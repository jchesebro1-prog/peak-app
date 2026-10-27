# Curved Track Layout + "Preliminary" Cut Sheets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A curved curtain track is configured as a path of straight and arc segments, priced per segment, and drawn on its own layout sheet in the curtain cut sheets; every cut sheet carries "PRELIMINARY — NOT FOR CONSTRUCTION".

**Architecture:** One new pure geometry module (`src/lib/track-path/`) is the single source for segment lengths, legs, pieces and hanging points. The track engine prices from it, the track configurator draws a mini plan from it, and a new pure shape builder (`src/lib/curtain-cut-sheets/layout.ts`) draws the cut-sheet layout from it — so the BOM and the drawing always agree. The stamp is a constant printed by the existing cut-sheet page components and the shared title block.

**Tech Stack:** Next.js 16 App Router, TypeScript, React server/client components, the repo's `tsx` spec harness (`scripts/test-*.ts`, `ok(cond, msg)`).

**Spec:** `docs/superpowers/specs/2026-10-25-curved-track-layout-cut-sheets-design.md` (commit e4307fcc).

## Global Constraints

- Work in a git worktree off `origin/main` (`superpowers:using-git-worktrees`). Fresh worktrees have no `node_modules`: run `npm ci` first (never symlink) — `npx tsc`/`npx eslint` silently fake success without it. Also copy `next-env.d.ts` if missing.
- **Never commit to `main` directly; never push** — the controller reviews the diff and pushes.
- Pure modules stay pure: `src/lib/track-path/` and `src/lib/curtain-cut-sheets/layout.ts` import no store, no `@/db`, no React, no AI SDK.
- Straight tracks (`curved: false`) must price **byte-identically** to today. Legacy curved tracks (no `path`) must price identically to today.
- A path has 1–12 segments. Arc length = `radiusFt × sweepDeg × π / 180`, never stored.
- Error copy, verbatim: `Add a segment to the curve.` · `A curved track has at most 12 segments.` · `Segment N: enter the length.` · `Segment N: enter the radius.` · `Segment N: <r>' is tighter than the <series name>'s <min>' minimum.` · `Segment N: the angle is more than 0° and at most 360°.` · `Segment N: pick Left or Right.` · `A curved track needs at least one arc — make it Straight instead.` · `<series name> has no curved track.`
- Stamp text, verbatim: `PRELIMINARY — NOT FOR CONSTRUCTION` (em dash). Always printed; no switch.
- The concave (open) side of a curve faces the audience, drawn at the bottom of the sheet with `AUDIENCE`.
- Every hanging point the layout draws comes from `legHangingPoints` — the same function the engine counts with.
- Only cut sheets get the stamp: the Grid drawing set, risers and rack sheets stay byte-identical.
- Feet-inches labels use the existing `ftIn()` from `src/lib/curtain-cut-sheets/geometry.ts`.
- No migration, no env var, no new dependency.
- Each task: run its own checks with `npx tsx scripts/test-curved-track.ts`, then `npx tsc --noEmit -p .` and `npx eslint <touched files>`. Tasks 6 and 7 also run `npx next build` (a client component importing a server module breaks only the build).
- One deliberate refinement of the spec: the Client-style "Track layout" drawing sits **beside** "How it hangs" in the same row (not under it), so a client sheet stays one page.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/lib/track-path/index.ts` | Create | Path geometry: lengths, walk, legs, pieces, hanging points, orientation, validation, signature |
| `src/lib/track-engine.ts` | Modify | `TrackConfig.path`; per-segment pricing for curved tracks |
| `src/app/(app)/estimator/types.ts` | Modify | `TrackSegmentDraft`; `TrackDraft.segments` |
| `src/app/(app)/estimator/track-segment-draft.ts` | Create | Draft ↔ path conversion, arc-length helpers, presets |
| `src/app/(app)/estimator/track-bom.ts` | Modify | Draft/config round trip, `cleanTrackConfig`, line description |
| `src/lib/curtain-cut-sheets/layout.ts` | Create | `trackLayoutSource`, `hangingPointsAlong`, `layoutView` shapes |
| `src/app/(app)/estimator/track-segments.tsx` | Create | Segment list editor + presets + mini plan (client UI) |
| `src/app/(app)/estimator/track-modal.tsx` | Modify | Curved mode shows the segment editor; error gating |
| `src/lib/curtain-cut-sheets/estimator-curtains.ts` | Modify | Reader carries `layout`; type key includes the path |
| `src/lib/curtain-cut-sheets/geometry.ts` | Modify | Elevation width note ("along track") |
| `src/lib/curtain-cut-sheets/model.ts` | Modify | `CUT_SHEET_STAMP`, title-block stamp, layout sheet model, page counts |
| `src/lib/curtain-cut-sheets/load.ts` | Modify | Submittal sheet indexes count layout sheets |
| `src/lib/design/grid-drawing-set.ts` | Modify | `TitleBlockData.stamp?` |
| `src/components/drawing/title-block.tsx` | Modify | Prints `data.stamp` when set |
| `src/components/cutsheets/cut-sheet-pages.tsx` | Modify | Stamp banner, layout sheet, client track layout |
| `src/app/globals.css` | Modify | `.pk-cs-area`, `.pk-cs-stamp`, `.pk-tb-stamp` |
| `scripts/test-curved-track.ts` | Create | All #369 checks |
| `scripts/test-review-and-spec.ts` | Modify | Wires `curvedTrackChecks` into `test:specs` |
| `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md`, spec | Modify | Docs (Task 7) |

---

### Task 1: "PRELIMINARY — NOT FOR CONSTRUCTION" on every cut sheet

**Files:**
- Create: `scripts/test-curved-track.ts`
- Modify: `scripts/test-review-and-spec.ts` (import near line 11369; `.then` near line 11792)
- Modify: `src/lib/design/grid-drawing-set.ts` (`TitleBlockData`, ~line 211)
- Modify: `src/components/drawing/title-block.tsx` (Sheet title cell, ~line 101)
- Modify: `src/lib/curtain-cut-sheets/model.ts`
- Modify: `src/components/cutsheets/cut-sheet-pages.tsx`
- Modify: `src/app/globals.css` (cut-sheet block, ~line 1322)

**Interfaces:**
- Produces: `CUT_SHEET_STAMP: string` (model.ts); `TitleBlockData.stamp?: string`; test scaffolding `curvedTrackChecks(ok)` with helpers `line`, `sec`, `curtain`, `collect`, `CTX`, `src` that later tasks reuse.

- [ ] **Step 1: Create the test file with the stamp checks**

Create `scripts/test-curved-track.ts`:

```ts
/* #369 — curved track layout + "Preliminary" cut sheets. Pure checks; run alone with
   `npx tsx scripts/test-curved-track.ts`. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ok } from "./test-inbox-org";
import type { SpecItem, SpecSection } from "../src/app/(app)/estimator/types";
import type { TrackSeries } from "../src/lib/track-series";
import { collectCurtainTypes } from "../src/lib/curtain-cut-sheets/collect";
import { CUT_SHEET_STAMP, cutSheetModel, type CutSheetContext } from "../src/lib/curtain-cut-sheets/model";
import { titleBlockData } from "../src/lib/design/grid-drawing-set";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const line = (id: number, extra: Partial<SpecItem> = {}): SpecItem =>
  ({ id, sku: "X", desc: "x", qty: 1, unit: "ea", cost: 0, price: 0, ...extra }) as SpecItem;
const sec = (items: SpecItem[]): SpecSection => ({ id: "s1", name: "Stage", kind: "materials", mfr: "", freightPct: 0, items }) as SpecSection;
/** A curtain line read through curtainInputs (no catalog fabric needed). */
const curtain = (id: number, extra: Partial<SpecItem> = {}): SpecItem =>
  line(id, {
    curtain: true,
    qty: 2,
    desc: "Main Drape",
    curtainInputs: { name: "Main Drape", fabricSku: "", fabricName: "Encore Velour 22 oz", qty: "2", width: "20", height: "18", fullness: "50" },
    ...extra,
  } as Partial<SpecItem>);
const collect = (items: SpecItem[], trackSeries: TrackSeries[] = []) =>
  collectCurtainTypes({ quote: { spec: { sections: [sec(items)], mobs: [] } }, fabrics: [], trackSeries, mounts: {}, partInfo: new Map(), grid: null });
const CTX: Omit<CutSheetContext, "style"> = {
  quote: { id: "Q-1", number: "EST-1042", name: "Main stage", customer: "Lakefront HS", venue: "Auditorium", revisions: [] },
  company: { name: "Peak Systems Group", logoDark: null, offices: [] },
  preparedBy: "Jeff Chesebro",
  index: 1,
  total: 1,
  now: 1,
};

export function stampChecks(ok: Ok) {
  ok(CUT_SHEET_STAMP === "PRELIMINARY — NOT FOR CONSTRUCTION", "#369 stamp: the exact words, em dash");
  const t = collect([curtain(1)]).types[0];
  ok(!!t, "#369 stamp: fixture collects one curtain type");
  const sub = cutSheetModel(t, { ...CTX, style: "submittal" });
  const cli = cutSheetModel(t, { ...CTX, style: "client" });
  ok(sub.titleBlock?.stamp === CUT_SHEET_STAMP, "#369 stamp: the Submittal title block carries the stamp");
  ok(cli.titleBlock === null, "#369 stamp: the Client style still has no title block");
  const drawingSet = titleBlockData({
    company: { name: "Peak" },
    project: { id: "G-1", name: "Gym", customer: "Lakefront HS", siteName: "Gym", intake: null, createdBy: "Jeff" },
    option: { name: "", quoteId: null },
    optionCount: 1,
    revisions: [],
    set: undefined,
    sheet: { number: "L-101", title: "Plan", scale: "NTS" },
    index: 1,
    total: 1,
    now: 1,
  } as Parameters<typeof titleBlockData>[0]);
  ok(!("stamp" in drawingSet), "#369 stamp: the Grid drawing set's title block has no stamp");
  const pages = src("src/components/cutsheets/cut-sheet-pages.tsx");
  ok((pages.match(/<Stamp \/>/g) || []).length >= 2, "#369 stamp: the Submittal and Client sheets both render <Stamp />");
  ok(src("src/components/drawing/title-block.tsx").includes("{data.stamp && <div className=\"pk-tb-stamp\">{data.stamp}</div>}"), "#369 stamp: the title block prints data.stamp only when set");
  const css = src("src/app/globals.css");
  ok(css.includes(".pk-cs-stamp {") && css.includes(".pk-cs-area {") && css.includes(".pk-tb-stamp {"), "#369 stamp: the banner, area and title-block styles exist");
}

export async function curvedTrackChecks(ok: Ok) {
  stampChecks(ok);
}

if (process.argv[1]?.endsWith("test-curved-track.ts")) {
  let pass = 0, fail = 0;
  const okf: Ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
  curvedTrackChecks(okf).then(() => { console.log(`${pass} PASS, ${fail} FAIL`); process.exit(fail ? 1 : 0); });
}
```

If `titleBlockData`'s input type rejects a field above, read `TitleBlockInput` in `src/lib/design/grid-drawing-set.ts` (~line 230) and match it; the check only needs a valid drawing-set call.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx tsx scripts/test-curved-track.ts`
Expected: a compile/import error on `CUT_SHEET_STAMP` (not exported yet), or FAIL lines for every stamp check.

- [ ] **Step 3: Add `stamp` to the title block type and component**

In `src/lib/design/grid-drawing-set.ts`, inside `export type TitleBlockData = { … }`, after `status: string;`:

```ts
  /** #369 — "PRELIMINARY — NOT FOR CONSTRUCTION" on curtain cut sheets; absent everywhere else. */
  stamp?: string;
```

In `src/components/drawing/title-block.tsx`, the last cell becomes:

```tsx
      <div className="pk-tb-cell">
        <div className="pk-tb-label">Sheet title</div>
        {data.stamp && <div className="pk-tb-stamp">{data.stamp}</div>}
        <div className="pk-tb-sheettitle">{sheet.title}</div>
        <div className="pk-tb-sheetno">{sheet.number}</div>
        <div className="pk-tb-mono">{`${sheet.index} of ${sheet.total} · ${data.status}`}</div>
      </div>
```

- [ ] **Step 4: Export the stamp and set it on the Submittal title block**

In `src/lib/curtain-cut-sheets/model.ts`, after `export const CUT_SHEETS_NONE = …`:

```ts
/** #369 — printed on every cut sheet, both styles, always. */
export const CUT_SHEET_STAMP = "PRELIMINARY — NOT FOR CONSTRUCTION";
```

In `cutSheetModel`, wrap the existing `titleBlockData({...})` call so the result carries the stamp:

```ts
    titleBlock: submittal
      ? {
          ...titleBlockData({
            // …the existing argument object, unchanged…
          }),
          stamp: CUT_SHEET_STAMP,
        }
      : null,
```

- [ ] **Step 5: Render the banner on both styles**

In `src/components/cutsheets/cut-sheet-pages.tsx`:

1. Change the model import to `import { CUT_SHEET_STAMP, cutSheetCssVars, type CutSheetModel, type CutSheetStyle } from "@/lib/curtain-cut-sheets/model";`
2. Add, above `function Elevation`:

```tsx
/** #369 — every cut sheet, both styles. */
function Stamp() {
  return <div className="pk-cs-stamp">{CUT_SHEET_STAMP}</div>;
}
```

3. In `SubmittalSheet`, change `<div className="pk-drawing-area">` to `<div className="pk-drawing-area pk-cs-area">` and put `<Stamp />` as its first child, before `<div className="pk-cs-grid">`.
4. In `ClientSheet`, put `<Stamp />` directly before `<h1 className="pk-cs-title">{m.title}</h1>`.

- [ ] **Step 6: Add the styles**

In `src/app/globals.css`, directly after the `.pk-cs-cell { … }` line:

```css
/* #369 — the Submittal drawing area stacks the stamp over the grid. */
.pk-cs-area { display: flex; flex-direction: column; }
.pk-cs-area > .pk-cs-grid { flex: 1; height: auto; min-height: 0; }
.pk-cs-stamp { flex: none; border: 1.5pt solid #16181d; background: #fff; color: #16181d; text-align: center; font-weight: 800; letter-spacing: 0.08em; font-size: 11pt; padding: 3pt 6pt; margin-bottom: 8pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.pk-drawing-sheet .pk-cs-stamp { font-size: calc(11pt * var(--dw-k)); margin-bottom: 0.08in; }
.pk-tb-stamp { font-weight: 800; letter-spacing: 0.04em; margin-bottom: 2pt; }
```

- [ ] **Step 7: Wire into `test:specs`**

In `scripts/test-review-and-spec.ts`, after `import { lineMoveChecks } from "./test-estimate-line-move";` add:

```ts
import { curvedTrackChecks } from "./test-curved-track";
```

and after the line `.then(() => lineMoveChecks(ok))` add:

```ts
  .then(() => curvedTrackChecks(ok))
```

- [ ] **Step 8: Run the checks**

Run: `npx tsx scripts/test-curved-track.ts`
Expected: `8 PASS, 0 FAIL` (or however many checks the file holds — 0 FAIL is what matters).
Run: `npx tsc --noEmit -p .` → no errors. `npx eslint src/components/cutsheets/cut-sheet-pages.tsx src/components/drawing/title-block.tsx src/lib/curtain-cut-sheets/model.ts src/lib/design/grid-drawing-set.ts scripts/test-curved-track.ts` → clean.

- [ ] **Step 9: Commit**

```bash
git add scripts/test-curved-track.ts scripts/test-review-and-spec.ts src/lib/design/grid-drawing-set.ts src/components/drawing/title-block.tsx src/lib/curtain-cut-sheets/model.ts src/components/cutsheets/cut-sheet-pages.tsx src/app/globals.css
git commit -m "feat(cutsheets): #369 PRELIMINARY — NOT FOR CONSTRUCTION on every cut sheet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Track path geometry module

**Files:**
- Create: `src/lib/track-path/index.ts`
- Modify: `scripts/test-curved-track.ts`

**Interfaces:**
- Produces (all exported from `@/lib/track-path`):
  - `type TrackSegment = { kind: "straight"; lengthFt: number } | { kind: "arc"; radiusFt: number; sweepDeg: number; turn: "left" | "right" }`
  - `MAX_TRACK_SEGMENTS = 12`
  - `segmentLengthFt(s: TrackSegment): number`, `pathLengthFt(path: readonly TrackSegment[]): number`, `segmentBounds(path): number[]`
  - `type PathPoint = { x: number; y: number; headingDeg: number }`; `type SegmentStart = PathPoint & { center?: { x: number; y: number } }`
  - `segmentStarts(path): SegmentStart[]`, `pointAt(path, distFt): PathPoint`, `samplePath(path, stepFt): Array<PathPoint & { d: number }>`
  - `audienceFrame(path): (p: { x: number; y: number }) => { x: number; y: number }`, `footprint(path): { widthFt: number; depthFt: number }`
  - `type PathSeriesFacts = { name: string; curvedSectionFt?: number; minRadiusFt?: number; hasSticks: boolean }`; `pathErrors(path, series: PathSeriesFacts, maxRunFt: number): string[]`
  - `legacyArc(runFt: number, radiusFt: number | undefined): TrackSegment[]`; `resolvePath(c: { curved: boolean; path?: readonly TrackSegment[]; runFt: number; radiusFt?: number }): TrackSegment[] | null`
  - `type LegSpan = { startFt: number; endFt: number }`; `trackLegs(totalFt: number, lapOverlapFt: number): LegSpan[]`
  - `type LegPiece = { kind: "straight" | "arc"; lengthFt: number; segmentIndex: number }`; `legPieces(path, leg: LegSpan): LegPiece[]`
  - `legHangingPoints(path, leg: LegSpan, spacingFt: number): number[]`
  - `cleanPath(path: readonly TrackSegment[]): TrackSegment[]`, `pathSignature(path): string`

- [ ] **Step 1: Write the failing tests**

In `scripts/test-curved-track.ts` add the import:

```ts
import {
  audienceFrame, cleanPath, footprint, legHangingPoints, legPieces, legacyArc, pathErrors, pathLengthFt, pathSignature, pointAt,
  resolvePath, samplePath, segmentBounds, trackLegs, type TrackSegment,
} from "../src/lib/track-path";
```

and add this function (and call `trackPathChecks(ok);` inside `curvedTrackChecks`):

```ts
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const S = (lengthFt: number): TrackSegment => ({ kind: "straight", lengthFt });
const A = (radiusFt: number, sweepDeg: number, turn: "left" | "right" = "left"): TrackSegment => ({ kind: "arc", radiusFt, sweepDeg, turn });
const FACTS = { name: "ADC 280", curvedSectionFt: 10, minRadiusFt: 5, hasSticks: true };

export function trackPathChecks(ok: Ok) {
  const quarter = [A(10, 90)];
  ok(near(pathLengthFt(quarter), 5 * Math.PI), "#369 path: a 90° R10 arc is 5π ft long");
  const e = pointAt(quarter, pathLengthFt(quarter));
  ok(near(e.x, 10) && near(e.y, 10) && near(e.headingDeg, 90), "#369 path: a left quarter arc from heading +x ends at (R, R) heading 90°");
  const r = pointAt([A(10, 90, "right")], 5 * Math.PI);
  ok(near(r.x, 10) && near(r.y, -10) && near(r.headingDeg, -90), "#369 path: a right quarter arc ends at (R, −R) heading −90°");
  const full = pointAt([A(7, 360)], 14 * Math.PI);
  ok(near(full.x, 0) && near(full.y, 0), "#369 path: a 360° arc closes on its start");
  const legs = [S(12), A(6, 90), S(12)];
  ok(segmentBounds(legs).map((n) => Math.round(n * 1000) / 1000).join() === "0,12,21.425,33.425", "#369 path: segment bounds are cumulative lengths");
  const sl = pointAt(legs, 33.4247779);
  ok(near(sl.x, 18, 1e-4) && near(sl.y, 18, 1e-4), "#369 path: straight · 90° · straight ends where the geometry says");
  ok(samplePath(legs, 1).length >= 34 && samplePath([], 1).length === 0, "#369 path: sampling covers the path; an empty path samples nothing");

  // orientation: the bulge goes to +y (upstage) so the concave side faces the audience (−y)
  for (const [name, p] of [["semicircle", [A(10, 180)]], ["U wrap", [S(10), A(2, 90), S(10), A(2, 90), S(10)]], ["right arc", [A(10, 120, "right")]]] as const) {
    const f = audienceFrame(p as TrackSegment[]);
    const pts = samplePath(p as TrackSegment[], 0.5).map(f);
    const s0 = pts[0], s1 = pts[pts.length - 1];
    const mean = pts.reduce((a, q) => a + q.y, 0) / pts.length;
    ok(near(s0.y, s1.y, 1e-6) && s1.x > s0.x && mean > 0, `#369 path: ${name} — start→end runs left to right and the bulge is upstage`);
  }
  const fp = footprint([A(10, 180)]);
  ok(near(fp.widthFt, 20, 1e-3) && near(fp.depthFt, 10, 1e-2), "#369 path: a semicircle R10 is 20' wide and 10' deep");

  // validation
  ok(pathErrors([], FACTS, 1000).join() === "Add a segment to the curve.", "#369 path: an empty path asks for a segment");
  ok(pathErrors([S(10), A(3, 90)], FACTS, 1000).includes("Segment 2: 3' is tighter than the ADC 280's 5' minimum."), "#369 path: a too-tight arc names its segment and the series minimum");
  ok(pathErrors([S(10), S(5)], FACTS, 1000).includes("A curved track needs at least one arc — make it Straight instead."), "#369 path: all straights is refused");
  ok(pathErrors([A(10, 90)], { ...FACTS, curvedSectionFt: undefined }, 1000).includes("ADC 280 has no curved track."), "#369 path: a series with no curved section refuses any arc");
  ok(pathErrors([A(10, 400)], FACTS, 1000).includes("Segment 1: the angle is more than 0° and at most 360°."), "#369 path: angle over 360° is refused");
  ok(pathErrors([S(NaN), A(NaN, 90)], FACTS, 1000).join("|") === "Segment 1: enter the length.|Segment 2: enter the radius.", "#369 path: blank numbers name their segment");
  ok(pathErrors(Array.from({ length: 13 }, () => A(10, 10)), FACTS, 1000).includes("A curved track has at most 12 segments."), "#369 path: at most 12 segments");
  ok(pathErrors([S(10), A(6, 90)], { ...FACTS, hasSticks: false }, 1000).includes("ADC 280 has no stick length — set it in Estimating Rules → Track series."), "#369 path: a straight segment needs sticks");
  ok(pathErrors([S(990), A(10, 180)], FACTS, 1000).includes("A run is at most 1000'."), "#369 path: the total run is capped");
  ok(pathErrors(legs, FACTS, 1000).length === 0, "#369 path: a good path has no errors");

  // legacy + resolve
  const legacy = legacyArc(40, 30);
  ok(legacy.length === 1 && legacy[0].kind === "arc" && near(pathLengthFt(legacy), 40, 1e-9), "#369 path: a legacy curved track is one arc of its run");
  ok(resolvePath({ curved: false, runFt: 40 }) === null, "#369 path: a straight track has no path");
  ok(resolvePath({ curved: true, runFt: 40, radiusFt: 30 })!.length === 1 && resolvePath({ curved: true, runFt: 40, path: [] })!.length === 0, "#369 path: legacy arcs resolve; an explicit (even empty) path wins");
  ok(legacyArc(40, undefined).length === 0, "#369 path: a legacy curve with no radius resolves to nothing");

  // legs, pieces, hanging points
  ok(JSON.stringify(trackLegs(40, 0)) === JSON.stringify([{ startFt: 0, endFt: 40 }]), "#369 path: no lap = one leg");
  const lap = trackLegs(40, 2);
  ok(near(lap[0].endFt - lap[0].startFt, 21) && near(lap[1].endFt - lap[1].startFt, 21) && near(lap[1].startFt, 19), "#369 path: a lapped bi-part is two legs of (run + overlap) / 2 meeting at center");
  const pcs = legPieces(legs, { startFt: 0, endFt: pathLengthFt(legs) });
  ok(pcs.map((p) => `${p.kind}:${Math.round(p.lengthFt * 100) / 100}`).join() === "straight:12,arc:9.42,straight:12", "#369 path: a leg's pieces follow its segments");
  const half = legPieces(legs, { startFt: 0, endFt: 16 });
  ok(half.length === 2 && near(half[1].lengthFt, 4), "#369 path: a leg ending mid-segment keeps only its share");
  ok(legHangingPoints([A(30, 76.39437268)], { startFt: 0, endFt: 40 }, 7).length === 7, "#369 path: one segment = ceil(L / spacing) + 1 points (today's rule)");
  const hp = legHangingPoints(legs, { startFt: 0, endFt: pathLengthFt(legs) }, 7);
  ok(hp.length === 7 && hp.some((d) => near(d, 12)) && hp.some((d) => near(d, 21.4247779, 1e-6)), "#369 path: every segment joint gets a hanging point");

  ok(pathSignature(legs) === "s12|a6:90:L|s12", "#369 path: a stable signature");
  ok(JSON.stringify(cleanPath([{ kind: "arc", radiusFt: 6, sweepDeg: 90, turn: "left", junk: 1 } as unknown as TrackSegment])) === JSON.stringify([A(6, 90)]), "#369 path: cleanPath keeps only segment fields");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx scripts/test-curved-track.ts`
Expected: fails to resolve `../src/lib/track-path`.

- [ ] **Step 3: Write the module**

Create `src/lib/track-path/index.ts`:

```ts
/**
 * Curved track paths (#369). Pure and client-safe. The track engine prices a
 * curved track from it, the track configurator draws its mini plan from it,
 * and the curtain cut sheets draw the layout sheet from it — one geometry, so
 * the BOM and the drawing always agree.
 *
 * A path walks from (0, 0) heading +x, in world feet with y up. An arc turns
 * left (counter-clockwise) or right about its center.
 */

export type TrackSegment =
  | { kind: "straight"; lengthFt: number }
  | { kind: "arc"; radiusFt: number; sweepDeg: number; turn: "left" | "right" };

export const MAX_TRACK_SEGMENTS = 12;
const RAD = Math.PI / 180;

/** ceil that forgives float noise at exact multiples (the track engine's rule). */
function ceilSafe(x: number): number {
  return Math.ceil(x - 1e-9);
}
const fmtFt = (n: number) => (Math.round(n * 100) / 100).toString() + "'";
const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

export function segmentLengthFt(s: TrackSegment): number {
  return s.kind === "straight" ? s.lengthFt : s.radiusFt * s.sweepDeg * RAD;
}

export function pathLengthFt(path: readonly TrackSegment[]): number {
  return path.reduce((a, s) => a + segmentLengthFt(s), 0);
}

/** [0, l1, l1 + l2, …, L] — where each segment starts, then the end. */
export function segmentBounds(path: readonly TrackSegment[]): number[] {
  const out = [0];
  for (const s of path) out.push(out[out.length - 1] + segmentLengthFt(s));
  return out;
}

export type PathPoint = { x: number; y: number; headingDeg: number };
export type SegmentStart = PathPoint & { center?: { x: number; y: number } };

function arcCenter(p: PathPoint, s: Extract<TrackSegment, { kind: "arc" }>): { x: number; y: number } {
  const t = p.headingDeg * RAD;
  const side = s.turn === "left" ? 1 : -1;
  return { x: p.x - side * s.radiusFt * Math.sin(t), y: p.y + side * s.radiusFt * Math.cos(t) };
}

/** The point `d` ft into segment `s`, which starts at `p`. */
function advance(p: PathPoint, s: TrackSegment, d: number): PathPoint {
  const t = p.headingDeg * RAD;
  if (s.kind === "straight") return { x: p.x + d * Math.cos(t), y: p.y + d * Math.sin(t), headingDeg: p.headingDeg };
  const side = s.turn === "left" ? 1 : -1;
  const c = arcCenter(p, s);
  const t2 = t + (side * d) / s.radiusFt;
  return { x: c.x + side * s.radiusFt * Math.sin(t2), y: c.y - side * s.radiusFt * Math.cos(t2), headingDeg: t2 / RAD };
}

/** Each segment's start point and heading, plus an arc's center. */
export function segmentStarts(path: readonly TrackSegment[]): SegmentStart[] {
  const out: SegmentStart[] = [];
  let p: PathPoint = { x: 0, y: 0, headingDeg: 0 };
  for (const s of path) {
    out.push(s.kind === "arc" ? { ...p, center: arcCenter(p, s) } : { ...p });
    p = advance(p, s, segmentLengthFt(s));
  }
  return out;
}

/** The point `distFt` along the path (clamped to its ends). */
export function pointAt(path: readonly TrackSegment[], distFt: number): PathPoint {
  if (!path.length) return { x: 0, y: 0, headingDeg: 0 };
  const starts = segmentStarts(path);
  const b = segmentBounds(path);
  const d = Math.min(Math.max(distFt, 0), b[b.length - 1]);
  let i = path.length - 1;
  for (let k = 0; k < path.length; k++) {
    if (d <= b[k + 1]) {
      i = k;
      break;
    }
  }
  return advance(starts[i], path[i], d - b[i]);
}

/** Points about every `stepFt` along the path, both ends included, at most 1,200 intervals. */
export function samplePath(path: readonly TrackSegment[], stepFt: number): Array<PathPoint & { d: number }> {
  const L = pathLengthFt(path);
  if (!(L > 0)) return [];
  const n = Math.min(1200, Math.max(1, Math.ceil(L / Math.max(stepFt, 1e-6))));
  return Array.from({ length: n + 1 }, (_, k) => {
    const d = (L * k) / n;
    return { d, ...pointAt(path, d) };
  });
}

/**
 * World → drawing frame: start → end runs left to right along +x and the path
 * bulges toward +y (upstage), so its open, concave side faces the audience at
 * −y. A path that closes on itself keeps its own rotation.
 */
export function audienceFrame(path: readonly TrackSegment[]): (p: { x: number; y: number }) => { x: number; y: number } {
  const L = pathLengthFt(path);
  const end = pointAt(path, L);
  const a = Math.hypot(end.x, end.y) > 1e-6 * Math.max(L, 1) ? Math.atan2(end.y, end.x) : 0;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const rot = (p: { x: number; y: number }) => ({ x: p.x * cos + p.y * sin, y: -p.x * sin + p.y * cos });
  const pts = samplePath(path, L / 200).map(rot);
  const mean = pts.reduce((s, p) => s + p.y, 0) / Math.max(1, pts.length);
  const flip = mean < 0;
  return (p) => {
    const r = rot(p);
    return { x: r.x, y: flip ? -r.y : r.y };
  };
}

/** Overall width (left → right in the audience frame) and depth, ft. */
export function footprint(path: readonly TrackSegment[]): { widthFt: number; depthFt: number } {
  const f = audienceFrame(path);
  const pts = samplePath(path, pathLengthFt(path) / 400).map(f);
  if (!pts.length) return { widthFt: 0, depthFt: 0 };
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { widthFt: Math.max(...xs) - Math.min(...xs), depthFt: Math.max(...ys) - Math.min(...ys) };
}

export type PathSeriesFacts = { name: string; curvedSectionFt?: number; minRadiusFt?: number; hasSticks: boolean };

/** Everything wrong with a path for this series, in reading order; [] = priceable. */
export function pathErrors(path: readonly TrackSegment[], series: PathSeriesFacts, maxRunFt: number): string[] {
  if (!path.length) return ["Add a segment to the curve."];
  const name = series.name || "This series";
  const errors: string[] = [];
  if (path.length > MAX_TRACK_SEGMENTS) errors.push(`A curved track has at most ${MAX_TRACK_SEGMENTS} segments.`);
  path.forEach((s, i) => {
    const at = `Segment ${i + 1}`;
    if (s.kind === "straight") {
      if (!positive(s.lengthFt)) errors.push(`${at}: enter the length.`);
      return;
    }
    if (!positive(s.radiusFt)) errors.push(`${at}: enter the radius.`);
    else if (series.minRadiusFt && s.radiusFt < series.minRadiusFt)
      errors.push(`${at}: ${fmtFt(s.radiusFt)} is tighter than the ${name}'s ${fmtFt(series.minRadiusFt)} minimum.`);
    if (!(positive(s.sweepDeg) && s.sweepDeg <= 360)) errors.push(`${at}: the angle is more than 0° and at most 360°.`);
    if (s.turn !== "left" && s.turn !== "right") errors.push(`${at}: pick Left or Right.`);
  });
  if (!path.some((s) => s.kind === "arc")) errors.push("A curved track needs at least one arc — make it Straight instead.");
  else if (!positive(series.curvedSectionFt)) errors.push(`${name} has no curved track.`);
  if (path.some((s) => s.kind === "straight") && !series.hasSticks) errors.push(`${name} has no stick length — set it in Estimating Rules → Track series.`);
  if (!errors.length && pathLengthFt(path) > maxRunFt) errors.push(`A run is at most ${maxRunFt}'.`);
  return errors;
}

/** A curved track saved before #369 (no path): the one left arc it always was; [] when its run or radius is unusable. */
export function legacyArc(runFt: number, radiusFt: number | undefined): TrackSegment[] {
  if (!positive(runFt) || !positive(radiusFt)) return [];
  return [{ kind: "arc", radiusFt, sweepDeg: runFt / radiusFt / RAD, turn: "left" }];
}

/** A track config's path: its own (even empty) when it has one, else the legacy arc; null for a straight track. */
export function resolvePath(c: { curved: boolean; path?: readonly TrackSegment[]; runFt: number; radiusFt?: number }): TrackSegment[] | null {
  if (!c.curved) return null;
  return Array.isArray(c.path) ? cleanPath(c.path) : legacyArc(c.runFt, c.radiusFt);
}

/** Path distances one leg of track covers. */
export type LegSpan = { startFt: number; endFt: number };

/** One leg, or a lapped bi-part's two legs of (run + overlap) / 2 that overlap at center. */
export function trackLegs(totalFt: number, lapOverlapFt: number): LegSpan[] {
  if (!(lapOverlapFt > 0)) return [{ startFt: 0, endFt: totalFt }];
  const mid = totalFt / 2;
  const half = Math.min(lapOverlapFt, totalFt) / 2;
  return [
    { startFt: 0, endFt: mid + half },
    { startFt: mid - half, endFt: totalFt },
  ];
}

export type LegPiece = { kind: "straight" | "arc"; lengthFt: number; segmentIndex: number };

/** The part of each segment a leg covers, in path order. */
export function legPieces(path: readonly TrackSegment[], leg: LegSpan): LegPiece[] {
  const b = segmentBounds(path);
  const out: LegPiece[] = [];
  path.forEach((s, i) => {
    const a = Math.max(b[i], leg.startFt);
    const z = Math.min(b[i + 1], leg.endFt);
    if (z - a > 1e-9) out.push({ kind: s.kind, lengthFt: z - a, segmentIndex: i });
  });
  return out;
}

/**
 * Hanging points on one leg, as path distances: both ends, every segment
 * joint inside the leg (#369 — each joint is supported), and evenly spaced
 * fill so no gap exceeds `spacingFt`. One segment gives ceil(L ÷ spacing) + 1,
 * the engine's rule before #369.
 */
export function legHangingPoints(path: readonly TrackSegment[], leg: LegSpan, spacingFt: number): number[] {
  const joints = segmentBounds(path).filter((d) => d > leg.startFt + 1e-9 && d < leg.endFt - 1e-9);
  const stops = [leg.startFt, ...joints, leg.endFt];
  const pts = [stops[0]];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1];
    const z = stops[i];
    const n = Math.min(2000, Math.max(1, ceilSafe((z - a) / spacingFt)));
    for (let k = 1; k <= n; k++) pts.push(a + ((z - a) * k) / n);
  }
  return pts;
}

/** Only the segment fields, so a stored config never carries stray keys. */
export function cleanPath(path: readonly TrackSegment[]): TrackSegment[] {
  return path.map((s) =>
    s.kind === "straight" ? { kind: "straight", lengthFt: s.lengthFt } : { kind: "arc", radiusFt: s.radiusFt, sweepDeg: s.sweepDeg, turn: s.turn === "right" ? "right" : "left" }
  );
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** "s12|a6:90:L|s12" — groups curtains on the same layout into one cut-sheet type. */
export function pathSignature(path: readonly TrackSegment[]): string {
  return path.map((s) => (s.kind === "straight" ? `s${r2(s.lengthFt)}` : `a${r2(s.radiusFt)}:${r2(s.sweepDeg)}:${s.turn === "right" ? "R" : "L"}`)).join("|");
}
```

Note `resolvePath` returns `cleanPath(...)`, so a config path with a missing `turn` reads as `left` — `pathErrors` in the engine runs on the raw `config.path` and still catches a bad turn.

- [ ] **Step 4: Run the tests**

Run: `npx tsx scripts/test-curved-track.ts` → 0 FAIL. If an orientation check fails, print the sampled points for that shape before changing `audienceFrame`; the flip rule is "mean y < 0 ⇒ mirror".
Run: `npx tsc --noEmit -p .` and `npx eslint src/lib/track-path/index.ts scripts/test-curved-track.ts` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/track-path/index.ts scripts/test-curved-track.ts
git commit -m "feat(track): #369 track path geometry — segments, legs, hanging points, audience frame

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Per-segment pricing in the track engine

**Files:**
- Modify: `src/lib/track-engine.ts` (`TrackConfig` ~line 51; `trackQuantities` ~line 107)
- Modify: `src/app/(app)/estimator/track-modal.tsx` (PartsTable row key only, ~line 260)
- Modify: `scripts/test-curved-track.ts`

**Interfaces:**
- Consumes: `pathErrors`, `pathLengthFt`, `resolvePath`, `trackLegs`, `legPieces`, `legHangingPoints`, `type TrackSegment` from Task 2.
- Produces: `TrackConfig.path?: TrackSegment[]`. `trackQuantities` may now emit **several `track` rows** (one per stick SKU, each with `sku` and `lengthFt`) plus a `curved` row.

- [ ] **Step 1: Write the failing tests**

Add imports to `scripts/test-curved-track.ts`:

```ts
import { sanitizeTrackSeries } from "../src/lib/track-series";
import { trackQuantities, type TrackConfig } from "../src/lib/track-engine";
```

Add (and call `curvedEngineChecks(ok);` in `curvedTrackChecks`):

```ts
const STICKS = [12, 14, 16, 18, 20, 22, 24].map((l) => ({ lengthFt: l, sku: `S-${l}` }));
const ROLES = ["splice", "carrier", "masterCarrier", "endStop", "battenClamp", "ceilingHanger", "livePulley", "deadPulley", "floorBlock", "operatingLine", "curved"];
export function series(over: Partial<TrackSeries> = {}): TrackSeries {
  return sanitizeTrackSeries({
    id: "adc-280", name: "ADC 280", manufacturer: "ADC", sticks: STICKS, carrierSpacingIn: 12, hangerSpacingFt: 7, overlapFt: 2,
    curvedSectionFt: 10, minRadiusFt: 5, parts: Object.fromEntries(ROLES.map((r) => [r, { sku: `P-${r}` }])), active: true, ...over,
  })!;
}
export const cfg = (over: Partial<TrackConfig> = {}): TrackConfig => ({ seriesId: "adc-280", operation: "oneway", runFt: 40, curved: false, mounting: "batten", qty: 1, ...over });
/** role → qty, sticks as "track:S-12" → qty. */
function qtys(c: TrackConfig, s = series()): Record<string, number> & { errors?: string } {
  const r = trackQuantities(c, s);
  const out: Record<string, number> & { errors?: string } = {};
  if (r.errors.length) out.errors = r.errors.join("|");
  for (const row of r.rows) out[row.role === "track" ? `track:${row.sku}` : row.role] = (out[row.role === "track" ? `track:${row.sku}` : row.role] ?? 0) + row.qty;
  return out;
}

export function curvedEngineChecks(ok: Ok) {
  // straight tracks are untouched
  const st = qtys(cfg());
  ok(st["track:S-20"] === 2 && st.splice === 1 && st.battenClamp === 7 && st.carrier === 39, "#369 engine: a straight 40' track prices as before");

  // legacy curved (no path) — today's numbers
  const lg = qtys(cfg({ curved: true, radiusFt: 30 }));
  ok(lg.curved === 4 && lg.splice === 3 && lg.battenClamp === 7 && !lg.errors, "#369 engine: a legacy curved 40' run is 4 sections, 3 splices, 7 clamps");
  const lgBi = qtys(cfg({ curved: true, radiusFt: 30, operation: "biparting" }));
  ok(lgBi.curved === 6 && lgBi.splice === 4 && lgBi.battenClamp === 8 && lgBi.masterCarrier === 2, "#369 engine: a legacy curved lapped bi-part is two legs of 21'");
  const sameAsPath = (c: TrackConfig) => JSON.stringify(trackQuantities(c, series())) === JSON.stringify(trackQuantities({ ...c, path: resolvePath(c)! }, series()));
  ok(sameAsPath(cfg({ curved: true, radiusFt: 30 })) && sameAsPath(cfg({ curved: true, radiusFt: 30, operation: "biparting" })) && sameAsPath(cfg({ curved: true, radiusFt: 25, runFt: 63.5, mounting: "ceiling", qty: 3 })),
    "#369 engine: a legacy curve and the same curve as an explicit one-arc path price identically");
  ok(qtys(cfg({ curved: true })).errors === "Enter the curve radius.", "#369 engine: a legacy curve with no radius keeps today's error");

  // mixed one-way: straight 12 · R6 90° · straight 12 (run 33.42')
  const mixed = [S(12), A(6, 90), S(12)];
  const mx = qtys(cfg({ curved: true, path: mixed, runFt: pathLengthFt(mixed) }));
  ok(mx["track:S-12"] === 2 && mx.curved === 1 && mx.splice === 2 && mx.battenClamp === 7 && mx.carrier === 33 && mx.endStop === 2 && !mx.errors,
    "#369 engine: straights buy sticks, the arc buys a section, a splice per joint, a clamp at every joint");
  // the engine reads the run from the path, not the stored runFt
  ok(JSON.stringify(qtys(cfg({ curved: true, path: mixed, runFt: 999 }))) === JSON.stringify(mx), "#369 engine: a segmented track's run is its path length");

  // mixed lapped bi-part: straight 10 · R8 180° · straight 10, overlap 2
  const bi = [S(10), A(8, 180), S(10)];
  const bx = qtys(cfg({ curved: true, path: bi, runFt: pathLengthFt(bi), operation: "biparting" }));
  ok(bx["track:S-12"] === 2 && bx.curved === 4 && bx.splice === 4 && bx.battenClamp === 10 && bx.masterCarrier === 2,
    "#369 engine: a lapped bi-part splits at center — each leg buys its own straight, arc share, splices and clamps");
  const two = qtys(cfg({ curved: true, path: bi, runFt: pathLengthFt(bi), operation: "biparting", qty: 2 }));
  ok(two.curved === 8 && two.battenClamp === 20 && two["track:S-12"] === 4, "#369 engine: qty multiplies every row");

  // errors
  ok(qtys(cfg({ curved: true, path: [S(10), A(3, 90)], runFt: 0 })).errors === "Segment 2: 3' is tighter than the ADC 280's 5' minimum.", "#369 engine: a too-tight arc refuses the track by segment");
  ok(qtys(cfg({ curved: true, path: [], runFt: 0 })).errors === "Add a segment to the curve.", "#369 engine: an empty path asks for a segment (no run-length error)");
  ok((qtys(cfg({ curved: true, path: mixed, runFt: 0 }), series({ curvedSectionFt: undefined })).errors || "").includes("ADC 280 has no curved track."), "#369 engine: no curved section, no curve");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx scripts/test-curved-track.ts`
Expected: FAIL on the mixed and empty-path checks (the engine ignores `path` today); the straight/legacy checks pass.

- [ ] **Step 3: Add `path` to `TrackConfig`**

In `src/lib/track-engine.ts`, add to the imports:

```ts
import { legHangingPoints, legPieces, pathErrors, pathLengthFt, resolvePath, trackLegs, type TrackSegment } from "@/lib/track-path";
```

In `export type TrackConfig = { … }`, after `radiusFt?: number;`:

```ts
  /**
   * #369 — curved only: the track's shape, 1–12 segments in order. When set it
   * IS the track: its length is the run (runFt is written to match) and it is
   * priced per segment. Absent on a curved track = a pre-#369 single arc of
   * runFt at radiusFt (resolvePath).
   */
  path?: TrackSegment[];
```

Also extend the big header comment's `curved` bullet with one line:

```ts
 *   curved    (#369) a path: each leg is cut into its segments — straight
 *             pieces buy sticks (the shortest that covers), arcs buy
 *             ceil(arc / curvedSectionFt) sections; splices = pieces − 1 per
 *             leg; hanging points per leg = legHangingPoints (every joint
 *             supported). A pre-#369 curve is one arc and prices as before:
```

(keep the existing `curved per leg n = …` lines under it).

- [ ] **Step 4: Rewrite the validation and piece/mount math in `trackQuantities`**

Replace the body of `trackQuantities` from its first line down to (and including) the line `const batten = config.mounting === "batten";` with:

```ts
  const errors: string[] = [];
  // #369: a curved track with a path is its segments, and its run is their length.
  const segmented = config.curved && Array.isArray(config.path);
  const run = segmented ? pathLengthFt(config.path!) : config.runFt;
  const qty = config.qty;

  if (!OPERATIONS.has(config.operation)) errors.push("Pick how the track operates.");
  if (config.mounting !== "batten" && config.mounting !== "ceiling") errors.push("Pick a mounting.");
  if (!segmented) {
    if (!(typeof run === "number" && Number.isFinite(run) && run > 0)) errors.push("Enter the run length.");
    else if (run > MAX_RUN_FT) errors.push(`A run is at most ${MAX_RUN_FT}'.`);
  }
  if (!(Number.isInteger(qty) && qty >= 1 && qty <= MAX_TRACK_QTY)) errors.push(`Quantity is a whole number from 1 to ${MAX_TRACK_QTY}.`);

  const cord = isCordOperated(config.operation);
  const trim = config.trimFt ?? DEFAULT_TRIM_FT;
  if (cord && !(Number.isFinite(trim) && trim >= 0 && trim <= MAX_TRIM_FT)) errors.push(`Trim is 0 to ${MAX_TRIM_FT}'.`);

  if (segmented) {
    errors.push(
      ...pathErrors(config.path!, { name: series.name, curvedSectionFt: series.curvedSectionFt, minRadiusFt: series.minRadiusFt, hasSticks: seriesSticks(series).length > 0 }, MAX_RUN_FT)
    );
  } else if (config.curved) {
    if (!(series.curvedSectionFt && series.curvedSectionFt > 0)) errors.push(`${series.name || "This series"} has no curved track.`);
    const radius = config.radiusFt;
    if (!(typeof radius === "number" && Number.isFinite(radius) && radius > 0)) errors.push("Enter the curve radius.");
    else if (series.minRadiusFt && radius < series.minRadiusFt)
      errors.push(`${series.name || "This series"} bends to a ${series.minRadiusFt}' radius at the tightest — ${radius}' is too tight.`);
  } else if (!seriesSticks(series).length) {
    errors.push(`${series.name || "This series"} has no stick length — set it in Estimating Rules → Track series.`);
  }

  if (errors.length) return { rows: [], errors };

  const bipart = partsAtCenter(config);
  const L = run + (bipart ? series.overlapFt || 0 : 0);
  // #291: a lapped bi-part is two legs that meet at center; neither a stick nor a splice crosses it.
  const lap = bipart && series.overlapFt > 0;
  const legs = lap ? 2 : 1;
  const leg = L / legs;
  const mapped = (role: TrackRole) => !!series.parts[role]?.sku;
  const carrierSpacing = spacing(config.carrierSpacingIn, series.carrierSpacingIn);
  const hangerSpacing = spacing(config.hangerSpacingFt, hangerSpacingFor(series, config.mounting));
  let pieces: TrackRow[];
  let splices: number;
  let mounts: number;
  const path = resolvePath(config);
  if (path && path.length) {
    ({ pieces, splices, mounts } = curvedPieces(path, run, lap ? series.overlapFt : 0, series, hangerSpacing));
  } else {
    const sticks = seriesSticks(series);
    const nLeg = ceilSafe(leg / sticks[sticks.length - 1].lengthFt);
    const stick: TrackStick = sticks.find((s) => s.lengthFt >= leg / nLeg - 1e-9) ?? sticks[sticks.length - 1];
    pieces = [{ role: "track", qty: legs * nLeg, sku: stick.sku, lengthFt: stick.lengthFt }];
    splices = legs * Math.max(0, nLeg - 1);
    mounts = legs * (ceilSafe(leg / hangerSpacing) + 1);
  }
  const allCarriers = ceilSafe((run * 12) / carrierSpacing);
  const masters = bipart ? 2 : 1;
  const carriers = Math.max(0, allCarriers - masters);
  const batten = config.mounting === "batten";
```

Then in the `const per: TrackRow[] = [` list, replace its first element `piece,` with `...pieces,`. Leave the rest of the function as it is (it already reads `splices`, `mounts`, `L`, `bipart`, `batten`, `cord`, `trim`).

Add this helper directly above `export function trackQuantities`:

```ts
/** #369 — a curved track's pieces, splices and hanging points, leg by leg along its path. */
function curvedPieces(path: TrackSegment[], runFt: number, lapOverlapFt: number, series: TrackSeries, hangerSpacingFt: number): { pieces: TrackRow[]; splices: number; mounts: number } {
  const sticks = seriesSticks(series);
  const bySku = new Map<string, TrackRow>();
  let curved = 0;
  let splices = 0;
  let mounts = 0;
  for (const leg of trackLegs(runFt, lapOverlapFt)) {
    let n = 0;
    for (const p of legPieces(path, leg)) {
      if (p.kind === "arc") {
        const k = ceilSafe(p.lengthFt / series.curvedSectionFt!);
        curved += k;
        n += k;
        continue;
      }
      const longest = sticks[sticks.length - 1];
      const k = ceilSafe(p.lengthFt / longest.lengthFt);
      const stick = sticks.find((s) => s.lengthFt >= p.lengthFt / k - 1e-9) ?? longest;
      const row = bySku.get(stick.sku);
      if (row) row.qty += k;
      else bySku.set(stick.sku, { role: "track", qty: k, sku: stick.sku, lengthFt: stick.lengthFt });
      n += k;
    }
    splices += Math.max(0, n - 1);
    mounts += legHangingPoints(path, leg, hangerSpacingFt).length;
  }
  const pieces = [...bySku.values()];
  if (curved > 0) pieces.push({ role: "curved", qty: curved });
  return { pieces, splices, mounts };
}
```

Note the legacy curve now runs through `curvedPieces` too (as a one-arc path); the parity checks prove its numbers didn't move.

- [ ] **Step 5: Give the parts table a unique row key**

In `src/app/(app)/estimator/track-modal.tsx`, `PartsTable`, change `key: r.role,` to:

```ts
key: r.role + (r.sku ? ":" + r.sku : ""),
```

(two `track` rows with different sticks would otherwise share a key).

- [ ] **Step 6: Run the tests**

Run: `npx tsx scripts/test-curved-track.ts` → 0 FAIL.
Run the existing track suites inside the full harness: `npm run test:specs 2>&1 | grep -E "#274|#291|#354|FAIL" | grep FAIL` → no output. (`test:specs` is slow; it must end `ALL PASSED`.)
Run: `npx tsc --noEmit -p .` and `npx eslint src/lib/track-engine.ts "src/app/(app)/estimator/track-modal.tsx" scripts/test-curved-track.ts` → clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/track-engine.ts "src/app/(app)/estimator/track-modal.tsx" scripts/test-curved-track.ts
git commit -m "feat(track): #369 curved tracks price per segment — sticks, sections, a splice and clamp at every joint

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Draft ↔ config, presets, line description

**Files:**
- Modify: `src/app/(app)/estimator/types.ts` (`TrackDraft`, ~line 376)
- Create: `src/app/(app)/estimator/track-segment-draft.ts`
- Modify: `src/app/(app)/estimator/track-bom.ts`
- Modify: `src/app/(app)/estimator/track-modal.tsx` (`TrackSetter` type only, line 32)
- Modify: `scripts/test-curved-track.ts`

**Interfaces:**
- Consumes: `TrackSegment`, `pathLengthFt`, `cleanPath`, `resolvePath` (Task 2); `TrackConfig.path` (Task 3).
- Produces:
  - `type TrackSegmentDraft = { kind: "straight" | "arc"; length: string; radius: string; angle: string; turn: "left" | "right" }`; `TrackDraft.segments?: TrackSegmentDraft[]`
  - `track-segment-draft.ts`: `blankSegment(kind)`, `segmentsToPath(segs): TrackSegment[]`, `pathToSegments(path): TrackSegmentDraft[]`, `arcLengthText(seg): string`, `angleFromArcLength(lengthText, radiusText): string`, `totalRunText(segs): string`, `type TrackPresetId = "single" | "legs" | "u" | "serpentine"`, `TRACK_PRESETS`, `presetSegments(id, runFt, minRadiusFt?)`
  - `TrackSetter = (field: keyof TrackDraft, val: string | boolean | TrackSegmentDraft[]) => void`

- [ ] **Step 1: Write the failing tests**

Add imports:

```ts
import { cleanTrackConfig, freshTrackDraft, trackConfigFromDraft, trackDraftFromConfig, trackLineDesc } from "../src/app/(app)/estimator/track-bom";
import { angleFromArcLength, arcLengthText, pathToSegments, presetSegments, segmentsToPath, totalRunText, TRACK_PRESETS } from "../src/app/(app)/estimator/track-segment-draft";
```

Add (call `segmentDraftChecks(ok);` in `curvedTrackChecks`):

```ts
export function segmentDraftChecks(ok: Ok) {
  const mixed = [S(12), A(6, 90), S(12)];
  ok(JSON.stringify(segmentsToPath(pathToSegments(mixed))) === JSON.stringify(mixed), "#369 draft: path → segments → path round-trips");
  ok(arcLengthText({ kind: "arc", length: "", radius: "6", angle: "90", turn: "left" }) === "9.42", "#369 draft: an arc row shows its arc length");
  ok(angleFromArcLength("10", "6") === "95.493", "#369 draft: typing an arc length back-solves the angle");
  ok(arcLengthText({ kind: "arc", length: "", radius: "", angle: "90", turn: "left" }) === "" && angleFromArcLength("10", "") === "", "#369 draft: no radius, no arc math");
  ok(totalRunText(pathToSegments(mixed)) === "33.42" && totalRunText([]) === "", "#369 draft: the total run reads the segments");

  const fresh = freshTrackDraft([series()]);
  ok(Array.isArray(fresh.segments) && fresh.segments.length === 0, "#369 draft: a new track starts with no segments");
  // fresh drafts default to bi-parting; the description checks below expect one-way
  const d = { ...fresh, operation: "oneway" as const, curved: true, segments: pathToSegments(mixed) };
  const c = trackConfigFromDraft(d);
  ok(JSON.stringify(c.path) === JSON.stringify(mixed) && Math.abs(c.runFt - 33.4248) < 1e-3 && c.radiusFt === 6, "#369 draft: a curved draft saves its path, the run = its length, radiusFt = its tightest arc");
  ok(JSON.stringify(trackConfigFromDraft({ ...fresh, curved: true }).path) === "[]", "#369 draft: curved with no rows saves an empty path (the engine asks for a segment)");
  ok(trackConfigFromDraft({ ...d, curved: false }).path === undefined, "#369 draft: a straight draft saves no path");

  // a legacy curve reopens as one arc and re-saves to the same BOM
  const legacy = cfg({ curved: true, radiusFt: 30 });
  const reopened = trackDraftFromConfig(legacy);
  ok(reopened.segments?.length === 1 && reopened.segments[0].radius === "30" && reopened.segments[0].angle === "76.3944", "#369 draft: a legacy curve reopens as one arc row");
  ok(JSON.stringify(trackQuantities(trackConfigFromDraft(reopened), series()).rows) === JSON.stringify(trackQuantities(legacy, series()).rows), "#369 draft: re-saving a reopened legacy curve keeps its parts");
  ok(trackDraftFromConfig(cfg()).segments?.length === 0, "#369 draft: a straight track reopens with no rows");

  const cleaned = cleanTrackConfig({ ...c, path: [...mixed, { kind: "arc", radiusFt: 9, sweepDeg: 45, turn: "right", junk: 1 } as unknown as TrackSegment] });
  ok(cleaned.path?.length === 4 && !JSON.stringify(cleaned).includes("junk"), "#369 draft: cleanTrackConfig keeps a curved track's path, segment fields only");
  ok(cleanTrackConfig({ ...c, curved: false }).path === undefined, "#369 draft: cleanTrackConfig drops a path off a straight track");

  const s = { name: "ADC 280" };
  ok(trackLineDesc(c, s) === "Track — ADC 280 one-way track, 33.42' run, curved: 3 segments (R6')", "#369 draft: a multi-segment curve says how many segments and its radii");
  ok(trackLineDesc({ ...c, path: [S(10), A(12, 30), S(4), A(2, 90, "right")] }, s).endsWith("curved: 4 segments (R12', R2')"), "#369 draft: distinct radii in path order");
  ok(trackLineDesc(legacy, s) === "Track — ADC 280 one-way track, 40' run, curved R30'", "#369 draft: a single arc keeps today's wording");

  ok(TRACK_PRESETS.map((p) => p.id).join() === "single,legs,u,serpentine", "#369 presets: four shapes");
  for (const p of TRACK_PRESETS) {
    const path = segmentsToPath(presetSegments(p.id, 40, 2));
    ok(pathErrors(path, { ...FACTS, minRadiusFt: 2 }, 1000).length === 0 && Math.abs(pathLengthFt(path) - 40) < 0.6, `#369 presets: ${p.label} is a valid ~40' path`);
  }
  ok(segmentsToPath(presetSegments("single", NaN)).length === 1, "#369 presets: a blank run still makes a preset (40')");
  ok(segmentsToPath(presetSegments("u", 40, 2)).filter((x) => x.kind === "arc").every((x) => x.kind === "arc" && x.sweepDeg === 90 && x.radiusFt === 2), "#369 presets: U wrap has two 90° corners at the series minimum");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx scripts/test-curved-track.ts` → fails to resolve `track-segment-draft`.

- [ ] **Step 3: Add the draft type**

In `src/app/(app)/estimator/types.ts`, directly above `export type TrackDraft = {`:

```ts
/** #369 — one row of a curved track's segment list (form strings; blank = not entered). */
export type TrackSegmentDraft = {
  kind: "straight" | "arc";
  /** Straight only, ft. */
  length: string;
  /** Arc only, ft. */
  radius: string;
  /** Arc only, degrees. */
  angle: string;
  turn: "left" | "right";
};
```

and inside `TrackDraft`, after `walkAlongBipart?: boolean;`:

```ts
  /** #369 — curved only: the segment list (replaces run + radius on a curved track). */
  segments?: TrackSegmentDraft[];
```

In `src/app/(app)/estimator/track-modal.tsx`, change line 32 to:

```ts
export type TrackSetter = (field: keyof TrackDraft, val: string | boolean | TrackSegmentDraft[]) => void;
```

and add `TrackSegmentDraft` to that file's `import type { … } from "./types"`.

- [ ] **Step 4: Create the draft helpers**

Create `src/app/(app)/estimator/track-segment-draft.ts`:

```ts
import { pathLengthFt, type TrackSegment } from "@/lib/track-path";
import type { TrackSegmentDraft } from "./types";

/**
 * #369 — the track configurator's segment rows ↔ a track path, the arc-length
 * helpers, and the four shape presets. Pure.
 */

const RAD = Math.PI / 180;
/** Blank → NaN (the engine names the segment); otherwise Number(). */
const numOf = (s: string) => {
  const t = (s ?? "").trim();
  return t === "" ? NaN : Number(t);
};
const r1 = (n: number) => Math.round(n * 10) / 10;
/** Form text: up to 4 decimals, "" when not a number. */
const txt = (n: number) => (Number.isFinite(n) ? String(Math.round(n * 10000) / 10000) : "");

export function blankSegment(kind: "straight" | "arc"): TrackSegmentDraft {
  return { kind, length: "", radius: "", angle: "", turn: "left" };
}

export function segmentsToPath(segs: readonly TrackSegmentDraft[]): TrackSegment[] {
  return segs.map((s) =>
    s.kind === "straight"
      ? { kind: "straight", lengthFt: numOf(s.length) }
      : { kind: "arc", radiusFt: numOf(s.radius), sweepDeg: numOf(s.angle), turn: s.turn === "right" ? "right" : "left" }
  );
}

export function pathToSegments(path: readonly TrackSegment[]): TrackSegmentDraft[] {
  return path.map((s) =>
    s.kind === "straight" ? { ...blankSegment("straight"), length: txt(s.lengthFt) } : { ...blankSegment("arc"), radius: txt(s.radiusFt), angle: txt(s.sweepDeg), turn: s.turn }
  );
}

const twoDp = (n: number) => String(Math.round(n * 100) / 100);

/** "9.42" — an arc row's length, "" until radius and angle are numbers. */
export function arcLengthText(seg: TrackSegmentDraft): string {
  const r = numOf(seg.radius);
  const a = numOf(seg.angle);
  return r > 0 && a > 0 ? twoDp(r * a * RAD) : "";
}

/** The angle for a typed arc length at the row's radius; "" when either is missing. */
export function angleFromArcLength(lengthText: string, radiusText: string): string {
  const l = numOf(lengthText);
  const r = numOf(radiusText);
  return l > 0 && r > 0 ? txt(l / r / RAD) : "";
}

/** "33.42" — the rows' total, "" when any row is incomplete or there are none. */
export function totalRunText(segs: readonly TrackSegmentDraft[]): string {
  if (!segs.length) return "";
  const L = pathLengthFt(segmentsToPath(segs));
  return Number.isFinite(L) && L > 0 ? twoDp(L) : "";
}

export type TrackPresetId = "single" | "legs" | "u" | "serpentine";
export const TRACK_PRESETS: ReadonlyArray<{ id: TrackPresetId; label: string }> = [
  { id: "single", label: "Single arc" },
  { id: "legs", label: "Arc with straight legs" },
  { id: "u", label: "U wrap" },
  { id: "serpentine", label: "Serpentine" },
];
const PRESET_RUN_FT = 40;
const U_CORNER_FT = 2;

/** A preset's rows sized to `runFt` (40' when blank), never tighter than the series minimum. Editable after. */
export function presetSegments(id: TrackPresetId, runFt: number, minRadiusFt?: number): TrackSegmentDraft[] {
  const run = Number.isFinite(runFt) && runFt > 0 ? runFt : PRESET_RUN_FT;
  const rMin = minRadiusFt && minRadiusFt > 0 ? minRadiusFt : 0;
  const straight = (l: number): TrackSegmentDraft => ({ ...blankSegment("straight"), length: txt(r1(l)) });
  // radius ≥ length / π keeps one arc at most 180°
  const arc = (l: number, turn: "left" | "right", radius = Math.max(rMin, l / Math.PI)): TrackSegmentDraft => {
    const r = r1(radius);
    return { ...blankSegment("arc"), radius: txt(r), angle: txt(r1(l / r / RAD)), turn };
  };
  switch (id) {
    case "single":
      return [arc(run, "left")];
    case "legs":
      return [straight(run * 0.25), arc(run * 0.5, "left"), straight(run * 0.25)];
    case "u": {
      const r = r1(Math.max(rMin, U_CORNER_FT));
      const corner = (): TrackSegmentDraft => ({ ...blankSegment("arc"), radius: txt(r), angle: "90", turn: "left" });
      const middle = Math.max(run * 0.5 - Math.PI * r, run * 0.25);
      return [straight(run * 0.25), corner(), straight(middle), corner(), straight(run * 0.25)];
    }
    case "serpentine": {
      const radius = Math.max(rMin, run / 2 / (Math.PI / 2));
      return [arc(run / 2, "left", radius), arc(run / 2, "right", radius)];
    }
  }
}
```

- [ ] **Step 5: Round-trip the path through `track-bom.ts`**

In `src/app/(app)/estimator/track-bom.ts`:

1. Add imports:

```ts
import { cleanPath, pathLengthFt, resolvePath } from "@/lib/track-path";
import { pathToSegments, segmentsToPath } from "./track-segment-draft";
```

2. `trackLineDesc` — replace the line `if (config.curved && config.radiusFt) desc += \`, curved R${fmtFt(config.radiusFt)}\`;` with:

```ts
  if (config.curved) {
    const path = resolvePath(config) ?? [];
    // #369: a multi-segment curve says how many segments and its radii; a single arc keeps "curved R12'"
    if (path.length > 1) {
      const radii = [...new Set(path.flatMap((s) => (s.kind === "arc" ? [`R${fmtFt(s.radiusFt)}`] : [])))];
      desc += `, curved: ${path.length} segments${radii.length ? ` (${radii.join(", ")})` : ""}`;
    } else if (config.radiusFt) desc += `, curved R${fmtFt(config.radiusFt)}`;
  }
```

3. `cleanTrackConfig` — after `if (out.curved && c.radiusFt != null) out.radiusFt = c.radiusFt;` add:

```ts
  if (out.curved && Array.isArray(c.path)) out.path = cleanPath(c.path);
```

4. `trackConfigFromDraft` — replace `if (d.curved) c.radiusFt = numOf(d.radius);` with:

```ts
  if (d.curved && Array.isArray(d.segments)) {
    // #369: the segments are the track — the run is their length; radiusFt (the tightest arc) keeps an older build reading it as one arc
    const path = segmentsToPath(d.segments);
    c.path = path;
    c.runFt = pathLengthFt(path);
    const radii = path.flatMap((s) => (s.kind === "arc" && Number.isFinite(s.radiusFt) ? [s.radiusFt] : []));
    if (radii.length) c.radiusFt = Math.min(...radii);
  } else if (d.curved) c.radiusFt = numOf(d.radius);
```

5. `trackDraftFromConfig` — add to the returned object, after `walkAlongBipart: …,`:

```ts
    segments: c.curved ? pathToSegments(resolvePath(c) ?? []) : [],
```

6. `freshTrackDraft` — add `segments: [],` after `walkAlongBipart: false,`.

- [ ] **Step 6: Run the tests**

Run: `npx tsx scripts/test-curved-track.ts` → 0 FAIL.
Run: `npx tsc --noEmit -p .` → clean (the `onSet={(field, val) => setTrackDraft((d) => ({ ...d, [field]: val }))}` callers in `steps/build-step.tsx` must still type-check; if TS rejects the wider `val`, change those two lambdas to `({ ...d, [field]: val }) as TrackDraft`).
Run: `npx eslint "src/app/(app)/estimator/track-segment-draft.ts" "src/app/(app)/estimator/track-bom.ts" "src/app/(app)/estimator/types.ts" "src/app/(app)/estimator/track-modal.tsx" scripts/test-curved-track.ts` → clean.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/estimator/types.ts" "src/app/(app)/estimator/track-segment-draft.ts" "src/app/(app)/estimator/track-bom.ts" "src/app/(app)/estimator/track-modal.tsx" "src/app/(app)/estimator/steps/build-step.tsx" scripts/test-curved-track.ts
git commit -m "feat(track): #369 segment rows round-trip to a track path; presets; multi-segment line description

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Layout view shapes

**Files:**
- Create: `src/lib/curtain-cut-sheets/layout.ts`
- Modify: `scripts/test-curved-track.ts`

**Interfaces:**
- Consumes: Task 2's path functions; `partsAtCenter`, `TrackConfig` (track-engine); `hangerSpacingFor`, `TrackSeries` (track-series); `ARCH_SCALES`, `ELEV_TEXT_IN`, `ftIn` (geometry.ts); `textExtent`, `Shape` (shapes.ts).
- Produces (from `@/lib/curtain-cut-sheets/layout`):
  - `type TrackOpening = "bipart" | "oneway" | "none"`
  - `type TrackLayoutSource = { path: TrackSegment[]; lapOverlapFt: number; opening: TrackOpening; mountLabel: "Batten clamps" | "Ceiling hangers"; hangerSpacingFt: number; trackQty: number }`
  - `SUBMITTAL_LAYOUT_BOX = { wIn: 7.9, hIn: 5.6 }`, `CLIENT_LAYOUT_BOX = { wIn: 2.6, hIn: 2.6 }`, `MODAL_LAYOUT_BOX = { wIn: 5, hIn: 2.4 }`
  - `trackLayoutSource(config: TrackConfig, series: Pick<TrackSeries, "overlapFt" | "hangerSpacingFt" | "ceilingSpacingFt" | "battenSpacingFt">): TrackLayoutSource | null`
  - `hangingPointsAlong(src: TrackLayoutSource): number[]`
  - `layoutView(src, opts: { box: { wIn: number; hIn: number }; detail: "submittal" | "client" }): { scale: string; shapes: Shape[]; hangingCount: number }`

- [ ] **Step 1: Write the failing tests**

Add imports:

```ts
import { CLIENT_LAYOUT_BOX, layoutView, SUBMITTAL_LAYOUT_BOX, trackLayoutSource } from "../src/lib/curtain-cut-sheets/layout";
import { ARCH_SCALES } from "../src/lib/curtain-cut-sheets/geometry";
import type { Shape } from "../src/lib/curtain-cut-sheets/shapes";
```

Add (call `layoutViewChecks(ok);` in `curvedTrackChecks`):

```ts
/** Every coordinate a shape draws at (path data parsed for its numbers). */
function coords(shapes: readonly Shape[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const s of shapes) {
    if (s.kind === "line") out.push([s.x1, s.y1], [s.x2, s.y2]);
    else if (s.kind === "text") out.push([s.x, s.y]);
    else if (s.kind === "path") {
      const n = (s.d.match(/-?\d+(\.\d+)?/g) || []).map(Number);
      for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i], n[i + 1]]);
    }
  }
  return out;
}
const texts = (shapes: readonly Shape[]) => shapes.flatMap((s) => (s.kind === "text" ? [s.text] : []));

export function layoutViewChecks(ok: Ok) {
  const s = series();
  ok(trackLayoutSource(cfg(), s) === null, "#369 layout: a straight track has no layout");
  const bi = [S(10), A(8, 180), S(10)];
  const biCfg = cfg({ curved: true, path: bi, runFt: pathLengthFt(bi), operation: "biparting", qty: 2 });
  const src = trackLayoutSource(biCfg, s)!;
  ok(src.opening === "bipart" && src.lapOverlapFt === 2 && src.mountLabel === "Batten clamps" && src.hangerSpacingFt === 7 && src.trackQty === 2, "#369 layout: the source reads the track and series");
  ok(trackLayoutSource({ ...biCfg, mounting: "ceiling", operation: "oneway" }, s)!.mountLabel === "Ceiling hangers" && trackLayoutSource({ ...biCfg, operation: "oneway" }, s)!.opening === "oneway",
    "#369 layout: ceiling mounting → hangers; one-way opens one way");
  ok(trackLayoutSource({ ...biCfg, operation: "walkalong" }, s)!.opening === "none" && trackLayoutSource({ ...biCfg, operation: "walkalong", walkAlongBipart: true }, s)!.opening === "bipart",
    "#369 layout: a walk-along has no travel arrow unless it is a two-half bi-part");
  ok(trackLayoutSource(cfg({ curved: true, path: [A(NaN, 90)], runFt: NaN }), s) === null, "#369 layout: an unfinished path has no layout");

  const sub = layoutView(src, { box: SUBMITTAL_LAYOUT_BOX, detail: "submittal" });
  const engineClamps = trackQuantities(biCfg, s).rows.find((r) => r.role === "battenClamp")!.qty;
  ok(sub.hangingCount * 2 === engineClamps, "#369 layout: the drawn hanging points × tracks equal the engine's clamp count");
  ok(texts(sub.shapes).includes(`Batten clamps (${sub.hangingCount} per track)`), "#369 layout: the caption counts per track when the line has several");
  ok(ARCH_SCALES.some((a) => a.label === sub.scale), "#369 layout: an architectural scale");
  ok(coords(sub.shapes).every(([x, y]) => x >= 0 && y >= 0 && x <= SUBMITTAL_LAYOUT_BOX.wIn && y <= SUBMITTAL_LAYOUT_BOX.hIn), "#369 layout: every Submittal shape lands on the sheet");
  ok(texts(sub.shapes).some((t) => t.startsWith(`R8'-0" · 180° · `)) && texts(sub.shapes).includes(`10'-0"`), "#369 layout: arcs print radius · angle · arc length; straights their length");
  ok(texts(sub.shapes).includes("AUDIENCE") && texts(sub.shapes).includes(`2'-0" lap`), "#369 layout: the audience and the bi-part lap are labelled");
  ok(sub.shapes.some((x) => x.tag === "mark"), "#369 layout: the Submittal draws hanging-point and split marks");

  const semi = trackLayoutSource(cfg({ curved: true, path: [A(10, 180)], runFt: 10 * Math.PI }), s)!;
  const semiView = layoutView(semi, { box: SUBMITTAL_LAYOUT_BOX, detail: "submittal" });
  ok(texts(semiView.shapes).includes(`20'-0" overall`) && texts(semiView.shapes).includes(`10'-0" deep`), "#369 layout: the footprint prints overall width and depth");

  const cli = layoutView(src, { box: CLIENT_LAYOUT_BOX, detail: "client" });
  ok(!cli.shapes.some((x) => x.tag === "mark") && !texts(cli.shapes).some((t) => t.includes("clamps")) && !texts(cli.shapes).some((t) => t.includes("°")),
    "#369 layout: the Client view has no hanging points, no angles");
  ok(texts(cli.shapes).includes("AUDIENCE") && texts(cli.shapes).includes(`R8'-0"`), "#369 layout: the Client view keeps the radius and the audience");
  ok(coords(cli.shapes).every(([x, y]) => x >= 0 && y >= 0 && x <= CLIENT_LAYOUT_BOX.wIn && y <= CLIENT_LAYOUT_BOX.hIn), "#369 layout: every Client shape lands in its box");
  const u = trackLayoutSource(cfg({ curved: true, path: segmentsToPath(presetSegments("u", 40, 2)), runFt: 40 }), series({ minRadiusFt: 2 }))!;
  ok(coords(layoutView(u, { box: SUBMITTAL_LAYOUT_BOX, detail: "submittal" }).shapes).every(([x, y]) => x >= 0 && y >= 0 && x <= SUBMITTAL_LAYOUT_BOX.wIn && y <= SUBMITTAL_LAYOUT_BOX.hIn),
    "#369 layout: a U wrap fits the sheet");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx scripts/test-curved-track.ts` → fails to resolve `layout`.

- [ ] **Step 3: Write the shape builder**

Create `src/lib/curtain-cut-sheets/layout.ts`:

```ts
/**
 * Curtain cut sheets (#369) — the plan view of a curtain's curved track as
 * pure shapes in PAPER INCHES (like the elevation). The track configurator's
 * mini plan draws the same shapes. Hanging points come from the track path's
 * legHangingPoints — the function the track engine counts with — so the
 * caption always equals the hardware table. The open (concave) side of the
 * curve faces the audience, drawn at the bottom.
 */
import { partsAtCenter, type TrackConfig } from "@/lib/track-engine";
import { hangerSpacingFor, type TrackSeries } from "@/lib/track-series";
import { audienceFrame, legHangingPoints, pathLengthFt, pointAt, resolvePath, samplePath, segmentBounds, segmentStarts, trackLegs, type TrackSegment } from "@/lib/track-path";
import { ARCH_SCALES, ELEV_TEXT_IN, ftIn } from "./geometry";
import { textExtent, type Shape } from "./shapes";

export type TrackOpening = "bipart" | "oneway" | "none";
export type TrackLayoutSource = {
  path: TrackSegment[];
  /** The bi-part lap at center, ft; 0 = one leg. */
  lapOverlapFt: number;
  opening: TrackOpening;
  mountLabel: "Batten clamps" | "Ceiling hangers";
  hangerSpacingFt: number;
  /** Identical tracks on the line — the caption says "per track" when > 1. */
  trackQty: number;
};

export const SUBMITTAL_LAYOUT_BOX = { wIn: 7.9, hIn: 5.6 } as const;
export const CLIENT_LAYOUT_BOX = { wIn: 2.6, hIn: 2.6 } as const;
export const MODAL_LAYOUT_BOX = { wIn: 5, hIn: 2.4 } as const;
/** Room kept around the drawn track for dimensions and labels, in. */
const MARGIN_IN = { submittal: 0.7, client: 0.4 } as const;

const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const deg = (n: number) => String(Math.round(n * 10) / 10);
const pathD = (pts: ReadonlyArray<{ x: number; y: number }>) => "M" + pts.map((p) => `${r4(p.x)} ${r4(p.y)}`).join(" L");

/** The layout a track line describes; null for a straight track or a curve with no usable path. */
export function trackLayoutSource(
  config: TrackConfig,
  series: Pick<TrackSeries, "overlapFt" | "hangerSpacingFt" | "ceilingSpacingFt" | "battenSpacingFt">
): TrackLayoutSource | null {
  const path = resolvePath(config);
  if (!path || !path.length || !(pathLengthFt(path) > 0)) return null;
  const bipart = partsAtCenter(config);
  return {
    path,
    lapOverlapFt: bipart && series.overlapFt > 0 ? series.overlapFt : 0,
    opening: bipart ? "bipart" : config.operation === "walkalong" ? "none" : "oneway",
    mountLabel: config.mounting === "ceiling" ? "Ceiling hangers" : "Batten clamps",
    hangerSpacingFt: positive(config.hangerSpacingFt) ? config.hangerSpacingFt : hangerSpacingFor(series, config.mounting),
    trackQty: Number.isInteger(config.qty) && config.qty > 0 ? config.qty : 1,
  };
}

/** Every hanging point on ONE track, as path distances (both legs of a lapped bi-part). */
export function hangingPointsAlong(src: TrackLayoutSource): number[] {
  return trackLegs(pathLengthFt(src.path), src.lapOverlapFt).flatMap((leg) => legHangingPoints(src.path, leg, src.hangerSpacingFt));
}

export function layoutView(
  src: TrackLayoutSource,
  opts: { box: { wIn: number; hIn: number }; detail: "submittal" | "client" }
): { scale: string; shapes: Shape[]; hangingCount: number } {
  const { box, detail } = opts;
  const sub = detail === "submittal";
  const M = MARGIN_IN[detail];
  const path = src.path;
  const L = pathLengthFt(path);
  const frame = audienceFrame(path);
  const framed = samplePath(path, L / 600).map(frame);
  const minX = Math.min(...framed.map((p) => p.x));
  const maxX = Math.max(...framed.map((p) => p.x));
  const minY = Math.min(...framed.map((p) => p.y));
  const maxY = Math.max(...framed.map((p) => p.y));
  const widthFt = maxX - minX;
  const depthFt = maxY - minY;
  const availW = box.wIn - 2 * M;
  const availH = box.hIn - 2 * M;
  const scale = ARCH_SCALES.find((a) => widthFt * a.inPerFt <= availW + 1e-9 && depthFt * a.inPerFt <= availH + 1e-9) ?? ARCH_SCALES[ARCH_SCALES.length - 1];
  const s = scale.inPerFt;
  const ox = M + (availW - widthFt * s) / 2;
  const oy = M + (availH - depthFt * s) / 2;
  /** World feet → paper inches (y down; upstage at the top). */
  const P = (q: { x: number; y: number }) => {
    const f = frame(q);
    return { x: ox + (f.x - minX) * s, y: oy + (maxY - f.y) * s };
  };
  const at = (d: number) => P(pointAt(path, d));
  const paper = samplePath(path, L / 600).map(P);
  const cx = paper.reduce((a, p) => a + p.x, 0) / paper.length;
  const cy = paper.reduce((a, p) => a + p.y, 0) / paper.length;
  /** The unit normal at `d`, pointing away from the drawing's center (labels go outside the curve). */
  const normal = (d: number) => {
    const a = at(Math.max(0, d - 0.01));
    const b = at(Math.min(L, d + 0.01));
    const tl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let nx = -(b.y - a.y) / tl;
    let ny = (b.x - a.x) / tl;
    const p = at(d);
    if ((p.x - cx) * nx + (p.y - cy) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    return { nx, ny };
  };
  const shapes: Shape[] = [{ kind: "path", tag: "panel", d: pathD(paper), stroke: "heavy" }];

  // each segment's dimension; an arc's radius back to its center (Submittal)
  const bounds = segmentBounds(path);
  const starts = segmentStarts(path);
  path.forEach((seg, i) => {
    const a = bounds[i];
    const z = bounds[i + 1];
    const mid = (a + z) / 2;
    const p = at(mid);
    const { nx, ny } = normal(mid);
    const text = seg.kind === "straight" ? ftIn(seg.lengthFt) : sub ? `R${ftIn(seg.radiusFt)} · ${deg(seg.sweepDeg)}° · ${ftIn(z - a)}` : `R${ftIn(seg.radiusFt)}`;
    const x = p.x + nx * 0.18;
    const y = p.y + ny * 0.18 + ELEV_TEXT_IN * 0.35;
    const ext = textExtent({ x, text, size: ELEV_TEXT_IN, anchor: "middle" });
    // a label far longer than its drawn segment is left off rather than overlapping its neighbours
    if (ext.x1 - ext.x0 <= (z - a) * s + 0.8 && ext.x0 >= 0 && ext.x1 <= box.wIn && y >= ELEV_TEXT_IN && y <= box.hIn)
      shapes.push({ kind: "text", x, y, text, size: ELEV_TEXT_IN, anchor: "middle" });
    const c = starts[i].center;
    if (sub && seg.kind === "arc" && c) {
      const pc = P(c);
      if (pc.x > 0.1 && pc.x < box.wIn - 0.1 && pc.y > 0.1 && pc.y < box.hIn - 0.1) {
        shapes.push(
          { kind: "line", tag: "dim", x1: p.x, y1: p.y, x2: pc.x, y2: pc.y, stroke: "thin", dash: true },
          { kind: "line", tag: "dim", x1: pc.x - 0.06, y1: pc.y, x2: pc.x + 0.06, y2: pc.y, stroke: "thin" },
          { kind: "line", tag: "dim", x1: pc.x, y1: pc.y - 0.06, x2: pc.x, y2: pc.y + 0.06, stroke: "thin" }
        );
      }
    }
  });

  // footprint: overall width above, depth to the right
  const top = oy;
  const bottom = oy + depthFt * s;
  const left = ox;
  const right = ox + widthFt * s;
  const wy = top - 0.28;
  shapes.push(
    { kind: "line", tag: "dim", x1: left, y1: wy, x2: right, y2: wy, stroke: "thin" },
    { kind: "line", tag: "dim", x1: left, y1: wy - 0.04, x2: left, y2: wy + 0.08, stroke: "thin" },
    { kind: "line", tag: "dim", x1: right, y1: wy - 0.04, x2: right, y2: wy + 0.08, stroke: "thin" },
    { kind: "text", x: (left + right) / 2, y: wy - 0.05, text: `${ftIn(widthFt)} overall`, size: ELEV_TEXT_IN, anchor: "middle" }
  );
  if (depthFt * s > 0.05) {
    const dx = right + 0.28;
    shapes.push(
      { kind: "line", tag: "dim", x1: dx, y1: top, x2: dx, y2: bottom, stroke: "thin" },
      { kind: "line", tag: "dim", x1: dx - 0.08, y1: top, x2: dx + 0.04, y2: top, stroke: "thin" },
      { kind: "line", tag: "dim", x1: dx - 0.08, y1: bottom, x2: dx + 0.04, y2: bottom, stroke: "thin" },
      { kind: "text", x: dx + 0.12, y: (top + bottom) / 2, text: `${ftIn(depthFt)} deep`, size: ELEV_TEXT_IN, anchor: "middle", rotate: -90 }
    );
  }

  if (sub && src.opening === "bipart") {
    // the center split, and the lap as a second line beside the track
    const mid = L / 2;
    const p = at(mid);
    const { nx, ny } = normal(mid);
    shapes.push({ kind: "line", tag: "mark", x1: p.x - nx * 0.12, y1: p.y - ny * 0.12, x2: p.x + nx * 0.12, y2: p.y + ny * 0.12, stroke: "med" });
    if (src.lapOverlapFt > 0) {
      const h = Math.min(src.lapOverlapFt, L) / 2;
      const lap = Array.from({ length: 13 }, (_, k) => mid - h + (2 * h * k) / 12).map((d) => {
        const q = at(d);
        const n = normal(d);
        return { x: q.x - n.nx * 0.05, y: q.y - n.ny * 0.05 };
      });
      shapes.push(
        { kind: "path", tag: "band", d: pathD(lap), stroke: "med" },
        { kind: "text", x: p.x - nx * 0.24, y: p.y - ny * 0.24 + ELEV_TEXT_IN * 0.35, text: `${ftIn(src.lapOverlapFt)} lap`, size: ELEV_TEXT_IN * 0.9, anchor: "middle" }
      );
    }
  }

  // which way each half travels as it opens (Submittal)
  const arrow = (d: number, dir: 1 | -1) => {
    const len = Math.min(0.3, (L * s) / 6);
    const { nx, ny } = normal(d);
    const off = (q: { x: number; y: number }) => ({ x: q.x - nx * 0.14, y: q.y - ny * 0.14 });
    const p0 = off(at(d));
    const p1 = off(at(Math.min(L, Math.max(0, d + (dir * len) / s))));
    const tl = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
    const ux = (p1.x - p0.x) / tl;
    const uy = (p1.y - p0.y) / tl;
    const hd = 0.05;
    shapes.push(
      { kind: "line", tag: "dim", x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y, stroke: "thin" },
      { kind: "path", tag: "dim", d: pathD([{ x: p1.x - ux * hd - uy * hd * 0.6, y: p1.y - uy * hd + ux * hd * 0.6 }, p1, { x: p1.x - ux * hd + uy * hd * 0.6, y: p1.y - uy * hd - ux * hd * 0.6 }]), stroke: "thin" }
    );
  };
  if (sub && src.opening === "bipart") {
    arrow(L * 0.4, -1);
    arrow(L * 0.6, 1);
  } else if (sub && src.opening === "oneway") arrow(L * 0.5, 1);

  const points = hangingPointsAlong(src);
  if (sub) {
    for (const d of points) {
      const p = at(d);
      const { nx, ny } = normal(d);
      shapes.push({ kind: "line", tag: "mark", x1: p.x - nx * 0.06, y1: p.y - ny * 0.06, x2: p.x + nx * 0.06, y2: p.y + ny * 0.06, stroke: "thin" });
    }
    shapes.push({ kind: "text", x: 0.15, y: box.hIn - 0.15, text: `${src.mountLabel} (${points.length}${src.trackQty > 1 ? " per track" : ""})`, size: ELEV_TEXT_IN, bold: true });
  }

  // the audience, below the open side of the curve
  const ax = box.wIn / 2;
  const ay = Math.min(bottom + 0.3, box.hIn - 0.3);
  shapes.push(
    { kind: "line", tag: "dim", x1: ax, y1: ay, x2: ax, y2: ay + 0.12, stroke: "thin" },
    { kind: "path", tag: "dim", d: pathD([{ x: ax - 0.04, y: ay + 0.08 }, { x: ax, y: ay + 0.12 }, { x: ax + 0.04, y: ay + 0.08 }]), stroke: "thin" },
    { kind: "text", x: ax, y: ay + 0.24, text: "AUDIENCE", size: ELEV_TEXT_IN, anchor: "middle", bold: true }
  );
  return { scale: scale.label, shapes, hangingCount: points.length };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx tsx scripts/test-curved-track.ts` → 0 FAIL. If an "on the sheet" check fails, print the offending coordinate and the shape it came from; adjust that shape's offset (don't loosen the check).
Run: `npx tsc --noEmit -p .` and `npx eslint src/lib/curtain-cut-sheets/layout.ts scripts/test-curved-track.ts` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/curtain-cut-sheets/layout.ts scripts/test-curved-track.ts
git commit -m "feat(cutsheets): #369 curved track layout view — segments, footprint, lap, hanging points, audience

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Track configurator — segment list, presets, mini plan

**Files:**
- Create: `src/app/(app)/estimator/track-segments.tsx`
- Modify: `src/app/(app)/estimator/track-modal.tsx`
- Modify: `src/app/(app)/estimator/curtain-modal.tsx` (only if it gates errors on `run` — see Step 4)
- Modify: `scripts/test-curved-track.ts`

**Interfaces:**
- Consumes: `TrackSegmentDraft`, `TrackSetter` (Task 4); `blankSegment`, `arcLengthText`, `angleFromArcLength`, `totalRunText`, `presetSegments`, `TRACK_PRESETS` (Task 4); `trackConfigFromDraft` (track-bom); `trackLayoutSource`, `layoutView`, `MODAL_LAYOUT_BOX` (Task 5); `pathErrors`, `MAX_TRACK_SEGMENTS` (Task 2); `ShapeSvg` (`@/components/cutsheets/shape-svg`); `FIELD`, `LBL`, `NUMFIELD`, `segBtn` (`./est-ui`).
- Produces: `TrackSegmentsEditor({ draft, current, onSet, disabled? })`.

- [ ] **Step 1: Write the failing source checks**

Add (call `configuratorChecks(ok);` in `curvedTrackChecks`):

```ts
export function configuratorChecks(ok: Ok) {
  const modal = src("src/app/(app)/estimator/track-modal.tsx");
  const editor = src("src/app/(app)/estimator/track-segments.tsx");
  ok(modal.includes('import { TrackSegmentsEditor } from "./track-segments";') && /\{draft\.curved && <TrackSegmentsEditor /.test(modal), "#369 UI: the track fields show the segment editor on a curved track");
  ok(/draft\.curved \? !\(draft\.segments \|\| \[\]\)\.length : !draft\.run\.trim\(\)/.test(modal), "#369 UI: an untouched curved form (no rows) shows no errors; a straight one keys off the run");
  ok(editor.includes("TRACK_PRESETS.map") && editor.includes("+ Add segment") && editor.includes("Total run"), "#369 UI: presets, + Add segment and the total run");
  ok(editor.includes("layoutView(") && editor.includes("MODAL_LAYOUT_BOX") && editor.includes("<ShapeSvg"), "#369 UI: the live mini plan uses the cut sheet's layout shapes");
  ok(editor.includes("MAX_TRACK_SEGMENTS") && editor.includes("angleFromArcLength("), "#369 UI: the 12-segment cap and the arc-length back-solve");
  ok(!/@\/lib\/stores\/|@\/db/.test(editor), "#369 UI: the segment editor imports no store or db");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx scripts/test-curved-track.ts` → FAIL (the file doesn't exist yet — `readFileSync` throws; that's the expected failure).

- [ ] **Step 3: Create the editor**

Create `src/app/(app)/estimator/track-segments.tsx`:

```tsx
"use client";

import type { CSSProperties } from "react";
import { ShapeSvg } from "@/components/cutsheets/shape-svg";
import { layoutView, MODAL_LAYOUT_BOX, trackLayoutSource } from "@/lib/curtain-cut-sheets/layout";
import { MAX_RUN_FT } from "@/lib/track-engine";
import { MAX_TRACK_SEGMENTS, pathErrors } from "@/lib/track-path";
import { seriesSticks, type TrackSeries } from "@/lib/track-series";
import { FIELD, LBL, NUMFIELD, segBtn } from "./est-ui";
import { trackConfigFromDraft } from "./track-bom";
import type { TrackSetter } from "./track-modal";
import { angleFromArcLength, arcLengthText, blankSegment, presetSegments, totalRunText, TRACK_PRESETS } from "./track-segment-draft";
import type { TrackDraft, TrackSegmentDraft } from "./types";

/**
 * #369 — a curved track's segment list: Straight / Arc rows in order, four
 * shape presets, the total run, and a live mini plan drawn with the cut
 * sheet's own layout shapes. Errors come from the engine (the modal lists them).
 */
const ROW: CSSProperties = { display: "grid", gridTemplateColumns: "20px 1.3fr 1fr 1fr 1fr 1.2fr auto", gap: 8, alignItems: "center", marginBottom: 6 };
const ICON: CSSProperties = { border: "1px solid #e4e7ec", background: "#fff", borderRadius: 6, width: 24, height: 24, fontSize: 11, color: "#5b616e", cursor: "pointer", padding: 0 };

export function TrackSegmentsEditor({ draft, current, onSet }: { draft: TrackDraft; current: TrackSeries | null; onSet: TrackSetter }) {
  const segs = draft.segments || [];
  const set = (next: TrackSegmentDraft[]) => onSet("segments", next);
  const patch = (i: number, p: Partial<TrackSegmentDraft>) => set(segs.map((s, k) => (k === i ? { ...s, ...p } : s)));
  const move = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= segs.length) return;
    const next = segs.slice();
    [next[i], next[j]] = [next[j], next[i]];
    set(next);
  };
  const runNow = Number(totalRunText(segs) || draft.run);
  const config = trackConfigFromDraft(draft);
  const clean =
    !!current &&
    !!config.path &&
    pathErrors(config.path, { name: current.name, curvedSectionFt: current.curvedSectionFt, minRadiusFt: current.minRadiusFt, hasSticks: seriesSticks(current).length > 0 }, MAX_RUN_FT).length === 0;
  const src = clean && current ? trackLayoutSource(config, current) : null;
  const view = src ? layoutView(src, { box: MODAL_LAYOUT_BOX, detail: "client" }) : null;

  return (
    <div style={{ marginBottom: 16 }}>
      <label style={LBL}>Shape presets</label>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 12 }}>
        {TRACK_PRESETS.map((p) => (
          <button key={p.id} type="button" style={segBtn(false)} onClick={() => set(presetSegments(p.id, runNow, current?.minRadiusFt))}>
            {p.label}
          </button>
        ))}
      </div>

      <label style={LBL}>Segments</label>
      {segs.map((s, i) => (
        <div key={i} style={ROW}>
          <span style={{ fontSize: 11, color: "#8c919c", fontFamily: "var(--font-mono)" }}>{i + 1}</span>
          <div style={{ display: "flex", gap: 4 }}>
            <button type="button" style={segBtn(s.kind === "straight")} onClick={() => patch(i, { kind: "straight" })}>
              Straight
            </button>
            <button type="button" style={segBtn(s.kind === "arc")} onClick={() => patch(i, { kind: "arc" })}>
              Arc
            </button>
          </div>
          {s.kind === "straight" ? (
            <>
              <input className="est-input est-field" value={s.length} onChange={(e) => patch(i, { length: e.target.value })} placeholder="Length ft" aria-label={`Segment ${i + 1} length (ft)`} style={NUMFIELD} />
              <span />
              <span />
              <span />
            </>
          ) : (
            <>
              <input className="est-input est-field" value={s.radius} onChange={(e) => patch(i, { radius: e.target.value })} placeholder={current?.minRadiusFt ? `R min ${current.minRadiusFt}` : "Radius ft"} aria-label={`Segment ${i + 1} radius (ft)`} style={NUMFIELD} />
              <input className="est-input est-field" value={s.angle} onChange={(e) => patch(i, { angle: e.target.value })} placeholder="Angle °" aria-label={`Segment ${i + 1} angle (degrees)`} style={NUMFIELD} />
              <input
                className="est-input est-field"
                value={arcLengthText(s)}
                onChange={(e) => patch(i, { angle: angleFromArcLength(e.target.value, s.radius) })}
                placeholder="Arc ft"
                title="Type an arc length to set the angle"
                aria-label={`Segment ${i + 1} arc length (ft)`}
                style={NUMFIELD}
              />
              <div style={{ display: "flex", gap: 4 }}>
                <button type="button" style={segBtn(s.turn === "left")} onClick={() => patch(i, { turn: "left" })}>
                  Left
                </button>
                <button type="button" style={segBtn(s.turn === "right")} onClick={() => patch(i, { turn: "right" })}>
                  Right
                </button>
              </div>
            </>
          )}
          <div style={{ display: "flex", gap: 3 }}>
            <button type="button" style={ICON} aria-label={`Move segment ${i + 1} up`} onClick={() => move(i, -1)} disabled={i === 0}>
              ↑
            </button>
            <button type="button" style={ICON} aria-label={`Move segment ${i + 1} down`} onClick={() => move(i, 1)} disabled={i === segs.length - 1}>
              ↓
            </button>
            <button type="button" style={ICON} aria-label={`Remove segment ${i + 1}`} onClick={() => set(segs.filter((_, k) => k !== i))}>
              ✕
            </button>
          </div>
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
        <button type="button" style={segBtn(false)} disabled={segs.length >= MAX_TRACK_SEGMENTS} onClick={() => set([...segs, blankSegment(segs.length ? "straight" : "arc")])}>
          + Add segment
        </button>
        <span style={{ fontSize: 12, color: "#5b616e" }}>
          Total run <strong style={{ fontFamily: "var(--font-mono)" }}>{totalRunText(segs) ? `${totalRunText(segs)}′` : "—"}</strong>
        </span>
      </div>
      {view && (
        <div style={{ ...FIELD, marginTop: 10, padding: 6, background: "#fff" }}>
          <ShapeSvg idPrefix="track-modal-layout" shapes={view.shapes} viewBox={`0 0 ${MODAL_LAYOUT_BOX.wIn} ${MODAL_LAYOUT_BOX.hIn}`} hatch={0.05} style={{ width: "100%", height: "auto" }} title="Track layout preview" />
        </div>
      )}
    </div>
  );
}
```

If `MAX_RUN_FT` is not exported from `track-engine.ts`, it is (`export const MAX_RUN_FT = 1000;` ~line 81) — import it as written. If `FIELD` carries a fixed height that crushes the preview, use `{ border: "1px solid #e4e7ec", borderRadius: 8, marginTop: 10, padding: 6, background: "#fff" }` instead.

- [ ] **Step 4: Show it in curved mode and fix error gating**

In `src/app/(app)/estimator/track-modal.tsx`:

1. Add `import { TrackSegmentsEditor } from "./track-segments";` with the other local imports.
2. In `TrackFields`, the run/radius/trim/qty grid: when `draft.curved`, the first two cells change. Replace the **Run** cell's `<div>…</div>` and the **Radius** cell's `<div>…</div>` with:

```tsx
        {draft.curved ? (
          <div style={{ gridColumn: "span 2" }}>
            <label style={LBL}>Run · along the track (ft)</label>
            <div style={{ ...NUMFIELD, display: "flex", alignItems: "center", background: "#f7f8fa", color: "#5b616e" }} aria-label="Total run (ft)">
              {totalRunText(draft.segments || []) || "—"}
            </div>
          </div>
        ) : (
          <>
            <div>
              <label style={LBL}>Run (ft)</label>
              <input className="est-input est-field" value={draft.run} onChange={(e) => onSet("run", e.target.value)} placeholder="0" aria-label="Run length (ft)" style={NUMFIELD} />
            </div>
            <div>
              <label style={LBL}>Radius (ft)</label>
              <input className="est-input est-field" value="" disabled placeholder="—" aria-label="Curve radius (ft)" style={{ ...NUMFIELD, background: "#f7f8fa" }} />
            </div>
          </>
        )}
```

   and add `import { totalRunText } from "./track-segment-draft";`.
3. Directly after that grid's closing `</div>` (before the `{/* spacing — collapsed … */}` comment), add:

```tsx
      {draft.curved && <TrackSegmentsEditor draft={draft} current={current} onSet={onSet} />}
```

4. In `TrackModal`, change the `errors` line to:

```ts
  const blank = draft.curved ? !(draft.segments || []).length : !draft.run.trim();
  const errors = readOnly ? [TRACK_SERIES_GONE] : noSeries || blank ? [] : bom.errors;
```

   and update the comment above it to: `// An untouched form (no run, or a curve with no rows) is not a mistake — Add stays disabled without shouting.`
   Rewrite the check's regex in Step 1 if you name the variable differently — the check expects the expression `draft.curved ? !(draft.segments || []).length : !draft.run.trim()` verbatim.
5. Open `src/app/(app)/estimator/curtain-modal.tsx` around line 93. If its track step hides errors on `!track.run.trim()`, apply the same `blank` rule there.
6. When **Curved** is pressed on a draft with no rows, nothing auto-fills: the presets and **+ Add segment** are right there, and the engine says "Add a segment to the curve." once a row exists.

- [ ] **Step 5: Run checks and the build**

Run: `npx tsx scripts/test-curved-track.ts` → 0 FAIL.
Run: `npx tsc --noEmit -p .`, `npx eslint "src/app/(app)/estimator/track-segments.tsx" "src/app/(app)/estimator/track-modal.tsx" "src/app/(app)/estimator/curtain-modal.tsx"` → clean.
Run: `npx next build` → succeeds (catches a client component pulling a server-only module).

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/estimator/track-segments.tsx" "src/app/(app)/estimator/track-modal.tsx" "src/app/(app)/estimator/curtain-modal.tsx" scripts/test-curved-track.ts
git commit -m "feat(track): #369 curved tracks edit as a segment list with presets and a live plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Layout sheet on the cut sheets

**Files:**
- Modify: `src/lib/curtain-cut-sheets/estimator-curtains.ts` (`CutSheetMount`, the track branch ~line 157, `curtainTypeKey` ~line 366)
- Modify: `src/lib/curtain-cut-sheets/geometry.ts` (`elevation` input + width text)
- Modify: `src/lib/curtain-cut-sheets/model.ts`
- Modify: `src/lib/curtain-cut-sheets/load.ts` (~lines 104–119)
- Modify: `src/components/cutsheets/cut-sheet-pages.tsx`
- Modify: `scripts/test-curved-track.ts`

**Interfaces:**
- Consumes: `trackLayoutSource`, `layoutView`, `SUBMITTAL_LAYOUT_BOX`, `CLIENT_LAYOUT_BOX`, `type TrackLayoutSource` (Task 5); `pathSignature` (Task 2); `CUT_SHEET_STAMP` (Task 1).
- Produces:
  - `CutSheetMount.track.layout?: TrackLayoutSource`
  - `CutSheetModel.layout: { sheetNo: string; scale: string; shapes: Shape[]; box: { wIn: number; hIn: number }; hangingCount: number; titleBlock: TitleBlockData | null } | null`
  - `layoutSourceOf(type: CurtainType): TrackLayoutSource | null`, `cutSheetPageCount(type: CurtainType): number`, `submittalSheetIndexes(types: readonly CurtainType[]): { starts: number[]; total: number }` (model.ts)

- [ ] **Step 1: Write the failing tests**

Add imports:

```ts
import { cutSheetPageCount, submittalSheetIndexes } from "../src/lib/curtain-cut-sheets/model";
```

(merge into the existing model import). Add (call `curvedCutSheetChecks(ok);` in `curvedTrackChecks`):

```ts
/** A track line built the way the Estimator builds one: components from the engine's rows. */
function trackItem(id: number, c: TrackConfig, s: TrackSeries, key: string): SpecItem {
  const rows = trackQuantities(c, s).rows;
  return line(id, {
    sku: "TRK-ADC-280", desc: "Main track", unit: "lot", track: c, curtainTrackKey: key,
    components: rows.map((r) => ({ sku: r.sku || s.parts[r.role]?.sku || r.role, label: r.role, role: ["battenClamp", "ceilingHanger"].includes(r.role) ? "mount" : "other", qty: r.qty, unit: "ea", cost: 1, price: 2 })),
  } as Partial<SpecItem>);
}

export function curvedCutSheetChecks(ok: Ok) {
  const s = series();
  const bi = [S(10), A(8, 180), S(10)];
  const curvedCfg = cfg({ curved: true, path: bi, runFt: pathLengthFt(bi), operation: "biparting" });
  const r = collect([curtain(1, { curtainTrackKey: "ct-1-a" }), trackItem(2, curvedCfg, s, "ct-1-a")], [s]);
  const t = r.types[0];
  ok(r.types.length === 1 && !!t.curtains[0].mount.track?.layout, "#369 sheets: a curtain on a curved track carries its layout");
  ok(cutSheetPageCount(t) === 2, "#369 sheets: a curved type prints two Submittal pages");
  const sub = cutSheetModel(t, { ...CTX, index: 1, total: 2, style: "submittal" });
  ok(sub.layout?.sheetNo === "CS-1.1" && sub.layout.titleBlock?.sheet.number === "CS-1.1" && sub.layout.titleBlock.sheet.title === "Layout — Main Drape",
    "#369 sheets: the layout sheet is CS-n.1, titled Layout — <title>");
  ok(sub.layout?.titleBlock?.sheet.index === 2 && sub.layout.titleBlock.sheet.total === 2 && sub.layout.titleBlock.stamp === CUT_SHEET_STAMP && sub.layout.titleBlock.scale === `Plan ${sub.layout.scale}`,
    "#369 sheets: the layout sheet is the next sheet in the set, stamped, at its plan scale");
  const clamps = t.hardware.find((h) => h.sku === "P-battenClamp")!.qty;
  ok(sub.layout!.hangingCount === clamps, "#369 sheets: the layout's hanging points equal the hardware table");
  ok(sub.elevation.shapes.some((x) => x.kind === "text" && x.text === `20'-0" along track`), "#369 sheets: a curved curtain's elevation width reads along the track");
  const cli = cutSheetModel(t, { ...CTX, style: "client" });
  ok(cli.layout !== null && cli.layout.titleBlock === null && !cli.layout.shapes.some((x) => x.tag === "mark"), "#369 sheets: the Client layout is the simple drawing, no title block");
  ok(!/"sku"/.test(JSON.stringify(cli)), "#369 sheets: the Client model still carries no SKU");

  // types split by layout; straight work is unchanged
  const other = [S(6), A(8, 180), S(6)];
  const two = collect([
    curtain(1, { curtainTrackKey: "ct-1-a" }), trackItem(2, curvedCfg, s, "ct-1-a"),
    curtain(3, { curtainTrackKey: "ct-3-b" }), trackItem(4, cfg({ curved: true, path: other, runFt: pathLengthFt(other), operation: "biparting" }), s, "ct-3-b"),
  ], [s]);
  ok(two.types.length === 2, "#369 sheets: curtains on different layouts are separate types");
  const straight = collect([curtain(1, { curtainTrackKey: "ct-1-a" }), trackItem(2, cfg({ operation: "biparting" }), s, "ct-1-a")], [s]).types[0];
  ok(cutSheetPageCount(straight) === 1 && cutSheetModel(straight, { ...CTX, style: "submittal" }).layout === null && !straight.curtains[0].mount.track?.layout,
    "#369 sheets: a straight track prints one sheet and no layout");
  ok(!straight.key.includes(":path:"), "#369 sheets: a straight track's type key is unchanged");
  const idx = submittalSheetIndexes([t, straight, t]);
  ok(idx.starts.join() === "1,3,4" && idx.total === 5, "#369 sheets: Submittal sheet numbers count layout sheets");

  const pages = src("src/components/cutsheets/cut-sheet-pages.tsx");
  ok(pages.includes("function LayoutSheet") && /\{m\.layout && <LayoutSheet m=\{m\} \/>\}/.test(pages) && pages.includes("Track layout"), "#369 sheets: the Submittal set prints the layout sheet; the Client sheet the Track layout");
  ok((pages.match(/<Stamp \/>/g) || []).length >= 3, "#369 sheets: the layout sheet is stamped too");
  ok(src("src/lib/curtain-cut-sheets/load.ts").includes("submittalSheetIndexes(result.types)"), "#369 sheets: load numbers the Submittal sheets with submittalSheetIndexes");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx scripts/test-curved-track.ts` → FAIL (import errors for the new model exports, or FAIL lines).

- [ ] **Step 3: Carry the layout through the reader and the type key**

In `src/lib/curtain-cut-sheets/estimator-curtains.ts`:

1. Imports: add `import { pathSignature } from "@/lib/track-path";` and `import { trackLayoutSource, type TrackLayoutSource } from "./layout";`.
2. In `CutSheetMount.track`, after `twoHalfWalkAlong?: boolean;`:

```ts
    /** #369 — a curved track's plan (series known); drives the CS-n.1 layout sheet. */
    layout?: TrackLayoutSource;
```

3. In `estimatorCurtains`, in the `if (trackLine?.track) {` branch, right after `if (!series) warnings.push(TRACK_SERIES_GONE_WARNING);` add:

```ts
        // #369: a curved track's plan — needs the series for its lap and hanger spacing
        const layout = series ? trackLayoutSource(cfg, series) : null;
```

   and inside the `track: { … }` object, after the `carrierSpacingIn: …,` line:

```ts
            ...(layout ? { layout } : {}),
```

4. In `curtainTypeKey`, change the last element to:

```ts
    // #354 review: a two-half walk-along never merges with another hang (the sheet states it).
    // #369: a curved track's layout is part of its type — different paths print different layout sheets.
    c.mount.track
      ? `track:${c.mount.track.seriesId}:${c.mount.track.carrierSpacingIn}${c.mount.track.twoHalfWalkAlong ? ":2w" : ""}${
          c.mount.track.layout ? `:path:${pathSignature(c.mount.track.layout.path)}:${c.mount.track.layout.opening}` : ""
        }`
      : "",
```

   and add to the doc comment above it: `A curved track appends :path:<signature>:<opening> (#369).`

- [ ] **Step 4: Elevation width note**

In `src/lib/curtain-cut-sheets/geometry.ts`, `elevation(input: { … })`: add an optional input field after `box: { wIn: number; hIn: number };`:

```ts
  /** #369 — appended to each panel's width ("along track" on a curved track: the panel is drawn flat). */
  widthNote?: string;
```

and change the width text shape `text: ftIn(p.widthFt),` (the one at `y: wy + 0.13`) to:

```ts
text: input.widthNote ? `${ftIn(p.widthFt)} ${input.widthNote}` : ftIn(p.widthFt),
```

- [ ] **Step 5: The model — layout sheet, page counts, sheet indexes**

In `src/lib/curtain-cut-sheets/model.ts`:

1. Imports: add `import { CLIENT_LAYOUT_BOX, layoutView, SUBMITTAL_LAYOUT_BOX, type TrackLayoutSource } from "./layout";`.
2. `CutSheetModel`: after the `elevation:` field add:

```ts
  /** #369 — a curved track's plan: Submittal prints it as sheet `${sheetNo}.1`; Client beside "How it hangs". null when straight. */
  layout: { sheetNo: string; scale: string; shapes: Shape[]; box: { wIn: number; hIn: number }; hangingCount: number; titleBlock: TitleBlockData | null } | null;
```

3. Add after `cutSheetCssVars`:

```ts
/** #369 — the type's curved-track plan, from its first member (members share a type key, so they share a path). */
export function layoutSourceOf(type: CurtainType): TrackLayoutSource | null {
  return type.curtains[0]?.mount.track?.layout ?? null;
}

/** Submittal pages one type prints: its sheet, plus a layout sheet when its track is curved. */
export function cutSheetPageCount(type: CurtainType): number {
  return layoutSourceOf(type) ? 2 : 1;
}

/** Each type's first Submittal sheet number (1-based) and the set's total, layout sheets included. */
export function submittalSheetIndexes(types: readonly CurtainType[]): { starts: number[]; total: number } {
  let at = 1;
  const starts = types.map((t) => {
    const s = at;
    at += cutSheetPageCount(t);
    return s;
  });
  return { starts, total: at - 1 };
}
```

4. In `cutSheetModel`, replace the `titleBlock: submittal ? { ...titleBlockData({ … }), stamp: CUT_SHEET_STAMP } : null,` expression (from Task 1) with a call to a local helper. Add, right after `const mountLabel = …;`:

```ts
  const block = (sheet: { number: string; title: string; scale: string }, index: number): TitleBlockData | null =>
    submittal
      ? {
          ...titleBlockData({
            company: ctx.company,
            project: { id: ctx.quote.number, name: ctx.quote.name, customer: ctx.quote.customer, siteName: ctx.quote.venue, intake: null, createdBy: ctx.preparedBy },
            option: { name: "", quoteId: ctx.quote.number },
            optionCount: 1,
            revisions: quoteRevisionRows(ctx.quote.revisions),
            set: { drawnBy: ctx.preparedBy, checkedBy: "" },
            sheet,
            index,
            total: ctx.total,
            now: ctx.now,
          }),
          stamp: CUT_SHEET_STAMP,
        }
      : null;
  const layoutSrc = layoutSourceOf(type);
  const lbox = submittal ? SUBMITTAL_LAYOUT_BOX : CLIENT_LAYOUT_BOX;
  const lv = layoutSrc ? layoutView(layoutSrc, { box: lbox, detail: ctx.style }) : null;
  const layoutSheetNo = `${type.sheetNo}.1`;
```

   (copy the `titleBlockData` argument object exactly as it is in the file today — the block above mirrors it; keep any field the current code has that this listing lacks.) Then set:

```ts
    titleBlock: block({ number: type.sheetNo, title: type.title, scale: `Elev ${elev.scale} · Detail NTS` }, ctx.index),
```

   and add after the `elevation:` property:

```ts
    layout: lv
      ? {
          sheetNo: layoutSheetNo,
          scale: lv.scale,
          shapes: lv.shapes,
          box: { wIn: lbox.wIn, hIn: lbox.hIn },
          hangingCount: lv.hangingCount,
          titleBlock: block({ number: layoutSheetNo, title: `Layout — ${type.title}`, scale: `Plan ${lv.scale}` }, ctx.index + 1),
        }
      : null,
```

5. In the `elevation({ … })` call inside `cutSheetModel`, add `...(layoutSrc ? { widthNote: "along track" } : {}),` — move the `const layoutSrc = …` line above the `elevation(` call so it is defined there.
6. Import `type TitleBlockData` from `@/lib/design/grid-drawing-set` if the file doesn't already (it does — check the first import).

- [ ] **Step 6: Number the Submittal sheets in `load.ts`**

In `src/lib/curtain-cut-sheets/load.ts`, add `submittalSheetIndexes` to the `./model` import and replace:

```ts
  const total = result.types.length;
```

with:

```ts
  // #369: a curved type's layout sheet takes the next number, so the set's total counts it
  const { starts, total } = submittalSheetIndexes(result.types);
```

and the `submittal:` line with:

```ts
    submittal: result.types.map((t, i) => cutSheetModel(t, ctx("submittal", starts[i]))),
```

(leave `client:` as it is).

- [ ] **Step 7: Print the layout sheet and the client track layout**

In `src/components/cutsheets/cut-sheet-pages.tsx`:

1. Add a component below `SubmittalSheet`:

```tsx
/** #369 — CS-n.1: a curved track's plan on its own title-blocked sheet. */
function LayoutSheet({ m }: { m: CutSheetModel }) {
  const l = m.layout!;
  return (
    <section className="pk-drawing-sheet" data-sheet={l.sheetNo} style={cutSheetCssVars() as CSSProperties}>
      <div className="pk-drawing-frame">
        <div className="pk-drawing-area pk-cs-area">
          <Stamp />
          <h2 className="pk-dw-h">{`Layout — ${m.title}`}</h2>
          <ShapeSvg idPrefix={`${l.sheetNo}-layout`} shapes={l.shapes} viewBox={`0 0 ${l.box.wIn} ${l.box.hIn}`} hatch={0.05} style={{ width: "100%", height: "auto", flex: 1, minHeight: 0 }} title={`Layout — ${m.title}`} />
          <div className="pk-dw-mono">{`Plan ${l.scale}`}</div>
        </div>
        {l.titleBlock && <TitleBlock data={l.titleBlock} />}
      </div>
    </section>
  );
}
```

2. `SubmittalSheet` returns its existing `<section>` **plus** the layout sheet: wrap the return in a fragment —

```tsx
  return (
    <>
      <section className="pk-drawing-sheet" …>{/* unchanged */}</section>
      {m.layout && <LayoutSheet m={m} />}
    </>
  );
```

3. `ClientSheet`: inside `<div className="pk-cs-row">`, between the "How it hangs" `<div>` and the `<div style={{ flex: 1 }}>` sizes block, add:

```tsx
        {m.layout && (
          <div>
            <h2 className="pk-dw-h">Track layout</h2>
            <ShapeSvg idPrefix={`${m.sheetNo}-client-layout`} shapes={m.layout.shapes} viewBox={`0 0 ${m.layout.box.wIn} ${m.layout.box.hIn}`} hatch={0.05} style={{ width: "2.6in", height: "2.6in" }} title={`Track layout — ${m.title}`} />
          </div>
        )}
```

- [ ] **Step 8: Run all checks and the build**

Run: `npx tsx scripts/test-curved-track.ts` → 0 FAIL.
Run: `npm run test:specs` → ends `ALL PASSED` (the #292/#304/#354 cut-sheet checks pin model and page output — if one fails, read it: a check that pinned the exact `titleBlockData` call shape or `total = result.types.length` may need its pin updated to the new code, never the behaviour loosened).
Run: `npx tsc --noEmit -p .`, `npx eslint src/lib/curtain-cut-sheets src/components/cutsheets scripts/test-curved-track.ts` → clean.
Run: `npx next build` → succeeds.

- [ ] **Step 9: Commit**

```bash
git add src/lib/curtain-cut-sheets src/components/cutsheets scripts/test-curved-track.ts
git commit -m "feat(cutsheets): #369 curved curtains get a CS-n.1 layout sheet; client sheets show the track layout

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Docs, full gate, browser pass

**Files:**
- Modify: `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md`, `docs/superpowers/specs/2026-10-25-curved-track-layout-cut-sheets-design.md`

- [ ] **Step 1: Recompute numbers right before writing**

Run: `git fetch -q origin && git show origin/main:DECISIONS.md | grep -oE "^## D[0-9]+" | tail -1` and `git show origin/main:PUNCHLIST.md | grep -oE "^## [0-9]+" | tail -1`. Use the next free D-numbers and punch number (expected D1304+ and #369; if #369 is taken, renumber everywhere including the spec, the plan header and the `#369` strings in code comments and test messages).

- [ ] **Step 2: Write the decisions**

Append to `DECISIONS.md`, one entry each, in the file's existing format (read the last two entries first):
1. Curved tracks are a segment path (straight / arc, 1–12), run = path length, radiusFt = the tightest arc for older builds; legacy curves read as one left arc, unchanged price (brainstorm with Jeff, Oct 25).
2. Pricing per segment; a hanging point at every joint (Jeff, Oct 25).
3. Layout sheet CS-n.1 (Submittal) and a Track layout beside "How it hangs" (Client, one page — refinement of the spec's "under").
4. Concave side faces the audience; no toggle (Jeff, Oct 25).
5. "PRELIMINARY — NOT FOR CONSTRUCTION" banner + Submittal title block, always on; Grid drawing set unchanged (Jeff, Oct 25).
6. Rollback: an older build prices a path track as one arc of runFt at its tightest radius — acceptable, roll forward.

- [ ] **Step 3: Punch item + phase note**

Add PUNCHLIST `## 369` (same layout as #368): what shipped, the decision numbers, and **Remaining (Jeff-gated):** set `curvedSectionFt` / `minRadiusFt` on each series that curves (corner wraps need a series that bends that tight), then configure a real curved track on production and print its cut sheets.
Add an `AGENTS.md` "Phase status" entry 69 in the existing style (✅ **Curved track layout + Preliminary cut sheets** (#369, D…) — 6–10 lines naming `src/lib/track-path/`, `layout.ts`, `track-segments.tsx`, the stamp, no migration).
In the spec, change "adds a simplified 'Track layout' drawing … under 'How it hangs'" to "beside 'How it hangs'".

- [ ] **Step 4: Full verification gate**

Run, and report the real numbers from each:
```bash
npx tsc --noEmit -p .
npm run test:specs
npm run test:smoke
npx eslint src scripts/test-curved-track.ts
npx next build
```
Expected: tsc clean · test:specs `ALL PASSED` · test:smoke all pass · eslint 0 errors · build succeeds.

- [ ] **Step 5: Browser pass (controller)**

Against a dev server **in the worktree** with a scratch database (never the shared `.data/pglite`, never `npm run dev` from `main` at the same time — check `ps aux | grep -E "next dev|tsx"` first): sign in with the dev login, open an estimate, **Configure track** → Curved → **U wrap** preset → confirm rows, total run and the mini plan; change a corner radius below the series minimum and confirm the segment-named error; Add the track, link a curtain to it, then open `/estimator/cut-sheets?id=<quote>` and `&style=client`. Confirm: the stamp banner on every sheet, CS-1.1 Layout with segments / radii / footprint / lap / hanging ticks / AUDIENCE, the caption count equal to the hardware table's clamp row, and a one-page client sheet. Screenshot both styles for the user.

- [ ] **Step 6: Commit**

```bash
git add DECISIONS.md PUNCHLIST.md AGENTS.md docs/superpowers/specs/2026-10-25-curved-track-layout-cut-sheets-design.md
git commit -m "docs: #369 curved track layout + preliminary cut sheets — decisions, punch, phase note

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Stop here. The controller reviews the whole diff (`superpowers:requesting-code-review`) and pushes only after review.
