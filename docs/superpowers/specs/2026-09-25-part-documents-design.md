# Part documents — datasheets and spec sheets, shared, with DaVinci-style accessory coverage

**Date:** 2026-09-25 · **Status:** approved by Jeff (brainstorm, 2026-09-25) · **Closes:** PUNCHLIST #40 (a) and the
population half of its (c) · **Model after:** ETC DaVinci's document + accessory graph (research 2026-09-25).

## 1. Goal

Get a datasheet and a spec sheet onto every part Peak actually quotes, with as little repetitive work as possible, and
make client packages include the right files. Jeff: it "should only reference things we actually quote"; accessories
(lenses, clamps, cables) ride on the fixture's datasheet — "a lens can be multiple datasheets and cables will live on
100s", and linking is done through the Assembly Builder. "It's going to be a big task and I am going to need help" —
anyone signed in can upload.

## 2. Decisions (from the brainstorm)

1. **Scope = parts ever quoted**: every SKU on any quote (any status), any Grid design placement, any saved bid spec —
   no time window. Ranked by how many quotes use it.
2. **Two document kinds per part**: **Datasheet** (PDF) and **Spec sheet** (PDF or Word — the manufacturer's A&E guide
   spec). A part's "slot" is satisfied by a document of that kind linked to it.
3. **Three ways in**: a to-do list with drop zones (home base), bulk drop with filename auto-matching, and fetch from
   links the catalog already holds.
4. **Anyone signed in** can upload, attach, replace and remove; every change records who/when; nothing is ever
   hard-deleted (replaced files are kept in history).
5. **DaVinci model**: documents are **shared records** attached to many parts; accessory coverage comes from a
   **fixture → accessory graph**, computed in context, never stored on the accessory. The Assembly Builder edits the
   graph; ETC's graph is pre-filled from DaVinci metadata.

## 3. What the user sees

- **Catalog → Datasheets** (`/catalog/documents`): the to-do list.
  - Rows: every quoted part, most-quoted first — manufacturer, model, description, times quoted, last quoted, and two
    slot cells, **Datasheet** and **Spec sheet**. A cell shows one of: ✓ file (view · replace · detach), **Covered on N
    fixture datasheets** (link opens the list), **Link only** (a URL we haven't fetched — with **Fetch**), **Not
    needed**, or an empty **drop zone**.
  - Progress line ("412 of 1,180 quoted parts have a datasheet"), filters (missing datasheet / missing spec sheet /
    link to fetch / covered / manufacturer / category), search, multi-select with bulk actions (**Fetch links**, **Mark
    not needed**, **Attach an existing document**).
  - **Drop** a file on a cell → it becomes a new shared document attached to that part; then an **"Also covers…"**
    step suggests other parts the same file likely describes (same manufacturer and model family / SKU prefix, and the
    part's accessories from the graph) — tick and confirm to attach them too.
- **Bulk drop** ("Upload many"): drop a folder; each file is matched to part(s) by the model number / MFR P/N / SKU in
  its filename (normalized; longest match wins) and a kind is guessed (filename contains spec/guide/specification or is
  .doc/.docx → Spec sheet; else Datasheet). A review table shows file → matched part(s) + kind with confidence;
  unmatched or ambiguous rows get a part search; **Confirm** uploads and attaches.
- **Fetch from links**: sources are imported `productMetadata.datasheets[].sourceUrl` (Datasheet URL / Guide Spec URL
  columns) and DaVinci `docs[]`. Fetch downloads server-side, verifies the bytes are really PDF/DOC/DOCX, stores the
  file privately and attaches it; failures are listed with the reason. A document fetched once is shared by every part
  that referenced the same URL.
- **Part editor** (catalog modal): a Documents section — the two slots with the same cell behaviour, the part's own
  documents, and "Covered by" (computed) with its accessory/fixture context.
- **Assembly Builder** (`/design/assemblies`): each fixture assembly's lens and option parts (data, power, mounting,
  accessories) are the fixture's **accessory links**. Each member shows its coverage ("covered by fixture datasheet" by
  default) with a **"has its own datasheet"** toggle. Editing an assembly updates the graph.
- **Client package** (quote and Grid): includes every needed document **once**; an accessory is covered when a part
  that lists it as an accessory is on the same quote; an accessory quoted **without** any of its fixtures is flagged
  `missing-datasheet` on that quote only. The gap report says "covered by <fixture>" instead of listing the accessory.

## 4. Coverage rule (computed)

For a part P and a kind K (datasheet | spec sheet):
1. P has its **own** document of kind K → satisfied (own).
2. Else P is marked **not needed** for K → satisfied (not needed).
3. Else P is an **accessory** of one or more parents (graph) and at least one parent has its own document of kind K →
   **covered**. In a quote/package context, prefer parents present on that quote; with no parent present, P is
   **not covered on that quote**. On the to-do list (no context), P counts as covered if any parent has one; the cell
   reads "Covered on N fixture datasheets" (N = distinct parent documents; collapse the list above 5).
4. Else P has only an unfetched URL → **link only** (not satisfied).
5. Else → **missing**.
An accessory marked "has its own datasheet" on an assembly member is excluded from step 3 for that parent link.

## 5. Data (additive migration — new tables only)

Doc-store collections (new `docTable()`s via one hand-written idempotent migration, `_seq_bump` triggers, D141 style):
- **`part_documents`** — a shared document: `{ id, kind: "datasheet"|"specsheet", title, fileName, contentType, size,
  blobKey | null, sourceUrl | null, source: "upload"|"fetch"|"davinci"|"legacy", sourceRef?, language?,
  uploadedAt, uploadedBy, history: [{ blobKey, fileName, size, replacedAt, replacedBy }] }`.
- **`part_document_links`** — `{ id, partSku, documentId, kind, createdAt, createdBy }` (one row per part↔document;
  soft-deleted to detach).
- **`part_accessory_links`** — `{ id, parentSku, accessorySku, maxQty?, included?, ownDatasheet?: boolean,
  source: "assembly"|"davinci"|"manual", sourceRef? }`.
- **Not-needed marks** live on the catalog part (`docNotNeeded?: { datasheet?: true; specsheet?: true }`) via
  `mergeUpsert`.
**Legacy**: each existing `datasheetBlobKey` becomes a `part_documents` row (source "legacy") + link, via an
idempotent backfill run on first read of the documents page (and a script); `datasheetBlobKey` stays readable for
older readers until they switch. Files: Vercel Blob private, path `part-docs/<documentId>/<fileName>`.

## 6. Uploads and fetch

- **Direct-to-Blob client uploads** (`@vercel/blob` `handleUpload`, the recordings route's pattern) — removes the
  ~900 KB server-action ceiling; cap 25 MB; allowed types PDF (datasheet) and PDF/DOC/DOCX (spec sheet), checked by
  magic bytes after upload before attaching. Token route requires a signed-in user.
- **Fetch** reuses `src/lib/venue-calendar-fetch.ts`'s guards (http/https only, every redirect hop re-validated,
  private/loopback/link-local addresses refused after DNS, streaming size cap, timeout); batch fetch runs a bounded
  number per request with progress and is resumable.
- **DaVinci pre-fill** (ETC only): extend `src/lib/davinci/extract.ts` to emit each type's document ids/metadata and its
  `accessories` links; an admin action/script writes `part_accessory_links` (source "davinci") where both ends match
  Peak SKUs (merge duplicate SKUs across classifications), and `part_documents` rows with `sourceUrl` only (no ETC file
  is downloaded or rehosted by the pre-fill — fetch is a separate, explicit step).

## 7. Consumers

- `hasDatasheet` in the Specs coverage (`design/specs/coverage.ts`) and the client package use the coverage rule —
  "link only" no longer counts as present.
- Displays API: point datasheet links at the new viewer route (fixes today's 404s).
- Viewer: `GET /api/part-documents/[id]` (signed-in, streams the private blob or redirects to the source URL for
  link-only docs).

## 8. Testing

Pure: coverage rule (all five outcomes, context preference, own-datasheet opt-out, collapse >5), filename matcher
(model/MFR P/N/SKU normalization, longest match, ambiguity), kind guesser, quoted-parts counter (quotes any status +
Grid + bid specs, no window), DaVinci link mapping (duplicate SKUs merged). Store: documents/links/accessory links CRUD,
legacy backfill idempotent, history on replace. Fetch: guard reuse (redirect/private refusal) and magic-byte check.
Gates: tsc, eslint, test:specs, regressions harness, test:smoke, `next build`, drizzle "no schema changes" after the
migration is generated.

## 9. Out of scope

Rehosting ETC files publicly; datasheets for non-quoted parts beyond what bulk tools touch; OCR/parsing document
contents; per-language variants beyond storing `language`.
