import type { MobDraft, TravelLite } from "./types";

export const MOB_DEFAULTS = {
  "Site Visit": ["1", "1"],
  Install: ["4", "5"],
  Hang: ["2", "3"],
  Commissioning: ["2", "3"],
  Training: ["1", "1"],
} as const;

export function mobDefaultsFor(name: string): { people: string; days: string } | null {
  const pair = MOB_DEFAULTS[name as keyof typeof MOB_DEFAULTS];
  return pair ? { people: pair[0], days: pair[1] } : null;
}

export function disciplineForSystemTitle(title: string): "RIG" | "LIG" | "AUD" | "OTH" {
  const value = (title || "").toLowerCase();
  if (/audio|sound|video|projection|\bav\b|a\/v/.test(value)) return "AUD";
  if (/light|electric|dimmer|control/.test(value)) return "LIG";
  if (/rig|hoist|hang|curtain|drape|track|lineset|line set/.test(value)) return "RIG";
  return "OTH";
}

export function laborMob(
  travel: TravelLite | null,
  name = "",
  people = "1",
  days = "1"
): MobDraft {
  const far = !!(travel && travel.minutes != null && travel.minutes > 60);
  const roundTrip = travel && travel.miles != null ? Math.round(travel.miles * 2) : null;
  return {
    name,
    nameCustom: false,
    tripType: far ? "travel" : "local",
    tripAuto: true,
    people,
    days,
    hoursPerDay: "8",
    otHrs: "",
    sup: true,
    milesRT: far && roundTrip != null ? String(roundTrip) : "",
    lift: false,
    liftRate: "",
    comments: "",
    internalNote: "",
  };
}

export function defaultLaborMobs(travel: TravelLite | null): MobDraft[] {
  return [laborMob(travel)];
}

/**
 * Removes only the old untouched five-row seed. Real multi-mobilization work
 * is preserved, including a user who changed any crew/day value or label.
 */
export function normalizeLaborMobs(mobs: MobDraft[], travel: TravelLite | null = null): MobDraft[] {
  const legacy = [
    ["Site Visit", "1", "1"],
    ["Install", "4", "5"],
    ["Hang", "2", "3"],
    ["Commissioning", "2", "3"],
    ["Training", "1", "1"],
  ] as const;
  if (mobs.length !== legacy.length) return mobs;
  const untouched = mobs.every((m, i) => {
    const [name, people, days] = legacy[i];
    return m.name === name && m.people === people && m.days === days && !m.nameCustom;
  });
  return untouched ? [laborMob(travel)] : mobs;
}
