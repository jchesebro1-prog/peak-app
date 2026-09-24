import type { MobDraft, TravelLite } from "./types";

/**
 * Crew-size × days defaults per mobilization type. D136 opened Labor with
 * these five as pre-filled rows; D207 (#161, Jeff 2026-09-23) made them what
 * they were meant to be — the numbers a type pick fills in.
 */
export const MOB_DEFAULTS: Record<string, { people: string; days: string }> = {
  "Site Visit": { people: "1", days: "1" },
  Install: { people: "4", days: "5" },
  Hang: { people: "2", days: "3" },
  Commissioning: { people: "2", days: "3" },
  Training: { people: "1", days: "1" },
};

const BLANK_MOB = { people: "1", days: "1" } as const;

const isListedType = (name: string) => Object.prototype.hasOwnProperty.call(MOB_DEFAULTS, name);

/** The defaults for a type; a blank or unknown name is 1 × 1. */
export function mobDefaultsFor(name: string): { people: string; days: string } {
  return isListedType(name) ? MOB_DEFAULTS[name] : { ...BLANK_MOB };
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

/** Labor opens with ONE blank mobilization (D207) — "+ Add mobilization" adds more. */
export function defaultLaborMobs(travel: TravelLite | null): MobDraft[] {
  return [laborMob(travel)];
}

/**
 * Picking a type from the "Select type…" list. People/days are refilled from
 * the new type's defaults ONLY while they still equal the previous type's
 * defaults (1 × 1 for a blank row) — anything the user typed is kept. A row
 * that carried a custom name has no "previous default", so it keeps its numbers.
 */
export function applyMobType(m: MobDraft, name: string): MobDraft {
  const wasCustom = m.nameCustom || (!!m.name && !isListedType(m.name));
  const prev = wasCustom ? null : mobDefaultsFor(m.name);
  const untouched = !!prev && m.people === prev.people && m.days === prev.days;
  const next: MobDraft = { ...m, name, nameCustom: false };
  if (!untouched) return next;
  const d = mobDefaultsFor(name);
  return { ...next, people: d.people, days: d.days };
}
