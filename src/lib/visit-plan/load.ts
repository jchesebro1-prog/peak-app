/**
 * Booking-check loader (spec 2026-10-09 site-visit scheduling, Part 2) — the
 * server half of the booking screen and the visit conflict badges. Reads each
 * person's Google Calendar once, plans the candidate's day per person through
 * spec 1's planDriveDays (the candidate injected as a virtual visit), and
 * hands the pure engine everything it needs. Computed live; nothing stored.
 * Addresses are read in cache mode (the booking UI's own address check
 * geocodes); missing routes go to OSRM under one shared budget and the
 * instance-wide OSRM pacer (routeMinutesFor). Only the viewer's own Google
 * events keep their titles; anyone else's read "a calendar event".
 */
import type { AddressState, LatLng } from "@/lib/address-verify/types";
import { addressStatesForVisits, type VisitAddressInput } from "@/lib/address-verify/targets";
import { addDays, chicagoDayKey, chicagoDayStart } from "@/lib/drive-plan/day";
import { planDriveDays, routeMinutesFor, visitAddressInput, type DriveDayPlan, type DriveLoadDeps, type DriveLoadMode } from "@/lib/drive-plan/load";
import { visitPeople } from "@/lib/drive-plan/stops";
import { FETCH_TIMEOUT_MS } from "@/lib/geo";
import { gmailEnabled, hasCalendarScope, personalKey } from "@/lib/gmail/config";
import { getConnectionInfo } from "@/lib/gmail/connections";
import { listEventsForSync, type CalendarEvent, type SyncRead } from "@/lib/google/calendar";
import { getSchedulingSettings, workHoursFor } from "@/lib/stores/schedule-prefs";
import { allVisits, type SiteVisit } from "@/lib/stores/site-visits";
import { allUsers } from "@/lib/users";
import { busyBlocks, busyInRange, OTHERS_EVENT_LABEL, toBusyVisit } from "./busy";
import { checkVisit, type CalendarRead, type PersonCheck } from "./check";
import { nearbyPairs, suggestDays, type NearbyResult } from "./nearby";
import type { SchedulingSettings, WorkHours } from "./settings";
import type { BookingCheckInput, BookingCheckResult } from "./types";

/** One budget for every live OSRM request a single booking check makes. */
export const BOOKING_ROUTE_BUDGET_MS = 10_000;
export const NEW_VISIT_ID = "NEW";

type Range = { timeMinMs: number; timeMaxMs: number };
type Person = { id: string; name: string; status: string };
type CalendarResult = { status: CalendarRead; events: CalendarEvent[] };

export type BookingDeps = {
  now(): number;
  users(): Promise<Person[]>;
  settings(): Promise<SchedulingSettings>;
  workHours(userId: string): Promise<WorkHours>;
  visits(): Promise<SiteVisit[]>;
  visitStates(visits: VisitAddressInput[]): Promise<Map<string, AddressState>>;
  readEvents(userId: string, range: Range): Promise<CalendarResult>;
  plan(args: Parameters<typeof planDriveDays>[0]): Promise<DriveDayPlan[]>;
  /** budgetMs: what's left of BOOKING_ROUTE_BUDGET_MS for this call (≥ 0). */
  routes(pairs: Array<{ from: LatLng; to: LatLng }>, budgetMs: number): Promise<Map<string, number>>;
};

export type CalendarReadDeps = {
  enabled(): boolean;
  /** true when this mailbox is connected with the calendar scope */
  connected(mailboxKey: string): Promise<boolean>;
  list(mailboxKey: string, range: Range): Promise<SyncRead>;
};

/** One person's calendar for the booking check. Never throws. "ok" only when
 *  the read covers the whole window — a partial read (page cap) or any error
 *  is "failed", so the panel says it couldn't check rather than "no conflicts". */
export async function readCalendarForBooking(userId: string, range: Range, deps?: Partial<CalendarReadDeps>): Promise<CalendarResult> {
  const d: CalendarReadDeps = {
    enabled: gmailEnabled,
    connected: async (key) => {
      const info = await getConnectionInfo(key);
      return !!info && hasCalendarScope(info.scope);
    },
    list: listEventsForSync,
    ...deps,
  };
  if (!d.enabled()) return { status: "no-calendar", events: [] };
  try {
    const key = personalKey(userId);
    if (!(await d.connected(key))) return { status: "no-calendar", events: [] };
    const r = await d.list(key, range);
    if (r.coveredThroughMs < range.timeMaxMs) {
      console.warn("[visit-booking] calendar read cut short:", userId, r.coveredThroughMs, range.timeMaxMs);
      return { status: "failed", events: [] };
    }
    return { status: "ok", events: r.events };
  } catch (err) {
    console.error("[visit-booking] calendar read failed:", userId, err);
    return { status: "failed", events: [] };
  }
}

/** With less than one request's timeout left, routing reads geo_cache only. */
export function bookingRouteMode(budgetMs: number): DriveLoadMode {
  return budgetMs >= FETCH_TIMEOUT_MS ? "live" : "cache";
}

function defaultDeps(): BookingDeps {
  return {
    now: Date.now,
    users: async () => (await allUsers()).map((u) => ({ id: u.id, name: u.name, status: u.status })),
    settings: getSchedulingSettings,
    workHours: workHoursFor,
    visits: allVisits,
    visitStates: (vs) => addressStatesForVisits(vs, "cache"),
    readEvents: readCalendarForBooking,
    plan: planDriveDays,
    routes: (pairs, budgetMs) => {
      const mode = bookingRouteMode(budgetMs);
      return routeMinutesFor(pairs, mode, mode === "live" ? { budgetMs } : undefined);
    },
  };
}

/** The visit being booked, as a scheduled SiteVisit the planner can use. An
 *  edited visit keeps its stored invites / event ids, so its own calendar
 *  copies are recognised (never a stop, never busy). */
export function virtualVisit(input: BookingCheckInput, stored: SiteVisit | null): SiteVisit {
  const id = input.visitId ?? NEW_VISIT_ID;
  const base: SiteVisit = stored ?? {
    id, customerId: null, customer: "", locationId: null, venue: "", address: "", contactName: "", contactEmail: "", contactPhone: "",
    reason: "", startAt: null, endAt: null, notes: "", assignedTo: "", attendees: [], invites: [], createdBy: "", createdAt: 0, updatedAt: 0,
    stage: "scheduled", leadId: null, surveyId: null, preferredTiming: "", engagementId: null,
  };
  return {
    ...base,
    id,
    customerId: input.customerId,
    locationId: input.locationId,
    address: input.address,
    venue: base.venue || "This visit",
    startAt: input.startAt,
    endAt: input.endAt,
    assignedTo: input.lead,
    attendees: input.attendees,
    stage: "scheduled",
  };
}

/** The calendar windows to read: one span covering every day (plus the day
 *  before, for stay-over origins). A candidate day far from the look-ahead
 *  gets its own span instead of stretching one read over months. */
function readSpans(dayKeys: string[]): Range[] {
  const spans: Array<{ first: string; last: string }> = [];
  for (const k of dayKeys) {
    const cur = spans[spans.length - 1];
    if (cur && addDays(cur.last, 2) >= k) cur.last = k;
    else spans.push({ first: k, last: k });
  }
  return spans.map((s) => ({ timeMinMs: chicagoDayStart(addDays(s.first, -1)), timeMaxMs: chicagoDayStart(addDays(s.last, 1)) }));
}

async function readPerson(d: BookingDeps, userId: string, spans: Range[]): Promise<CalendarResult> {
  const one = async (range: Range): Promise<CalendarResult> => {
    try {
      return await d.readEvents(userId, range);
    } catch (err) {
      console.error("[visit-booking] calendar read failed:", userId, err);
      return { status: "failed", events: [] };
    }
  };
  const parts = await Promise.all(spans.map(one));
  const status: CalendarRead = parts.some((p) => p.status === "failed") ? "failed" : parts.some((p) => p.status === "no-calendar") ? "no-calendar" : "ok";
  if (status !== "ok") return { status, events: [] };
  const seen = new Set<string>();
  return { status, events: parts.flatMap((p) => p.events).filter((e) => !seen.has(e.id) && !!seen.add(e.id)) };
}

export type BookingCheckOpts = {
  /** The signed-in user. Only their own Google events keep their titles —
   *  anyone else's read "a calendar event" (null: nobody's keep them). */
  viewerId: string | null;
  /** false for conflict badges: no nearby days */
  nearby?: boolean;
};

/** Another person's events lose their titles before any block, stop or text is
 *  built from them, so no conflict line or nearby day can carry one. */
function eventsForViewer(events: CalendarEvent[], ownerId: string, viewerId: string | null): CalendarEvent[] {
  return ownerId === viewerId ? events : events.map((e) => ({ ...e, title: OTHERS_EVENT_LABEL }));
}

export async function loadBookingCheck(input: BookingCheckInput, opts: BookingCheckOpts, deps?: Partial<BookingDeps>): Promise<BookingCheckResult> {
  const d: BookingDeps = { ...defaultDeps(), ...deps };
  const now = d.now();
  const deadline = now + BOOKING_ROUTE_BUDGET_MS;
  const [settings, users, all] = await Promise.all([d.settings(), d.users(), d.visits()]);
  const stored = input.visitId ? all.find((v) => v.id === input.visitId) ?? null : null;
  const cand = virtualVisit(input, stored);
  const key = "sv:" + cand.id;
  const others = all.filter((v) => v.id !== cand.id);
  // The candidate stays in the busy source so its calendar copies are recognised; excludeVisitId keeps it from being a block.
  const busySrc = [...others, cand].map(toBusyVisit);

  const people = visitPeople(cand)
    .map((name) => users.find((u) => u.name === name && u.status === "active"))
    .filter((u): u is Person => !!u);
  const lead = people.find((u) => u.name === cand.assignedTo) ?? null;
  const timed = input.startAt != null && input.endAt != null && input.endAt > input.startAt;
  const candDay = timed ? chicagoDayKey(input.startAt!) : null;
  const wantNearby = opts.nearby !== false;
  const lookaheadDays = settings.nearbyLookaheadDays;
  const today = chicagoDayKey(now);
  // Today … today + look-ahead, never a past day — if the address turns out verified.
  const maybeLook = wantNearby && lead ? Array.from({ length: lookaheadDays }, (_, i) => addDays(today, i)) : [];

  // Addresses: ONE cache read up front — the candidate plus every visit any
  // plan below can reach (these people, these days) — reused by every plan.
  const names = new Set(people.map((u) => u.name));
  const maybeSpans = readSpans([...new Set([...maybeLook, ...(candDay ? [candDay] : [])])].sort());
  const inSpans = (ms: number) => maybeSpans.some((r) => ms >= r.timeMinMs && ms < r.timeMaxMs);
  const states = new Map<string, AddressState>();
  const statesFor = async (vs: VisitAddressInput[]): Promise<Map<string, AddressState>> => {
    const missing = vs.filter((v) => !states.has(v.id));
    if (missing.length) for (const [id, st] of await d.visitStates(missing)) states.set(id, st);
    return new Map(vs.flatMap((v) => (states.has(v.id) ? [[v.id, states.get(v.id)!] as const] : [])));
  };
  const reachable = names.size ? others.filter((v) => v.startAt != null && inSpans(v.startAt) && visitPeople(v).some((n) => names.has(n))) : [];
  await statesFor([cand, ...reachable].map(visitAddressInput));
  const candState: AddressState = states.get(cand.id) ?? { status: "unresolved", label: input.address, point: null, pointKey: null, fix: null };
  states.set(cand.id, candState);
  const address = { status: candState.status, fix: candState.fix };
  const candPoint = candState.status === "verified" ? candState.point : null;

  const look = candPoint ? maybeLook : [];
  const emptyNearby: NearbyResult | null = !wantNearby ? null : candPoint ? { status: "ok", days: [], lookaheadDays, leadCalendar: null } : { status: "unverified" };
  const dayKeys = [...new Set([...look, ...(candDay ? [candDay] : [])])].sort();
  if (!dayKeys.length || !people.length) return { address, people: [], nearby: emptyNearby, checkedAt: now };

  const spans = readSpans(dayKeys);
  const [reads, hours] = await Promise.all([
    Promise.all(
      people.map(async (u) => {
        const r = await readPerson(d, u.id, spans);
        return [u.id, { ...r, events: eventsForViewer(r.events, u.id, opts.viewerId) }] as const;
      })
    ).then((e) => new Map(e)),
    Promise.all(people.map(async (u) => [u.id, await d.workHours(u.id)] as const)).then((e) => new Map(e)),
  ]);
  const calendarOf = (userId: string): CalendarRead => {
    const r = reads.get(userId);
    // Every person in `people` was read above.
    if (!r) throw new Error(`[visit-booking] no calendar read for ${userId}`);
    return r.status;
  };
  const eventsOf = (userId: string): CalendarEvent[] | null => {
    const r = reads.get(userId);
    return r && r.status === "ok" ? r.events : null;
  };
  const busyOf = (u: Person) => busyBlocks({ person: u.name, visits: busySrc, events: eventsOf(u.id), excludeVisitId: cand.id });
  const routesFor = async (pairs: Array<{ from: LatLng; to: LatLng }>): Promise<Map<string, number>> => {
    try {
      return await d.routes(pairs, Math.max(0, deadline - d.now()));
    } catch (err) {
      console.error("[visit-booking] routing failed:", err);
      return new Map<string, number>();
    }
  };
  // Every plan sees the in-memory visit list (one read) with the candidate in
  // it, so its calendar copies dedup against it; addresses come from the memo.
  const planDeps: Partial<DriveLoadDeps> = {
    visits: async () => [...others, cand],
    visitStates: (vs) => statesFor(vs),
    routes: (pairs) => routesFor(pairs),
  };

  // Nearby first: the strip the user sees gets the routing budget before the per-person plans.
  let nearby: NearbyResult | null = emptyNearby;
  if (wantNearby && candPoint && lead && look.length) {
    // The lead's stops only — no routing for these plans; just the nearby pairs below.
    const leadPlans = await d.plan({ userId: lead.id, dayKeys: look, events: eventsOf(lead.id), mode: "cache", deps: { ...planDeps, routes: async () => new Map() } });
    const leadBusy = busyOf(lead);
    const inWindow = new Set(look);
    const leadDays = leadPlans
      .filter((p) => inWindow.has(p.dayKey))
      .map((p) => ({ dayKey: p.dayKey, stops: p.stops, busy: busyInRange(leadBusy, chicagoDayStart(p.dayKey), chicagoDayStart(addDays(p.dayKey, 1))) }));
    const pairs = nearbyPairs(candPoint, leadDays, settings.sameAreaMin, key);
    const routeMinutes = pairs.length ? await routesFor(pairs) : new Map<string, number>();
    nearby = suggestDays({
      candidate: { key, point: candPoint, startMs: input.startAt, endMs: input.endAt },
      leadDays,
      routeMinutes,
      sameAreaMin: settings.sameAreaMin,
      lookaheadDays,
      others: people.filter((u) => u.id !== lead.id).map((u) => ({ person: u.name, calendar: calendarOf(u.id), hours: hours.get(u.id)!, busy: busyOf(u) })),
      lead: { person: lead.name, calendar: calendarOf(lead.id) },
    });
  }

  const checks: PersonCheck[] = [];
  if (candDay) {
    for (const u of people) {
      const [day] = await d.plan({ userId: u.id, dayKeys: [candDay], events: eventsOf(u.id), mode: "cache", deps: planDeps });
      checks.push(
        ...checkVisit(
          { key },
          [{ person: u.name, dayKey: candDay, stops: day?.stops ?? [], legs: day?.legs ?? [], busy: busyOf(u), hours: hours.get(u.id)!, calendar: calendarOf(u.id) }],
          { dailyDriveLimitMin: settings.dailyDriveLimitMin }
        )
      );
    }
  }
  return { address, people: checks, nearby, checkedAt: now };
}
