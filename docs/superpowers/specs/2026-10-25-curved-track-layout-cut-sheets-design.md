# Curved track layout + "Preliminary" cut sheets — design

Date: 2026-10-25 · Punch item #369 (renumber at merge if taken) · Builds on #274/#291 (track
configurator), #292 (curtain cut sheets), #354 (#45 track extras), #368 (re-price lock).

## Goal

Jeff, Oct 25: curtain cut sheets need (1) a **layout view when the curtain's track is curved**, which
means a curved track has to be configurable beyond today's single radius, and (2) **"PRELIMINARY — NOT
FOR CONSTRUCTION"** on every sheet.

## Decisions taken with Jeff (brainstorm, Oct 25)

1. Curved tracks come in all four shapes — single arc, arc with straight legs, corner wraps (90° bends),
   serpentine / mixed — so the shape is an ordered **segment path** (Approach A).
2. **Pricing follows the segments** (straight sticks for straights, curved sections for arcs).
3. **Every segment joint gets its own hanging point**, on top of the series spacing.
4. The layout view shows segment dimensions, the overall footprint, the bi-part split + overlap, and
   hanging points.
5. The layout view is **its own sheet** after the type's sheet (CS-n.1), Submittal style.
6. The stamp is a **banner across the top + the Submittal title block's status slot**, and it **always**
   prints — no switch.
7. The **concave (open) side of the curve faces the audience**; no per-track toggle.

## Non-goals

- Grid curtains (they don't link to configurator tracks — elevation only, unchanged).
- The Grid drawing set, risers and rack sheets (no stamp change).
- Curve idlers / spindles (still not wanted, PUNCHLIST #291).
- An "Issued for construction" switch.

## 1. Data model

`TrackConfig` (`src/lib/track-engine.ts`) gains an optional path, used only when `curved`:

```ts
export type TrackSegment =
  | { kind: "straight"; lengthFt: number }
  | { kind: "arc"; radiusFt: number; sweepDeg: number; turn: "left" | "right" };

export type TrackConfig = {
  // …existing fields…
  /** Curved only: 1–12 segments in order. Absent on a curved track = legacy single arc (below). */
  path?: TrackSegment[];
};
```

- Arc length = `radiusFt × sweepDeg × π / 180`; never stored.
- On a curved track with a path, `runFt` is **derived** = Σ segment lengths, and the builder writes it on
  save so every existing reader of `runFt` (descriptions, carriers, line) keeps working.
- **Legacy read:** a curved track with no `path` reads as one arc `{ radiusFt, sweepDeg: runFt / radiusFt
  × 180 / π, turn: "left" }`. Pure, at read time; nothing is rewritten, and its quantities are identical
  to today's (one arc, same length → same section count, splices and hanging points — the joint rule adds
  nothing with a single segment).
- Limits: 1–12 segments; straight 0 < length ≤ `MAX_RUN_FT`; arc radius > 0 and ≥ the series'
  `minRadiusFt`; 0 < sweep ≤ 360; total ≤ `MAX_RUN_FT`. Sanitized server-side wherever a track config is
  already sanitized (`track-bom.ts` `cleanConfig` path), dropping bad segments the same way bad fields are
  dropped today.
- Straight tracks: unchanged, `path` ignored and not stored.

## 2. Geometry — `src/lib/track-path/` (new, pure, client-safe)

- `resolvePath(config): TrackSegment[]` — the path, or the legacy single arc.
- `segmentLengths`, `pathLengthFt`.
- `pointAt(path, distFt) → { x, y, headingDeg }` — walking from (0,0) heading +x; an arc turns left
  (counter-clockwise) or right about its center.
- `orientForAudience(points)` — rotates so start → end is horizontal, left → right, then flips vertically
  if needed so the path's bulge sits **upstage** (the concave side faces the audience, drawn at the
  bottom). A path whose start and end coincide skips the rotation.
- `footprint(path)` → overall width (along the start→end chord direction after orienting) and depth.
- `splitAt(path, distFt)` → two sub-paths (a bi-part's legs at the midpoint).
- `hangingPoints(path, spacingFt)` → distances along the path: the start, the end, every segment joint,
  and fill points so no gap exceeds `spacingFt`, computed **per run between joints**
  (`ceil(span / spacing)` intervals each). Lapped bi-parts compute this per leg.
- `pathSignature(path)` → a stable short string (`s12|a6:90:L|s12`) for type keys and descriptions.

## 3. Pricing — `trackQuantities` per segment

For a curved track (path resolved, legs split at the midpoint of the length including the overlap, as
today):

- **Legs.** The path is split at its midpoint; on a lapped bi-part each leg then gains `overlapFt / 2`,
  added to the segment at the center end of that leg (so the center segment's pieces cover the lap).
- **Pieces.** Each leg is cut into its segments. Straight segments buy straight sticks by the existing
  shortest-stick-that-covers rule *per segment*; arc segments buy `ceil(arc ÷ curvedSectionFt)` curved
  sections. Rows: `track` (one row per chosen stick SKU — the engine's row gains the ability to emit more
  than one `track` row, each with its `sku`/`lengthFt`) and `curved`.
- **Splices** = (pieces − 1) per leg — every joint between pieces, including between segments. Ceiling
  splice substitution as today.
- **Hanging points** = `hangingPoints(leg, spacing).length` per leg (decision 3). Pipe clamps follow
  mounts as today.
- Carriers, masters, end stops, lap clamps, center pipe supports and cord/line: unchanged, from the total
  length.
- **Errors** name the segment: `Segment 2: 3' is tighter than the ADC 280's 6' minimum.`; a series with
  no `curvedSectionFt` refuses any arc; a path with an arc but a series with no sticks refuses only if it
  also has straight segments.
- A straight track (`curved: false`) prices exactly as today.
- Sent estimates are locked until Revise (#368); only drafts re-price.

## 4. Track configurator (`src/app/(app)/estimator/track-modal.tsx`)

- **Straight:** unchanged.
- **Curved:** the Run and Radius fields are replaced by a **segment list**:
  - each row: Straight / Arc, Length (straight) or Radius + Angle (arc), Left / Right, ↑ ↓ ✕;
  - an arc row shows its arc length, and typing an arc length back-solves the angle;
  - **+ Add segment** (max 12); **Total run** shown read-only.
- **Presets** fill the list (editable afterwards): *Single arc*, *Arc with straight legs*, *U wrap*
  (straight · 90° · straight · 90° · straight), *Serpentine* (arc left · arc right). Preset dimensions
  start from the current run and the series' minimum radius.
- **Live mini plan** under the list, drawn with the same layout-shape builder as the cut sheet (§5), and
  per-row errors from the engine.
- Description (`track-bom.ts`): `…, curved R12'` stays for a single arc; a multi-segment path reads
  `…, curved: 3 segments (R12', R2')`.
- Draft ↔ config round-trip (`track-bom.ts` draft helpers) carries the path; switching Straight ↔ Curved
  keeps the list in the draft.

## 5. Cut sheets

### 5.1 Layout shapes — `src/lib/curtain-cut-sheets/layout.ts` (new, pure)

`layoutView({ path, operation, walkAlongBipart, overlapFt, mounting, hangerSpacingFt, box, detail })` →
`{ scale, shapes }` in paper inches, using the existing `Shape` primitives and `ARCH_SCALES` (largest
scale that fits the box, smallest when none does). `detail: "submittal" | "client"`.

- **Both:** the path (heavy stroke; arcs as SVG arc `path` shapes), the overall width and depth dimension
  strings, each arc's radius drawn as a thin leader to a center cross with `R6'-0"` and the sweep (`90°`),
  and each straight's length along it.
- **Submittal only:** arc length per arc; bi-part center split mark, the lap drawn as a short double line
  of `overlapFt`, and a travel arrow per half (one arrow for one-way; two for a walk-along bi-part, none
  for a single walk-along); hanging-point ticks at `hangingPoints()` with the caption
  `Batten clamps (n)` / `Ceiling hangers (n)` — n equals the hardware table's mount quantity; an
  `AUDIENCE` arrow + label under the path.
- **Client:** path, footprint, radii, `Audience` — no hanging points, no arc lengths.
- Labels that can't fit are dropped, never overlapped (same rule as the elevation's bottom label).

### 5.2 Model + types

- `CutSheetCurtain.mount.track` gains the resolved `path` (only when curved) plus `overlapFt`,
  `operation`, `walkAlongBipart`, `mounting`, `hangerSpacingFt` already known to the reader.
- `curtainTypeKey` appends `pathSignature(path)` for curved tracks, so curtains on different layouts are
  separate types (straight-track keys unchanged → existing sheet numbering unchanged for straight work).
- `CutSheetModel` gains `layout: { scale, shapes, box } | null`.
- The elevation of a curved-track curtain labels its overall width `… along track`.

### 5.3 Pages (`src/components/cutsheets/cut-sheet-pages.tsx`)

- **Submittal:** a curved type renders a second `pk-drawing-sheet` right after its sheet, numbered
  `CS-n.1`, titled `Layout — <title>`, with the full drawing area given to the layout view and the
  title block's scale `Plan <scale>`. The title block's index/total count layout sheets
  (`total` = sheets actually printed). Sheet numbers of later types do not shift (`.1` suffix).
- **Client:** a curved type adds a `Track layout` block (client shapes) beside "How it hangs"; still one
  page per type.
- Every consumer already renders these components — `/estimator/cut-sheets`, the signed
  `/print/cutsheets/[quoteId]` route (client-package `cutsheets/` folder), the estimate PDF's Cut sheets
  toggle, and the online/portal views — so no consumer changes beyond page counts.

### 5.4 Stamp

- A constant `CUT_SHEET_STAMP = "PRELIMINARY — NOT FOR CONSTRUCTION"` in `model.ts`.
- **Banner:** a bold, bordered, full-width banner at the top of every cut sheet — Submittal (inside the
  drawing frame, above the grid) and Client (under the header). Black on white so it prints on any
  printer; class `pk-cs-stamp` in `globals.css`.
- **Title block:** `TitleBlockData` gains optional `status?: string`; the shared `title-block.tsx` prints
  it as a bold line in the Revisions cell when set. Only cut sheets set it, so the Grid drawing set,
  risers and rack sheets are byte-identical.
- Always on; no setting, no per-quote switch.

## 6. Tests

- `scripts/test-track-path.ts` (new, in `test:specs`): lengths, `pointAt` closure on a 360° arc,
  orientation (concave side down) for single arc / U / serpentine, footprint, split at midpoint,
  hanging points (joint inclusion, spacing cap, single-segment = today's count).
- Track engine: legacy curved configs produce **identical rows** to before (parity over a fixture set);
  mixed path quantities by hand-checked examples; segment-named errors.
- Cut sheets: a curved type yields a `CS-n.1` layout sheet; the hanging-point caption equals the hardware
  mount qty; different paths → different types; straight-only quotes keep their existing sheet list; the
  stamp string is present on both styles; the drawing set's title block output is unchanged.
- Browser pass: configure a U-wrap bi-part in the track modal, link a curtain, open
  `/estimator/cut-sheets` in both styles, and render the print route to PDF.

## 7. Rollout

No migration (JSON on the line). No env var. A rollback leaves `path` on saved lines; an older build
ignores it and prices those tracks as one arc of `runFt` — acceptable, noted in DECISIONS.
Jeff-gated after merge: set `curvedSectionFt` / `minRadiusFt` on each series that curves (corner wraps
need a series that bends that tight), then try a real curved job on production.
