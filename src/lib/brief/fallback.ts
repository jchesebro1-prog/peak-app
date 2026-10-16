/**
 * AI daily brief — the rule-built brief (spec §1 step 4 "Fallback"): used on a
 * refusal, an error, or when Assist is off. The summary is composed from the
 * counts, in the card's block order — Emails, then Estimates, then Tasks
 * (Jeff, 2026-10-15; `blocks.ts`); Do-these-first is the top 3 snapshot rows
 * with their reasons. Pure, client-safe.
 */
import { chicagoTime } from "@/lib/triage/clock";
import type { SnapshotRow, TriageSource } from "@/lib/triage/types";
import { rowSource } from "./blocks";
import { BRIEF_SUMMARY_MAX, BRIEF_WHY_MAX, cleanBriefText } from "./sanitize";
import type { BriefOrganize, BriefPromiseTask, BriefSince, BriefSlot, BriefText, BriefToday, QuietQuote } from "./types";

export type BriefFacts = {
  slot: BriefSlot;
  /** The snapshot rows in rank order. */
  rows: ReadonlyArray<Pick<SnapshotRow, "key" | "title" | "reason">>;
  organize: BriefOrganize;
  newPromiseTasks: readonly BriefPromiseTask[];
  today: BriefToday;
  quiet: readonly QuietQuote[];
  approvals: number;
  since?: BriefSince;
};

const RULE_DO_FIRST = 3;

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** "1 h 10 min" / "25 min" / "2 h". */
export function driveLabel(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r} min`;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** Rows of these sources (by key prefix) — the per-block counts. */
export function countRows(rows: ReadonlyArray<{ key: string; source?: unknown }>, ...sources: TriageSource[]): number {
  return rows.filter((r) => sources.includes(rowSource(r)!)).length;
}

export function ruleBrief(f: BriefFacts): BriefText {
  const parts: string[] = [];
  if (f.slot === "midday" && f.since) parts.push(`Since this morning: ${f.since.done} done, ${f.since.open} still open, ${f.since.new} new.`);
  if (!f.rows.length) parts.push("Your list is clear.");

  // Emails
  const waiting = countRows(f.rows, "email");
  if (waiting > 0) parts.push(`${n(waiting, "customer", "customers")} waiting on a reply.`);
  const o = f.organize;
  if (o.toFile > 0 || o.noise > 0) {
    const bits: string[] = [];
    if (o.toFile > 0) bits.push(`${n(o.toFile, "thread", "threads")} to file${o.strong > 0 ? ` (${o.strong} strong)` : ""}`);
    if (o.noise > 0) bits.push(`${o.noise} noise`);
    parts.push(`Inbox: ${bits.join(", ")}.`);
  }

  // Estimates
  if (f.approvals > 0) parts.push(`${n(f.approvals, "quote", "quotes")} waiting on your approval.`);
  if (f.quiet.length > 0) parts.push(`${n(f.quiet.length, "sent quote has", "sent quotes have")} gone quiet.`);
  const leads = countRows(f.rows, "lead");
  if (leads > 0) parts.push(`${n(leads, "lead", "leads")} ready to quote.`);
  const renewals = countRows(f.rows, "renewal");
  if (renewals > 0) parts.push(`${n(renewals, "renewal", "renewals")} coming up.`);

  // Tasks
  const onList = countRows(f.rows, "task", "assignment", "call");
  if (onList > 0) parts.push(`${n(onList, "task", "tasks")} on your list.`);
  if (f.newPromiseTasks.length > 0) parts.push(`${n(f.newPromiseTasks.length, "new task from a promise", "new tasks from promises")}.`);
  const t = f.today;
  if (t.visits > 0) {
    const first = t.firstVisitAt ? (t.visits === 1 ? `, at ${chicagoTime(t.firstVisitAt)}` : `, the first at ${chicagoTime(t.firstVisitAt)}`) : "";
    parts.push(`${n(t.visits, "site visit", "site visits")} today${first}.`);
  }
  if (t.driveMin && t.driveMin > 0) parts.push(`About ${driveLabel(t.driveMin)} of driving.`);
  if (t.tasksDue > 0) parts.push(`${n(t.tasksDue, "task", "tasks")} on today's plan.`);
  return {
    summary: cleanBriefText(parts.join(" "), BRIEF_SUMMARY_MAX),
    doFirst: f.rows.slice(0, RULE_DO_FIRST).map((r) => ({ key: r.key, why: cleanBriefText(r.reason, BRIEF_WHY_MAX) })),
  };
}
