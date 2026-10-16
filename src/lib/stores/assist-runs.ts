/** assist_runs store (#334, spec §6). One row per model call. */
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { DOC_TABLES } from "@/db/doc-tables";
import { getDoc, listDocsByField, upsertDoc } from "@/db/doc-store";
import type { AssistFeature, AssistOutcome, AssistStep } from "@/lib/assist/types";

export type AssistRun = {
  id: string;
  feature: AssistFeature;
  step: AssistStep | null;
  userId: string;
  userName: string;
  provider: "anthropic" | "local" | "fake";
  model: string;
  requestedModel: string;
  fellBack: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  latencyMs: number;
  inputHash: string;
  output: string;
  ok: boolean;
  error: string | null;
  stopReason: string | null;
  contextRef: string;
  monthKey: string;
  outcome: AssistOutcome | null;
  outcomeDetail: Record<string, unknown> | null;
  outcomeAt: number | null;
  createdAt: number;
};

const COLL = "assist_runs" as const;
export const RUN_OUTPUT_MAX = 20_000;

export function newRunId(now: number = Date.now()): string {
  return "AR-" + now.toString(36) + "-" + Math.random().toString(36).slice(2, 6);
}

export async function createRun(run: AssistRun): Promise<AssistRun> {
  return upsertDoc(COLL, { ...run, output: (run.output || "").slice(0, RUN_OUTPUT_MAX) });
}

export async function getRun(id: string): Promise<AssistRun | null> {
  return getDoc<AssistRun>(COLL, id);
}

/**
 * First write wins; only the run's own user may record its outcome. One atomic
 * UPDATE (never a read-modify-write): the WHERE clause is re-checked under the
 * row lock, so of two concurrent calls exactly one applies and a no-op attempt
 * writes nothing. `doc->>'outcome' IS NULL` covers both a missing key and the
 * stored JSON null.
 */
export async function setRunOutcome(
  id: string,
  userId: string,
  outcome: AssistOutcome,
  detail: Record<string, unknown> | null,
  now: number = Date.now()
): Promise<boolean> {
  const db = await getDb();
  const t = DOC_TABLES[COLL];
  const rows = await db
    .update(t)
    .set({
      doc: sql`jsonb_set(jsonb_set(jsonb_set(${t.doc}, '{outcome}', to_jsonb(${outcome}::text)), '{outcomeAt}', to_jsonb(${now}::bigint)), '{outcomeDetail}', COALESCE(NULLIF(${t.doc}->'outcomeDetail', 'null'::jsonb), '{}'::jsonb) || ${JSON.stringify(detail ?? {})}::jsonb)`,
      rev: sql`${t.rev} + 1`,
      updatedAt: now,
      receivedAt: now,
    })
    .where(and(eq(t.id, id), eq(t.deleted, false), sql`${t.doc}->>'userId' = ${userId}`, sql`${t.doc}->>'outcome' IS NULL`))
    .returning({ id: t.id });
  return rows.length > 0;
}

/**
 * #348 slice 5 — score a Read-the-PDF run at the estimate save that first keeps it. First write wins; no user check
 * (a teammate may save) but feature-checked: only a `vendorpdf` run. Atomic, like setRunOutcome: one UPDATE whose
 * WHERE clause (outcome still null, feature vendorpdf) is re-checked under the row lock. `detail` merges into the
 * read-time detail (hard, mathFlags, dataHash… stay).
 */
export async function setVendorPdfOutcome(
  id: string,
  outcome: AssistOutcome,
  detail: Record<string, unknown>,
  now: number = Date.now()
): Promise<boolean> {
  const db = await getDb();
  const t = DOC_TABLES[COLL];
  const rows = await db
    .update(t)
    .set({
      doc: sql`jsonb_set(jsonb_set(jsonb_set(${t.doc}, '{outcome}', to_jsonb(${outcome}::text)), '{outcomeAt}', to_jsonb(${now}::bigint)), '{outcomeDetail}', COALESCE(NULLIF(${t.doc}->'outcomeDetail', 'null'::jsonb), '{}'::jsonb) || ${JSON.stringify(detail ?? {})}::jsonb)`,
      rev: sql`${t.rev} + 1`,
      updatedAt: now,
      receivedAt: now,
    })
    .where(and(eq(t.id, id), eq(t.deleted, false), sql`${t.doc}->>'feature' = 'vendorpdf'`, sql`${t.doc}->>'outcome' IS NULL`))
    .returning({ id: t.id });
  return rows.length > 0;
}

/** Confirmed card kinds kept on one Ask AI run. */
export const ASK_CONFIRMED_MAX = 20;

/**
 * Ask AI — a card was confirmed (spec 2026-10-13 §4). One atomic UPDATE on the
 * asker's own `ask` run: the outcome becomes `accepted` only while it is still
 * null (first decision wins — a Try-harder `discarded` stays), and `kind` is
 * appended to `outcomeDetail.confirmed` while it holds fewer than 20. False
 * when the run is missing, someone else's, or not an Ask run.
 */
export async function recordAskConfirm(id: string, userId: string, kind: string, now: number = Date.now()): Promise<boolean> {
  const db = await getDb();
  const t = DOC_TABLES[COLL];
  const detail = sql`COALESCE(NULLIF(${t.doc}->'outcomeDetail', 'null'::jsonb), '{}'::jsonb)`;
  const confirmed = sql`COALESCE(NULLIF(${detail}->'confirmed', 'null'::jsonb), '[]'::jsonb)`;
  const nextConfirmed = sql`CASE WHEN jsonb_typeof(${confirmed}) = 'array' AND jsonb_array_length(${confirmed}) < ${ASK_CONFIRMED_MAX} THEN ${confirmed} || to_jsonb(${kind}::text) WHEN jsonb_typeof(${confirmed}) = 'array' THEN ${confirmed} ELSE jsonb_build_array(${kind}::text) END`;
  const undecided = sql`(${t.doc}->>'outcome') IS NULL`;
  const rows = await db
    .update(t)
    .set({
      doc: sql`jsonb_set(jsonb_set(jsonb_set(${t.doc}, '{outcome}', CASE WHEN ${undecided} THEN to_jsonb('accepted'::text) ELSE ${t.doc}->'outcome' END), '{outcomeAt}', CASE WHEN ${undecided} THEN to_jsonb(${now}::bigint) ELSE COALESCE(${t.doc}->'outcomeAt', 'null'::jsonb) END), '{outcomeDetail}', ${detail} || jsonb_build_object('confirmed', ${nextConfirmed}))`,
      rev: sql`${t.rev} + 1`,
      updatedAt: now,
      receivedAt: now,
    })
    .where(and(eq(t.id, id), eq(t.deleted, false), sql`${t.doc}->>'userId' = ${userId}`, sql`${t.doc}->>'feature' = 'ask'`))
    .returning({ id: t.id });
  return rows.length > 0;
}

/** Merge facts into outcomeDetail without setting an outcome (e.g. the estimate's drafted lines). Atomic; false if the run is missing. */
export async function mergeRunDetail(id: string, patch: Record<string, unknown>): Promise<boolean> {
  const db = await getDb();
  const t = DOC_TABLES[COLL];
  const now = Date.now();
  const rows = await db
    .update(t)
    .set({
      doc: sql`jsonb_set(${t.doc}, '{outcomeDetail}', COALESCE(NULLIF(${t.doc}->'outcomeDetail', 'null'::jsonb), '{}'::jsonb) || ${JSON.stringify(patch ?? {})}::jsonb)`,
      rev: sql`${t.rev} + 1`,
      updatedAt: now,
      receivedAt: now,
    })
    .where(and(eq(t.id, id), eq(t.deleted, false)))
    .returning({ id: t.id });
  return rows.length > 0;
}

export async function listRunsByMonth(monthKey: string): Promise<AssistRun[]> {
  return listDocsByField<AssistRun>(COLL, "monthKey", [monthKey]);
}

export async function monthSpend(monthKey: string): Promise<number> {
  const runs = await listRunsByMonth(monthKey);
  return runs.reduce((s, r) => s + (Number(r.costUsd) || 0), 0);
}

/**
 * One user's logged spend on one feature in [fromMs, toMs) by `createdAt` —
 * Ask AI's daily per-user budget. One SQL SUM, no rows loaded; a non-numeric
 * cost or timestamp counts as nothing.
 */
export async function userFeatureSpend(userId: string, feature: AssistFeature, fromMs: number, toMs: number): Promise<number> {
  const db = await getDb();
  const t = DOC_TABLES[COLL];
  const cost = sql`CASE WHEN jsonb_typeof(${t.doc}->'costUsd') = 'number' THEN (${t.doc}->>'costUsd')::numeric ELSE 0 END`;
  const at = sql`CASE WHEN jsonb_typeof(${t.doc}->'createdAt') = 'number' THEN (${t.doc}->>'createdAt')::numeric ELSE NULL END`;
  const rows = await db
    .select({ total: sql<string | number | null>`COALESCE(SUM(${cost}), 0)` })
    .from(t)
    .where(and(eq(t.deleted, false), sql`${t.doc}->>'userId' = ${userId}`, sql`${t.doc}->>'feature' = ${feature}`, sql`${at} >= ${fromMs}`, sql`${at} < ${toMs}`));
  const n = Number(rows[0]?.total ?? 0);
  return Number.isFinite(n) ? n : 0;
}
