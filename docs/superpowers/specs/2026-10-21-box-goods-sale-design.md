# Box goods sale — design

Date: 2026-10-21 · Owner: Jeff · Builds on the BOM quote PDF (#360, D1232)

## Goal

Some estimates are box goods sales: equipment and freight only, with no install. For those, the Estimator skips the
narrative and package machinery. The customer gets the itemized BOM: the estimate PDF is the BOM, and the client link
opens the itemized list.

## Decisions (Jeff, 2026-10-21)

- **What's sold:** equipment and freight only. No labor, install, mobilization or travel.
- **Where it's set:** both a **Box goods sale** card on + New quote and a switch in the Estimator header. It can be
  turned on or off on any Estimator system estimate.
- **What the customer gets:** the BOM PDF plus the online BOM link. No Cover PDF, no narrative overview, no summary,
  goals or Not included. No datasheets or drawings.
- **Labor:** saving is refused while a box goods sale has any labor line. Nothing is deleted automatically.
- **2% estimator bonus:** kept, unchanged. The 5% package bonus already skips systems with no labor.

## Non-goals

- No new builder or quote type. `quoteType` stays `"system"` and `source` stays `"estimator"`.
- Nothing narrative is deleted. Narrative text, key products, goals, cover text, the package document and the
  presentation settings stay stored. They're hidden and don't print while the switch is on, and turning it off brings
  them all back.
- No change to freight rules, approvals, bids/parties, portal catalog quotes, service quotes, or the Grid / Quick Design
  promote paths.
- No change to how a won quote converts. A won quote with no labor already becomes a sales order (`quoteHasLabor`,
  `src/lib/stores/projects.ts`).

## Data

- `Quote.boxSale?: boolean`. Absent means false. Stored top-level on the quote (`src/lib/stores/quotes.ts`).
- The Estimator's Save carries it (`SavePayload`, `src/app/(app)/estimator/actions.ts`; `InitialQuote` /
  `initialFrom` on load). Only Estimator system quotes (`quoteType` absent or `"system"`) may set it. The server drops it
  for any other quote type.
- It is **content**. It joins `QUOTE_CONTENT_FIELDS`, so a change re-renders the stored PDF and marks it stale.
- It is **frozen on sent revisions**. It joins `QuoteRevisionDocFields` / `revisionDocFields`, so a sent revision
  renders the way it was sent (`quoteAsOfRevision`). A revision cut before this field existed reads as false.
- Move/Copy system → New estimate copies the source estimate's `boxSale`. Move/Copy into an existing estimate leaves
  the target's flag alone. The labor rule still applies to the target on its next save.

## The one document rule

A pure helper `boxSaleDocProps(p: QuoteDocumentProps): QuoteDocumentProps` produces the BOM view. Its effect is
identical to `bomViewProps`: `document: null`, `detail: "itemized"`, `pdfQty` and `pdfNotes` on,
`pdfItemizedAppendix: false`, every section `presentation: "itemized"`. Prices follow the quote's own `pdfPrices`.
Either reuse `bomViewProps` directly or share one implementation; never two copies.

`quoteDocumentDataFor` (`src/lib/quote-pdf/quote-document-data.ts`) applies it when the quote (or the frozen revision)
has `boxSale`. So the print route, the portal and share pages, the staff preview and the live BOM all follow from one
seam. The print layout for a box sale is the BOM quote PDF's layout (#360): `layout="web"` plus `QUOTE_WEB_EMBED_CSS`,
with no title page and the investment band kept. It has no cut sheets, no datasheet-links page, and no drawings merged
by the generator (`src/lib/quote-pdf/generate.ts`). A normal estimate prints byte-for-byte as before.

## Labor rule

- **Labor** means any line where `labor`, `laborOverhead` or `laborTravel` is set, or any section with `kind === "labor"`.
  Mobilization / travel lines count as labor.
- The server's Estimator save refuses a `boxSale` quote with any labor:
  `A box goods sale can't include labor — remove the labor lines or turn off Box goods sale.`
  The client shows the same message and doesn't send the save.
- Turning the switch on while labor exists is allowed in the editor. A banner on Build says the same sentence and names
  the systems with labor, and Save stays refused until it's resolved.

## Estimator UI while the switch is on

| Surface | Behaviour |
|---|---|
| Header | **Box goods sale** switch (on/off), next to the existing header meta; also a chip so the mode is visible |
| Build → system card | hide + Configure labor, the Customer: Narrative/Itemized chip, Discipline, Add narrative…, ★ key product |
| Build → toolbar / More ▾ | hide "Draft from survey/inspection" (it assembles narrative scope); + Add system, From library, Suggested BOM and Design in the Grid stay |
| New systems | added as `presentation: "itemized"` (plain add, category add, suggested add, From library; a loaded system's own presentation is kept in storage but doesn't print) |
| Build package | only the **BOM quote** tab: live itemized document, Download / Open PDF (#360), Vendors card, plus Lead estimator / Prepared by (moved here from the Narrative aside). `?ptab=narrative` / `?ptab=client` land on BOM quote |
| Customer review | only the **Document** and **BOM** tabs; the sidebar's package checklist is hidden |
| Readiness badges | no narrative / intro / goals / key-product / datasheet / drawing gaps |
| Send & track | Estimate PDF attached; Cover PDF neither offered nor attached; the email says "Attached is our quote … You can also view it online here: {link}" with no "full package" or alternates wording |

## Customer side

- **Estimate PDF:** the BOM layout described above.
- **Client link / package page:** opens the itemized list only. It has no Overview/Itemized toggle, no summary, goals,
  Not included, Plans & risers, downloads (zip, datasheet book) or datasheet links. Accept and choosing options /
  alternates still work, and so does the question form.
- **Cover PDF:** not generated or offered. `renderCoverPdf` answers 404 for a box sale, as it already does for
  non-system quotes.
- **Portal pages for the customer:** they follow the same document rule through `quoteDocumentDataFor`.

## Errors and edges

- A save with labor on a box sale is refused with the sentence above. Nothing is partially written.
- Switching off restores everything, because nothing was removed.
- A sent revision keeps its frozen `boxSale`, so the client link to that revision is unaffected by a later toggle.
- Bidder PDFs (#348) follow the same document rule, because they render through the same print page.

## Testing

- **Pure:**
  - `boxSaleDocProps`, or its reuse of `bomViewProps`.
  - The labor predicate across the four labor shapes.
  - Send defaults when `boxSale` is on.
  - Hidden tab lists.
  - `parsePackageTab` landing on BOM quote.
- **Store:**
  - `boxSale` round-trips through Save.
  - It's dropped for non-system quote types.
  - It's in the content key, so a toggle stales the PDF.
  - It's frozen in revision doc fields.
  - The save is refused with labor.
  - Move/Copy → New estimate carries it.
- **Document seam:** a box sale's `quoteDocumentDataFor` output has no document, is itemized, and has no appendix. A
  normal quote's output is unchanged.
- **Harness source checks:** the print route and the generator skip the appendices for a box sale. The package page
  hides the narrative slots. The Cover PDF answers 404.
- **Chrome:** render one box-sale estimate PDF on a scratch DB. Check one page, the investment band, and no title page.
- **Gates:** tsc, test:specs, test:smoke, eslint, with real numbers reported.

## Logging

DECISIONS.md entries for the flag and its no-delete behaviour, and for the labor refusal. A PUNCHLIST item for Jeff's
production check: one real box-sale estimate sent to himself.
