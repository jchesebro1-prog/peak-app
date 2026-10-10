import { isOpen, slaDeadline, STALE_DAYS, type LeadRecord } from "@/lib/stores/leads";
import { sameName } from "@/lib/quote-approval-rules";
import { displayLeadNumber } from "@/lib/estimate-number";
import { money } from "@/lib/format";
import { triageKey } from "../keys";
import type { TriageCandidate, TriageFact } from "../types";
import type { FeedCtx, TriageFeed } from "./context";

const DAY = 86_400_000;
export const SLA_SOON_MS = 4 * 3_600_000;

/**
 * followUpInfo()'s precedence (stores/leads.ts) re-done against an explicit
 * `now` (the store reads Date.now()): SLA breached wins outright; else SLA
 * due within 4 h and/or next action overdue; stale only when nothing else.
 */
export function leadFacts(l: LeadRecord, now: number): { facts: TriageFact[]; since: number } {
  const facts: TriageFact[] = [];
  let since = l.createdAt || 0;
  if (!l.firstContactAt && l.stage === "new") {
    const ms = slaDeadline(l) - now;
    if (ms < 0) return { facts: [{ kind: "lead_sla_breached" }], since };
    if (ms <= SLA_SOON_MS) facts.push({ kind: "lead_sla_due_soon", minutes: Math.max(1, Math.ceil(ms / 60_000)) });
  }
  if (l.nextActionAt && l.nextActionAt < now) {
    facts.push({ kind: "lead_next_action_overdue" });
    since = l.nextActionAt;
  }
  if (!facts.length) {
    const last = l.lastActivityAt || l.createdAt || now;
    const days = Math.floor((now - last) / DAY);
    if (days >= STALE_DAYS) {
      facts.push({ kind: "lead_stale", days });
      since = last;
    }
  }
  return { facts, since };
}

/** Open leads I own, plus unowned ones — the bell's `unownedOrMine` rule. */
export function selectLeads(leads: readonly LeadRecord[], ctx: Pick<FeedCtx, "me" | "now">): TriageCandidate[] {
  const out: TriageCandidate[] = [];
  for (const l of leads) {
    if (!isOpen(l)) continue;
    if (l.owner && !sameName(l.owner, ctx.me.name)) continue;
    const { facts, since } = leadFacts(l, ctx.now);
    if (!facts.length) continue;
    out.push({
      key: triageKey.lead(l.id),
      source: "lead",
      title: l.org || l.contact || displayLeadNumber(l),
      sub: [l.interest, l.value ? money(l.value) : "", l.owner ? "" : "unassigned"].filter(Boolean).join(" · "),
      href: `/leads?lead=${encodeURIComponent(l.id)}`,
      since,
      facts,
    });
  }
  return out;
}

export const leadsFeed: TriageFeed = {
  source: "lead",
  async load(ctx) {
    return { candidates: selectLeads(await ctx.data.leads(), ctx) };
  },
};
