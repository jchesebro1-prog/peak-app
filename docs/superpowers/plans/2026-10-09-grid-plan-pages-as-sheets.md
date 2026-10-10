# One sheet per PDF page; a real plan retires the generated plan (#319) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Grid sheet upload (the `+` tab, the intake's plan view — dropped or copied from file — and the notices banner's re-upload) turns an N-page PDF into N one-page sheets in page order, and any real plan that lands removes the generated plan when nothing is drawn on it.

**Architecture:** A pure, client-safe module (`grid-sheet-split.ts`) owns the cap, names, result shape, copy and the Adjust-queue rules; a server-only pdf-lib splitter (`sheet-split-bytes.ts`) turns bytes into one-page PDFs with `copyPages` (which carries each page's own and inherited MediaBox / CropBox / Rotate — verified against pdf.js); ONE server function (`storeUploadAsSheets` in `grid-sheet-split-server.ts`) stores an upload as one or more sheets at its position and then calls a new store function `retireBaseSheet`, which shares `removeSheet`'s (#317) drop logic. The broker commit, the 4 MB route and the intake's copy all call that one function; their results gain `sheetIds` + `baseSheet` + `note`, and the editor's Adjust sheet walks a multi-sheet upload as a queue.

**Tech Stack:** Next.js 16 App Router (server actions, route handlers), TypeScript, Drizzle doc-store on PGlite/Postgres, pdf-lib 1.17.1, pdfjs-dist (`legacy/build/pdf.mjs` in the Node harness), `@vercel/blob`.

**Spec:** `docs/superpowers/specs/2026-10-09-grid-plan-pages-as-sheets-design.md` (approved). Builds on #318 (`docs/superpowers/plans/2026-10-09-grid-sheet-crop-rotate.md`).

## Spec deviations (found while reading the code — each is logged in DECISIONS in Task 5)

1. **Two more "kept as one sheet" fallbacks besides encrypted / unreadable / over 60 pages:** the split output is capped at **100 MB** total (Blob on) or **24 MB** (Blob off, stored as data-URLs) — pdf-lib copies a page's shared resources into every one-page file, so a 25 MB set with one big shared raster could otherwise grow to gigabytes in memory — reason `too-big`; and if storing any page fails, the pages already written are deleted and the upload lands whole — reason `failed`. Both carry a note; neither refuses the upload.
2. **Results keep `sheetId` (= `sheetIds[0]`) beside the new `sheetIds`.** The #318 callers and tests keep working, `intake.planSheetId` is page 1, and the replay answer is `{ sheetId: done, sheetIds: [done], already: true }`.
3. **`?adjust=` carries a comma-separated id list** (listed ids only, in order, ≤ 60 — `parseAdjustParam`), the editor prop `adjustSheetId` becomes `adjustSheetIds: string[]`, and `saveGridIntakeAction` returns `planSheetIds` (its `planSheetId` is removed in Task 4).
4. **Who gets told what:** paths at the intake's FIRST position (the dropped plan, the on-file copy, the banner's "Choose the plan again…" and "Retry the plan view") leave the kept sentence and any split note as **intake notices** (`intakeNotices: true`); the `+` tab only notes in the status bar (`noteAction(uploadNote(…))`). The banner re-upload does both.
5. **"N devices" counts placement records** on the generated plan, across every option (a lot with qty 12 is one marker); wires = route records, counted only when there are no devices.
6. **The on-file copy reads the source (≤ 30 MB) to split it** instead of copying Blob to Blob; images and unsplittable PDFs still copy Blob to Blob. The customer's source file is **never** dropped (no `dropOriginal` on the copy path — pinned).
7. **A PDF whose bytes can't be read back** (the blob read fails or exceeds 30 MB) lands as one sheet with the "couldn't be split" note.
8. **`copyPages` alone preserves the displayed box and rotation** — no explicit box/rotation writes. Dry-run (pdf-lib 1.17.1 → pdf.js): a page with an offset CropBox, one with its own `/Rotate 90`, and one inheriting the page tree's MediaBox + `/Rotate` each read back identically after the split (pdf-lib's copier moves the inheritable `MediaBox`/`CropBox`/`Rotate`/`Resources` onto the copied page).
9. **In the Adjust queue, Escape and "Done with nothing changed" behave as Skip** (next sheet) — they already call `onCancel`. After the last sheet or **Skip the rest**, the editor stays on the sheet the dialog was on (today's Skip rule), not the first of the batch.
10. `GridSheet.split` is stored (provenance) but not displayed anywhere yet.

## Global Constraints

- Split at upload, on every path that creates a sheet from an uploaded or copied file; an N-page PDF → N single-page sheets, consecutive, in page order, at the upload's position (appended, or FIRST for the intake plan view). A 1-page PDF and images are unchanged.
- Names: `<file name> — p.<n>` (n 1-based); a 1-page PDF keeps its name; names stay ≤ 120 characters (the suffix is kept).
- Each split sheet records `split: { from: <original file name>, page: n, pages: N }` and is its own **root** for Adjust sheet (no `adjust` field).
- At most **60 pages** split per upload; more → one sheet with a note. Encrypted / unreadable → one sheet, never refused.
- The broker's original upload blob is deleted after a successful split (a replayed commit then fails its head read instead of splitting twice). A customer's on-file document is never deleted.
- Retire the generated plan after a real plan (PDF **or** image) lands: if `intake.baseSheetId` is listed and no placement or route on any option references it, remove it like Delete sheet (#317) — Spaces dropped after an automatic revision `Auto-saved before removing the generated plan`, riser boxes pruned. Otherwise keep it and report `Generated plan kept — it has N devices on it.` (wires if no devices). Never clear `intake.baseSheetId`.
- The intake `position: "first"` paths stay inside `withPlanLock` with `planUploadId` idempotency; split + retire happen inside that same locked commit.
- Results gain `sheetIds: string[]` and `baseSheet?: "removed" | { kept: number; what: "devices" | "wires" }` (plus `note?: string`).
- Adjust queue: "Sheet 2 of 5", Done or Skip → next, **Skip the rest**. One sheet → today's flow.
- Existing multi-page sheets are left as they are. Out of scope: splitting existing sheets, choosing pages, retiring on Auto when devices exist.
- No migration (doc-store JSONB). Ids: `gs-` + 12 hex. Timestamps epoch-ms.
- `src/lib/design/grid-sheet-split.ts` is pure and import-free (client components import it). `"use client"` files never import stores, pdf-lib, sharp, postgres or any `*-server.ts`.
- UI: accent only via `var(--accent)`; the dialog stays `role="dialog"`.
- Tests: `npm run test:specs` (`scripts/test-review-and-spec.ts`, its own temp `PGLITE_PATH`); assertions prefixed **`#319`**; fixtures built in-test (pdf-lib PDFs, sharp images) — never read gitignored files. New async check functions go at the END of the harness file and are chained after `.then(() => sheetAdjust318StaleSheetChecks())`.
- pdf-lib errors are matched by message (`e.name` is always `"Error"`). Never pass `isEvalSupported` to pdf.js `getDocument` (a TS error here).
- Shell: `export PATH=$HOME/.local/node/bin:$PATH` first. Never `git add -A` / `git stash` (untracked junk sits at the repo root) — add exact paths. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- PGlite is single-process: before any `test:specs`/`tsx`/`next dev` run, `ps aux | grep -E "tsx|next dev" | grep -v grep` must show nothing. Any DB run outside test:specs uses a temp `PGLITE_PATH`.
- `npx eslint` on the whole repo crashes on the harness file — pass `--ignore-pattern scripts/test-review-and-spec.ts` when linting broadly; per task, lint only the touched source files.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/lib/design/grid-sheet-split.ts` | Create | Pure, client-safe: caps, `SheetSplit`, `BaseSheetOutcome`, `SheetsLanded` / `SheetUploadResult`, `splitSheetName`, `cleanBaseSheetOutcome`, `baseSheetKeptText`, `splitFallbackNote`, `landed`, `uploadNote`, `parseSheetsLanded`, `parseAdjustParam`, `adjustQueueStep`, copy. |
| `src/lib/design/sheet-split-bytes.ts` | Create | Server-only pdf-lib splitter `splitPdfPages` (bytes in → one-page PDFs out, or why not). |
| `src/lib/stores/grid-projects.ts` | Modify | `GridSheet.split?`; `NewSheetFile` + `addSheets` (`addSheet` wraps it); private `sheetHolds` + `dropSheetInPatch` shared by `removeSheet` and the new `retireBaseSheet`. |
| `src/lib/design/sheet-adjust-server.ts` | Modify | Export `StoredSheetFile`, `storeSheetFile`, and a new `readBlobCapped` (the existing stream reader, shared). |
| `src/lib/design/grid-sheet-split-server.ts` | Create | Server-only `storeUploadAsSheets` — the one "store these bytes as sheets, then retire the generated plan" step. |
| `src/lib/design/grid-sheet-upload-server.ts` | Modify | Broker commit calls `storeUploadAsSheets`; new `read` dep; result gains `sheetIds`/`baseSheet`/`note`. |
| `src/app/api/grid-sheets/upload/route.ts` | Modify | Legacy 4 MB route calls `storeUploadAsSheets`; its own `storeSheet` is gone. |
| `src/lib/design/grid-plan-intake-server.ts` | Modify | On-file copy calls `storeUploadAsSheets` (reads the source to split; never drops it). |
| `src/app/(app)/design/grid/[id]/actions.ts` | Modify | `commitSheetUploadAction` returns `SheetsLanded`; `saveGridIntakeAction` returns `planSheetIds`. |
| `src/lib/design/grid-plan-upload.ts` | Modify | `postSheetMultipart` parses the route's new reply (`parseSheetsLanded`). |
| `src/app/(app)/design/grid/[id]/sheet-upload.ts` | Modify | `SheetUploadResult` comes from the pure module. |
| `src/app/(app)/design/grid/[id]/use-grid-editor.ts` | Modify | `adjustSheetIds` prop, the Adjust queue (`adjusting.queue`, `adjustQueue`, `skipRestAdjust`), the `+` tab's `uploadNote`. |
| `src/app/(app)/design/grid/[id]/workspace/sheet-adjust-dialog.tsx` | Modify | "Sheet n of N" + **Skip the rest**. |
| `src/app/(app)/design/grid/[id]/editor.tsx` | Modify | Pass `queue` / `onSkipRest`. |
| `src/app/(app)/design/grid/[id]/page.tsx` | Modify | `adjustSheetIds={parseAdjustParam(…)}`. |
| `src/app/(app)/design/grid/[id]/grid-intake.tsx` | Modify | Finish with `?adjust=<every new sheet id>`. |
| `src/app/(app)/design/grid/[id]/workspace/intake-notices.tsx` | Modify | Re-upload notes the result and queues every new sheet. |
| `scripts/test-review-and-spec.ts` | Modify | `#319` check functions + chain; four `#318`/`#314` pins and one `#318` test helper updated. |
| `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md` | Modify | D695–D697 (recompute), `## 319.`, a ✅ follow-up under item 38. |

---

### Task 1: Pure rules + the PDF splitter

**Files:**
- Create: `src/lib/design/grid-sheet-split.ts`
- Create: `src/lib/design/sheet-split-bytes.ts`
- Test: `scripts/test-review-and-spec.ts` (new functions at the END + two chain entries)

**Interfaces:**
- Consumes: `sheetKindOf(bytes): SheetKind | null` from `src/lib/design/sheet-adjust-bytes.ts` (#318).
- Produces (all later tasks rely on these exact names):
  - `GRID_SHEET_SPLIT_MAX_PAGES = 60`, `GRID_SHEET_SPLIT_MAX_TOTAL_BYTES = 100 MB`, `GRID_SHEET_SPLIT_DATAURL_MAX_TOTAL_BYTES = 24 MB`, `GRID_SHEET_SPLIT_COPY = { storage, gone }`
  - `type SheetSplit = { from: string; page: number; pages: number }`
  - `type BaseSheetOutcome = "removed" | { kept: number; what: "devices" | "wires" }`
  - `type SheetsLanded = { sheetId: string; sheetIds: string[]; baseSheet?: BaseSheetOutcome; note?: string }`
  - `type SheetUploadResult = ({ ok: true } & SheetsLanded) | { ok: false; error: string }`
  - `type SplitFallback = "too-many-pages" | "encrypted" | "unreadable" | "too-big" | "failed"`
  - `splitSheetName(name: string, page: number, pages: number): string`
  - `cleanBaseSheetOutcome(raw: unknown): BaseSheetOutcome | null`
  - `baseSheetKeptText(o: { kept: number; what: "devices" | "wires" }): string`
  - `splitFallbackNote(reason: SplitFallback, pageCount?: number): string`
  - `landed(sheetIds: readonly string[], baseSheet?: BaseSheetOutcome | null, note?: string | null): SheetsLanded`
  - `uploadNote(fileName: string, r: Pick<SheetsLanded, "sheetIds" | "baseSheet" | "note">): string`
  - `parseSheetsLanded(raw: unknown): SheetsLanded | null`
  - `parseAdjustParam(raw: unknown, sheetIds: readonly string[]): string[]`
  - `adjustQueueStep(queue: readonly string[] | null | undefined, current: string, listed: readonly string[]): { position: { index: number; total: number } | null; next: string | null }`
  - `splitPdfPages(bytes: Uint8Array, opts?: { maxPages?: number; maxTotalBytes?: number }): Promise<SplitPdfResult>` where `SplitPdfResult = { ok: true; pages: Uint8Array[] } | { ok: false; reason: "not-pdf" | "single" | "too-many-pages" | "encrypted" | "unreadable" | "too-big"; pageCount?: number }`
  - Harness helpers (module-level, used again in Task 3): `views319(bytes)`, `pdf319Set()`, `pagesPdf319(n)`, `encryptedPdf319()`.

- [ ] **Step 0: Record the baselines (once, before any change)**

```bash
export PATH=$HOME/.local/node/bin:$PATH
cd /Users/sm/Downloads/peak-app
ps aux | grep -E "tsx|next dev" | grep -v grep          # must print nothing
df -h /System/Volumes/Data | tail -1                     # room for test:specs temp datadirs
npx tsc --noEmit -p . 2>&1 | tail -3                     # baseline: no output
npm run test:specs > "$TMPDIR/specs-319-base.txt" 2>&1; tail -1 "$TMPDIR/specs-319-base.txt"; grep -c '^PASS' "$TMPDIR/specs-319-base.txt"
npx eslint --ignore-pattern scripts/test-review-and-spec.ts 2>&1 | tail -3
```

Write the four numbers down (tsc errors, ALL PASSED + PASS count, eslint errors/warnings). Task 5 compares against them.

- [ ] **Step 1: Write the failing tests**

Append at the END of `scripts/test-review-and-spec.ts`:

```ts
/* ---------------- #319: one sheet per PDF page — fixtures ---------------- */
/** #319: what pdf.js shows for each page (its view box and rotation). */
async function views319(bytes: Uint8Array): Promise<Array<{ view: number[]; rotate: number }>> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true });
  const pdf = await task.promise;
  const out: Array<{ view: number[]; rotate: number }> = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const pg = await pdf.getPage(n);
    out.push({ view: [...pg.view], rotate: pg.rotate });
  }
  await task.destroy();
  return out;
}

/** #319: a 3-page plan set — page 1 is 200×100 with an offset CropBox; page 2 is
 *  300×200 with its own /Rotate 90; page 3 has no MediaBox of its own and
 *  inherits the page tree's 612×792. Pages 1 and 3 inherit the tree's /Rotate 180. */
async function pdf319Set(): Promise<Uint8Array> {
  const { PDFDocument, PDFName, PDFNumber, degrees } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const p1 = doc.addPage([200, 100]);
  p1.setCropBox(10, 20, 150, 60);
  const p2 = doc.addPage([300, 200]);
  p2.setRotation(degrees(90));
  const p3 = doc.addPage([400, 500]);
  doc.catalog.Pages().set(PDFName.of("MediaBox"), doc.context.obj([0, 0, 612, 792]));
  doc.catalog.Pages().set(PDFName.of("Rotate"), PDFNumber.of(180));
  p3.node.delete(PDFName.of("MediaBox"));
  return doc.save();
}

/** #319: an n-page PDF of 100×100 pages. */
async function pagesPdf319(n: number): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) doc.addPage([100, 100]);
  return doc.save();
}

/** #319: a 2-page PDF with an /Encrypt dictionary (the #318 recipe) — pdf-lib refuses it as encrypted. */
async function encryptedPdf319(): Promise<Uint8Array> {
  const text = Buffer.from(await pagesPdf319(2)).toString("latin1");
  const rootAt = text.lastIndexOf("/Root");
  const enc = text.slice(0, rootAt) + "/Encrypt << /Filter /Standard /V 1 /R 2 /O <" + "00".repeat(32) + "> /U <" + "00".repeat(32) + "> /P -4 >> /Root" + text.slice(rootAt + 5);
  return new Uint8Array(Buffer.from(enc, "latin1"));
}

/* ---------------- #319: one sheet per PDF page — pure rules ---------------- */
async function pagesAsSheets319PureChecks(): Promise<void> {
  const S = await import("@/lib/design/grid-sheet-split");
  const J = (v: unknown) => JSON.stringify(v);
  ok(S.GRID_SHEET_SPLIT_MAX_PAGES === 60, "#319 the split cap is 60 pages");
  ok(S.splitSheetName("Set.pdf", 2, 5) === "Set.pdf — p.2" && S.splitSheetName("Set.pdf", 1, 1) === "Set.pdf" && S.splitSheetName("  ", 1, 3) === "Plan sheet — p.1",
    "#319 splitSheetName: '<file name> — p.<n>'; a 1-page PDF keeps its name; a blank name is Plan sheet");
  const long = S.splitSheetName("x".repeat(200), 60, 60);
  ok(long.length === 120 && long.endsWith(" — p.60"), "#319 splitSheetName keeps the page suffix inside the 120-character name cap");
  ok(J(S.cleanBaseSheetOutcome("removed")) === J("removed") && J(S.cleanBaseSheetOutcome({ kept: 2, what: "devices" })) === J({ kept: 2, what: "devices" }) &&
     S.cleanBaseSheetOutcome({ kept: 0, what: "devices" }) === null && S.cleanBaseSheetOutcome({ kept: 1, what: "spaces" }) === null && S.cleanBaseSheetOutcome(null) === null,
    "#319 cleanBaseSheetOutcome: removed, or a positive count of devices / wires");
  ok(S.baseSheetKeptText({ kept: 3, what: "devices" }) === "Generated plan kept — it has 3 devices on it." &&
     S.baseSheetKeptText({ kept: 1, what: "devices" }) === "Generated plan kept — it has 1 device on it." &&
     S.baseSheetKeptText({ kept: 1, what: "wires" }) === "Generated plan kept — it has 1 wire on it.",
    "#319 the kept sentence counts devices (or wires) with the right noun");
  ok(S.uploadNote("Set.pdf", { sheetIds: ["gs-1", "gs-2", "gs-3"], baseSheet: "removed" }) === "Uploaded Set.pdf as 3 sheets · removed the generated plan" &&
     S.uploadNote("Plan.png", { sheetIds: ["gs-1"] }) === "Uploaded Plan.png" &&
     S.uploadNote("Plan.png", { sheetIds: ["gs-1"], baseSheet: { kept: 2, what: "devices" } }) === "Uploaded Plan.png · Generated plan kept — it has 2 devices on it." &&
     S.uploadNote("Big.pdf", { sheetIds: ["gs-1"], note: S.splitFallbackNote("too-many-pages", 75) }) === "Uploaded Big.pdf · This PDF has 75 pages — more than 60 — so it was kept as one sheet.",
    "#319 uploadNote: how many sheets, what happened to the generated plan, and why a PDF wasn't split");
  ok((["too-many-pages", "encrypted", "unreadable", "too-big", "failed"] as const).every((r) => S.splitFallbackNote(r, 61).endsWith("so it was kept as one sheet.")) &&
     new Set((["too-many-pages", "encrypted", "unreadable", "too-big", "failed"] as const).map((r) => S.splitFallbackNote(r, 61))).size === 5 &&
     S.splitFallbackNote("encrypted").includes("password-protected"),
    "#319 every split fallback has its own sentence ending 'kept as one sheet'");
  const a = "gs-aaaaaaaaaaaa", b = "gs-bbbbbbbbbbbb", c = "gs-cccccccccccc";
  ok(J(S.parseSheetsLanded({ ok: true, sheetId: a, sheetIds: [a, b], baseSheet: "removed", note: " n " })) === J({ sheetId: a, sheetIds: [a, b], baseSheet: "removed", note: "n" }) &&
     J(S.parseSheetsLanded({ ok: true, sheetId: a })) === J({ sheetId: a, sheetIds: [a] }) &&
     J(S.parseSheetsLanded({ ok: true, sheetId: a, sheetIds: ["../x", b], baseSheet: { kept: -1, what: "devices" } })) === J({ sheetId: b, sheetIds: [b] }) &&
     S.parseSheetsLanded({ ok: false, error: "x" }) === null && S.parseSheetsLanded({ ok: true, sheetId: "nope" }) === null && S.parseSheetsLanded("x") === null,
    "#319 parseSheetsLanded: the 4 MB route's reply — junk ids and outcomes dropped; an old single-sheet reply still reads");
  const seventy = Array.from({ length: 70 }, (_, i) => `gs-${String(i).padStart(12, "0")}`);
  ok(J(S.parseAdjustParam(`${b},${a},zz,${b}`, [a, b])) === J([b, a]) && J(S.parseAdjustParam(undefined, [a])) === "[]" &&
     J(S.parseAdjustParam(["x"], [a])) === "[]" && J(S.parseAdjustParam(a, [a])) === J([a]) && S.parseAdjustParam(seventy.join(","), seventy).length === 60,
    "#319 parseAdjustParam: listed ids only, in the order asked, no repeats, at most 60; one id still works");
  ok(J(S.adjustQueueStep([a, b, c], a, [a, b, c])) === J({ position: { index: 0, total: 3 }, next: b }) &&
     J(S.adjustQueueStep([a, b, c], b, [a, c])) === J({ position: { index: 1, total: 3 }, next: c }) &&
     J(S.adjustQueueStep([a, b, c], a, [a, c])) === J({ position: { index: 0, total: 3 }, next: c }) &&
     J(S.adjustQueueStep([a, b, c], c, [a, b, c])) === J({ position: { index: 2, total: 3 }, next: null }) &&
     J(S.adjustQueueStep([a], a, [a])) === J({ position: null, next: null }) && J(S.adjustQueueStep(undefined, a, [a])) === J({ position: null, next: null }) &&
     J(S.adjustQueueStep([a, b], c, [a, b, c])) === J({ position: null, next: null }),
    "#319 adjustQueueStep: 'Sheet n of N', and the next sheet still listed (a removed one is skipped; the last has none)");
  ok(J(S.landed([a, b], "removed", "")) === J({ sheetId: a, sheetIds: [a, b], baseSheet: "removed" }) && J(S.landed([a], null, null)) === J({ sheetId: a, sheetIds: [a] }),
    "#319 landed: the first sheet is the sheetId; empty extras are left off");
}

/* ---------------- #319: one sheet per PDF page — the splitter ---------------- */
async function pagesAsSheets319BytesChecks(): Promise<void> {
  const X = await import("@/lib/design/sheet-split-bytes");
  const sharp = (await import("sharp")).default;
  const J = (v: unknown) => JSON.stringify(v);
  const set = await pdf319Set();
  const srcViews = await views319(set);
  ok(J(srcViews) === J([{ view: [10, 20, 160, 80], rotate: 180 }, { view: [0, 0, 300, 200], rotate: 90 }, { view: [0, 0, 612, 792], rotate: 180 }]),
    "#319 fixture: page 3 inherits the MediaBox, pages 1 and 3 inherit /Rotate 180 (pdf.js reads the source so)");
  const r = await X.splitPdfPages(set);
  const got = r.ok ? await Promise.all(r.pages.map((p) => views319(p))) : [];
  ok(r.ok && r.pages.length === 3 && got.every((v) => v.length === 1) && J(got.map((v) => v[0])) === J(srcViews),
    "#319 splitPdfPages: three one-page PDFs in page order, each shown exactly as its source page (CropBox, own and inherited /Rotate, inherited MediaBox)");
  const r1 = await X.splitPdfPages(await pagesPdf319(1));
  const png = new Uint8Array(await sharp({ create: { width: 4, height: 4, channels: 3, background: "#ffffff" } }).png().toBuffer());
  const rp = await X.splitPdfPages(png);
  ok(!r1.ok && r1.reason === "single" && !rp.ok && rp.reason === "not-pdf", "#319 a 1-page PDF is 'single' and an image is 'not-pdf' (both stay one sheet)");
  const enc = await X.splitPdfPages(await encryptedPdf319());
  ok(!enc.ok && enc.reason === "encrypted", "#319 an encrypted PDF is 'encrypted' (matched by pdf-lib's message)");
  const r61 = await X.splitPdfPages(await pagesPdf319(61));
  const r60 = await X.splitPdfPages(await pagesPdf319(60));
  ok(!r61.ok && r61.reason === "too-many-pages" && r61.pageCount === 61 && r60.ok && r60.pages.length === 60,
    "#319 61 pages is over the cap (with its count); exactly 60 still splits");
  const tooBig = await X.splitPdfPages(set, { maxTotalBytes: 10 });
  const broken = await X.splitPdfPages(new TextEncoder().encode("%PDF-1.7 not really a pdf"));
  ok(!tooBig.ok && tooBig.reason === "too-big" && !broken.ok && broken.reason === "unreadable",
    "#319 split output over the byte budget is 'too-big'; a broken PDF is 'unreadable'");
}
```

Then, in the promise chain near line 11530, change:

```ts
  .then(() => sheetAdjust318StaleSheetChecks())
```

to:

```ts
  .then(() => sheetAdjust318StaleSheetChecks())
  .then(() => pagesAsSheets319PureChecks())
  .then(() => pagesAsSheets319BytesChecks())
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: an error naming `Cannot find module '@/lib/design/grid-sheet-split'` (exit code 1).

- [ ] **Step 3: Create `src/lib/design/grid-sheet-split.ts`**

```ts
/**
 * #319 — a multi-page PDF becomes one Grid sheet per page, and a real plan
 * retires the generated plan. Pure and client-safe (the editor, the intake
 * and the notices banner import it): the caps, the names, the provenance
 * stamp, the result every upload path returns, its copy, and the Adjust-sheet
 * queue rules. The bytes are split in sheet-split-bytes.ts (pdf-lib); the one
 * "store an upload as sheets" step is grid-sheet-split-server.ts.
 */

/** Most pages one upload is split into; more → kept as one sheet, with a note. */
export const GRID_SHEET_SPLIT_MAX_PAGES = 60;
/** Most bytes the one-page files of a split may add up to (pdf-lib copies shared
 *  resources into every page) — Blob on. Over → one sheet, with a note. */
export const GRID_SHEET_SPLIT_MAX_TOTAL_BYTES = 100 * 1024 * 1024;
/** The same budget when Blob is off and every page is stored in-database. */
export const GRID_SHEET_SPLIT_DATAURL_MAX_TOTAL_BYTES = 24 * 1024 * 1024;
const NAME_MAX = 120;
const SHEET_ID_RE = /^gs-[0-9a-f]{12}$/;

export const GRID_SHEET_SPLIT_COPY = {
  storage: "Upload to file storage failed — check the Blob token, or try again.",
  gone: "That design could not be found.",
} as const;

/** Stamped on each sheet split from a multi-page PDF (display/provenance only). */
export type SheetSplit = { from: string; page: number; pages: number };
/** What a landed plan did to the generated plan: removed it, or left it (and why). */
export type BaseSheetOutcome = "removed" | { kept: number; what: "devices" | "wires" };
/** Every sheet-creating path's success: all new sheets in order (`sheetId` = the first). */
export type SheetsLanded = { sheetId: string; sheetIds: string[]; baseSheet?: BaseSheetOutcome; note?: string };
export type SheetUploadResult = ({ ok: true } & SheetsLanded) | { ok: false; error: string };
/** Why a PDF was kept as one sheet instead of split. */
export type SplitFallback = "too-many-pages" | "encrypted" | "unreadable" | "too-big" | "failed";

/** `<file name> — p.<n>`; a 1-page PDF keeps its name. The suffix always fits the 120-character cap. */
export function splitSheetName(name: string, page: number, pages: number): string {
  const base = (name || "").trim() || "Plan sheet";
  if (pages <= 1) return base.slice(0, NAME_MAX);
  const suffix = ` — p.${page}`;
  return base.slice(0, NAME_MAX - suffix.length).trimEnd() + suffix;
}

export function cleanBaseSheetOutcome(raw: unknown): BaseSheetOutcome | null {
  if (raw === "removed") return "removed";
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { kept?: unknown; what?: unknown };
  const kept = Number(o.kept);
  return Number.isInteger(kept) && kept > 0 && (o.what === "devices" || o.what === "wires") ? { kept, what: o.what } : null;
}

export function baseSheetKeptText(o: { kept: number; what: "devices" | "wires" }): string {
  const noun = o.what === "devices" ? (o.kept === 1 ? "device" : "devices") : o.kept === 1 ? "wire" : "wires";
  return `Generated plan kept — it has ${o.kept} ${noun} on it.`;
}

export function splitFallbackNote(reason: SplitFallback, pageCount = 0): string {
  switch (reason) {
    case "too-many-pages":
      return `This PDF has ${pageCount} pages — more than ${GRID_SHEET_SPLIT_MAX_PAGES} — so it was kept as one sheet.`;
    case "encrypted":
      return "This PDF is password-protected, so it was kept as one sheet.";
    case "too-big":
      return "This PDF's pages are too large to store one by one, so it was kept as one sheet.";
    case "failed":
      return "This PDF's pages couldn't be saved one by one, so it was kept as one sheet.";
    default:
      return "This PDF couldn't be split into pages, so it was kept as one sheet.";
  }
}

/** The success shape, with empty extras left off. */
export function landed(sheetIds: readonly string[], baseSheet?: BaseSheetOutcome | null, note?: string | null): SheetsLanded {
  return { sheetId: sheetIds[0] ?? "", sheetIds: [...sheetIds], ...(baseSheet ? { baseSheet } : {}), ...(note ? { note } : {}) };
}

/** The editor's "Last action" after an upload. */
export function uploadNote(fileName: string, r: Pick<SheetsLanded, "sheetIds" | "baseSheet" | "note">): string {
  const n = r.sheetIds.length;
  const parts = [n > 1 ? `Uploaded ${fileName} as ${n} sheets` : `Uploaded ${fileName}`];
  if (r.baseSheet === "removed") parts.push("removed the generated plan");
  else if (r.baseSheet) parts.push(baseSheetKeptText(r.baseSheet));
  if (r.note) parts.push(r.note);
  return parts.join(" · ");
}

const isSheetId = (v: unknown): v is string => typeof v === "string" && SHEET_ID_RE.test(v);

/** The 4 MB route's JSON reply → the success shape, or null. An older single-sheet reply still reads. */
export function parseSheetsLanded(raw: unknown): SheetsLanded | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.ok !== true || !isSheetId(o.sheetId)) return null;
  const ids = Array.isArray(o.sheetIds) ? o.sheetIds.filter(isSheetId) : [];
  const note = typeof o.note === "string" ? o.note.trim().slice(0, 300) : "";
  return landed(ids.length ? ids : [o.sheetId], cleanBaseSheetOutcome(o.baseSheet), note);
}

/** `?adjust=<id>,<id>,…` → the listed ids, in the order asked, no repeats, at most 60. */
export function parseAdjustParam(raw: unknown, sheetIds: readonly string[]): string[] {
  if (typeof raw !== "string" || !raw) return [];
  const listed = new Set(sheetIds);
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (listed.has(id) && !out.includes(id)) out.push(id);
    if (out.length >= GRID_SHEET_SPLIT_MAX_PAGES) break;
  }
  return out;
}

/**
 * Adjust sheet's walk through a multi-sheet upload: where `current` sits
 * ("Sheet 2 of 5") and the next queued sheet still listed. A queue of one, or
 * a sheet not in it, is no walk.
 */
export function adjustQueueStep(
  queue: readonly string[] | null | undefined,
  current: string,
  listed: readonly string[]
): { position: { index: number; total: number } | null; next: string | null } {
  if (!queue || queue.length < 2) return { position: null, next: null };
  const index = queue.indexOf(current);
  if (index < 0) return { position: null, next: null };
  const live = new Set(listed);
  return { position: { index, total: queue.length }, next: queue.slice(index + 1).find((id) => live.has(id)) ?? null };
}
```

- [ ] **Step 4: Create `src/lib/design/sheet-split-bytes.ts`**

```ts
// SERVER ONLY — pdf-lib. Never import from a "use client" file.
/**
 * #319 — a multi-page PDF in, one single-page PDF per page out, in page order.
 * `copyPages` carries each page's own AND inherited /MediaBox, /CropBox,
 * /Rotate and /Resources onto the copied page (pdf-lib's copier), so every
 * one-page file displays exactly as that page did — checked against pdf.js
 * in the spec harness. Pure in, bytes out — no storage, no store.
 */
import { PDFDocument } from "pdf-lib";
import { sheetKindOf } from "./sheet-adjust-bytes";
import { GRID_SHEET_SPLIT_MAX_PAGES, GRID_SHEET_SPLIT_MAX_TOTAL_BYTES } from "./grid-sheet-split";

export type SplitPdfResult =
  | { ok: true; pages: Uint8Array[] }
  | { ok: false; reason: "not-pdf" | "single" | "too-many-pages" | "encrypted" | "unreadable" | "too-big"; pageCount?: number };

export async function splitPdfPages(bytes: Uint8Array, opts: { maxPages?: number; maxTotalBytes?: number } = {}): Promise<SplitPdfResult> {
  const maxPages = opts.maxPages ?? GRID_SHEET_SPLIT_MAX_PAGES;
  const maxTotal = opts.maxTotalBytes ?? GRID_SHEET_SPLIT_MAX_TOTAL_BYTES;
  if (sheetKindOf(bytes) !== "pdf") return { ok: false, reason: "not-pdf" };
  let src: PDFDocument;
  try {
    src = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    // pdf-lib 1.17's errors are ES5-subclassed: `e.name` is always "Error"; the message is the only tell.
    return { ok: false, reason: /encrypted/i.test(String((e as { message?: unknown } | null)?.message)) ? "encrypted" : "unreadable" };
  }
  const count = src.getPageCount();
  if (count <= 1) return { ok: false, reason: "single", pageCount: count };
  if (count > maxPages) return { ok: false, reason: "too-many-pages", pageCount: count };
  try {
    const pages: Uint8Array[] = [];
    let total = 0;
    for (let i = 0; i < count; i++) {
      const out = await PDFDocument.create({ updateMetadata: false });
      const [page] = await out.copyPages(src, [i]);
      out.addPage(page);
      const one = await out.save();
      total += one.byteLength;
      if (total > maxTotal) return { ok: false, reason: "too-big", pageCount: count };
      pages.push(one);
    }
    return { ok: true, pages };
  } catch {
    return { ok: false, reason: "unreadable", pageCount: count };
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:specs 2>&1 | grep -E "#319|FAIL|ALL PASSED|FAILED"`
Expected: every `#319` line starts with `PASS`; the run ends with `ALL PASSED`.

- [ ] **Step 6: Typecheck and lint**

Run: `npx tsc --noEmit -p . 2>&1 | tail -3` → no output.
Run: `npx eslint src/lib/design/grid-sheet-split.ts src/lib/design/sheet-split-bytes.ts` → no output.

- [ ] **Step 7: Commit**

```bash
git add src/lib/design/grid-sheet-split.ts src/lib/design/sheet-split-bytes.ts scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(grid): #319 pure split rules + pdf-lib page splitter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Store — `addSheets`, `retireBaseSheet`, and `removeSheet` sharing one drop helper

**Files:**
- Modify: `src/lib/stores/grid-projects.ts` (imports; `GridSheet` ~325–343; `addSheet` ~606–642; `removeSheet` ~674–720)
- Test: `scripts/test-review-and-spec.ts` (one new function + chain entry; one `#314` pin updated)

**Interfaces:**
- Consumes: `SheetSplit`, `BaseSheetOutcome` from `@/lib/design/grid-sheet-split` (Task 1).
- Produces:
  - `GridSheet.split?: SheetSplit`
  - `type NewSheetFile = { name: string; mime: string; dataUrl?: string; url?: string; blobPath?: string; split?: SheetSplit }`
  - `addSheets(projectId: string, files: readonly NewSheetFile[], opts: { by: string; first?: boolean }): Promise<GridSheet[] | null>` — all docs written, then ONE patch puts the ids at the end (or, `first`, the front) in order; `null` = no such design.
  - `addSheet(projectId, input)` — unchanged signature; now `addSheets` with one file.
  - `retireBaseSheet(projectId: string, by: string): Promise<BaseSheetOutcome | null>`
  - `removeSheet` — unchanged public behaviour (all `#317` assertions keep passing).

- [ ] **Step 1: Write the failing test and update the `#314` pin**

Append at the END of `scripts/test-review-and-spec.ts`:

```ts
/* ---------------- #319: retire the generated plan + addSheets (store) ---------------- */
async function pagesAsSheets319StoreChecks(): Promise<void> {
  // In-database sheets only (data-URLs): this suite never writes to Blob.
  const prevBlob = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  try {
    const G = await import("@/lib/stores/grid-projects");
    const DS = await import("@/db/doc-store");
    const { DEFAULT_OPTION_ID } = await import("@/lib/design/grid-options");
    const J = (v: unknown) => JSON.stringify(v);
    const by = "Test Harness";
    const SVG = "data:image/svg+xml,<svg/>";
    const PNG = "data:image/png;base64,iVBORw0KGgo=";
    const square = [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.1 }, { x: 0.4, y: 0.4 }, { x: 0.1, y: 0.4 }];
    const line = [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }];
    /** A design whose intake stamped a generated plan, plus one uploaded plan. */
    const setup = async (label: string) => {
      const gp = await G.createProject({ name: `#319 ${label}`, customer: "Spec fixture", customerId: null, by });
      registerFixture("grid_projects", gp.id);
      const base = (await G.addSheet(gp.id, { name: "Generated base plan", mime: "image/svg+xml", dataUrl: SVG, by }))!;
      registerFixture("grid_sheets", base.id);
      await G.saveGridIntake(gp.id, { complete: true, measurementBased: true, venueName: "V", locationName: "L", address: "", notes: "", baseSheetId: base.id });
      const plan = (await G.addSheet(gp.id, { name: "Plan.png", mime: "image/png", dataUrl: PNG, by }))!;
      registerFixture("grid_sheets", plan.id);
      return { gp, base, plan };
    };

    // Spaces only → removed, after one automatic revision; another sheet's Space stays.
    const s1 = await setup("spaces only");
    await G.addSpace(s1.gp.id, { sheetId: s1.base.id, page: 1, name: "Stage", points: square, by });
    await G.addSpace(s1.gp.id, { sheetId: s1.plan.id, page: 1, name: "Keep", points: square, by });
    const revs1 = ((await G.getProject(s1.gp.id))!.revisions || []).length;
    const out1 = await G.retireBaseSheet(s1.gp.id, by);
    const p1 = (await G.getProject(s1.gp.id))!;
    ok(out1 === "removed" && J(p1.sheetIds) === J([s1.plan.id]) && (p1.spaces || []).length === 1 && (p1.spaces || [])[0].sheetId === s1.plan.id,
      "#319 retireBaseSheet: a generated plan with only Spaces is removed, its Spaces with it (another sheet's stays)");
    const rev = (p1.revisions || []).at(-1);
    ok((p1.revisions || []).length === revs1 + 1 && rev?.reason === "manual" && rev.note === "Auto-saved before removing the generated plan" && rev.by === by && rev.sheetIds.includes(s1.base.id),
      "#319 retireBaseSheet cuts one automatic revision first (it still lists the generated plan)");
    ok(p1.intake?.baseSheetId === s1.base.id && !!(await DS.getDoc("grid_sheets", s1.base.id)),
      "#319 intake.baseSheetId is kept (Auto fill keys off it) and the sheet doc stays readable (revisions name it)");
    ok((await G.retireBaseSheet(s1.gp.id, by)) === null, "#319 a second retire is a no-op (the generated plan is no longer listed)");

    // An empty generated plan → removed with no revision (nothing to recover).
    const s0 = await setup("empty");
    const revs0 = ((await G.getProject(s0.gp.id))!.revisions || []).length;
    ok((await G.retireBaseSheet(s0.gp.id, by)) === "removed" && ((await G.getProject(s0.gp.id))!.revisions || []).length === revs0,
      "#319 an empty generated plan is removed without a revision (like Delete sheet)");

    // A device → kept; a wire only → kept as wires.
    const s2 = await setup("device");
    await G.addPlacement(s2.gp.id, { sheetId: s2.base.id, page: 1, x: 0.5, y: 0.5, partId: "TEST-PART", optionId: DEFAULT_OPTION_ID, by });
    await G.addRoute(s2.gp.id, { sheetId: s2.base.id, page: 1, partId: "TEST-WIRE", points: line, aspect: 1, optionId: DEFAULT_OPTION_ID, by });
    ok(J(await G.retireBaseSheet(s2.gp.id, by)) === J({ kept: 1, what: "devices" }) && (await G.getProject(s2.gp.id))!.sheetIds.includes(s2.base.id),
      "#319 a generated plan with a device on it stays: {kept: 1, what: devices} (devices counted before wires)");
    const s3 = await setup("wire");
    await G.addRoute(s3.gp.id, { sheetId: s3.base.id, page: 1, partId: "TEST-WIRE", points: line, aspect: 1, optionId: DEFAULT_OPTION_ID, by });
    ok(J(await G.retireBaseSheet(s3.gp.id, by)) === J({ kept: 1, what: "wires" }), "#319 with only a wire on it, it stays and the wires are counted");

    // No generated plan, or no design → null.
    const plain = await G.createProject({ name: "#319 plain", customer: "Spec fixture", customerId: null, by });
    registerFixture("grid_projects", plain.id);
    ok((await G.retireBaseSheet(plain.id, by)) === null && (await G.retireBaseSheet("GRD-0", by)) === null, "#319 no generated plan (or no design) → nothing retired");

    // addSheets: a run appended in order, or put FIRST in order; the split stamp is stored.
    const ab = await G.addSheets(plain.id, [
      { name: "Set.pdf — p.1", mime: "application/pdf", dataUrl: PNG, split: { from: "Set.pdf", page: 1, pages: 2 } },
      { name: "Set.pdf — p.2", mime: "application/pdf", dataUrl: PNG, split: { from: "Set.pdf", page: 2, pages: 2 } },
    ], { by });
    const ff = await G.addSheets(plain.id, [{ name: "F1", mime: "image/png", dataUrl: PNG }, { name: "F2", mime: "image/png", dataUrl: PNG }], { by, first: true });
    for (const s of [...(ab || []), ...(ff || [])]) registerFixture("grid_sheets", s.id);
    const pp = (await G.getProject(plain.id))!;
    const doc1 = ab ? await DS.getDoc<import("@/lib/stores/grid-projects").GridSheet>("grid_sheets", ab[0].id) : null;
    ok(!!ab && !!ff && J(pp.sheetIds) === J([ff[0].id, ff[1].id, ab[0].id, ab[1].id]) && J(doc1?.split) === J({ from: "Set.pdf", page: 1, pages: 2 }) &&
       doc1?.addedBy === by && ab.every((s) => /^gs-[0-9a-f]{12}$/.test(s.id)),
      "#319 addSheets appends a run in order, or puts the whole run FIRST in order; the split stamp is stored");
    ok((await G.addSheets("GRD-0", [{ name: "x", mime: "image/png", dataUrl: PNG }], { by })) === null && J(await G.addSheets(plain.id, [], { by })) === "[]",
      "#319 addSheets: no design → null; nothing to add → []");
  } finally {
    if (prevBlob === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = prevBlob;
  }
}
```

Add to the chain after `.then(() => pagesAsSheets319BytesChecks())`:

```ts
  .then(() => pagesAsSheets319StoreChecks())
```

Update the `#314` pin (around line 59306) — the `addSheet` order line moves into `addSheets`. Replace:

```ts
     store.includes("p.sheetIds = input.first ? [sheet.id, ...(p.sheetIds || [])] : [...(p.sheetIds || []), sheet.id];"),
```

with:

```ts
     store.includes("p.sheetIds = opts.first ? [...ids, ...(p.sheetIds || [])] : [...(p.sheetIds || []), ...ids];"),
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:specs 2>&1 | grep -E "#319|#314 pin: an intake plan view|FAIL|FAILED|Error" | head -20`
Expected: the run stops with `TypeError: G.retireBaseSheet is not a function` (and the updated `#314` pin prints `FAIL`).

- [ ] **Step 3: Implement in `src/lib/stores/grid-projects.ts`**

3a. Imports — after the line `import { blockedPages, remapSheetRefs, type SheetAdjust } from "@/lib/design/sheet-adjust";` add:

```ts
import type { BaseSheetOutcome, SheetSplit } from "@/lib/design/grid-sheet-split";
```

3b. In `export type GridSheet = {`, after the `adjust?: SheetAdjust;` member (and its comment) add:

```ts
  /** #319: set on each sheet split from a multi-page PDF upload — the file it
   *  came from and which page (display/provenance only). Each is its own root
   *  for Adjust sheet (no `adjust`). Absent on any other sheet. */
  split?: SheetSplit;
```

3c. Replace the whole `addSheet` function (its doc comment through its closing `}`) with:

```ts
/** One new sheet's file — exactly one of dataUrl / blobPath carries the bytes. */
export type NewSheetFile = { name: string; mime: string; dataUrl?: string; url?: string; blobPath?: string; split?: SheetSplit };

/** Upload one plan background and append it to the project's sheet order.
 *  Exactly one of dataUrl/url should carry the file (the action decides —
 *  Blob when the token exists, in-database otherwise). `first` (#314, the
 *  intake's plan view) puts it at the FRONT instead, so the editor opens on it. */
export async function addSheet(
  projectId: string,
  input: {
    name: string;
    mime: string;
    dataUrl?: string;
    url?: string;
    blobPath?: string;
    by: string;
    first?: boolean;
  }
): Promise<GridSheet | null> {
  const { by, first, ...file } = input;
  return (await addSheets(projectId, [file], { by, first }))?.[0] ?? null;
}

/** #319: several new sheets as one run (a split PDF's pages) — every doc
 *  written, then ONE patch puts their ids at the end of the sheet order, or
 *  (`first`) at the front, in the order given. Null = no such design. */
export async function addSheets(projectId: string, files: readonly NewSheetFile[], opts: { by: string; first?: boolean }): Promise<GridSheet[] | null> {
  const project = await getProject(projectId);
  if (!project) return null;
  if (!files.length) return [];
  const at = Date.now();
  const sheets: GridSheet[] = files.map((f) => ({
    id: rid("gs-"),
    projectId,
    name: f.name || "Plan sheet",
    mime: f.mime,
    dataUrl: f.dataUrl || "",
    ...(f.url ? { url: f.url } : {}),
    ...(f.blobPath ? { blobPath: f.blobPath } : {}),
    ...(f.split ? { split: f.split } : {}),
    addedBy: opts.by,
    at,
  }));
  for (const s of sheets) await upsertDoc<GridSheet>("grid_sheets", s);
  const ids = sheets.map((s) => s.id);
  await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    p.sheetIds = opts.first ? [...ids, ...(p.sheetIds || [])] : [...(p.sheetIds || []), ...ids];
    p.updatedAt = Date.now();
  });
  return sheets;
}
```

3d. Replace the body of `removeSheet` (keep its doc comment) and add the two private helpers plus `retireBaseSheet` right after it:

```ts
export async function removeSheet(
  projectId: string,
  sheetId: string,
  by: string
): Promise<
  | { ok: true; spacesRemoved: number }
  | { ok: false; reason: "not-found" | "no-such-sheet" | "in-use" }
> {
  const project = await getProject(projectId);
  if (!project) return { ok: false, reason: "not-found" };
  if (!(project.sheetIds || []).includes(sheetId)) return { ok: false, reason: "no-such-sheet" };
  if (sheetHolds(project, sheetId)) return { ok: false, reason: "in-use" };
  const sheet = await getDoc<GridSheet>("grid_sheets", sheetId);
  const sheetName = sheet?.name?.trim() || "Plan sheet";
  // Re-checked on the doc patchDoc hands us: a placement/route added
  // between the pre-check and the write still refuses (no mutation).
  let refused: "no-such-sheet" | "in-use" | null = null;
  let spacesRemoved = 0;
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    if (!(p.sheetIds || []).includes(sheetId)) { refused = "no-such-sheet"; return; }
    if (sheetHolds(p, sheetId)) { refused = "in-use"; return; }
    spacesRemoved = dropSheetInPatch(p, sheetId, by, `Auto-saved before deleting sheet "${sheetName}"`);
  });
  if (!updated) return { ok: false, reason: "not-found" };
  // (Assigned inside the callback, which TS's flow analysis can't see.)
  const refusal = refused as "no-such-sheet" | "in-use" | null;
  if (refusal) return { ok: false, reason: refusal };
  return { ok: true, spacesRemoved };
}

/** What keeps a sheet on the design (#317, #319): its devices — else its
 *  wires — on ANY option. Null = nothing drawn on it. */
function sheetHolds(p: GridProject, sheetId: string): { kept: number; what: "devices" | "wires" } | null {
  const devices = (p.placements || []).filter((pl) => pl.sheetId === sheetId).length;
  if (devices) return { kept: devices, what: "devices" };
  const wires = (p.routes || []).filter((r) => r.sheetId === sheetId).length;
  return wires ? { kept: wires, what: "wires" } : null;
}

/** Drop a sheet inside a patch (#317): every Space on it (any page) goes with
 *  it — after ONE automatic revision named `note`, so it can be restored —
 *  riser boxes/links pruned like removeSpace. The caller has checked
 *  sheetHolds. Returns how many Spaces went. */
function dropSheetInPatch(p: GridProject, sheetId: string, by: string, note: string): number {
  const dropped = new Set((p.spaces || []).filter((sp) => sp.sheetId === sheetId).map((sp) => sp.id));
  if (dropped.size) {
    pushRevision(p, by, "manual", note);
    p.spaces = (p.spaces || []).filter((sp) => !dropped.has(sp.id));
    if (p.riser) p.riser = pruneRisers(p.riser, { spaceIds: dropped });
  }
  p.sheetIds = (p.sheetIds || []).filter((id) => id !== sheetId);
  p.updatedAt = Date.now();
  return dropped.size;
}

/**
 * #319 (D696): a real plan landed — remove the generated plan
 * (`intake.baseSheetId`) exactly like Delete sheet (#317) when no device or
 * wire on any option is on it: its Spaces go after one automatic revision,
 * riser boxes pruned. With devices (or, failing that, wires) on it, it stays
 * and the answer says how many. `intake.baseSheetId` is never cleared — Auto
 * fill keys off it, and its refusal already names a missing base sheet.
 * Null = nothing to retire (no generated plan, already gone, no such design).
 * Checked before and again inside the patch (removeSheet's pattern).
 */
export async function retireBaseSheet(projectId: string, by: string): Promise<BaseSheetOutcome | null> {
  const project = await getProject(projectId);
  const baseId = project?.intake?.baseSheetId;
  if (!project || !baseId || !sheetOnProject(project, baseId)) return null;
  const pre = sheetHolds(project, baseId);
  if (pre) return pre;
  let out: BaseSheetOutcome | null = null;
  const updated = await patchDoc<GridProject>("grid_projects", projectId, (p) => {
    if (p.intake?.baseSheetId !== baseId || !sheetOnProject(p, baseId)) return;
    const holds = sheetHolds(p, baseId);
    if (holds) { out = holds; return; }
    dropSheetInPatch(p, baseId, by, "Auto-saved before removing the generated plan");
    out = "removed";
  });
  // (Assigned inside the callback, which TS's flow analysis can't see.)
  return updated ? (out as BaseSheetOutcome | null) : null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:specs 2>&1 | grep -E "#319|#317|#314|#318|FAIL|ALL PASSED|FAILED"`
Expected: every `#319`, `#317`, `#314` and `#318` line `PASS` (the #317 `removeSheet` assertions are the regression check for the refactor); `ALL PASSED`.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit -p . 2>&1 | tail -3` → no output.
Run: `npx eslint src/lib/stores/grid-projects.ts` → no errors (compare any warning with `git show HEAD:src/lib/stores/grid-projects.ts | npx eslint --stdin --stdin-filename src/lib/stores/grid-projects.ts`).

- [ ] **Step 6: Commit**

```bash
git add src/lib/stores/grid-projects.ts scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(grid): #319 addSheets + retireBaseSheet sharing removeSheet's drop

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: One server step for every upload path — split, store, retire

**Files:**
- Modify: `src/lib/design/sheet-adjust-server.ts` (export the file reader + storer)
- Create: `src/lib/design/grid-sheet-split-server.ts`
- Modify: `src/lib/design/grid-sheet-upload-server.ts` (full replacement below)
- Modify: `src/app/api/grid-sheets/upload/route.ts` (full replacement below)
- Modify: `src/lib/design/grid-plan-intake-server.ts` (imports + `attachPlanCandidate*`)
- Modify: `src/app/(app)/design/grid/[id]/actions.ts` (`commitSheetUploadAction`, `saveGridIntakeAction`)
- Test: `scripts/test-review-and-spec.ts` (one new function + chain entry; the `#318` commit `deps` helper; two `#314` pins)

**Interfaces:**
- Consumes: Task 1 (`splitPdfPages`, `splitSheetName`, `splitFallbackNote`, `baseSheetKeptText`, `landed`, caps, `GRID_SHEET_SPLIT_COPY`, `SheetsLanded`, `BaseSheetOutcome`); Task 2 (`addSheets`, `NewSheetFile`, `retireBaseSheet`); existing `addIntakeNotices`, `newNoticeId`, `recordIntakePlan`, `withPlanLock`.
- Produces:
  - `sheet-adjust-server.ts`: `export type StoredSheetFile = { mime: string; dataUrl: string; url?: string; blobPath?: string }`, `export async function storeSheetFile(projectId, name, bytes, mime)` (unchanged body), `export async function readBlobCapped(pathname: string, max = SHEET_ADJUST_READ_MAX_BYTES): Promise<Uint8Array | null>`.
  - `grid-sheet-split-server.ts`: `type SheetSource = { name; mime; readBytes; storeWhole; dropOriginal? }`, `type StoreSheetsResult = ({ ok: true } & SheetsLanded) | { ok: false; reason: "storage" | "gone"; error: string }`, `storeUploadAsSheets(projectId, src, opts: { by: string; first?: boolean; intakeNotices?: boolean }, deps?: Partial<{ storePage; removeBlob; blobOn }>): Promise<StoreSheetsResult>`.
  - `commitSheetUpload(...)` → `({ ok: true; already?: true } & SheetsLanded) | { ok: false; error }`; deps gain `read(pathname) → Promise<Uint8Array | null>`.
  - `commitSheetUploadAction(...)` → `({ ok: true } & SheetsLanded) | { ok: false; error }`.
  - 4 MB route reply: `{ ok: true, sheetId, sheetIds, baseSheet?, note? }` (status 404 for gone, 502 for storage).
  - `attachPlanCandidate(...)` → `({ ok: true; name: string; already?: true } & SheetsLanded) | { ok: false; error }`.
  - `saveGridIntakeAction` → also `planSheetIds?: string[]` (Task 4 drops `planSheetId`).

- [ ] **Step 1: Write the failing tests and update the pins this task moves**

Append at the END of `scripts/test-review-and-spec.ts`:

```ts
/* ---------------- #319: one sheet per PDF page — every upload path ---------------- */
async function pagesAsSheets319UploadChecks(): Promise<void> {
  // In-database sheets only (data-URLs): this suite never writes to Blob.
  const prevBlob = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  try {
    const G = await import("@/lib/stores/grid-projects");
    const SS = await import("@/lib/design/grid-sheet-split-server");
    const S = await import("@/lib/design/grid-sheet-split");
    const C = await import("@/lib/design/grid-sheet-upload-server");
    const U = await import("@/lib/design/grid-sheet-upload");
    const DS = await import("@/db/doc-store");
    const { DEFAULT_OPTION_ID } = await import("@/lib/design/grid-options");
    const { decodeDataUrl } = await import("@/lib/grid-sheet-file");
    const sharp = (await import("sharp")).default;
    type Sheet = import("@/lib/stores/grid-projects").GridSheet;
    const J = (v: unknown) => JSON.stringify(v);
    const by = "Test Harness";
    const SVG = "data:image/svg+xml,<svg/>";
    const square = [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.1 }, { x: 0.4, y: 0.4 }, { x: 0.1, y: 0.4 }];
    const set = await pdf319Set();
    const setViews = await views319(set);
    const onePdf = await pagesPdf319(1);
    const manyPdf = await pagesPdf319(61);
    const encPdf = await encryptedPdf319();
    const png = new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 3, background: "#ffffff" } }).png().toBuffer());
    const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

    /** A design whose generated plan (the intake's base sheet) holds only a Space. */
    const designWithBase = async (label: string) => {
      const gp = await G.createProject({ name: `#319 ${label}`, customer: "Spec fixture", customerId: null, by });
      registerFixture("grid_projects", gp.id);
      const base = (await G.addSheet(gp.id, { name: "Generated base plan", mime: "image/svg+xml", dataUrl: SVG, by }))!;
      registerFixture("grid_sheets", base.id);
      await G.saveGridIntake(gp.id, { complete: true, measurementBased: true, venueName: "V", locationName: "L", address: "", notes: "", baseSheetId: base.id });
      await G.addSpace(gp.id, { sheetId: base.id, page: 1, name: "Stage", points: square, by });
      return { gp, base };
    };
    /** Register and read back sheets by id. */
    const sheetsOf = async (ids: readonly string[]) => {
      const out: Sheet[] = [];
      for (const id of ids) {
        registerFixture("grid_sheets", id);
        const s = await DS.getDoc<Sheet>("grid_sheets", id);
        if (s) out.push(s);
      }
      return out;
    };
    /** The 4 MB route's source: bytes in hand, stored whole as a data-URL when not split. */
    const bytesSource = (name: string, mime: string, bytes: Uint8Array) => ({
      name,
      mime,
      readBytes: async () => bytes,
      storeWhole: async () => ({ mime, dataUrl: `data:${mime};base64,${b64(bytes)}` }),
    });

    // 1. A 3-page PDF → three sheets, appended in page order, each one page shown as its source page.
    const d1 = await designWithBase("split append");
    const keep = (await G.addSheet(d1.gp.id, { name: "Existing.png", mime: "image/png", dataUrl: `data:image/png;base64,${b64(png)}`, by }))!;
    registerFixture("grid_sheets", keep.id);
    const r1 = await SS.storeUploadAsSheets(d1.gp.id, bytesSource("Set.pdf", "application/pdf", set), { by });
    const s1 = r1.ok ? await sheetsOf(r1.sheetIds) : [];
    const v1 = await Promise.all(s1.map((s) => views319(decodeDataUrl(s.dataUrl)!.bytes)));
    const p1 = (await G.getProject(d1.gp.id))!;
    ok(r1.ok && r1.sheetIds.length === 3 && r1.sheetId === r1.sheetIds[0] && J(p1.sheetIds) === J([keep.id, ...r1.sheetIds]),
      "#319 a 3-page PDF becomes three sheets, appended after the existing ones in page order");
    ok(J(s1.map((s) => s.name)) === J(["Set.pdf — p.1", "Set.pdf — p.2", "Set.pdf — p.3"]) &&
       s1.every((s, i) => s.mime === "application/pdf" && J(s.split) === J({ from: "Set.pdf", page: i + 1, pages: 3 }) && !s.adjust),
      "#319 split sheets are named '— p.n', stamped with where they came from, and are their own Adjust-sheet roots");
    ok(v1.length === 3 && v1.every((v) => v.length === 1) && J(v1.map((v) => v[0])) === J(setViews),
      "#319 each split sheet is one page that pdf.js shows exactly as the source page (inherited box + rotation included)");
    ok(r1.ok && r1.baseSheet === "removed" && !r1.note && !p1.sheetIds.includes(d1.base.id) && (p1.spaces || []).length === 0,
      "#319 the real plan retires the generated plan (Spaces only) and says so");

    // 2. FIRST position (the intake's plan view): the whole run goes in front, in order.
    const d2 = await designWithBase("split first");
    const later = (await G.addSheet(d2.gp.id, { name: "Later.png", mime: "image/png", dataUrl: `data:image/png;base64,${b64(png)}`, by }))!;
    registerFixture("grid_sheets", later.id);
    const r2 = await SS.storeUploadAsSheets(d2.gp.id, bytesSource("Set.pdf", "application/pdf", set), { by, first: true });
    if (r2.ok) await sheetsOf(r2.sheetIds);
    ok(r2.ok && J((await G.getProject(d2.gp.id))!.sheetIds) === J([...r2.sheetIds, later.id]), "#319 position first puts every split sheet in front, in page order");

    // 3. A 1-page PDF and an image: one sheet under their own name; an image is never read; both retire the generated plan.
    const d3 = await designWithBase("one page");
    const r3 = await SS.storeUploadAsSheets(d3.gp.id, bytesSource("Single.pdf", "application/pdf", onePdf), { by });
    let read4 = 0;
    const d4 = await designWithBase("image");
    const r4 = await SS.storeUploadAsSheets(d4.gp.id, { ...bytesSource("Plan.png", "image/png", png), readBytes: async () => { read4++; return png; } }, { by });
    const [s3] = r3.ok ? await sheetsOf(r3.sheetIds) : [];
    const [s4] = r4.ok ? await sheetsOf(r4.sheetIds) : [];
    ok(r3.ok && r3.sheetIds.length === 1 && s3?.name === "Single.pdf" && !s3.split && !r3.note && r4.ok && r4.sheetIds.length === 1 && s4?.name === "Plan.png" && read4 === 0,
      "#319 a 1-page PDF and an image stay one sheet under their own name (an image is never read for splitting)");
    ok(r3.ok && r3.baseSheet === "removed" && r4.ok && r4.baseSheet === "removed", "#319 an image (or a 1-page PDF) also retires the generated plan");

    // 4. Encrypted / over the cap / unreadable → one sheet, unchanged, with a note.
    const d5 = await G.createProject({ name: "#319 fallbacks", customer: "Spec fixture", customerId: null, by });
    registerFixture("grid_projects", d5.id);
    const r5 = await SS.storeUploadAsSheets(d5.id, bytesSource("Locked.pdf", "application/pdf", encPdf), { by });
    const r6 = await SS.storeUploadAsSheets(d5.id, bytesSource("Huge.pdf", "application/pdf", manyPdf), { by });
    const r7 = await SS.storeUploadAsSheets(d5.id, { ...bytesSource("Gone.pdf", "application/pdf", set), readBytes: async () => null }, { by });
    const [s5] = r5.ok ? await sheetsOf(r5.sheetIds) : [];
    const [s6] = r6.ok ? await sheetsOf(r6.sheetIds) : [];
    if (r7.ok) await sheetsOf(r7.sheetIds);
    ok(r5.ok && r5.sheetIds.length === 1 && r5.note === S.splitFallbackNote("encrypted") && s5?.name === "Locked.pdf" && decodeDataUrl(s5.dataUrl)!.bytes.length === encPdf.length,
      "#319 an encrypted PDF is kept as one sheet, unchanged, with a note (never refused)");
    ok(r6.ok && r6.sheetIds.length === 1 && r6.note === S.splitFallbackNote("too-many-pages", 61) && s6?.name === "Huge.pdf",
      "#319 a 61-page PDF is kept as one sheet with a note naming its page count");
    ok(r7.ok && r7.sheetIds.length === 1 && r7.note === S.splitFallbackNote("unreadable") && r5.ok && r5.baseSheet === undefined,
      "#319 a PDF whose bytes can't be read back is kept as one sheet; no generated plan → nothing to retire");

    // 5. A page that fails to store: the pages already written are deleted and the upload lands whole.
    const dropped: string[] = [];
    let calls = 0;
    const r8 = await SS.storeUploadAsSheets(d5.id, bytesSource("Flaky.pdf", "application/pdf", set), { by }, {
      storePage: async () => (++calls === 1 ? { mime: "application/pdf", dataUrl: "", blobPath: "grid-sheets/T319/p1.pdf" } : null),
      removeBlob: async (p: string) => { dropped.push(p); },
    });
    if (r8.ok) await sheetsOf(r8.sheetIds);
    ok(r8.ok && r8.sheetIds.length === 1 && r8.note === S.splitFallbackNote("failed") && J(dropped) === J(["grid-sheets/T319/p1.pdf"]),
      "#319 a page that fails to store rolls back the pages written and keeps the upload as one sheet");
    const r9 = await SS.storeUploadAsSheets(d5.id, { ...bytesSource("x.png", "image/png", png), storeWhole: async () => null }, { by });
    const r10 = await SS.storeUploadAsSheets("GRD-0", bytesSource("Set.pdf", "application/pdf", set), { by });
    ok(!r9.ok && r9.reason === "storage" && r9.error === S.GRID_SHEET_SPLIT_COPY.storage && !r10.ok && r10.reason === "gone",
      "#319 a storage failure is 'storage' (the route answers 502); an unknown design is 'gone'");

    // 6. Devices on the generated plan → kept; on the intake path the kept sentence and the split note become notices.
    const d7 = await designWithBase("kept");
    for (const x of [0.3, 0.6]) await G.addPlacement(d7.gp.id, { sheetId: d7.base.id, page: 1, x, y: 0.5, partId: "TEST-PART", optionId: DEFAULT_OPTION_ID, by });
    const r11 = await SS.storeUploadAsSheets(d7.gp.id, bytesSource("Huge.pdf", "application/pdf", manyPdf), { by, first: true, intakeNotices: true });
    if (r11.ok) await sheetsOf(r11.sheetIds);
    const n7 = ((await G.getProject(d7.gp.id))!.intake?.notices || []).map((n) => n.message);
    ok(r11.ok && J(r11.baseSheet) === J({ kept: 2, what: "devices" }) && (await G.getProject(d7.gp.id))!.sheetIds.includes(d7.base.id) &&
       n7.includes("Generated plan kept — it has 2 devices on it.") && n7.includes(S.splitFallbackNote("too-many-pages", 61)),
      "#319 a generated plan with devices stays; on the intake path the kept sentence and the split note are left as notices");
    const r12 = await SS.storeUploadAsSheets(d7.gp.id, bytesSource("Plan.png", "image/png", png), { by });
    if (r12.ok) await sheetsOf(r12.sheetIds);
    ok(r12.ok && ((await G.getProject(d7.gp.id))!.intake?.notices || []).length === n7.length, "#319 off the intake path no notice is added");

    // 7. The Blob broker commit: the original upload's blob is dropped after a split; a 1-page PDF / image / encrypted PDF keeps it.
    const key = "UP-0000000000000319";
    const pathOf = (projectId: string, n: string) => U.gridSheetBlobPath(projectId, key, n).replace(/(\.[a-z]+)$/, "-Sfx19$1");
    const removed: string[] = [];
    const deps = (bytes: Uint8Array) => ({
      head: async () => ({ bytes: bytes.subarray(0, U.GRID_SHEET_SNIFF_BYTES), size: bytes.length }),
      read: async () => bytes,
      remove: async (p: string) => { removed.push(p); },
    });
    const d8 = await designWithBase("broker");
    const c1 = await C.commitSheetUpload(d8.gp.id, { uploadKey: key, blobPath: pathOf(d8.gp.id, "set.pdf"), name: "Set.pdf" }, by, deps(set));
    const cs1 = c1.ok ? await sheetsOf(c1.sheetIds) : [];
    ok(c1.ok && c1.sheetIds.length === 3 && J(cs1.map((s) => s.name)) === J(["Set.pdf — p.1", "Set.pdf — p.2", "Set.pdf — p.3"]) &&
       cs1.every((s) => s.blobPath !== pathOf(d8.gp.id, "set.pdf")) && J(removed) === J([pathOf(d8.gp.id, "set.pdf")]) && c1.baseSheet === "removed",
      "#319 commit: a 3-page PDF lands as three sheets, the original upload's blob is deleted, and the generated plan is retired");
    const replay = await C.commitSheetUpload(d8.gp.id, { uploadKey: key, blobPath: pathOf(d8.gp.id, "set.pdf"), name: "Set.pdf" }, by, { ...deps(set), head: async () => null });
    ok(!replay.ok && replay.error === U.GRID_SHEET_UPLOAD_COPY.noArrival && (await G.getProject(d8.gp.id))!.sheetIds.length === 3,
      "#319 commit: a replay after a split fails its head read instead of splitting twice");
    const c2 = await C.commitSheetUpload(d8.gp.id, { uploadKey: key, blobPath: pathOf(d8.gp.id, "one.pdf"), name: "One.pdf" }, by, deps(onePdf));
    const c3 = await C.commitSheetUpload(d8.gp.id, { uploadKey: key, blobPath: pathOf(d8.gp.id, "plan.png"), name: "Plan.png" }, by,
      { ...deps(png), read: async () => { throw new Error("an image is never read"); } });
    const c4 = await C.commitSheetUpload(d8.gp.id, { uploadKey: key, blobPath: pathOf(d8.gp.id, "locked.pdf"), name: "Locked.pdf" }, by, deps(encPdf));
    const [cs2] = c2.ok ? await sheetsOf(c2.sheetIds) : [];
    const [cs3] = c3.ok ? await sheetsOf(c3.sheetIds) : [];
    const [cs4] = c4.ok ? await sheetsOf(c4.sheetIds) : [];
    ok(c2.ok && cs2?.blobPath === pathOf(d8.gp.id, "one.pdf") && cs2.name === "One.pdf" && c3.ok && !c3.note && cs3?.blobPath === pathOf(d8.gp.id, "plan.png") && cs3.mime === "image/png" &&
       c4.ok && c4.note === S.splitFallbackNote("encrypted") && cs4?.blobPath === pathOf(d8.gp.id, "locked.pdf") && removed.length === 1,
      "#319 commit: a 1-page PDF, an image and an encrypted PDF are recorded as uploaded (their blob kept)");

    // 8. A plan-view commit (FIRST): page 1 becomes the intake's plan; a retry returns it without splitting again.
    const d9 = await designWithBase("broker first");
    const uid = "00000000-0000-4000-8000-000000000319";
    const f1 = await C.commitSheetUpload(d9.gp.id, { uploadKey: key, blobPath: pathOf(d9.gp.id, "first.pdf"), name: "First.pdf", position: "first", planUploadId: uid }, by, deps(set));
    if (f1.ok) await sheetsOf(f1.sheetIds);
    const p9 = (await G.getProject(d9.gp.id))!;
    ok(f1.ok && f1.sheetIds.length === 3 && J(p9.sheetIds.slice(0, 3)) === J(f1.sheetIds) && p9.intake?.planSheetId === f1.sheetIds[0] && p9.intake?.planSource === `upload:${uid}`,
      "#319 commit: a plan-view PDF goes FIRST as its pages, and page 1 is recorded as the intake's plan");
    const f2 = await C.commitSheetUpload(d9.gp.id, { uploadKey: key, blobPath: pathOf(d9.gp.id, "first2.pdf"), name: "First.pdf", position: "first", planUploadId: uid }, by, deps(set));
    ok(f1.ok && f2.ok && f2.already === true && J(f2.sheetIds) === J([f1.sheetIds[0]]) && (await G.getProject(d9.gp.id))!.sheetIds.length === p9.sheetIds.length,
      "#319 commit: a retried plan-view upload returns the sheet that landed (no second split)");

    // 9. Wiring pins.
    const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
    const route = rd("src/app/api/grid-sheets/upload/route.ts");
    ok(route.includes("storeUploadAsSheets(") && !route.includes("putBlob(") && !route.includes("addSheet(") && route.includes("await recordIntakePlan(projectId, r.sheetIds[0], source);"),
      "#319 pin: the 4 MB route stores through storeUploadAsSheets (split + retire), never on its own");
    const pis = rd("src/lib/design/grid-plan-intake-server.ts");
    ok(pis.includes("storeUploadAsSheets(") && pis.includes("readBytes: () => readBlobCapped(pick.blobPath)") && !pis.includes("dropOriginal") && !pis.includes("addSheet("),
      "#319 pin: the on-file plan copy splits through storeUploadAsSheets and never deletes the customer's own file");
    const commit = rd("src/lib/design/grid-sheet-upload-server.ts");
    ok(commit.includes("dropOriginal: () => d.remove(blobPath)") && !commit.includes("addSheet("), "#319 pin: the broker commit drops its original blob only through a successful split");
    ok(rd("src/app/(app)/design/grid/[id]/actions.ts").includes("planSheetIds = attached.sheetIds;"), "#319 pin: the intake save hands back every sheet a copied plan became");
  } finally {
    if (prevBlob === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = prevBlob;
  }
}
```

Add to the chain after `.then(() => pagesAsSheets319StoreChecks())`:

```ts
  .then(() => pagesAsSheets319UploadChecks())
```

Update the `#318` commit test's fake Blob (around line 59909, inside `sheetUpload318Checks`) so its fixture PDF (`%PDF-1.7 fixture`, not a real PDF) is never read from the live store — replace:

```ts
  const deps = (bytes: Uint8Array, size: number) => ({ head: async () => ({ bytes, size }), remove: async (p: string) => { removed.push(p); } });
```

with:

```ts
  const deps = (bytes: Uint8Array, size: number) => ({ head: async () => ({ bytes, size }), read: async () => null, remove: async (p: string) => { removed.push(p); } });
```

Update the two `#314` pins (around lines 59332–59336). Replace:

```ts
  ok(route.includes("if (first && !isPlanUploadId(uploadId))") && route.includes("withPlanLock(projectId, async () => {") && route.indexOf("attachedPlanSheet(now.intake") < route.indexOf("storeSheet(projectId, name, mime, bytes, user.name, true)") &&
     route.includes("await recordIntakePlan(projectId, r, source);") && rd("src/lib/design/grid-plan-upload.ts").includes('body.append("planUploadId", uploadId);'),
```

with:

```ts
  ok(route.includes("if (first && !isPlanUploadId(uploadId))") && route.includes("withPlanLock(projectId, async () => {") && route.indexOf("attachedPlanSheet(now.intake") > 0 && route.indexOf("attachedPlanSheet(now.intake") < route.indexOf("await storeAsSheets(true)") &&
     route.includes("await recordIntakePlan(projectId, r.sheetIds[0], source);") && rd("src/lib/design/grid-plan-upload.ts").includes('body.append("planUploadId", uploadId);'),
```

and replace:

```ts
  ok(pis.includes("return withPlanLock(projectId, () => attachPlanCandidateLocked(projectId, candidateId, by));") && pis.indexOf("attachedPlanSheet(current.intake") < pis.indexOf("copyBlob(") && pis.includes("await recordIntakePlan(projectId, sheet.id, source);"),
```

with:

```ts
  ok(pis.includes("return withPlanLock(projectId, () => attachPlanCandidateLocked(projectId, candidateId, by));") && pis.indexOf("attachedPlanSheet(current.intake") < pis.indexOf("copyBlob(") && pis.includes("await recordIntakePlan(projectId, r.sheetIds[0], source);"),
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: an error naming `Cannot find module '@/lib/design/grid-sheet-split-server'` (exit code 1).

- [ ] **Step 3: Share the file reader and storer in `src/lib/design/sheet-adjust-server.ts`**

Replace:

```ts
type StoredFile = { mime: string; dataUrl: string; url?: string; blobPath?: string };
```

with:

```ts
/** A stored sheet file — exactly one of dataUrl / blobPath carries the bytes (#319 reuses it). */
export type StoredSheetFile = { mime: string; dataUrl: string; url?: string; blobPath?: string };
type StoredFile = StoredSheetFile;
```

Replace the whole `readSheetBytes` function with:

```ts
/** The whole root file — a local reader, not rack/submittal-server's readCapped, so the
 *  Grid editor's actions don't pull the rack submittal's import graph. */
async function readSheetBytes(sheet: GridSheet): Promise<Uint8Array | null> {
  if (!sheet.blobPath) return decodeDataUrl(sheet.dataUrl)?.bytes ?? null;
  return readBlobCapped(sheet.blobPath);
}

/** A private blob's whole file, or null when it is missing, unreadable or
 *  over `max` (#319 reads an upload back with it to split it into pages). */
export async function readBlobCapped(pathname: string, max = SHEET_ADJUST_READ_MAX_BYTES): Promise<Uint8Array | null> {
  try {
    const stream = await getBlobStream(pathname);
    if (!stream) return null;
    const reader = (stream as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.byteLength;
      if (n > max) {
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
```

And change `async function storeSheetFile(` to `export async function storeSheetFile(` (body unchanged).

- [ ] **Step 4: Create `src/lib/design/grid-sheet-split-server.ts`**

```ts
// SERVER ONLY — reads/writes sheet files and runs pdf-lib.
/**
 * #319 — the ONE step every sheet-creating upload path takes (the Blob
 * broker's commit, the 4 MB multipart route, the intake's copy of a plan on
 * file): store an upload as one or more Grid sheets at its position, then
 * retire the generated plan if nothing is drawn on it (retireBaseSheet).
 *
 * A PDF of 2–60 pages is read back whole and split into one-page PDFs
 * (sheet-split-bytes), each stored like any sheet (private Blob, or a
 * data-URL when Blob is off) as "<file> — p.<n>"; the caller's original is
 * then dropped (`dropOriginal` — the broker's own upload blob, never a
 * customer's file). Anything else — an image, a 1-page PDF, or a PDF that
 * can't be split (encrypted, unreadable, over 60 pages, too large, a page
 * that failed to store) — lands as ONE sheet exactly as before
 * (`storeWhole`), with a note saying why it wasn't split. An upload is never
 * refused for a split reason. `deps` exists for the spec harness.
 */
import { blobEnabled, deleteBlob } from "@/lib/blob";
import { addIntakeNotices, addSheets, retireBaseSheet, type NewSheetFile } from "@/lib/stores/grid-projects";
import { newNoticeId } from "./grid-plan-intake";
import { splitPdfPages } from "./sheet-split-bytes";
import { storeSheetFile, type StoredSheetFile } from "./sheet-adjust-server";
import {
  baseSheetKeptText,
  GRID_SHEET_SPLIT_COPY as COPY,
  GRID_SHEET_SPLIT_DATAURL_MAX_TOTAL_BYTES,
  GRID_SHEET_SPLIT_MAX_TOTAL_BYTES,
  landed,
  splitFallbackNote,
  splitSheetName,
  type BaseSheetOutcome,
  type SheetsLanded,
} from "./grid-sheet-split";

export type SheetSource = {
  /** The upload's display name ("Set.pdf"). */
  name: string;
  /** What the bytes really are (sniffed / verified by the caller). Only "application/pdf" is ever split. */
  mime: string;
  /** The whole file, to split a PDF. Null (or a throw) = unreadable → one sheet. Never called for a non-PDF. */
  readBytes: () => Promise<Uint8Array | null>;
  /** Store the upload as ONE sheet's file, unchanged; null = storage failed. */
  storeWhole: () => Promise<StoredSheetFile | null>;
  /** After a successful split only: drop the original upload (best effort). */
  dropOriginal?: () => Promise<void>;
};

export type StoreSheetsResult = ({ ok: true } & SheetsLanded) | { ok: false; reason: "storage" | "gone"; error: string };

type SplitStoreDeps = {
  storePage: (projectId: string, name: string, bytes: Uint8Array) => Promise<StoredSheetFile | null>;
  removeBlob: (pathname: string) => Promise<void>;
  blobOn: () => boolean;
};
const liveDeps: SplitStoreDeps = {
  storePage: async (projectId, name, bytes) => {
    const r = await storeSheetFile(projectId, name, bytes, "application/pdf");
    return r.ok ? r.file : null;
  },
  removeBlob: deleteBlob,
  blobOn: blobEnabled,
};

export async function storeUploadAsSheets(
  projectId: string,
  src: SheetSource,
  opts: { by: string; first?: boolean; intakeNotices?: boolean },
  deps: Partial<SplitStoreDeps> = {}
): Promise<StoreSheetsResult> {
  const d: SplitStoreDeps = { ...liveDeps, ...deps };
  let wrote: string[] = [];
  const dropWritten = async () => {
    for (const p of wrote) await d.removeBlob(p).catch(() => {});
    wrote = [];
  };
  let files: NewSheetFile[] | null = null;
  let note: string | null = null;
  if (src.mime === "application/pdf") {
    let bytes: Uint8Array | null = null;
    try {
      bytes = await src.readBytes();
    } catch {
      bytes = null;
    }
    const split = bytes
      ? await splitPdfPages(bytes, { maxTotalBytes: d.blobOn() ? GRID_SHEET_SPLIT_MAX_TOTAL_BYTES : GRID_SHEET_SPLIT_DATAURL_MAX_TOTAL_BYTES })
      : null;
    if (!split) note = splitFallbackNote("unreadable");
    else if (split.ok) {
      const pages = split.pages.length;
      const out: NewSheetFile[] = [];
      for (let i = 0; i < pages; i++) {
        const name = splitSheetName(src.name, i + 1, pages);
        const stored = await d.storePage(projectId, name, split.pages[i]).catch(() => null);
        if (!stored) break;
        if (stored.blobPath) wrote.push(stored.blobPath);
        out.push({ name, ...stored, split: { from: src.name, page: i + 1, pages } });
      }
      if (out.length === pages) files = out;
      else {
        await dropWritten();
        note = splitFallbackNote("failed");
      }
    } else if (split.reason !== "not-pdf" && split.reason !== "single") note = splitFallbackNote(split.reason, split.pageCount);
  }
  const didSplit = files !== null;
  if (!files) {
    const whole = await src.storeWhole();
    if (!whole) return { ok: false, reason: "storage", error: COPY.storage };
    files = [{ name: src.name, ...whole }];
  }
  const sheets = await addSheets(projectId, files, { by: opts.by, first: opts.first });
  if (!sheets) {
    await dropWritten();
    return { ok: false, reason: "gone", error: COPY.gone };
  }
  if (didSplit && src.dropOriginal) await src.dropOriginal().catch(() => {});
  let baseSheet: BaseSheetOutcome | null = null;
  try {
    baseSheet = await retireBaseSheet(projectId, opts.by);
  } catch (e) {
    // The plan is in; a failed retire never fails the upload (the generated plan just stays).
    console.error("[grid] retiring the generated plan failed:", e);
  }
  if (opts.intakeNotices) {
    const messages = [note, baseSheet && baseSheet !== "removed" ? baseSheetKeptText(baseSheet) : null].filter((m): m is string => !!m);
    if (messages.length) await addIntakeNotices(projectId, messages.map((message) => ({ id: newNoticeId(), message, at: Date.now() }))).catch(() => null);
  }
  return { ok: true, ...landed(sheets.map((s) => s.id), baseSheet, note) };
}
```

- [ ] **Step 5: Replace `src/lib/design/grid-sheet-upload-server.ts` with**

```ts
// SERVER ONLY.
/**
 * #318 — record a sheet the browser uploaded straight to Blob (the
 * Plans & risers order, package-files-server.ts): path scope → never a path a
 * sheet already holds → the head Blob really holds (size ≤ 25 MB, sniffed
 * type) → storeUploadAsSheets. The client's `blobPath` is untrusted
 * throughout; a refusal deletes the unrecorded blob. A plan-view upload
 * (`position: "first"`) runs under the design's plan lock with its upload id,
 * so a retry of one that landed returns that sheet (#314's rule).
 * #319: a multi-page PDF is read back and split into one sheet per page, and
 * the original upload's blob is then deleted (a replayed commit fails its head
 * read instead of splitting twice); a real plan retires the generated plan.
 * `deps` exists for the spec harness.
 */
import { deleteBlob, getBlobHead } from "@/lib/blob";
import { listDocsByField } from "@/db/doc-store";
import { baseName, cleanText, displayFileName, isUploadKey } from "@/lib/document-files";
import { getProject, recordIntakePlan, type GridSheet } from "@/lib/stores/grid-projects";
import { withPlanLock } from "@/lib/design/grid-plan-intake-server";
import { attachedPlanSheet, isPlanUploadId, planSourceKey } from "@/lib/design/grid-plan-intake";
import { GRID_SHEET_DIRECT_MAX_BYTES, GRID_SHEET_SNIFF_BYTES, GRID_SHEET_UPLOAD_COPY as COPY, gridSheetPathInScope, sniffSheetFile } from "./grid-sheet-upload";
import { readBlobCapped } from "./sheet-adjust-server";
import { storeUploadAsSheets } from "./grid-sheet-split-server";
import type { SheetsLanded } from "./grid-sheet-split";

type CommitDeps = {
  head: (pathname: string, max: number) => Promise<{ bytes: Uint8Array; size: number } | null>;
  remove: (pathname: string) => Promise<void>;
  /** #319: the whole uploaded file, to split a PDF (null = unreadable → one sheet). */
  read: (pathname: string) => Promise<Uint8Array | null>;
};
const liveDeps: CommitDeps = { head: getBlobHead, remove: deleteBlob, read: (p) => readBlobCapped(p) };

export type CommitSheetResult = ({ ok: true; already?: true } & SheetsLanded) | { ok: false; error: string };

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
  // displayFileName falls back to "file" for a blank name — check the cleaned
  // base name first so a nameless upload is called "Plan sheet" (#318).
  const name = cleanText(baseName(inp.name), 180) ? displayFileName(inp.name).slice(0, 120) : "Plan sheet";
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
      return { ok: true, sheetId: done, sheetIds: [done], already: true };
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
  const landed = await storeUploadAsSheets(
    projectId,
    {
      name,
      mime: type,
      readBytes: () => d.read(blobPath),
      // Not split: the uploaded blob IS the sheet's file (no `url` — provenance only, D692).
      storeWhole: async () => ({ mime: type, dataUrl: "", blobPath }),
      dropOriginal: () => d.remove(blobPath),
    },
    { by, first: !!source, intakeNotices: !!source }
  );
  if (!landed.ok) return refuse(landed.reason === "gone" ? COPY.gone : landed.error);
  if (source) await recordIntakePlan(projectId, landed.sheetIds[0], source);
  return landed;
}
```

- [ ] **Step 6: Replace `src/app/api/grid-sheets/upload/route.ts` with**

```ts
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { getProject, recordIntakePlan } from "@/lib/stores/grid-projects";
import { withPlanLock } from "@/lib/design/grid-plan-intake-server";
import { attachedPlanSheet, isPlanUploadId, planSourceKey } from "@/lib/design/grid-plan-intake";
import { storeSheetFile } from "@/lib/design/sheet-adjust-server";
import { storeUploadAsSheets, type StoreSheetsResult } from "@/lib/design/grid-sheet-split-server";
import { landed } from "@/lib/design/grid-sheet-split";
import { GRID_SHEET_MAX_BYTES, GRID_SHEET_MAX_LABEL, sheetMimeVerdict } from "@/lib/grid-sheet-file";

/**
 * Plan-sheet upload (#146, D173). Shape copied from
 * /api/vendor-quote-attachments/upload (#143) — multipart in,
 * NextResponse.json out.
 *
 * Why a route and not the server action it replaces: `addSheetAction` took the
 * sheet as a base64 data-URL inside its payload and advertised an 8 MB
 * ceiling, but next.config.ts caps a server-action body at 1200kb and base64
 * inflates by 4/3 — so the real limit was a ~900 kB file, and anything larger
 * had its whole request body rejected by Next BEFORE the action ran. The user
 * got an unhandled rejection rather than the action's careful error message.
 * Route handlers are not bound by that cap.
 *
 * Unlike the vendor-quote route this does the WHOLE job — bytes to storage and
 * the `grid_sheets` docs written here — and returns only the new sheet ids.
 * That is the deliberate difference (D173): a vendor quote hangs off an
 * estimate that may not be saved yet, so its `blobPath` has to round-trip
 * through the browser and be re-validated on the way back
 * (ownsVendorQuoteBlobPath). A plan sheet belongs to a project that already
 * exists, so the path never leaves the server and there is no untrusted
 * `blobPath` to guard: the sheet proxy (/api/grid-sheets/<id>) keeps reading a
 * value only this route wrote.
 *
 * #319: storing goes through storeUploadAsSheets — a multi-page PDF becomes one
 * sheet per page, and a real plan retires the generated plan — the same step
 * the Blob broker's commit and the intake's copy take.
 *
 * Auth is requireUser(), matching both the old action and the sibling GET
 * proxy — any designer may add a sheet to a design they can open.
 *
 * Route resolution note: this static `upload` segment sits beside the dynamic
 * `[id]` proxy. Next resolves static before dynamic, and sheet ids are minted
 * `gs-<hex>`, so the two can never collide.
 */

// One file in, then Blob writes — nowhere near this, but a slow uplink on a
// venue's wifi must not have the function expire while the body is arriving.
export const maxDuration = 60;

const tooBig = () =>
  `That file is larger than ${GRID_SHEET_MAX_LABEL}. Print the drawing to a smaller PDF (one sheet per file) and try again.`;

export async function POST(req: Request): Promise<NextResponse> {
  const user = await requireUser();

  /* Refuse on the declared length BEFORE req.formData() materializes the whole
     multipart body in memory (the #143 re-review lesson): the file.size check
     below limits what gets STORED, not what gets READ. A header can be absent
     or lie, so that check stays the authoritative one. */
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > GRID_SHEET_MAX_BYTES + 64 * 1024) {
    return NextResponse.json({ ok: false, error: tooBig() }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Expected a file upload." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "No file was attached." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ ok: false, error: "That file is empty." }, { status: 400 });
  }
  if (file.size > GRID_SHEET_MAX_BYTES) {
    return NextResponse.json({ ok: false, error: tooBig() }, { status: 413 });
  }

  const mime = file.type || "application/octet-stream";
  const verdict = sheetMimeVerdict(mime);
  if (verdict !== "ok") {
    return NextResponse.json(
      {
        ok: false,
        error:
          verdict === "svg"
            ? "SVG plan sheets aren't supported — export the drawing as a PDF or PNG instead."
            : "PDF or image files only — print DWGs to PDF first.",
      },
      { status: 415 }
    );
  }

  const projectId = String(form.get("projectId") || "");
  if (!projectId || projectId.includes("/") || projectId.length > 64) {
    return NextResponse.json({ ok: false, error: "Bad design id." }, { status: 400 });
  }
  if (!(await getProject(projectId))) {
    return NextResponse.json({ ok: false, error: "Design not found." }, { status: 404 });
  }

  const name = String(form.get("name") || file.name || "Plan sheet").slice(0, 120);
  const bytes = Buffer.from(await file.arrayBuffer());
  // #314: the Grid intake's plan view asks to go FIRST (the editor opens on
  // it, in front of the generated base sheet); every other upload appends.
  // It carries an upload id, so a retry of an upload that already landed
  // (the response was lost) returns that sheet instead of adding it twice.
  const first = String(form.get("position") || "") === "first";
  const uploadId = form.get("planUploadId");
  if (first && !isPlanUploadId(uploadId)) {
    return NextResponse.json({ ok: false, error: "Bad upload id." }, { status: 400 });
  }
  // Blob storage when the token exists (D116); an in-database data-URL
  // otherwise — the whole dev story (AGENTS.md: `npm run dev` needs no cloud).
  const storeAsSheets = (atFront: boolean) =>
    storeUploadAsSheets(
      projectId,
      {
        name,
        mime,
        readBytes: async () => new Uint8Array(bytes),
        storeWhole: async () => {
          const r = await storeSheetFile(projectId, name, bytes, mime);
          return r.ok ? r.file : null;
        },
      },
      { by: user.name, first: atFront, intakeNotices: atFront }
    );
  const reply = (r: StoreSheetsResult) =>
    r.ok
      ? NextResponse.json({ ok: true, ...landed(r.sheetIds, r.baseSheet, r.note) })
      : NextResponse.json({ ok: false, error: r.error }, { status: r.reason === "gone" ? 404 : 502 });
  if (first) {
    const source = planSourceKey("upload", uploadId as string);
    return withPlanLock(projectId, async () => {
      const now = await getProject(projectId);
      const done = now ? attachedPlanSheet(now.intake, now.sheetIds || [], source) : null;
      if (done) return NextResponse.json({ ok: true, sheetId: done, sheetIds: [done], already: true });
      const r = await storeAsSheets(true);
      if (r.ok) {
        await recordIntakePlan(projectId, r.sheetIds[0], source);
        revalidatePath(`/design/grid/${encodeURIComponent(projectId)}`);
      }
      return reply(r);
    });
  }
  const r = await storeAsSheets(false);
  if (r.ok) revalidatePath(`/design/grid/${encodeURIComponent(projectId)}`);
  return reply(r);
}
```

(The `#146` pins still hold: no `NextResponse.json({ … blobPath …})`, and the `content-length` pre-check is unchanged.)

- [ ] **Step 7: Route the on-file copy through it — `src/lib/design/grid-plan-intake-server.ts`**

Replace the import line:

```ts
import { addSheet, getProject, recordIntakePlan } from "@/lib/stores/grid-projects";
```

with:

```ts
import { getProject, recordIntakePlan } from "@/lib/stores/grid-projects";
import { readBlobCapped } from "./sheet-adjust-server";
import { storeUploadAsSheets } from "./grid-sheet-split-server";
import type { SheetsLanded } from "./grid-sheet-split";
```

Replace both `attachPlanCandidate` and `attachPlanCandidateLocked` (from the `/**\n * Copy one on-file plan into the design` comment to the end of the file) with:

```ts
/** #319: what a plan copy answers — every sheet it became (page 1 first). */
export type AttachPlanResult = ({ ok: true; name: string; already?: true } & SheetsLanded) | { ok: false; error: string };

/**
 * Copy one on-file plan into the design as its FIRST sheet(s) (calibration
 * stays manual). Re-derives the candidate list from the SAVED design, then
 * checks the source bytes (magic bytes, size) exactly like a Plans & risers
 * upload. Idempotent per source (#314 review): a retry after a copy that
 * landed — say the response was lost — returns the sheet it already made.
 * #319: a multi-page PDF is read and split into one sheet per page; anything
 * else is copied Blob to Blob as before. The source is the customer's own
 * file — it is never deleted.
 */
export async function attachPlanCandidate(projectId: string, candidateId: string, by: string): Promise<AttachPlanResult> {
  return withPlanLock(projectId, () => attachPlanCandidateLocked(projectId, candidateId, by));
}

async function attachPlanCandidateLocked(projectId: string, candidateId: string, by: string): Promise<AttachPlanResult> {
  const source = planSourceKey("copy", candidateId);
  const current = await getProject(projectId);
  if (!current) return { ok: false, error: "That design could not be found." };
  const done = attachedPlanSheet(current.intake, current.sheetIds || [], source);
  if (done) return { ok: true, sheetId: done, sheetIds: [done], name: "", already: true };
  if (!blobEnabled()) return { ok: false, error: GRID_PLAN_COPY.noStorage };
  const ctx = await planContextOfProject(projectId);
  if (!ctx) return { ok: false, error: "That design could not be found." };
  const pick = (await planCandidatesFor(ctx)).find((c) => c.id === candidateId);
  if (!pick) return { ok: false, error: GRID_PLAN_COPY.gone };
  try {
    const head = await getBlobHead(pick.blobPath, PACKAGE_FILE_SNIFF_BYTES);
    if (!head) return { ok: false, error: GRID_PLAN_COPY.gone };
    const verdict = planCopyVerdict(head.bytes, head.size);
    if (!verdict.ok) return verdict;
    const name = pick.name.slice(0, 120);
    const r = await storeUploadAsSheets(
      projectId,
      {
        name,
        mime: verdict.type,
        readBytes: () => readBlobCapped(pick.blobPath),
        storeWhole: async () => {
          const copied = await copyBlob(pick.blobPath, `${GRID_SHEET_BLOB_PREFIX}${projectId}/${safeName(pick.name)}`, verdict.type);
          return { mime: verdict.type, dataUrl: "", url: copied.url, blobPath: copied.pathname };
        },
      },
      { by, first: true, intakeNotices: true }
    );
    if (!r.ok) return { ok: false, error: r.reason === "gone" ? "That design could not be found." : GRID_PLAN_COPY.failed };
    await recordIntakePlan(projectId, r.sheetIds[0], source);
    return { ...r, name };
  } catch (e) {
    if (isBlobNotFound(e)) return { ok: false, error: GRID_PLAN_COPY.gone };
    console.error("[grid] plan copy failed:", e);
    return { ok: false, error: GRID_PLAN_COPY.failed };
  }
}
```

- [ ] **Step 8: Actions — `src/app/(app)/design/grid/[id]/actions.ts`**

8a. Add an import beside the other `@/lib/design/*` imports:

```ts
import { landed, type SheetsLanded } from "@/lib/design/grid-sheet-split";
```

8b. Replace `commitSheetUploadAction` (its doc comment stays; update it) with:

```ts
/** #318 (D692): record a sheet the browser uploaded straight to Blob (≤ 25 MB).
 *  Everything in `input` is untrusted — commitSheetUpload re-checks the path,
 *  the stored size and the bytes, and deletes a refused upload's blob.
 *  #319: answers every sheet the upload became, and what happened to the
 *  generated plan. */
export async function commitSheetUploadAction(
  projectId: string,
  input: { blobPath: string; uploadKey: string; name: string; position?: "first"; planUploadId?: string }
): Promise<({ ok: true } & SheetsLanded) | { ok: false; error: string }> {
  const user = await requireUser();
  const r = await commitSheetUpload(String(projectId || ""), input, user.name);
  if (!r.ok) return r;
  revalidatePath(editorPath(projectId));
  return { ok: true, ...landed(r.sheetIds, r.baseSheet, r.note) };
}
```

8c. In `saveGridIntakeAction`: change the return type's `planSheetId?: string }` to `planSheetId?: string; planSheetIds?: string[] }`; after `let planSheetId: string | undefined;` add `let planSheetIds: string[] | undefined;`; replace

```ts
    } else planSheetId = attached.sheetId;
```

with

```ts
    } else {
      planSheetId = attached.sheetId;
      planSheetIds = attached.sheetIds;
    }
```

and change the final return line's `...(planSheetId ? { planSheetId } : {}) };` to `...(planSheetId ? { planSheetId } : {}), ...(planSheetIds ? { planSheetIds } : {}) };`. (Task 4 removes `planSheetId`.)

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npm run test:specs 2>&1 | grep -E "#319|#318|#314|#146|FAIL|ALL PASSED|FAILED"`
Expected: every `#319`, `#318`, `#314` and `#146` line `PASS`; `ALL PASSED`.

- [ ] **Step 10: Typecheck and lint**

Run: `npx tsc --noEmit -p . 2>&1 | tail -3` → no output.
Run: `npx eslint src/lib/design/sheet-adjust-server.ts src/lib/design/grid-sheet-split-server.ts src/lib/design/grid-sheet-upload-server.ts src/app/api/grid-sheets/upload/route.ts src/lib/design/grid-plan-intake-server.ts "src/app/(app)/design/grid/[id]/actions.ts"` → no errors.

- [ ] **Step 11: Commit**

```bash
git add src/lib/design/sheet-adjust-server.ts src/lib/design/grid-sheet-split-server.ts src/lib/design/grid-sheet-upload-server.ts src/app/api/grid-sheets/upload/route.ts src/lib/design/grid-plan-intake-server.ts "src/app/(app)/design/grid/[id]/actions.ts" scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(grid): #319 every upload path splits PDFs into sheets and retires the generated plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Client — result shapes, the `+` tab note, and the Adjust queue

**Files:**
- Modify: `src/lib/design/grid-plan-upload.ts` (`postSheetMultipart`)
- Modify: `src/app/(app)/design/grid/[id]/sheet-upload.ts` (result type)
- Modify: `src/app/(app)/design/grid/[id]/use-grid-editor.ts`
- Modify: `src/app/(app)/design/grid/[id]/workspace/sheet-adjust-dialog.tsx`
- Modify: `src/app/(app)/design/grid/[id]/editor.tsx`
- Modify: `src/app/(app)/design/grid/[id]/page.tsx`
- Modify: `src/app/(app)/design/grid/[id]/grid-intake.tsx`
- Modify: `src/app/(app)/design/grid/[id]/workspace/intake-notices.tsx`
- Modify: `src/app/(app)/design/grid/[id]/actions.ts` (drop `planSheetId`)
- Test: `scripts/test-review-and-spec.ts` (one new function + chain entry; four `#318` pins)

**Interfaces:**
- Consumes: Task 1 (`SheetUploadResult`, `parseSheetsLanded`, `uploadNote`, `parseAdjustParam`, `adjustQueueStep`); Task 3 (`commitSheetUploadAction` / route / `saveGridIntakeAction.planSheetIds`).
- Produces:
  - `postSheetMultipart(projectId, file, uploadId?): Promise<SheetUploadResult>`; `uploadGridSheet(...)`: `Promise<SheetUploadResult>` (re-exported type).
  - Hook: prop `adjustSheetIds?: string[] | null` (replaces `adjustSheetId`); `adjusting: { sheetId; afterUpload; queue?: string[] }`; `openAdjust(sheetId: string, afterUpload = false, queue?: readonly string[])`; new returns `adjustQueue: { index: number; total: number } | null`, `skipRestAdjust: () => void`.
  - Dialog props `queue?: { index: number; total: number } | null`, `onSkipRest?: () => void`.
  - `saveGridIntakeAction` returns `planSheetIds?: string[]` only.

- [ ] **Step 1: Write the failing pins and update the four `#318` pins**

Append at the END of `scripts/test-review-and-spec.ts`:

```ts
/* ---------------- #319: client wiring pins (result shapes + the Adjust queue) ---------------- */
async function pagesAsSheets319UiPins(): Promise<void> {
  const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const hook = rd("src/app/(app)/design/grid/[id]/use-grid-editor.ts");
  ok(hook.includes("openAdjust(r.sheetId, true, r.sheetIds);") && hook.includes("noteAction(uploadNote(file.name, r));"),
    "#319 pin: the + tab notes how many sheets landed (and the generated plan) and walks every new sheet in Adjust sheet");
  ok(hook.includes("const nextId = adjustQueueStep(adjusting?.queue, adjustSwap.from, sheets.map((s) => s.id)).next;") &&
     hook.includes("const closeAdjust = useCallback(() => closeAdjustWith(false), [closeAdjustWith]);") &&
     hook.includes("const skipRestAdjust = useCallback(() => closeAdjustWith(true), [closeAdjustWith]);") &&
     hook.includes("adjustSheetIds?: string[] | null;") && !hook.includes("adjustSheetId?:") && !hook.includes("blobPath"),
    "#319 pin: Done and Skip move to the next sheet of a multi-sheet upload; Skip the rest ends the walk; ?adjust= is a list");
  const dlg = rd("src/app/(app)/design/grid/[id]/workspace/sheet-adjust-dialog.tsx");
  ok(dlg.includes("Sheet {queue.index + 1} of {queue.total}") && dlg.includes("Skip the rest") && dlg.includes('{afterUpload ? "Skip" : "Cancel"}') && dlg.includes("onSkipRest?: () => void;"),
    "#319 pin: the dialog shows 'Sheet n of N' and offers Skip the rest");
  const ed = rd("src/app/(app)/design/grid/[id]/editor.tsx");
  ok(ed.includes("queue={ed.adjustQueue}") && ed.includes("onSkipRest={ed.skipRestAdjust}"), "#319 pin: the editor hands the queue to the dialog");
  ok(rd("src/app/(app)/design/grid/[id]/page.tsx").includes("adjustSheetIds={parseAdjustParam(requestedAdjust, project.sheetIds || [])}"),
    "#319 pin: the page passes ?adjust= as a list of listed sheet ids");
  const gi = rd("src/app/(app)/design/grid/[id]/grid-intake.tsx");
  ok(gi.includes("let adjustIds = saved.planSheetIds ?? [];") && gi.includes("else adjustIds = up.sheetIds;") && gi.includes('?adjust=${adjustIds.map(encodeURIComponent).join(",")}'),
    "#319 pin: the intake finishes by queueing every sheet its plan view became");
  const banner = rd("src/app/(app)/design/grid/[id]/workspace/intake-notices.tsx");
  ok(banner.includes("openAdjust(up.sheetId, true, up.sheetIds);") && banner.includes("noteAction(uploadNote(file.name, up));"),
    "#319 pin: the banner's re-upload queues every new sheet and notes the result");
  ok(rd("src/lib/design/grid-plan-upload.ts").includes("const landedSheets = parseSheetsLanded(r);") &&
     rd("src/app/(app)/design/grid/[id]/sheet-upload.ts").includes('import type { SheetUploadResult } from "@/lib/design/grid-sheet-split";'),
    "#319 pin: both upload paths answer one result shape (sheetIds + baseSheet + note)");
  const acts = rd("src/app/(app)/design/grid/[id]/actions.ts");
  ok(!acts.includes("planSheetId?: string") && acts.includes("planSheetIds?: string[]"), "#319 pin: the intake save answers planSheetIds only");
}
```

Add to the chain after `.then(() => pagesAsSheets319UploadChecks())`:

```ts
  .then(() => pagesAsSheets319UiPins())
```

Update four `#318` pins:

(a) around line 59985 (`sheetAdjust318UiPins`), replace:

```ts
  ok(hook.includes("openAdjust(r.sheetId, true);") && /if \(requestedAdjust && requestedAdjust !== adjustApplied && sheets\.some\(\(s\) => s\.id === requestedAdjust\)\) \{\s*setAdjustApplied\(requestedAdjust\);/.test(hook) &&
```

with:

```ts
  ok(hook.includes("openAdjust(r.sheetId, true, r.sheetIds);") && /if \(requestedIds && requestedAdjust && requestedAdjust !== adjustApplied && sheets\.some\(\(s\) => s\.id === requestedIds\[0\]\)\) \{\s*setAdjustApplied\(requestedAdjust\);/.test(hook) &&
```

(b) around line 59991, replace:

```ts
  ok(page.includes("adjustSheetId={requestedAdjust && (project.sheetIds || []).includes(requestedAdjust) ? requestedAdjust : null}") && page.includes("base: isBaseSheet(s, project.intake),") && page.includes("adjust: s.adjust ?? null,"),
```

with:

```ts
  ok(page.includes("adjustSheetIds={parseAdjustParam(requestedAdjust, project.sheetIds || [])}") && page.includes("base: isBaseSheet(s, project.intake),") && page.includes("adjust: s.adjust ?? null,"),
```

(c) around line 59994, replace:

```ts
  ok(gi.includes("if (adjustId) router.replace(`/design/grid/${encodeURIComponent(projectId)}?adjust=${encodeURIComponent(adjustId)}`);") && gi.includes("let adjustId = saved.planSheetId ?? null;"),
```

with:

```ts
  ok(gi.includes('if (adjustIds.length) router.replace(`/design/grid/${encodeURIComponent(projectId)}?adjust=${adjustIds.map(encodeURIComponent).join(",")}`);') && gi.includes("let adjustIds = saved.planSheetIds ?? [];"),
```

(d) around line 60019 (`sheetAdjust318DialogGuardPins`), replace:

```ts
     /const openAdjust = useCallback\(\(sheetId: string, afterUpload = false\) => \{[\s\S]{0,120}setSelectedIds\(\[\]\);/.test(hook),
```

with:

```ts
     /const openAdjust = useCallback\(\(sheetId: string, afterUpload = false, queue\?: readonly string\[\]\) => \{[\s\S]{0,120}setSelectedIds\(\[\]\);/.test(hook),
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:specs 2>&1 | grep -E "#319 pin|#318 pin|#318 fix|FAILED" | grep -E "FAIL"`
Expected: the new `#319 pin` lines and the four updated `#318` lines print `FAIL`; the run ends `N FAILED`.

- [ ] **Step 3: `src/lib/design/grid-plan-upload.ts` — one result shape**

Add to the imports:

```ts
import { parseSheetsLanded, type SheetUploadResult } from "@/lib/design/grid-sheet-split";
```

Replace `postSheetMultipart` with:

```ts
/** The 4 MB multipart route (no Blob). `uploadId` = a plan-view upload: FIRST position, idempotent.
 *  #319: answers every sheet the upload became (a multi-page PDF splits) and what happened to the generated plan. */
export async function postSheetMultipart(projectId: string, file: File, uploadId?: string): Promise<SheetUploadResult> {
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
    const r = (await res.json()) as unknown;
    const landedSheets = parseSheetsLanded(r);
    if (landedSheets) return { ok: true, ...landedSheets };
    const error = (r as { error?: unknown } | null)?.error;
    return { ok: false, error: typeof error === "string" && error ? error : "That plan could not be uploaded." };
  } catch {
    // A dropped connection or a non-JSON reply (a proxy's own 413 page).
    return { ok: false, error: "That plan could not be uploaded. Check your connection and try again." };
  }
}
```

- [ ] **Step 4: `src/app/(app)/design/grid/[id]/sheet-upload.ts` — the shared type**

Replace:

```ts
export type SheetUploadResult = { ok: true; sheetId: string } | { ok: false; error: string };
```

with:

```ts
import type { SheetUploadResult } from "@/lib/design/grid-sheet-split";
/** #319: `sheetIds` = every sheet the upload became (a multi-page PDF splits), `sheetId` = the first. */
export type { SheetUploadResult };
```

(Move the `import type` line up beside the file's other imports if eslint's `import/first` complains; the `export type { … }` stays where the old type was.)

- [ ] **Step 5: `use-grid-editor.ts` — prop, queue, upload note**

5a. Imports — after `import { uploadGridSheet } from "./sheet-upload";` add:

```ts
import { adjustQueueStep, uploadNote } from "@/lib/design/grid-sheet-split";
```

5b. Props — replace:

```ts
  /** #318: `?adjust=<sheetId>` — the intake's plan view, opened in Adjust sheet once it is listed. */
  adjustSheetId?: string | null;
```

with:

```ts
  /** #318/#319: `?adjust=<id>,<id>,…` — the sheets the intake's plan view became, walked in Adjust sheet once the first is listed. */
  adjustSheetIds?: string[] | null;
```

5c. Replace the block from `  const [adjusting, setAdjusting] = useState<{ sheetId: string; afterUpload: boolean } | null>(null);` through the end of `const openAdjust = useCallback(…, []);` with:

```ts
  /** #319: `queue` = every sheet one upload made (≥ 2, in order) — Adjust sheet walks them one at a time. */
  const [adjusting, setAdjusting] = useState<{ sheetId: string; afterUpload: boolean; queue?: string[] } | null>(null);
  const requestedIds = props.adjustSheetIds?.length ? props.adjustSheetIds : null;
  /** The request as one string — a fresh array arrives every render. */
  const requestedAdjust = requestedIds ? requestedIds.join(",") : null;
  const [adjustApplied, setAdjustApplied] = useState<string | null>(null);
  if (requestedIds && requestedAdjust && requestedAdjust !== adjustApplied && sheets.some((s) => s.id === requestedIds[0])) {
    setAdjustApplied(requestedAdjust);
    setAdjusting({ sheetId: requestedIds[0], afterUpload: true, ...(requestedIds.length > 1 ? { queue: requestedIds } : {}) });
    setSelectedIds([]);
    setActiveSheetId(requestedIds[0]);
    setPage(1);
  }
  // The swap has landed (the new sheet is listed — or the old one is gone,
  // whatever the refresh brought): close the dialog on the new sheet — or,
  // #319, in a multi-sheet upload, open the next one.
  if (adjustSwap && (sheets.some((s) => s.id === adjustSwap.to) || !sheets.some((s) => s.id === adjustSwap.from))) {
    setAdjustSwap(null);
    const nextId = adjustQueueStep(adjusting?.queue, adjustSwap.from, sheets.map((s) => s.id)).next;
    if (adjusting?.queue && nextId) {
      setAdjusting({ sheetId: nextId, afterUpload: true, queue: adjusting.queue });
      setActiveSheetId(nextId);
      setPage(1);
    } else setAdjusting(null);
  }
  const openAdjust = useCallback((sheetId: string, afterUpload = false, queue?: readonly string[]) => {
    // Defence in depth: nothing stays selected behind the dialog.
    setSelectedIds([]);
    setAdjusting({ sheetId, afterUpload, ...(queue && queue.length > 1 ? { queue: [...queue] } : {}) });
  }, []);
```

5d. Right after `const adjustAfterUpload = adjusting?.afterUpload ?? false;` add:

```ts
  /** #319: this sheet's place in a multi-sheet upload's walk ("Sheet 2 of 5"); null = a single sheet. */
  const adjustQueue = adjusting?.queue ? adjustQueueStep(adjusting.queue, adjusting.sheetId, []).position : null;
```

5e. In `async function upload(file: File)`, replace:

```ts
    noteAction(`Uploaded ${file.name}`);
    openAdjust(r.sheetId, true);
```

with:

```ts
    noteAction(uploadNote(file.name, r));
    openAdjust(r.sheetId, true, r.sheetIds);
```

5f. Replace the whole `closeAdjust` (its comment and `useCallback`) with:

```ts
  /** #318: Cancel / Skip — the sheet stays as it is. Skip after an upload opens that sheet's plan.
   *  #319: in a multi-sheet upload, Skip (Escape, or Done with nothing changed) opens the next
   *  sheet still listed; Skip the rest (`rest`) ends the walk on this one. */
  const closeAdjustWith = useCallback(
    (rest: boolean) => {
      const nextId = rest ? null : adjustQueueStep(adjusting?.queue, adjusting?.sheetId ?? "", sheets.map((s) => s.id)).next;
      if (adjusting?.queue && nextId) {
        setAdjusting({ sheetId: nextId, afterUpload: true, queue: adjusting.queue });
        switchSheet(nextId);
        return;
      }
      if (adjusting?.afterUpload && adjusting.sheetId !== sheet?.id && sheets.some((s) => s.id === adjusting.sheetId)) switchSheet(adjusting.sheetId);
      setAdjusting(null);
      dropAdjustParam();
    },
    [adjusting, sheet?.id, sheets, switchSheet, dropAdjustParam]
  );
  const closeAdjust = useCallback(() => closeAdjustWith(false), [closeAdjustWith]);
  const skipRestAdjust = useCallback(() => closeAdjustWith(true), [closeAdjustWith]);
```

(`dropAdjustParam` keeps `requestedAdjust` — now the joined string — as its dependency; its body is unchanged.)

5g. In the hook's return object, after `adjustAfterUpload,` add `adjustQueue,` and after `closeAdjust,` add `skipRestAdjust,`.

- [ ] **Step 6: The dialog — `workspace/sheet-adjust-dialog.tsx`**

6a. Destructuring — replace:

```tsx
  afterUpload,
  onCancel,
  onDone,
}: {
```

with:

```tsx
  afterUpload,
  queue = null,
  onCancel,
  onDone,
  onSkipRest,
}: {
```

6b. Prop types — replace:

```tsx
  /** Opened right after an upload: Cancel reads "Skip". */
  afterUpload: boolean;
  onCancel: () => void;
  onDone: (newSheetId: string) => void;
}) {
```

with:

```tsx
  /** Opened right after an upload: Cancel reads "Skip". */
  afterUpload: boolean;
  /** #319: this sheet's place in a multi-sheet upload ("Sheet 2 of 5"); null = a single sheet. */
  queue?: { index: number; total: number } | null;
  onCancel: () => void;
  onDone: (newSheetId: string) => void;
  /** #319: Skip the rest — end the walk on this sheet. */
  onSkipRest?: () => void;
}) {
```

6c. Header — replace:

```tsx
        <span style={{ fontSize: 12, color: "#aeb3bc" }}>Crop to the plan and turn it upright, then calibrate.</span>
```

with:

```tsx
        {queue && <span style={{ fontSize: 12.5, fontWeight: 600, color: "#e6e8ec", whiteSpace: "nowrap" }}>Sheet {queue.index + 1} of {queue.total}</span>}
        <span style={{ fontSize: 12, color: "#aeb3bc" }}>Crop to the plan and turn it upright, then calibrate.</span>
```

6d. Buttons — replace:

```tsx
        <button type="button" style={dim(BTN, saving)} disabled={saving} onClick={onCancel}>{afterUpload ? "Skip" : "Cancel"}</button>
```

with:

```tsx
        {queue && onSkipRest && queue.index < queue.total - 1 && (
          <button type="button" style={dim(BTN, saving)} disabled={saving} onClick={() => onSkipRest()} title="Leave this and the remaining sheets as they are">
            Skip the rest
          </button>
        )}
        <button type="button" style={dim(BTN, saving)} disabled={saving} onClick={onCancel}>{afterUpload ? "Skip" : "Cancel"}</button>
```

- [ ] **Step 7: `editor.tsx`, `page.tsx`, the intake, the banner, the action**

7a. `editor.tsx` — replace:

```tsx
          afterUpload={ed.adjustAfterUpload}
          onCancel={ed.closeAdjust}
          onDone={ed.finishAdjust}
```

with:

```tsx
          afterUpload={ed.adjustAfterUpload}
          queue={ed.adjustQueue}
          onCancel={ed.closeAdjust}
          onDone={ed.finishAdjust}
          onSkipRest={ed.skipRestAdjust}
```

7b. `page.tsx` — add the import `import { parseAdjustParam } from "@/lib/design/grid-sheet-split";` beside `import { isBaseSheet } from "@/lib/design/sheet-adjust";`, and replace:

```tsx
      adjustSheetId={requestedAdjust && (project.sheetIds || []).includes(requestedAdjust) ? requestedAdjust : null}
```

with:

```tsx
      adjustSheetIds={parseAdjustParam(requestedAdjust, project.sheetIds || [])}
```

7c. `grid-intake.tsx` — inside `save`, replace:

```tsx
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

with:

```tsx
      // #318/#319: the plan view (copied above, or uploaded here) opens in Adjust sheet —
      // every sheet it became (a multi-page PDF splits), walked in order.
      let adjustIds = saved.planSheetIds ?? [];
      if (planFile && planUploadId) {
        const up = await uploadGridSheet(projectId, planFile, { blobUploads, planUploadId });
        if (!up.ok) await notePlanUploadFailedAction(projectId, up.error).catch(() => null);
        else adjustIds = up.sheetIds;
      }
      if (adjustIds.length) router.replace(`/design/grid/${encodeURIComponent(projectId)}?adjust=${adjustIds.map(encodeURIComponent).join(",")}`);
      else router.refresh();
```

(The `#314` "no `set…(` after the save" pin still holds — there is none.)

7d. `workspace/intake-notices.tsx` — add the import `import { uploadNote } from "@/lib/design/grid-sheet-split";`; replace:

```tsx
  const { intakeNotices, project, router, blobUploads, openAdjust } = ed;
```

with:

```tsx
  const { intakeNotices, project, router, blobUploads, openAdjust, noteAction } = ed;
```

and replace:

```tsx
      if (!up.ok) return up;
      openAdjust(up.sheetId, true);
```

with:

```tsx
      if (!up.ok) return up;
      noteAction(uploadNote(file.name, up));
      openAdjust(up.sheetId, true, up.sheetIds);
```

7e. `actions.ts` — in `saveGridIntakeAction` drop `planSheetId`: the return type's `planSheetId?: string; planSheetIds?: string[] }` becomes `planSheetIds?: string[] }`; delete `let planSheetId: string | undefined;`; replace

```ts
    } else {
      planSheetId = attached.sheetId;
      planSheetIds = attached.sheetIds;
    }
```

with

```ts
    } else planSheetIds = attached.sheetIds;
```

and change the final return's `...(planSheetId ? { planSheetId } : {}), ...(planSheetIds ? { planSheetIds } : {}) };` to `...(planSheetIds ? { planSheetIds } : {}) };`.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm run test:specs 2>&1 | grep -E "#319|#318|#314|#146|FAIL|ALL PASSED|FAILED"`
Expected: all `PASS` (including `#146 the editor uploads through the route and never names a stored path`); `ALL PASSED`.

- [ ] **Step 9: Typecheck and lint**

Run: `npx tsc --noEmit -p . 2>&1 | tail -3` → no output.
Run: `npx eslint src/lib/design/grid-plan-upload.ts "src/app/(app)/design/grid/[id]/sheet-upload.ts" "src/app/(app)/design/grid/[id]/use-grid-editor.ts" "src/app/(app)/design/grid/[id]/workspace/sheet-adjust-dialog.tsx" "src/app/(app)/design/grid/[id]/editor.tsx" "src/app/(app)/design/grid/[id]/page.tsx" "src/app/(app)/design/grid/[id]/grid-intake.tsx" "src/app/(app)/design/grid/[id]/workspace/intake-notices.tsx" "src/app/(app)/design/grid/[id]/actions.ts"` → no errors.

- [ ] **Step 10: Commit**

```bash
git add src/lib/design/grid-plan-upload.ts "src/app/(app)/design/grid/[id]/sheet-upload.ts" "src/app/(app)/design/grid/[id]/use-grid-editor.ts" "src/app/(app)/design/grid/[id]/workspace/sheet-adjust-dialog.tsx" "src/app/(app)/design/grid/[id]/editor.tsx" "src/app/(app)/design/grid/[id]/page.tsx" "src/app/(app)/design/grid/[id]/grid-intake.tsx" "src/app/(app)/design/grid/[id]/workspace/intake-notices.tsx" "src/app/(app)/design/grid/[id]/actions.ts" scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(grid): #319 Adjust sheet walks a multi-sheet upload; uploads report sheets + generated plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Docs, full gates, build, and a browser check

**Files:**
- Modify: `DECISIONS.md` (append), `PUNCHLIST.md` (after `## 318.`), `AGENTS.md` (item 38, after the `#318` follow-up)

**Interfaces:**
- Consumes: everything above. Produces: nothing new in code.

- [ ] **Step 1: Pick the decision numbers**

Run: `git fetch -q origin && git log origin/main --oneline -3 && grep -n "^## D[0-9]" DECISIONS.md | tail -1` — #318 used D692–D694, so expect `## D694.` and use D695, D696, D697. If main has landed more (another session), merge it forward first, then shift all three numbers — and the `D696` reference in the `retireBaseSheet` doc comment in `src/lib/stores/grid-projects.ts` — to the next free ones.

- [ ] **Step 2: Append to `DECISIONS.md`**

```markdown

## D695. A multi-page PDF becomes one Grid sheet per page (#319, 2026-10-09)

Jeff: "When uploads have multiple pages they should be treated as different sheets in the grid." Every path that makes a
sheet from an uploaded or copied file — the `+` tab (Blob broker commit and the 4 MB route), the intake's plan view
(dropped, or copied from file), the notices banner's re-upload — calls one server step, `storeUploadAsSheets`
(`src/lib/design/grid-sheet-split-server.ts`). A PDF of 2–60 pages is split with pdf-lib `copyPages` (which carries each
page's own and inherited MediaBox / CropBox / Rotate, checked against pdf.js) into one-page sheets named
`<file> — p.<n>`, consecutive in page order at the upload's position (appended, or first for the plan view), each
stamped `split: { from, page, pages }` and its own root for Adjust sheet. The broker's original upload blob is deleted
after a split (a replayed commit fails its head read instead of splitting twice); a customer's on-file document is never
deleted — the copy path reads it (≤ 30 MB) and stores new files. An image, a 1-page PDF, or a PDF that can't be split
lands as ONE sheet exactly as before, with a note: encrypted, unreadable, more than 60 pages, split output over 100 MB
(24 MB without Blob — pdf-lib copies shared resources into every page), or a page that failed to store (the pages
already written are deleted). An upload is never refused for a split reason. Existing multi-page sheets are untouched.

## D696. A real plan retires the generated plan (#319, 2026-10-09)

Jeff picked option A: "When a PDF is uploaded it should remove the autogenerated plan set." After any real plan (PDF or
image) lands through the paths in D695, `retireBaseSheet` removes the sheet named by `intake.baseSheetId` exactly like
Delete sheet (#317, D691) when no placement or route on any option is on it: its Spaces go after one automatic revision
"Auto-saved before removing the generated plan", riser boxes pruned; checked before and again inside the patch. With
devices on it (counted as placement records), or failing that wires (route records), it stays and the upload says
`Generated plan kept — it has N devices on it.` `intake.baseSheetId` is never cleared — Auto fill keys off it and already
names a missing base sheet. `removeSheet` and the retire share one private drop helper (`dropSheetInPatch`).

## D697. Upload results name every sheet; Adjust sheet walks them (#319, 2026-10-09)

The commit, the 4 MB route and the plan copy answer `{ sheetId, sheetIds, baseSheet?: "removed" | { kept, what },
note? }` (`sheetId` = the first, so single-sheet callers are unchanged). The `+` tab notes "Uploaded X as N sheets ·
removed the generated plan" (or the kept sentence, or why a PDF wasn't split) in the status bar; the intake-position
paths (the plan view, its copy, the banner's re-upload) leave the kept sentence and any split note as intake notices,
because the intake swaps into the editor before anything it holds is seen. After a multi-sheet upload Adjust sheet
walks the new sheets in order — "Sheet 2 of 5", Done or Skip (Escape, or Done with nothing changed) opens the next,
**Skip the rest** stops — and the editor stays on the sheet the dialog was on. The intake hands the walk over as
`?adjust=<id>,<id>,…` (listed ids only, ≤ 60).
```

- [ ] **Step 3: Add `## 319.` to `PUNCHLIST.md`**

Insert right after the whole `## 318.` entry (before the next `## ` heading, or at the end of the file if 318 is last):

```markdown

## 319. One Grid sheet per PDF page; a real plan retires the generated plan — DONE 2026-10-09 (D695–D697)

Jeff: "When uploads have multiple pages they should be treated as different sheets in the grid." and "When a PDF is
uploaded it should remove the autogenerated plan set." (option A).

- **Split:** every sheet upload path (`+` tab broker + 4 MB route, intake plan view dropped or copied, notices
  re-upload) calls `storeUploadAsSheets` (`src/lib/design/grid-sheet-split-server.ts`); `sheet-split-bytes.ts` splits a
  2–60-page PDF into one-page PDFs named `<file> — p.<n>`, in order, at the upload's position. Images, 1-page PDFs and
  PDFs that can't be split (encrypted, unreadable, > 60 pages, too large) land as one sheet with a note.
- **Retire:** `retireBaseSheet` (`grid-projects.ts`, sharing `removeSheet`'s drop) removes the generated plan when no
  device or wire is on it — Spaces go after an automatic revision; otherwise "Generated plan kept — it has N devices on it."
- **UI:** results carry `sheetIds` + `baseSheet` + `note`; the `+` tab notes them; the intake paths leave notices; Adjust
  sheet walks a multi-sheet upload ("Sheet 2 of 5", Skip the rest). Pure rules in `src/lib/design/grid-sheet-split.ts`.
- Spec harness: `#319` assertions (pure rules, split vs pdf.js incl. inherited boxes/rotation, retire + addSheets,
  every upload path incl. the broker's original-blob delete and the fallbacks, wiring pins); four `#318` pins, two `#314`
  pins and the `#318` commit test's fake Blob updated.
- Jeff-gated: upload a real multi-page architect's set (> 4 MB) on a preview deploy with Blob on — the broker split, the
  original blob gone from the store, the timing of a large set; check a real Auto design keeps its generated plan.
```

- [ ] **Step 4: Add the AGENTS.md follow-up**

In `AGENTS.md`, item 38, right after the line `    Crop & rotate…. Punch item #318.` add:

```markdown
    ✅ Follow-up (#319, D695–D697): a multi-page PDF uploads as one sheet per
    page (`<file> — p.<n>`, up to 60; `grid-sheet-split*.ts`), Adjust sheet
    walks them ("Sheet 2 of 5", Skip the rest), and a real plan removes the
    generated plan when nothing is drawn on it. Punch item #319.
```

- [ ] **Step 5: Run the gates and the build; compare with Task 1's baselines**

```bash
export PATH=$HOME/.local/node/bin:$PATH
ps aux | grep -E "tsx|next dev" | grep -v grep          # nothing for this checkout
df -h /System/Volumes/Data | tail -1                     # room for temp datadirs
npx tsc --noEmit -p . 2>&1 | tail -3                     # expect: no output (0 errors)
npm run test:specs > "$TMPDIR/specs-319.txt" 2>&1; tail -1 "$TMPDIR/specs-319.txt"; grep -c '^PASS' "$TMPDIR/specs-319.txt"; grep -c '^PASS #319' "$TMPDIR/specs-319.txt"
                                                         # expect: ALL PASSED; PASS count = baseline + the #319 count
npm run test:smoke 2>&1 | tail -5                        # expect: ALL PASSED (own scratch datadir)
npx eslint --ignore-pattern scripts/test-review-and-spec.ts 2>&1 | tail -3   # expect: 0 errors; warnings ≤ baseline
npm run build 2>&1 | tail -15                            # expect: build completes (workers use throwaway datadirs)
```

Report each with its real numbers next to the Task 1 baseline. Any new tsc error, failing spec, smoke failure, new eslint error or build error is a stop. Afterwards clean temp datadirs if `df` is tight (`ls -d $TMPDIR/tmp.* | head`).

- [ ] **Step 6: Browser check — scratch datadir, Blob OFF**

`@next/env` only fills keys that are *undefined* in the process env, so pass the Blob keys as **empty** (not `env -u`, which lets `.env.local`'s live token back in):

```bash
export PATH=$HOME/.local/node/bin:$PATH
cd /Users/sm/Downloads/peak-app
SCR=/private/tmp/claude-501/-Users-sm-Downloads-peak-app/e21e410c-2995-4cd9-b8a5-c9775ab94173/scratchpad
ps aux | grep -E "tsx|next dev" | grep -v grep           # nothing
lsof -iTCP:3319 -sTCP:LISTEN                              # nothing (port free)
stat -f "%m" .data/pglite                                 # note the mtime
# A 3-page 24×16 in plan set (page 2 turned) — pdf-lib resolves from the repo, so the generator runs from the root, then goes:
cat > tmp-319-fixture.ts <<'EOF'
import { writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
(async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const n of [1, 2, 3]) {
    const p = doc.addPage([1728, 1152]);
    p.drawText(`Plan set - page ${n}`, { x: 72, y: 72, size: 64, font });
    if (n === 2) p.setRotation(degrees(90));
  }
  writeFileSync(process.argv[2], await doc.save());
})();
EOF
npx tsx tmp-319-fixture.ts "$SCR/plan-set-319.pdf" && rm tmp-319-fixture.ts && git status --short | grep tmp-319 || true   # expect: nothing listed
base64 -i "$SCR/plan-set-319.pdf" | tr -d '\n' > "$SCR/plan-set-319.b64"
```

Start the server in the background (Bash `run_in_background: true`):

```bash
cd /Users/sm/Downloads/peak-app && env -u DATABASE_URL BLOB_READ_WRITE_TOKEN= BLOB_STORE_ID= VERCEL_OIDC_TOKEN= PGLITE_PATH=/private/tmp/claude-501/-Users-sm-Downloads-peak-app/e21e410c-2995-4cd9-b8a5-c9775ab94173/scratchpad/pglite-319 NEXT_TELEMETRY_DISABLED=1 PATH=$HOME/.local/node/bin:$PATH node node_modules/.bin/next dev -p 3319
```

In the Browser pane, open `http://localhost:3319` (never `127.0.0.1`), sign in through the dev picker, and unregister the service worker once (`navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()))` via `javascript_tool`, then reload). Then:

1. Design → Grid → New design. Fill the intake (a new customer name, a venue name), choose **Blank**. The Plan view drop zone must read "up to **4 MB**" — proof Blob is off; stop if it says 25 MB.
2. Attach the plan set to the Plan view's file input (the pane has no file picker; this sets the input the way a pick would): in `javascript_tool`, run
   `const b64 = "<paste $SCR/plan-set-319.b64>"; const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); const dt = new DataTransfer(); dt.items.add(new File([bytes], "plan-set-319.pdf", { type: "application/pdf" })); const input = document.querySelector('input[type=file]'); input.files = dt.files; input.dispatchEvent(new Event("change", { bubbles: true }));`
   — then press the intake's save/finish button.
3. Expect: the editor opens with Adjust sheet showing **Sheet 1 of 3** and "Skip the rest". Press **Skip** → **Sheet 2 of 3** (page 2 shows turned). Turn it ⟳ once and press **Done** → after "Saving…", **Sheet 3 of 3** (no "Skip the rest" on the last). Press **Skip**.
4. Expect the tabs `plan-set-319.pdf — p.1`, `— p.2`, `— p.3` and **no** "Generated base plan" tab; the Revisions panel lists "Auto-saved before removing the generated plan".
5. Press the `+` tab and attach the same file the same way (the `+` tab's hidden `input[type=file]` — use `find` to get its ref, or `document.querySelectorAll('input[type=file]')`). Expect the status bar "Uploaded plan-set-319.pdf as 3 sheets" (no generated plan any more), Adjust sheet on Sheet 1 of 3; press **Skip the rest** → the dialog closes on that sheet.

Verify text with `get_page_text`/`javascript_tool` rather than a possibly-stale screenshot. Then stop and clean up:

```bash
pkill -f "next dev -p 3319"; sleep 2; ps aux | grep -E "next dev" | grep -v grep   # nothing
stat -f "%m" .data/pglite                                 # same mtime as before
rm -rf "$SCR/pglite-319"
```

Report what each numbered check showed. A failure is a stop (fix, re-run the gates, re-check).

- [ ] **Step 7: Commit**

```bash
git add DECISIONS.md PUNCHLIST.md AGENTS.md
git commit -m "$(cat <<'EOF'
docs: #319 one Grid sheet per PDF page; real plan retires the generated plan (D695–D697)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review (done while writing)

- **Spec coverage:** Split at upload on every path → Task 3 (broker commit, 4 MB route, intake copy; the dropped plan and banner re-upload ride the commit/route) + Task 4 (callers). Names / 1-page unchanged → Task 1 `splitSheetName`, Task 3 tests. Bytes via `copyPages` with inherited boxes/rotation → Task 1 splitter + pdf.js checks. `split` stamp + own root → Tasks 2/3. Blob vs data-URL storage → Task 3 (`storeSheetFile`). Original blob deleted, replay fails head → Task 3 tests 7. Fallback to one sheet (encrypted / unreadable / cap) with note → Tasks 1/3. 60-page cap → Task 1. Existing multi-page sheets untouched → nothing touches them. Adjust queue → Task 4. Retire (PDF or image; Spaces after revision; riser pruned; kept with count; baseSheetId kept) → Task 2 + Task 3 tests 1/3/6. Locking for `first` → Task 3 (commit/route/copy stay inside `withPlanLock`; split + retire inside). Surfacing (`sheetIds`, `baseSheet`, noteAction, intake notice) → Tasks 3/4. Testing list → Tasks 1–4 harness functions; gates + browser check → Task 5. Out-of-scope items are not built.
- **Placeholders:** none — every code step carries its code; the only "pick a number" step gives the command and what to change if it moved.
- **Type consistency:** `SheetsLanded` / `SheetUploadResult` / `BaseSheetOutcome` / `SheetSplit` (Task 1) are the types used by `addSheets`/`retireBaseSheet` (Task 2), `storeUploadAsSheets`/`CommitSheetResult`/`AttachPlanResult`/route reply (Task 3) and the client (Task 4); `storeUploadAsSheets(projectId, src, { by, first, intakeNotices }, deps)`, `readBlobCapped`, `storeSheetFile`, `StoredSheetFile`, `adjustQueueStep`, `parseAdjustParam`, `uploadNote`, `openAdjust(sheetId, afterUpload, queue)`, `closeAdjustWith`/`closeAdjust`/`skipRestAdjust`, `adjustQueue`, `adjustSheetIds` are spelled the same everywhere they appear.
