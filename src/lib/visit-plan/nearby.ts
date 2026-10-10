/**
 * Nearby days (spec 2026-10-09 site-visit scheduling, Part 2 "suggestDays").
 * Pure and client-safe. Days in the look-ahead when the LEAD already has a
 * verified stop within the same-area drive time of the candidate. Minutes
 * come only from routed drive times (geo_cache / OSRM); the straight-line
 * distance below only skips stops too far to bother routing.
 */
import type { LatLng } from "@/lib/address-verify/types";
import { addDays, chicagoDayStart } from "@/lib/drive-plan/day";
import { pairKey } from "@/lib/drive-plan/plan";
import type { DriveStop } from "@/lib/drive-plan/stops";
import { busyInRange, fmtBusy, type BusyBlock } from "./busy";
import { overlaps, type CalendarRead } from "./check";
import { chicagoMinuteOfDay, chicagoWallMs, fmtDayLabel, workWindow } from "./hours";
import type { WorkHours } from "./settings";

export const MAX_NEARBY_DAYS = 5;
/** Faster than any real drive, so the pre-filter never drops a reachable stop. */
export const PREFILTER_MPH = 80;

export const NEARBY_TEXT = {
  unverified: "Verify the address to see nearby days",
  unavailable: "Nearby days unavailable",
} as const;

export function straightLineMiles(a: LatLng, b: LatLng): number {
  const R = 3958.8;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Pre-filter only — never shown, never turned into minutes. */
export function couldBeSameArea(a: LatLng, b: LatLng, sameAreaMin: number): boolean {
  return straightLineMiles(a, b) <= (sameAreaMin * PREFILTER_MPH) / 60;
}

export type LeadDay = { dayKey: string; stops: DriveStop[]; busy: BusyBlock[] };
export type OtherAttendee = { person: string; calendar: CalendarRead; hours: WorkHours; busy: BusyBlock[] };
export type AttendeeDayStatus = { person: string; status: "free" | "conflict" | "unknown" };
export type NearbyDay = {
  dayKey: string;
  label: string;
  nearest: { label: string; minutes: number };
  /** the lead's busy times that day, "9–11:30, 2–3" ("" when free) */
  busyText: string;
  others: AttendeeDayStatus[];
};
export type NearbyResult = { status: "ok"; days: NearbyDay[]; lookaheadDays: number } | { status: "unverified" } | { status: "unavailable" };

const pointOf = (s: DriveStop): LatLng | null => (s.address.status === "verified" ? s.address.point : null);

/** The stop → candidate pairs worth routing. */
export function nearbyPairs(point: LatLng, leadDays: LeadDay[], sameAreaMin: number, excludeKey: string): Array<{ from: LatLng; to: LatLng }> {
  const out = new Map<string, { from: LatLng; to: LatLng }>();
  for (const d of leadDays)
    for (const s of d.stops) {
      if (s.key === excludeKey) continue;
      const p = pointOf(s);
      if (!p || !couldBeSameArea(p, point, sameAreaMin)) continue;
      out.set(pairKey(p, point), { from: p, to: point });
    }
  return [...out.values()];
}

/** The same Chicago time of day, moved to `dayKey`. */
export function projectTime(startMs: number, endMs: number, dayKey: string): { startMs: number; endMs: number } {
  const s = chicagoWallMs(dayKey, chicagoMinuteOfDay(startMs));
  return { startMs: s, endMs: s + Math.max(0, endMs - startMs) };
}

/** With a slot: free unless it's outside their hours or overlaps something.
 *  Without one: free when it's a work day with nothing booked in work hours. */
export function attendeeStatusOn(o: OtherAttendee, dayKey: string, slot: { startMs: number; endMs: number } | null): AttendeeDayStatus["status"] {
  if (o.calendar === "failed") return "unknown";
  const win = workWindow(dayKey, o.hours);
  if (!win) return "conflict";
  const span = slot ?? win;
  if (span.startMs < win.startMs || span.endMs > win.endMs) return "conflict";
  return o.busy.some((b) => overlaps(span.startMs, span.endMs, b.startMs, b.endMs)) ? "conflict" : "free";
}

export function suggestDays(args: {
  candidate: { key: string; point: LatLng | null; startMs: number | null; endMs: number | null };
  leadDays: LeadDay[];
  routeMinutes: ReadonlyMap<string, number>;
  sameAreaMin: number;
  lookaheadDays: number;
  others: OtherAttendee[];
}): NearbyResult {
  const { candidate } = args;
  if (!candidate.point) return { status: "unverified" };
  const point = candidate.point;
  const timed = candidate.startMs != null && candidate.endMs != null && candidate.endMs > candidate.startMs;
  const found: NearbyDay[] = [];
  let missing = 0;
  for (const d of args.leadDays) {
    let best: { label: string; minutes: number } | null = null;
    for (const s of d.stops) {
      if (s.key === candidate.key) continue;
      const p = pointOf(s);
      if (!p || !couldBeSameArea(p, point, args.sameAreaMin)) continue;
      const m = args.routeMinutes.get(pairKey(p, point));
      if (m == null || !Number.isFinite(m)) {
        missing++;
        continue;
      }
      const minutes = Math.max(0, Math.round(m));
      if (minutes > args.sameAreaMin) continue;
      if (!best || minutes < best.minutes) best = { label: s.label, minutes };
    }
    if (!best) continue;
    const slot = timed ? projectTime(candidate.startMs!, candidate.endMs!, d.dayKey) : null;
    const dayStart = chicagoDayStart(d.dayKey);
    const dayEnd = chicagoDayStart(addDays(d.dayKey, 1));
    // Clipped to this day, so a late event reads "…–midnight" here.
    const dayBusy = busyInRange(d.busy, dayStart, dayEnd).map((b) => ({ ...b, startMs: Math.max(b.startMs, dayStart), endMs: Math.min(b.endMs, dayEnd) }));
    found.push({
      dayKey: d.dayKey,
      label: fmtDayLabel(d.dayKey),
      nearest: best,
      busyText: fmtBusy(dayBusy),
      others: args.others.map((o) => ({ person: o.person, status: attendeeStatusOn({ ...o, busy: busyInRange(o.busy, dayStart, dayEnd) }, d.dayKey, slot) })),
    });
  }
  if (!found.length && missing > 0) return { status: "unavailable" };
  found.sort((a, b) => a.nearest.minutes - b.nearest.minutes || (a.dayKey < b.dayKey ? -1 : a.dayKey > b.dayKey ? 1 : 0));
  return { status: "ok", days: found.slice(0, MAX_NEARBY_DAYS), lookaheadDays: args.lookaheadDays };
}

/** "Tue Oct 14 · 18 min from Lone Pine Elementary · busy 9–11:30" */
export function nearbyLine(d: NearbyDay): string {
  return `${d.label} · ${d.nearest.minutes} min from ${d.nearest.label}${d.busyText ? " · busy " + d.busyText : ""}`;
}
