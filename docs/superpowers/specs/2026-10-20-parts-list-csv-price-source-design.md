# Parts list (CSV) v2 — item name, margins, price source

Date: 2026-10-20 · Owner: Jeff · Extends #262 (Estimator → More ▾ → Parts list (CSV))

## Goal

The Estimator's Parts list export says, on every row, what the item is, what it
costs, what it sells for, at what margin, and where that price came from. Catalog
items say `Catalog`.

## Non-goals

- No new export, and no change to which rows appear. Labor, options, alternates,
  bonus lines and the Rewards credit stay out. Assemblies, tracks, racks, fixtures
  and vendor quotes still explode into their parts.
- No new stored field on `SpecItem`. Every value comes from data the line already
  carries.
- No check against today's live catalog price. The cost is the line's snapshot.

## Columns (in order)

| # | Header | Value |
|---|---|---|
| 1 | Manufacturer | unchanged |
| 2 | Item name | today's Model number rule (`lineModel` / `partModel`), else the SKU, else blank. Replaces the `Model number` column. |
| 3 | Description | the row's existing `desc` (line text, catalog desc for a component, vendor line text) — moved up from column 8 |
| 4 | Room | unchanged |
| 5 | System | unchanged |
| 6 | Qty | unchanged |
| 7 | Unit Cost | unchanged |
| 8 | Unit Sell | unchanged — still carries the system's freight / $25 rounding / typed-sell factor `k` |
| 9 | Line margin | `(unitSell_before_k − unitCost) ÷ unitSell_before_k` — the margin as priced on the line |
| 10 | Effective margin | `(Unit Sell − Unit Cost) ÷ Unit Sell` — from this file's own columns |
| 11 | Price source | see below |
| 12 | Notes | unchanged ("Part of: …", "per <unit>", internal notes) |

Margins print as a percent with one decimal (`35.0%`). Negative margins print as
negative (`-4.2%`). Both margins are blank when the relevant sell is 0, and on
cost-adjustment rows.

For an exploded component or a vendor-quote line, the before-`k` unit sell is the
allocated share the code already computes (`sellOf(comp)`, `lineSell × amount ÷
linesTotal ÷ qty`). Line margin therefore equals the parent line's margin wherever
sell is allocated by cost share. It may differ when sell falls back to list-price
share (the assembly has no part costs), and that's correct.

## Price source

First match wins:

1. Vendor-quote line → `Vendor quote — <vendor>` plus ` #<quoteNumber>` when there is one
2. Cost-adjustment row (vendor total ≠ lines, or assembly cost ≠ parts) → `Adjustment`
3. Exploded component (assembly, fixture, track, rack — anything with `components`) → `Catalog`
4. `por` → `Price on request`
5. `allowance` → `Allowance`
6. `curtain` → `Curtain calculator`
7. `custom` → `Custom`
8. SKU resolves in the catalog → `Catalog`, or `Catalog — sell edited` when the line
   has `sellOverride` or a finite `extSellOverride`
9. Anything else, including a SKU that doesn't resolve → `Not in catalog`

The sell-edited suffix applies only in rule 8. A component inherits no suffix from
its parent line.

## Data changes (pure, `src/app/(app)/estimator/parts-csv.ts`)

- `PartsListRow` gains `source: string` and `lineSell: number` (unit sell before
  `k`, unrounded). `modelNumber` stays the internal field name. The header label
  changes, and the CSV writer applies the SKU fallback for Item name.
- `expand()` sets `source` and `lineSell` at each push. `k` scaling continues to
  touch `unitSell` only.
- The consolidation key adds `source`, so a catalog part and the same part entered
  as custom stay on separate rows. Merged rows share system, unit cost and unit sell,
  so their margins agree.
- `PARTS_CSV_HEADER` becomes the 12 columns above. `partsListCsvRows` formats the
  margins.

No server, store, migration or UI change. The menu item, file name and
`resolveCatalogSkusAction` are untouched.

## Reconciliation (unchanged invariants)

- Σ qty × Unit Cost = the estimate's material cost.
- Per system, Σ qty × Unit Sell = the system price (freight in) less labor lines' share.

## Testing (`scripts/test-review-and-spec.ts`, the #262 block)

- The header assertion becomes the 12 columns.
- Each source label, from a fixture line per rule (vendor quote with and without a
  quote number, adjustment, component, POR, allowance, curtain, custom, catalog,
  catalog with `sellOverride`, catalog with `extSellOverride`, unknown SKU).
- Line margin vs Effective margin: a system with freight shows Effective > Line. A
  system with no freight and no rounding shows them equal.
- Margin blanks: sell 0, and adjustment rows.
- The merge-key split: the same SKU as catalog and as custom stays two rows.
- Item name falls back to the SKU when the part has no model.
- The existing reconciliation assertions still pass unchanged.

## Logging

DECISIONS.md entry: the #262 header changes. `Model number` is renamed `Item name`
and Description moves to column 3, at Jeff's request (2026-10-20).
