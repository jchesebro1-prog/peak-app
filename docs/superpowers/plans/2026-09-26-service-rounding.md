# Service Quotes: $25 Rounding, Typed Total, Editable Testing Cost (#217) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flame-test, repair and inspection quotes auto-round their total to the nearest $25, let the estimator type their own total (the margin back-solves), and let a flame-test venue's testing cost be typed. Letters, renewals and the builders all use the same numbers.

**Architecture:** A new import-free module `src/lib/service-pricing.ts` holds every rule: `roundToStep`, override parsing, and one "finish" function per service (`finishFlame` / `finishRepair` / `finishInspection`) that turns cost into the final price. The three server engines and the three `"use client"` builder previews call the same finish function, so builder/engine parity is structural rather than duplicated (D285). Save actions validate and persist `priceOverride` (and flame `venues[].testingOverride`). Renewals re-price with the auto-rounding and never carry overrides. Letters print the fly-mode travel line as travel's share of the final total (`travelLineShare`), so the printed line can never exceed the total. A shared client component `src/components/service-total-field.tsx` renders the Total input, "Reset to auto" and the low-margin warning in all three builders.

**Tech Stack:** Next.js 16 App Router (server components + server actions), TypeScript, the `scripts/test-review-and-spec.ts` assertion harness (`npm run test:specs`).

**Spec:** `docs/superpowers/specs/2026-09-26-venues-and-service-rounding-design.md`, section "#217" (ignore #216).

## Global Constraints

- Work only in `/Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks` (branch `feat/punch-inbox-tasks`). Every shell starts with `export PATH=$HOME/.local/node/bin:$PATH && cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks`.
- Rounding: `roundToStep(x, step = 25)` = nearest multiple, half rounds up. Floors (flame `baseFee`, repair `minCallout`, inspection `minFee`) apply **before** rounding.
- Typed total: `priceOverride` on the quote's service subdoc (`flameTest` / `repair` / `inspection`), whole dollars, `> 0` and `≤ 10,000,000`. It's used exactly, never re-rounded. No 5–50 margin clamp applies to it. The stored margin is the back-solved one.
- Flame testing cost: `venues[].testingOverride` (whole dollars, `≥ 0`). Blank means computed. That venue's `laborCost = testingOverride` in the engine, the preview and the save.
- Renewals re-price at current rates and round to $25. `priceOverride` and `testingOverride` are **never** carried over.
- `src/lib/service-pricing.ts` has **no imports** (it runs in client bundles). Client components (`"use client"`) never import a value from `@/lib/stores/*`, `@/db/*`, or any engine module (`@/lib/flametest-engine`, `@/lib/repair-engine`, `@/lib/inspection-engine`). Only `next build` catches a violation, so UI tasks run it.
- Not in scope: the Estimator, Grid, Quick Design, rentals.
- No DB migration. Quote subdocs are untyped JSONB (`flameTest?: unknown` etc. in `src/lib/stores/quotes.ts:185-189`). New fields are optional, and old docs read unchanged.
- Harness assertions are labelled `#217 …`. New harness imports use `217`-suffixed aliases. New synchronous blocks are appended at the **end of** `scripts/test-review-and-spec.ts` (the #212 blocks prove top-level blocks at EOF run and count). The harness already imports `computeFlameQuote`, `FTVenue` (line 4164), `trvRepairEstimate`, `trvInspectionEstimate` (10182-10183), `PRICING_GROUPS` (4051), `readFileSync` (242), `join` (243), and defines `ok` (324). Reuse them.
- Do not write DECISIONS.md or PUNCHLIST.md entries. Do not run `npm run dev` or any `db:*` script. `npm run test:specs` uses its own `mktemp -d` datadir and is safe.
- Gates at the end of every task: `npx tsc --noEmit` → 0 errors; `npm run test:specs` → 0 `FAIL` lines (report the PASS count: `npm run test:specs 2>&1 | grep -c '^PASS'`); `npx eslint <changed files>` → 0 errors. UI tasks (3, 4) also run `npx next build` → exit 0 (first check `lsof -i :3000` shows no dev server from this worktree).
- Commit messages: `feat(pricing): … (#217)`, then a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `git add` only the files the task names. If git reports `index.lock`, wait a few seconds and retry.

## Spec ambiguities resolved (read before starting)

1. **Whole dollars.** Typed totals and typed testing costs are rounded to whole dollars on parse (`"1,234.40"` → 1234). Quote values are whole dollars everywhere (`quotes.update` rounds `value`, and `money()` prints whole dollars).
2. **Repairs have two margins.** The slider is the *service* margin, and parts keep their own markup. For repairs, the rounding difference (or a typed total) is absorbed into the service sell (`serviceSell = total − partsSell`), and the back-solved margin shown and stored is `serviceMargin = 1 − serviceCost ÷ serviceSell`. The warning compares `serviceMargin` to 10% and the total to the whole job cost.
3. **Stored `quote.margin` is always the back-solved margin** (auto or typed), which matches `quotes.ts:172-173` ("`margin` stays the blended actual"). The `rates` snapshot on the subdoc keeps the slider's margin, so renewal change-reason diffs are unaffected.
4. **"Reset to auto" leaves the slider where the typed total put it** (clamped to 10–50), then the total re-rounds at that margin. Moving the slider also clears the override. Picking a different customer clears it.
5. **Printed-line reconciliation.** The only dollar component line any letter prints is the D283 fly-mode travel line. It is now `travelLineShare()`: `round(flight × total ÷ cost)`, clamped to `[0, total]`. The service part (the rest) absorbs the rounding and typed-total difference, so printed lines always sum to the total. A legacy quote with no stored `cost` keeps D283's `flight ÷ (1 − margin)`, still clamped.
6. **Hand-set renewal wording.** This line goes in the customer-facing draft, so it reads: "Last year's price was hand-set at $X; this year's is priced at our current rates." It appears only when last year's quote had a `priceOverride`, and only on the first mint (a re-opened existing renewal keeps its draft, D75).
7. **D286 parity (sent quotes don't silently change price).** A quote past draft that was saved before #217 with a value off the $25 grid reopens in the builder with that value already typed as the total (`seedPriceOverride`). Re-saving keeps the price the customer saw. Drafts and on-grid values reopen on auto.
8. **A $0 testing cost is a real figure** (free testing). Blank means computed.
9. **The warning shows only for a typed total.** An invalid typed entry (e.g. `abc`, `0`) prices at auto and says so under the field.
10. **Estimating Rules formula strings** for `flame.total`, `repair.total` and `inspection.total` gain "·  rounded to the nearest $25" (the #208 M4 `includes` checks still pass).

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/lib/service-pricing.ts` | create | Pure, no imports: `roundToStep`, `normalizePriceOverride`, `normalizeTestingOverride`, `sellAtMargin`, `finishPrice`, `finishFlame`, `finishRepair`, `finishInspection`, `venueTesting`, `typedPriceWarning`, `sliderPts`, `fmtPts`, `fmtDollars`, `travelLineShare`, `seedPriceOverride` |
| `src/lib/flametest-engine.ts` | modify | `priceVenue` honours `testingOverride`; `compute` finishes through `finishFlame` with `priceOverride` |
| `src/lib/repair-engine.ts` | modify | `computeEstimate` finishes through `finishRepair` |
| `src/lib/inspection-engine.ts` | modify | `computeEstimate` finishes through `finishInspection` |
| `src/lib/stores/pricing.ts` | modify | Three formula strings mention the $25 rounding |
| `src/app/(app)/flame-tests/quote/actions.ts` | modify | Parse and persist `priceOverride` + `venues[].testingOverride`; store back-solved margin, `autoTotal` |
| `src/app/(app)/repairs/quote/actions.ts` | modify | Parse and persist `priceOverride`; store `serviceMargin`, `autoTotal` |
| `src/app/(app)/inspections/quote/actions.ts` | modify | Parse and persist `priceOverride`; store back-solved margin, `autoTotal` |
| `src/lib/renewal-outreach.ts` | modify | Export `priceParagraph` + hand-set sentence, `priorHandSetPrice`; store back-solved margin; travel line via `travelLineShare` |
| `src/app/(app)/{flame-tests,inspections,repairs}/letter/page.tsx` | modify | Travel line via `travelLineShare` |
| `src/components/service-total-field.tsx` | create | Client Total input + "Reset to auto" + warning |
| `src/app/(app)/flame-tests/quote/controls.tsx` + `page.tsx` | modify | Builder finishes through `finishFlame`; Total input; Testing cell inputs; reopen seeding |
| `src/app/(app)/repairs/quote/controls.tsx` + `page.tsx` | modify | Builder finishes through `finishRepair`; Total input; reopen seeding |
| `src/app/(app)/inspections/quote/controls.tsx` + `page.tsx` | modify | Builder finishes through `finishInspection`; Total input; reopen seeding |
| `scripts/test-review-and-spec.ts` | modify | Update six #208 totals + one #208 letter regex; append `#217` blocks |

---

### Task 1: Pure pricing finish + engines round to $25 and accept overrides

**Files:**
- Create: `src/lib/service-pricing.ts`
- Modify: `src/lib/flametest-engine.ts` (imports 1-15; types `FlameTestVenueInput` ~137-146, `VenuePrice` ~169-176, `FlameTestComputeOpts` ~178-183, `FlameTestPricing` ~185-208; `priceVenue` 219-234; `compute` tail 327-361)
- Modify: `src/lib/repair-engine.ts` (imports 1-11; `RepairEstimateOptions` ~211-224; `RepairEstimate` ~226-252; `computeEstimate` tail 277-317)
- Modify: `src/lib/inspection-engine.ts` (imports 1-17; `InspectionEstimateOptions` ~83-92; `InspectionEstimate` ~94-116; `computeEstimate` tail 142-172)
- Modify: `src/lib/stores/pricing.ts:414,430,448`
- Test: `scripts/test-review-and-spec.ts` (update #208 lines 10192-10233; append at EOF)

**Interfaces:**
- Consumes: nothing new.
- Produces (all exported from `@/lib/service-pricing`):
  - `PRICE_STEP = 25`, `PRICE_OVERRIDE_MAX = 10_000_000`, `LOW_MARGIN_WARN = 0.1`, `MARGIN_SLIDER_MIN = 10`, `MARGIN_SLIDER_MAX = 50`
  - `roundToStep(x: number, step?: number): number`
  - `normalizePriceOverride(raw: unknown): number | undefined` (whole dollars, 1…10,000,000)
  - `normalizeTestingOverride(raw: unknown): number | undefined` (whole dollars, 0…10,000,000)
  - `sellAtMargin(cost: number, margin: number): number`
  - `type FinishedPrice = { totalRaw; autoTotal; total; priceOverride: number | null; overridden: boolean; marginAmount; effectiveMargin }` (all `number` except noted)
  - `finishPrice(totalRaw: number, cost: number, priceOverride?: number | null): FinishedPrice`
  - `type FlameFinish = FinishedPrice & { rawCost; baseFee; baseApplied: boolean; cost; margin }`, `finishFlame({ rawCost, baseFee, margin, priceOverride? }): FlameFinish`
  - `type InspectionFinish = FinishedPrice & { cost; sellRaw; minFee; minApplied: boolean; margin }`, `finishInspection({ cost, minFee, margin, priceOverride? }): InspectionFinish`
  - `type RepairFinish = FinishedPrice & { serviceCost; serviceSellRaw; minCallout; calloutApplied: boolean; serviceSellAuto; partsCost; partsSell; serviceSell; cost; margin; partsMargin; serviceMargin }`, `finishRepair({ serviceCost, minCallout, margin, partsCost, partsMargin, priceOverride? }): RepairFinish`
  - `venueTesting(computedCost: number, raw: unknown): { laborCost: number; computedCost: number; testingOverride: number | null }`
  - `type PriceWarning = { kind: "below-cost" | "low-margin"; text: string } | null`, `typedPriceWarning(total, cost, margin): PriceWarning`
  - `sliderPts(margin: number): number` (clamped 10–50), `fmtPts(margin: number): string` (one decimal), `fmtDollars(n: number): string`
  - `travelLineShare({ flightTotal, total, cost?, margin? }): { travel: number; rest: number }`
  - `seedPriceOverride(status: string, value: unknown, saved: unknown): number | null`
- Engine results gain: flame `FlameTestPricing` + `totalRaw, autoTotal, priceOverride, overridden, effectiveMargin`, and `VenuePrice` + `computedCost, testingOverride`; `RepairEstimate` + `serviceSellAuto, totalRaw, autoTotal, priceOverride, overridden, effectiveMargin, serviceMargin` (`serviceSell` is now `total − partsSell`); `InspectionEstimate` + `totalRaw, autoTotal, priceOverride, overridden, effectiveMargin`. Options gain `priceOverride?: number | string | null`, and `FlameTestVenueInput` gains `testingOverride?: number | string | null`.

- [ ] **Step 0: Record the baseline**

Run: `npm run test:specs 2>&1 | grep -c '^PASS'` and `npm run test:specs 2>&1 | grep '^FAIL' | head`
Expected: a PASS count (write it down as BASE) and no FAIL lines.

- [ ] **Step 1: Update the six #208 engine totals that rounding changes**

In `scripts/test-review-and-spec.ts`, make these six exact replacements (all inside the `/* --- #208 engines: …` block starting at line 10179):

```ts
  ok(fd.trip.total === 500 && fd.testingSubtotal === 75 && fd.rawCost === 575 && near(fd.total, 575 / (1 - 0.3)),
    "#208 flame: a $500 drive prices exactly as before (575 cost → 821.43)");
```
→
```ts
  ok(fd.trip.total === 500 && fd.testingSubtotal === 75 && fd.rawCost === 575 && near(fd.totalRaw, 575 / (1 - 0.3)) && fd.total === 825,
    "#208 flame: a $500 drive prices exactly as before (575 cost → 821.43, #217 rounds to 825)");
```

```ts
  ok(ff.trip.total === 2200 && ff.trip.mode === "fly" && ff.travel?.total === 1765 && ff.rawCost === 2515 && near(ff.total, 2515 / (1 - 0.3)),
```
→
```ts
  ok(ff.trip.total === 2200 && ff.trip.mode === "fly" && ff.travel?.total === 1765 && ff.rawCost === 2515 && near(ff.totalRaw, 2515 / (1 - 0.3)) && ff.total === 3600,
```

```ts
  ok(rd.trip.total === 307.5 && rd.serviceCost === 607.5 && near(rd.total, 607.5 / (1 - 0.3)) && rd.trip.mode === "drive",
```
→
```ts
  ok(rd.trip.total === 307.5 && rd.serviceCost === 607.5 && near(rd.totalRaw, 607.5 / (1 - 0.3)) && rd.total === 875 && rd.trip.mode === "drive",
```

```ts
  ok(rf.trip.mode === "fly" && rf.trip.flight?.crew === 2 && rf.travel?.total === 3305 && rf.serviceCost === 5105 && near(rf.total, 5105 / (1 - 0.3)),
```
→
```ts
  ok(rf.trip.mode === "fly" && rf.trip.flight?.crew === 2 && rf.travel?.total === 3305 && rf.serviceCost === 5105 && near(rf.totalRaw, 5105 / (1 - 0.3)) && rf.total === 7300,
```

```ts
  ok(idr.trip.total === 307.5 && idr.cost === 832.5 && near(idr.total, 832.5 / (1 - 0.3)) && idr.trip.mode === "drive",
```
→
```ts
  ok(idr.trip.total === 307.5 && idr.cost === 832.5 && near(idr.totalRaw, 832.5 / (1 - 0.3)) && idr.total === 1200 && idr.trip.mode === "drive",
```

```ts
  ok(ifl.inspectHours === 12 && ifl.trip.mode === "fly" && ifl.travel?.total === 1765 && ifl.cost === 2665 && near(ifl.total, 2665 / (1 - 0.3)),
```
→
```ts
  ok(ifl.inspectHours === 12 && ifl.trip.mode === "fly" && ifl.travel?.total === 1765 && ifl.cost === 2665 && near(ifl.totalRaw, 2665 / (1 - 0.3)) && ifl.total === 3800,
```

- [ ] **Step 2: Append the failing #217 T1 block at the end of `scripts/test-review-and-spec.ts`**

```ts

/* ====================================================================
   #217 T1 — service quotes round to $25, take a typed total and (flame) a
   typed per-venue testing cost. The pure finish module + the three engines.
   ==================================================================== */
import {
  PRICE_STEP as PRICE_STEP217,
  roundToStep as roundToStep217,
  normalizePriceOverride as normalizePriceOverride217,
  normalizeTestingOverride as normalizeTestingOverride217,
  finishFlame as finishFlame217,
  finishRepair as finishRepair217,
  finishInspection as finishInspection217,
  typedPriceWarning as typedPriceWarning217,
  sliderPts as sliderPts217,
  fmtPts as fmtPts217,
  travelLineShare as travelLineShare217,
  seedPriceOverride as seedPriceOverride217,
} from "@/lib/service-pricing";
{
  const near217 = (a: number | undefined, b: number): boolean => a != null && Math.abs(a - b) < 1e-6;

  // ---- pure rules ----
  ok(PRICE_STEP217 === 25, "#217: the rounding step is $25");
  ok(roundToStep217(821.43) === 825 && roundToStep217(812.49) === 800 && roundToStep217(812.5) === 825 && roundToStep217(837.5) === 850,
    "#217 roundToStep: nearest $25, half rounds up");
  ok(roundToStep217(0) === 0 && roundToStep217(25) === 25 && roundToStep217(Number.NaN) === 0 && roundToStep217(14, 10) === 10 && roundToStep217(15, 10) === 20,
    "#217 roundToStep: exact multiples stay, NaN is 0, a custom step works");
  ok(roundToStep217(862.4999999999999) === 875, "#217 roundToStep: float noise just under a half still rounds up");
  ok(normalizePriceOverride217("1,234.40") === 1234 && normalizePriceOverride217("$900") === 900 && normalizePriceOverride217(950) === 950 && normalizePriceOverride217(10_000_000) === 10_000_000,
    "#217 priceOverride: whole dollars, $ and commas tolerated, up to $10,000,000");
  ok([0, -5, 10_000_001, "abc", "", null, undefined, true].every((v) => normalizePriceOverride217(v) === undefined),
    "#217 priceOverride: zero, negative, over the cap, junk and blank are no override");
  ok(normalizeTestingOverride217("0") === 0 && normalizeTestingOverride217(" 120 ") === 120 && normalizeTestingOverride217("") === undefined && normalizeTestingOverride217(-1) === undefined,
    "#217 testingOverride: $0 is a real figure, blank is computed, negatives refused");
  ok(typedPriceWarning217(500, 575, 1 - 575 / 500)?.kind === "below-cost" && typedPriceWarning217(600, 575, 1 - 575 / 600)?.kind === "low-margin" && typedPriceWarning217(800, 575, 1 - 575 / 800) === null,
    "#217 warning: below cost first, then under a 10% margin, otherwise none");
  ok(sliderPts217(0.05) === 10 && sliderPts217(0.62) === 50 && sliderPts217(0.3) === 30 && sliderPts217(0.28125) === 28,
    "#217 slider: the back-solved margin moves the slider, clamped to 10–50");
  ok(fmtPts217(0.28125) === "28.1" && fmtPts217(0.3) === "30", "#217: the margin label shows the true value to one decimal");
  const s1 = travelLineShare217({ flightTotal: 1765, total: 3600, cost: 2515, margin: 0.3 });
  ok(s1.travel === 2526 && s1.rest === 1074 && s1.travel + s1.rest === 3600,
    "#217 printed lines: the travel line is travel's share of the rounded total; the service part takes the rest");
  const s2 = travelLineShare217({ flightTotal: 1765, total: 1000, cost: 2515, margin: 0.3 });
  ok(s2.travel === 702 && s2.travel + s2.rest === 1000, "#217 printed lines: a typed total below cost scales the travel line with it");
  const s3 = travelLineShare217({ flightTotal: 1765, total: 3593, cost: null, margin: 0.3 });
  ok(s3.travel === 2521 && s3.rest === 3593 - 2521, "#217 printed lines: a legacy quote with no stored cost keeps the D283 figure");
  const s4 = travelLineShare217({ flightTotal: 1765, total: 1000, cost: null, margin: 0 });
  ok(s4.travel === 1000 && s4.rest === 0, "#217 printed lines: the travel line never exceeds the total");
  ok(seedPriceOverride217("sent", 821, undefined) === 821 && seedPriceOverride217("won", 821.4, null) === 821,
    "#217 D286 parity: a pre-#217 sent quote priced off the $25 grid reopens with that price typed in");
  ok(seedPriceOverride217("draft", 821, undefined) === null && seedPriceOverride217("sent", 825, undefined) === null && seedPriceOverride217("sent", 0, undefined) === null,
    "#217: drafts, on-grid prices and zero values reopen on auto");
  ok(seedPriceOverride217("draft", 825, 900) === 900 && seedPriceOverride217("sent", 821, "900") === 900,
    "#217: a saved typed total always reopens as typed");

  // ---- flame engine ----
  const fRates217 = { mileageRate: 1, laborRate: 75, curtainMinutes: 5, baseFee: 150, margin: 0.3, travelRoundMin: 15 };
  const fNear217: FTVenue = { id: "r217-near", label: "Near", curtains: 12, oneWayMiles: 100, oneWayMin: 120 };
  const fa = computeFlameQuote({ venues: [fNear217] }, fRates217);
  ok(near217(fa.totalRaw, 575 / 0.7) && fa.autoTotal === 825 && fa.total === 825 && !fa.overridden && fa.priceOverride === null,
    "#217 flame: the auto total rounds 821.43 → 825");
  ok(fa.marginAmount === 250 && near217(fa.effectiveMargin, 1 - 575 / 825) && fa.margin === 0.3,
    "#217 flame: margin amount = total − cost, the effective margin back-solves, the rate margin is unchanged");
  const fo = computeFlameQuote({ venues: [fNear217], priceOverride: 800 }, fRates217);
  ok(fo.total === 800 && fo.overridden && fo.priceOverride === 800 && fo.autoTotal === 825 && near217(fo.effectiveMargin, 1 - 575 / 800) && fo.marginAmount === 225,
    "#217 flame: a typed total is used exactly and the margin back-solves");
  ok(computeFlameQuote({ venues: [fNear217], priceOverride: 812 }, fRates217).total === 812,
    "#217 flame: a typed total off the $25 grid is not re-rounded");
  const fBad = computeFlameQuote({ venues: [fNear217], priceOverride: "abc" }, fRates217);
  ok(fBad.total === 825 && !fBad.overridden, "#217 flame: an invalid typed total prices at auto");
  const ft = computeFlameQuote({ venues: [{ ...fNear217, testingOverride: 100 }] }, fRates217);
  ok(ft.perVenue[0].laborCost === 100 && ft.perVenue[0].computedCost === 75 && ft.perVenue[0].testingOverride === 100 && ft.testingSubtotal === 100 && ft.rawCost === 600 && ft.total === 850,
    "#217 flame: a typed testing cost replaces that venue's labor and the auto total re-rounds (857.14 → 850)");
  const ftBlank = computeFlameQuote({ venues: [{ ...fNear217, testingOverride: "" }] }, fRates217);
  ok(ftBlank.perVenue[0].laborCost === 75 && ftBlank.perVenue[0].testingOverride === null, "#217 flame: a blank testing cost is computed");
  const fFloor = computeFlameQuote({ venues: [{ id: "r217-here", label: "Here", curtains: 1, oneWayMiles: 0, oneWayMin: 0 }] }, fRates217);
  ok(fFloor.baseApplied && fFloor.cost === 150 && fFloor.total === 225,
    "#217 flame: the base fee floors the cost first, then the total rounds (214.29 → 225)");

  // ---- repair engine ----
  const rRates217 = { laborRate: 75, mileageRate: 1, minCallout: 350, partsMargin: 0.3, margin: 0.3, emergencyMult: 1.5, travelRoundMin: 15 };
  const rNear217 = [{ label: "Near", oneWayMiles: 60, oneWayMin: 70 }];
  const ra = trvRepairEstimate({ venues: rNear217, laborHours: 4 }, rRates217);
  ok(near217(ra.totalRaw, 607.5 / 0.7) && ra.total === 875 && ra.serviceSell === 875 && near217(ra.serviceMargin, 1 - 607.5 / 875),
    "#217 repair: the auto total rounds 867.86 → 875 and the service sell absorbs the difference");
  const rp = trvRepairEstimate({ venues: rNear217, laborHours: 4, parts: [{ name: "Cable", qty: 2, cost: 100 }] }, rRates217);
  ok(rp.total === 1150 && near217(rp.partsSell, 200 / 0.7) && near217(rp.serviceSell, 1150 - 200 / 0.7) && near217(rp.serviceSell + rp.partsSell, rp.total),
    "#217 repair: with parts the total rounds 1,153.57 → 1,150 and service + parts sell still sum to it");
  const ro = trvRepairEstimate({ venues: rNear217, laborHours: 4, parts: [{ name: "Cable", qty: 2, cost: 100 }], priceOverride: 1000 }, rRates217);
  ok(ro.total === 1000 && ro.overridden && near217(ro.serviceMargin, 1 - 607.5 / (1000 - 200 / 0.7)) && near217(ro.marginAmount, 1000 - 807.5),
    "#217 repair: a typed total back-solves the SERVICE margin; parts keep their markup");
  const rc = trvRepairEstimate({ venues: [{ label: "Here", oneWayMiles: 0, oneWayMin: 0 }], laborHours: 1 }, rRates217);
  ok(rc.calloutApplied && rc.total === 350, "#217 repair: the minimum call-out floors the service sell before rounding");

  // ---- inspection engine ----
  const iRates217 = { laborRate: 75, mileageRate: 1, lineSetMinutes: 15, baseHours: 2, level2Mult: 1.75, minFee: 650, margin: 0.3, travelRoundMin: 15 };
  const iNear217 = [{ id: "r217-i1", label: "Near", lineSets: 20, oneWayMiles: 60, oneWayMin: 70 }];
  const ia = trvInspectionEstimate({ venues: iNear217 }, iRates217);
  ok(near217(ia.totalRaw, 832.5 / 0.7) && ia.total === 1200 && near217(ia.effectiveMargin, 1 - 832.5 / 1200),
    "#217 inspection: the auto total rounds 1,189.29 → 1,200");
  const io = trvInspectionEstimate({ venues: iNear217, priceOverride: 1100 }, iRates217);
  ok(io.total === 1100 && io.overridden && io.autoTotal === 1200 && near217(io.effectiveMargin, 1 - 832.5 / 1100),
    "#217 inspection: a typed total is used exactly");
  const im = trvInspectionEstimate({ venues: [{ id: "r217-i2", label: "Here", lineSets: 0, oneWayMiles: 0, oneWayMin: 0 }] }, iRates217);
  ok(im.minApplied && im.total === 650, "#217 inspection: the minimum fee floors before rounding");

  // ---- parity: each engine's finish IS the shared finish the builders will call ----
  const pf = finishFlame217({ rawCost: fa.rawCost, baseFee: 150, margin: 0.3, priceOverride: null });
  ok(pf.total === fa.total && pf.cost === fa.cost && pf.effectiveMargin === fa.effectiveMargin, "#217 parity: the flame engine finishes exactly like finishFlame()");
  const pr = finishRepair217({ serviceCost: rp.serviceCost, minCallout: 350, margin: 0.3, partsCost: rp.partsCost, partsMargin: 0.3, priceOverride: null });
  ok(pr.total === rp.total && pr.serviceSell === rp.serviceSell && pr.serviceMargin === rp.serviceMargin, "#217 parity: the repair engine finishes exactly like finishRepair()");
  const pi = finishInspection217({ cost: ia.cost, minFee: 650, margin: 0.3, priceOverride: null });
  ok(pi.total === ia.total && pi.effectiveMargin === ia.effectiveMargin, "#217 parity: the inspection engine finishes exactly like finishInspection()");
  for (const [f, fn] of [
    ["src/lib/flametest-engine.ts", "finishFlame"],
    ["src/lib/repair-engine.ts", "finishRepair"],
    ["src/lib/inspection-engine.ts", "finishInspection"],
  ] as const) {
    const s = readFileSync(join(process.cwd(), f), "utf8");
    const code = s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""); // doc comments still quote the formula
    ok(code.includes(`${fn}(`) && /from "@\/lib\/service-pricing"/.test(code) && !/\/ \(1 - margin\)/.test(code),
      `#217: ${f} finishes its price through ${fn}() with no margin math of its own`);
  }
  const sp217 = readFileSync(join(process.cwd(), "src/lib/service-pricing.ts"), "utf8");
  ok(!/^\s*import\s/m.test(sp217), "#217: service-pricing.ts imports nothing — safe for the 'use client' builders");
  const formula217 = (key: string, id: string): string =>
    (PRICING_GROUPS.find((g) => g.key === key)!.items.find((it) => it.id === id) as { expr: string }).expr;
  ok(formula217("flame", "flame.total").includes("rounded to the nearest $25") &&
      formula217("repair", "repair.total").includes("rounded to the nearest $25") &&
      formula217("inspection", "inspection.total").includes("rounded to the nearest $25"),
    "#217: the Estimating Rules formulas say service totals round to the nearest $25");
}
```

- [ ] **Step 3: Run the harness to verify it fails**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: the run crashes with `Cannot find module '@/lib/service-pricing'` (or an equivalent resolve error).

- [ ] **Step 4: Create `src/lib/service-pricing.ts`**

```ts
/**
 * Service-quote price finish (#217) — the last step of pricing a flame-test,
 * repair or inspection quote: floors, the $25 rounding, a typed total, the
 * back-solved margin, and the printed-line split.
 * Spec: docs/superpowers/specs/2026-09-26-venues-and-service-rounding-design.md §#217.
 *
 * This module has NO imports and touches no DB or server code: the three
 * quote builders' "use client" previews call the same finish functions as the
 * server engines (flametest-engine, repair-engine, inspection-engine), so the
 * preview and the saved price can never disagree (D285).
 *
 * The rules:
 *   - auto total = the engine's total exactly as before (floors applied), then
 *     rounded to the nearest $25 (half rounds up);
 *   - a typed total (priceOverride, whole dollars, $1–$10,000,000) replaces it
 *     exactly — never re-rounded, never margin-clamped;
 *   - margin amount = total − cost; the effective margin = 1 − cost ÷ total.
 */

export const PRICE_STEP = 25;
export const PRICE_OVERRIDE_MAX = 10_000_000;
/** A typed total under this margin (or under cost) warns — it never blocks. */
export const LOW_MARGIN_WARN = 0.1;
export const MARGIN_SLIDER_MIN = 10;
export const MARGIN_SLIDER_MAX = 50;

/** Nearest multiple of `step` (default $25); half rounds up; NaN → 0. */
export function roundToStep(x: number, step: number = PRICE_STEP): number {
  if (!Number.isFinite(x)) return 0;
  if (!(step > 0)) return x;
  // + 1e-9 keeps float noise (862.4999999999999) rounding up like the true half.
  return Math.floor(x / step + 0.5 + 1e-9) * step;
}

/** A posted/typed dollar figure → whole dollars; undefined for blank or junk. */
function wholeDollars(raw: unknown): number | undefined {
  let s: string;
  if (typeof raw === "number") s = String(raw);
  else if (typeof raw === "string") s = raw.replace(/[$,\s]/g, "");
  else return undefined;
  if (s === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

/** A typed quote total: whole dollars, > 0 and ≤ $10,000,000; else no override. */
export function normalizePriceOverride(raw: unknown): number | undefined {
  const n = wholeDollars(raw);
  return n != null && n > 0 && n <= PRICE_OVERRIDE_MAX ? n : undefined;
}

/** A typed flame venue testing cost: whole dollars, ≥ 0 ($0 = free); blank = computed. */
export function normalizeTestingOverride(raw: unknown): number | undefined {
  const n = wholeDollars(raw);
  return n != null && n >= 0 && n <= PRICE_OVERRIDE_MAX ? n : undefined;
}

/** cost ÷ (1 − margin) when 0 < margin < 1, else cost. */
export function sellAtMargin(cost: number, margin: number): number {
  return margin > 0 && margin < 1 ? cost / (1 - margin) : cost;
}

export type FinishedPrice = {
  /** The total before rounding (floors already applied). */
  totalRaw: number;
  /** totalRaw rounded to the nearest $25. */
  autoTotal: number;
  /** What the quote prices: the typed total when set, else autoTotal. */
  total: number;
  priceOverride: number | null;
  overridden: boolean;
  marginAmount: number;
  /** 1 − cost ÷ total (0 when total is 0). */
  effectiveMargin: number;
};

/** Round the auto total, apply a typed total, back-solve the margin. */
export function finishPrice(
  totalRaw: number,
  cost: number,
  priceOverride?: number | null
): FinishedPrice {
  const autoTotal = roundToStep(totalRaw);
  const o = priceOverride != null && priceOverride > 0 ? priceOverride : null;
  const total = o ?? autoTotal;
  return {
    totalRaw,
    autoTotal,
    total,
    priceOverride: o,
    overridden: o != null,
    marginAmount: total - cost,
    effectiveMargin: total > 0 ? 1 - cost / total : 0,
  };
}

export type FlameFinish = FinishedPrice & {
  rawCost: number;
  baseFee: number;
  baseApplied: boolean;
  cost: number;
  /** The rate (slider) margin the auto total was priced at. */
  margin: number;
};

/** Flame tests: cost = max(baseFee, rawCost); total = cost ÷ (1 − margin), rounded. */
export function finishFlame(i: {
  rawCost: number;
  baseFee: number;
  margin: number;
  priceOverride?: number | null;
}): FlameFinish {
  const baseApplied = i.rawCost < i.baseFee;
  const cost = baseApplied ? i.baseFee : i.rawCost;
  return {
    rawCost: i.rawCost,
    baseFee: i.baseFee,
    baseApplied,
    cost,
    margin: i.margin,
    ...finishPrice(sellAtMargin(cost, i.margin), cost, i.priceOverride),
  };
}

export type InspectionFinish = FinishedPrice & {
  cost: number;
  sellRaw: number;
  minFee: number;
  minApplied: boolean;
  margin: number;
};

/** Inspections: total = max(minFee, cost ÷ (1 − margin)), rounded. */
export function finishInspection(i: {
  cost: number;
  minFee: number;
  margin: number;
  priceOverride?: number | null;
}): InspectionFinish {
  const sellRaw = sellAtMargin(i.cost, i.margin);
  const minApplied = sellRaw < i.minFee;
  return {
    cost: i.cost,
    sellRaw,
    minFee: i.minFee,
    minApplied,
    margin: i.margin,
    ...finishPrice(minApplied ? i.minFee : sellRaw, i.cost, i.priceOverride),
  };
}

export type RepairFinish = FinishedPrice & {
  serviceCost: number;
  serviceSellRaw: number;
  minCallout: number;
  calloutApplied: boolean;
  /** The floored service sell before rounding (what serviceSell was before #217). */
  serviceSellAuto: number;
  partsCost: number;
  partsSell: number;
  /** total − partsSell: the service line absorbs the rounding / typed difference. */
  serviceSell: number;
  cost: number;
  margin: number;
  partsMargin: number;
  /** 1 − serviceCost ÷ serviceSell — the margin the builder's slider shows. */
  serviceMargin: number;
};

/**
 * Repairs: serviceSell = max(minCallout, serviceCost ÷ (1 − margin)); parts sell
 * at their own margin; total = serviceSell + partsSell, rounded (or typed).
 */
export function finishRepair(i: {
  serviceCost: number;
  minCallout: number;
  margin: number;
  partsCost: number;
  partsMargin: number;
  priceOverride?: number | null;
}): RepairFinish {
  const serviceSellRaw = sellAtMargin(i.serviceCost, i.margin);
  const calloutApplied = serviceSellRaw < i.minCallout;
  const serviceSellAuto = calloutApplied ? i.minCallout : serviceSellRaw;
  const partsSell = sellAtMargin(i.partsCost, i.partsMargin);
  const cost = i.serviceCost + i.partsCost;
  const fin = finishPrice(serviceSellAuto + partsSell, cost, i.priceOverride);
  const serviceSell = fin.total - partsSell;
  return {
    ...fin,
    serviceCost: i.serviceCost,
    serviceSellRaw,
    minCallout: i.minCallout,
    calloutApplied,
    serviceSellAuto,
    partsCost: i.partsCost,
    partsSell,
    serviceSell,
    cost,
    margin: i.margin,
    partsMargin: i.partsMargin,
    serviceMargin: serviceSell > 0 ? 1 - i.serviceCost / serviceSell : 0,
  };
}

/** A flame venue's testing cost: the typed figure when set, else the computed one. */
export function venueTesting(
  computedCost: number,
  raw: unknown
): { laborCost: number; computedCost: number; testingOverride: number | null } {
  const o = normalizeTestingOverride(raw);
  return { laborCost: o ?? computedCost, computedCost, testingOverride: o ?? null };
}

export function fmtDollars(n: number): string {
  return "$" + Math.round(n || 0).toLocaleString("en-US");
}

/** A margin fraction as points with one decimal: 0.28125 → "28.1". */
export function fmtPts(margin: number): string {
  const v = Math.round((Number.isFinite(margin) ? margin : 0) * 1000) / 10;
  return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

/** The builder's 10–50 slider position for a (back-solved) margin. */
export function sliderPts(margin: number): number {
  const pts = Math.round(margin * 100);
  if (!Number.isFinite(pts)) return MARGIN_SLIDER_MIN;
  return Math.max(MARGIN_SLIDER_MIN, Math.min(MARGIN_SLIDER_MAX, pts));
}

export type PriceWarning = { kind: "below-cost" | "low-margin"; text: string } | null;

/** Warning (never a block) for a typed total below cost or under a 10% margin. */
export function typedPriceWarning(total: number, cost: number, margin: number): PriceWarning {
  if (total < cost)
    return {
      kind: "below-cost",
      text: `Below cost — ${fmtDollars(total)} is ${fmtDollars(cost - total)} under the ${fmtDollars(cost)} cost.`,
    };
  if (margin < LOW_MARGIN_WARN)
    return {
      kind: "low-margin",
      text: `Low margin — ${fmtPts(margin)} pts at this total, under ${Math.round(LOW_MARGIN_WARN * 100)} pts.`,
    };
  return null;
}

/**
 * The letters' one dollar component line (D283 fly-mode travel) reconciled to
 * the final total: travel's proportional share, flight × total ÷ cost, clamped
 * to [0, total]; the service part (`rest`) absorbs rounding and a typed total,
 * so the printed parts always sum to the total. With no stored cost (legacy
 * quotes) it falls back to D283's flight ÷ (1 − margin).
 */
export function travelLineShare(i: {
  flightTotal: number;
  total: number;
  cost?: number | null;
  margin?: number | null;
}): { travel: number; rest: number } {
  const total = Math.max(0, Math.round(i.total || 0));
  const flight = Math.max(0, i.flightTotal || 0);
  const m = i.margin ?? 0;
  const share =
    i.cost != null && i.cost > 0
      ? Math.round((flight * total) / i.cost)
      : Math.round(m > 0 && m < 1 ? flight / (1 - m) : flight);
  const travel = Math.max(0, Math.min(total, share));
  return { travel, rest: total - travel };
}

/**
 * The builder's typed-total seed when a saved quote is reopened: its saved
 * priceOverride; else — D286 parity, a sent price must not silently change —
 * a quote past draft whose value is off the $25 grid (saved before #217)
 * reopens with that value typed in. Drafts and on-grid values reopen on auto.
 */
export function seedPriceOverride(status: string, value: unknown, saved: unknown): number | null {
  const typed = normalizePriceOverride(saved);
  if (typed != null) return typed;
  if (status === "draft") return null;
  const v = typeof value === "number" && Number.isFinite(value) ? value : 0;
  if (v <= 0 || v % PRICE_STEP === 0) return null;
  return normalizePriceOverride(v) ?? null;
}
```

- [ ] **Step 5: Wire the flame engine (`src/lib/flametest-engine.ts`)**

5a. After the `} from "@/lib/travel-plan";` import (line 15), add:

```ts
import {
  finishFlame,
  normalizePriceOverride,
  venueTesting,
  type FlameFinish,
} from "@/lib/service-pricing";
```

5b. In `FlameTestVenueInput`, after `oneWayMin?: number | string | null;` add:

```ts
  /** #217: a typed testing cost for this venue (blank/absent = computed). */
  testingOverride?: number | string | null;
```

5c. Replace the `VenuePrice` type with:

```ts
export type VenuePrice = {
  id: string | null;
  label: string;
  curtains: number;
  laborMin: number;
  /** What this venue's testing prices at — the typed figure when set. */
  laborCost: number;
  charge: number;
  /** curtains × curtainMinutes at laborRate, before any typed figure. */
  computedCost: number;
  testingOverride: number | null;
};
```

5d. In `FlameTestComputeOpts`, after `travel?: TravelOverride | null;` add:

```ts
  /** #217: a typed quote total — replaces the rounded auto total exactly. */
  priceOverride?: number | string | null;
```

5e. Replace the whole `FlameTestPricing` type with:

```ts
export type FlameTestPricing = FlameFinish & {
  rates: FlameTestRates;
  perVenue: VenuePrice[];
  testingSubtotal: number;
  /** Alias of testingSubtotal (prototype exposed both). */
  venuesSubtotal: number;
  curtainsTotal: number;
  venueCount: number;
  /** The drive numbers (trip.total is always the DRIVE cost) + mode/flight. */
  trip: TripTravel & TripMode;
  /** The travel plan — travel.total is the figure the quote prices. */
  travel: TravelPlan;
};
```

5f. Replace `priceVenue` (lines 219-234) with:

```ts
/** Per-venue curtain-testing labor: curtains x curtainMinutes at laborRate,
 *  unless a typed testing cost replaces it (#217). */
export function priceVenue(
  v: FlameTestVenueInput,
  rates: FlameTestRates
): VenuePrice {
  const curtains = Math.max(0, Math.round(Number(v.curtains) || 0));
  const laborMin = curtains * rates.curtainMinutes;
  const t = venueTesting(laborMin * (rates.laborRate / 60), v.testingOverride);
  return {
    id: v.id ?? null,
    label: v.label || "Venue",
    curtains,
    laborMin,
    laborCost: t.laborCost,
    charge: t.laborCost,
    computedCost: t.computedCost,
    testingOverride: t.testingOverride,
  };
}
```

5g. In `compute`, replace from `  const trip = withMode(drive, plan);` through the end of the `return { … };` (lines 327-361) with:

```ts
  const trip = withMode(drive, plan);
  // Base $150 is a floor on the WHOLE job cost (mileage + travel + testing),
  // not a per-venue charge. Margin is applied on top of the floored cost, then
  // (#217) the total rounds to the nearest $25 unless a typed total replaces
  // it — finishFlame() is the same code the builder preview runs.
  const rawCost = plan.total + testingSubtotal;
  const fin = finishFlame({
    rawCost,
    baseFee: C.baseFee,
    margin: C.margin,
    priceOverride: normalizePriceOverride(opts.priceOverride),
  });

  return {
    rates: C,
    perVenue,
    testingSubtotal,
    venuesSubtotal: testingSubtotal,
    curtainsTotal,
    venueCount: venues.length,
    trip,
    travel: plan,
    ...fin,
  };
```

5h. In the `compute` doc comment, replace ` *   total   = cost / (1 - margin)            — when 0 < margin < 1, else cost` with:

```ts
 *   total   = cost / (1 - margin)            — when 0 < margin < 1, else cost,
 *             rounded to the nearest $25, or a typed priceOverride (#217)
```

- [ ] **Step 6: Wire the repair engine (`src/lib/repair-engine.ts`)**

6a. After the `} from "@/lib/travel-plan";` import (line 11), add:

```ts
import { finishRepair, normalizePriceOverride } from "@/lib/service-pricing";
```

6b. In `RepairEstimateOptions`, after `travel?: TravelOverride | null;` add:

```ts
  /** #217: a typed quote total — replaces the rounded auto total exactly. */
  priceOverride?: number | string | null;
```

6c. In `RepairEstimate`, replace `  serviceSell: number;` with:

```ts
  /** The floored service sell before rounding (pre-#217 serviceSell). */
  serviceSellAuto: number;
  /** total − partsSell: the service line absorbs the $25 rounding / typed total. */
  serviceSell: number;
```

and replace the last two fields `  total: number;\n  marginAmount: number;\n};` with:

```ts
  /** The total before rounding (floors applied). */
  totalRaw: number;
  /** totalRaw rounded to the nearest $25. */
  autoTotal: number;
  total: number;
  priceOverride: number | null;
  overridden: boolean;
  marginAmount: number;
  /** 1 − cost ÷ total over the whole job. */
  effectiveMargin: number;
  /** 1 − serviceCost ÷ serviceSell — the slider's margin, back-solved. */
  serviceMargin: number;
};
```

6d. In `computeEstimate`, replace from `  const serviceCost = laborCost + plan.total;` through the end of the `return { … };` with:

```ts
  const serviceCost = laborCost + plan.total;

  const parts: RepairEstimatePart[] = (opts.parts || []).map((p) => {
    const qty = Math.max(0, Number(p.qty) || 0);
    const cost = Math.max(0, Number(p.cost) || 0);
    return { name: p.name || "Part", qty, cost, extCost: qty * cost };
  });
  const partsCost = parts.reduce((a, p) => a + p.extCost, 0);

  // #217: the call-out floor, both margins, the $25 rounding and a typed total
  // all come from finishRepair() — the same code the builder preview runs.
  const fin = finishRepair({
    serviceCost,
    minCallout: C.minCallout,
    margin: C.margin,
    partsCost,
    partsMargin: C.partsMargin,
    priceOverride: normalizePriceOverride(opts.priceOverride),
  });

  return {
    rates: C,
    laborHours,
    laborRate,
    laborCost,
    emergency: !!opts.emergency,
    trip,
    travel: plan,
    serviceCost,
    serviceSellRaw: fin.serviceSellRaw,
    serviceSellAuto: fin.serviceSellAuto,
    serviceSell: fin.serviceSell,
    minCallout: C.minCallout,
    calloutApplied: fin.calloutApplied,
    parts,
    partsCost,
    partsSell: fin.partsSell,
    margin: C.margin,
    partsMargin: C.partsMargin,
    cost: fin.cost,
    totalRaw: fin.totalRaw,
    autoTotal: fin.autoTotal,
    total: fin.total,
    priceOverride: fin.priceOverride,
    overridden: fin.overridden,
    marginAmount: fin.marginAmount,
    effectiveMargin: fin.effectiveMargin,
    serviceMargin: fin.serviceMargin,
  };
```

6e. In the header comment's "5. Total = serviceSell + partsSell." line, change it to `5. Total = serviceSell + partsSell, rounded to the nearest $25 (or a typed total, #217).`

- [ ] **Step 7: Wire the inspection engine (`src/lib/inspection-engine.ts`)**

7a. After the `} from "@/lib/travel-plan";` import (line 17), add:

```ts
import { finishInspection, normalizePriceOverride } from "@/lib/service-pricing";
```

7b. In `InspectionEstimateOptions`, after `travel?: TravelOverride | null;` add:

```ts
  /** #217: a typed quote total — replaces the rounded auto total exactly. */
  priceOverride?: number | string | null;
```

7c. In `InspectionEstimate`, replace the tail `  margin: number;\n  total: number;\n  marginAmount: number;\n};` with:

```ts
  margin: number;
  /** The total before rounding (min fee applied). */
  totalRaw: number;
  /** totalRaw rounded to the nearest $25. */
  autoTotal: number;
  total: number;
  priceOverride: number | null;
  overridden: boolean;
  marginAmount: number;
  /** 1 − cost ÷ total. */
  effectiveMargin: number;
};
```

7d. In `computeEstimate`, replace from `  const cost = laborCost + plan.total;` through the end of the `return { … };` with:

```ts
  const cost = laborCost + plan.total;
  // #217: min-fee floor, the $25 rounding and a typed total — finishInspection()
  // is the same code the builder preview runs.
  const fin = finishInspection({
    cost,
    minFee: C.minFee,
    margin: C.margin,
    priceOverride: normalizePriceOverride(opts.priceOverride),
  });

  return {
    rates: C,
    level,
    lineSetsTotal,
    baseHours: C.baseHours,
    inspectHoursRaw,
    inspectHours,
    levelMult,
    laborRate: C.laborRate,
    laborCost,
    trip,
    travel: plan,
    ...fin,
  };
```

7e. In the header comment, change ` *   4. Total = (labor + travel) ÷ (1 − margin), floored at the minimum fee.` to ` *   4. Total = (labor + travel) ÷ (1 − margin), floored at the minimum fee, then rounded to the nearest $25 (or a typed total, #217).`

- [ ] **Step 8: Formula strings (`src/lib/stores/pricing.ts`)**

With replace-all (exactly 3 occurrences, lines 414, 430, 448), replace:

```
  ·  travel = flights when one trip's drive cost ≥ threshold"),
```
with
```
  ·  travel = flights when one trip's drive cost ≥ threshold  ·  rounded to the nearest $25"),
```

- [ ] **Step 9: Run the gates**

Run: `npx tsc --noEmit` → Expected: no output, exit 0.
Run: `npm run test:specs 2>&1 | grep '^FAIL'` → Expected: nothing.
Run: `npm run test:specs 2>&1 | grep -c '^PASS'` → Expected: BASE + 40 (the #217 T1 block adds 40 assertions: 17 pure-rule, 8 flame, 4 repair, 3 inspection, 3 parity, 3 engine-source, 1 import-free, 1 formula; the six #208 edits don't change the count).
Run: `npx eslint src/lib/service-pricing.ts src/lib/flametest-engine.ts src/lib/repair-engine.ts src/lib/inspection-engine.ts src/lib/stores/pricing.ts scripts/test-review-and-spec.ts` → Expected: 0 errors.

If tsc reports a consumer reading a removed field: none should exist (every old field name is kept). Fix only by adapting the consumer to the new names above.

Note: between this task and Tasks 3–4, the builder previews still show the unrounded figure while the save rounds. That's expected on the branch; Tasks 3–4 close it.

- [ ] **Step 10: Commit**

```bash
git add src/lib/service-pricing.ts src/lib/flametest-engine.ts src/lib/repair-engine.ts src/lib/inspection-engine.ts src/lib/stores/pricing.ts scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(pricing): service engines round to $25 and take a typed total (#217)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Save actions persist overrides; renewals and letters reconcile

**Files:**
- Modify: `src/app/(app)/flame-tests/quote/actions.ts` (imports 1-19; `PostedVenue` 31; venue map 78-89; `compute` call 101-105; payload 121-155)
- Modify: `src/app/(app)/repairs/quote/actions.ts` (imports 1-30; `computeEstimate` call 144-159; payload 183-227)
- Modify: `src/app/(app)/inspections/quote/actions.ts` (imports; `computeEstimate` call 114-126; payload 137-170)
- Modify: `src/lib/renewal-outreach.ts` (imports 48-56; `RenewalPricing` 122-128; `priceParagraph` 135-153; `FlameTestDoc` 199-211; flame ensure 276-383; flame letter 462-471; `InspectionDoc` 522-537; inspection ensure 638-743; inspection letter 820-828)
- Modify: `src/app/(app)/flame-tests/letter/page.tsx` (import 10; `FlameTestDoc` 69-83; row 289-296)
- Modify: `src/app/(app)/inspections/letter/page.tsx` (import 10; `InspectionDoc` 71-82; row 267-274)
- Modify: `src/app/(app)/repairs/letter/page.tsx` (import 14; `RepairDoc` 47-67; travel paragraph 216-224)
- Test: `scripts/test-review-and-spec.ts` (one #208 regex at ~10299; append at EOF)

**Interfaces:**
- Consumes (Task 1): `normalizePriceOverride`, `normalizeTestingOverride`, `travelLineShare` from `@/lib/service-pricing`; engine results' `effectiveMargin`, `serviceMargin`, `autoTotal`, `priceOverride`, `perVenue[].testingOverride`; engine options `priceOverride`, venue `testingOverride`.
- Produces:
  - Form field contract the builders post (Tasks 3–4): `priceOverride` (string; blank = auto). Flame `venues` JSON items gain `testingOverride: number | null`.
  - Stored subdoc fields: `flameTest.priceOverride?`, `flameTest.autoTotal`, `flameTest.venues[].testingOverride?`; `repair.priceOverride?`, `repair.autoTotal`; `inspection.priceOverride?`, `inspection.autoTotal`. Quote `margin` = back-solved (repairs: `serviceMargin`).
  - `export function priceParagraph(p: RenewalPricing, kind: string): string`, `export type RenewalPricing` (with `lastHandSet?: number | null`), `export function priorHandSetPrice(doc: unknown): number | null` in `@/lib/renewal-outreach`.

- [ ] **Step 1: Update the #208 letter regex**

In `scripts/test-review-and-spec.ts` (~line 10299), replace:

```ts
    ok(/flightOf\(/.test(src) && line.test(src) && /travelLineAmount\(/.test(src),
```
with
```ts
    ok(/flightOf\(/.test(src) && line.test(src) && /travelLineAmount\(|travelLineShare\(/.test(src),
```

- [ ] **Step 2: Append the failing #217 T2 block at the end of `scripts/test-review-and-spec.ts`**

```ts

/* ====================================================================
   #217 T2 — save paths persist the typed total / testing cost and the
   back-solved margin; renewals re-price without them and say when last
   year's price was hand-set; letters print travel's share of the final total.
   ==================================================================== */
import {
  priceParagraph as priceParagraph217,
  priorHandSetPrice as priorHandSetPrice217,
} from "@/lib/renewal-outreach";
{
  const src217 = (f: string): string => readFileSync(join(process.cwd(), f), "utf8");
  const typedIn = /const priceOverride = normalizePriceOverride\(formData\.get\("priceOverride"\)\);/;
  const storedTyped = /\.\.\.\(r\.priceOverride != null \? \{ priceOverride: r\.priceOverride \} : \{\}\)/;
  const storedAuto = /autoTotal: Math\.round\(r\.autoTotal\),/;

  const fa = src217("src/app/(app)/flame-tests/quote/actions.ts");
  ok(typedIn.test(fa) && /venues: venueInputs, travel: travelOverride, priceOverride \}/.test(fa),
    "#217 flame save: reads the typed total and prices with it");
  ok(/testingOverride: normalizeTestingOverride\(v\.testingOverride\),/.test(fa) &&
      /\.\.\.\(v\.testingOverride != null \? \{ testingOverride: v\.testingOverride \} : \{\}\)/.test(fa),
    "#217 flame save: each venue's typed testing cost is validated, priced and saved on the venue");
  ok(/margin: r\.effectiveMargin,/.test(fa) && storedTyped.test(fa) && storedAuto.test(fa),
    "#217 flame save: stores the back-solved margin, the typed total (when set) and the auto figure");

  const ra = src217("src/app/(app)/repairs/quote/actions.ts");
  ok(typedIn.test(ra) && /travel: travelOverride,\n\s*priceOverride,\n/.test(ra) && /margin: r\.serviceMargin,/.test(ra) && storedTyped.test(ra) && storedAuto.test(ra),
    "#217 repair save: typed total in; service margin, typed total and auto figure out");

  const ia = src217("src/app/(app)/inspections/quote/actions.ts");
  ok(typedIn.test(ia) && /travel: travelOverride,\n\s*priceOverride,\n/.test(ia) && /margin: r\.effectiveMargin,/.test(ia) && storedTyped.test(ia) && storedAuto.test(ia),
    "#217 inspection save: typed total in; back-solved margin, typed total and auto figure out");

  const rn = src217("src/lib/renewal-outreach.ts");
  const fnBody = (name: string): string => {
    const at = rn.indexOf(`async function ${name}`);
    return at < 0 ? "" : rn.slice(at, rn.indexOf("\n}\n", at));
  };
  for (const fn of ["ensureFlameRenewalQuote", "ensureInspectionRenewalQuote"]) {
    const b = fnBody(fn);
    ok(b.length > 0 && !/priceOverride:/.test(b) && !/testingOverride/.test(b),
      `#217 renewal: ${fn} re-prices without last year's typed total or testing cost`);
    ok(/lastHandSet: priorHandSetPrice\(/.test(b) && /margin: r\.effectiveMargin,/.test(b) && storedAuto.test(b),
      `#217 renewal: ${fn} notes a hand-set prior price and stores the rounded price's margin`);
  }
  ok(priorHandSetPrice217({ priceOverride: 850 }) === 850 && priorHandSetPrice217({}) === null && priorHandSetPrice217(null) === null,
    "#217 renewal: last year's hand-set price is read from its priceOverride");
  type PP217 = Parameters<typeof priceParagraph217>[0];
  const para = priceParagraph217({ quote: { value: 900 }, lastPrice: 850, reasons: [], lastHandSet: 850 } as unknown as PP217, "inspection");
  ok(para.includes("Last year's price was hand-set at $850; this year's is priced at our current rates.") && para.includes("compared with $850 last year"),
    "#217 renewal: the draft body says last year's price was hand-set");
  const para2 = priceParagraph217({ quote: { value: 900 }, lastPrice: 850, reasons: [] } as unknown as PP217, "inspection");
  ok(!para2.includes("hand-set"), "#217 renewal: no hand-set sentence when last year's price was auto");

  for (const f of [
    "src/app/(app)/flame-tests/letter/page.tsx",
    "src/app/(app)/inspections/letter/page.tsx",
    "src/app/(app)/repairs/letter/page.tsx",
    "src/lib/renewal-outreach.ts",
  ]) {
    const s = src217(f);
    ok(/travelLineShare\(\{/.test(s) && !/travelLineAmount\(/.test(s),
      `#217 printed lines: ${f} prints travel's share of the final total`);
  }
}
```

- [ ] **Step 3: Run the harness to verify it fails**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: crash on `priorHandSetPrice`/`priceParagraph` not exported (`does not provide an export named` or `is not a function`).

- [ ] **Step 4: Flame save action (`src/app/(app)/flame-tests/quote/actions.ts`)**

4a. After `import { parseTravelOverride, savedTrip } from "@/lib/travel-plan";` add:

```ts
import { normalizePriceOverride, normalizeTestingOverride } from "@/lib/service-pricing";
```

4b. Replace `type PostedVenue = { id: string; label: string; curtains: number };` with:

```ts
type PostedVenue = {
  id: string;
  label: string;
  curtains: number;
  /** #217: the builder's typed Testing cell (null/absent = computed). */
  testingOverride?: number | string | null;
};
```

4c. Replace:

```ts
      label: v.label || loc?.label || "Venue",
      curtains: v.curtains,
```
with
```ts
      label: v.label || loc?.label || "Venue",
      curtains: v.curtains,
      testingOverride: normalizeTestingOverride(v.testingOverride),
```

4d. Replace:

```ts
  const r = compute(
    { office: office || undefined, venues: venueInputs, travel: travelOverride },
```
with
```ts
  // #217: a typed total (whole dollars, $1–$10,000,000) replaces the rounded
  // auto total exactly; the 5–50 clamp above bounds only the slider's margin.
  const priceOverride = normalizePriceOverride(formData.get("priceOverride"));
  const r = compute(
    { office: office || undefined, venues: venueInputs, travel: travelOverride, priceOverride },
```

4e. Replace `    margin: r.margin,` with `    margin: r.effectiveMargin,`.

4f. Replace:

```ts
        curtains: v.curtains,
        testingCost: Math.round(v.laborCost),
      })),
```
with
```ts
        curtains: v.curtains,
        testingCost: Math.round(v.laborCost),
        ...(v.testingOverride != null ? { testingOverride: v.testingOverride } : {}),
      })),
```

4g. Replace:

```ts
      marginAmount: Math.round(r.marginAmount),
      total: Math.round(r.total),
```
with
```ts
      marginAmount: Math.round(r.marginAmount),
      autoTotal: Math.round(r.autoTotal),
      ...(r.priceOverride != null ? { priceOverride: r.priceOverride } : {}),
      total: Math.round(r.total),
```

- [ ] **Step 5: Repair save action (`src/app/(app)/repairs/quote/actions.ts`)**

5a. After `import { parseTravelOverride, savedTrip } from "@/lib/travel-plan";` add:

```ts
import { normalizePriceOverride } from "@/lib/service-pricing";
```

5b. Replace:

```ts
  const travelOverride = parseTravelOverride(formData.get("travel"));
  const r = computeEstimate(
```
with
```ts
  const travelOverride = parseTravelOverride(formData.get("travel"));
  // #217: a typed total (whole dollars, $1–$10,000,000) replaces the rounded
  // auto total exactly; the 5–50 clamp above bounds only the slider's margin.
  const priceOverride = normalizePriceOverride(formData.get("priceOverride"));
  const r = computeEstimate(
```

5c. Replace:

```ts
      crewSize,
      travel: travelOverride,
      geo: {
```
with
```ts
      crewSize,
      travel: travelOverride,
      priceOverride,
      geo: {
```

5d. Replace `    margin: r.margin,` with `    margin: r.serviceMargin,`.

5e. Replace:

```ts
      marginAmount: Math.round(r.marginAmount),
      total: Math.round(r.total),
```
with
```ts
      marginAmount: Math.round(r.marginAmount),
      autoTotal: Math.round(r.autoTotal),
      ...(r.priceOverride != null ? { priceOverride: r.priceOverride } : {}),
      total: Math.round(r.total),
```

- [ ] **Step 6: Inspection save action (`src/app/(app)/inspections/quote/actions.ts`)**

6a. After its `import { parseTravelOverride, savedTrip } from "@/lib/travel-plan";` add:

```ts
import { normalizePriceOverride } from "@/lib/service-pricing";
```

6b. Replace:

```ts
  const travelOverride = parseTravelOverride(formData.get("travel"));
  const r = computeEstimate(
```
with
```ts
  const travelOverride = parseTravelOverride(formData.get("travel"));
  // #217: a typed total (whole dollars, $1–$10,000,000) replaces the rounded
  // auto total exactly; the 5–50 clamp above bounds only the slider's margin.
  const priceOverride = normalizePriceOverride(formData.get("priceOverride"));
  const r = computeEstimate(
```

6c. Replace:

```ts
      level,
      travel: travelOverride,
      geo: {
```
with
```ts
      level,
      travel: travelOverride,
      priceOverride,
      geo: {
```

6d. Replace `    margin: r.margin,` with `    margin: r.effectiveMargin,`.

6e. Replace:

```ts
      marginAmount: Math.round(r.marginAmount),
      total: Math.round(r.total),
```
with
```ts
      marginAmount: Math.round(r.marginAmount),
      autoTotal: Math.round(r.autoTotal),
      ...(r.priceOverride != null ? { priceOverride: r.priceOverride } : {}),
      total: Math.round(r.total),
```

- [ ] **Step 7: Renewals (`src/lib/renewal-outreach.ts`)**

7a. In the `@/lib/travel-plan` import list, delete the line `  travelLineAmount,`. After that import's closing `} from "@/lib/travel-plan";` add:

```ts
import { normalizePriceOverride, travelLineShare } from "@/lib/service-pricing";
```

7b. Replace the `RenewalPricing` type and the whole `priceParagraph` function (lines 120-153) with:

```ts
/** What the ✉ flow learned while minting this year's quote — feeds the
 *  email's price-comparison sentence (D69). */
export type RenewalPricing = {
  quote: Quote;
  /** Last year's price (0 = unknown, e.g. seed-era records). */
  lastPrice: number;
  /** Customer-safe phrases explaining a changed price (may be empty). */
  reasons: string[];
  /** #217: last year's typed total, when it had one (renewals never carry it). */
  lastHandSet?: number | null;
};

/**
 * The email's price paragraph: always cites last year's price when known,
 * and explains a change (or falls back to generic "current rates" wording
 * when the components can't be reconstructed). #217: when last year's price
 * was typed by hand, says so — this year's is re-priced and rounded instead.
 */
export function priceParagraph(p: RenewalPricing, kind: string): string {
  const newPrice = p.quote.value || 0;
  const closing = ` If it looks good, just reply here and we'll get this year's ${kind} on the schedule.`;
  const handSet = p.lastHandSet
    ? ` Last year's price was hand-set at ${money(p.lastHandSet)}; this year's is priced at our current rates.`
    : "";
  if (newPrice > 0 && p.lastPrice > 0) {
    if (newPrice === p.lastPrice)
      return (
        `I've attached this year's quote — ${money(newPrice)}, unchanged ` +
        `from last year.` + handSet + closing
      );
    const dir = newPrice > p.lastPrice ? "increase" : "decrease";
    const why = p.reasons.length ? listJoin(p.reasons) : "our current rates";
    return (
      `I've attached this year's quote — ${money(newPrice)}, compared with ` +
      `${money(p.lastPrice)} last year. The ${dir} reflects ${why}.` + handSet + closing
    );
  }
  if (newPrice > 0)
    return `I've attached this year's quote — ${money(newPrice)}.` + handSet + closing;
  return `I've attached this year's quote.` + handSet + closing;
}

/** #217: last year's typed total from a prior service subdoc, or null. */
export function priorHandSetPrice(doc: unknown): number | null {
  if (!doc || typeof doc !== "object") return null;
  return normalizePriceOverride((doc as { priceOverride?: unknown }).priceOverride) ?? null;
}
```

7c. In `type FlameTestDoc` (renewal copy, ~199-211), after `  total?: number | null;` add:

```ts
  /** Whole-job cost as saved (for the printed travel share, #217). */
  cost?: number | null;
  /** #217: a typed total — read only to mention it; never carried. */
  priceOverride?: unknown;
```

7d. In `type InspectionDoc` (renewal copy, ~522-537), after `  total?: number | null;` add the same two fields:

```ts
  /** Whole-job cost as saved (for the printed travel share, #217). */
  cost?: number | null;
  /** #217: a typed total — read only to mention it; never carried. */
  priceOverride?: unknown;
```

7e. Replace-all (exactly 2 occurrences — flame and inspection renewal payloads) `    margin: r.margin,` with `    margin: r.effectiveMargin,`.

7f. Replace-all (exactly 2 occurrences):

```ts
      marginAmount: Math.round(r.marginAmount),
      total: Math.round(r.total),
```
with
```ts
      marginAmount: Math.round(r.marginAmount),
      autoTotal: Math.round(r.autoTotal),
      total: Math.round(r.total),
```

7g. Replace `  return { quote, lastPrice, reasons: flameChangeReasons(priorFt, r) };` with:

```ts
  return {
    quote,
    lastPrice,
    reasons: flameChangeReasons(priorFt, r),
    lastHandSet: priorHandSetPrice(priorFt),
  };
```

7h. Replace:

```ts
    reasons: inspectionChangeReasons(priorIn, r, venueInput.label || "this venue"),
  };
```
with
```ts
    reasons: inspectionChangeReasons(priorIn, r, venueInput.label || "this venue"),
    lastHandSet: priorHandSetPrice(priorIn),
  };
```

7i. In `flameLetterDoc`, replace:

```ts
        flyTravelSentence(`${companyName} (${originCity})`, venueName, travelLineAmount(flight.total, margin)) +
```
with
```ts
        flyTravelSentence(
          `${companyName} (${originCity})`,
          venueName,
          travelLineShare({
            flightTotal: flight.total,
            total: quote.value != null ? quote.value : ft.total || 0,
            cost: ft.cost,
            margin,
          }).travel
        ) +
```

7j. In `inspectionLetterDoc`, replace:

```ts
        flyTravelSentence(`${companyName} (${insp.office || "our office"})`, venueName, travelLineAmount(flight.total, margin)) +
```
with
```ts
        flyTravelSentence(
          `${companyName} (${insp.office || "our office"})`,
          venueName,
          travelLineShare({
            flightTotal: flight.total,
            total: quote.value != null ? quote.value : insp.total || 0,
            cost: insp.cost,
            margin,
          }).travel
        ) +
```

Verify: `grep -n "travelLineAmount\|margin: r.margin," src/lib/renewal-outreach.ts` → no output. (The flame and inspection `venueInputs` literals already list their fields explicitly — `id, label, curtains/lineSets, coords, oneWayMiles, oneWayMin` — so no `testingOverride` reaches the engine, and no `priceOverride` is passed. Leave them as they are.)

- [ ] **Step 8: Letters**

8a. `src/app/(app)/flame-tests/letter/page.tsx`: replace line 10 `import { TRAVEL_FLY_LINE, flightOf, travelLineAmount } from "@/lib/travel-plan";` with:

```ts
import { TRAVEL_FLY_LINE, flightOf } from "@/lib/travel-plan";
import { travelLineShare } from "@/lib/service-pricing";
```

In `type FlameTestDoc`, after `  total?: number | null;` add `  cost?: number | null;`. Replace:

```ts
      qty: money(travelLineAmount(flight.total, travelMargin)),
```
with
```ts
      // #217: travel's share of the final (rounded or typed) total — the service
      // part absorbs the difference, so the printed parts sum to the total.
      qty: money(
        travelLineShare({
          flightTotal: flight.total,
          total: quote.value != null ? quote.value : ft.total || 0,
          cost: ft.cost,
          margin: travelMargin,
        }).travel
      ),
```

8b. `src/app/(app)/inspections/letter/page.tsx`: replace line 10 with:

```ts
import { TRAVEL_FLY_LINE, flightOf } from "@/lib/travel-plan";
import { travelLineShare } from "@/lib/service-pricing";
```

In `type InspectionDoc`, after `  total?: number | null;` add `  cost?: number | null;`. Replace:

```ts
      qty: money(travelLineAmount(flight.total, travelMargin)),
```
with
```ts
      // #217: travel's share of the final (rounded or typed) total — the service
      // part absorbs the difference, so the printed parts sum to the total.
      qty: money(
        travelLineShare({
          flightTotal: flight.total,
          total: quote.value != null ? quote.value : insp.total || 0,
          cost: insp.cost,
          margin: travelMargin,
        }).travel
      ),
```

8c. `src/app/(app)/repairs/letter/page.tsx`: replace line 14 `import { flightOf, flyTravelSentence, travelLineAmount } from "@/lib/travel-plan";` with:

```ts
import { flightOf, flyTravelSentence } from "@/lib/travel-plan";
import { travelLineShare } from "@/lib/service-pricing";
```

In `type RepairDoc`, after `  total?: number | null;` add:

```ts
  serviceCost?: number | null;
  serviceSell?: number | null;
  partsSell?: number | null;
```

Replace:

```ts
        travelLineAmount(flight.total, travelMargin)
```
with
```ts
        // #217: travel's share of the service sell (parts excluded), which
        // already absorbs the $25 rounding or a typed total.
        travelLineShare({
          flightTotal: flight.total,
          total:
            rp.serviceSell != null
              ? rp.serviceSell
              : Math.max(0, (quote.value != null ? quote.value : rp.total || 0) - (rp.partsSell || 0)),
          cost: rp.serviceCost,
          margin: travelMargin,
        }).travel
```

- [ ] **Step 9: Run the gates**

Run: `npx tsc --noEmit` → Expected: exit 0.
Run: `npm run test:specs 2>&1 | grep '^FAIL'` → Expected: nothing.
Run: `npm run test:specs 2>&1 | grep -c '^PASS'` → Expected: Task 1 count + 16 (3 flame save, 1 repair save, 1 inspection save, 4 renewal loop, 1 priorHandSetPrice, 2 paragraph, 4 letters).
Run: `npx eslint "src/app/(app)/flame-tests/quote/actions.ts" "src/app/(app)/repairs/quote/actions.ts" "src/app/(app)/inspections/quote/actions.ts" src/lib/renewal-outreach.ts "src/app/(app)/flame-tests/letter/page.tsx" "src/app/(app)/inspections/letter/page.tsx" "src/app/(app)/repairs/letter/page.tsx" scripts/test-review-and-spec.ts` → Expected: 0 errors.

- [ ] **Step 10: Commit**

```bash
git add "src/app/(app)/flame-tests/quote/actions.ts" "src/app/(app)/repairs/quote/actions.ts" "src/app/(app)/inspections/quote/actions.ts" src/lib/renewal-outreach.ts "src/app/(app)/flame-tests/letter/page.tsx" "src/app/(app)/inspections/letter/page.tsx" "src/app/(app)/repairs/letter/page.tsx" scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(pricing): save typed totals and testing costs; renewals and letters reconcile (#217)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Flame builder — Total input, Reset to auto, editable Testing cells

**Files:**
- Create: `src/components/service-total-field.tsx`
- Modify: `src/app/(app)/flame-tests/quote/controls.tsx` (imports 1-21; `BuilderInitial` 71-89; types/pricing 93-234; state ~299-306; `pickCustomer` 356-386; `setCurtains` 405-412; live pricing 414-438; `buildForm` 455-477; venue grid 694 `VGRID`, Testing cell 799-809; sidebar 895-967)
- Modify: `src/app/(app)/flame-tests/quote/page.tsx` (imports 1-12; `FtVenue`/`FlameTestDoc` 34-42; edit seeding 123-164)
- Test: `scripts/test-review-and-spec.ts` (append at EOF)

**Interfaces:**
- Consumes (Task 1): `finishFlame`, `venueTesting`, `normalizePriceOverride`, `normalizeTestingOverride`, `sliderPts`, `fmtPts`, `seedPriceOverride`, `typedPriceWarning`, `fmtDollars`, `type FlameFinish`. Consumes (Task 2): the `priceOverride` form field and `venues[].testingOverride` JSON items.
- Produces: `ServiceTotalField` (for Task 4):

```ts
export function ServiceTotalField(props: {
  total: number; autoTotal: number; cost: number; margin: number;
  overridden: boolean; text: string; onText: (text: string) => void;
  onReset: () => void; disabled?: boolean; accent: string; style?: CSSProperties;
}): JSX.Element
```

and the builder-initial contract `BuilderInitial.priceOverride?: number | null`, which Task 4 mirrors.

- [ ] **Step 1: Append the failing #217 T3 block at the end of `scripts/test-review-and-spec.ts`**

```ts

/* ====================================================================
   #217 T3 — the flame builder previews through the engine's finish, the Total
   is an input (Reset to auto + warning), each venue's Testing cell is an input,
   and reopening a quote restores both (D286-style seed for old sent prices).
   Client component — raw-source idiom (#177).
   ==================================================================== */
{
  const fc = readFileSync(join(process.cwd(), "src/app/(app)/flame-tests/quote/controls.tsx"), "utf8");
  const fcCode = fc.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  ok(/from "@\/lib\/service-pricing"/.test(fc) && /finishFlame\(\{/.test(fcCode) && /venueTesting\(/.test(fcCode) && !/\/ \(1 - margin\)/.test(fcCode),
    "#217 flame builder: the preview finishes through finishFlame()/venueTesting(), no inlined margin math");
  ok(/fd\.set\("priceOverride", priceOverride != null \? String\(priceOverride\) : ""\);/.test(fc) &&
      /testingOverride: normalizeTestingOverride\(v\.testingOverride\) \?\? null,/.test(fc),
    "#217 flame builder: posts the typed total and each venue's typed testing cost");
  ok(/<ServiceTotalField/.test(fc) && /aria-label=\{"Testing cost for " \+ l\.label/.test(fc),
    "#217 flame builder: the Total and each venue's Testing cell are inputs");
  ok(/value=\{r\?\.overridden \? sliderPts\(r\.effectiveMargin\) : marginPts\}/.test(fc) &&
      /setMarginPts\(Math\.round\(\+e\.target\.value\)\);\n\s*setPriceText\(""\);/.test(fc) &&
      /function resetToAuto\(\)/.test(fc),
    "#217 flame builder: the slider follows a typed total; moving it or Reset to auto clears the override");
  ok(!/^import (?!type )[^;]*from "@\/lib\/(flametest-engine|repair-engine|inspection-engine)"/m.test(fc),
    "#217 flame builder: imports no engine module (client bundle)");
  const tf = readFileSync(join(process.cwd(), "src/components/service-total-field.tsx"), "utf8");
  ok(/^"use client";/.test(tf) && !/from "@\/(lib\/stores|db)\//.test(tf) && /Reset to auto/.test(tf) && /typedPriceWarning\(/.test(tf) && /rounded to the nearest \$25/.test(tf),
    "#217: the shared Total field is a client component on the pure module, with Reset to auto and the warning");
  const fp = readFileSync(join(process.cwd(), "src/app/(app)/flame-tests/quote/page.tsx"), "utf8");
  ok(/priceOverride: seedPriceOverride\(editQuote\.status, editQuote\.value, ft && ft\.priceOverride\),/.test(fp) &&
      /testing: v\.testingOverride != null \? String\(v\.testingOverride\) : ""/.test(fp),
    "#217 flame page: reopening restores the typed total and testing costs (old sent prices stay put)");
}
```

- [ ] **Step 2: Run the harness to verify it fails**

Run: `npm run test:specs 2>&1 | grep '^FAIL' | grep '#217'`
Expected: the seven `#217 flame builder…`, `#217: the shared Total field…` and `#217 flame page…` lines FAIL. (The shared-field check fails with ENOENT until the file exists, which crashes the run. That also counts as failing.)

- [ ] **Step 3: Create `src/components/service-total-field.tsx`**

```tsx
"use client";

import { useState, type CSSProperties } from "react";
import { fmtDollars, typedPriceWarning } from "@/lib/service-pricing";

/**
 * #217 — the service quote builders' Total row as an input. It shows the auto
 * total (rounded to the nearest $25) until someone types a figure. A typed
 * figure is the quote's price exactly, the margin back-solves, and "Reset to
 * auto" clears it. A typed total below cost or under a 10% margin warns but
 * never blocks. Imports only the pure pricing module — safe in a client bundle.
 */
export function ServiceTotalField({
  total,
  autoTotal,
  cost,
  margin,
  overridden,
  text,
  onText,
  onReset,
  disabled,
  accent,
  style,
}: {
  total: number;
  autoTotal: number;
  cost: number;
  /** The margin the builder's slider shows (the service margin on repairs). */
  margin: number;
  overridden: boolean;
  /** The typed text ("" = auto). */
  text: string;
  onText: (text: string) => void;
  onReset: () => void;
  disabled?: boolean;
  accent: string;
  style?: CSSProperties;
}) {
  // While focused the field shows exactly what is being typed (even ""), so
  // clearing it to type a new figure doesn't snap back to the auto total.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (text !== "" ? text : String(Math.round(autoTotal)));
  const invalid = text.trim() !== "" && !overridden;
  const warning = overridden ? typedPriceWarning(total, cost, margin) : null;
  return (
    <div style={{ marginTop: 4, paddingTop: 9, borderTop: "1px solid #f0f1f4", ...style }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
          fontSize: 14,
          fontWeight: 700,
        }}
      >
        <label htmlFor="svc-total-input">Total</label>
        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <span style={{ fontFamily: "var(--font-mono)", color: "#8c919c" }}>$</span>
          <input
            id="svc-total-input"
            inputMode="decimal"
            value={shown}
            disabled={disabled}
            aria-describedby="svc-total-note"
            onFocus={(e) => {
              setDraft(shown);
              e.currentTarget.select();
            }}
            onBlur={() => setDraft(null)}
            onChange={(e) => {
              setDraft(e.target.value);
              onText(e.target.value);
            }}
            style={{
              width: 118,
              fontFamily: "var(--font-mono)",
              fontSize: 14,
              fontWeight: 700,
              textAlign: "right",
              color: "#16181d",
              background: overridden ? "#fffaf0" : "#fff",
              border: "1px solid " + (overridden ? accent : "#e4e7ec"),
              borderRadius: 8,
              padding: "6px 8px",
              boxSizing: "border-box",
            }}
          />
        </div>
      </div>
      <div
        id="svc-total-note"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 8,
          fontSize: 10.5,
          color: "#9aa0ab",
          marginTop: 5,
          lineHeight: 1.45,
        }}
      >
        <span>
          {overridden
            ? `Typed total · auto is ${fmtDollars(autoTotal)}`
            : invalid
              ? "Not a dollar amount — using the auto total."
              : "Auto · rounded to the nearest $25"}
        </span>
        {(overridden || invalid) && (
          <button
            type="button"
            onClick={() => {
              setDraft(null);
              onReset();
            }}
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 10.5,
              fontWeight: 600,
              color: accent,
              background: "none",
              border: 0,
              padding: 0,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Reset to auto
          </button>
        )}
      </div>
      {warning && (
        <div role="status" style={{ fontSize: 10.5, color: "#b4543a", marginTop: 5, lineHeight: 1.45 }}>
          {warning.text}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Flame builder (`src/app/(app)/flame-tests/quote/controls.tsx`)**

4a. After `import { TravelModePanel } from "@/components/travel-mode-panel";` add:

```ts
import { ServiceTotalField } from "@/components/service-total-field";
import {
  finishFlame,
  fmtPts,
  normalizePriceOverride,
  normalizeTestingOverride,
  sliderPts,
  venueTesting,
  type FlameFinish,
} from "@/lib/service-pricing";
```

4b. In `BuilderInitial`, replace `  venueSel: Record<string, { on: boolean; curtains: string }>;` with:

```ts
  /** testing = the typed Testing cell ("" / absent = computed, #217). */
  venueSel: Record<string, { on: boolean; curtains: string; testing?: string }>;
```

and after `  travel?: TravelOverride | null;` (last field) add:

```ts
  /** #217: the typed total to reopen with (null = auto). */
  priceOverride?: number | null;
```

4c. In `type VenueIn`, after `  oneWayMin: number | null;` add:

```ts
  /** #217: the typed Testing cell ("" = computed). */
  testingOverride?: string;
```

4d. Replace `type PerVenue = { id: string; label: string; curtains: number; laborCost: number };` with:

```ts
type PerVenue = {
  id: string;
  label: string;
  curtains: number;
  laborCost: number;
  computedCost: number;
  testingOverride: number | null;
};
```

4e. Replace the whole `type Pricing = { … };` block with:

```ts
type Pricing = FlameFinish & {
  perVenue: PerVenue[];
  curtainsTotal: number;
  venueCount: number;
  trip: Trip;
  /** Flights over drive — travel.total is the figure the quote prices. */
  travel: TravelPlan;
};
```

4f. Replace the builder's `priceVenue` function with:

```ts
function priceVenue(v: VenueIn, rates: BuilderRates): PerVenue {
  const curtains = Math.max(0, Math.round(Number(v.curtains) || 0));
  const laborMin = curtains * rates.curtainMinutes;
  // #217: the engine's own rule — a typed testing cost replaces the computed one.
  const t = venueTesting(laborMin * (rates.laborRate / 60), v.testingOverride);
  return {
    id: v.id,
    label: v.label || "Venue",
    curtains,
    laborCost: t.laborCost,
    computedCost: t.computedCost,
    testingOverride: t.testingOverride,
  };
}
```

4g. Replace the whole `computePricing` function with:

```ts
function computePricing(
  office: BuilderOffice | null,
  venues: VenueIn[],
  rates: BuilderRates,
  tr: BuilderTravelRates,
  override: TravelOverride | undefined,
  priceOverride: number | undefined
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
  // #217: the engine's finish — base fee floor, margin, $25 rounding, typed total.
  const fin = finishFlame({
    rawCost: travel.total + testingSubtotal,
    baseFee: rates.baseFee,
    margin: rates.margin,
    priceOverride,
  });
  return { perVenue, curtainsTotal, venueCount: venues.length, trip, travel, ...fin };
}
```

4h. After the `const [travelDraft, setTravelDraft] = useState<TravelDraft>(…);` line add:

```ts
  /* #217: the typed Total ("" = auto — rounded to the nearest $25). */
  const [priceText, setPriceText] = useState(
    initial.priceOverride != null ? String(initial.priceOverride) : ""
  );
```

4i. In `pickCustomer`, replace `    setVenueSel(sel);` with:

```ts
    setVenueSel(sel);
    setPriceText(""); // a new customer is a new price
```

4j. After the `setCurtains` function add:

```ts
  function setTesting(locId: string, val: string) {
    const clean = val === "" ? "" : String(Math.max(0, Math.round(+val || 0)));
    setVenueSel((prev) => {
      const cur = prev[locId] || { on: true, curtains: "" };
      return { ...prev, [locId]: { ...cur, testing: clean, on: true } };
    });
    dirty();
  }
```

4k. In the `selectedVenues` map, replace:

```ts
      curtains: +(venueSel[l.id]?.curtains || 0) || 0,
```
with
```ts
      curtains: +(venueSel[l.id]?.curtains || 0) || 0,
      testingOverride: venueSel[l.id]?.testing ?? "",
```

4l. Replace:

```ts
  const r =
    hasCustomer && selectedVenues.length
      ? computePricing(office, selectedVenues, liveRates, travelRates, overrideFromDraft(travelDraft))
      : null;
  const chargeById = new Map((r?.perVenue || []).map((p) => [p.id, p]));
```
with
```ts
  const priceOverride = normalizePriceOverride(priceText);
  const r =
    hasCustomer && selectedVenues.length
      ? computePricing(office, selectedVenues, liveRates, travelRates, overrideFromDraft(travelDraft), priceOverride)
      : null;
  const chargeById = new Map((r?.perVenue || []).map((p) => [p.id, p]));

  /** #217 — back to the auto total; the slider stays where the typed total put it. */
  function resetToAuto() {
    if (r?.overridden) setMarginPts(sliderPts(r.effectiveMargin));
    setPriceText("");
    dirty();
  }
```

4m. In `buildForm`, replace:

```ts
    fd.set(
      "venues",
      JSON.stringify(selectedVenues.map((v) => ({ id: v.id, label: v.label, curtains: v.curtains })))
    );
```
with
```ts
    fd.set("priceOverride", priceOverride != null ? String(priceOverride) : "");
    fd.set(
      "venues",
      JSON.stringify(
        selectedVenues.map((v) => ({
          id: v.id,
          label: v.label,
          curtains: v.curtains,
          testingOverride: normalizeTestingOverride(v.testingOverride) ?? null,
        }))
      )
    );
```

4n. Replace `const VGRID = "34px minmax(0,1fr) 118px 92px";` with `const VGRID = "34px minmax(0,1fr) 118px 104px";`.

4o. Replace the Testing cell:

```tsx
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 13.5,
                        fontWeight: 600,
                        textAlign: "right",
                        color: on ? "#16181d" : "#c0c5cd",
                      }}
                    >
                      {on && pc ? money(pc.laborCost) : "—"}
                    </div>
```
with
```tsx
                    <input
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      value={st.testing ?? ""}
                      onChange={(e) => setTesting(l.id, e.target.value)}
                      disabled={!on}
                      placeholder={on && pc ? String(Math.round(pc.computedCost)) : "—"}
                      aria-label={"Testing cost for " + l.label + " (blank = computed)"}
                      title="Type a dollar figure to set this venue's testing cost; clear it to use the computed cost"
                      style={{
                        width: "100%",
                        fontFamily: "var(--font-mono)",
                        fontSize: 13.5,
                        fontWeight: 600,
                        textAlign: "right",
                        color: on ? "#16181d" : "#c0c5cd",
                        background: on ? (st.testing ? "#fffaf0" : "#fff") : "#f7f8fa",
                        border: "1px solid " + (on && st.testing ? "#f0d6cd" : "#e4e7ec"),
                        borderRadius: 8,
                        padding: "9px 8px",
                        boxSizing: "border-box",
                      }}
                    />
```

4p. In the sidebar Testing breakdown, replace:

```tsx
                  label={p.label + " · " + p.curtains + " curtain" + (p.curtains === 1 ? "" : "s")}
```
with
```tsx
                  label={
                    p.label +
                    " · " +
                    p.curtains +
                    " curtain" +
                    (p.curtains === 1 ? "" : "s") +
                    (p.testingOverride != null ? " · set" : "")
                  }
```

4q. Replace `                  <span style={{ color: "#5b616e" }}>Margin · {marginPts} pts</span>` with:

```tsx
                  <span style={{ color: "#5b616e" }}>
                    Margin · {r?.overridden ? fmtPts(r.effectiveMargin) : marginPts} pts
                  </span>
```

4r. Replace:

```tsx
                  value={marginPts}
                  onChange={(e) => {
                    setMarginPts(Math.round(+e.target.value));
                    dirty();
                  }}
```
with
```tsx
                  value={r?.overridden ? sliderPts(r.effectiveMargin) : marginPts}
                  onChange={(e) => {
                    setMarginPts(Math.round(+e.target.value));
                    setPriceText("");
                    dirty();
                  }}
```

4s. Replace the sidebar's bottom Total row:

```tsx
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    fontSize: 14,
                    fontWeight: 700,
                    marginTop: 4,
                    paddingTop: 9,
                    borderTop: "1px solid #f0f1f4",
                  }}
                >
                  <span>Total</span>
                  <span style={{ fontFamily: "var(--font-mono)" }}>{money(total)}</span>
                </div>
```
with
```tsx
                <ServiceTotalField
                  total={total}
                  autoTotal={r?.autoTotal ?? 0}
                  cost={r?.cost ?? 0}
                  margin={r?.effectiveMargin ?? 0}
                  overridden={!!r?.overridden}
                  text={priceText}
                  onText={(t) => {
                    setPriceText(t);
                    dirty();
                  }}
                  onReset={resetToAuto}
                  disabled={!r}
                  accent={accent}
                />
```

4t. In the file's top doc comment, after "with the flametest-engine math inlined below", add the sentence: `The price finish (base fee, margin, $25 rounding, a typed total) is the engine's own finishFlame() from the import-free service-pricing module (#217).`

- [ ] **Step 5: Flame page (`src/app/(app)/flame-tests/quote/page.tsx`)**

5a. After `import { normalizeTravelOverride } from "@/lib/travel-plan";` add:

```ts
import { seedPriceOverride } from "@/lib/service-pricing";
```

5b. Replace `type FtVenue = { id?: string | null; label?: string; curtains?: number };` with:

```ts
type FtVenue = { id?: string | null; label?: string; curtains?: number; testingOverride?: number | null };
```

and in `type FlameTestDoc`, after `  trip?: { mode?: string } | null;` add `  priceOverride?: unknown;`.

5c. Replace:

```ts
      if (v.id) venueSel[v.id] = { on: true, curtains: String(v.curtains || "") };
```
with
```ts
      if (v.id)
        venueSel[v.id] = {
          on: true,
          curtains: String(v.curtains || ""),
          testing: v.testingOverride != null ? String(v.testingOverride) : "",
        };
```

5d. Replace:

```ts
      travel: normalizeTravelOverride(ft && ft.travel) ?? (legacyDrive ? { mode: "drive" } : null),
```
with
```ts
      travel: normalizeTravelOverride(ft && ft.travel) ?? (legacyDrive ? { mode: "drive" } : null),
      // #217: reopen with the typed total; an old sent price off the $25 grid
      // reopens typed in too, so re-saving never silently changes it (D286).
      priceOverride: seedPriceOverride(editQuote.status, editQuote.value, ft && ft.priceOverride),
```

- [ ] **Step 6: Run the gates**

Run: `npx tsc --noEmit` → Expected: exit 0.
Run: `npm run test:specs 2>&1 | grep '^FAIL'` → Expected: nothing.
Run: `npm run test:specs 2>&1 | grep -c '^PASS'` → Expected: Task 2 count + 7.
Run: `npx eslint src/components/service-total-field.tsx "src/app/(app)/flame-tests/quote/controls.tsx" "src/app/(app)/flame-tests/quote/page.tsx" scripts/test-review-and-spec.ts` → Expected: 0 errors (if `money` is now unused in controls.tsx, keep it only if still referenced; it is, by the header total and breakdown rows).
Run: `lsof -i :3000 | head -3` (no dev server from this worktree), then `npx next build` → Expected: exit 0, and no "server-only / postgres / doc-store in client bundle" error.

- [ ] **Step 7: Commit**

```bash
git add src/components/service-total-field.tsx "src/app/(app)/flame-tests/quote/controls.tsx" "src/app/(app)/flame-tests/quote/page.tsx" scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(pricing): flame builder types its total and per-venue testing cost (#217)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Repairs + inspections builders — Total input, Reset to auto

**Files:**
- Modify: `src/app/(app)/repairs/quote/controls.tsx` (imports 1-21; `BuilderInitial` 77-101; `Pricing` 151-168; `computePricing` 207-266; state ~362-366; `pickCustomer` 412-433; live pricing 465-495; `buildForm` 513-545; sidebar 1194-1273)
- Modify: `src/app/(app)/repairs/quote/page.tsx` (imports; `RepairDoc` 46-60; edit seeding 175-205)
- Modify: `src/app/(app)/inspections/quote/controls.tsx` (imports 1-25; `BuilderInitial` 72-90; `Pricing` 140-158; `computePricing` 196-246; state ~316-320; `pickCustomer` 365-386; live pricing 420-436; `buildForm` 453-475; sidebar 972-1032)
- Modify: `src/app/(app)/inspections/quote/page.tsx` (imports; `InspectionDoc` 39-46; edit seeding 157-172)
- Test: `scripts/test-review-and-spec.ts` (append at EOF)

**Interfaces:**
- Consumes (Tasks 1–3): `finishRepair`, `finishInspection`, `normalizePriceOverride`, `sliderPts`, `fmtPts`, `seedPriceOverride`, `type RepairFinish`, `type InspectionFinish`; `ServiceTotalField` (props as in Task 3); the `priceOverride` form field (Task 2).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Append the failing #217 T4 block at the end of `scripts/test-review-and-spec.ts`**

```ts

/* ====================================================================
   #217 T4 — repairs + inspections builders preview through the engines'
   finish, the Total is an input, and reopening restores a typed total.
   ==================================================================== */
{
  const strip217 = (s: string): string => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  const rc = readFileSync(join(process.cwd(), "src/app/(app)/repairs/quote/controls.tsx"), "utf8");
  ok(/from "@\/lib\/service-pricing"/.test(rc) && /finishRepair\(\{/.test(strip217(rc)) && !/\/ \(1 - margin\)/.test(strip217(rc)) && !/\/ \(1 - pMargin\)/.test(strip217(rc)),
    "#217 repair builder: the preview finishes through finishRepair(), no inlined margin math");
  ok(/fd\.set\("priceOverride", priceOverride != null \? String\(priceOverride\) : ""\);/.test(rc) && /<ServiceTotalField/.test(rc),
    "#217 repair builder: the Total is an input and the typed total is posted");
  ok(/value=\{r\?\.overridden \? sliderPts\(r\.serviceMargin\) : marginPts\}/.test(rc) &&
      /setMarginPts\(Math\.round\(\+e\.target\.value\)\);\n\s*setPriceText\(""\);/.test(rc) &&
      /function resetToAuto\(\)/.test(rc),
    "#217 repair builder: the slider follows the back-solved SERVICE margin; moving it or Reset clears the override");
  const ic = readFileSync(join(process.cwd(), "src/app/(app)/inspections/quote/controls.tsx"), "utf8");
  ok(/from "@\/lib\/service-pricing"/.test(ic) && /finishInspection\(\{/.test(strip217(ic)) && !/\/ \(1 - margin\)/.test(strip217(ic)),
    "#217 inspection builder: the preview finishes through finishInspection(), no inlined margin math");
  ok(/fd\.set\("priceOverride", priceOverride != null \? String\(priceOverride\) : ""\);/.test(ic) && /<ServiceTotalField/.test(ic),
    "#217 inspection builder: the Total is an input and the typed total is posted");
  ok(/value=\{r\?\.overridden \? sliderPts\(r\.effectiveMargin\) : marginPts\}/.test(ic) &&
      /setMarginPts\(Math\.round\(\+e\.target\.value\)\);\n\s*setPriceText\(""\);/.test(ic) &&
      /function resetToAuto\(\)/.test(ic),
    "#217 inspection builder: the slider follows a typed total; moving it or Reset clears the override");
  for (const [svc, sub] of [["repairs", "rp"], ["inspections", "insp"]] as const) {
    const pg = readFileSync(join(process.cwd(), `src/app/(app)/${svc}/quote/page.tsx`), "utf8");
    ok(new RegExp(`priceOverride: seedPriceOverride\\(editQuote\\.status, editQuote\\.value, ${sub} && ${sub}\\.priceOverride\\),`).test(pg),
      `#217 ${svc} page: reopening restores the typed total (old sent prices stay put)`);
  }
}
```

- [ ] **Step 2: Run the harness to verify it fails**

Run: `npm run test:specs 2>&1 | grep '^FAIL' | grep '#217'`
Expected: the eight T4 assertions FAIL.

- [ ] **Step 3: Repairs builder (`src/app/(app)/repairs/quote/controls.tsx`)**

3a. After `import { TravelModePanel } from "@/components/travel-mode-panel";` add:

```ts
import { ServiceTotalField } from "@/components/service-total-field";
import {
  finishRepair,
  fmtPts,
  normalizePriceOverride,
  sliderPts,
  type RepairFinish,
} from "@/lib/service-pricing";
```

3b. In `BuilderInitial`, after `  travel?: TravelOverride | null;` add:

```ts
  /** #217: the typed total to reopen with (null = auto). */
  priceOverride?: number | null;
```

3c. Replace the whole `type Pricing = { … };` block (lines 151-168) with:

```ts
type Pricing = RepairFinish & {
  laborHours: number;
  laborRate: number;
  laborCost: number;
  emergency: boolean;
  trip: Trip;
  parts: Array<PartIn & { extCost: number }>;
  /** Flights over drive — travel.total is the figure the quote prices. */
  travel: TravelPlan;
};
```

3d. In `computePricing`'s parameter list, replace:

```ts
  tr: BuilderTravelRates,
  override: TravelOverride | undefined
): Pricing {
```
with
```ts
  tr: BuilderTravelRates,
  override: TravelOverride | undefined,
  priceOverride: number | undefined
): Pricing {
```

3e. Replace from `  const serviceCost = laborCost + travel.total;` through the end of `computePricing` (the closing `}` after `travel,\n  };`) with:

```ts
  const serviceCost = laborCost + travel.total;
  const priced = parts.map((p) => {
    const qty = Math.max(0, Number(p.qty) || 0);
    const cost = Math.max(0, Number(p.cost) || 0);
    return { name: p.name || "Part", qty, cost, extCost: qty * cost };
  });
  const partsCost = priced.reduce((a, p) => a + p.extCost, 0);
  // #217: the engine's finish — call-out floor, both margins, $25 rounding, typed total.
  const fin = finishRepair({
    serviceCost,
    minCallout: rates.minCallout,
    margin: rates.margin,
    partsCost,
    partsMargin: rates.partsMargin,
    priceOverride,
  });
  return {
    laborHours: hours,
    laborRate,
    laborCost,
    emergency,
    trip,
    parts: priced,
    travel,
    ...fin,
  };
}
```

3f. After the `const [travelDraft, setTravelDraft] = useState<TravelDraft>(…);` line add:

```ts
  /* #217: the typed Total ("" = auto — rounded to the nearest $25). */
  const [priceText, setPriceText] = useState(
    initial.priceOverride != null ? String(initial.priceOverride) : ""
  );
```

3g. In `pickCustomer`, replace `    setVenueSel(sel);` with:

```ts
    setVenueSel(sel);
    setPriceText(""); // a new customer is a new price
```

3h. Replace:

```ts
  const r =
    hasCustomer && selectedVenues.length
      ? computePricing(office, selectedVenues, crewHours, crew, partsIn, emergency, liveRates, travelRates, overrideFromDraft(travelDraft))
      : null;
```
with
```ts
  const priceOverride = normalizePriceOverride(priceText);
  const r =
    hasCustomer && selectedVenues.length
      ? computePricing(office, selectedVenues, crewHours, crew, partsIn, emergency, liveRates, travelRates, overrideFromDraft(travelDraft), priceOverride)
      : null;

  /** #217 — back to the auto total; the slider stays where the typed total put it. */
  function resetToAuto() {
    if (r?.overridden) setMarginPts(sliderPts(r.serviceMargin));
    setPriceText("");
    dirty();
  }
```

3i. In `buildForm`, replace `    fd.set("parts", JSON.stringify(partsIn));` with:

```ts
    fd.set("parts", JSON.stringify(partsIn));
    fd.set("priceOverride", priceOverride != null ? String(priceOverride) : "");
```

3j. Replace `                  <span style={{ color: "#5b616e" }}>Margin · {marginPts} pts</span>` with:

```tsx
                  <span style={{ color: "#5b616e" }}>
                    Margin · {r?.overridden ? fmtPts(r.serviceMargin) : marginPts} pts
                  </span>
```

3k. Replace:

```tsx
                  value={marginPts}
                  onChange={(e) => {
                    setMarginPts(Math.round(+e.target.value));
                    dirty();
                  }}
```
with
```tsx
                  value={r?.overridden ? sliderPts(r.serviceMargin) : marginPts}
                  onChange={(e) => {
                    setMarginPts(Math.round(+e.target.value));
                    setPriceText("");
                    dirty();
                  }}
```

3l. Replace the bottom Total row:

```tsx
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  fontSize: 14,
                  fontWeight: 700,
                  marginTop: 13,
                  paddingTop: 12,
                  borderTop: "1px solid #eceef1",
                }}
              >
                <span>Total</span>
                <span style={{ fontFamily: "var(--font-mono)" }}>{money(total)}</span>
              </div>
```
with
```tsx
              <ServiceTotalField
                total={total}
                autoTotal={r?.autoTotal ?? 0}
                cost={r?.cost ?? 0}
                margin={r?.serviceMargin ?? 0}
                overridden={!!r?.overridden}
                text={priceText}
                onText={(t) => {
                  setPriceText(t);
                  dirty();
                }}
                onReset={resetToAuto}
                disabled={!r}
                accent={accent}
                style={{ marginTop: 13, paddingTop: 12, borderTop: "1px solid #eceef1" }}
              />
```

- [ ] **Step 4: Repairs page (`src/app/(app)/repairs/quote/page.tsx`)**

4a. After its `import { normalizeTravelOverride } from "@/lib/travel-plan";` add:

```ts
import { seedPriceOverride } from "@/lib/service-pricing";
```

4b. In `type RepairDoc`, after `  trip?: { mode?: string } | null;` add `  priceOverride?: unknown;`.

4c. Replace:

```ts
      travel: normalizeTravelOverride(rp && rp.travel) ?? (legacyDrive ? { mode: "drive" } : null),
```
with
```ts
      travel: normalizeTravelOverride(rp && rp.travel) ?? (legacyDrive ? { mode: "drive" } : null),
      // #217: reopen with the typed total; an old sent price off the $25 grid
      // reopens typed in too, so re-saving never silently changes it (D286).
      priceOverride: seedPriceOverride(editQuote.status, editQuote.value, rp && rp.priceOverride),
```

- [ ] **Step 5: Inspections builder (`src/app/(app)/inspections/quote/controls.tsx`)**

5a. After `import { TravelModePanel } from "@/components/travel-mode-panel";` add:

```ts
import { ServiceTotalField } from "@/components/service-total-field";
import {
  finishInspection,
  fmtPts,
  normalizePriceOverride,
  sliderPts,
  type InspectionFinish,
} from "@/lib/service-pricing";
```

5b. In `BuilderInitial`, after `  travel?: TravelOverride | null;` add:

```ts
  /** #217: the typed total to reopen with (null = auto). */
  priceOverride?: number | null;
```

5c. Replace the whole `type Pricing = { … };` block (lines 140-158) with:

```ts
type Pricing = InspectionFinish & {
  perVenue: PerVenue[];
  lineSetsTotal: number;
  venueCount: number;
  levelMult: number;
  inspectHours: number;
  baseCost: number;
  laborCost: number;
  trip: Trip;
  /** Flights over drive — travel.total is the figure the quote prices. */
  travel: TravelPlan;
};
```

5d. In `computePricing`'s parameter list, replace:

```ts
  tr: BuilderTravelRates,
  override: TravelOverride | undefined
): Pricing {
```
with
```ts
  tr: BuilderTravelRates,
  override: TravelOverride | undefined,
  priceOverride: number | undefined
): Pricing {
```

5e. Replace from `  const cost = laborCost + travel.total;` through the end of `computePricing` with:

```ts
  // #217: the engine's finish — min fee floor, margin, $25 rounding, typed total.
  const fin = finishInspection({
    cost: laborCost + travel.total,
    minFee: rates.minFee,
    margin: rates.margin,
    priceOverride,
  });
  return {
    perVenue,
    lineSetsTotal,
    venueCount: venues.length,
    levelMult,
    inspectHours,
    baseCost,
    laborCost,
    trip,
    travel,
    ...fin,
  };
}
```

5f. After the `const [travelDraft, setTravelDraft] = useState<TravelDraft>(…);` line add:

```ts
  /* #217: the typed Total ("" = auto — rounded to the nearest $25). */
  const [priceText, setPriceText] = useState(
    initial.priceOverride != null ? String(initial.priceOverride) : ""
  );
```

5g. In `pickCustomer`, replace `    setVenueSel(sel);` with:

```ts
    setVenueSel(sel);
    setPriceText(""); // a new customer is a new price
```

5h. Replace:

```ts
  const r =
    hasCustomer && selectedVenues.length
      ? computePricing(office, selectedVenues, level, liveRates, travelRates, overrideFromDraft(travelDraft))
      : null;
  const chargeById = new Map((r?.perVenue || []).map((p) => [p.id, p]));
```
with
```ts
  const priceOverride = normalizePriceOverride(priceText);
  const r =
    hasCustomer && selectedVenues.length
      ? computePricing(office, selectedVenues, level, liveRates, travelRates, overrideFromDraft(travelDraft), priceOverride)
      : null;
  const chargeById = new Map((r?.perVenue || []).map((p) => [p.id, p]));

  /** #217 — back to the auto total; the slider stays where the typed total put it. */
  function resetToAuto() {
    if (r?.overridden) setMarginPts(sliderPts(r.effectiveMargin));
    setPriceText("");
    dirty();
  }
```

5i. In `buildForm`, replace `    fd.set("travel", JSON.stringify(overrideFromDraft(travelDraft) ?? {}));` with:

```ts
    fd.set("travel", JSON.stringify(overrideFromDraft(travelDraft) ?? {}));
    fd.set("priceOverride", priceOverride != null ? String(priceOverride) : "");
```

5j. Replace `                  <span style={{ color: "#5b616e" }}>Margin · {marginPts} pts</span>` with:

```tsx
                  <span style={{ color: "#5b616e" }}>
                    Margin · {r?.overridden ? fmtPts(r.effectiveMargin) : marginPts} pts
                  </span>
```

5k. Replace:

```tsx
                  value={marginPts}
                  onChange={(e) => {
                    setMarginPts(Math.round(+e.target.value));
                    dirty();
                  }}
```
with
```tsx
                  value={r?.overridden ? sliderPts(r.effectiveMargin) : marginPts}
                  onChange={(e) => {
                    setMarginPts(Math.round(+e.target.value));
                    setPriceText("");
                    dirty();
                  }}
```

5l. Replace the bottom Total row:

```tsx
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    fontSize: 14,
                    fontWeight: 700,
                    marginTop: 4,
                    paddingTop: 9,
                    borderTop: "1px solid #f0f1f4",
                  }}
                >
                  <span>Total</span>
                  <span style={{ fontFamily: "var(--font-mono)" }}>{money(total)}</span>
                </div>
```
with
```tsx
                <ServiceTotalField
                  total={total}
                  autoTotal={r?.autoTotal ?? 0}
                  cost={r?.cost ?? 0}
                  margin={r?.effectiveMargin ?? 0}
                  overridden={!!r?.overridden}
                  text={priceText}
                  onText={(t) => {
                    setPriceText(t);
                    dirty();
                  }}
                  onReset={resetToAuto}
                  disabled={!r}
                  accent={accent}
                />
```

- [ ] **Step 6: Inspections page (`src/app/(app)/inspections/quote/page.tsx`)**

6a. After its `import { normalizeTravelOverride } from "@/lib/travel-plan";` add:

```ts
import { seedPriceOverride } from "@/lib/service-pricing";
```

6b. In `type InspectionDoc`, after `  trip?: { mode?: string } | null;` add `  priceOverride?: unknown;`.

6c. Replace:

```ts
      travel: normalizeTravelOverride(insp && insp.travel) ?? (legacyDrive ? { mode: "drive" } : null),
```
with
```ts
      travel: normalizeTravelOverride(insp && insp.travel) ?? (legacyDrive ? { mode: "drive" } : null),
      // #217: reopen with the typed total; an old sent price off the $25 grid
      // reopens typed in too, so re-saving never silently changes it (D286).
      priceOverride: seedPriceOverride(editQuote.status, editQuote.value, insp && insp.priceOverride),
```

- [ ] **Step 7: Run the gates**

Run: `npx tsc --noEmit` → Expected: exit 0.
Run: `npm run test:specs 2>&1 | grep '^FAIL'` → Expected: nothing.
Run: `npm run test:specs 2>&1 | grep -c '^PASS'` → Expected: Task 3 count + 8 (final = BASE + 40 + 16 + 7 + 8 = BASE + 71).
Run: `npx eslint "src/app/(app)/repairs/quote/controls.tsx" "src/app/(app)/repairs/quote/page.tsx" "src/app/(app)/inspections/quote/controls.tsx" "src/app/(app)/inspections/quote/page.tsx" scripts/test-review-and-spec.ts` → Expected: 0 errors.
Run: `lsof -i :3000 | head -3`, then `npx next build` → Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/repairs/quote/controls.tsx" "src/app/(app)/repairs/quote/page.tsx" "src/app/(app)/inspections/quote/controls.tsx" "src/app/(app)/inspections/quote/page.tsx" scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(pricing): repair and inspection builders type their total (#217)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review (done while writing)

- **Spec coverage.** `roundToStep` + engines round (T1); typed total, back-solved margin, slider moves, reset/slider clear, warning (T1 rules + T3/T4 UI); server accepts `priceOverride` with no margin clamp and stores the back-solved margin (T2); flame testing input into engine/preview/save (T1/T2/T3); printed lines reconcile (T1 `travelLineShare` + T2 letters and renewal PDFs); renewals re-price, round, drop overrides and mention a hand-set price (T2); builder/engine parity through a shared finish (T1 numeric + T3/T4 source); Estimator/Grid/Quick Design/rentals untouched.
- **Assertion counts.** T1 = 40, T2 = 16, T3 = 7, T4 = 8. If an executor's count differs, recount the `ok(` calls in their block rather than editing assertions to match.
- **Name consistency.** `priceOverride`, `testingOverride`, `autoTotal`, `totalRaw`, `effectiveMargin`, `serviceMargin`, `serviceSellAuto`, `travelLineShare`, `seedPriceOverride`, `ServiceTotalField`, `resetToAuto`, `priceText`/`setPriceText` are used identically across tasks.
