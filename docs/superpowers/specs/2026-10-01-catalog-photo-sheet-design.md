# Catalog photo sheet — design

**Date:** 2026-10-01 · **Punch item:** next free number, recomputed from
`origin/main` right before the docs commit (#292/#293 are in flight in other
worktrees) · **Decisions:** next free D numbers, same rule.

## Goal

One spreadsheet, keyed by manufacturer part number, that (a) shows which
customer-facing parts still need a photo and (b) imports photos into the
catalog from either an image URL or a photo file name. The sheet round-trips:
export → fill in → import → export again shows what landed.

## What already exists (reused, not rebuilt)

- `src/lib/part-docs/filename-match.ts` — `normalizeSku` identifier keys
  (SKU / MFR P/N / MFR M/N), `MIN_MATCH_KEY = 4`.
- `src/lib/part-docs/fetch.ts` — `fetchImageBytes(url)` through the shared
  `guardedFetchBytes` SSRF guard.
- `src/lib/google/drive-photos.ts` — "Peak Product Photos" folder lookup,
  `listPhotoTree`, download; `drive-photo-sync.ts` stores
  `source: "drive", sourceRef: <Drive fileId>`.
- `src/lib/part-docs/shrink.ts` — every image → ≤1600 px WebP q80; HEIC refuses.
- `src/app/(app)/catalog/documents/upload-client.ts` — `uploadNewDocument`
  (preflight → direct-to-Blob → `attachUploadedDocumentAction`).
- `setImageOrder(sku, ids)` + `moveImageToFront` (D536) — the one image-order
  write and the primary front-move.
- `src/lib/part-docs/quoted-parts.ts` (`quotedPartStats`) and
  `src/lib/portal-departments.ts` (`departmentOfCategory`) — the two row
  sources.
- `src/lib/import/xlsx-to-csv.ts` — server-only exceljs reading.

## Where it lives

A new page, **Catalog → Datasheets → Photo sheet**, at
`/catalog/documents/photos`, linked from the Datasheets page header next to
Upload many. Export and Import on the same page. Requires `create`.

Not the Import/Export hub (its columnar preview → confirm has no file/fetch
step) and not a CLI script (no web access, no prod without a deploy).

## 1. The sheet

**Format:** `.xlsx` on export; `.xlsx` or `.csv` on import.

**Columns, in order:**

| Column | Export | Import |
|---|---|---|
| Manufacturer | part's manufacturer | match key |
| MFR Part # | part's MFR P/N | match key |
| SKU | part's SKU | tie-break key |
| Description | part's description | ignored |
| Category | part's category | ignored |
| Photos now | count of the part's real images (not datasheet-render thumbnails) | ignored |
| Photo 1 | source of the part's 1st real image, else blank | URL or file name |
| Photo 2 | source of the 2nd, else blank | URL or file name |
| Photo 3 | source of the 3rd, else blank | URL or file name |
| Status | `Missing` · `Has N` | ignored on import; filled on the results sheet |

Headers match case-insensitively with surrounding whitespace trimmed; any
other column is ignored.

**Rows on export:** every part that has been quoted (`quotedPartStats`) **or**
whose category belongs to a portal department (`departmentOfCategory`),
de-duplicated. Order: parts with `Photos now = 0` first, then by Manufacturer,
then MFR Part #. No filters in v1.

**A slot's "source" on export:** `sourceUrl` when set; otherwise the Drive
file's name for `source: "drive"` / `"sheet"` images whose `sourceRef` is a
Drive file id (looked up from the folder listing when Drive is connected, else
the document's `fileName`); otherwise the document's `fileName`. Informational
— it lets the person see what's filled.

**Row → part matching (import):**
1. Normalize Manufacturer (trim, case-insensitive) and MFR Part #
   (`normalizeSku`). Candidates = parts whose manufacturer matches and whose
   normalized MFR P/N **or** MFR M/N equals it.
2. If SKU is filled, it narrows the candidates (and a SKU alone, with MFR
   Part # blank, matches by SKU).
3. Exactly one candidate → matched. Zero → Problem "no matching part".
   Several → Problem "ambiguous — fill the SKU column". Never guesses.
4. Rows for parts not in the export are accepted the same way.

## 2. Import flow

### Upload
The person picks the filled sheet and (optionally) drops image files. The
**sheet file** goes to a server action as `FormData` (refused over 1 MB —
exceljs is server-only, and a quoted+portal sheet is far smaller) and is read
there. **Dropped images are not uploaded yet** — only their names and sizes go
to the planner. Dropped HEIC files and files over 25 MB are refused up front
with the existing `preflight`.

### Preview — pure planner, nothing written
`src/lib/part-docs/photo-sheet-plan.ts`, shaped like `drive-photo-plan.ts`.
Inputs: parsed rows, the matchable parts with each part's existing images
(`sourceUrl`, `sourceRef`, `source`), the dropped file names, the Drive listing
(or `null` when Drive photos aren't connected). For every non-blank Photo cell,
first rule wins:

1. Row unmatched / ambiguous → **Problem** (row reason, once per row).
2. Cell starts with `http://` or `https://` → a **URL item**.
   Other `scheme:` values → **Problem** "not an http(s) URL".
3. Otherwise it's a **file name**, resolved:
   a. a dropped file with exactly that name (case-insensitive) → **dropped item**;
   b. else Drive listing, exact name → **Drive item**; else case-insensitive
      name, exactly one → **Drive item**; several → **Problem** "N Drive files
      share this name";
   c. else → **Problem** "not dropped and not in Peak Product Photos" (or
      "…and Drive photos aren't connected" when the listing is `null`).
   A `.heic`/`.heif` name or a HEIC Drive mime type → **Problem** with the
   existing `HEIC_REASON`.
4. **Skip** when the part already has an image with the same source: URL items
   compare to `sourceUrl`; Drive items compare their Drive file id to
   `sourceRef`; dropped items compare to `sourceRef` `file:<name>` (case-
   insensitive).
5. Otherwise **Will add**.

**Sharing:** Will-add items with the same URL, the same Drive file id, or the
same dropped file name collapse into **one planned document** linked to every
part that names it (the `part_documents` shared model).

**Order:** each planned link records whether it came from Photo 1. Preview
shows counts (Will add · Skip · Problem) and a Problem table (row, slot,
value, reason).

### Import — after confirm
Two lanes, run from the page after Confirm:

- **Server lane (URL + Drive items)** — `importPhotoSheetBatchAction(plan,
  cursor)` processes planned documents in order under a **45 s budget** per
  call and returns a cursor; the page loops until done, and a closed tab
  resumes from a re-import (already-done items now Skip). Per document:
  fetch (`fetchImageBytes` / Drive download) → shrink → store as a new image
  document with `source: "sheet"`, `sourceUrl` = the URL (URL items) or
  `sourceRef` = the Drive file id (Drive items) → link to its parts.
- **Client lane (dropped items)** — after the server lane, the page uploads each
  planned dropped file through the existing `uploadNewDocument` path
  (preflight → direct-to-Blob → attach), extended with optional provenance so
  the document records `source: "sheet"`, `sourceRef: "file:<name>"`. The
  attach action keeps its existing server-side blob-path and byte checks —
  the client-supplied path stays untrusted.

**Ordering after each link:** a new document from **Photo 1** is moved to the
front of that part's real images with `moveImageToFront` and persisted through
`setImageOrder` (D536). Photo 2/3 documents append at the end of the real-image
group. Datasheet-render thumbnails stay after the boundary.

**Never deletes or replaces.** Changing a filled slot adds the new photo; the
old one stays. Removal stays in the part editor. Imported images get default
(Auto) visibility.

**Per-item failures** (fetch refused, not an image, Drive download error,
shrink error) are recorded against their row/slot and never stop the batch.

### Results
A summary (added · linked · skipped · failed) and **Download results sheet** —
the same columns, every uploaded row, Status filled per row: `Added N`,
`Skipped (already attached)`, or the first problem/failure reason
("Photo 2: URL returned HTML, not an image"). The results sheet can be fixed
and re-uploaded as-is.

## New type value

`PartDocumentSource` gains `"sheet"`. Anywhere that switches on source
(labels in the part editor's Documents/Images list) shows it as **Sheet**.

## Out of scope (v1)

- A live Google Sheet (would sit on the same planner later; needs a Sheets
  write scope).
- More than three photos per part from the sheet.
- Deleting or reordering beyond "new Photo 1 becomes primary".
- Datasheet / Spec sheet / Manual columns.
- Setting Show/Hide visibility from the sheet.
- Fuzzy matching on description.
- Export filters (manufacturer, category, missing-only).

## Testing

All four gates (tsc, `test:specs`, `test:smoke`, eslint vs a stash-free
baseline) plus `next build` (client page importing actions).

- **Planner (`test:specs`, TDD):** Manufacturer + MFR P/N match; MFR M/N
  match; SKU tie-break; SKU-only row; ambiguous; no match; URL vs non-http
  scheme; dropped-file wins over Drive; Drive exact vs case-insensitive vs
  duplicate names; Drive not connected; HEIC by name and by mime; Skip for
  each of the three source kinds; shared-document collapse across rows;
  Photo 1 flag carried.
- **Export:** row set = quoted ∪ portal-department parts, de-duplicated;
  missing-first ordering; slot sources written; Photos now excludes
  datasheet-render thumbnails.
- **Sheet parse:** header aliasing/case, extra columns ignored, `.csv` and
  `.xlsx` give the same rows, >1 MB refused.
- **Executor:** fake fetch/Drive/store — budget stops and resumes from cursor;
  per-item failure doesn't stop the batch; Photo 1 front-move through
  `setImageOrder`; Photo 2/3 append.
- **Smoke:** `/catalog/documents/photos` renders; export route returns an xlsx.
- **Manual, scratch datadir:** export → two URLs + one dropped file → import →
  re-import shows all Skip → export again shows the sources and `Has N`.

## Jeff-gated after ship

Export a real sheet in production and try one manufacturer. File-name cells
that should come from Drive need the #283 Drive setup done first.
