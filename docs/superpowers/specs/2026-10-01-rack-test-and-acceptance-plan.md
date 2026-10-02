# Rack assembly: test matrix and end-to-end acceptance

**All waves.** Authored off-mini 2026-10-01. Follows repo conventions (`npm run test:specs` blocks in
`scripts/test-review-and-spec.ts`, `scripts/test-review-regressions.ts`) — confirm in Task 0.

## Unit — layout engine (wave 1)
- Bounds: ruStart 0, ruCount+1, height past top -> error.
- Overlap: same face/lane overlap rejected; front vs rear same RU allowed; half-width pair allowed; full + half rejected.
- Shelf: devices on shelf take no RU; removing a shelf removes/rehomes children (decide: reject if children exist).
- firstFit: finds lowest fit, null when full; honors face and width.
- autoFillBlanks: fills only empty RU, idempotent, never overwrites reserved.
- validate: depth clash, airflow adjacency, unknown SKU, optional overlap warnings.
- totals: unknown data never counted as zero; optional excluded by default; BTU = W x 3.412; imperial only.
- Immutability: inputs deep-equal after every call.

## Unit — catalog fields (wave 1)
- Enum/number validation; absent vs zero preserved; CSV round-trip additive; coverage report counts.

## Unit — assembly kind (wave 2)
- `sanitizeFixtureInput` rack cases: missing label, empty rack, invalid placement, >300 placements, kind change refused.
- Duplicate SKUs allowed in placements, still rejected in `parts`.
- `resolveRack`: pricing with costOverride, optional excluded, missing-SKU $0, snapshot + drift (cost only).
- `allAssembliesFrom` lists racks; Grid `asm:` virtual part layer from scope; dead-rack blocks quote by name.
- Regression: existing fixture/system/hardware blocks still pass unchanged.

## Component (wave 2)
- Snapshot tests of `renderRackElevationSvg` for fixtures: empty, mixed widths, shelf, rear + front, optional, reserved.
- Interaction tests (Playwright or the repo's runner): arm+place, drag, arrow-key move, delete, undo/redo, fill blanks, invalid-drop reason.
- A11y: keyboard-only build of a 5-device rack; screen-reader labels present.

## Outputs (wave 3)
- Golden files for schedule rows, power/heat page text, cover index with gaps.
- SVG in the sidebar equals SVG used in the PDF for the same layout.
- Zip contents list and filenames stable; PDF opens; datasheet merge order = RU order.

## End-to-end acceptance (Jeff-visible)
1. Create "AV Head-End Rack" 42U; add rack frame, PDU, rails as rack-level parts.
2. Place 10 devices via sidebar (mix of 1U, 2U, a shelf with two half-width items, 1 rear-mounted).
3. Mark one as optional; reserve 4U for future.
4. Fill blanks; see RU used/free and watts/BTU/weight; resolve one warning.
5. Save; add the rack to an Estimator quote and a Grid project; prices match the builder.
6. Export submittal: elevation, schedule, power/heat, datasheet package with listed gaps.
7. Run the client-package from the quote; Racks section is present; D94 docx has the Equipment Racks section.

## Regression guards
Pricing parity across surfaces (Builder/Estimator vs Grid vs portal-not-indexed); no change to existing kinds;
no SQL migration; no secrets or real customer data in test fixtures.
