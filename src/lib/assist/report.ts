/** Assist report (D879) — pure aggregation. Extract steps cost money but carry no outcome. */
import type { AssistRun } from "@/lib/stores/assist-runs";
import type { EstimateRunOutcome } from "./outcome";
import type { FilingLogEntry } from "@/lib/stores/inbox-org";
import type { FilingSource } from "@/lib/inbox-org/types";
import { NUDGE_OPENED_KEY, PREDRAFT_RUN_KEY } from "@/lib/brief/report-keys";

/** `noSuggestion` — estimate draft runs that saved no suggestion (spec 2026-10-13 §4): counted apart, never as discarded. */
export type ReportRow = { key: string; runs: number; okRuns: number; accepted: number; edited: number; discarded: number; pending: number; noSuggestion: number; costUsd: number };

const blank = (key: string): ReportRow => ({ key, runs: 0, okRuns: 0, accepted: 0, edited: 0, discarded: 0, pending: 0, noSuggestion: 0, costUsd: 0 });

/** #335 — the Inbox-organization passes read as what they do. */
const FEATURE_LABEL: Partial<Record<AssistRun["feature"], string>> = { file: "file (filing)", promise: "promise (court + promises)", brief: "Daily brief", ask: "Ask AI", vendorpdf: "Read the PDF" };

export function featureKey(r: Pick<AssistRun, "feature" | "step">): string {
  return r.feature === "estimate" ? `Suggest estimate (${r.step ?? "draft"})` : FEATURE_LABEL[r.feature] ?? r.feature;
}

/** `estimateOutcomes`: run id → the draft run's bucket (outcome.ts `estimateRunOutcome`); absent = pending. */
export function assistReport(runs: AssistRun[], estimateOutcomes: Map<string, EstimateRunOutcome>) {
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
        else if (outcome === "none") row.noSuggestion++;
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

/* ---- AI daily brief rows (spec §6) ------------------------------------------- */

/** One stored brief's facts the report needs (the blob's `builtBy`). */
export type BriefBuildRow = { builtBy: string };

export type BriefReport = {
  /** briefs stored this month, by how they were built */
  built: { cron: number; lazy: number; rebuild: number; total: number };
  /** Reply runs the draft queue made (marked `queued`), and what people did with them. Task suggestions are not counted. */
  preDrafts: {
    made: number;
    /** accepted or edited — the person used it (Use it, then sent) */
    used: number;
    /** thrown away: the composer closed unsent and the reader left, or replaced by a newer run */
    discarded: number;
    /** no outcome yet: never opened, or opened and still parked. Includes drafts made stale by newer mail. */
    unused: number;
  };
  /** Follow-up nudges: `made` = ok quiet-quote runs; `opened` = the composer opened via ?nudge= (not proof it was sent — Gmail send isn't tied back to the run). */
  nudges: { made: number; opened: number };
};

/**
 * Pure: the month's brief rows. `runs` are the month's assist_runs; `briefs`
 * the month's stored briefs. Brief builds themselves are `brief` runs with a
 * `brief:` contextRef and are NOT nudges; nudges are the `brief` runs on a
 * `quote:` contextRef.
 */
export function briefReport(runs: AssistRun[], briefs: BriefBuildRow[]): BriefReport {
  const built = { cron: 0, lazy: 0, rebuild: 0, total: 0 };
  for (const b of briefs) {
    if (b.builtBy === "cron" || b.builtBy === "lazy" || b.builtBy === "rebuild") built[b.builtBy]++;
    built.total++;
  }
  const preDrafts = { made: 0, used: 0, discarded: 0, unused: 0 };
  const nudges = { made: 0, opened: 0 };
  for (const r of runs) {
    if (!r.ok) continue;
    const d = (r.outcomeDetail ?? {}) as Record<string, unknown>;
    if (r.feature === "reply" && d[PREDRAFT_RUN_KEY] === true) {
      preDrafts.made++;
      if (r.outcome === "accepted" || r.outcome === "edited") preDrafts.used++;
      else if (r.outcome === "discarded") preDrafts.discarded++;
      else preDrafts.unused++;
    } else if (r.feature === "brief" && String(r.contextRef || "").startsWith("quote:")) {
      nudges.made++;
      if (r.outcome === "accepted" && d[NUDGE_OPENED_KEY] === true) nudges.opened++;
    }
  }
  return { built, preDrafts, nudges };
}

/* ---- Ask AI rows (spec 2026-10-13 §6) ---------------------------------------- */

export const ASK_REPORT_KINDS = ["task", "note", "email", "estimate"] as const;
type AskReportKind = (typeof ASK_REPORT_KINDS)[number];
type KindCounts = Record<AskReportKind, number>;

/** One person's (or everyone's) Ask AI month. */
export type AskReportRow = {
  key: string;
  questions: number;
  /** answered by a Haiku / a Sonnet model (Try harder asks Sonnet); anything else counts in `other` */
  haiku: number;
  sonnet: number;
  other: number;
  /** questions asked with Try harder (`outcomeDetail.hard === true`; `retryOf` can be null when the earlier answer never logged) */
  tryHarder: number;
  /** tryHarder ÷ questions, %, one decimal; null with no questions */
  tryHarderPct: number | null;
  /** cards shown, by kind (`outcomeDetail.cardKinds`); `cardsShown` also counts runs logged before kinds were kept */
  proposed: KindCounts;
  cardsShown: number;
  /** cards confirmed, by kind (`outcomeDetail.confirmed`) */
  confirmed: KindCounts;
  webSearches: number;
  costUsd: number;
};

export type AskReport = { total: AskReportRow; byPerson: AskReportRow[] };

const kinds = (): KindCounts => ({ task: 0, note: 0, email: 0, estimate: 0 });
const blankAsk = (key: string): AskReportRow => ({ key, questions: 0, haiku: 0, sonnet: 0, other: 0, tryHarder: 0, tryHarderPct: null, proposed: kinds(), cardsShown: 0, confirmed: kinds(), webSearches: 0, costUsd: 0 });
const isKind = (k: unknown): k is AskReportKind => typeof k === "string" && (ASK_REPORT_KINDS as readonly string[]).includes(k);
const count = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/**
 * Pure: the month's Ask AI table. One `ask` run = one question (failed and
 * refused-after-start runs included); other features are ignored. The model
 * is the one that answered (`model`). Cost is rounded like the main report.
 */
export function askReport(runs: AssistRun[]): AskReport {
  const total = blankAsk("All");
  const people = new Map<string, AskReportRow>();
  for (const r of runs) {
    if (r.feature !== "ask") continue;
    const d = (r.outcomeDetail ?? {}) as Record<string, unknown>;
    const who = r.userName || r.userId;
    for (const row of [total, people.get(who) ?? blankAsk(who)]) {
      row.questions++;
      const m = String(r.model || "").toLowerCase();
      if (m.includes("haiku")) row.haiku++;
      else if (m.includes("sonnet")) row.sonnet++;
      else row.other++;
      if (d.hard === true) row.tryHarder++;
      row.cardsShown += Math.max(count(d.cards), Array.isArray(d.cardKinds) ? d.cardKinds.length : 0);
      for (const k of Array.isArray(d.cardKinds) ? d.cardKinds : []) if (isKind(k)) row.proposed[k]++;
      for (const k of Array.isArray(d.confirmed) ? d.confirmed : []) if (isKind(k)) row.confirmed[k]++;
      row.webSearches += count(d.web);
      row.costUsd += r.costUsd || 0;
      if (row !== total) people.set(who, row);
    }
  }
  const done = (x: AskReportRow): AskReportRow => ({
    ...x,
    tryHarderPct: x.questions ? Math.round((x.tryHarder / x.questions) * 1000) / 10 : null,
    costUsd: Math.round(x.costUsd * 10000) / 10000,
  });
  return { total: done(total), byPerson: [...people.values()].map(done).sort((a, b) => a.key.localeCompare(b.key)) };
}
