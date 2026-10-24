# Markup pricing — design

**Date:** 2026-10-23 · **Asked by:** Jeff · **Punch item:** #367 (confirm the number at merge)
**Supersedes:** the margin-on-price convention (D87, D88, D413, D635 and the entries listed in §9)

## 1. Goal

Every pricing percentage in Quartzite becomes **markup on cost**:

    sell = cost × (1 + markup)        markup = (sell − cost) ÷ cost

instead of today's margin on price (`sell = cost ÷ (1 − margin)`). The math
itself changes, not just the labels (approach B). **No saved quote changes its sell
amount.** Each stored margin is rewritten as the exact equivalent markup:

    markup = margin ÷ (1 − margin)     margin = markup ÷ (1 + markup)
    30% margin = 42.857% markup · 20% = 25% · 35% = 53.846%

## 2. Decisions (Jeff, Oct 23)

| # | Question | Answer |
|---|---|---|
| 1 | Keep today's prices or today's numbers? | **Keep prices.** Convert the numbers. |
| 2 | What do reports show? | **Markup only**, everywhere. No margin column. |
| 3 | Converted settings values | **Round to a whole %** at the switch. |
| 4 | Values stored on saved quotes | **Convert exactly.** Only settings and code constants round. |
| 5 | Approach | **B: rewrite the math to markup** (Jeff switched from A). |
| 6 | How saved docs convert | **Stamp + convert on read.** No bulk job. |

## 3. What users see

- **One word.** Every pricing % is "Markup", never "margin" or "pts". This covers:
  - Estimating Rules: customer tiers, service defaults, repair parts, the catalog default, and the formula rows.
  - The Estimator: Markup · all systems, per system, per line, the labor modal, the vendor quote "Sell at N%" and the custom-part form.
  - The three service builders' knob and the typed-total field.
  - The tier prompt ("Kept your 54% markup — Gold is 25%") and the tier re-price banner.
- **Reports and exports show markup only.** These are the Estimator header's blended figure, the Review cost summary, the Quotes hub, the Home stage sheet, the project page, the dashboard average tiles, the parts CSV ("Line markup", "Effective markup") and the review spreadsheet. On the spreadsheet, the existing true-markup column becomes the only % column and "Line margin" is dropped. Dollar figures (projected profit, system markup $) don't change.
- **Ranges and thresholds**, converted and rounded:

| Thing | Today (margin) | New (markup) |
|---|---|---|
| Estimator sliders (all systems, per system) | 0–55 % | 0–125 % |
| Service knob | 10–50 (server clamp 5–50) | 10–100 % (server clamp 5–100) |
| Estimating Rules cap on a % rate | 60 % | 150 % |
| Low warning (service totals, typed system sell) | under 10 pts | under 11 % |
| Line colours green / amber (`marginColor`) | 30 % / 18 % | 43 % / 22 % |
| Labor clamp | 0.95 margin | 19 (1,900 %) markup |

- **Typed prices behave as they do today.** A typed system sell or service total back-solves the markup, and "Reset keeps this markup."
- **Wherever the formula is printed** (`fabric-rate-field.tsx`, `custom-items.tsx`, the Estimating Rules `formula(...)` rows) it reads `cost × (1 + markup)`.
- **Mislabelled spots get fixed.** Repair "Parts markup" and `catalog.defaultMargin` ("Default markup") are already called markup but run margin math. They become real markup.

## 4. The converter module

`src/lib/markup/` is pure, has no imports from stores, and is the only place the conversion lives.

- `marginToMarkup(m)` and `markupToMargin(k)`. Both are guarded: `m ≥ 1` or `k < 0` return the input clamped, never `Infinity` or `NaN`.
- `sellAt(cost, markup) = cost × (1 + markup)`. It replaces every `cost ÷ (1 − m)` and `cost ÷ m'` form.
- `markupOf(cost, sell) = (sell − cost) ÷ cost`, and `null` when `cost ≤ 0`. It replaces every `(sell − cost) ÷ sell` and `1 − cost ÷ sell`.
- `costFromSell(sell, markup) = sell ÷ (1 + markup)`. It replaces the inverse forms (Grid labor `amount × (1 − margin)`, dashboard book cost `value × (1 − blended)`).
- `roundMarkupPct(k)` rounds to a whole %. It's used only by the settings conversion.
- `PRICING_BASIS = "markup"` is the stamp value.

## 5. Data

### 5.1 The stamp and convert-on-read

Every doc that stores a pricing fraction gains `pricingBasis?: "markup"`. **A doc without the stamp is margin.** One read-time step per doc type converts every stored fraction exactly with `marginToMarkup`, then sets the stamp. The next save writes it back stamped. A stamped doc is never converted again.

The step runs where each store reads its docs (the read seam each store already uses for legacy conversions), so every reader, server action, print route, portal page and harness sees markup.

| Doc | Fields converted |
|---|---|
| Quote (`stores/quotes.ts`) | `margin` (blended), `tierMargin` (stamped seed), per-system and per-line margin overrides, `laborGroups[*].draft.margin` (percent string), vendor-quote line margins |
| Service sub-docs `flameTest` / `repair` / `inspection` | `rates.margin`, `repair.partsMargin`; `marginAmount` is dollars and stays as is |
| Quote revisions + won version (`quote-won-version.ts`) | same as Quote, frozen copies included |
| Project (`stores/projects.ts`) | `margin` |
| Design (`stores/designs.ts`), Grid projects, Quick Design | `margin`, `tierMargin`, table margins |
| Portal carts / portal quotes | any stamped `tierMargin` / `serviceMargin` |
| Leads, assessments → quote, narrative system library | stamped `tierMargin` |

Line prices (`price`, `extSellOverride`, typed sells) are never touched. That's what keeps every sell amount identical.

**Bonus percents (`bonusPct`, `bonus.packagePct`/`estimatorPct`) and freight % of cost are not margins and don't convert.** The package bonus's "marked up at the system's blended rate" already multiplies by sell ÷ cost, and keeps doing so. The estimator-bonus back-solve `typed·pct/(1+pct)` is a percent of price and stays.

### 5.2 Settings

At the switch, a one-time settings conversion reads each margin rate, converts it, rounds it to a whole %, writes it as markup and stamps the blob. The old values are kept beside it (`marginBackup`), the way `settings.fixtureAssemblies` was kept. It's idempotent: a stamped blob is skipped. It runs lazily on the first read of each blob, so every environment converts itself, including production after the merge deploy.

| Blob / key | Today | Converts to |
|---|---|---|
| `pricing_rules` `tiers.base/copper/silver/gold/platinum/reseller/employee` (whole %) | 30/27/22/20/15/10/5 | 43/37/28/25/18/11/5 |
| `pricing_rules` `system.baseMargin` (reference only) | 30 | 43 |
| `flametest_rates.margin`, `inspection_rates.margin`, `repair_rates.margin` (fraction) | 0.30 | 0.43 |
| `repair_rates.partsMargin` | 0.30 | 0.43 |
| `catalog_rates.defaultMargin` | 0.30 | 0.43 |
| `fixture_rates.customCostFactor` (cost = sell × 0.66) | 0.66 | stays a cost factor; its help text says "≈ 52 % markup" |

Admin-edited values convert the same way: whatever is stored converts and then rounds.

### 5.3 Code constants and defaults

`CURTAIN_MARGIN` (both copies) 0.30 → 0.43 · `TIER_FALLBACK_MARGIN` 0.30 → 0.43 ·
`CUSTOM_PART_MARGIN` 0.35 → 0.54 · `LABOR_COST_FRAC_FALLBACK` 0.7 → cost =
sell ÷ 1.43 · the equipment-map / grid `sellFromCost` fallback 0.30 → 0.43 · the
`TIER_DEFAULTS` in `pricing-tiers.ts` and the `stores/pricing.ts` defaults → the
table above · `LOW_MARGIN_WARN` 0.10 → 0.11 · seed data (`db/seeds/quotes.ts`,
`projects.ts`) → exact markup + stamped.

Constants are renamed to say markup (`CURTAIN_MARKUP`, …). The fields stored on docs (`margin`, `tierMargin`, `rates.margin`, `partsMargin`) keep their names and hold markup once stamped. Renaming persisted keys would force a second migration. The stamp and a header comment on each type say what the field holds.

### 5.4 What prices move

Only new pricing that reads a rounded setting or constant moves. Base on $1,000 cost goes from $1,428.57 to $1,430, a custom part on $100 cost from $153.85 to $154, Gold from $1,250 to $1,250 (exact). Saved quotes, revisions, sent and won quotes, projects and portal quotes keep their sell amounts to the cent. A saved draft re-priced later through a tier change uses the new rounded tier value.

## 6. Engines and back-solves

All ~85 formula sites switch to `sellAt`, and ~25 back-solves switch to `markupOf`. The inventory is in the implementation plan, grouped by engine:

- **Estimator.** `pricing.ts` (`repriceAtMargin` → `repriceAtMarkup`, `repricedAtLineMargin`, `lineMarginOf`, `systemMargin`, `totals().margin`, `reconcileEstimatorValue`, `computeLabor`, `buildLaborItems`, `computeCurtain`, `systemSellWarning`), `tier-reprice.ts`, `use-estimator-state.ts` (set-all / per-system, custom allowance, vendor quote, `freshLabor`), `labor-group.ts`, `copy-system.ts` (`keepMarginOnNewCost`), `track-bom.ts`, `vendor-quote-modal.tsx`, `catalog-picker.tsx`, `section-card.tsx`.
- **Services.** `service-pricing.ts` (`sellAtMargin`, effective margin, the repair service and parts back-solve, lift, printed travel, `typedPriceWarning`, slider bounds), `flametest-engine.ts`, `inspection-engine.ts`, `repair-engine.ts`, `travel-plan.ts`, `renewal-outreach.ts`, the three `quote/actions.ts` and `letter-view.tsx`, `portal-service-pricing.ts`, `service-total-field.tsx`, `tier-seed.ts`.
- **Curtains.** `lib/curtain-pricing.ts`, `lib/design/curtain-pricing.ts`, `grid-curtains.ts`.
- **Grid / Quick Design.** `grid-quote.ts` (tier list, conduit, curtains, custom items, labor cost), `grid-bom.ts` `bomTotals`, `grid-accessories.ts`, `grid-custom-items.ts`, `equipment-map.ts`, `equipment-map-view.ts`, `grid-virtual-parts.ts`, `equipment-pricing.ts`, `auto-estimate.ts`, `design/grid/[id]/actions.ts` and `page.tsx`, `design/quick/engine.ts`, `tier-pricing.ts` `isTierPriced`.
- **Portal.** `portal-price-rules.ts`, `portal-pricing.ts`, `portal-part-detail.ts`.
- **Other.** `system-categories.ts`, `assist/features/suggestion.ts`, `narrative/load-system.ts`, `library-actions.ts`, `estimate-bonus/rules.ts` (review only, see §5.1), `dashboard/metrics.ts` (avg markup value-weighted on cost; projected profit = value × k ÷ (1 + k); book cost = value ÷ (1 + k)), and `pricing.ts:551` custom fixture cost.

**The "still at the seed price" checks** must be rewritten, not just relabelled. These are the 5¢ comparisons in `tier-reprice.ts` and `labor-group.ts` and the $0.01 match from D457. Labor's whole-percent seed round keeps rounding the markup.

**Clamps and guards** move to markup terms. The rule `0 < m < 1` becomes `k > 0` (no upper bound beyond the caps in §3). The `< 0.95` guards become `< 19`.

**Not margin-based, no change:** rentals, consulting fees, freight % of cost, fixture configurator add-ons, Quick Design Good/Better/Best `priceMul`, and review limits / approvals (dollar-based).

## 7. Rollout

The work is four slices on one branch, and the app runs after each one:

1. **Core.** `src/lib/markup/`, the stamp + convert-on-read in each store in §5.1, the settings conversion §5.2, and constants §5.3. Between slices 1 and 2 the engines get `markupToMargin(k)` at their entry point, so prices are identical while the formulas still divide.
2. **Engines.** §6, one engine group at a time. The temporary entry-point conversions are removed as each engine switches to `sellAt`.
3. **Screens and words.** Everything in §3.
4. **Docs.** A DECISIONS entry superseding the margin convention, plus PUNCHLIST #367, AGENTS.md phase 67, and the header comments in `pricing-tiers.ts` / `pricing.ts`.

**There's no rollback past the merge; fix forward.** Once a stamped doc is saved, pre-merge code would read 0.43 as margin and mis-price it.

**Never deploy a Vercel preview of this branch.** Previews share the production Neon database. A preview would stamp live quotes and settings while production still runs the margin code.

The production settings convert on the first read after the merge deploy. Back up first with `npm run db:export`.

## 8. Testing

- **Price-parity harness** (`scripts/test-markup-parity.ts`, in `test:specs`):
  - It uses fixtures captured on main before the change: an Estimator quote with labor, a vendor quote, curtains + track, a custom part, a typed system sell and a project discount; a Grid quote with curtains, conduit and labor; one flame-test, one repair (with parts and lift) and one inspection quote with travel (drive + fly); a portal catalog cart and a portal service quote; a renewal re-price; and a Quick Design.
  - Each fixture is priced before (recorded) and after (convert-on-read + markup engines). Every line, system and total must match to the cent.
  - The only allowed differences are new prices from rounded settings. The harness lists each one with old and new prices.
- **Round-trip.** A margin doc read → saved → read again is stamped and keeps the same price. A stamped doc read twice converts once. A settings blob converts once.
- **Rewritten tests.** The ~260 existing margin assertions (≈95% in `scripts/test-review-and-spec.ts`) are rewritten to markup inputs with the same expected dollars. The source-text pins that assert `!/\/ \(1 - margin\)/` become pins that assert no `÷ (1 − …)` pricing form remains in `src/`.
- **Gate:** tsc, `test:specs`, `test:smoke`, eslint and `next build`, then a browser pass on a scratch PGlite dev server. That pass checks each builder's knob, the Estimator sliders and the Estimating Rules tier table.

## 9. Docs that change

These DECISIONS entries get a "superseded by" note: D87, D88, D135, D163, D283, D303, D314, D319, D333, D364, D413, D457, D476, D482, D484, D501, D635, D1231 and D1250. Also OPEN-DECISIONS.md "Cost + margin", the MASTER-QUESTIONS lines on tier percentages, and the AGENTS.md phase notes that quote "margin". Old spec and plan docs are left alone, since they're history.

## 10. Open for Jeff

- Whether the rounded tier table (43/37/28/25/18/11/5) is what you want, or you'd rather set cleaner values (e.g. 45/35/30/25/20/10/5) at the switch. Rounding is the default, and you can edit any of them in Estimating Rules afterward.
- The new slider and knob ranges in §3 (0–125 %, 10–100 %).
