/**
 * Conflict badges for the viewer's own agenda (spec 2026-10-09 site-visit
 * scheduling, "Calendar + visit"). Pure: works off the drive layer's plans
 * for the viewer's days, so a page view reads no one else's calendar.
 */
import type { DriveLeg } from "@/lib/drive-plan/plan";
import type { DriveStop } from "@/lib/drive-plan/stops";
import { busyBlocks, toBusyVisit, type BusyEvent, type VisitForBusy } from "./busy";
import { stopConflicts, type Conflict } from "./check";
import type { WorkHours } from "./settings";

const UID_PREFIX = "sv-";
const UID_SUFFIX = "@peak-app";

/** Keyed by agenda item key: "v-<visitId>" for the app's visit row and
 *  "g-<eventId>" for every calendar copy of that visit. Linear-ish: the
 *  viewer's busy blocks are built once per call (each stop drops its own
 *  block), and each event's owning visit(s) are found once up front. */
export function agendaConflicts(args: {
  me: string;
  plans: ReadonlyArray<{ dayKey: string; stops: DriveStop[]; legs: DriveLeg[] }>;
  visits: readonly VisitForBusy[];
  events: readonly BusyEvent[] | null;
  hours: WorkHours;
  dailyDriveLimitMin: number;
}): Map<string, Conflict[]> {
  const out = new Map<string, Conflict[]>();
  const busyVisits = args.visits.map(toBusyVisit);
  const allBusy = busyBlocks({ person: args.me, visits: busyVisits, events: args.events });

  // Event id → the visit whose calendar copy it is (the first visit with that
  // id wins, as a lookup by id would), and visit id → its copies in event order.
  const ownersOfEventId = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const v of busyVisits) {
    if (seen.has(v.id)) continue;
    seen.add(v.id);
    for (const eid of v.eventIds) ownersOfEventId.set(eid, [...(ownersOfEventId.get(eid) ?? []), v.id]);
  }
  const copiesOf = new Map<string, string[]>();
  for (const e of args.events ?? []) {
    const owners = new Set<string>(ownersOfEventId.get(e.id) ?? []);
    const uid = e.iCalUID;
    if (uid.length > UID_PREFIX.length + UID_SUFFIX.length && uid.startsWith(UID_PREFIX) && uid.endsWith(UID_SUFFIX))
      owners.add(uid.slice(UID_PREFIX.length, -UID_SUFFIX.length));
    for (const id of owners) copiesOf.set(id, [...(copiesOf.get(id) ?? []), e.id]);
  }

  for (const p of args.plans) {
    for (const s of p.stops) {
      if (s.kind !== "visit") continue;
      const id = s.key.slice("sv:".length);
      const own = "sv:" + id;
      const busy = allBusy.filter((b) => b.key !== own);
      const { conflicts } = stopConflicts({ stopKey: s.key, dayKey: p.dayKey, stops: p.stops, legs: p.legs, busy, hours: args.hours, dailyDriveLimitMin: args.dailyDriveLimitMin });
      if (!conflicts.length) continue;
      out.set("v-" + id, conflicts);
      for (const eid of copiesOf.get(id) ?? []) out.set("g-" + eid, conflicts);
    }
  }
  return out;
}
