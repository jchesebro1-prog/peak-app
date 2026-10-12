# Grid notes — 2026-10-12

Jeff's rapid-fire Grid feedback. One line per note, status kept current.
Bugs are fixed and pushed as they land; features get a plan here first.

| # | Note | Kind | Status |
|---|------|------|--------|
| 1 | Icon picker (symbol selector) opens off-screen in the Property Editor | Bug | ✅ Fixed `a3073d3d` — panel portals to `<body>`, clamped to the viewport |
| 2 | Edit **Type** next to Space (Property Editor + Spreadsheet); an admin change should fix the part everywhere, or a "save as rule" (e.g. SM58 mic shows as Dimming & Power) | Feature | Built — awaiting review (D832 per-part type + whole-category box; D833 space pin) |
| 3 | Quick multi-select / marquee: selected parts appear then drop out; Properties shows a stale single device (PRT-02) above the multi-selection | Bug | ✅ Fixed `18bae19c` — duplicate React key orphaned Designator rows; Shift near-miss no longer clears; drag-and-put-back keeps the group |
| 4 | Equipment groups: select a rack, place gear inside it, grouped for this design and shown grouped on the Spreadsheet | Feature | Decided (below) — ready to plan |
| 5 | Preload wire types into the Grid and Catalog — "a major thing I am missing" | Feature | ✅ Shipped `ccd4ed28`+`5e237f04` — admin **Load starter cables** (20 cables, $0 drafts, OD from datasheets) + **Sync per-foot cables to the Grid** in Grid Settings → Wire types; Needs price chip. Jeff: confirm riser symbols SP/A/V/F/LV/PW/M, then price the cables |
| 6 | Product Library shows only a small slice of the catalog | Gap | ✅ Shipped `bcf3e8c8`+`614465e3` — "From the catalog" server search (every word, honours the node, 40 results); placing adds it to the library |
| 7 | Client package "rough drawings" have no devices and no title block | Bug | ✅ Shipped `d90cbf89`+`83cc466c` — ZIP ships the title-blocked drawing set (live design); rough drawings + raw plans only as a fallback with a gap |
| 8 | Combined datasheet PDF with a cover: Peak logo, job name, contact, venue, location, customer logo | Feature | Building |
| 9 | The specification and all documents carry the Peak standard header at the top unless otherwise selected | Feature | Building |

## #2 Type editing — findings

- A part has **no device-type field**. Type = the part's raw catalog `category` → global `gridTypeMap` blob (`device-types.ts:36-44`), auto-filled by keyword rules (`RULES` :242-303) or set by an admin on Catalog → Device types (`assignDeviceTypeAction`, `manage_users`).
- So today a fix is per **category**: re-typing the SM58's category moves every part in it (likely "Audio", bulk-accepted as Dimming & Power).
- **Space is not editable either** — it's computed from where the device sits (`spaceOf`). The Category column/Apply is the edit pattern to mirror (`devices-table.tsx:162-188`, `setPlacementsCategoryAction`).
- Changing type doesn't renumber existing designators until Renumber → "Apply current type codes".
- **Jeff (Oct 12):** per-part override by an admin, applied wherever the part is used, plus an "Apply to the whole <category> category" checkbox. **Space:** per-device override dropdown (pins a device to a room), with "Auto" to go back to position-based.
- Options considered: per-part `deviceTypeOverride` on the catalog part (admin, from the Grid; checked first in `gridPartsFrom`) and/or "apply to the whole category" (existing map).
- **Built (Oct 12, D832/D833):** `CatalogPart.deviceTypeKey` (admin-only `setPartDeviceTypeAction`, `manage_users`) is read first by `typeOfPart`, so the palette, layers, legends, designators, schedule, drawing set, risers and catalog search all follow it. The Property Editor's Type row (one device or several) is a select for admins with **Apply to the whole '<category>' category (N parts)** (re-types the category, clears this part's override); the Spreadsheet's Type cell sets the per-part type; the part editor has the same select; Catalog → Device types shows "N own type" per category. Not undoable (catalog change); a changed prefix says "Designators keep their numbers — Renumber to apply the new prefix." **Space:** `GridPlacement.spaceId` pin, read through `spaceOfPlacement` (dead pins ignored; `removeSpace` clears them), set by `setPlacementsSpaceAction` (undoable) from the Property Editor and the Spreadsheet's Space cell. Pure rules: `device-types.ts` (`planPartTypeEdit`), `grid-type-edit.ts`, `grid-geometry.ts`; harness "Grid notes #2:".
- **SM58 legend:** "Dimming & Power — Cardioid Dynamic" was the per-entry mic icon differing from the Dimming & Power type icon (`legendRows` appends the description when an entry's look differs from its type's). Typed Microphones, the icons agree and the row reads "Microphones" (harness-pinned).

## #4 Equipment groups — groundwork

- Today nothing nests: placements are flat (`GridProject.placements`, `grid-projects.ts:126-202`); a placed rack is one sealed `asm:<fixtureId>` marker priced as one line; its RU contents live in the global rack record, shared by every design.
- Proposed seam: `groupId?` on `GridPlacement` + `groups?: {id, name, containerPlacementId?}[]` on `GridOption` (like customItems/accessories); one `setPlacementsGroup` batch write via `batchEdit`; a Group column in `deviceRows` and sub-sections in `buildSchedule`. BOM stays merged by part → pricing unchanged.
- Must carry: `addOption`/`copyOptionMembers` remap `groupId`; revisions snapshot `groups`; deleting a container keeps or clears members.
- **Jeff (Oct 12):** any device can hold a group ("Make group": a plain rack part, a rack assembly, a booth, a panel). On the plan, members are hidden inside the holder (a count badge like "Rack · 6"); the Spreadsheet lists them indented under the holder, each keeping its own designator.
- Still open: does a group feed a rack assembly's RU elevation/submittal? (later)
- Original questions: is the rack a placed `asm:` rack (priced as the assembly) or just a plain rack part + a group? Do grouped devices sit on the plan at their own spot, or collapse into the rack marker? Does a group feed the rack's RU elevation / submittal?

## #5 Wire types — findings

- Two layers that don't connect today:
  1. **Routable wire = any Grid library part with unit `ft`/`lf`/`lin ft`/`linear ft`** (`grid-bom.ts:429`); the Wires pane lists them (`use-grid-editor.ts:1103`). The catalog has **none**: the 10,702-row import is all `ea` (4 Belden/Cat5 "Wire" rows are per-foot prices stored as `ea`). And even a new `ft` part never reaches the Grid library (#6), so the pane's empty hint ("add cable with unit 'ft' under Catalog") is wrong.
  2. **Wire-type registry** (`settings.wireTypes`, `catalog-connect.ts:25-48`, ~25 `DEFAULT_WIRE_TYPES`: DMX 5-pin, Cat6, speaker pair, XLR, SDI, HDMI, fiber, powerCON, motor power, ETC families) — used for port checks and the conduit riser. None has `cableSku`, `dollarsPerFt` or `symbol` set, so the riser legend shows nothing; `dollarsPerFt` is read nowhere.
- Plan: seed a starter set of `category: "Wire"`, `unit: "ft"` catalog parts (cost/list per ft, `cableOdIn`), put them in the Grid library, and link each to its wire type (`cableSku`, riser `symbol`, `signal`). #6's catalog search makes later cable additions show up automatically.
- **Jeff (Oct 12):** starter set — ~20 common cables with real part numbers + OD, seeded as $0 drafts linked to each wire type; Jeff fills cost/sell per ft in the Catalog.
- Originally needed from Jeff: the cables Peak actually pulls — part # (e.g. Belden 1583A), cost + sell per ft, OD, riser letter.

## #6 Product Library is a small slice — root cause

- The library is the separate `grid_catalog` collection, not the catalog (`stores/grid-catalog.ts:9-12`). `listGridSymbols` seeds it from the catalog **once, on first use, only when it's empty** (`:82-99`). Prod's was seeded long before the 37k-part catalog landed.
- After that, a catalog part only joins the library when Auto fill or the From-estimate tray needs it (`ensureGridSymbolsFor`, `:184`; callers `grid-auto-fill.ts:61`, `actions.ts:569`, `estimator/grid-design-actions.ts:72`). So the library = the first seed + whatever Auto fill/estimates pulled in.
- Shipping 37k parts to the client isn't viable. Plan: a **Catalog** search in the Product Library (server action, debounced, ~50 results, same palette tile), and placing a catalog result calls `ensureGridSymbolsFor([part])` first so it becomes an ordinary library entry. Fabric/Labor stay out (as today).
- **Built (Oct 12):** typing 2+ characters under All / a scope / a type adds a **From the catalog** section below the library tiles — `searchGridCatalogAction` (`grid/[id]/actions.ts`) → `searchGridCatalog` (`lib/design/grid-catalog-search-server.ts`): the specs picker's SQL pre-filter (`listDocsFiltered` over the #304 fields + category, every token ANDed, light fields only, ≤ 2,000 rows — "Showing the first matches…" when that cap is hit), then the exact #304 + category match, fabric/Labor/renamed excluded, the selected scope / device type (before the cap), the Estimator picker's ranking, cap 40, hits re-read in full and each hit built through `gridPartsFrom` like the library entry it becomes (`fromCatalog: true`). Debounced 250 ms with a sequence guard; parts already in the library and other manufacturers (when the filter is set) are hidden. Placing (click-to-arm or drag) is gated like Replace part (placeable id ≤ 120 chars; no fabric/Labor/renamed/deleted catalog row), then it and Replace part call `adoptCatalogParts`, which inserts the missing library entries directly. Pure rules in `lib/design/grid-catalog-search.ts`; harness "Grid notes #6:".

## #8 Datasheet package — decisions (Jeff, Oct 12)

- Cover: Peak logo · job name · **both** contacts ("Prepared for" = the customer's contact on the job; "Prepared by" = Peak's lead estimator) · venue · location · customer logo.
- No customer logo stored today → add a logo upload on the company record. No logo → company name set large in that spot.
- One PDF: cover + every datasheet in BOM order. Appears in **all three** places: the client package ZIP (Grid + estimate, `datasheets/combined-datasheets.pdf`), its own download button (Grid Outputs menu + estimate Build package), and the client link page ("Download all datasheets").
- Reuse: #296 rack submittal already pdf-lib-merges datasheets with a gap cover.

## #9 Peak header — decisions (Jeff, Oct 12)

- The Peak standard header = the existing letterhead (`peak-letterhead.jpg`, or the uploaded dark logo per D59) already on quotes, letters, reports and the cover.
- Specs (spec builder Word file, D94 bid-spec .docx/.doc/HTML, the spec inside client packages): letterhead on the **first page only**; later pages keep the MasterSpec running header + footer.
- Also the plain-text-name documents: the quote equipment summary / rough-drawings fallback PDF and the rack datasheet index.
- Toggle in **both** places: a company default in Settings → Branding ("Put the Peak header on documents", on) and a per-document "Include Peak header" checkbox.
- Letters/quotes/reports/cut sheets/drawing set unchanged (already carry it).

## Side observations

- Legend shows "Dimming & Power — Cardioid Dynamic" for the SM58: the per-entry symbol override splits a legend row as type + description. Checked with #2: setting the SM58's type to Microphones makes the row read "Microphones".
