# Grid notes — 2026-10-12

Jeff's rapid-fire Grid feedback. One line per note, status kept current.
Bugs are fixed and pushed as they land; features get a plan here first.

| # | Note | Kind | Status |
|---|------|------|--------|
| 1 | Icon picker (symbol selector) opens off-screen in the Property Editor | Bug | ✅ Fixed `a3073d3d` — panel portals to `<body>`, clamped to the viewport |
| 2 | Edit **Type** next to Space (Property Editor + Spreadsheet); an admin change should fix the part everywhere, or a "save as rule" (e.g. SM58 mic shows as Dimming & Power) | Feature | Decided (below) — ready to plan |
| 3 | Quick multi-select / marquee: selected parts appear then drop out; Properties shows a stale single device (PRT-02) above the multi-selection | Bug | ✅ Fixed — duplicate React key orphaned Designator rows; Shift near-miss no longer clears; drag-and-put-back keeps the group |
| 4 | Equipment groups: select a rack, place gear inside it, grouped for this design and shown grouped on the Spreadsheet | Feature | Decided (below) — ready to plan |
| 5 | Preload wire types into the Grid and Catalog — "a major thing I am missing" | Feature | Investigating |
| 6 | Product Library shows only a small slice of the catalog (All: Lighting 21 · Audio 5 · Unscoped 4) | Gap | Root cause found (below) — plan: search the full catalog server-side |

## #2 Type editing — findings

- A part has **no device-type field**. Type = the part's raw catalog `category` → global `gridTypeMap` blob (`device-types.ts:36-44`), auto-filled by keyword rules (`RULES` :242-303) or set by an admin on Catalog → Device types (`assignDeviceTypeAction`, `manage_users`).
- So today a fix is per **category**: re-typing the SM58's category moves every part in it (likely "Audio", bulk-accepted as Dimming & Power).
- **Space is not editable either** — it's computed from where the device sits (`spaceOf`). The Category column/Apply is the edit pattern to mirror (`devices-table.tsx:162-188`, `setPlacementsCategoryAction`).
- Changing type doesn't renumber existing designators until Renumber → "Apply current type codes".
- **Jeff (Oct 12):** per-part override by an admin, applied wherever the part is used, plus an "Apply to the whole <category> category" checkbox. **Space:** per-device override dropdown (pins a device to a room), with "Auto" to go back to position-based.
- Options considered: per-part `deviceTypeOverride` on the catalog part (admin, from the Grid; checked first in `gridPartsFrom`) and/or "apply to the whole category" (existing map).

## #4 Equipment groups — groundwork

- Today nothing nests: placements are flat (`GridProject.placements`, `grid-projects.ts:126-202`); a placed rack is one sealed `asm:<fixtureId>` marker priced as one line; its RU contents live in the global rack record, shared by every design.
- Proposed seam: `groupId?` on `GridPlacement` + `groups?: {id, name, containerPlacementId?}[]` on `GridOption` (like customItems/accessories); one `setPlacementsGroup` batch write via `batchEdit`; a Group column in `deviceRows` and sub-sections in `buildSchedule`. BOM stays merged by part → pricing unchanged.
- Must carry: `addOption`/`copyOptionMembers` remap `groupId`; revisions snapshot `groups`; deleting a container keeps or clears members.
- **Jeff (Oct 12):** any device can hold a group ("Make group": a plain rack part, a rack assembly, a booth, a panel). On the plan, members are hidden inside the holder (a count badge like "Rack · 6"); the Spreadsheet lists them indented under the holder, each keeping its own designator.
- Still open: does a group feed a rack assembly's RU elevation/submittal? (later)
- Original questions: is the rack a placed `asm:` rack (priced as the assembly) or just a plain rack part + a group? Do grouped devices sit on the plan at their own spot, or collapse into the rack marker? Does a group feed the rack's RU elevation / submittal?

## #6 Product Library is a small slice — root cause

- The library is the separate `grid_catalog` collection, not the catalog (`stores/grid-catalog.ts:9-12`). `listGridSymbols` seeds it from the catalog **once, on first use, only when it's empty** (`:82-99`). Prod's was seeded long before the 37k-part catalog landed.
- After that, a catalog part only joins the library when Auto fill or the From-estimate tray needs it (`ensureGridSymbolsFor`, `:184`; callers `grid-auto-fill.ts:61`, `actions.ts:569`, `estimator/grid-design-actions.ts:72`). So the library = the first seed + whatever Auto fill/estimates pulled in.
- Shipping 37k parts to the client isn't viable. Plan: a **Catalog** search in the Product Library (server action, debounced, ~50 results, same palette tile), and placing a catalog result calls `ensureGridSymbolsFor([part])` first so it becomes an ordinary library entry. Fabric/Labor stay out (as today).

## Side observations

- Legend shows "Dimming & Power — Cardioid Dynamic" for the SM58: the per-entry symbol override splits a legend row as type + description. Check when #2 lands.
