import type { SiteVisit } from "@/lib/stores/site-visits";
import { sameName } from "@/lib/quote-approval-rules";
import { dayKey } from "../clock";
import { triageKey } from "../keys";
import type { TriageCandidate, TriageFact } from "../types";
import type { TriageFeed } from "./context";

/** Spec 2 adds `attendees: string[]` (names); until then a visit has only its lead, `assignedTo`. */
export function visitAttendees(v: SiteVisit): string[] {
  const a = (v as SiteVisit & { attendees?: unknown }).attendees;
  return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : [];
}

/** Today's (Chicago) visits not yet done where `me` is the lead or an attendee. */
export function todaysVisitsFor(visits: readonly SiteVisit[], me: string, now: number): SiteVisit[] {
  const today = dayKey(now);
  return visits.filter(
    (v) =>
      !!v.startAt &&
      dayKey(v.startAt) === today &&
      v.stage !== "done" &&
      (sameName(v.assignedTo, me) || visitAttendees(v).some((n) => sameName(n, me)))
  );
}

export function selectVisits(visits: readonly SiteVisit[], flags: ReadonlyMap<string, readonly string[]>): TriageCandidate[] {
  return visits.map((v) => {
    const facts: TriageFact[] = [{ kind: "visit_today", startAt: v.startAt || 0 }];
    const f = flags.get(v.id) ?? [];
    if (f.length) facts.push({ kind: "visit_flag", label: f.join(" · ") });
    return {
      key: triageKey.visit(v.id),
      source: "visit",
      title: `${v.customer || v.id}${v.venue ? ` — ${v.venue}` : ""}`,
      sub: [v.reason, v.address].filter(Boolean).join(" · "),
      href: "/calendar?view=day",
      since: v.startAt || 0,
      facts,
    };
  });
}

export const visitsFeed: TriageFeed = {
  source: "visit",
  async load(ctx) {
    const mine = todaysVisitsFor(await ctx.data.visits(), ctx.me.name, ctx.now);
    const flags = mine.length ? await ctx.hooks.visitFlags(mine.map((v) => v.id), ctx.now) : new Map<string, readonly string[]>();
    return { candidates: selectVisits(mine, flags) };
  },
};
