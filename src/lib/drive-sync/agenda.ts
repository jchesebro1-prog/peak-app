/**
 * The drive layer of the merged agenda (spec "Display"): drive blocks as
 * their own items, flagged legs as zero-length flags at their anchor, and
 * the address flag for each unverified stop. Computed in "cache" mode on
 * every view — no geocoding or OSRM calls on a page render.
 */
import type { FixTarget } from "@/lib/address-verify/types";
import type { AgendaItem } from "@/lib/agenda";
import { dayKeysBetween } from "@/lib/drive-plan/day";
import { planDriveDays, type DriveLoadDeps } from "@/lib/drive-plan/load";
import { FLAG_TEXT, type DriveLeg } from "@/lib/drive-plan/plan";
import type { CalendarEvent } from "@/lib/google/calendar";
import { allVisits } from "@/lib/stores/site-visits";
import { driveEventTitle } from "./diff";

export type AddressFlag = { text: string; fix: FixTarget | null };

export function driveItemFromLeg(leg: DriveLeg): AgendaItem {
  return {
    key: "d-" + leg.key,
    id: leg.key,
    title: leg.flag ? leg.flag.text : driveEventTitle(leg),
    startMs: leg.startMs ?? leg.anchorMs,
    endMs: leg.endMs ?? leg.anchorMs,
    allDay: false,
    location: "",
    href: "",
    source: "drive",
    drive: {
      dayKey: leg.dayKey,
      minutes: leg.minutes,
      routeMin: leg.routeMin,
      bufferMin: leg.bufferMin,
      flag: leg.flag?.text ?? null,
      tight: leg.tight?.text ?? null,
      fix: leg.fix,
      fromLabel: leg.from.label,
      toLabel: leg.to.label,
    },
  };
}

export async function driveAgendaLayer(args: {
  userId: string;
  minMs: number;
  maxMs: number;
  googleEvents: CalendarEvent[] | null;
  deps?: Partial<DriveLoadDeps>;
}): Promise<{ items: AgendaItem[]; addressFlags: Map<string, AddressFlag> }> {
  const plans = await planDriveDays({
    userId: args.userId,
    dayKeys: dayKeysBetween(args.minMs, args.maxMs),
    events: args.googleEvents,
    mode: "cache",
    deps: args.deps,
  });
  const items = plans.flatMap((p) => p.legs.map(driveItemFromLeg));
  const addressFlags = new Map<string, AddressFlag>();
  // A visit pushed straight to Google (googleEventId) shows as that event.
  const needVisits = (args.googleEvents ?? []).length > 0 && plans.some((p) => p.stops.some((s) => s.kind === "visit" && s.address.status !== "verified"));
  const eventIdOf = new Map<string, string>();
  if (needVisits) for (const v of await (args.deps?.visits ?? allVisits)()) if (v.googleEventId) eventIdOf.set(v.id, v.googleEventId);
  for (const p of plans) {
    for (const s of p.stops) {
      if (s.address.status === "verified") continue;
      const flag: AddressFlag = { text: FLAG_TEXT.unverified, fix: s.address.fix };
      if (s.kind === "visit") {
        const id = s.key.slice("sv:".length);
        addressFlags.set("v-" + id, flag);
        for (const e of args.googleEvents ?? []) if (e.iCalUID === `sv-${id}@peak-app` || e.id === eventIdOf.get(id)) addressFlags.set("g-" + e.id, flag);
      } else {
        addressFlags.set("g-" + s.key.slice("g:".length), flag);
      }
    }
  }
  return { items, addressFlags };
}
