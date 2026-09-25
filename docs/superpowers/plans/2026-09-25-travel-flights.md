# Flights Over Drive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The three auto-priced service quotes (flame tests, repairs, inspections) price travel as flights, lodging and per diem instead of a drive once one trip's drive cost reaches a threshold (default $1,000), with an Auto · Drive · Fly override, per-quote crew / nights / airfare overrides, and one customer-facing line "Travel (air, lodging & per diem)".

**Architecture:** A new **pure, import-free** module `src/lib/travel-plan.ts` owns the whole rule (`planTravel`), the flight-rate defaults, override parsing, the persisted trip shape and every customer-facing string. The three server engines (`flametest-engine.ts`, `repair-engine.ts`, `inspection-engine.ts`) call it on top of their unchanged drive math and price `plan.total` where they priced `trip.total`; the three client builder previews (which inline the engine math because the engines import the doc-store) call the same function. Flight rates join the shared `travel_rates` blob; each service's default crew joins that service's own rates blob; both surface in Estimating Rules through the existing generic `rate()` registry. Save actions, renewal re-pricing, the on-screen letters and the renewal PDF letters read the persisted `trip.mode` / `trip.flight`.

**Tech Stack:** Next.js 16 App Router (server components, server actions, `"use client"` builders), TypeScript, the Drizzle doc-store (JSONB blobs + quote documents, no migration), tsx for the `test:specs` harness (`scripts/test-review-and-spec.ts`).

**Spec:** `docs/superpowers/specs/2026-09-25-travel-flights-design.md` (approved by Jeff, 2026-09-25).

## Global Constraints

From the spec and the project's binding rules — every task's requirements implicitly include this section:

- **Scope:** flame tests, repairs, inspections and every path that prices them (builders, builder previews, save actions, renewal re-pricing in `renewal-outreach.ts`, on-screen letters, renewal PDF letters). **Not** the Estimator (`computeMob`, TVL-HTL / TVL-FOD), rentals or consulting. No live airfare lookup, no per-venue split trips (one quote = one trip).
- **Trigger:** the per-trip drive cost — the engines' existing `trip.total` (mileage + drive-time labor for that one trip) — compared to `flyThreshold`: `drive.total ≥ flyThreshold` (and `flyThreshold > 0`) → fly. `flyThreshold = 0` → never fly.
- **Override:** `travel?: { mode?: "auto"|"drive"|"fly"; crew?: number; nights?: number; airfarePerPerson?: number }` on each service quote's saved subdoc. Absent = auto, no overrides. No migration (JSONB documents).
- **Fly-mode formulas, exactly:** `crew = override.crew ?? crewDefault` (integer ≥ 1) · `workDays = max(1, ceil(onSiteHours / (crew × flyHoursPerDay)))` · `nights = override.nights ?? workDays` · `tripDays = nights + 1` · `airfare = crew × (override.airfarePerPerson ?? airfarePerPerson)` · `lodging = crew × nights × hotelPerNight` · `perDiem = crew × tripDays × perDiemPerDay` · `car = ceil(crew / 2) × tripDays × carPerDay` · `travelLabor = crew × flyTravelHoursEachWay × 2 × laborRate` (the service's own labor rate) · `total = airfare + lodging + perDiem + car + travelLabor`.
- **Drive mode is bit-for-bit unchanged:** in drive mode `plan.total` IS `drive.total` (the same number, no arithmetic), and margin, minimum fee / base fee and rounding apply exactly as they do to travel today.
- **Rate defaults, exactly (spec table):** `flyThreshold` $1,000 · `airfarePerPerson` $450 · `hotelPerNight` $140 · `perDiemPerDay` $70 · `carPerDay` $75 · `flyTravelHoursEachWay` 4 h · `flyHoursPerDay` 8 h. Estimating Rules labels, exactly: "Fly when one trip's drive cost reaches", "Airfare allowance (round trip, per person)", "Hotel (per room per night)", "Per diem (per person per day)", "Rental car (per car per day, 1 car per 2 people)", "Travel-day labor (hours each way, per person)", "On-site hours per person per day".
- **Default crew:** `flame_rates.flyCrew` 1, `repair_rates.flyCrew` 2, `inspection_rates.flyCrew` 1, each in its own Estimating Rules group. Missing keys on stored blobs fall back to the defaults.
- **On-site hours:** flame — total curtain labor minutes ÷ 60; repairs — estimated labor hours (crew-hours); inspections — its labor hours (`inspectHours`).
- **Customer-facing line text, exactly:** `Travel (air, lodging & per diem)` (constant `TRAVEL_FLY_LINE`). The itemized airfare / lodging / per diem / car / travel labor breakdown is builder-only.
- **Builder note text, exactly (spec §5):** `Drive would be $X — over the $1,000 threshold, priced as flights.` (the threshold figure is the live rate, formatted `$1,000`).
- **Already-saved quotes keep their stored price.** Nothing re-prices in bulk; a quote changes only on builder save or renewal re-price.
- **Client-bundle rule (breaks `next build`, invisible to tsc):** a `"use client"` file must never import a VALUE from `@/lib/stores/*` or `@/db/*`. `src/lib/travel-plan.ts` has **no import statements at all** so the builders can import it.
- Timestamps, if any are added, are epoch-ms numbers. No hardcoded accent colours: accent-coloured UI uses the `accent` prop the pages already pass from `settings.accent`.
- **Worktree only.** Work in `/Users/sm/Downloads/peak-app/.claude/worktrees/travel-flights` (branch `feat/travel-flights`). Never `cd` to `/Users/sm/Downloads/peak-app`, never open its `.data/pglite`, never `git stash` (the stash is shared across worktrees — commit instead), never start a dev server by hand. `test:specs`, the regressions harness and `test:smoke` each run on their own `mktemp -d` datadir.
- **Harness rule:** new pure blocks in `scripts/test-review-and-spec.ts` are inserted **immediately above the line `seeded()`** that starts the async promise chain (so they append in task order). ES imports inside the file are hoisted and module-scoped: bindings the harness already imports — `ok`, `readFileSync`, `join`, `PRICING_GROUPS`, `TRAVEL_RATE_DEFAULTS`, `RateEntry`, `computeFlameQuote`, `FTVenue`, `getTemplateDef` — must be **reused, never re-imported** (a duplicate binding is a SyntaxError that kills the whole suite). Every new check message starts with `#TRV`.
- **Gates** (report real numbers): `npx tsc --noEmit` (0 errors) · `npx eslint` (baseline **111 warnings / 0 errors**; 0 errors and no new warnings) · `npm run test:specs` (0 FAIL) · `D=$(mktemp -d); env -u DATABASE_URL PGLITE_PATH=$D npx tsx scripts/test-review-regressions.ts` · `npm run test:smoke` · `env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npm run build` then `rm -rf .next`.

### Worktree setup (once, before Task 1)

A fresh worktree has no `node_modules`, `next-env.d.ts` or `.env.local`, and `npx` silently resolves the parent checkout's binaries (tsc/eslint "pass" without checking anything). Run:

```bash
cd /Users/sm/Downloads/peak-app/.claude/worktrees/travel-flights
npm ci --no-audit --no-fund                      # never symlink node_modules — Turbopack panics
ls node_modules/.bin/tsc node_modules/.bin/next  # both must exist
printf '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n' > next-env.d.ts
printf 'AUTH_SECRET=%s\nAUTH_DEV_LOGIN=true\nAUTH_TRUST_HOST=true\n' "$(openssl rand -base64 32)" > .env.local
rm -rf .next
npx tsc --noEmit; echo "tsc exit $?"             # expect 0 errors on the untouched branch
npx eslint 2>&1 | tail -3                        # expect "111 problems (0 errors, 111 warnings)" — record the real baseline
```

`next-env.d.ts` and `.env.local` are gitignored; never commit them.

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `src/lib/travel-plan.ts` | **Create** | Pure, import-free: fly-rate + crew defaults, `planTravel`, override normalize/parse/draft/carry, `withMode`, `savedTrip`, `flightOf`, `travelLineAmount`, all wording (`TRAVEL_FLY_LINE`, `autoSwitchNote`, `flyTravelSentence`, `travelModeChangeReason`). |
| `src/lib/stores/pricing.ts` | Modify | `TravelRates` gains the 7 fly keys (optional in the type, present in the defaults); `ResolvedTravelRates`; `flyCrew` on flame/repair/inspection rates + defaults; Estimating Rules rows. |
| `src/lib/flametest-engine.ts` | Modify | `compute()` plans travel, prices `plan.total`, returns `trip` (+ `mode`/`flight`) and `travel`. |
| `src/lib/repair-engine.ts` | Modify | `computeEstimate(opts, C, travel?)` same; `crewSize` floors the flying crew. |
| `src/lib/inspection-engine.ts` | Modify | `computeEstimate(opts, C, travel?)` same. |
| `src/app/(app)/{flame-tests,repairs,inspections}/quote/actions.ts` | Modify | Parse the posted `travel` override, pass it + live travel rates to the engine, persist `trip: savedTrip(r.trip)` and `travel`. |
| `src/lib/renewal-outreach.ts` | Modify | Renewal re-pricing carries last year's override (minus airfare), persists the new trip shape, adds the mode-flip reason; the PDF letters print the fly line. |
| `src/components/travel-mode-panel.tsx` | **Create** | `"use client"` presentation: Auto · Drive · Fly switch, auto-switch note, crew / nights / airfare inputs, itemized flight rows. |
| `src/app/(app)/{flame-tests,repairs,inspections}/quote/controls.tsx` | Modify | Previews take live travel rates (road factor / mph / fly rates), run `planTravel`, render the panel, post the override. |
| `src/app/(app)/{flame-tests,repairs,inspections}/quote/page.tsx` | Modify | Load `getTravelRates()`, seed `initial.travel` from the saved subdoc. |
| `src/lib/templates.ts` | Modify | New `priceLineFly` field on `flame_proposal` and `inspection_proposal`. |
| `src/app/(app)/{flame-tests,inspections,repairs}/letter/page.tsx` | Modify | Fly mode prints the one travel line (scope row / paragraph) and the fly price line. |
| `scripts/test-review-and-spec.ts` | Modify | `#TRV` pure checks per spec §6 (one block per task). |
| `DECISIONS.md`, `PUNCHLIST.md` | Modify | Placeholder-numbered entries (`D-TRV-1…D-TRV-5`, `#TRV`) — renumbered by the controller at merge. |

---

### Task 1: Pure travel planner + rates + Estimating Rules rows

**Files:**
- Create: `src/lib/travel-plan.ts`
- Modify: `src/lib/stores/pricing.ts` (imports at line 1-2; rate types/defaults lines 34-134; `getTravelRates` lines 201-203; `GROUPS` flame/repair/inspection/travel groups lines 385-441)
- Test: `scripts/test-review-and-spec.ts` (new block above `seeded()`)

**Interfaces:**
- Consumes: nothing.
- Produces (all exported from `@/lib/travel-plan`):
  - `type TravelMode = "drive" | "fly"`; `type TravelModeChoice = "auto" | TravelMode`
  - `type FlyRates = { flyThreshold: number; airfarePerPerson: number; hotelPerNight: number; perDiemPerDay: number; carPerDay: number; flyTravelHoursEachWay: number; flyHoursPerDay: number }`
  - `const FLY_RATE_DEFAULTS: FlyRates`; `const FLY_CREW_DEFAULTS: { readonly flame: 1; readonly repair: 2; readonly inspection: 1 }`; `const TRAVEL_FLY_LINE = "Travel (air, lodging & per diem)"`
  - `type TravelOverride = { mode?: TravelModeChoice; crew?: number; nights?: number; airfarePerPerson?: number }`
  - `type FlightPlan = { crew; workDays; nights; tripDays; airfare; lodging; perDiem; car; travelHours; travelLabor; total }` (all `number`)
  - `type TravelPlan = { mode: TravelMode; autoMode: TravelMode; choice: TravelModeChoice; driveTotal: number; threshold: number; flight: FlightPlan | null; defaults: { crew: number; nights: number; airfarePerPerson: number }; total: number }`
  - `type TripMode = { mode: TravelMode; flight?: FlightPlan }`
  - `type PlanTravelInput = { drive: { total: number }; onSiteHours: number; laborRate: number; crewDefault: number; rates?: Partial<FlyRates> | null; override?: TravelOverride | null }`
  - `resolveFlyRates(rates?: Partial<FlyRates> | null): FlyRates`
  - `planTravel(input: PlanTravelInput): TravelPlan`
  - `withMode<T extends object>(drive: T, plan: TravelPlan): T & TripMode`
  - `normalizeTravelOverride(raw: unknown): TravelOverride | undefined` (drops `"auto"`; output only `"drive"|"fly"` modes)
  - `parseTravelOverride(json: unknown): TravelOverride | undefined` (a posted JSON string)
  - `carryTravelOverride(raw: unknown): TravelOverride | undefined` (normalize, then drop `airfarePerPerson`)
  - `type TravelDraft = { mode: TravelModeChoice; crew: string; nights: string; airfare: string }`; `draftFromOverride(o?: TravelOverride | null): TravelDraft`; `overrideFromDraft(d: TravelDraft): TravelOverride | undefined`
  - `type SavedTrip = { miles: number; minutes: number; mileageCost: number; timeCost: number; method: "route" | "estimate"; mode: TravelMode; flight?: FlightPlan }`; `savedTrip(t): SavedTrip`
  - `flightOf(trip: unknown): FlightPlan | null` (a saved trip → its flight, only when `mode === "fly"`)
  - `travelLineAmount(flightTotal: number, margin: number): number`
  - `fmtUsd(n: number): string`; `autoSwitchNote(driveTotal: number, threshold: number): string`; `flyTravelSentence(from: string, to: string, amount: number): string`; `travelModeChangeReason(prior: TravelMode, current: TravelMode): string | null`
  - From `@/lib/stores/pricing`: `type TravelRates = { roadFactor: number; mph: number } & Partial<FlyRates>`; `type ResolvedTravelRates = { roadFactor: number; mph: number } & FlyRates`; `TRAVEL_RATE_DEFAULTS: ResolvedTravelRates`; `getTravelRates(): Promise<ResolvedTravelRates>`; `FlametestRates.flyCrew`, `RepairRates.flyCrew`, `InspectionRates.flyCrew` (required `number` in the store types).

- [ ] **Step 1: Write the failing test**

Insert this block in `scripts/test-review-and-spec.ts` immediately above the line `seeded()` (the start of the `.then(...)` chain near the end of the file):

```ts
/* --- #TRV flights over drive — the pure planner, its rates and the Estimating
   Rules rows (spec docs/superpowers/specs/2026-09-25-travel-flights-design.md §3, §6) --- */
import {
  FLY_RATE_DEFAULTS,
  FLY_CREW_DEFAULTS,
  TRAVEL_FLY_LINE,
  planTravel,
  resolveFlyRates,
  normalizeTravelOverride,
  parseTravelOverride,
  carryTravelOverride,
  draftFromOverride,
  overrideFromDraft,
  savedTrip,
  flightOf,
  travelLineAmount,
  autoSwitchNote,
  flyTravelSentence,
  travelModeChangeReason,
} from "@/lib/travel-plan";
import {
  FLAMETEST_RATE_DEFAULTS,
  REPAIR_RATE_DEFAULTS,
  INSPECTION_RATE_DEFAULTS,
} from "@/lib/stores/pricing";
{
  const R = FLY_RATE_DEFAULTS;
  ok(
    R.flyThreshold === 1000 && R.airfarePerPerson === 450 && R.hotelPerNight === 140 &&
      R.perDiemPerDay === 70 && R.carPerDay === 75 && R.flyTravelHoursEachWay === 4 && R.flyHoursPerDay === 8,
    "#TRV: fly-rate defaults are exactly the spec table ($1,000 / $450 / $140 / $70 / $75 / 4 h / 8 h)"
  );
  ok(
    FLY_CREW_DEFAULTS.flame === 1 && FLY_CREW_DEFAULTS.repair === 2 && FLY_CREW_DEFAULTS.inspection === 1,
    "#TRV: default flying crew is flame 1 · repairs 2 · inspections 1"
  );
  ok(
    TRAVEL_RATE_DEFAULTS.roadFactor === 1.25 && TRAVEL_RATE_DEFAULTS.mph === 50 &&
      TRAVEL_RATE_DEFAULTS.flyThreshold === 1000 && TRAVEL_RATE_DEFAULTS.flyHoursPerDay === 8,
    "#TRV: the travel_rates defaults keep 1.25 / 50 and carry every fly key"
  );
  ok(
    FLAMETEST_RATE_DEFAULTS.flyCrew === 1 && REPAIR_RATE_DEFAULTS.flyCrew === 2 && INSPECTION_RATE_DEFAULTS.flyCrew === 1,
    "#TRV: each service's rates blob defaults carry its flyCrew"
  );
  ok(TRAVEL_FLY_LINE === "Travel (air, lodging & per diem)", "#TRV: the customer-facing line is exactly 'Travel (air, lodging & per diem)'");

  // threshold boundary (on-site 10 h, 1 person, $75/h)
  const base = { onSiteHours: 10, laborRate: 75, crewDefault: 1, rates: R };
  const p999 = planTravel({ ...base, drive: { total: 999.99 } });
  ok(p999.mode === "drive" && p999.flight === null && p999.total === 999.99, "#TRV: a $999.99 drive stays a drive, total untouched");
  const p1000 = planTravel({ ...base, drive: { total: 1000 } });
  ok(p1000.mode === "fly" && p1000.autoMode === "fly" && p1000.choice === "auto" && p1000.flight !== null, "#TRV: a $1,000 drive flies (≥ threshold)");
  const pNever = planTravel({ ...base, rates: { ...R, flyThreshold: 0 }, drive: { total: 50000 } });
  ok(pNever.mode === "drive" && pNever.total === 50000, "#TRV: threshold 0 never flies");

  // forced modes
  const forcedDrive = planTravel({ ...base, drive: { total: 5000 }, override: { mode: "drive" } });
  ok(forcedDrive.mode === "drive" && forcedDrive.autoMode === "fly" && forcedDrive.total === 5000 && forcedDrive.flight === null,
    "#TRV: forced Drive over the threshold prices the drive");
  const forcedFly = planTravel({ ...base, drive: { total: 100 }, override: { mode: "fly" } });
  ok(forcedFly.mode === "fly" && forcedFly.autoMode === "drive" && forcedFly.choice === "fly" && forcedFly.total === 1765,
    "#TRV: forced Fly under the threshold prices flights");

  // formulas: 10 h on site, crew 1, 8 h/day → 2 work days, 2 nights, 3 trip days
  const f = p1000.flight!;
  ok(f.crew === 1 && f.workDays === 2 && f.nights === 2 && f.tripDays === 3, "#TRV: workDays = ceil(10 / 8) = 2, nights = workDays, tripDays = nights + 1");
  ok(
    f.airfare === 450 && f.lodging === 280 && f.perDiem === 210 && f.car === 225 &&
      f.travelHours === 8 && f.travelLabor === 600 && f.total === 1765 && p1000.total === 1765,
    "#TRV: airfare 450 + lodging 280 + per diem 210 + car 225 + travel labor 600 = 1,765"
  );
  ok(p1000.defaults.crew === 1 && p1000.defaults.nights === 2 && p1000.defaults.airfarePerPerson === 450, "#TRV: the plan reports the defaults the builder shows as placeholders");

  // crew override 3 → 1 work day, 1 night, 2 trip days, ceil(3/2) = 2 cars
  const c3 = planTravel({ ...base, drive: { total: 2000 }, override: { crew: 3 } }).flight!;
  ok(
    c3.crew === 3 && c3.workDays === 1 && c3.nights === 1 && c3.tripDays === 2 && c3.airfare === 1350 &&
      c3.lodging === 420 && c3.perDiem === 420 && c3.car === 300 && c3.travelLabor === 1800 && c3.total === 4290,
    "#TRV: a crew override of 3 re-derives work days and prices 2 cars (4,290)"
  );
  const c2 = planTravel({ ...base, drive: { total: 2000 }, override: { crew: 2 } }).flight!;
  ok(c2.car === 150, "#TRV: 2 people share 1 car (ceil(2/2) × 2 days × $75)");

  // nights override 0 → a same-day fly-in
  const n0 = planTravel({ ...base, drive: { total: 2000 }, override: { nights: 0 } }).flight!;
  ok(n0.workDays === 2 && n0.nights === 0 && n0.tripDays === 1 && n0.lodging === 0 && n0.perDiem === 70 && n0.car === 75,
    "#TRV: a nights override replaces workDays; tripDays = nights + 1");

  // airfare override
  const air = planTravel({ ...base, drive: { total: 2000 }, override: { airfarePerPerson: 800 } }).flight!;
  ok(air.airfare === 800 && air.total === 1765 - 450 + 800, "#TRV: the manual airfare replaces the allowance");

  // travel labor uses the service's labor rate
  const lab = planTravel({ ...base, laborRate: 100, drive: { total: 2000 } }).flight!;
  ok(lab.travelLabor === 800, "#TRV: travel labor = crew × 4 h × 2 × the service's labor rate");

  // zero on-site hours still books one work day
  ok(planTravel({ ...base, onSiteHours: 0, drive: { total: 2000 } }).flight!.workDays === 1, "#TRV: zero on-site hours → 1 work day");

  // missing blob keys fall back to the defaults
  ok(JSON.stringify(resolveFlyRates(undefined)) === JSON.stringify(R), "#TRV: resolveFlyRates(undefined) = the defaults");
  const partialRates = resolveFlyRates({ hotelPerNight: 200 });
  ok(partialRates.hotelPerNight === 200 && partialRates.flyThreshold === 1000 && partialRates.carPerDay === 75,
    "#TRV: a stored blob with only some fly keys keeps the defaults for the rest");
  const pEmpty = planTravel({ ...base, rates: {}, drive: { total: 1000 } });
  ok(pEmpty.mode === "fly" && pEmpty.total === 1765, "#TRV: an existing travel_rates blob with no fly keys prices with the defaults");

  // override normalization / posting / drafts / carry-forward
  ok(normalizeTravelOverride({ mode: "auto" }) === undefined, "#TRV: mode 'auto' with nothing else is no override");
  ok(
    JSON.stringify(normalizeTravelOverride({ mode: "fly", crew: "2", nights: "", airfarePerPerson: "abc" })) === JSON.stringify({ mode: "fly", crew: 2 }),
    "#TRV: normalize keeps valid fields, coerces numeric strings, drops blanks and junk"
  );
  ok(normalizeTravelOverride({ crew: 0, nights: -1 }) === undefined && normalizeTravelOverride("junk") === undefined,
    "#TRV: crew < 1, negative nights and non-objects are rejected");
  ok(JSON.stringify(parseTravelOverride('{"mode":"drive","nights":3}')) === JSON.stringify({ mode: "drive", nights: 3 }) &&
      parseTravelOverride("{not json") === undefined && parseTravelOverride(null) === undefined,
    "#TRV: parseTravelOverride reads the posted JSON and tolerates garbage");
  const d = draftFromOverride({ mode: "fly", crew: 3 });
  ok(d.mode === "fly" && d.crew === "3" && d.nights === "" && d.airfare === "", "#TRV: draftFromOverride fills the builder inputs");
  ok(JSON.stringify(overrideFromDraft(d)) === JSON.stringify({ mode: "fly", crew: 3 }) && overrideFromDraft(draftFromOverride(undefined)) === undefined,
    "#TRV: overrideFromDraft round-trips; an untouched draft posts no override");
  ok(JSON.stringify(carryTravelOverride({ mode: "fly", crew: 3, airfarePerPerson: 900 })) === JSON.stringify({ mode: "fly", crew: 3 }) &&
      carryTravelOverride({ airfarePerPerson: 900 }) === undefined,
    "#TRV: a renewal carries last year's mode/crew/nights but never last year's airfare");

  // persisted trip + letters
  const st = savedTrip({ miles: 1000, minutes: 960, mileageCost: 1000.4, timeCost: 1199.6, method: "estimate", mode: "fly", flight: { ...f, airfare: 450.4 } });
  ok(st.mileageCost === 1000 && st.timeCost === 1200 && st.mode === "fly" && st.flight?.airfare === 450 && st.flight?.total === 1765,
    "#TRV: savedTrip rounds money like today's trip block and keeps mode + flight");
  const sd = savedTrip({ miles: 200, minutes: 240, mileageCost: 200, timeCost: 300, method: "route", mode: "drive" });
  ok(sd.mode === "drive" && !("flight" in sd), "#TRV: a drive-mode saved trip carries mode 'drive' and no flight");
  ok(flightOf(st)?.total === 1765 && flightOf({ miles: 10 }) === null && flightOf({ mode: "drive", flight: f }) === null && flightOf(null) === null,
    "#TRV: flightOf returns a flight only for a fly-mode saved trip");
  ok(travelLineAmount(1765, 0.3) === Math.round(1765 / (1 - 0.3)) && travelLineAmount(1765, 0) === 1765,
    "#TRV: the customer line is travel's share of the sell price (÷ (1 − margin)), rounded");
  ok(autoSwitchNote(2200, 1000) === "Drive would be $2,200 — over the $1,000 threshold, priced as flights.",
    "#TRV: the builder note reads exactly as spec §5");
  ok(
    flyTravelSentence("Peak Systems Group (Milwaukee)", "Lakefront Theatre", 2521) ===
      "Given the distance from Peak Systems Group (Milwaukee) to Lakefront Theatre, this visit is priced with air travel — Travel (air, lodging & per diem): $2,521.",
    "#TRV: the letter sentence names the one travel line and its amount"
  );
  ok(
    travelModeChangeReason("drive", "fly") === "travel now being priced as flights, lodging & per diem instead of a drive" &&
      travelModeChangeReason("fly", "drive") === "travel now being priced as a drive instead of flights" &&
      travelModeChangeReason("drive", "drive") === null && travelModeChangeReason("fly", "fly") === null,
    "#TRV: renewal 'why the price changed' wording on a mode flip, silence otherwise"
  );

  // Estimating Rules rows (the page renders GROUPS generically)
  const trvRows = (key: string): RateEntry[] =>
    PRICING_GROUPS.find((g) => g.key === key)!.items.filter((it): it is RateEntry => it.kind === "rate");
  const flyKeys = ["flyThreshold", "airfarePerPerson", "hotelPerNight", "perDiemPerDay", "carPerDay", "flyTravelHoursEachWay", "flyHoursPerDay"] as const;
  ok(
    flyKeys.every((k) => {
      const row = trvRows("travel").find((it) => it.id === "travel." + k);
      return !!row && row.store === "travel" && row.key === k && row.ref === false && row.def === FLY_RATE_DEFAULTS[k];
    }),
    "#TRV: Estimating Rules → Travel & mileage exposes all seven flight rates, live, keyed into travel_rates"
  );
  const crewRow = (g: string) => trvRows(g).find((it) => it.id === g + ".flyCrew");
  ok(
    crewRow("flame")?.store === "flame" && crewRow("flame")?.key === "flyCrew" && crewRow("flame")?.def === 1 &&
      crewRow("repair")?.store === "repair" && crewRow("repair")?.def === 2 &&
      crewRow("inspection")?.store === "inspection" && crewRow("inspection")?.def === 1,
    "#TRV: each service group exposes its default flying crew"
  );

  const trvSrc = readFileSync(join(process.cwd(), "src/lib/travel-plan.ts"), "utf8");
  ok(!/^\s*import\s/m.test(trvSrc), "#TRV: travel-plan.ts imports nothing — safe for the 'use client' builder previews");
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:specs 2>&1 | tail -15`
Expected: the harness dies on load with `Cannot find module '@/lib/travel-plan'` (or `ERR_MODULE_NOT_FOUND`) — no `ALL PASSED`.

- [ ] **Step 3: Create `src/lib/travel-plan.ts`**

```ts
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
```

- [ ] **Step 4: Wire the rates into `src/lib/stores/pricing.ts`**

4a. Imports — replace

```ts
import { getBlob, setBlob } from "@/db/doc-store";
import { FIXTURE_RATE_DEFAULTS, type FixtureRates } from "@/lib/fixture-rates";
```

with

```ts
import { getBlob, setBlob } from "@/db/doc-store";
import { FIXTURE_RATE_DEFAULTS, type FixtureRates } from "@/lib/fixture-rates";
import { FLY_CREW_DEFAULTS, FLY_RATE_DEFAULTS, type FlyRates } from "@/lib/travel-plan";
```

4b. `FlametestRates` — replace

```ts
  /** round total travel time up to the nearest N minutes */
  travelRoundMin: number;
};

/** flametest.js DEFAULTS — seed/fallback for blob `flametest_rates`. */
export const FLAMETEST_RATE_DEFAULTS: FlametestRates = {
  mileageRate: 1,
  laborRate: 75,
  curtainMinutes: 5,
  baseFee: 150,
  margin: 0.30,
  travelRoundMin: 15,
};
```

with

```ts
  /** round total travel time up to the nearest N minutes */
  travelRoundMin: number;
  /** default crew when the trip is priced as flights (travel-plan.ts) */
  flyCrew: number;
};

/** flametest.js DEFAULTS — seed/fallback for blob `flametest_rates`. */
export const FLAMETEST_RATE_DEFAULTS: FlametestRates = {
  mileageRate: 1,
  laborRate: 75,
  curtainMinutes: 5,
  baseFee: 150,
  margin: 0.30,
  travelRoundMin: 15,
  flyCrew: FLY_CREW_DEFAULTS.flame,
};
```

4c. `RepairRates` — replace

```ts
  /** round total travel time up to the nearest N minutes */
  travelRoundMin: number;
};

/** repair.js DEFAULTS — seed/fallback for blob `repair_rates`. */
export const REPAIR_RATE_DEFAULTS: RepairRates = {
  laborRate: 75,
  mileageRate: 1,
  minCallout: 350,
  partsMargin: 0.30,
  margin: 0.30,
  emergencyMult: 1.5,
  travelRoundMin: 15,
};
```

with

```ts
  /** round total travel time up to the nearest N minutes */
  travelRoundMin: number;
  /** default crew when the trip is priced as flights (travel-plan.ts) */
  flyCrew: number;
};

/** repair.js DEFAULTS — seed/fallback for blob `repair_rates`. */
export const REPAIR_RATE_DEFAULTS: RepairRates = {
  laborRate: 75,
  mileageRate: 1,
  minCallout: 350,
  partsMargin: 0.30,
  margin: 0.30,
  emergencyMult: 1.5,
  travelRoundMin: 15,
  flyCrew: FLY_CREW_DEFAULTS.repair,
};
```

4d. `InspectionRates` — replace

```ts
  /** round total travel time up to the nearest N minutes */
  travelRoundMin: number;
};

/** Inspection estimating defaults — seed/fallback for blob `inspection_rates`.
```

with

```ts
  /** round total travel time up to the nearest N minutes */
  travelRoundMin: number;
  /** default crew when the trip is priced as flights (travel-plan.ts) */
  flyCrew: number;
};

/** Inspection estimating defaults — seed/fallback for blob `inspection_rates`.
```

and replace

```ts
  minFee: 650,
  margin: 0.30,
  travelRoundMin: 15,
};
```

with

```ts
  minFee: 650,
  margin: 0.30,
  travelRoundMin: 15,
  flyCrew: FLY_CREW_DEFAULTS.inspection,
};
```

4e. `TravelRates` — replace

```ts
export type TravelRates = {
  /** Straight-line → on-road distance fudge (offline fallback only). */
  roadFactor: number;
  /** Assumed average door-to-door driving speed, mph (offline fallback only). */
  mph: number;
};
```

with

```ts
export type TravelRates = {
  /** Straight-line → on-road distance fudge (offline fallback only). */
  roadFactor: number;
  /** Assumed average door-to-door driving speed, mph (offline fallback only). */
  mph: number;
} & Partial<FlyRates>;

/** A resolved `travel_rates` blob — getBlob() merges every default under the
 *  stored patch, so the fly keys are always present at runtime. The fly keys
 *  are optional on TravelRates only so drive-only callers (geo.ts, tests)
 *  keep passing `{ roadFactor, mph }`; travel-plan.ts resolves any gap. */
export type ResolvedTravelRates = { roadFactor: number; mph: number } & FlyRates;
```

and replace

```ts
export const TRAVEL_RATE_DEFAULTS: TravelRates = {
  roadFactor: 1.25,
  mph: 50,
};
```

with

```ts
export const TRAVEL_RATE_DEFAULTS: ResolvedTravelRates = {
  roadFactor: 1.25,
  mph: 50,
  ...FLY_RATE_DEFAULTS,
};
```

4f. `getTravelRates` — replace

```ts
export async function getTravelRates(): Promise<TravelRates> {
  return getBlob(TRAVEL_RATES_BLOB, { ...TRAVEL_RATE_DEFAULTS });
}
```

with

```ts
export async function getTravelRates(): Promise<ResolvedTravelRates> {
  return getBlob(TRAVEL_RATES_BLOB, { ...TRAVEL_RATE_DEFAULTS });
}
```

4g. Estimating Rules rows. In the `flame` group, replace

```ts
      rate("travelRoundMin", "Round travel time up to", 15, "min", { min: 1, max: 60, step: 1, store: "flame" }),
```

with

```ts
      rate("travelRoundMin", "Round travel time up to", 15, "min", { min: 1, max: 60, step: 1, store: "flame" }),
      rate("flame.flyCrew", "Crew when the trip flies", 1, "people", { min: 1, max: 10, step: 1, store: "flame", key: "flyCrew", help: "Default crew for a flame test priced as flights (Travel & mileage → fly threshold). Overridable on each quote." }),
```

In the `repair` group, replace

```ts
      rate("repair.travelRoundMin", "Round travel time up to", 15, "min", { min: 1, max: 60, step: 1, store: "repair", key: "travelRoundMin" }),
```

with

```ts
      rate("repair.travelRoundMin", "Round travel time up to", 15, "min", { min: 1, max: 60, step: 1, store: "repair", key: "travelRoundMin" }),
      rate("repair.flyCrew", "Crew when the trip flies", 2, "people", { min: 1, max: 10, step: 1, store: "repair", key: "flyCrew", help: "Default crew for a repair priced as flights — never fewer than the quote's own crew size. Overridable on each quote." }),
```

In the `inspection` group, replace

```ts
      rate("inspection.travelRoundMin", "Round travel time up to", 15, "min", { min: 1, max: 60, step: 1, store: "inspection", key: "travelRoundMin" }),
```

with

```ts
      rate("inspection.travelRoundMin", "Round travel time up to", 15, "min", { min: 1, max: 60, step: 1, store: "inspection", key: "travelRoundMin" }),
      rate("inspection.flyCrew", "Crew when the trip flies", 1, "people", { min: 1, max: 10, step: 1, store: "inspection", key: "flyCrew", help: "Default crew for an inspection priced as flights. Overridable on each quote." }),
```

Replace the whole `travel` group object

```ts
  {
    key: "travel", label: "Travel & mileage", live: true,
    sub: "Distance / drive-time estimate (feeds flame-test + any travel line)",
    note: "Live — feeds the flame-test travel estimate's offline fallback. Live road routing (OSRM) still overrides these when a cached/live route is available; these are only used for the straight-line fallback.",
    items: [
      rate("travel.roadFactor", "Straight-line → road factor", 1.25, "×", { min: 1, max: 2, step: 0.05, store: "travel", key: "roadFactor", help: "Bumps as-the-crow-flies distance up to road distance." }),
      rate("travel.mph", "Assumed average speed", 50, "mph", { min: 20, max: 75, step: 1, store: "travel", key: "mph" }),
      formula("travel.miles", "Estimated road miles", "miles = straightLineMiles × roadFactor"),
      formula("travel.time", "Estimated drive time", "minutes = (miles ÷ mph) × 60"),
    ],
  },
```

with

```ts
  {
    key: "travel", label: "Travel & mileage", live: true,
    sub: "Drive estimate + flights over drive (flame-test, repair and inspection quotes)",
    note: "Live — road factor and speed feed the offline drive fallback (live OSRM routing still overrides them when a cached/live route is available). The flight rates price any flame-test, repair or inspection trip whose drive cost (mileage + drive time) reaches the threshold; 0 = never fly. Each service's default flying crew lives in its own group above.",
    items: [
      rate("travel.roadFactor", "Straight-line → road factor", 1.25, "×", { min: 1, max: 2, step: 0.05, store: "travel", key: "roadFactor", help: "Bumps as-the-crow-flies distance up to road distance." }),
      rate("travel.mph", "Assumed average speed", 50, "mph", { min: 20, max: 75, step: 1, store: "travel", key: "mph" }),
      rate("travel.flyThreshold", "Fly when one trip's drive cost reaches", 1000, "$", { min: 0, max: 20000, step: 50, store: "travel", key: "flyThreshold", help: "One trip's drive cost (mileage + drive-time labor) at or over this prices the trip as flights. 0 = never fly." }),
      rate("travel.airfarePerPerson", "Airfare allowance (round trip, per person)", 450, "$", { min: 0, max: 5000, step: 10, store: "travel", key: "airfarePerPerson", help: "The default — each quote can enter its own airfare." }),
      rate("travel.hotelPerNight", "Hotel (per room per night)", 140, "$", { min: 0, max: 1000, step: 5, store: "travel", key: "hotelPerNight", help: "One room per person." }),
      rate("travel.perDiemPerDay", "Per diem (per person per day)", 70, "$", { min: 0, max: 500, step: 5, store: "travel", key: "perDiemPerDay" }),
      rate("travel.carPerDay", "Rental car (per car per day, 1 car per 2 people)", 75, "$", { min: 0, max: 500, step: 5, store: "travel", key: "carPerDay" }),
      rate("travel.flyTravelHoursEachWay", "Travel-day labor (hours each way, per person)", 4, "hr", { min: 0, max: 24, step: 0.5, store: "travel", key: "flyTravelHoursEachWay", help: "Billed at the service's own labor rate." }),
      rate("travel.flyHoursPerDay", "On-site hours per person per day", 8, "hr", { min: 1, max: 24, step: 0.5, store: "travel", key: "flyHoursPerDay", help: "Sets the nights: work days = on-site hours ÷ (crew × this), rounded up." }),
      formula("travel.miles", "Estimated road miles", "miles = straightLineMiles × roadFactor"),
      formula("travel.time", "Estimated drive time", "minutes = (miles ÷ mph) × 60"),
      formula("travel.fly", "Flights (drive cost ≥ threshold)", "nights = ⌈on-site hrs ÷ (crew × hrs/day)⌉  ·  airfare = crew × allowance  ·  lodging = crew × nights × hotel  ·  per diem = crew × (nights + 1) × per diem  ·  car = ⌈crew ÷ 2⌉ × (nights + 1) × car  ·  travel labor = crew × hrs each way × 2 × labor rate"),
    ],
  },
```

- [ ] **Step 5: Run the tests and type-check**

Run: `npx tsc --noEmit; echo "tsc exit $?"`
Expected: `tsc exit 0` (geo.ts, flametest-engine.ts, customers.ts and travel-bulk.ts keep compiling — `TravelRates` only gained optional keys and `ResolvedTravelRates` is assignable to it).

Run: `npm run test:specs 2>&1 | grep -E "#TRV|#60-67|FAIL|ALL PASSED" | tail -60`
Expected: every `#TRV` and `#60-67` line starts with `PASS`; the last line is `ALL PASSED`.

Run: `npx eslint 2>&1 | tail -3`
Expected: `0 errors`, warnings ≤ the baseline recorded at setup.

- [ ] **Step 6: Commit**

```bash
git add src/lib/travel-plan.ts src/lib/stores/pricing.ts scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(travel): pure flights-over-drive planner + fly rates in Estimating Rules

travel-plan.ts (import-free, client-safe) owns the spec rule: one trip's
drive cost >= flyThreshold prices flights, lodging, per diem, a car and
travel-day labor; drive mode returns the drive total untouched. Fly rates
join travel_rates, default crew joins each service's rates blob.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: The three engines price `plan.total`

**Files:**
- Modify: `src/lib/flametest-engine.ts` (imports lines 1-7; header comment ~14-30; `FlameTestRates` 48-61; `FlameTestComputeOpts` 171-174; `FlameTestPricing` 176-194; `compute` 291-330)
- Modify: `src/lib/repair-engine.ts` (imports 1-2; `RepairRates` 31-39; `RepairEstimateOptions` 191-199; `RepairEstimate` 201-221; `computeEstimate` 224-277; `compute` 280-284)
- Modify: `src/lib/inspection-engine.ts` (imports 1-8; `InspectionRates` 31-40; `InspectionEstimateOptions` 70-77; `InspectionEstimate` 79-97; `computeEstimate` 100-143; `compute` 146-150)
- Test: `scripts/test-review-and-spec.ts` (new block above `seeded()`)

**Interfaces:**
- Consumes (Task 1): `planTravel`, `withMode`, `FLY_CREW_DEFAULTS`, `type FlyRates`, `type TravelOverride`, `type TravelPlan`, `type TripMode` from `@/lib/travel-plan`; `getTravelRates` from `@/lib/stores/pricing`.
- Produces:
  - Flame: `FlameTestComputeOpts.travel?: TravelOverride | null`; `FlameTestRates.flyCrew?: number`; `FlameTestPricing.trip: TripTravel & TripMode`; `FlameTestPricing.travel: TravelPlan`; `compute(opts, rates, travel: TravelRates = TRAVEL_RATE_DEFAULTS)` unchanged signature; `rawCost = travel.total + testingSubtotal`.
  - Repair: `RepairRates.flyCrew?: number`; `RepairEstimateOptions.crewSize?: number | string | null`, `.travel?: TravelOverride | null`; `RepairEstimate.trip: TripTravel & TripMode`, `.travel: TravelPlan`; `computeEstimate(opts, C, travel?: Partial<FlyRates> | null)`; `serviceCost = laborCost + travel.total`.
  - Inspection: `InspectionRates.flyCrew?: number`; `InspectionEstimateOptions.travel?: TravelOverride | null`; `InspectionEstimate.trip: TripTravel & TripMode`, `.travel: TravelPlan`; `computeEstimate(opts, C, travel?: Partial<FlyRates> | null)`; `cost = laborCost + travel.total`.
  - `trip.total` everywhere STAYS the drive cost; the priced travel figure is `.travel.total`.

- [ ] **Step 1: Write the failing test**

Insert above the line `seeded()`:

```ts
/* --- #TRV engines: drive mode unchanged vs before (hard-coded pre-change
   figures), fly mode equals the hand-computed spec formula. All fixtures use
   the no-coords estimate branch (trip = one-way × 2) so every number is exact. --- */
import { computeEstimate as trvRepairEstimate } from "@/lib/repair-engine";
import { computeEstimate as trvInspectionEstimate } from "@/lib/inspection-engine";
{
  const near = (a: number | undefined, b: number): boolean => a != null && Math.abs(a - b) < 1e-6;

  // ---- flame (1 person) ----
  const flameRates = { mileageRate: 1, laborRate: 75, curtainMinutes: 5, baseFee: 150, margin: 0.3, travelRoundMin: 15 };
  const flameNear: FTVenue = { id: "trv-near", label: "Near", curtains: 12, oneWayMiles: 100, oneWayMin: 120 };
  const flameFar: FTVenue = { id: "trv-far", label: "Far", curtains: 120, oneWayMiles: 500, oneWayMin: 480 };
  const fd = computeFlameQuote({ venues: [flameNear] }, flameRates);
  ok(fd.trip.total === 500 && fd.testingSubtotal === 75 && fd.rawCost === 575 && near(fd.total, 575 / (1 - 0.3)),
    "#TRV flame: a $500 drive prices exactly as before (575 cost → 821.43)");
  ok(fd.trip.mode === "drive" && !("flight" in fd.trip) && fd.travel?.total === fd.trip.total && fd.rawCost === fd.trip.total + fd.testingSubtotal,
    "#TRV flame: drive mode prices trip.total itself (bit-for-bit)");
  const ff = computeFlameQuote({ venues: [flameFar] }, flameRates);
  ok(ff.trip.total === 2200 && ff.trip.mode === "fly" && ff.travel?.total === 1765 && ff.rawCost === 2515 && near(ff.total, 2515 / (1 - 0.3)),
    "#TRV flame: a $2,200 drive flies — 1,765 travel + 750 testing = 2,515 cost");
  ok(ff.trip.flight?.crew === 1 && ff.trip.flight?.nights === 2 && ff.trip.flight?.tripDays === 3,
    "#TRV flame: 10 on-site hours (120 curtains × 5 min) → 2 nights for 1 person");
  const ffDrive = computeFlameQuote({ venues: [flameFar], travel: { mode: "drive" } }, flameRates);
  ok(ffDrive.trip.mode === "drive" && ffDrive.rawCost === 2950, "#TRV flame: forced Drive over the threshold prices the 2,200 drive");
  const fdFly = computeFlameQuote({ venues: [flameNear], travel: { mode: "fly" } }, flameRates);
  ok(fdFly.trip.mode === "fly" && fdFly.travel?.total === 1480 && fdFly.rawCost === 1555, "#TRV flame: forced Fly under the threshold (1 night) = 1,480 travel");
  const ffCrew2 = computeFlameQuote({ venues: [flameFar] }, { ...flameRates, flyCrew: 2 });
  ok(ffCrew2.travel?.total === 2810, "#TRV flame: flame_rates.flyCrew 2 flies two people (1 night) = 2,810");

  // ---- repair (default crew 2) ----
  const repairRates = { laborRate: 75, mileageRate: 1, minCallout: 350, partsMargin: 0.3, margin: 0.3, emergencyMult: 1.5, travelRoundMin: 15 };
  const rd = trvRepairEstimate({ venues: [{ label: "Near", oneWayMiles: 60, oneWayMin: 70 }], laborHours: 4 }, repairRates);
  ok(rd.trip.total === 307.5 && rd.serviceCost === 607.5 && near(rd.total, 607.5 / (1 - 0.3)) && rd.trip.mode === "drive",
    "#TRV repair: a $307.50 drive prices exactly as before (607.50 service cost)");
  const rf = trvRepairEstimate({ venues: [{ label: "Far", oneWayMiles: 500, oneWayMin: 480 }], laborHours: 24 }, repairRates);
  ok(rf.trip.mode === "fly" && rf.trip.flight?.crew === 2 && rf.travel?.total === 3305 && rf.serviceCost === 5105 && near(rf.total, 5105 / (1 - 0.3)),
    "#TRV repair: 24 crew-hours far away fly 2 people — 3,305 travel + 1,800 labor");
  const rf3 = trvRepairEstimate({ venues: [{ label: "Far", oneWayMiles: 500, oneWayMin: 480 }], laborHours: 24, crewSize: 3 }, repairRates);
  ok(rf3.trip.flight?.crew === 3 && rf3.travel?.total === 4290, "#TRV repair: a crew of 3 on the quote flies 3 (never fewer than the priced crew)");
  const rfe = trvRepairEstimate({ venues: [{ label: "Far", oneWayMiles: 500, oneWayMin: 480 }], laborHours: 24, emergency: true }, repairRates);
  ok(rfe.laborCost === 2700 && rfe.trip.flight?.travelLabor === 1200, "#TRV repair: emergency multiplies on-site labor only — travel labor stays at the base $75");
  const rfOverride = trvRepairEstimate({ venues: [{ label: "Far", oneWayMiles: 500, oneWayMin: 480 }], laborHours: 24, travel: { mode: "drive" } }, repairRates);
  ok(rfOverride.trip.mode === "drive" && rfOverride.serviceCost === 1800 + 2200, "#TRV repair: forced Drive keeps the drive");

  // ---- inspection (1 person) ----
  const inspRates = { laborRate: 75, mileageRate: 1, lineSetMinutes: 15, baseHours: 2, level2Mult: 1.75, minFee: 650, margin: 0.3, travelRoundMin: 15 };
  const idr = trvInspectionEstimate({ venues: [{ id: "trv-i1", label: "Near", lineSets: 20, oneWayMiles: 60, oneWayMin: 70 }] }, inspRates);
  ok(idr.trip.total === 307.5 && idr.cost === 832.5 && near(idr.total, 832.5 / (1 - 0.3)) && idr.trip.mode === "drive",
    "#TRV inspection: a $307.50 drive prices exactly as before (832.50 cost)");
  const ifl = trvInspectionEstimate({ venues: [{ id: "trv-i2", label: "Far", lineSets: 40, oneWayMiles: 500, oneWayMin: 480 }] }, inspRates);
  ok(ifl.inspectHours === 12 && ifl.trip.mode === "fly" && ifl.travel?.total === 1765 && ifl.cost === 2665 && near(ifl.total, 2665 / (1 - 0.3)),
    "#TRV inspection: 12 inspection hours far away fly 1 person — 1,765 travel + 900 labor");
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:specs 2>&1 | grep -E "#TRV (flame|repair|inspection)" | head -20`
Expected: the drive-fixture lines that check only old fields may already `PASS`; every line that checks `trip.mode`, `travel`, `flight` or a fly total prints `FAIL`.

- [ ] **Step 3: Flame engine**

3a. Replace the import block

```ts
import { getBlob, setBlob } from "@/db/doc-store";
import {
  FLAMETEST_RATE_DEFAULTS,
  TRAVEL_RATE_DEFAULTS,
  getTravelRates,
  type TravelRates,
} from "@/lib/stores/pricing";
```

with

```ts
import { getBlob, setBlob } from "@/db/doc-store";
import {
  FLAMETEST_RATE_DEFAULTS,
  TRAVEL_RATE_DEFAULTS,
  getTravelRates,
  type TravelRates,
} from "@/lib/stores/pricing";
import {
  FLY_CREW_DEFAULTS,
  planTravel,
  withMode,
  type TravelOverride,
  type TravelPlan,
  type TripMode,
} from "@/lib/travel-plan";
```

3b. In the header comment, replace

```ts
 *   4. Margin — flat 30-point margin of the sell price on top:
 *        total = cost / (1 - margin)   (when 0 < margin < 1)
```

with

```ts
 *   4. Margin — flat 30-point margin of the sell price on top:
 *        total = cost / (1 - margin)   (when 0 < margin < 1)
 *   5. Flights over drive (spec 2026-09-25, src/lib/travel-plan.ts) — when
 *      the trip's drive cost reaches the travel_rates threshold (or the quote
 *      forces Fly) travel prices as flights; the base fee and margin then
 *      apply to that figure exactly as they do to the drive. Drive mode is
 *      unchanged.
```

3c. In `FlameTestRates`, replace

```ts
  /** Round total travel time up to the nearest N minutes. */
  travelRoundMin: number;
};

const RATES_BLOB_ID = "flametest_rates";
```

with

```ts
  /** Round total travel time up to the nearest N minutes. */
  travelRoundMin: number;
  /** Default crew when the trip flies (FLY_CREW_DEFAULTS.flame when absent). */
  flyCrew?: number;
};

const RATES_BLOB_ID = "flametest_rates";
```

3d. Replace

```ts
export type FlameTestComputeOpts = {
  office?: FlameTestOffice | null;
  venues?: FlameTestVenueInput[];
};
```

with

```ts
export type FlameTestComputeOpts = {
  office?: FlameTestOffice | null;
  venues?: FlameTestVenueInput[];
  /** Per-quote travel override (Auto · Drive · Fly, crew, nights, airfare). */
  travel?: TravelOverride | null;
};
```

3e. In `FlameTestPricing`, replace

```ts
  venueCount: number;
  trip: TripTravel;
  /** trip.total + testingSubtotal, before the base-fee floor. */
  rawCost: number;
```

with

```ts
  venueCount: number;
  /** The drive numbers (trip.total is always the DRIVE cost) + mode/flight. */
  trip: TripTravel & TripMode;
  /** The travel plan — travel.total is the figure the quote prices. */
  travel: TravelPlan;
  /** travel.total + testingSubtotal, before the base-fee floor. */
  rawCost: number;
```

3f. In `compute`, replace

```ts
  const trip = tripTravel(opts.office, venues, C, travel);
  // Base $150 is a floor on the WHOLE job cost (mileage + travel + testing),
  // not a per-venue charge. Margin is applied on top of the floored cost.
  const rawCost = trip.total + testingSubtotal;
```

with

```ts
  const drive = tripTravel(opts.office, venues, C, travel);
  // Flights over drive: in drive mode plan.total IS drive.total (bit-for-bit).
  const plan = planTravel({
    drive,
    onSiteHours: (curtainsTotal * C.curtainMinutes) / 60,
    laborRate: C.laborRate,
    crewDefault: C.flyCrew ?? FLY_CREW_DEFAULTS.flame,
    rates: travel,
    override: opts.travel,
  });
  const trip = withMode(drive, plan);
  // Base $150 is a floor on the WHOLE job cost (mileage + travel + testing),
  // not a per-venue charge. Margin is applied on top of the floored cost.
  const rawCost = plan.total + testingSubtotal;
```

and in its return object replace

```ts
    venueCount: venues.length,
    trip,
    rawCost,
```

with

```ts
    venueCount: venues.length,
    trip,
    travel: plan,
    rawCost,
```

- [ ] **Step 4: Repair engine**

4a. Replace

```ts
import { getBlob, setBlob } from "@/db/doc-store";
import { REPAIR_RATE_DEFAULTS } from "@/lib/stores/pricing";
```

with

```ts
import { getBlob, setBlob } from "@/db/doc-store";
import { REPAIR_RATE_DEFAULTS, getTravelRates } from "@/lib/stores/pricing";
import {
  FLY_CREW_DEFAULTS,
  planTravel,
  withMode,
  type FlyRates,
  type TravelOverride,
  type TravelPlan,
  type TripMode,
} from "@/lib/travel-plan";
```

4b. In the header comment replace

```ts
 *   5. Total = serviceSell + partsSell.
```

with

```ts
 *   5. Total = serviceSell + partsSell.
 *   6. Flights over drive (spec 2026-09-25, src/lib/travel-plan.ts) — a trip
 *      whose drive cost reaches the threshold prices as flights for at least
 *      the quote's crew (default repair_rates.flyCrew); travel-day labor bills
 *      at the base labor rate, like drive time. Drive mode is unchanged.
```

4c. Replace

```ts
  travelRoundMin: number; // round total travel time up to the nearest N minutes
};

const RATES_BLOB_ID = "repair_rates"; // rss_repair_rates_v1
```

with

```ts
  travelRoundMin: number; // round total travel time up to the nearest N minutes
  flyCrew?: number; // default crew when the trip flies (FLY_CREW_DEFAULTS.repair when absent)
};

const RATES_BLOB_ID = "repair_rates"; // rss_repair_rates_v1
```

4d. Replace

```ts
  emergency?: boolean;
  /** Optional routing service (prototype's window.Geo). */
  geo?: GeoAdapter | null;
};

export type RepairEstimate = {
```

with

```ts
  emergency?: boolean;
  /** Crew on the job (laborHours is already crew-hours) — the flying crew is never smaller. */
  crewSize?: number | string | null;
  /** Per-quote travel override (Auto · Drive · Fly, crew, nights, airfare). */
  travel?: TravelOverride | null;
  /** Optional routing service (prototype's window.Geo). */
  geo?: GeoAdapter | null;
};

export type RepairEstimate = {
```

4e. In `RepairEstimate`, replace

```ts
  emergency: boolean;
  trip: TripTravel;
  serviceCost: number;
```

with

```ts
  emergency: boolean;
  /** The drive numbers (trip.total is always the DRIVE cost) + mode/flight. */
  trip: TripTravel & TripMode;
  /** The travel plan — travel.total is the figure the quote prices. */
  travel: TravelPlan;
  serviceCost: number;
```

4f. Replace

```ts
export function computeEstimate(
  opts: RepairEstimateOptions,
  C: RepairRates
): RepairEstimate {
  const venues = (opts.venues || []).slice();

  const laborHours = Math.max(0, Number(opts.laborHours) || 0);
  const laborRate = C.laborRate * (opts.emergency ? C.emergencyMult || 1 : 1);
  const laborCost = laborHours * laborRate;

  const trip = tripTravel(opts.office, venues, C, opts.geo);
  const serviceCost = laborCost + trip.total;
```

with

```ts
export function computeEstimate(
  opts: RepairEstimateOptions,
  C: RepairRates,
  travel?: Partial<FlyRates> | null
): RepairEstimate {
  const venues = (opts.venues || []).slice();

  const laborHours = Math.max(0, Number(opts.laborHours) || 0);
  const laborRate = C.laborRate * (opts.emergency ? C.emergencyMult || 1 : 1);
  const laborCost = laborHours * laborRate;

  const drive = tripTravel(opts.office, venues, C, opts.geo);
  const crew = Math.max(1, Math.round(Number(opts.crewSize) || 1));
  // Flights over drive: in drive mode plan.total IS drive.total (bit-for-bit).
  const plan = planTravel({
    drive,
    onSiteHours: laborHours,
    laborRate: C.laborRate,
    crewDefault: Math.max(C.flyCrew ?? FLY_CREW_DEFAULTS.repair, crew),
    rates: travel,
    override: opts.travel,
  });
  const trip = withMode(drive, plan);
  const serviceCost = laborCost + plan.total;
```

and in its return object replace

```ts
    emergency: !!opts.emergency,
    trip,
    serviceCost,
```

with

```ts
    emergency: !!opts.emergency,
    trip,
    travel: plan,
    serviceCost,
```

4g. Replace

```ts
  return computeEstimate(opts, await getRates());
}
```

with

```ts
  return computeEstimate(opts, await getRates(), await getTravelRates());
}
```

(This line appears once in `repair-engine.ts`.)

- [ ] **Step 5: Inspection engine**

5a. Replace

```ts
import { getBlob, setBlob } from "@/db/doc-store";
import { INSPECTION_RATE_DEFAULTS } from "@/lib/stores/pricing";
import {
  tripTravel,
  type GeoAdapter,
  type TripTravel,
  type TripVenueInput,
} from "@/lib/repair-engine";
```

with

```ts
import { getBlob, setBlob } from "@/db/doc-store";
import { INSPECTION_RATE_DEFAULTS, getTravelRates } from "@/lib/stores/pricing";
import {
  tripTravel,
  type GeoAdapter,
  type TripTravel,
  type TripVenueInput,
} from "@/lib/repair-engine";
import {
  FLY_CREW_DEFAULTS,
  planTravel,
  withMode,
  type FlyRates,
  type TravelOverride,
  type TravelPlan,
  type TripMode,
} from "@/lib/travel-plan";
```

5b. Header comment — replace

```ts
 *   4. Total = (labor + travel) ÷ (1 − margin), floored at the minimum fee.
```

with

```ts
 *   4. Total = (labor + travel) ÷ (1 − margin), floored at the minimum fee.
 *   5. Flights over drive (spec 2026-09-25, src/lib/travel-plan.ts) — a trip
 *      whose drive cost reaches the threshold prices as flights (default crew
 *      inspection_rates.flyCrew, nights from the inspection hours). Drive
 *      mode is unchanged.
```

5c. Replace

```ts
  travelRoundMin: number; // round total travel time up to the nearest N minutes
};

const RATES_BLOB_ID = "inspection_rates"; // rss_inspection_rates_v1
```

with

```ts
  travelRoundMin: number; // round total travel time up to the nearest N minutes
  flyCrew?: number; // default crew when the trip flies (FLY_CREW_DEFAULTS.inspection when absent)
};

const RATES_BLOB_ID = "inspection_rates"; // rss_inspection_rates_v1
```

5d. Replace

```ts
  level?: number;
  /** Optional routing service (prototype's window.Geo). */
  geo?: GeoAdapter | null;
};
```

with

```ts
  level?: number;
  /** Per-quote travel override (Auto · Drive · Fly, crew, nights, airfare). */
  travel?: TravelOverride | null;
  /** Optional routing service (prototype's window.Geo). */
  geo?: GeoAdapter | null;
};
```

5e. In `InspectionEstimate`, replace

```ts
  laborCost: number;
  trip: TripTravel;
  cost: number;
```

with

```ts
  laborCost: number;
  /** The drive numbers (trip.total is always the DRIVE cost) + mode/flight. */
  trip: TripTravel & TripMode;
  /** The travel plan — travel.total is the figure the quote prices. */
  travel: TravelPlan;
  cost: number;
```

5f. Replace

```ts
export function computeEstimate(
  opts: InspectionEstimateOptions,
  C: InspectionRates
): InspectionEstimate {
```

with

```ts
export function computeEstimate(
  opts: InspectionEstimateOptions,
  C: InspectionRates,
  travel?: Partial<FlyRates> | null
): InspectionEstimate {
```

and replace

```ts
  const trip = tripTravel(opts.office, venues, C, opts.geo);
  const cost = laborCost + trip.total;
```

with

```ts
  const drive = tripTravel(opts.office, venues, C, opts.geo);
  // Flights over drive: in drive mode plan.total IS drive.total (bit-for-bit).
  const plan = planTravel({
    drive,
    onSiteHours: inspectHours,
    laborRate: C.laborRate,
    crewDefault: C.flyCrew ?? FLY_CREW_DEFAULTS.inspection,
    rates: travel,
    override: opts.travel,
  });
  const trip = withMode(drive, plan);
  const cost = laborCost + plan.total;
```

and in its return object replace

```ts
    laborCost,
    trip,
    cost,
```

with

```ts
    laborCost,
    trip,
    travel: plan,
    cost,
```

5g. Replace

```ts
  return computeEstimate(opts, await getRates());
}
```

with

```ts
  return computeEstimate(opts, await getRates(), await getTravelRates());
}
```

- [ ] **Step 6: Run the tests and type-check**

Run: `npx tsc --noEmit; echo "tsc exit $?"`
Expected: `tsc exit 0`. (Callers compile unchanged: the new opts/param are optional; `r.trip.miles`/`.minutes`/`.mileageCost`/`.timeCost`/`.method` still exist.)

Run: `npm run test:specs 2>&1 | grep -E "#TRV|#60-67|FAIL|ALL PASSED" | tail -70`
Expected: all `PASS`, last line `ALL PASSED`.

Run: `npx eslint 2>&1 | tail -3` — expected `0 errors`, warnings ≤ baseline.

- [ ] **Step 7: Commit**

```bash
git add src/lib/flametest-engine.ts src/lib/repair-engine.ts src/lib/inspection-engine.ts scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(travel): flame/repair/inspection engines price flights over drive

Each engine plans travel on top of its unchanged drive math and prices
travel.total; trip keeps the drive numbers and gains mode/flight. Drive
mode prices trip.total itself, so drive-mode quotes are bit-for-bit
unchanged. Repairs fly at least the quote's crew; travel labor bills at
the base labor rate.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Save actions + renewal re-pricing persist the travel plan

**Files:**
- Modify: `src/app/(app)/flame-tests/quote/actions.ts` (imports ~14-18; compute call ~95-96; `trip` block ~138-144)
- Modify: `src/app/(app)/repairs/quote/actions.ts` (imports ~19-29; `computeEstimate` call ~139-153; `trip` block ~206-212)
- Modify: `src/app/(app)/inspections/quote/actions.ts` (imports ~18-23; `computeEstimate` call ~109-121; `trip` block ~154-160)
- Modify: `src/lib/renewal-outreach.ts` (imports ~26-47; `FlameTestDoc` ~186-196; `flameChangeReasons` ~237-241; `ensureFlameRenewalQuote` ~307-354; `InspectionDoc` ~495-507; `inspectionChangeReasons` ~567-571; `ensureInspectionRenewalQuote` ~613-669)
- Test: `scripts/test-review-and-spec.ts` (new block above `seeded()`)

**Interfaces:**
- Consumes: Task 1 `parseTravelOverride`, `savedTrip`, `carryTravelOverride`, `travelModeChangeReason`; Task 2 engine opts `travel`, repair `crewSize`, the third `travel` param of `computeEstimate`, `r.trip.mode`.
- Produces (the persisted quote shape Tasks 4-5 read): each service subdoc (`quote.flameTest`, `quote.repair`, `quote.inspection`) has `trip: SavedTrip` (`{ miles, minutes, mileageCost, timeCost, method, mode, flight? }`) and, only when set, `travel: TravelOverride`. The builders post the override as the FormData field `"travel"` (a JSON string).

- [ ] **Step 1: Write the failing test**

Insert above the line `seeded()`:

```ts
/* --- #TRV save paths: every path that persists a service quote stores the
   priced trip through savedTrip() (mode + flight) and the per-quote override --- */
{
  const trvSavers = [
    "src/app/(app)/flame-tests/quote/actions.ts",
    "src/app/(app)/repairs/quote/actions.ts",
    "src/app/(app)/inspections/quote/actions.ts",
    "src/lib/renewal-outreach.ts",
  ];
  for (const f of trvSavers) {
    const src = readFileSync(join(process.cwd(), f), "utf8");
    ok(/trip: savedTrip\(r\.trip\)/.test(src) && !/mileageCost: Math\.round\(r\.trip\.mileageCost\)/.test(src),
      `#TRV: ${f} persists the priced trip (mode + flight) through savedTrip()`);
    ok(/travel: travelOverride/.test(src) && /\{ travel: travelOverride \}/.test(src),
      `#TRV: ${f} prices with and persists the per-quote travel override`);
  }
  const renewalSrc = readFileSync(join(process.cwd(), "src/lib/renewal-outreach.ts"), "utf8");
  ok((renewalSrc.match(/carryTravelOverride\(/g) || []).length === 2 && (renewalSrc.match(/travelModeChangeReason\(/g) || []).length === 2,
    "#TRV: flame + inspection renewals carry last year's travel choice and explain a mode flip");
  const repairActionsSrc = readFileSync(join(process.cwd(), "src/app/(app)/repairs/quote/actions.ts"), "utf8");
  ok(/crewSize,\s*\n\s*travel: travelOverride/.test(repairActionsSrc), "#TRV: the repair save passes the crew size so the flying crew is never smaller");
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:specs 2>&1 | grep -E "#TRV: (src|flame \+|the repair save)" | head`
Expected: every line `FAIL`.

- [ ] **Step 3: Flame save action** (`src/app/(app)/flame-tests/quote/actions.ts`)

3a. Replace

```ts
import { coordsOf, quoteOrigin } from "@/lib/geo";
```

with

```ts
import { coordsOf, quoteOrigin } from "@/lib/geo";
import { parseTravelOverride, savedTrip } from "@/lib/travel-plan";
```

3b. Replace

```ts
  const travelRates = await getTravelRates();
  const r = compute({ office: office || undefined, venues: venueInputs }, rates, travelRates);
```

with

```ts
  const travelRates = await getTravelRates();
  // Flights over drive (spec 2026-09-25): the builder posts its Auto · Drive ·
  // Fly choice + crew/nights/airfare overrides as JSON; absent = auto.
  const travelOverride = parseTravelOverride(formData.get("travel"));
  const r = compute(
    { office: office || undefined, venues: venueInputs, travel: travelOverride },
    rates,
    travelRates
  );
```

3c. Replace

```ts
      trip: {
        miles: r.trip.miles,
        minutes: r.trip.minutes,
        mileageCost: Math.round(r.trip.mileageCost),
        timeCost: Math.round(r.trip.timeCost),
        method: r.trip.method,
      },
```

with

```ts
      trip: savedTrip(r.trip),
      ...(travelOverride ? { travel: travelOverride } : {}),
```

- [ ] **Step 4: Repair save action** (`src/app/(app)/repairs/quote/actions.ts`)

4a. Replace

```ts
import { coordsOf, quoteOrigin, driveMiles, driveMinutes } from "@/lib/geo";
```

with

```ts
import { coordsOf, quoteOrigin, driveMiles, driveMinutes } from "@/lib/geo";
import { parseTravelOverride, savedTrip } from "@/lib/travel-plan";
```

4b. Replace

```ts
  const travelRates = await getTravelRates();
  const r = computeEstimate(
    {
      office: office || undefined,
      venues: venueInputs,
      laborHours: hoursEach * crewSize,
      parts: partInputs,
      emergency,
      geo: {
        driveMiles: (a, b) => driveMiles(a, b, travelRates),
        driveMinutes: (a, b) => driveMinutes(a, b, travelRates),
      },
    },
    rates
  );
```

with

```ts
  const travelRates = await getTravelRates();
  // Flights over drive (spec 2026-09-25): the builder posts its Auto · Drive ·
  // Fly choice + crew/nights/airfare overrides as JSON; absent = auto.
  const travelOverride = parseTravelOverride(formData.get("travel"));
  const r = computeEstimate(
    {
      office: office || undefined,
      venues: venueInputs,
      laborHours: hoursEach * crewSize,
      parts: partInputs,
      emergency,
      crewSize,
      travel: travelOverride,
      geo: {
        driveMiles: (a, b) => driveMiles(a, b, travelRates),
        driveMinutes: (a, b) => driveMinutes(a, b, travelRates),
      },
    },
    rates,
    travelRates
  );
```

4c. Replace the `trip: { … method: r.trip.method, },` block (same 7 lines as 3c) with

```ts
      trip: savedTrip(r.trip),
      ...(travelOverride ? { travel: travelOverride } : {}),
```

- [ ] **Step 5: Inspection save action** (`src/app/(app)/inspections/quote/actions.ts`)

5a. Replace

```ts
import { coordsOf, quoteOrigin, driveMiles, driveMinutes } from "@/lib/geo";
```

with

```ts
import { coordsOf, quoteOrigin, driveMiles, driveMinutes } from "@/lib/geo";
import { parseTravelOverride, savedTrip } from "@/lib/travel-plan";
```

5b. Replace

```ts
  const travelRates = await getTravelRates();
  const r = computeEstimate(
    {
      office: office || undefined,
      venues: venueInputs,
      level,
      geo: {
        driveMiles: (a, b) => driveMiles(a, b, travelRates),
        driveMinutes: (a, b) => driveMinutes(a, b, travelRates),
      },
    },
    rates
  );
```

with

```ts
  const travelRates = await getTravelRates();
  // Flights over drive (spec 2026-09-25): the builder posts its Auto · Drive ·
  // Fly choice + crew/nights/airfare overrides as JSON; absent = auto.
  const travelOverride = parseTravelOverride(formData.get("travel"));
  const r = computeEstimate(
    {
      office: office || undefined,
      venues: venueInputs,
      level,
      travel: travelOverride,
      geo: {
        driveMiles: (a, b) => driveMiles(a, b, travelRates),
        driveMinutes: (a, b) => driveMinutes(a, b, travelRates),
      },
    },
    rates,
    travelRates
  );
```

5c. Replace the `trip: { … method: r.trip.method, },` block with

```ts
      trip: savedTrip(r.trip),
      ...(travelOverride ? { travel: travelOverride } : {}),
```

- [ ] **Step 6: Renewal re-pricing** (`src/lib/renewal-outreach.ts`)

6a. Replace

```ts
import { renderField } from "@/lib/templates";
```

with

```ts
import { renderField } from "@/lib/templates";
import {
  carryTravelOverride,
  savedTrip,
  travelModeChangeReason,
} from "@/lib/travel-plan";
```

6b. In the flame `FlameTestDoc` type replace

```ts
  origin?: { name?: string; street?: string; city?: string; state?: string; zip?: string } | null;
  trip?: { miles?: number; minutes?: number } | null;
```

with

```ts
  origin?: { name?: string; street?: string; city?: string; state?: string; zip?: string } | null;
  trip?: { miles?: number; minutes?: number; mode?: string; flight?: unknown } | null;
  /** Per-quote travel override (travel-plan.ts TravelOverride). */
  travel?: unknown;
```

6c. In `flameChangeReasons`, replace

```ts
  const oldMiles = priorFt?.trip?.miles;
  if (oldMiles != null && Math.abs(r.trip.miles - oldMiles) >= 2)
    out.push(
      `updated travel distance (${r.trip.miles} mi round trip, was ${Math.round(oldMiles)})`
    );
```

with

```ts
  const oldMiles = priorFt?.trip?.miles;
  if (oldMiles != null && Math.abs(r.trip.miles - oldMiles) >= 2)
    out.push(
      `updated travel distance (${r.trip.miles} mi round trip, was ${Math.round(oldMiles)})`
    );
  // Flights over drive (spec 2026-09-25 §5): say so when the mode flipped.
  if (priorFt?.trip) {
    const flip = travelModeChangeReason(priorFt.trip.mode === "fly" ? "fly" : "drive", r.trip.mode);
    if (flip) out.push(flip);
  }
```

6d. In `ensureFlameRenewalQuote`, replace

```ts
  const r = computeFlame(
    { office: office || undefined, venues: venueInputs },
    rates,
    travelRates
  );
```

with

```ts
  // Last year's travel CHOICE (mode/crew/nights) carries; its airfare doesn't (D69: current rates).
  const travelOverride = carryTravelOverride(priorFt?.travel);
  const r = computeFlame(
    { office: office || undefined, venues: venueInputs, travel: travelOverride },
    rates,
    travelRates
  );
```

6e. In the inspection `InspectionDoc` type replace

```ts
  inspectHours?: number | null;
  trip?: { miles?: number; minutes?: number } | null;
```

with

```ts
  inspectHours?: number | null;
  trip?: { miles?: number; minutes?: number; mode?: string; flight?: unknown } | null;
  /** Per-quote travel override (travel-plan.ts TravelOverride). */
  travel?: unknown;
```

6f. In `inspectionChangeReasons`, replace

```ts
  const oldMiles = priorVenueCount === 1 ? priorIn?.trip?.miles : null;
  if (oldMiles != null && Math.abs(r.trip.miles - oldMiles) >= 2)
    out.push(
      `updated travel distance (${r.trip.miles} mi round trip, was ${Math.round(oldMiles)})`
    );
```

with

```ts
  const oldMiles = priorVenueCount === 1 ? priorIn?.trip?.miles : null;
  if (oldMiles != null && Math.abs(r.trip.miles - oldMiles) >= 2)
    out.push(
      `updated travel distance (${r.trip.miles} mi round trip, was ${Math.round(oldMiles)})`
    );
  // Flights over drive (spec 2026-09-25 §5): say so when the mode flipped
  // (single-venue priors only — a combined trip is explained above).
  if (priorVenueCount === 1 && priorIn?.trip) {
    const flip = travelModeChangeReason(priorIn.trip.mode === "fly" ? "fly" : "drive", r.trip.mode);
    if (flip) out.push(flip);
  }
```

6g. In `ensureInspectionRenewalQuote`, replace

```ts
  const r = computeInspection(
    {
      office: office || undefined,
      venues: [venueInput],
      level,
      geo: {
        driveMiles: (a, b) => driveMiles(a, b, travelRates),
        driveMinutes: (a, b) => driveMinutes(a, b, travelRates),
      },
    },
    rates
  );
```

with

```ts
  // Last year's travel CHOICE (mode/crew/nights) carries; its airfare doesn't (D69: current rates).
  const travelOverride = carryTravelOverride(priorIn?.travel);
  const r = computeInspection(
    {
      office: office || undefined,
      venues: [venueInput],
      level,
      travel: travelOverride,
      geo: {
        driveMiles: (a, b) => driveMiles(a, b, travelRates),
        driveMinutes: (a, b) => driveMinutes(a, b, travelRates),
      },
    },
    rates,
    travelRates
  );
```

6h. The two identical `trip: { … method: r.trip.method, },` blocks (one in `ensureFlameRenewalQuote`, one in `ensureInspectionRenewalQuote`, both 6-space indented) — replace **both** (Edit with `replace_all: true`) with

```ts
      trip: savedTrip(r.trip),
      ...(travelOverride ? { travel: travelOverride } : {}),
```

(`travelOverride` is in scope in both functions after 6d/6g.)

- [ ] **Step 7: Run the tests and type-check**

Run: `npx tsc --noEmit; echo "tsc exit $?"` — expected `tsc exit 0`.
Run: `npm run test:specs 2>&1 | grep -E "#TRV|FAIL|ALL PASSED" | tail -80` — expected all `PASS`, `ALL PASSED`.
Run: `D=$(mktemp -d); env -u DATABASE_URL PGLITE_PATH=$D npx tsx scripts/test-review-regressions.ts 2>&1 | tail -5` — expected no assertion failure (exit 0).
Run: `npx eslint 2>&1 | tail -3` — expected `0 errors`, warnings ≤ baseline.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/flame-tests/quote/actions.ts" "src/app/(app)/repairs/quote/actions.ts" "src/app/(app)/inspections/quote/actions.ts" src/lib/renewal-outreach.ts scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(travel): save actions and renewals persist the travel plan

Flame/repair/inspection saves read the posted travel override, price with
the live travel rates and persist trip (mode + flight) plus the override.
Renewal re-pricing carries last year's mode/crew/nights (never its manual
airfare) and names a drive <-> flights flip in the why-changed reasons.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Builder UI — Auto · Drive · Fly in all three quote builders

**Files:**
- Create: `src/components/travel-mode-panel.tsx`
- Modify: `src/app/(app)/flame-tests/quote/controls.tsx`, `src/app/(app)/repairs/quote/controls.tsx`, `src/app/(app)/inspections/quote/controls.tsx`
- Modify: `src/app/(app)/flame-tests/quote/page.tsx`, `src/app/(app)/repairs/quote/page.tsx`, `src/app/(app)/inspections/quote/page.tsx`
- Test: `scripts/test-review-and-spec.ts` (new block above `seeded()`)

**Interfaces:**
- Consumes: Task 1 `planTravel`, `draftFromOverride`, `overrideFromDraft`, `normalizeTravelOverride`, `autoSwitchNote`, `FLY_CREW_DEFAULTS`, types `FlyRates`, `TravelDraft`, `TravelModeChoice`, `TravelOverride`, `TravelPlan`; `getTravelRates(): Promise<ResolvedTravelRates>`; Task 3's `"travel"` FormData field and saved `travel` subdoc key.
- Produces:
  - `TravelModePanel(props: { plan: TravelPlan | null; draft: TravelDraft; onDraft: (next: TravelDraft) => void; accent: string })` from `@/components/travel-mode-panel` (`"use client"`).
  - Each builder's `BuilderRates.flyCrew?: number`, `BuilderInitial.travel?: TravelOverride | null`, new `export type BuilderTravelRates = FlyRates & { roadFactor: number; mph: number }`, and a new required `QuoteBuilder` prop `travelRates: BuilderTravelRates`.

- [ ] **Step 1: Write the failing test**

Insert above the line `seeded()`:

```ts
/* --- #TRV builders: previews run the same planner with the live travel
   rates, render the travel panel, post the override — and stay client-safe --- */
{
  for (const svc of ["flame-tests", "repairs", "inspections"]) {
    const src = readFileSync(join(process.cwd(), `src/app/(app)/${svc}/quote/controls.tsx`), "utf8");
    ok(/from "@\/lib\/travel-plan"/.test(src) && /planTravel\(/.test(src) && /<TravelModePanel/.test(src),
      `#TRV: the ${svc} builder previews through planTravel and renders the travel panel`);
    ok(/fd\.set\("travel", JSON\.stringify\(overrideFromDraft\(travelDraft\) \?\? \{\}\)\)/.test(src),
      `#TRV: the ${svc} builder posts its travel override`);
    ok(!/^import (?!type )[^;]*from "@\/(lib\/stores|db)\//m.test(src),
      `#TRV: the ${svc} builder imports no value from @/lib/stores or @/db`);
    ok(!/\* 1\.25\)/.test(src) && !/\/ 50\) \* 60/.test(src),
      `#TRV: the ${svc} preview uses the live road factor / speed, not 1.25 / 50`);
    const page = readFileSync(join(process.cwd(), `src/app/(app)/${svc}/quote/page.tsx`), "utf8");
    ok(/getTravelRates\(\)/.test(page) && /travelRates=\{travelRates\}/.test(page) && /normalizeTravelOverride\(/.test(page),
      `#TRV: the ${svc} page hands the builder live travel rates and the saved override`);
  }
  const panelSrc = readFileSync(join(process.cwd(), "src/components/travel-mode-panel.tsx"), "utf8");
  ok(/^"use client";/.test(panelSrc) && !/from "@\/(lib\/stores|db)\//.test(panelSrc) && /autoSwitchNote\(/.test(panelSrc),
    "#TRV: the travel panel is a client component that imports only the pure planner");
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:specs 2>&1 | grep -E "#TRV: the (flame|repairs|inspections|travel panel)" | head -20`
Expected: the harness crashes with `ENOENT … travel-mode-panel.tsx` or the builder lines print `FAIL` (only the "imports no value" lines may already `PASS`).

- [ ] **Step 3: Create `src/components/travel-mode-panel.tsx`**

```tsx
"use client";

import type { CSSProperties } from "react";
import {
  autoSwitchNote,
  type TravelDraft,
  type TravelModeChoice,
  type TravelPlan,
} from "@/lib/travel-plan";

/**
 * Flights over drive — the travel control shared by the three auto-priced
 * service quote builders (flame tests, repairs, inspections; spec
 * docs/superpowers/specs/2026-09-25-travel-flights-design.md §5).
 *
 * Presentation only: the builder owns the draft, re-prices through
 * planTravel() and hands the plan back in. Renders the Auto · Drive · Fly
 * switch, the auto-switch note, and — when the plan flies — the crew /
 * nights / airfare inputs (blank = the default, shown as the placeholder)
 * and the itemized flight costs. The itemization is builder-only; customers
 * see one "Travel (air, lodging & per diem)" line.
 */

const CHOICES: Array<{ key: TravelModeChoice; label: string }> = [
  { key: "auto", label: "Auto" },
  { key: "drive", label: "Drive" },
  { key: "fly", label: "Fly" },
];

function money(n: number): string {
  return "$" + Math.round(n || 0).toLocaleString("en-US");
}
function count(n: number, one: string, many: string): string {
  return n + " " + (n === 1 ? one : many);
}

const LABEL: CSSProperties = {
  display: "block",
  fontSize: 10,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".04em",
  textTransform: "uppercase",
  marginBottom: 4,
};
const FIELD: CSSProperties = {
  width: "100%",
  fontFamily: "var(--font-mono)",
  fontSize: 12.5,
  color: "#16181d",
  background: "#fff",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "6px 8px",
  boxSizing: "border-box",
};

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        fontSize: 12.5,
        marginBottom: 6,
        fontWeight: strong ? 700 : 400,
      }}
    >
      <span style={{ color: strong ? "#16181d" : "#5b616e", minWidth: 0 }}>{label}</span>
      <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, flexShrink: 0 }}>{value}</span>
    </div>
  );
}

export function TravelModePanel({
  plan,
  draft,
  onDraft,
  accent,
}: {
  plan: TravelPlan | null;
  draft: TravelDraft;
  onDraft: (next: TravelDraft) => void;
  accent: string;
}) {
  const flight = plan?.flight ?? null;
  const set = (patch: Partial<TravelDraft>) => onDraft({ ...draft, ...patch });

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: "#5b616e" }}>Travel</span>
        <div
          role="radiogroup"
          aria-label="Travel mode"
          style={{ display: "inline-flex", border: "1px solid #e4e7ec", borderRadius: 8, overflow: "hidden" }}
        >
          {CHOICES.map((c) => {
            const on = draft.mode === c.key;
            return (
              <button
                key={c.key}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => set({ mode: c.key })}
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 11.5,
                  fontWeight: 600,
                  padding: "5px 11px",
                  border: "none",
                  cursor: "pointer",
                  background: on ? accent : "#fff",
                  color: on ? "#fff" : "#5b616e",
                }}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {plan && plan.choice === "auto" && plan.mode === "fly" && (
        <div style={{ fontSize: 10.5, color: "#b4543a", marginTop: 7, lineHeight: 1.45 }}>
          {autoSwitchNote(plan.driveTotal, plan.threshold)}
        </div>
      )}

      {plan && flight && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 10 }}>
            <label>
              <span style={LABEL}>Crew</span>
              <input
                type="number"
                min={1}
                step={1}
                value={draft.crew}
                placeholder={String(plan.defaults.crew)}
                onChange={(e) => set({ crew: e.target.value })}
                style={FIELD}
              />
            </label>
            <label>
              <span style={LABEL}>Nights</span>
              <input
                type="number"
                min={0}
                step={1}
                value={draft.nights}
                placeholder={String(plan.defaults.nights)}
                onChange={(e) => set({ nights: e.target.value })}
                style={FIELD}
              />
            </label>
            <label>
              <span style={LABEL}>Airfare / pp</span>
              <input
                type="number"
                min={0}
                step={10}
                value={draft.airfare}
                placeholder={String(plan.defaults.airfarePerPerson)}
                onChange={(e) => set({ airfare: e.target.value })}
                style={FIELD}
              />
            </label>
          </div>
          <div style={{ marginTop: 10 }}>
            <Row label={"Airfare · " + count(flight.crew, "person", "people")} value={money(flight.airfare)} />
            <Row
              label={"Lodging · " + count(flight.crew, "room", "rooms") + " × " + count(flight.nights, "night", "nights")}
              value={money(flight.lodging)}
            />
            <Row
              label={"Per diem · " + count(flight.crew, "person", "people") + " × " + count(flight.tripDays, "day", "days")}
              value={money(flight.perDiem)}
            />
            <Row
              label={"Rental car · " + count(Math.ceil(flight.crew / 2), "car", "cars") + " × " + count(flight.tripDays, "day", "days")}
              value={money(flight.car)}
            />
            <Row
              label={"Travel labor · " + Math.round(flight.travelHours * 10) / 10 + " h"}
              value={money(flight.travelLabor)}
            />
            <Row label="Flights total" value={money(flight.total)} strong />
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Shared edits — apply to EACH of the three `controls.tsx` files**

These snippets are textually identical in all three builders; apply each one per file.

4a. Imports — replace

```ts
import { ChangeTypeControl, useWonEditGuard } from "@/components/quote-flow-controls";
```

with

```ts
import { ChangeTypeControl, useWonEditGuard } from "@/components/quote-flow-controls";
import { TravelModePanel } from "@/components/travel-mode-panel";
import {
  FLY_CREW_DEFAULTS,
  draftFromOverride,
  overrideFromDraft,
  planTravel,
  type FlyRates,
  type TravelDraft,
  type TravelOverride,
  type TravelPlan,
} from "@/lib/travel-plan";
```

4b. Drive helpers — replace

```ts
function driveMiles(a: Coords | BuilderOffice, b: Coords | BuilderOffice): number | null {
  const m = haversine(a, b);
  return m == null ? null : Math.round(m * 1.25);
}
function driveMinutes(a: Coords | BuilderOffice, b: Coords | BuilderOffice): number | null {
  const mi = driveMiles(a, b);
  return mi == null ? null : Math.round((mi / 50) * 60);
}
```

with

```ts
/* Live Estimating Rules road factor / speed — the values the server re-prices
   with — so the preview's drive total, and therefore its drive-or-fly
   decision, matches the saved quote. */
function driveMiles(a: Coords | BuilderOffice, b: Coords | BuilderOffice, tr: BuilderTravelRates): number | null {
  const m = haversine(a, b);
  return m == null ? null : Math.round(m * tr.roadFactor);
}
function driveMinutes(a: Coords | BuilderOffice, b: Coords | BuilderOffice, tr: BuilderTravelRates): number | null {
  const mi = driveMiles(a, b, tr);
  return mi == null ? null : Math.round((mi / tr.mph) * 60);
}
```

4c. `tripTravel` — replace

```ts
function tripTravel(office: BuilderOffice | null, venues: VenueIn[], rates: BuilderRates): Trip {
```

with

```ts
function tripTravel(office: BuilderOffice | null, venues: VenueIn[], rates: BuilderRates, tr: BuilderTravelRates): Trip {
```

and inside it replace

```ts
      const m = driveMiles(seq[i], seq[i + 1]);
      const t = driveMinutes(seq[i], seq[i + 1]);
```

with

```ts
      const m = driveMiles(seq[i], seq[i + 1], tr);
      const t = driveMinutes(seq[i], seq[i + 1], tr);
```

4d. `BuilderInitial` — add the optional saved override. In **flame** replace

```ts
  /** #160 — the intake supplied a name: don't auto-rename on venue toggles. */
  nameLocked: boolean;
};
```

with

```ts
  /** #160 — the intake supplied a name: don't auto-rename on venue toggles. */
  nameLocked: boolean;
  /** The saved travel override (flights over drive) — absent = auto. */
  travel?: TravelOverride | null;
};
```

In **repairs** and **inspections** replace

```ts
  /** #160 / D205 — the draft this new quote replaces; posted on the create save. */
  replaces: string;
};
```

with

```ts
  /** #160 / D205 — the draft this new quote replaces; posted on the create save. */
  replaces: string;
  /** The saved travel override (flights over drive) — absent = auto. */
  travel?: TravelOverride | null;
};
```

4e. `BuilderRates` gains `flyCrew`, and a new travel-rates type follows it. In **flame** replace

```ts
  margin: number;
  travelRoundMin: number;
};
export type BuilderInitial = {
```

with

```ts
  margin: number;
  travelRoundMin: number;
  /** Default flying crew (Estimating Rules → Flame-test pricing). */
  flyCrew?: number;
};
/** Estimating Rules → Travel & mileage (blob `travel_rates`): drive fallback + flight rates. */
export type BuilderTravelRates = FlyRates & { roadFactor: number; mph: number };
export type BuilderInitial = {
```

In **repairs** replace

```ts
  emergencyMult: number;
  travelRoundMin: number;
};
export type BuilderOption = { key: string; label: string };
```

with

```ts
  emergencyMult: number;
  travelRoundMin: number;
  /** Default flying crew (Estimating Rules → Repair pricing). */
  flyCrew?: number;
};
/** Estimating Rules → Travel & mileage (blob `travel_rates`): drive fallback + flight rates. */
export type BuilderTravelRates = FlyRates & { roadFactor: number; mph: number };
export type BuilderOption = { key: string; label: string };
```

In **inspections** replace

```ts
  minFee: number;
  margin: number;
  travelRoundMin: number;
};
export type BuilderLevel = { key: number; label: string; long: string; blurb: string };
```

with

```ts
  minFee: number;
  margin: number;
  travelRoundMin: number;
  /** Default flying crew (Estimating Rules → Inspection pricing). */
  flyCrew?: number;
};
/** Estimating Rules → Travel & mileage (blob `travel_rates`): drive fallback + flight rates. */
export type BuilderTravelRates = FlyRates & { roadFactor: number; mph: number };
export type BuilderLevel = { key: number; label: string; long: string; blurb: string };
```

4f. `QuoteBuilder` props — in each file replace `  rates: baseRates,\n` with

```ts
  rates: baseRates,
  travelRates,
```

and `  rates: BuilderRates;\n` (the props type — the only `rates: BuilderRates;` line) with

```ts
  rates: BuilderRates;
  travelRates: BuilderTravelRates;
```

4g. State — in each file replace

```ts
  const [savedFlag, setSavedFlag] = useState(initial.saved || initial.approved);
```

with

```ts
  const [savedFlag, setSavedFlag] = useState(initial.saved || initial.approved);
  const [travelDraft, setTravelDraft] = useState<TravelDraft>(() => draftFromOverride(initial.travel));
```

4h. Post the override — in each file replace

```ts
    fd.set("laborRate", laborRate);
```

with

```ts
    fd.set("laborRate", laborRate);
    fd.set("travel", JSON.stringify(overrideFromDraft(travelDraft) ?? {}));
```

4i. Sidebar — in each file replace

```tsx
              <BreakRow label={"Mileage · " + mileageDetail} value={money(trip.mileageCost)} />
              <BreakRow label={"Travel time · " + timeDetail} value={money(trip.timeCost)} last />
```

with

```tsx
              {/* the drive figures stay visible; muted when the trip is priced as flights */}
              <div style={{ opacity: r?.travel.mode === "fly" ? 0.45 : 1 }}>
                <BreakRow label={"Mileage · " + mileageDetail} value={money(trip.mileageCost)} />
                <BreakRow label={"Travel time · " + timeDetail} value={money(trip.timeCost)} last />
              </div>
              <TravelModePanel
                plan={r?.travel ?? null}
                draft={travelDraft}
                onDraft={(next) => {
                  setTravelDraft(next);
                  dirty();
                }}
                accent={accent}
              />
```

- [ ] **Step 5: Per-builder pricing — flame** (`src/app/(app)/flame-tests/quote/controls.tsx`)

5a. `Pricing` type — replace

```ts
  margin: number;
  marginAmount: number;
  total: number;
};

function priceVenue(v: VenueIn, rates: BuilderRates): PerVenue {
```

with

```ts
  margin: number;
  marginAmount: number;
  total: number;
  /** Flights over drive — travel.total is the figure the quote prices. */
  travel: TravelPlan;
};

function priceVenue(v: VenueIn, rates: BuilderRates): PerVenue {
```

5b. Replace the whole `computePricing` function (from `function computePricing(office: BuilderOffice | null, venues: VenueIn[], rates: BuilderRates): Pricing {` through its closing `}`) with

```ts
function computePricing(
  office: BuilderOffice | null,
  venues: VenueIn[],
  rates: BuilderRates,
  tr: BuilderTravelRates,
  override: TravelOverride | undefined
): Pricing {
  const perVenue = venues.map((v) => priceVenue(v, rates));
  const testingSubtotal = perVenue.reduce((a, v) => a + v.laborCost, 0);
  const curtainsTotal = perVenue.reduce((a, v) => a + v.curtains, 0);
  const trip = tripTravel(office, venues, rates, tr);
  // Flights over drive — the same planner the server engine runs.
  const travel = planTravel({
    drive: trip,
    onSiteHours: (curtainsTotal * rates.curtainMinutes) / 60,
    laborRate: rates.laborRate,
    crewDefault: rates.flyCrew ?? FLY_CREW_DEFAULTS.flame,
    rates: tr,
    override,
  });
  const rawCost = travel.total + testingSubtotal;
  const baseApplied = rawCost < rates.baseFee;
  const cost = baseApplied ? rates.baseFee : rawCost;
  const margin = rates.margin;
  const total = margin > 0 && margin < 1 ? cost / (1 - margin) : cost;
  return {
    perVenue,
    curtainsTotal,
    venueCount: venues.length,
    trip,
    cost,
    rawCost,
    baseApplied,
    margin,
    marginAmount: total - cost,
    total,
    travel,
  };
}
```

5c. `liveRates` — replace

```ts
    margin: marginPts / 100,
    travelRoundMin: baseRates.travelRoundMin,
  };
```

with

```ts
    margin: marginPts / 100,
    travelRoundMin: baseRates.travelRoundMin,
    flyCrew: baseRates.flyCrew,
  };
```

5d. Call site — replace

```ts
      ? computePricing(office, selectedVenues, liveRates)
```

with

```ts
      ? computePricing(office, selectedVenues, liveRates, travelRates, overrideFromDraft(travelDraft))
```

- [ ] **Step 6: Per-builder pricing — repairs** (`src/app/(app)/repairs/quote/controls.tsx`)

6a. `Pricing` type — replace

```ts
  cost: number;
  total: number;
  marginAmount: number;
};
```

with

```ts
  cost: number;
  total: number;
  marginAmount: number;
  /** Flights over drive — travel.total is the figure the quote prices. */
  travel: TravelPlan;
};
```

6b. Replace the whole `computePricing` function (from `function computePricing(` through its closing `}` just above `/* ---------- display helpers ---------- */`) with

```ts
function computePricing(
  office: BuilderOffice | null,
  venues: VenueIn[],
  laborHours: number,
  crew: number,
  parts: PartIn[],
  emergency: boolean,
  rates: BuilderRates,
  tr: BuilderTravelRates,
  override: TravelOverride | undefined
): Pricing {
  const hours = Math.max(0, Number(laborHours) || 0);
  const laborRate = rates.laborRate * (emergency ? rates.emergencyMult || 1 : 1);
  const laborCost = hours * laborRate;
  const trip = tripTravel(office, venues, rates, tr);
  // Flights over drive — the same planner the server engine runs: never fewer
  // flyers than the priced crew; travel labor at the base (non-emergency) rate.
  const travel = planTravel({
    drive: trip,
    onSiteHours: hours,
    laborRate: rates.laborRate,
    crewDefault: Math.max(rates.flyCrew ?? FLY_CREW_DEFAULTS.repair, crew),
    rates: tr,
    override,
  });
  const serviceCost = laborCost + travel.total;
  const margin = rates.margin;
  const serviceSellRaw =
    margin > 0 && margin < 1 ? serviceCost / (1 - margin) : serviceCost;
  const calloutApplied = serviceSellRaw < rates.minCallout;
  const serviceSell = calloutApplied ? rates.minCallout : serviceSellRaw;
  const priced = parts.map((p) => {
    const qty = Math.max(0, Number(p.qty) || 0);
    const cost = Math.max(0, Number(p.cost) || 0);
    return { name: p.name || "Part", qty, cost, extCost: qty * cost };
  });
  const partsCost = priced.reduce((a, p) => a + p.extCost, 0);
  const pMargin = rates.partsMargin;
  const partsSell =
    pMargin > 0 && pMargin < 1 ? partsCost / (1 - pMargin) : partsCost;
  const total = serviceSell + partsSell;
  const cost = serviceCost + partsCost;
  return {
    laborHours: hours,
    laborRate,
    laborCost,
    emergency,
    trip,
    serviceCost,
    serviceSellRaw,
    serviceSell,
    calloutApplied,
    parts: priced,
    partsCost,
    partsSell,
    cost,
    total,
    marginAmount: total - cost,
    travel,
  };
}
```

6c. Call site — replace

```ts
      ? computePricing(office, selectedVenues, crewHours, partsIn, emergency, liveRates)
```

with

```ts
      ? computePricing(office, selectedVenues, crewHours, crew, partsIn, emergency, liveRates, travelRates, overrideFromDraft(travelDraft))
```

(`liveRates` already spreads `...baseRates`, so it carries `flyCrew`.)

- [ ] **Step 7: Per-builder pricing — inspections** (`src/app/(app)/inspections/quote/controls.tsx`)

7a. `Pricing` type — replace

```ts
  minApplied: boolean;
  margin: number;
  marginAmount: number;
  total: number;
};

function tripTravel(
```

with

```ts
  minApplied: boolean;
  margin: number;
  marginAmount: number;
  total: number;
  /** Flights over drive — travel.total is the figure the quote prices. */
  travel: TravelPlan;
};

function tripTravel(
```

7b. Replace the whole `computePricing` function (from `function computePricing(` through its closing `}` above `/* ---------- display helpers ---------- */`) with

```ts
function computePricing(
  office: BuilderOffice | null,
  venues: VenueIn[],
  level: number,
  rates: BuilderRates,
  tr: BuilderTravelRates,
  override: TravelOverride | undefined
): Pricing {
  const levelMult = level === 2 ? rates.level2Mult || 1 : 1;
  const perVenue: PerVenue[] = venues.map((v) => {
    const lineSets = Math.max(0, Math.round(Number(v.lineSets) || 0));
    const hours = ((lineSets * rates.lineSetMinutes) / 60) * levelMult;
    return { id: v.id, label: v.label || "Venue", lineSets, laborCost: hours * rates.laborRate };
  });
  const lineSetsTotal = perVenue.reduce((a, v) => a + v.lineSets, 0);
  const inspectHoursRaw = rates.baseHours + (lineSetsTotal * rates.lineSetMinutes) / 60;
  const inspectHours = Math.round(inspectHoursRaw * levelMult * 10) / 10;
  const laborCost = inspectHours * rates.laborRate;
  const baseCost = rates.baseHours * levelMult * rates.laborRate;
  const trip = tripTravel(office, venues, rates, tr);
  // Flights over drive — the same planner the server engine runs.
  const travel = planTravel({
    drive: trip,
    onSiteHours: inspectHours,
    laborRate: rates.laborRate,
    crewDefault: rates.flyCrew ?? FLY_CREW_DEFAULTS.inspection,
    rates: tr,
    override,
  });
  const cost = laborCost + travel.total;
  const margin = rates.margin;
  const sellRaw = margin > 0 && margin < 1 ? cost / (1 - margin) : cost;
  const minApplied = sellRaw < rates.minFee;
  const total = minApplied ? rates.minFee : sellRaw;
  return {
    perVenue,
    lineSetsTotal,
    venueCount: venues.length,
    levelMult,
    inspectHours,
    baseCost,
    laborCost,
    trip,
    cost,
    sellRaw,
    minApplied,
    margin,
    marginAmount: total - cost,
    total,
    travel,
  };
}
```

7c. Call site — replace

```ts
      ? computePricing(office, selectedVenues, level, liveRates)
```

with

```ts
      ? computePricing(office, selectedVenues, level, liveRates, travelRates, overrideFromDraft(travelDraft))
```

- [ ] **Step 8: Pages hand over live travel rates + the saved override**

8a. **Flame** (`src/app/(app)/flame-tests/quote/page.tsx`). Replace

```ts
import { getSettings } from "@/lib/settings";
```

with

```ts
import { getSettings } from "@/lib/settings";
import { getTravelRates } from "@/lib/stores/pricing";
import { normalizeTravelOverride } from "@/lib/travel-plan";
```

Replace

```ts
type FlameTestDoc = { venues?: FtVenue[]; contact?: FtContact } | null;
```

with

```ts
type FlameTestDoc = { venues?: FtVenue[]; contact?: FtContact; travel?: unknown } | null;
```

Replace

```ts
  const [, sp, customerDocs, rates, settings] = await Promise.all([
    requireUser(),
    searchParams,
    allCustomers(),
    getRates(),
    getSettings(),
  ]);
```

with

```ts
  const [, sp, customerDocs, rates, settings, travelRates] = await Promise.all([
    requireUser(),
    searchParams,
    allCustomers(),
    getRates(),
    getSettings(),
    getTravelRates(),
  ]);
```

In the edit branch's `initial = { … }` replace

```ts
      replaces: "",
      nameLocked: false,
    };
  } else if (preCustomer) {
```

with

```ts
      replaces: "",
      nameLocked: false,
      travel: normalizeTravelOverride(ft && ft.travel) ?? null,
    };
  } else if (preCustomer) {
```

Replace

```tsx
        rates={rates}
```

with

```tsx
        rates={rates}
        travelRates={travelRates}
```

8b. **Repairs** (`src/app/(app)/repairs/quote/page.tsx`). Replace

```ts
import { getSettings } from "@/lib/settings";
```

with

```ts
import { getSettings } from "@/lib/settings";
import { getTravelRates } from "@/lib/stores/pricing";
import { normalizeTravelOverride } from "@/lib/travel-plan";
```

In `RepairDoc` replace

```ts
  contact?: RpContact;
  venues?: RpVenue[];
} | null;
```

with

```ts
  contact?: RpContact;
  venues?: RpVenue[];
  travel?: unknown;
} | null;
```

Replace the `Promise.all` destructure exactly as in 8a (the repair page's block is textually identical: `const [, sp, customerDocs, rates, settings] = await Promise.all([ … getSettings(), ]);`) with the `travelRates` version shown in 8a.

In the edit branch replace

```ts
      source: (rp && rp.source) || null,
```

with

```ts
      source: (rp && rp.source) || null,
      travel: normalizeTravelOverride(rp && rp.travel) ?? null,
```

(That `source:` line occurs once in the file — only the edit branch reads `rp.source`.) Then replace `        rates={rates}` with the two-line `rates` + `travelRates` version from 8a.

8c. **Inspections** (`src/app/(app)/inspections/quote/page.tsx`). Replace

```ts
import { getSettings } from "@/lib/settings";
```

with

```ts
import { getSettings } from "@/lib/settings";
import { getTravelRates } from "@/lib/stores/pricing";
import { normalizeTravelOverride } from "@/lib/travel-plan";
```

Replace

```ts
  venues?: InVenue[];
  contact?: InContact;
} | null;
```

with

```ts
  venues?: InVenue[];
  contact?: InContact;
  travel?: unknown;
} | null;
```

Replace

```ts
  const [user, sp, customerDocs, rates, settings] = await Promise.all([
    requireUser(),
    searchParams,
    allCustomers(),
    getRates(),
    getSettings(),
  ]);
```

with

```ts
  const [user, sp, customerDocs, rates, settings, travelRates] = await Promise.all([
    requireUser(),
    searchParams,
    allCustomers(),
    getRates(),
    getSettings(),
    getTravelRates(),
  ]);
```

Replace

```ts
      notes: (insp && insp.scope) || "",
```

with

```ts
      notes: (insp && insp.scope) || "",
      travel: normalizeTravelOverride(insp && insp.travel) ?? null,
```

and replace `        rates={rates}` with the `rates` + `travelRates` version from 8a.

- [ ] **Step 9: Run the tests, type-check, lint and BUILD**

Run: `npx tsc --noEmit; echo "tsc exit $?"` — expected `tsc exit 0`.
Run: `npm run test:specs 2>&1 | grep -E "#TRV|FAIL|ALL PASSED" | tail -90` — expected all `PASS`, `ALL PASSED`.
Run: `npx eslint 2>&1 | tail -3` — expected `0 errors`, warnings ≤ baseline.
Run: `env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npm run build 2>&1 | tail -25; rm -rf .next`
Expected: `✓ Compiled successfully` and the route table; no `Module not found: Can't resolve 'fs'` / `'net'` / `'tls'` (that error means a client file pulled a store).
Run: `npm run test:smoke 2>&1 | tail -8` — expected `ALL PASSED` (covers `/flame-tests/quote?customer=…`, `/repairs/quote?…`, `/inspections/quote?…`, `/estimating-rules`).

- [ ] **Step 10: Commit**

```bash
git add src/components/travel-mode-panel.tsx "src/app/(app)/flame-tests/quote/controls.tsx" "src/app/(app)/repairs/quote/controls.tsx" "src/app/(app)/inspections/quote/controls.tsx" "src/app/(app)/flame-tests/quote/page.tsx" "src/app/(app)/repairs/quote/page.tsx" "src/app/(app)/inspections/quote/page.tsx" scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(travel): Auto / Drive / Fly in the flame, repair and inspection builders

A shared client panel shows the travel mode switch, the auto-switch note,
crew / nights / airfare inputs (defaults as placeholders) and the itemized
flight costs. Previews run the same planner with the live travel rates
(road factor / speed no longer hardcoded) and post the override.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Letters, quote documents and the renewal PDFs print one travel line

**Files:**
- Modify: `src/lib/templates.ts` (`flame_proposal` fields ~103-117; `inspection_proposal` fields ~277-290)
- Modify: `src/app/(app)/flame-tests/letter/page.tsx` (imports ~1-15; `FlameTestDoc` ~67-82; travel vars ~216-224; scope rows ~285-292; price line ~305-310)
- Modify: `src/app/(app)/inspections/letter/page.tsx` (imports ~1-12; `InspectionDoc` ~67-78; travel vars ~203-211; scope rows ~262-269; price line ~290-295)
- Modify: `src/app/(app)/repairs/letter/page.tsx` (imports ~1-15; `RepairDoc` 50-67; travel paragraph ~194-224)
- Modify: `src/lib/renewal-outreach.ts` (travel-plan import from Task 3; `flameLetterDoc` ~443-461 and cost line ~480; `inspectionLetterDoc` ~760-776 and cost line ~797)
- Test: `scripts/test-review-and-spec.ts` (new block above `seeded()`)

**Interfaces:**
- Consumes: Task 1 `TRAVEL_FLY_LINE`, `flightOf`, `travelLineAmount`, `flyTravelSentence`; Task 3 persisted `trip.mode` / `trip.flight` and `rates.margin` snapshot on each subdoc.
- Produces: template field `priceLineFly` on `flame_proposal` and `inspection_proposal` (editable in Settings → Templates like every field; `renderField` falls back to its default).

- [ ] **Step 1: Write the failing test**

Insert above the line `seeded()`:

```ts
/* --- #TRV letters: fly mode prints ONE customer line, never the itemization --- */
import { renderField as trvRenderField } from "@/lib/templates";
{
  ok(
    trvRenderField(undefined, "flame_proposal", "priceLineFly", { curtainsLabel: "12 curtains", price: "$3,593" }) ===
      "Everything above — travel (air, lodging & per diem), the on-site hours, and every one of your 12 curtains inspected and documented — comes to $3,593, all in.",
    "#TRV: flame_proposal has a fly-mode price line that never says 'the drive'"
  );
  ok(
    trvRenderField(undefined, "inspection_proposal", "priceLineFly", { lineSetsLabel: "40 line sets", price: "$3,807" }) ===
      "Everything above — travel (air, lodging & per diem), the on-site hours, and every one of your 40 line sets inspected and documented — comes to $3,807, all in.",
    "#TRV: inspection_proposal has a fly-mode price line"
  );
  ok(!!getTemplateDef("flame_proposal")?.fields.some((fl) => fl.id === "priceLineFly") &&
      !!getTemplateDef("inspection_proposal")?.fields.some((fl) => fl.id === "priceLineFly"),
    "#TRV: the fly price line is an editable template field on both proposals");
  const trvLetters: Array<[string, RegExp]> = [
    ["src/app/(app)/flame-tests/letter/page.tsx", /desc: TRAVEL_FLY_LINE/],
    ["src/app/(app)/inspections/letter/page.tsx", /desc: TRAVEL_FLY_LINE/],
    ["src/app/(app)/repairs/letter/page.tsx", /flyTravelSentence\(/],
    ["src/lib/renewal-outreach.ts", /flyTravelSentence\(/],
  ];
  for (const [f, line] of trvLetters) {
    const src = readFileSync(join(process.cwd(), f), "utf8");
    ok(/flightOf\(/.test(src) && line.test(src) && /travelLineAmount\(/.test(src),
      `#TRV: ${f} prints the one travel line at travel's share of the sell price in fly mode`);
    ok(!/lodging|perDiem|airfare/.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")),
      `#TRV: ${f} never prints the itemized airfare / lodging / per diem`);
  }
  const renewalLetters = readFileSync(join(process.cwd(), "src/lib/renewal-outreach.ts"), "utf8");
  ok((renewalLetters.match(/flight \? "priceLineFly" : rtMiles > 0 \? "priceLine" : "priceLineNoTravel"/g) || []).length === 2,
    "#TRV: both renewal PDFs pick the fly price line in fly mode");
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:specs 2>&1 | grep -E "#TRV: (flame_proposal|inspection_proposal|the fly price|src/|both renewal)" | head -20`
Expected: the `priceLineFly` and `flightOf` lines print `FAIL`.

- [ ] **Step 3: Template fields** (`src/lib/templates.ts`)

In `flame_proposal`, replace

```ts
        default:
          "Every one of your {{curtainsLabel}} inspected and documented on-site comes to {{price}}, all in.",
      },
```

with

```ts
        default:
          "Every one of your {{curtainsLabel}} inspected and documented on-site comes to {{price}}, all in.",
      },
      {
        id: "priceLineFly",
        label: "Price line (flights)",
        multiline: true,
        help: "Used when travel is priced as flights — air, lodging & per diem.",
        default:
          "Everything above — travel (air, lodging & per diem), the on-site hours, and every one of your {{curtainsLabel}} inspected and documented — comes to {{price}}, all in.",
      },
```

In `inspection_proposal`, replace

```ts
        default:
          "Every one of your {{lineSetsLabel}} inspected and documented on-site comes to {{price}}, all in.",
      },
```

with

```ts
        default:
          "Every one of your {{lineSetsLabel}} inspected and documented on-site comes to {{price}}, all in.",
      },
      {
        id: "priceLineFly",
        label: "Price line (flights)",
        multiline: true,
        help: "Used when travel is priced as flights — air, lodging & per diem.",
        default:
          "Everything above — travel (air, lodging & per diem), the on-site hours, and every one of your {{lineSetsLabel}} inspected and documented — comes to {{price}}, all in.",
      },
```

- [ ] **Step 4: Flame letter** (`src/app/(app)/flame-tests/letter/page.tsx`)

4a. Replace

```ts
import { getTravelRates } from "@/lib/stores/pricing";
```

with

```ts
import { getTravelRates } from "@/lib/stores/pricing";
import { TRAVEL_FLY_LINE, flightOf, travelLineAmount } from "@/lib/travel-plan";
```

4b. In `FlameTestDoc` replace

```ts
  rates?: { curtainMinutes?: number } | null;
```

with

```ts
  rates?: { curtainMinutes?: number; margin?: number } | null;
```

4c. Replace

```ts
  const travelHours = 2 * oneWayHours;
```

with

```ts
  // Flights over drive (spec 2026-09-25 §5): one customer-facing travel line.
  const flight = flightOf(ft.trip);
  const travelMargin = typeof ft.rates?.margin === "number" ? ft.rates.margin : quote.margin || 0;
  const travelHours = flight ? flight.travelHours : 2 * oneWayHours;
```

4d. Replace

```ts
  if (hasTrip) {
    scopeRows.push({
      item: pad2(sr++),
      desc: "Round-trip site mobilization from " + originCity,
```

with

```ts
  if (flight) {
    scopeRows.push({
      item: pad2(sr++),
      desc: TRAVEL_FLY_LINE,
      sub: "From " + originCity,
      qty: money(travelLineAmount(flight.total, travelMargin)),
      hours: num1(flight.travelHours) + " hrs",
    });
  } else if (hasTrip) {
    scopeRows.push({
      item: pad2(sr++),
      desc: "Round-trip site mobilization from " + originCity,
```

4e. Replace

```ts
    hasTrip ? "priceLine" : "priceLineNoTravel",
```

with

```ts
    flight ? "priceLineFly" : hasTrip ? "priceLine" : "priceLineNoTravel",
```

- [ ] **Step 5: Inspection letter** (`src/app/(app)/inspections/letter/page.tsx`)

5a. Replace

```ts
import { getTravelRates } from "@/lib/stores/pricing";
```

with

```ts
import { getTravelRates } from "@/lib/stores/pricing";
import { TRAVEL_FLY_LINE, flightOf, travelLineAmount } from "@/lib/travel-plan";
```

5b. In `InspectionDoc` replace

```ts
  trip?: { miles?: number; minutes?: number } | null;
  total?: number | null;
};
```

with

```ts
  trip?: { miles?: number; minutes?: number } | null;
  rates?: { margin?: number } | null;
  total?: number | null;
};
```

5c. Replace

```ts
  const travelHours = 2 * oneWayHours;
```

with

```ts
  // Flights over drive (spec 2026-09-25 §5): one customer-facing travel line.
  const flight = flightOf(insp.trip);
  const travelMargin = typeof insp.rates?.margin === "number" ? insp.rates.margin : quote.margin || 0;
  const travelHours = flight ? flight.travelHours : 2 * oneWayHours;
```

5d. Replace the `if (hasTrip) { scopeRows.push({ item: pad2(sr++), desc: "Round-trip site mobilization from " + originCity,` head exactly as in 4d (identical text in this file) with the 4d replacement.

5e. Replace

```ts
    hasTrip ? "priceLine" : "priceLineNoTravel",
```

with

```ts
    flight ? "priceLineFly" : hasTrip ? "priceLine" : "priceLineNoTravel",
```

- [ ] **Step 6: Repair letter** (`src/app/(app)/repairs/letter/page.tsx`)

6a. Replace

```ts
import { getTravelRates } from "@/lib/stores/pricing";
```

with

```ts
import { getTravelRates } from "@/lib/stores/pricing";
import { flightOf, flyTravelSentence, travelLineAmount } from "@/lib/travel-plan";
```

6b. In `RepairDoc` replace

```ts
  trip?: { miles?: number; minutes?: number } | null;
  total?: number | null;
};
```

with

```ts
  trip?: { miles?: number; minutes?: number } | null;
  rates?: { margin?: number } | null;
  total?: number | null;
};
```

6c. Replace the whole `travelParagraph` declaration

```ts
  const travelParagraph =
    "The distance from " +
    companyName +
    " (" +
    originCity +
    ") to " +
    venueName +
    " is approximately " +
    num1(oneWayMiles) +
    " miles, or about " +
    num1(oneWayHours) +
    " hours each way. We estimate approximately " +
    num1(laborHours) +
    " crew-hour" +
    (laborHours === 1 ? "" : "s") +
    " on site" +
    (crewSize > 1
      ? " (" + num1(hoursEach) + " hours × crew of " + crewSize + ")"
      : "") +
    ".";
```

with (drive-mode text is byte-identical to before)

```ts
  const crewSentence =
    " We estimate approximately " +
    num1(laborHours) +
    " crew-hour" +
    (laborHours === 1 ? "" : "s") +
    " on site" +
    (crewSize > 1
      ? " (" + num1(hoursEach) + " hours × crew of " + crewSize + ")"
      : "") +
    ".";
  // Flights over drive (spec 2026-09-25 §5): one customer-facing travel line.
  const flight = flightOf(rp.trip);
  const travelMargin = typeof rp.rates?.margin === "number" ? rp.rates.margin : quote.margin || 0;
  const travelParagraph = flight
    ? flyTravelSentence(
        companyName + " (" + originCity + ")",
        venueName,
        travelLineAmount(flight.total, travelMargin)
      ) + crewSentence
    : "The distance from " +
      companyName +
      " (" +
      originCity +
      ") to " +
      venueName +
      " is approximately " +
      num1(oneWayMiles) +
      " miles, or about " +
      num1(oneWayHours) +
      " hours each way." +
      crewSentence;
```

- [ ] **Step 7: Renewal PDF letters** (`src/lib/renewal-outreach.ts`)

7a. Replace the Task 3 import

```ts
import {
  carryTravelOverride,
  savedTrip,
  travelModeChangeReason,
} from "@/lib/travel-plan";
```

with

```ts
import {
  carryTravelOverride,
  flightOf,
  flyTravelSentence,
  savedTrip,
  travelLineAmount,
  travelModeChangeReason,
} from "@/lib/travel-plan";
```

7b. In `flameLetterDoc`, replace

```ts
  const rtMiles = (ft.trip && ft.trip.miles) || 0;
  if (rtMiles > 0) {
```

with

```ts
  const rtMiles = (ft.trip && ft.trip.miles) || 0;
  // Flights over drive (spec 2026-09-25 §5): one customer-facing travel line.
  const flight = flightOf(ft.trip);
  if (flight) {
    const curtainMin = (ft.rates && ft.rates.curtainMinutes) || 5;
    const margin = typeof ft.rates?.margin === "number" ? ft.rates.margin : quote.margin || 0;
    blocks.push({
      kind: "p",
      text:
        flyTravelSentence(`${companyName} (${originCity})`, venueName, travelLineAmount(flight.total, margin)) +
        ` The on-site inspection should take approximately ${num1((curtainsTotal * curtainMin) / 60)} hours.`,
    });
  } else if (rtMiles > 0) {
```

7c. In `inspectionLetterDoc`, replace

```ts
  const rtMiles = (insp.trip && insp.trip.miles) || 0;
  if (rtMiles > 0) {
```

with

```ts
  const rtMiles = (insp.trip && insp.trip.miles) || 0;
  // Flights over drive (spec 2026-09-25 §5): one customer-facing travel line.
  const flight = flightOf(insp.trip);
  if (flight) {
    const margin = typeof insp.rates?.margin === "number" ? insp.rates.margin : quote.margin || 0;
    blocks.push({
      kind: "p",
      text:
        flyTravelSentence(`${companyName} (${insp.office || "our office"})`, venueName, travelLineAmount(flight.total, margin)) +
        ` The on-site inspection should take approximately ${num1(insp.inspectHours || 0)} hours.`,
    });
  } else if (rtMiles > 0) {
```

7d. Replace **both** occurrences (Edit with `replace_all: true`) of

```ts
      rtMiles > 0 ? "priceLine" : "priceLineNoTravel",
```

with

```ts
      flight ? "priceLineFly" : rtMiles > 0 ? "priceLine" : "priceLineNoTravel",
```

(`flight` is in scope in both letter builders after 7b/7c.)

- [ ] **Step 8: Run the tests, type-check, lint, smoke**

Run: `npx tsc --noEmit; echo "tsc exit $?"` — expected `tsc exit 0`.
Run: `npm run test:specs 2>&1 | grep -E "#TRV|FAIL|ALL PASSED" | tail -100` — expected all `PASS`, `ALL PASSED`.
Run: `npx eslint 2>&1 | tail -3` — expected `0 errors`, warnings ≤ baseline.
Run: `npm run test:smoke 2>&1 | tail -8` — expected `ALL PASSED` (covers `/flame-tests/letter?id=FT-3001` and the other letters).

- [ ] **Step 9: Commit**

```bash
git add src/lib/templates.ts "src/app/(app)/flame-tests/letter/page.tsx" "src/app/(app)/inspections/letter/page.tsx" "src/app/(app)/repairs/letter/page.tsx" src/lib/renewal-outreach.ts scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(travel): letters and renewal PDFs print one fly-mode travel line

In fly mode the flame / inspection letters' mobilization row, the repair
letter's distance sentence and both renewal PDFs read "Travel (air,
lodging & per diem)" with travel's share of the sell price; a new
priceLineFly template field replaces "the drive" wording. Drive mode
text is unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Decision log, punch entry, full gate run

**Files:**
- Modify: `DECISIONS.md` (append at end of file)
- Modify: `PUNCHLIST.md` (append at end of file)

**Interfaces:**
- Consumes: everything above (for the write-up).
- Produces: nothing code-facing.

**Numbering:** use the placeholders **`D-TRV-1` … `D-TRV-5`** and **`#TRV`** exactly as written below. Do NOT pick real D-numbers or punch numbers — two sessions write to `main` in parallel and numbers collide within the hour; **the controller renumbers these at merge time** from `origin/main` (and rewrites the `#TRV` / `D-TRV-n` references in the test messages, code comments and commit-free docs in the same pass).

- [ ] **Step 1: Append to `DECISIONS.md`**

```markdown

## D-TRV-1. Auto-priced service quotes fly once one trip's drive cost reaches a threshold (#TRV, 2026-09-25)

Jeff: "once we reach 1000 dollars in travel expenses, then it switches to flights and hotels with allowances." A pure,
import-free planner (`src/lib/travel-plan.ts`) runs in the flame-test, repair and inspection engines, their builder
previews, the save actions and renewal re-pricing, so every path applies one rule. Trigger: the engines' existing
per-trip drive cost (`trip.total` = mileage + drive-time labor) ≥ `flyThreshold` (default $1,000; 0 = never fly),
overridable per quote as Auto · Drive · Fly. Fly = crew × airfare + crew × nights × hotel + crew × (nights + 1) × per
diem + ⌈crew ÷ 2⌉ × (nights + 1) × car + crew × hours each way × 2 × the service's labor rate; nights default to
⌈on-site hours ÷ (crew × hours per day)⌉; crew, nights and airfare are editable on the quote (blank = default, shown
as the placeholder). Flight rates live in the shared `travel_rates` blob and each service's default crew in its own
rates blob (flame 1, repair 2, inspection 1), all in Estimating Rules; missing keys fall back to the defaults — no
migration. Drive mode returns the drive total itself, so drive-mode prices are bit-for-bit unchanged, and saved
quotes keep their stored price until someone re-prices them. `trip` keeps the drive numbers and gains `mode` (and
`flight` when flying); the per-quote override is saved as `travel` on the service subdoc.

## D-TRV-2. Repairs fly at least the crew the labor is priced for; travel labor bills at the base rate (#TRV, 2026-09-25)

The spec's default repair crew is 2, but a repair quote already carries a crew size. The flying crew defaults to
`max(repair_rates.flyCrew, the quote's crew size)` so a crew of 3 is never priced as 2 flights. Travel-day labor
bills at the service's base labor rate even on emergency quotes — the same rate drive time already uses; only
on-site labor takes the emergency multiplier.

## D-TRV-3. Customers see one travel line, at travel's share of the sell price (#TRV, 2026-09-25)

In fly mode the letters, quote documents and renewal PDFs print one line, "Travel (air, lodging & per diem)", with
the flight cost marked up by the quote's margin (`flight.total ÷ (1 − margin)`, rounded) — never a bare cost figure
next to an all-in price. It replaces the round-trip mobilization row (flame, inspection) and the distance sentence
(repair); the hours column shows the travel-day hours. The proposals' `priceLine` says "the drive", so a new
editable template field `priceLineFly` ("Everything above — travel (air, lodging & per diem), …") is used in fly
mode. The itemized airfare / lodging / per diem / car / travel labor stays builder-only.

## D-TRV-4. Renewals keep last year's travel choice, not last year's airfare (#TRV, 2026-09-25)

Renewal re-pricing (D69, current rates) carries the prior quote's travel override — mode, crew, nights — but drops
its manual airfare, which is a one-year number; the allowance applies. When the renewal's mode differs from last
year's, the email's "why the price changed" list gains "travel now being priced as flights, lodging & per diem
instead of a drive" (or "…as a drive instead of flights").

## D-TRV-5. The quote-builder previews use the live road factor and speed (#TRV, 2026-09-25)

The three builders' inlined previews hardcoded 1.25 / 50 mph while the server re-priced with the Estimating Rules
values. With a threshold on the drive total the two could disagree on drive vs fly, so the pages now hand the
builders the live `travel_rates` blob and the previews use it. Server totals are unchanged.
```

- [ ] **Step 2: Append to `PUNCHLIST.md`**

```markdown


---

## #TRV. Auto-priced service quotes — flights over drive past a drive-cost threshold — DONE 2026-09-25 (D-TRV-1…D-TRV-5)

**Reported:** 2026-09-25 (Jeff, brainstorm): "once we reach 1000 dollars in travel expenses, then it switches to
flights and hotels with allowances." Spec: `docs/superpowers/specs/2026-09-25-travel-flights-design.md`; plan:
`docs/superpowers/plans/2026-09-25-travel-flights.md`.

**Done.**
- **One rule everywhere** — `src/lib/travel-plan.ts` (pure, client-safe) prices flights when one trip's drive cost
  reaches the threshold (default $1,000), used by the flame / repair / inspection engines, their builder previews,
  the save actions and renewal re-pricing. Drive-mode prices are unchanged; saved quotes keep their price.
- **Estimating Rules** — Travel & mileage gains the fly threshold, airfare allowance, hotel, per diem, rental car,
  travel-day hours and on-site hours per day; each service group gains its default flying crew (1 / 2 / 1).
- **Builders** — a Travel: Auto · Drive · Fly control; in fly mode crew / nights / airfare per person (defaults as
  placeholders) and the itemized airfare / lodging / per diem / car / travel labor, plus "Drive would be $X — over
  the $1,000 threshold, priced as flights." when Auto switched.
- **Customer documents** — one "Travel (air, lodging & per diem)" line at travel's share of the sell price on the
  flame / inspection / repair letters and both renewal PDFs; new `priceLineFly` template field.
- **Renewals** — carry last year's travel choice (not its airfare) and say so when the mode flips.

**Still open.** Live airfare lookup, per-venue split trips and Estimator mobilization stay out of scope (spec §7).
A browser check of the three builders in fly mode on a scratch datadir is the lead's call (never against
`.data/pglite`). Jeff to confirm the default allowances once real trips are priced.
```

- [ ] **Step 3: Full gate run (report the real numbers)**

```bash
npx tsc --noEmit; echo "tsc exit $?"
npx eslint 2>&1 | tail -3
npm run test:specs 2>&1 | tail -3
npm run test:specs 2>&1 | grep -c "^PASS #TRV"
D=$(mktemp -d); env -u DATABASE_URL PGLITE_PATH=$D npx tsx scripts/test-review-regressions.ts 2>&1 | tail -5; echo "regressions exit $?"
npm run test:smoke 2>&1 | tail -5
env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npm run build 2>&1 | tail -20; rm -rf .next
git status --short   # must show only DECISIONS.md and PUNCHLIST.md (next-env.d.ts / .env.local are gitignored)
```

Expected: tsc exit 0 · eslint `0 errors` and warnings = baseline · test:specs `ALL PASSED` with every `#TRV` check passing · regressions exit 0 · smoke `ALL PASSED` · build compiles with the route table · `.next` removed.

- [ ] **Step 4: Commit**

```bash
git add DECISIONS.md PUNCHLIST.md
git commit -m "$(cat <<'EOF'
docs: flights over drive — decisions D-TRV-1…5 and punch #TRV (placeholders)

Placeholder numbers; renumber from origin/main at merge time.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review

**Spec coverage.**
- §1/§2.1 scope (three quotes + builders, previews, renewals, letters, quote docs; not Estimator/rentals/consulting) → Tasks 2-5; Global Constraints fence the Estimator.
- §2.2 trigger = per-trip drive cost vs threshold, `≥`, automatic with override → Task 1 `planTravel` (+ boundary tests), Task 2 engines, Task 4 control.
- §2.3 allowances in Estimating Rules + manual airfare on the quote → Task 1 rows, Task 4 airfare input, `override.airfarePerPerson`.
- §2.4 default crew per service, days from on-site hours, shown + overridable → Task 1 defaults/rows, Task 2 on-site hours per engine, Task 4 inputs.
- §2.5 one customer line → Task 1 `TRAVEL_FLY_LINE`, Task 5.
- §3 formulas, drive bit-for-bit, `plan.total` replaces `trip.total`, margin/min/rounding unchanged → Task 1 + Task 2 (hard-coded pre-change fixtures).
- §3 rate table + labels + per-service crew + missing-key fallback → Task 1 (`resolveFlyRates`, `ResolvedTravelRates`, registry test).
- §3 on-site hours per engine → Task 2 (flame curtain minutes ÷ 60, repair labor hours, inspection `inspectHours`).
- §4 saved `travel?` override, no migration, `trip.mode` + `flight`, saved quotes keep price → Task 3 (+ Task 4 reload).
- §5 builders (control, fly fields, itemization, note text) → Task 4; letters/quote docs → Task 5; renewal flip wording → Tasks 1 + 3; Estimating Rules → Task 1.
- §6 tests: boundary (999.99 / 1000 / 0), forced drive over / forced fly under, workDays/nights/tripDays incl. crew + nights overrides, airfare override, `ceil(crew/2)`, labor rate, each engine drive-unchanged + fly hand-computed, renewal flip wording, missing keys → Tasks 1-2; gates → every task, all six in Task 6.
- §7 out of scope → PUNCHLIST "Still open".

**Placeholder scan.** No TBD/TODO. `D-TRV-n` / `#TRV` are deliberate, flagged for the controller to renumber.

**Type consistency.** `TravelPlan.total/flight/mode/choice/autoMode/driveTotal/threshold/defaults`, `FlightPlan.travelHours`, `TripMode`, `TravelOverride`, `TravelDraft` are defined in Task 1 and used with the same names in Tasks 2-5. Engine results expose `trip` (drive + `mode`/`flight`) and `travel` (plan) in all three engines and all three previews. `computeEstimate(opts, C, travel?)` third param is `Partial<FlyRates> | null` in repair and inspection; flame keeps `travel: TravelRates`. `BuilderTravelRates` is per-builder and structurally equals `ResolvedTravelRates`.
