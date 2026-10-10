/**
 * planDay — the drive chain for one rep's Chicago day (spec Part 2). Pure,
 * no IO, client-safe (type-only imports). Route minutes come in through
 * `routeMinutes` (keyed by pairKey); a missing pair is FLAGGED, never
 * estimated — there is no straight-line fallback anywhere on this path.
 */
import type { FixTarget, LatLng } from "@/lib/address-verify/types";
import type { DriveStop } from "./stops";

export type DriveBase = { name: string; lat: number; lng: number };
export type DriveFlagKind = "no_base" | "unverified" | "route_unavailable" | "long_route";

export const FLAG_TEXT: Record<DriveFlagKind, string> = {
  no_base: "No base set",
  unverified: "Address not verified — no drive time",
  route_unavailable: "Drive time unavailable — retrying",
  long_route: "Over 6 h — check the address",
};

/** A route longer than this is almost certainly a wrong address (a name that
 *  geocoded to the far side of the country): flagged, never placed. */
export const LONG_ROUTE_MIN = 360;
/** Below this many route minutes (before buffer) there is no drive to place. */
export const MIN_ROUTE_MIN = 3;

export type LegEnd = {
  kind: "base" | "stop" | "prev_stop";
  key: string;
  label: string;
  point: LatLng | null;
  verified: boolean;
  /** Set only when this end is unverified (what its address flag fixes). */
  fix: FixTarget | null;
  /** The stop's own Fix target whatever its state (null for the base) — what a
   *  long-route flag offers, since a verified end can still be the wrong place. */
  addressFix?: FixTarget | null;
};

export type DriveLeg = {
  key: string;
  userId: string;
  dayKey: string;
  from: LegEnd;
  to: LegEnd;
  direction: "to_stop" | "back";
  routeMin: number | null;
  bufferMin: number;
  /** route + buffer; null when flagged */
  minutes: number | null;
  startMs: number | null;
  endMs: number | null;
  /** Where a flag shows: the stop's start (drive-to) or the last stop's end (back). */
  anchorMs: number;
  flag: { kind: DriveFlagKind; text: string } | null;
  fix: FixTarget | null;
  tight: { needMin: number; haveMin: number; text: string } | null;
};

export type PlanDayInput = {
  userId: string;
  dayKey: string;
  stops: DriveStop[];
  base: DriveBase | null;
  bufferMin: number;
  routeMinutes: ReadonlyMap<string, number>;
  prevDay: { stayOver: boolean; lastStop: DriveStop | null };
  stayOver: boolean;
};

function r4(n: number): string {
  return (Math.round(n * 1e4) / 1e4).toFixed(4);
}

/** Same string as geo.ts routeKey, so geo_cache lookups use it directly. */
export function pairKey(a: LatLng, b: LatLng): string {
  return r4(a.lat) + "," + r4(a.lng) + "|" + r4(b.lat) + "," + r4(b.lng);
}

export function fmtDur(min: number): string {
  const total = Math.max(0, Math.round(min));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

function stopEnd(s: DriveStop, kind: "stop" | "prev_stop" = "stop"): LegEnd {
  const verified = s.address.status === "verified" && !!s.address.point;
  return { kind, key: s.key, label: s.label, point: verified ? s.address.point : null, verified, fix: verified ? null : s.address.fix, addressFix: s.address.fix };
}

function baseEnd(b: DriveBase | null): LegEnd {
  return b
    ? { kind: "base", key: "base", label: b.name, point: { lat: b.lat, lng: b.lng }, verified: true, fix: null }
    : { kind: "base", key: "base", label: FLAG_TEXT.no_base, point: null, verified: false, fix: null };
}

const samePoint = (a: LegEnd, b: LegEnd) => !!a.point && !!b.point && pairKey(a.point, a.point) === pairKey(b.point, b.point);

function makeLeg(
  input: PlanDayInput,
  from: LegEnd,
  to: LegEnd,
  direction: "to_stop" | "back",
  anchorMs: number,
  prevStopEndMs: number | null
): DriveLeg | null {
  let flagKind: DriveFlagKind | null = null;
  if ((from.kind === "base" && !from.verified) || (to.kind === "base" && !to.verified)) flagKind = "no_base";
  else if (!from.verified || !to.verified) flagKind = "unverified";
  let routeMin: number | null = null;
  if (!flagKind) {
    const r = input.routeMinutes.get(pairKey(from.point!, to.point!));
    if (r == null || !Number.isFinite(r)) flagKind = "route_unavailable";
    else if (r < MIN_ROUTE_MIN) return null; // near-zero: no leg, no block
    else if (r > LONG_ROUTE_MIN) flagKind = "long_route"; // flagged like an unverified address, never placed
    else routeMin = Math.max(0, Math.round(r));
  }
  const bufferMin = Math.max(0, Math.round(input.bufferMin));
  const minutes = routeMin == null ? null : routeMin + bufferMin;
  let startMs: number | null = null;
  let endMs: number | null = null;
  if (minutes != null) {
    if (direction === "to_stop") {
      endMs = anchorMs;
      startMs = anchorMs - minutes * 60_000;
    } else {
      startMs = anchorMs;
      endMs = anchorMs + minutes * 60_000;
    }
  }
  let tight: DriveLeg["tight"] = null;
  if (minutes != null && startMs != null && direction === "to_stop" && prevStopEndMs != null && startMs < prevStopEndMs) {
    const haveMin = Math.max(0, Math.round((anchorMs - prevStopEndMs) / 60_000));
    tight = { needMin: minutes, haveMin, text: `Tight — needs ${fmtDur(minutes)}, has ${fmtDur(haveMin)}` };
  }
  return {
    key: `${input.userId}|${input.dayKey}|${from.key}|${to.key}`,
    userId: input.userId,
    dayKey: input.dayKey,
    from,
    to,
    direction,
    routeMin,
    bufferMin,
    minutes,
    startMs,
    endMs,
    anchorMs,
    flag: flagKind ? { kind: flagKind, text: FLAG_TEXT[flagKind] } : null,
    fix:
      flagKind === "unverified"
        ? (to.fix ?? from.fix)
        : flagKind === "long_route"
          ? (to.addressFix ?? from.addressFix ?? null)
          : null,
    tight,
  };
}

export function planDay(input: PlanDayInput): DriveLeg[] {
  const stops = [...input.stops].sort((a, b) => a.startMs - b.startMs || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  if (!stops.length) return [];
  const base = baseEnd(input.base);
  const legs: DriveLeg[] = [];
  const push = (from: LegEnd, to: LegEnd, direction: "to_stop" | "back", anchorMs: number, prevEnd: number | null) => {
    if (samePoint(from, to)) return; // same place back-to-back: no drive
    const leg = makeLeg(input, from, to, direction, anchorMs, prevEnd);
    if (leg) legs.push(leg);
  };
  const origin = input.prevDay.stayOver && input.prevDay.lastStop ? stopEnd(input.prevDay.lastStop, "prev_stop") : base;
  push(origin, stopEnd(stops[0]), "to_stop", stops[0].startMs, null);
  // Stops can overlap (an all-day conference with a visit inside it), so "when
  // the previous stop ended" is the running MAX end of every earlier stop.
  let maxEnd = stops[0].endMs;
  for (let i = 1; i < stops.length; i++) {
    push(stopEnd(stops[i - 1]), stopEnd(stops[i]), "to_stop", stops[i].startMs, maxEnd);
    maxEnd = Math.max(maxEnd, stops[i].endMs);
  }
  if (!input.stayOver) push(stopEnd(stops[stops.length - 1]), base, "back", maxEnd, null);
  return legs;
}

/** Every verified from→to pair the day's legs need, deduplicated by pairKey.
 *  Callers filter it against their own cache (geo_cache / routeMinutes) —
 *  this function doesn't know what is already cached. */
export function neededRoutes(input: Omit<PlanDayInput, "routeMinutes">): Array<{ from: LatLng; to: LatLng }> {
  const out = new Map<string, { from: LatLng; to: LatLng }>();
  for (const l of planDay({ ...input, routeMinutes: new Map() })) {
    if (l.flag?.kind === "route_unavailable" && l.from.point && l.to.point) out.set(pairKey(l.from.point, l.to.point), { from: l.from.point, to: l.to.point });
  }
  return [...out.values()];
}

/** The day header's total drive time (buffer included; flagged legs count 0). */
export function dayDriveTotal(legs: DriveLeg[]): number {
  return legs.reduce((s, l) => s + (l.flag || l.minutes == null ? 0 : l.minutes), 0);
}
