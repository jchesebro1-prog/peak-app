# Grid sheet crop + rotate, and 25 MB plan uploads (#318)

Date: 2026-10-09 · Requested by Jeff · Approved in session ("looks right, go ahead").

## Problem

Jeff uploads architect/CAD PDFs to the Grid (`/design/grid/[id]`). A typical
36×24 sheet arrives sideways and carries a title block, site map and 3D view
around the floor plan. He wants, after upload: **crop to the plan, spin it
upright, then calibrate.** He also had to shrink the PDF ("…smaller1") to get
under the 4 MB upload ceiling.

## Decisions (asked and answered)

1. Crop/rotate is allowed **only while that page is empty** — no placements,
   spaces, routes or calibration on that (sheet, page). Nothing ever needs
   remapping on the page being adjusted.
2. Rotation is **90° steps only** (⟲ / ⟳). No fine-straighten.
3. Multi-page PDFs: crop + rotation are **per page** (with a "Same for all
   pages" convenience).
4. Plan uploads go **direct to Blob, up to 25 MB** (the datasheet / package-file
   broker pattern). Without Blob (local dev) the old 4 MB route stays.

## User flow

- `+` tab upload, and the intake's Plan view (dropped file or a plan copied
  from file), finish by opening the new sheet in **Adjust sheet**.
- **Adjust sheet** (full-window dialog, `role="dialog"`): the page fills the
  view with a crop box (corner + edge handles, drag inside to move, dimmed
  mask outside). Toolbar: ⟲ Rotate left · ⟳ Rotate right · Reset · Cancel ·
  Done. Rotating turns the whole page and the crop box with it. Multi-page:
  `‹ n / N ›`, per-page settings, "Same for all pages" (applies to every page
  that isn't locked). A page with content shows locked with the reason.
- **Done** saves and opens the adjusted sheet; the existing Calibrate scale
  banner follows. **Cancel/Skip** leaves the upload exactly as is.
- Later: the tab's ⋯ menu gains **Crop & rotate…**, opening the same dialog on
  the **original full page** with the current crop/rotation shown — crops are
  never lossy. Disabled (with the reason) when every page is locked. Never
  offered on the generated base sheet (`image/svg+xml`, or
  `intake.baseSheetId`).

## Storage model — derive a new sheet, never transform at view time

Every consumer (editor canvas, `toNorm`, `measureSheetAspect`, the drawing
set's `PlanSheetFigure`, print, package "Generate from Grid", riser Connect)
treats a sheet's frame as the PDF page's effective box (CropBox ∩ MediaBox,
with `/Rotate`) or an image's natural (EXIF-oriented) size. So an adjustment
writes **new bytes** and a **new `GridSheet` doc**; no consumer changes.

- `GridSheet.adjust?: { fromSheetId: string; pages: Record<string, PageAdjust> }`
  where `PageAdjust = { rotate: 0 | 90 | 180 | 270; crop: { x, y, w, h } }`.
  - `fromSheetId` is always the **root** (the original upload), never a chain:
    re-adjusting an adjusted sheet re-derives from the root's bytes.
  - `rotate` is the delta added to the root page's own rotation.
  - `crop` is normalized 0..1 in the root page **as displayed after that
    rotation** (top-left origin, y down). Identity = `{rotate:0, crop:{0,0,1,1}}`
    and is omitted from `pages`. Keys are 1-based page numbers as strings.
- **PDF** (pdf-lib, server): load the root bytes; for each page with a spec,
  map the crop rect back into PDF user space within the page's effective box
  (pure, tested math for all four total rotations, honouring the root page's
  existing `/Rotate` and CropBox), set `/CropBox` to it and `/Rotate` to
  `(rootRotate + rotate) % 360`. Pages without a spec are untouched, so their
  frame — and anything already on them — is unchanged. Save; vector stays
  vector.
- **Image** (sharp, server; page 1 only): auto-orient (EXIF), rotate by
  `rotate`, extract the crop in rotated pixel space (rounded, ≥ 1 px), re-encode
  in the source format (JPEG q92, WebP q90, PNG). Pixel caps as `shrink.ts`.
- New bytes go to Blob (`putBlob`, `grid-sheets/<projectId>/…`) — or a data URL
  when Blob is off and the result is under the data-URL cap; otherwise refuse
  with a sentence.
- One `patchDoc` on the project, re-checking the gate on the fresh doc:
  - the new id replaces the old id **at the same position** in `sheetIds`;
  - every stored reference to the old id on **other pages** is remapped to the
    new id: placements / spaces / routes `sheetId`, calibrations `docId`,
    `intake.planSheetId`, `drawingSet.excluded` keys `plan:<sys>:<sheetId>:<page>`;
  - the old sheet doc is left in place (revisions may reference it — same rule
    as `removeSheet`); revisions are not rewritten.
- Gate: refuse `in-use` when any page whose spec **changes** (vs the current
  sheet's spec) has a placement/space/route/calibration on (oldSheetId, page)
  — checked across all options. Refuse `base-sheet` for the generated base
  sheet. Refuse `not-found` / `no-such-sheet` as `removeSheet` does.
- Known, accepted edge: restoring a revision cut before an adjustment that
  references the old sheet id re-adds that old sheet next to the new one
  (`restoreRevision`'s existing re-add rule). Content lands in the correct
  frame; documented, not engineered around.

## 25 MB direct uploads

- Token route `POST /api/grid-sheets/upload-url` (handles only
  `blob.generate-client-token`; 503 `{reason:"blob-disabled"}` when Blob is
  off): `requireUser`, project exists, pathname must be exactly
  `grid-sheets/<projectId>/<uploadKey>/<safe name>` (no `..`, safe chars),
  content types PDF/PNG/JPEG/WebP/GIF, `maximumSizeInBytes` 25 MB,
  `addRandomSuffix: true`, `access: "private"`.
- Commit server action `commitSheetUploadAction(projectId, { blobPath,
  uploadKey, name, position?, planUploadId? })`: the client's `blobPath` is
  untrusted — re-check scope, refuse an already-referenced path, `getBlobHead`
  for real size (≤ 25 MB) and a sniff (PDF `%PDF-` header or a real image
  signature; markup / SVG refused); a refusal deletes the orphan blob. Then
  `addSheet` (append) or, for `position: "first"`, the existing intake path
  under `withPlanLock` with `planUploadId` idempotency and `recordIntakePlan`.
- Clients (`use-grid-editor` upload, `uploadPlanFirst`): try the broker; on
  `blob-disabled` fall back to the existing multipart route and its 4 MB cap.
  The size courtesy check uses 25 MB on the broker path, 4 MB on fallback.
  Copy-a-plan-on-file already allows 25 MB.

## Code shape

- `src/lib/design/sheet-adjust.ts` — pure: types, `sanitizePageAdjust`,
  `isIdentity`, `cropToPdfBox(viewBox, rootRotate, adjust)`,
  `cropToPixels(w, h, adjust)`, `rotatedSize`, `changedPages(old, next)`,
  `remapSheetRefs(project, oldId, newId, keepPages)`, gate reasons.
- `src/lib/design/sheet-adjust-server.ts` — bytes in (Blob / data URL), pdf-lib
  / sharp transform, store, project patch.
- `src/lib/design/grid-sheet-upload-broker.ts` (+ route + commit action) — the
  25 MB path; client helper `uploadGridSheet(file, opts)` shared by the `+`
  tab and the intake.
- `workspace/sheet-adjust-dialog.tsx` — the dialog. Renders the **root** sheet
  via the existing proxy; `PdfCanvas` gains an optional absolute `rotation`
  prop (default = page's own); images rotate via a CSS transform inside the
  dialog only (display only — the stored result is server-derived).
- Opening after upload: editor state `adjustSheetId`; the intake swap passes
  `?adjust=<sheetId>` which the editor consumes once.

## Testing

`npm run test:specs` assertions (prefix `#318`): crop↔PDF-box math for
rotations 0/90/180/270 with and without a root `/Rotate` and an offset
CropBox (round-trip and corner cases); sanitize (rotate snapped, crop clamped
to the unit square, minimum size); a real pdf-lib PDF built in-test →
transform → read back `/CropBox` + `/Rotate`; an untouched second page keeps
its boxes; a sharp image built in-test → transform → expected dimensions;
the gate (changed page with content refuses; unchanged page with content is
fine; base sheet refuses); the project patch (position kept, other-page
refs remapped incl. calibration `docId`, `intake.planSheetId`, drawing-set
keys; old doc still resolves); broker path scope + sniff verdicts. Gates:
tsc 0, test:specs all pass, eslint on changed files, `next build`. Browser
check of the dialog on a scratch datadir with Blob disabled.

## Out of scope

Fine-angle straighten; adjusting a page that already has content; splitting
a multi-page PDF into separate sheets; magic-byte checks on the legacy
multipart route.
