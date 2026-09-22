# The Grid: editable identity + estimator-style intake with venue address lookup

Status: approved by Jeff (brainstorming 2026-09-21). Branch `feat/grid-intake-identity`.

## Context

The Grid is Design's manual layout mode (`/design/grid/[id]`, D138/D139). A `GridProject`
already carries `name`, `customer`, `customerId`, `siteId` (the linked venue) and an `intake`
blob (`venueName`, `locationName`, `address`, `notes`, `autoConfig`). But:

- **Name and customer are set once at creation and can't be changed.** The editor header
  (`editor.tsx:983`) prints `Manual Layout · {name} · {customer}` read-only.
- **The intake tab uses free text** (`grid-intake.tsx`): `venueName`/`locationName`/`address`
  are plain inputs, unrelated to the customer's real sites. There is no customer picker.
- **No address lookup**, though `searchAddressAction(query)` (companies/actions.ts:107) already
  returns `AddressHitVM[]` and the Companies venue modal uses it.

Jeff's asks (2026-09-21): (1) edit the name and other info from the Grid screen;
(2) put customer, location and venue on top of the intake, the same as the estimator;
(3) an address lookup that searches for the venue and fills the address + location.

Jeff's two decisions in brainstorming: **link to real records** (pick a customer → pick or
quick-add their location/venue → address comes from / creates the venue record; the design links
to the venue via `siteId` like the estimator), and **inline header editing** (rename in place,
an "Edit details" affordance opens customer/venue/notes without leaving the workspace).

Everything reuses existing seams — no schema change:
- `GridProject.customerId` / `siteId` and `setVenueAction` (editor.tsx:990) already link a venue.
- `EntityQuickAdd` (`src/components/entity-quick-add.tsx`, built in #96) for new customer/venue.
- `searchAddressAction` for the lookup; `AddressHitVM` for hits.
- `sitesForCompany(customerId)` for a customer's venues; `saveCustomerAction` /
  `quickAddVenueAction` (inbox/link-actions.ts:208) to create them.
- The estimator's customer→venue header pattern (`estimator-client.tsx:1126`) and the guided
  quote intake (`/quotes/new`) are the visual precedent.

## 1. Data model

No new fields. Reuse:
- `customerId: string | null` — the linked customer.
- `siteId: string | null` — the linked venue (a customer site).
- `intake: { venueName, locationName, address, notes, autoConfig, measurementBased, complete }`
  — becomes **derived-from / synced-with** the linked site when one is chosen, and a free-text
  fallback when it isn't (a quick sketch with no customer). When `siteId` is set, the cover-page
  `venueName`/`locationName`/`address` are populated from the site and kept read-only-ish (edited
  by changing the venue, not by typing over them); a "no customer / no venue" design keeps the
  free-text path exactly as today.

## 2. Server actions (`src/app/(app)/design/grid/[id]/actions.ts`)

- `renameGridAction(projectId, name)` → `{ ok }`. Trims; empty name rejected. `requireUser`,
  `revalidatePath(editorPath)`.
- `setGridCustomerAction(projectId, customerId | null)` → `{ ok }`. Sets `customerId` + denormalized
  `customer` name; **clears `siteId`** if the current venue doesn't belong to the new customer;
  re-resolves the pricing tier on next load (already `resolveTier(customerId)` in page.tsx).
- `setVenueAction(projectId, siteId)` — **exists**; on set, copy the site's `label`/`locationName`/
  `address` into the intake cover fields so documents and the riser show them.
- Quick-add: reuse `quickAddVenueAction`-style logic against the grid's customer — extract a shared
  `addVenueToCustomer(customerId, { label, city, state, address? })` used by both Inbox and Grid so
  there's one implementation, or call the existing action. New venue → set it as the grid's `siteId`.
- Address lookup: a thin `gridAddressSearchAction(query)` that delegates to `searchAddressAction`
  (or the intake calls `searchAddressAction` directly). A picked hit fills the new-venue form's
  address/city/state and the venue label defaults from the hit's title.
- `saveGridIntakeAction` extended: also accept `customerId` and `siteId` so the first-run intake
  can set identity + venue in one save; when a `siteId` is chosen the cover fields derive from it.

All actions `requireUser`; none needs a permission beyond that (matches the current Grid actions).

## 3. Editor header — inline identity (`editor.tsx` ~983–1010)

- **Name:** the read-only `· {name}` becomes a click-to-edit control — click shows an input seeded
  with the name; Enter/blur calls `renameGridAction`; Esc cancels. Same inline-rename affordance the
  app uses elsewhere; keep it a client island that calls the action and `router.refresh()`.
- **Edit details** button next to the name opens a small popover/panel (a client island, positioned
  like the existing venue `<select>`) holding: customer picker (existing customers + "+ New
  customer" via `EntityQuickAdd`), venue picker (the customer's sites + "+ New venue" via
  `EntityQuickAdd` with the address-search field), and notes. Picking a customer swaps the venue
  list; picking/creating a venue sets `siteId`; the address field in the new-venue form is backed by
  `searchAddressAction` (type → hit list → fill). The existing venue `<select>` stays for the common
  "just change the venue" case; the popover is for customer + new venue + notes.
- Everything the popover changes goes through the actions in §2 and `router.refresh()`.

## 4. Intake tab — estimator-style top block (`grid-intake.tsx`)

Restructure so the **first block** is Customer → Location/Venue, mirroring `/quotes/new` and the
estimator header:

- **Customer**: a `pick | new` control (existing customers, or `EntityQuickAdd kind="customer"`).
- **Venue**: once a customer is set, a `pick | new | skip` control over that customer's sites;
  "+ New venue" opens `EntityQuickAdd kind="venue"` with an **address search** field (type an
  address → `searchAddressAction` hits → picking one fills address/city/state and defaults the
  venue label); creating it sets `siteId`. "Skip" keeps the current free-text cover fields for a
  quick no-customer sketch.
- Below that, the existing venue-type / size / stage-dimensions / systems auto-brief is unchanged.
- The cover-page fields (Location/Venue/Address) become **derived display** when a venue is linked
  (read-only, showing the site's values) and stay editable free text only in the "skip / no
  customer" path.
- Submit calls the extended `saveGridIntakeAction` with `customerId` + `siteId` + the auto-config.

## 5. Shared extraction

`EntityQuickAdd` is already shared (Inbox + quote intake). Extract the venue-creation server logic
(`addVenueToCustomer`) and the address-search-fills-venue client wiring into one place both the Grid
and Inbox use, rather than a second copy — the #96 review already flagged a `locationName`-dropping
bug in one copy, so a single implementation is the fix.

## 6. Testing

- `test:specs` (pure): any new pure helper (e.g. "does site belong to customer" for the siteId
  clear-on-customer-change, address-hit → venue-form mapping).
- `test:review:regressions` (scratch DB): `renameGridAction` renames; `setGridCustomerAction`
  changing the customer clears a foreign `siteId` and keeps a matching one; `saveGridIntakeAction`
  with a `siteId` derives the cover fields from the site; quick-add venue with an address hit links
  it and stamps the address.
- Smoke: `/design/grid/<seeded id>` 200 with the new header and intake; picking a customer/venue
  round-trips.
- Browser pass: rename inline; open Edit details, pick a customer, add a venue via address search,
  confirm the venue links and the address fills; on the intake tab confirm customer/venue sit on top
  and the auto-brief still works.

## Out of scope

- No change to the auto-brief compute, the layout workspace, wires/spaces/scope, or quote promotion.
- No new venue fields; address search reuses the existing provider behind `searchAddressAction`.
- Multi-venue-per-design is not added (one `siteId`, as today).
