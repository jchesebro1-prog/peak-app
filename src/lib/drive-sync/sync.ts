/**
 * Drive sync (spec Part 3): computes a rep's desired legs (live loader) and
 * inserts / updates / deletes ONLY Google events tagged peakDrive. Never
 * touches anything the rep made; flagged legs get no event (but a leg that is
 * only waiting on a route keeps the one it has); a rep with no connected
 * calendar is app-only; a write failure is logged and retried on the next
 * sync. Callers run these inside after() (next/server) — never on the
 * request's critical path.
 */
import { addressStatesForVisits, type VisitAddressInput } from "@/lib/address-verify/targets";
import type { AddressState } from "@/lib/address-verify/types";
import { addDays, chicagoDayKey, chicagoDayStart, isDayKey } from "@/lib/drive-plan/day";
import { planDriveDays, type DriveDayPlan, type DriveLoadMode } from "@/lib/drive-plan/load";
import { visitPeople } from "@/lib/drive-plan/stops";
import { gmailEnabled, hasCalendarScope, personalKey } from "@/lib/gmail/config";
import { getConnectionInfo } from "@/lib/gmail/connections";
import {
  deleteEvent,
  insertEvent,
  listEventsForSync,
  updateEvent,
  type EventWriteInput,
  type SyncCalendarEvent,
  type SyncRead,
} from "@/lib/google/calendar";
import { getDriveSyncState, setDriveSyncState, type DriveSyncState } from "@/lib/stores/schedule-prefs";
import { allVisits, type SiteVisit } from "@/lib/stores/site-visits";
import { allUsers } from "@/lib/users";
import {
  daysFullyCovered,
  desiredFromLegs,
  diffDriveEvents,
  drivePrivateProps,
  existingFromCalendar,
  isLegacyTravelBlock,
  type DesiredDriveEvent,
} from "./diff";

export const STALE_SYNC_MS = 10 * 60_000;
export const SYNC_WINDOW_DAYS = 15;
export const LEGACY_LOOKAHEAD_MS = 180 * 86_400_000;
/** Paged reads the one-time D144 scan may make (each up to 1,000 events). */
const LEGACY_MAX_READS = 10;

export function syncWindowDays(nowMs: number): string[] {
  const today = chicagoDayKey(nowMs);
  return Array.from({ length: SYNC_WINDOW_DAYS }, (_, i) => addDays(today, i));
}

export type VisitLike = { startAt: number | null; assignedTo: string; attendees?: readonly string[] | null };

type ReadRange = { timeMinMs: number; timeMaxMs: number };

export type DriveSyncDeps = {
  now(): number;
  calendarKeyFor(userId: string): Promise<string | null>;
  /** The paged read: events plus how far it got (coveredThroughMs). */
  listEvents(key: string, range: ReadRange): Promise<SyncRead>;
  insertEvent(key: string, ev: EventWriteInput): Promise<{ id: string }>;
  updateEvent(key: string, id: string, ev: EventWriteInput): Promise<unknown>;
  deleteEvent(key: string, id: string): Promise<void>;
  plan(args: Parameters<typeof planDriveDays>[0]): Promise<DriveDayPlan[]>;
  getState(userId: string): Promise<DriveSyncState>;
  setState(userId: string, patch: Partial<DriveSyncState>): Promise<void>;
  users(): Promise<Array<{ id: string; name: string; status: string }>>;
  visits(): Promise<SiteVisit[]>;
  visitStates(visits: VisitAddressInput[], mode: DriveLoadMode): Promise<Map<string, AddressState>>;
  log(msg: string, err?: unknown): void;
};

export type DriveSyncResult = {
  userId: string;
  days: string[];
  google: "written" | "no-calendar" | "read-failed" | "none";
  inserted: number;
  updated: number;
  removed: number;
  legacyRemoved: number;
  flagged: number;
  errors: string[];
};

function defaultDeps(): DriveSyncDeps {
  return {
    now: Date.now,
    calendarKeyFor: async (userId) => {
      if (!gmailEnabled()) return null;
      const key = personalKey(userId);
      const info = await getConnectionInfo(key);
      return info && hasCalendarScope(info.scope) ? key : null;
    },
    listEvents: listEventsForSync,
    insertEvent,
    updateEvent,
    deleteEvent,
    plan: planDriveDays,
    getState: getDriveSyncState,
    setState: setDriveSyncState,
    users: async () => (await allUsers()).map((u) => ({ id: u.id, name: u.name, status: u.status })),
    visits: allVisits,
    visitStates: (visits, mode) => addressStatesForVisits(visits, mode),
    log: (msg, err) => console.error(msg, err),
  };
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

function toWrite(ev: DesiredDriveEvent): EventWriteInput {
  return { title: ev.title, startMs: ev.startMs, endMs: ev.endMs, description: ev.description, privateProps: drivePrivateProps(ev) };
}

/** D144 retirement — upcoming exact-shape blocks, today → +180 days, read
 *  with the paged reader and continued where a capped read stopped. True
 *  only when the whole range was read and every delete went through. */
async function cleanLegacyBlocks(key: string, now: number, d: DriveSyncDeps, res: DriveSyncResult): Promise<boolean> {
  const today = chicagoDayKey(now);
  const endMs = chicagoDayStart(addDays(today, Math.round(LEGACY_LOOKAHEAD_MS / 86_400_000)));
  let cursor = chicagoDayStart(today);
  let clean = true;
  const seen = new Set<string>(); // a continued read overlaps the last one
  for (let i = 0; i < LEGACY_MAX_READS; i++) {
    let read: SyncRead;
    try {
      read = await d.listEvents(key, { timeMinMs: cursor, timeMaxMs: endMs });
    } catch (err) {
      res.errors.push("legacy list: " + errText(err));
      return false;
    }
    for (const ev of read.events) {
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      if (!isLegacyTravelBlock(ev, now)) continue;
      try {
        await d.deleteEvent(key, ev.id);
        res.legacyRemoved++;
      } catch (err) {
        clean = false;
        res.errors.push("legacy " + ev.id + ": " + errText(err));
      }
    }
    if (read.coveredThroughMs >= endMs) return clean;
    if (!(read.coveredThroughMs > cursor)) break; // no progress — try again next sync
    cursor = read.coveredThroughMs;
  }
  res.errors.push("legacy list: calendar read did not finish");
  return false;
}

export async function syncDriveDays(userId: string, dayKeys: string[], deps?: Partial<DriveSyncDeps>): Promise<DriveSyncResult> {
  const d = { ...defaultDeps(), ...deps };
  const now = d.now();
  const window = new Set(syncWindowDays(now));
  // Past days are history; days past +14 wait for the window to reach them.
  const days = [...new Set(dayKeys.filter((k) => isDayKey(k) && window.has(k)))].sort();
  const res: DriveSyncResult = { userId, days, google: "none", inserted: 0, updated: 0, removed: 0, legacyRemoved: 0, flagged: 0, errors: [] };
  if (!days.length) return res;

  const key = await d.calendarKeyFor(userId);
  let events: SyncCalendarEvent[] | null = null;
  let covered: string[] = [];
  if (key) {
    try {
      // Whole Chicago days: the day before the first (its last stop is a
      // stay-over origin) through the end of the last.
      const read = await d.listEvents(key, {
        timeMinMs: chicagoDayStart(addDays(days[0], -1)),
        timeMaxMs: chicagoDayStart(addDays(days[days.length - 1], 1)),
      });
      events = read.events;
      // A capped read saw only part of the window: diff just the days it saw
      // in full, or a missing tagged event would be re-inserted (duplicate)
      // and a missing stop's event wrongly deleted.
      covered = daysFullyCovered(days, read.coveredThroughMs);
    } catch (err) {
      d.log("[drive-sync] calendar read failed " + userId, err);
      res.google = "read-failed";
      return res; // can't see our tagged events — writing now could duplicate
    }
  } else {
    res.google = "no-calendar";
  }

  const plans = await d.plan({ userId, dayKeys: days, events, mode: "live" });
  const legs = plans.flatMap((p) => p.legs);
  res.flagged = legs.filter((l) => l.flag).length;
  if (!key || !events) return res;

  const state = await d.getState(userId);
  if (!state.legacyCleanedAt && (await cleanLegacyBlocks(key, now, d, res))) await d.setState(userId, { legacyCleanedAt: now });

  if (covered.length < days.length) res.errors.push(`calendar read truncated: ${days.length - covered.length} day(s) left for the next sync`);
  // "Drive time unavailable — retrying" is transient (OSRM down / out of
  // budget): its leg still exists, so its Google event stays as it is.
  const retrying = new Set(legs.filter((l) => l.flag?.kind === "route_unavailable").map((l) => l.key));
  const existing = existingFromCalendar(events).filter((e) => !retrying.has(e.key));
  const diff = diffDriveEvents(desiredFromLegs(legs), existing, new Set(covered));
  for (const ev of diff.insert) {
    try {
      await d.insertEvent(key, toWrite(ev));
      res.inserted++;
    } catch (err) {
      res.errors.push("insert " + ev.key + ": " + errText(err));
    }
  }
  for (const u of diff.update) {
    try {
      await d.updateEvent(key, u.id, toWrite(u.ev));
      res.updated++;
    } catch (err) {
      res.errors.push("update " + u.id + ": " + errText(err));
    }
  }
  for (const r of diff.remove) {
    try {
      await d.deleteEvent(key, r.id);
      res.removed++;
    } catch (err) {
      res.errors.push("delete " + r.id + ": " + errText(err));
    }
  }
  if (res.errors.length) d.log("[drive-sync] " + userId + " sync errors", res.errors);
  res.google = "written";
  return res;
}

/** The whole window, then stamp lastSyncAt — unless markDriveStale ran after
 *  this sync started (its reads may predate the change): then the rep stays
 *  stale so the next view / cron pass picks the change up. */
async function syncWindow(userId: string, d: DriveSyncDeps, startMs: number): Promise<DriveSyncResult> {
  const res = await syncDriveDays(userId, syncWindowDays(startMs), d);
  const after = await d.getState(userId);
  await d.setState(userId, { lastSyncAt: (after.staleAt ?? 0) >= startMs ? 0 : d.now() });
  return res;
}

export async function syncDriveForUser(userId: string, deps?: Partial<DriveSyncDeps>): Promise<DriveSyncResult> {
  const d = { ...defaultDeps(), ...deps };
  return syncWindow(userId, d, d.now());
}

/** /calendar + Home: re-sync when the last one is > 10 min old (catches
 *  edits made directly in Google). Claims first so rapid reloads don't stack. */
export async function syncDriveIfStale(userId: string, deps?: Partial<DriveSyncDeps>): Promise<DriveSyncResult | null> {
  const d = { ...defaultDeps(), ...deps };
  const startMs = d.now();
  const state = await d.getState(userId);
  if (startMs - state.lastSyncAt < STALE_SYNC_MS) return null;
  await d.setState(userId, { lastSyncAt: startMs });
  return syncWindow(userId, d, startMs);
}

/** The daily cron rider: every active rep with a connected calendar, least
 *  recently synced first, own try/catch each, no new rep after the budget. */
export async function syncAllDrivers(opts: { budgetMs: number }, deps?: Partial<DriveSyncDeps>): Promise<{ synced: number; skipped: number; errors: string[] }> {
  const d = { ...defaultDeps(), ...deps };
  const start = d.now();
  const out = { synced: 0, skipped: 0, errors: [] as string[] };
  const reps: Array<{ id: string; lastSyncAt: number }> = [];
  for (const u of await d.users()) {
    if (u.status !== "active") continue;
    try {
      if (!(await d.calendarKeyFor(u.id))) continue;
      reps.push({ id: u.id, lastSyncAt: (await d.getState(u.id)).lastSyncAt });
    } catch (err) {
      out.errors.push(u.id + ": " + errText(err));
    }
  }
  reps.sort((a, b) => a.lastSyncAt - b.lastSyncAt);
  for (const r of reps) {
    if (d.now() - start > opts.budgetMs) {
      out.skipped++;
      continue;
    }
    try {
      await syncDriveForUser(r.id, d);
      out.synced++;
    } catch (err) {
      out.errors.push(r.id + ": " + errText(err));
    }
  }
  return out;
}

function addPersonDays(map: Map<string, Set<string>>, v: VisitLike | null): void {
  if (!v || v.startAt == null) return;
  const day = chicagoDayKey(v.startAt);
  for (const p of visitPeople(v)) {
    const set = map.get(p) ?? new Set<string>();
    set.add(day);
    set.add(addDays(day, 1)); // the next day's first leg may start from this day's last stop
    map.set(p, set);
  }
}

async function syncPeopleDays(map: Map<string, Set<string>>, d: DriveSyncDeps): Promise<void> {
  if (!map.size) return;
  const users = await d.users();
  for (const [name, days] of map) {
    const u = users.find((x) => x.name === name && x.status === "active");
    if (!u) continue;
    try {
      await syncDriveDays(u.id, [...days], d);
    } catch (err) {
      d.log("[drive-sync] visit re-sync failed " + u.id, err);
    }
  }
}

/** Visit created / moved / reassigned / unscheduled / deleted. */
export async function resyncForVisitChange(before: VisitLike | null, after: VisitLike | null, deps?: Partial<DriveSyncDeps>): Promise<void> {
  const d = { ...defaultDeps(), ...deps };
  const map = new Map<string, Set<string>>();
  addPersonDays(map, before);
  addPersonDays(map, after);
  await syncPeopleDays(map, d);
}

/** An address was verified: re-sync upcoming visit legs touching it now; a
 *  place-book key may also be a Google event location on anyone's calendar,
 *  so every active rep is marked stale (next view / cron picks it up). */
export async function resyncForAddress(pointKey: string, deps?: Partial<DriveSyncDeps>): Promise<void> {
  const d = { ...defaultDeps(), ...deps };
  const window = syncWindowDays(d.now());
  const minMs = chicagoDayStart(window[0]);
  const maxMs = chicagoDayStart(addDays(window[window.length - 1], 1));
  const upcoming = (await d.visits()).filter((v) => v.startAt != null && v.startAt >= minMs && v.startAt < maxMs);
  const states = await d.visitStates(
    upcoming.map((v) => ({ id: v.id, customerId: v.customerId, locationId: v.locationId, address: v.address })),
    "cache"
  );
  const map = new Map<string, Set<string>>();
  for (const v of upcoming) if (states.get(v.id)?.pointKey === pointKey) addPersonDays(map, v);
  await syncPeopleDays(map, d);
  if (pointKey.startsWith("place:")) {
    const at = d.now();
    for (const u of await d.users()) if (u.status === "active") await d.setState(u.id, { lastSyncAt: 0, staleAt: at });
  }
}
