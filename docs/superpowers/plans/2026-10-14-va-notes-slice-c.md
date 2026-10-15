# Venue Assessment notes — Slice C (drawing & photo capture) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jeff's notes 9, 10 (pads), 11, 12, 20, 22 (Pencil sheet): Apple-Pencil sketch pads over rough stage/house outlines, per-section photos with caption or markup that keeps the original, the line set schedule as a handwriting sheet, and 3D view presets in wireframe — all offline-capable on private Blob.

**Architecture:** A pure ink model (`src/lib/ink/`) and pure SVG background generators feed one full-screen `InkPad` client component. Survey photos and sketches become file references on the survey (`photoRefs`, `sketches`) whose bytes travel through the Assessments engine's device photo queue, generalised from "photos of an assessment" to "files of a record" — the record kind is read from the id prefix (`AS-` engine, `FS-` survey), so the engine's IndexedDB keys and behaviour don't change. A pure merge rule keeps a finished file path from ever being overwritten by an editor save; every survey write path applies it under one advisory lock. The field sheet PDF gains image blocks.

**Tech Stack:** Next.js 16, TypeScript, Pointer Events + Canvas 2D, three.js (already a dependency), Vercel Blob client uploads, IndexedDB, the zero-dep `src/lib/pdf.ts` (JPEG pass-through).

**Spec:** `docs/superpowers/specs/2026-10-14-venue-assessment-notes-design.md` — C1–C8, R1, R4. Slices A (D1019–D1032) and B (D1038–D1051) are on main; **no instant rollback past slice B** (D1043).

## Global Constraints

- Worktree `/Users/sm/Downloads/peak-app/.claude/worktrees/va-notes`, branch `feat/344-va-notes`. Never `cd` to the main checkout; never bare `git stash`; never touch `.superpowers/sdd/task-4-report.md`. `export PATH="$HOME/.local/node/bin:$PATH"`.
- Read AGENTS.md (Conventions, PGlite). Next 16 differs from training data.
- **Never upload to Blob from local dev.** `.env.local` holds the production Blob token; local dev must use the inline (data-URL) path. Don't click photo/sketch upload against a dev server that has Blob configured — the browser pass runs with Blob disabled (unset `BLOB_READ_WRITE_TOKEN` in the dev server env; verify `blobEnabled()` is false before clicking).
- **Slice C does not merge until Jeff tests on a real iPad + Apple Pencil** (pressure, palm rejection, offline capture then sync). Build, review and verify on desktop; stop before merge.
- No migration file, no new env var. Binding rules from slices A/B: read-time migration never drops data; "a cleared field stays cleared"; plain-text readers show only what the editor shows plus `legacyNotes`.
- The Assessments engine's photo behaviour must be unchanged for `AS-` records (same Blob paths `assessments/<AS>/<p_…>.jpg`, same IndexedDB database/keys, same actions). Its harness (`scripts/test-assessments.ts`) must keep passing unmodified except where a check pins a now-generalised internal name.
- Client components never import stores or server modules at runtime. `npm run build` is the gate.
- Harness labels `#344 C<n>: …` in `scripts/test-va-notes.ts`. Each task: tsc clean, test-va-notes all PASS, eslint on touched files (1 pre-existing `Date.now` warning in controls.tsx allowed), commit; tasks touching the editor/server also run `npm run test:specs` and `npm run build` once.

## File ids, paths and refs (shared contract)

| File | Id | Path | Type |
|---|---|---|---|
| Photo original | `p_<12 hex>` | `<prefix><recordId>/<id>.jpg` | image/jpeg |
| Photo markup (flattened) | `m_<its own 12 hex>` — a NEW id for every (re)markup, stored on `ref.markup.id` | `….jpg` | image/jpeg |
| Strokes (photo markup or sketch) | `k_<same hex as its markup / sketch>` | `….json` | application/json |
| Sketch (flattened) | `s_<12 hex>` | `….jpg` | image/jpeg |

- `prefix`: `assessments/` for `AS-\d+`, `surveys/` for `FS-\d+`. Blob may add `-<suffix>` before the extension (existing rule).
- File id regex: `/^[pmks]_[a-z0-9]{8,32}$/` (no `-`).
- Survey record additions (all optional; absent on old records):

```ts
type FileSlot = { blobPath?: string; inline?: string; pending?: true };
type SurveyPhotoRef = {
  id: string;            // p_<hex>
  section: string;       // editor section id, e.g. "mBeams"
  takenAt: number;
  by: string;
  caption?: string;      // ≤ 500 chars
  file: FileSlot;        // the untouched original
  markup?: { id: string /* m_<hex> */; image: FileSlot; strokes: FileSlot; updatedAt: number };
};
type SketchRef = { id: string /* s_<hex> */; image: FileSlot; strokes: FileSlot; updatedAt: number; by: string };
// survey.photoRefs?: SurveyPhotoRef[]  (cap 200)
// survey.sketches?: Record<SketchKey, SketchRef>
```

- Old `photos: SurveyPhoto[]` (inline data URLs) stay untouched and readable as "Earlier photos".

---

### Task 1 (C1): Pure ink model

**Files:** create `src/lib/ink/model.ts`; checks.

**Produces:** `InkDoc = { v: 1; w: number; h: number; strokes: Stroke[]; labels: InkLabel[] }`; `Stroke = { id: string; tool: "pen"; color: string; width: number; pts: number[] }` (flat `[x, y, p, …]`, x/y rounded to 0.5, p to 2 decimals, p ∈ [0,1]); `InkLabel = { id: string; x: number; y: number; text: string; color: string; size: number }`; `INK_COLORS = ["#16181d", "#c0392b", "#1f5f9a"]`; `INK_CAPS = { strokes: 5000, numbers: 400_000, labels: 200, labelChars: 120 }`; `emptyInk(w, h)`; `simplify(pts: number[], tolerance = 0.4): number[]` (Ramer–Douglas–Peucker over x/y, keeping endpoints and each kept point's pressure); `addStroke(doc, stroke)`, `eraseAt(doc, x, y, radius): InkDoc` (removes strokes with any segment within radius; returns same doc when nothing hit); `addLabel`, `moveLabel`, `removeLabel`, `clearInk`; `type InkOp` + `applyOp(doc, op)` + an undo/redo history helper `createHistory(doc, cap = 200)` with `do(op)`, `undo()`, `redo()`, `canUndo`, `canRedo`, `current`; `serializeInk(doc): string`; `parseInk(json: unknown): InkDoc | null` (validates shape and caps; drops bad strokes/labels; null on non-object); `renderInk(ctx: CanvasRenderingContext2D-like, doc, scale: number)` — draws each stroke as quadratic-smoothed segments with width `width * scale * (0.5 + p)` and round caps, then labels with `fillText` at `size * scale`.

- [ ] Checks: simplify keeps endpoints and drops collinear points; erase hits/misses; caps enforced by `parseInk` (5001 strokes → 5000; a stroke with an odd-length or NaN `pts` dropped); history do/undo/redo/cap; serialize→parse round trip equals; `renderInk` against a fake ctx records `moveTo/quadraticCurveTo/lineTo/stroke/fillText` calls with scaled widths. Commit `feat(ink): #344 C1 pure ink model — strokes, erase, labels, history, caps`.

### Task 2 (C2): Pad backgrounds

**Files:** create `src/lib/ink/backgrounds.ts`; checks.

**Produces:** `type SketchKey = "beams" | "cwElevation" | "brick" | "stagePlan" | "stageSection" | "houseSection" | "housePlan" | "linesetSheet" | \`linesetSheet${number}\``; `SKETCH_PADS: Array<{ key: SketchKey; section: string; title: string; gate?: "counterweight" | "linesets" }>` per the spec C5 table (beams→mBeams, cwElevation→mBeams counterweight, brick→mBeams counterweight, stagePlan→mLayout, stageSection→mSection, houseSection→mFOH, housePlan→mHouse, linesetSheet→linesets linesets); `backgroundFor(key, m: Record<string, string | boolean>, opts?: { linesetRows?: number; page?: number }): { svg: string; w: number; h: number }`.
- Generators draw in feet-scaled units (1 ft = 10 units) when the measurements parse (use the existing ft-in parser — find it: grep `parseFtIn`/`ftInToFeet` in `src/lib`; the venue-3d model reads measurements too), else generic proportions; stroke `#9aa0ab` thin lines, dimension labels in `#8c919c` 11-unit text. Stage-only plan (beams/stagePlan): plaster line, proscenium opening (proW), stage depth (stageDepth), wings SL/SR (wingSL/wingSR), centre line dashed, labels "SL"/"SR"/"PLASTER LINE"/"CL". Stage section: deck line, proscenium (proH), grid line (gridH), labels. House plan: house outline from house width/depth keys (grep `HOUSE_FIELDS` in survey-measure-fields.ts for the keys), stage edge at top. House section: floor, ceiling (houseH), catwalk/FOH line. `cwElevation`: titled grid "CW ELEVATION SHEET (placeholder — Jeff's sheet replaces this)" 24×12 cells. `brick`: plain 20-unit grid titled "BRICK DRAWING". `linesetSheet`: ruled table with header row using the `LinesetRow` column labels (Set, Dist. from PL, Set name, Type, Batten, Lift lines, Goods, Finished W×H, Arbor load, Trim low, Trim high, Condition, Notes), 30 rows per page, page `n` numbers rows `30(n-1)+1…`.
- All SVG strings are self-contained (`<svg xmlns=… viewBox="0 0 w h">`), escape label text, white background rect.
- [ ] Checks: every `SKETCH_PADS` key renders; a measured stage plan contains "PLASTER LINE" and the proW dimension label; generic fallback when measurements are empty; linesetSheet page 2 starts at row 31; SVG has no `<script` and escapes `<` in labels. Commit `feat(ink): #344 C2 sketch pad backgrounds`.

### Task 3 (C3): InkPad component

**Files:** create `src/components/ink/ink-pad.tsx` (+ a small CSS block inside); checks (source pins + pure helpers if any are extracted).

**Produces:** `InkPad({ open, title, background, initial, onCancel, onDone })` where `background: { kind: "svg"; svg: string; w: number; h: number } | { kind: "image"; url: string; w: number; h: number }`, `initial?: InkDoc`, `onDone(result: { doc: InkDoc; jpeg: Blob })`.
- Full-screen fixed overlay (z above the editor header), safe-area padding; toolbar: Pen, colours (`INK_COLORS`), Eraser, Text, Undo, Redo, Clear (inline armed confirm), Cancel, Done. Stage area: background (SVG via `<img src="data:image/svg+xml;charset=utf-8,…">` or the photo URL) with a `<canvas>` overlay sized to the stage, DPR capped at 2; doc coordinates in background units.
- Pointer handling: `touch-action: none` on the stage; `penSeen` (module-level, session) set on the first `pointerType === "pen"`. While `penSeen`: pen draws/erases/places text; touch never draws — one finger pans, two fingers pinch-zoom (scale 0.5–4) and pan. Without a pen: mouse/touch draws with the active tool; two-finger pinch still zooms. Use `getCoalescedEvents()` when available; pressure from `e.pressure` (mouse → 0.5). On pointerup simplify the stroke and push an `add` op.
- Text tool: tap places an inline `<input>` at the point; Enter/blur commits a label (≤ 120 chars); tapping a label selects it (drag to move, Delete key or a toolbar ✕ removes).
- Done → flatten: draw the background (load SVG/photo into an `Image`, draw on an offscreen canvas at long edge ≤ 1600), then `renderInk`, export `canvas.toBlob("image/jpeg", 0.85)` on a white base → `onDone({ doc, jpeg })`. A failed image load still exports the ink on white (never block Done).
- Keyboard: Esc = Cancel (asks if there are unsaved strokes), Cmd/Ctrl+Z / Shift+Z undo/redo. Focus trapped in the dialog; `aria-modal`, labelled by the title.
- [ ] Checks: source pins (`pointerType === "pen"`, `getCoalescedEvents`, `touch-action`, `toBlob(`, `aria-modal`), plus any pure helper you extract (e.g. pinch math) tested. `npm run build`. Commit `feat(ink): #344 C3 InkPad — Pencil-first drawing, pan/zoom, text, flatten to JPEG`.

### Task 4 (C4): Files of a record — generalised queue + survey file storage

**Files:** create `src/lib/field-files/files.ts` (pure), `src/app/(app)/venue-assessments/file-actions.ts` ("use server"), `src/app/api/surveys/[id]/files/upload/route.ts`, `src/app/api/surveys/[id]/files/[fileId]/route.ts`, `src/lib/field-files/file-bytes.ts` (server); modify `src/lib/assessments/photo-queue.ts`, `src/lib/stores/surveys.ts`, `src/app/api/sync/push/route.ts`, `src/app/(app)/venue-assessments/[id]/actions.ts`; checks (pure + DB).

**Produces:**
- `files.ts`: `FILE_ID_RE`, `newFileId(kind: "p" | "m" | "s")`, `siblingId(id, kind: "k")`, `recordKind(recordId): "assessment" | "survey" | null`, `filePrefix(kind)`, `fileBlobPath(recordId, fileId)` (`.json` for `k_`, else `.jpg`), `filePathMatches(path, recordId, fileId)` (same suffix rule as `photoPathMatches`), `fileContentType(fileId)`, `INLINE_CAPS = { jpeg: 400_000, json: 200_000, totalPerSurvey: 1_500_000 }`, `type SurveyPhotoRef`, `type SketchRef`, `type FileSlot`, `mergeSurveyFileRefs(stored: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown>` — returns `incoming` with, for every photo ref / sketch present in BOTH (same id), each `FileSlot` that is finished in `stored` (has `blobPath` or `inline`) kept as stored (a stored finished slot always wins; callers first pass the client copy through `sanitizeIncomingFileSlots`, so only the finalize creates finished slots); a sketch or markup whose incoming id differs from the stored id (a re-draw / re-markup) keeps the incoming one; refs absent from `incoming` stay absent (deleted). Pure, no mutation of inputs.
- Queue generalisation (`photo-queue.ts`): items are "files of a record". Keep DB name/version/stores/keys; add optional `contentType` to the meta (default `image/jpeg`); the upload path comes from `fileBlobPath(recordId, fileId)`; the broker URL by kind: `assessment` → `/api/assessments/<id>/photos/upload` (unchanged contract `{photoId}`), `survey` → `/api/surveys/<id>/files/upload` (`{fileId}`); finalize by kind: `assessment` → `finalizeAssessmentPhoto` (unchanged), `survey` → `finalizeSurveyFile`. `enqueuePhoto(recordId, fileId, blob)` keeps its signature (rename internals freely, export an alias `enqueueFile`). `onDone` handlers must ignore other kinds (document it). In dev without Blob: a `.jpg` file is finalized inline via `shrinkForInline` (existing), a `.json` file inline as a `data:application/json;base64,…` string ≤ `INLINE_CAPS.json`.
- Survey storage (`surveys.ts`): `applyFinalizedSurveyFile(id, fileId, slot: { blobPath } | { inline }, user)` under `withAdvisoryLock(<survey namespace>, "survey:"+id)` — finds the ref owning the file (photo `p_` → `file`; `m_` → `markup.image` of the photo whose `markup.id` is that id; `k_` → `markup.strokes` of the markup with the same hex, else `sketches[*].strokes` with that hex; `s_` → `sketches[*].image`), sets the slot (drops `pending`), never bumps rev (an offline edit saved before the upload must still push cleanly); returns `{ ok, rev, already? }`; an already-finished slot returns `already` (never replaced); unknown ref → retryable `{ ok:false }` (the capture save may not have synced); deleted survey → terminal. **Every survey write path merges file refs under the same lock:** `update()` (used by `saveSurvey`, `advanceSurveyStage`, `assign`, `setStage`, `createQuoteFromSurvey`) reads the stored doc and applies `mergeSurveyFileRefs(stored, patched)` before writing; the `/api/sync/push` `surveys` branch does the same inside the lock (add a `pushSurvey` store function used by the route, like `pushAssessment`). Look for an existing lock namespace constant pattern (`ASSESSMENT_LOCK_NAMESPACE` in `@/db`) and add `SURVEY_LOCK_NAMESPACE` the same way.
- Inline guard: production (`blobEnabled()`) refuses inline; dev enforces `INLINE_CAPS` (refuse terminally beyond them with a clear error).
- Server action `finalizeSurveyFile(recordId, fileId, path | null, inline?)` mirroring `finalizeAssessmentPhoto` (session + `can("create")`, path checks, `getBlobHead` + sniff: JPEG for jpg ids, `{`/`[` first byte + JSON.parse for `k_` json, delete wrong files with `reupload`), returning the same result union.
- Broker route mirrors the assessments one: `clientPayload {fileId}`, the survey must exist, pathname must equal `fileBlobPath`, allowed content type by id (`image/jpeg` ≤ 5 MB; `application/json` ≤ 2 MB), `addRandomSuffix: true`.
- Bytes route `GET /api/surveys/[id]/files/[fileId]` — session-gated (`requireUser`-style), the file must be referenced by the survey, path in scope, streams with the right content type, `nosniff`, `private, max-age=3600`; inline data URLs decoded. `file-bytes.ts` exports `surveyFileBytes(survey, fileId)` for the route and the field sheet.
- [ ] Checks: pure — ids/paths/kinds/suffix rule; `mergeSurveyFileRefs` (finished slot survives an unfinished incoming; incoming finished wins over stored unfinished; deleted ref stays deleted; sketch re-draw keeps incoming; inputs not mutated). DB (`vaNotesDbChecks`) — create a survey fixture with a pending photo ref + sketch; `applyFinalizedSurveyFile` inline for `p_`, `m_`, `k_`, `s_`; then `update(id, patchWithPendingSlots)` keeps the finished slots; a second finalize returns `already`; push via `pushSurvey` with stale slots keeps them; engine regression: `scripts/test-assessments.ts` unchanged and passing. `npm run test:specs`, `npm run build`. Commit `feat(field-files): #344 C4 survey files on the shared photo queue; finished file paths survive every save`.

### Task 5 (C5): Per-section photos with caption and markup

**Files:** create `src/app/(app)/venue-assessments/[id]/sections/section-photos.tsx`; modify `controls.tsx`, `types.ts`, `page.tsx` (blob flag), `sections/photos.tsx` (becomes "Earlier photos"); checks.
- Every section header row gets **Add photo** (camera `capture="environment"`, library, multiple). Capture: shrink with the engine's `photo-resize` helper (long edge 1600, q 0.8), new `p_` id, add a pending `SurveyPhotoRef { section, takenAt, by }` to the draft, save through the existing save path, `enqueuePhoto(record.id, id, jpeg)`. Cap 200 refs (clear message at the cap).
- Thumbnails under each section (from the queue's device blob while pending — `queuedPhotoBlob` — else `/api/surveys/<id>/files/<fileId>`, the markup image when present); tapping opens a viewer sheet: image (markup by default), **View original** toggle, **Caption** (≤ 500, saves on blur), **Mark up** / **Edit markup** (opens `InkPad` with the ORIGINAL as background and the saved strokes as `initial`; Done → a NEW `m_` id (`newFileId("m")`) and its `k_` (`siblingId(m, "k")`) enqueued, stored on `markup.id`, `markup` slots pending, `updatedAt`), **Remove markup** (drops `markup` from the ref; blobs left as orphans — log), **Delete photo** (inline confirm; removes the ref).
- Queue wiring: the editor calls `configurePhotoQueue` with an `onDone` that, for `FS-` ids of THIS survey, folds the finished slot into the draft (by the same rules as `applyFinalizedSurveyFile`) and adopts `rev`; failed items listed with Retry / Discard using the engine's `FailedPhotos` UI if it fits.
- The old Photos section becomes **Earlier photos** (read-only grid of `draft.photos` with a note "Taken before photos moved into each section"), shown only when `draft.photos.length > 0`; the 8-photo `readPhoto`/`onPhotos` path is removed. Assessment findings that reference old photo ids keep working (they read `draft.photos`).
- Rail badge: photo count per section (tone "photo").
- [ ] Checks: source pins (capture input per section; `enqueuePhoto(`; `InkPad` used with the original as background; Earlier photos read-only; no `readPhoto`); a pure helper for "fold a finished slot into refs" shared by the editor and the store (put it in `files.ts`) and tested. `npm run test:specs`, `npm run build`. Commit `feat(venue-assessments): #344 C5 per-section photos with caption and markup that keeps the original`.

### Task 6 (C6): Sketch pads in sections

**Files:** create `sections/sketch-tile.tsx`; modify `controls.tsx`, `sections/linesets.tsx`; checks.
- For each `SKETCH_PADS` entry whose section is visible and whose gate passes (`hasCounterweight`, `hasLinesets`), render a tile in that section: thumbnail of the flattened sketch (device blob while pending, else bytes route), or a "Draw" tile with the pad title. Tap → `InkPad` with `backgroundFor(key, draft.measurements, …)` and `initial` = parsed strokes (device queue blob for a pending `k_`, else fetched JSON from the bytes route, else empty). Done → new `s_` id + `k_` sibling, enqueue both, replace `sketches[key]` with pending slots (the old files become orphans — log).
- Line set schedule: a **Fill in by hand** button opens the `linesetSheet` pad (page 1; a page selector when `linesetQty > 30` adds `linesetSheet2`…); the table stays; a note says the handwritten sheet is the record unless the table is typed (no handwriting recognition).
- Beams: the CW Elevation sheet and Brick drawing pads sit beside their "on file" checks (counterweight only).
- [ ] Checks: pure gate helper `visibleSketchPads(survey, sectionId)` (in backgrounds.ts or flow) tested for counterweight/linesets gates and scope; source pins for the tiles and the linesets button. `npm run test:specs`, `npm run build`. Commit `feat(venue-assessments): #344 C6 sketch pads for beams, stage, house, CW elevation, brick and the line set sheet`.

### Task 7 (C7): Field sheet images

**Files:** modify `src/lib/pdf.ts` (field sheet sections accept `images?: Array<{ jpeg: Buffer; caption?: string; full?: boolean }>`), `src/lib/venue-assessment-sheet.ts`, `src/app/(app)/venue-assessments/[id]/actions.ts` (`printSurveySheet` loads image bytes server-side); checks.
- `buildAssessmentSheet` stays pure: it takes an optional `images: { photosBySection: Record<string, Array<{ fileId: string; caption?: string }>>; sketches: Array<{ key: SketchKey; title: string }> }` plan; `printSurveySheet` resolves bytes via `surveyFileBytes` (markup image when present, else original; sketch image), skipping missing ones, total budget 20 MB (beyond it list the rest by caption as text rows), and passes `Buffer`s into the sheet sections. Photos 2 per row with captions under their section's page; sketches full width. Earlier (inline) photos print under Wrap-up.
- `pdf.ts`: render image blocks inside field-sheet sections with `addJpeg` + `image(...)`, page-breaking as needed; captions in the row font. Keep text-only sheets byte-identical where possible (no images → same output).
- [ ] Checks: a sheet with two image blocks renders a PDF containing two `/Subtype /Image` XObjects and the captions; a text-only sheet's PDF is unchanged vs before (compare a hash computed in the check from the pre-change renderer path — or at least that no `/XObject` appears); budget overflow lists the rest. `npm run test:specs`, `npm run build`. Commit `feat(venue-assessments): #344 C7 the field sheet prints photos (markup version) and sketches`.

### Task 8 (C8): 3D presets + wireframe

**Files:** modify `src/app/(app)/venue-assessments/[id]/venue-3d.tsx`; checks.
- Buttons: **Orbit** (today's view), **Plan** (OrthographicCamera top-down fit to the model bounds), **Section** (OrthographicCamera from stage right, `renderer.localClippingEnabled = true` with a clipping plane at the centre line applied to every material), **Elevation** (PerspectiveCamera at centre house, eye height 5 ft, looking at the plaster line); **Wireframe** toggle default ON (`material.wireframe`), Solid when off. Orbit controls: full on Orbit; on the ortho presets only zoom + pan (`enableRotate = false`). Dispose cameras/materials properly; keep the lazy `import("three")`.
- Pure helper `presetCamera(preset, bounds): { position, target, ortho?: { left, right, top, bottom } }` exported and tested.
- [ ] Checks: helper tested for each preset; source pins (`localClippingEnabled`, `wireframe`, `OrthographicCamera`). `npm run build`. Commit `feat(venue-assessments): #344 C8 3D view presets and wireframe`.

### Task 9 (C9): Gates, desktop browser pass, docs — stop before merge

- Four gates + build (smoke with ≥ 45 GB free; clean `$TMPDIR` `-mmin +60` and this worktree's `.next` first).
- Desktop browser pass on a scratch datadir **with Blob disabled** (inline path): add a photo in two sections, caption it, mark it up, view original, remove markup; draw on Beams, Stage plan and the line set sheet; reload → everything persists; print the sheet → images appear; 3D presets. Check `blobEnabled()` is false on that server before any capture.
- Docs: DECISIONS (file ids/paths, record kind by prefix, merge rule under the survey lock, inline caps, orphan blobs left, no handwriting recognition, placeholder CW/line set sheets), PUNCHLIST #344 slice C "built, awaiting Jeff's iPad + Pencil test" with a test script for Jeff (what to try, offline steps), AGENTS phase 61 note. **Do not push to main.**
