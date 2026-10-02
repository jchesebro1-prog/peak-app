# Catalog Photo Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Catalog → Datasheets → Photo sheet page that exports an .xlsx of customer-facing parts keyed by MFR part number and imports photos back from it — each Photo cell an image URL or a file name (dropped with the sheet, else found in the "Peak Product Photos" Drive folder).

**Architecture:** Pure modules decide everything (`photo-sheet.ts`: sheet rows, row→part matching, slot sources, ordering; `photo-sheet-plan.ts`: the per-cell plan + result statuses). One server-only I/O module reads/writes the workbook and loads the context; one server-only executor imports URL + Drive items under a 45 s budget, re-planning every call so it is resumable and idempotent. Dropped files go through the existing direct-to-Blob upload path with sheet provenance. The Drive photo sync learns to leave sheet-imported Drive files alone.

**Tech Stack:** Next.js 16 App Router (server actions, route handler), TypeScript, exceljs (server-only), sharp via `shrinkImage`, Vercel Blob, PGlite in tests, the `scripts/test-review-and-spec.ts` harness.

**Spec:** `docs/superpowers/specs/2026-10-01-catalog-photo-sheet-design.md`

## Global Constraints

- Columns, exactly and in order: `Manufacturer · MFR Part # · SKU · Description · Category · Photos now · Photo 1 · Photo 2 · Photo 3 · Status`. Headers match case-insensitively, whitespace trimmed/collapsed; other columns ignored.
- Export rows = parts that were quoted (`quotedPartStats`) **or** whose category is in a portal department (`departmentOfCategory`); never `Labor`; `Photos now = 0` first, then Manufacturer, then MFR Part #.
- Row → part: Manufacturer + MFR Part # (`normalizeSku`, MFR P/N **or** MFR M/N), SKU narrows; SKU alone matches by SKU. Exactly one → matched; else Problem. Never guesses.
- Photo 1 is the primary: a new Photo 1 is moved to the front of the part's real images; Photo 2/3 append at the end of the real-image group; datasheet-render thumbnails always stay last.
- Never deletes, replaces or hides an image. Imported images get default visibility.
- New `PartDocumentSource` value `"sheet"`; label **Sheet**. `sourceRef` is `drive:<fileId>` for Drive items, `file:<name>` for dropped files; `sourceUrl` is the URL (URL items) or the Drive `webViewLink` (Drive items).
- Images: ≤ 25 MB (`MAX_PART_IMAGE_BYTES`), HEIC refused with `HEIC_REASON`, every stored image shrunk with `shrinkImage` → `webpFileName`.
- Sheet upload ≤ 800 KB (`MAX_SHEET_BYTES`), ≤ 5000 rows (`MAX_SHEET_ROWS`) — server actions cap bodies at 1200 KB (`next.config.ts`).
- Server batch budget = `FETCH_ACTION_BUDGET_MS` (45 s); page `maxDuration = 60`.
- Import requires `create` (`requirePerm("create")`); the export route too.
- `exceljs` is SERVER-ONLY — never import `photo-sheet-io.ts`, `photo-sheet-import.ts`, or any store from a `"use client"` file. Client files may import `photo-sheet.ts` / `photo-sheet-plan.ts` (pure; type-only imports of server modules).
- Copy uses the app's voice: sentence case, em dashes, no exclamation marks.

## Before you start (worktree)

Per the project's memory: work in a fresh worktree off `origin/main`, then in it run `npm ci` (never symlink `node_modules`), copy `.env.local` and `next-env.d.ts` from the main checkout. Never open `.data/pglite` from the worktree (`test:specs` uses a temp datadir; fine). Commit instead of stashing. Gates per task: `npx tsc --noEmit` (0 errors), `npm run test:specs` (ALL PASSED, PASS count = baseline + new), `npx eslint <touched files>` (0 problems). Record the baseline PASS count first:

```bash
npm run test:specs 2>&1 | grep -c "^PASS"
```

## File structure

| File | Responsibility |
|---|---|
| `src/lib/part-docs/types.ts` (modify) | `"sheet"` source + its gallery rank |
| `src/lib/part-docs/photo-sheet.ts` (create, pure) | headers, grid → rows, rows → grid, part matcher, slot source, export rows, image placement, Drive claims |
| `src/lib/part-docs/photo-sheet-plan.ts` (create, pure) | per-cell plan (add / skip / problem, shared docs) + result statuses |
| `src/lib/part-docs/drive-photo-plan.ts` (modify) | `claimed` file ids are left alone |
| `src/lib/part-docs/drive-photo-sync.ts` (modify) | pass claims; export `listDrivePhotosForSheet` + `drivePhotosToken` |
| `src/lib/part-docs/photo-sheet-io.ts` (create, server) | read .xlsx/.csv, write workbook, load context, build export |
| `src/lib/part-docs/photo-sheet-import.ts` (create, server) | `placeSheetImage`, `runPhotoSheetBatch` |
| `src/app/(app)/catalog/documents/actions.ts` (modify) | `attachUploadedDocumentAction` takes optional sheet provenance |
| `src/app/(app)/catalog/documents/upload-client.ts` (modify) | `uploadNewDocument` passes it through |
| `src/app/(app)/catalog/part-documents-section.tsx` (modify) | `sheet: "Sheet"` label |
| `src/app/(app)/catalog/documents/photos/actions.ts` (create) | plan / batch / results server actions |
| `src/app/(app)/catalog/documents/photos/export/route.ts` (create) | GET → .xlsx |
| `src/app/(app)/catalog/documents/photos/page.tsx` (create) | page shell |
| `src/app/(app)/catalog/documents/photos/photo-sheet-client.tsx` (create) | upload → preview → import → results UI |
| `src/app/(app)/catalog/documents/page.tsx` (modify) | "Photo sheet" header link |
| `scripts/smoke-routes.ts` (modify) | two routes |
| `scripts/test-review-and-spec.ts` (modify) | appended check blocks + one chain line |
| `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md` (modify) | docs |

**Harness conventions** (`scripts/test-review-and-spec.ts`, ~43k lines): `ok(cond, msg)` prints `PASS`/`FAIL`. New blocks are **appended at the end of the file**; their `import` lines sit right above the block with unique aliases (ES imports hoist). Synchronous pure blocks are bare `{ … }` scopes. Async DB blocks are `async function xxxAsyncChecks()` added to the promise chain near line 10715 **right after** `.then(() => packages289AsyncChecks())` and before `.finally(() => teardownFixtures())`. DB fixtures use `fixtureId(scope, slug)` + `registerFixture(coll, id)` (already imported) and `upsertPart` (already imported from `@/lib/stores/catalog`). Run one block's output with:

```bash
npm run test:specs 2>&1 | grep -E "photo sheet|FAIL|ALL PASSED|FAILED"
```

---

### Task 1: Pure sheet model + `"sheet"` source

**Files:**
- Modify: `src/lib/part-docs/types.ts:49` and `:136-143`
- Modify: `src/app/(app)/catalog/part-documents-section.tsx:17-24`
- Create: `src/lib/part-docs/photo-sheet.ts`
- Test: append to `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `normalizeSku` (`@/lib/davinci/sku`), `PartDocumentSource` (`./types`).
- Produces (all exported from `photo-sheet.ts`):
  - `PHOTO_SHEET_NAME = "Photos"`, `PHOTO_SLOTS = 3`, `PHOTO_SHEET_HEADERS` (readonly tuple, 10 names), `MAX_SHEET_ROWS = 5000`, `MAX_SHEET_BYTES = 800 * 1024`
  - `type PhotoSheetRow = { rowNumber: number; manufacturer: string; mfrPart: string; sku: string; description: string; category: string; photosNow: string; photos: string[]; status: string }`
  - `type ImportRow = Pick<PhotoSheetRow, "rowNumber" | "manufacturer" | "mfrPart" | "sku" | "photos">`
  - `rowsFromGrid(grid: readonly (readonly string[])[]): { ok: true; rows: PhotoSheetRow[] } | { ok: false; error: string }`
  - `rowsToGrid(rows: readonly PhotoSheetRow[], statuses?: ReadonlyMap<number, string>): string[][]`
  - `toImportRows(rows: readonly PhotoSheetRow[]): ImportRow[]` (only rows with ≥1 photo value)
  - `type SheetPart = { sku: string; desc: string; category: string; mfr?: string; manufacturerPartNumber?: string; manufacturerModelNumber?: string }`
  - `type RowMatch = { kind: "matched"; sku: string } | { kind: "none" } | { kind: "ambiguous"; skus: string[] }`
  - `type PartMatcher = (row: Pick<ImportRow, "manufacturer" | "mfrPart" | "sku">) => RowMatch`
  - `buildPartMatcher(parts: readonly SheetPart[]): PartMatcher`
  - `type SheetImage = { id: string; source: PartDocumentSource; sourceUrl: string | null; sourceRef?: string; fileName: string }`
  - `driveIdOf(img: Pick<SheetImage, "source" | "sourceRef">): string | null`, `droppedNameOf(img): string | null`
  - `slotSource(img: SheetImage, driveNames: ReadonlyMap<string, string>): string`
  - `exportRows(parts, include: ReadonlySet<string>, imagesBySku: ReadonlyMap<string, readonly SheetImage[]>, driveNames): PhotoSheetRow[]`
  - `placeNewImage(ordered: readonly { id: string; source: PartDocumentSource }[], id: string, primary: boolean): string[]`
  - `sheetDriveClaims(docs: readonly Pick<SheetImage, "source" | "sourceRef">[]): Set<string>`

- [ ] **Step 1: Add the source value**

In `src/lib/part-docs/types.ts` line 49:

```ts
export type PartDocumentSource = "upload" | "drive" | "fetch" | "davinci" | "legacy" | "datasheet-render" | "sheet";
```

In `IMAGE_SOURCE_RANK` (line 136) add `sheet: 0,` after `drive: 0,` (a sheet image is a hand-picked photo, same rank as an upload or Drive photo).

In `src/app/(app)/catalog/part-documents-section.tsx` `IMAGE_SOURCE_LABEL` add `sheet: "Sheet",` after `drive: "Drive",`.

Run `npx tsc --noEmit` — expect 0 errors (any other `Record<PartDocumentSource, …>` would now fail; fix it the same way if one appears).

- [ ] **Step 2: Write the failing tests** — append to the end of `scripts/test-review-and-spec.ts`:

```ts
/* ======================================================================
   Photo sheet — pure sheet model (photo-sheet.ts).
   ====================================================================== */
import {
  rowsFromGrid as phsRows, rowsToGrid as phsGrid, toImportRows as phsImportRows, buildPartMatcher as phsMatcher,
  slotSource as phsSlot, exportRows as phsExport, placeNewImage as phsPlace, sheetDriveClaims as phsClaims,
  PHOTO_SHEET_HEADERS as phsHeaders, type SheetPart as PhsPart, type SheetImage as PhsImage,
} from "@/lib/part-docs/photo-sheet";
const PHS_H: string[] = [...phsHeaders];
const PHS_PARTS: PhsPart[] = [
  { sku: "SKU-A", desc: "A", category: "Lighting", mfr: "ETC", manufacturerPartNumber: "S4-ALPHA" },
  { sku: "SKU-B", desc: "B", category: "Lighting", mfr: "ETC", manufacturerModelNumber: "S4 BRAVO" },
  { sku: "SKU-C1", desc: "C1", category: "Rigging", mfr: "ADC", manufacturerPartNumber: "280" },
  { sku: "SKU-C2", desc: "C2", category: "Rigging", mfr: "ADC", manufacturerPartNumber: "280" },
  { sku: "SKU-D", desc: "D", category: "Lighting", mfr: "Chauvet", manufacturerPartNumber: "S4-ALPHA" },
  { sku: "SKU-L", desc: "L", category: "Labor", manufacturerPartNumber: "LAB1" },
];
{
  const g = phsRows([PHS_H.map((h) => `  ${h.toUpperCase()} `), ["ETC", "S4-ALPHA", "", "", "", "", " https://x/a.jpg ", "", "", ""], [], ["", "", "", "", "", "", "", "", "", ""]]);
  ok(g.ok && g.rows.length === 1 && g.rows[0].rowNumber === 2 && g.rows[0].photos[0] === "https://x/a.jpg" && g.rows[0].photos.length === 3,
    "photo sheet parse: headers match case/space-insensitively, cells trim, blank rows drop, rowNumber is the sheet row");
  const bad = phsRows([["Foo", "Bar"], ["1", "2"]]);
  ok(!bad.ok && /Photo 1/.test(bad.error), "photo sheet parse: a sheet without Photo 1 + MFR Part #/SKU is refused");
  const skuOnly = phsRows([["SKU", "Photo 1", "Notes"], ["SKU-D", "x.jpg", "ignored"]]);
  ok(skuOnly.ok && skuOnly.rows[0].sku === "SKU-D" && skuOnly.rows[0].photos[0] === "x.jpg" && skuOnly.rows[0].mfrPart === "", "photo sheet parse: SKU + Photo 1 is enough; unknown columns are ignored");
  const many = phsRows([PHS_H, ...Array.from({ length: 5001 }, (_, i) => ["M", `P${i}`, "", "", "", "", "", "", "", ""])]);
  ok(!many.ok && /5000/.test(many.error), "photo sheet parse: more than 5000 rows is refused");

  const grid = phsGrid(g.ok ? g.rows : [], new Map([[2, "Added 1"]]));
  ok(grid[0].join("|") === PHS_H.join("|") && grid[1][9] === "Added 1" && grid[1][6] === "https://x/a.jpg", "photo sheet grid: header row + a status override lands in Status");
  ok(phsImportRows(skuOnly.ok ? [...skuOnly.rows, { ...skuOnly.rows[0], rowNumber: 3, photos: ["", "", ""] }] : []).length === 1, "photo sheet import rows: rows with no photo value are dropped");

  const m = phsMatcher(PHS_PARTS);
  const pick = (manufacturer: string, mfrPart: string, sku: string) => m({ manufacturer, mfrPart, sku });
  const a = pick("etc", "s4alpha", "");
  ok(a.kind === "matched" && a.sku === "SKU-A", "photo sheet match: manufacturer (any case) + normalized MFR P/N");
  const amb = pick("", "S4-ALPHA", "");
  ok(amb.kind === "ambiguous" && amb.skus.sort().join() === "SKU-A,SKU-D", "photo sheet match: the same MFR P/N at two manufacturers is ambiguous without a manufacturer");
  const b = pick("ETC", "S4-BRAVO", "");
  ok(b.kind === "matched" && b.sku === "SKU-B", "photo sheet match: the MFR model number counts");
  const c2 = pick("ADC", "280", "sku-c2");
  ok(c2.kind === "matched" && c2.sku === "SKU-C2", "photo sheet match: SKU breaks a tie");
  ok(pick("ADC", "280", "").kind === "ambiguous", "photo sheet match: a tie without SKU stays ambiguous");
  const d = pick("", "", "SKU-D");
  ok(d.kind === "matched" && d.sku === "SKU-D", "photo sheet match: a SKU-only row matches by SKU");
  ok(pick("ETC", "NOPE", "").kind === "none" && pick("", "LAB1", "").kind === "none" && pick("", "", "").kind === "none", "photo sheet match: unknown, Labor and empty rows match nothing");

  const drv: PhsImage = { id: "PD-1", source: "drive", sourceRef: "f1", sourceUrl: "https://drive/f1", fileName: "front.webp" };
  const sh: PhsImage = { id: "PD-2", source: "sheet", sourceRef: "file:Back.JPG", sourceUrl: null, fileName: "Back.webp" };
  const shd: PhsImage = { id: "PD-3", source: "sheet", sourceRef: "drive:f2", sourceUrl: "https://drive/f2", fileName: "side.webp" };
  const up: PhsImage = { id: "PD-4", source: "upload", sourceUrl: null, fileName: "u.webp" };
  const fe: PhsImage = { id: "PD-5", source: "fetch", sourceUrl: "https://m/x.jpg", fileName: "x.webp" };
  const names = new Map([["f1", "front.jpg"], ["f2", "side.png"]]);
  ok(phsSlot(drv, names) === "front.jpg" && phsSlot(drv, new Map()) === "https://drive/f1", "photo sheet slot source: a Drive photo shows its Drive name, else its link");
  ok(phsSlot(shd, names) === "side.png" && phsSlot(sh, names) === "Back.JPG", "photo sheet slot source: sheet photos show their Drive or dropped name");
  ok(phsSlot(up, names) === "u.webp" && phsSlot(fe, names) === "https://m/x.jpg", "photo sheet slot source: an upload shows its file name, a fetch its URL");

  const rows = phsExport(PHS_PARTS, new Set(["SKU-A", "SKU-B", "SKU-L"]), new Map([["SKU-A", [fe, up, drv, sh]]]), names);
  ok(rows.length === 2 && rows[0].sku === "SKU-B" && rows[0].status === "Missing" && rows[0].photosNow === "0", "photo sheet export: Labor dropped; parts missing a photo come first");
  ok(rows[1].sku === "SKU-A" && rows[1].photos.join("|") === "https://m/x.jpg|u.webp|front.jpg" && rows[1].photosNow === "4" && rows[1].status === "Has 4" && rows[1].mfrPart === "S4-ALPHA" && rows[1].manufacturer === "ETC",
    "photo sheet export: the first three real photos fill the slots; Photos now counts all");
  ok(rows[0].rowNumber === 2 && rows[1].rowNumber === 3, "photo sheet export: rows are numbered as sheet rows");

  const ord = [{ id: "a", source: "upload" as const }, { id: "r", source: "datasheet-render" as const }, { id: "n", source: "sheet" as const }];
  ok(phsPlace(ord, "n", true).join() === "n,a,r", "photo sheet place: a primary goes to the front, thumbnails stay last");
  ok(phsPlace(ord, "n", false).join() === "a,n,r", "photo sheet place: a non-primary appends at the end of the real photos");
  ok([...phsClaims([shd, drv, sh])].join() === "f2", "photo sheet claims: only sheet-imported Drive files are claimed");
}
```

- [ ] **Step 3: Run to confirm failure**

Run: `npm run test:specs 2>&1 | tail -5`
Expected: the run aborts with a module-not-found error for `@/lib/part-docs/photo-sheet`.

- [ ] **Step 4: Implement `src/lib/part-docs/photo-sheet.ts`**

```ts
import { normalizeSku } from "@/lib/davinci/sku";
import type { PartDocumentSource } from "./types";

/**
 * Catalog photo sheet (spec 2026-10-01-catalog-photo-sheet-design.md) — the
 * pure half: the sheet's columns, grid ↔ rows, row → part matching, what each
 * Photo slot shows on export, and where a new image lands in a part's
 * gallery. No I/O; safe in client components.
 */

export const PHOTO_SHEET_NAME = "Photos";
export const PHOTO_SLOTS = 3;
export const PHOTO_SHEET_HEADERS = ["Manufacturer", "MFR Part #", "SKU", "Description", "Category", "Photos now", "Photo 1", "Photo 2", "Photo 3", "Status"] as const;
export const MAX_SHEET_ROWS = 5000;
/** Server actions cap bodies at 1200 KB, and the results sheet re-sends the file. */
export const MAX_SHEET_BYTES = 800 * 1024;

export type PhotoSheetRow = {
  /** The row's own number in the sheet (the header is row 1). */
  rowNumber: number;
  manufacturer: string;
  mfrPart: string;
  sku: string;
  description: string;
  category: string;
  photosNow: string;
  /** Always PHOTO_SLOTS long; "" = empty slot. */
  photos: string[];
  status: string;
};

/** What an import needs from a row — what the browser sends back per batch. */
export type ImportRow = Pick<PhotoSheetRow, "rowNumber" | "manufacturer" | "mfrPart" | "sku" | "photos">;

type Field = "manufacturer" | "mfrPart" | "sku" | "description" | "category" | "photosNow" | "photo1" | "photo2" | "photo3" | "status";
const HEADER_FIELD: Record<string, Field> = {
  manufacturer: "manufacturer",
  "mfr part #": "mfrPart",
  sku: "sku",
  description: "description",
  category: "category",
  "photos now": "photosNow",
  "photo 1": "photo1",
  "photo 2": "photo2",
  "photo 3": "photo3",
  status: "status",
};

const headerKey = (h: unknown) => String(h ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const lower = (s: string | undefined) => String(s ?? "").trim().toLowerCase();

export function rowsFromGrid(grid: readonly (readonly string[])[]): { ok: true; rows: PhotoSheetRow[] } | { ok: false; error: string } {
  const col = new Map<Field, number>();
  (grid[0] ?? []).forEach((h, i) => {
    const f = HEADER_FIELD[headerKey(h)];
    if (f && !col.has(f)) col.set(f, i);
  });
  if (!col.has("photo1") || (!col.has("mfrPart") && !col.has("sku"))) {
    return { ok: false, error: "This doesn't look like a photo sheet — it needs a Photo 1 column and an MFR Part # or SKU column." };
  }
  const rows: PhotoSheetRow[] = [];
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r] ?? [];
    const get = (f: Field) => {
      const i = col.get(f);
      return i == null ? "" : String(cells[i] ?? "").trim();
    };
    const row: PhotoSheetRow = {
      rowNumber: r + 1,
      manufacturer: get("manufacturer"),
      mfrPart: get("mfrPart"),
      sku: get("sku"),
      description: get("description"),
      category: get("category"),
      photosNow: get("photosNow"),
      photos: [get("photo1"), get("photo2"), get("photo3")],
      status: get("status"),
    };
    if (!row.manufacturer && !row.mfrPart && !row.sku && row.photos.every((p) => !p)) continue;
    rows.push(row);
  }
  if (rows.length > MAX_SHEET_ROWS) return { ok: false, error: `That sheet has ${rows.length} rows — split it into sheets of ${MAX_SHEET_ROWS} or fewer.` };
  return { ok: true, rows };
}

/** Header + one line per row; `statuses` (by rowNumber) overrides Status. */
export function rowsToGrid(rows: readonly PhotoSheetRow[], statuses?: ReadonlyMap<number, string>): string[][] {
  return [
    [...PHOTO_SHEET_HEADERS],
    ...rows.map((r) => [r.manufacturer, r.mfrPart, r.sku, r.description, r.category, r.photosNow, ...r.photos.slice(0, PHOTO_SLOTS), statuses?.get(r.rowNumber) ?? r.status]),
  ];
}

export function toImportRows(rows: readonly PhotoSheetRow[]): ImportRow[] {
  return rows
    .filter((r) => r.photos.some((p) => p.trim()))
    .map((r) => ({ rowNumber: r.rowNumber, manufacturer: r.manufacturer, mfrPart: r.mfrPart, sku: r.sku, photos: [...r.photos] }));
}

export type SheetPart = { sku: string; desc: string; category: string; mfr?: string; manufacturerPartNumber?: string; manufacturerModelNumber?: string };
export type RowMatch = { kind: "matched"; sku: string } | { kind: "none" } | { kind: "ambiguous"; skus: string[] };
export type PartMatcher = (row: Pick<ImportRow, "manufacturer" | "mfrPart" | "sku">) => RowMatch;

/** Manufacturer + MFR P/N (or M/N), normalized like the filename rule; SKU
 *  narrows; a SKU-only row matches by SKU. Labor is never a target. */
export function buildPartMatcher(parts: readonly SheetPart[]): PartMatcher {
  const byKey = new Map<string, SheetPart[]>();
  const bySku = new Map<string, SheetPart[]>();
  const push = (m: Map<string, SheetPart[]>, k: string, p: SheetPart) => {
    const l = m.get(k);
    if (l) l.push(p);
    else m.set(k, [p]);
  };
  for (const p of parts) {
    if (p.category === "Labor") continue;
    for (const k of new Set([normalizeSku(p.manufacturerPartNumber || ""), normalizeSku(p.manufacturerModelNumber || "")])) if (k) push(byKey, k, p);
    push(bySku, lower(p.sku), p);
  }
  return (row) => {
    const key = normalizeSku(row.mfrPart || "");
    const sku = lower(row.sku);
    let cands: SheetPart[];
    if (key) {
      cands = byKey.get(key) ?? [];
      const mfr = lower(row.manufacturer);
      if (mfr) cands = cands.filter((p) => lower(p.mfr) === mfr);
      if (sku) cands = cands.filter((p) => lower(p.sku) === sku);
    } else if (sku) {
      cands = bySku.get(sku) ?? [];
    } else {
      return { kind: "none" };
    }
    const skus = [...new Set(cands.map((p) => p.sku))];
    if (skus.length === 1) return { kind: "matched", sku: skus[0] };
    return skus.length ? { kind: "ambiguous", skus } : { kind: "none" };
  };
}

export type SheetImage = { id: string; source: PartDocumentSource; sourceUrl: string | null; sourceRef?: string; fileName: string };

/** The Drive file an image came from — a #283 sync photo or a sheet one. */
export function driveIdOf(img: Pick<SheetImage, "source" | "sourceRef">): string | null {
  if (img.source === "drive" && img.sourceRef) return img.sourceRef;
  if (img.source === "sheet" && img.sourceRef?.startsWith("drive:")) return img.sourceRef.slice(6) || null;
  return null;
}

/** The dropped file name a sheet image came from. */
export function droppedNameOf(img: Pick<SheetImage, "source" | "sourceRef">): string | null {
  return img.source === "sheet" && img.sourceRef?.startsWith("file:") ? img.sourceRef.slice(5) || null : null;
}

/** What a Photo slot shows on export — and what a re-import treats as "already there". */
export function slotSource(img: SheetImage, driveNames: ReadonlyMap<string, string>): string {
  const d = driveIdOf(img);
  if (d && driveNames.has(d)) return driveNames.get(d)!;
  const f = droppedNameOf(img);
  if (f) return f;
  return img.sourceUrl || img.fileName;
}

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

/** `imagesBySku` holds each part's REAL images (no datasheet-render), in gallery order. */
export function exportRows(
  parts: readonly SheetPart[],
  include: ReadonlySet<string>,
  imagesBySku: ReadonlyMap<string, readonly SheetImage[]>,
  driveNames: ReadonlyMap<string, string>
): PhotoSheetRow[] {
  const rows = parts
    .filter((p) => include.has(p.sku) && p.category !== "Labor")
    .map((p) => {
      const imgs = imagesBySku.get(p.sku) ?? [];
      return {
        rowNumber: 0,
        manufacturer: p.mfr ?? "",
        mfrPart: p.manufacturerPartNumber || p.manufacturerModelNumber || "",
        sku: p.sku,
        description: p.desc,
        category: p.category,
        photosNow: String(imgs.length),
        photos: Array.from({ length: PHOTO_SLOTS }, (_, i) => (imgs[i] ? slotSource(imgs[i], driveNames) : "")),
        status: imgs.length ? `Has ${imgs.length}` : "Missing",
      };
    });
  rows.sort((a, b) => Number(a.photosNow !== "0") - Number(b.photosNow !== "0") || byText(a.manufacturer, b.manufacturer) || byText(a.mfrPart, b.mfrPart) || byText(a.sku, b.sku));
  rows.forEach((r, i) => (r.rowNumber = i + 2));
  return rows;
}

/** The full image order after placing `id` (already linked): front when
 *  primary, else last among real photos; datasheet-render thumbnails last. */
export function placeNewImage(ordered: readonly { id: string; source: PartDocumentSource }[], id: string, primary: boolean): string[] {
  const others = ordered.filter((i) => i.id !== id);
  const real = others.filter((i) => i.source !== "datasheet-render").map((i) => i.id);
  const auto = others.filter((i) => i.source === "datasheet-render").map((i) => i.id);
  return primary ? [id, ...real, ...auto] : [...real, id, ...auto];
}

/** Drive file ids a sheet import owns — the Drive sync leaves these alone. */
export function sheetDriveClaims(docs: readonly Pick<SheetImage, "source" | "sourceRef">[]): Set<string> {
  const out = new Set<string>();
  for (const d of docs) if (d.source === "sheet") {
    const id = driveIdOf(d);
    if (id) out.add(id);
  }
  return out;
}
```

- [ ] **Step 5: Run the tests** — `npm run test:specs 2>&1 | grep -E "photo sheet|FAIL|ALL PASSED|FAILED"` — expect every `photo sheet` line PASS and `ALL PASSED`.

- [ ] **Step 6: Gates + commit**

```bash
npx tsc --noEmit && npx eslint src/lib/part-docs/photo-sheet.ts src/lib/part-docs/types.ts "src/app/(app)/catalog/part-documents-section.tsx"
git add src/lib/part-docs/photo-sheet.ts src/lib/part-docs/types.ts "src/app/(app)/catalog/part-documents-section.tsx" scripts/test-review-and-spec.ts
git commit -m "feat(catalog): photo sheet model + sheet image source"
```

---

### Task 2: The pure planner + result statuses

**Files:**
- Create: `src/lib/part-docs/photo-sheet-plan.ts`
- Test: append to `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: from `./photo-sheet` — `PHOTO_SLOTS`, `ImportRow`, `PartMatcher`, `SheetImage`, `slotSource`, `driveIdOf`, `droppedNameOf`; `HEIC_REASON`, `OVER_CAP_REASON` from `./drive-photo-plan`; `MAX_PART_IMAGE_BYTES` from `./types`; `type DriveListedPhoto` from `@/lib/google/drive-photos`.
- Produces:
  - `type DroppedFile = { name: string; size: number }`
  - `type PlannedLink = { sku: string; primary: boolean; rowNumber: number; slot: number }` (slot 1–3)
  - `type PlannedDoc = { key: string; via: "url"; url: string; existingId: string | null; links: PlannedLink[] } | { key: string; via: "drive"; file: DriveListedPhoto; existingId: string | null; links: PlannedLink[] } | { key: string; via: "dropped"; name: string; links: PlannedLink[] }`
  - `type PlanProblem = { rowNumber: number; slot: number | null; value: string; reason: string }`
  - `type PlanSkip = { rowNumber: number; slot: number; sku: string }`
  - `type PhotoSheetPlan = { docs: PlannedDoc[]; skipped: PlanSkip[]; problems: PlanProblem[]; matched: number }`
  - `type PlanInput = { rows: readonly ImportRow[]; match: PartMatcher; imagesBySku: ReadonlyMap<string, readonly SheetImage[]>; imageByUrl: ReadonlyMap<string, string>; imageByDriveId: ReadonlyMap<string, string>; dropped: readonly DroppedFile[]; drive: readonly DriveListedPhoto[] | null; driveReason: string }`
  - `planPhotoSheet(input: PlanInput): PhotoSheetPlan`
  - `type SheetDocOutcome = { key: string; ok: boolean; error?: string; documentId?: string }`
  - `resultStatuses(plan: PhotoSheetPlan, outcomes: readonly SheetDocOutcome[]): Map<number, string>`
  - `planCounts(plan: PhotoSheetPlan): { add: number; skip: number; problems: number }`

- [ ] **Step 1: Write the failing tests** — append:

```ts
/* ======================================================================
   Photo sheet — the planner (photo-sheet-plan.ts).
   ====================================================================== */
import { planPhotoSheet as phsPlan, resultStatuses as phsStatuses, planCounts as phsCounts } from "@/lib/part-docs/photo-sheet-plan";
import { HEIC_REASON as phsHeic, OVER_CAP_REASON as phsOverCap } from "@/lib/part-docs/drive-photo-plan";
{
  const m = phsMatcher(PHS_PARTS);
  const dfile = (id: string, name: string, mimeType = "image/jpeg", size = 100) => ({ id, name, mimeType, md5: "m", size, webViewLink: `https://drive/${id}` });
  const drive = [dfile("d1", "Front.jpg"), dfile("d2", "dup.jpg"), dfile("d3", "dup.jpg"), dfile("d4", "phone.heic", "image/heic"), dfile("d5", "Shared.png"), dfile("d6", "pic.jpg", "image/heic")];
  const imgs = new Map<string, PhsImage[]>([["SKU-A", [
    { id: "PD-a1", source: "fetch", sourceUrl: "https://m/a1.jpg", fileName: "a1.webp" },
    { id: "PD-a2", source: "upload", sourceUrl: null, fileName: "old.webp" },
  ]]]);
  const parsed = phsRows([PHS_H,
    ["ETC", "S4-ALPHA", "", "", "", "", "https://m/a1.jpg", "OLD.webp", "https://m/new.jpg", ""],
    ["ETC", "S4-BRAVO", "", "", "", "", "front.JPG", "ftp://x/y.jpg", "drop1.jpg", ""],
    ["ADC", "280", "", "", "", "", "https://m/new.jpg", "", "", ""],
    ["", "", "SKU-D", "", "", "", "https://m/new.jpg", "dup.jpg", "phone.heic", ""],
    ["", "", "SKU-C1", "", "", "", "Shared.png", "missing.jpg", "big.jpg", ""],
    ["", "", "SKU-C2", "", "", "", "pic.jpg", "C:\\photos\\drop1.jpg", "", ""],
  ]);
  const rows = phsImportRows(parsed.ok ? parsed.rows : []);
  const input = {
    rows, match: m, imagesBySku: imgs,
    imageByUrl: new Map([["https://m/a1.jpg", "PD-a1"]]), imageByDriveId: new Map([["d5", "PD-shared"]]),
    dropped: [{ name: "DROP1.jpg", size: 10 }, { name: "big.jpg", size: 26 * 1024 * 1024 }],
    drive, driveReason: "Drive photos aren't connected",
  };
  const plan = phsPlan(input);
  const doc = (key: string) => plan.docs.find((d) => d.key === key);
  const prob = (row: number, slot: number | null) => plan.problems.find((p) => p.rowNumber === row && p.slot === slot);

  ok(plan.skipped.filter((s) => s.rowNumber === 2).map((s) => s.slot).join() === "1,2", "photo sheet plan: a URL already on the part and an exported file name (any case) skip");
  const nu = doc("url:https://m/new.jpg");
  ok(!!nu && nu.via === "url" && nu.existingId === null && nu.links.map((l) => `${l.sku}:${l.primary}:${l.rowNumber}:${l.slot}`).join() === "SKU-A:false:2:3,SKU-D:true:5:1",
    "photo sheet plan: one URL on two rows is one shared document; Photo 1 marks primary per part");
  const d1 = doc("drive:d1");
  ok(!!d1 && d1.via === "drive" && d1.links[0].sku === "SKU-B" && d1.links[0].primary, "photo sheet plan: a file name finds a Drive file case-insensitively");
  ok(prob(3, 2)?.reason === "not an http(s) URL", "photo sheet plan: a non-http scheme is a problem");
  const dr = doc("file:drop1.jpg");
  ok(!!dr && dr.via === "dropped" && dr.name === "DROP1.jpg" && dr.links.map((l) => l.sku).join() === "SKU-B,SKU-C2", "photo sheet plan: a dropped file wins (any case, a Windows path's base name) and is shared");
  ok(/ambiguous/.test(prob(4, null)?.reason ?? "") && !plan.docs.some((d) => d.links.some((l) => l.rowNumber === 4)), "photo sheet plan: an ambiguous row is one row problem and plans nothing");
  ok(prob(5, 2)?.reason === "2 Drive files share this name", "photo sheet plan: duplicate Drive names are a problem, never a guess");
  ok(prob(5, 3)?.reason === phsHeic && prob(7, 1)?.reason === phsHeic, "photo sheet plan: HEIC refuses by name and by Drive type");
  const sh = doc("drive:d5");
  ok(!!sh && sh.via === "drive" && sh.existingId === "PD-shared" && sh.links[0].sku === "SKU-C1", "photo sheet plan: a Drive file already in the catalog is linked, not re-imported");
  ok(prob(6, 2)?.reason === "not dropped and not in Peak Product Photos" && prob(6, 3)?.reason === phsOverCap, "photo sheet plan: a missing file and an over-cap dropped file are problems");
  ok(plan.matched === 5, "photo sheet plan: matched counts matched rows");
  const c = phsCounts(plan);
  ok(c.add === plan.docs.reduce((n, d) => n + d.links.length, 0) && c.skip === plan.skipped.length && c.problems === plan.problems.length, "photo sheet plan: counts add links, skips and problems");

  const noDrive = phsPlan({ ...input, drive: null });
  ok(noDrive.problems.find((p) => p.rowNumber === 3 && p.slot === 1)?.reason === "not dropped, and Drive photos aren't connected", "photo sheet plan: without Drive, a file name says why");

  const st = phsStatuses(plan, [
    { key: "url:https://m/new.jpg", ok: true },
    { key: "drive:d1", ok: false, error: "Drive download failed: boom" },
    { key: "file:drop1.jpg", ok: true },
    { key: "drive:d5", ok: true },
  ]);
  ok(st.get(2) === "Added 1; Skipped 2 (already attached)", "photo sheet status: added + skipped counts");
  ok(st.get(3) === "Photo 1: Drive download failed: boom; Photo 2: not an http(s) URL; Added 1", "photo sheet status: problems and failures by slot, then counts");
  ok(/^ambiguous/.test(st.get(4) ?? ""), "photo sheet status: a row problem stands alone");
  ok(phsStatuses(plan, []).get(5)?.includes("Photo 1: not imported") === true, "photo sheet status: a planned photo with no outcome says not imported");
}
```

- [ ] **Step 2: Run to confirm failure** — `npm run test:specs 2>&1 | tail -5` → module-not-found for `photo-sheet-plan`.

- [ ] **Step 3: Implement `src/lib/part-docs/photo-sheet-plan.ts`**

```ts
import type { DriveListedPhoto } from "@/lib/google/drive-photos";
import { HEIC_REASON, OVER_CAP_REASON } from "./drive-photo-plan";
import { droppedNameOf, driveIdOf, PHOTO_SLOTS, slotSource, type ImportRow, type PartMatcher, type SheetImage } from "./photo-sheet";
import { MAX_PART_IMAGE_BYTES } from "./types";

/**
 * Catalog photo sheet — what one import should do, decided purely. Per
 * filled Photo cell, first rule wins: row unmatched/ambiguous → one row
 * problem; equal to what the part's slot already shows → skip; an http(s)
 * URL; another scheme → problem; else a file name (dropped file first, then
 * the Drive listing exact, then case-insensitive, duplicates refused);
 * already attached by URL / Drive id / dropped name → skip; else add. Adds
 * naming the same URL, Drive file or dropped name collapse into one planned
 * document linked to every part. Safe in client components.
 */

export type DroppedFile = { name: string; size: number };
export type PlannedLink = { sku: string; primary: boolean; rowNumber: number; slot: number };
export type PlannedDoc =
  | { key: string; via: "url"; url: string; existingId: string | null; links: PlannedLink[] }
  | { key: string; via: "drive"; file: DriveListedPhoto; existingId: string | null; links: PlannedLink[] }
  | { key: string; via: "dropped"; name: string; links: PlannedLink[] };
export type PlanProblem = { rowNumber: number; slot: number | null; value: string; reason: string };
export type PlanSkip = { rowNumber: number; slot: number; sku: string };
export type PhotoSheetPlan = { docs: PlannedDoc[]; skipped: PlanSkip[]; problems: PlanProblem[]; matched: number };
export type PlanInput = {
  rows: readonly ImportRow[];
  match: PartMatcher;
  /** Each part's REAL images (no datasheet-render), gallery order. */
  imagesBySku: ReadonlyMap<string, readonly SheetImage[]>;
  /** Any image document's sourceUrl → its id (shared docs get linked, not re-fetched). */
  imageByUrl: ReadonlyMap<string, string>;
  /** Any image document's Drive file id → its id. */
  imageByDriveId: ReadonlyMap<string, string>;
  dropped: readonly DroppedFile[];
  /** The Peak Product Photos listing; null when it can't be read. */
  drive: readonly DriveListedPhoto[] | null;
  /** Why `drive` is null, e.g. "Drive photos aren't connected". */
  driveReason: string;
};
export type SheetDocOutcome = { key: string; ok: boolean; error?: string; documentId?: string };

const HEIC_NAME = /\.(heic|heif)$/i;
const HEIC_MIME = new Set(["image/heic", "image/heif"]);
const HTTP = /^https?:\/\//i;
const OTHER_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

export function planPhotoSheet(input: PlanInput): PhotoSheetPlan {
  const plan: PhotoSheetPlan = { docs: [], skipped: [], problems: [], matched: 0 };
  const byKey = new Map<string, PlannedDoc>();
  const droppedByName = new Map(input.dropped.map((f) => [f.name.toLowerCase(), f] as const));
  const driveNames = new Map((input.drive ?? []).map((f) => [f.id, f.name] as const));

  const addLink = (key: string, make: () => PlannedDoc, link: PlannedLink) => {
    let doc = byKey.get(key);
    if (!doc) {
      doc = make();
      byKey.set(key, doc);
      plan.docs.push(doc);
    }
    const same = doc.links.find((l) => l.sku === link.sku);
    if (same) same.primary ||= link.primary;
    else doc.links.push(link);
  };

  for (const row of input.rows) {
    const values = row.photos.slice(0, PHOTO_SLOTS).map((v) => String(v ?? "").trim());
    if (!values.some(Boolean)) continue;
    const m = input.match(row);
    if (m.kind !== "matched") {
      const reason = m.kind === "ambiguous" ? `ambiguous — fill the SKU column (${m.skus.slice(0, 5).join(", ")}${m.skus.length > 5 ? ", …" : ""})` : "no matching part";
      plan.problems.push({ rowNumber: row.rowNumber, slot: null, value: "", reason });
      continue;
    }
    plan.matched++;
    const sku = m.sku;
    const imgs = input.imagesBySku.get(sku) ?? [];
    const shown = new Set(imgs.map((i) => slotSource(i, driveNames).toLowerCase()));

    values.forEach((v, i) => {
      if (!v) return;
      const slot = i + 1;
      const link: PlannedLink = { sku, primary: slot === 1, rowNumber: row.rowNumber, slot };
      const problem = (reason: string) => plan.problems.push({ rowNumber: row.rowNumber, slot, value: v, reason });
      const skip = () => plan.skipped.push({ rowNumber: row.rowNumber, slot, sku });
      if (shown.has(v.toLowerCase())) return skip();

      if (HTTP.test(v)) {
        if (imgs.some((img) => img.sourceUrl === v)) return skip();
        return addLink(`url:${v}`, () => ({ key: `url:${v}`, via: "url", url: v, existingId: input.imageByUrl.get(v) ?? null, links: [] }), link);
      }
      if (OTHER_SCHEME.test(v)) return problem("not an http(s) URL");

      const name = v.split(/[\\/]/).pop() || v;
      if (HEIC_NAME.test(name)) return problem(HEIC_REASON);
      const dropped = droppedByName.get(name.toLowerCase());
      if (dropped) {
        if (dropped.size > MAX_PART_IMAGE_BYTES) return problem(OVER_CAP_REASON);
        if (imgs.some((img) => droppedNameOf(img)?.toLowerCase() === dropped.name.toLowerCase())) return skip();
        const key = `file:${dropped.name.toLowerCase()}`;
        return addLink(key, () => ({ key, via: "dropped", name: dropped.name, links: [] }), link);
      }
      if (!input.drive) return problem(`not dropped, and ${input.driveReason}`);
      let hits = input.drive.filter((f) => f.name === name);
      if (!hits.length) hits = input.drive.filter((f) => f.name.toLowerCase() === name.toLowerCase());
      if (hits.length > 1) return problem(`${hits.length} Drive files share this name`);
      const file = hits[0];
      if (!file) return problem("not dropped and not in Peak Product Photos");
      if (HEIC_MIME.has(file.mimeType)) return problem(HEIC_REASON);
      if (file.size > MAX_PART_IMAGE_BYTES) return problem(OVER_CAP_REASON);
      if (imgs.some((img) => driveIdOf(img) === file.id)) return skip();
      const key = `drive:${file.id}`;
      return addLink(key, () => ({ key, via: "drive", file, existingId: input.imageByDriveId.get(file.id) ?? null, links: [] }), link);
    });
  }
  return plan;
}

export function planCounts(plan: PhotoSheetPlan): { add: number; skip: number; problems: number } {
  return { add: plan.docs.reduce((n, d) => n + d.links.length, 0), skip: plan.skipped.length, problems: plan.problems.length };
}

/** Status column text per row for the results sheet: problems and failures
 *  by slot (a row problem first), then "Added N", then "Skipped N (already attached)". */
export function resultStatuses(plan: PhotoSheetPlan, outcomes: readonly SheetDocOutcome[]): Map<number, string> {
  const byKey = new Map(outcomes.map((o) => [o.key, o] as const));
  const acc = new Map<number, { added: number; skipped: number; notes: Array<{ slot: number; text: string }> }>();
  const at = (n: number) => {
    let a = acc.get(n);
    if (!a) acc.set(n, (a = { added: 0, skipped: 0, notes: [] }));
    return a;
  };
  for (const p of plan.problems) at(p.rowNumber).notes.push({ slot: p.slot ?? 0, text: p.slot ? `Photo ${p.slot}: ${p.reason}` : p.reason });
  for (const s of plan.skipped) at(s.rowNumber).skipped++;
  for (const d of plan.docs) {
    const o = byKey.get(d.key);
    for (const l of d.links) {
      if (o?.ok) at(l.rowNumber).added++;
      else at(l.rowNumber).notes.push({ slot: l.slot, text: `Photo ${l.slot}: ${o ? o.error || "failed" : "not imported"}` });
    }
  }
  const out = new Map<number, string>();
  for (const [row, a] of acc) {
    const parts = a.notes.sort((x, y) => x.slot - y.slot).map((n) => n.text);
    if (a.added) parts.push(`Added ${a.added}`);
    if (a.skipped) parts.push(`Skipped ${a.skipped} (already attached)`);
    out.set(row, parts.join("; "));
  }
  return out;
}
```

- [ ] **Step 4: Run tests** — `npm run test:specs 2>&1 | grep -E "photo sheet|FAIL|ALL PASSED|FAILED"` → all PASS.

- [ ] **Step 5: Gates + commit**

```bash
npx tsc --noEmit && npx eslint src/lib/part-docs/photo-sheet-plan.ts
git add src/lib/part-docs/photo-sheet-plan.ts scripts/test-review-and-spec.ts
git commit -m "feat(catalog): photo sheet planner + result statuses"
```

---

### Task 3: Drive sync leaves sheet files alone + Drive helpers for the sheet

**Files:**
- Modify: `src/lib/part-docs/drive-photo-plan.ts:46-51` (signature) and the loop
- Modify: `src/lib/part-docs/drive-photo-sync.ts` (claims in `runSync`; two new exports)
- Test: append to `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `sheetDriveClaims` (Task 1).
- Produces:
  - `planDrivePhotoSync(listing, files, matchOf, maxBytes, claimed?: ReadonlySet<string>)` — a claimed file id counts as `unchanged`.
  - `listDrivePhotosForSheet(): Promise<{ files: DriveListedPhoto[] } | { files: null; reason: string }>`
  - `drivePhotosToken(): Promise<string | null>`

- [ ] **Step 1: Failing test** — append:

```ts
/* ======================================================================
   Photo sheet — the Drive sync leaves sheet-imported Drive files alone.
   ====================================================================== */
import { planDrivePhotoSync as phsDrivePlan } from "@/lib/part-docs/drive-photo-plan";
{
  const listing = [{ id: "c1", name: "PHSALPHA01.jpg", mimeType: "image/jpeg", md5: "m", size: 10, webViewLink: "https://drive/c1" }];
  const hit = () => ({ confidence: "high" as const, skus: ["X"] });
  const free = phsDrivePlan(listing, {}, hit, 25 * 1024 * 1024);
  const claimed = phsDrivePlan(listing, {}, hit, 25 * 1024 * 1024, new Set(["c1"]));
  ok(free.imports.length === 1 && claimed.imports.length === 0 && claimed.unchanged === 1 && claimed.unmatched.length === 0,
    "photo sheet: a Drive file a sheet imported is never imported again by the Drive sync");
}
```

- [ ] **Step 2: Run** — expect that line to FAIL (`claimed.imports.length === 1`). (TS accepts the 5th arg only after Step 3; `tsx` doesn't type-check, so the run itself proceeds.)

- [ ] **Step 3: Implement**

`drive-photo-plan.ts` — signature and first lines of the loop:

```ts
export function planDrivePhotoSync(
  listing: readonly DriveListedPhoto[],
  files: Readonly<Record<string, DrivePhotoFileState>>,
  matchOf: (name: string) => PhotoMatch,
  maxBytes: number,
  /** Drive file ids a photo-sheet import owns (`sheetDriveClaims`) — left alone. */
  claimed: ReadonlySet<string> = new Set()
): DrivePhotoPlan {
```

and right after `seen.add(photo.id);`:

```ts
    if (claimed.has(photo.id)) { plan.unchanged++; continue; }
```

Add rule 0 to the header comment: `0. Claimed by a photo-sheet import (sheetDriveClaims) → unchanged.`

`drive-photo-sync.ts`:
- imports: add `allDocuments` to the `@/lib/stores/part-documents` import, and `import { sheetDriveClaims } from "./photo-sheet";`
- in `runSync`, replace the `const plan = planDrivePhotoSync(...)` line with:

```ts
  const claimed = sheetDriveClaims(await allDocuments());
  const plan = planDrivePhotoSync(listing, state.files, (name) => matchByName.get(name) ?? { confidence: "none", skus: [] }, MAX_PART_IMAGE_BYTES, claimed);
```

- append these exports after `resolveToken`:

```ts
/** The Drive photos account's token for a photo-sheet import, or null. */
export async function drivePhotosToken(): Promise<string | null> {
  const t = await resolveToken();
  return "token" in t ? t.token : null;
}

/** The Peak Product Photos listing for a photo-sheet plan or export. Never
 *  writes sync state; a reason (lower-case, reads after "not dropped, and")
 *  instead of a listing when Drive can't be read. */
export async function listDrivePhotosForSheet(): Promise<{ files: DriveListedPhoto[] } | { files: null; reason: string }> {
  const t = await resolveToken();
  if ("error" in t) return { files: null, reason: "Drive photos aren't connected" };
  try {
    const state = await getDrivePhotoSyncState();
    let folder = state.folder ? await getDriveFolder(t.token, state.folder.id) : null;
    if (!folder) {
      const found = await findPhotosFolder(t.token);
      if (!found.ok) return { files: null, reason: "the Peak Product Photos folder wasn't found" };
      folder = found.folder;
    }
    return { files: await listPhotoTree(t.token, folder.id) };
  } catch {
    return { files: null, reason: "Peak Product Photos couldn't be read" };
  }
}
```

- [ ] **Step 4: Run** — `npm run test:specs 2>&1 | grep -E "photo sheet|#283 sync|FAIL|ALL PASSED|FAILED"` → all PASS (the existing #283 sync checks must stay green).

- [ ] **Step 5: Gates + commit**

```bash
npx tsc --noEmit && npx eslint src/lib/part-docs/drive-photo-plan.ts src/lib/part-docs/drive-photo-sync.ts
git add src/lib/part-docs/drive-photo-plan.ts src/lib/part-docs/drive-photo-sync.ts scripts/test-review-and-spec.ts
git commit -m "feat(catalog): Drive photo sync leaves sheet-imported files alone"
```

---

### Task 4: Server I/O — read/write the workbook, load context, build the export

**Files:**
- Create: `src/lib/part-docs/photo-sheet-io.ts`
- Test: append to `scripts/test-review-and-spec.ts` (async block + chain line)

**Interfaces:**
- Consumes: Task 1 (`rowsToGrid`, `exportRows`, `buildPartMatcher`, `PHOTO_SHEET_NAME`, `SheetImage`, `driveIdOf`), Task 3 (`listDrivePhotosForSheet`), `cellText` (`@/lib/import/xlsx-to-csv`), `parseCsv` (`@/app/(app)/import/parse`), `buildImageIndex` (`./views`), stores.
- Produces:
  - `type ListDrive = () => Promise<{ files: DriveListedPhoto[] } | { files: null; reason: string }>`
  - `readSheetFile(buf: Buffer, fileName: string): Promise<{ ok: true; grid: string[][] } | { ok: false; error: string }>`
  - `writePhotoSheet(rows: readonly PhotoSheetRow[], statuses?: ReadonlyMap<number, string>): Promise<Buffer>`
  - `type PhotoSheetContext = { parts: CatalogPart[]; match: PartMatcher; imagesBySku: Map<string, SheetImage[]>; imageByUrl: Map<string, string>; imageByDriveId: Map<string, string>; drive: DriveListedPhoto[] | null; driveReason: string; driveNames: Map<string, string> }`
  - `loadPhotoSheetContext(listDrive?: ListDrive): Promise<PhotoSheetContext>`
  - `buildPhotoSheetExport(listDrive?: ListDrive): Promise<PhotoSheetRow[]>`

- [ ] **Step 1: Failing test** — append the block, and add `.then(() => photoSheetIoAsyncChecks())` to the chain right after `.then(() => packages289AsyncChecks())`:

```ts
/* ======================================================================
   Photo sheet — workbook I/O, context and export (PGlite).
   ====================================================================== */
import { readSheetFile as phsRead, writePhotoSheet as phsWrite, loadPhotoSheetContext as phsCtx, buildPhotoSheetExport as phsBuildExport } from "@/lib/part-docs/photo-sheet-io";
import { getBlob as phsGetBlob, setBlob as phsSetBlob } from "@/db/doc-store";
async function photoSheetIoAsyncChecks(): Promise<void> {
  const rows = phsExport(PHS_PARTS, new Set(["SKU-A", "SKU-B"]), new Map(), new Map());
  const buf = await phsWrite(rows, new Map([[2, "Added 1"]]));
  const back = await phsRead(buf, "sheet.xlsx");
  const parsed = back.ok ? phsRows(back.grid) : null;
  ok(!!parsed && parsed.ok && parsed.rows.length === 2 && parsed.rows[0].sku === rows[0].sku && parsed.rows[0].status === "Added 1" && parsed.rows[1].mfrPart === "S4-ALPHA",
    "photo sheet io: an exported workbook reads back the same rows (status override applied)");
  const csv = await phsRead(Buffer.from("SKU,Photo 1\nSKU-D,https://m/d.jpg\n"), "sheet.csv");
  ok(csv.ok && csv.grid[0].join() === "SKU,Photo 1" && csv.grid[1][1] === "https://m/d.jpg", "photo sheet io: a .csv reads into the same grid shape");
  const junk = await phsRead(Buffer.from("not a workbook"), "x.xlsx");
  ok(!junk.ok, "photo sheet io: an unreadable workbook is refused");

  const ALPHA = fixtureId("PHS", "IO-ALPHA");
  await upsertPart({ id: ALPHA, sku: ALPHA, desc: "PHS io alpha", category: "PhsIoCat", unit: "ea", list: 10, cost: 5, mfr: "PhsMfr", manufacturerPartNumber: "PHSIOALPHA01" });
  registerFixture("catalog_parts", ALPHA);
  const noDrive = async () => ({ files: null, reason: "Drive photos aren't connected" }) as const;
  const ctx = await phsCtx(noDrive);
  const mm = ctx.match({ manufacturer: "phsmfr", mfrPart: "PHSIOALPHA01", sku: "" });
  ok(mm.kind === "matched" && mm.sku === ALPHA && ctx.drive === null && ctx.driveReason === "Drive photos aren't connected", "photo sheet io: the context matches catalog parts and carries the Drive reason");

  // Written straight to the blob: saveDepartments validates categories against
  // the cached portal index, which a fresh fixture part isn't in.
  const prev = await phsGetBlob<Record<string, unknown>>("portal_departments", {});
  try {
    const before = await phsBuildExport(noDrive);
    ok(!before.some((r) => r.sku === ALPHA), "photo sheet export: an unquoted part outside any portal department is left out");
    await phsSetBlob("portal_departments", { departments: [{ id: "phs-dept", name: "PHS Dept", categories: ["PhsIoCat"] }] });
    const after = await phsBuildExport(noDrive);
    const row = after.find((r) => r.sku === ALPHA);
    ok(!!row && row.status === "Missing" && row.mfrPart === "PHSIOALPHA01" && row.manufacturer === "PhsMfr", "photo sheet export: a part in a portal department is listed, Missing");
  } finally {
    await phsSetBlob("portal_departments", { departments: prev.departments ?? [] });
  }
}
```

- [ ] **Step 2: Run** → module-not-found for `photo-sheet-io`.

- [ ] **Step 3: Implement `src/lib/part-docs/photo-sheet-io.ts`**

```ts
// SERVER ONLY — exceljs + stores. Never import from a "use client" file.
import ExcelJS from "exceljs";
import { parseCsv } from "@/app/(app)/import/parse";
import type { DriveListedPhoto } from "@/lib/google/drive-photos";
import { cellText } from "@/lib/import/xlsx-to-csv";
import { departmentOfCategory } from "@/lib/portal-departments";
import { list as listCatalog, type CatalogPart } from "@/lib/stores/catalog";
import { allGeneratedSpecs } from "@/lib/stores/generated-specs";
import { listProjects } from "@/lib/stores/grid-projects";
import { allDocumentLinks, allDocuments } from "@/lib/stores/part-documents";
import { getDepartments } from "@/lib/stores/portal-departments";
import { getAll as allQuotes } from "@/lib/stores/quotes";
import { listDrivePhotosForSheet } from "./drive-photo-sync";
import { buildPartMatcher, driveIdOf, exportRows, PHOTO_SHEET_HEADERS, PHOTO_SHEET_NAME, rowsToGrid, type PartMatcher, type PhotoSheetRow, type SheetImage } from "./photo-sheet";
import { quotedPartStats } from "./quoted-parts";
import { buildImageIndex } from "./views";

/**
 * Catalog photo sheet — the server half's I/O: read an uploaded .xlsx/.csv
 * into a grid, write the workbook, and load everything a plan needs (the
 * catalog matcher, each part's real images, the Drive listing).
 */

export type ListDrive = () => Promise<{ files: DriveListedPhoto[] } | { files: null; reason: string }>;

export async function readSheetFile(buf: Buffer, fileName: string): Promise<{ ok: true; grid: string[][] } | { ok: false; error: string }> {
  if (/\.(csv|tsv|txt)$/i.test(fileName)) {
    const t = parseCsv(buf.toString("utf8"));
    if (!t.ok) return { ok: false, error: t.error || "That CSV couldn't be read." };
    return { ok: true, grid: [t.headers, ...t.rows] };
  }
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  } catch {
    return { ok: false, error: "That file couldn't be read as an Excel workbook or CSV." };
  }
  const ws = wb.worksheets.find((w) => w.name === PHOTO_SHEET_NAME) ?? wb.worksheets[0];
  if (!ws) return { ok: false, error: "That workbook has no sheets." };
  const grid: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cells[col - 1] = cellText(cell.value);
    });
    for (let i = 0; i < cells.length; i++) cells[i] ??= "";
    grid[n - 1] = cells;
  });
  for (let i = 0; i < grid.length; i++) grid[i] ??= [];
  return { ok: true, grid };
}

/** One "Photos" sheet: bold, frozen header; widths sized for the content. */
export async function writePhotoSheet(rows: readonly PhotoSheetRow[], statuses?: ReadonlyMap<number, string>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(PHOTO_SHEET_NAME);
  for (const line of rowsToGrid(rows, statuses)) ws.addRow(line);
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const widths: Record<string, number> = { Manufacturer: 18, "MFR Part #": 20, SKU: 22, Description: 40, Category: 16, "Photos now": 11, "Photo 1": 40, "Photo 2": 40, "Photo 3": 40, Status: 40 };
  PHOTO_SHEET_HEADERS.forEach((h, i) => (ws.getColumn(i + 1).width = widths[h]));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export type PhotoSheetContext = {
  parts: CatalogPart[];
  match: PartMatcher;
  imagesBySku: Map<string, SheetImage[]>;
  imageByUrl: Map<string, string>;
  imageByDriveId: Map<string, string>;
  drive: DriveListedPhoto[] | null;
  driveReason: string;
  driveNames: Map<string, string>;
};

export async function loadPhotoSheetContext(listDrive: ListDrive = listDrivePhotosForSheet): Promise<PhotoSheetContext> {
  const [parts, documents, links, driveList] = await Promise.all([listCatalog(), allDocuments(), allDocumentLinks(), listDrive()]);
  const docsById = new Map(documents.map((d) => [d.id, d] as const));
  const imagesBySku = new Map<string, SheetImage[]>();
  for (const [sku, refs] of buildImageIndex(documents, links)) {
    const real: SheetImage[] = [];
    for (const r of refs) {
      const d = docsById.get(r.id);
      if (!d || d.source === "datasheet-render") continue;
      real.push({ id: d.id, source: d.source, sourceUrl: d.sourceUrl, ...(d.sourceRef ? { sourceRef: d.sourceRef } : {}), fileName: d.fileName });
    }
    if (real.length) imagesBySku.set(sku, real);
  }
  const imageByUrl = new Map<string, string>();
  const imageByDriveId = new Map<string, string>();
  for (const d of documents) {
    if (d.kind !== "image" || d.source === "datasheet-render") continue;
    if (d.sourceUrl && !imageByUrl.has(d.sourceUrl)) imageByUrl.set(d.sourceUrl, d.id);
    const drive = driveIdOf(d);
    if (drive && !imageByDriveId.has(drive)) imageByDriveId.set(drive, d.id);
  }
  const drive = driveList.files;
  return {
    parts,
    match: buildPartMatcher(parts),
    imagesBySku,
    imageByUrl,
    imageByDriveId,
    drive,
    driveReason: driveList.files ? "" : driveList.reason,
    driveNames: new Map((drive ?? []).map((f) => [f.id, f.name] as const)),
  };
}

/** Export rows: every part quoted anywhere or in a portal department. */
export async function buildPhotoSheetExport(listDrive: ListDrive = listDrivePhotosForSheet): Promise<PhotoSheetRow[]> {
  const [ctx, quotes, gridProjects, generated, departments] = await Promise.all([loadPhotoSheetContext(listDrive), allQuotes(), listProjects(), allGeneratedSpecs(), getDepartments()]);
  const bySku = new Map(ctx.parts.map((p) => [p.sku, p] as const));
  const stats = quotedPartStats({ quotes, gridProjects, generated }, (sku) => {
    const p = bySku.get(sku);
    return !!p && p.category !== "Labor";
  });
  const deptCats = departmentOfCategory(departments);
  const include = new Set<string>([...stats.keys()]);
  for (const p of ctx.parts) if (deptCats.has(p.category)) include.add(p.sku);
  return exportRows(ctx.parts, include, ctx.imagesBySku, ctx.driveNames);
}
```

(`quotedPartStats` returns `Map<sku, QuotedPartStat>`; `CatalogPart` carries `desc`, `category`, `mfr`, `manufacturerPartNumber`, `manufacturerModelNumber` at `src/lib/stores/catalog.ts:74-78`, so it satisfies `SheetPart`.)

- [ ] **Step 4: Run** — `npm run test:specs 2>&1 | grep -E "photo sheet|FAIL|ALL PASSED|FAILED"` → all PASS.

- [ ] **Step 5: Gates + commit**

```bash
npx tsc --noEmit && npx eslint src/lib/part-docs/photo-sheet-io.ts
git add src/lib/part-docs/photo-sheet-io.ts scripts/test-review-and-spec.ts
git commit -m "feat(catalog): photo sheet workbook I/O, context and export rows"
```

---

### Task 5: The executor — URL + Drive lane, placement

**Files:**
- Create: `src/lib/part-docs/photo-sheet-import.ts`
- Test: append to `scripts/test-review-and-spec.ts` (async block + chain line after `photoSheetIoAsyncChecks`)

**Interfaces:**
- Consumes: Tasks 1–4; `fetchImageBytes`, `shrinkImage`/`webpFileName`, `sniffImageType`/`fileNameForFetched`, `downloadDriveFile`/`DOWNLOAD_TIMEOUT_MS`, `drivePhotosToken`, `createDocument`/`attachDocument`/`documentLinksForParts`/`getDocuments`/`setImageOrder`, `putBlob`/`deleteBlob`/`blobEnabled`, `invalidatePortalIndex`.
- Produces:
  - `placeSheetImage(documentId: string, sku: string, primary: boolean): Promise<void>`
  - `type PhotoSheetDeps = { listDrive?: ListDrive; downloadDrive?: (fileId: string, timeoutMs: number) => Promise<Uint8Array>; fetchImage?: (url: string) => ReturnType<typeof fetchImageBytes>; putFile?: (pathname: string, bytes: Buffer, contentType: string) => Promise<{ pathname: string }>; clock?: () => number; now?: () => number }`
  - `type SheetBatchInput = { rows: ImportRow[]; dropped: DroppedFile[]; failedKeys: string[] }`
  - `type SheetBatchResult = { ok: true; outcomes: SheetDocOutcome[]; remaining: number } | { ok: false; error: string }`
  - `runPhotoSheetBatch(input: SheetBatchInput, by: string, budgetMs: number, deps?: PhotoSheetDeps): Promise<SheetBatchResult>`

- [ ] **Step 1: Failing test** — append, and add `.then(() => photoSheetImportAsyncChecks())` after `.then(() => photoSheetIoAsyncChecks())`:

```ts
/* ======================================================================
   Photo sheet — executor (PGlite + fake fetch/Drive/Blob).
   ====================================================================== */
import { runPhotoSheetBatch as phsRun } from "@/lib/part-docs/photo-sheet-import";
import { visibleImagesForParts as phsVisible, createDocument as phsCreateDoc, attachDocument as phsAttach, allDocuments as phsAllDocs } from "@/lib/stores/part-documents";
async function photoSheetImportAsyncChecks(): Promise<void> {
  const ALPHA = fixtureId("PHS", "X-ALPHA");
  const BRAVO = fixtureId("PHS", "X-BRAVO");
  for (const [id, mpn] of [[ALPHA, "PHSXALPHA01"], [BRAVO, "PHSXBRAVO01"]] as const) {
    await upsertPart({ id, sku: id, desc: `PHS ${mpn}`, category: "Lighting", unit: "ea", list: 10, cost: 5, mfr: "PhsMfr", manufacturerPartNumber: mpn });
    registerFixture("catalog_parts", id);
  }
  const old = await phsCreateDoc({ kind: "image", fileName: "old.webp", contentType: "image/webp", size: 1, blobKey: null, sourceUrl: null, source: "upload", by: "PHS test" });
  if (old) { registerFixture("part_documents", old.id); await phsAttach(old.id, [ALPHA], "PHS test"); }

  const jpeg = new Uint8Array(await s283Sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#06c" } }).jpeg().toBuffer());
  const fetched: string[] = [];
  const fetchImage = async (url: string) => {
    fetched.push(url);
    if (url.endsWith("/gone.jpg")) return { ok: false as const, error: "The link returned HTTP 404." };
    if (url.endsWith("/page")) return { ok: true as const, file: { bytes: new TextEncoder().encode("<html></html>"), contentDisposition: null, finalUrl: url } };
    return { ok: true as const, file: { bytes: jpeg, contentDisposition: null, finalUrl: url } };
  };
  const listDrive = async () => ({ files: [{ id: "PHSd1", name: "bravo front.jpg", mimeType: "image/jpeg", md5: "m", size: jpeg.byteLength, webViewLink: "https://drive/PHSd1" }] });
  const stored: string[] = [];
  const deps = {
    fetchImage, listDrive,
    downloadDrive: async () => jpeg,
    putFile: async (p: string) => { stored.push(p); return { pathname: p }; },
    now: () => 1_700_000_000_000,
  };
  const grid = (lines: string[][]) => { const p = phsRows([PHS_H, ...lines]); return phsImportRows(p.ok ? p.rows : []); };
  const rows = grid([
    ["PhsMfr", "PHSXALPHA01", "", "", "", "", "https://img.test/alpha.jpg", "https://img.test/gone.jpg", "", ""],
    ["PhsMfr", "PHSXBRAVO01", "", "", "", "", "bravo front.jpg", "https://img.test/page", "https://img.test/alpha.jpg", ""],
  ]);
  const order = async (sku: string) => ((await phsVisible([sku])).get(sku) ?? []).map((d) => d.id);
  const docsBefore = (await phsAllDocs()).length;
  try {
    const r1 = await phsRun({ rows, dropped: [], failedKeys: [] }, "PHS test", 45_000, deps);
    ok(r1.ok && r1.remaining === 0 && r1.outcomes.length === 4 && r1.outcomes.filter((o) => o.ok).length === 2, "photo sheet import: two photos land, two fail, nothing remains");
    const out = (key: string) => (r1.ok ? r1.outcomes.find((o) => o.key === key) : undefined);
    ok(out("url:https://img.test/gone.jpg")?.error === "The link returned HTTP 404." && out("url:https://img.test/page")?.error === "That link is not a PNG, JPEG, or WebP image.",
      "photo sheet import: a failed fetch and a non-image keep their reasons and don't stop the batch");
    const alphaId = out("url:https://img.test/alpha.jpg")?.documentId ?? "";
    const driveId = out("drive:PHSd1")?.documentId ?? "";
    for (const id of [alphaId, driveId]) if (id) registerFixture("part_documents", id);
    ok(fetched.filter((u) => u.endsWith("/alpha.jpg")).length === 1, "photo sheet import: a URL on two rows is fetched once");
    const all = await phsAllDocs();
    const a = all.find((d) => d.id === alphaId);
    const dr = all.find((d) => d.id === driveId);
    ok(!!a && a.source === "sheet" && a.sourceUrl === "https://img.test/alpha.jpg" && a.contentType === "image/webp" && a.fileName.endsWith(".webp"), "photo sheet import: a URL photo is a shrunk WebP, source sheet");
    ok(!!dr && dr.source === "sheet" && dr.sourceRef === "drive:PHSd1" && dr.sourceUrl === "https://drive/PHSd1", "photo sheet import: a Drive photo records its Drive file");
    ok((await order(ALPHA)).join() === [alphaId, old?.id].join(), "photo sheet import: a new Photo 1 becomes the part's primary");
    ok((await order(BRAVO)).join() === [driveId, alphaId].join(), "photo sheet import: Photo 3 appends after Photo 1; the shared photo links to both parts");
    ok(stored.length === 2 && stored.every((p) => p.startsWith("part-docs/")), "photo sheet import: two files stored under part-doc paths");

    const failedKeys = r1.ok ? r1.outcomes.filter((o) => !o.ok).map((o) => o.key) : [];
    const r2 = await phsRun({ rows, dropped: [], failedKeys }, "PHS test", 45_000, deps);
    ok(r2.ok && r2.outcomes.length === 0 && r2.remaining === 0 && (await phsAllDocs()).length === docsBefore + 2, "photo sheet import: a re-import skips what landed and creates nothing");

    let t = 0;
    const slow = { ...deps, clock: () => (t += 40_000) };
    const more = grid([["PhsMfr", "PHSXALPHA01", "", "", "", "", "", "", "https://img.test/a2.jpg", ""], ["PhsMfr", "PHSXBRAVO01", "", "", "", "", "", "https://img.test/b2.jpg", "", ""]]);
    const r3 = await phsRun({ rows: more, dropped: [], failedKeys: [] }, "PHS test", 45_000, slow);
    ok(r3.ok && r3.outcomes.length === 1 && r3.remaining === 1, "photo sheet import: the budget stops a batch after the first photo");
    const r4 = await phsRun({ rows: more, dropped: [], failedKeys: [] }, "PHS test", 45_000, deps);
    ok(r4.ok && r4.outcomes.length === 1 && r4.outcomes[0].ok && r4.remaining === 0, "photo sheet import: the next call picks up the rest");
    for (const o of [...(r3.ok ? r3.outcomes : []), ...(r4.ok ? r4.outcomes : [])]) if (o.documentId) registerFixture("part_documents", o.documentId);
  } finally {
    // fixture rows are torn down by teardownFixtures()
  }
}
```

(`s283Sharp` is the harness's existing `sharp` default-import alias (line ~40570); `"part_documents"` is a valid `CollectionName`.)

- [ ] **Step 2: Run** → module-not-found for `photo-sheet-import`.

- [ ] **Step 3: Implement `src/lib/part-docs/photo-sheet-import.ts`**

```ts
// SERVER ONLY — the photo-sheet import's server lane (URL + Drive items).
import { blobEnabled, deleteBlob, putBlob } from "@/lib/blob";
import { DOWNLOAD_TIMEOUT_MS, downloadDriveFile } from "@/lib/google/drive-photos";
import { invalidatePortalIndex } from "@/lib/portal-catalog-index";
import { attachDocument, createDocument, documentLinksForParts, getDocuments, setImageOrder } from "@/lib/stores/part-documents";
import { drivePhotosToken } from "./drive-photo-sync";
import { fetchImageBytes } from "./fetch";
import { fileNameForFetched, sniffImageType } from "./files";
import { placeNewImage, type ImportRow } from "./photo-sheet";
import { loadPhotoSheetContext, type ListDrive } from "./photo-sheet-io";
import { planPhotoSheet, type DroppedFile, type PlannedDoc, type SheetDocOutcome } from "./photo-sheet-plan";
import { shrinkImage, webpFileName } from "./shrink";
import { MAX_PART_IMAGE_BYTES, newDocumentId, partDocBlobPath } from "./types";
import { buildImageIndex } from "./views";

/**
 * Catalog photo sheet — one import batch: re-plan from the rows (so a call
 * after a closed tab, or a second upload of the same sheet, only does what's
 * left), then fetch / download → shrink → store → link each URL or Drive
 * photo under the wall-clock budget. One photo's failure is that photo's
 * outcome; the batch carries on. Dropped files are the browser's lane
 * (uploadNewDocument with sheet provenance), never this one.
 */

/** A fetch + shrink + store rarely takes more than a few seconds; don't
 *  START another with less than this left (the first always runs). */
const PER_DOC_WORST_MS = 12_000;

export type PhotoSheetDeps = {
  listDrive?: ListDrive;
  downloadDrive?: (fileId: string, timeoutMs: number) => Promise<Uint8Array>;
  fetchImage?: (url: string) => ReturnType<typeof fetchImageBytes>;
  putFile?: (pathname: string, bytes: Buffer, contentType: string) => Promise<{ pathname: string }>;
  clock?: () => number;
  now?: () => number;
};
export type SheetBatchInput = { rows: ImportRow[]; dropped: DroppedFile[]; failedKeys: string[] };
export type SheetBatchResult = { ok: true; outcomes: SheetDocOutcome[]; remaining: number } | { ok: false; error: string };

/** Put a just-linked image where the sheet asked: front for Photo 1, else
 *  last among real photos. One order write (setImageOrder, D536). */
export async function placeSheetImage(documentId: string, sku: string, primary: boolean): Promise<void> {
  const links = (await documentLinksForParts([sku])).filter((l) => l.kind === "image");
  const docs = await getDocuments(links.map((l) => l.documentId));
  const ordered = buildImageIndex(docs, links).get(sku) ?? [];
  if (!ordered.some((i) => i.id === documentId)) return;
  await setImageOrder(sku, placeNewImage(ordered, documentId, primary));
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const titleOf = (name: string) => name.replace(/\.[A-Za-z0-9]{1,5}$/, "").trim();

export async function runPhotoSheetBatch(input: SheetBatchInput, by: string, budgetMs: number, deps: PhotoSheetDeps = {}): Promise<SheetBatchResult> {
  const clock = deps.clock ?? Date.now;
  const now = deps.now ?? Date.now;
  const deadline = clock() + Math.max(0, budgetMs);
  const put = deps.putFile ?? putBlob;
  if (!deps.putFile && !blobEnabled()) return { ok: false, error: "File storage isn't configured (no BLOB_READ_WRITE_TOKEN) — photos can't be stored on this deployment." };
  const fetchImage = deps.fetchImage ?? ((url: string) => fetchImageBytes(url));

  const ctx = await loadPhotoSheetContext(deps.listDrive);
  const plan = planPhotoSheet({
    rows: input.rows,
    match: ctx.match,
    imagesBySku: ctx.imagesBySku,
    imageByUrl: ctx.imageByUrl,
    imageByDriveId: ctx.imageByDriveId,
    dropped: input.dropped,
    drive: ctx.drive,
    driveReason: ctx.driveReason,
  });
  const failed = new Set(input.failedKeys);
  const work = plan.docs.filter((d): d is Exclude<PlannedDoc, { via: "dropped" }> => d.via !== "dropped" && !failed.has(d.key));

  let token: string | null | undefined;
  const downloadDrive = deps.downloadDrive ?? (async (fileId: string, timeoutMs: number) => {
    if (token === undefined) token = await drivePhotosToken();
    if (!token) throw new Error("Drive photos aren't connected");
    return downloadDriveFile(token, fileId, MAX_PART_IMAGE_BYTES, undefined, timeoutMs);
  });

  const link = async (documentId: string, d: PlannedDoc) => {
    const skus = [...new Set(d.links.map((l) => l.sku))];
    const primary = new Set(d.links.filter((l) => l.primary).map((l) => l.sku));
    await attachDocument(documentId, skus, by, now());
    for (const sku of skus) await placeSheetImage(documentId, sku, primary.has(sku));
  };

  const importOne = async (d: Exclude<PlannedDoc, { via: "dropped" }>): Promise<SheetDocOutcome> => {
    const fail = (error: string): SheetDocOutcome => ({ key: d.key, ok: false, error });
    if (d.existingId) {
      await link(d.existingId, d);
      return { key: d.key, ok: true, documentId: d.existingId };
    }
    let bytes: Uint8Array;
    let baseName: string;
    let sourceUrl: string | null;
    let sourceRef: string | undefined;
    if (d.via === "url") {
      const got = await fetchImage(d.url);
      if (!got.ok) return fail(got.error);
      const type = sniffImageType(got.file.bytes);
      if (!type) return fail("That link is not a PNG, JPEG, or WebP image.");
      bytes = got.file.bytes;
      baseName = fileNameForFetched(got.file.contentDisposition, got.file.finalUrl, "image", type === "image/png" ? "png" : type === "image/jpeg" ? "jpeg" : "webp");
      sourceUrl = d.url;
    } else {
      try {
        bytes = await downloadDrive(d.file.id, Math.min(DOWNLOAD_TIMEOUT_MS, Math.max(5_000, deadline + 10_000 - clock())));
      } catch (e) {
        return fail(`Drive download failed: ${errorText(e)}`);
      }
      baseName = d.file.name;
      sourceUrl = d.file.webViewLink || null;
      sourceRef = `drive:${d.file.id}`;
    }
    const shrunk = await shrinkImage(bytes);
    if (!shrunk.ok) return fail(shrunk.error);
    const documentId = newDocumentId();
    const fileName = webpFileName(baseName);
    const stored = await put(partDocBlobPath(documentId, fileName), shrunk.bytes, shrunk.contentType);
    const created = await createDocument({
      id: documentId,
      kind: "image",
      title: titleOf(baseName),
      fileName,
      contentType: shrunk.contentType,
      size: shrunk.bytes.byteLength,
      blobKey: stored.pathname,
      sourceUrl,
      source: "sheet",
      ...(sourceRef ? { sourceRef } : {}),
      by,
      at: now(),
    });
    if (!created) {
      if (!deps.putFile) await deleteBlob(stored.pathname).catch(() => undefined);
      return fail("Could not record the document.");
    }
    await link(created.id, d);
    return { key: d.key, ok: true, documentId: created.id };
  };

  const outcomes: SheetDocOutcome[] = [];
  let processed = 0;
  for (const d of work) {
    if (processed > 0 && deadline - clock() < PER_DOC_WORST_MS) break;
    processed++;
    try {
      outcomes.push(await importOne(d));
    } catch (e) {
      outcomes.push({ key: d.key, ok: false, error: `Stopped on this photo: ${errorText(e)}` });
    }
  }
  if (outcomes.some((o) => o.ok)) invalidatePortalIndex();
  return { ok: true, outcomes, remaining: work.length - processed };
}
```

Check `sniffImageType`'s return: it returns `"image/png" | "image/jpeg" | "image/webp" | null` (`files.ts:91`), and `fileNameForFetched`'s 4th arg is a `SniffedType` (`"png" | "jpeg" | "webp" | …`) — the mapping above mirrors `addImageFromUrlAction`.

- [ ] **Step 4: Run** — `npm run test:specs 2>&1 | grep -E "photo sheet|FAIL|ALL PASSED|FAILED"` → all PASS.

- [ ] **Step 5: Gates + commit**

```bash
npx tsc --noEmit && npx eslint src/lib/part-docs/photo-sheet-import.ts
git add src/lib/part-docs/photo-sheet-import.ts scripts/test-review-and-spec.ts
git commit -m "feat(catalog): photo sheet import executor (URL + Drive lane)"
```

---

### Task 6: Actions, export route, dropped-file provenance

**Files:**
- Create: `src/app/(app)/catalog/documents/photos/actions.ts`
- Create: `src/app/(app)/catalog/documents/photos/export/route.ts`
- Modify: `src/app/(app)/catalog/documents/actions.ts:124-165` (`attachUploadedDocumentAction`)
- Modify: `src/app/(app)/catalog/documents/upload-client.ts:55-63` (`uploadNewDocument`)
- Test: append a source check to `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces:
  - `planPhotoSheetAction(form: FormData): Promise<{ ok: true; rows: PhotoSheetRow[]; plan: PhotoSheetPlan; driveReason: string } | { ok: false; error: string }>` — form fields `sheet` (File), `dropped` (JSON `DroppedFile[]`)
  - `importPhotoSheetBatchAction(input: SheetBatchInput): Promise<SheetBatchResult>`
  - `photoSheetResultsAction(form: FormData): Promise<{ ok: true; base64: string; fileName: string } | { ok: false; error: string }>` — form fields `sheet` (File), `statuses` (JSON `Array<[number, string]>`)
  - `attachUploadedDocumentAction(input: { …existing; sheet?: { fileName: string; primarySkus: string[] } })`
  - `uploadNewDocument(file, kind, skus, opts?: { sheet?: { fileName: string; primarySkus: string[] } })`
  - GET `/catalog/documents/photos/export` → `Peak photo sheet <YYYY-MM-DD>.xlsx`

- [ ] **Step 1: Failing source check** — append:

```ts
/* ======================================================================
   Photo sheet — wiring (source checks; actions need a session).
   ====================================================================== */
{
  const src = (p: string) => readFileSync(p, "utf8");
  const acts = src("src/app/(app)/catalog/documents/photos/actions.ts");
  ok(/requirePerm\("create"\)/.test(acts) && acts.includes("MAX_SHEET_BYTES") && acts.includes("FETCH_ACTION_BUDGET_MS"), "photo sheet wiring: actions are create-gated, size-capped and budgeted");
  const route = src("src/app/(app)/catalog/documents/photos/export/route.ts");
  ok(route.includes("buildPhotoSheetExport") && route.includes("spreadsheetml"), "photo sheet wiring: the export route returns an xlsx");
  const attach = src("src/app/(app)/catalog/documents/actions.ts");
  ok(/source: sheet \? "sheet" : "upload"/.test(attach) && attach.includes("placeSheetImage"), "photo sheet wiring: a dropped sheet photo is recorded as source sheet and placed");
}
```

(`readFileSync` is imported at the top of the harness, line 242.)

- [ ] **Step 2: Run** → FAIL (files missing → `readFileSync` throws; that aborts the run — expected).

- [ ] **Step 3: `src/app/(app)/catalog/documents/photos/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { MAX_SHEET_BYTES, MAX_SHEET_ROWS, PHOTO_SLOTS, rowsFromGrid, type ImportRow, type PhotoSheetRow } from "@/lib/part-docs/photo-sheet";
import { loadPhotoSheetContext, readSheetFile, writePhotoSheet } from "@/lib/part-docs/photo-sheet-io";
import { runPhotoSheetBatch, type SheetBatchInput, type SheetBatchResult } from "@/lib/part-docs/photo-sheet-import";
import { planPhotoSheet, type DroppedFile, type PhotoSheetPlan } from "@/lib/part-docs/photo-sheet-plan";
import { FETCH_ACTION_BUDGET_MS } from "@/lib/part-docs/types";

/** Catalog → Datasheets → Photo sheet: plan, import batches, results sheet. */

async function readUploadedSheet(form: FormData): Promise<{ ok: true; rows: PhotoSheetRow[] } | { ok: false; error: string }> {
  const file = form.get("sheet");
  if (!(file instanceof File) || !file.size) return { ok: false, error: "Pick the filled photo sheet (.xlsx or .csv)." };
  if (file.size > MAX_SHEET_BYTES) return { ok: false, error: `That sheet is over ${Math.round(MAX_SHEET_BYTES / 1024)} KB — split it into smaller sheets.` };
  const read = await readSheetFile(Buffer.from(await file.arrayBuffer()), file.name);
  if (!read.ok) return read;
  return rowsFromGrid(read.grid);
}

function cleanDropped(raw: unknown): DroppedFile[] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((f) => ({ name: String((f as DroppedFile)?.name ?? "").slice(0, 255), size: Number((f as DroppedFile)?.size) || 0 }))
    .filter((f) => f.name)
    .slice(0, 2000);
}

function cleanRows(raw: unknown): ImportRow[] {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_SHEET_ROWS) : [];
  const s = (v: unknown) => String(v ?? "").slice(0, 2048);
  return list.map((r) => {
    const row = (r ?? {}) as Partial<ImportRow>;
    const photos = Array.isArray(row.photos) ? row.photos : [];
    return { rowNumber: Number(row.rowNumber) || 0, manufacturer: s(row.manufacturer), mfrPart: s(row.mfrPart), sku: s(row.sku), photos: Array.from({ length: PHOTO_SLOTS }, (_, i) => s(photos[i])) };
  });
}

export async function planPhotoSheetAction(form: FormData): Promise<{ ok: true; rows: PhotoSheetRow[]; plan: PhotoSheetPlan; driveReason: string } | { ok: false; error: string }> {
  await requirePerm("create");
  const parsed = await readUploadedSheet(form);
  if (!parsed.ok) return parsed;
  let dropped: DroppedFile[] = [];
  try {
    dropped = cleanDropped(JSON.parse(String(form.get("dropped") ?? "[]")));
  } catch {
    dropped = [];
  }
  const ctx = await loadPhotoSheetContext();
  const plan = planPhotoSheet({ rows: parsed.rows, match: ctx.match, imagesBySku: ctx.imagesBySku, imageByUrl: ctx.imageByUrl, imageByDriveId: ctx.imageByDriveId, dropped, drive: ctx.drive, driveReason: ctx.driveReason });
  return { ok: true, rows: parsed.rows, plan, driveReason: ctx.driveReason };
}

export async function importPhotoSheetBatchAction(input: SheetBatchInput): Promise<SheetBatchResult> {
  const user = await requirePerm("create");
  const r = await runPhotoSheetBatch(
    { rows: cleanRows(input?.rows), dropped: cleanDropped(input?.dropped), failedKeys: (Array.isArray(input?.failedKeys) ? input.failedKeys : []).map(String).slice(0, 10_000) },
    user.name,
    FETCH_ACTION_BUDGET_MS
  );
  if (r.ok && r.outcomes.some((o) => o.ok)) {
    revalidatePath("/catalog/documents");
    revalidatePath("/catalog");
  }
  return r;
}

/** The uploaded sheet again, Status filled per row — so it can be fixed and re-uploaded. */
export async function photoSheetResultsAction(form: FormData): Promise<{ ok: true; base64: string; fileName: string } | { ok: false; error: string }> {
  await requirePerm("create");
  const parsed = await readUploadedSheet(form);
  if (!parsed.ok) return parsed;
  let statuses = new Map<number, string>();
  try {
    const raw = JSON.parse(String(form.get("statuses") ?? "[]"));
    if (Array.isArray(raw)) statuses = new Map(raw.map((e) => [Number(e?.[0]) || 0, String(e?.[1] ?? "").slice(0, 2000)] as [number, string]));
  } catch {
    /* no statuses — the sheet comes back as uploaded */
  }
  const buf = await writePhotoSheet(parsed.rows, statuses);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
  return { ok: true, base64: buf.toString("base64"), fileName: `Peak photo sheet results ${day}.xlsx` };
}
```

- [ ] **Step 4: `src/app/(app)/catalog/documents/photos/export/route.ts`**

```ts
import { requirePerm } from "@/lib/session";
import { buildPhotoSheetExport, writePhotoSheet } from "@/lib/part-docs/photo-sheet-io";

/** Catalog photo sheet **export**: every quoted or portal-department part,
 *  missing-photo first, each Photo slot showing what's already there. */
export const maxDuration = 60;

export async function GET() {
  await requirePerm("create");
  const buf = await writePhotoSheet(await buildPhotoSheetExport());
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="Peak photo sheet ${day}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
```

- [ ] **Step 5: Dropped-file provenance**

In `src/app/(app)/catalog/documents/actions.ts`, add the import `import { placeSheetImage } from "@/lib/part-docs/photo-sheet-import";` and change `attachUploadedDocumentAction`:

```ts
export async function attachUploadedDocumentAction(input: {
  documentId: string;
  blobPathname: string;
  fileName: string;
  kind: PartDocKind;
  skus: string[];
  /** A photo-sheet dropped file (#photo sheet): recorded as source "sheet" and placed. */
  sheet?: { fileName: string; primarySkus: string[] };
}): Promise<DocActionResult<{ documentId: string; linked: number }>> {
```

and inside, replace the `createDocument({...})` call and the lines after it with:

```ts
  const sheet = input.kind === "image" && input.sheet && String(input.sheet.fileName || "").trim() ? input.sheet : null;
  const doc = await createDocument({
    id: input.documentId,
    kind: input.kind,
    ...file,
    sourceUrl: null,
    source: sheet ? "sheet" : "upload",
    ...(sheet ? { sourceRef: `file:${String(sheet.fileName).trim().slice(0, 255)}` } : {}),
    by: user.name,
  });
  if (!doc) return { ok: false, error: "That document already exists — use Replace." };
  const linked = await attachDocument(doc.id, skus, user.name);
  if (sheet) {
    const primary = new Set((sheet.primarySkus || []).map(String));
    for (const sku of skus) await placeSheetImage(doc.id, sku, primary.has(sku));
  }
  revalidate();
  return { ok: true, documentId: doc.id, linked };
```

In `upload-client.ts`:

```ts
/** A new shared document, linked to `skus`. `opts.sheet` marks a photo-sheet dropped file. */
export async function uploadNewDocument(
  file: File,
  kind: PartDocKind,
  skus: string[],
  opts: { sheet?: { fileName: string; primarySkus: string[] } } = {}
): Promise<Result<{ documentId: string }>> {
  const refused = preflight(file, kind);
  if (refused) return { ok: false, error: refused };
  const documentId = newDocumentId();
  const put = await putFile(file, documentId);
  if (!put.ok) return put;
  const r = await attachUploadedDocumentAction({ documentId, blobPathname: put.pathname, fileName: file.name, kind, skus, ...(opts.sheet ? { sheet: opts.sheet } : {}) });
  return r.ok ? { ok: true, documentId: r.documentId } : r;
}
```

- [ ] **Step 6: Run** — `npm run test:specs 2>&1 | grep -E "photo sheet|FAIL|ALL PASSED|FAILED"` → all PASS.

- [ ] **Step 7: Gates + commit** (include `next build` — `upload-client.ts` is imported by client components and now reaches `actions.ts` → `photo-sheet-import.ts`; server actions are fine across that boundary, but prove it):

```bash
npx tsc --noEmit && npx eslint "src/app/(app)/catalog/documents/photos" "src/app/(app)/catalog/documents/actions.ts" "src/app/(app)/catalog/documents/upload-client.ts"
npm run build 2>&1 | tail -5
git add "src/app/(app)/catalog/documents/photos/actions.ts" "src/app/(app)/catalog/documents/photos/export/route.ts" "src/app/(app)/catalog/documents/actions.ts" "src/app/(app)/catalog/documents/upload-client.ts" scripts/test-review-and-spec.ts
git commit -m "feat(catalog): photo sheet actions, export route, dropped-file provenance"
```

Expected build tail: a route table that includes `/catalog/documents/photos/export`, no errors. (Per the project's memory, clean up temp `tmp.*` PGlite dirs after build if `df` shows the disk filling.)

---

### Task 7: The page + client, entry link, smoke, docs

**Files:**
- Create: `src/app/(app)/catalog/documents/photos/page.tsx`
- Create: `src/app/(app)/catalog/documents/photos/photo-sheet-client.tsx`
- Modify: `src/app/(app)/catalog/documents/page.tsx` (header button row, ~line 118)
- Modify: `scripts/smoke-routes.ts` (after line 79)
- Modify: `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md`

**Interfaces:**
- Consumes: Task 6 actions, `uploadNewDocument`, pure `planCounts` / `resultStatuses` / `toImportRows` / `PhotoSheetRow` / `PhotoSheetPlan` / `SheetDocOutcome` / `MAX_SHEET_BYTES` (client-safe modules only).
- Produces: the `/catalog/documents/photos` page.

- [ ] **Step 1: `page.tsx`**

```tsx
import Link from "next/link";
import { requirePerm } from "@/lib/session";
import { blobEnabled } from "@/lib/blob";
import PhotoSheetClient from "./photo-sheet-client";

export const metadata = { title: "Photo sheet — Quartzite-6" };
// Import batches fetch, shrink and store under a 45 s budget (FETCH_ACTION_BUDGET_MS).
export const maxDuration = 60;

/** Catalog photo sheet: export the to-do list, fill in URLs or file names, import. */
export default async function PhotoSheetPage() {
  await requirePerm("create");
  return (
    <div className="pk-content" style={{ maxWidth: 1100 }}>
      <Link href="/catalog/documents" style={{ fontSize: 12.5, color: "#8c919c", textDecoration: "none" }}>← Datasheets</Link>
      <h1 style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em", margin: "7px 0 4px" }}>Photo sheet</h1>
      <p style={{ color: "#8c919c", fontSize: 13, margin: "0 0 16px", maxWidth: 760 }}>
        Download the sheet — every quoted or portal part, the ones missing a photo first. Put an image link or a photo&apos;s
        file name in Photo 1–3 (Photo 1 becomes the main photo), then upload it with any photos it names. Names not dropped
        here are looked up in the Peak Product Photos Drive folder. Nothing is ever removed.
      </p>
      {!blobEnabled() && (
        <div style={{ marginBottom: 14, padding: "10px 14px", borderRadius: 10, background: "#fdf3df", border: "1px solid #f3e0b5", color: "#9a6b12", fontSize: 12.5 }}>
          File storage isn&apos;t configured on this deployment (no BLOB_READ_WRITE_TOKEN) — imports will be refused.
        </div>
      )}
      <PhotoSheetClient />
    </div>
  );
}
```

- [ ] **Step 2: `photo-sheet-client.tsx`**

```tsx
"use client";

import { useMemo, useState } from "react";
import { MAX_SHEET_BYTES, toImportRows, type PhotoSheetRow } from "@/lib/part-docs/photo-sheet";
import { planCounts, resultStatuses, type PhotoSheetPlan, type SheetDocOutcome } from "@/lib/part-docs/photo-sheet-plan";
import { uploadNewDocument } from "../upload-client";
import { importPhotoSheetBatchAction, photoSheetResultsAction, planPhotoSheetAction } from "./actions";

/**
 * Photo sheet flow: pick the sheet (+ photos) → Preview (nothing written) →
 * Import (server lane in budgeted batches, then dropped files straight to
 * Blob) → summary + results sheet. Only file NAMES leave the browser until
 * Import, and only the photos the plan will use are uploaded.
 */

type Phase = "pick" | "planning" | "preview" | "importing" | "done";
const box: React.CSSProperties = { border: "1px solid #e6e8ee", borderRadius: 12, padding: 16, background: "#fff", marginBottom: 14 };
const label: React.CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 600, margin: "0 0 6px" };

export default function PhotoSheetClient() {
  const [phase, setPhase] = useState<Phase>("pick");
  const [sheet, setSheet] = useState<File | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [rows, setRows] = useState<PhotoSheetRow[]>([]);
  const [plan, setPlan] = useState<PhotoSheetPlan | null>(null);
  const [outcomes, setOutcomes] = useState<SheetDocOutcome[]>([]);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  const counts = useMemo(() => (plan ? planCounts(plan) : null), [plan]);
  const dropped = () => photos.map((f) => ({ name: f.name, size: f.size }));

  const preview = async () => {
    if (!sheet) return;
    if (sheet.size > MAX_SHEET_BYTES) return setError(`That sheet is over ${Math.round(MAX_SHEET_BYTES / 1024)} KB — split it into smaller sheets.`);
    setError("");
    setPhase("planning");
    const form = new FormData();
    form.set("sheet", sheet);
    form.set("dropped", JSON.stringify(dropped()));
    const r = await planPhotoSheetAction(form);
    if (!r.ok) {
      setError(r.error);
      setPhase("pick");
      return;
    }
    setRows(r.rows);
    setPlan(r.plan);
    setPhase("preview");
  };

  const runImport = async () => {
    if (!plan) return;
    setPhase("importing");
    const all: SheetDocOutcome[] = [];
    const importRows = toImportRows(rows);
    const failedKeys: string[] = [];
    for (;;) {
      setProgress(`Fetching linked and Drive photos… ${all.filter((o) => o.ok).length} done`);
      const r = await importPhotoSheetBatchAction({ rows: importRows, dropped: dropped(), failedKeys });
      if (!r.ok) {
        setError(r.error);
        break;
      }
      all.push(...r.outcomes);
      failedKeys.push(...r.outcomes.filter((o) => !o.ok).map((o) => o.key));
      setOutcomes([...all]);
      if (r.remaining === 0 || r.outcomes.length === 0) break;
    }
    const byName = new Map(photos.map((f) => [f.name.toLowerCase(), f] as const));
    const droppedDocs = plan.docs.filter((d) => d.via === "dropped");
    for (const [i, d] of droppedDocs.entries()) {
      if (d.via !== "dropped") continue;
      setProgress(`Uploading dropped photos… ${i + 1} of ${droppedDocs.length}`);
      const file = byName.get(d.name.toLowerCase());
      if (!file) {
        all.push({ key: d.key, ok: false, error: "the file is no longer selected" });
        continue;
      }
      const skus = [...new Set(d.links.map((l) => l.sku))];
      const primarySkus = [...new Set(d.links.filter((l) => l.primary).map((l) => l.sku))];
      const r = await uploadNewDocument(file, "image", skus, { sheet: { fileName: d.name, primarySkus } });
      all.push(r.ok ? { key: d.key, ok: true, documentId: r.documentId } : { key: d.key, ok: false, error: r.error });
      setOutcomes([...all]);
    }
    setOutcomes([...all]);
    setProgress("");
    setPhase("done");
  };

  const downloadResults = async () => {
    if (!sheet || !plan) return;
    const form = new FormData();
    form.set("sheet", sheet);
    form.set("statuses", JSON.stringify([...resultStatuses(plan, outcomes)]));
    const r = await photoSheetResultsAction(form);
    if (!r.ok) return setError(r.error);
    const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = r.fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setPhase("pick");
    setPlan(null);
    setRows([]);
    setOutcomes([]);
    setError("");
  };

  const added = plan ? plan.docs.filter((d) => outcomes.find((o) => o.key === d.key)?.ok).reduce((n, d) => n + d.links.length, 0) : 0;
  const failed = outcomes.filter((o) => !o.ok).length;

  return (
    <div>
      <div style={box}>
        <span style={label}>1. Get the sheet</span>
        <a href="/catalog/documents/photos/export" className="pk-btn-outline" style={{ textDecoration: "none" }}>Download photo sheet (.xlsx)</a>
      </div>

      <div style={box}>
        <span style={label}>2. Upload it, with any photos it names</span>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ fontSize: 12.5 }}>
            Filled sheet (.xlsx or .csv)
            <br />
            <input type="file" accept=".xlsx,.csv" disabled={phase === "planning" || phase === "importing"} onChange={(e) => { setSheet(e.target.files?.[0] ?? null); reset(); }} />
          </label>
          <label style={{ fontSize: 12.5 }}>
            Photos (optional — PNG, JPEG or WebP)
            <br />
            <input type="file" accept="image/png,image/jpeg,image/webp,.heic" multiple disabled={phase === "planning" || phase === "importing"} onChange={(e) => { setPhotos([...(e.target.files ?? [])]); reset(); }} />
          </label>
          <button type="button" className="pk-btn-accent" disabled={!sheet || phase === "planning" || phase === "importing"} onClick={preview}>
            {phase === "planning" ? "Checking…" : "Preview"}
          </button>
        </div>
        {!!photos.length && <p style={{ fontSize: 12, color: "#8c919c", margin: "8px 0 0" }}>{photos.length} photo{photos.length === 1 ? "" : "s"} selected — only the ones the sheet names are uploaded.</p>}
      </div>

      {error && <div style={{ ...box, background: "#fdecec", borderColor: "#f5c2c2", color: "#a12a2a", fontSize: 13 }}>{error}</div>}

      {plan && counts && (
        <div style={box}>
          <span style={label}>3. Review</span>
          <p style={{ fontSize: 13, margin: "0 0 10px" }}>
            <b>{counts.add}</b> photo{counts.add === 1 ? "" : "s"} to add · <b>{counts.skip}</b> already attached · <b>{counts.problems}</b> problem{counts.problems === 1 ? "" : "s"} · {plan.matched} of {rows.length} rows matched a part
          </p>
          {!!plan.problems.length && (
            <div style={{ maxHeight: 320, overflow: "auto", border: "1px solid #eef0f4", borderRadius: 8, marginBottom: 12 }}>
              <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "#8c919c" }}>
                    <th style={{ padding: "6px 8px" }}>Row</th><th style={{ padding: "6px 8px" }}>Slot</th><th style={{ padding: "6px 8px" }}>Value</th><th style={{ padding: "6px 8px" }}>Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.problems.slice(0, 300).map((p, i) => (
                    <tr key={i} style={{ borderTop: "1px solid #f2f3f6" }}>
                      <td style={{ padding: "5px 8px", fontFamily: "var(--font-mono)" }}>{p.rowNumber}</td>
                      <td style={{ padding: "5px 8px" }}>{p.slot ? `Photo ${p.slot}` : "—"}</td>
                      <td style={{ padding: "5px 8px", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.value}</td>
                      <td style={{ padding: "5px 8px" }}>{p.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {phase === "preview" && (
            <button type="button" className="pk-btn-accent" disabled={!counts.add} onClick={runImport}>
              Import {counts.add} photo{counts.add === 1 ? "" : "s"}
            </button>
          )}
          {phase === "importing" && <p style={{ fontSize: 13, margin: 0 }}>{progress || "Importing…"}</p>}
          {phase === "done" && (
            <div>
              <p style={{ fontSize: 13, margin: "0 0 10px" }}>
                Added <b>{added}</b> photo link{added === 1 ? "" : "s"}{failed ? <> · <b>{failed}</b> photo{failed === 1 ? "" : "s"} failed</> : null}. The results sheet has a Status for every row — fix any problems and upload it again.
              </p>
              <button type="button" className="pk-btn-outline" onClick={downloadResults}>Download results sheet</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Entry link** — in `src/app/(app)/catalog/documents/page.tsx`, inside the header button row, right before the `Upload many` link:

```tsx
          <Link href="/catalog/documents/photos" className="pk-btn-outline" style={{ textDecoration: "none" }}>Photo sheet</Link>
```

- [ ] **Step 4: Smoke** — in `scripts/smoke-routes.ts`, after the `"/catalog/documents/upload"` line:

```ts
  "/catalog/documents/photos", // photo sheet — export, upload, preview, import
  "/catalog/documents/photos/export", // photo sheet — the .xlsx download
```

- [ ] **Step 5: Gates**

```bash
npx tsc --noEmit
npx eslint "src/app/(app)/catalog/documents/photos" "src/app/(app)/catalog/documents/page.tsx" scripts/smoke-routes.ts
npm run test:specs 2>&1 | tail -2
npm run build 2>&1 | tail -5
```

Then `npm run test:smoke` per the project's protocol (stop any dev server first; it boots its own). Expected: both new routes 200, no new failures vs baseline.

- [ ] **Step 6: Manual check on a scratch datadir** (never `.data/pglite`): follow memory `peak-exercising-post-routes-safely.md` / `peak-worktree-dev-server-browser-verification-traps.md` to boot `next dev` on a temp `PGLITE_PATH` from the worktree, sign in with the dev picker, then: open `/catalog/documents/photos` → Download photo sheet → in the .xlsx put one public image URL in Photo 1 of a Missing row, the same URL in Photo 3 of another row, and a dropped file's name in Photo 1 of a third → upload with that photo → Preview shows 3 to add → Import → Download results sheet shows `Added 1` on each → upload the results sheet again → Preview shows 0 to add, 3 already attached. Screenshot the done state. (Local Blob uploads are unreliable per memory — if the dropped-file upload is refused locally, record that and rely on the harness for that lane.)

- [ ] **Step 7: Docs** — recompute numbers from `origin/main` right before writing (`git fetch && git show origin/main:PUNCHLIST.md | grep -oE "^## #[0-9]+" | tail -3` and the same for `^## D[0-9]+` in DECISIONS.md). Using the next free punch `#N` and decisions `D(a)…D(c)`:
  - `DECISIONS.md`: **D(a)** "Photo sheet: one row per part, Photo 1–3, Photo 1 = primary; rows match on Manufacturer + MFR P/N (or M/N) with SKU as tie-break, never guessed" · **D(b)** "A new image source `sheet` (`sourceRef` `drive:<id>` / `file:<name>`); the Drive photo sync treats sheet-claimed Drive files as unchanged so a file is never imported twice; an existing image document with the same URL or Drive file is linked, not re-fetched" · **D(c)** "Sheet ≤ 800 KB / 5000 rows (server-action body cap 1200 KB; the results sheet re-sends the file); import re-plans on every 45 s batch so it is resumable and a re-upload is a no-op; never deletes or replaces". Follow the existing entry format (`## D###. Title (#N, 2026-10-01)` + paragraph).
  - `PUNCHLIST.md`: `## #N` entry — Reported (Jeff, 2026-10-01: "an easy spreadsheet model for tracking and importing photos into the catalog, linked to manufacturer part number"), what shipped, Jeff-gated follow-up (export a real sheet in production and try one manufacturer; Drive-name cells need the #283 setup).
  - `AGENTS.md`: append phase item `32. ✅ **Catalog photo sheet** (#N, D(a)–D(c)) — …` in the style of items 26–31, three to five lines.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/catalog/documents/photos/page.tsx" "src/app/(app)/catalog/documents/photos/photo-sheet-client.tsx" "src/app/(app)/catalog/documents/page.tsx" scripts/smoke-routes.ts DECISIONS.md PUNCHLIST.md AGENTS.md
git commit -m "feat(catalog): photo sheet page — export, preview, import, results (#N)"
```

---

## Self-review notes (done while writing)

- **Spec coverage:** sheet columns/headers (T1), export row set + order + slot sources (T1, T4), matching (T1), file-name resolution order + Drive duplicates/HEIC/over-cap (T2), skip rules for all three source kinds + exported-value round trip (T2), shared-document collapse + existing-document link (T2, T5), budgeted resumable server lane (T5), dropped lane with provenance (T6, T7), Photo 1 front / Photo 2–3 append (T1, T5, T6), never-delete (no delete path anywhere), results sheet (T2 statuses, T6 action, T7 button), `sheet` source + label (T1), `create` gate (T6, T7), smoke + build (T6, T7), docs (T7). Drive-sync double-import guard (T3) closes a gap the spec implied but didn't spell out.
- **Deviation from spec, recorded in the spec itself:** sheet cap 800 KB instead of 1 MB; batch calls send only rows with photos.
- **Type names are consistent across tasks:** `PhotoSheetRow`, `ImportRow`, `SheetImage`, `PartMatcher`, `PlannedDoc`, `SheetDocOutcome`, `PhotoSheetPlan`, `ListDrive`, `PhotoSheetDeps`, `SheetBatchInput`, `SheetBatchResult`.
