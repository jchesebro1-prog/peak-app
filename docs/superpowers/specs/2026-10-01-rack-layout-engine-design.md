# Rack layout engine: pure placement rules, validation, totals

**Wave 1.** Authored off-mini 2026-10-01. Build this BEFORE any UI so rules are unit-tested.

## Goal
A pure TypeScript module (no React, no DB) that models a rack and answers: can this go here, what
happens if I move it, what does the rack total, what is wrong with it.
Suggested home: `src/lib/rack/layout.ts` (+ `layout.test` in the repo's test style; recon whether tests
live in `scripts/test-*.ts`).

## Task 0 — recon
- Repo test convention (`npm run test:specs` blocks in `scripts/test-review-and-spec.ts`).
- Any existing rack/enclosure types in the Grid (`src/lib/design/**`) to reuse or align with.

## Types
```ts
type RackFace = 'front' | 'rear'
type PlacementKind = 'device' | 'shelf' | 'blank' | 'vent' | 'reserved'
interface RackConfig {
  ruCount: number            // 1..60, default 42
  widthIn: 19 | 23           // default 19
  depthIn?: number           // usable depth for clash checks
  numbering: 'bottom-up' | 'top-down'   // default bottom-up (RU 1 at bottom)
}
interface RackPlacement {
  id: string                 // RP-<base36>
  kind: PlacementKind
  sku?: string               // required for device/shelf/blank/vent; absent for reserved
  label?: string
  ruStart: number            // lowest occupied RU
  ruHeight: number           // resolved (override > catalog), whole RU in v1
  face: RackFace
  lane?: 0 | 1 | 2           // for half/third-width devices side by side
  laneCount?: 1 | 2 | 3      // derived from rackWidth
  shelfId?: string           // device sits on this shelf placement (shelf has the RU, device has none)
  optional?: boolean         // add-on: shown dashed, excluded from price (matches D134 qty-0 idea)
  override?: { ruHeight?: number; depthIn?: number; weightLb?: number; powerWatts?: number; rackWidth?: string }
  costOverride?: number
  notes?: string
}
interface RackLayout { config: RackConfig; placements: RackPlacement[] }
```

## Rules
1. In bounds: `1 <= ruStart` and `ruStart + ruHeight - 1 <= ruCount`.
2. No overlap: two placements on the **same face and lane** may not share an RU.
3. Width: `full` uses all lanes; `half` uses lane 0 or 1; `third` uses 0/1/2. Mixed widths in the same RU
   must fit within the lanes. 23 in racks accept 19 in gear (flagged "needs adapter" warning).
4. Shelf: a `shelf` placement occupies RU; child devices reference it via `shelfId`, take **no RU**, and
   their total height must fit under the next obstruction (warning, not error, if unknown).
5. Depth clash (warning): front-face depth + rear-face depth at overlapping RUs exceeds rack depth.
6. Heat (warning): a device with `airflow` front-to-rear directly above/below another with
   rear-to-front/side without a vent/blank between; or >N W contiguous with no vent (N = configurable, default 1500 W per 10 RU; OPEN).
7. Placements are individual: the builder's "one SKU per line" rule does **not** apply to racks.
8. `blank`/`vent` are real catalog SKUs (BOM lines). `reserved` has no SKU, no price, appears in the
   schedule as "Reserved — future".
9. Optional placements still occupy space (they are shown dashed) but are excluded from price and weight totals
   by default; totals expose both "included" and "with options".

## API (pure functions)
`canPlace(layout, placement) -> {ok, reason?}` · `place` · `move` · `remove` · `resize` ·
`firstFit(layout, ruHeight, face, widthClass) -> ruStart | null` · `autoFillBlanks(layout, blankSku) -> layout` ·
`validate(layout) -> Issue[]` (`error`/`warning`, with placementIds + messages) ·
`totals(layout, partLookup) -> {ruUsed, ruFree, ruReserved, weightLb, watts, maxWatts, btuHr, byFace, missingData[]}` ·
`renumber(layout, numbering)` (display only; storage is always bottom-up).
Edits return a **new** layout (immutable) so undo/redo is a stack of layouts.

## Totals
`btuHr = watts * 3.412`. `missingData` lists SKUs lacking RU/depth/weight/watts so totals read
"at least X W (3 parts unknown)" — never silently treat unknown as zero.

## Build tasks
0. Recon. 1. Types + resolve helpers (override > catalog > unknown). 2. canPlace/place/move/remove.
3. firstFit + autoFillBlanks. 4. validate. 5. totals + missingData. 6. Test suite (see test plan).

## Open questions
- Heat threshold defaults (see rule 6). 
- Half-RU placement in v1? (default: whole RU only; catalog may store 0.5, layout rounds up with a warning.)
- 23 in rack support in v1 or just 19 in? (default: store the option, 19 in only in UI.)

## Acceptance
All rules above are covered by unit tests; no function mutates its input; totals flag unknown data.
