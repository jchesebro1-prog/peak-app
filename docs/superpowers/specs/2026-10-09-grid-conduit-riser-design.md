# Grid: conduit riser — Bray format, lighting control first (#321)

Date: 2026-10-09 · Requested by Jeff · Designed in session (brainstorm, every
section approved: "Yes, write the spec and be ready to implement").

## Ask

Jeff shared two Bray Architects sheets — **TL1.5 Lighting – Control Riser**
(Fall Creek HS, 100% CD) and **AV1.5 Audio/Visual – Conduit Riser** (Montevideo
HS, 50% CD) — and asked how to get "a conduit riser on the Grid that can be
similar to this". Follow-ups in session:

> "Unpriced but we do need to price the wire inside the conduit at times and
> sometimes the conduit so that should be an option, lighting control first,
> Bray's Format. Also this should link to the plan view with the same devices
> so that way if I connect two devices together in plan view it translates to
> the riser and connects those automatically with just a confirmation and
> layout editing."

> "I do want this to be able to be exported as a DWG or a CAD file … so we
> could incorporate this into the drawing set and use it as template for later"
> — clarified: *later in the process for that job*, not a cross-job riser
> template ("I would rather use the entire Grid design as a template").

## What Bray's sheet has (the target)

- **Device tag blocks**, one per device: gray header `CRO-04` (ID), then
  location `ELEC 4` + a P/D cell, then `BOX · FACE · MOUNT · HEIGHT`
  (`BOX DMXO CS 18"`). A power-type diamond under powered devices.
- **Conduit runs between devices**: home runs back to the head end (`ER-01`),
  daisy chains across (`EP-06 → EP-08 → EP-07…`), junction boxes (`LVJB`),
  off-diagram stubs ("TO JB1"). Each run labelled with its size (`3/4"`) and
  round **signal bubbles** (D, N, UE, P, CC). Solid = wire pulls through
  conduit; dashed = cable management by the rigging manufacturer.
- **Level lines** (floors / catwalk / pit) the tags sit on.
- **Numbered area details** on one sheet (AV1.5: 1.1 PAC, 1.2 PAC Lobby…, NTS).
- **Tables**: power types, wire legend, line legend, equipment rack contents,
  power controls; AV1.5 adds an A/V conduit box-type table.

The existing E-501 riser (#209, D112/D290–D292) is a space-level one-line:
nodes are spaces holding grouped device rows; conduit is a free-text
annotation. It stays as it is.

## Decisions (Jeff picked each in session)

1. **IDs: extend #320** with a per-part designator code (`CRO`) and two-digit
   numbering (`CRO-01`). One ID everywhere — plan, schedules, riser.
2. **Pricing: two design defaults + per-run override.** *Price wire in conduit*
   and *Price conduit*, both default **off**; each run: Default / Yes / No.
3. **Plan → riser: suggestions with confirmation.** A plan wire joining two
   devices becomes a suggested run; wires joining the same pair merge into one
   run carrying all their signals.
4. **Tag fields: per-part defaults + per-device overrides.**
5. **Levels: on spaces**, with a per-sheet default level; a tag can be dragged
   off its line.
6. **Conduit size: typed per run**, design default `3/4"`.
7. **Details from the start**: a detail is a named, numbered group of spaces.
8. **All six tables** in v1.
9. **Architecture A**: a new, separate conduit riser beside E-501 — derived
   tags, stored layout — not a mode of E-501 and not a workspace sheet.
10. **CAD export = DXF** (blocks with attributes, named layers). DWG is
    Autodesk's closed binary; writing it needs ODA/LibreDWG, neither of which
    runs on Vercel. DXF opens natively in AutoCAD, Vectorworks, Revit and
    BricsCAD; DWG is one Save As away.
11. **No riser templates.** The Grid design is the template.

## Dependency

Builds on **#320 Grid device designators** (`docs/superpowers/specs/2026-10-09-grid-designators-design.md`
on `feat/320-grid-designators`, in flight in another session). Implementation
starts from main **after #320 merges**; nothing here edits that branch.

## Architecture

```
plan placements + routes + RiserLinks          (source of truth, unchanged)
        │  derive / suggest (pure)
        ▼
ConduitRiserView ── layout (pure) ── drawing (pure) ──► Geometry[]
        ▲                                               │        │
ConduitRiserDoc (stored: positions, runs, details…)     svg.ts   dxf.ts
                                                        │        │
                                       editor + E-502 sheet      Download DXF
```

Pure, client-safe modules (the grid-bom rule — no DB imports) in
`src/lib/design/conduit-riser/`:

| module | job |
|---|---|
| `model.ts` | types, caps, `normalizeConduitRiserDoc`, `patchConduitRiser` (ops) |
| `tags.ts` | effective tag fields: part defaults ⊕ placement overrides |
| `suggest.ts` | group device-to-device wires/links into suggestions; dismiss rules |
| `derive.ts` | the view: which devices get a tag, runs with their wires + signals, details, stubs |
| `layout.ts` | deterministic auto-layout for unpinned items |
| `drawing.ts` | view + layout → `Geometry[]` in sheet inches (tags, runs, bubbles, levels, detail titles, tables) |
| `svg.ts` | `Geometry[]` → SVG (editor + print) |
| `dxf.ts` | `Geometry[]` → DXF R2000 ASCII text |
| `tables.ts` | the six tables' rows |
| `pricing.ts` | effective wire/conduit pricing per run; conduit BOM lines; refusals |

Server/store: `src/lib/stores/grid-conduit-riser.ts`; actions + page under
`src/app/(app)/design/grid/[id]/conduit-riser/`; a DXF GET route.

## Data

No migration — everything lives in the `grid_projects` JSONB document, catalog
part documents, and settings blobs.

### #320 extension (build step 1)

- `CatalogPart.designatorCode?: string` — 1–6 chars `[A-Z0-9]`, uppercased,
  written only through `mergeUpsert`. Edited in the part editor. Code
  resolution becomes: **part code → device-type code → category type code →
  system letter**.
- **Two-digit numbering**: a Grid setting `designatorDigits: 1 | 2`, default
  **2**. `nextFree`/`assignMissing`/`renumber` emit zero-padded numbers
  (`CRO-01`, `CRO-10`, `CRO-100`); `parseDesignator` already reads `01` as 1;
  a lot reads `LX-01–24`. Changing the setting never rewrites existing
  designators — **Renumber…** does.

### Tag fields (build step 2)

```ts
type TagFields = {
  box?: string;        // box-type code: "E", "FB", "AR" …  (≤ 4)
  face?: string;       // faceplate: "DMXO", "NET", "10B" … (≤ 8)
  mount?: string;      // "SM" | "FM" | "PM" | "CS" | "TS" | free (≤ 4)
  height?: string;     // "18\"", "48\"", "XX\"X" (≤ 8)
  pd?: "P" | "D" | "P/D" | "";
};
CatalogPart.tagDefaults?: TagFields;                 // mergeUpsert only
GridPlacement.tag?: TagFields & {
  location?: string;   // ≤ 24; default = containing space name
  power?: string;      // power-type letter, ≤ 2
  contents?: string;   // power-controls "Contents", ≤ 60
};
```

- `effectiveTag(placement, part, spaceName)` = part defaults, overridden
  per field by the placement's values; `location` falls back to the space name
  (uppercased on print). Empty string override = deliberately blank.
- Edited in the Property Editor (a **Riser tag** group) and as **columns in
  #320's Devices spreadsheet tab** (Box, Face, Mount, Height, P/D, Location,
  Power, Contents). Edits go through #320's batched `setDesignatorsAction`
  sibling `setTagFieldsAction` (one undo step, clears `auto`).
- Curtains carry no tag fields.

### Levels (build step 2)

```ts
GridProject.levels?: { id: string /*'lvl-'*/; label: string; elevation?: string; order: number }[];  // ≤ 30
GridSpace.levelId?: string;
GridSheet.defaultLevelId?: string;
```

A device's level = its space's level ?? its sheet's default ?? none (tags with
no level sit on an "Unlevelled" band at the bottom of the detail). Edited:
levels list on the conduit riser page; a Level select on a space (Spaces panel)
and on a sheet tab's ⋯ menu. Project-wide, not per option.

### Settings (build step 2)

- `WireType.symbol?: string` (1–3 chars, e.g. `N`, `D`, `UE`, `P`, `CC`) and
  `WireType.signal?: string` (e.g. "Network", "DMX", "EchoConnect"), edited in
  Settings → Wire types. A cable part's wire type is found by `cableSku`
  (exact sku/former-sku match), else the route's `connectionType` → the first
  wire type listing it.
- Blob `riser_box_types`: `{ code, description }[]`, admin-edited in Settings
  (full-replacement list, the wireTypes idiom). Seeded from AV1.5: AR "As
  required for specified conduit", A–J, K–T, FB "Floor box as specified".
- Blob `conduit_sizes` (Estimating Rules → **Conduit sizes**):
  `{ size: string /*'3/4"'*/; partId?: string }[]`, seeded with 1/2", 3/4", 1",
  1-1/4", 1-1/2", 2" and no parts.

### The conduit riser document (build step 3)

`GridProject.conduitRiser?: Record<optionId, ConduitRiserDoc>`:

```ts
type RunEnd = { kind: "placement"; placementId: string } | { kind: "stub"; stubId: string };
type ConduitRun = {
  id: string;                    // 'cr-' + 12 hex
  a: RunEnd; b: RunEnd;          // a = source side (head-end side when known)
  routeIds: string[];            // plan GridRoutes inside it
  linkIds: string[];             // RiserLinks (typed-length) inside it
  size: string;                  // '3/4"' — design default when created
  style: "conduit" | "cableMgmt";
  priceWire?: boolean;           // undefined = design default
  priceConduit?: boolean;
  lengthFt?: number;             // typed; overrides measured (0 < ft ≤ 5000)
  bend?: Point;                  // dragged elbow, sheet inches
  signals?: string[];            // wire-type ids — display only, for a stub run (no members)
};
type ConduitRiserDoc = {
  system: "lighting";            // v1; "audio" | "video" later
  details: { id: string; n: string /*'1' | '1.1'*/; name: string; spaceIds: string[] /*[] = all*/ }[];
  tags: Record<placementId, { x: number; y: number; detailId: string }>;  // pinned positions
  stubs: { id: string; label: string /*'TO JB1'*/; detailId: string; x?: number; y?: number }[];
  runs: ConduitRun[];
  dismissed: { key: string /*sorted "gp-a|gp-b"*/; ids: string[] /*route/link ids seen at dismissal*/ }[];
  levelY: Record<detailId, Record<levelId, number>>;  // dragged level-line positions, per detail
  alwaysShow: string[];          // device-type keys; default lighting set below
  powerTypes: { letter: string; type: string; config: string; input: string }[];
  notes: { id: string; n: number; text: string }[];
  defaults: { size: string; priceWire: boolean; priceConduit: boolean };
};
```

Caps (normalize on read, refuse on write): 20 details, 2,000 tags, 200 stubs,
1,000 runs, 2,000 dismissed, 20 power types, 100 notes; label/text lengths as
the existing riser doc. Ends are canonicalized server-side (never trusted as
the client shaped them).

Default `alwaysShow` for lighting: `control-networking`, `dimming-power`,
`racks-cases`. A new document starts with one detail `{ n: "1", name:
"Lighting control", spaceIds: [] }`.

Carried like the existing riser map: revisions snapshot/restore it, option
copy re-points placement ends at the copied placements, option removal drops
it, deleting a device drops runs that end on it and its tag position, deleting
a space drops it from details.

## Plan ↔ riser link (build step 3)

**Suggestions** (`suggest.ts`). Input: the option's routes with both
`fromPlacementId` and `toPlacementId`, and RiserLinks whose ends are both
placements, where at least one end is in the riser's system (`placementSystem`
→ `L` for lighting). Group by sorted pair key. For each pair:

- pair has a run → any route/link not yet in it is a **"joins run"**
  suggestion;
- pair key in `dismissed` and every current route/link of the pair is in that
  entry's `ids` → hidden; a wire not in `ids` (drawn after the dismissal)
  un-hides it. Pure — no hook in the route/link creation paths;
- otherwise → a **new run** suggestion.

Wires whose ends are not both snapped to devices, in the system's scope, are
listed as **"Not connected to two devices"** with *Show on plan*.

**Confirming.**

1. **In the plan**, when a wire is finished with both ends on devices and one
   end in a system that has a conduit riser (lighting in v1): a small prompt
   — "Add to lighting control riser? **Add** · Later". *Add* runs
   `acceptSuggestionsAction` for that pair. *Later* leaves it as a suggestion.
   The prompt never blocks drawing; it auto-hides after the next action.
2. **On the riser page**: "From the plan: N new" list — *Accept*, *Accept
   all*, *Dismiss* per item.

Accepting creates (or extends) the run — idempotent: accepting the same
route twice never duplicates. Direction: `a` is the end closer to the head end
(below), else the route's `from`.

**The plan stays the source of truth.**

- Deleting a plan wire removes its id from its run; a run with no wires left
  stays as an **empty conduit** (drawn, marked "empty" in the panel).
- Deleting a device removes runs ending on it.
- **Connect on the riser** (two tags, or a tag and a stub): *with wire* reuses
  D292's `connectKind` — a real plan route when both devices share a
  calibrated sheet/page, else a typed RiserLink — and puts it in a new run;
  *conduit only* makes an empty run. A run with a stub end has no member wires;
  it can carry a typed length and display-only `signals` (e.g. CC for "FA —
  wire pull by others"), which feed its bubbles and the wire legend.

**Which devices get a tag**: in at least one run, **or** device type in
`alwaysShow` and system match, **and** in the detail's spaces. A device in
several details' spaces appears in the first detail by number.

**Head end** per detail: the tagged device with the most runs; ties → device
type `racks-cases` first, then lowest designator.

## Pricing (build step 4)

Effective per run: `priceWire = run.priceWire ?? doc.defaults.priceWire`,
same for conduit.

- **Wire**: routes/links in a run with effective `priceWire = false` are
  excluded from `routeLines` (new optional `exclude: Set<routeId|linkId>`
  argument). The Grid BOM shows them in an **"In conduit — by others"** group
  with footage, never priced, never on the quote. Wires in no run price as
  today.
- **Conduit**: for a run with effective `priceConduit = true`, length =
  `lengthFt` ?? the longest measured member route ?? the longest member link's
  typed length. Footage is summed per conduit part (`conduit_sizes` maps size →
  part) and ceiling-rounded once, then lands in the Grid BOM and draft quote
  under a **Conduit** heading.
- **Refusals** (the #211 pattern, re-checked server-side on every promote
  path): a priced run whose size has no part — "Conduit 3/4" has no part — set
  it in Estimating Rules → Conduit sizes"; a priced run with no length —
  "ER-01 → CRO-04 needs a length".
- **Estimate-owned options** (#314, `option.estimateOwned`): the riser is
  drawing-only; both pricing switches and run overrides are hidden and ignored.
- Back boxes are labels only in v1 — never priced.

## Editor (build step 3)

- Grid toolbar riser button becomes a menu: **System riser** (E-501) ·
  **Lighting control riser**.
- `/design/grid/[id]/conduit-riser?option=&detail=` — option picker, detail
  tabs, suggestions list, canvas, side panel.
- **Auto-layout** (`layout.ts`, deterministic — same input, same picture):
  - level lines across in elevation/order, highest at top; tags sit on their
    level; an "Unlevelled" band last;
  - head end anchors a vertical trunk; home runs leave as parallel lines
    (fixed pitch) then turn orthogonally into each tag;
  - chains (a run whose `a` end is not the head end) line up side by side
    along their level;
  - collision pass on a 1/8" grid; size label at the bend, signal bubbles near
    the `a` end, power diamond under the tag.
- **Editing**: drag a tag (pins it), drag a level line, drag a run's bend;
  **Re-layout** (unpinned) and **Reset layout** (clears pins). Client undo/redo
  (the workspace's 100-deep stack pattern) over batched `patchConduitRiser`
  ops.
- **Side panel**: Tag (designator, tag fields, power type, contents, Show on
  plan — writes to the placement); Run (size, Conduit / Cable management,
  wire + conduit pricing Default / Yes / No, length, member wires with signal
  letters, Remove from riser); Detail (name, number, spaces); **+ Stub**;
  numbered notes; Power types (with **Start from Bray's A–E**); Levels list.
- Phone: view only.

## Drawing sheet + tables + DXF (build step 5)

**Geometry** (`drawing.ts`): `line | polyline (dashed?) | rect (fill?) | text
(size, anchor) | circle | diamond | block-insert { block, at, attrs }` in
sheet inches. Both writers consume only this list.

**Drawing set**: `buildSheetList` gains **E-502 Lighting control riser** after
E-501 when the option's lighting riser has at least one run; details that do
not fit flow onto E-503… (AV later takes the next number). Same title block,
same 11×17 / 24×36 sizes. Layout: details on the left, each titled with a
detail bubble (`1.1  PAC  NTS`); tables stacked down the right.

**Tag block (Bray)**: gray header = designator; row 2 = location + P/D cell;
row 3 = BOX · FACE · MOUNT · HT. Power diamond below. Solid line = conduit,
dashed = cable management. Signal bubbles = circles with the wire type symbol;
a cable with no symbol prints `?` and the editor warns by name.

**Tables** (each printed only when non-empty):

1. **Wire legend** — symbol · "(n) <cable model>" · signal, from cables in
   runs via their wire type.
2. **Line legend** — fixed: solid "Wire pulls through conduit"; dashed "Cable
   management provided by others".
3. **Box types** — the full `riser_box_types` list.
4. **Power types** — the option's list.
5. **Equipment rack contents** — one table per rack assembly placed in the
   system, titled with its designator: item · qty (from the rack's
   placements, grouped by part).
6. **Power controls** — ID · device name (model / description) · contents,
   for tagged devices of device type `dimming-power`.

**DXF** (`dxf.ts`): DXF R2000 (AC1015) ASCII, `$INSUNITS` = inches, 1:1 sheet
size, **no title block**. Layers `PK-RISER-TAG`, `PK-RISER-CONDUIT`,
`PK-RISER-CABLEMGMT` (DASHED linetype), `PK-RISER-SIGNAL`, `PK-RISER-LEVEL`,
`PK-RISER-TEXT`, `PK-RISER-TABLE`. Blocks with ATTDEFs: `PK_TAG` (ID, LOC, PD,
BOX, FACE, MOUNT, HT), `PK_SIGNAL` (SYM), `PK_POWER` (PWR), `PK_STUB` (LABEL);
inserts carry ATTRIBs. Text style `STANDARD` (Arial). Handles allocated
sequentially; every section balanced.

**Download DXF**: on the riser page and beside E-502 in the drawing set; one
file per sheet, `<project>-E-502-lighting-control-riser.dxf`; route
`GET /api/grid/[id]/conduit-riser/dxf?option=&sheet=`, `requireUser` + the
Grid view permission, `Content-Disposition: attachment`.

## Out of scope (v1)

AV/video conduit risers (same engine, later), computed conduit fill (typed
size only), pricing back boxes, wire-crossing hops, DWG binary output, riser
templates across jobs, plan-sheet DXF export (the geometry seam makes it
possible later), customer documents.

## Testing

- **Spec harness** (`scripts/test-review-and-spec.ts`), pure modules:
  effective code chain + two-digit numbering; `effectiveTag`; suggestion
  grouping, joins-run, dismiss/un-dismiss; derive (who gets a tag, head end,
  details, stubs); layout determinism (same input → identical geometry) and no
  overlapping tags on a fixture; pricing inheritance, exclusion from
  `routeLines`, conduit length rule, ceiling per part, refusals,
  estimate-owned ignore; the six tables; DXF structure (group-code pairs,
  balanced SECTION/ENDSEC and BLOCK/ENDBLK, every INSERT's block defined,
  ATTRIBs match ATTDEFs) via a small DXF reader in the harness; SVG ⇄ DXF
  draw the same element counts.
- **Local CAD check**: `scripts/dxf-audit.py` (ezdxf `audit()` + `readfile`,
  run with the `~/.venvs/venue-templates` venv) on the fixture's DXF — local
  only, not a gate.
- **Store tests** (scratch PGlite): accept twice = one run; deleting a wire →
  empty conduit; deleting a device prunes runs + tag; option copy re-points
  ends; revision restore carries the doc; tag-field edits round-trip; levels
  on spaces/sheets.
- **Four gates** — tsc, test:specs, test:smoke, eslint vs a baseline — with
  real numbers per build step.
- **Acceptance**: rebuild a slice of TL1.5 in a dev design (scratch datadir) —
  ER-01 home runs, the EP-06…EP-04 EchoConnect chain, two LVJBs with stubs,
  power diamonds, all six tables — and compare the printed E-502 beside Bray's
  sheet.
- **Jeff**: open the DXF in AutoCAD / Vectorworks; try the plan prompt on a
  real job.

## Build steps (one plan, each step shippable)

1. Bray IDs — per-part designator code, two-digit numbering (#320 follow-up).
2. Device data — tag defaults/overrides, levels, box types, wire-type
   symbols, Devices-spreadsheet columns.
3. Conduit riser — doc + store, suggestions, derive, layout, editor page,
   plan prompt, details, stubs, notes.
4. Pricing — defaults, per-run overrides, Conduit sizes, BOM group, refusals.
5. Sheet — geometry, SVG, E-502 + tables, DXF + route.

Decision numbers (D…) and the punch entry are assigned from origin/main at
merge time.
