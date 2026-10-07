# Task 4 report — Alternates block on the estimate PDF + online view

## Render structure (QuoteDocument, print + layout="web")
- Body: `previewSections` = systems with `sec.alternate !== true` that carry revenue → bands 01…n, group headings
  (`printedGroupHeadings` now skips alternate systems), line count, Itemized appendix (filters `previewSections`,
  so In-total only). `appendixSystemIds`/`offersBomView` unchanged (BOM view still itemizes alternates).
- Header: `N systems · M line items · K alternate(s) · J optional` — K = printed alternate SYSTEMS; the alternate
  part is concatenated into the existing optional-count expression so a no-alternates render is byte-identical.
- **Alternates block** (`.est-alts`) after the last body band, before the Optional additions box: title row
  `Alternates` / `Priced separately — not included in the total` (`est-secband est-althead`, so it keeps with the
  next heading/band under QUOTE_PRINT_CSS), then per Alternate group a `GroupHeading` (name + Σ subtotal) and its
  systems as `SectionBand`s numbered `A1`, `A2`… (continuous across groups) with the shared body.
- Totals / Total investment band: untouched (`p.t` already excludes alternates).
- New pure helper `alternateGroupsForPrint(sections, groups)` in quote-document-view.ts (stamp-keyed, document
  order, groups with ≥1 printed system, subtotal Σ systemSellTotal).

## Extraction
- `docSystem(sec, num, p)` — the old `previewSections` map body, verbatim (num now `number | string`).
- `SystemBody` — narrative/key-products | ItemizedLines | sectioned line-count row; used by the body loop and the
  Alternates block. Takes `alternate` so an EMPTY narrative alternate prints "Priced separately — not included
  in the total." instead of "…included in the total above."
- `OptionRow` — the Optional additions row markup, used by the box and by alternate option lines.
- `SectionBand.num` accepts `number | string`.

## Decisions
- POR: `anyPorPrinted` ignores alternate systems — the Total never includes alternates, so an alternate's POR line
  cannot make it understated; that line still reads "Price on request" in its own band.
- Option lines inside an alternate: out of the Optional additions box and its count; printed (when Show options is
  on) right under that alternate's band body via `OptionRow` with the note
  "Optional — not included in this alternate’s price" (new copy — flag for Jeff/Task 6). They are not in the
  alternate's subtotal (systemSellTotal excludes options), hence the note rather than an ordinary line.

## Tests (`#P2b document`, end of scripts/test-review-and-spec.ts) — 45 checks
Pure helper (order, subtotal, empty group, stamp-keyed, groups order), printedGroupHeadings exclusion; print + web
renders (block copy, position, group heading/subtotal, A1–A3, own lines vs narrative, body numbering In-total only,
header counts, totals + investment band identical to the In-total-only quote, alternate option placement), singular
count, options off, empty group → no block, empty narrative alternate copy, appendix, sectioned detail, portal POR;
byte-for-byte: 7 no-alternates cases (grouped print/web/sectioned/appendix/options-off, portal POR, ungrouped web)
against `docs/superpowers/fixtures/p2b-quote-document-no-alternates.json`, written from the PRE-change code by
`scripts/qdp2b-baseline.ts` (cases in `qdP2bNoAltCases()`); source pins for SystemBody/docSystem reuse. Existing
#293 baseline and #P2a pins pass unchanged.

## Gates
- `npx tsc --noEmit` 0
- `npx eslint "src/app/(app)/estimator" src/lib/quote-pdf src/lib/estimate-output src/components/online-estimate` + the two scripts: clean
- `npm run test:specs`: 13241 PASS / 0 FAIL (baseline 13196)
- `npx next build`: OK
- Visual check: headless-Chrome screenshot of a print render looked right (block between bands and options box).

## Fix round 1

- quote-document.tsx: an alternate system's option lines are now kept out of the Optional additions box only when that system actually prints in the Alternates block (`printedAltIds`, built from `alternateGroups`). An option-only alternate (sell $0, not printed) routes its option lines to the box as before the phase.
- Empty-narrative alternate text is now "Scope and pricing for this alternate are shown above." (the old pinned test updated).
- Tests: "#P2b document fix" block appended to scripts/test-review-and-spec.ts (option-only alternate -> box, no Alternates block; printing alternate keeps option in band, out of box; new empty-narrative text) in print and web layouts.
- Gates: tsc 0, eslint clean, test:specs 13246 PASS / 0 FAIL (baseline 13241 + 5); no-alternates byte-identical fixture passes.
