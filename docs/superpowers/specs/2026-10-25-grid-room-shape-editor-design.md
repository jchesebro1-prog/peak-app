# Grid room shape editor — design

Date: 2026-10-25 · Punch item #370 (renumber at merge if taken; #369 is the curved-track spec) · Builds on
#249/#255 (venue templates, movable rooms), D109 (Spaces), #299 (Grid workspace), #318 (replace-sheet path),
#320 (designators), #321 (riser DXF R12 writer).

## Goal

Jeff, Oct 25: start from the layout rules as they stand (template stretched to the intake's dimensions), then
let the person reshape the plan **during the Grid intake, before any equipment**: a point on every corner and a
point halfway along every wall; select a wall and either **curve it** or **add points**. The same mechanism adds
the rooms and positions a venue really has — center mix positions, electrical rooms, hallways, lobbies, booths,
music rooms, green rooms, dressing rooms. The result must export to CAD for team editing and submittals.

## Decisions taken with Jeff (brainstorm, Oct 25)

1. **Hand edits freeze the layout.** The first edit turns the plan into its own shape; the dimension fields
   lock; **Reset to template** discards the edits and returns to the numbers. (No re-stretching of edits.)
2. **Walls are redrawn from the rooms.** The edited room outlines are the plan; walls are redrawn 6" thick from
   them. Template detail linework (stairs, seats, doors, pit detail) is dropped once the layout is frozen.
3. **Curves: both kinds.** A wall curves as a **true arc** by default (typed radius); a toggle makes it a
   **free-form** (Bezier) curve.
4. **Add a room:** pick a type, it drops as a rectangle at that type's default size, snaps to the nearest wall,
   and is then shaped with the same points / midpoints / curves.
5. **Rooms vs. zones:** two kinds — **rooms** (walled) and **zones** (dashed outline, no walls; may sit inside
   the house or on the stage). Center mix, followspot and camera positions are zones.
6. **Auto fill uses a few known roles:** mix, booth, electrical (plus the template's stage / house / catwalk).
   Other rooms are Spaces only.
7. **Where:** a "Shape the room" step in the Grid intake, and **reopen later** from the base sheet's tab menu;
   saving redraws the base sheet and placed devices keep their real-world positions.
8. **Room list:** a **fixed list in code, with a free name** per room.
9. **Precision:** snap (6" grid, 1' with Shift, 90° / 45° off neighbouring walls) plus typed lengths (and
   radius on an arc) — **and a DXF export** for CAD.
10. **Approach A** (a room-shape document the plan is drawn from), built in **three slices** (§9).

## Non-goals

- CAD **import** / round trip (export only).
- The editor in **Quick Design** (Quick Design keeps its wall drag; a Quick design carries no shape into the Grid).
- Multiple floors / levels, ceiling heights, sections.
- Door and window symbols; per-room wall thickness (always 6").
- A room edge that touches partway along another wall (a T-junction) following that wall when it moves.
- An admin-editable room-type list.
- Pre-template base sheets (no `intake.baseSheetTemplate`): no shape editing.

## 1. Data model

A new optional field on the Grid intake — one shape per design, shared by every design option exactly like the
base sheet. No migration (the project is a JSONB doc).

```ts
// src/lib/design/room-shape/types.ts
export type ShapePt = { x: number; y: number }; // feet; origin = centreline at the plaster line / platform
                                                // front (the template's `origin`), x right, y DOWN the sheet
export type ShapeEdge =
  | { kind: "line" }
  | { kind: "arc"; bulge: number }              // DXF bulge = tan(sweep / 4); sign = which side it bows to
  | { kind: "curve"; c1: ShapePt; c2: ShapePt }; // cubic Bezier handles, feet

export type ShapeRoom = {
  id: string;            // "rm_" + 8 hex, stable for the room's life
  type: RoomTypeKey;     // §3
  name: string;          // ≤ 60 chars; defaults to the type label ("Dressing room 2")
  kind: "room" | "zone";
  pts: ShapePt[];        // ≥ 3, ≤ 64; closed (last → first is an edge)
  edges: ShapeEdge[];    // edges[i] runs pts[i] → pts[(i + 1) % n]; edges.length === pts.length
};

export type RoomShape = {
  v: 1;
  fromTemplate: string;  // the template id it was frozen from ("proscenium@1", …)
  rooms: ShapeRoom[];    // ≤ 40
  frozenAt: number;
  by: string;
};
```

`GridProject.intake.roomShape?: RoomShape`. Absent = today's behaviour, unchanged.

- **The outline is the room's inside face.** Walls are drawn 6" **outward** from it, so a typed length is the
  inside dimension (what gets measured on site). Where two room outlines are within 6" of each other along an
  edge, one shared wall fills the gap (drawn once).
- **Arc:** radius and sweep are derived from the chord and `bulge`, never stored. Constraint: |sweep| < 360°.
- **Freeze** (`freezeFromTemplate(a, tplId, movables)`, pure): the stretched template's `regions` become rooms —
  one per region in the keys' `spaces` order, named by `numberedRegionLabels`, typed from the region's role
  (`roles.stage` → `stage`, `roles.house` → `house`, `roles.booth` → `booth`, `roles.catwalk` → `catwalk`, the
  proscenium Pit → `pit` only when the pit is on, everything else → the matching §3 type by label, else `other`
  with the label kept as its name). Region arc runs that the template draws as true circles (`trueArcs`) become
  `arc` edges; other sampled runs become `line` edges after collinear points are merged. Movable rooms are frozen
  where they are placed. Inches → feet, y flipped to sheet-down.
- **While frozen:** the intake's dimension fields and `MovableFields` are read-only, with the line
  "Shape edited — dimensions come from the shape" and a **Reset to template** button (confirm; deletes
  `roomShape`). `autoConfig` keeps its values (still used by the equipment equations).
- **Coincident points are glued:** in the editor, dragging a point moves every other room's point within 0.5"
  of it; Alt-drag moves only the one. Nothing is stored for the glue — it is positional.

### Server sanitize (`sanitizeRoomShape`, pure)

Run on every save path that writes `roomShape`. Never trusted from the client:

- `v === 1`, `fromTemplate` a known template id; `by` / `frozenAt` stamped by the server.
- Numbers finite, |coord| ≤ 2,000 ft; bulge finite, |bulge| ≤ 10; curve handles within 2,000 ft.
- Caps: 40 rooms, 3–64 points per room; `edges.length === pts.length`.
- `type` in the fixed list; `kind` taken from the type (a client can't make a Stage a zone); `name` trimmed to 60.
- No outline that crosses itself (edges sampled, segment-intersection test); an arc whose radius would be smaller
  than half its chord is impossible by construction from bulge, so only the sweep cap applies.
- At most one room per role (§3); a second one's role is dropped.
- Exactly one `stage` and one `house` room are required — otherwise the save is refused with
  "Every plan needs a Stage and a House."
- A bad room is **dropped** with a note in the response (`dropped: [{ name, reason }]`); the rest saves. A shape
  left with no Stage / House is refused as above.

## 2. The editor

`src/components/room-shape/` (client) over pure rules in `src/lib/design/room-shape/` (`geometry.ts` — arc /
Bezier math, sampling, offset, intersection; `edit.ts` — every edit as a pure `(shape, op) → shape | refusal`;
`snap.ts`; `freeze.ts`; `sanitize.ts`; `svg.ts`; `spaces.ts`; `frame.ts`; `dxf.ts`).

A "Shape the room" panel in the Grid intake after the dimensions — a live SVG plan of the stretched template
until the first edit, then of the shape.

- **Corner handles** (filled squares): drag moves the point. Snap: 6" grid (Shift = 1'), and 90° / 45° relative
  to each neighbouring wall; a snapped guide line shows while dragging.
- **Midpoint handles** (hollow circles, at the middle of every edge — the arc's / curve's own midpoint when
  curved): click selects that wall. Wall toolbar:
  - **Add point** — splits the edge at its midpoint (an arc splits into two arcs on the same circle; a curve by
    de Casteljau).
  - **Curve** — makes it an arc; dragging the midpoint sets the bow. Boxes: **Radius** and **Arc length**, both
    typeable (radius ≥ half the chord; typing arc length solves the sweep).
  - **Free-form** — makes it a Bezier; two handles appear (initialised on the arc / straight line).
  - **Straighten** — back to a line.
  - **Length** box (straight walls): typing moves the wall's far point along the wall's direction ("far" = the
    point after it in outline order; Alt-Enter moves the near point instead).
- **Corner selected:** **Delete point** (refused below 3 points); the two adjoining edges become one line.
- **Room selected** (click inside): name field, type select, **Delete room** (Stage and House can't be
  deleted), and the room's area in sq ft.
- **+ Add room** (§3).
- **Undo / Redo** (in-editor, 100 deep); **Reset to template**.
- Pointer events throughout — mouse, touch and Apple Pencil (the #344 ink-pad idiom). Pinch / wheel zoom, drag
  on empty canvas pans.
- **Refusals:** an edit that would make an outline cross itself (or another rule in §1) is not applied; the
  point snaps back and a one-line note shows ("That would make the House cross itself").

The editor holds the shape in client state; the intake's existing **Create** saves it with the rest of the
intake (`saveGridIntakeAction` → `sanitizeRoomShape`).

## 3. Rooms and zones

Fixed list (`ROOM_TYPES` in `room-shape/types.ts`):

| key | label | kind | default (w × d) | role |
|---|---|---|---|---|
| `stage` | Stage | room | — (template) | stage |
| `house` | House | room | — (template) | house |
| `pit` | Pit | room | — (template) | — |
| `catwalk` | Catwalk | room | — (template) | catwalk |
| `mix` | Center mix position | zone | 8' × 6' | mix |
| `followspot` | Followspot position | zone | 6' × 4' | — |
| `camera` | Camera position | zone | 6' × 6' | — |
| `booth` | Booth | room | 12' × 10' | booth |
| `electrical` | Electrical room | room | 10' × 12' | electrical |
| `hallway` | Hallway | room | 6' × 30' | — |
| `lobby` | Lobby | room | 30' × 20' | — |
| `music` | Music room | room | 30' × 25' | — |
| `choir` | Choir room | room | 30' × 25' | — |
| `green` | Green room | room | 15' × 20' | — |
| `dressing` | Dressing room | room | 12' × 15' | — |
| `storage` | Storage | room | 10' × 10' | — |
| `office` | Office | room | 10' × 10' | — |
| `other` | Other | room | 10' × 10' | — |

Template-only labels the freeze meets (Platform, Nave, Chancel, Sacristy, Floor…) map to `stage` / `house` by
role, or to `other` with the template's label as the room's name.

- **Drop:** + Add room → pick a type → tap / click the plan; the default rectangle is centred there. A **room**
  whose edge comes within 2' of another room's outer wall face snaps flush to it (its outline 6" off the
  neighbour's, so they share one wall) and squares to that wall. A **zone** never snaps to walls.
- **Name:** the type label, numbered when repeated ("Dressing room 2"); freely editable.
- **Roles:** at most one room per role. Adding a second Booth / Electrical room / Center mix position adds it
  with no role and a note ("Auto fill uses the first Booth").

## 4. What a frozen shape drives

When `roomShape` is present it replaces the template everywhere the template is read for this design:

- **Base sheet** — `roomShapeSvg(shape, devicesBounds?)` (pure): rooms as 6" filled walls (inside face + outer
  offset; arcs offset exactly by ±6", Bezier offset by sampling), zones as dashed outlines, each room's name at
  its pole of inaccessibility (simple: the sampled polygon's centroid nudged inside), and a dimension string on
  each outer wall (length; radius on an arc). Saved as today's `image/svg+xml` sheet. The sheet's frame
  (`{ minX, minY, wFt, hFt }` in feet, with a fixed margin) is stamped as `intake.baseSheetFrame` so every
  feet ↔ sheet conversion later is exact.
- **Calibration** — derived from the frame (feet per normalized unit); never prompted.
- **Spaces** — one per room and one per zone, named as on the plan, points sampled from the outline (one point
  per 6" of curve, ≤ 64 per curved edge), normalized to the sheet. Each carries `fromRoom: <room id>` (new optional
  field on `GridSpace`). Smallest-wins already makes a device in the Center mix zone count there, not in the House.
- **Auto fill** — `venueFrame` gains a shape branch ahead of the template branch: `stage` / `audience` / `booth`
  / `catwalk` = the bounding boxes of the rooms with those roles; `stageEdge` = the Stage room's edge nearest the
  House, sampled (curves included). New roles:
  - **mix:** `audio:mixerDsp` lands in the Center mix zone instead of the Booth. Video processor and projector
    stay in the Booth.
  - **electrical:** `controls:processor` (Power Controls – Production) and `controls:batteryBackup` (Emergency) —
    rows Auto fill places nowhere today — land in the Electrical room. No Electrical room → still unplaced.
  - `fillGeometry` reads the stamped shape (the one the sheet was drawn from — `intake.baseSheetShape`, a copy
    stamped at sheet generation), never the live intake shape, mirroring `baseSheetMovables`.
- **Starter Spaces** — `starterSpaces` returns the shape's Spaces when the shape is present.
- **Not touched:** Quick Design, the riser, the conduit risers, drawing-set title blocks. Drawing-set plan sheets
  print the new base sheet like any sheet.

## 5. Reopen after Create

The base sheet's tab menu gains **⋯ → Edit room shape…** and **⋯ → Download DXF** (shape or not — §6). Offered
only on the design's base sheet (`intake.baseSheetId`) when it carries a template stamp or a shape.

- Opens the §2 editor full-window on `intake.roomShape`; a base sheet with no shape yet is frozen first from its
  **stamp** (`baseSheetTemplate` + `baseSheetMovables` + `autoConfig`), so the editor shows exactly what's drawn.
  The old sheet's feet ↔ sheet mapping comes from the same stamped stretch (`G.W`, `G.H`, the template's
  inches-per-pixel and origin), so placements can be read in feet.
- **Save** (`editRoomShapeAction`, one `patchDoc`, all or nothing):
  1. Auto-cut a revision "Auto-saved before editing the room shape".
  2. Render the new sheet (bounds = shape ∪ every placement / route point on the old sheet, + margin — nothing
     ever lands off the sheet) and add it as a new `grid_sheets` doc (sheet docs are immutable).
  3. Swap it in through the #318 replace path (`remapSheetRefs`), then **re-project every normalized point on
     that sheet through feet**: placements, route polylines, hand-drawn Spaces, curtains and anything else
     `remapSheetRefs` already visits (the plan lists them). Old sheet → feet (old frame) → new sheet (new frame).
  4. Shape Spaces (`fromRoom`) are rebuilt from their rooms, **keeping their space ids** so device pins hold; a
     deleted room's Space is removed with its pins cleared exactly as `removeSpace` does. Starter Spaces from a
     pre-shape sheet are matched to rooms by name at freeze time and tagged.
  5. Replace the calibration, stamp `baseSheetShape` + `baseSheetFrame`.
- Auto fill refills from the new shape when the person runs it (unchanged trigger).
- **Plan-time check:** how a revision restore behaves across a replaced sheet (revisions hold placements with
  sheet ids; confirm `remapSheetRefs` rewrites revision refs or that restore re-projects) — the plan settles this
  before any code; if restore can't be made exact, restoring a pre-edit revision is refused with a note.

## 6. DXF export

`GET /api/grid/[id]/room-shape/dxf` (design access as the Grid page; `?option=` not needed — the shape is
per design). DXF **R12**, `$INSUNITS = 1` (inches), y **up** (CAD convention; flip from sheet-down), origin =
the shape's origin.

| Layer | Content |
|---|---|
| `PK-WALL` | each room's inside face and its 6" outer face as closed `POLYLINE`s; arcs as vertex bulges (group 42); Bezier edges as polylines sampled at ≤ 3" chords |
| `PK-ZONE` | zone outlines, `DASHED` linetype |
| `PK-ROOM-NAME` | `TEXT` at each room's label point |
| `PK-DIM` | wall lengths / radii as `LINE` + `TEXT` (not `DIMENSION` entities — R12 portability) |
| `PK-DEVICE` | each placement on the base sheet: `CIRCLE` (6" radius) + `TEXT` designator (`MIC-01`) |

A design with no shape exports the frozen-from-stamp shape (computed, not stored) so every templated base sheet
can export. The R12 header / layer / linetype / entity helpers move out of `conduit-riser/dxf.ts` into
`src/lib/dxf/r12.ts`; the riser's DXF stays **byte-identical** (asserted).

## 7. Errors

- Every write path re-sanitizes (§1); refusals return a named reason, dropped rooms are listed.
- Reopen-save is one `patchDoc`; a render or sheet-add failure leaves the design untouched.
- Estimate-owned design options (#314): the shape edits geometry only — no grid → quote write — so allowed.
- The DXF route 404s on a design with no base sheet template and no shape.

## 8. Testing

`scripts/test-room-shape.ts` (in `test:specs`):

- Freeze from all seven templates (proscenium, church traditional / contemporary, gym stage, blackbox,
  conference, arena): room count, names and roles match today's `starterSpaces`; arcs from `trueArcs` come out as
  `arc` edges.
- Geometry: bulge ↔ radius / sweep / arc length; typed length moves the right point; typed radius; split arc /
  split Bezier preserves the curve; offset of an arc is exact.
- Edits: self-crossing refused; snap to grid / 45° / 90°; glued points move together, Alt separates; delete
  below 3 refused; Stage / House undeletable.
- Sanitize: caps, bad numbers, unknown types, kind forced by type, duplicate roles, missing Stage / House.
- Output: SVG wall / zone / label counts; Spaces sampling and `fromRoom`; calibration from the frame;
  `venueFrame` shape branch (mix + electrical rows land in their rooms).
- Reopen: feet round trip (old → feet → new) within 0.01"; bounds grow to cover devices; shape Space ids kept,
  deleted-room pins cleared.
- DXF: entity counts per layer, bulge values, y flip; riser DXF byte-identical before / after the extraction.

Plus a smoke route for a design with a `roomShape`.

## 9. Slices

1. **Shape editor in the intake** — §1 data + sanitize, §2 editor, freeze / Reset, §4 base sheet, Spaces,
   calibration (template roles only).
2. **Rooms and zones** — §3 list, drop + snap, rename, roles; §4 mix and electrical Auto fill rules.
3. **Reopen + DXF** — §5 and §6, including the `r12.ts` extraction.

No migration in any slice.

## Open items for Jeff

- The default sizes in §3 are guesses — confirm or replace.
- Which other equipment rows (if any) should follow the Electrical room or Center mix zone (e.g. the lighting
  console to the mix position).
