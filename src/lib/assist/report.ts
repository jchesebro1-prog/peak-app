/** Assist report (D879) — pure aggregation. Extract steps cost money but carry no outcome. */
import type { AssistRun } from "@/lib/stores/assist-runs";
import type { AssistOutcome } from "./types";

export type ReportRow = { key: string; runs: number; okRuns: number; accepted: number; edited: number; discarded: number; pending: number; costUsd: number };

const blank = (key: string): ReportRow => ({ key, runs: 0, okRuns: 0, accepted: 0, edited: 0, discarded: 0, pending: 0, costUsd: 0 });

/** #335 — the Inbox-organization passes read as what they do. */
const FEATURE_LABEL: Partial<Record<AssistRun["feature"], string>> = { file: "file (filing)", promise: "promise (court + promises)" };

export function featureKey(r: Pick<AssistRun, "feature" | "step">): string {
  return r.feature === "estimate" ? `estimate (${r.step ?? "draft"})` : FEATURE_LABEL[r.feature] ?? r.feature;
}

export function assistReport(runs: AssistRun[], estimateOutcomes: Map<string, AssistOutcome>) {
  const groups = { byFeature: new Map<string, ReportRow>(), byUser: new Map<string, ReportRow>(), byModel: new Map<string, ReportRow>() };
  let totalUsd = 0;
  for (const r of runs) {
    totalUsd += r.costUsd || 0;
    const outcome = r.outcome ?? estimateOutcomes.get(r.id) ?? null;
    const bearing = r.ok && r.step !== "extract";
    for (const [map, key] of [[groups.byFeature, featureKey(r)], [groups.byUser, r.userName || r.userId], [groups.byModel, r.model]] as const) {
      const row = map.get(key) ?? blank(key);
      row.runs++;
      if (r.ok) row.okRuns++;
      row.costUsd += r.costUsd || 0;
      if (bearing) {
        if (outcome === "accepted") row.accepted++;
        else if (outcome === "edited") row.edited++;
        else if (outcome === "discarded") row.discarded++;
        else row.pending++;
      }
      map.set(key, row);
    }
  }
  const sorted = (m: Map<string, ReportRow>) => [...m.values()].map((x) => ({ ...x, costUsd: Math.round(x.costUsd * 10000) / 10000 })).sort((a, b) => a.key.localeCompare(b.key));
  return { totalUsd: Math.round(totalUsd * 10000) / 10000, runs: runs.length, byFeature: sorted(groups.byFeature), byUser: sorted(groups.byUser), byModel: sorted(groups.byModel) };
}

export type AssistReport = ReturnType<typeof assistReport>;

/** Current month first, then the n-1 before it (America/Chicago). */
export function recentMonthKeys(now: number, n: number, monthKey: (ms: number) => string): string[] {
  const out: string[] = [];
  let [y, m] = monthKey(now).split("-").map(Number);
  for (let i = 0; i < n; i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m--;
    if (m === 0) { m = 12; y--; }
  }
  return out;
}
