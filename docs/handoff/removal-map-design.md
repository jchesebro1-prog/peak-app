# Removal map — Design tab

Status: written 2026-11-19 from the code in this repository. Companion to `design-spec.md` and
`design-data.json`. It is a guide for the developer who will delete the Design tab code from this
app. No application code was changed to produce it.

How to read this document

- "Removed" means the Design scope in the spec: the Design overview (`/design`), Quick Design
  (`/design/quick`, `/quick-design`) and the designs list (`/design/designs`), the Grid
  (`/design/grid/**`, its risers, drawing set and schedule), Grid Settings (Equipment map, wire
  types, symbols, port rules, box types), the Specs module (`/design/specs/**`,
  `src/lib/specs/**`), and Consulting (`/design/engagements/**`, `/consulting/**`, the consulting
  proposal and the D94 spec generator's own screens).
- "Kept" means: the Estimator and Quotes hub, the Catalog (including device types), the Assembly
  Builder with racks (`/design/assemblies`), the Lineset Builder (`/design/lineset`), the Motor
  Library (`/design/motors`), Knowledge tools, Estimating Rules, CRM, Settings, Reports, and
  shared infrastructure.
- "Going separately" means features being removed by other work items: the customer Portal,
  Inbox and Gmail, Krisp meetings and recordings, AI and Assist, Flame Tests, Inspections, Venue
  Assessments, Repairs, Rentals, Projects, Schedule, Tasks, Calendar and Morning triage. Their
  references into the Design code are counted in section B.4 and not itemised.
- Line numbers were read on 2026-11-19. A "~" marks a line found by reading rather than by the
  import scan; re-check it before editing.
- Method: every `.ts` and `.tsx` file under `src/` was classified by path as removed, going
  separately, or kept. Every `import … from`, `export … from` and `import("…")` was resolved to a
  file. Section B.1 lists each one that goes from a kept file to a removed file. Route strings
  and collection names were then searched separately (sections B.2 and B.3).
- Fix codes in section B.1: **M** = move a small piece of removed code into kept code first;
  **X** = delete the caller's use; **D** = a decision is needed (section F).

Contents

- A. Files and directories
- B. References from kept code into removed code
- C. Wiring to remove (nav, settings, search, Home, Reviews, import, build step, scripts, packages)
- D. Database tables and stored settings that become unused
- E. Suggested deletion order
- F. Risks and decisions needed
- G. Not verified

---

## A. Files and directories

### A.1 Delete outright

These have no kept caller once the edits in section B are made.

Screens and routes

| Path | What it is |
| --- | --- |
| `src/app/(app)/design/page.tsx` | Design overview |
| `src/app/(app)/design/quick/` | Quick Design: `engine.ts` (the equations), `plan-svg.tsx` (venue geometry and the plan), the client, actions, tier-definition store, CSS |
| `src/app/(app)/quick-design/` | Old route, redirects to `/design/quick` |
| `src/app/(app)/design/designs/` | Designs list, its actions and CSS |
| `src/app/(app)/design/grid/` | The Grid: `[id]/` (editor, workspace, intake, riser, conduit riser, set, schedule, actions) and `settings/` (Grid Settings, Equipment map). **Move `settings/equipment-map/part-picker.tsx` out first (fix M1)** |
| `src/app/(app)/design/specs/` | Spec builder, library, records, templates, actions |
| `src/app/(app)/design/engagements/` | Consulting hub, engagement page, proposal builder (`quote/`), proposal document (`letter/`), markup viewer, D94 generator (`spec/`) |
| `src/app/(app)/consulting/` | Old consulting routes (redirects) |
| `src/app/(app)/home-my-designs.tsx` | Home "My designs" card |
| `src/app/api/grid/` | Datasheet book PDF, conduit riser DXF, package manifest for a Grid design |
| `src/app/api/grid-sheets/` | Sheet upload (direct and 4 MB), sheet file proxy |
| `src/app/api/spec/`, `src/app/api/spec-documents/` | D94 spec and spec-builder Word downloads |
| `src/app/api/spec-library/` | Spec library JSON export / import |
| `src/app/api/engagement-files/` | Engagement activity file upload and download (also listed in the Project Management map) |
| `src/app/print/grid-set/` | Signed print route for the drawing set, and its sheet and document asset routes |

Libraries

| Path | What it is |
| --- | --- |
| `src/lib/design/` **except the files in A.3** | The Grid's rules: `auto-estimate.ts`, `cable-package.ts`, `conduit-riser/` (but see decision D2 for `tags.ts` and `cable-od.ts`), `conduit-riser-server.ts`, `design-links.ts`, `designators.ts`, `designators-server.ts`, `drawing-labels.ts`, `drawing-set-data.ts`, `equipment-legacy-hints.ts`, `equipment-map.ts`, `equipment-map-view.ts`, `equipment-pricing.ts`, `equipment-vocab.ts`, `estimate-grid-link.ts`, `estimate-links-server.ts`, `estimate-tray.ts`, `estimate-tray-server.ts`, every `grid-*.ts` not in A.3, `legacy-church-geom.ts`, `legacy-pros-geom.ts`, `object-symbols.ts`, `object-symbols-server.ts`, `room-shape/`, `scope-targets.ts`, `sheet-adjust*.ts`, `sheet-split-bytes.ts`, `venue-templates/`, `wire-labor.ts` (after fix M3 and X10), `wire-starter.ts`, `wire-starter-server.ts` |
| `src/lib/specs/` | Specs module rules (after fixes M4, D1, D3, D5) |
| `src/lib/stores/grid-projects.ts`, `grid-catalog.ts`, `grid-riser.ts`, `grid-conduit-riser.ts` | Grid stores |
| `src/lib/stores/designs.ts`, `design-pricing.ts`, `equipment-map.ts` | Design records, Quick Design pricing loader, Equipment map store |
| `src/lib/stores/spec-documents.ts`, `spec-records.ts`, `spec-curtain-templates.ts`, `generated-specs.ts` | Specs stores with no kept reader after section B |
| `src/lib/stores/spec-sections.ts`, `spec-articles.ts`, `spec-templates.ts` | Specs stores — **only if decision D1 drops catalog spec text** |
| `src/lib/stores/engagements.ts`, `review-snapshots.ts` | Consulting store and its approval snapshots |
| `src/lib/stores/riser-box-types.ts`, `conduit-sizes.ts`, `src/lib/riser-box-types.ts`, `src/lib/conduit-sizes.ts` | Conduit riser settings |
| `src/lib/consulting-review.ts`, `consulting-stages.ts` (after fix M6), `consulting-files.ts` (after fix M7), `consulting-files-server.ts` | Consulting helpers |
| `src/lib/grid-sheet-file.ts`, `grid-sheet-serve.ts` | Sheet file checks and serving |
| `src/lib/annotations.ts` | Markup, measurement and calibration model. Every importer is in the removed code (the Grid, consulting markup, `src/components/drawing/`) |
| `src/lib/bid-spec.ts`, `bid-spec-docx.ts` | D94 generator — **only if decision D5 drops the specification from client packages**; otherwise they stay |

Components

| Path | What it is |
| --- | --- |
| `src/components/design/` | PDF canvas, symbol shapes, icon picker, object symbol tile, scope inputs panel, New design button, feet input, movable-room fields |
| `src/components/drawing/` **except `title-block.tsx`** (fix M2) | Drawing sheet, set sheets, riser canvas, conduit riser figure |
| `src/components/room-shape/` | Room shape editor |

Screens that live under kept folders but exist only for the Grid (delete with Design, subject to
decision D2):

| Path | What it is |
| --- | --- |
| `src/app/(app)/estimating-rules/conduit-sizes/` | Estimating Rules → Conduit sizes |
| `src/app/(app)/catalog/riser-data/`, `src/lib/riser-data-sheet.ts`, `riser-data-sheet-server.ts`, `riser-data-preview.ts` | Catalog → Riser data sheet (designator codes, riser tag defaults, cable diameters) |
| `src/app/(app)/catalog/tag-defaults-field.tsx` | Riser tag defaults in the part editor |
| `src/app/(app)/estimator/grid-design-actions.ts` | "Design in the Grid" server actions |

Seeds, scripts and source documents: `src/db/seeds/designs.ts`, `src/db/seeds/grid-projects.ts`,
`scripts/build-grid-icons.ts`, `scripts/grid-icons-gen.ts`, `scripts/grid-icon-picks.json`,
`scripts/fixture-grid-drawing-set.ts`, `scripts/room-shape-renders.ts`,
`scripts/test-room-shape.ts`, `scripts/test-grid-options.ts`,
`scripts/smoke-grid-sheet-upload.ts`, `scripts/backfill-blob-sheets.ts`,
`scripts/symbols-davinci.ts`, `scripts/dxf-audit.py`, `scripts/venue-template-convert.py`,
`scripts/seed-specs-once.ts`, `scripts/specs-renumber-bray.ts`, `scripts/specs-seed-northhs.py`,
`scripts/import-spec-library.ts`. Source documents that can move to an archive with the spec:
`docs/venue-templates/`, `docs/room-shape/`, `docs/specs-seed/`.

### A.2 Delete only when the "going separately" work has also landed

| Path | Still used by |
| --- | --- |
| `src/lib/consulting-schedule.ts`, `src/lib/engagement-activity.ts`, `engagement-activity-write.ts` | Listed for deletion in the Project Management map; the engagement Schedule and Activity tabs are their only screens |
| `src/app/(app)/design/engagements/schedule-tab.tsx`, `activity-tab.tsx`, `schedule-actions.ts`, `activity-actions.ts` | Same; they go with `design/engagements/` here |
| `src/components/gantt/` | The engagement Schedule tab and the Project Management Schedule |

### A.3 Do NOT delete — shared files that look like they belong

| Path | Why it stays |
| --- | --- |
| `src/app/(app)/design/assemblies/`, `lineset/`, `motors/` | The three kept builders |
| `src/app/(app)/design/export.ts`, `save-bar.tsx`, `studio-actions.ts` | CSV export, save bar and save actions of the Lineset Builder |
| `src/app/(app)/design/fixtures/`, `steel/`, `subassemblies/`, `src/app/(app)/design-studio/` | One-line redirect stubs to kept screens |
| `src/lib/design-routes.ts` | The redirect map those stubs use. Trim its consulting entries |
| `src/lib/design/lineset.ts`, `goods.ts`, `venue-dims.ts` | Lineset Builder rules. `goods.ts` is also read by curtain cut sheets |
| `src/lib/design/steel.ts`, `steel-shapes.json` | Motor Library, steel calculator, Lineset weights, cut sheets |
| `src/lib/design/fixture-crossref.json` | Knowledge → fixture cross-reference |
| `src/lib/design/curtain-pricing.ts` | The curtain cost model used by the Estimator, portal pricing, cut sheets and Estimating Rules |
| `src/lib/design/device-types.ts`, `src/lib/stores/device-types.ts` | Device types stay with the Catalog. `device-types.ts` imports `grid-scopes.ts` |
| `src/lib/design/grid-scopes.ts` | Needed by device types (the scope list and guard). Fix X12 removes its one import of the Quick Design engine |
| `src/lib/stores/studio-designs.ts`, `src/lib/stores/linesets.ts` | Lineset Builder saves |
| `src/lib/stores/fixtures.ts`, `src/lib/fixture-assemblies.ts`, `src/lib/rack/` | Assembly Builder |
| `src/lib/catalog-connect.ts`, `catalog-port*.ts` | Catalog ports and the wire-type list. Wire types are edited in Grid Settings but the port checks are catalog code |
| `src/lib/curtain-geom.ts`, `src/lib/curtain-pricing.ts`, `src/lib/fabric-part.ts` | Shared curtain helpers |
| `src/lib/venue-types.ts` | CRM venue types. Fix X5 removes its Background handling |
| `src/components/drawing/title-block.tsx` | Used by rack submittal sheets and curtain cut sheets (fix M2) |
| `src/components/spec-key-select.tsx` | Estimator Spec select — see decision D3 |

A suggested tidy-up after the deletion: the surviving files in `src/lib/design/` (lineset, goods,
steel, venue-dims, curtain-pricing, device-types, grid-scopes, fixture-crossref) no longer belong
under a "design" folder. Renaming is optional and touches many imports.

---

## B. References from kept code into removed code

### B.1 Imports (181)

Fix codes

| Code | Fix |
| --- | --- |
| M1 | Move `design/grid/settings/equipment-map/part-picker.tsx` to `src/components/part-picker.tsx`, and move the `EquipPartHit` type and `searchEquipmentPartsAction` (in `design/grid/settings/actions.ts`, lines ~189 and ~217) to a kept actions file. Five kept Estimating Rules screens use the picker |
| M2 | Move `src/components/drawing/title-block.tsx` and the title-block half of `src/lib/design/grid-drawing-set.ts` (`titleBlockData`, `revLetter`, `RevisionRow`, `TitleBlockData`, `TitleBlockInput`, plus the sheet-size constants the component needs) to a kept module, for example `src/lib/title-block.ts` |
| M3 | Move the quote-line id helpers to a kept module, for example `src/lib/quote-line-ids.ts`: `ASSEMBLY_PART_PREFIX`, `ALLOWANCE_PART_PREFIX`, `parseVirtualPartId`, `internalSkuCheck`, `gridSpecBomRows` (from `grid-virtual-parts.ts`), `CUSTOM_ITEM_PREFIX` (from `grid-custom-items.ts`) and `isLaborSku` (from `wire-labor.ts`). Existing quotes made from the Grid keep `asm:`, `allow:`, `custom:` and `labor:` SKUs forever, so reports and packages must keep recognising them |
| M4 | Move `isPlaceholderSku` and `PLACEHOLDER_SKUS` from `src/lib/specs/record-keys.ts` to a kept module |
| M5 | Move `isPerLengthUnit` (a short predicate in `src/lib/design/grid-bom.ts`) to a kept module |
| M6 | Move `DEFAULT_CONSULTING_ASSUMPTIONS` and `mergedConsultingAssumptions` out of `consulting-stages.ts`: the Estimator page passes them as its assumptions library |
| M7 | Move the `FileRef` type out of `consulting-files.ts` (the notes store uses it) |
| X1 | Delete the Conduit sizes screen and its Estimating Rules link; in `catalog-rename/apply.ts` drop the conduit-sizes rewrite step |
| X2 | Remove the Grid branch: "Design in the Grid", "Generate from Grid" drawings, Grid-project lookups for a quote (`gridProjectForQuote` → treat as none), Grid riser and drawing-set output in client packages, the Grid datasheet book |
| X3 | Drop Grid projects and D94 generated specs as sources of "quoted parts" in Catalog → Datasheets and the photo sheet |
| X4 | Curtain cut sheets: move `GridCurtain`, `GridCurtainType` and `GRID_CURTAIN_TYPES` into `curtain-cut-sheets/vocab.ts`; drop the branch that reads curtains from a Grid project. Cut sheets for quotes that came from the Grid will then have no curtain data (risk R5) |
| X5 | Settings → Venue types: remove the Background column; in `venue-types.ts` stop sanitising `background` (leave the stored value) |
| X6 | Remove the design and Grid seeds and their two lines in `src/db/seed-data.ts`; remove the spec-template seeding lines (252–253) |
| X7 | In `catalog-rename/apply.ts` remove the Equipment-map rewrite and the `grid_catalog`, `grid_projects` and `spec_documents` sweeps (lines ~213–234, ~332, ~338) |
| X8 | Remove design rows: the Home "My designs" card and its promote action, the design rows on Reviews, the design-review nav badge, the designs feed in dashboard data |
| X9 | Remove consulting rows: the engagement chip on consulting quote rows, phase reviews on Reviews, the consulting spawn in `quote-spawn.ts`, consulting phases in Import and Settings, engagement feeds in dashboard data and venue history |
| X10 | Estimating Rules: remove the wire-pull, Cable Package and per-system labor groups from `stores/pricing.ts` together with `loadWireLaborRules` (decision D6 first) |
| X11 | `settings.ts`: inline the `GridShape` type or drop the Grid settings keys from the type |
| X12 | `grid-scopes.ts`: replace the imported `SysKey` type with a local one |
| D1–D6 | See section F |

**Estimator** (20)

| File:line | Imports | From | Fix |
| --- | --- | --- | --- |
| `src/app/(app)/estimator/catalog-rank.ts:1` | isPerLengthUnit | `lib/design/grid-bom.ts` | M5 |
| `src/app/(app)/estimator/curtain-line.ts:12` | curtainSpecKey | `lib/specs/record-keys.ts` | D3 |
| `src/app/(app)/estimator/grid-design-actions.ts:7` | createProject, getProject, gridProjectForQuote, linkOptionToEstimate,  | `lib/stores/grid-projects.ts` | X2 |
| `src/app/(app)/estimator/grid-design-actions.ts:8` | createDesign | `lib/stores/designs.ts` | X2 |
| `src/app/(app)/estimator/grid-design-actions.ts:9` | ensureGridSymbolsFor | `lib/stores/grid-catalog.ts` | X2 |
| `src/app/(app)/estimator/grid-design-actions.ts:10` | defaultOptionId | `lib/design/grid-options.ts` | X2 |
| `src/app/(app)/estimator/grid-design-actions.ts:11` | siteForLocId | `lib/design/grid-intake.ts` | X2 |
| `src/app/(app)/estimator/grid-design-actions.ts:14` | estimateTrayParts | `lib/design/estimate-tray-server.ts` | X2 |
| `src/app/(app)/estimator/grid-design-actions.ts:15` | GRID_LINK_COPY, quoteQualifiesForGrid | `lib/design/estimate-grid-link.ts` | X2 |
| `src/app/(app)/estimator/narrative.ts:3` | isPlaceholderSku | `lib/specs/record-keys.ts` | M4 |
| `src/app/(app)/estimator/package-actions.ts:5` | GRID_SET_COPY | `lib/design/grid-set-print.ts` | X2 |
| `src/app/(app)/estimator/package-staff-panel.tsx:7` | GRID_LINK_COPY | `lib/design/estimate-grid-link.ts` | X2 |
| `src/app/(app)/estimator/package-staff-panel.tsx:13` | GRID_SET_COPY | `lib/design/grid-set-print.ts` | X2 |
| `src/app/(app)/estimator/page.tsx:26` | allSpecRecords | `lib/stores/spec-records.ts` | D3 |
| `src/app/(app)/estimator/page.tsx:34` | systemMatchKeys | `lib/specs/records.ts` | D3 |
| `src/app/(app)/estimator/page.tsx:42` | mergedConsultingAssumptions | `lib/consulting-stages.ts` | M6 |
| `src/app/(app)/estimator/parts-csv.ts:7` | isPlaceholderSku | `lib/specs/record-keys.ts` | M4 |
| `src/app/(app)/estimator/steps/package-narrative-tab.tsx:11` | GRID_LINK_COPY | `lib/design/estimate-grid-link.ts` | X2 |
| `src/app/(app)/estimator/track-bom.ts:12` | curtainSpecKey | `lib/specs/record-keys.ts` | D3 |
| `src/app/(app)/estimator/use-estimator-state.ts:55` | curtainSpecKey | `lib/specs/record-keys.ts` | D3 |

**Estimate output, client packages, cut sheets** (50)

| File:line | Imports | From | Fix |
| --- | --- | --- | --- |
| `src/components/cutsheets/cut-sheet-pages.tsx:2` | TitleBlock | `components/drawing/title-block.tsx` | M2 |
| `src/lib/client-package-server.ts:2` | assemble, matchBom, AssembledSpec, RackSpecSection, SpecCatalogPart | `lib/bid-spec.ts` | D5 |
| `src/lib/client-package-server.ts:3` | buildSpecDocx | `lib/bid-spec-docx.ts` | D5 |
| `src/lib/client-package-server.ts:5` | placementQty | `lib/design/grid-bom.ts` | X2 |
| `src/lib/client-package-server.ts:8` | riserGraph | `lib/design/grid-riser.ts` | X2 |
| `src/lib/client-package-server.ts:10` | gridProjectForQuote, listSheets, GridProject | `lib/stores/grid-projects.ts` | X2 |
| `src/lib/client-package-server.ts:11` | allSections | `lib/stores/spec-sections.ts` | D5 |
| `src/lib/client-package-server.ts:25` | GRID_SET_STEP_MS | `lib/design/grid-set-print.ts` | X2 |
| `src/lib/client-package-server.ts:26` | renderGridSetPdf, GridSetRenderCause, GridSetRenderFn | `lib/design/grid-set-render.ts` | X2 |
| `src/lib/client-package-server.ts:29` | ensureOptions, optionSlice, resolveOptionId | `lib/design/grid-options.ts` | X2 |
| `src/lib/client-package-server.ts:31` | internalSkuCheck | `lib/design/grid-virtual-parts.ts` | M3 |
| `src/lib/client-package.ts:1` | SpecCatalogPart, BomRow | `lib/bid-spec.ts` | D5 |
| `src/lib/client-package.ts:2` | optionSlice, resolveOptionId | `lib/design/grid-options.ts` | X2 |
| `src/lib/client-package.ts:3` | GridProject | `lib/stores/grid-projects.ts` | X2 |
| `src/lib/client-package.ts:4` | hasPrintableSpec | `lib/specs/articles.ts` | D5 |
| `src/lib/client-package.ts:7` | placementQty | `lib/design/grid-bom.ts` | X2 |
| `src/lib/client-package.ts:8` | gridSpecBomRows, internalSkuCheck, parseVirtualPartId | `lib/design/grid-virtual-parts.ts` | M3 |
| `src/lib/curtain-cut-sheets/estimator-curtains.ts:9` | ensureOptions, hasOption, optionSlice, GridOption | `lib/design/grid-options.ts` | X4 |
| `src/lib/curtain-cut-sheets/estimator-curtains.ts:10` | GridCurtain, GridCurtainType | `lib/design/grid-bom.ts` | X4 |
| `src/lib/curtain-cut-sheets/load.ts:12` | getProject | `lib/stores/grid-projects.ts` | X4 |
| `src/lib/curtain-cut-sheets/model.ts:10` | revLetter, titleBlockData, RevisionRow, TitleBlockData, TitleBlockInpu | `lib/design/grid-drawing-set.ts` | M2 |
| `src/lib/curtain-cut-sheets/parse.ts:6` | GRID_CURTAIN_TYPES, GridCurtainType | `lib/design/grid-bom.ts` | X4 |
| `src/lib/curtain-cut-sheets/vocab.ts:6` | GridCurtainType | `lib/design/grid-bom.ts` | X4 |
| `src/lib/estimate-output/bom-models.ts:5` | isPlaceholderSku | `lib/specs/record-keys.ts` | M4 |
| `src/lib/estimate-output/bom.ts:4` | isPlaceholderSku | `lib/specs/record-keys.ts` | M4 |
| `src/lib/estimate-output/package-docs-server.ts:2` | internalSkuCheck | `lib/design/grid-virtual-parts.ts` | M3 |
| `src/lib/estimate-output/package-extras.ts:4` | allSections | `lib/stores/spec-sections.ts` | D5 |
| `src/lib/estimate-output/package-files-server.ts:3` | GRID_SET_COPY, GRID_SET_DEADLINE_MS, GRID_SET_STEP_MS, gridSetFileName | `lib/design/grid-set-print.ts` | X2 |
| `src/lib/estimate-output/package-files-server.ts:4` | renderGridSetPdf, GridSetRenderFn | `lib/design/grid-set-render.ts` | X2 |
| `src/lib/estimate-output/package-files-server.ts:9` | gridProjectForQuote, GridProject | `lib/stores/grid-projects.ts` | X2 |
| `src/lib/estimate-output/package-live-loader.ts:13` | allSections | `lib/stores/spec-sections.ts` | D5 |
| `src/lib/estimate-output/package-panel-server.ts:4` | gridProjectForQuote, GridProject | `lib/stores/grid-projects.ts` | X2 |
| `src/lib/estimate-output/package-panel-server.ts:13` | quoteQualifiesForGrid | `lib/design/estimate-grid-link.ts` | X2 |
| `src/lib/estimate-output/package-spec-docs-server.ts:5` | loadAssembledSpec | `lib/specs/load-spec.ts` | D5 |
| `src/lib/estimate-output/package-spec-docs-server.ts:6` | buildSectionDocx | `lib/specs/spec-docx.ts` | D5 |
| `src/lib/estimate-output/package-spec-docs-server.ts:7` | specFileName | `lib/specs/spec-file-name.ts` | D5 |
| `src/lib/estimate-output/package-spec-docs-server.ts:8` | specDocumentsWithQuoteSource, SpecDocument | `lib/stores/spec-documents.ts` | D5 |
| `src/lib/estimate-output/package-spec-ready.ts:1` | hasPrintableSpec | `lib/specs/articles.ts` | D5 |
| `src/lib/estimate-output/package-zip-server.ts:1` | buildSpecDocx | `lib/bid-spec-docx.ts` | D5 |
| `src/lib/estimate-output/package-zip-server.ts:2` | SpecCatalogPart | `lib/bid-spec.ts` | D5 |
| `src/lib/estimate-output/package-zip-server.ts:17` | allSections | `lib/stores/spec-sections.ts` | D5 |
| `src/lib/part-docs/datasheet-book-cover-server.ts:11` | GridProject | `lib/stores/grid-projects.ts` | X2 |
| `src/lib/part-docs/datasheet-book-download.ts:5` | ensureOptions, resolveOptionId | `lib/design/grid-options.ts` | X2 |
| `src/lib/part-docs/datasheet-book-download.ts:21` | getProject | `lib/stores/grid-projects.ts` | X2 |
| `src/lib/part-docs/photo-sheet-io.ts:8` | allGeneratedSpecs | `lib/stores/generated-specs.ts` | X3 |
| `src/lib/part-docs/photo-sheet-io.ts:9` | listProjects | `lib/stores/grid-projects.ts` | X3 |
| `src/lib/project-discounts/rules.ts:2` | isPlaceholderSku | `lib/specs/record-keys.ts` | M4 |
| `src/lib/quote-line-members.ts:37` | gridSpecBomRows, parseVirtualPartId | `lib/design/grid-virtual-parts.ts` | M3 |
| `src/lib/quote-line-members.ts:38` | isLaborSku | `lib/design/wire-labor.ts` | M3 |
| `src/lib/review-limits.ts:18` | isLaborSku | `lib/design/wire-labor.ts` | M3 |

**Catalog and Displays API** (49)

| File:line | Imports | From | Fix |
| --- | --- | --- | --- |
| `src/app/(app)/catalog/actions.ts:16` | articleIdForPart | `lib/specs/articles.ts` | D1 |
| `src/app/(app)/catalog/actions.ts:17` | allArticles | `lib/stores/spec-articles.ts` | D1 |
| `src/app/(app)/catalog/actions.ts:18` | allSections | `lib/stores/spec-sections.ts` | D1 |
| `src/app/(app)/catalog/documents/actions.ts:22` | listProjects | `lib/stores/grid-projects.ts` | X3 |
| `src/app/(app)/catalog/documents/actions.ts:23` | allGeneratedSpecs | `lib/stores/generated-specs.ts` | X3 |
| `src/app/(app)/catalog/documents/page.tsx:7` | listProjects | `lib/stores/grid-projects.ts` | X3 |
| `src/app/(app)/catalog/documents/page.tsx:8` | allGeneratedSpecs | `lib/stores/generated-specs.ts` | X3 |
| `src/app/(app)/catalog/import.ts:11` | looksLikeSpecId, resolveArticleRef, resolveSectionRef | `lib/specs/articles.ts` | D1 |
| `src/app/(app)/catalog/import.ts:12` | allSections | `lib/stores/spec-sections.ts` | D1 |
| `src/app/(app)/catalog/import.ts:13` | allArticles | `lib/stores/spec-articles.ts` | D1 |
| `src/app/(app)/catalog/page.tsx:25` | allArticles | `lib/stores/spec-articles.ts` | D1 |
| `src/app/(app)/catalog/page.tsx:26` | allSections | `lib/stores/spec-sections.ts` | D1 |
| `src/app/(app)/catalog/page.tsx:27` | allTemplates, ensureStarterTemplates | `lib/stores/spec-templates.ts` | D1 |
| `src/app/(app)/catalog/page.tsx:28` | articleIdForPart | `lib/specs/articles.ts` | D1 |
| `src/app/(app)/catalog/page.tsx:40` | isPerLengthUnit | `lib/design/grid-bom.ts` | M5 |
| `src/app/(app)/catalog/page.tsx:41` | formatCableOd, suggestCableOd | `lib/design/conduit-riser/cable-od.ts` | D2 |
| `src/app/(app)/catalog/part-documents-section.tsx:11` | ObjectSymbolTile | `components/design/object-symbol.tsx` | D2 |
| `src/app/(app)/catalog/part-form.ts:7` | cleanTagFields, TagFields | `lib/design/conduit-riser/tags.ts` | D2 |
| `src/app/(app)/catalog/part-form.ts:8` | CABLE_OD_MAX_IN, cleanCableOd | `lib/design/conduit-riser/cable-od.ts` | D2 |
| `src/app/(app)/catalog/spec-panel.tsx:5` | outlineToText, renderBody | `lib/specs/outline.ts` | D1 |
| `src/app/(app)/catalog/spec-panel.tsx:6` | scaffoldFrom, SpecTemplateHeading | `lib/specs/templates.ts` | D1 |
| `src/app/(app)/catalog/tag-defaults-field.tsx:4` | TAG_LIMITS, TagFields | `lib/design/conduit-riser/tags.ts` | D2 |
| `src/app/api/v1/displays/catalog/[sku]/route.ts:4` | SpecCatalogPart | `lib/bid-spec.ts` | D1 |
| `src/app/api/v1/displays/catalog/[sku]/route.ts:5` | allSections | `lib/stores/spec-sections.ts` | D1 |
| `src/app/api/v1/displays/catalog/[sku]/route.ts:6` | allArticles | `lib/stores/spec-articles.ts` | D1 |
| `src/app/api/v1/displays/catalog/route.ts:5` | SpecCatalogPart | `lib/bid-spec.ts` | D1 |
| `src/app/api/v1/displays/catalog/route.ts:6` | allSections | `lib/stores/spec-sections.ts` | D1 |
| `src/app/api/v1/displays/catalog/route.ts:7` | allArticles | `lib/stores/spec-articles.ts` | D1 |
| `src/app/api/v1/displays/specs/[id]/route.ts:4` | SpecCatalogPart | `lib/bid-spec.ts` | D1 |
| `src/app/api/v1/displays/specs/[id]/route.ts:5` | hasPrintableSpec | `lib/specs/articles.ts` | D1 |
| `src/app/api/v1/displays/specs/[id]/route.ts:6` | allSections | `lib/stores/spec-sections.ts` | D1 |
| `src/app/api/v1/displays/specs/[id]/route.ts:7` | allArticles | `lib/stores/spec-articles.ts` | D1 |
| `src/app/api/v1/displays/specs/route.ts:4` | SpecCatalogPart | `lib/bid-spec.ts` | D1 |
| `src/app/api/v1/displays/specs/route.ts:5` | hasPrintableSpec | `lib/specs/articles.ts` | D1 |
| `src/app/api/v1/displays/specs/route.ts:6` | allSections | `lib/stores/spec-sections.ts` | D1 |
| `src/app/api/v1/displays/specs/route.ts:7` | allArticles | `lib/stores/spec-articles.ts` | D1 |
| `src/lib/catalog-rename/apply.ts:44` | CONDUIT_SIZES_BLOB | `lib/conduit-sizes.ts` | X1 |
| `src/lib/catalog-rename/apply.ts:46` | EQUIPMENT_MAP_BLOB | `lib/design/equipment-map.ts` | X7 |
| `src/lib/displays-api.ts:4` | PartSpecFields | `lib/bid-spec.ts` | D1 |
| `src/lib/displays-api.ts:6` | hasPrintableSpec, SpecCategoryArticle | `lib/specs/articles.ts` | D1 |
| `src/lib/displays-api.ts:7` | SpecSection | `lib/specs/sections.ts` | D1 |
| `src/lib/riser-data-preview.ts:9` | TagFields | `lib/design/conduit-riser/tags.ts` | D2 |
| `src/lib/riser-data-preview.ts:21` | formatCableOd | `lib/design/conduit-riser/cable-od.ts` | D2 |
| `src/lib/riser-data-sheet-server.ts:28` | listProjects | `lib/stores/grid-projects.ts` | D2 |
| `src/lib/riser-data-sheet.ts:16` | cleanTagFields, TAG_LIMITS, TagFields | `lib/design/conduit-riser/tags.ts` | D2 |
| `src/lib/riser-data-sheet.ts:17` | suggestTagDefaults | `lib/design/conduit-riser/suggest-tags.ts` | D2 |
| `src/lib/riser-data-sheet.ts:19` | CABLE_OD_MAX_IN, cleanCableOd, formatCableOd, suggestCableOd | `lib/design/conduit-riser/cable-od.ts` | D2 |
| `src/lib/riser-data-sheet.ts:20` | isPerLengthUnit | `lib/design/grid-bom.ts` | M5 |
| `src/lib/stores/catalog.ts:8` | TagFields | `lib/design/conduit-riser/tags.ts` | D2 |

**Estimating Rules** (14)

| File:line | Imports | From | Fix |
| --- | --- | --- | --- |
| `src/app/(app)/estimating-rules/conduit-sizes/actions.ts:5` | saveConduitSizes | `lib/stores/conduit-sizes.ts` | X1 |
| `src/app/(app)/estimating-rules/conduit-sizes/actions.ts:6` | ConduitSize | `lib/design/conduit-riser/pricing.ts` | X1 |
| `src/app/(app)/estimating-rules/conduit-sizes/actions.ts:8` | EquipPartHit | `app/(app)/design/grid/settings/actions.ts` | M1 |
| `src/app/(app)/estimating-rules/conduit-sizes/conduit-sizes-client.tsx:5` | PartPicker | `app/(app)/design/grid/settings/equipment-map/part-picker.tsx` | M1 |
| `src/app/(app)/estimating-rules/conduit-sizes/conduit-sizes-client.tsx:6` | CONDUIT_SIZES_MAX, CONDUIT_SIZE_MAX, validateConduitSizeRows | `lib/conduit-sizes.ts` | X1 |
| `src/app/(app)/estimating-rules/conduit-sizes/conduit-sizes-client.tsx:7` | ConduitSize | `lib/design/conduit-riser/pricing.ts` | X1 |
| `src/app/(app)/estimating-rules/conduit-sizes/page.tsx:5` | getConduitSizes | `lib/stores/conduit-sizes.ts` | X1 |
| `src/app/(app)/estimating-rules/curtain-mounts/curtain-mounts-client.tsx:5` | PartPicker | `app/(app)/design/grid/settings/equipment-map/part-picker.tsx` | M1 |
| `src/app/(app)/estimating-rules/lineset-types/lineset-types-client.tsx:6` | PartPicker | `app/(app)/design/grid/settings/equipment-map/part-picker.tsx` | M1 |
| `src/app/(app)/estimating-rules/pipe-types/pipe-types-client.tsx:6` | PartPicker | `app/(app)/design/grid/settings/equipment-map/part-picker.tsx` | M1 |
| `src/app/(app)/estimating-rules/system-categories/actions.ts:8` | EquipPartHit | `app/(app)/design/grid/settings/actions.ts` | M1 |
| `src/app/(app)/estimating-rules/system-categories/system-categories-client.tsx:6` | PartPicker | `app/(app)/design/grid/settings/equipment-map/part-picker.tsx` | M1 |
| `src/app/(app)/estimating-rules/track-series/track-series-client.tsx:6` | PartPicker | `app/(app)/design/grid/settings/equipment-map/part-picker.tsx` | M1 |
| `src/lib/stores/pricing.ts:9` | CABLE_PER_FIXTURE_MAX, DEFAULT_CABLE_PER_FIXTURE, DEFAULT_LABOR_PCT, D | `lib/design/wire-labor.ts` | X10 |

**Assembly Builder (racks)** (3)

| File:line | Imports | From | Fix |
| --- | --- | --- | --- |
| `src/components/rack/RackSheets.tsx:2` | TitleBlock | `components/drawing/title-block.tsx` | M2 |
| `src/components/rack/RackSheets.tsx:4` | titleBlockData | `lib/design/grid-drawing-set.ts` | M2 |
| `src/lib/rack/submittal.ts:12` | parseVirtualPartId | `lib/design/grid-virtual-parts.ts` | M3 |

**Quotes hub and Reviews** (10)

| File:line | Imports | From | Fix |
| --- | --- | --- | --- |
| `src/app/(app)/quotes/page.tsx:15` | getEngagementForQuoteRef, ENGAGEMENT_STATUS_LABEL | `lib/stores/engagements.ts` | X9 |
| `src/app/(app)/reviews/actions.ts:7` | approveDesign, claimDesignReview, requestDesignChanges, | `lib/stores/designs.ts` | X8 |
| `src/app/(app)/reviews/actions.ts:12` | approvePhaseReview, claimPhaseReview, getEngagement, requestPhaseChang | `lib/stores/engagements.ts` | X9 |
| `src/app/(app)/reviews/page.tsx:4` | getAllDesigns | `lib/stores/designs.ts` | X8 |
| `src/app/(app)/reviews/page.tsx:5` | allEngagements | `lib/stores/engagements.ts` | X9 |
| `src/app/(app)/reviews/page.tsx:9` | designBudgetLabel | `lib/design/scope-targets.ts` | X8 |
| `src/app/(app)/reviews/page.tsx:10` | designOpenHref | `lib/design/design-links.ts` | X8 |
| `src/lib/stores/quote-spawn.ts:154` | (dynamic import / type) | `lib/consulting-stages.ts` | X9 |
| `src/lib/stores/quote-spawn.ts:158` | (dynamic import / type) | `lib/stores/engagements.ts` | X9 |
| `src/lib/stores/review-snapshots.ts:2` | EngagementDoc, EngagementPhase | `lib/stores/engagements.ts` | X9 |

**Settings and Import** (10)

| File:line | Imports | From | Fix |
| --- | --- | --- | --- |
| `src/app/(app)/import/page.tsx:11` | mergedConsultingPhases | `lib/stores/engagements.ts` | X9 |
| `src/app/(app)/import/registry.ts:21` | looksLikeSpecId, resolveArticleRef, resolveSectionRef | `lib/specs/articles.ts` | D1 |
| `src/app/(app)/import/registry.ts:22` | allSections | `lib/stores/spec-sections.ts` | D1 |
| `src/app/(app)/import/registry.ts:23` | allArticles | `lib/stores/spec-articles.ts` | D1 |
| `src/app/(app)/import/registry.ts:30` | mergedConsultingPhases | `lib/stores/engagements.ts` | X9 |
| `src/app/(app)/settings/page.tsx:8` | mergedConsultingPhases | `lib/stores/engagements.ts` | X9 |
| `src/app/(app)/settings/page.tsx:9` | mergedConsultingAssumptions | `lib/consulting-stages.ts` | M6 |
| `src/app/(app)/settings/venue-types-card.tsx:13` | BUILT_IN_SCHEMATIC_LABEL, defaultBackground, pickerTemplates, template | `lib/design/venue-templates/index.ts` | X5 |
| `src/lib/settings.ts:141` | (dynamic import / type) | `lib/design/grid-symbols.ts` | X11 |
| `src/lib/venue-types.ts:20` | sanitizeBackground | `lib/design/venue-templates/index.ts` | X5 |

**Home, Reports, nav badges** (17)

| File:line | Imports | From | Fix |
| --- | --- | --- | --- |
| `src/app/(app)/_dashboard/widgets/home-cards.tsx:12` | designBudgetLabel, designNeedsPart, designRefreshHint | `lib/design/scope-targets.ts` | X8 |
| `src/app/(app)/_dashboard/widgets/home-cards.tsx:13` | designOpenHref | `lib/design/design-links.ts` | X8 |
| `src/app/(app)/_dashboard/widgets/home-cards.tsx:15` | timeAgo as designTimeAgo | `lib/stores/designs.ts` | X8 |
| `src/app/(app)/_dashboard/widgets/home-cards.tsx:34` | HomeMyDesigns, { DesignCard | `app/(app)/home-my-designs.tsx` | X8 |
| `src/app/(app)/_dashboard/widgets/home-cards.tsx:35` | estimateLinksForDesigns | `lib/design/estimate-links-server.ts` | X8 |
| `src/app/(app)/home-actions.ts:15` | promoteDesignAction as promoteFromDesigns | `app/(app)/design/designs/actions.ts` | X8 |
| `src/lib/dashboard/data.ts:11` | allEngagements | `lib/stores/engagements.ts` | X9 |
| `src/lib/dashboard/data.ts:12` | getAllDesigns | `lib/stores/designs.ts` | X8 |
| `src/lib/dashboard/home-metrics.ts:4` | DesignRecord | `lib/stores/designs.ts` | X8 |
| `src/lib/dashboard/metrics.ts:8` | ConsultingEngagement | `lib/stores/engagements.ts` | X9 |
| `src/lib/manufacturer-analytics.ts:22` | ALLOWANCE_PART_PREFIX, ASSEMBLY_PART_PREFIX | `lib/design/grid-virtual-parts.ts` | M3 |
| `src/lib/manufacturer-analytics.ts:23` | CUSTOM_ITEM_PREFIX | `lib/design/grid-custom-items.ts` | M3 |
| `src/lib/manufacturer-analytics.ts:24` | isLaborSku | `lib/design/wire-labor.ts` | M3 |
| `src/lib/nav-counts.ts:4` | listDesignRecords | `lib/stores/designs.ts` | X8 |
| `src/lib/sourcing-report.ts:27` | ALLOWANCE_PART_PREFIX, ASSEMBLY_PART_PREFIX | `lib/design/grid-virtual-parts.ts` | M3 |
| `src/lib/sourcing-report.ts:28` | CUSTOM_ITEM_PREFIX | `lib/design/grid-custom-items.ts` | M3 |
| `src/lib/sourcing-report.ts:29` | isLaborSku | `lib/design/wire-labor.ts` | M3 |

**CRM and shared** (4)

| File:line | Imports | From | Fix |
| --- | --- | --- | --- |
| `src/components/spec-key-select.tsx:4` | curtainSpecKey | `lib/specs/record-keys.ts` | D3 |
| `src/lib/design/grid-scopes.ts:29` | SysKey | `app/(app)/design/quick/engine.ts` | X12 |
| `src/lib/stores/notes.ts:2` | FileRef | `lib/consulting-files.ts` | M7 |
| `src/lib/venue-history-server.ts:14` | allEngagements | `lib/stores/engagements.ts` | X9 |

**Seeds** (4)

| File:line | Imports | From | Fix |
| --- | --- | --- | --- |
| `src/db/seed-data.ts:252` | (dynamic import / type) | `lib/stores/spec-templates.ts` | X6 |
| `src/db/seed-data.ts:253` | (dynamic import / type) | `lib/stores/spec-curtain-templates.ts` | X6 |
| `src/db/seeds/designs.ts:1` | DesignRecord, DesignReview, ReviewState | `lib/stores/designs.ts` | X6 |
| `src/db/seeds/grid-projects.ts:1` | GridProject | `lib/stores/grid-projects.ts` | X6 |

What the table says about the five areas the request singled out

- **Assembly Builder.** Fixtures, Systems and Hardware assemblies import nothing from the removed
  code. The dependency runs the other way: the Equipment map, Auto fill and the Grid's rack groups
  read assemblies. Racks have three imports: the title block for rack submittal sheets (M2) and
  `parseVirtualPartId` in `rack/submittal.ts` (M3). The rack's "Grid layer" is drawn by removed
  code (`src/lib/design/grid-rack-link.ts`); nothing in the builder needs changing.
- **Estimator.** 20 imports: "Design in the Grid" (X2, 11 imports across
  `grid-design-actions.ts`, `package-staff-panel.tsx`, `package-actions.ts` and
  `package-narrative-tab.tsx`), the Spec select and curtain spec keys (D3, 5), placeholder-SKU
  checks (M4, 2), the per-length unit test (M5, 1) and the consulting assumptions library (M6, 1). "Suggested BOM" is AI code and is
  going separately; it does not import Design code.
- **Catalog.** Device types stay and need `device-types.ts` and `grid-scopes.ts` (A.3). The part
  editor reaches into the removed code for spec text (D1), riser tag defaults and cable outside
  diameter (D2), symbol and riser drawings (D2), and the per-length unit test (M5). Catalog →
  Datasheets counts Grid projects and generated specs as "quoted" sources (X3).
- **Client packages.** `client-package.ts` and `client-package-server.ts` have 16 imports:
  the D94 specification file (D5), the Grid's riser graph and drawing-set PDF (X2), option
  helpers (X2) and virtual part ids (M3). The newer estimate package (`src/lib/estimate-output/`)
  has 18 more of the same kinds, plus spec-builder documents attached to a quote (D5).
- **Estimating Rules.** Five kept screens import the Equipment map's part picker (M1). Conduit
  sizes is Grid-only (X1). The wire-pull, Cable Package and per-system labor groups feed only
  Quick Design and the Grid (X10, D6). The curtain sewing % stays.

### B.2 Route links and type strings in kept code (not imports)

| File:line | What it is | Fix |
| --- | --- | --- |
| `src/components/nav/nav-data.ts:106–107, 113–115` | Design group: Overview, Consulting, The Grid, Specs, Grid Settings | Remove five entries; keep Lineset Builder, Assembly Builder, Motor Library (section C.1) |
| `src/components/nav/nav-data.ts:~150, ~154, ~168` | Active-key rules for `/design/grid/settings`, `/design/specs`, `/design` | Remove |
| `src/app/(app)/design/assemblies/page.tsx:75`, `lineset/page.tsx:138`, `motors/page.tsx:55` | "← Design" back links to `/design` | Point at a kept page |
| `src/app/(app)/design/studio-actions.ts:33, 40` | `revalidatePath("/design")` | Change to `/design/lineset` |
| `src/app/(app)/design/assemblies/actions.ts:29` | Revalidates `/design/quick` | Drop that path |
| `src/app/(app)/catalog/actions.ts:308` | Revalidates `/design/specs/library` | Drop |
| `src/app/(app)/catalog/device-types/actions.ts:19` | Revalidates `/design/grid` | Drop |
| `src/app/(app)/estimator/grid-design-actions.ts:76` | Revalidates `/design/designs` | File is deleted |
| `src/app/(app)/estimator/package-staff-panel.tsx:239, 356–357` | Links to `/design/grid/<id>` | Remove with "Design in the Grid" |
| `src/lib/curtain-cut-sheets/estimator-curtains.ts:410` | "Edit in the Grid design →" link | Remove with fix X4 |
| `src/app/(app)/home-greeting.tsx:111`, `home-pipeline.tsx:212, 222` | Links to `/design/quick` | Remove the buttons |
| `src/app/(app)/quotes/new/types.ts:13, 79–80, 120` | "Consulting quote" on + New quote, routed to `/design/engagements/quote` | Decision D4 |
| `src/lib/quote-links.ts:24–25` | A consulting quote opens `/design/engagements/quote?id=` | Decision D4 |
| `src/app/(app)/quotes/page.tsx:1051` | Engagement link on a consulting quote row | Remove (X9) |
| `src/app/(app)/quotes/page.tsx:1071` | "Spec" button → `/design/specs/new?quote=` | Remove |
| `src/app/(app)/reviews/page.tsx:155` | Phase review link | Remove (X9) |
| `src/lib/venue-history-server.ts:157, 196` | Engagement links in venue history | Remove (X9) |
| `src/lib/nav-counts.ts:213` | Design review badge link | Remove (X8) |
| `src/lib/search/global-search.ts:113, 221–227` | ⌘K searches `designs` and links to `/design/designs?id=` | Remove the designs branch |
| `src/app/(app)/settings/settings-sections.ts:21, 52, 61, 64, 85–87` | Consulting settings group; Grid Settings shortcut | Section C.2 |
| `src/lib/estimate-number.ts:18, 27, ~209–220` | `consulting` estimate type and its `CON` prefix | Keep: existing consulting quotes still need a number (decision D4) |

### B.3 Direct reads of removed collections from kept code

| File:line | Collection | Fix |
| --- | --- | --- |
| `src/lib/search/global-search.ts:113` | `designs` | Remove the search branch |
| `src/lib/venue-history-server.ts:61` | `consulting_engagements` | Remove the activity source |
| `src/lib/catalog-rename/apply.ts:~213–234` | `grid_catalog` | Remove (X7) |
| `src/lib/catalog-rename/apply.ts:~332` | `spec_documents` | Remove (X7) |
| `src/lib/catalog-rename/apply.ts:~338` | `grid_projects` | Remove (X7) |
| `src/db/seed-data.ts:123–124` | `designs`, `grid_projects` seeds | Remove (X6) |
| `src/db/seed-data.ts:172–173` | `spec_records`, `spec_record_revisions` in the list kept by the go-live wipe | Leave or remove; harmless |
| `src/lib/dashboard-layout.ts:8, 44` | The `designs` Home widget key | Remove the key; a saved layout that names it must be tolerated |
| `src/db/doc-tables.ts:72, 75–76, 78–82, 93–95, 99–101` | Table registrations | Section D |

### B.4 References from "going separately" code (not itemised)

14 imports go from code that is being removed by other work items into the Design code (the
Portal, Inbox, Assist and the Project Management screens). 31 go the other way. They disappear
when both sides are deleted. If Design is deleted first, expect compile errors in: the consulting
rows of `/schedule`, the engagement cards of the Inbox and meetings linking, Ask AI's read tools,
and the portal's use of curtain pricing (which stays). Run the scan again at that point.

---

## C. Wiring to remove

### C.1 Navigation

`src/components/nav/nav-data.ts`, the "Design" group (lines 100–119): remove `designoverview`,
`engagements`, `designs`, `specs` and `gridsettings`. Three entries remain: Lineset Builder,
Assembly Builder and Motor Library. Project notes say Catalog already sits in the Estimating
group; consider moving these three there and dropping the Design group. Remove the matching
active-key rules (lines ~150–168) and the design-review badge in `src/lib/nav-counts.ts`
(lines 4, ~92, ~145, ~213).

### C.2 Settings

| Where | What | Action |
| --- | --- | --- |
| `settings-sections.ts:21, 61, 85–87`; `settings-client.tsx:18`; `settings/groups/consulting.tsx`; `settings/page.tsx:8–9` | Settings → Consulting (phase menu and weights, disciplines, assumptions library) | Remove the group. Keep the assumptions list if the Estimator still offers assumptions (fix M6) |
| `settings-sections.ts:52, 64` | "Grid Settings" shortcut under Data | Remove |
| `settings/venue-types-card.tsx:13` | Background column on venue types | Remove (X5) |
| Estimating Rules index | Conduit sizes link; wire-pull, Cable Package and labor groups | X1, X10 |
| Catalog index | Riser data link; Device types stays | D2 |

Stored settings keys that become unused are in section D.

### C.3 Home, Reports and Reviews

| Where | What | Action |
| --- | --- | --- |
| `_dashboard/widgets/home-cards.tsx:180–~200` | "My designs" widget | Remove; drop `designs` from `dashboard-layout.ts` |
| `_dashboard/widgets/home-cards.tsx:~250–265` | Designs in Team activity and Needs attention | Remove the design inputs |
| `home-actions.ts:15` | Promote a design from Home | Remove |
| `home-greeting.tsx:111`, `home-pipeline.tsx:212, 222` | Quick Design buttons | Remove |
| `_dashboard/widgets/installs.tsx:53–54`; `lib/dashboard/data.ts:11–12`; `metrics.ts:8`; `home-metrics.ts:4` | Engagements in the installs / billing forecast; designs feed | Remove the engagement and design inputs |
| `reviews/page.tsx:4–10, ~155`; `reviews/actions.ts:7, 12` | Design reviews and consulting phase reviews | Remove both row kinds; quote reviews stay |

### C.4 Import / Export and ⌘K

- `src/app/(app)/import/registry.ts:21–23, 30` and `import/page.tsx:11`: the catalog importer's
  spec columns (D1) and the consulting phase list used by the task-template importer (that
  importer is in the Project Management map).
- `src/lib/search/global-search.ts`: the designs branch.

### C.5 The build step — do this first

`package.json` → `"build": "node scripts/migrate.mjs && tsx scripts/seed-specs-once.ts && next build"`.
The middle command seeds the Spec Library on every production build. Deleting
`scripts/seed-specs-once.ts` or `src/lib/specs/seed-once.ts` without editing this line **breaks
the production build**. Change it to `node scripts/migrate.mjs && next build` in the same commit.

### C.6 `package.json` scripts and `scripts/`

| Script | Runs | Action |
| --- | --- | --- |
| `build` | see C.5 | Edit |
| `specs:seed`, `specs:renumber-bray`, `specs:import-library` | Spec Library tools | Remove |
| `symbols:davinci` | Attach DaVinci symbol drawings | Remove |
| `icons:grid` | Build the Grid icon set | Remove |
| `test:grid-options` | Grid options harness | Remove |
| `test:smoke:grid-sheet` | Sheet upload smoke test | Remove |
| `test:specs` | `scripts/test-review-and-spec.ts`, then `test:markup-settings` | **Trim, do not delete** (risk R1) |
| `test:review:regressions` | `scripts/test-review-regressions.ts` (about 70 Design imports) | Trim |

Other harness files that import Design code and need trimming, not deleting:
`scripts/test-oct15-batch4.ts` (about 20 imports; Grid, specs and catalog checks),
`scripts/test-markup.ts` (2; curtain pricing stays, the Equipment map check goes),
`scripts/test-settings-race.ts` (2; device types stay, the wire starter goes),
`scripts/test-curved-track.ts` (1; the title block, after fix M2), and
`scripts/smoke-routes.ts` (the routes on lines ~125–132 and ~142).

### C.7 npm packages

| Package | Used by removed code | Still used by kept code | Verdict |
| --- | --- | --- | --- |
| `pdf-lib` | `sheet-adjust-bytes.ts`, `sheet-split-bytes.ts` | `part-docs/datasheet-book-server.ts`, `quote-pdf/appendix-merge-server.ts`, `vendor-pdf/pages-server.ts` | Keep |
| `pdfjs-dist` | `components/design/pdf-canvas.tsx`, `sheet-aspect.ts` | `part-docs/thumbnail.ts`, `print/part-thumb`, `quote-pdf/render.ts` | Keep |
| `docx` | `specs/spec-docx.ts`, `bid-spec-docx.ts` | `letterhead-docx.ts` — but its only callers are those two files | **Unused if decision D5 drops the specification from packages**; otherwise keep |
| `exceljs` | `specs/record-io.ts`, `specs/product-spec-io.ts`, `riser-data-sheet-server.ts` | Estimator review sheet, photo sheet, import hub | Keep |
| `sharp` | `sheet-adjust-bytes.ts` | Catalog photos, rack raster, logos, icons | Keep |
| `puppeteer-core`, `@sparticuz/chromium` | Drawing-set PDF | Quote PDFs, cut sheets, rack sheets | Keep |
| `three`, `@types/three` | none (the 3D view is in Venue Assessments) | — | Not a Design dependency |
| `@tiptap/*`, `leaflet`, `qrcode`, `zod`, `@vercel/blob` | none or shared | yes | Keep |
| `jszip` (dev) | none | the main harness | Keep |

No DXF library is installed: the DXF writer is hand-written (`conduit-riser/dxf.ts`) and goes with
the folder. The public file `/pdf.worker.min.mjs` stays (quote PDF previews use it).

### C.8 Middleware and cron

`src/middleware.ts` has no Design-specific exemption. `/print/grid-set` rides the same signed
print-route rule as the other print routes; nothing to remove beyond the route itself.
`vercel.json` has no Design cron.

---

## D. Database tables and stored settings that become unused

Per the handoff decision, production tables and records are left in place. This is the list of
what nothing will read any more.

Document collections (registered in `src/db/doc-tables.ts`)

| Collection | Holds | After removal |
| --- | --- | --- |
| `designs` | Design records (`D-###`) | Unused |
| `grid_projects` | Grid designs (`GRD-####`) with devices, wires, spaces, options, revisions, risers | Unused |
| `grid_sheets` | Plan sheets (file data or a pointer to Blob) | Unused. Blob files under `grid-sheets/<design>/…` are orphaned |
| `grid_catalog` | Grid library entries (symbols, looks, Grid-made assemblies) | Unused |
| `consulting_engagements` | Engagements (`CE-####`) | Unused |
| `review_snapshots` | Frozen copies of what a phase approval approved | Unused |
| `generated_specs` | D94 saved specs | Unused |
| `spec_documents` | Spec builder documents (`SP-####`) | Unused, unless decision D5 keeps spec documents in packages |
| `spec_records`, `spec_record_revisions` | Spec Library records and their history | Unused |
| `spec_curtain_templates` | Curtain spec templates | Unused |
| `spec_sections`, `spec_articles`, `spec_templates` | Library sections, Part 2 articles, authoring templates | Unused **only if** decision D1 drops catalog spec text |
| `subassemblies` | Fixture, System, Hardware and Rack assemblies | **Still used** (Assembly Builder) |

Removing a table's registration from `doc-tables.ts` also removes it from the go-live wipe's list
(that list is the registry's keys). Leave the registrations in if the wipe should still be able to
clear them; otherwise remove them together with the store files.

Settings blobs and keys

| Key | Holds | After removal |
| --- | --- | --- |
| `grid_equipment_map` | Equipment map | Unused |
| `conduit_sizes` | Conduit size → part | Unused |
| `riser_box_types` | Riser box types | Unused |
| `spec_seed_applied` | Marker for the one-time spec seed | Unused |
| `gridFavorites:<user>`, `gridRecent:<user>` | Library favorites and recents | Unused |
| `gridDeviceTypes`, `gridTypeMap` | Device types and the category map | **Still used** (Catalog → Device types) |
| App settings: wire types, `gridCategoryShapes`, category icons, symbol colours, port rules, standard general notes, `designatorDigits` | Grid Settings | Unused, except wire types and port rules if the Catalog keeps port checks (section G) |
| App settings: `consultingPhases` (and phase weights), `consultingDisciplines` | Consulting settings | Unused |
| App settings: `consultingAssumptions` | Assumptions library | Still used if fix M6 keeps it for the Estimator |
| Estimating Rules values `wire.*`, `cable.lighting.*`, `labor.<system>.*`, `system.freightPct`, `system.contingencyPct`, legacy `system.installPct` | Wire pull, Cable Package, per-system labor, Quick Design freight and contingency | Decision D6 |
| Venue type `background` | Template id per venue type | Unused (X5) |
| Studio designs blob | Lineset and weights saves | **Still used** |

Fields on kept records that only the removed code reads

| Record | Field | Note |
| --- | --- | --- |
| Catalog part | `cableOdIn`, `tagDefaults`, `designatorCode`, `gridScope`, `ports` | Decision D2. Leave the stored values |
| Catalog part | `specArticleId`, `specSectionId`, `specTitle`, `specBody`, `specSameAs`, `specSort`, `specState`, `specSource` | Decision D1 |
| Part documents | Kinds `symbol` and `riser` | Unused after D2; the records stay |
| Device type | `icon`, `symbolDocId`, `code` | Only the Grid draws or numbers with them. Harmless to keep |
| Quote | `source: "grid"` with `spec.kind: "grid"`, `gridProjectId`, `gridOptionId`; `source: "sandbox"` with `spec.fromDesign`; `quoteType: "consulting"` with a `consulting` payload | Existing quotes keep these. Risk R3 and decision D4 |
| Quote line | `specKey` | Decision D3 |
| Quote | `packageFiles` generated from the Grid | Stored files stay and still download |
| Site (venue) | `venue_kind` → venue type → Background | The venue type stays; only Background is unused |

Migrations in `drizzle/` are history and are not edited. Migrations 0025 (spec library) and 0033
(spec records) created tables that become unused.

---

## E. Suggested deletion order

Each step should compile on its own (`tsc --noEmit`).

1. **Build step.** Edit the `build` script (C.5). Nothing else is safe before this.
2. **Moves (no behaviour change).** Apply M1 through M7. After this step no kept file needs a
   removed file for something it will keep.
3. **Decisions.** Settle D1 through D6 (section F). They decide whether `bid-spec*.ts`, three
   spec stores, the catalog's riser fields and three Estimating Rules groups stay.
4. **Estimator and packages.** Apply X2, X4 and the D3 and D5 outcomes: remove "Design in the
   Grid", "Generate from Grid", the Grid branches in client packages, cut sheets and the
   datasheet book. Delete `estimator/grid-design-actions.ts`.
5. **Catalog.** Apply X3, M5 and the D1 and D2 outcomes.
6. **Hubs and dashboards.** Apply X8, X9: Home, Reviews, Quotes hub, nav badges, ⌘K, dashboard
   data, venue history, `quote-spawn.ts`.
7. **Settings and rules.** Apply X1, X5, X10, X11 and section C.2. Remove nav entries (C.1).
8. **Shared sweeps.** Apply X6 (seeds) and X7 (catalog rename).
9. **Delete screens and routes** (A.1, "Screens and routes"), then components, then the store
   files, then `src/lib/specs/` and the removed part of `src/lib/design/`.
10. **Detach the kept `src/lib/design/` files.** Apply X12. Confirm `device-types.ts`,
    `grid-scopes.ts`, `goods.ts`, `lineset.ts`, `steel.ts`, `venue-dims.ts` and
    `curtain-pricing.ts` import nothing that was deleted (today the only such import is the
    `SysKey` type in `grid-scopes.ts`).
11. **Harness and scripts.** Trim `scripts/test-review-and-spec.ts` and the other harness files
    (C.6), delete the Design-only scripts, remove the `package.json` entries.
12. **Table registrations** (section D), if the team wants them gone.
13. Run `npm run build`, `npm run test:specs` and the smoke routes.

---

## F. Risks and decisions needed

Risks

| # | Risk | Detail |
| --- | --- | --- |
| R1 | The main harness | `scripts/test-review-and-spec.ts` is about 72,000 lines and has roughly 980 imports from the removed code, mixed with checks for kept features. It runs under `npm run test:specs`. It cannot be deleted and trimming it is the largest single task in this removal. It also contains source guards that walk Design files by path (for example the rule that no Grid client file imports cost-bearing modules); those guards fail when the files are gone |
| R2 | The production build | Section C.5 |
| R3 | Existing quotes from the Grid | Quotes with source "grid" keep flat `spec.lines` and SKUs prefixed `asm:`, `allow:`, `custom:` and `labor:`. Reports (manufacturer analytics, sourcing), review limits, packages and rack submittals special-case these prefixes. Fix M3 keeps them recognised. Opening such a quote in the Estimator must keep working with no Grid project behind it |
| R4 | Estimate-owned Grid designs | An estimate that used "Design in the Grid" has a Grid project linked to it and may have drawing-set PDFs stored in its package files. The files stay and download; "Open the design" and "Generate from Grid" go away. Tell users before the release |
| R5 | Curtain cut sheets for Grid quotes | Cut sheets read curtain sizes from the Grid project for quotes that came from the Grid. After X4 those quotes have no cut-sheet data. Estimator-built quotes are not affected |
| R6 | Quick Design promotes | Quotes with source "sandbox" carry `requote: true` and a `spec.fromDesign` id. The Estimator must not try to open the design |
| R7 | Shared curtain and lineset math lives under `src/lib/design/` | `curtain-pricing.ts`, `goods.ts`, `lineset.ts`, `steel.ts` and `venue-dims.ts` are imported by the Estimator, portal pricing, cut sheets and the kept builders. A blanket delete of `src/lib/design/` breaks all of them |
| R8 | The Equipment map's part picker | Five kept Estimating Rules screens import a component that lives inside the Grid Settings folder (fix M1). Deleting the folder first breaks Track series, Pipe types, Lineset types, Curtain mounts and System categories |
| R9 | The title block | Rack submittal sheets and curtain cut sheets print through the drawing set's title block (fix M2) |
| R10 | Consulting quotes | See decision D4. `quote-spawn.ts` creates an engagement when a consulting quote is sent or won; with the store gone that branch must be removed, not left to throw |
| R11 | Order against the other removals | The Project Management map deletes `consulting-schedule.ts` and the engagement activity files; the Inbox map deletes engagement linking. Whichever lands second must re-run the scan |
| R12 | Catalog renames | `catalog-rename/apply.ts` rewrites Grid and spec records when a SKU is renamed. Removing those steps (X7) is safe only because nothing reads the records afterwards |

Decisions

| # | Question | Options |
| --- | --- | --- |
| D1 | Does the Catalog keep spec text on parts? | The part editor's Spec panel, the catalog importer's spec columns and the external Displays API (`/api/v1/displays/**`, `src/lib/displays-api.ts`) read `src/lib/specs/articles.ts`, `sections.ts`, `outline.ts`, `templates.ts` and three spec stores (32 imports). **Keep**: move those four files and three stores to a kept folder (they import nothing else from Specs — verify) and keep the tables. **Drop**: remove the Spec panel, the importer columns and the spec fields of the Displays API, which changes that API's output |
| D2 | Do riser tag defaults, cable outside diameter, designator code, and symbol / riser drawings stay on catalog parts? | They are catalog fields that only the Grid reads (12 imports, plus the Riser data sheet). **Drop the UI** and leave stored values, or **keep** the fields editable for the spin-off program's data export by moving `conduit-riser/tags.ts`, `cable-od.ts` and `suggest-tags.ts` and the object-symbol tile to kept code |
| D3 | Does the Estimator keep the Spec select and spec keys? | Spec keys exist only to match Spec Library records (6 imports: `curtainSpecKey`, `allSpecRecords`, `systemMatchKeys`, `spec-key-select.tsx`). **Drop** the select and stop writing `specKey`, or **keep** it as free text for export to the spin-off |
| D4 | What happens to consulting quotes? | "+ New quote → Consulting quote" opens a builder that is being removed, and existing `CON-####` quotes open it too. **Remove** the type from + New quote and show existing consulting quotes read-only in the Quotes hub, or **keep** `design/engagements/quote/` and `letter/` as a small proposal builder without engagements |
| D5 | Does a client package still include a specification file? | The package's Specifications.docx and the rack submittal's Equipment Racks section are built by `bid-spec.ts` and `bid-spec-docx.ts` from spec text on catalog parts and `spec_sections` (15 imports). The estimate package also attaches spec-builder documents that were made from the quote. **Keep D94 in packages**: keep both files and the D1 "keep" option, and drop only the spec-builder attachment. **Drop**: remove the specification from packages and rack submittals; then the `docx` package is unused |
| D6 | Do the per-system labor %, wire-pull and Cable Package rules leave Estimating Rules? | Only Quick Design and the Grid read them. The Estimator has its own labor. Removing them changes the Estimating Rules screen. The Quick Design freight and contingency rows (`system.freightPct`, `system.contingencyPct`) have no other reader and go with them |

---

## G. Not verified

1. The scan resolves static imports and string-literal dynamic imports. It does not see a module
   path built at run time, a route string assembled from parts, or a server action passed as a
   prop. None was found by reading, but none was ruled out.
2. The "going separately" class was assigned by path prefix from the other removal maps. A file
   wrongly placed in it would be missing from section B.1.
3. `src/lib/annotations.ts` has no kept importer today (searched by import path). Re-check
   before deleting it if the Inbox or documents work lands first.
4. Wire types and port rules: whether the Catalog's part editor uses them without the Grid was
   not traced. `catalog-connect.ts` is kept on that assumption.
5. `src/lib/davinci/`, `scripts/davinci-*.ts` and `scripts/part-docs-davinci.ts`: these serve the
   catalog import and were assumed kept.
6. Decision D1: `articles.ts`, `sections.ts`, `outline.ts` and `templates.ts` import only each
   other, and the three stores import only those and the document store (checked by reading their
   import lines). What else the Spec panel's server actions need was not traced.
7. `system.freightPct` and `system.contingencyPct` are defined in `stores/pricing.ts` and read
   only by Quick Design (`design/quick/page.tsx`, `stores/design-pricing.ts`), by a text search.
   They become unused; whether to remove their Estimating Rules rows is part of decision D6.
8. `review_snapshots`: its store is imported only by `reviews/actions.ts` among kept files; it
   was assumed to serve consulting phase approvals only.
9. Line numbers inside `test-review-and-spec.ts` were not collected; the import counts for
   harness files are counts of matching lines, not of distinct checks.
10. Blob storage: the path prefix for Grid sheets was read from the upload code. Other Blob
    prefixes written by the removed code (engagement files in Drive or Blob, spec downloads) were
    not listed.
11. Nothing was compiled or run after these notes were written. The deletion order in section E
    is reasoned from the import graph, not tested.
