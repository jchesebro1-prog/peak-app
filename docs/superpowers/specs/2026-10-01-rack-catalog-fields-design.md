# Rack catalog fields: RU, depth, weight, power on catalog parts

**Wave 1.** Authored off-mini 2026-10-01. Decision RK-2 (Jeff): optional catalog fields + per-placement
override; backfill over time.

## Goal
Give catalog parts the physical and electrical data a rack layout needs, without making any of it
required, and with a fast way to backfill the gear Peak actually specs.

## Task 0 — recon
- How are catalog parts stored (`catalog_parts`, ~14.7k hosted rows per memory)? Fixed columns vs a
  jsonb attribute bag? Where is the part editor and where do imports write?
- How do the existing price-book / 52-brand imports map columns? Reuse that mapper for backfill.
- Does `searchAssemblyPartsAction` return the full part row or a trimmed shape? It must carry the new fields.

## Fields (all optional, imperial)
| Field | Type | Notes |
|---|---|---|
| `rackMount` | enum `rack` / `shelf` / `none` | `rack` = has rack ears; `shelf` = sits on a shelf; `none` = not rack gear. Absent = unknown. |
| `ruHeight` | number | Whole or half RU, > 0 (0.5 allowed for a few modules; 1, 2, 3 ... typical). |
| `rackWidth` | enum `full` / `half` / `third` / `23in` | Default `full` (19 in). Drives lane use in the layout. |
| `depthIn` | number | Overall depth incl. connectors, inches. |
| `weightLb` | number | Shipping/installed weight, pounds. |
| `powerWatts` | number | Typical draw, W. |
| `maxPowerWatts` | number | Peak/rated draw, W; used for circuit sizing. |
| `mountFace` | enum `front` / `rear` / `both` | Default `front`. |
| `airflow` | enum `front-to-rear` / `rear-to-front` / `side` / `passive` | Used for heat warnings. |
| `rackNotes` | string | e.g. "needs 1U vent above". |
Absent field = **unknown**, never zero. Zero means "measured, none" (e.g. a passive patch panel = 0 W).

## Per-placement override
The rack layout (see layout-engine spec) may override `ruHeight`, `rackWidth`, `depthIn`, `weightLb`,
`powerWatts` per placement. Resolution order: **placement override > catalog field > unknown**.

## Backfill path (Jeff: "over time")
1. Catalog part editor: a "Rack data" section with the fields above.
2. CSV import/export of just these columns keyed by SKU (additive; never blanks existing values).
3. A **coverage report**: of parts used in racks/assemblies, how many lack RU/depth/watts. Surfaces in
   the builder as chips ("3 parts missing RU height") and in the submittal output as gaps.
4. Phase 2 (out of scope here): extract specs from datasheets via Part Documents.

## Build tasks
0. Recon (above).
1. Add the fields + validation (positive numbers, enums) to the catalog part type and editor.
2. Extend assembly part search to return them.
3. CSV import/export for the rack columns.
4. Coverage report helper (pure fn) used by the builder and outputs.
5. Seed the ~25 most common AV/control parts (amps, DSPs, switchers, PDUs, patch panels, blanks,
   vent panels, shelves, rails) **only with values Jeff supplies** — do NOT invent specs. Ship the
   import template so Jeff or Jena can fill it.

## Open questions
- **[BLOCKING for seed data]** Who supplies the first-pass RU/depth/watts for common gear?
- Half-RU modules: keep or restrict to whole RU in v1? (default: allow 0.5 in data, layout snaps to whole RU.)

## Acceptance
A part can carry any subset of the fields; unknowns stay unknown; a CSV round-trip preserves them; the
assembly part picker returns them; coverage report lists parts missing RU/depth/watts.
