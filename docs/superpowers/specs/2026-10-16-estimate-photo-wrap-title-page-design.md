# Estimate photo wrap, model tags, title page and PDF appendices — design

Date: 2026-10-16 · Asked by Jeff · Punch item: assign at merge (#TBD) · Decisions: D-TBD-a…h (number at merge)

## What Jeff asked for

1. In the client estimate document, key-product photos sit left or right and the
   **system narrative text wraps around them**. "The narrative ultimately holds
   the text, not the photo."
2. Each photo carries its **Model Number as a tag in the bottom corner** of the image.
3. The estimate PDF opens with a **title page**, then the system narratives, then
   the BOM (if selected), then the **drawings**, then the **datasheet links**.

Scope answers (AskUserQuestion, Oct 16):

| Question | Answer |
|---|---|
| Which output | **Both**: the estimate document (PDF + online estimate + package page) **and** the Build package TipTap document |
| Several photos in one system | **Spread down the text**: photo 1 at the first paragraph, photo 2 at the next, alternating right/left; text always flows around them |
| Model # look | **Tag in the bottom corner** (small dark label, only as wide as the text) |
| Page 1 | **Title page** only (letterhead, project, customer, venue, estimate #, date, prepared by) |
| Prices / totals / terms / signature | **After the narratives** |
| Cover note | **On the title page** |
| Drawings in the PDF | **Pages merged in**, at **their own size** (11×17 stays 11×17) |
| Datasheet links | **Our hosted copy** via **permanent per-datasheet links** (work from the first save, never expire, live while the estimate still lists the datasheet; client-link Revoke doesn't touch them) |
| New page order online | **PDF only** — the online estimate keeps today's order |

## 1. Photos spread through the narrative (every surface that prints key-product photos)

Today each key product is its own `display: flow-root` box (`.est-kp` in
`quote-document.tsx` SystemBody, `.pkg-kp { overflow: hidden }` in
`package-view.tsx`, `.pd-product` flow-root in `package-doc-view.tsx`), so a photo
only wraps its own product paragraph and never the system narrative.

New rule, one pure helper (`src/lib/estimate-output/photo-spread.ts`):

- A system's printed text is a list of **units**: each narrative block
  (paragraph or bullet list) in order, then each key product as one unit
  (heading + its blocks).
- Photos are the system's photo'd key products in key-product order.
- `spreadPhotoAnchors(unitCount, photoCount)` → photo *k* anchors before unit *k*;
  photos beyond the last unit all anchor before the last unit (they stack).
  With zero units, every photo anchors at 0.
- Sides keep today's document-order alternation (`alternatingPhotoSides`,
  Jeff 2026-10-15 #20): right, left, right… across the whole document.
- The **system** body is the only float container (`display: flow-root` on the
  system's body div / `.pkg-scope` body), so a float never leaks into the next
  system's band. Product units are plain blocks.
- Photo size is unchanged: 34 % wide, max-height 2.4in, `object-fit: contain`,
  14 px gutter. The phone (≤ 480 px / ≤ 600 px) rules that unfloat photos to full
  width stay.
- Page breaks: the photo's figure is `break-inside: avoid`; the old `.est-kp`
  rule moves to the product unit so a product heading stays with its first lines.

Surfaces: `quote-document.tsx` SystemBody (PDF, portal online estimate, share v1),
the package page `package-view.tsx` Scope (v2/v3 + staff Package preview).

**Package document (TipTap).** The writer places photos by hand there, so no
anchoring changes: a product block with its photo stops being a flow-root and
becomes a plain block, so the paragraphs after it keep wrapping (exactly what a
`productImage` node already does). Headings and page breaks still clear both.
Same change in the editor NodeView (`product-block-view.tsx`) so the editor
matches print.

## 2. Model-number tag

- The photo is wrapped in a figure (`.est-ph` / `.pkg-ph` / `.pd-ph`) that carries the
  float; the img is `width: 100%` inside it; a `<span class="…-tag">` is
  absolutely positioned at the figure's **outer bottom corner** — bottom-right on
  a right-floated photo, bottom-left on a left-floated one (Jeff, Oct 16); a
  full-width package-doc image uses bottom-right: dark background
  (`rgba(22,24,29,.86)`), white text, IBM-Plex-Mono-ish 9 px (print) / 10 px (web),
  padding 2px 6px, `max-width: 100%`, single line with ellipsis.
- Text is the **model number only** (customer documents print the Model # only,
  #304): `lineModel(line, part)` — the line's own model #, else the catalog part's
  model #, else the line's MFR P/N, else `partModel(part)`. Allowance / custom
  lines (`line:<id>` keys) use the line's own fields. Empty → no tag.
- A placeholder image (Contact Us / Image Coming Soon / Allowance / Custom Device)
  gets a tag only when the line has a real model number.
- Data: a new optional `keyProductModels?: Record<string, string>` (key = the
  key product's sku key, the same key `keyProductPhotos` uses) on
  `QuoteDocumentProps`, built server-side next to the photos — `keyProductPhotoDocs`
  already reads every photo sku's catalog part (`partsAndImagesBySku`). Assembly
  lines use the aliased member part (the same part whose photo prints).
  Package doc: `RProduct` / `RImage` gain `model`, resolve ctx gains `models`.
  The editor's library rows gain `model` so the editor shows the same tag.
  The package page model gains `model` per key product.
- Live client views without a catalog read (Build package BOM tab) print no
  photos today, so nothing changes there.

## 3. PDF page order (print layout only — `layout` ≠ `"web"`)

`QuoteDocument` print layout becomes:

1. **Title page** (`.est-titlepage`, `break-after: page`): letterhead, the title
   block (QUOTE · number · REV · Issued · Valid), Prepared for / Project / Prepared
   by, the bid line, and the **cover note** (when `pdfCover` + `quoteNote`).
2. **System narratives**: group headings, bands, narratives / key products — or
   the package document when it applies — then the Alternates block, then
   Optional additions.
3. **Pricing**: totals, rewards/standing lines, terms, acceptance, footer,
   assumptions. The investment band is **dropped from the PDF** (Jeff, Oct 16 —
   the totals block already shows the Total); web keeps it.
4. **BOM** — the itemized appendix exactly as today (`pdfItemizedAppendix` /
   package-doc rules), starting on a new page.
5. **Cut sheets** when `pdfCutSheets` is on — unchanged, appended by the print
   route.
6. **Drawings** (merged with pdf-lib, §4).
7. **Datasheet links** (§5).

`layout="web"` (portal online estimate, share v1) keeps today's order and markup
apart from §1/§2. The bidder PDF (`?bidder=`) gets the title page and order
(same route) but **not** §4/§5 — those are customer-estimate only (Jeff, Oct 16).

## 4. Drawings merged into the estimate PDF

- Source: `shownPackageFiles(quote.packageFiles, quote.packageSelection)` — the
  same Plans & risers list the package page shows; the Client package →
  Documents → Drawings switch off = no drawings.
- In `generateQuotePdf` after Chrome: pdf-lib loads the Chrome bytes, appends each
  drawing in list order, appends the datasheet-links pages, saves once.
  - PDF files: every page copied at its **own size** (`copyPages`), encrypted or
    unreadable files skipped (reuse the datasheet book's load/copy loop:
    `ignoreEncryption`, refuse encrypted, `checkPageBox`).
  - PNG / JPEG: one page per image, page = the image's orientation on letter
    (portrait or landscape), image fitted inside 0.5in margins. WebP: converted
    to PNG with sharp first.
  - Caps: per file 25 MB (already the upload cap), the finished PDF kept ≤ 14 MB so Send can still attach it (15 MB email limit; Jeff, Oct 16 — drawings that don't fit are left out with a warning and stay on the package page), and a
    deadline inside the existing 120 s render budget; anything over is skipped.
  - **Never fails the estimate PDF**: a skipped drawing is logged on the PDF state
    (`pdfNotes`-style warning shown in Customer review → Document) and the rest
    still print.
- Staleness: the drawings shown and the datasheet list now change the PDF, so the
  PDF doc key gains a digest of the shown package files (id + blobPath),
  `packageSelection.drawings` and `packageSelection.excludedDatasheets`, and the
  package-file upload/remove/Generate-from-Grid actions and `setPackageSelection`
  schedule a PDF re-render (they don't bump `updatedAt`; that stays as is).

## 5. Datasheet links page

- **Rows**: the same datasheets the client package includes — `specPackageDocs`
  (quoteBom → catalog → `loadScopedCoverage` → exclusions) — datasheet kind only,
  one row per (part, datasheet): Manufacturer · Model · Description · **Datasheet ↗**.
  No rows → no page.
- **Page**: rendered by Chrome in the same print route as a final section
  (`.est-dslinks`), but split out with a second `page.pdf()` pass on the same
  loaded page (first pass hides it, second pass shows only it) so pdf-lib can put
  it **after** the drawings. Link annotations survive `copyPages` (tested).
- **Permanent link**: `GET /d/ds/[quoteId]/[docId]/[sig]`, `sig` = HMAC-SHA256
  over `"est-datasheet:" + quoteId + ":" + docId` with a key derived from
  `AUTH_SECRET` (truncated base64url). No expiry, no session.
  - Serves the stored datasheet inline (`application/pdf`, `Content-Disposition:
    inline`, `X-Content-Type-Options: nosniff`, private cache) **only while the
    quote exists and its current datasheet list still contains `docId`**
    (else 404, the same page as a bad signature).
  - Exempt from team auth (added next to `/share/` in the proxy allowlist).
  - Absolute URL = the print origin (`printOriginFor`, same precedent as the Cover
    PDF's link line).
- Revoking the client link does not affect these links (Jeff's choice). Deleting
  the quote, or removing/excluding the datasheet from it, does.

## Not in scope

- The online estimate's order (Jeff: PDF only). Online already has drawings and
  datasheets on the package page.
- The Cover PDF (`/print/cover`) — unchanged.
- The Datasheets.pdf book and the package zip — unchanged.
- Manuals / spec sheets on the links page.

## Tests

- Pure: `spreadPhotoAnchors`, model-key builder, datasheet-link sign/verify,
  drawing page-size fitting, the PDF doc-key digest.
- Render harness: regenerate `p5-quote-document-no-document.json` and the other
  `est-kp` / `.pd-product` baselines deliberately (they pin the old boxed layout);
  new cases: two photos + three narrative paragraphs (anchors, sides, tags), more
  photos than units, title page + order in print vs. unchanged web order.
- pdf-lib: merge a 2-page 11×17 PDF + a PNG + a links page with a URI annotation;
  assert page sizes, order and that the annotation survives.
- Route: bad sig / unlisted doc / deleted quote → 404; good → inline PDF.
- Smoke: existing portal/share/estimator-preview routes still 200.
- Verification gate: tsc, test:specs, test:smoke, eslint, next build; a real
  render of Q-2041 in the dev server, checked with pypdf (page sizes, link
  annotation, page order) and a screenshot of the narrative page.
