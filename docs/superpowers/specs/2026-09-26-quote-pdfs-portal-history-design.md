# Punch #221 (quotes open in the builder they were made in), #222 (saved quote PDFs are the customer preview), #220 (portal history)

Date: 2026-09-26 · Branch `feat/punch-inbox-tasks`.

Jeff (2026-09-26):

> Customers Portal should show all estimates, and projects in history. Selecting a quote should pop
> up to what mode it was created in. Flame Tests now open into Estimator. I also want when you save
> the estimate and customer preview it saves the PDF version and that is what shows up in the
> customer preview.

Picks confirmed in chat: portal history is **app-era only** (Daylite-imported records stay internal);
the PDF is a **real PDF printed from the customer preview by a headless browser**; it is
**regenerated on every Save**; it covers **Estimator quotes and the flame-test / repair / inspection
proposal letters**.

## #221 — Every quote link opens the quote's own builder (bug)

Recon: `quoteType` is the one marker (`src/lib/stores/quotes.ts:178`). Two private/partial helpers
exist: `editHrefFor` (`src/app/(app)/quotes/page.tsx:61-73`, complete) and `quoteDeepLink`
(`src/lib/venue-match.ts:67-81`, missing `rental`). Five screens hard-code `/estimator?id=`:
`companies/[id]/page.tsx:577`, `src/lib/company-summary.ts:136` (map pop-out, added 2026-09-24),
`home-stage-sheet.tsx:224` (needs `quoteType` on `SheetQuote`, built at `app/(app)/page.tsx:92-97`),
`src/lib/dashboard/home-metrics.ts:135`, `reviews/page.tsx:97-100`. The Estimator loads any id.

Fix:
- New pure `src/lib/quote-links.ts`: `quoteBuilderHref({ id, quoteType }) → string` covering
  `flame_test → /flame-tests/quote?id=`, `repair → /repairs/quote?id=`, `inspection →
  /inspections/quote?id=`, `consulting → ` (the engagement quote route `editHrefFor` uses today),
  `rental → /rentals/quote?id=`, anything else / missing → `/estimator?id=`. Copy the exact routes
  from `editHrefFor`.
- `editHrefFor` and `quoteDeepLink` delegate to it (keep their exports; `quoteDeepLink` gains rental).
- The five call sites use it.
- Backstop: `estimator/page.tsx` redirects a loaded quote whose `quoteType` is set and not
  `"system"` to `quoteBuilderHref(q)`.
- Assertions: every quoteType maps; the five files no longer contain a hard-coded `/estimator?id=`
  for arbitrary quotes (source grep); estimator redirect (pure predicate `estimatorShouldRedirect`).

## #222 — The saved PDF is the customer preview

### Rendering
- A print route per document type renders the **same** customer document the team sees, from saved
  data only (no client state):
  - Estimator: `/print/quote/[id]` renders `PreviewDoc` (today client-only in
    `estimator/preview-doc.tsx`) from the saved quote + saved PDF options.
  - Service letters: the existing flame / repairs / inspections letter pages, in a print variant
    (`/print/letter/[kind]/[id]` wrapping the same letter components).
- The preview toggles (`pdfQty`, `pdfNotes`, `pdfPrices`, `pdfCover`, `pdfTerms`, `pdfOptions`,
  `detail`) become saved quote fields (`pdfOptions` on the quote), saved with the quote, so the PDF
  is reproducible.
- Print routes are outside the team session: they require a short-lived signed token
  (`HMAC-SHA256(AUTH_SECRET, "print:<kind>:<id>:<exp>")`, 120 s) in the query, and are excluded from
  the team middleware the way `/portal` is. No token / bad token / expired → 404.
- PDF engine: `puppeteer-core` + `@sparticuz/chromium` on Vercel; locally, the system Chrome
  (`CHROME_PATH`, default the macOS Google Chrome path). `src/lib/quote-pdf/render.ts`:
  `renderPrintRouteToPdf(url) → Buffer` (Letter size, print CSS, `printBackground: true`, 30 s
  timeout). Env-gated: when no Chromium is available the save still succeeds and the PDF state is
  `failed` with a reason.

### Storage + state
- Blob path `quote-pdfs/<quoteId>/<epochMs>.pdf` (private). Quote gains
  `pdf?: { status: "pending" | "ready" | "failed"; blobPath?: string; at: number; savedAt: number;
  error?: string }` where `savedAt` is the save it was made from.
- On every successful save (Estimator `saveQuoteAction`; flame / repair / inspection save actions),
  the action sets `pdf.status = "pending"` and schedules generation with Next's `after()`; the
  generator writes `ready` + blobPath (deleting the previous blob) or `failed`. A newer save
  supersedes an older in-flight one (only write if `savedAt` still matches).
- When a quote is **sent** (the existing revision cut in `setStatus`), the current PDF blob is copied
  to `quote-pdfs/<quoteId>/rev-<n>.pdf` and recorded on that `QuoteRevision` (`pdfBlobPath`), so the
  exact sent document is kept even after later edits.
- Download: team `GET /api/quotes/[id]/pdf` (`requireUser`; `?rev=n` for a revision), portal
  `GET /portal/quotes/[id]/pdf` (portal session customer must own the quote and the quote must pass
  `portalListsQuote`; serves the latest sent revision's PDF when one exists, else the current PDF —
  customers never see an unsent draft's PDF unless it is their own portal self-serve estimate).
  Headers: `Content-Type: application/pdf`, `inline` disposition, `nosniff`,
  `Cache-Control: private, no-store`.

### The customer preview shows the PDF
- Estimator "Customer preview →" shows the saved PDF in an embedded viewer (`<iframe>` of the team
  PDF route) with its status: "Updating PDF…" (pending; polls every 2 s up to 60 s, then offers
  Retry), "Unsaved changes — save to update the PDF" when the editor is dirty, or the failure reason
  with Retry. The preview's controls (toggles, detail) stay editable; changing one marks the quote
  dirty so the next Save regenerates. "Download PDF" downloads the saved file (no more
  `window.print()`).
- Service builders' letter buttons open the saved PDF the same way.

## #220 — Portal: all estimates and project history (app-era only)

- **Quotes & estimates:** every quote `portalListsQuote` already allows (sent / won / lost + the
  customer's own self-serve drafts; never Daylite imports), grouped Open (sent, own drafts) and
  History (won, lost), newest first. Each row opens its PDF (#222 portal route) in a new tab; a quote
  with no PDF yet shows "Document being prepared".
- **Projects:** a new Projects section: Active (not Complete) and History (Complete), app-era only —
  excludes `source.system === "daylite"` and legacy `P-dl-*` ids. Shows name, venue (derived venue
  name), type, stage label, install start/end or target date, and value only when known and the
  linked quote is won. Never: margin, procurement, crew, time logs, notes, tasks, owner, deliveries,
  mobilizations. A pure `portalProjectView(project, …)` whitelists fields (tested).
- Team preview (`?preview=<customerId>`) shows the same.

## Not in scope
Daylite-era portal history; service-job (flame/repair/inspection job) history on the portal; editing
PDFs; e-signature; emailing the PDF (the renewal flow keeps its own letter PDF).

## Testing
- #221 as above.
- #222: token sign/verify (expiry, tamper), pdf state machine (supersede by `savedAt`), revision copy
  on send, portal PDF access rules (other customer → 404, unsent draft → 404, own self-serve → ok),
  pdfOptions round-trip; a smoke render of one print route to PDF when Chrome is available (skipped
  with a logged reason otherwise).
- #220: `portalProjectView` whitelist, app-era filter, grouping.
- Four gates + `next build`; browser check: save an estimate → preview shows the PDF; portal lists it
  and opens the PDF.
