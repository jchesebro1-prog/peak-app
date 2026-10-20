# BOM quote PDF — design

Date: 2026-10-20 · Owner: Jeff · Ships alongside the Parts list CSV v2 (`2026-10-20-parts-list-csv-price-source-design.md`)

## Goal

Staff can download the itemized BOM quote from the Build package → BOM quote tab as a PDF. It prints the same letterheaded document the tab shows, with the saved estimate's data.

## Non-goals

- No live, unsaved-state PDF. The PDF renders on the server from the saved estimate, like the Cover PDF (#301). The tab still shows unsaved edits live.
- Not stored in Blob. Not attached when the estimate is sent. Not offered in the portal, the client link or the package zip.
- No change to the estimate PDF, the saved preview or the BOM tab's live render.

## Behaviour

The BOM quote tab's top strip, beside **Open saved preview ↗**:

- **Saved estimate:** `Download PDF` (downloads) and `Open PDF ↗` (opens inline in a new tab). When the editor has unsaved changes (`pdfDirty`), a note reads *"Save first — the PDF prints the saved estimate."*
- **Never-saved estimate:** a greyed `Download PDF — Save to create the PDF.` with no link.

The file is named `<estimate number> BOM.pdf` (e.g. `EST-1234 BOM.pdf`), with the same character rule as the Cover PDF's name and `Estimate` when the number is blank.

## Architecture

1. **Print route, `src/app/print/quote/[id]/page.tsx`.** It accepts `view=bom`. With it, the page renders `bomViewProps(doc)`, the same transform the saved preview (`/estimator-preview/[id]?tab=bom`) and the live tab use: itemized bands, no package document, quantities and notes on, no itemized appendix. Prices still follow the quote's `pdfPrices`. It never appends cut sheets, and it reads no key-product photos, matching the saved BOM preview. The token check is unchanged: the same `quote`-kind print token, verified before any read. `view` isn't signed, because it only re-lays-out data the token already authorizes.
2. **Render, `src/lib/estimate-output/bom-pdf-server.ts`.** `renderBomPdf(quoteId, host, proto)` mirrors `renderCoverPdf`: system estimates only (`pdfKindForQuoteType === "quote"`), `AUTH_SECRET` and `printOriginFor` checks, a signed `quote` token, `renderPrintRouteToPdf(…/print/quote/<id>?t=…&view=bom)` with a 45 s timeout and a 55 s deadline. It returns `{ok:true,pdf,fileName}` or `{ok:false,status:404|500|503,error}`.
3. **Route, `src/app/api/quotes/[id]/bom-pdf/route.ts`.** `GET`, `requireUser()` first, `maxDuration = 60`, `force-dynamic`. `?download=1` sends an attachment, and otherwise the PDF opens inline. Headers are `nosniff` and `private, no-store`. Errors come back as plain text with the render's status.
4. **Pure helpers, `src/lib/estimate-output/bom-pdf.ts`.** `bomPdfFileName(number)` and `bomPdfPath(quoteId, download)`. They're client-safe, with no store import, because the BOM tab must import nothing from `@/lib/stores/`.
5. **Tab, `src/app/(app)/estimator/steps/package-bom-tab.tsx`.** It adds the buttons and four `BOM_TAB_COPY` strings. `pdfDirty` comes from the hook (it already exists).

## Errors

- Unknown id, or a service quote → 404 `Not found`.
- No secret, no print origin, or Chrome unavailable → 503 with the reason.
- The render failed → 500 *"The BOM PDF couldn’t be rendered — try again."*

The browser shows the text response in its tab, the same as the Cover PDF.

## Testing

- **Pure:** `bomPdfFileName` (`EST-1234` → `EST-1234 BOM.pdf`, blank → `Estimate BOM.pdf`, `A/B` → `A_B BOM.pdf`) and `bomPdfPath`.
- **Source checks, in the harness's existing style:**
  - The print page reads `view`, renders `bomViewProps(doc)` only when it's set, skips cut sheets and photos for it, and still checks the token before `getQuote(`.
  - The route and render use requireUser, 60 s, the shared print origin, system quotes only, the `quote` token, `&view=bom`, the timeouts, `bomPdfFileName(displayQuoteNumber(q))` and `nosniff`.
  - The tab has the copy, `bomPdfPath(loadedId, true)` and `bomPdfPath(loadedId, false)`, the `pdfDirty` note, and still no store import.
- **Smoke:** `/api/quotes/Q-0/bom-pdf` and `/print/quote/Q-2041?view=bom` (no token) are clean 404s.
- **Manual:** on the local dev server, open a saved system estimate's Build package → BOM quote and use Open PDF ↗. Check that the PDF shows the letterhead and itemized systems matching the tab. GET only, no writes.

## Logging

A DECISIONS.md entry and a PUNCHLIST line, shared with the CSV v2 docs task.
