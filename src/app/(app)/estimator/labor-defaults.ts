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

/**
 * #272: the route's round-trip miles (one-way x 2, whole miles) — what the
 * Labor modal's "Use N mi RT" button shows — or null when there is no route
 * (venue not located, no estimate yet).
 */
export function roundTripMiles(travel: TravelLite | null | undefined): number | null {
  return travel && travel.miles != null ? Math.round(travel.miles * 2) : null;
}

/** True while a miles box is empty — "untouched"; a typed 0 is a deliberate choice. */
const blankMiles = (v: string | undefined | null) => v === "" || v == null;

type MobMiles = Pick<MobDraft, "milesRT" | "milesAuto">;

/** A mobilization with `next` miles; `milesAuto` is only ever present as true. */
function withMiles(m: MobDraft, next: MobMiles): MobDraft {
  const { milesAuto: _drop, ...rest } = m;
  void _drop;
  return next.milesAuto ? { ...rest, milesRT: next.milesRT, milesAuto: true } : { ...rest, milesRT: next.milesRT };
}

/**
 * The miles box against the route. Miles the route filled earlier
 * (`milesAuto`) follow it — replaced by the new round trip, or blanked when
 * the new route has none (so the no-mileage warning shows). A blank box fills.
 * Typed miles, and legacy drafts with no flag, are never touched.
 */
function followRoute(m: MobDraft, travel: TravelLite | null | undefined): MobMiles {
  const rt = roundTripMiles(travel);
  if (m.milesAuto === true) return rt != null ? { milesRT: String(rt), milesAuto: true } : { milesRT: "", milesAuto: false };
  if (blankMiles(m.milesRT) && rt != null) return { milesRT: String(rt), milesAuto: true };
  return { milesRT: m.milesRT, milesAuto: false };
}

/** Typing in the miles box: the value is the user's from now on (a typed 0 included). */
export function typeMobMiles(m: MobDraft, value: string): MobDraft {
  return withMiles(m, { milesRT: value, milesAuto: false });
}

/** The modal's "Use N mi RT" button: the route's miles, still auto (a later route change follows). */
export function setRouteMiles(m: MobDraft, travel: TravelLite | null): MobDraft {
  const rt = roundTripMiles(travel);
  return rt == null ? m : withMiles(m, { milesRT: String(rt), milesAuto: true });
}

export function laborMob(
  travel: TravelLite | null,
  name = "",
  people = "1",
  days = "1"
): MobDraft {
  const far = !!(travel && travel.minutes != null && travel.minutes > 60);
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
    // #272: Local seeds the route's miles too — local mileage bills every day
    // (computeMob), so a blank box silently priced it at $0.
    milesRT: roundTripMiles(travel) != null ? String(roundTripMiles(travel)) : "",
    ...(roundTripMiles(travel) != null ? { milesAuto: true } : {}),
    lift: false,
    liftRate: "",
    comments: "",
    internalNote: "",
  };
}

/**
 * #272: switching a mobilization to Local (a manual pick, so the >1 h auto rule
 * stops applying). A blank miles box fills from the route — daily mileage now
 * needs the number — while typed miles stay.
 */
export function applyLocalTrip(m: MobDraft, travel: TravelLite | null): MobDraft {
  return withMiles({ ...m, tripType: "local", tripAuto: false }, followRoute(m, travel));
}

/** Switching a mobilization to Travel (manual): blank miles fill, typed miles stay. */
export function applyTravelTripTo(m: MobDraft, travel: TravelLite | null): MobDraft {
  return withMiles({ ...m, tripType: "travel", tripAuto: false }, followRoute(m, travel));
}

/**
 * The customer / venue (the route) changed while Labor is open. Every
 * mobilization still on the auto rule takes the trip type the route implies
 * (> 60 min one way -> Travel; a manual Local/Travel pick keeps its type). The
 * miles box follows the route for all of them (#272): auto-filled miles are
 * replaced by the new round trip (blanked when the route has none), a blank box
 * fills, and typed miles — or a reopened #269 draft's, or a pre-flag draft's —
 * are never overwritten.
 */
export function applyAutoTrips(mobs: MobDraft[], travel: TravelLite | null): MobDraft[] {
  const far = !!(travel && travel.minutes != null && travel.minutes > 60);
  return mobs.map((m) => {
    const typed: MobDraft = m.tripAuto === false ? m : { ...m, tripType: far ? "travel" : "local" };
    return withMiles(typed, followRoute(m, travel));
  });
}

/**
 * #272: a mobilization whose miles box is blank with no route to fill it from
 * bills $0 mileage without saying so — the Labor modal flags it (never blocks Add).
 */
export function mobMissingMileage(m: Pick<MobDraft, "milesRT">, travel: TravelLite | null | undefined): boolean {
  return blankMiles(m.milesRT) && roundTripMiles(travel) == null;
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
