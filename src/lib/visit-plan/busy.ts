/**
 * Busy blocks for one person (spec 2026-10-09 site-visit scheduling,
 * "Double-booked"). Pure and client-safe. Busy = their scheduled visits and
 * their accepted (or own) timed Google events. Never busy: all-day,
 * declined, unanswered or tentative events, the app's drive events, and any
 * calendar copy of a visit (the visit itself is counted once, from its record).
 */
import { isVisitIcsCopy, visitPeople } from "@/lib/drive-plan/stops";
import { visitEventIds, type InviteVisitShape } from "@/lib/visit-invite-plan";
import { chicagoMinuteOfDay, fmtClockShort } from "./hours";

export type BusyBlock = { key: string; kind: "visit" | "event"; label: string; startMs: number; endMs: number };
export type BusyVisit = { id: string; label: string; startAt: number | null; endAt: number | null; stage: string; people: string[]; eventIds: string[] };
export type BusyEvent = {
  id: string;
  iCalUID: string;
  title: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  selfDeclined: boolean;
  selfResponse?: string;
  peakDriveKey: string;
};
export type VisitForBusy = InviteVisitShape & { venue: string; customer: string; stage: string };

export function toBusyVisit(v: VisitForBusy): BusyVisit {
  return { id: v.id, label: v.venue || v.customer || v.id, startAt: v.startAt, endAt: v.endAt, stage: v.stage, people: visitPeople(v), eventIds: visitEventIds(v) };
}

export function isBusyEvent(e: BusyEvent): boolean {
  if (e.allDay || e.selfDeclined || e.peakDriveKey || !(e.endMs > e.startMs)) return false;
  return !e.selfResponse || e.selfResponse === "accepted";
}

/** `visits` must include the visit being edited (its calendar copies are
 *  recognised); `excludeVisitId` keeps it from being its own conflict. */
export function busyBlocks(args: {
  person: string;
  visits: readonly BusyVisit[];
  events: readonly BusyEvent[] | null;
  excludeVisitId?: string | null;
}): BusyBlock[] {
  const out: BusyBlock[] = [];
  for (const v of args.visits) {
    if (v.id === args.excludeVisitId || v.startAt == null || !v.people.includes(args.person)) continue;
    if (v.stage !== "scheduled" && v.stage !== "done") continue;
    out.push({ key: "sv:" + v.id, kind: "visit", label: v.label, startMs: v.startAt, endMs: Math.max(v.endAt ?? v.startAt, v.startAt) });
  }
  const copies = args.visits.map((v) => ({ id: v.id, eventIds: v.eventIds }));
  for (const e of args.events ?? []) {
    if (!isBusyEvent(e) || isVisitIcsCopy(e, copies)) continue;
    out.push({ key: "g:" + e.id, kind: "event", label: e.title, startMs: e.startMs, endMs: e.endMs });
  }
  return out.sort((a, b) => a.startMs - b.startMs || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export function busyInRange(blocks: readonly BusyBlock[], minMs: number, maxMs: number): BusyBlock[] {
  return blocks.filter((b) => b.endMs > minMs && b.startMs < maxMs);
}

export function fmtBusyRange(b: { startMs: number; endMs: number }): string {
  return `${fmtClockShort(chicagoMinuteOfDay(b.startMs))}–${fmtClockShort(chicagoMinuteOfDay(b.endMs))}`;
}

/** Overlapping blocks merged: "9–11:30, 2–3" ("" when free). */
export function fmtBusy(blocks: readonly BusyBlock[]): string {
  const sorted = [...blocks].sort((a, b) => a.startMs - b.startMs);
  const merged: Array<{ startMs: number; endMs: number }> = [];
  for (const b of sorted) {
    const last = merged[merged.length - 1];
    if (last && b.startMs <= last.endMs) last.endMs = Math.max(last.endMs, b.endMs);
    else merged.push({ startMs: b.startMs, endMs: b.endMs });
  }
  return merged.map(fmtBusyRange).join(", ");
}
