# Spreadsheet import — CSV/Excel upload + downloadable templates (design)

Date: 2026-07-24
Status: approved (Jeff, 2026-07-24 — "yes, one path is fine, keep §4 in")
Area: `src/lib/sheet/*` (new), `src/app/(app)/catalog/*`, `src/app/(app)/import/*`,
`src/db/doc-store.ts`

## Problem

Neither importer in the app accepts a file. Both are paste-only.

- **`/catalog` import panel** (the price-book sidebar) offers three methods.
  "Paste a list" is wired end-to-end; "Upload a price book" is a hardcoded
  *"File upload is coming soon"* placeholder ([controls.tsx:321](../../../src/app/(app)/catalog/controls.tsx#L321))
  and "Connect a manufacturer" is a roadmap note. There is no template download.
- **`/import` hub** (admin-only) has a registry of 8 record types with rich
  field metadata, working CSV template downloads
  (`/import/export?type=X&kind=template`), CSV export, auto-mapping and a
  dedupe-mode preview — but also **no file upload**, and **catalog is not one
  of its 8 types**.

So "download an example" is solved in one place and missing in the other, and
uploading a file is impossible in both. Jeff needs to hand a template to
someone, get a filled-in CSV or Excel sheet back, and load it.

## Decisions (locked)

1. **Scope: catalog + the `/import` hub.** One shared file-reading layer wired
   into both, so every import screen accepts CSV and Excel. No second system.
2. **`.xlsx` is parsed server-side with `exceljs` and converted to CSV text**,
   so it rejoins the existing parsers unchanged.
3. **Both formats go through one route handler.** (Refinement to the original
   "CSV in the browser, Excel on the server" split — see *Why one path* below.)
4. **Templates in both CSV and Excel.** The Excel template is the richer
   artifact: styled header, example rows, and an Instructions sheet.
5. **Duplicates are surfaced before commit** with skip/update/create modes,
   matching the hub's existing behavior.
6. **A Manufacturer column in the file wins**; the sidebar dropdown is the
   fallback for rows that leave it blank.
7. **Fix two adjacent hazards this feature amplifies** (§4): bulk writes and
   merge-on-update.

### Why `exceljs` and not `xlsx`/SheetJS

`xlsx` on npm is frozen at **0.18.5 (March 2022)**; SheetJS moved distribution
to their own CDN. The npm build carries unpatched advisories (prototype
pollution CVE-2023-30533, ReDoS CVE-2024-22363) whose fixes exist only in
CDN-only releases. Taking it from npm means knowingly shipping those; taking it
from the CDN means a non-npm tarball URL in `package.json` and owning the
patching story. `exceljs` 4.4.0 is on npm, reads `.xlsx` fine, and — because it
stays server-side — never reaches the browser bundle.

### Why one path (not client CSV + server Excel)

Decision 5 (show new-vs-updating counts before commit) requires a server call
to diff against the live catalog. Once that call exists, parsing CSV in the
browser saves no round trip and leaves two code paths to maintain. Sending both
formats to one route handler is strictly simpler. `exceljs` still never reaches
the browser, and route handlers are not subject to the **1 MB server-action body
limit** — which matters, because `next.config.ts` sets no
`serverActions.bodySizeLimit` and the catalog is ~10.7k rows.

## Architecture

### New: `src/lib/sheet/`

| Module | Runtime | Responsibility |
|---|---|---|
| `csv.ts` | shared | `csvCell()` escaping + `toCsv(rows)`. Extracted from the private copy in `import/registry.ts`; that copy is deleted and re-imported from here. |
| `workbook.ts` | server only | `xlsxToCsv(buf, sheet?) → { csv, sheetNames }` via `exceljs`. Also `buildXlsx(meta) → Buffer` for templates. |
| `fields.ts` | shared | Catalog's `FieldDef[]` declared once, in the same shape `import/types.ts` already uses. |
| `template.ts` | server only | `templateCsv(fields)` (generalized from `registry.ts`) and `templateXlsx(meta)`. |

`exceljs` is added to `serverExternalPackages` in `next.config.ts` alongside the
existing native/WASM drivers, so the server compiler does not bundle it.

### Upload flow

```
File (.csv/.tsv/.xlsx/.xls)
  │
  ├─ POST /api/sheet/preview ──► requireUser, 10 MB cap, sniff type
  │                              .xlsx → exceljs → CSV text
  │                              .csv  → text as-is
  │                              → existing parseCatalog / parseCsv
  │                              → diff SKUs against live catalog
  │   ◄── { sheetNames, stats:{total,valid,invalid,new,updating},
  │         sample: first 20 rows, warnings[] }
  │
  ├─ client renders the existing preview UI + mode picker
  │
  └─ POST /api/catalog/import (same File re-posted, + mode + mfr)
                              → parse again → bulk upsert → counts
```

**Commit re-posts the file** rather than staging parsed rows server-side.
In-memory staging is unreliable on Vercel (each request may hit a different
lambda), and a staging table would need a migration and a TTL sweep. Re-parsing
a 10k-row file costs ~1s and removes both problems.

**Multi-sheet workbooks:** `sheetNames` comes back with the preview. Default to
the first non-empty sheet; render a picker when there is more than one, which
re-posts with `?sheet=N`.

## Catalog field definitions

Declared once in `src/lib/sheet/fields.ts`, consumed by the panel, the hub card,
and both template generators:

| key | header | required | example |
|---|---|---|---|
| `sku` | SKU | ✓ | `ROSE:IFR-VEL-22` |
| `desc` | Description | ✓ | `IFR Velour 22oz black` |
| `mfr` | Manufacturer |  | `Rose Brand` |
| `category` | Category |  | `Fabric` |
| `unit` | Unit |  | `sq ft` |
| `list` | List Price |  | `18.50` |
| `cost` | Cost |  | `12.95` |

Aliases carry over verbatim from the existing `ALIASES` map in
[catalog/parse.ts:26](../../../src/app/(app)/catalog/parse.ts#L26), plus
`manufacturer`/`mfr`/`vendor`/`brand` for the new column.

**Existing conventions preserved** (from `scripts/import-catalog.ts`, the
one-off that loaded the current price book):

- SKU is keyed `Vendor:Model`.
- Rows where `cost > list`, or with no list price, are flagged with
  `note: "verify price"` so they surface for human review rather than silently
  entering quotes at a bad margin.

Catalog is also registered as a 9th type in the `/import` hub, giving it a card
and template links like every other type. The sidebar panel keeps its quick
inline flow. **One field definition, one writer, two entry points.**

## Templates

- **CSV** — header row + one example row. Unchanged behavior, now also
  available for catalog.
- **Excel** — bold frozen header, sized columns, 2–3 realistic example rows,
  and a second **Instructions** sheet listing every column with: required
  yes/no, accepted alternate headings, and an example value.

Served from the existing download endpoint, extended with a format parameter:

```
/import/export?type=catalog&kind=template            → CSV   (existing shape)
/import/export?type=catalog&kind=template&fmt=xlsx   → Excel (new)
```

Both are plain `<a href>` attachments, so they work without JS — matching how
the endpoint already behaves.

## §4 — Data-safety fixes

Not part of the original ask. Both are pre-existing, and both go from unlikely
to probable the moment a 10,000-row file can be dropped in.

### Bulk writes

`upsertDoc` issues one `INSERT … ON CONFLICT` per call
([doc-store.ts:77](../../../src/db/doc-store.ts#L77)), and `importCatalog`
awaits it in a loop. 10k rows = 10k sequential round trips — minutes against
Neon, and a near-certain serverless timeout.

Add `bulkUpsertDocs(coll, docs[])`: Drizzle multi-row insert with
`onConflictDoUpdate` using `excluded`, chunked at 500 rows.

### Merge instead of replace

`upsert()` writes `{ ...part, id }` as the whole document — a **full replace**.
An imported row that omits a field wipes it. Concretely: re-importing a Fabric
row without `costPerSqft` breaks the curtain configurator's material cost basis;
a Labor row without `discipline`/`role` breaks the labor configurator's rate
lookup. Both fields are absent from every price book a manufacturer will ever
send.

Update mode therefore merges over the existing document (via the `patchDoc`
pattern at [doc-store.ts:137](../../../src/db/doc-store.ts#L137)), preserving
`costPerSqft`, `discipline`, `role`, and `note` when the incoming row is silent
about them. Create mode is unaffected.

## Error handling

Every rejection names its cause; no generic failures.

| Condition | Response |
|---|---|
| Unsupported extension / MIME | "That's a `.pdf`. Upload a CSV or Excel file." |
| Over size cap | "That file is 14 MB — the limit is 10 MB." |
| Password-protected or corrupt workbook | "Excel couldn't be read — it may be password-protected." |
| Empty sheet / no data rows | "That sheet is empty." |
| No recognizable columns | "No SKU or Description column found," + the headers it did see, + a template link. |
| Some rows invalid | Non-fatal: preview shows "N ready · M skipped", skipped rows listed with reasons. |

Auth matches each surface: `requireUser()` for the catalog panel endpoints,
`requirePerm("manage_users")` for hub endpoints, mirroring today's gates.

## Testing

No jest/vitest in this project — tests are `tsx` scripts with `ok()`
assertions printing PASS/FAIL, run via `npm run test:specs`
(`scripts/test-review-and-spec.ts`). New assertions follow that convention.

- `csvCell` escaping round-trips commas, quotes, and embedded newlines.
- `xlsxToCsv` on a fixture workbook: header + rows, multi-sheet, empty sheet,
  numeric and date cells.
- Alias mapping resolves `Part Number` → `sku`, `Dealer Net` → `cost`, etc.
- Manufacturer precedence: file column wins; blank falls back to the dropdown.
- `"verify price"` flagging fires on `cost > list` and on missing list price.
- Merge-on-update preserves `costPerSqft` / `discipline` / `role`.
- `bulkUpsertDocs` chunking: 1,200 rows across 3 chunks, all present after.
- **Round-trip (the real proof):** generate the xlsx template → fill it with
  rows → upload it → imports cleanly with zero skipped rows. Our reader must
  read our own writer's output.

## Out of scope

- "Connect a manufacturer" (live dealer-account pricing) stays a stub.
- Writing `.xlsx` *exports* of live data — CSV export already exists and is
  unchanged. Only *templates* gain an Excel format.
- Undo/rollback of a committed import. The preview + mode picker is the
  safeguard this round; rollback would need import batch tracking.
- `.xls` (BIFF, pre-2007) is accepted by extension only if `exceljs` reads it;
  no separate legacy parser. If it fails it falls into the "couldn't be read"
  message above.
