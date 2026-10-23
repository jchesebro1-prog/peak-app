# Project discounts on catalog parts — design

Date: 2026-10-22 · Owner: Jeff

## Goal

A vendor sometimes gives Peak special pricing on a part for one job (e.g. ETC registered-project
pricing on a fixture). The estimator records it on the estimate as an extra **% off our cost** for that
catalog part. Peak's cost drops, the customer's price does not move, and the savings show as margin.

## Decisions (Jeff, 2026-10-22)

| Question | Answer |
|---|---|
| Whose discount | **Our cost** (vendor project pricing), not the customer's price |
| Sell price | **Stays put** — margin rises |
| What one discount covers | **One catalog part (SKU)**, wherever it appears on the estimate |
| Which parts | **Any catalog part** (fixtures are the main use) |
| Inside assemblies | **Yes** — a matching assembly part is discounted too |
| Entered as | **% off our normal cost** |
| Where it's set | **On the line**, applying to that SKU estimate-wide; a short list shows them all |
| Also shows in | **Review spreadsheet**, **the won project**, and a **reference note** per discount |
| Freight / 5% package bonus | Figured on the **normal** cost, so the customer's price is identical |

## Non-goals

- Discounts on the customer's sell price.
- Manufacturer-wide discounts (one % for every ETC part).
- A project unit cost typed in dollars (only % off).
- Real per-line project procurement. Today a won project's procurement list is the prototype's
  placeholder (a few package rows priced as a % of value — `deriveProcurement` in
  `src/lib/stores/projects.ts`). Making procurement follow the estimate's real lines is separate work.
- Anything customer-facing. The customer never sees a discount, a chip, or a changed number.

## Model

**One source of truth on the estimate:** `spec.projectDiscounts`, a map keyed by the trimmed catalog
SKU → `{ pct, note, by, at }`.
- `pct`: a percent number, 0 < pct < 100, at most two decimals. 0 or blank removes the entry.
- `note`: up to 200 characters, e.g. a vendor's project registration or quote number.
- `by` / `at`: who set it and when (epoch ms), stamped by the server.
- A cap of 200 entries per estimate.

**Stamped on the lines:** every line, and every assembly part (`components[]`), whose SKU has a
discount carries:
- `catalogCost`: its normal cost (what `cost` would be with no discount).
- `cost` = `round2(catalogCost × (1 − pct/100))`.
- `projectDiscountPct`: the % applied (a mirror of the map entry, for readers that see only the line).

An assembly line (one with `components`) is stamped too. Its own `catalogCost` is its pre-discount
cost, and its `cost` drops by Σ `component.qty × (normal − discounted)` over its discounted parts. Its
`projectDiscountPct` is left unset, because more than one part may be discounted at different rates.

**One pure function:** `applyProjectDiscounts(sections, discounts)` in a new
`src/lib/project-discounts/` module. It re-stamps every matching line and part, and **restores**
(`cost = catalogCost`, both fields removed) any line whose SKU no longer has a discount. It is
idempotent and never touches `price`, `extSellOverride` or any sell field. The client runs it after
each discount edit and line add, and the **server runs it on every save, move and copy**, so a stale or
hand-edited payload can't save a wrong cost.

Matching uses the same real-SKU rule as the Review spreadsheet: placeholder SKUs (CUSTOM, AI, CURTAIN,
CRT-n) never match. Custom lines, allowances, vendor-quote lines, labor and bonus lines are never
discounted.

## Normal cost where the price must not move

Three readers use `catalogCost ?? cost` (a new helper, `normalCostOf(item)`) instead of `cost`:
1. **Freight**: `systemFreightBase`, so freight dollars don't change.
2. **The 5% package bonus**: its cost basis in `src/lib/estimate-bonus/rules.ts`, so the bonus line's
   sell doesn't change.
3. **Tier reprice** (`tier-reprice.ts`: `isAtTierSeed` / `tierSeedPrice`), so a discounted line still
   counts as "at the tier seed" and re-prices on a tier change exactly as before, from its normal cost.

Everything else reads the real (discounted) `cost`: system and blended margin, the cost column, the
margin color, review / approval limits, the internal cost summary, the 2% estimator bonus record, and
the Review spreadsheet.

## Estimator UI (Build)

- **Line editor / line menu:** a catalog line, or a catalog part inside an assembly line, gets
  **Project discount…**. It opens a small popover with % and Note, Save and Remove. Saving applies to
  that SKU everywhere on the estimate and says how many lines it hit ("Applied to 3 lines").
- **Chip on each discounted line:** "−12% project". Its tooltip shows the normal cost, the discounted
  cost and the note. The line's margin readout uses the discounted cost.
- **Editing Unit cost on a discounted line** edits the **normal** cost: the field is labeled
  "Normal cost" while a discount applies, and the discount re-applies to the new value.
- **Project discounts list:** a short collapsible card under the Build rail (hidden when empty). Each
  row shows part (model number), %, note and the number of lines it hits, with Edit and Remove.
- **Moving or copying lines into another estimate:** the target's own `projectDiscounts` decide. A
  part with no discount there goes back to its normal cost. A system copied to a **new** estimate
  carries the discount entries for the SKUs it contains.
- Only users who can edit the estimate can set or remove discounts. Sent, won and lost estimates follow
  the existing edit rules; nothing new is unlocked.

## Review spreadsheet

- Unit Cost is the discounted cost (it already reads `cost`).
- Price source reads `Catalog — project discount 12%`. Merge keys already include the source, so a
  discounted and an undiscounted copy of a part stay on separate rows.
- The discount's note is added to Notes as `Project pricing: <note>`.

## Won project

At Won, the project stores a frozen copy of the discounts that hit at least one line,
`projectPricing: [{ sku, model, desc, qty, pct, normalCost, expectedCost, note }]`, with qty summed
across the estimate. The project page shows a **Project pricing to request** card listing them, so
purchasing asks the vendor for project pricing. Read-only, internal, and hidden when empty.

## Errors and edges

- A pct outside 0–100 or junk is refused on the client with an inline message, and dropped by the
  server's sanitizer.
- A line with no cost (cost 0) has nothing to discount: the popover says so and offers no Save.
- Revisions and sent snapshots keep the costs as stamped. Margin history stays truthful.
- Older estimates have no map and no stamped fields, so they read exactly as before.
- The customer PDF, online estimate, package page, portal and BOM read sell only, so nothing changes
  there. A test pins this.

## Testing (in `test:specs`)

- `applyProjectDiscounts`: stamps lines and assembly parts, restores on removal, is idempotent,
  ignores placeholders, custom, vendor and labor lines, and never changes any sell field.
- Customer price unchanged: system sell total, freight, both bonus lines and the grand total are
  identical before and after a discount (with $25 rounding on and off).
- Margin rises by exactly the discounted dollars.
- A tier change on an estimate with a discount re-prices discounted lines from their normal cost.
- Server save re-stamps a tampered payload (a client `cost` that doesn't match the map).
- Move into an estimate without the discount restores the normal cost. Copy-to-new carries the
  entries.
- Review spreadsheet price source and notes.
- The project's `projectPricing` snapshot at Won.

## Open questions

None. Every question above was answered on 2026-10-22.
