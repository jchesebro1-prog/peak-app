# Conduit riser phase 2 — riser data sheet, conduit fill, A/V riser (#328)

Date: 2026-10-10 · Requested by Jeff ("Can we move forward on the deferred items") · every choice below picked by
Jeff in session (pop-out questions), design approved as a whole.

Builds on #321 (spec `2026-10-09-grid-conduit-riser-design.md`, D763–D774) and its polish (plan
`docs/superpowers/plans/2026-10-10-conduit-riser-polish.md`). Build order: polish → **A** riser data sheet →
**B** conduit fill → **C** A/V riser; each reviewed and pushed on its own.

Also decided in the same session (handled by the polish plan, recorded here for completeness): page size stays a
manual per-design choice (11×17 internal, 24×36 external); the riser **fits the chosen page** (shrinks on 11×17,
grows on 24×36, capped at 1.5×); the conduit riser page is **fully read-only on a phone**.

---

## A. Riser data sheet + wire-type symbol fill

**Ask:** settings pre-fill help — Jeff picked an in-app sheet (repeatable, works on production with no credentials),
lighting-control parts only, **Bray's codes**, and a one-click wire-type fill.

### Catalog → Riser data (`/catalog/riser-data`, admin, `requirePerm("manage_users")`)
- **Export .xlsx**, tab **Devices**: one row per catalog part whose device type is `control-networking`,
  `dimming-power` or `racks-cases` (lighting scope). Columns: Manufacturer · Model · SKU · Description · Device type ·
  **Designator code · Box · Face · Mount · Height · P/D** (editable) · **Source** (`current` when the part already had
  a value for that row's editable cells, `suggested` when any cell was filled by a rule, `—` when neither).
  A blank part value is pre-filled from the suggestion rules; an existing value is never replaced in the export.
- Tab **Cables** (for B): one row per per-length cable part referenced by a wire type's `cableSku` or used by any Grid
  route/RiserLink. Columns: Manufacturer · Model · SKU · Description · **Outside diameter (in)** (editable) · Source ·
  **OD source** (the datasheet the suggestion came from).
- **Upload** → **Preview** (per part: field: old → new; rows with no change hidden by default; unknown SKU / renamed
  SKU (followed through `renamedTo`) / invalid value listed per row) → **Apply** (one `mergeUpsert` per changed part,
  touching only `designatorCode`, `tagDefaults`, `cableOdIn`; resumable batches like the Photo sheet if needed).
  Cell rules: **blank = leave unchanged**, **`-` = clear**, anything else is cleaned (`cleanTypeCode`,
  `cleanTagFields`, OD a positive number ≤ 3.0 in, 3 decimals). Invalid cells are refused per row, never guessed.
- **Suggestion rules** — a pure table (`src/lib/design/conduit-riser/suggest-tags.ts`) over model + description +
  category, first match wins, case-insensitive. **Evaluation order is most-specific device kind first:** EBDK, DEBC,
  DR, ER, TS, EP, OCC, LVJB, then the outlets CRON, CRO, CRN — so a "DMX emergency bypass controller" or a dimmer
  rack whose description mentions DMX is never coded as an outlet (corrected 2026-10-10 during A1; the table below
  lists the rules, not the order):

  | match | code | face | mount | height | P/D |
  |---|---|---|---|---|---|
  | DMX **and** network/ethernet/RJ45 outlet/port | CRON | O/N | SM | 18" | P/D |
  | DMX outlet / port / receptacle / connector panel | CRO | DMXO | SM | 18" | P/D |
  | network / ethernet / RJ45 / data outlet | CRN | NET | SM | 18" | P/D |
  | button station / keypad / control station / preset / scene station | EP | — | FM | 48" | — |
  | occupancy / vacancy sensor | OCC | — | CS | — | — |
  | touchscreen / touch panel | TS | — | FM | 48" | — |
  | emergency bypass detection / ELTS / BCM sense | EBDK | — | SM | — | — |
  | emergency bypass controller / DMX emergency bypass | DEBC | — | SM | — | — |
  | dimmer / relay / sensor rack or panel (incl. ETC Unison, DRd, ERn, Sensor) | DR | — | SM | — | — |
  | equipment rack / enclosure | ER | — | FM | — | — |
  | junction box / pull box | LVJB | — | SM | — | P/D |

  `—` leaves the cell blank. Box is never suggested (gang count isn't knowable from the catalog).
- **Grid Settings → Wire types:** a **Fill symbols from Bray's legend** button fills only empty Symbol/Signal on a
  wire type by its connection types: DMX → `D` "DMX"; network/ethernet/Cat5e/Cat6 → `N` "Network"; EchoConnect →
  `UE` "EchoConnect"; contact closure → `CC` "Contact closure"; panic → `P` "Panic". Client-side; the user Saves.

## B. Computed conduit fill

**Ask:** suggest + warn (Jeff keeps control of the size), researched cable diameters, EMT tables.

- `CatalogPart.cableOdIn?: number` (inches; `mergeUpsert` only), shown in the part editor for per-length parts
  ("Outside diameter (in)"), carried through `gridPartsFrom` → `PartLite`, and edited in bulk on the Riser data sheet's
  Cables tab.
- **Researched pre-fill:** a code table `CABLE_OD_SUGGESTIONS` keyed by normalized manufacturer + model (Belden 1583A,
  8471, and the #16/#14 stranded control cables the wire types use, plus any other cable parts the wire types name),
  each value with its datasheet citation. Values are researched from manufacturer datasheets during implementation;
  a cable with no verifiable datasheet value is left blank, never guessed. The Cables tab pre-fills from this table
  with `Source = suggested` and the citation in OD source.
- **Fill math** (pure, `src/lib/design/conduit-riser/fill.ts`): cable area = π·(OD/2)²; total = Σ over the run's
  member wires (each member counts once); allowed fill by count: 1 → 53 %, 2 → 31 %, ≥3 → 40 % (NEC Chapter 9
  Table 1); conduit internal area from NEC Chapter 9 Table 4 **EMT** (1/2" … 4"; values verified against the table
  during implementation and cited in the module). `fillPct(run) = total / area(typed size)`; suggested size = the
  smallest EMT trade size whose allowed area ≥ total. A run whose size isn't an EMT trade size shows the suggestion
  only. A run with any member lacking an OD → **fill unknown** (lists the cables missing a diameter); a run with no
  members (empty conduit / stub run) shows nothing.
- **Shown:** the Run panel (`Fill 28 % · suggests 3/4"` / amber `Overfilled — 3/4" allows 31 % for 2 cables`), a ⚠ on
  the run's size label in the editor only (never on the printed sheet or the DXF), and the riser page's warnings list
  ("ER-01 → CRO-04: 3/4\" is overfilled (47 %) — suggests 1\""). Never blocks a quote or a print.

## C. A/V conduit riser

**Ask:** one combined Audio/Visual riser like Bray's AV1.5; bubbles off by default with a switch; back-box devices +
racks shown by default; the plan prompt offers it; box types, line legend, rack contents and (when bubbles are on)
the wire legend.

- **Same engine and editor**, a second riser per design option. Engine: `ConduitRiserSystem = "lighting" | "av"`;
  system-aware defaults (`emptyConduitRiserDoc(system)`: A/V detail "Audio/Visual", A/V `alwaysShow` default, A/V
  `showSignals: false`); `ConduitRiserDoc.showSignals: boolean` (lighting defaults true, A/V false) — when false the
  layout draws no bubbles and the sheet prints no wire legend.
- **Storage:** `GridProject.avRiser?: Record<optionId, ConduitRiserDoc>` beside `conduitRiser` (lighting); every
  carry/prune/copy/restore/undo path iterates one list `CONDUIT_RISER_FIELDS = [{system:"lighting",
  field:"conduitRiser"}, {system:"av", field:"avRiser"}]` so a third system later is one row. Revisions gain
  `avRiser`. No migration.
- **System membership:** a device is A/V when `placementSystem` is `audio` or `video`; a wire when its
  `routeSystem` is `audio`/`video` (links: either end). Lighting stays `lighting`.
- **A/V always-show default:** `cable-connectors` (connector plates/boxes), `displays-projectors`,
  `switching-distribution`, `networking`, `racks-cases`, `assistive-listening` — editable per riser like lighting's.
- **Tables (A/V):** Conduit box types · Line legend · Equipment rack contents · Wire legend only when
  `showSignals`. No power types / power controls.
- **Page:** the existing `/design/grid/[id]/conduit-riser` with `?system=av` (default lighting); the header names the
  riser ("Lighting control riser" / "A/V conduit riser"); a Show signal bubbles switch in Defaults (both risers).
  Outputs menu gains **A/V conduit riser →**.
- **Drawing set:** A/V pages follow the lighting pages: E-502… lighting, then the next E-50x numbers A/V ("A/V
  conduit riser", continuations "(cont.)"), included when that riser has ≥ 1 run; exclusion key `av-riser`; DXF route
  takes `system=av`; file name `<project>-E-50n-av-conduit-riser.dxf`.
- **Plan prompt:** a wire between two A/V devices asks "Add … to the A/V conduit riser?"; lighting unchanged.
- **Pricing:** `riserBom` reads both risers (wire by others and conduit demand from each); estimate-owned ignores both.
- **Tag fields, levels, box types, conduit sizes, fill:** shared, unchanged.

## Out of scope
Separate audio and video risers; per-type conduit fill tables (EMT only); auto-sizing runs; a Peak code set
(Bray's codes only); pre-fill for non-lighting parts (A/V tag defaults are entered by hand or a later sheet tab).

## Testing
Pure modules (suggestion rules, fill math incl. the 53/31/40 % breaks and the EMT table, sheet parse/preview/apply
plans, A/V system defaults, `showSignals` off → no bubbles/no wire legend) in the spec harness; store checks on a
scratch DB (sheet Apply writes only the three fields and follows renames; A/V riser carried through option copy,
revision restore, delete-undo, pruning; quote reads both risers); four gates per task and `npm run build` at the end
of each piece; a browser check per piece on a scratch datadir.
