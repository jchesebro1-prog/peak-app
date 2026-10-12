# Estimator bonuses — 5% package bonus + 2% estimator bonus

**Date:** 2026-10-12 · **Requested by:** Jeff · **Status:** design approved, awaiting spec review
**Supersedes:** the 5%-of-labor-cost performance bonus (D136, D244, D251) for Estimator system quotes.

## Why

Jeff wants the estimate's bonus structure spelled out and enforced by the Estimator:

1. A **5% package bonus** on each system ("package") that contains a labor line.
2. A **2% estimator bonus** on the total of every estimate that is won, tracked per estimator.

Neither may ever appear on the estimate the customer sees or on anything else client-facing.

Today the Estimator has only a 5% "Performance bonus — 5% of labor cost" line, added by the Add labor modal
(`computeLabor` in `src/app/(app)/estimator/pricing.ts`, `performanceBonus = baseCost * 0.05`) and folded into the
labor line on customer documents by `customerLines()` (D251). There is no 2% and no per-estimator tracking.

## Decisions (Jeff, 2026-10-12)

| # | Question | Answer |
|---|----------|--------|
| 1 | What is the 5% figured on? | 5% of the system's **cost**, only when the system has a labor line |
| 2 | Does the 5% raise the price or come out of margin? | **Raises the price** (hidden) |
| 3 | Is the 5% marked up? | Yes, **at the system's margin** |
| 4 | Is the 5% tracked? | **Per project**: a Won estimate carries it to the install project as the performance-bonus pool |
| 5 | Does the 2% raise the price or come out of margin? | **Raises the price** (hidden) |
| 6 | What is the 2% figured on? | The estimate's **sell total before the 2%** (5% lines in; alternates and add-ons out) |
| 7 | When is the 2% earned? | When the estimate is marked **Won** |
| 8 | Who is credited? | **Split** between Lead estimator (`owner`) and Prepared by (`preparedBy`) |
| 9 | How is it split? | 50/50 default, **editable per estimate** by an approver |
| 10 | Who sees the tracking? | Admins see everyone; each estimator sees only their own |
| 11 | Existing estimates? | **Drafts switch** to the new rules when next saved; sent / won / lost keep their numbers |
| 12 | Alternates and add-ons? | An alternate with labor carries its own 5%; the 2% is priced into each alternate but **counts only when the customer takes it** |
| 13 | Which quotes? | **Estimator system quotes** only (including Grid-started and Load-system estimates). Not flame / repair / inspection, consulting, rentals or customer-built portal quotes |

## Approach

**Hidden computed lines.** Each bonus is a real `SpecItem` stored on the system, recomputed automatically whenever the
system changes, and folded into other lines on every customer surface. This extends the mechanism that already hides
today's 5% (`laborOverhead`, `isLaborOverheadItem`, `customerLines`). Totals, review limits, approval snapshots and the
internal cost summary therefore stay correct without special-casing.

Rejected:
- **Multiplier at total time** (nothing stored). Every total, PDF, portal page and report would have to remember to
  apply it, and missing one shows the customer a different number.
- **Raise each line's price directly.** The bonus disappears into the prices and can't be tracked or audited.

## Units

### 1. `src/lib/estimate-bonus/rules.ts` (new, pure)

The one place the bonus math lives. No I/O, no React. Exports:

- `BONUS_PACKAGE_PCT = 0.05`, `BONUS_ESTIMATOR_PCT = 0.02`.
- `isBonusEligibleQuote(q)`: true exactly when the quote's own builder is the Estimator (the same predicate the
  #219 "every quote link opens that quote's own builder" routing uses), which covers Estimator-built estimates,
  Load-system estimates and estimates linked to a Grid design (#314, the estimate owns the lines). False for any
  `source` starting `portal`, for Grid-sourced quotes that open in the Grid, for Quick Design quotes, and for flame /
  repair / inspection, consulting and rental quotes.
- `hasLaborLine(sec)`: true when the system has at least one in-total, non-option line with `labor: true`, not
  counting the bonus lines themselves. Labor travel lines (#270) count as labor; labor overhead lines (shop &
  engineering, misc) count as labor.
- `packageBonus(sec)`: `{ cost, sell }` for the system's 5% line, or `null` when `hasLaborLine(sec)` is false.
  - `cost = round2(0.05 × Σ qty × cost)` over the system's in-total, non-option lines, excluding both bonus lines and
    any Rewards credit line.
  - `sell = round2(cost × blendedMarkup)`, where `blendedMarkup = Σ ext sell ÷ Σ qty × cost` over the same lines. A
    system with zero cost gets no bonus (`null`).
- `estimatorBonus(sec)`: `{ cost, sell }` for the system's 2% line, with `cost === sell` (a payout, never marked up).
  - Without a typed sell: `sell = round2(0.02 × P)`, where `P` is the system's price without the 2% line: every
    in-total, non-option line's ext sell (5% line included) plus `systemFreight(sec)`. The $25 round-up (#267) is
    applied afterwards, as it is today, to the total that includes the 2%.
  - With a typed sell (`sellOverride`, #267): the typed total is what the customer pays, so the 2% is inside it:
    `sell = round2(typed × 0.02 ÷ 1.02)`. The price adjustment absorbs the rest.
  - The 2% exists on every eligible system, labor or not.
  - Summed over the in-total systems, this is 2% of the estimate's sell total before the 2%, except the $25
    round-ups (at most $25 per system), which are not bonused. Tax and the Rewards credit are outside it.
- `withBonusLines(sections, opts)`: returns sections with each system's two bonus lines **replaced** (never
  duplicated): removed when no longer due, updated when amounts change, appended when newly due. It also removes any
  legacy 5%-of-labor line (`laborOverhead: "bonus"` or a `LAB-BONUS-` SKU). `opts.frozen === true` (sent / won /
  lost) returns the input unchanged. The function is idempotent: running it twice gives the same result.

The two lines are identified by a new `SpecItem.bonus?: "package" | "estimator"` flag. That flag, not the SKU, is what
code reads. SKUs: `BON-PKG-<sectionId>` and `BON-EST-<sectionId>`. Internal descriptions: "Package bonus — 5% of
system cost" and "Estimator bonus — 2% of system price". Both lines have `qty: 1`, are never options, are not editable
in the Build line table (they show read-only, greyed, with a lock), and cannot be deleted by hand.

### 2. Estimator wiring

- **Recompute.** `use-estimator-state.ts` runs `withBonusLines` after every change to a system's lines, freight,
  typed sell or alternate flag, and on load of a draft. A system's totals (`systemItemsRev`, `systemSellTotal`,
  `totals()`) need no change, since the bonus lines are ordinary in-total lines.
- **Server is canonical.** The quote save action (and every other server write path that persists `spec.sections` for
  an eligible quote: Load system, Copy system, Move system, Grid → estimate, category add, catalog-rename rewrite)
  re-runs `withBonusLines` before persisting, so a stale or hand-crafted client cannot save a wrong bonus. A frozen
  quote is not rewritten.
- **Add labor modal.** `computeLabor` stops computing `performanceBonus`. `totalCost = baseCost`, and the "Performance
  bonus · 5% of … cost" row in `labor-modal.tsx` is replaced by the note "Package bonus (5% of system cost) is added
  automatically". `laborOverhead` loses its `"bonus"` member for new writes; `isLaborOverheadItem` still recognises old
  `"bonus"` / `LAB-BONUS-` lines so frozen quotes print exactly as before.
- **Internal display.** Each system footer on Build shows "5% package bonus $X · 2% estimator bonus $Y" (staff only).
  The Customer review internal sidebar's cost summary gains the two totals.

### 3. Hidden on every customer surface

`customerLines()` (D251) gains the bonus lines:

- **5% line:** folds exactly like today's performance bonus, into the system's mobilization line(s) by cost, then
  other labor lines. (It only exists when a labor line exists, so the neutral-row fallback is never hit.)
- **2% line:** folds across **all** of the system's visible lines in proportion to their ext sell, the last line
  absorbing rounding, so a system with no labor never shows an extra row. A system whose only visible lines are
  zero-sell spreads evenly.

The system's displayed total is unchanged by folding, to the cent.

**Leak audit.** The plan enumerates every customer-facing reader of `spec.sections` and routes each through
`customerLines()` or an explicit `isBonusItem` exclusion. At minimum:
- estimate PDF (`quote-document.tsx`) and cover PDF (`/print/cover/[id]`)
- online estimate (`/portal/quotes/[id]`, `/share/quote/...`) and package page / package BOM / package zip
- portal (My quotes, cart, Refresh pricing)
- package document chips (`spec.document` price / quantity chips)
- client package (`client-package-server.ts`), Word spec / BOM (`specs/quote-bom.ts`)
- Gmail send attachments, CSV / Import-Export exports of quotes
- cut sheets, narrative, Load-system library (`system library` index) and Copy system (bonus lines are not carried
  as ordinary lines into another quote; `withBonusLines` re-derives them there)

A new spec-harness check renders each of these for a fixture quote with both bonus lines and asserts the strings
"bonus", "Package bonus", "Estimator bonus", `BON-` never appear, and that each surface's total equals the staff
total.

### 4. Credit split (Send & track)

- New quote field `estimatorBonusSplit?: { leadPct: number }` (0–100, default 50). Prepared by gets `100 − leadPct`.
- When Lead estimator and Prepared by are the same person, or Prepared by is blank, that person gets 100% and the
  control is hidden.
- The split control sits on the Send & track tab: "Estimator bonus split: Lead [ 50 ]% · Prepared by 50%". Only
  `approve` holders can edit; others see it read-only. The server action checks `approve`.
- Editing the split never changes a price.

### 5. Recording at Won

`setStatus(id, "won")` (`src/lib/stores/quotes.ts`), for an eligible quote, writes a store-owned
`Quote.bonusRecord`:

```ts
type BonusRecord = {
  wonAt: number;                 // epoch ms
  estimatorBonus: number;        // Σ 2% line sell over in-total systems + taken alternates
  packageBonusCost: number;      // Σ 5% line COST over the same systems (the payout)
  alternatesTaken: string[];     // section ids
  credits: { userId: string; role: "lead" | "prepared"; pct: number; amount: number }[];
};
```

- **Alternates taken.** The Won confirmation on Send & track lists the estimate's alternate systems as checkboxes,
  pre-ticked from the latest client response's chosen scopes (#301 `clientResponses`), else none. The portal's Accept
  path pre-ticks the same way. Their 2% and 5% count; the others' don't.
- **Amounts** round to the cent; the last credit absorbs the rounding so credits sum to `estimatorBonus`.
- **Leaving Won.** Moving the quote off Won deletes `bonusRecord`. Re-winning writes a new one.
- **Install project.** `createProjectFromQuote` copies `packageBonusCost` to the project as `performanceBonusPool`,
  shown on the project page in the internal header ("Performance bonus pool $X"), staff only. Who earns it is decided
  outside the app (not in scope).
- Quotes and projects are JSONB documents, so **no migration**.

### 6. Report — Reports → Estimator bonuses

Route `/reports/estimator-bonuses`, linked from the Reports page.

- One row per credit per won estimate: month won, estimate # and name, customer, role (Lead / Prepared by), split %,
  estimate sell total, bonus amount. Grouped by person, then month, with per-person and per-month subtotals.
- Filters: date range (default this year, Chicago time), person.
- `manage_users` holders see everyone. Everyone else sees only rows where they are the credited user, with no
  person filter.
- Reads `bonusRecord` only; it never recomputes from lines. A won quote with no `bonusRecord` (won before this
  ships) does not appear.
- CSV download of the current view.

### 7. Existing estimates

- **Draft / not-yet-sent:** on next load the client runs `withBonusLines`, which removes the old 5%-of-labor line and
  adds the new lines. The price changes; the save shows it as an ordinary edit. Nothing is rewritten in bulk.
- **Sent / won / lost:** untouched. Old `LAB-BONUS-` lines keep folding as before.
- **Approval snapshots (#284):** because the bonus lines change the gross sell, an approved draft that gains them
  goes stale through the existing `approvedAgainst` rule. That is intended.

## Error handling

- `withBonusLines` never throws: a system with non-finite cost or sell gets no bonus lines and the Build footer shows
  "Bonus not figured — check line costs".
- A Won transition whose bonus figuring fails still marks Won, logs the error, and leaves `bonusRecord` absent; the
  report then omits it. The Send & track tab shows "Bonus not recorded — re-save Won" to approvers.
- A credit with no `userId` (no team member matched the name when it was recorded) keeps its amount and shows "(no matching team member)".

## Testing

Spec harness (`npm run test:specs`):
- `rules.ts`: labor / no labor, zero cost, blended markup, typed sell closed form, $25 rounding after the 2%,
  options and Rewards credit excluded, alternates, idempotency, legacy line removal, frozen passthrough.
- `customerLines`: both folds keep the system total to the cent; no-labor system gets no extra row.
- Leak check across every customer surface (§3).
- `setStatus` won / un-won / re-won; split edge cases (same person, blank Prepared by, 70/30, rounding).
- Report permission scoping.

Plus the four verification gates (tsc, test:specs, test:smoke, eslint vs baseline) and a `next build`.

## Out of scope

- Who earns the 5% pool on a project, and paying either bonus out (payroll).
- Service, consulting, rental and customer-built portal quotes, and Grid-sourced / Quick Design quotes that open in
  their own builders. A portal quote staff later re-open in the Estimator stays excluded (its `source` is still
  `portal…`).
- Changing the 5% / 2% rates in Settings. They are constants in `rules.ts`; making them editable is a later item if
  Jeff wants it.
