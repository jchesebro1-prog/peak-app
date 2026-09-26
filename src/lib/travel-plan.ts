/**
 * Flights over drive — the travel planner for the three auto-priced service
 * quotes (flame tests, repairs, inspections).
 * Spec: docs/superpowers/specs/2026-09-25-travel-flights-design.md.
 *
 * This module has NO imports and touches no DB or server code: the quote
 * builders' "use client" previews use it directly (a client import of any
 * value under @/lib/stores or @/db breaks `next build`). The engines, the
 * save actions, renewal re-pricing and the letters use it too, so every path
 * applies one rule and prints one wording.
 *
 * The rule: one trip's drive cost (mileage + drive-time labor — the engines'
 * existing trip.total) at or over `flyThreshold` prices the trip as flights,
 * lodging, per diem, a rental car and travel-day labor. A threshold of 0
 * never flies. Drive mode hands back the drive total untouched, so
 * drive-mode quotes price bit-for-bit as before.
 */

export type TravelMode = "drive" | "fly";
export type TravelModeChoice = "auto" | TravelMode;

/** The flight knobs — stored in the shared `travel_rates` blob. */
export type FlyRates = {
  /** $ — fly when one trip's drive cost reaches this (0 = never fly). */
  flyThreshold: number;
  /** $ — round-trip airfare allowance per person (the quote can override it). */
  airfarePerPerson: number;
  /** $ — one room per person per night. */
  hotelPerNight: number;
  /** $ — per person per trip day. */
  perDiemPerDay: number;
  /** $ — per car per trip day, one car per two people. */
  carPerDay: number;
  /** Hours of travel-day labor each way, per person. */
  flyTravelHoursEachWay: number;
  /** On-site hours one person works per day (sets the nights). */
  flyHoursPerDay: number;
};

/** Spec §3 defaults — seed/fallback for the fly keys of blob `travel_rates`. */
export const FLY_RATE_DEFAULTS: FlyRates = {
  flyThreshold: 1000,
  airfarePerPerson: 450,
  hotelPerNight: 140,
  perDiemPerDay: 70,
  carPerDay: 75,
  flyTravelHoursEachWay: 4,
  flyHoursPerDay: 8,
};

/** Default flying crew per service (each lives in that service's rates blob as `flyCrew`). */
export const FLY_CREW_DEFAULTS = { flame: 1, repair: 2, inspection: 1 } as const;

/** The one customer-facing travel line in fly mode (spec §2.5). */
export const TRAVEL_FLY_LINE = "Travel (air, lodging & per diem)";

/** Per-quote override, saved as `travel` on the quote's service subdoc. */
export type TravelOverride = {
  mode?: TravelModeChoice;
  crew?: number;
  nights?: number;
  airfarePerPerson?: number;
};

export type FlightPlan = {
  crew: number;
  workDays: number;
  nights: number;
  tripDays: number;
  airfare: number;
  lodging: number;
  perDiem: number;
  car: number;
  /** crew × hours each way × 2 — shown on letters' hours column. */
  travelHours: number;
  travelLabor: number;
  total: number;
};

export type TravelPlan = {
  /** What the quote prices. */
  mode: TravelMode;
  /** What Auto would pick (the builder note compares the two). */
  autoMode: TravelMode;
  /** The override's mode, or "auto". */
  choice: TravelModeChoice;
  /** The drive cost of the trip (the engines' trip.total). */
  driveTotal: number;
  threshold: number;
  /** Non-null exactly when mode === "fly". */
  flight: FlightPlan | null;
  /** The values the builder shows as placeholders (crew/nights/airfare). */
  defaults: { crew: number; nights: number; airfarePerPerson: number };
  /** The travel figure the engine prices: drive.total in drive mode, flight.total in fly mode. */
  total: number;
};

/** What a priced trip carries on top of the drive numbers. */
export type TripMode = { mode: TravelMode; flight?: FlightPlan };

export type PlanTravelInput = {
  drive: { total: number };
  onSiteHours: number;
  /** The service's own labor rate (base rate — never the emergency multiple). */
  laborRate: number;
  crewDefault: number;
  rates?: Partial<FlyRates> | null;
  override?: TravelOverride | null;
};

function num(v: unknown): number | null {
  if (v === "" || v == null || typeof v === "boolean") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Every fly key, taking the stored value when it is a finite number and the default otherwise. */
export function resolveFlyRates(rates?: Partial<FlyRates> | null): FlyRates {
  const out: FlyRates = { ...FLY_RATE_DEFAULTS };
  if (!rates) return out;
  for (const k of Object.keys(FLY_RATE_DEFAULTS) as Array<keyof FlyRates>) {
    const v = num(rates[k]);
    if (v != null) out[k] = v;
  }
  return out;
}

/** Clean an override from any source (posted JSON, a stored doc). "auto" is the absence of a mode. */
export function normalizeTravelOverride(raw: unknown): TravelOverride | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: TravelOverride = {};
  if (r.mode === "drive" || r.mode === "fly") out.mode = r.mode;
  const crew = num(r.crew);
  if (crew != null && crew >= 1) out.crew = Math.round(crew);
  const nights = num(r.nights);
  if (nights != null && nights >= 0) out.nights = Math.round(nights);
  const airfare = num(r.airfarePerPerson);
  if (airfare != null && airfare >= 0) out.airfarePerPerson = airfare;
  return Object.keys(out).length ? out : undefined;
}

/** The builder posts the override as a JSON string field named "travel". */
export function parseTravelOverride(json: unknown): TravelOverride | undefined {
  if (typeof json !== "string" || !json) return undefined;
  try {
    return normalizeTravelOverride(JSON.parse(json));
  } catch {
    return undefined;
  }
}

/** Renewals keep last year's travel CHOICE (mode, crew, nights) but re-price
 *  airfare at the current allowance — a manual fare is a one-year number. */
export function carryTravelOverride(raw: unknown): TravelOverride | undefined {
  const o = normalizeTravelOverride(raw);
  if (!o) return undefined;
  const { airfarePerPerson: _dropped, ...rest } = o;
  void _dropped;
  return Object.keys(rest).length ? rest : undefined;
}

/** Builder input state — strings, blank = use the default. */
export type TravelDraft = { mode: TravelModeChoice; crew: string; nights: string; airfare: string };

export function draftFromOverride(o?: TravelOverride | null): TravelDraft {
  return {
    mode: o?.mode ?? "auto",
    crew: o?.crew != null ? String(o.crew) : "",
    nights: o?.nights != null ? String(o.nights) : "",
    airfare: o?.airfarePerPerson != null ? String(o.airfarePerPerson) : "",
  };
}

export function overrideFromDraft(d: TravelDraft): TravelOverride | undefined {
  return normalizeTravelOverride({ mode: d.mode, crew: d.crew, nights: d.nights, airfarePerPerson: d.airfare });
}

/** Spec §3 — the whole rule. Pure. */
export function planTravel(input: PlanTravelInput): TravelPlan {
  const R = resolveFlyRates(input.rates);
  const o = normalizeTravelOverride(input.override) ?? {};
  const driveTotal = input.drive.total;
  const autoMode: TravelMode = R.flyThreshold > 0 && driveTotal >= R.flyThreshold ? "fly" : "drive";
  const choice: TravelModeChoice = o.mode ?? "auto";
  const mode: TravelMode = choice === "auto" ? autoMode : choice;

  const crewDefault = Math.max(1, Math.round(num(input.crewDefault) ?? 1));
  const crew = o.crew ?? crewDefault;
  const perDay = crew * R.flyHoursPerDay;
  const onSite = Math.max(0, num(input.onSiteHours) ?? 0);
  // round to 1e-6 first so 16.000000000002 h doesn't book an extra day
  const workDays = perDay > 0 ? Math.max(1, Math.ceil(Math.round((onSite / perDay) * 1e6) / 1e6)) : 1;
  const defaults = { crew: crewDefault, nights: workDays, airfarePerPerson: R.airfarePerPerson };

  if (mode === "drive") {
    // bit-for-bit: the drive total itself, no arithmetic
    return { mode, autoMode, choice, driveTotal, threshold: R.flyThreshold, flight: null, defaults, total: driveTotal };
  }

  const nights = o.nights ?? workDays;
  const tripDays = nights + 1;
  const airfare = crew * (o.airfarePerPerson ?? R.airfarePerPerson);
  const lodging = crew * nights * R.hotelPerNight;
  const perDiem = crew * tripDays * R.perDiemPerDay;
  const car = Math.ceil(crew / 2) * tripDays * R.carPerDay;
  const travelHours = crew * R.flyTravelHoursEachWay * 2;
  const travelLabor = travelHours * input.laborRate;
  const total = airfare + lodging + perDiem + car + travelLabor;
  return {
    mode,
    autoMode,
    choice,
    driveTotal,
    threshold: R.flyThreshold,
    flight: { crew, workDays, nights, tripDays, airfare, lodging, perDiem, car, travelHours, travelLabor, total },
    defaults,
    total,
  };
}

/** The engine's priced trip: the drive numbers, plus the mode and (fly) the flight. */
export function withMode<T extends object>(drive: T, plan: TravelPlan): T & TripMode {
  return plan.flight ? { ...drive, mode: plan.mode, flight: plan.flight } : { ...drive, mode: plan.mode };
}

/** The `trip` block every service quote persists (today's drive fields + mode/flight). */
export type SavedTrip = {
  miles: number;
  minutes: number;
  mileageCost: number;
  timeCost: number;
  method: "route" | "estimate";
  mode: TravelMode;
  flight?: FlightPlan;
};

export function savedTrip(
  t: { miles: number; minutes: number; mileageCost: number; timeCost: number; method: "route" | "estimate" } & TripMode
): SavedTrip {
  const out: SavedTrip = {
    miles: t.miles,
    minutes: t.minutes,
    mileageCost: Math.round(t.mileageCost),
    timeCost: Math.round(t.timeCost),
    method: t.method,
    mode: t.mode,
  };
  if (t.flight) {
    const f = t.flight;
    out.flight = {
      ...f,
      airfare: Math.round(f.airfare),
      lodging: Math.round(f.lodging),
      perDiem: Math.round(f.perDiem),
      car: Math.round(f.car),
      travelLabor: Math.round(f.travelLabor),
      total: Math.round(f.total),
    };
  }
  return out;
}

/** A saved trip's flight — only when it was priced as flights. Tolerates any stored shape. */
export function flightOf(trip: unknown): FlightPlan | null {
  if (!trip || typeof trip !== "object") return null;
  const t = trip as { mode?: unknown; flight?: unknown };
  if (t.mode !== "fly" || !t.flight || typeof t.flight !== "object") return null;
  const f = t.flight as Record<string, unknown>;
  const total = num(f.total);
  if (total == null) return null;
  const n = (k: string): number => num(f[k]) ?? 0;
  return {
    crew: n("crew"),
    workDays: n("workDays"),
    nights: n("nights"),
    tripDays: n("tripDays"),
    airfare: n("airfare"),
    lodging: n("lodging"),
    perDiem: n("perDiem"),
    car: n("car"),
    travelHours: n("travelHours"),
    travelLabor: n("travelLabor"),
    total,
  };
}

/** Travel's share of the sell price: the flight cost marked up by the quote's margin. */
export function travelLineAmount(flightTotal: number, margin: number): number {
  return margin > 0 && margin < 1 ? Math.round(flightTotal / (1 - margin)) : Math.round(flightTotal);
}

export function fmtUsd(n: number): string {
  return "$" + Math.round(n || 0).toLocaleString("en-US");
}

/** Spec §5 — shown in the builder when Auto switched the trip to flights. */
export function autoSwitchNote(driveTotal: number, threshold: number): string {
  return `Drive would be ${fmtUsd(driveTotal)} — over the ${fmtUsd(threshold)} threshold, priced as flights.`;
}

/** The letters' one travel sentence in fly mode. */
export function flyTravelSentence(from: string, to: string, amount: number): string {
  return `Given the distance from ${from} to ${to}, this visit is priced with air travel — ${TRAVEL_FLY_LINE}: ${fmtUsd(amount)}.`;
}

/** Renewal "why the price changed" phrase when the mode flipped (a noun phrase for "The increase reflects …"). */
export function travelModeChangeReason(prior: TravelMode, current: TravelMode): string | null {
  if (prior === current) return null;
  return current === "fly"
    ? "travel now being priced as flights, lodging & per diem instead of a drive"
    : "travel now being priced as a drive instead of flights";
}
