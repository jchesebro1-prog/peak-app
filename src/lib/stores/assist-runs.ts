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
