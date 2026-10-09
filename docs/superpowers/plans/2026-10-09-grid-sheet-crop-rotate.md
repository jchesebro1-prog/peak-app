# Grid sheet crop + rotate, and 25 MB plan uploads (#318) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a plan sheet is uploaded to the Grid, let Jeff crop it to the plan and turn it upright (quarter turns, per page, only while the page is empty) before calibrating, and let plan files up to 25 MB upload straight to Blob.

**Architecture:** An adjustment never transforms at view time: the server derives **new bytes** (pdf-lib sets `/CropBox` + `/Rotate`; sharp rotates + extracts images) from the sheet's **root** (original upload) and writes a **new `grid_sheets` doc** that replaces the old id in place in one `patchDoc`, remapping every reference on the untouched pages. Pure rules (types, sanitize, crop↔PDF-box and crop↔pixel math, gate, remap, copy) live in one client-safe module; the 25 MB path is a Vercel Blob client-upload token broker plus a commit action that re-checks everything, with the 4 MB multipart route kept for Blob-less dev. A full-window **Adjust sheet** dialog (crop box with handles, ⟲ ⟳, per-page, Same for all pages) opens after every upload and from the sheet tab's ⋯ menu.

**Tech Stack:** Next.js 16 App Router (server actions, route handlers), TypeScript, Drizzle doc-store on PGlite/Postgres, pdf-lib 1.17.1, sharp 0.35, pdfjs-dist 6.3 (browser render; `legacy/build/pdf.mjs` in the Node harness), `@vercel/blob` 2.6 (`handleUpload` / `upload`).

**Spec:** `docs/superpowers/specs/2026-10-09-grid-sheet-crop-rotate-design.md` (approved).

## Spec deviations (found while reading the code — each is logged in DECISIONS in Task 6)

1. **`PdfCanvas` gets `rotateBy` (quarter turns added to the page's own rotation), not an absolute `rotation`.** pdf.js's `getViewport({ rotation })` is absolute (verified: a page with `/Rotate 90` rendered with `rotation: 0` comes out unrotated). The dialog renders the root page and only knows the *delta* it is editing, so `PdfCanvas` adds `pg.rotate + rotateBy` itself. Absent/0 = today's behaviour exactly.
2. **The broker is chosen by a server flag (`blobUploads = blobEnabled()`), not by trying the token route and falling back on `blob-disabled`.** `@vercel/blob/client`'s `upload()` throws the same `"Failed to retrieve the client token"` for every non-2xx token response, so a 503 can't be told apart from a refusal. The token route still answers 503 `{reason:"blob-disabled"}`; the estimator already passes `blobUploads={blobEnabled()}` the same way.
3. **`remapSheetRefs(project, oldId, newId)` has no `keepPages` argument.** The gate (re-checked inside the same patch) guarantees no placement/space/route/calibration sits on a changed page, so moving *every* reference is the same as moving "other-page" references.
4. **Files split differently from the spec's "Code shape":** `sheet-adjust-bytes.ts` (pdf-lib/sharp, bytes in → bytes out) is separate from `sheet-adjust-server.ts` (read root, store, swap); the patch itself is a store function `replaceSheetWithAdjusted` in `grid-projects.ts`. The broker is `src/lib/design/grid-sheet-upload.ts` (pure) + `grid-sheet-upload-server.ts` (commit) + route `src/app/api/grid-sheets/upload-url/route.ts` + client helper `src/app/(app)/design/grid/[id]/sheet-upload.ts` (it imports the commit server action, so it lives beside `actions.ts`, like `estimator/package-file-upload.ts`).
5. **GIF re-encodes as PNG** (the spec lists JPEG/WebP/PNG outputs only); the derived sheet's mime is `image/png`.
6. **"Reset everything" (an empty spec) still makes a new sheet doc**, with `adjust: { fromSheetId: <root>, pages: {} }` and the root's own stored file (no new bytes). The root id itself is never put back in `sheetIds` — one code path, and the root stays an untouched history doc.
7. **"Same for all pages" is a checkbox:** ticking it copies the current page's crop/rotation to every unlocked page, and while it stays ticked every edit goes to every unlocked page.
8. **`uploadPlanFirst` is replaced by `uploadGridSheet(projectId, file, { blobUploads, planUploadId? })`**; the multipart code stays in `grid-plan-upload.ts` as `postSheetMultipart`. Three `#314` source pins in the harness name the old call and are updated (Tasks 4 and 5).
9. **`saveGridIntakeAction` now returns `planSheetId`** when it copied a plan on file, so a copied plan opens in Adjust sheet too (the spec's "or a plan copied from file").
10. **Crop & rotate… is disabled only when we *know* every page is locked:** an image (one page), or the PDF on screen (its page count is known). Another PDF tab opens the dialog, which shows its locked pages.
11. **Broker-uploaded sheets store no `url`** (provenance only; the browser's upload result is untrusted). Every reader uses `blobPath`.
12. **The notices banner's "Choose the plan again…" opens Adjust sheet after it lands;** the copy retry ("Retry the plan view") does not (its action returns no sheet id).

## Global Constraints

- Crop/rotate is allowed **only while that page is empty** — no placements, spaces, routes or calibration on that (sheet, page), checked across **all options**.
- Rotation is **90° steps only** (⟲ / ⟳). No fine-straighten.
- Multi-page PDFs: crop + rotation are **per page**, with a "Same for all pages" convenience that applies to every page that isn't locked.
- Plan uploads go **direct to Blob, up to 25 MB**; without Blob (local dev) the old **4 MB** route stays.
- An adjustment writes **new bytes** and a **new `GridSheet` doc**; no consumer changes. `adjust.fromSheetId` is always the **root** (the original upload), never a chain.
- `rotate` is the delta added to the root page's own rotation; `crop` is normalized 0..1 in the root page **as displayed after that rotation** (top-left origin, y down); identity `{rotate:0, crop:{0,0,1,1}}` is omitted from `pages`; keys are 1-based page numbers as strings.
- Images: page 1 only; auto-orient (EXIF), rotate, extract (rounded, ≥ 1 px), re-encode in the source format (JPEG q92, WebP q90, PNG); pixel caps as `shrink.ts` (`SHRINK_MAX_INPUT_PIXELS`).
- The old sheet doc is left in place; revisions are never rewritten. Known, accepted edge: restoring a revision cut before an adjustment re-adds the old sheet next to the new one.
- Never offered on the generated base sheet (`image/svg+xml`, or `intake.baseSheetId`).
- Gate refusals: `in-use` (a changed page has content), `base-sheet`, `not-found`, `no-such-sheet` — the `removeSheet` (#317) pattern: pre-check, then re-check inside the patch.
- Token route: `requireUser`-equivalent (signed in), project exists, pathname exactly `grid-sheets/<projectId>/<uploadKey>/<safe name>` (no `..`, safe chars), types PDF/PNG/JPEG/WebP/GIF, `maximumSizeInBytes` 25 MB, `addRandomSuffix: true`, private access.
- Commit: the client's `blobPath` is untrusted — scope, never-referenced, `getBlobHead` size ≤ 25 MB, sniff (PDF `%PDF-` or a real image signature; markup / SVG refused); a refusal deletes the orphan blob.
- No migration (doc-store JSONB). Ids: `gs-` + 12 hex. Timestamps epoch-ms.
- UI: accent only via `var(--accent)`; the dialog is `role="dialog"` (the editor's key handlers already ignore events inside `[role="dialog"]`).
- `src/lib/design/sheet-adjust.ts` and `grid-sheet-upload.ts` stay import-free of server modules (client components import them). Never import `sheet-adjust-bytes.ts` (sharp) or any store from a `"use client"` file.
- Tests: `npm run test:specs` (`scripts/test-review-and-spec.ts`, its own temp `PGLITE_PATH`); assertions prefixed **`#318`**; fixtures built in-test (pdf-lib PDFs, sharp images) — never read gitignored files. New async check functions go at the END of the harness file and are chained after `.then(() => estimateGrid314AsyncChecks())`.
- Shell: `export PATH=$HOME/.local/node/bin:$PATH` first. Never `git add -A` (untracked junk sits at the repo root) — add exact paths. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- PGlite is single-process: before any `test:specs`/`tsx` run, `ps aux | grep -E "tsx|next dev" | grep -v grep` must show nothing holding this checkout's `.data/pglite`.
- `npx eslint` on the whole repo crashes on the harness file — always pass `--ignore-pattern scripts/test-review-and-spec.ts` when linting broadly; per task, lint only the touched source files.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/lib/design/sheet-adjust.ts` | Create | Pure, client-safe: types (`PageAdjust`, `SheetAdjust`…), sanitize, identity/changed pages, quarter-turn crop math, `dragCrop`, PDF box math (`effectiveBox`, `displayToPdf`, `cropToPdfBox`), `cropToPixels`, content gate (`pageContents`, `blockedPages`, `pageLocks`, `allPagesLocked`), `remapSheetRefs`, `isBaseSheet`, refusal copy. |
| `src/lib/design/sheet-adjust-bytes.ts` | Create | Server-only: `sheetKindOf`, `adjustSheetBytes` (pdf-lib for PDFs, sharp for images). |
| `src/lib/stores/grid-projects.ts` | Modify | `GridSheet.adjust?`; `replaceSheetWithAdjusted` (new doc + one gated patch + remap). |
| `src/lib/design/sheet-adjust-server.ts` | Create | Server-only orchestrator `adjustSheet` (gate → read root → transform → store → swap). |
| `src/lib/design/grid-sheet-upload.ts` | Create | Pure, client-safe broker rules: caps, types, copy, path helpers, `parseSheetUploadPayload`, `sniffSheetFile`. |
| `src/lib/design/grid-sheet-upload-server.ts` | Create | Server-only `commitSheetUpload` (scope → referenced → head → sniff → addSheet; plan lock for `first`). |
| `src/app/api/grid-sheets/upload-url/route.ts` | Create | Token broker (`blob.generate-client-token` only). |
| `src/lib/design/grid-plan-upload.ts` | Modify | `planFileProblem(file, blobUploads)`, `postSheetMultipart` (legacy 4 MB route); `uploadPlanFirst` removed. |
| `src/app/(app)/design/grid/[id]/sheet-upload.ts` | Create | Client helper `uploadGridSheet` (broker + commit, or legacy). |
| `src/app/(app)/design/grid/[id]/actions.ts` | Modify | `adjustSheetAction`, `commitSheetUploadAction`; `saveGridIntakeAction` returns `planSheetId`. |
| `src/components/design/pdf-canvas.tsx` | Modify | Optional `rotateBy` prop. |
| `src/app/(app)/design/grid/[id]/workspace/sheet-adjust-dialog.tsx` | Create | The Adjust sheet dialog. |
| `src/app/(app)/design/grid/[id]/use-grid-editor.ts` | Modify | `SheetLite.adjust/base`, props `blobUploads`/`adjustSheetId`, upload via `uploadGridSheet`, adjust state + open/close/finish, `adjustAvailability`. |
| `src/app/(app)/design/grid/[id]/editor.tsx` | Modify | Render the dialog. |
| `src/app/(app)/design/grid/[id]/workspace/sheet-tabs.tsx` | Modify | ⋯ → Crop & rotate…. |
| `src/app/(app)/design/grid/[id]/workspace/intake-notices.tsx` | Modify | Re-upload through `uploadGridSheet`, then open Adjust sheet. |
| `src/app/(app)/design/grid/[id]/grid-intake.tsx` | Modify | `blobUploads` prop; upload through `uploadGridSheet`; finish with `?adjust=`. |
| `src/app/(app)/design/grid/[id]/page.tsx` | Modify | `?adjust=`, `blobUploads`, sheet `adjust`/`base` in the payload. |
| `scripts/test-review-and-spec.ts` | Modify | `#318` check functions + chain; three `#314` pins updated. |
| `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md` | Modify | D692–D694 (recompute), `## 318`, a ✅ follow-up under item 38. |

---

### Task 1: Pure rules — `src/lib/design/sheet-adjust.ts`

**Files:**
- Create: `src/lib/design/sheet-adjust.ts`
- Test: `scripts/test-review-and-spec.ts` (new `sheetAdjust318PureChecks` at the end of the file + one chain line)

**Interfaces:**
- Consumes: nothing (no imports).
- Produces (used by Tasks 2–5):
  - `type QuarterTurn = 0 | 90 | 180 | 270`; `type CropRect = { x; y; w; h }`; `type PageAdjust = { rotate: QuarterTurn; crop: CropRect }`; `type AdjustPages = Record<string, PageAdjust>`; `type SheetAdjust = { fromSheetId: string; pages: AdjustPages }`; `type PdfBox = [number, number, number, number]`; `type CropHandle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw"`; `type SheetRefsDoc`; `type PageContent`; `type AdjustRefusal = "not-found" | "no-such-sheet" | "base-sheet" | "in-use" | "unsupported" | "encrypted" | "unreadable" | "too-big" | "failed"`.
  - `IDENTITY_CROP`, `IDENTITY_ADJUST`, `MIN_CROP = 0.02`, `MAX_ADJUST_PAGES = 500`.
  - `snapTurn(raw): QuarterTurn`, `pdfPageTurn(raw): QuarterTurn`, `sanitizeCrop(raw): CropRect`, `sanitizePageAdjust(raw): PageAdjust`, `isIdentity(a): boolean`, `sanitizeAdjustPages(raw): AdjustPages`, `pageAdjustOf(pages, page): PageAdjust`, `samePageAdjust(a, b)`, `changedPages(before, after): number[]`, `rotatedSize(w, h, turn): [number, number]`, `rotateCrop(c, "cw" | "ccw")`, `turnAdjust(a, "cw" | "ccw")`, `dragCrop(c, handle, dx, dy): CropRect`.
  - `normalizeBox(b): PdfBox`, `effectiveBox(media, crop?): PdfBox`, `displayToPdf(box, turn, u, v): [number, number]`, `cropToPdfBox(view, rootTurn, a): { box: PdfBox; rotate: QuarterTurn }`, `cropToPixels(w, h, a): { width; height; left; top }`.
  - `pageContents(p, sheetId): Map<number, PageContent>`, `blockedPages(p, sheetId, pages): number[]`, `lockReason(c): string`, `pageLocks(p, sheetId): Record<number, string>`, `allPagesLocked(locks, pageCount): boolean`, `remapSheetRefs(p, oldId, newId): void`, `isBaseSheet(sheet, intake?): boolean`, `adjustRefusalText(reason, pages?): string`.

**The crop → PDF math (derived, then checked against pdf.js).** pdf.js shows a page's effective box `view = CropBox ∩ MediaBox = [x0, y0, x1, y1]` (W = x1−x0, H = y1−y0), turned clockwise by the total rotation `R = (rootRotate + delta) mod 360`. A displayed point (u, v) ∈ [0,1]² (top-left origin, y down) maps to PDF user space:

| R | display top-left shows | x | y |
|---|---|---|---|
| 0 | (x0, y1) | x0 + u·W | y1 − v·H |
| 90 | (x0, y0) | x0 + v·W | y0 + u·H |
| 180 | (x1, y0) | x1 − u·W | y0 + v·H |
| 270 | (x1, y1) | x1 − v·W | y1 − u·H |

Each clockwise quarter turn moves the box corner shown at the display's top-left one corner counter-clockwise (top-left → bottom-left → bottom-right → top-right). The new `/CropBox` is the min/max of the two mapped crop corners; the new `/Rotate` is R. Worked checks, `view = [10, 20, 160, 80]` (W 150, H 60), `crop = {x 0.2, y 0.25, w 0.5, h 0.5}`, root `/Rotate 0`:

- **R 0:** corners (0.2, 0.25) → (10+30, 80−15) = (40, 65); (0.7, 0.75) → (115, 35) → **[40, 35, 115, 65]**. Displayed width is 150: the crop spans display x 30..105 and y 15..45 from the top, i.e. PDF y 65..35. ✓
- **R 90:** displayed 60 wide × 150 tall. (0.2, 0.25) → (10+0.25·150, 20+0.2·60) = (47.5, 32); (0.7, 0.75) → (122.5, 62) → **[47.5, 32, 122.5, 62]**.
- **R 180:** (0.2, 0.25) → (160−30, 20+15) = (130, 35); (0.7, 0.75) → (55, 65) → **[55, 35, 130, 65]**.
- **R 270:** (0.2, 0.25) → (160−37.5, 80−12) = (122.5, 68); (0.7, 0.75) → (47.5, 38) → **[47.5, 38, 122.5, 68]**.

A root `/Rotate` folds in first: root 90 + delta 90 = R 180 → [55, 35, 130, 65]; root −90 (read as 270, the pdf.js rule) + delta 90 = R 0 → [40, 35, 115, 65]. These four boxes were computed by this module's code during planning and matched `pdfjs-dist/legacy/build/pdf.mjs` `page.getViewport({ scale: 1, rotation: R }).convertToPdfPoint(u·width, v·height)` exactly (pdf.js's `rotation` is absolute and runs headless under tsx), so the harness checks the math against pdf.js directly.

- [ ] **Step 0: Record the baselines (before any change)**

```bash
export PATH=$HOME/.local/node/bin:$PATH
cd /Users/sm/Downloads/peak-app
ps aux | grep -E "tsx|next dev" | grep -v grep   # must print nothing for this checkout
npx tsc --noEmit -p . 2>&1 | tail -3              # expect no output (0 errors)
npm run test:specs > "$TMPDIR/specs-baseline-318.txt" 2>&1; tail -1 "$TMPDIR/specs-baseline-318.txt"; grep -c '^PASS' "$TMPDIR/specs-baseline-318.txt"   # expect "ALL PASSED" and the PASS count
npx eslint --ignore-pattern scripts/test-review-and-spec.ts 2>&1 | tail -3   # note "N problems (0 errors, M warnings)"
```

Write the three numbers (PASS count, eslint errors/warnings) into the task's report; Task 6 compares against them.

- [ ] **Step 1: Write the failing test**

Append at the very end of `scripts/test-review-and-spec.ts` (after `function J314`):

```ts
/* ---------------- #318: Grid sheet crop + rotate — pure rules ---------------- */
async function sheetAdjust318PureChecks(): Promise<void> {
  const A = await import("@/lib/design/sheet-adjust");
  const J = (v: unknown) => JSON.stringify(v);
  const near = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-9);

  ok(A.snapTurn(89) === 90 && A.snapTurn(-90) === 270 && A.snapTurn(450) === 90 && A.snapTurn(44) === 0 && A.snapTurn("x") === 0,
    "#318 snapTurn: any angle snaps to the nearest quarter turn in 0..270");
  ok(A.pdfPageTurn(-90) === 270 && A.pdfPageTurn(450) === 90 && A.pdfPageTurn(45) === 0 && A.pdfPageTurn(undefined) === 0,
    "#318 pdfPageTurn reads a PDF /Rotate the way pdf.js does (not a multiple of 90 → 0)");
  ok(J(A.sanitizeCrop({ x: -1, y: 0.5, w: 2, h: 0.9 })) === J({ x: 0, y: 0.1, w: 1, h: 0.9 }),
    "#318 sanitizeCrop clamps to the unit square, keeping the size and moving the box back in");
  ok(J(A.sanitizeCrop({ x: 0.995, y: 0, w: 0, h: 0.001 })) === J({ x: 0.98, y: 0, w: 0.02, h: 0.02 }) && J(A.sanitizeCrop("junk")) === J(A.IDENTITY_CROP),
    "#318 sanitizeCrop: each side is at least MIN_CROP; junk is the full page");
  const X = { rotate: 90 as const, crop: A.IDENTITY_CROP };
  const Y = { rotate: 0 as const, crop: { x: 0.1, y: 0, w: 0.5, h: 1 } };
  ok(J(A.sanitizeAdjustPages({ "1": { rotate: 0, crop: { x: 0, y: 0, w: 1, h: 1 } }, "2": { rotate: 91, crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } }, "0": X, a: X, "03": X })) ===
     J({ "2": { rotate: 90, crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } } }) && J(A.sanitizeAdjustPages([X])) === "{}",
    "#318 sanitizeAdjustPages drops identity pages and junk keys and snaps rotation");
  ok(J(A.changedPages({ "1": X, "3": Y }, { "1": X, "2": Y })) === J([2, 3]) && J(A.changedPages(undefined, {})) === "[]",
    "#318 changedPages lists the pages whose adjust differs (a missing page is identity)");
  const c = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
  ok(J(A.rotateCrop(c, "cw")) === J({ x: 0.4, y: 0.1, w: 0.4, h: 0.3 }) && J(A.rotateCrop(A.rotateCrop(c, "cw"), "ccw")) === J(c) &&
     J(A.rotateCrop(A.rotateCrop(A.rotateCrop(A.rotateCrop(c, "cw"), "cw"), "cw"), "cw")) === J(c),
    "#318 rotateCrop: the crop turns with the page (cw then ccw, or four cw, is where it started)");
  ok(A.turnAdjust({ rotate: 270, crop: A.IDENTITY_CROP }, "cw").rotate === 0 && A.turnAdjust({ rotate: 0, crop: A.IDENTITY_CROP }, "ccw").rotate === 270,
    "#318 turnAdjust wraps 270 ⟳ to 0 and 0 ⟲ to 270");
  const box = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };
  ok(J(A.dragCrop(box, "move", 0.9, -0.5)) === J({ x: 0.5, y: 0, w: 0.5, h: 0.5 }) && J(A.dragCrop(box, "se", 0.1, 0.2)) === J({ x: 0.1, y: 0.1, w: 0.6, h: 0.7 }) &&
     J(A.dragCrop(box, "nw", 0.9, 0.9)) === J({ x: 0.58, y: 0.58, w: 0.02, h: 0.02 }) && J(A.dragCrop(box, "e", -1, 0)) === J({ x: 0.1, y: 0.1, w: 0.02, h: 0.5 }),
    "#318 dragCrop: move stays on the page, a corner resizes, and a side never crosses the opposite one");

  // PDF boxes — the worked checks in the plan.
  const view: [number, number, number, number] = [10, 20, 160, 80];
  const crop = { x: 0.2, y: 0.25, w: 0.5, h: 0.5 };
  const want: Record<number, number[]> = { 0: [40, 35, 115, 65], 90: [47.5, 32, 122.5, 62], 180: [55, 35, 130, 65], 270: [47.5, 38, 122.5, 68] };
  ok(([0, 90, 180, 270] as const).every((R) => { const r = A.cropToPdfBox(view, 0, { rotate: R, crop }); return near(r.box, want[R]) && r.rotate === R; }),
    "#318 cropToPdfBox: the four total rotations give the hand-derived CropBoxes");
  ok(near(A.cropToPdfBox(view, 90, { rotate: 90, crop }).box, want[180]) && A.cropToPdfBox(view, 90, { rotate: 90, crop }).rotate === 180 &&
     near(A.cropToPdfBox(view, -90, { rotate: 90, crop }).box, want[0]) && A.cropToPdfBox(view, -90, { rotate: 90, crop }).rotate === 0,
    "#318 cropToPdfBox folds the root page's own /Rotate in first");
  ok(near(A.effectiveBox([0, 0, 200, 100], [10, 20, 160, 80]), view) && near(A.effectiveBox([200, 100, 0, 0], [160, 80, 10, 20]), view) &&
     near(A.effectiveBox([0, 0, 200, 100], [300, 300, 400, 400]), [0, 0, 200, 100]) && near(A.effectiveBox([0, 0, 200, 100], [-50, 20, 160, 500]), [0, 20, 160, 100]) &&
     near(A.effectiveBox([0, 0, 200, 100], null), [0, 0, 200, 100]),
    "#318 effectiveBox is pdf.js's view: CropBox ∩ MediaBox, normalized, else the MediaBox");

  // The same math, checked against pdf.js itself.
  const { PDFDocument, degrees } = await import("pdf-lib");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await PDFDocument.create();
  const p1 = doc.addPage([200, 100]);
  p1.setCropBox(10, 20, 150, 60);
  p1.setRotation(degrees(90));
  doc.addPage([300, 200]).setRotation(degrees(270));
  const task = pdfjs.getDocument({ data: new Uint8Array(await doc.save()), isEvalSupported: false, disableFontFace: true });
  const pdf = await task.promise;
  let agree = true;
  for (const n of [1, 2]) {
    const pg = await pdf.getPage(n);
    const pv = A.normalizeBox(pg.view);
    for (const R of [0, 90, 180, 270] as const) {
      const vp = pg.getViewport({ scale: 1, rotation: R });
      for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.2, 0.75]]) {
        const [ex, ey] = vp.convertToPdfPoint(u * vp.width, v * vp.height);
        const [gx, gy] = A.displayToPdf(pv, R, u, v);
        if (Math.abs(ex - gx) > 1e-6 || Math.abs(ey - gy) > 1e-6) agree = false;
      }
    }
  }
  await task.destroy();
  ok(agree, "#318 displayToPdf agrees with pdf.js's own viewport (convertToPdfPoint) at every rotation, with an offset CropBox and a root /Rotate");

  ok(J(A.cropToPixels(400, 200, { rotate: 90, crop: { x: 0.1, y: 0.25, w: 0.5, h: 0.5 } })) === J({ left: 20, top: 100, width: 100, height: 200 }) &&
     J(A.cropToPixels(3, 3, { rotate: 0, crop: { x: 0.98, y: 0.98, w: 0.02, h: 0.02 } })) === J({ left: 2, top: 2, width: 1, height: 1 }) &&
     J(A.rotatedSize(400, 200, 90)) === J([200, 400]) && J(A.rotatedSize(400, 200, 180)) === J([400, 200]),
    "#318 cropToPixels works in the turned image's pixels, at least 1 px each way");

  // The gate.
  const proj = {
    placements: [{ sheetId: "gs-a", page: 1 }, { sheetId: "gs-a", page: 1 }, { sheetId: "gs-b", page: 2 }],
    spaces: [{ sheetId: "gs-a", page: 2 }],
    routes: [{ sheetId: "gs-a", page: 1 }],
    calibrations: [{ docId: "gs-a", page: 3 }],
  };
  const locks = A.pageLocks(proj, "gs-a");
  ok(locks[1] === "This page has 2 devices and 1 wire on it — crop and rotate only work on an empty page." &&
     locks[2] === "This page has 1 space on it — crop and rotate only work on an empty page." &&
     locks[3] === "This page has a scale on it — crop and rotate only work on an empty page." && !locks[4],
    "#318 pageLocks names what sits on each page (devices, spaces, wires, a scale) — another sheet's content doesn't count");
  ok(A.lockReason({ devices: 3, spaces: 1, wires: 0, scale: true }) === "This page has 3 devices, 1 space and a scale on it — crop and rotate only work on an empty page.",
    "#318 lockReason lists three things with commas and 'and'");
  ok(J(A.blockedPages(proj, "gs-a", [4, 3, 1, 1])) === J([1, 3]) && J(A.blockedPages(proj, "gs-b", [1])) === "[]",
    "#318 blockedPages: of the changed pages, the ones with content");
  ok(A.allPagesLocked(locks, 3) && !A.allPagesLocked(locks, 4) && !A.allPagesLocked(locks, 0) && !A.allPagesLocked({}, 1),
    "#318 allPagesLocked only when every one of a known page count is locked");

  // The remap.
  const doc2 = {
    sheetIds: ["gs-x", "gs-a", "gs-y"],
    placements: [{ id: "p1", sheetId: "gs-a", page: 2 }, { id: "p2", sheetId: "gs-x", page: 1 }],
    spaces: [{ id: "s1", sheetId: "gs-a", page: 2 }],
    routes: [{ id: "r1", sheetId: "gs-a", page: 2 }],
    calibrations: [{ docId: "gs-a", page: 2, scale: 1 }, { docId: "gs-x", page: 1, scale: 2 }],
    intake: { planSheetId: "gs-a", baseSheetId: "gs-x" },
    drawingSet: { excluded: ["plan:lighting:gs-a:2", "plan:audio:gs-x:1", "riser"] },
  };
  A.remapSheetRefs(doc2, "gs-a", "gs-n");
  ok(J(doc2.sheetIds) === J(["gs-x", "gs-n", "gs-y"]) && J(doc2.placements) === J([{ id: "p1", sheetId: "gs-n", page: 2 }, { id: "p2", sheetId: "gs-x", page: 1 }]) &&
     doc2.spaces[0].sheetId === "gs-n" && doc2.routes[0].sheetId === "gs-n" && J(doc2.calibrations) === J([{ docId: "gs-n", page: 2, scale: 1 }, { docId: "gs-x", page: 1, scale: 2 }]) &&
     doc2.intake.planSheetId === "gs-n" && doc2.intake.baseSheetId === "gs-x" && J(doc2.drawingSet.excluded) === J(["plan:lighting:gs-n:2", "plan:audio:gs-x:1", "riser"]),
    "#318 remapSheetRefs moves every reference (same position in sheetIds, items keep their other fields, calibration docId, plan view, drawing-set keys) and nothing else");
  ok(A.isBaseSheet({ id: "gs-x", mime: "image/png" }, { baseSheetId: "gs-x" }) && A.isBaseSheet({ id: "gs-q", mime: "image/svg+xml" }) && !A.isBaseSheet({ id: "gs-q", mime: "application/pdf" }, { baseSheetId: "gs-x" }),
    "#318 isBaseSheet: the stamped base sheet, or any SVG (pre-#314 designs)");
  ok(A.adjustRefusalText("in-use", [2]) === "Page 2 has devices, spaces, wires or a scale on it — crop and rotate only work on an empty page." &&
     A.adjustRefusalText("in-use", [1, 3]) === "Pages 1, 3 have devices, spaces, wires or a scale on them — crop and rotate only work on an empty page." &&
     A.adjustRefusalText("base-sheet") === "The generated base plan can't be cropped or rotated.",
    "#318 adjustRefusalText names the pages that block");
}
```

Then add the chain line directly after `.then(() => estimateGrid314AsyncChecks())`:

```ts
  .then(() => sheetAdjust318PureChecks())
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: the run ends with an error naming `Cannot find module '@/lib/design/sheet-adjust'` (exit code 1).

- [ ] **Step 3: Write the module**

Create `src/lib/design/sheet-adjust.ts`:

```ts
/**
 * #318 — Grid sheet crop + rotate: the pure rules (types, sanitize, the
 * crop ↔ PDF-box and crop ↔ pixel math, the content gate, and the reference
 * remap a derived sheet needs). Client-safe: the Adjust sheet dialog, the
 * store and the byte transforms all read this one module.
 *
 * The model (spec 2026-10-09): an adjusted sheet is a NEW grid_sheets doc
 * derived from its ROOT (the original upload) — `adjust.fromSheetId` is
 * always the root, never a chain. Per page, `rotate` is the quarter turns
 * ADDED to the root page's own rotation and `crop` is normalized 0..1 in the
 * root page as displayed after that rotation (top-left origin, y down).
 * Identity ({rotate:0, crop:{0,0,1,1}}) is never stored.
 */

export type QuarterTurn = 0 | 90 | 180 | 270;
export type CropRect = { x: number; y: number; w: number; h: number };
export type PageAdjust = { rotate: QuarterTurn; crop: CropRect };
/** Keys are 1-based page numbers as strings ("1", "2", …). */
export type AdjustPages = Record<string, PageAdjust>;
export type SheetAdjust = { fromSheetId: string; pages: AdjustPages };

export const IDENTITY_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };
export const IDENTITY_ADJUST: PageAdjust = { rotate: 0, crop: IDENTITY_CROP };
/** Smallest crop side, as a fraction of the page side (2 %). */
export const MIN_CROP = 0.02;
/** Most pages one adjust may carry (a 500-page plan set is not a plan sheet). */
export const MAX_ADJUST_PAGES = 500;
const PAGE_KEY_RE = /^[1-9]\d{0,3}$/;

const round4 = (v: number): number => Math.round(v * 10000) / 10000;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Any angle → the nearest quarter turn in 0..270 (user input: snapped). */
export function snapTurn(raw: unknown): QuarterTurn {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 0;
  return ((((Math.round(n / 90) * 90) % 360) + 360) % 360) as QuarterTurn;
}

/** A PDF page's own /Rotate the way pdf.js reads it: not a multiple of 90 → 0; else 0..270. */
export function pdfPageTurn(raw: unknown): QuarterTurn {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n % 90 !== 0) return 0;
  return (((n % 360) + 360) % 360) as QuarterTurn;
}

/** A crop clamped to the unit square, each side ≥ MIN_CROP, rounded to 4 places. */
export function sanitizeCrop(raw: unknown): CropRect {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const w = round4(clamp(num(r.w, 1), MIN_CROP, 1));
  const h = round4(clamp(num(r.h, 1), MIN_CROP, 1));
  const x = Math.min(round4(clamp(num(r.x, 0), 0, 1)), round4(1 - w));
  const y = Math.min(round4(clamp(num(r.y, 0), 0, 1)), round4(1 - h));
  return { x, y, w, h };
}

export function sanitizePageAdjust(raw: unknown): PageAdjust {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { rotate: snapTurn(r.rotate), crop: sanitizeCrop(r.crop) };
}

export function isIdentity(a: PageAdjust | null | undefined): boolean {
  if (!a) return true;
  const c = a.crop;
  return a.rotate === 0 && c.x === 0 && c.y === 0 && c.w === 1 && c.h === 1;
}

/** Page → adjust, sanitized; identity pages and junk keys dropped; at most MAX_ADJUST_PAGES. */
export function sanitizeAdjustPages(raw: unknown): AdjustPages {
  const out: AdjustPages = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const keys = Object.keys(raw as Record<string, unknown>)
    .filter((k) => PAGE_KEY_RE.test(k))
    .sort((a, b) => Number(a) - Number(b))
    .slice(0, MAX_ADJUST_PAGES);
  for (const k of keys) {
    const a = sanitizePageAdjust((raw as Record<string, unknown>)[k]);
    if (!isIdentity(a)) out[k] = a;
  }
  return out;
}

export function pageAdjustOf(pages: AdjustPages | null | undefined, page: number): PageAdjust {
  return pages?.[String(page)] ?? IDENTITY_ADJUST;
}

export function samePageAdjust(a: PageAdjust, b: PageAdjust): boolean {
  return a.rotate === b.rotate && a.crop.x === b.crop.x && a.crop.y === b.crop.y && a.crop.w === b.crop.w && a.crop.h === b.crop.h;
}

/** Pages whose adjust differs between two (sanitized) maps — ascending. */
export function changedPages(before: AdjustPages | null | undefined, after: AdjustPages | null | undefined): number[] {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...keys]
    .map(Number)
    .filter((n) => !samePageAdjust(pageAdjustOf(before, n), pageAdjustOf(after, n)))
    .sort((a, b) => a - b);
}

/** Width × height after a quarter turn. */
export function rotatedSize(w: number, h: number, turn: QuarterTurn): [number, number] {
  return turn === 90 || turn === 270 ? [h, w] : [w, h];
}

/** The crop as seen after turning the page one quarter clockwise ("cw") or counter-clockwise. */
export function rotateCrop(c: CropRect, dir: "cw" | "ccw"): CropRect {
  return dir === "cw"
    ? { x: round4(1 - (c.y + c.h)), y: round4(c.x), w: c.h, h: c.w }
    : { x: round4(c.y), y: round4(1 - (c.x + c.w)), w: c.h, h: c.w };
}

/** ⟳ / ⟲ — the page and its crop box turn together. */
export function turnAdjust(a: PageAdjust, dir: "cw" | "ccw"): PageAdjust {
  return { rotate: snapTurn(a.rotate + (dir === "cw" ? 90 : -90)), crop: rotateCrop(a.crop, dir) };
}

export type CropHandle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** One crop-box drag: `dx`/`dy` are the pointer's travel as fractions of the displayed page. */
export function dragCrop(c: CropRect, handle: CropHandle, dx: number, dy: number): CropRect {
  if (handle === "move") {
    return { x: round4(clamp(c.x + dx, 0, 1 - c.w)), y: round4(clamp(c.y + dy, 0, 1 - c.h)), w: c.w, h: c.h };
  }
  let { x, y } = c;
  let r = c.x + c.w;
  let b = c.y + c.h;
  if (handle.includes("w")) x = clamp(c.x + dx, 0, r - MIN_CROP);
  if (handle.includes("e")) r = clamp(r + dx, x + MIN_CROP, 1);
  if (handle.includes("n")) y = clamp(c.y + dy, 0, b - MIN_CROP);
  if (handle.includes("s")) b = clamp(b + dy, y + MIN_CROP, 1);
  return sanitizeCrop({ x, y, w: r - x, h: b - y });
}

/* ------------------------------ PDF geometry ------------------------------ */

/** [llx, lly, urx, ury] in PDF user space, ll < ur. */
export type PdfBox = [number, number, number, number];

export function normalizeBox(b: readonly number[]): PdfBox {
  return [Math.min(b[0], b[2]), Math.min(b[1], b[3]), Math.max(b[0], b[2]), Math.max(b[1], b[3])];
}

/** What pdf.js draws (its `page.view`): CropBox ∩ MediaBox, or the MediaBox when that is empty. */
export function effectiveBox(media: readonly number[], crop?: readonly number[] | null): PdfBox {
  const m = normalizeBox(media);
  if (!crop) return m;
  const c = normalizeBox(crop);
  const box: PdfBox = [Math.max(m[0], c[0]), Math.max(m[1], c[1]), Math.min(m[2], c[2]), Math.min(m[3], c[3])];
  return box[2] - box[0] > 0 && box[3] - box[1] > 0 ? box : m;
}

/**
 * A point of the page as DISPLAYED at total clockwise rotation `turn`
 * (u, v in 0..1 of the displayed width/height, top-left origin, y down) → PDF
 * user space. pdf.js: at 0 the display's top-left is the box's top-left
 * (x0, y1); each clockwise quarter moves the box corner shown there
 * counter-clockwise: 90 → (x0, y0), 180 → (x1, y0), 270 → (x1, y1).
 */
export function displayToPdf(box: PdfBox, turn: QuarterTurn, u: number, v: number): [number, number] {
  const [x0, y0, x1, y1] = box;
  const W = x1 - x0;
  const H = y1 - y0;
  switch (turn) {
    case 90:
      return [x0 + v * W, y0 + u * H];
    case 180:
      return [x1 - u * W, y0 + v * H];
    case 270:
      return [x1 - v * W, y1 - u * H];
    default:
      return [x0 + u * W, y1 - v * H];
  }
}

/** The CropBox and /Rotate that show `view` (the root page's effective box, own rotation `rootTurn`) cropped and turned by `a`. */
export function cropToPdfBox(view: PdfBox, rootTurn: number, a: PageAdjust): { box: PdfBox; rotate: QuarterTurn } {
  const turn = snapTurn(pdfPageTurn(rootTurn) + a.rotate);
  const [ax, ay] = displayToPdf(view, turn, a.crop.x, a.crop.y);
  const [bx, by] = displayToPdf(view, turn, a.crop.x + a.crop.w, a.crop.y + a.crop.h);
  return { box: normalizeBox([ax, ay, bx, by]), rotate: turn };
}

/** The pixel region to extract from an image of (EXIF-oriented) size w × h after turning it by `a.rotate`. */
export function cropToPixels(w: number, h: number, a: PageAdjust): { width: number; height: number; left: number; top: number } {
  const [W, H] = rotatedSize(w, h, a.rotate);
  const left = clamp(Math.round(a.crop.x * W), 0, W - 1);
  const top = clamp(Math.round(a.crop.y * H), 0, H - 1);
  const right = clamp(Math.round((a.crop.x + a.crop.w) * W), left + 1, W);
  const bottom = clamp(Math.round((a.crop.y + a.crop.h) * H), top + 1, H);
  return { left, top, width: right - left, height: bottom - top };
}

/* ------------------------- the gate and the remap ------------------------- */

/** The parts of a Grid project that name a sheet (structural, so this module stays store-free). */
export type SheetRefsDoc = {
  sheetIds?: string[];
  placements?: Array<{ sheetId: string; page: number }>;
  spaces?: Array<{ sheetId: string; page: number }>;
  routes?: Array<{ sheetId: string; page: number }>;
  calibrations?: Array<{ docId: string; page: number }>;
  intake?: { planSheetId?: string; baseSheetId?: string } | null;
  drawingSet?: { excluded?: string[] } | null;
};

export type PageContent = { devices: number; spaces: number; wires: number; scale: boolean };

/** What sits on each page of one sheet, across every option. Pages with nothing are absent. */
export function pageContents(p: SheetRefsDoc, sheetId: string): Map<number, PageContent> {
  const out = new Map<number, PageContent>();
  const at = (page: number): PageContent => {
    let c = out.get(page);
    if (!c) out.set(page, (c = { devices: 0, spaces: 0, wires: 0, scale: false }));
    return c;
  };
  for (const pl of p.placements || []) if (pl.sheetId === sheetId) at(pl.page).devices++;
  for (const sp of p.spaces || []) if (sp.sheetId === sheetId) at(sp.page).spaces++;
  for (const r of p.routes || []) if (r.sheetId === sheetId) at(r.page).wires++;
  for (const c of p.calibrations || []) if (c.docId === sheetId) at(c.page).scale = true;
  return out;
}

/** Of `pages`, the ones that have anything on them (the adjust gate) — ascending. */
export function blockedPages(p: SheetRefsDoc, sheetId: string, pages: readonly number[]): number[] {
  const on = pageContents(p, sheetId);
  return [...new Set(pages)].filter((n) => on.has(n)).sort((a, b) => a - b);
}

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? "" : "s"}`;

/** "This page has 3 devices, 1 space and a scale on it — …" (the dialog's locked-page note). */
export function lockReason(c: PageContent): string {
  const parts = [
    c.devices ? plural(c.devices, "device") : "",
    c.spaces ? plural(c.spaces, "space") : "",
    c.wires ? plural(c.wires, "wire") : "",
    c.scale ? "a scale" : "",
  ].filter(Boolean);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] || "something";
  return `This page has ${list} on it — crop and rotate only work on an empty page.`;
}

/** Page number → lock reason, for every page of `sheetId` that has content. */
export function pageLocks(p: SheetRefsDoc, sheetId: string): Record<number, string> {
  const out: Record<number, string> = {};
  for (const [page, c] of pageContents(p, sheetId)) out[page] = lockReason(c);
  return out;
}

/** Is every one of `pageCount` pages locked? (Crop & rotate… is disabled then.) */
export function allPagesLocked(locks: Record<number, string>, pageCount: number): boolean {
  if (!(pageCount >= 1)) return false;
  for (let n = 1; n <= pageCount; n++) if (!locks[n]) return false;
  return true;
}

/**
 * Point every stored reference to `oldId` at `newId`, in place, on a doc
 * patchDoc just read: the sheet order (same position), placements, spaces,
 * routes, calibrations (`docId`), the intake's plan view and drawing-set
 * exclusion keys `plan:<system>:<sheetId>:<page>`. The adjust gate has
 * already guaranteed nothing sits on a page whose frame changed, so every
 * reference moves. Revisions are history and are never touched; the base
 * sheet id is never remapped (the base sheet is never adjusted).
 */
export function remapSheetRefs(p: SheetRefsDoc, oldId: string, newId: string): void {
  p.sheetIds = (p.sheetIds || []).map((id) => (id === oldId ? newId : id));
  const move = <T extends { sheetId: string }>(list: T[] | undefined): T[] | undefined =>
    list?.map((x) => (x.sheetId === oldId ? { ...x, sheetId: newId } : x));
  if (p.placements) p.placements = move(p.placements);
  if (p.spaces) p.spaces = move(p.spaces);
  if (p.routes) p.routes = move(p.routes);
  if (p.calibrations) p.calibrations = p.calibrations.map((c) => (c.docId === oldId ? { ...c, docId: newId } : c));
  if (p.intake?.planSheetId === oldId) p.intake.planSheetId = newId;
  if (p.drawingSet?.excluded) {
    p.drawingSet.excluded = p.drawingSet.excluded.map((k) => {
      const parts = k.split(":");
      return parts[0] === "plan" && parts.length === 4 && parts[2] === oldId ? [parts[0], parts[1], newId, parts[3]].join(":") : k;
    });
  }
}

/** Is this the generated base sheet (never cropped or rotated)? */
export function isBaseSheet(sheet: { id: string; mime: string }, intake?: { baseSheetId?: string } | null): boolean {
  return sheet.id === intake?.baseSheetId || /svg/i.test(sheet.mime || "");
}

/* --------------------------------- copy --------------------------------- */

export type AdjustRefusal = "not-found" | "no-such-sheet" | "base-sheet" | "in-use" | "unsupported" | "encrypted" | "unreadable" | "too-big" | "failed";

export function adjustRefusalText(reason: AdjustRefusal, pages: readonly number[] = []): string {
  switch (reason) {
    case "not-found":
      return "That design could not be found.";
    case "no-such-sheet":
      return "That sheet could not be found.";
    case "base-sheet":
      return "The generated base plan can't be cropped or rotated.";
    case "in-use":
      return pages.length > 1
        ? `Pages ${pages.join(", ")} have devices, spaces, wires or a scale on them — crop and rotate only work on an empty page.`
        : `Page ${pages[0] ?? ""} has devices, spaces, wires or a scale on it — crop and rotate only work on an empty page.`;
    case "unsupported":
      return "This sheet's file type can't be cropped — upload it as a PDF, PNG, JPEG, WebP or GIF.";
    case "encrypted":
      return "This PDF is password-protected — print it to a new PDF and upload that.";
    case "unreadable":
      return "Couldn't read this sheet's file — upload it again and try once more.";
    case "too-big":
      return "The adjusted sheet is too large to store without file storage — crop it tighter or use a smaller file.";
    default:
      return "Couldn't save the adjusted sheet — try again.";
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:specs 2>&1 | grep -E "#318|FAIL|ALL PASSED|FAILED"`
Expected: every `#318` line starts with `PASS`; the run ends with `ALL PASSED`.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit -p . 2>&1 | tail -3` → no output.
Run: `npx eslint src/lib/design/sheet-adjust.ts` → no output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/design/sheet-adjust.ts scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(grid): #318 sheet-adjust pure rules (crop/rotate math, gate, remap)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Byte transforms — `src/lib/design/sheet-adjust-bytes.ts`

**Files:**
- Create: `src/lib/design/sheet-adjust-bytes.ts`
- Test: `scripts/test-review-and-spec.ts` (new `sheetAdjust318BytesChecks` + chain line)

**Interfaces:**
- Consumes (Task 1): `cropToPdfBox`, `cropToPixels`, `effectiveBox`, `pageAdjustOf`, `type AdjustPages`. Also `sniffImageType` (`@/lib/part-docs/files`), `SHRINK_MAX_INPUT_PIXELS` (`@/lib/part-docs/shrink`).
- Produces (Task 3): `type SheetKind = "pdf" | "image/png" | "image/jpeg" | "image/webp" | "image/gif"`; `sheetKindOf(bytes: Uint8Array): SheetKind | null`; `type AdjustBytesResult = { ok: true; bytes: Uint8Array; mime: string } | { ok: false; reason: "unsupported" | "encrypted" | "unreadable" }`; `adjustSheetBytes(bytes: Uint8Array, pages: AdjustPages): Promise<AdjustBytesResult>`.

Notes for the implementer: pdf-lib's `getCropBox()` falls back to the MediaBox and both read inherited values; `getRotation().angle` is the raw (possibly negative) `/Rotate` — `cropToPdfBox` normalizes it like pdf.js. sharp 0.35's constructor option `autoOrient: true` applies EXIF orientation before `.rotate(deg)`; `.rotate(deg).extract(...)` extracts in the *turned* image (verified during planning: a 40×20 JPEG with EXIF orientation 6 comes out 20×40 before the turn). `sheetKindOf` is deliberately tolerant (a `%PDF-` anywhere in the first KB, no markup check): it decides how to *parse* a sheet already stored, unlike the upload sniff in Task 4 which decides what may be *stored*.

- [ ] **Step 1: Write the failing test**

Append to the end of `scripts/test-review-and-spec.ts`:

```ts
/* ---------------- #318: Grid sheet crop + rotate — byte transforms ---------------- */
async function sheetAdjust318BytesChecks(): Promise<void> {
  const B = await import("@/lib/design/sheet-adjust-bytes");
  const { PDFDocument, degrees } = await import("pdf-lib");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const sharp = (await import("sharp")).default;
  const near = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
  const views = async (bytes: Uint8Array) => {
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true });
    const pdf = await task.promise;
    const out: Array<{ view: number[]; rotate: number }> = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const pg = await pdf.getPage(n);
      out.push({ view: [...pg.view], rotate: pg.rotate });
    }
    await task.destroy();
    return out;
  };

  // A two-page PDF: page 1 has an offset CropBox and its own /Rotate 90; page 2 is plain.
  const doc = await PDFDocument.create();
  const p1 = doc.addPage([200, 100]);
  p1.setCropBox(10, 20, 150, 60);
  p1.setRotation(degrees(90));
  doc.addPage([300, 200]);
  const src = await doc.save();
  ok(B.sheetKindOf(src) === "pdf" && B.sheetKindOf(new TextEncoder().encode("hello")) === null, "#318 sheetKindOf: a PDF is a PDF; text is nothing");

  const r1 = await B.adjustSheetBytes(src, { "1": { rotate: 90, crop: { x: 0.2, y: 0.25, w: 0.5, h: 0.5 } } });
  const v1 = r1.ok ? await views(r1.bytes) : [];
  ok(r1.ok && r1.mime === "application/pdf" && v1.length === 2 && near(v1[0].view, [55, 35, 130, 65]) && v1[0].rotate === 180 && near(v1[1].view, [0, 0, 300, 200]) && v1[1].rotate === 0,
    "#318 a PDF page is cropped (CropBox) and turned (/Rotate = own 90 + 90) as pdf.js reads it back; the untouched page keeps its boxes");
  if (r1.ok) {
    const back = await PDFDocument.load(r1.bytes);
    const cb = back.getPage(0).getCropBox();
    ok(near([cb.x, cb.y, cb.width, cb.height], [55, 35, 75, 30]) && back.getPage(0).getRotation().angle === 180 && back.getPage(0).getMediaBox().width === 200,
      "#318 pdf-lib reads back the same CropBox and /Rotate, and the MediaBox is untouched (vector stays vector)");
  }
  const r2 = await B.adjustSheetBytes(src, { "2": { rotate: 270, crop: { x: 0, y: 0, w: 1, h: 1 } } });
  const v2 = r2.ok ? await views(r2.bytes) : [];
  ok(r2.ok && near(v2[0].view, [10, 20, 160, 80]) && v2[0].rotate === 90 && near(v2[1].view, [0, 0, 300, 200]) && v2[1].rotate === 270,
    "#318 turning page 2 only leaves page 1 exactly as it was");
  const r3 = await B.adjustSheetBytes(src, { "9": { rotate: 90, crop: { x: 0, y: 0, w: 1, h: 1 } } });
  ok(r3.ok && (await views(r3.bytes)).every((v, i) => v.rotate === [90, 0][i]), "#318 a page the file doesn't have is ignored");
  const bad = await B.adjustSheetBytes(new TextEncoder().encode("%PDF-1.7 not really a pdf"), { "1": { rotate: 90, crop: { x: 0, y: 0, w: 1, h: 1 } } });
  const none = await B.adjustSheetBytes(new TextEncoder().encode("hello"), {});
  ok(!bad.ok && bad.reason === "unreadable" && !none.ok && none.reason === "unsupported", "#318 a broken PDF is unreadable; an unknown file is unsupported");

  // A 400 × 200 PNG in quadrants: top-left red, top-right green, bottom-left blue, bottom-right white.
  const raw = Buffer.alloc(400 * 200 * 3);
  for (let y = 0; y < 200; y++) for (let x = 0; x < 400; x++) {
    const i = (y * 400 + x) * 3;
    const col = x < 200 ? (y < 100 ? [255, 0, 0] : [0, 0, 255]) : y < 100 ? [0, 255, 0] : [255, 255, 255];
    raw[i] = col[0]; raw[i + 1] = col[1]; raw[i + 2] = col[2];
  }
  const png = await sharp(raw, { raw: { width: 400, height: 200, channels: 3 } }).png().toBuffer();
  // Turned 90° clockwise the image is 200 × 400 with red at the top right; the crop's
  // top-left pixel (20, 100) comes from the original's bottom-left (blue), its
  // top-right pixel (119, 100) from the original's top-left (red).
  const ri = await B.adjustSheetBytes(png, { "1": { rotate: 90, crop: { x: 0.1, y: 0.25, w: 0.5, h: 0.5 } } });
  const px = ri.ok ? await sharp(ri.bytes).raw().toBuffer({ resolveWithObject: true }) : null;
  const at = (x: number) => (px ? [...px.data.subarray(x * px.info.channels, x * px.info.channels + 3)] : []);
  ok(ri.ok && ri.mime === "image/png" && px?.info.width === 100 && px?.info.height === 200 && JSON.stringify(at(0)) === "[0,0,255]" && JSON.stringify(at(99)) === "[255,0,0]",
    "#318 an image is turned, then cropped in the turned image's pixels, and stays a PNG");
  const jpg = await sharp(Buffer.alloc(40 * 20 * 3, 128), { raw: { width: 40, height: 20, channels: 3 } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const rj = await B.adjustSheetBytes(jpg, { "1": { rotate: 0, crop: { x: 0, y: 0, w: 1, h: 0.5 } } });
  const mj = rj.ok ? await sharp(rj.bytes).metadata() : null;
  ok(rj.ok && rj.mime === "image/jpeg" && mj?.width === 20 && mj?.height === 20 && !mj?.orientation,
    "#318 a JPEG is EXIF-oriented first (orientation 6: 40 × 20 shows 20 × 40), stays a JPEG, and drops the orientation tag");
  const webp = await sharp(raw, { raw: { width: 400, height: 200, channels: 3 } }).webp().toBuffer();
  const rw = await B.adjustSheetBytes(webp, { "1": { rotate: 0, crop: { x: 0, y: 0, w: 0.5, h: 1 } } });
  const mw = rw.ok ? await sharp(rw.bytes).metadata() : null;
  ok(rw.ok && rw.mime === "image/webp" && mw?.format === "webp" && mw?.width === 200 && mw?.height === 200, "#318 a WebP stays a WebP");
  const gif = await sharp(raw, { raw: { width: 400, height: 200, channels: 3 } }).gif().toBuffer();
  const rg = await B.adjustSheetBytes(gif, { "1": { rotate: 180, crop: { x: 0, y: 0, w: 0.5, h: 1 } } });
  const mg = rg.ok ? await sharp(rg.bytes).metadata() : null;
  ok(B.sheetKindOf(gif) === "image/gif" && rg.ok && rg.mime === "image/png" && mg?.format === "png" && mg?.width === 200 && mg?.height === 200,
    "#318 a GIF is read and comes back as a PNG");
}
```

Chain it after the Task 1 line:

```ts
  .then(() => sheetAdjust318BytesChecks())
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: an error naming `Cannot find module '@/lib/design/sheet-adjust-bytes'`.

- [ ] **Step 3: Write the module**

Create `src/lib/design/sheet-adjust-bytes.ts`:

```ts
// SERVER ONLY — pdf-lib + sharp (native). Never import from a "use client" file.
/**
 * #318 — the byte half of Adjust sheet: a root sheet's file in, the adjusted
 * file out. PDFs keep their vector content (pdf-lib sets each adjusted page's
 * /CropBox and /Rotate; untouched pages keep their boxes). Images (page 1
 * only) are EXIF-oriented, turned, cropped and re-encoded by sharp in their
 * own format (GIF → PNG). Pure in, bytes out — no storage, no store.
 */
import { degrees, PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { sniffImageType } from "@/lib/part-docs/files";
import { SHRINK_MAX_INPUT_PIXELS } from "@/lib/part-docs/shrink";
import { cropToPdfBox, cropToPixels, effectiveBox, pageAdjustOf, type AdjustPages } from "./sheet-adjust";

export type SheetKind = "pdf" | "image/png" | "image/jpeg" | "image/webp" | "image/gif";
export type AdjustBytesResult = { ok: true; bytes: Uint8Array; mime: string } | { ok: false; reason: "unsupported" | "encrypted" | "unreadable" };

/** What a sheet's bytes really are (the stored mime is not trusted for this). */
export function sheetKindOf(bytes: Uint8Array): SheetKind | null {
  const img = sniffImageType(bytes);
  if (img) return img;
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return "image/gif";
  const head = Array.from(bytes.subarray(0, 1024), (b) => String.fromCharCode(b)).join("");
  return head.includes("%PDF-") ? "pdf" : null;
}

export async function adjustSheetBytes(bytes: Uint8Array, pages: AdjustPages): Promise<AdjustBytesResult> {
  const kind = sheetKindOf(bytes);
  if (!kind) return { ok: false, reason: "unsupported" };
  return kind === "pdf" ? adjustPdf(bytes, pages) : adjustImage(bytes, kind, pages);
}

async function adjustPdf(bytes: Uint8Array, pages: AdjustPages): Promise<AdjustBytesResult> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    return { ok: false, reason: e instanceof Error && e.name === "EncryptedPDFError" ? "encrypted" : "unreadable" };
  }
  try {
    const list = doc.getPages();
    for (const key of Object.keys(pages)) {
      const page = list[Number(key) - 1];
      if (!page) continue; // the file has no such page — nothing to adjust
      const m = page.getMediaBox();
      const c = page.getCropBox();
      const view = effectiveBox([m.x, m.y, m.x + m.width, m.y + m.height], [c.x, c.y, c.x + c.width, c.y + c.height]);
      const { box, rotate } = cropToPdfBox(view, page.getRotation().angle, pages[key]);
      page.setCropBox(box[0], box[1], box[2] - box[0], box[3] - box[1]);
      page.setRotation(degrees(rotate));
    }
    return { ok: true, bytes: await doc.save(), mime: "application/pdf" };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

async function adjustImage(bytes: Uint8Array, kind: Exclude<SheetKind, "pdf">, pages: AdjustPages): Promise<AdjustBytesResult> {
  const a = pageAdjustOf(pages, 1);
  try {
    const meta = await sharp(bytes, { failOn: "error", limitInputPixels: SHRINK_MAX_INPUT_PIXELS }).metadata();
    const w = meta.autoOrient?.width ?? meta.width;
    const h = meta.autoOrient?.height ?? meta.height;
    if (!w || !h) return { ok: false, reason: "unreadable" };
    let img = sharp(bytes, { failOn: "error", limitInputPixels: SHRINK_MAX_INPUT_PIXELS, autoOrient: true });
    if (a.rotate) img = img.rotate(a.rotate);
    img = img.extract(cropToPixels(w, h, a));
    if (kind === "image/jpeg") return { ok: true, bytes: await img.jpeg({ quality: 92 }).toBuffer(), mime: "image/jpeg" };
    if (kind === "image/webp") return { ok: true, bytes: await img.webp({ quality: 90 }).toBuffer(), mime: "image/webp" };
    return { ok: true, bytes: await img.png().toBuffer(), mime: "image/png" };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:specs 2>&1 | grep -E "#318|FAIL|ALL PASSED|FAILED"`
Expected: every `#318` line `PASS`; `ALL PASSED`.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit -p . 2>&1 | tail -3` → no output.
Run: `npx eslint src/lib/design/sheet-adjust-bytes.ts` → no output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/design/sheet-adjust-bytes.ts scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(grid): #318 sheet-adjust byte transforms (pdf-lib CropBox/Rotate, sharp)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Store swap, orchestrator and `adjustSheetAction`

**Files:**
- Modify: `src/lib/stores/grid-projects.ts` (imports ~line 1–40; `GridSheet` ~line 324; new function after `removeSheet`, before `addPlacement` ~line 698)
- Create: `src/lib/design/sheet-adjust-server.ts`
- Modify: `src/app/(app)/design/grid/[id]/actions.ts` (import block ~line 3–60; new action after `removeSheetAction` ~line 1085)
- Test: `scripts/test-review-and-spec.ts` (new `sheetAdjust318StoreChecks` + chain line)

**Interfaces:**
- Consumes (Task 1): `blockedPages`, `remapSheetRefs`, `isBaseSheet`, `changedPages`, `sanitizeAdjustPages`, `adjustRefusalText`, `type SheetAdjust`, `type AdjustRefusal`. (Task 2): `adjustSheetBytes`.
- Produces:
  - `GridSheet.adjust?: SheetAdjust` (Task 5 reads it in the page payload).
  - `replaceSheetWithAdjusted(projectId: string, oldSheetId: string, input: { name: string; mime: string; dataUrl?: string; url?: string; blobPath?: string; adjust: SheetAdjust; by: string }, changed: readonly number[]): Promise<{ ok: true; sheet: GridSheet } | { ok: false; reason: "not-found" | "no-such-sheet" | "base-sheet" | "in-use"; pages?: number[] }>`.
  - `adjustSheet(projectId: string, sheetId: string, rawPages: unknown, by: string): Promise<{ ok: true; sheetId: string; unchanged?: true } | { ok: false; reason: AdjustRefusal; pages?: number[] }>`; constants `SHEET_ADJUST_READ_MAX_BYTES`, `SHEET_ADJUST_DATAURL_MAX_BYTES`.
  - Server action `adjustSheetAction(projectId: string, sheetId: string, pages: unknown): Promise<{ ok: true; sheetId: string } | { ok: false; error: string }>` (Task 5's dialog calls it).

- [ ] **Step 1: Write the failing test**

Append to the end of `scripts/test-review-and-spec.ts`:

```ts
/* ---------------- #318: Grid sheet crop + rotate — store + orchestrator ---------------- */
async function sheetAdjust318StoreChecks(): Promise<void> {
  type G318Sheet = import("@/lib/stores/grid-projects").GridSheet;
  // In-database sheets only (data-URLs): this suite never writes to Blob.
  const prevBlob = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  try {
    const G = await import("@/lib/stores/grid-projects");
    const S = await import("@/lib/design/sheet-adjust-server");
    const DS = await import("@/db/doc-store");
    const { DEFAULT_OPTION_ID } = await import("@/lib/design/grid-options");
    const { decodeDataUrl } = await import("@/lib/grid-sheet-file");
    const { PDFDocument, degrees } = await import("pdf-lib");
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const J = (v: unknown) => JSON.stringify(v);
    const near = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
    const by = "Test Harness";
    const views = async (dataUrl: string) => {
      const task = pdfjs.getDocument({ data: new Uint8Array(decodeDataUrl(dataUrl)!.bytes), isEvalSupported: false, disableFontFace: true });
      const pdf = await task.promise;
      const out: Array<{ view: number[]; rotate: number }> = [];
      for (let n = 1; n <= pdf.numPages; n++) { const pg = await pdf.getPage(n); out.push({ view: [...pg.view], rotate: pg.rotate }); }
      await task.destroy();
      return out;
    };

    const doc = await PDFDocument.create();
    const p1 = doc.addPage([200, 100]);
    p1.setCropBox(10, 20, 150, 60);
    p1.setRotation(degrees(90));
    doc.addPage([300, 200]);
    const pdfUrl = `data:application/pdf;base64,${Buffer.from(await doc.save()).toString("base64")}`;
    const PNG = "data:image/png;base64,iVBORw0KGgo=";

    const gp = await G.createProject({ name: "#318 test grid project", customer: "Spec fixture", customerId: null, by });
    registerFixture("grid_projects", gp.id);
    const add = async (name: string, mime: string, dataUrl: string) => {
      const sh = await G.addSheet(gp.id, { name, mime, dataUrl, by });
      if (sh) registerFixture("grid_sheets", sh.id);
      return sh!;
    };
    const before = await add("#318 Before", "image/png", PNG);
    const plan = await add("#318 Plan.pdf", "application/pdf", pdfUrl);
    const after = await add("#318 After", "image/png", PNG);
    const square = [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.1 }, { x: 0.4, y: 0.4 }, { x: 0.1, y: 0.4 }];
    // Everything sits on page 2; page 1 is empty.
    await G.addPlacement(gp.id, { sheetId: plan.id, page: 2, x: 0.5, y: 0.5, partId: "TEST-PART", optionId: DEFAULT_OPTION_ID, by });
    await G.addSpace(gp.id, { sheetId: plan.id, page: 2, name: "Stage", points: square, by });
    await G.addRoute(gp.id, { sheetId: plan.id, page: 2, partId: "TEST-WIRE", points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }], aspect: 1, optionId: DEFAULT_OPTION_ID, by });
    await G.setSheetCalibration(gp.id, { docId: plan.id, page: 2, scale: 100, unit: "ft", refLength: 10, by, at: 1 });
    await G.recordIntakePlan(gp.id, plan.id, "upload:00000000-0000-4000-8000-000000000318");
    await G.setDrawingSet(gp.id, { excluded: [`plan:lighting:${plan.id}:2`, "riser"] });
    const revsBefore = ((await G.getProject(gp.id))!.revisions || []).length;

    const busy = await S.adjustSheet(gp.id, plan.id, { "2": { rotate: 90, crop: { x: 0, y: 0, w: 1, h: 1 } } }, by);
    ok(!busy.ok && busy.reason === "in-use" && J(busy.pages) === "[2]", "#318 adjustSheet refuses a page with content on it, naming the page");
    const same = await S.adjustSheet(gp.id, plan.id, {}, by);
    ok(same.ok && same.sheetId === plan.id && same.unchanged === true, "#318 an adjust that changes nothing is a no-op on the same sheet");

    const A1 = { rotate: 90, crop: { x: 0.2, y: 0.25, w: 0.5, h: 0.5 } };
    const r1 = await S.adjustSheet(gp.id, plan.id, { "1": A1 }, by);
    if (r1.ok) registerFixture("grid_sheets", r1.sheetId);
    const id1 = r1.ok ? r1.sheetId : "";
    const proj = (await G.getProject(gp.id))!;
    ok(r1.ok && id1 !== plan.id && J(proj.sheetIds) === J([before.id, id1, after.id]), "#318 the derived sheet takes the old one's place in the sheet order");
    ok(proj.placements.every((pl) => pl.sheetId === id1) && (proj.spaces || []).every((sp) => sp.sheetId === id1) &&
       (proj.routes || []).every((r) => r.sheetId === id1) && proj.calibrations.every((c) => c.docId === id1 && c.page === 2),
      "#318 devices, spaces, wires and the scale on the untouched page 2 follow to the new sheet");
    ok(proj.intake?.planSheetId === id1 && J(proj.drawingSet?.excluded) === J([`plan:lighting:${id1}:2`, "riser"]),
      "#318 the intake's plan view and the drawing-set keys follow too");
    ok((proj.revisions || []).length === revsBefore, "#318 an adjust cuts no revision");
    ok(!!(await DS.getDoc("grid_sheets", plan.id)), "#318 the original sheet doc stays readable (revisions may name it)");
    const n1 = (await DS.getDoc<G318Sheet>("grid_sheets", id1))!;
    // (JSONB reorders object keys, so the stored spec is compared field by field.)
    const pg1 = n1.adjust?.pages["1"];
    ok(n1.adjust?.fromSheetId === plan.id && Object.keys(n1.adjust.pages).join() === "1" && pg1?.rotate === 90 && near([pg1.crop.x, pg1.crop.y, pg1.crop.w, pg1.crop.h], [0.2, 0.25, 0.5, 0.5]) &&
       n1.name === plan.name && n1.mime === "application/pdf" && !n1.blobPath,
      "#318 the new sheet records its root and the page spec (stored in-database with Blob off)");
    const v1 = await views(n1.dataUrl);
    ok(near(v1[0].view, [55, 35, 130, 65]) && v1[0].rotate === 180 && near(v1[1].view, [0, 0, 300, 200]) && v1[1].rotate === 0,
      "#318 the stored PDF shows page 1 cropped and turned, page 2 untouched (pdf.js reads it)");

    const r2 = await S.adjustSheet(gp.id, id1, { "1": { rotate: 0, crop: { x: 0, y: 0, w: 0.5, h: 1 } } }, by);
    if (r2.ok) registerFixture("grid_sheets", r2.sheetId);
    const n2 = r2.ok ? await DS.getDoc<G318Sheet>("grid_sheets", r2.sheetId) : null;
    const v2 = n2 ? await views(n2.dataUrl) : [];
    ok(r2.ok && n2?.adjust?.fromSheetId === plan.id && near(v2[0]?.view ?? [], [10, 20, 160, 50]) && v2[0]?.rotate === 90,
      "#318 re-adjusting an adjusted sheet derives from the original upload again (never a chain)");

    const r3 = r2.ok ? await S.adjustSheet(gp.id, r2.sheetId, {}, by) : null;
    if (r3?.ok) registerFixture("grid_sheets", r3.sheetId);
    const n3 = r3?.ok ? await DS.getDoc<G318Sheet>("grid_sheets", r3.sheetId) : null;
    ok(!!r3?.ok && n3?.adjust?.fromSheetId === plan.id && J(n3?.adjust?.pages) === "{}" && n3?.dataUrl === plan.dataUrl,
      "#318 Reset everything makes a sheet that points at the original file (no new bytes)");

    const base = await add("#318 Base", "image/svg+xml", "data:image/svg+xml,<svg/>");
    const rb = await S.adjustSheet(gp.id, base.id, { "1": A1 }, by);
    const gone = await S.adjustSheet(gp.id, plan.id, { "1": A1 }, by);
    const noProj = await S.adjustSheet("GRD-0", plan.id, { "1": A1 }, by);
    ok(!rb.ok && rb.reason === "base-sheet" && !gone.ok && gone.reason === "no-such-sheet" && !noProj.ok && noProj.reason === "not-found",
      "#318 the base sheet, a sheet no longer listed and an unknown design are refused");
    const junk = await add("#318 Junk", "image/png", `data:image/png;base64,${Buffer.from("hello").toString("base64")}`);
    const rj = await S.adjustSheet(gp.id, junk.id, { "1": A1 }, by);
    ok(!rj.ok && rj.reason === "unsupported", "#318 a file that is neither a PDF nor a known image is refused as unsupported");

    // The store's own backstop: content that lands after the pre-check refuses inside the patch.
    await G.addPlacement(gp.id, { sheetId: after.id, page: 1, x: 0.5, y: 0.5, partId: "TEST-PART", optionId: DEFAULT_OPTION_ID, by });
    const late = await G.replaceSheetWithAdjusted(gp.id, after.id, { name: "#318 late", mime: "image/png", dataUrl: PNG, adjust: { fromSheetId: after.id, pages: { "1": { rotate: 90, crop: { x: 0, y: 0, w: 1, h: 1 } } } }, by }, [1]);
    ok(!late.ok && late.reason === "in-use" && J(late.pages) === "[1]" && (await G.getProject(gp.id))!.sheetIds.includes(after.id) &&
       (await DS.listDocsByField("grid_sheets", "name", ["#318 late"])).length === 0,
      "#318 replaceSheetWithAdjusted re-checks the gate on the doc it patches; a refusal soft-deletes the sheet it wrote");
  } finally {
    if (prevBlob === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = prevBlob;
  }
}
```

Chain it after the Task 2 line:

```ts
  .then(() => sheetAdjust318StoreChecks())
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: an error naming `Cannot find module '@/lib/design/sheet-adjust-server'`.

- [ ] **Step 3: Add `GridSheet.adjust` and `replaceSheetWithAdjusted` to the store**

In `src/lib/stores/grid-projects.ts`, add an import below the `grid-plan-intake` import line (`import { cleanIntakeNotices, MAX_INTAKE_NOTICES, type GridIntakeNotice } from "@/lib/design/grid-plan-intake";`):

```ts
import { blockedPages, remapSheetRefs, type SheetAdjust } from "@/lib/design/sheet-adjust";
```

In `export type GridSheet = { … }`, after the `blobPath?: string;` field and before `addedBy: string;`:

```ts
  /** #318: set on a sheet derived by Adjust sheet (crop + rotate) — the
   *  ORIGINAL upload it was made from (always the root, never a chain) and
   *  the per-page spec (lib/design/sheet-adjust). Absent on an upload. */
  adjust?: SheetAdjust;
```

Insert this function directly after the closing `}` of `removeSheet` (before `export async function addPlacement(`):

```ts
/**
 * #318 — put an adjusted (cropped / turned) copy of a sheet in its place.
 * Writes the new grid_sheets doc, then ONE patch that re-checks, on the doc
 * patchDoc hands us, that the old sheet is still listed, is not the generated
 * base sheet, and that no page in `changed` has anything on it (any option) —
 * the removeSheet pattern — then moves every reference to the new id
 * (remapSheetRefs: same position in sheetIds, placements / spaces / routes /
 * calibrations, the intake's plan view, drawing-set keys). A refusal
 * soft-deletes the doc it wrote. The old doc stays: revisions may name it, and
 * restoring one cut before the adjust re-adds it (restoreRevision's rule —
 * accepted, D693). Revisions are never rewritten.
 */
export async function replaceSheetWithAdjusted(
  projectId: string,
  oldSheetId: string,
  input: { name: string; mime: string; dataUrl?: string; url?: string; blobPath?: string; adjust: SheetAdjust; by: string },
  changed: readonly number[]
): Promise<{ ok: true; sheet: GridSheet } | { ok: false; reason: "not-found" | "no-such-sheet" | "base-sheet" | "in-use"; pages?: number[] }> {
  const sheet: GridSheet = {
    id: rid("gs-"),
    projectId,
    name: input.name || "Plan sheet",
    mime: input.mime,
    dataUrl: input.dataUrl || "",
    ...(input.url ? { url: input.url } : {}),
    ...(input.blobPath ? { blobPath: input.blobPath } : {}),
    adjust: input.adjust,
    addedBy: input.by,
    at: Date.now(),
  };
  await upsertDoc<GridSheet>("grid_sheets", sheet);
  let refused: { reason: "no-such-sheet" | "base-sheet" | "in-use"; pages?: number[] } | null = null;
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    if (!(p.sheetIds || []).includes(oldSheetId)) { refused = { reason: "no-such-sheet" }; return; }
    if (p.intake?.baseSheetId === oldSheetId) { refused = { reason: "base-sheet" }; return; }
    const blocked = blockedPages(p, oldSheetId, changed);
    if (blocked.length) { refused = { reason: "in-use", pages: blocked }; return; }
    remapSheetRefs(p, oldSheetId, sheet.id);
    p.updatedAt = Date.now();
  });
  // (Assigned inside the callback, which TS's flow analysis can't see.)
  const refusal = (updated ? refused : { reason: "not-found" }) as
    | { reason: "not-found" | "no-such-sheet" | "base-sheet" | "in-use"; pages?: number[] }
    | null;
  if (refusal) {
    await softDeleteDoc("grid_sheets", sheet.id);
    return { ok: false, ...refusal };
  }
  return { ok: true, sheet };
}
```

(`upsertDoc`, `patchDoc` and `softDeleteDoc` are already imported at the top of the file; `rid` is the file's private id helper.)

- [ ] **Step 4: Write the orchestrator**

Create `src/lib/design/sheet-adjust-server.ts`:

```ts
// SERVER ONLY — reads sheet files, runs pdf-lib / sharp, writes Blob.
/**
 * #318 — Adjust sheet, end to end: check the gate, read the ROOT sheet's file
 * (Blob or data-URL), transform it (sheet-adjust-bytes), store the result
 * (private Blob, or a data-URL when Blob is off and it fits), then swap the
 * new sheet in for the old one (grid-projects.replaceSheetWithAdjusted, which
 * re-checks the gate on the doc it patches). A refusal after a Blob write
 * deletes that blob again. "Reset everything" (an empty spec) writes no bytes:
 * the new sheet points at the root's own file.
 */
import { getDoc } from "@/db/doc-store";
import { blobEnabled, deleteBlob, getBlobStream, putBlob, safeName } from "@/lib/blob";
import { decodeDataUrl, GRID_SHEET_BLOB_PREFIX } from "@/lib/grid-sheet-file";
import { getProject, replaceSheetWithAdjusted, type GridSheet } from "@/lib/stores/grid-projects";
import { adjustSheetBytes } from "./sheet-adjust-bytes";
import { blockedPages, changedPages, isBaseSheet, sanitizeAdjustPages, type AdjustRefusal } from "./sheet-adjust";

/** Largest root file read back (the 25 MB upload cap, with room). */
export const SHEET_ADJUST_READ_MAX_BYTES = 30 * 1024 * 1024;
/** Largest adjusted file stored in-database when Blob is off (local dev): the
 *  4 MB upload cap plus room for pdf-lib's re-save growing a file. */
export const SHEET_ADJUST_DATAURL_MAX_BYTES = 6 * 1024 * 1024;

export type AdjustSheetResult = { ok: true; sheetId: string; unchanged?: true } | { ok: false; reason: AdjustRefusal; pages?: number[] };
type StoredFile = { mime: string; dataUrl: string; url?: string; blobPath?: string };

export async function adjustSheet(projectId: string, sheetId: string, rawPages: unknown, by: string): Promise<AdjustSheetResult> {
  const project = await getProject(projectId);
  if (!project) return { ok: false, reason: "not-found" };
  if (!(project.sheetIds || []).includes(sheetId)) return { ok: false, reason: "no-such-sheet" };
  const cur = await getDoc<GridSheet>("grid_sheets", sheetId);
  if (!cur) return { ok: false, reason: "no-such-sheet" };
  if (isBaseSheet(cur, project.intake)) return { ok: false, reason: "base-sheet" };
  const next = sanitizeAdjustPages(rawPages);
  const changed = changedPages(sanitizeAdjustPages(cur.adjust?.pages), next);
  if (!changed.length) return { ok: true, sheetId: cur.id, unchanged: true };
  const blocked = blockedPages(project, cur.id, changed);
  if (blocked.length) return { ok: false, reason: "in-use", pages: blocked };
  const rootId = cur.adjust?.fromSheetId || cur.id;
  const root = rootId === cur.id ? cur : await getDoc<GridSheet>("grid_sheets", rootId);
  if (!root) return { ok: false, reason: "unreadable" };

  let file: StoredFile;
  let wrote: string | null = null;
  if (!Object.keys(next).length) {
    file = { mime: root.mime, dataUrl: root.dataUrl || "", ...(root.url ? { url: root.url } : {}), ...(root.blobPath ? { blobPath: root.blobPath } : {}) };
  } else {
    const bytes = await readSheetBytes(root);
    if (!bytes) return { ok: false, reason: "unreadable" };
    const out = await adjustSheetBytes(bytes, next);
    if (!out.ok) return { ok: false, reason: out.reason };
    const put = await storeSheetFile(projectId, cur.name, out.bytes, out.mime);
    if (!put.ok) return { ok: false, reason: put.reason };
    file = put.file;
    wrote = put.file.blobPath ?? null;
  }
  const r = await replaceSheetWithAdjusted(projectId, cur.id, { name: cur.name, ...file, adjust: { fromSheetId: rootId, pages: next }, by }, changed);
  if (!r.ok) {
    if (wrote) await deleteBlob(wrote).catch(() => {});
    return { ok: false, reason: r.reason, ...(r.pages ? { pages: r.pages } : {}) };
  }
  return { ok: true, sheetId: r.sheet.id };
}

/** The whole root file — a local reader, not rack/submittal-server's readCapped, so the
 *  Grid editor's actions don't pull the rack submittal's import graph. */
async function readSheetBytes(sheet: GridSheet): Promise<Uint8Array | null> {
  if (!sheet.blobPath) return decodeDataUrl(sheet.dataUrl)?.bytes ?? null;
  try {
    const stream = await getBlobStream(sheet.blobPath);
    if (!stream) return null;
    const reader = (stream as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.byteLength;
      if (n > SHEET_ADJUST_READ_MAX_BYTES) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
    return new Uint8Array(Buffer.concat(chunks));
  } catch {
    return null;
  }
}

async function storeSheetFile(projectId: string, name: string, bytes: Uint8Array, mime: string): Promise<{ ok: true; file: StoredFile } | { ok: false; reason: "too-big" | "failed" }> {
  if (blobEnabled()) {
    try {
      const up = await putBlob(`${GRID_SHEET_BLOB_PREFIX}${projectId}/${safeName(name)}`, Buffer.from(bytes), mime);
      return { ok: true, file: { mime, dataUrl: "", url: up.url, blobPath: up.pathname } };
    } catch (e) {
      console.error("[grid] adjusted sheet upload failed:", e);
      return { ok: false, reason: "failed" };
    }
  }
  if (bytes.byteLength > SHEET_ADJUST_DATAURL_MAX_BYTES) return { ok: false, reason: "too-big" };
  return { ok: true, file: { mime, dataUrl: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}` } };
}
```

- [ ] **Step 5: Add `adjustSheetAction`**

In `src/app/(app)/design/grid/[id]/actions.ts`, add two imports after the line `import { attachPlanCandidate, planCandidatesFor } from "@/lib/design/grid-plan-intake-server";`:

```ts
import { adjustSheet } from "@/lib/design/sheet-adjust-server";
import { adjustRefusalText } from "@/lib/design/sheet-adjust";
```

Insert after the closing `}` of `removeSheetAction`:

```ts
/** #318: crop + rotate a sheet's pages. A NEW sheet, derived from the original
 *  upload, replaces it in place (D693); refused while a changed page has
 *  devices, spaces, wires or a scale on it, and never on the base sheet. */
export async function adjustSheetAction(
  projectId: string,
  sheetId: string,
  pages: unknown
): Promise<{ ok: true; sheetId: string } | { ok: false; error: string }> {
  const user = await requireUser();
  const r = await adjustSheet(String(projectId || ""), String(sheetId || ""), pages, user.name);
  if (!r.ok) return { ok: false, error: adjustRefusalText(r.reason, r.pages) };
  revalidatePath(editorPath(projectId));
  return { ok: true, sheetId: r.sheetId };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test:specs 2>&1 | grep -E "#318|FAIL|ALL PASSED|FAILED"`
Expected: every `#318` line `PASS` (including the earlier #317 block's lines still passing); `ALL PASSED`.

- [ ] **Step 7: Typecheck and lint**

Run: `npx tsc --noEmit -p . 2>&1 | tail -3` → no output.
Run: `npx eslint src/lib/stores/grid-projects.ts src/lib/design/sheet-adjust-server.ts "src/app/(app)/design/grid/[id]/actions.ts"` → 0 errors (any warnings must be ones these files already had — `git stash` is never used here; compare against `git show HEAD:<file>` if a warning looks new).

- [ ] **Step 8: Commit**

```bash
git add src/lib/stores/grid-projects.ts src/lib/design/sheet-adjust-server.ts "src/app/(app)/design/grid/[id]/actions.ts" scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(grid): #318 adjustSheet — derive a cropped/turned sheet and swap it in place

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 25 MB direct uploads (broker, commit, client helper) and the callers

**Files:**
- Create: `src/lib/design/grid-sheet-upload.ts`
- Create: `src/lib/design/grid-sheet-upload-server.ts`
- Create: `src/app/api/grid-sheets/upload-url/route.ts`
- Create: `src/app/(app)/design/grid/[id]/sheet-upload.ts`
- Modify: `src/lib/design/grid-plan-upload.ts` (whole file)
- Modify: `src/app/(app)/design/grid/[id]/actions.ts` (new `commitSheetUploadAction`)
- Modify: `src/app/(app)/design/grid/[id]/use-grid-editor.ts` (import line 39; props type; `upload()` ~line 1407; return object)
- Modify: `src/app/(app)/design/grid/[id]/grid-intake.tsx` (imports ~line 29–32; props; `pickFile`; `save`; drop text ~line 403)
- Modify: `src/app/(app)/design/grid/[id]/workspace/intake-notices.tsx`
- Modify: `src/app/(app)/design/grid/[id]/page.tsx` (`blobUploads` on both components)
- Test: `scripts/test-review-and-spec.ts` (new `sheetUpload318Checks` + chain; two `#314` pins at ~line 59296 and ~59312)

**Interfaces:**
- Consumes: `isUploadKey`, `safeFileName`, `displayFileName`, `newUploadKey` (`@/lib/document-files`); `sniffPackageFile` (`@/lib/estimate-output/package-files`); `withPlanLock` (`grid-plan-intake-server`); `attachedPlanSheet`, `isPlanUploadId`, `planSourceKey` (`grid-plan-intake`); `addSheet`, `getProject`, `recordIntakePlan`; `getBlobHead`, `deleteBlob`, `blobEnabled`; `listDocsByField`.
- Produces:
  - Pure: `GRID_SHEET_DIRECT_MAX_BYTES` (25 MB), `GRID_SHEET_DIRECT_MAX_LABEL` ("25 MB"), `GRID_SHEET_DIRECT_TYPES`, `GRID_SHEET_SNIFF_BYTES`, `GRID_SHEET_UPLOAD_COPY`, `projectPathSegment`, `gridSheetUploadPrefix`, `gridSheetBlobPath(projectId, uploadKey, fileName)`, `gridSheetPathInScope(pathname, projectId, uploadKey)`, `parseSheetUploadPayload(payload)`, `sniffSheetFile(head)`.
  - Server: `commitSheetUpload(projectId: string, input: unknown, by: string, deps?: Partial<{ head; remove }>): Promise<{ ok: true; sheetId: string; already?: true } | { ok: false; error: string }>`.
  - Action: `commitSheetUploadAction(projectId: string, input: { blobPath: string; uploadKey: string; name: string; position?: "first"; planUploadId?: string })`.
  - `grid-plan-upload.ts`: `planFileProblem(file: { size: number; type: string }, blobUploads?: boolean): string | null`, `newPlanUploadId()`, `postSheetMultipart(projectId, file, uploadId?)`.
  - Client: `uploadGridSheet(projectId: string, file: File, opts: { blobUploads: boolean; planUploadId?: string }): Promise<{ ok: true; sheetId: string } | { ok: false; error: string }>` (Task 5 relies on it).
  - Editor props: `GridEditorProps.blobUploads?: boolean`; hook returns `blobUploads`. Intake prop `blobUploads?: boolean`.

- [ ] **Step 1: Write the failing test**

Append to the end of `scripts/test-review-and-spec.ts`:

```ts
/* ---------------- #318: plan sheets up to 25 MB, direct to Blob ---------------- */
async function sheetUpload318Checks(): Promise<void> {
  const U = await import("@/lib/design/grid-sheet-upload");
  const C = await import("@/lib/design/grid-sheet-upload-server");
  const P = await import("@/lib/design/grid-plan-upload");
  const G = await import("@/lib/stores/grid-projects");
  const DS = await import("@/db/doc-store");
  const J = (v: unknown) => JSON.stringify(v);
  const by = "Test Harness";
  const key = "UP-0000000000000318";

  // Pure rules.
  ok(U.gridSheetBlobPath("GRD-5001", key, "My Plan (rev 2).pdf") === "grid-sheets/GRD-5001/UP-0000000000000318/My_Plan_rev_2_.pdf",
    "#318 gridSheetBlobPath: grid-sheets/<design>/<uploadKey>/<safe name>");
  const pre = U.gridSheetUploadPrefix("GRD-5001", key);
  ok(U.gridSheetPathInScope(`${pre}plan-Sfx01.pdf`, "GRD-5001", key) &&
     !U.gridSheetPathInScope(`grid-sheets/GRD-5002/${key}/plan.pdf`, "GRD-5001", key) &&
     !U.gridSheetPathInScope(`grid-sheets/GRD-5001/UP-1111111111111111/plan.pdf`, "GRD-5001", key) &&
     !U.gridSheetPathInScope(`${pre}../x.pdf`, "GRD-5001", key) && !U.gridSheetPathInScope(`${pre}a/b.pdf`, "GRD-5001", key) &&
     !U.gridSheetPathInScope(`${pre}`, "GRD-5001", key) && !U.gridSheetPathInScope(`${pre}x.pdf`, "GRD-5001", "UP-nope") && !U.gridSheetPathInScope(42, "GRD-5001", key),
    "#318 gridSheetPathInScope: only one file directly under this design's upload key");
  ok(J(U.parseSheetUploadPayload(JSON.stringify({ uploadKey: key, projectId: "GRD-5001" }))) === J({ uploadKey: key, projectId: "GRD-5001" }) &&
     U.parseSheetUploadPayload("{") === null && U.parseSheetUploadPayload(JSON.stringify({ uploadKey: key })) === null &&
     U.parseSheetUploadPayload(JSON.stringify({ uploadKey: key, projectId: "GRD/1" })) === null && U.parseSheetUploadPayload(null) === null,
    "#318 parseSheetUploadPayload: {uploadKey, projectId} or null");
  const enc = (s: string) => new TextEncoder().encode(s);
  const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0]);
  ok(U.sniffSheetFile(enc("%PDF-1.7 x")) === "application/pdf" && U.sniffSheetFile(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) === "image/png" &&
     U.sniffSheetFile(gif) === "image/gif" && U.sniffSheetFile(enc("<svg xmlns='http://www.w3.org/2000/svg'/>")) === null &&
     U.sniffSheetFile(Uint8Array.from([...gif, ...enc("<script>")])) === null && U.sniffSheetFile(enc("%PDF-1.7 <html>")) === null && U.sniffSheetFile(enc("hello")) === null,
    "#318 sniffSheetFile: PDF and PNG/JPEG/WebP/GIF by their bytes; markup anywhere in the head refuses");
  const f = (size: number, type: string) => ({ size, type });
  ok(P.planFileProblem(f(5 * 1024 * 1024, "application/pdf"), true) === null && P.planFileProblem(f(26 * 1024 * 1024, "application/pdf"), true) === U.GRID_SHEET_UPLOAD_COPY.tooBig &&
     (P.planFileProblem(f(5 * 1024 * 1024, "application/pdf")) || "").includes("4 MB") && P.planFileProblem(f(10, "image/heic"), true) === U.GRID_SHEET_UPLOAD_COPY.wrongType &&
     P.planFileProblem(f(10, "image/heic")) === null && P.planFileProblem(f(0, "application/pdf"), true) === "That file is empty.",
    "#318 planFileProblem: 25 MB and five types on the Blob path, 4 MB on the old route");

  // The commit (fake Blob head/remove).
  const gp = await G.createProject({ name: "#318 upload project", customer: "Spec fixture", customerId: null, by });
  registerFixture("grid_projects", gp.id);
  const path = (n: string) => U.gridSheetBlobPath(gp.id, key, n).replace(/(\.[a-z]+)$/, "-Sfx01$1");
  const removed: string[] = [];
  const deps = (bytes: Uint8Array, size: number) => ({ head: async () => ({ bytes, size }), remove: async (p: string) => { removed.push(p); } });
  const pdf = enc("%PDF-1.7 fixture");
  const okRes = await C.commitSheetUpload(gp.id, { uploadKey: key, blobPath: path("plan.pdf"), name: "Plan.pdf" }, by, deps(pdf, 20 * 1024 * 1024));
  if (okRes.ok) registerFixture("grid_sheets", okRes.sheetId);
  const sheet = okRes.ok ? await DS.getDoc<import("@/lib/stores/grid-projects").GridSheet>("grid_sheets", okRes.sheetId) : null;
  ok(okRes.ok && !!sheet && sheet.mime === "application/pdf" && sheet.blobPath === path("plan.pdf") && sheet.name === "Plan.pdf" && sheet.dataUrl === "" &&
     (await G.getProject(gp.id))!.sheetIds.at(-1) === sheet.id && removed.length === 0,
    "#318 commit: a real 20 MB PDF under this design's key becomes the last sheet, typed by its bytes");
  const again = await C.commitSheetUpload(gp.id, { uploadKey: key, blobPath: path("plan.pdf"), name: "x.pdf" }, by, deps(pdf, 10));
  ok(!again.ok && again.error === U.GRID_SHEET_UPLOAD_COPY.alreadySaved && removed.length === 0, "#318 commit: replaying a recorded path is refused and never deletes that blob");
  const svg = await C.commitSheetUpload(gp.id, { uploadKey: key, blobPath: path("x.svg"), name: "x.svg" }, by, deps(enc("<svg/>"), 6));
  const big = await C.commitSheetUpload(gp.id, { uploadKey: key, blobPath: path("big.pdf"), name: "big.pdf" }, by, deps(pdf, U.GRID_SHEET_DIRECT_MAX_BYTES + 1));
  const empty = await C.commitSheetUpload(gp.id, { uploadKey: key, blobPath: path("e.pdf"), name: "e.pdf" }, by, deps(pdf, 0));
  ok(!svg.ok && svg.error === U.GRID_SHEET_UPLOAD_COPY.wrongType && !big.ok && big.error === U.GRID_SHEET_UPLOAD_COPY.tooBig && !empty.ok && empty.error === U.GRID_SHEET_UPLOAD_COPY.empty &&
     J(removed) === J([path("x.svg"), path("big.pdf"), path("e.pdf")]),
    "#318 commit: SVG, oversize and empty uploads are refused and their unrecorded blobs deleted");
  const foreign = await C.commitSheetUpload(gp.id, { uploadKey: key, blobPath: `grid-sheets/GRD-OTHER/${key}/a.pdf`, name: "a.pdf" }, by, deps(pdf, 10));
  const missing = await C.commitSheetUpload(gp.id, { uploadKey: key, blobPath: path("m.pdf"), name: "m.pdf" }, by, { head: async () => null, remove: async (p: string) => { removed.push(p); } });
  const noProj = await C.commitSheetUpload("GRD-0", { uploadKey: key, blobPath: path("n.pdf"), name: "n.pdf" }, by, deps(pdf, 10));
  ok(!foreign.ok && foreign.error === U.GRID_SHEET_UPLOAD_COPY.notThisDesign && !missing.ok && missing.error === U.GRID_SHEET_UPLOAD_COPY.noArrival &&
     !noProj.ok && noProj.error === U.GRID_SHEET_UPLOAD_COPY.gone && removed.length === 3,
    "#318 commit: another design's path, a blob that never arrived and an unknown design are refused without deleting anything");
  const uid = "00000000-0000-4000-8000-000000000318";
  const first = await C.commitSheetUpload(gp.id, { uploadKey: key, blobPath: path("first.pdf"), name: "First.pdf", position: "first", planUploadId: uid }, by, deps(pdf, 10));
  if (first.ok) registerFixture("grid_sheets", first.sheetId);
  const proj = (await G.getProject(gp.id))!;
  ok(first.ok && proj.sheetIds[0] === first.sheetId && proj.intake?.planSheetId === first.sheetId && proj.intake?.planSource === `upload:${uid}`,
    "#318 commit: a plan-view upload goes FIRST and is recorded as the intake's plan");
  const retry = await C.commitSheetUpload(gp.id, { uploadKey: key, blobPath: path("first2.pdf"), name: "First.pdf", position: "first", planUploadId: uid }, by, deps(pdf, 10));
  ok(retry.ok && first.ok && retry.sheetId === first.sheetId && retry.already === true && (await G.getProject(gp.id))!.sheetIds.length === proj.sheetIds.length && removed.at(-1) === path("first2.pdf"),
    "#318 commit: a retried plan-view upload returns the sheet that landed and deletes its own duplicate blob");
  const badId = await C.commitSheetUpload(gp.id, { uploadKey: key, blobPath: path("b.pdf"), name: "b.pdf", position: "first", planUploadId: "x" }, by, deps(pdf, 10));
  ok(!badId.ok && badId.error === U.GRID_SHEET_UPLOAD_COPY.badUploadId, "#318 commit: a plan-view upload needs a valid upload id");

  // Wiring pins.
  const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const route = rd("src/app/api/grid-sheets/upload-url/route.ts");
  ok(route.includes('reason: "blob-disabled"') && route.includes("maximumSizeInBytes: GRID_SHEET_DIRECT_MAX_BYTES") && route.includes("addRandomSuffix: true") &&
     route.includes("gridSheetPathInScope(pathname, project.id, p.uploadKey)") && route.includes('body.type !== "blob.generate-client-token"'),
    "#318 pin: the token route grants one in-scope path, ≤ 25 MB, random suffix, token events only, 503 without Blob");
  const helper = rd("src/app/(app)/design/grid/[id]/sheet-upload.ts");
  ok(helper.includes('access: "private"') && helper.includes('handleUploadUrl: "/api/grid-sheets/upload-url"') && helper.includes("if (!opts.blobUploads) return postSheetMultipart(projectId, file, opts.planUploadId);") &&
     helper.includes("commitSheetUploadAction(projectId,"),
    "#318 pin: the client helper uploads privately through the broker and commits, or uses the 4 MB route without Blob");
  const hook = rd("src/app/(app)/design/grid/[id]/use-grid-editor.ts");
  ok(hook.includes("await uploadGridSheet(project.id, file, { blobUploads })") && !hook.includes('fetch("/api/grid-sheets/upload"'), "#318 pin: the + tab uploads through uploadGridSheet");
  ok(rd("src/app/(app)/design/grid/[id]/page.tsx").split("blobUploads={blobEnabled()}").length === 3, "#318 pin: the page tells both the intake and the editor whether Blob uploads are on");
}
```

Chain it after the Task 3 line:

```ts
  .then(() => sheetUpload318Checks())
```

(`readFileSync` and `join` are already imported at the top of the harness.)

Update the two `#314` pins that name the replaced call. At ~line 59296 change

```ts
  ok(saveBody.indexOf("await saveGridIntakeAction(") < saveBody.indexOf("uploadPlanFirst(projectId, planFile, planUploadId)") && saveBody.includes("if (!saved.ok) return setError(saved.error);") &&
```

to

```ts
  ok(saveBody.indexOf("await saveGridIntakeAction(") < saveBody.indexOf("uploadGridSheet(projectId, planFile, { blobUploads, planUploadId })") && saveBody.includes("if (!saved.ok) return setError(saved.error);") &&
```

and at ~line 59312 change `banner.includes("uploadPlanFirst(project.id, file, newPlanUploadId())")` to `banner.includes("uploadGridSheet(project.id, file, { blobUploads, planUploadId: newPlanUploadId() })")`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: an error naming `Cannot find module '@/lib/design/grid-sheet-upload'`.

- [ ] **Step 3: Write the pure broker rules**

Create `src/lib/design/grid-sheet-upload.ts`:

```ts
import { isUploadKey, safeFileName } from "@/lib/document-files";
import { sniffPackageFile } from "@/lib/estimate-output/package-files";
import { GRID_SHEET_BLOB_PREFIX } from "@/lib/grid-sheet-file";

/**
 * #318 — plan sheets up to 25 MB, straight from the browser to private Blob
 * (the Plans & risers broker, #301). Pure and client-safe: the path every
 * upload must sit under, the sniff, the copy. The token route
 * (/api/grid-sheets/upload-url) grants ONE path per upload; the commit
 * (grid-sheet-upload-server.ts) treats the browser's `blobPath` as untrusted
 * and re-checks scope, size and the bytes before a sheet is recorded.
 * Without Blob (local dev) the 4 MB multipart route stays (grid-sheet-file.ts).
 */

export const GRID_SHEET_DIRECT_MAX_BYTES = 25 * 1024 * 1024;
export const GRID_SHEET_DIRECT_MAX_LABEL = "25 MB";
export const GRID_SHEET_DIRECT_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type GridSheetDirectType = (typeof GRID_SHEET_DIRECT_TYPES)[number];
/** Bytes read from the uploaded blob to tell what it really is. */
export const GRID_SHEET_SNIFF_BYTES = 1024;

export const GRID_SHEET_UPLOAD_COPY = {
  tooBig: `That file is larger than ${GRID_SHEET_DIRECT_MAX_LABEL}. Print the drawing to a smaller PDF (one sheet per file) and try again.`,
  empty: "That file is empty.",
  wrongType: "PDF or image files only (PNG, JPEG, WebP or GIF) — print DWGs to PDF first.",
  notThisDesign: "That upload doesn't belong to this design.",
  alreadySaved: "That file is already on this design.",
  badUploadId: "Bad upload id.",
  noArrival: "The upload didn't arrive — try again.",
  unreadable: "Couldn't read the uploaded file — try again.",
  noStorage: "File storage isn't configured on this server.",
  gone: "That design could not be found.",
} as const;

/** One path segment for a design id (ids are `GRD-####`; anything odd folds to `_`). */
export function projectPathSegment(projectId: string): string {
  return String(projectId ?? "").replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 64) || "_";
}

export function gridSheetUploadPrefix(projectId: string, uploadKey: string): string {
  return `${GRID_SHEET_BLOB_PREFIX}${projectPathSegment(projectId)}/${uploadKey}/`;
}

/** `grid-sheets/<design>/<uploadKey>/<safe name>` — Blob appends a random suffix. */
export function gridSheetBlobPath(projectId: string, uploadKey: string, fileName: string): string {
  return gridSheetUploadPrefix(projectId, uploadKey) + safeFileName(fileName);
}

/** Does a CLIENT-SUPPLIED pathname sit directly under this design's upload key? */
export function gridSheetPathInScope(pathname: unknown, projectId: string, uploadKey: string): pathname is string {
  if (typeof pathname !== "string" || !projectId || !isUploadKey(uploadKey)) return false;
  const prefix = gridSheetUploadPrefix(projectId, uploadKey);
  if (!pathname.startsWith(prefix) || pathname.includes("..")) return false;
  const rest = pathname.slice(prefix.length);
  return rest.length > 0 && rest.length <= 200 && /^[A-Za-z0-9._-]+$/.test(rest);
}

/** The token route's clientPayload: `{uploadKey, projectId}`, or null. */
export function parseSheetUploadPayload(payload: string | null | undefined): { uploadKey: string; projectId: string } | null {
  try {
    const p = payload ? (JSON.parse(payload) as { uploadKey?: unknown; projectId?: unknown } | null) : null;
    if (!p || !isUploadKey(p.uploadKey) || typeof p.projectId !== "string") return null;
    return /^[A-Za-z0-9_-]{1,64}$/.test(p.projectId) ? { uploadKey: p.uploadKey, projectId: p.projectId } : null;
  } catch {
    return null;
  }
}

/** What an uploaded sheet really is: a PDF or one of the four raster types; markup / SVG / anything else → null. */
export function sniffSheetFile(head: Uint8Array): GridSheetDirectType | null {
  const known = sniffPackageFile(head);
  if (known) return known;
  // GIF87a / GIF89a — the one sheet type Plans & risers doesn't take. Markup
  // anywhere in the head disqualifies it like every other type (polyglots).
  const isGif = head.length >= 6 && head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x38 && (head[4] === 0x37 || head[4] === 0x39) && head[5] === 0x61;
  if (!isGif) return null;
  const text = Array.from(head.subarray(0, GRID_SHEET_SNIFF_BYTES), (b) => String.fromCharCode(b)).join("").toLowerCase();
  return /<svg|<html|<script|<!doctype|<\?xml/.test(text) ? null : "image/gif";
}
```

- [ ] **Step 4: Write the commit**

Create `src/lib/design/grid-sheet-upload-server.ts`:

```ts
// SERVER ONLY.
/**
 * #318 — record a sheet the browser uploaded straight to Blob (the
 * Plans & risers order, package-files-server.ts): path scope → never a path a
 * sheet already holds → the head Blob really holds (size ≤ 25 MB, sniffed
 * type) → addSheet. The client's `blobPath` is untrusted throughout; a
 * refusal deletes the unrecorded blob. A plan-view upload (`position:
 * "first"`) runs under the design's plan lock with its upload id, so a retry
 * of one that landed returns that sheet (#314's rule). `deps` exists for the
 * spec harness.
 */
import { deleteBlob, getBlobHead } from "@/lib/blob";
import { listDocsByField } from "@/db/doc-store";
import { displayFileName, isUploadKey } from "@/lib/document-files";
import { addSheet, getProject, recordIntakePlan, type GridSheet } from "@/lib/stores/grid-projects";
import { withPlanLock } from "@/lib/design/grid-plan-intake-server";
import { attachedPlanSheet, isPlanUploadId, planSourceKey } from "@/lib/design/grid-plan-intake";
import { GRID_SHEET_DIRECT_MAX_BYTES, GRID_SHEET_SNIFF_BYTES, GRID_SHEET_UPLOAD_COPY as COPY, gridSheetPathInScope, sniffSheetFile } from "./grid-sheet-upload";

type CommitDeps = {
  head: (pathname: string, max: number) => Promise<{ bytes: Uint8Array; size: number } | null>;
  remove: (pathname: string) => Promise<void>;
};
const liveDeps: CommitDeps = { head: getBlobHead, remove: deleteBlob };

export type CommitSheetResult = { ok: true; sheetId: string; already?: true } | { ok: false; error: string };

export async function commitSheetUpload(projectId: string, input: unknown, by: string, deps: Partial<CommitDeps> = {}): Promise<CommitSheetResult> {
  const d: CommitDeps = { ...liveDeps, ...deps };
  const inp = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const project = await getProject(String(projectId || ""));
  if (!project) return { ok: false, error: COPY.gone };
  const uploadKey = inp.uploadKey;
  if (!isUploadKey(uploadKey) || !gridSheetPathInScope(inp.blobPath, project.id, uploadKey)) return { ok: false, error: COPY.notThisDesign };
  const blobPath = inp.blobPath;
  const first = inp.position === "first";
  if (first && !isPlanUploadId(inp.planUploadId)) return { ok: false, error: COPY.badUploadId };
  const name = displayFileName(inp.name).slice(0, 120) || "Plan sheet";
  const source = first ? planSourceKey("upload", inp.planUploadId as string) : null;
  const run = () => commitLocked(project.id, blobPath, name, by, source, d);
  return source ? withPlanLock(project.id, run) : run();
}

async function referenced(blobPath: string): Promise<boolean> {
  return (await listDocsByField<GridSheet>("grid_sheets", "blobPath", [blobPath])).length > 0;
}

async function commitLocked(projectId: string, blobPath: string, name: string, by: string, source: string | null, d: CommitDeps): Promise<CommitSheetResult> {
  /** Drop this upload's blob unless some sheet already holds that path (a replay names a real file). */
  const dropOrphan = async () => {
    try {
      if (!(await referenced(blobPath))) await d.remove(blobPath);
    } catch {
      /* best effort — the answer stands either way */
    }
  };
  if (source) {
    const now = await getProject(projectId);
    const done = now ? attachedPlanSheet(now.intake, now.sheetIds || [], source) : null;
    if (done) {
      await dropOrphan();
      return { ok: true, sheetId: done, already: true };
    }
  }
  if (await referenced(blobPath)) return { ok: false, error: COPY.alreadySaved };
  const refuse = async (error: string): Promise<CommitSheetResult> => {
    await dropOrphan();
    return { ok: false, error };
  };
  let head: { bytes: Uint8Array; size: number } | null;
  try {
    head = await d.head(blobPath, GRID_SHEET_SNIFF_BYTES);
  } catch {
    return { ok: false, error: COPY.unreadable };
  }
  if (!head) return { ok: false, error: COPY.noArrival };
  if (!(head.size > 0)) return refuse(COPY.empty);
  if (head.size > GRID_SHEET_DIRECT_MAX_BYTES) return refuse(COPY.tooBig);
  const type = sniffSheetFile(head.bytes);
  if (!type) return refuse(COPY.wrongType);
  const sheet = await addSheet(projectId, { name, mime: type, blobPath, by, ...(source ? { first: true } : {}) });
  if (!sheet) return refuse(COPY.gone);
  if (source) await recordIntakePlan(projectId, sheet.id, source);
  return { ok: true, sheetId: sheet.id };
}
```

- [ ] **Step 5: Write the token route**

Create `src/app/api/grid-sheets/upload-url/route.ts`:

```ts
import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { blobEnabled } from "@/lib/blob";
import { getOptionalUser } from "@/lib/session";
import { getProject } from "@/lib/stores/grid-projects";
import {
  GRID_SHEET_DIRECT_MAX_BYTES,
  GRID_SHEET_DIRECT_TYPES,
  GRID_SHEET_UPLOAD_COPY,
  gridSheetPathInScope,
  parseSheetUploadPayload,
} from "@/lib/design/grid-sheet-upload";

// Token minting only — no bytes pass through this function.
export const maxDuration = 30;

class UploadRefused extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

/**
 * #318 (D692) — Vercel Blob client-upload broker for Grid plan sheets up to
 * 25 MB (the Plans & risers route's pattern, #301). Only
 * `blob.generate-client-token` (no completion callback, so no middleware
 * exemption). The grant is for ONE path: `grid-sheets/<design>/<uploadKey>/…`
 * of an existing design, to a signed-in user (any designer may add a sheet —
 * the legacy route's rule), ≤ 25 MB, private. commitSheetUploadAction
 * re-checks the real bytes before a sheet is recorded. This static segment
 * sits beside the `[id]` proxy; sheet ids are `gs-<hex>`, so they never collide.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!blobEnabled()) return NextResponse.json({ reason: "blob-disabled", error: GRID_SHEET_UPLOAD_COPY.noStorage }, { status: 503 });
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (body.type !== "blob.generate-client-token") return NextResponse.json({ error: "unsupported event" }, { status: 400 });
  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const u = await getOptionalUser();
        if (!u) throw new UploadRefused(401, "unauthorized");
        const p = parseSheetUploadPayload(clientPayload);
        if (!p) throw new UploadRefused(400, "clientPayload must be {uploadKey, projectId}");
        const project = await getProject(p.projectId);
        if (!project) throw new UploadRefused(404, GRID_SHEET_UPLOAD_COPY.gone);
        if (!gridSheetPathInScope(pathname, project.id, p.uploadKey)) throw new UploadRefused(400, GRID_SHEET_UPLOAD_COPY.notThisDesign);
        return {
          maximumSizeInBytes: GRID_SHEET_DIRECT_MAX_BYTES,
          allowedContentTypes: [...GRID_SHEET_DIRECT_TYPES, "application/octet-stream"],
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ projectId: project.id, uploadKey: p.uploadKey }),
        };
      },
    });
    return NextResponse.json(json);
  } catch (e) {
    if (e instanceof UploadRefused) return NextResponse.json({ error: e.message }, { status: e.status });
    // Never show the vendor's own error to the browser — only our refusals.
    return NextResponse.json({ error: "Upload could not be authorized." }, { status: 400 });
  }
}
```

- [ ] **Step 6: Add `commitSheetUploadAction`**

In `actions.ts`, add after the Task 3 imports:

```ts
import { commitSheetUpload } from "@/lib/design/grid-sheet-upload-server";
```

and after `adjustSheetAction`:

```ts
/** #318 (D692): record a sheet the browser uploaded straight to Blob (≤ 25 MB).
 *  Everything in `input` is untrusted — commitSheetUpload re-checks the path,
 *  the stored size and the bytes, and deletes a refused upload's blob. */
export async function commitSheetUploadAction(
  projectId: string,
  input: { blobPath: string; uploadKey: string; name: string; position?: "first"; planUploadId?: string }
): Promise<{ ok: true; sheetId: string } | { ok: false; error: string }> {
  const user = await requireUser();
  const r = await commitSheetUpload(String(projectId || ""), input, user.name);
  if (!r.ok) return r;
  revalidatePath(editorPath(projectId));
  return { ok: true, sheetId: r.sheetId };
}
```

- [ ] **Step 7: Rewrite `src/lib/design/grid-plan-upload.ts`**

Replace the whole file with:

```ts
import { GRID_SHEET_MAX_BYTES, GRID_SHEET_MAX_LABEL, sheetMimeVerdict } from "@/lib/grid-sheet-file";
import { GRID_SHEET_DIRECT_MAX_BYTES, GRID_SHEET_DIRECT_TYPES, GRID_SHEET_UPLOAD_COPY } from "@/lib/design/grid-sheet-upload";

/**
 * #314 — the Grid plan view's browser half, shared by the intake, the editor's
 * `+` tab and the notice banner: the courtesy checks run before uploading (the
 * server re-checks — this is not the rule), and the post to the 4 MB multipart
 * route `/api/grid-sheets/upload`, which is what runs when Blob is off (#318:
 * with Blob on, sheet-upload.ts goes straight to Blob up to 25 MB). A plan-view
 * upload carries an upload id and asks for the FIRST position: the route turns
 * a repeat of an upload that already landed into a no-op. Client-safe.
 */

export function planFileProblem(file: { size: number; type: string }, blobUploads = false): string | null {
  if (file.size === 0) return "That file is empty.";
  if (blobUploads) {
    if (file.size > GRID_SHEET_DIRECT_MAX_BYTES) return GRID_SHEET_UPLOAD_COPY.tooBig;
  } else if (file.size > GRID_SHEET_MAX_BYTES) {
    return `That file is larger than ${GRID_SHEET_MAX_LABEL}. Print the drawing to a smaller PDF (one sheet per file) and try again.`;
  }
  const v = sheetMimeVerdict(file.type || "");
  if (v === "svg") return "SVG plan sheets aren't supported — export the drawing as a PDF or PNG instead.";
  if (v !== "ok") return "PDF or image files only — print DWGs to PDF first.";
  // The Blob path takes five types (the token route enforces them; the commit sniffs the bytes).
  const t = file.type.toLowerCase().split(";")[0].trim();
  if (blobUploads && !(GRID_SHEET_DIRECT_TYPES as readonly string[]).includes(t)) return GRID_SHEET_UPLOAD_COPY.wrongType;
  return null;
}

/** A fresh id per picked file — the same file retried keeps its id. */
export function newPlanUploadId(): string {
  return globalThis.crypto.randomUUID();
}

/** The 4 MB multipart route (no Blob). `uploadId` = a plan-view upload: FIRST position, idempotent. */
export async function postSheetMultipart(projectId: string, file: File, uploadId?: string): Promise<{ ok: true; sheetId: string } | { ok: false; error: string }> {
  const body = new FormData();
  body.append("projectId", projectId);
  body.append("name", file.name);
  if (uploadId) {
    body.append("position", "first");
    body.append("planUploadId", uploadId);
  }
  body.append("file", file);
  try {
    const res = await fetch("/api/grid-sheets/upload", { method: "POST", body });
    const r = (await res.json()) as { ok?: boolean; sheetId?: string; error?: string };
    return r?.ok && r.sheetId ? { ok: true, sheetId: r.sheetId } : { ok: false, error: r?.error || "That plan could not be uploaded." };
  } catch {
    // A dropped connection or a non-JSON reply (a proxy's own 413 page).
    return { ok: false, error: "That plan could not be uploaded. Check your connection and try again." };
  }
}
```

- [ ] **Step 8: Write the client helper**

Create `src/app/(app)/design/grid/[id]/sheet-upload.ts`:

```ts
import { upload } from "@vercel/blob/client";
import { newUploadKey } from "@/lib/document-files";
import { gridSheetBlobPath } from "@/lib/design/grid-sheet-upload";
import { planFileProblem, postSheetMultipart } from "@/lib/design/grid-plan-upload";
import { commitSheetUploadAction } from "./actions";

/**
 * #318 (D692) — the browser half of a plan-sheet upload, for the `+` tab, the
 * intake's plan view and the notice banner's re-upload. With Blob on
 * (`blobUploads`, the page's blobEnabled()): preflight, mint an upload key,
 * send the bytes straight to private Blob through the token broker (≤ 25 MB),
 * then commitSheetUploadAction — which re-checks everything. With Blob off:
 * the 4 MB multipart route. `planUploadId` = the intake's plan view (FIRST
 * position, idempotent per id). Never throws. Client-only.
 */
export type SheetUploadResult = { ok: true; sheetId: string } | { ok: false; error: string };

export async function uploadGridSheet(projectId: string, file: File, opts: { blobUploads: boolean; planUploadId?: string }): Promise<SheetUploadResult> {
  const problem = planFileProblem(file, opts.blobUploads);
  if (problem) return { ok: false, error: problem };
  if (!opts.blobUploads) return postSheetMultipart(projectId, file, opts.planUploadId);
  const uploadKey = newUploadKey();
  let pathname: string;
  try {
    const res = await upload(gridSheetBlobPath(projectId, uploadKey, file.name), file, {
      access: "private",
      handleUploadUrl: "/api/grid-sheets/upload-url",
      clientPayload: JSON.stringify({ uploadKey, projectId }),
      contentType: file.type || "application/octet-stream",
      multipart: file.size > 5 * 1024 * 1024,
    });
    pathname = res.pathname;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return {
      ok: false,
      error: /client token/i.test(msg)
        ? "Upload refused — file storage may not be configured, or your session ended."
        : "That sheet could not be uploaded. Check your connection and try again.",
    };
  }
  try {
    return await commitSheetUploadAction(projectId, {
      blobPath: pathname,
      uploadKey,
      name: file.name,
      ...(opts.planUploadId ? { position: "first" as const, planUploadId: opts.planUploadId } : {}),
    });
  } catch {
    return { ok: false, error: "That sheet could not be saved. Check your connection and try again." };
  }
}
```

- [ ] **Step 9: Switch the editor's `+` tab to `uploadGridSheet`**

In `use-grid-editor.ts`:

1. Replace the import line `import { GRID_SHEET_MAX_BYTES, GRID_SHEET_MAX_LABEL } from "@/lib/grid-sheet-file";` with `import { uploadGridSheet } from "./sheet-upload";`.
2. In `GridEditorProps`, after the `focusSheetId?: string | null;` member, add:

```ts
  /** #318: file storage is on — sheets upload straight to Blob (≤ 25 MB); off = the 4 MB route. */
  blobUploads?: boolean;
```

3. Right after `const intakeNotices = props.intakeNotices ?? [];` add `const blobUploads = props.blobUploads ?? false;`.
4. Replace everything from the `/**` line directly above ` * Post the sheet to /api/grid-sheets/upload (#146, D173) rather than through` down to the closing `}` of `async function upload(file: File)` (the line after its `router.refresh();`) with:

```ts
  /**
   * Upload one plan sheet (#146, D173; #318, D692): straight to private Blob
   * up to 25 MB through the token broker when file storage is on, else the
   * 4 MB multipart route — uploadGridSheet picks, preflights and never
   * throws. The reply carries only the new sheet id; nothing here names a
   * stored path.
   */
  async function upload(file: File) {
    setErr(null);
    setBusy(true);
    const r = await uploadGridSheet(project.id, file, { blobUploads });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setActiveSheetId(r.sheetId);
    setPage(1);
    noteAction(`Uploaded ${file.name}`);
    clearUndo();
    router.refresh();
  }
```

5. In the hook's `return { … }`, add `blobUploads,` right after `intakeNotices,`.

- [ ] **Step 10: Switch the intake and the notice banner**

`grid-intake.tsx`:
- Replace `import { newPlanUploadId, planFileProblem, uploadPlanFirst } from "@/lib/design/grid-plan-upload";` with:

```ts
import { newPlanUploadId, planFileProblem } from "@/lib/design/grid-plan-upload";
import { GRID_SHEET_DIRECT_MAX_LABEL } from "@/lib/design/grid-sheet-upload";
import { uploadGridSheet } from "./sheet-upload";
```

- In the props destructure add `blobUploads = false,` after `planCandidates: initialCandidates = [],`; in the props type add, after `planCandidates?: PlanCandidate[];`:

```ts
  /** #318: file storage is on — the dropped plan uploads straight to Blob (≤ 25 MB). */
  blobUploads?: boolean;
```

- In `pickFile`, change `const problem = planFileProblem(file);` to `const problem = planFileProblem(file, blobUploads);`.
- In `save`, change `const up = await uploadPlanFirst(projectId, planFile, planUploadId);` to `const up = await uploadGridSheet(projectId, planFile, { blobUploads, planUploadId });`.
- In the drop zone text change `(PDF or image, up to {GRID_SHEET_MAX_LABEL})` to `(PDF or image, up to {blobUploads ? GRID_SHEET_DIRECT_MAX_LABEL : GRID_SHEET_MAX_LABEL})`.

`workspace/intake-notices.tsx`:
- Replace `import { newPlanUploadId, planFileProblem, uploadPlanFirst } from "@/lib/design/grid-plan-upload";` with:

```ts
import { newPlanUploadId, planFileProblem } from "@/lib/design/grid-plan-upload";
import { GRID_SHEET_DIRECT_MAX_LABEL } from "@/lib/design/grid-sheet-upload";
import { uploadGridSheet } from "../sheet-upload";
```

- `const { intakeNotices, project, router } = ed;` → `const { intakeNotices, project, router, blobUploads } = ed;`
- `const problem = planFileProblem(file);` → `const problem = planFileProblem(file, blobUploads);`
- `const up = await uploadPlanFirst(project.id, file, newPlanUploadId());` → `const up = await uploadGridSheet(project.id, file, { blobUploads, planUploadId: newPlanUploadId() });`
- The retry button's title → ``title={`Choose the plan again — PDF or image, up to ${blobUploads ? GRID_SHEET_DIRECT_MAX_LABEL : GRID_SHEET_MAX_LABEL}`}``.
- The hidden input's `accept` gains GIF: `accept="application/pdf,image/png,image/jpeg,image/webp,image/gif,.pdf,.png,.jpg,.jpeg,.webp,.gif"`.

`page.tsx`:
- Add `import { blobEnabled } from "@/lib/blob";` to the imports.
- On `<GridIntake …>` add the prop `blobUploads={blobEnabled()}` after `planCandidates={planCandidates}`.
- On `<GridEditor …>` add `blobUploads={blobEnabled()}` after the `focusSheetId={…}` prop.

- [ ] **Step 11: Run the tests to verify they pass**

Run: `npm run test:specs 2>&1 | grep -E "#318|#314|#146|FAIL|ALL PASSED|FAILED"`
Expected: every `#318`, `#314` and `#146` line `PASS` (the #146 pin "the editor uploads through the route and never names a stored path" must still pass — `use-grid-editor.ts` never mentions `blobPath`); `ALL PASSED`.

- [ ] **Step 12: Typecheck, lint, build-gate the client imports**

Run: `npx tsc --noEmit -p . 2>&1 | tail -3` → no output.
Run: `npx eslint src/lib/design/grid-sheet-upload.ts src/lib/design/grid-sheet-upload-server.ts src/lib/design/grid-plan-upload.ts src/app/api/grid-sheets/upload-url/route.ts "src/app/(app)/design/grid/[id]/sheet-upload.ts" "src/app/(app)/design/grid/[id]/actions.ts" "src/app/(app)/design/grid/[id]/use-grid-editor.ts" "src/app/(app)/design/grid/[id]/grid-intake.tsx" "src/app/(app)/design/grid/[id]/workspace/intake-notices.tsx" "src/app/(app)/design/grid/[id]/page.tsx"` → no errors.

- [ ] **Step 13: Commit**

```bash
git add src/lib/design/grid-sheet-upload.ts src/lib/design/grid-sheet-upload-server.ts src/lib/design/grid-plan-upload.ts src/app/api/grid-sheets/upload-url/route.ts "src/app/(app)/design/grid/[id]/sheet-upload.ts" "src/app/(app)/design/grid/[id]/actions.ts" "src/app/(app)/design/grid/[id]/use-grid-editor.ts" "src/app/(app)/design/grid/[id]/grid-intake.tsx" "src/app/(app)/design/grid/[id]/workspace/intake-notices.tsx" "src/app/(app)/design/grid/[id]/page.tsx" scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(grid): #318 plan sheets up to 25 MB straight to Blob (4 MB route kept without Blob)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: The Adjust sheet dialog and its wiring

**Files:**
- Modify: `src/components/design/pdf-canvas.tsx`
- Create: `src/app/(app)/design/grid/[id]/workspace/sheet-adjust-dialog.tsx`
- Modify: `src/app/(app)/design/grid/[id]/use-grid-editor.ts`
- Modify: `src/app/(app)/design/grid/[id]/editor.tsx`
- Modify: `src/app/(app)/design/grid/[id]/workspace/sheet-tabs.tsx`
- Modify: `src/app/(app)/design/grid/[id]/workspace/intake-notices.tsx`
- Modify: `src/app/(app)/design/grid/[id]/grid-intake.tsx` (`save`)
- Modify: `src/app/(app)/design/grid/[id]/actions.ts` (`saveGridIntakeAction` returns `planSheetId`)
- Modify: `src/app/(app)/design/grid/[id]/page.tsx` (`?adjust=`, sheet `adjust`/`base`)
- Test: `scripts/test-review-and-spec.ts` (new `sheetAdjust318UiPins` + chain; the `#314` "after save" pin at ~line 59298)

**Interfaces:**
- Consumes: Task 1 (`changedPages`, `dragCrop`, `IDENTITY_ADJUST`, `isIdentity`, `pageAdjustOf`, `rotatedSize`, `sanitizeAdjustPages`, `turnAdjust`, `pageLocks`, `allPagesLocked`, `isBaseSheet`, types); Task 3 `adjustSheetAction`; Task 4 `uploadGridSheet`, `blobUploads`.
- Produces: `PdfCanvas` prop `rotateBy?: number`; `SheetLite.adjust?: SheetAdjust | null` and `SheetLite.base?: boolean`; `GridEditorProps.adjustSheetId?: string | null`; hook returns `adjustTarget: SheetLite | null`, `adjustAfterUpload: boolean`, `adjustLocks: Record<number, string>`, `openAdjust(sheetId, afterUpload?)`, `closeAdjust()`, `finishAdjust(newSheetId)`, `adjustAvailability(s): { hidden; disabled; title }`; `saveGridIntakeAction` result gains `planSheetId?: string`.

This task's UI can't be unit-tested beyond source pins, tsc and `next build`; the controller does a browser check afterwards (scratch datadir, Blob disabled): upload a PDF and an image on `+`, crop/rotate, Done → the tab shows the adjusted sheet and the Calibrate banner; ⋯ → Crop & rotate… reopens on the full original page with the crop shown; a page with a device shows Locked; the base sheet's ⋯ has no Crop & rotate….

- [ ] **Step 1: Write the failing test**

Append to the end of `scripts/test-review-and-spec.ts`:

```ts
/* ---------------- #318: Adjust sheet — dialog wiring pins ---------------- */
async function sheetAdjust318UiPins(): Promise<void> {
  const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const pdfc = rd("src/components/design/pdf-canvas.tsx");
  ok(pdfc.includes("rotateBy?: number;") && pdfc.includes("const turn = rotateBy ? { rotation: (((pg.rotate + rotateBy) % 360) + 360) % 360 } : {};") &&
     pdfc.includes("pg.getViewport({ scale, ...turn })") && pdfc.includes("printBox?.w, printBox?.h, rotateBy]"),
    "#318 pin: PdfCanvas adds rotateBy to the page's own rotation (pdf.js's rotation is absolute); absent = unchanged");
  const dlg = rd("src/app/(app)/design/grid/[id]/workspace/sheet-adjust-dialog.tsx");
  ok(dlg.includes('role="dialog"') && dlg.includes("const src = `/api/grid-sheets/${encodeURIComponent(rootId)}`;") && dlg.includes("const rootId = sheet.adjust?.fromSheetId || sheet.id;") &&
     dlg.includes("await adjustSheetAction(projectId, sheet.id, next)") && dlg.includes("if (!changedPages(initial, next).length) return onCancel();") &&
     dlg.includes('{afterUpload ? "Skip" : "Cancel"}') && dlg.includes("Same for all pages") && dlg.includes("rotateBy={cur.rotate}") && !dlg.includes("blobPath"),
    "#318 pin: the dialog shows the ROOT file with the current spec, saves only a real change, and Skip/Cancel leaves the sheet as is");
  const hook = rd("src/app/(app)/design/grid/[id]/use-grid-editor.ts");
  ok(hook.includes("openAdjust(r.sheetId, true);") && /if \(requestedAdjust && requestedAdjust !== adjustApplied && sheets\.some\(\(s\) => s\.id === requestedAdjust\)\) \{\s*setAdjustApplied\(requestedAdjust\);/.test(hook) &&
     hook.includes("if (s.base) return { hidden: true, disabled: true, title: \"\" };") && !hook.includes("blobPath"),
    "#318 pin: an upload opens Adjust sheet; ?adjust= is adopted during render once the sheet arrives; never on the base sheet");
  const tabs = rd("src/app/(app)/design/grid/[id]/workspace/sheet-tabs.tsx");
  ok(tabs.includes('label: "Crop & rotate…"') && tabs.includes("const avail = adjustAvailability(s);"), "#318 pin: the sheet tab's ⋯ menu offers Crop & rotate…");
  const page = rd("src/app/(app)/design/grid/[id]/page.tsx");
  ok(page.includes("adjustSheetId={requestedAdjust && (project.sheetIds || []).includes(requestedAdjust) ? requestedAdjust : null}") && page.includes("base: isBaseSheet(s, project.intake),") && page.includes("adjust: s.adjust ?? null,"),
    "#318 pin: the page passes ?adjust= (only for a listed sheet) and each sheet's adjust spec and base flag");
  const gi = rd("src/app/(app)/design/grid/[id]/grid-intake.tsx");
  ok(gi.includes("if (adjustId) router.replace(`/design/grid/${encodeURIComponent(projectId)}?adjust=${encodeURIComponent(adjustId)}`);") && gi.includes("let adjustId = saved.planSheetId ?? null;"),
    "#318 pin: the intake finishes by opening its plan view (uploaded or copied) in Adjust sheet");
  const ed = rd("src/app/(app)/design/grid/[id]/editor.tsx");
  ok(ed.includes("{ed.adjustTarget && (") && ed.includes("onDone={ed.finishAdjust}"), "#318 pin: the editor renders the dialog for the sheet being adjusted");
}
```

Chain it after the Task 4 line:

```ts
  .then(() => sheetAdjust318UiPins())
```

Update the `#314` "after save" pin (~line 59298). Change

```ts
  ok(!/\bset[A-Z]\w*\(/.test(afterSave) && afterSave.includes("await notePlanUploadFailedAction(projectId, up.error)") && afterSave.trim().endsWith("router.refresh();\n    });\n  };".trim()) &&
```

to

```ts
  ok(!/\bset[A-Z]\w*\(/.test(afterSave) && afterSave.includes("await notePlanUploadFailedAction(projectId, up.error)") && afterSave.trim().endsWith("else router.refresh();\n    });\n  };".trim()) &&
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: the run fails — the first new pin (`PdfCanvas … rotateBy`) prints `FAIL`, then `readFileSync` throws `ENOENT … workspace/sheet-adjust-dialog.tsx` and the run exits 1.

- [ ] **Step 3: Add `rotateBy` to `PdfCanvas`**

In `src/components/design/pdf-canvas.tsx`:

1. In `type PdfDoc`, replace `getViewport: (o: { scale: number }) => { width: number; height: number };` with:

```ts
    /** The page's own /Rotate, as pdf.js normalized it (0/90/180/270). */
    rotate: number;
    getViewport: (o: { scale: number; rotation?: number }) => { width: number; height: number };
```

2. In the component's destructure add `rotateBy,` after `printBox,`; in its props type, after `printBox?: { w: number; h: number };` add:

```ts
  /** #318: quarter turns ADDED to the page's own rotation (the Adjust sheet
   *  preview turns the root page live). Absent or 0 = the page exactly as
   *  stored — every other caller is unaffected. */
  rotateBy?: number;
```

3. In the paint effect replace

```ts
        const base = printBox ? pg.getViewport({ scale: 1 }) : null;
        const scale = base && printBox ? printZoom(base.width, base.height, printBox.w, printBox.h) : zoom;
        const viewport = pg.getViewport({ scale });
```

with

```ts
        // #318: an extra turn renders at an absolute rotation (pdf.js's
        // `rotation` replaces the page's own, so the two are added here).
        const turn = rotateBy ? { rotation: (((pg.rotate + rotateBy) % 360) + 360) % 360 } : {};
        const base = printBox ? pg.getViewport({ scale: 1, ...turn }) : null;
        const scale = base && printBox ? printZoom(base.width, base.height, printBox.w, printBox.h) : zoom;
        const viewport = pg.getViewport({ scale, ...turn });
```

4. Change that effect's dependency list `}, [page, zoom, loading, printBox?.w, printBox?.h]);` to `}, [page, zoom, loading, printBox?.w, printBox?.h, rotateBy]);`.

- [ ] **Step 4: Write the dialog**

Create `src/app/(app)/design/grid/[id]/workspace/sheet-adjust-dialog.tsx`:

```tsx
"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import {
  changedPages,
  dragCrop,
  IDENTITY_ADJUST,
  isIdentity,
  pageAdjustOf,
  rotatedSize,
  sanitizeAdjustPages,
  turnAdjust,
  type AdjustPages,
  type CropHandle,
  type CropRect,
  type PageAdjust,
  type SheetAdjust,
} from "@/lib/design/sheet-adjust";
import { adjustSheetAction } from "../actions";

const PdfCanvas = dynamic(() => import("@/components/design/pdf-canvas"), { ssr: false });

/**
 * Adjust sheet (#318) — crop a plan sheet to the plan and turn it upright,
 * page by page, before it is calibrated. Always shows the ROOT file (the
 * original upload, through the sheet proxy) with the sheet's current crop and
 * rotation, so a crop is never lossy. A page with anything on it is locked.
 * The preview turns on screen only; Done asks the server to derive the new
 * sheet (adjustSheetAction), Cancel / Skip leaves the sheet as it is.
 */

const PAD = 40;
const BTN: CSSProperties = { border: "1px solid #4d5057", background: "#55585f", color: "#e6e8ec", borderRadius: 7, padding: "6px 11px", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap" };
const PRIMARY: CSSProperties = { ...BTN, background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" };
const HANDLES: CropHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const HANDLE_CURSOR: Record<CropHandle, string> = { move: "move", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize" };

/** Where a handle sits on the crop box, as fractions of its width / height. */
function handleAt(h: CropHandle): { fx: number; fy: number } {
  return { fx: h.includes("w") ? 0 : h.includes("e") ? 1 : 0.5, fy: h.includes("n") ? 0 : h.includes("s") ? 1 : 0.5 };
}

export default function SheetAdjustDialog({
  projectId,
  sheet,
  locks,
  afterUpload,
  onCancel,
  onDone,
}: {
  projectId: string;
  sheet: { id: string; name: string; mime: string; adjust?: SheetAdjust | null };
  /** Page number → why it is locked (pageLocks). */
  locks: Record<number, string>;
  /** Opened right after an upload: Cancel reads "Skip". */
  afterUpload: boolean;
  onCancel: () => void;
  onDone: (newSheetId: string) => void;
}) {
  const rootId = sheet.adjust?.fromSheetId || sheet.id;
  const src = `/api/grid-sheets/${encodeURIComponent(rootId)}`;
  const isPdf = sheet.mime === "application/pdf" || sheet.name.toLowerCase().endsWith(".pdf");
  const [initial] = useState<AdjustPages>(() => sanitizeAdjustPages(sheet.adjust?.pages));
  const [pages, setPages] = useState<AdjustPages>(initial);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [sameForAll, setSameForAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const cur = pageAdjustOf(pages, page);
  const locked = locks[page] ?? null;

  /* The stage's size (the area the page is fitted into). */
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  /* PDF: rendered at `zoom`; the canvas size it reports gives the page's size at zoom 1. */
  const [zoom, setZoom] = useState(0.5);
  const [render, setRender] = useState<{ w: number; h: number; zoom: number } | null>(null);
  const onSize = useCallback((w: number, h: number) => setRender({ w, h, zoom }), [zoom]);
  if (isPdf && render && stage.w > PAD && stage.h > PAD) {
    const want = Math.max(0.05, Math.min(4, Math.min((stage.w - PAD) / (render.w / render.zoom), (stage.h - PAD) / (render.h / render.zoom))));
    if (Math.abs(want - zoom) / zoom > 0.02) setZoom(want);
  }
  /* Image: natural (EXIF-oriented) size; turned with CSS here, by the server on Done. */
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [rw, rh] = natural ? rotatedSize(natural.w, natural.h, cur.rotate) : [0, 0];
  const imgScale = natural && stage.w > PAD && stage.h > PAD ? Math.min((stage.w - PAD) / rw, (stage.h - PAD) / rh) : 0;
  const disp = isPdf ? (render ? { w: render.w, h: render.h } : null) : imgScale > 0 ? { w: rw * imgScale, h: rh * imgScale } : null;

  /** Write `next` to this page — or, with Same for all pages, to every page that isn't locked. */
  const apply = (next: PageAdjust) => {
    const targets = sameForAll ? Array.from({ length: pageCount }, (_, i) => i + 1).filter((n) => !locks[n]) : [page];
    setPages((prev) => {
      const out: AdjustPages = { ...prev };
      for (const n of targets) {
        if (isIdentity(next)) delete out[String(n)];
        else out[String(n)] = next;
      }
      return out;
    });
  };

  const drag = useRef<{ handle: CropHandle; sx: number; sy: number; start: CropRect; id: number } | null>(null);
  /** Pointer down on the crop box (`data-handle` absent = move) or on one of its handles. */
  const grab = (e: ReactPointerEvent<HTMLElement>) => {
    if (locked || saving || !disp) return;
    const handle = (e.currentTarget.dataset.handle || "move") as CropHandle;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { handle, sx: e.clientX, sy: e.clientY, start: cur.crop, id: e.pointerId };
  };
  const pull = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || !disp) return;
    apply({ rotate: cur.rotate, crop: dragCrop(d.start, d.handle, (e.clientX - d.sx) / disp.w, (e.clientY - d.sy) / disp.h) });
  };
  const release = (e: ReactPointerEvent<HTMLElement>) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };

  const done = async () => {
    const next = sanitizeAdjustPages(pages);
    if (!changedPages(initial, next).length) return onCancel();
    setSaving(true);
    setErr(null);
    let r: Awaited<ReturnType<typeof adjustSheetAction>>;
    try {
      r = await adjustSheetAction(projectId, sheet.id, next);
    } catch {
      r = { ok: false, error: "That didn't save — check your connection and try again." };
    }
    setSaving(false);
    if (!r.ok) return setErr(r.error);
    onDone(r.sheetId);
  };

  const c = cur.crop;
  const box = disp ? { left: c.x * disp.w, top: c.y * disp.h, width: c.w * disp.w, height: c.h * disp.h } : null;
  const shade: CSSProperties = { position: "absolute", background: "rgba(15,17,21,.6)", pointerEvents: "none" };

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Adjust sheet"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !saving) {
          e.preventDefault();
          onCancel();
        }
      }}
      style={{ position: "fixed", inset: 0, zIndex: 90, display: "flex", flexDirection: "column", background: "#2b2d31", color: "#e6e8ec", outline: "none" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 14px", borderBottom: "1px solid #3d4047" }}>
        <div style={{ fontSize: 14, fontWeight: 700, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 360 }} title={sheet.name}>
          Adjust sheet — {sheet.name}
        </div>
        <span style={{ fontSize: 12, color: "#aeb3bc" }}>Crop to the plan and turn it upright, then calibrate.</span>
        <span style={{ flex: 1 }} />
        <button type="button" style={BTN} disabled={!!locked || saving} onClick={() => apply(turnAdjust(cur, "ccw"))} title="Turn the page a quarter turn to the left">⟲ Rotate left</button>
        <button type="button" style={BTN} disabled={!!locked || saving} onClick={() => apply(turnAdjust(cur, "cw"))} title="Turn the page a quarter turn to the right">⟳ Rotate right</button>
        <button type="button" style={BTN} disabled={!!locked || saving || isIdentity(cur)} onClick={() => apply(IDENTITY_ADJUST)} title="Back to the full, unturned page">Reset</button>
        <button type="button" style={BTN} disabled={saving} onClick={onCancel}>{afterUpload ? "Skip" : "Cancel"}</button>
        <button type="button" style={PRIMARY} disabled={saving} onClick={() => void done()}>{saving ? "Saving…" : "Done"}</button>
      </div>
      {isPdf && pageCount > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 14px", borderBottom: "1px solid #3d4047", fontSize: 12.5 }}>
          <button type="button" style={BTN} aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button>
          <span>{page} / {pageCount}</span>
          <button type="button" style={BTN} aria-label="Next page" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>›</button>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
            <input
              type="checkbox"
              checked={sameForAll}
              disabled={!!locked || saving}
              onChange={(e) => {
                setSameForAll(e.target.checked);
                if (e.target.checked) {
                  const next = cur;
                  setPages((prev) => {
                    const out: AdjustPages = { ...prev };
                    for (let n = 1; n <= pageCount; n++) {
                      if (locks[n]) continue;
                      if (isIdentity(next)) delete out[String(n)];
                      else out[String(n)] = next;
                    }
                    return out;
                  });
                }
              }}
            />
            Same for all pages
          </label>
          {Object.keys(locks).length > 0 && <span style={{ color: "#aeb3bc" }}>Pages with devices, spaces, wires or a scale stay as they are.</span>}
        </div>
      )}
      <div ref={stageRef} style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {loadErr ? (
          <div style={{ fontSize: 13, color: "#f0a58f" }}>Couldn&apos;t open this sheet: {loadErr}</div>
        ) : (
          <div style={{ position: "relative", width: disp?.w, height: disp?.h, flex: "0 0 auto" }}>
            {isPdf ? (
              <PdfCanvas key={rootId} dataUrl={src} page={page} zoom={zoom} rotateBy={cur.rotate} onLoaded={setPageCount} onSize={onSize} onError={setLoadErr} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt={sheet.name}
                draggable={false}
                ref={(el) => {
                  if (el && el.complete && el.naturalWidth > 0 && !natural) setNatural({ w: el.naturalWidth, h: el.naturalHeight });
                }}
                onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                onError={() => setLoadErr("the image could not be loaded.")}
                style={
                  natural && imgScale > 0
                    ? { position: "absolute", left: "50%", top: "50%", width: natural.w * imgScale, height: natural.h * imgScale, transform: `translate(-50%, -50%) rotate(${cur.rotate}deg)`, maxWidth: "none" }
                    : { visibility: "hidden", position: "absolute" }
                }
              />
            )}
            {disp && box && (
              <>
                <div style={{ ...shade, left: 0, top: 0, width: disp.w, height: box.top }} />
                <div style={{ ...shade, left: 0, top: box.top + box.height, width: disp.w, height: Math.max(0, disp.h - box.top - box.height) }} />
                <div style={{ ...shade, left: 0, top: box.top, width: box.left, height: box.height }} />
                <div style={{ ...shade, left: box.left + box.width, top: box.top, width: Math.max(0, disp.w - box.left - box.width), height: box.height }} />
                <div
                  data-testid="crop-box"
                  onPointerDown={grab}
                  onPointerMove={pull}
                  onPointerUp={release}
                  onPointerCancel={release}
                  style={{ position: "absolute", ...box, border: "1.5px solid #fff", boxShadow: "0 0 0 1px rgba(0,0,0,.5)", cursor: locked ? "default" : "move", touchAction: "none" }}
                />
                {!locked &&
                  HANDLES.map((h) => {
                    const { fx, fy } = handleAt(h);
                    return (
                      <div
                        key={h}
                        aria-hidden
                        data-handle={h}
                        onPointerDown={grab}
                        onPointerMove={pull}
                        onPointerUp={release}
                        onPointerCancel={release}
                        style={{ position: "absolute", left: box.left + fx * box.width - 6, top: box.top + fy * box.height - 6, width: 12, height: 12, background: "#fff", border: "1px solid #16181d", borderRadius: 2, cursor: HANDLE_CURSOR[h], touchAction: "none" }}
                      />
                    );
                  })}
              </>
            )}
          </div>
        )}
        {locked && (
          <div role="status" style={{ position: "absolute", left: "50%", top: 14, transform: "translateX(-50%)", maxWidth: "min(560px, 90%)", background: "#fdf4e7", color: "#7a5a1c", border: "1px solid #f0dcbb", borderRadius: 8, padding: "7px 12px", fontSize: 12.5, lineHeight: 1.45 }}>
            Locked — {locked}
          </div>
        )}
      </div>
      {err && (
        <div role="alert" style={{ padding: "8px 14px", background: "#3a2a26", color: "#f0a58f", fontSize: 12.5, borderTop: "1px solid #5a3a32" }}>
          {err}
        </div>
      )}
    </div>
  );
}
```

Notes: the stage is measured by a `ResizeObserver` (its first callback fires on `observe`, so no setState runs in the effect body); the PDF's fit zoom is adjusted during render from the last reported canvas size (`render.w / render.zoom` is the page's size at zoom 1 for the current rotation) and settles after one re-render; crop-box pointer handlers read the handle from `data-handle` (a curried handler trips the React Compiler's "refs during render" rule).

- [ ] **Step 5: Wire the editor hook**

In `use-grid-editor.ts`:

1. Add to the imports:

```ts
import { allPagesLocked, pageLocks, type SheetAdjust } from "@/lib/design/sheet-adjust";
```

2. Replace `export type SheetLite = { id: string; name: string; mime: string; dataUrl: string };` with:

```ts
export type SheetLite = {
  id: string;
  name: string;
  mime: string;
  dataUrl: string;
  /** #318: how this sheet was derived from its original upload (Adjust sheet); null/absent = an upload. */
  adjust?: SheetAdjust | null;
  /** #318: the generated base sheet — never cropped or rotated. */
  base?: boolean;
};
```

3. In `GridEditorProps`, after the `blobUploads?: boolean;` member from Task 4, add:

```ts
  /** #318: `?adjust=<sheetId>` — the intake's plan view, opened in Adjust sheet once it is listed. */
  adjustSheetId?: string | null;
```

4. Directly after the focus-sheet adoption block

```ts
  if (focusHere && focusSheetId !== focusApplied) {
    setFocusApplied(focusSheetId);
    setActiveSheetId(focusSheetId!);
    setPage(1);
  }
```

insert:

```ts
  // #318: Adjust sheet (crop + rotate). Opened from the tab's ⋯ menu, right
  // after an upload (the + tab, the notice banner's re-upload), or by the
  // intake's swap into the editor through `?adjust=<sheetId>` — adopted during
  // render once that sheet is in `sheets`, like the focus sheet above.
  const [adjusting, setAdjusting] = useState<{ sheetId: string; afterUpload: boolean } | null>(null);
  const requestedAdjust = props.adjustSheetId ?? null;
  const [adjustApplied, setAdjustApplied] = useState<string | null>(null);
  if (requestedAdjust && requestedAdjust !== adjustApplied && sheets.some((s) => s.id === requestedAdjust)) {
    setAdjustApplied(requestedAdjust);
    setAdjusting({ sheetId: requestedAdjust, afterUpload: true });
  }
  const openAdjust = useCallback((sheetId: string, afterUpload = false) => setAdjusting({ sheetId, afterUpload }), []);
  const closeAdjust = useCallback(() => {
    setAdjusting(null);
    // Drop ?adjust= so a reload doesn't open it again.
    if (requestedAdjust) router.replace(`${pathname}?option=${encodeURIComponent(activeOptionId)}`, { scroll: false });
  }, [requestedAdjust, router, pathname, activeOptionId]);
  /** The sheet open in Adjust sheet — null until a just-uploaded sheet arrives in `sheets`. */
  const adjustTarget = adjusting ? (sheets.find((s) => s.id === adjusting.sheetId) ?? null) : null;
  const adjustAfterUpload = adjusting?.afterUpload ?? false;
  const adjustLocks = useMemo(() => (adjustTarget ? pageLocks(project, adjustTarget.id) : {}), [project, adjustTarget]);
```

5. In `upload()` (Task 4's version) add `openAdjust(r.sheetId, true);` on its own line right after ``noteAction(`Uploaded ${file.name}`);``.

6. Directly after the `goToPage` callback (the block ending `[page, pages, resetSheetState]\n  );`), insert:

```ts
  /** #318: Done in Adjust sheet — the new sheet took the old one's place; open it. */
  const finishAdjust = useCallback(
    (newSheetId: string) => {
      const name = adjustTarget?.name || "the sheet";
      closeAdjust();
      setActiveSheetId(newSheetId);
      resetSheetState();
      noteAction(`Cropped & rotated ${name}`);
      // Device / space / wire ids are unchanged but now name the new sheet —
      // the undo stack's recorded bundles would restore onto the old one.
      onStructuralChange();
    },
    [adjustTarget, closeAdjust, resetSheetState, noteAction, onStructuralChange]
  );

  /** #318: the ⋯ menu's Crop & rotate… for one tab — never on the generated
   *  base sheet; disabled, with why, once every page is known to have content. */
  const adjustAvailability = useCallback(
    (s: SheetLite): { hidden: boolean; disabled: boolean; title: string } => {
      if (s.base) return { hidden: true, disabled: true, title: "" };
      const sheetIsPdf = s.mime === "application/pdf" || s.name.toLowerCase().endsWith(".pdf");
      // A PDF's page count is known only for the sheet on screen; any other PDF opens and shows its locked pages.
      const count = !sheetIsPdf ? 1 : s.id === sheet?.id ? pages : 0;
      return allPagesLocked(pageLocks(project, s.id), count)
        ? { hidden: false, disabled: true, title: "Every page of this sheet has devices, spaces, wires or a scale on it — crop and rotate only work on an empty page." }
        : { hidden: false, disabled: false, title: "Crop the sheet to the plan and turn it upright — pages with anything on them stay as they are" };
    },
    [project, sheet?.id, pages]
  );
```

7. In the hook's `return { … }`, add after `onStructuralChange,`:

```ts
    adjustTarget,
    adjustAfterUpload,
    adjustLocks,
    openAdjust,
    closeAdjust,
    finishAdjust,
    adjustAvailability,
```

- [ ] **Step 6: Render the dialog and add the menu item**

`editor.tsx`: add `import SheetAdjustDialog from "./workspace/sheet-adjust-dialog";` after the `IntakeNotices` import, and inside `center={<> … </>}` add, right after `<ViewTabs ed={ed} />`:

```tsx
          {ed.adjustTarget && (
            <SheetAdjustDialog
              key={ed.adjustTarget.id}
              projectId={ed.project.id}
              sheet={ed.adjustTarget}
              locks={ed.adjustLocks}
              afterUpload={ed.adjustAfterUpload}
              onCancel={ed.closeAdjust}
              onDone={ed.finishAdjust}
            />
          )}
```

`workspace/sheet-tabs.tsx`: add `openAdjust, adjustAvailability` to the `const { … } = ed;` destructure. Inside `sheets.map((s) => {`, after `const on = s.id === sheet?.id;` add `const avail = adjustAvailability(s);`. On the tab's `<Menu label="⋯" …>` add the prop:

```tsx
                items={avail.hidden ? [] : [{ label: "Crop & rotate…", onSelect: () => openAdjust(s.id), disabled: avail.disabled, title: avail.title }]}
```

(The existing `ConfirmButton` children stay; `Menu` draws a divider between items and children.)

- [ ] **Step 7: Open Adjust sheet from the intake and the notice banner**

`actions.ts` — `saveGridIntakeAction`:
- Change its return type `Promise<{ ok: true; warning?: string; planRetry?: string } | { ok: false; error: string }>` to `Promise<{ ok: true; warning?: string; planRetry?: string; planSheetId?: string } | { ok: false; error: string }>`.
- After `let planWarning: string | undefined;` add `let planSheetId: string | undefined;`.
- Replace

```ts
    if (!attached.ok) {
      planRetry = input.planCandidateId;
      planWarning = `The plan is ready, but the plan view wasn't added: ${attached.error}`;
    }
```

with

```ts
    if (!attached.ok) {
      planRetry = input.planCandidateId;
      planWarning = `The plan is ready, but the plan view wasn't added: ${attached.error}`;
    } else planSheetId = attached.sheetId;
```

- Change the final `return { ok: true, ...(allWarnings ? { warning: allWarnings } : {}), ...(planRetry ? { planRetry } : {}) };` to `return { ok: true, ...(allWarnings ? { warning: allWarnings } : {}), ...(planRetry ? { planRetry } : {}), ...(planSheetId ? { planSheetId } : {}) };`.

`grid-intake.tsx` — in `save`, replace

```ts
      if (planFile && planUploadId) {
        const up = await uploadGridSheet(projectId, planFile, { blobUploads, planUploadId });
        if (!up.ok) await notePlanUploadFailedAction(projectId, up.error).catch(() => null);
      }
      router.refresh();
```

with

```ts
      // #318: the plan view (copied above, or uploaded here) opens in Adjust sheet.
      let adjustId = saved.planSheetId ?? null;
      if (planFile && planUploadId) {
        const up = await uploadGridSheet(projectId, planFile, { blobUploads, planUploadId });
        if (!up.ok) await notePlanUploadFailedAction(projectId, up.error).catch(() => null);
        else adjustId = up.sheetId;
      }
      if (adjustId) router.replace(`/design/grid/${encodeURIComponent(projectId)}?adjust=${encodeURIComponent(adjustId)}`);
      else router.refresh();
```

`workspace/intake-notices.tsx` — destructure `openAdjust` too (`const { intakeNotices, project, router, blobUploads, openAdjust } = ed;`) and in `pickFile` replace

```ts
      if (!up.ok) return up;
      return dismissGridNoticeAction(project.id, noticeId);
```

with

```ts
      if (!up.ok) return up;
      openAdjust(up.sheetId, true);
      return dismissGridNoticeAction(project.id, noticeId);
```

`page.tsx`:
- Add `import { isBaseSheet } from "@/lib/design/sheet-adjust";`.
- `searchParams: Promise<{ option?: string }>;` → `searchParams: Promise<{ option?: string; adjust?: string }>;` and `const { option: requestedOption } = await searchParams;` → `const { option: requestedOption, adjust: requestedAdjust } = await searchParams;`.
- In the `sheets={sheets.map((s) => ({ … }))}` object add, after the `dataUrl: …` line:

```tsx
        // #318: how the sheet was derived (Adjust sheet) and whether it is the generated base sheet.
        adjust: s.adjust ?? null,
        base: isBaseSheet(s, project.intake),
```

- On `<GridEditor …>` add after `blobUploads={blobEnabled()}`:

```tsx
      adjustSheetId={requestedAdjust && (project.sheetIds || []).includes(requestedAdjust) ? requestedAdjust : null}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm run test:specs 2>&1 | grep -E "#318|#314|#146|FAIL|ALL PASSED|FAILED"`
Expected: all `PASS`; `ALL PASSED`.

- [ ] **Step 9: Typecheck, lint, build**

Run: `npx tsc --noEmit -p . 2>&1 | tail -3` → no output.
Run: `npx eslint src/components/design/pdf-canvas.tsx "src/app/(app)/design/grid/[id]/workspace/sheet-adjust-dialog.tsx" "src/app/(app)/design/grid/[id]/use-grid-editor.ts" "src/app/(app)/design/grid/[id]/editor.tsx" "src/app/(app)/design/grid/[id]/workspace/sheet-tabs.tsx" "src/app/(app)/design/grid/[id]/workspace/intake-notices.tsx" "src/app/(app)/design/grid/[id]/grid-intake.tsx" "src/app/(app)/design/grid/[id]/actions.ts" "src/app/(app)/design/grid/[id]/page.tsx"` → no errors.
Run (no dev server running — `ps aux | grep -E "next dev|tsx" | grep -v grep` empty): `npm run build 2>&1 | tail -15` → completes; no "Module not found" / "server-only" import errors (this is the gate that catches a client file pulling `sharp`, `postgres` or a store).

- [ ] **Step 10: Commit**

```bash
git add src/components/design/pdf-canvas.tsx "src/app/(app)/design/grid/[id]/workspace/sheet-adjust-dialog.tsx" "src/app/(app)/design/grid/[id]/use-grid-editor.ts" "src/app/(app)/design/grid/[id]/editor.tsx" "src/app/(app)/design/grid/[id]/workspace/sheet-tabs.tsx" "src/app/(app)/design/grid/[id]/workspace/intake-notices.tsx" "src/app/(app)/design/grid/[id]/grid-intake.tsx" "src/app/(app)/design/grid/[id]/actions.ts" "src/app/(app)/design/grid/[id]/page.tsx" scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(grid): #318 Adjust sheet dialog — crop + rotate after upload and from the tab menu

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Docs and the full verification gates

**Files:**
- Modify: `DECISIONS.md` (append), `PUNCHLIST.md` (append), `AGENTS.md` (item 38)

**Interfaces:**
- Consumes: everything above. Produces: nothing new in code.

- [ ] **Step 1: Pick the decision numbers**

Run: `grep -n "^## D[0-9]" DECISIONS.md | tail -1` — #317 used D691, so expect `## D691.`; use the next three numbers (D692, D693, D694). If someone landed more meanwhile, shift all three (and the references in the code comments above: `D692` in `upload-url/route.ts`, `sheet-upload.ts`, `actions.ts`, `use-grid-editor.ts`; `D693` in `grid-projects.ts` and `actions.ts`) to the new numbers.

- [ ] **Step 2: Append to `DECISIONS.md`**

```markdown
## D692. Grid plan sheets upload straight to Blob, up to 25 MB (#318, 2026-10-09)

Jeff had to shrink an architect's PDF to get under the 4 MB plan-sheet ceiling (the Vercel function body limit, D173).
With Blob on, a sheet now goes from the browser straight to private Blob through a token broker
(`/api/grid-sheets/upload-url`, the Plans & risers pattern): one path per upload, `grid-sheets/<design>/<uploadKey>/<safe
name>`, ≤ 25 MB, PDF/PNG/JPEG/WebP/GIF, random suffix. `commitSheetUploadAction` treats the returned `blobPath` as
untrusted — scope, never a path a sheet already holds, the stored size from `getBlobHead`, a magic-byte sniff (markup/SVG
refused) — and deletes a refused upload's blob; a plan-view upload keeps #314's FIRST position, plan lock and upload-id
idempotency. This is the upgrade D173 named: the path now round-trips through the browser, guarded like the documents and
package-file brokers. Without Blob the 4 MB multipart route is unchanged. The client picks the path from a server flag
(`blobUploads = blobEnabled()`), not by trying the broker: `@vercel/blob/client` reports every token refusal with the
same message. Broker sheets store no `url` (provenance only).

## D693. Adjust sheet derives a new sheet; nothing transforms at view time (#318, 2026-10-09)

Crop + rotate writes new bytes and a new `grid_sheets` doc, so every consumer (editor, drawing set, print, package,
riser Connect) keeps reading a sheet's frame from its own file. `GridSheet.adjust = { fromSheetId, pages }`:
`fromSheetId` is always the ROOT upload (re-adjusting re-derives from it, so crops are never lossy); per page, `rotate`
is the quarter turns added to the root page's own `/Rotate`, `crop` is normalized in the root page as displayed after
that turn. PDFs keep vector content — pdf-lib sets `/CropBox` (CropBox ∩ MediaBox math checked against pdf.js) and
`/Rotate` on changed pages only; images are EXIF-oriented, turned, cropped and re-encoded by sharp (JPEG q92, WebP q90,
PNG; GIF → PNG). Allowed only while a changed page is empty (no device, space, wire or scale, any option) — checked
before and again inside the one patch that puts the new id at the old one's position and moves every reference
(placements, spaces, routes, calibrations, the intake's plan view, drawing-set keys). Never on the generated base sheet.
The old doc stays (revisions may name it); restoring a revision cut before an adjustment re-adds the old sheet beside
the new one — accepted, its content lands in its own frame. "Reset" points the new sheet at the root's own file (no new
bytes). Without Blob, an adjusted file is stored in-database up to 6 MB.

## D694. The Adjust sheet dialog (#318, 2026-10-09)

Every new sheet (the `+` tab, the intake's plan view — uploaded or copied, via `?adjust=` — and the notice banner's
re-upload) opens in a full-window Adjust sheet: the root page with a crop box (corner/edge handles, drag to move,
dimmed outside), ⟲ / ⟳ quarter turns, Reset, per-page ‹ n / N › and a "Same for all pages" checkbox (copies the current
page to every unlocked page and keeps doing so while ticked). A page with content shows Locked with what is on it. Done
saves and opens the new sheet (the Calibrate banner follows); Cancel — "Skip" after an upload — leaves the sheet as it
is. The tab's ⋯ menu gains Crop & rotate…, hidden on the base sheet and disabled when every page is known to be locked
(an image, or the PDF on screen — another PDF opens and shows its locks). `PdfCanvas` gained `rotateBy`, added to the
page's own rotation (pdf.js's viewport rotation is absolute); absent = unchanged.
```

- [ ] **Step 3: Append to `PUNCHLIST.md`**

```markdown

## 318. Grid sheet crop + rotate, and 25 MB plan uploads — DONE 2026-10-09 (D692–D694)

Jeff: a 36×24 architect's PDF arrives sideways with a title block, site map and 3D view around the floor plan — "crop
to the plan, spin it upright, then calibrate"; and he had to shrink the file to get under 4 MB.

- **Uploads:** with Blob on, plan sheets go straight to private Blob up to 25 MB (`/api/grid-sheets/upload-url` +
  `commitSheetUploadAction`, `src/lib/design/grid-sheet-upload*.ts`, client `grid/[id]/sheet-upload.ts`); without Blob
  the 4 MB route stays. The intake and the notice banner use the same helper.
- **Adjust sheet:** `src/lib/design/sheet-adjust.ts` (pure: spec, crop ↔ PDF box / pixels, gate, remap),
  `sheet-adjust-bytes.ts` (pdf-lib / sharp), `sheet-adjust-server.ts` + `replaceSheetWithAdjusted` (new sheet in the old
  one's place, references moved) and `adjustSheetAction`. Quarter turns only, per page, only on an empty page, never the
  base sheet; the original upload is always the source.
- **UI:** `workspace/sheet-adjust-dialog.tsx` opens after every upload and from the tab's ⋯ → Crop & rotate…;
  `PdfCanvas` gained `rotateBy`.
- Spec harness: `#318` assertions (math vs pdf.js, transforms on in-test PDFs/images, store swap + gate + remap, broker
  scope/sniff/commit, wiring pins); three `#314` pins updated for `uploadGridSheet`.
- Jeff-gated: try a real 36×24 PDF (> 4 MB) on a preview deploy with Blob on; check the dialog in Safari.
```

- [ ] **Step 4: Add the AGENTS.md follow-up**

In `AGENTS.md`, item 38 (`38. ✅ **The Grid workspace** (#299, …`), after its last line `try it on a real Auto-filled, large design in production. Punch item #299.` add:

```markdown
    ✅ Follow-up (#318, D692–D694): plan sheets upload straight to Blob up to
    25 MB (the 4 MB route stays when Blob is off), and every new sheet opens in
    **Adjust sheet** — crop to the plan, turn it upright in quarter turns, per
    page, only while the page is empty — which derives a new sheet from the
    original upload (`src/lib/design/sheet-adjust*.ts`); later via the tab's ⋯ →
    Crop & rotate…. Punch item #318.
```

- [ ] **Step 5: Run the four gates and the build, and compare with Task 1's baselines**

```bash
export PATH=$HOME/.local/node/bin:$PATH
ps aux | grep -E "tsx|next dev" | grep -v grep          # nothing for this checkout
df -h /System/Volumes/Data | tail -1                     # room for temp datadirs (see the temp-dir memory)
npx tsc --noEmit -p . 2>&1 | tail -3                     # expect: no output (0 errors)
npm run test:specs > "$TMPDIR/specs-318.txt" 2>&1; tail -1 "$TMPDIR/specs-318.txt"; grep -c '^PASS' "$TMPDIR/specs-318.txt"   # expect: ALL PASSED; PASS count = baseline + the 68 new #318 assertions
npm run test:smoke 2>&1 | tail -5                        # expect: ALL PASSED (own scratch datadir)
npx eslint --ignore-pattern scripts/test-review-and-spec.ts 2>&1 | tail -3   # expect: 0 errors; warnings ≤ baseline
npm run build 2>&1 | tail -15                            # expect: build completes
```

Report each with its real numbers next to the Task 1 baseline. Any new eslint error, failing spec or build error is a stop.

- [ ] **Step 6: Commit**

```bash
git add DECISIONS.md PUNCHLIST.md AGENTS.md
git commit -m "$(cat <<'EOF'
docs: #318 Grid sheet crop + rotate, 25 MB uploads (D692–D694)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review (done while writing)

- **Spec coverage:** decisions 1–4 → Tasks 1/3 (gate), 1 (90° only), 1/5 (per page + Same for all), 4 (25 MB broker, 4 MB fallback). User flow → Task 5 (after `+` upload, intake upload/copy via `?adjust=`, ⋯ Crop & rotate… on the original with the current spec, disabled/hidden rules, Done → calibrate banner, Cancel/Skip). Storage model → Tasks 1–3 (root-only `fromSheetId`, delta rotate, displayed-frame crop, identity omitted, pdf-lib CropBox/Rotate with root `/Rotate` and offset CropBox, sharp pipeline + caps, Blob or capped data-URL, one patch with position kept and refs remapped incl. calibration `docId`/`intake.planSheetId`/drawing-set keys, old doc kept, gate refusals). 25 MB uploads → Task 4 (route checks, commit checks + orphan delete, `first` under plan lock with `planUploadId` + `recordIntakePlan`, client size courtesy 25/4 MB). Testing list → Tasks 1–5 harness functions; gates → Task 6. Out-of-scope items are not built.
- **Placeholders:** none — every code step carries the code; the only "pick a number" step (D-numbers) gives the exact command and what to change if it moved.
- **Type consistency:** `replaceSheetWithAdjusted` / `adjustSheet` / `adjustSheetAction` / `commitSheetUpload` / `commitSheetUploadAction` / `uploadGridSheet` / `postSheetMultipart` / `planFileProblem(file, blobUploads)` / hook names (`adjustTarget`, `adjustAfterUpload`, `adjustLocks`, `openAdjust`, `closeAdjust`, `finishAdjust`, `adjustAvailability`, `blobUploads`) are spelled identically wherever used; `SheetLite.adjust` is `SheetAdjust | null` and the dialog's `sheet` prop accepts it.
