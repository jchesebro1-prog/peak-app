# `rack` assembly kind: model, builder, pricing, consumers

**Wave 2.** Authored off-mini 2026-10-01. Decision RK-1 (Jeff): a new `rack` kind beside
fixture / system / hardware. Facts from `peak-assembly-builder.md` (main d36413ac) — verify in Task 0.

## Goal
Peak can build a priced equipment-rack package in `/design/assemblies`, with the RU sidebar laying it
out, that quotes as one line everywhere assemblies already quote.

## Task 0 — recon
- Read `src/lib/fixture-assemblies.ts` (`FixtureRecord` ~:240, `resolveFixture` ~:360,
  `sanitizeFixtureInput` ~:525, `allAssembliesFrom` ~:654), `stores/fixtures.ts`, the builder files,
  `src/lib/design/grid-virtual-parts.ts`, `fixtures-convert.ts`. Record actual line numbers.
- Where kind enums/tabs are hard-coded (builder tabs, Estimator `FixtureModal`, Grid layer mapping,
  Quick Design picker, portal index filter) — grep for `'hardware'` to find every place D386 touched; racks need the same treatment.

## Model changes
- `FixtureRecord.kind`: add `'rack'`.
- New optional `rack?: RackLayout` (types from the layout-engine spec) — only valid when `kind === 'rack'`.
- `scope?` applies to racks like systems (use `SYSTEM_SCOPES`; suggest Audio / Video / Controls / Other).
  **[OPEN]** required vs optional — default: required, same as system.
- `parts?` holds **rack-level parts not placed in RU** (frame, rails, PDUs, casters, fans, cable mgmt).
  Placed devices live in `rack.placements`; they are NOT duplicated in `parts`.
- Storage unchanged: doc table `subassemblies`, jsonb `doc`, rev/seq/deleted. **No SQL migration.**
- Ids: `SA-<base36>`; Grid virtual part `asm:<id>`; accessory graph scope not used for racks in v1.
- Kind is fixed after creation (D299). Placements ids `RP-<base36>`.

## Save rules (`sanitizeFixtureInput` additions)
- Label required. At least one placement or one rack-level part.
- `rack.config.ruCount` 1–60; every placement passes `canPlace` against the rest (reject invalid saves
  with a clear message listing placement + reason).
- Max 300 placements (200-line cap applies to `parts`).
- Placement SKUs may repeat (exempt from the one-SKU-per-line check); `parts` still enforce it.
- A placement SKU missing from the catalog is allowed (prices at $0 or override, consistent with other kinds) and flagged in Issues.
- Warnings never block a save; errors do.

## Pricing
- Builder/Estimator `resolveRack()`: sum of (included placements with SKU: catalog cost / list, `costOverride` honored)
  + `parts` with qty > 0. `optional` placements and qty-0 parts are excluded. `reserved` = $0.
  Same unit-cost/sell, `pricesAsOf` newest-wins, snapshot + drift badge (cost only) as D295.
- Expose `components` for the Estimator: every placement expands to a component row (qty 1 each, grouped
  by SKU for display), plus rack-level parts.
- Grid/Quick Design: `priceCell` unchanged — uses the rack's included sell, else cost ÷ (1 − defaultMargin).
- Portal: **racks are NOT indexed in v1** (portal indexes fixture kind only today); revisit later.

## Consumers
- **Builder:** new "Racks" tab; "New rack" creates a kind-rack record and opens the sidebar; list rows show RU used / watts.
- **Estimator + Quick Design:** `allAssembliesFrom()` already lists every kind (D418/D419); ensure racks
  appear with scope and that the Parts CSV expands components. Optional placements surface as add-on toggles (same mechanism as qty 0).
- **Grid:** racks become `asm:` virtual parts; layer comes from `scope`; "dead" rule applies when no priced parts.
  `gridSpecBomRows` expands placements + parts into members for specs/client packages.
- **Part Documents:** a rack contributes its distinct placement SKUs to the datasheet package (see outputs spec).
- **Go-live reset** keeps `subassemblies`. No assembly CSV import/export exists; not added here.

## Build tasks
0. Recon. 1. Types + `kind: 'rack'` + sanitize/validate. 2. `resolveRack` + snapshot/drift. 3. Store/actions
accept the rack block. 4. Builder tab, list, form wiring + sidebar mount (component spec). 5. Update every
kind switch found in recon (Estimator, Quick Design, Grid layer, spec rows). 6. Tests (see plan).
7. Update repo `CLAUDE.md`/`AGENTS.md` about kinds (it is stale) and `peak-assembly-builder.md` in memory.

## Open questions
- **[BLOCKING]** Should a rack be allowed to contain *another assembly* (e.g. an "amp rack" template placing a
  "power distribution" hardware assembly)? Default NO (no nesting, per current rule). Template racks instead = duplicate a rack record.
- Rack templates/presets (e.g. "42U AV head-end")? Default: duplicate existing record.
- Rack-level labor (install/wiring) lines — use catalog labor parts in `parts` (D408 precedent).

## Acceptance
A user creates a rack, lays out 10 devices + rack-level parts, saves; it appears in Estimator, Quick Design
and Grid with the right price; invalid layouts are refused with a specific message; optional devices are add-on toggles.
