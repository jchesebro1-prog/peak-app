/**
 * Drive loader (spec Part 2): assembles planDay input for one rep over a set
 * of Chicago days. "cache" mode (page views) reads the place book and
 * geo_cache only; "live" mode (syncs) geocodes unknown addresses and routes
 * missing pairs through OSRM. Route minutes come ONLY from geo_cache or
 * OSRM — never a straight-line estimate.
 */
import { isPhysicalLocation, addressKey } from "@/lib/address-verify/keys";
import { placeStatesFor } from "@/lib/address-verify/place-book";
import { addressStatesForVisits, type VisitAddressInput } from "@/lib/address-verify/targets";
import type { AddressState, LatLng } from "@/lib/address-verify/types";
import { FETCH_TIMEOUT_MS, officesFromSettings, route, routeCachedBulk, type RouteResult } from "@/lib/geo";
import { ROUTE_DELAY_MS } from "@/lib/geo-backfill";
import type { CalendarEvent } from "@/lib/google/calendar";
import type { Office } from "@/lib/settings";
import { driveBufferFor, getStayOvers } from "@/lib/stores/schedule-prefs";
import { allVisits, type SiteVisit } from "@/lib/stores/site-visits";
import { baseOffice } from "@/lib/travel-origin";
import { getUser } from "@/lib/users";
import { addDays, chicagoDayStart, isDayKey } from "./day";
import { dayDriveTotal, neededRoutes, pairKey, planDay, type DriveBase, type DriveLeg, type PlanDayInput } from "./plan";
import { stopsForDay, visitPeople, type DriveStop, type StopSourceEvent, type StopSourceVisit } from "./stops";

export type DriveLoadMode = "cache" | "live";
export type DriveUser = { id: string; name: string; officeId: string | null };

export type DriveLoadDeps = {
  getUser(id: string): Promise<DriveUser | null>;
  offices(): Promise<Office[]>;
  visits(): Promise<SiteVisit[]>;
  bufferMin(userId: string): Promise<number>;
  stayOvers(userId: string): Promise<Record<string, boolean>>;
  visitStates(visits: VisitAddressInput[], mode: DriveLoadMode): Promise<Map<string, AddressState>>;
  placeStates(texts: string[], mode: DriveLoadMode): Promise<Map<string, AddressState>>;
  routes(pairs: Array<{ from: LatLng; to: LatLng }>, mode: DriveLoadMode): Promise<Map<string, number>>;
};

export type DriveDayPlan = { dayKey: string; stops: DriveStop[]; legs: DriveLeg[]; totalMin: number };

export type RouteDeps = {
  cached: (keys: string[]) => Promise<Map<string, RouteResult>>;
  live: (a: LatLng, b: LatLng) => Promise<RouteResult | null>;
  delayMs: number;
  budgetMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** When the next OSRM request may go out. Shared by every loader in this
   *  instance (the module default), so concurrent syncs stay at ≤ 1 request
   *  per delayMs combined. Tests inject their own. */
  pacer: { nextAt: number };
};

/** The instance-wide OSRM turn queue (see RouteDeps.pacer). */
const osrmPacer = { nextAt: 0 };

/** The address input the address-state lookups take for a visit — the one
 *  mapping the loader and the sync both use. */
export function visitAddressInput(v: Pick<SiteVisit, "id" | "customerId" | "locationId" | "address">): VisitAddressInput {
  return { id: v.id, customerId: v.customerId, locationId: v.locationId, address: v.address };
}

/** geo_cache first (pairKey === geo routeKey); in live mode, OSRM for the
 *  misses, paced (one shared turn queue per instance) and budgeted per call.
 *  A failed route stays missing → flagged. */
export async function routeMinutesFor(
  pairs: Array<{ from: LatLng; to: LatLng }>,
  mode: DriveLoadMode,
  deps?: Partial<RouteDeps>
): Promise<Map<string, number>> {
  const d: RouteDeps = {
    cached: routeCachedBulk,
    live: route,
    delayMs: ROUTE_DELAY_MS,
    budgetMs: 20_000,
    now: Date.now,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    pacer: osrmPacer,
    ...deps,
  };
  const out = new Map<string, number>();
  if (!pairs.length) return out;
  for (const [k, r] of await d.cached(pairs.map((p) => pairKey(p.from, p.to)))) out.set(k, r.minutes);
  if (mode === "live") {
    const start = d.now();
    let n = 0;
    for (const p of pairs) {
      const k = pairKey(p.from, p.to);
      if (out.has(k)) continue;
      // Take the next shared turn — synchronously, so two loaders can't take
      // the same one — unless it would land past this call's own budget.
      const now = d.now();
      const slot = Math.max(now, d.pacer.nextAt);
      if ((n > 0 || slot > now) && slot - start + FETCH_TIMEOUT_MS > d.budgetMs) break;
      d.pacer.nextAt = slot + d.delayMs;
      if (slot > now) await d.sleep(slot - now);
      n++;
      const r = await d.live(p.from, p.to);
      if (r) out.set(k, r.minutes);
    }
  }
  return out;
}

function defaultDeps(): DriveLoadDeps {
  return {
    getUser: async (id) => {
      const u = await getUser(id);
      return u ? { id: u.id, name: u.name, officeId: u.officeId ?? null } : null;
    },
    offices: officesFromSettings,
    visits: allVisits,
    bufferMin: driveBufferFor,
    stayOvers: getStayOvers,
    visitStates: (visits, mode) => addressStatesForVisits(visits, mode),
    placeStates: (texts, mode) => placeStatesFor(texts, mode),
    routes: (pairs, mode) => routeMinutesFor(pairs, mode),
  };
}

const unresolved = (label: string): AddressState => ({ status: "unresolved", label, point: null, pointKey: null, fix: null });

export async function planDriveDays(args: {
  userId: string;
  dayKeys: string[];
  events: CalendarEvent[] | null;
  mode: DriveLoadMode;
  deps?: Partial<DriveLoadDeps>;
}): Promise<DriveDayPlan[]> {
  const d = { ...defaultDeps(), ...args.deps };
  const days = [...new Set(args.dayKeys.filter(isDayKey))].sort();
  if (!days.length) return [];
  const user = await d.getUser(args.userId);
  if (!user) return [];
  // Each day also needs the day before (stay-over origin).
  const span = [...new Set(days.flatMap((k) => [addDays(k, -1), k]))].sort();
  const minMs = chicagoDayStart(span[0]);
  const maxMs = chicagoDayStart(addDays(span[span.length - 1], 1));

  const mine = (await d.visits()).filter(
    (v) => v.startAt != null && v.startAt >= minMs && v.startAt < maxMs && visitPeople(v).includes(user.name)
  );
  const vStates = await d.visitStates(
    mine.map(visitAddressInput),
    args.mode
  );
  const evs = (args.events ?? []).filter((e) => e.startMs >= minMs && e.startMs < maxMs);
  const physical = evs.filter((e) => !e.allDay && !e.selfDeclined && !e.peakDriveKey && isPhysicalLocation(e.location));
  const pStates = await d.placeStates(physical.map((e) => e.location), args.mode);

  const visitSrc: StopSourceVisit[] = mine.map((v) => ({
    id: v.id,
    label: v.venue || v.customer || v.id,
    startAt: v.startAt,
    endAt: v.endAt,
    stage: v.stage,
    people: visitPeople(v),
    googleEventId: v.googleEventId ?? null,
    address: vStates.get(v.id) ?? unresolved(v.address || ""),
  }));
  const eventSrc: StopSourceEvent[] = evs.map((e) => ({
    id: e.id,
    iCalUID: e.iCalUID,
    title: e.title,
    startMs: e.startMs,
    endMs: e.endMs,
    allDay: e.allDay,
    location: e.location,
    selfDeclined: e.selfDeclined,
    peakDriveKey: e.peakDriveKey,
    address: pStates.get(addressKey(e.location)) ?? null,
  }));
  const stopsBy = new Map(span.map((k) => [k, stopsForDay({ person: user.name, dayKey: k, visits: visitSrc, events: eventSrc })]));

  const b = baseOffice(await d.offices(), user.officeId);
  const base: DriveBase | null =
    b && b.lat != null && b.lng != null && Number.isFinite(Number(b.lat)) && Number.isFinite(Number(b.lng))
      ? { name: b.name || "your base office", lat: Number(b.lat), lng: Number(b.lng) }
      : null;
  const [bufferMin, stays] = await Promise.all([d.bufferMin(user.id), d.stayOvers(user.id)]);

  const inputs: Array<Omit<PlanDayInput, "routeMinutes">> = days.map((k) => {
    const prev = addDays(k, -1);
    const prevStops = stopsBy.get(prev) ?? [];
    return {
      userId: user.id,
      dayKey: k,
      stops: stopsBy.get(k) ?? [],
      base,
      bufferMin,
      prevDay: { stayOver: !!stays[prev], lastStop: prevStops[prevStops.length - 1] ?? null },
      stayOver: !!stays[k],
    };
  });
  const pairs = new Map<string, { from: LatLng; to: LatLng }>();
  for (const i of inputs) for (const p of neededRoutes(i)) pairs.set(pairKey(p.from, p.to), p);
  const routeMinutes = pairs.size ? await d.routes([...pairs.values()], args.mode) : new Map<string, number>();
  return inputs.map((i) => {
    const legs = planDay({ ...i, routeMinutes });
    return { dayKey: i.dayKey, stops: i.stops, legs, totalMin: dayDriveTotal(legs) };
  });
}
