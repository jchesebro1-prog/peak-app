/**
 * Google sync diff (spec Part 3) — pure. The app only ever touches events
 * carrying the private extended property peakDrive = "1"; everything the
 * rep made is invisible here. Leg key = rep + date + from-stop + to-stop.
 */
import type { DriveLeg } from "@/lib/drive-plan/plan";
import { addDays, chicagoDayStart } from "@/lib/drive-plan/day";
import { DRIVE_DAY_PROP, DRIVE_KEY_PROP, DRIVE_PROP } from "@/lib/google/drive-props";

export { DRIVE_DAY_PROP, DRIVE_KEY_PROP, DRIVE_PROP };
export const LEGACY_DESCRIPTION_PREFIX = "Auto-added travel time";
const LEGACY_TITLE = /^Drive to .+ \(auto\)$/;

export type DesiredDriveEvent = { key: string; dayKey: string; title: string; description: string; startMs: number; endMs: number };
export type ExistingDriveEvent = { id: string; key: string; dayKey: string; title: string; startMs: number; endMs: number };
export type DriveDiff = {
  insert: DesiredDriveEvent[];
  update: Array<{ id: string; ev: DesiredDriveEvent }>;
  remove: ExistingDriveEvent[];
};

export function driveEventTitle(leg: DriveLeg): string {
  return leg.direction === "back" ? `Drive back to ${leg.to.label}` : `Drive to ${leg.to.label}`;
}

/** Flagged legs have no minutes to place — they never reach Google. */
export function desiredFromLegs(legs: DriveLeg[]): DesiredDriveEvent[] {
  return legs
    .filter((l) => !l.flag && l.minutes != null && l.startMs != null && l.endMs != null)
    .map((l) => ({
      key: l.key,
      dayKey: l.dayKey,
      title: driveEventTitle(l),
      description: `Drive time added by Quartzite — it updates on its own. ${l.routeMin} min drive + ${l.bufferMin} min buffer, from ${l.from.label}.`,
      startMs: l.startMs as number,
      endMs: l.endMs as number,
    }));
}

export function drivePrivateProps(ev: DesiredDriveEvent): Record<string, string> {
  return { [DRIVE_PROP]: "1", [DRIVE_KEY_PROP]: ev.key, [DRIVE_DAY_PROP]: ev.dayKey };
}

/** The tagged drive events that are THIS rep's legs (key "<userId>|…"). A
 *  shared or delegated calendar can show another rep's drive events; those
 *  are never diffed, so one rep's sync can't delete another's. */
export function existingFromCalendar(
  events: ReadonlyArray<{ id: string; title: string; startMs: number; endMs: number; peakDriveKey: string; peakDriveDay: string }>,
  userId: string
): ExistingDriveEvent[] {
  const prefix = userId + "|";
  return events
    .filter((e) => !!e.peakDriveKey && e.peakDriveKey.startsWith(prefix))
    .map((e) => ({ id: e.id, key: e.peakDriveKey, dayKey: e.peakDriveDay, title: e.title, startMs: e.startMs, endMs: e.endMs }));
}

/** Insert / update / delete ONLY tagged events on the given days. Two
 *  events with one key (a concurrent double-sync) collapse to one. */
export function diffDriveEvents(desired: DesiredDriveEvent[], existing: ExistingDriveEvent[], days: ReadonlySet<string>): DriveDiff {
  const byKey = new Map<string, ExistingDriveEvent[]>();
  for (const e of existing) {
    if (!days.has(e.dayKey)) continue;
    const list = byKey.get(e.key) ?? [];
    list.push(e);
    byKey.set(e.key, list);
  }
  const out: DriveDiff = { insert: [], update: [], remove: [] };
  const wanted = new Set<string>();
  for (const ev of desired) {
    if (!days.has(ev.dayKey) || wanted.has(ev.key)) continue;
    wanted.add(ev.key);
    const [keep, ...extra] = [...(byKey.get(ev.key) ?? [])].sort((a, b) => a.id.localeCompare(b.id));
    out.remove.push(...extra);
    if (!keep) out.insert.push(ev);
    else if (keep.title !== ev.title || keep.startMs !== ev.startMs || keep.endMs !== ev.endMs) out.update.push({ id: keep.id, ev });
  }
  for (const [key, list] of byKey) if (!wanted.has(key)) out.remove.push(...list);
  return out;
}

/** Days a paged calendar read saw in full: a Chicago day is kept only if it
 *  ends at or before `coveredThroughMs` (the read's coverage). Pass just these
 *  to diffDriveEvents — a day cut off mid-read would mis-insert/update/delete. */
export function daysFullyCovered(days: string[], coveredThroughMs: number): string[] {
  return days.filter((d) => chicagoDayStart(addDays(d, 1)) <= coveredThroughMs);
}

/** D144's "Drive to … (auto)" block, upcoming only, exact shape only. */
export function isLegacyTravelBlock(ev: { title: string; description: string; startMs: number; peakDriveKey?: string }, nowMs: number): boolean {
  return !ev.peakDriveKey && LEGACY_TITLE.test(ev.title) && ev.description.startsWith(LEGACY_DESCRIPTION_PREFIX) && ev.startMs >= nowMs;
}
