# Manufacturer images + placeholder images — design (Manufacturer section, Part 1)

**Date:** 2026-10-02 · **Punch item:** next free number on `origin/main` when the
docs are written (#297 at spec time) · **Decisions:** next free D numbers (D583+
at spec time) · **Migration:** next free number (0035 at spec time).

Part 1 of three (Jeff, 2026-10-02): **1** manufacturer records + images +
placeholders (this spec); **2** the manufacturer page — company, vendors,
people, locations, alias merging; **3** quoted cost and forecast by manufacturer
and vendor. Parts 2 and 3 grow the record defined here.

## Goal

A customer never sees a blank or a grey cube where a part photo belongs. When a
part has no photo of its own, the app shows — in order — a kind placeholder
(Allowance, Custom Device), the manufacturer's image, a pricing placeholder
(Contact Us for More Information) or "Image Coming Soon". Staff upload one image
per manufacturer on a new Catalog → Manufacturers page.

## The four placeholders

Jeff's four 1254×1254 WebP files ship with the app, unchanged, as public static
files:

| Name | File | Meaning |
|---|---|---|
| `allowance` | `public/placeholders/allowance.webp` | an allowance line / part |
| `custom-device` | `public/placeholders/custom-device.webp` | a custom part or line |
| `contact-us` | `public/placeholders/contact-us.webp` | price on request (portal only) |
| `coming-soon` | `public/placeholders/coming-soon.webp` | nothing else applies (portal only) |

Changing one is a code change (no Settings editor).

## The fallback rule (one pure function, two chains)

`src/lib/part-image-fallback.ts`. Input: `{ allowance, custom, mfr, por }` plus a
lookup `mfr → manufacturer image document id | null`.

- **Portal chain:** own photo (caller) → `allowance` → `custom-device` →
  manufacturer image → `contact-us` (when `por`) → `coming-soon`. Never null.
- **Document chain:** own photo (caller) → `allowance` → `custom-device` →
  manufacturer image → **null** (the line prints full width, as today).
  Documents never print `contact-us` or `coming-soon`.

A fallback is **never stored on a part** and never counts as a photo: photo
counts, the Photo sheet, the Datasheets to-do list and the portal's
browsable/visibility rule all read only a part's own linked images.

**Custom**, per surface: a catalog part whose category is `Custom Parts` (what
the Estimator's "add to catalog" custom part saves); a quote line with
`custom: true`. **Allowance:** a quote line with `allowance: true`. **POR:** the
portal's existing `por` (unit price null).

## Manufacturer records

New doc collection **`manufacturers`** (migration, idempotent per D141, with the
`_seq_bump` trigger). One record per manufacturer key:

```ts
type Manufacturer = {
  id: string;            // "MF-" + 10 hex
  key: string;           // mfrKey(name): lowercase, letters + digits only
  name: string;          // the spelling shown (most common catalog spelling at creation)
  imageDocumentId: string | null;
  imageHistory: string[]; // earlier image document ids, newest first
  createdAt: number; updatedAt: number; updatedBy: string;
};
```

- **Matching:** `mfrKey` (`src/lib/catalog-books.ts`) — "ETC" and "E.T.C." share
  one record; "Allen & Heath" and "Allen and Heath" are two (Part 2 merges).
- **Lazy:** a record is created the first time an image is set for that key.
  Catalog manufacturers without a record still list on the page.
- **One record per key** — writes look up by key; a second create for the same
  key updates the existing record.

### The image is a part document with no part links

The manufacturer image is stored as an ordinary `part_documents` record —
`kind: "image"`, new source **`manufacturer`** (label "Manufacturer", gallery
rank 0), `sourceRef: "mfr:<key>"` — that is **linked to no part**. This reuses,
unchanged: the direct-to-Blob upload route, byte sniffing, the 25 MB cap, HEIC
refusal, the shrink to ≤1600 px WebP, `replaceDocumentFile` history, the staff
file route `/api/part-documents/<id>`, the portal doc route, the online-quote
photo routes and cut-sheet image reads. Coverage, photo counts and the portal
visibility rule all go through **links**, so an unlinked document never counts
as a part photo. "Attach existing" search excludes `source: "manufacturer"`.

- **Set image:** upload → verify → shrink → create the document → point the
  record at it; the previous image id moves to `imageHistory` (nothing deleted).
- **Remove:** `imageDocumentId: null`, the id moves to `imageHistory`.
- Every change calls `invalidatePortalIndex()` and revalidates the pages.
- Go-live "Clear demo data" wipes `manufacturers` with the catalog (it is not a
  config collection) — consistent with part documents.

## Catalog → Manufacturers (`/catalog/manufacturers`)

A link in the Catalog header beside Datasheets / Device types / Departments.
View: anyone signed in. Upload / Replace / Remove / Upload many: `create`.

- **One row per manufacturer key** in the catalog (Labor excluded), sorted by
  part count, then name: name (the most common spelling; "+N spellings" when
  variants share the key), part count, **parts without their own photo** (how
  many tiles this image covers), thumbnail or "No image", and actions.
- **Filters:** All / Missing image / Has image; a name search.
- **Upload many:** drop or pick image files; each file name without its
  extension is reduced with `mfrKey` and must **equal** one row's key
  (`ETC.jpg` → ETC; `ETC Lighting.jpg` never matches ETC). A review table
  lists matched and unmatched files; an unmatched file gets a manufacturer
  picker; nothing uploads until Confirm. Files upload one at a time.

## Where fallbacks appear

### Customer portal (full chain)
- The portal index gains `mfrImageDocs: Map<mfrKey, documentId>` (manufacturers
  with an image whose document has a stored file) and adds those document ids
  to `servableDocIds`, so the existing `/portal/catalog/doc/<id>` route serves
  them (PNG/JPEG/WebP only, viewer-gated, rate-limited — unchanged).
- `TileVM` and `PartDetail` gain `fallback: ImageFallback | null` — null when
  the tile/part has its own image. Search/browse tiles, "Goes with" rows (they
  are tiles), the part sidebar (one fallback image instead of the gallery) and
  the fixture configurator (its light engine's manufacturer / custom status)
  render it. Department/Packages landing tiles keep choosing a part with a real
  photo; when none has one they show `coming-soon`. The grey-cube and
  datasheet SVGs are retired from these spots.

### Documents (document chain)
- **Allowance and custom lines become starrable key products.** Their block's
  anchor token is `line:<line id>` (in `KeyProduct.sku`), since they have no
  real sku; `remapKeyProducts` rewrites the token when Copy system remaps line
  ids. Their paragraph is typed on the quote (no "Save to library" — that needs
  a catalog part). Merge narrative skips `line:` blocks (no matching line in
  another system).
- A printable key product carries `placeholder: "allowance" | "custom-device"`
  for those lines; the quote document prints that placeholder (a plain
  `/placeholders/…` URL — public, same origin for the print route and the
  online pages) where it would print a photo, honouring the block's Photo
  checkbox.
- A catalog key product with no photo of its own uses its manufacturer's image:
  `keyProductPhotoDocs` returns the manufacturer image document for that sku,
  so the PDF data-URI path, the online photo links and the online photo routes
  (which serve only what the latest sent revision prints) work unchanged.
- **Estimator narrative column hint:** "Prints the manufacturer image (ETC)",
  "Prints the Allowance placeholder", "Prints the Custom Device placeholder",
  or the existing "No photo — prints full width".
- **Cut sheets (client style):** each fabric/hardware photo falls back to that
  part's manufacturer image; with none, the strip is omitted as today.

### Unchanged
Staff screens other than the Manufacturers page and the narrative hint (gaps
stay visible), the Grid, the Displays API, client packages, the Photo sheet.

## Out of scope (Part 1)
Alias merging, company/vendor/people/location links, quoted cost and forecast
(Parts 2–3); a Settings editor for placeholders; manufacturer images through the
Photo sheet; placeholders on staff screens.

## Testing

Four gates (tsc, `test:specs`, `test:smoke`, eslint) plus `next build`.

- **Fallback rule (pure):** every step of both chains; kind placeholder beats a
  manufacturer image; POR without a manufacturer image; documents stop before
  `contact-us` / `coming-soon`; blank manufacturer.
- **Store (DB):** key matching; lazy create; one record per key; set image keeps
  history; remove keeps the document; `searchDocumentsAction` excludes
  manufacturer images; an unlinked manufacturer image never appears in a
  part's images.
- **Upload many (pure):** exact key match only; unmatched listed.
- **Portal (DB):** tiles/sidebar carry the right fallback; the manufacturer
  image document is servable; a part's browsable/visibility result is the same
  with and without a manufacturer image.
- **Documents:** allowance/custom lines are starrable with `line:` tokens and
  survive a remap; printable key products carry the placeholder; a catalog key
  product without a photo resolves its manufacturer image document; a quote
  with no fallbacks prints byte-for-byte as before (the #293 baseline fixture).
- **Smoke:** `/catalog/manufacturers`. **Browser (scratch datadir, no Blob
  writes):** the page lists manufacturers; a portal tile with no photo shows a
  placeholder.
