# Quote intake + Estimator entry flow — design (#160, #161)

**Date:** 2026-09-23 · **Source:** Jeff's practice-run notes, brainstormed same day.

## Problems (code-verified)

1. Customer page "+ New quote" links to bare `/estimator`
   (`src/app/(app)/companies/[id]/page.tsx:324`) — no customer carried, no
   type picker, no chance to name the quote.
2. The Estimator's quote name is static text (`estimator-client.tsx:1618`,
   default `"New estimate"` from `estimator/page.tsx:55`) and save resends
   `initial.projectName` (`:541`). No rename anywhere.
3. The catalog picker closes after every add (`addPart` → `closeInput()`,
   `estimator-client.tsx:850`) and always adds qty 1.
4. `/quotes/new` "Search customers…" filters a closed `<select>`
   (`quotes/new/intake-form.tsx:243-256`) — nothing visibly happens, so it
   reads as broken (1,723 companies).
5. The intake screen collects venue + contact but `builderPath`
   (`quotes/new/types.ts:102`) forwards only `?customer=`; a picked
   existing venue/contact is dropped and the builder falls back to primaries.
6. No way to change a quote's type after creation.
7. Labor opens with five pre-filled mobilizations (D136). Jeff: those five
   were meant as the per-type crew × days defaults, not five rows.

## Design — #160 Quote intake flow

### 1. Customer page → intake
- "+ New quote" → `/quotes/new?customer=<id>`. `quotes/new/page.tsx` reads
  `customer` (and `name`, `venue`, `contact`, `type`, `replaces` — see §4)
  and hands them to `QuoteIntakeForm` as initial values. An unknown id is
  ignored (form starts blank).
- The search box + `<select>` pair is replaced by the existing shared
  `CustomerCombobox` (`src/components/customer-combobox.tsx`), already used
  by the flame/repair/inspection/consulting builders. The "no match → quick
  add" path is kept.
- New optional **Quote name** input. Blank → the builder's existing
  auto-name; for system/custom the fallback becomes `"<Customer> — System"`
  (or `"<Customer> — <category>"`) instead of `"New estimate"`.

### 2. Intake → builder handoff (bug fix)
- `builderPath(type, customerId, opts)` gains `name`, `venue` (location id)
  and `contact` (contact name) params; all six builders read them on a new
  quote only (never override a loaded quote), same pattern as their existing
  `preCustomer` handling. A venue id not on the customer, or a contact name
  not on the customer, is ignored → existing primary fallback.
- Rental has no venue concept; it ignores `venue`.

### 3. Rename + won-quote warning
- Estimator title becomes click-to-edit (Enter/blur saves, Esc reverts),
  persisted through `updateQuoteMetaAction` like customer/venue/contact
  already are; the save path uses the current name, not `initial.projectName`.
- On a **won** quote, changing customer, venue or contact in any builder
  asks for confirmation first: "This quote is won — its project/job keeps
  the old <field>. Change the quote anyway?" Warn, don't block. Name edits
  don't warn.

### 4. Change type (drafts only)
- Each builder gets a "Change type" control. Enabled only when
  `status === "draft"`; on a sent/won/lost quote it is disabled with the hint
  "Already sent — start a new quote instead."
- It opens `/quotes/new?replaces=<quoteId>` pre-filled with the quote's
  customer, venue, contact and name, with the current type preselected.
- Continuing with a **different** type shows a confirm naming the old quote
  and its line-item count ("Q-2041 and its 12 lines will be replaced"), then
  opens the new builder with the carried params plus `replaces=<quoteId>`.
- The old draft is deleted **only when the new quote is first saved**: each
  builder's create path passes `replaces` to one shared helper
  (`retireReplacedDraft(id)` in `src/lib/stores/quotes.ts`) that re-checks
  the old quote is still a draft, then `remove()`s it. Backing out of the new
  builder leaves the old draft untouched. Same type → just returns to the
  old quote.
- No new "void" status (a `lost` mark would skew win-rate reports).

### 5. Catalog rapid-fire
- Each `CatalogPicker` result row gets a qty input (default 1, integer ≥ 1)
  beside **Add**. Add, or Enter in the qty input, adds that qty.
- `onAdd` carries qty; `addPart` pushes `qty` and **does not** call
  `closeInput()` for catalog adds. The panel closes only via its toggle or ×.
- After an add: a transient "✓ Added 4 × <desc>" line (~2 s), the search
  input clears and refocuses. Enter in the search box does nothing new.

## Design — #161 Labor opens with one mobilization

- `defaultLaborMobs` returns **one** row: blank type ("Select type…"),
  1 person × 1 day.
- `MOB_DEFAULTS` becomes a per-type lookup (`Site Visit 1×1, Install 4×5,
  Hang 2×3, Commissioning 2×3, Training 1×1`). Picking a type in
  `setMobNameSelect` fills people/days from it **only if** the row's
  people/days are still untouched (equal to the previous type's default, or
  to 1×1 on a blank row). Custom names leave numbers alone.
- "+ Add mobilization" still adds exactly one row. Supersedes D136's
  five-row opening; resolves PUNCHLIST's "Labor: single mobilization — NEEDS
  JEFF" entry.

## Testing
- `scripts/test-review-and-spec.ts`: `builderPath` carries name/venue/contact
  for all seven types; intake param parsing ignores unknown ids;
  `retireReplacedDraft` refuses a non-draft and no-ops on a missing id; `defaultLaborMobs` length 1; type-pick fills
  defaults only when untouched.
- Browser click-through on a scratch datadir: company page → intake (company
  preselected, combobox search) → Estimator with the typed name; rename in
  the header; rapid-add three parts at different qtys; Labor opens with one
  row and Install fills 4×5.
- The four gates (tsc, test:specs, test:smoke, eslint vs stash baseline).

## Out of scope
- Migrating the other ~12 bespoke customer `<select>`s to `CustomerCombobox`.
- Changing type on sent quotes; syncing edits into already-spawned
  projects/jobs.

## Decisions to log
- D205 — Change type is drafts-only and deletes the old draft (no void status).
- D206 — Editing customer/venue/contact on a won quote warns, doesn't block.
- D207 — Labor opens with one mobilization; the D136 five are per-type defaults.
