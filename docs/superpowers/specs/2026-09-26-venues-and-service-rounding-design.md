# Punch #216 (venues: edit, derived names, editable types) and #217 (service quotes: $25 rounding, typed total, editable testing cost)

Date: 2026-09-26 · Branch `feat/punch-inbox-tasks` (built after #212–#215). Decisions numbered after
#212–#215's, recomputed from `origin/main` right before docs are written.

Jeff (2026-09-26):

> We need the ability to edit a venue after it is added. We also need to display the Venue's main
> name like Elementary or High School of what was typed in as well as the type of space. I also would
> like to edit what displays for the options when selecting the type of venue. There needs to be a
> Gym Stage option. Then that can eliminate the Venue Label, basically using the logic of the
> location name and venue type to be the name of the venue.
>
> Auto-estimates should round to the nearest 25 dollars. It should allow the estimator to change the
> figure and auto-adjust the margin. I also would like the venue testing cost to be editable in order
> to help with the rounding.

Picks confirmed in chat: rounding + typed total on **all three** service builders (flame tests,
repairs, inspections), testing-cost edit on flame tests; renewals **re-price + round** (hand-set
figures are not carried); venue types are an editable list where each type has a **"works like"**
built-in kind.

---

## #216 — Venues

### Today (recon)
- `sites` (`src/db/schema.ts:338-376`): `name` (what forms call "Venue label"), `locationName`
  (campus/building), `venueKind` (controlled type, default `"proscenium"`), `kind` (free-text import
  category). Legacy `CustomerLocation.label` = `sites.name` (`stores/customers.ts:78,302,685`).
- ~35 call sites display `label || "Venue"`; none show `locationName`.
- Types: hardcoded `VENUE_KINDS` (`src/app/(app)/companies/lib.ts:46-52`): proscenium, church, flat,
  blackbox, arena; `venueKindLabel()` (:54). No gym option. Other code reads `venueKind` for design /
  estimating defaults (Quick Design engine, `venue-defaults.ts`, `import/link.ts:271`, …).
- Only edit path: the whole-company modal (`companies/edit-modal.tsx`, `?edit=1`). Create:
  `venue-quick-add.tsx` (always proscenium), inbox `quickAddVenueAction`, quote intake.
  `saveCustomerAction` is the only write path (replaces the whole venue list).

### Venue types become an editable list
- Settings blob `venueTypes`: `{ key: string; label: string; worksLike: BuiltInVenueKind; order:
  number; archived?: true }[]`. `BuiltInVenueKind` = the five existing keys. Seeded on first read
  with the five built-ins (key = worksLike = the old key, label = today's label) plus
  `{ key: "gymstage", label: "Gym Stage", worksLike: "proscenium" }`.
- Pure module `src/lib/venue-types.ts`: `venueTypesFrom(raw)` (seed + sanitize), `venueTypeLabel(types,
  key)`, `worksLikeOf(types, key) → BuiltInVenueKind` (unknown key → "proscenium"),
  `mergeVenueTypes(current, input)` (labels trimmed 1–40 chars, unique case-insensitively; keys are
  immutable and generated from the label on add; archiving hides a type from pickers but venues keep
  it; built-in keys can be renamed/archived but not deleted).
- Every consumer that branches on `venueKind` for behaviour (design defaults, estimating, Quick
  Design, import mapping) reads `worksLikeOf(...)` instead of the raw key. `sites.venueKind` stores the
  type key.
- Settings → **Venue types** card (admin, `manage_users`): rename, add, reorder, archive, pick "works
  like". Every venue-type `<select>` (edit modal, venue quick-add, inbox quick-add, quote intake) reads
  the list; archived types are hidden unless the venue already has one.

### The venue name is derived: "Location — Type"
- Pure `deriveVenueName({ locationName, companyName, typeLabel }, siblingNames) → string`:
  `base = (locationName.trim() || companyName.trim()) + " — " + typeLabel`; if a sibling venue of the
  same company already has `base`, append ` (2)`, ` (3)` … (first free).
- The derived name is **stored in `sites.name`** on save, so every existing display site shows it
  with no call-site changes. `sites` is a columnar table, so it gains a boolean column `name_auto`
  (default false) via a Drizzle migration, written in the repo's idempotent form. Migration number:
  0027 is taken by the spec-builder branch, so this is **0028** unless `origin/main` has moved further
  at build time (re-check).
- Renaming a type label in Settings re-derives the name of every `nameAuto` venue with that type
  (per company, keeping numbering stable: re-derive in `isPrimary` then creation order).
- Existing venues keep their current `name` (`nameAuto` false) until someone edits them; the edit
  dialog then shows "Will display as: …" and saving switches the venue to the derived name.
- The **"Venue label" input is removed** from every form. The forms ask for Location name (e.g.
  "Lincoln High School"; placeholder shows the company name as the fallback) and Venue type.
- Names already copied onto saved records (quotes, jobs, site visits) are snapshots and do not change.

### Edit one venue
- Company page venue rows (`companies/[id]/page.tsx:363-403`) and the venue page
  (`venues/[id]/page.tsx`) get an **Edit** button → a venue dialog: Location name, Venue type,
  address (same address search as the edit modal), primary flag, and the "Will display as" preview.
- New server action `saveVenueAction({ companyId, siteId?, … })` (`requireUser`, same permission as
  `saveCustomerAction`) that creates or updates ONE site via `saveSite` (never rewrites siblings
  except the re-numbering described above, and clearing `isPrimary` on the old primary when this one
  is made primary). Soft delete stays where it is today.
- The venue quick-add and inbox quick-add use the same dialog/field set and save through the same
  action (they gain the type picker).

## #217 — Service quotes: round to $25, type your own total, editable testing cost

### Today (recon)
- Engines: flame `src/lib/flametest-engine.ts` (`priceVenue` 219-234: labor = curtains × minutes ×
  rate/60; `compute` 311-361: cost = max(baseFee, travel + testing), total = cost/(1−margin));
  repairs `src/lib/repair-engine.ts` (277-293); inspections `src/lib/inspection-engine.ts` (149-152,
  minFee floor after margin). Builders duplicate the math (flame `controls.tsx` `computePricing`
  ~196-230, D285). Margin slider 10–50; server clamps margin 5–50. Save stores `value =
  Math.round(total)`; flame stores `venues[].testingCost`. Letters print `quote.value`; D283 prints a
  flight line = flight.total ÷ (1−margin).

### Rules
- Pure `roundToStep(x, step = 25)` = nearest multiple (half rounds up) in a shared pricing util.
- **Auto total:** each engine computes its total exactly as today, then `total = roundToStep(total,
  25)`; `marginAmount = total − cost`; `effectiveMargin = 1 − cost/total`. Floors (flame baseFee,
  inspection minFee) apply before rounding. The rounded total is what saves, prints, and renews.
- **Typed total:** each builder's Total becomes an input. Typing a figure sets `priceOverride` on the
  quote's service subdoc (flameTest / repair / inspection); `total = priceOverride` (used exactly,
  not re-rounded), margin shown = `1 − cost/total`, and the slider moves to match (clamped visually
  to its range; the number shows the true value). Moving the slider or clicking "Reset to auto"
  clears the override. Warning (not a block) when the typed total gives a margin below 10% or below
  cost. Server accepts `priceOverride` (> 0, ≤ 10,000,000) and does not apply the 5–50 margin clamp
  to it; the stored margin is the back-solved one.
- **Flame testing cost:** each venue row's Testing cell becomes an input. A typed dollar figure
  saves as `venues[].testingOverride`; that venue's `laborCost = testingOverride` in the engine,
  builder preview and save. Blank = computed. The auto total re-rounds from the new cost.
- **Printed lines reconcile:** wherever a letter/quote document prints component lines (the D283
  travel line and the service line), the difference between the rounded/typed total and the sum of
  the unrounded lines is absorbed into the main service line, so printed lines always sum to the
  total.
- **Renewals** (`src/lib/renewal-outreach.ts`) re-price at current rates and round to $25;
  `priceOverride` and `testingOverride` are not carried. When last year's quote had a
  `priceOverride`, the renewal draft body says last year's price was hand-set at $X.
- The builders' duplicated math must produce exactly the engine's numbers (extend the existing
  parity checks, or make the builders call the pure engine function).
- Not in scope: the Estimator, Grid, Quick Design, rentals.

## Testing
- `venue-types.ts` (seed, merge rules, worksLike fallback), `deriveVenueName` (fallback to company
  name, numbering), re-derive on type rename, `saveVenueAction` single-site behaviour (async).
- `roundToStep`; each engine's auto total is a multiple of 25 and margin back-solves; typed total;
  testing override; printed-lines reconciliation; renewal drops overrides and mentions a hand-set
  price; builder/engine parity.
- Four gates + `next build`.
