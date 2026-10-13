/** Assist report (D879) — pure aggregation. Extract steps cost money but carry no outcome. */
import type { AssistRun } from "@/lib/stores/assist-runs";
import type { AssistOutcome } from "./types";
import type { FilingLogEntry } from "@/lib/stores/inbox-org";
import type { FilingSource } from "@/lib/inbox-org/types";

export type ReportRow = { key: string; runs: number; okRuns: number; accepted: number; edited: number; discarded: number; pending: number; costUsd: number };

const blank = (key: string): ReportRow => ({ key, runs: 0, okRuns: 0, accepted: 0, edited: 0, discarded: 0, pending: 0, costUsd: 0 });

/** #335 — the Inbox-organization passes read as what they do. */
const FEATURE_LABEL: Partial<Record<AssistRun["feature"], string>> = { file: "file (filing)", promise: "promise (court + promises)", brief: "Daily brief" };

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

/* ---- #335 Inbox organization rows (spec §8 "Report") ------------------------- */

/** One filing source's row: what was suggested and what people did with it. */
export type FilingSourceRow = {
  source: FilingSource;
  suggested: number;
  /** approved as suggested (incl. "Noise" on a noise suggestion) */
  approved: number;
  /** changed to something else (Change…, or Noise on a filing) */
  corrected: number;
  /** "Not noise" on a noise suggestion */
  rescued: number;
  skipped: number;
  undone: number;
  /** filed with no person deciding (on reply, a teammate's reply, a sender
   *  rule) — counted apart, never as approved */
  autoFiled: number;
  /** approved ÷ (approved + corrected + rescued + skipped), one decimal; null with none */
  approvedPct: number | null;
};

export type FilingReport = {
  bySource: FilingSourceRow[];
  totals: Omit<FilingSourceRow, "source">;
  /** "On me" / "Not on me" overrides in the reader */
  courtOverrides: number;
  promiseTasks: { created: number; undone: number };
};

export type PromiseTaskRow = { id: string; createdAt: number; deleted: boolean };

const FILING_SOURCES: FilingSource[] = ["rule", "identity", "number", "noise-rule", "ai"];
const AUTO_ACTIONS = new Set(["reply", "teammate-reply", "rule"]);

const blankSource = (source: FilingSource): FilingSourceRow => ({
  source, suggested: 0, approved: 0, corrected: 0, rescued: 0, skipped: 0, undone: 0, autoFiled: 0, approvedPct: null,
});

function approvedPct(r: Pick<FilingSourceRow, "approved" | "corrected" | "rescued" | "skipped">): number | null {
  const decided = r.approved + r.corrected + r.rescued + r.skipped;
  return decided ? Math.round((r.approved / decided) * 1000) / 10 : null;
}

/**
 * Pure: the month's filing report. AI suggestions come from the `file` runs
 * (one ok run = one suggestion; its outcome is what a person did; an
 * `autoFiled` / `undone` note in its detail counts apart — an auto-filing
 * leaves the outcome null). Rule-based ones come from the filing log: the
 * pipeline's own entries (no `action`) are the suggestions, the rest are what
 * happened to them. `log` and `promiseTasks` must already be the month's.
 */
export function filingReport(runs: AssistRun[], log: FilingLogEntry[], promiseTasks: PromiseTaskRow[]): FilingReport {
  const rows = new Map<FilingSource, FilingSourceRow>(FILING_SOURCES.map((s) => [s, blankSource(s)]));
  const row = (s: FilingSource) => {
    let r = rows.get(s);
    if (!r) rows.set(s, (r = blankSource(s)));
    return r;
  };
  let courtOverrides = 0;

  for (const r of runs) {
    if (r.feature !== "file" || !r.ok) continue;
    const x = row("ai");
    x.suggested++;
    const d = (r.outcomeDetail ?? {}) as { action?: string; autoFiled?: string; undone?: boolean };
    if (r.outcome === "accepted") x.approved++;
    else if (r.outcome === "edited") {
      if (d.action === "rescued") x.rescued++;
      else x.corrected++;
    } else if (r.outcome === "discarded") x.skipped++;
    else if (d.autoFiled) x.autoFiled++;
    if (d.undone) x.undone++;
  }

  for (const e of log) {
    if (e.action === "court-override") {
      courtOverrides++;
      continue;
    }
    if (e.source === "ai") continue; // AI suggestions are counted from their runs
    const x = row(e.source);
    if (!e.action) {
      if (e.outcome === "suggested") x.suggested++;
    } else if (e.action === "approved") x.approved++;
    else if (e.action === "changed") x.corrected++;
    else if (e.action === "noise") {
      if (e.noise) x.approved++;
      else x.corrected++;
    } else if (e.action === "rescued") x.rescued++;
    else if (e.action === "skipped") x.skipped++;
    else if (e.action === "undone") x.undone++;
    else if (AUTO_ACTIONS.has(e.action)) x.autoFiled++;
  }

  const bySource = [...rows.values()].map((r) => ({ ...r, approvedPct: approvedPct(r) }));
  const totals: Omit<FilingSourceRow, "source"> = { suggested: 0, approved: 0, corrected: 0, rescued: 0, skipped: 0, undone: 0, autoFiled: 0, approvedPct: null };
  for (const r of bySource) {
    totals.suggested += r.suggested;
    totals.approved += r.approved;
    totals.corrected += r.corrected;
    totals.rescued += r.rescued;
    totals.skipped += r.skipped;
    totals.undone += r.undone;
    totals.autoFiled += r.autoFiled;
  }
  totals.approvedPct = approvedPct(totals);
  return {
    bySource,
    totals,
    courtOverrides,
    promiseTasks: { created: promiseTasks.length, undone: promiseTasks.filter((t) => t.deleted).length },
  };
}
