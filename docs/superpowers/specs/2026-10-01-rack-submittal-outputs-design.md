# Rack submittal outputs: elevation, schedule, power/heat, datasheet package

**Wave 3.** Authored off-mini 2026-10-01. Decision RK-3 (Jeff): all four outputs. Plugs into the
client-package / D94 submittal flow (`archive/specs-staging-landed-2026-07-25/2026-07-25-client-package-generator-design.md`).

## Goal
From a saved rack record (or any quote/Grid project containing racks), emit a submittal-ready set:
front/rear elevation drawing, equipment schedule, power/heat summary, and the datasheets for every
placed part — with gaps listed, never silently skipped.

## Task 0 — recon
- Zero-dep PDF writer from #36 (what it can do: text, tables, vector lines, images?).
- D94 .docx generator: can it embed an image or a table section? Entry points + match-report shape.
- SVG -> PNG/PDF options available in the stack (server-side), if the docx needs raster.
- Part Documents (#207): list datasheets for a SKU; blob helpers (D116).
- The client-package bundle walker, if it landed since 2026-07-25.

## Outputs
1. **Elevation drawing** — `renderRackElevationSvg()` (same code as the sidebar). One sheet per rack:
   title block (project, rack name, date, revision), front elevation, rear elevation if any rear items,
   RU numbers both rails, device labels with manufacturer/model, legend (optional, reserved, blank).
   Landscape letter by default; ANSI B option. Outputs SVG and PDF; PNG for the docx.
2. **Equipment schedule** — table per rack: RU (e.g. "12–13"), face, qty, manufacturer, model/SKU,
   description, depth, weight (lb), watts, notes; rack-level parts in a second table; reserved rows as "Future".
3. **Power/heat summary** — total watts / max watts, BTU/hr, total weight, RU used/free, circuit view
   (watts ÷ 120 V amps; PDU capacity vs load when PDU watts known), plus every warning from `validate()`.
   If data is missing: "at least ..." with a list of parts lacking data — printed on the sheet.
4. **Datasheet package** — distinct SKUs from placements + rack-level parts; merge their datasheet PDFs
   behind a cover index grouped by rack, in RU order; parts without a datasheet are **listed as gaps** on the cover.

## Delivery paths
- **Builder:** "Export submittal" button on a rack record -> zip (default) of: `elevation.pdf`,
  `schedule.pdf` (or .xlsx — OPEN), `power-heat.pdf`, `datasheets.pdf`.
- **Quote / Grid project:** the client-package action includes a Racks section automatically when `asm:`
  parts of kind rack are present.
- **D94 spec .docx:** add an "Equipment Racks" section (schedule table + embedded elevation image) to the
  bid-spec output when racks exist; CSI placement **OPEN** (likely 27 11 00 communications equipment rooms / 27 11 16 racks; confirm with Jeff).
- Stored via D116 blob on the project; downloadable/shareable.

## Style
Peak letterhead + footer, **Arial**, per `knowledge/peak/line-item-comparison-template.md` v2 for any
standalone client-facing document. Imperial units throughout. Drawings are "rough/for submittal", not stamped.

## Build tasks
0. Recon. 1. `rack-submittal-model.ts`: pure fn rack -> {schedule rows, power/heat, gaps, datasheetSkus}.
2. SVG sheet composer (title block + elevations). 3. PDF composer for sheets and schedule/power pages.
4. Datasheet merge + cover with gap list (reuse the client-package walker). 5. Builder button + zip.
6. Hook into client-package + D94 section. 7. Golden-file tests (see plan).

## Open questions
- **[BLOCKING]** Schedule format: PDF only, or also an .xlsx? (default: PDF + CSV.)
- CSI section numbers for the rack section (see above).
- Sheet size and title-block layout: does Peak have an existing drawing title block to match?
- Include a cable/patch schedule? Out of scope v1.

## Acceptance
For a rack with 10 devices (2 missing datasheets, 1 missing watts): the zip contains an accurate
elevation, a schedule matching the layout, a power page that says "at least X W (1 part unknown)", and a
datasheet package whose cover lists the 2 gaps. The elevation PDF is visually identical to the sidebar.
