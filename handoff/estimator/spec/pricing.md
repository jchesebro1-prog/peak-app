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
`PeakEstimatingCore.round2`). **Every percentage Peak prices with is a markup on cost**:
**sell = cost × (1 + markup)** (`sellAt` in the `markup` module), so a 43 % markup on a $70 cost sells at
$100.10, and **markup = (sell − cost) ÷ cost**. This replaced margin-on-price (sell = cost ÷ (1 − margin))
on Oct 23, 2026. Prices already saved did not move: each stored margin was converted to the exact
equivalent markup (*Stored basis* below). A field still named `margin` or `tierMargin` on a stored quote holds
a **markup** once the quote is stamped `pricingBasis: "markup"`; `totals()` reports `markup`.

## 1. A line

- **Extended sell** = qty × unit sell (`price`), unless the line carries an extended-sell override
  (`extSellOverride`), which is used as typed (floored at $0). `PeakEstimatingCore.lineExtSellOf`
- **Line cost** = qty × unit cost. A line's markup readout is (sell − cost) ÷ cost
  (`PeakEstimatingCore.lineMarkupOf`; null without a positive cost).
- **Typing a unit sell** stores it to the cent and clears any extended-sell override
  (`PeakEstimatingCore.priceFromUnitSellEdit`). **Typing an extended sell** back-solves the unit sell as
  ext ÷ qty, at full precision so qty × price gives back exactly the typed figure. A qty of 0 becomes 1
  (`PeakEstimatingCore.backSolveExtSell`).
- **Markup slider** (per system, or "Reprice every line", 0–125 %): every line becomes
  round2(cost × (1 + k)) and loses its extended-sell override (`PeakEstimatingCore.repriceAtMarkup`). A
  vendor-quote line whose cost changes keeps the markup it already carries
  (`PeakEstimatingCore.repricedAtLineMarkup`).
- **Option lines** (`option: true`) are optional scope. They are left out of the system's price and the
  grand total, and summed separately into `totals.opt`. **Allowance lines** (`allowance: true`) are
  ordinary priced lines with no committed part.
- **POR lines** (`por: true`, price on request) carry no price until Peak sets one.

## 2. Adding a part — tiers and markups

Every customer has a **pricing tier**. The tier's markup seeds the sell of most lines added to the
estimate.

- **Which tier**: the attention contact's tier, else the company's, else `base`. The quote stamps the
  tier and its markup (`pricingTier`, `tierMargin` — the field keeps its old name and holds a markup) when it
  is created, and re-stamps them when the customer or contact changes. The tier markups are Estimating Rules
  (`tiers.<tier>`, in percent, up to 150): **base 43 %, copper 37 %, silver 28 %, gold 25 %, platinum 18 %,
  reseller 11 %, employee 5 %**. (Before the markup switch these were the margins 30 / 27 / 22 / 20 / 15 / 10 / 5, each
  converted to the equivalent markup and rounded to a whole percent.) Tier lookup belongs to your customer
  system: it is the `customers` port (`ports.md`), not the engine.
- **Seed markup** = the stamped tier markup when it is a real fraction (0 < k ≤ 19), else **43 %**
  (`PeakEstimatingCore.seedMarkupOf`, `PeakEstimatingCore.TIER_FALLBACK_MARKUP`).
- **A catalog part** added from the picker sells at round2(cost × (1 + seed markup)). A part with no
  cost sells at its catalog **list** price (`PeakEstimatingCore.catalogAddPrice`). The CSV material
  import and the track configurator use the same rule.
- **A custom part** sells at a flat **54 %** markup, not the tier: round2(cost × 1.54)
  (`PeakEstimatingCore.customPartSell`, `PeakEstimatingCore.CUSTOM_PART_MARKUP`; it was a 35 % margin).
- **Labor** seeds at the tier markup rounded to a whole percent and capped at 1,900 %
  (`PeakEstimatingCore.laborSeedMarkupOf`).
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
6. **System markup** = (items sell + adjustment − items cost) ÷ items cost. Freight is left out
   (`PeakEstimatingCore.systemMarkup`). A typed sell below cost, or under an 11 % markup, warns but never
   blocks (`PeakEstimatingCore.systemSellWarning`).

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

### Project discounts lower cost, never sell

A line's `cost` can carry a vendor's project discount (`data-model.md` → *Project discounts*). The line keeps
its normal cost as `catalogCost` (`normalCostOf(line)` is `catalogCost`, else `cost`), and the customer's price is
figured on **that**: the freight base (`PeakEstimatingCore.systemFreightBase`), the 5 % package bonus's cost
basis, and the tier seed (so a discounted line still counts as at its tier price and re-prices on a tier change
exactly as an undiscounted one) all read the normal cost. `price`, an edited sell, a typed system sell and the $25
rounding are never touched. So a discount changes cost and markup only: sell, freight, both bonus lines and the
grand total are identical with and without it, and the saving shows as markup. The customer rows are identical.

### Stored basis — margin to markup

Peak's stored data predates the switch, so a doc can hold either basis, and the stamp says which.

- **Quotes (and projects) convert on read.** A quote **without** `pricingBasis: "markup"` stores margins.
  Reading it converts every stored pricing fraction exactly, markup = m ÷ (1 − m) (a margin of 0.95 or more
  caps at 19): the blended `margin`, `tierMargin`, each revision's two, a service quote's rates, and a labor
  draft's percent string. **No sell amount is touched**: `price`, extended-sell overrides, typed system sells
  and `value` stay exactly as stored, which is why every saved quote still totals the same to the cent. The
  converted doc is stamped, and a **stamped doc is never converted again**.
  The arithmetic is the pure `marginToMarkup` and the doc rule `hydrateDoc`, both in `src/lib/markup/`. A new
  doc is born stamped.
- **Rate settings convert once.** Each stored rate (the seven tiers, the system base, flame-test, repair,
  repair parts and inspection defaults, the catalog default) is converted **and rounded to a whole percent**
  the first time it is read, then stamped `_pricingBasis: "markup"` with the old values kept in `_marginBackup`.
  Examples: 30 → 43, 27 → 37, 22 → 28, 20 → 25, 15 → 18, 10 → 11, 5 → 5 (a margin of 5 % is 5.26 % markup).
  An admin-edited rate converts the same way.
- **The prototype applies the same two rules** with the app's own converters: the slicer converts every bundled
  quote and rate blob before writing `data/*.js`, and the browser store converts anything still unstamped on
  read (`ports.md`). So `data/estimates.js` is already on the markup basis; a quote's `margin` and `tierMargin`
  there are markups, and `golden/` (computed from the stored sections' prices) is unaffected by the basis.

## 4. The estimate — `totals()`

`PeakEstimatingCore.totals(sections, taxRatePct)` returns `mat`, `lab`, `fr`, `opt`, `rev`, `cost`, `tax`,
`grand`, `markup`, `adj`, `credit` and, when there is one, `alt`. The Estimator always passes tax **0**.
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
- **markup** = (rev − cost) ÷ cost. Freight and the credit are not in it. (Before the markup switch this was the margin
  (rev − cost) ÷ rev, reported as `margin`.)

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
  - its sell is round2(that cost × (base sell ÷ base cost)), the system's blended markup;
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
- **Sell each** = round2(cost each × (1 + markup)). The markup is the tier markup, else 43 %
  (`PeakEstimatingCore.curtainPricing.curtainPrice`).
- A curtain and the track that hangs it share a `curtainTrackKey` (`ct-<curtain line id>-…`). The key
  links them on the cut sheets. It does not change either price.

## 8. Track

One line per configured track: qty 1, unit `lot`, SKU `TRK-<series>`. Its parts ride along as
`components` (`PeakEstimatingCore.trackLine`, `PeakEstimatingCore.trackBom`). The quantities come from
the series (Estimating Rules → Track series) and the configuration
(`PeakEstimatingCore.trackEngine.trackQuantities`). Per track:

- **Parts at center**: a bi-parting track, or a walk-along bi-part (`PeakEstimatingCore.trackEngine.partsAtCenter`).
- **Length** L = run + the series' overlap when the track parts at center — bi-parting or a
  walk-along bi-part (`PeakEstimatingCore.trackEngine.trackLengthFt`).
- **Legs**: 2 for a lapped bi-part (parts at center, and the series has an overlap), else 1. Leg = L ÷ legs.
- **Straight sticks**: per leg, n = ⌈leg ÷ the longest stick⌉, and each piece is the shortest stick ≥
  leg ÷ n. Sticks = legs × n; splices = legs × (n − 1). **Curved**: n = ⌈leg ÷ curved section length⌉
  per leg; curved track needs a series with curved sections, and a radius at least its minimum.
- **Splices**: on a ceiling (not batten) mount, the series' **ceiling splice** replaces the splice
  when the series maps one; same count.
- **Carriers**: ⌈run × 12 ÷ carrier spacing (in)⌉, less the master carriers (2 when it parts at
  center, else 1).
- **End stops**: 2. A walk-along has 2 per curtain half (4 on a walk-along bi-part), as walk-along end
  stops when the series maps them.
- **Hanging points**: legs × (⌈leg ÷ spacing⌉ + 1), as batten clamps or ceiling hangers. Pipe clamps
  match them on a batten when the series maps one. A lapped batten bi-part adds 2 lap clamps (when
  mapped).
- **Center pipe supports** (batten mount, when the series maps one and sets "every" ft):
  ⌈L ÷ every⌉ − 1, never below 0.
- **Cord-operated** (bi-parting, one-way) adds a live pulley, a dead pulley, a floor block and
  operating line = ⌈2L + 2 × trim (default 20 ft) + the series' line allowance⌉ ft. On a one-way
  track the series' **one-way dead-end pulley** replaces the dead pulley when it maps one.
- Everything above is × the number of identical tracks.

Pricing: each part is priced as a catalog add would be (`catalogAddPrice`). The line's cost is
Σ part cost × qty. Its sell is round2(Σ costed parts' cost × qty × (1 + seed markup) + Σ list × qty of
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
- **sell** = cost × (1 + markup), with the markup capped at 1,900 % (`MARKUP_MAX`).

**The lines:**

- one crew line per mobilization (with its `mob`), then a separate line for each travel cost (mileage,
  hotel, per diem, lift) that costs something. These share the mobilization's `laborMobKey`;
- a shop & engineering line and a misc line (`laborOverhead`);
- each line sells at round2(cost × (1 + markup)). The rounding drift (≤ 5¢ a line) lands on the last
  line, so the lines sum to the configurator's total.

**On the customer document:** travel lines fold back into their mobilization line. Overhead lines (shop
& engineering, misc, the 5 % package bonus) fold into the mobilization lines by cost weight, else into
other labor lines by sell, else into one neutral "Project management, engineering & shop" row
(`PeakEstimatingCore.customerLines`, `PeakEstimatingCore.foldLaborMobLines`).

## 11. What the customer sees

The customer document never shows cost, markup, overhead lines, travel lines or either bonus line, yet
its rows, together with the system's freight row, always add up to the system price.

- **Rows** = `PeakEstimatingCore.customerLines(system)`, plus a separate **Freight** row when the
  system has freight (`PeakEstimatingCore.systemFreight`); rows + freight = the system price
  (`PeakEstimatingCore.systemSellTotal`). This applies the labor folds (§10). The 2 %
  estimator bonus is spread over every row in proportion to its amount. The system's adjustment ($25
  rounding or typed sell) is spread the same way. The rounding remainder lands on the largest row, and
  no row goes below $0 (`PeakEstimatingCore.absorbSellAdjustment`) — so only a typed sell below the
  system's freight can leave the rows short of the total.
- A system prints in the body only when it carries some revenue (`PeakEstimatingCore.systemPrintsInBody`).
- Amounts print as `$1,234.56` (`PeakEstimatingCore.fmt`).
- **A box goods sale** (`Quote.boxSale`, `data-model.md`) changes no pricing: it has no labor, so the
  5 % package bonus never exists, and the 2 % estimator bonus and freight price as usual. Only the
  document differs: it is the BOM view below.
- **The BOM view** (the BOM tab, print and package-page BOM toggle) is the same rows and totals with
  display switches from `pdfOptions`: *Line prices* hides the per-line amounts (and each system's freight
  amount), *Materials* and *Labor* hide those totals rows, *Freight* hides every freight row. They only
  hide figures; system prices, tax, the Rewards credit and the Total always print and still add up.
  Plain catalog lines print as *Model — Description*.

## 12. What the Estimator shows vs. the golden files

The golden files are the engine's contract: `totals()` over the sections **as stored**. When you open a
**draft**, the Estimator first canonicalizes the sections. It sorts the systems into group order, turns
on the $25 round-up for every system that lacks it, and adds or refreshes the bonus lines at today's
rates. So a draft's on-screen "Quoted total" can **differ** from its golden `grand` — usually higher
(the round-up and the bonus lines add), but lower too, for example when a stored bonus line was built
at a higher rate than today's. **Won and lost** estimates are never re-derived, and a **sent**
estimate only refreshes the bonus lines it already has, at the rates they carry (§6) — which
reproduces what was saved — so a sent or won estimate's header matches its golden `grand`. Saving stores the canonical sections, and the saved value
(`PeakEstimatingCore.reconcileEstimatorValue`) is `totals()` of those.

This is a deliberate invariant, not a gap: **golden = the engine contract over the stored data**
(raw `totals()`); **the header = what the Estimator shows after load** (steps 1–4 below). The
package's checks hold each to its own definition.

In code:

1. `PeakEstimatingCore.groups.normalizeSystemOrder`, then
2. `PeakEstimatingCore.withPriceRound` (draft, not a portal quote), then
3. `PeakEstimatingCore.bonusRules.withBonusLines` at `PeakEstimatingCore.bonusRules.bonusRatesFor`'s
   rates, when `PeakEstimatingCore.bonusRules.bonusRulesApply`,
4. then `PeakEstimatingCore.totals(…, 0).grand`.

Both numbers are verified: the package's checks compare every golden file to this engine byte for byte,
and every sampled estimate's on-screen total to steps 1–4.
