/**
 * Conflict badges for the viewer's own agenda (spec 2026-10-09 site-visit
 * scheduling, "Calendar + visit"). Pure: works off the drive layer's plans
 * for the viewer's days, so a page view reads no one else's calendar.
 */
import type { DriveLeg } from "@/lib/drive-plan/plan";
import { isVisitIcsCopy, type DriveStop } from "@/lib/drive-plan/stops";
import { busyBlocks, toBusyVisit, type BusyEvent, type VisitForBusy } from "./busy";
import { stopConflicts, type Conflict } from "./check";
import type { WorkHours } from "./settings";

/** Keyed by agenda item key: "v-<visitId>" for the app's visit row and
 *  "g-<eventId>" for every calendar copy of that visit. */
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
  for (const p of args.plans) {
    for (const s of p.stops) {
      if (s.kind !== "visit") continue;
      const id = s.key.slice("sv:".length);
      const busy = busyBlocks({ person: args.me, visits: busyVisits, events: args.events, excludeVisitId: id });
      const { conflicts } = stopConflicts({ stopKey: s.key, dayKey: p.dayKey, stops: p.stops, legs: p.legs, busy, hours: args.hours, dailyDriveLimitMin: args.dailyDriveLimitMin });
      if (!conflicts.length) continue;
      out.set("v-" + id, conflicts);
      const eventIds = busyVisits.find((v) => v.id === id)?.eventIds ?? [];
      for (const e of args.events ?? []) if (isVisitIcsCopy(e, [{ id, eventIds }])) out.set("g-" + e.id, conflicts);
    }
  }
  return out;
}
