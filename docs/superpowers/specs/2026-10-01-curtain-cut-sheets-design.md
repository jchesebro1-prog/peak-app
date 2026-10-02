# Curtain cut sheets (#292) — design

**Date:** 2026-10-01 · **Punch:** #292 · **Builds on:** #227 curtain pricing, #274/#291 track configurator, #222 quote
PDFs, #207/#283/#290 part documents, #209 drawing set, #40 client packages
**Approved by:** Jeff (2026-10-01, in session)

## Ask

Every curtain on a quote gets a cut sheet for the submittal package and the estimate bundle. Each sheet shows the
curtain's front elevation, how it mounts, all of its mounting hardware, and its materials. Everything is deterministic:
no AI, and no number that isn't already on the quote, in the catalog or in Estimating Rules.

## Decisions

These become DECISIONS.md entries **D539+**. The exact numbers are assigned at docs time; recompute them from
`origin/main` right before writing.

1. **One sheet per curtain type.**
   - A type is: same name (trimmed, case-insensitive) + fabric + fullness + top finish + bottom finish + mount.
   - Mount means the track series and mounting when a track is linked, else the picked mount type.
   - Size is **not** part of the type. A sheet lists the total qty and a size schedule with every finished W × H and
     its qty.
   - Sheets are numbered **CS-1, CS-2…** in first-appearance order: section order, then line order (Estimator), or
     placement order (Grid).
2. **The elevation is drawn from finished dimensions.** These are the numbers `curtainCost`
   (`src/lib/design/curtain-pricing.ts:125`) prices and `computeSetWeight` (`src/lib/design/steel.ts:557`) weighs.
   Sewn area and weight on the sheet come from those two functions, never a parallel formula.
3. **Two sources, one collector.** `collectCurtainTypes` reads either an Estimator quote (`spec.sections`) or a Grid
   quote (`spec.kind === "grid"`), through two adapters. A quote is read by exactly one adapter:
   - non-empty `spec.sections` → the Estimator adapter;
   - else `spec.kind === "grid"` → the Grid adapter.

   An Estimator save rewrites `spec` to `{ sections, mobs }` (`estimator/actions.ts:441`), so a quote is never both.
4. **Estimator curtain lines store structured inputs.**
   - The line keeps a `CurtainRequest` in `curtainInputs`: the portal's shape (`src/lib/portal-cart-types.ts:9`),
     extended with three optional fields — top finish, bottom finish and mount type.
   - Legacy lines (size only in `desc`) are read by a pure parser.
   - A line the parser can't read is **flagged, never guessed**: "Can't read size — edit the curtain."
5. **Curtain ↔ track link is a shared key, not a line id.** Both lines carry `curtainTrackKey` (the `laborMobKey`
   idiom, `estimator/types.ts`).
   - Line ids are renumbered by copy and reorder flows, and a key survives both.
   - **Fallback for existing quotes:** a curtain line with no key is linked to the line **immediately after it in the
     same section**, when that line is a track line (`it.track`) with no key of its own.
6. **Mount comes from the track, else it's picked.**
   - **Linked track:**
     - The track line's `track.mounting` picks the mount detail.
     - The hardware list is that line's stored `components` (`track-bom.ts:146`), summed by SKU across the type's
       linked tracks.
     - **Code deviation:** mounting lives on the line's `TrackConfig` (`src/lib/track-engine.ts:53`), not on
       `TrackSeries`. `track-series.ts:34` only declares the `TrackMounting` union.
   - **No track:** the curtain's picked `mountType` applies. Its hardware is an admin list per mount type in a
     settings blob, edited at Estimating Rules → **Curtain mounts**.
7. **A third mounting value must not break anything.** A mounting string maps to a mount type through
   `mountTypeForTrackMounting(m: string)`:

   | Mounting | Mount type |
   |---|---|
   | `"batten"` | `track-batten` |
   | `"ceiling"` | `track-ceiling` |
   | `"structure"` | `track-structure` |
   | anything else | `track-other`, a generic detail |

   The parameter is a plain `string` and the switch has a default branch. When another session adds `"structure"` to
   `TrackMounting`, nothing here needs to change to compile or render.
8. **The mount detail library is code.** It's one pure SVG geometry function per mount type. Starter types:

   | Id | Label |
   |---|---|
   | `track-batten` | Track — batten mount |
   | `track-ceiling` | Track — ceiling mount |
   | `track-structure` | Track — structure mount (drop kit) |
   | `tie-batten` | Tie-line to pipe batten |
   | `wall-hookloop` | Wall/header — hook-and-loop |

   These are **awaiting Jeff's confirmation** (see Open questions). `track-other` is a fallback only and is never
   offered in a picker.
9. **Two styles, one data source.** Both styles render from one `CutSheetModel`; only the layout differs.
   - **Submittal:** formal; Letter landscape; title block; elevation, mount detail, materials table and hardware
     table.
   - **Client:** lighter; Letter portrait; Peak header; elevation, a plain-language description, and part photos.
10. **Three outputs.**
    - **(a) Cut sheets page** off the quote, with a Submittal / Client switch, printed with the shared `PrintButton`.
    - **(b) Client package:** a `cutsheets/` folder in the zip with one Submittal PDF per type.
    - **(c) Customer estimate PDF:** Client pages appended behind a new Show-on-PDF toggle, off by default.
11. **Top-finish marks default to 12" o.c. maximum.**
    - **Grommets:** every mark is a grommet (and its tie or hook).
    - **Tracked curtain:** the marks are carriers, spaced at the line's `carrierSpacingIn` override, else the
      series' `carrierSpacingIn` (`track-series.ts:50`), else 12".
    - **Layout:** marks are spaced evenly, with both ends always marked. `count = ceil(W·12 ÷ s) + 1`, at spacing
      `W·12 ÷ (count − 1)`, which is ≤ s.
12. **Fabric facts come from the catalog.**
    - The weight basis (`oz`, `ozBasis`, `boltWidthIn`) already exists on `CatalogPart`
      (`src/lib/stores/catalog.ts:86`) but has no editor.
    - **Flame rating exists nowhere in the code.** Fabric parts gain an optional `flameRating` text field. It's
      edited together with the weight-basis fields in the part editor's fabric section, through
      `optionalPartFields` (`src/app/(app)/catalog/part-form.ts:39`).
    - A blank fact prints nothing. It is never filled with stand-in text.
13. **Optional lines are left out.** Optional-scope curtain lines (`option: true`) get no sheet. The staff page lists
    them, so leaving them out is visible. This matches `bomFromQuote` (`src/lib/specs/quote-bom.ts`).
14. **Permissions.**
    - **Viewing cut sheets:** `requireUser()`, the same gate as the Estimator page (`estimator/page.tsx:238`) and
      the Quotes hub.
    - **Curtain mounts screen and its actions:** `manage_users`, the same as Track series
      (`estimating-rules/track-series/page.tsx`, `actions.ts`).
    - **Editing curtains:** rides the existing Estimator save. No new permission.

## 1. Data model (no SQL migration)

### 1.1 Curtain vocabulary — new `src/lib/curtain-cut-sheets/vocab.ts` (pure, client-safe)

```ts
export type CurtainTopFinish = "grommets" | "pipe-pocket" | "hook-loop";
export type CurtainBottomFinish = "chain" | "pipe-pocket" | "hem";
export type CurtainMountTypeId = "track-batten" | "track-ceiling" | "track-structure" | "tie-batten" | "wall-hookloop";
export type CurtainMountKey = CurtainMountTypeId | "track-other";

export const TOP_FINISH_LABELS: Record<CurtainTopFinish, string>;     // "Webbing with grommets", "Pipe pocket", "Hook-and-loop"
export const BOTTOM_FINISH_LABELS: Record<CurtainBottomFinish, string>; // "Chain pocket (jack chain)", "Pipe pocket", "Plain hem"
export const CURTAIN_MOUNT_TYPES: ReadonlyArray<{ id: CurtainMountTypeId; label: string; track: boolean }>;
export const DEFAULT_MARK_SPACING_IN = 12;
export function mountTypeForTrackMounting(m: string): CurtainMountKey;
export function isMountTypeId(v: unknown): v is CurtainMountTypeId;
```

- **Bottom-finish values:** these keep the prototype's Chain / Pocket / None
  (`design_handoff_claude_code/app/Estimator.dc.html`, `bottomOptions`) under clearer names.
- **Defaults** for a curtain that stores none: top `grommets`, bottom `chain` (today's `freshCurtain` default,
  `estimator-client.tsx:235`).
  - **Mount, with a linked track:** comes from the track.
  - **Mount, otherwise:** `tie-batten`.
  - **Flag:** a defaulted mount is marked `assumed`, and the staff page says so (§5.1).

### 1.2 `CurtainRequest` — `src/lib/portal-cart-types.ts:9`

```ts
topFinish?: CurtainTopFinish;
bottomFinish?: CurtainBottomFinish;
mountType?: CurtainMountTypeId; // used only when no track is linked
```

- All three fields are optional, and the portal never sets them.
- `cleanCurtainRequest` (`src/lib/portal-cart-rules.ts:43`) builds a fresh object from the original seven keys, so
  they never enter a cart.
- `cartLinesFromSpec` (`src/lib/portal-pricing.ts:469`) runs only for portal-catalog quotes. A staff-added curtain on
  such a quote now carries `curtainInputs`, so Copy to new quote includes it. Before, it was dropped. That's intended,
  and the new fields fall away at the cart's clean step.

### 1.3 `SpecItem` — `src/app/(app)/estimator/types.ts`

```ts
/** #292: shared by a curtain line and the track line that hangs it (laborMobKey idiom). */
curtainTrackKey?: string;
```

- **Key format:** `"ct-" + <the curtain line's id when it was added>`. It's stable after that, whatever ids become.
- **No save whitelist:** the save path keeps every item field as-is.
- **Copies:** `copySectionForTarget` (`estimator/copy-system.ts:92`) copies items with `...it`, so the key travels
  with both lines.

### 1.4 `GridCurtain` — `src/lib/design/grid-bom.ts:121`

- Gains optional `topFinish`, `bottomFinish` and `mountType`.
- Set by the drop dialog (`src/app/(app)/design/grid/[id]/curtain-drop.tsx`).
- Validated in `placeCurtainAction` (`design/grid/[id]/actions.ts:506`) against the vocabulary. Bad or absent values
  are dropped, never refused.
- **Defaults by Grid type**, for curtains already placed and for blank fields:

  | Grid type | Top | Bottom | Mount |
  |---|---|---|---|
  | `Draw` | grommets | chain | `track-batten` |
  | `Border` | grommets | hem | `tie-batten` |
  | `Leg` | grommets | chain | `tie-batten` |
  | `Full` | grommets | chain | `tie-batten` |

  Full's chain bottom matches the Full Stage Drops template (`src/lib/stores/spec-curtain-templates.ts:77`).
- **Grid has no curtain edit flow** (none exists today). To change these fields, re-drop the curtain.
- **Grid has no tracks.** A Grid curtain never links to a track. A `track-*` mount type picked without a track uses
  the Curtain mounts list for that type (§1.6).

### 1.5 `CatalogPart` — `src/lib/stores/catalog.ts`

- New field: `flameRating?: string`, max 120 characters, Fabric parts only. It's written only through `mergeUpsert`,
  like `curtainAreaRate`.
- The part editor's fabric section (`src/app/(app)/catalog/fabric-rate-field.tsx`) gains:
  - **Weight (oz)**, written to `oz`;
  - **Weight basis**: lin yd / sq yd, written to `ozBasis`;
  - **Flame rating**: free text, e.g. "NFPA 701 (IFR)".
- `optionalPartFields` reads all three only when submitted. A blank clears the field, matching `boltWidthIn`.
- No import column ships in this punch (see Out of scope).

### 1.6 Curtain mounts blob — new `src/lib/curtain-mounts.ts` (pure) + `src/lib/stores/curtain-mounts.ts`

```ts
export const CURTAIN_MOUNTS_BLOB = "curtain_mount_hardware";
export type MountQtyRule =
  | { kind: "perCurtain"; qty: number }                  // qty per curtain
  | { kind: "perFtWidth"; qty: number; everyFt: number } // qty × ceil(W ÷ everyFt) per curtain
  | { kind: "perMark"; qty: number };                    // qty × top-finish marks per curtain (ties, hooks)
export type MountHardwareRow = { sku: string; rule: MountQtyRule };
export type CurtainMountHardware = { rows: MountHardwareRow[]; updatedBy?: string; updatedAt?: number };
export function sanitizeCurtainMounts(raw: unknown): Partial<Record<CurtainMountTypeId, CurtainMountHardware>>;
export function mountRowQty(rule: MountQtyRule, curtain: { widthFt: number; marks: number }): number;
```

- **Storage:** one top-level key per mount type id, written per key through `setBlob`'s jsonb merge. This is the
  `track_series` idiom (`src/lib/stores/track-series.ts`).
- **Starts empty, no seeding.**
- **Survives go-live:** `clearDemoData` never touches blobs.
- **Sanitize** drops:
  - unknown mount ids;
  - blank SKUs;
  - unknown rule kinds;
  - `qty` ≤ 0, non-finite, or above 1,000;
  - `everyFt` ≤ 0.

  It also caps each type at 30 rows.
- **Save** re-sanitizes. It refuses a SKU missing from the live catalog by name, using one `getMany`, like
  `saveTrackSeries`.

## 2. Pure modules — `src/lib/curtain-cut-sheets/`

All of these are client-safe: no DB and no server-only imports. The harness tests them directly.

### 2.1 `parse.ts` — reading curtains back

```ts
export type CurtainSize = { widthFt: number; heightFt: number };
export type ParsedEstimatorDesc = { name: string; fabricName: string; widthFt: number; heightFt: number; fullnessPct: number };
export function parseEstimatorCurtainDesc(desc: string, fabricNames: ReadonlySet<string>): ParsedEstimatorDesc | null;
export function parseGridCurtainDesc(desc: string): (ParsedEstimatorDesc & { gridType: GridCurtainType }) | null;
```

**`parseEstimatorCurtainDesc`** reads the exact string `addCurtain` writes (`estimator-client.tsx:2273`):
`<name> — <fabric>, <W>'W × <H>'H, <F>% fullness`.

- **Anchoring:** a regex anchored at the end, `, (\d+(\.\d+)?)'W × (\d+(\.\d+)?)'H, (\d+)% fullness$`.
- **Name/fabric split:** the head splits at the **last** ` — ` whose right side is a known fabric name (catalog
  `desc`, which is the Estimator's `FabricOpt.name`). With no such match, it splits at the first ` — `. That way a
  name containing an em dash still parses.
- **Format coverage:** the portal's priced and POR descs use the same format (`portal-pricing.ts:278`), but those
  lines carry `curtainInputs` and are read structurally first.

**`parseGridCurtainDesc`** reads `curtainDesc` (`grid-bom.ts:179`): `<name> (<type>) · <W>×<H> ft · <F>% fullness|flat · <fabric>`.

**Both parsers** return `null` for anything else, including a desc someone edited by hand.

### 2.2 `track-link.ts`

```ts
export function linkCurtainTracks(sections: readonly SpecSection[]): Map<number /* curtain line id */, SpecItem /* track line */>;
export function newCurtainTrackKey(curtainLineId: number): string; // "ct-<id>"
```

- **By key:** a track line matches a curtain line when both carry the same `curtainTrackKey`. The match works across
  sections, because a curtain can be moved without its track.
- **Fallback:** per decision 5, a key-less curtain at index *i* links to the item at *i + 1* of the same section when
  that item has `track` and no `curtainTrackKey`.
- **One track per curtain.** A track line links to at most one curtain. If two curtains name one key, the first wins
  and the second gets a staff warning.

### 2.3 `collect.ts` — one collector, two adapters

```ts
export type CutSheetCurtain = {
  ref: string;                 // "sec-3/line-41" or "placement-p9" — staff warnings only
  name: string; gridType?: GridCurtainType; color?: string;
  fabric: CutSheetFabric | null; // resolved catalog fabric (sku, name, oz/basis/bolt, flameRating)
  fabricText: string;          // what the line says, printed when `fabric` is null
  widthFt: number; heightFt: number; fullnessPct: number; qty: number;
  topFinish: CurtainTopFinish; bottomFinish: CurtainBottomFinish;
  mount: { key: CurtainMountKey; source: "track" | "picked" | "assumed";
           track?: { line: SpecItem; seriesName: string; seriesGone: boolean; operation: TrackOperation; carrierSpacingIn: number } };
};
export type CurtainType = {
  key: string; sheetNo: string; title: string;
  curtains: CutSheetCurtain[];                      // every member, in quote order
  sizes: Array<{ widthFt: number; heightFt: number; qty: number }>; // merged by size, largest area first
  totalQty: number; markSpacingIn: number;
  hardware: Array<{ sku: string; desc: string; qty: number; unit: string; from: "track" | "mount-rules" }>;
  sewnAreaSqftEach: number[]; sewnAreaSqftTotal: number; // curtainCost(...).sewnAreaSqft
  weightLbEach: Array<number | null>; weightLbTotal: number | null; // computeSetWeight(...).goods
  warnings: string[];
};
export type CollectInput = {
  quote: { spec?: unknown };
  fabrics: ReadonlyArray<Pick<CatalogPart, "sku" | "desc" | "oz" | "ozBasis" | "boltWidthIn" | "flameRating">>;
  trackSeries: readonly TrackSeries[];
  mounts: Partial<Record<CurtainMountTypeId, CurtainMountHardware>>;
  partInfo: ReadonlyMap<string, { desc: string; unit: string }>; // mount-rule SKUs
  grid: { project: GridProject | null } | null;                  // loaded only for a grid quote
};
export type CollectResult = {
  types: CurtainType[];
  unreadable: Array<{ ref: string; desc: string; reason: string }>;
  skippedOptional: Array<{ ref: string; desc: string }>;
  notes: string[];
};
export function collectCurtainTypes(input: CollectInput): CollectResult;
```

**Estimator adapter** (`estimatorCurtains`): for each `curtain: true` item that is not optional and not a Rewards
credit:

1. **Read the curtain.**
   - With `curtainInputs`: name, fabric (by `fabricSku`, else `fabricName`), width, height and fullness come from
     it, and the qty comes from **`it.qty`**. `curtainInputs.qty` is informational only, per its own comment.
   - Without: run `parseEstimatorCurtainDesc`.
   - Neither works: the line goes to `unreadable` with "Can't read size — edit the curtain".
2. **Check the size.** W or H ≤ 0 → `unreadable` with "Size is 0 — edit the curtain".
3. **Resolve the mount.** If `linkCurtainTracks` finds a track: `mount.key` comes from
   `mountTypeForTrackMounting(track.mounting)`, and `source` is `"track"`. Otherwise use `curtainInputs.mountType`
   (`"picked"`), else `tie-batten` (`"assumed"`).

**Grid adapter** (`gridCurtains`):

- **Project and option live:** reads the option's live placements with `curtain` set, through
  `optionSlice(project, spec.gridOptionId)` (`grid-options.ts:100`). The project is found by
  `getProject(spec.gridProjectId)` (`stores/grid-projects.ts:324`); the quote stores both ids
  (`grid-quote.ts:280`).
  - Each placement is one curtain (qty 1).
  - Fabric is read by `fabricSku`.
  - Finishes and mount come from §1.4, defaulted by Grid type and marked `assumed` when defaulted.
- **Project or option gone:** falls back to the quote's frozen `spec.lines` where `sku === "CURTAIN"`
  (`grid-quote.ts:283`), via `parseGridCurtainDesc`.
  - The staff page notes: "The Grid design behind this quote no longer exists — sheets read the quoted lines."
  - A line that doesn't parse goes to `unreadable`.

**Merging:**

- **Key:** `lower(trim(name)) | fabric sku-or-text | fullness | top | bottom | mountKey | trackSeriesId-or-""`.
- **Titles:** the curtain name. Names that collide across types get the fabric appended: "Legs (Encore Velour 22 oz)".
- **Sizes:** merge on exact W and H. They're listed largest area first.

**Hardware:**

- **Track mount:** the sum by SKU of every linked track line's `components`. Each component's `qty` already counts
  that line's `config.qty` tracks.
  - Several curtains sharing one track line count it once.
  - `seriesGone` (no series with `track.seriesId`) keeps the stored components. The warning reads: "Track series no
    longer exists — hardware as quoted."
- **Picked or assumed mount:** each curtain's `mountRowQty` result × that curtain's qty, summed by SKU. A mount type
  with no rows gets the warning "No hardware listed for <mount> — Estimating Rules → Curtain mounts".

**Mark spacing:** per decision 11. A type whose members disagree on spacing uses the smallest.

**Weight**, per curtain:

- Computed as `computeSetWeight({ name, fabResolved: fabricFromPart(fabric), w, h, full, qty: 1, chain, batten: 0, mode: "dead" }, DEFAULT_WEIGHTS).goods`.
- `chain` is `CHAIN_JACK` for a chain bottom, else `CHAIN_NONE` (`goods.ts:36`).
- This is fabric (with `DEFAULT_WEIGHTS.cut` = 6" cut allowance) + chain + the 0.5 lb/ft hardware allowance: the
  same figure the lineset tool uses. Track weight is not included.
- `fabricUnresolved` (the catalog row has no `oz`) → `null`. The sheet prints "—" and the staff page warns "Weight
  not set for <fabric> — Catalog".

**Sewn area:** `curtainCost({ finishedWidthFt, finishedHeightFt, fullnessPct, qty: 1 }, { fabricRate: 0, sewingPct: 0 }).sewnAreaSqft`.
Only the area is read; no rate is involved.

### 2.4 `geometry.ts` — the elevation (pure; returns shapes, not JSX)

```ts
export function ftIn(ft: number): string; // nearest 1/4": 21.5 → 21'-6"; 18 → 18'-0"; 0.75 → 0'-9"; 10.999 → 11'-0"; 6.0208 → 6'-0 1/4"
export const ARCH_SCALES: ReadonlyArray<{ label: string; inPerFt: number }>; // 1"=1'-0" … 1/16"=1'-0"
export function pickScale(sizes: CurtainSize[], box: { wIn: number; hIn: number }): { label: string; inPerFt: number };
export function topMarks(widthFt: number, maxSpacingIn: number): { count: number; spacingIn: number };
export function elevation(input: {
  sizes: CurtainSize[]; fullnessPct: number; top: CurtainTopFinish; bottom: CurtainBottomFinish;
  markSpacingIn: number; markLabel: "Grommets" | "Carriers"; box: { wIn: number; hIn: number };
}): { scale: string; shapes: Shape[] };
```

**What `elevation` draws**, at one common scale chosen by `pickScale` (the largest architectural scale where every
drawn panel fits the box), in inches on paper:

- **Panels:** up to **3** distinct sizes, side by side, largest first. With more than 3 sizes, only the largest is
  drawn, captioned "Typical — N sizes, see schedule".
- **Outline:** each panel's finished W × H rectangle.
- **Fullness:** thin vertical pleat lines at half the mark spacing, as a pattern. None for flat (0%).
- **Top band:** 3-1/2" deep at scale, minimum 0.06", depending on the top finish:
  - **grommets:** a circle at each mark (`topMarks`), with a dimension between the first two marks labelled
    `Grommets @ 12" o.c. max (N)` (or `Carriers @ …`);
  - **pipe pocket:** a band labelled "Pipe pocket", no marks;
  - **hook-and-loop:** a hatched band, no marks.
- **Bottom band:** depends on the bottom finish:
  - **chain:** a 4" band with a dashed chain line, labelled "Chain pocket";
  - **pipe pocket:** a 4" band, labelled "Pipe pocket";
  - **hem:** a single 4" hem line.
- **Dimensions** in ft-in with extension lines: overall width under each panel, overall height left of each panel,
  and the qty of that size under its width string ("Qty 4").
- **Scale note:** "Elevation <scale>". A zero size never reaches here (§2.3).

### 2.5 `mount-details.ts` — the detail library (pure)

```ts
export type MountDetail = { title: string; shapes: Shape[]; labels: Array<{ x: number; y: number; text: string; leaderTo?: [number, number] }>; note?: string };
export function mountDetail(key: CurtainMountKey): MountDetail; // fixed 240 × 300 viewBox, NTS
```

Every detail is a section through the top of the curtain, with leaders to plain-language labels. It never shows a
part number; the hardware table carries those.

| Key | What the section shows |
|---|---|
| `track-batten` | Pipe batten (circle, 1.9" OD, "by others"), batten clamp + pipe clamp, hanger down to the track channel, carrier, snap hook to a grommet in the webbing, fabric below |
| `track-ceiling` | Hatched ceiling line, ceiling hanger/clip with anchor ("anchor by others"), track channel, carrier, hook, webbing |
| `track-structure` | Steel beam (I-section), beam clamp, drop rod/cable ("length varies"), hanger, track channel, carrier, hook, webbing |
| `tie-batten` | Pipe batten, tie line through the grommet and around the pipe (bow knot), webbing, fabric |
| `wall-hookloop` | Wall, header board ("by others"), hook strip fastened to the header, loop strip sewn to the curtain face, fabric |
| `track-other` | Track channel, carrier, hook, webbing; note "Track mounting per manufacturer's instructions" |

### 2.6 `model.ts` — the sheet view model

```ts
export type CutSheetStyle = "submittal" | "client";
export function cutSheetModel(type: CurtainType, ctx: {
  style: CutSheetStyle; quote: { id: string; number: string; name: string; customer: string; venue: string; revisions?: QuoteRevision[] };
  company: TitleBlockInput["company"]; preparedBy: string; index: number; total: number; now: number;
}): CutSheetModel;
export function plainDescription(type: CurtainType): string;
export function quoteRevisionRows(revs: QuoteRevision[] | undefined): RevisionRow[];
export function cutSheetCssVars(): Record<string, string>;
```

**Title block (Submittal)** is the existing `TitleBlockData` (`grid-drawing-set.ts:209`), filled from the quote:

| Field | Value |
|---|---|
| project id | the estimate number |
| name | the quote name |
| customer | the quote's customer |
| venue | the location label |
| option | `null` |
| quote | the estimate number |
| sheet | `{ number: "CS-n", title: <type title>, index, total }` |
| scale | "Elev <scale> · Detail NTS" |
| drawn | `preparedBy` |
| checked | "" |
| revisions | `quoteRevisionRows(quote.revisions)` (see below) |

- `quoteRevisionRows` maps `QuoteRevision` (`stores/quotes.ts:366`) to the same `RevisionRow` shape `revisionRows`
  makes. The label is the revision note, else "Issued to customer" for `sent`, else "Pricing snapshot".
- With no revisions, the strip reads "— Preliminary", unchanged.

**Materials rows**, in this order:

- **Fabric:** the name, plus "25 oz/lin yd, 54" bolt" when known.
- **Flame rating:** only when set.
- **Color:** Grid only, when set.
- **Fullness:** e.g. "50% (1.5×)", or "Flat".
- **Finished size:** "See schedule" when there are several sizes.
- **Top finish** and **Bottom finish.**
- **Sewn area:** each and total, in sq ft, 1 dp.
- **Weight:** each and total, in lb, 0 dp, or "—".
- **Qty.**

**Hardware rows:** SKU, description, qty, unit.

**`plainDescription`** is one deterministic sentence built from the type, e.g.:

> "Two Main Drape panels, each 21'-6" wide × 18'-0" tall finished, sewn from Charisma Velour 25 oz with 50% fullness.
> The top has webbing with grommets every 12", hung from carriers on an ADC 280 Black track mounted to a pipe batten;
> the bottom has a chain pocket so the curtain hangs straight."

**`cutSheetCssVars`** gives the `.pk-drawing-sheet` variables for **Letter landscape**:

| Variable | Value |
|---|---|
| `--dw-w` | 11in |
| `--dw-h` | 8.5in |
| `--dw-k` | 0.85 |
| `--dw-m` | 0.3in |
| `--dw-strip` | 2.1in |
| `--dw-pad` | 0.15in |

`SheetSizeKey` (`b` | `d`) is **not** widened: the drawing set switches on it. The cut sheet sets its own variables
instead (see §4.1).

## 3. Server module — `src/lib/curtain-cut-sheets/load.ts` (server-only)

```ts
export async function loadCutSheets(quoteId: string, opts: { images: "url" | "data" }): Promise<
  | { ok: true; quote: Quote; result: CollectResult; models: Record<CutSheetStyle, CutSheetModel[]>; photos: Map<string, string> }
  | { ok: false; error: string }>;
```

1. Reads the quote (`stores/quotes` `get`).
2. Reads the fabrics with `fabricParts()` (`stores/catalog.ts:232`), the same list the Estimator page loads.
3. Reads `listTrackSeries()` and the mounts blob.
4. Reads the mount-rule SKUs' rows with one `getMany`.
5. For a grid quote only, reads `getProject`.
6. Reads settings (company, offices, `logoDark`) and the customer/location label.
7. Calls `collectCurtainTypes`, then `cutSheetModel` for both styles.

**Client-style photos:**

- **Which parts:** the type's fabric SKU, then its hardware SKUs, at most **6 per sheet**.
- **Which photo:** the first image per part from `visibleImagesForParts` (`stores/part-documents.ts:288`).
- **How it's served:**
  - `"url"`, on the staff page: `/api/part-documents/<id>` (a signed-in viewer);
  - `"data"`, on the print route: the blob is read and inlined as a `data:` URL, because headless Chrome has no
    session. Images are already ≤ 1600 px WebP since #283.
- A failed read drops that photo, never the page.

## 4. UI surfaces

### 4.1 Shared renderer — `src/components/cutsheets/cut-sheet-pages.tsx`

`<CutSheetPages models style photos />` is server-renderable, with no "use client". It renders SVG from the pure
shapes. The drawings need no client code, so `PrintButton` needs no `waitFor`.

**Submittal page:**

- **Frame:** a `<section className="pk-drawing-sheet">` with `cutSheetCssVars()`, using the existing frame / area
  classes and `<TitleBlock>` (`src/components/drawing/title-block.tsx:21`).
- **Not `DrawingSheet`:** that component (`drawing-sheet.tsx:11`) requires a `SheetSizeKey`. The cut sheet repeats
  its 15-line frame markup instead of widening the type.
- **Drawing area:**
  - top-left, about 60%: the elevation;
  - top-right, about 40%: the mount detail, titled "Mounting detail — <label>";
  - bottom-left: the materials table and size schedule;
  - bottom-right: the hardware table, omitted when there are no rows.
- **Print CSS:** `@page { size: 11in 8.5in; margin: 0 }`, with one sheet per page (the existing
  `.pk-drawing-sheet` print rules).

**Client page:**

- **Size:** Letter portrait, `break-before: page`.
- **Header:** Peak header (logo, company name, "Curtain cut sheet · <estimate #>"), then the type title.
- **Body:** the elevation full width, `plainDescription`, a small "How it hangs" mount detail, the size schedule,
  and a photo strip.
- **Hidden:** SKUs, costs and the hardware table.

### 4.2 Cut sheets page — `src/app/(app)/estimator/cut-sheets/page.tsx`

**Route:** `/estimator/cut-sheets?id=<quoteId>&style=submittal|client`. `requireUser()`. The default style is
submittal. Nav: Estimator.

**Toolbar** (`pk-no-print`):

- "← Back to estimate" (`quoteBuilderHref`);
- a Submittal / Client switch, as links;
- `PrintButton`;
- "N curtain types · M curtains".

**Staff panel** (`pk-no-print`), shown only when it has content:

- unreadable lines, each with "Edit the curtain →" (the Estimator link);
- optional lines left out;
- assumed mounts;
- missing weight, flame rating or mount hardware;
- a gone track series;
- the Grid fallback note.

**Body:** `<CutSheetPages>`.

**Empty states:**

- **No quote:** "Quote not found." with a 200 response. The smoke test hits this case.
- **Wrong quote type:** a quote whose `quoteType` isn't system/blank reads "Cut sheets are for system quotes."
- **No curtains:** "This quote has no curtains."

### 4.3 Entry points

- **Estimator toolbar:** a "Cut sheets" button beside "Customer preview →" (`estimator-client.tsx:2802`), shown when
  `loadedId` is set.
  - It opens the page in a new tab.
  - When `pdfDirty` is set, it runs `saveNow` first, the same rule `QuoteNextStep` follows, so the sheets show what
    was just edited.
- **Quotes hub:** the selected quote's action strip gains "Cut sheets →" beside "Build client package" and "Spec from
  this quote" (`quotes/page.tsx:918–961`), for system or untyped quotes.
  - **Code deviation:** the hub has no per-row menu. This action strip is the per-quote action surface.

### 4.4 Curtain modal — `estimator/curtain-modal.tsx`

- **New fields:**
  - **Top finish:** segmented — Grommets / Pipe pocket / Hook & loop.
  - **Bottom finish:** segmented — Chain pocket / Pipe pocket / Hem.
  - **Mount:** a select of `CURTAIN_MOUNT_TYPES`, shown only while Add track is off. While it's on, the modal shows
    "Mount: from the track (Batten / Ceiling / …)".
- **Unused fields:** `hang` and `bottom` on `CurtainDraft` (`types.ts:259`) stay in the type, but nothing reads them.
  `CurtainDraft` gains `topFinish`, `bottomFinish` and `mountType`.
- **Edit curtain (new):**
  - `CurtainModal` already has an `editing` prop ("Update curtain", line 95) that nothing passes.
  - A ✎ action on curtain lines in `section-card.tsx` (mirroring `onEditTrack`, line 170) calls a new
    `openCurtainEdit(secId, lineId)`. It seeds the draft from `curtainInputs`, else the parsed desc. If neither
    works, it seeds name only, with W/H blank, so the user fills them in.
  - **Update** replaces the line in place through a new pure `replaceCurtainLine` (in `track-bom.ts` beside
    `replaceTrackLine`, line 184). It keeps:
    - id, `lineOrder`, `comment`, `internalNote`, `option`, `curtainTrackKey`, `specKey`;
    - `por` and `portalConfirm`, which the existing save rules (`clearPricedPor`) still decide.

    It re-prices at today's rates.
  - **Add track while editing:** shown only when no track is linked. It appends a keyed track line after the curtain.
    A linked track is edited with its own ✎.
- **`addCurtain`** (`estimator-client.tsx:2249`) writes:
  - `curtainInputs`: `{ name, fabricSku, fabricName, qty, width, height, fullness, topFinish, bottomFinish, mountType }`;
  - `curtainTrackKey: newCurtainTrackKey(idN)` on both lines, when a track is added.

  The `desc` format is unchanged.

### 4.5 Grid drop dialog — `design/grid/[id]/curtain-drop.tsx`

The same three fields, pre-set from the Grid type defaults (§1.4) and changed when the type changes, unless the user
has touched them. `placeCurtainAction` stores them.

### 4.6 Estimating Rules → Curtain mounts — `src/app/(app)/estimating-rules/curtain-mounts/`

This follows `track-series/` exactly: `page.tsx`, `curtain-mounts-client.tsx` and `actions.ts`.

- **Gate:**
  - **Page:** `manage_users`; anyone else sees the same "Admin access required" card.
  - **Actions:** `requirePerm("manage_users")`.
- **Layout:** one card per mount type, with:
  - its detail thumbnail (`mountDetail(id)`);
  - hardware rows: part via the shared `PartPicker` (`design/grid/settings/equipment-map/part-picker.tsx`), a rule
    select, qty, and every-N-ft for `perFtWidth`;
  - "+ Add part", ×, and Save per card.
- **Page reads:** the blob plus one `getMany` for the live description and cost. A SKU that has left the catalog
  shows as missing.
- **Save action:** `saveCurtainMountAction(mountTypeId, rows)` → `saveCurtainMount` in the store, then
  `revalidatePath`.
- **Link:** `estimating-rules/page.tsx` gains a link card under Track series (line 157): "Curtain mounts — The
  hardware each curtain mount uses when a curtain has no track."

### 4.7 Catalog part editor

The fabric section gains Weight (oz), Weight basis and Flame rating (§1.5).

## 5. Print / PDF pipeline

### 5.1 Signed print route — `src/app/print/cutsheets/[quoteId]/page.tsx`

- **Token:** `PrintTokenKind` (`src/lib/quote-pdf/token.ts:16`) gains `"cutsheets"`. `PdfKind` stays unwidened, as
  its comment requires.
- **Query:** `?t=<token>&style=submittal|client&sheet=CS-n` (`sheet` is optional; absent means all).
- **Check before any read:** `verifyPrintToken(secret, t, "cutsheets", quoteId, now)`, else `notFound()`. The check
  is module-level, like `print/quote/[id]/page.tsx`.
- **Session:** none needed. `src/middleware.ts` already exempts `print/`.
- **Render:** `loadCutSheets(quoteId, { images: "data" })` → `<CutSheetPages>` with the style's print CSS. No staff
  panel, no toolbar.
- **Render path:** `renderPrintRouteToPdf` (`render.ts`) prints with `preferCSSPageSize: true` (line 158), so the
  landscape `@page` size is honored.

### 5.2 Client package — `src/lib/client-package-server.ts`

**New helper:** `addCutSheets(quoteId, files, gaps, budgetMs = 60_000)`.

1. Loads the types once.
2. Renders per sheet:
   `` `${origin}/print/cutsheets/${id}?style=submittal&sheet=CS-n&t=${signPrintToken(secret, "cutsheets", id, now)}` ``
   through `renderPrintRouteToPdf`.
3. Pushes `cutsheets/CS-n-<safeName(title)>.pdf`.

**Origin:**

- It's `QUOTE_PDF_ORIGIN` through `printOriginFor`, the same as the quote PDF.
- Both package actions must pass the request's host and protocol, read with `headers()` in the action. Today
  neither action needs an origin.

**Failure handling:**

- Chrome unavailable, a bad origin, or a render error adds a gap, and the package still builds.
- `PackageGapKind` (`client-package.ts:11`) gains `"missing-cutsheet"`. Its `sku` is the sheet number, its
  description the title and reason, and its qty the curtain count.
- After `budgetMs`, the remaining sheets become gaps ("Not rendered in time — print from Cut sheets"), so the build
  stays inside the pages' `maxDuration = 120`.
- Unreadable curtains are listed in `00-package-index.json` under `cutSheets.unreadable`.

**Callers:**

- **`createQuoteClientPackage`** (line 235): calls it for the quote.
- **`createClientPackage`** (line 177, Grid):
  - with a quote: calls it with the resolved option's `quoteId` (`grid-options.ts:28`);
  - without a quote: adds one gap "Add this design to Quotes to include cut sheets".

### 5.3 Customer estimate PDF

- **The option:** `QuotePdfOptions` (`pdf-options.ts:7`) gains `pdfCutSheets: boolean`.
  - `PDF_TOGGLE_KEYS` and `DEFAULT_PDF_OPTIONS` include it, default **false**, so every existing PDF is unchanged.
  - `normalizePdfOptions` reads it like the others.
- **The preview** (`preview-doc.tsx`): `PdfToggle` gains it as a "Cut sheets" chip.
  - The preview doesn't render the sheets, because it has no server photo data. It shows a stand-in card under the
    document: "+ N cut sheet pages (Client style) print after the estimate — View cut sheets →".
  - N is computed client-side by `collectCurtainTypes` over the live sections, so it's the same count.
  - The chip is disabled when there are no curtains.
- **The print route:** `print/quote/[id]/page.tsx` renders `<CutSheetPages style="client">` after `<QuoteDocument>`
  when `normalizePdfOptions(q.pdfOptions).pdfCutSheets` is on and there's at least one type.
  - The pages carry `break-before: page`.
  - They print under the existing `QUOTE_PRINT_CSS` Letter / 0.6in rule, which is why Client is portrait Letter.
- **Freshness:** `pdfOptions` and `spec` are already `QUOTE_CONTENT_FIELDS`, so toggling or editing a curtain
  reschedules the PDF.
  - Catalog changes (fabric oz, flame rating, photos), track-series edits and Curtain mounts edits do **not**
    reschedule it. They show on the next save, like catalog descriptions today.
- **Portal:** serves this same stored PDF, so the customer sees the pages too.

## 6. Edge cases

| Case | Behaviour |
|---|---|
| No curtains | The page says so. The package adds no `cutsheets/` folder. The PDF toggle is disabled with a hint, and if it's saved on anyway, nothing is appended |
| W or H is 0, or the desc can't be read | Listed as unreadable with "Edit the curtain →". No sheet, never a guessed size |
| Curtain is on an optional line | Not sheeted. Listed as left out |
| Linked track's series deleted | Mount from the line's `track.mounting`. Hardware from its stored `components`. Warning |
| Track mounting value unknown (e.g. a future `"structure"` before its detail ships) | `track-other` generic detail. No crash |
| Two curtains point at one track line | The first links. The second falls back to its picked mount, with a warning |
| Grid quote whose project or option is gone | Frozen `spec.lines` are parsed. Note shown |
| Grid quote opened and saved in the Estimator | The spec becomes sections. The Grid has no curtain lines there, so none appear |
| Fabric not in the catalog (deleted, or a renamed desc) | Prints the line's fabric text. Weight "—". Warning |
| Fabric with no `oz` | Weight "—". Warning |
| Mount type with no hardware rows | Detail printed, hardware table omitted. Warning |
| Several sizes in one type | Up to 3 panels drawn. All sizes in the schedule |
| Chrome unavailable (package or PDF) | Package: a gap per sheet with the reason. Quote PDF: the existing PDF-state failure path, unchanged |

## 7. Tests

### 7.1 `scripts/test-review-and-spec.ts`

A new `#292` block is appended at the end of the file, in the `#291` block's shape: aliased imports, a fixture
builder, then `ok(...)` lines.

**Pure checks:**

- **Parsers:**
  - the exact `addCurtain` desc round-trips, including decimals and a 0% fullness;
  - a name containing " — " splits at the fabric;
  - a hand-edited desc → `null`;
  - `curtainDesc` output round-trips through `parseGridCurtainDesc`, flat and %;
  - a non-matching Grid line → `null`.
- **Track link:**
  - a key match across sections;
  - the adjacency fallback, which needs the same section, the next index, `it.track`, and no key;
  - no fallback across sections, past a non-track line, or onto a keyed track;
  - the duplicate-key warning.
- **`mountTypeForTrackMounting`:** batten, ceiling and structure each map; `"rafter"` → `track-other`; every
  `CURTAIN_MOUNT_TYPES` id has a `mountDetail` with ≥ 1 label; `track-other` has its note.
- **Collector (Estimator):**
  - structured lines are read in preference to the desc;
  - `it.qty` wins over `curtainInputs.qty`;
  - identical curtains merge (qty sum, sizes merged);
  - different fullness, finish or mount split into separate types;
  - optional lines are skipped and listed;
  - zero size and unparseable lines are unreadable;
  - CS numbering is in quote order;
  - colliding titles get the fabric suffix.
- **Collector (Grid):**
  - placements → types with the type defaults, marked `assumed`;
  - stored finishes win over defaults;
  - a gone project → the `spec.lines` fallback;
  - a gone option → the same fallback.
- **Hardware:**
  - `perCurtain`, `perFtWidth` (ceil) and `perMark` arithmetic;
  - × curtain qty;
  - track components summed by SKU, with a shared track line counted once;
  - a gone series keeps the components and warns;
  - an empty rule list warns.
- **Geometry:**
  - `topMarks(20, 12)` → 21 marks at 12";
  - `topMarks(20.5, 12)` → 22 marks at ≤ 12";
  - `topMarks(0, 12)` → 0 marks;
  - a carrier-spacing override beats the series default;
  - `ftIn` cases from §2.4;
  - `pickScale` picks the largest fitting architectural scale, and the smallest scale for an oversize drop;
  - 3 vs 4 sizes (typical caption).
- **Weight and area:**
  - weight equals `computeSetWeight(...).goods` for the same inputs;
  - chain vs hem changes it by the `CHAIN_JACK` amount;
  - no `oz` → `null`;
  - sewn area equals `curtainCost(...).sewnAreaSqft`.
- **Sanitize:** `sanitizeCurtainMounts` drops unknown ids, blank SKUs, bad rules, `qty` ≤ 0 and `everyFt` ≤ 0, and
  caps rows at 30.
- **PDF options:** `pdfCutSheets` defaults to `false`, is in `PDF_TOGGLE_KEYS`, and `normalizePdfOptions` keeps a
  stored `true`.
- **Token:** a `"cutsheets"` token verifies for its quote id only, and a `"quote"` token doesn't verify as
  `"cutsheets"`.
- **Model:**
  - `plainDescription` produces a fixed sample string;
  - `quoteRevisionRows` letters A, B…, and `sent` reads "Issued to customer";
  - the Client model has no SKU or cost fields.

**DB checks** (scratch PGlite, which the harness already uses):

- `saveCurtainMount` round-trips and refuses a missing SKU by name.
- `loadCutSheets` on an inserted quote with two identical curtain lines and one keyed track returns one type, with
  the track's components.

**Source checks:**

- `addCurtain` writes `curtainInputs` and `curtainTrackKey`.
- `CurtainModal` receives `editing`.
- The print route calls `verifyPrintToken(..., "cutsheets", ...)` before `loadCutSheets`.
- `client-package-server.ts` writes `cutsheets/`.
- `estimating-rules/page.tsx` links `/estimating-rules/curtain-mounts`.
- The curtain-mounts actions use `requirePerm("manage_users")`.
- `src/lib/curtain-cut-sheets/` imports no Anthropic SDK and no `lib/ai`.
- `smoke-routes.ts` lists the new routes.

### 7.2 `scripts/smoke-routes.ts`

New entries:

- `ROUTES`: `"/estimating-rules/curtain-mounts"`.
- `DYNAMIC_ROUTES`:
  - `/estimator/cut-sheets?id=Q-2041`;
  - `/estimator/cut-sheets?id=Q-2041&style=client`;
  - `/estimator/cut-sheets?id=Q-0000` with `reject: "Application error"`. This case renders "Quote not found." with
    a 200.

The signed print route isn't smoked, because it 404s without a token by design. The harness's token checks cover it.

## 8. Rollout

- **No migration.** Every new field is optional JSONB, plus one new settings blob.
- **Ships inert:**
  - `pdfCutSheets` is off;
  - Curtain mounts is empty, so no-track sheets print without a hardware table until rows are set;
  - existing curtain lines are read by the parser, and their mount is assumed `tie-batten` unless a track follows
    them.
- **Jeff-gated after deploy:**
  1. Confirm the five mount types (Open questions).
  2. Fill Estimating Rules → Curtain mounts.
  3. Set Weight (oz) and Flame rating on the real fabric rows. Production's Rose Brand `RB-FAB-…` rows likely carry
     no `oz`, and until they do, weight prints "—".
  4. Open one real quote's cut sheets and compare each sheet against the quote.
- **`QUOTE_PDF_ORIGIN`** must already be set in production for package and PDF renders. It's the existing #222
  requirement; nothing new.
- **Instant rollback** past this punch is safe. Older code ignores the new fields and the blob.

## Out of scope

- A "Flame rating" / "Weight (oz)" import column.
- A Grid curtain edit dialog.
- Bi-parting pairs drawn as two lapped panels: a pair prints as one panel with "Qty 2".
- Track weight on the sheet.
- Rentals and portal-side cut sheets.
- A zip of the Client style.
- Per-curtain color on Estimator lines.

## Open questions for Jeff

1. **Mount types — awaiting confirmation.** Track — batten mount; Track — ceiling mount; Track — structure mount
   (drop kit); Tie-line to pipe batten; Wall/header — hook-and-loop. Add, rename or drop any?
2. **Assumed mount for old curtain lines.** Is `tie-batten` the right assumption when there's no track?
3. **Grid type defaults.** Are the table in §1.4 right? In particular, should Border be hem, and should Draw be
   track-batten?
4. **Mark spacing.** Is 12" o.c. max right for grommets on every fabric, or should it vary by fabric or type?
5. **Hem and pocket depths.** The sheet draws 3-1/2" webbing and 4" bottom hems and pockets. Are those Peak's shop
   standards?
