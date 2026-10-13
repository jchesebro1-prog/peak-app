/** assist_runs store (#334, spec §6). One row per model call. */
import { getDoc, listDocsByField, patchDoc, upsertDoc } from "@/db/doc-store";
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

/** First write wins; only the run's own user may record its outcome. */
export async function setRunOutcome(
  id: string,
  userId: string,
  outcome: AssistOutcome,
  detail: Record<string, unknown> | null,
  now: number = Date.now()
): Promise<boolean> {
  let applied = false;
  await patchDoc<AssistRun>(COLL, id, (d) => {
    if (d.userId !== userId || d.outcome) return d;
    applied = true;
    d.outcome = outcome;
    d.outcomeDetail = { ...(d.outcomeDetail ?? {}), ...(detail ?? {}) };
    d.outcomeAt = now;
    return d;
  });
  return applied;
}

/** Merge facts into outcomeDetail without setting an outcome (e.g. the estimate's drafted lines). */
export async function mergeRunDetail(id: string, patch: Record<string, unknown>): Promise<void> {
  await patchDoc<AssistRun>(COLL, id, (d) => {
    d.outcomeDetail = { ...(d.outcomeDetail ?? {}), ...patch };
    return d;
  });
}

export async function listRunsByMonth(monthKey: string): Promise<AssistRun[]> {
  return listDocsByField<AssistRun>(COLL, "monthKey", [monthKey]);
}

export async function monthSpend(monthKey: string): Promise<number> {
  const runs = await listRunsByMonth(monthKey);
  return runs.reduce((s, r) => s + (Number(r.costUsd) || 0), 0);
}
