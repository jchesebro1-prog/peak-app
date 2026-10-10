/**
 * A rep's stops for one Chicago day (spec Part 2 "Stops"). Pure.
 * Stops: the rep's scheduled site visits with a start, and Google events
 * with a physical location. Not stops: all-day events, events with no
 * location / a URL / a video-call mention / a phone number, events the rep
 * declined, the app's own drive events, and a visit's .ics copy
 * (sv-<id>@peak-app) — the same stop, counted once.
 */
import { isPhysicalLocation } from "@/lib/address-verify/keys";
import type { AddressState } from "@/lib/address-verify/types";
import { chicagoDayKey } from "./day";

/** Everyone a visit is a stop for. Spec 2 adds `attendees` to SiteVisit —
 *  this is the ONE place that knows, so loaders and triggers follow. */
export function visitPeople(v: { assignedTo: string; attendees?: readonly string[] | null }): string[] {
  const out: string[] = [];
  for (const n of [v.assignedTo, ...(v.attendees ?? [])]) {
    const s = (n || "").trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

export function isVisitIcsCopy(
  ev: { id: string; iCalUID: string },
  visits: ReadonlyArray<{ id: string; googleEventId?: string | null; eventIds?: readonly string[] | null }>
): boolean {
  return visits.some(
    (v) => ev.iCalUID === `sv-${v.id}@peak-app` || (!!v.googleEventId && v.googleEventId === ev.id) || !!v.eventIds?.includes(ev.id)
  );
}

export type StopSourceVisit = {
  id: string;
  label: string;
  startAt: number | null;
  endAt: number | null;
  stage: string;
  people: string[];
  googleEventId?: string | null;
  /** Spec 2026-10-09 site-visit scheduling — every person's direct calendar copy of the visit. */
  eventIds?: string[] | null;
  address: AddressState;
};

export type StopSourceEvent = {
  id: string;
  iCalUID: string;
  title: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  location: string;
  selfDeclined: boolean;
  peakDriveKey: string;
  address: AddressState | null;
};

export type DriveStop = {
  key: string;
  kind: "visit" | "event";
  label: string;
  startMs: number;
  endMs: number;
  address: AddressState;
};

export function stopsForDay(args: {
  person: string;
  dayKey: string;
  visits: StopSourceVisit[];
  events: StopSourceEvent[];
}): DriveStop[] {
  const out: DriveStop[] = [];
  for (const v of args.visits) {
    if (!v.people.includes(args.person) || v.startAt == null) continue;
    // A stored "scheduled" visit reads "done" once it has ended
    // (deriveVisitStage) — still the same stop on today's chain.
    if (v.stage !== "scheduled" && v.stage !== "done") continue;
    if (chicagoDayKey(v.startAt) !== args.dayKey) continue;
    out.push({ key: `sv:${v.id}`, kind: "visit", label: v.label, startMs: v.startAt, endMs: Math.max(v.endAt ?? v.startAt, v.startAt), address: v.address });
  }
  for (const e of args.events) {
    if (e.allDay || e.selfDeclined || e.peakDriveKey) continue;
    if (!isPhysicalLocation(e.location)) continue;
    if (isVisitIcsCopy(e, args.visits)) continue;
    if (chicagoDayKey(e.startMs) !== args.dayKey) continue;
    out.push({
      key: `g:${e.id}`,
      kind: "event",
      label: e.title,
      startMs: e.startMs,
      endMs: Math.max(e.endMs, e.startMs),
      address: e.address ?? { status: "unresolved", label: e.location, point: null, pointKey: null, fix: null },
    });
  }
  return out.sort((a, b) => a.startMs - b.startMs || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
