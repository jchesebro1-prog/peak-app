# Gear Rentals module: inventory, availability, and a rental quote type

Authored 2026-08-07 off a Krisp call between Jeff and Isaac earlier the same
day, plus Rentman.io research. All scoping decisions locked via pop-in
questions.

## Problem

Equipment selection for quotes currently lives in a flat QuickBooks/LIP-books
dropdown — "this massive fucking dropdown" (Isaac). Peak also has no way to
know what gear it owns, where it is, or whether it's free on a given date
range, and no way to bill a customer a day/week/month rental line. Isaac
described how he organizes owned gear in Rentman today: **folders of owned
equipment by category** (speakers, monitors, lighting, consoles, control/IO),
pulled into **per-project estimate subgroups** when designing a job. Jeff
wants the picker to be category/manufacturer search-driven, not a dropdown.
One explicit design constraint from Isaac: **preserve a human reviewing every
line as it's added** — no auto-populate. This is a genuine positioning change
for Peak — the original prototype data modeled the company as declining
pure-rental work (`design_handoff_claude_code/app/lead.js:174-177`,
`lostReason: 'Wanted rental only — not our line of business'`) — confirmed
intentional in scoping.

## Locked decisions

1. **Scope: full combined design** — inventory data model, availability/
   booking, and a customer-facing rental quote type, designed together (not
   phased sub-specs), per Jeff's choice over a narrower Estimator-only slice.
2. **Gear lifecycle: deployed & reclaimed** — production/AV equipment goes
   out for a job and comes back; availability/booking conflict detection is
   required (not just a better parts catalog).
3. **Billing: customers ARE billed rental** — day/week/month rate line items
   on customer-facing quotes/invoices, like an actual rental house (not
   purely internal gear tracking).
4. **Quote integration: new standalone "Rental" quote type**, mirroring the
   existing flame/repair/inspection quote builders (own builder, own letter,
   badge + edit link in the Quotes hub) — not lines bolted onto other quote
   types.
5. **Serialization: quantity pool per item**, not per-unit serial tracking.
   "8 of this speaker, 3 booked" is sufficient for v1.
6. **Check-out workflow: manual status toggle**, no barcode/QR scanning for
   v1.
7. **Locations: multiple** — stock is tracked per location, not a single pool.
8. **Architecture: standalone module now; Grid integration deferred.** The
   Grid (`/design/grid`) already does plan-view device placement + live BOM,
   which is close to Jeff's "place items on a drawing" idea, but Grid is
   still mid-build on its own roadmap (phases 2–5) and most rental quotes
   don't need plan-sheet calibration ("8 speakers, load-in Friday"). Once
   `equipmentItems` exists, Grid's device-painting can point at it in a later
   phase — no code paths in this design block that.

## Data model

New tables in `src/db/schema.ts`, following the existing collection-table
conventions (see `catalog_parts`-style modules under `src/lib/stores/`):

- **`equipmentLocations`** — `id, name, address`.
- **`equipmentItems`** — `id, sku, name, category, subcategory, manufacturer,
  description, dayRate, weekRate, monthRate, active`. Category is a flat
  string set to start — `speakers | monitors | lighting | consoles |
  control-io | other` — matching Isaac's folder list. No nested-folder
  hierarchy in v1.
- **`equipmentStock`** — `itemId, locationId, qtyOwned`. Separate from
  `equipmentItems` so per-location quantities are rows, not columns, and
  adding a location never requires a schema change.
- **`equipmentBookings`** — `id, itemId, locationId, qty, quoteId, startDate,
  endDate, status, rate` (rate is frozen at booking creation, not
  live-looked-up — same pattern other quote builders already use so historical
  quotes don't drift when catalog rates change). `status` enum: `reserved |
  confirmed | out | returned | cancelled`.

## Booking lifecycle & availability

Building or editing a Rental quote does **not** lock stock — estimating stays
frictionless and matches Isaac's "don't auto-populate, keep humans reviewing"
principle. When a Rental quote is marked **Won**, it auto-spawns `confirmed`
`equipmentBookings` rows — the same pattern already used for "Won repair
quotes auto-spawn repair jobs" (Phase 4). The picker shows live availability
(`qtyOwned` − sum of `confirmed`/`out` bookings overlapping the requested date
range, per location) as a **warning**, not a hard block — staff can
knowingly overbook with judgment, consistent with decision #4 above (Isaac's
human-review requirement extends to trusting staff over hard validation).

Overlap detection reuses the exact interval predicate already proven in
`schedule/page.tsx:1005` (`b.start <= o.end && b.end >= o.start`), generalized
from "is this crew person already booked" to "is this item already booked at
this location," including the same greedy lane-packing for calendar display.

Manual status toggle moves a booking `confirmed → out → returned`. Any
booking still `out` past its `endDate` surfaces as an overdue flag (same
dashboard-KPI pattern as flame/repair dashboards).

## Screens

- **Rentals hub** (new top-level nav entry) — inventory list grouped/
  filterable by category, manufacturer, and location, with available-qty at a
  glance. CRUD for items and per-location stock, mirroring the existing
  Catalog browse pattern (`src/app/(app)/catalog/`).
- **Rental quote builder** — new quote type alongside flame/repair/
  inspection: pick a date range, then a category/manufacturer/search picker
  (replaces the dropdown) to add lines with qty, live availability warnings
  inline, auto-priced by day/week/month against `equipmentItems` rates,
  generates a rental agreement letter via the existing PDF infra
  (`lib/pdf.ts`).
- **Booking/status board** — confirmed bookings grouped by upcoming load-in/
  return dates, manual status toggle, overdue-return flag — same shape as the
  flame-tests "today" day sheet (`/flame-tests/today`).
- Quotes hub gains a `Rental` type badge + edit link, same treatment as the
  other three quote types.

## Integration

- New `manageRentals` / `viewRentals` permissions in `ROLE_PERMS`
  (`src/lib/team.ts`).
- New nav entry + route map addition in `nav-data.ts`.
- Equipment items added to the existing per-type Import/Export CSV hub
  (Phase 9).

## Explicitly deferred (named, not designed)

Serialized/per-unit tracking, barcode/QR scanning, damage/maintenance
workflow (repair-triggered-by-return), stock transfers between locations,
utilization/revenue-per-item reporting, and Grid plan-view integration. Each
is a natural next phase once v1 is proven; nothing in this design blocks
them.

## Testing / rollout

Seed a handful of fixture items across categories + two locations in
`db:seed`. Manual QA path: create a Rental quote → mark Won → verify
`confirmed` bookings spawn + availability warning fires correctly on a
conflicting second quote → cycle a booking through `out`/`returned` → verify
overdue flag. No new automated-test infrastructure needed beyond what the
repo already uses.

## Open questions

- Exact rate-card shape when a rental spans a mixed period (e.g. 10 days —
  does it bill 1 week + 3 days, or round up to 2 weeks)? Rentman's own docs
  didn't surface a clear rule; needs a Jeff call before the quote builder's
  pricing math is implemented.
- Cancellation/no-show policy for a `confirmed` booking that gets cancelled
  close to the load-in date — does stock free up immediately, or is there a
  hold period? Not raised in the Krisp call; default to immediate release
  unless Jeff says otherwise.
