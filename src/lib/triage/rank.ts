import { chicagoTime } from "./clock";
import type { RankedCandidate, TriageCandidate, TriageFact } from "./types";

/**
 * Spec "Ranking" — points per fact, a row's score is the sum, ties → older
 * first → key. The reason is the top two POSITIVE facts in words. Pure.
 */
export function pointsFor(f: TriageFact): number {
  switch (f.kind) {
    case "lead_sla_breached":
      return 60;
    case "visit_today":
      return 50;
    case "task_overdue":
      return 40 + Math.min(30, 5 * Math.max(0, f.days));
    case "customer_waiting":
      return 40 + Math.min(30, 10 * Math.max(0, f.businessDays - 1));
    case "quote_awaiting_approval":
    case "lead_sla_due_soon":
      return 35;
    case "task_due_today":
    case "call_todo":
    case "portal_quote_review":
    case "quote_sent_back":
    case "renewal_past_due":
      return 30;
    case "lead_next_action_overdue":
      return 25;
    case "task_at_risk":
    case "renewal_window":
    case "task_due_tomorrow":
      return 15;
    case "task_tier":
      return f.tier === "high" ? 15 : -10;
    case "linked_open_deal":
    case "call_names_me":
    case "visit_flag":
    case "customer_message_new":
    case "lead_stale":
      return 10;
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** 45 → "45 min", 180 → "3h", 90 → "1h 30m": whole hours floor, the remainder shows as minutes (never rounds up past the real time left). */
function dueIn(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function factLabel(f: TriageFact): string {
  switch (f.kind) {
    case "lead_sla_breached":
      return "First response overdue";
    case "visit_today":
      return `Site visit today ${chicagoTime(f.startAt)}`;
    case "task_overdue":
      return `Overdue ${plural(f.days, "day")}`;
    case "customer_waiting":
      return `Customer waiting ${plural(f.businessDays, "business day")}`;
    case "quote_awaiting_approval":
      return "Waiting on your approval";
    case "lead_sla_due_soon":
      return `First response due in ${dueIn(f.minutes)}`;
    case "task_due_today":
      return "Due today";
    case "call_todo":
      return "To-do from a call";
    case "portal_quote_review":
      return "Portal quote to review";
    case "quote_sent_back":
      return "Sent back to you";
    case "renewal_past_due":
      return `Renewal ${plural(f.days, "day")} past due`;
    case "lead_next_action_overdue":
      return "Follow-up overdue";
    case "task_at_risk":
      return "At risk";
    case "linked_open_deal":
      return f.label;
    case "call_names_me":
      return "Names you";
    case "visit_flag":
      return f.label;
    case "task_tier":
      return f.tier === "high" ? "High priority" : "Low priority";
    case "renewal_window":
      return `Renewal due in ${plural(f.days, "day")}`;
    case "task_due_tomorrow":
      return "Due tomorrow";
    case "customer_message_new":
      return `Customer message ${f.hours}h old`;
    case "lead_stale":
      return `No contact in ${plural(f.days, "day")}`;
  }
}

export function scoreOf(facts: readonly TriageFact[]): number {
  return facts.reduce((n, f) => n + pointsFor(f), 0);
}

export function reasonOf(facts: readonly TriageFact[]): string {
  return facts
    .map((f, i) => ({ f, i, p: pointsFor(f) }))
    .filter((x) => x.p > 0)
    .sort((a, b) => b.p - a.p || a.i - b.i)
    .slice(0, 2)
    .map((x) => factLabel(x.f))
    .join(" · ");
}

const ageOf = (c: TriageCandidate) => (c.since > 0 ? c.since : Number.MAX_SAFE_INTEGER);

export function rankCandidates(cands: readonly TriageCandidate[]): RankedCandidate[] {
  return cands
    .map((c) => ({ ...c, score: scoreOf(c.facts), reason: reasonOf(c.facts) }))
    .sort((a, b) => b.score - a.score || ageOf(a) - ageOf(b) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
