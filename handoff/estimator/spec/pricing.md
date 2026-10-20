# Pricing

**Confidential — Peak Systems Group.**

Every formula the Estimator prices with, in words. Each one names the function that computes it in
`app/estimating-core.js`, as a path on the engine's one global: `PeakEstimatingCore.totals` is the
function `totals` in that file, and `PeakEstimatingCore.bonusRules.withBonusLines` is `withBonusLines`
in the `bonusRules` group. The source's own doc comments sit above each function in the file.

```js
// in a browser:  <script src="app/estimating-core.js"></script>
// in Node:       const PeakEstimatingCore = require("./app/estimating-core.js");
const t = PeakEstimatingCore.totals(estimate.spec.sections, 0);   // the Estimator prices with tax 0
```

`golden/<id>.json` holds, for every bundled estimate, each system's sell, each line's extended sell and
`totals()`, all computed by this engine over the stored sections. Reproduce those files and your
pricing matches Peak's.

Conventions: money is plain dollars. `round2` rounds to the cent (`Math.round(n × 100) / 100`,
`PeakEstimatingCore.round2`). A **margin** is always margin on *price*, never markup:
**sell = cost ÷ (1 − margin)**, so a 30 % margin on a $70 cost sells at $100.

## 1. A line

- **Extended sell** = qty × unit sell (`price`), unless the line carries an extended-sell override
  (`extSellOverride`), which is used as typed (floored at $0). `PeakEstimatingCore.lineExtSellOf`
- **Line cost** = qty × unit cost. A line's margin readout is (sell − cost) ÷ sell
  (`PeakEstimatingCore.lineMarginOf`).
- **Typing a unit sell** stores it to the cent and clears any extended-sell override
  (`PeakEstimatingCore.priceFromUnitSellEdit`). **Typing an extended sell** back-solves the unit sell as
  ext ÷ qty, at full precision so qty × price gives back exactly the typed figure. A qty of 0 becomes 1
  (`PeakEstimatingCore.backSolveExtSell`).
- **Margin slider** (per system, or "Reprice every line"): every line becomes round2(cost ÷ (1 − m)) and
  loses its extended-sell override (`PeakEstimatingCore.repriceAtMargin`). A vendor-quote line whose cost
  changes keeps the margin it already carries (`PeakEstimatingCore.repricedAtLineMargin`).
- **Option lines** (`option: true`) are optional scope. They are left out of the system's price and the
  grand total, and summed separately into `totals.opt`. **Allowance lines** (`allowance: true`) are
  ordinary priced lines with no committed part.
- **POR lines** (`por: true`, price on request) carry no price until Peak sets one.

## 2. Adding a part — tiers and margins

Every customer has a **pricing tier**. The tier's margin seeds the sell of most lines added to the
estimate.

- **Which tier**: the attention contact's tier, else the company's, else `base`. The quote stamps the
  tier and its margin (`pricingTier`, `tierMargin`) when it is created, and re-stamps them when the
  customer or contact changes. The tier margins are Estimating Rules (`tiers.<tier>`, in percent); the
  defaults are base 30 %, copper 27 %, silver 22 %, gold 20 %, platinum 15 %, reseller 10 % and employee
  5 %. Tier lookup belongs to your customer system: it is the `customers` port (`ports.md`), not the
  engine.
- **Seed margin** = the stamped tier margin when it is a real fraction (0 < m < 1), else **30 %**
  (`PeakEstimatingCore.seedMarginOf`, `PeakEstimatingCore.TIER_FALLBACK_MARGIN`).
- **A catalog part** added from the picker sells at round2(cost ÷ (1 − seed margin)). A part with no
  cost sells at its catalog **list** price (`PeakEstimatingCore.catalogAddPrice`). The CSV material
  import and the track configurator use the same rule.
- **A custom part** sells at a flat **35 %** margin, not the tier: round2(cost ÷ 0.65)
  (`PeakEstimatingCore.customPartSell`, `PeakEstimatingCore.CUSTOM_PART_MARGIN`).
- **Labor** seeds at the tier margin rounded to a whole percent and capped at 95 %
  (`PeakEstimatingCore.laborSeedMarginOf`).
- **Changing the customer's tier** re-prices every line still at the *old* tier's seed, within a cent
  (5¢ for labor lines), to the new seed. Hand-priced lines (an extended-sell override, or a sell off the
  old seed) are kept and counted. Fixtures, POR lines, no-cost lines and bonus lines are never
  tier-priced. A track line's parts follow the line. `PeakEstimatingCore.repriceForTier`
  (`PeakEstimatingCore.isAtTierSeed`, `PeakEstimatingCore.tierSeedPrice`,
  `PeakEstimatingCore.reseedTrackComponents`)

## 3. A system

A system's price is its lines plus freight, then rounded or overridden.

1. **Items sell** = Σ extended sell of its in-total lines: every line except options and the Rewards
   credit (`PeakEstimatingCore.isSystemLine`, `PeakEstimatingCore.systemItemsRev`). **Items cost** =
   Σ qty × cost over the same lines (`PeakEstimatingCore.systemItemsCost`).
2. **Freight** = round2(freight-bearing cost × `freightPct` ÷ 100). Freight-bearing cost is items cost
   *minus* lines marked `noFreight`: a vendor quote that already includes freight, and both bonus lines.
   Freight is charged on **cost**, not sell. `PeakEstimatingCore.systemFreightBase`,
   `PeakEstimatingCore.systemFreight`
3. **Computed sell** = items sell + freight (`PeakEstimatingCore.systemComputedSell`).
4. **The system's price** (`PeakEstimatingCore.systemSellTotal`):
   - a valid **typed system sell** (`sellOverride`: finite, > 0, ≤ $10,000,000, to the cent) is used
     exactly (`PeakEstimatingCore.validSellOverride`, `PeakEstimatingCore.parseSellOverride`);
   - else, when the system carries `priceRound: 25`, the computed sell is rounded **up** to the next
     $25. An exact multiple stays put; it never rounds to nearest
     (`PeakEstimatingCore.servicePricing.ceilToStep`, `PeakEstimatingCore.SYSTEM_PRICE_STEP`);
   - else (a system saved before rounding existed) the computed sell exactly.
5. **The adjustment** = system price − computed sell, to the cent (`PeakEstimatingCore.systemSellAdjustment`).
   It is the $25 round-up or the typed difference.
6. **System margin** = (items sell + adjustment − items cost) ÷ (items sell + adjustment). Freight is
   left out (`PeakEstimatingCore.systemMargin`). A typed sell below cost, or under a 10 % margin, warns
   but never blocks (`PeakEstimatingCore.systemSellWarning`).

**When rounding applies.** The Estimator turns the $25 round-up on for every new system, and on load
for every system of a **draft** estimate (`PeakEstimatingCore.withPriceRound`). Sent, won and lost
estimates keep the prices they were sent at. That is why a draft's on-screen total can differ from
`totals()` of its stored sections (see *What the Estimator shows* below).

### Freight percent

A new system starts at the freight rule's base percent until a venue is picked. Then:
**base % + step % for every full step of one-way miles from the office, capped**. The defaults are
2 % + 1 % per 200 miles, capped at 10 %. An unknown distance charges the cap.
`PeakEstimatingCore.freightRule.freightPctForMiles`, `PeakEstimatingCore.sectionFreightDefault`.
Systems still on the automatic freight (`freightAuto`) follow a venue change. A freight percent typed
by hand is never rewritten (`PeakEstimatingCore.applyAutoFreight`).

## 4. The estimate — `totals()`

`PeakEstimatingCore.totals(sections, taxRatePct)` returns `mat`, `lab`, `fr`, `opt`, `rev`, `cost`, `tax`,
`grand`, `margin`, `adj`, `credit` and, when there is one, `alt`. The Estimator always passes tax **0**.
For every system that is **not** an alternate:

- each in-total line's extended sell adds to `rev`, and its qty × cost to `cost`;
- the line's sell also goes to **labor** (`lab`) when the system's `kind` is `"labor"` or the line is
  `labor: true`, else to **materials** (`mat`);
- option lines go to `opt` only;
- the system's freight adds to `fr`;
- the 2 % **estimator bonus** line's sell is split between `mat` and `lab` in proportion to the
  system's own materials and labor sell;
- the system's **adjustment** (rounding or typed sell) adds to `rev` and `adj`, split between `mat` and
  `lab` the same way. A labor-only system puts it all in labor.

Then:

- `tax` = (rev + fr) × tax rate;
- the **Rewards credit** (one negative line parked on the last system,
  `PeakEstimatingCore.rewardCreditLine.creditLineAmount`) comes off **after** tax, capped so the total
  never goes below $0;
- **grand** = rev + fr + tax − credit;
- **margin** = (rev − cost) ÷ rev. Freight and the credit are not in it.

`PeakEstimatingCore.inclusionsLine` turns mat / lab / fr into the document's "Materials, installation &
freight included" line, naming only what the estimate carries.

## 5. Alternates

A system in an **Alternate group** is priced separately and is **not** part of the total. `totals()`
adds its system price (`systemSellTotal`, so freight and rounding included) to `totals.alt` and nothing
else: no rev, cost, mat, lab, fr, opt or adj. Which systems are alternates is derived from their group
on every read (`PeakEstimatingCore.groups.normalizeSystemOrder`, which stamps `alternate: true`). The
review limit compares the base bid plus the largest Alternate group
(`PeakEstimatingCore.reviewLimits.largestAlternateTotal`).

## 6. Bonuses — the hidden 5 % and 2 % lines

Each eligible system carries up to two automatic, locked, internal lines. The engine writes them and
never shows them to the customer by name. `PeakEstimatingCore.bonusRules.withBonusLines` adds or
refreshes them on every system (`PeakEstimatingCore.bonusRules.sectionWithBonusLines`). The base for
both is the system's in-total lines with every bonus line removed
(`PeakEstimatingCore.bonusRules.stripBonusLines`).

- **5 % package bonus**, only when the system has labor (a labor system, or any `labor: true` line,
  `PeakEstimatingCore.bonusRules.hasLaborLine`):
  - its cost is round2(base cost × 5 %);
  - it sells at that cost × (base sell ÷ base cost), the system's blended markup;
  - it is a labor line, `noFreight`, SKU `BON-PKG-<system id>`.
  - `PeakEstimatingCore.bonusRules.packageBonus`
- **2 % estimator bonus**: round2(2 % × (base sell + the package bonus's sell + the system's freight)).
  On a system with a **typed sell** S, it is round2(S × 2 % ÷ 1.02) instead, so the typed price
  already includes it. It sells at cost (cost = sell), is `noFreight`, and has SKU `BON-EST-<system id>`.
  `PeakEstimatingCore.bonusRules.estimatorBonus`
- Both rates are Estimating Rules (`bonus.packagePct`, `bonus.estimatorPct`, at most 20 %;
  `PeakEstimatingCore.bonusFlags.bonusRatesFrom`). A line built at a non-default rate records it
  (`bonusPct`).
- **When they are derived**: only on system estimates made in the Estimator (not portal, not Grid). A
  **draft** always gets them, at today's rates. A **sent** estimate re-derives them only if it already
  has them, at the rates its lines carry. A **won** or **lost** estimate is never touched: it keeps the
  lines it closed with. `PeakEstimatingCore.bonusRules.bonusRulesApply`,
  `PeakEstimatingCore.bonusRules.bonusRatesFor`
- Both lines raise the price. On the customer document the 5 % folds into labor and the 2 % spreads
  across every row (§10).

## 7. Curtains

One line per curtain: qty = the number of identical curtains, unit cost and sell per curtain.
`PeakEstimatingCore.computeCurtain`, built into a line by `PeakEstimatingCore.curtainItem`.

- **Sewn area** = finished width × (1 + fullness %) × finished height, in sq ft.
- **Fabric rate** ($/sq ft of sewn fabric) comes from the catalog fabric, in this order: its
  `curtainAreaRate`, else Peak's seed rate for that SKU, else its `costPerSqft`, else its cost when the
  part is sold per sq ft, else 0 (`PeakEstimatingCore.curtainPricing.fabricAreaRateOf`).
- **Make-it cost each** = round2(sewn area × fabric rate × (1 + sewing %)). Sewing is an Estimating
  Rule, 10 % by default (`PeakEstimatingCore.curtainPricing.sewnAreaRate`,
  `PeakEstimatingCore.curtainPricing.curtainCost`).
- A **vendor cost** (a real Rose Brand quote) replaces the make-it cost entirely, with no sewing on top.
- **Sell each** = round2(cost each ÷ (1 − margin)). The margin is the tier margin, else 30 %
  (`PeakEstimatingCore.curtainPricing.curtainPrice`).
- A curtain and the track that hangs it share a `curtainTrackKey` (`ct-<curtain line id>-…`). The key
  links them on the cut sheets. It does not change either price.

## 8. Track

One line per configured track: qty 1, unit `lot`, SKU `TRK-<series>`. Its parts ride along as
`components` (`PeakEstimatingCore.trackLine`, `PeakEstimatingCore.trackBom`). The quantities come from
the series (Estimating Rules → Track series) and the configuration
(`PeakEstimatingCore.trackEngine.trackQuantities`). Per track:

- **Length** L = run + the series' overlap when it is bi-parting (`PeakEstimatingCore.trackEngine.trackLengthFt`).
- **Legs**: 2 for a lapped bi-part (a bi-parting series with an overlap), else 1. Leg = L ÷ legs.
- **Straight sticks**: per leg, n = ⌈leg ÷ the longest stick⌉, and each piece is the shortest stick ≥
  leg ÷ n. Sticks = legs × n; splices = legs × (n − 1). **Curved**: n = ⌈leg ÷ curved section length⌉
  per leg; curved track needs a series with curved sections, and a radius at least its minimum.
- **Carriers**: ⌈run × 12 ÷ carrier spacing (in)⌉, less the master carriers (2 bi-parting, else 1).
- **End stops**: 2. A walk-along has 2 per curtain half.
- **Hanging points**: legs × (⌈leg ÷ spacing⌉ + 1), as batten clamps or ceiling hangers. Pipe clamps
  match them on a batten when the series maps one. A lapped batten bi-part adds 2 lap clamps.
- **Cord-operated** (bi-parting, one-way) adds a live pulley, a dead pulley, a floor block and
  operating line = ⌈2L + 2 × trim (default 20 ft) + the series' line allowance⌉ ft.
- Everything above is × the number of identical tracks.

Pricing: each part is priced as a catalog add would be (`catalogAddPrice`). The line's cost is
Σ part cost × qty. Its sell is round2(Σ costed parts' cost × qty ÷ (1 − seed margin) + Σ list × qty of
parts with no cost). A role whose part isn't mapped, or is gone from the catalog, blocks the line and
names the role.

## 9. Fixtures, systems, hardware and racks (assemblies)

The Assembly Builder's records price **live** from today's catalog
(`PeakEstimatingCore.fixtureAssemblies.resolveFixture`,
`PeakEstimatingCore.fixtureAssemblies.allAssembliesFrom`):

- each part's **cost** = its cost override when set, else its catalog cost. Its **sell** = its catalog
  **list** price, never the tier;
- only parts with qty ≥ 1 count. A qty-0 part is an optional add-on;
- **assembly cost** = Σ cost × qty, and **assembly sell** = Σ list × qty.

Adding one to an estimate (`PeakEstimatingCore.fixtureBomLine`,
`PeakEstimatingCore.assemblyComponentTotals`) makes **one line**. Its qty is the configured quantity. Its
unit cost and sell are the sums over the parts at the quantities chosen in the configurator, with
optional add-ons switched on or off. The parts ride along as `components`, and the line is
`fixture: true`. An assembly that sells for $0 can't be added.

A **rack** prices the same way. Its parts are its rack-level parts, then one group per placed SKU
(qty = that SKU's non-optional placements). When any placement carries a cost override, the group's
unit cost is the mean of (override, else catalog cost) over its placements. The line also carries the
rack's `rackId`. The RU, weight, power and heat figures (`PeakEstimatingCore.rackRules.totals`) are
engineering readouts, not prices.

## 10. Labor

The labor configurator builds a set of lines from one draft (`PeakEstimatingCore.computeLabor`,
`PeakEstimatingCore.computeMob`, `PeakEstimatingCore.buildLaborItems`). Hourly rates come from the live
catalog's Labor parts by SKU, falling back to built-in defaults
(`PeakEstimatingCore.makeLaborRate`, `PeakEstimatingCore.LABOR_RATES_FALLBACK`). The discipline is
RIG, LIG, AUD, VID or OTH.

**Per mobilization:**

- regular hours per day = min(8, scheduled hours, at most 24). Regular man-hours = people × days ×
  regular hours per day;
- **supervisor** hours = days × regular hours per day, when there is crew. Installer hours = regular −
  supervisor. Regular cost = installer hours × `<disc>-LBR` + supervisor hours × `<disc>-SUP`;
- **overtime** hours = people × days × (scheduled − 8), at `<disc>-OT`;
- vehicles (and hotel rooms) = ⌈people ÷ 2⌉;
- **mileage**: local = round-trip miles × vehicles × days × `TVL-MIL`. Travel = round-trip miles ×
  vehicles × `TVL-MIL` (they drive there once);
- **hotel** (travel only) = days × rooms × `TVL-HTL`. **Per diem** (travel only) = people × days × `TVL-FOD`;
- **lift** = ⌈days ÷ 5⌉ rentals × (the typed rate, else `EQP-LIFT`).

**Per labor draft:**

- PM hours default to a share of all regular man-hours: RIG 10 %, LIG 5 %, AUD 5 %, VID 10 %, OTH 10 %
  (`PeakEstimatingCore.LABOR_PCT`);
- drafting hours default to 2 %;
- shop & engineering cost = PM hours × `SHP-PM` + shop hours × `SHP-IN` + drafting hours × `DRF-SUB`;
- plus a misc allowance in dollars;
- **sell** = cost ÷ (1 − margin), with the margin capped at 95 %.

**The lines:**

- one crew line per mobilization (with its `mob`), then a separate line for each travel cost (mileage,
  hotel, per diem, lift) that costs something. These share the mobilization's `laborMobKey`;
- a shop & engineering line and a misc line (`laborOverhead`);
- each line sells at round2(cost ÷ (1 − margin)). The rounding drift (≤ 5¢ a line) lands on the last
  line, so the lines sum to the configurator's total.

**On the customer document:** travel lines fold back into their mobilization line. Overhead lines (shop
& engineering, misc, the 5 % package bonus) fold into the mobilization lines by cost weight, else into
other labor lines by sell, else into one neutral "Project management, engineering & shop" row
(`PeakEstimatingCore.customerLines`, `PeakEstimatingCore.foldLaborMobLines`).

## 11. What the customer sees

The customer document never shows cost, margin, overhead lines, travel lines or either bonus line, yet
its rows always add up to the system price.

- **Rows** = `PeakEstimatingCore.customerLines(system)`. This applies the labor folds (§10). The 2 %
  estimator bonus is spread over every row in proportion to its amount. The system's adjustment ($25
  rounding or typed sell) is spread the same way. The rounding remainder lands on the largest row, and
  no row goes below $0 (`PeakEstimatingCore.absorbSellAdjustment`).
- A system prints in the body only when it carries some revenue (`PeakEstimatingCore.systemPrintsInBody`).
- Amounts print as `$1,234.56` (`PeakEstimatingCore.fmt`).

## 12. What the Estimator shows vs. the golden files

The golden files are the engine's contract: `totals()` over the sections **as stored**. When you open a
**draft**, the Estimator first canonicalizes the sections. It sorts the systems into group order, turns
on the $25 round-up for every system that lacks it, and adds or refreshes the bonus lines at today's
rates. So a draft's on-screen "Quoted total" can be higher than its golden `grand`. Saving stores the
canonical sections, and the saved value (`PeakEstimatingCore.reconcileEstimatorValue`) is `totals()` of
those.

In code:

1. `PeakEstimatingCore.groups.normalizeSystemOrder`, then
2. `PeakEstimatingCore.withPriceRound` (draft, not a portal quote), then
3. `PeakEstimatingCore.bonusRules.withBonusLines` at `PeakEstimatingCore.bonusRules.bonusRatesFor`'s
   rates, when `PeakEstimatingCore.bonusRules.bonusRulesApply`,
4. then `PeakEstimatingCore.totals(…, 0).grand`.

Both numbers are verified: the package's checks compare every golden file to this engine byte for byte,
and every sampled estimate's on-screen total to steps 1–4.
