# Flights over drive — auto-priced service quotes switch to air travel past a drive-cost threshold

**Date:** 2026-09-25 · **Status:** approved by Jeff (brainstorm, 2026-09-25)

## 1. Goal

Jeff: "For all automated [quotes], we need allow for flights over travel when we reach a certain travel dollar amount.
So once we reach 1000 dollars in travel expenses, then it switches to flights and hotels with allowances."

Today the three auto-priced service quotes — **flame tests**, **repairs**, **inspections** — price travel as a drive
only: `miles × mileageRate + roundUp(minutes, travelRoundMin)/60 × laborRate` over one trip (office → every venue →
office; `tripTravel` in `src/lib/flametest-engine.ts` and `src/lib/repair-engine.ts`, the latter reused by
`src/lib/inspection-engine.ts`). No flights, hotels or per diem exist for these quotes. The Estimator's own hotel/meal
mobilization (`computeMob`, TVL-HTL / TVL-FOD) is **out of scope** and unchanged.

## 2. Decisions (from the brainstorm)

1. **Scope:** the three auto-priced quotes (flame tests, repairs, inspections) and every path that prices them —
   the quote builders, their browser previews, the renewal re-pricing (`renewal-outreach.ts`), letters and quote
   documents. Not the Estimator, rentals or consulting.
2. **Trigger:** the **per-trip drive cost** (the existing `trip.total` = mileage + drive-time labor for that one trip)
   compared to a threshold, default **$1,000**. `≥ threshold` → flights. Automatic, with an override.
3. **Flight pricing:** allowances set once in Estimating Rules, plus a **manual airfare** field on the quote (the
   allowance is only the default).
4. **Crew and nights:** a default crew per service (flame **1**, repairs **2**, inspections **1**); days on site computed
   from on-site labor hours; both shown in the builder and overridable.
5. **Customer view:** one line, **"Travel (air, lodging & per diem)"**; the itemized breakdown is builder-only.

## 3. Pricing (pure)

A new pure module `src/lib/travel-plan.ts` (no DB, no server imports — client previews import it):

```
planTravel({ drive: TripTravel, onSiteHours, laborRate, crewDefault, rates: TravelRates, override? }) → TravelPlan
```

- **Mode:** `override.mode` ∈ `auto | drive | fly` (default `auto`). Auto → `fly` when `drive.total ≥ rates.flyThreshold`
  (and `flyThreshold > 0`), else `drive`.
- **Drive mode:** exactly today's `drive` numbers; `total = drive.total`. Engines' drive-mode totals must be bit-for-bit
  unchanged.
- **Fly mode:**
  - `crew = override.crew ?? crewDefault` (integer ≥ 1)
  - `workDays = max(1, ceil(onSiteHours / (crew × rates.flyHoursPerDay)))`
  - `nights = override.nights ?? workDays` (arrive the night before)
  - `tripDays = nights + 1`
  - `airfare = crew × (override.airfarePerPerson ?? rates.airfarePerPerson)`
  - `lodging = crew × nights × rates.hotelPerNight` (one room per person)
  - `perDiem = crew × tripDays × rates.perDiemPerDay`
  - `car = ceil(crew / 2) × tripDays × rates.carPerDay`
  - `travelLabor = crew × rates.flyTravelHoursEachWay × 2 × laborRate` (the service's own labor rate)
  - `total = airfare + lodging + perDiem + car + travelLabor`
- The engine then uses `plan.total` wherever it used `trip.total`; margin, minimum fee / base fee and rounding apply
  exactly as they do to travel today.

**Rates** — added to the shared `TravelRates` blob (`travel_rates`, `src/lib/stores/pricing.ts`) with defaults, and
exposed in Estimating Rules → Travel & mileage:

| Key | Label | Default |
|---|---|---|
| `flyThreshold` | Fly when one trip's drive cost reaches | $1,000 |
| `airfarePerPerson` | Airfare allowance (round trip, per person) | $450 |
| `hotelPerNight` | Hotel (per room per night) | $140 |
| `perDiemPerDay` | Per diem (per person per day) | $70 |
| `carPerDay` | Rental car (per car per day, 1 car per 2 people) | $75 |
| `flyTravelHoursEachWay` | Travel-day labor (hours each way, per person) | 4 h |
| `flyHoursPerDay` | On-site hours per person per day | 8 h |

Per-service default crew lives with each service's rates: `flame_rates.flyCrew` 1, `repair_rates.flyCrew` 2,
`inspection_rates.flyCrew` 1 (each in its own Estimating Rules group). Missing keys on stored blobs fall back to the
defaults (existing blobs have none of them).

**On-site hours** per engine: flame — total curtain labor minutes ÷ 60; repairs — estimated labor hours; inspections —
its labor hours (the same quantities each engine already prices).

## 4. Data

- Each service quote's saved input gains an optional `travel?: { mode?: "auto"|"drive"|"fly"; crew?: number;
  nights?: number; airfarePerPerson?: number }`. Absent = auto, no overrides. No migration (JSONB documents).
- The priced result carries the plan: `trip` keeps the drive numbers and gains `mode: "drive"|"fly"` and, in fly mode,
  `flight: { crew, workDays, nights, tripDays, airfare, lodging, perDiem, car, travelLabor, total }`; the engine's
  travel figure used in the total is `plan.total`.
- **Already-saved quotes keep their stored price.** Nothing is re-priced in bulk; a quote changes only when someone
  re-prices it (builder save, renewal re-price).

## 5. What the user sees

- **Quote builders** (flame / repairs / inspections): the travel block shows the drive figures as today, plus a
  **Travel: Auto · Drive · Fly** control. In fly mode (auto-switched or forced) it shows crew, nights and airfare per
  person (editable, pre-filled from the defaults), the itemized airfare / lodging / per diem / rental car / travel labor,
  and a note when auto switched: "Drive would be $X — over the $1,000 threshold, priced as flights."
- **Letters and quote documents:** in fly mode the travel line reads **"Travel (air, lodging & per diem)"** with the
  single amount; wording that today says mileage/drive time is replaced by that line. Drive mode is unchanged.
- **Renewal outreach:** re-pricing applies the same rule; when the renewal flips mode relative to last year, the
  "why the price changed" text says travel is now priced as flights (or back to driving).
- **Estimating Rules:** the new travel keys and each service's default crew are editable like other rates.

## 6. Testing

Pure (`scripts/test-review-and-spec.ts`): threshold boundary (999.99 → drive, 1000 → fly, threshold 0 → never fly);
forced drive over threshold; forced fly under threshold; workDays/nights/tripDays formulas incl. crew override and
nights override; airfare override; car = ceil(crew/2); travel labor uses the service's labor rate; each engine's total
in drive mode unchanged vs before (fixtures) and in fly mode equal to the hand-computed figure; renewal wording on a
mode flip; missing blob keys fall back to defaults. Gates: tsc, eslint (baseline), test:specs, regressions harness,
test:smoke, `next build`.

## 7. Out of scope

Estimator mobilization; live airfare lookup; per-venue split trips (one quote = one trip, as today); changing prices of
already-saved quotes.
