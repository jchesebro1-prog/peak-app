# Build package tabs — Narrative · BOM quote · Client package

**Date:** 2026-10-12 · **Requested by:** Jeff (punch #333) · **Status:** approved — open questions answered 2026-10-12 (§11)
**Builds on:** Estimator in four steps (#305, D643–D684), two-prong estimate output (#301, D613–D634), part documents
(#207), datasheet book (#329), assembly members for datasheets (#332, in flight: `lineMemberRows` in
`src/lib/quote-line-members.ts`).

> Jeff: "The Build package screen should see both the narrative and have a tab for seeing the BOM quote, then a
> selection of what is actually getting presented to the client on this project."

This file holds the design (§1–§11) and the task-by-task implementation plan (§12). Decision-log entries are
**D857–D868** (numbered 2026-10-12; deviations as shipped in §11's "As shipped" note).

---

## 1. Decisions already made (Jeff, 2026-10-12)

| # | Question | Answer |
|---|----------|--------|
| 1 | Layout | Three tabs on Build package: **Narrative \| BOM quote \| Client package** |
| 2 | Narrative tab | Today's Build package content: systems nav or document tools on the left, narrative column or TipTap package document in the centre |
| 3 | BOM quote tab | The itemized, priced quote as the customer's BOM view prints it. Built **live** from the unsaved editor state. Read-only |
| 4 | Client package tab | **One checklist** of everything the client gets on this project |
| 5 | What the checklist holds | (1) Narrative vs itemized per system, set in one place; (2) documents on/off: estimate PDF, Cover PDF, BOM (itemized) appendix, cut sheets, drawings; (3) per-product datasheets for this project; (4) the "Show on PDF" line-detail block |
| 6 | Assembly lines | Datasheet rows list the members of assembly lines (#332 `lineMemberRows`) |

## 2. Goals and non-goals

**Goals**
- One place to see and set what the client receives, per project.
- A live itemized BOM view on Build package that moves as the estimator types, with no Save needed.
- Per-project datasheet choices that every datasheet consumer honours, frozen with each sent revision.
- Every quote that never touches the new controls prints and serves **byte-identically** to today.

**Non-goals**
- No new document types. The client gets the same documents as today; this feature switches them and sets
  defaults.
- No change to the staff Quotes-hub client package's cut-sheet or drawing folders (§6.4). Only its datasheets follow
  the new per-product choices, and that is open question Q3.
- No portal changes (`/portal/quotes/[id]` and the v1 share page are unchanged).
- No Grid-design packages (`createClientPackage` for Grid options) and no rack submittal (`rack/submittal-server.ts`).
- No migration (§8).
- No change to pricing, approval snapshots (#284), bonus lines (#330) or the estimate PDF's own layout.

## 3. Today (verified 2026-10-12, worktree at `bebfd20f`)

- **Build package step.** `src/app/(app)/estimator/steps/package-step.tsx` → `PackageStep` (:46) has three columns:
  - Left: the systems nav, or `DocLeftPane` (`components/package-doc/editor/left-pane.tsx`) once a document exists
    (`hasDoc`, :101).
  - Centre: the `docBar` (:159), `NarrativeColumn` (`estimator/narrative-column.tsx`) and `PackageDocEditor` (:310).
  - Right aside (:325–369): `PdfOptionsPanel` (`estimator/preview-doc.tsx` :113–207), `QuotePeopleFields`,
    `CoverPackagePanel` (`estimator/cover-package-panel.tsx`) and `PackageStaffPanel section="package"`
    (`estimator/package-staff-panel.tsx` :225–398). The staff panel holds the gap chips, the Datasheets book link,
    Drawings (upload / Generate from Grid / remove), Design in the Grid, Rebuild package and Include Peak header.
- **System presentation** (`SpecSection.presentation`, `estimator/types.ts` :244) is editable in three places:
  - the Build section card select (`section-card.tsx` :505, through `build-step.tsx` :490);
  - the narrative column select (`narrative-column.tsx` :259–271);
  - the `PdfOptionsPanel` "Systems" list (`preview-doc.tsx` :185–203).

  All three write `setSystemPresentation` (`use-estimator-state.ts` :1624). Draft narrative also switches a system to
  Narrative (`narrative-column.tsx` :128).
- **Show on PDF.** `Quote.pdfOptions` (`src/lib/quote-pdf/pdf-options.ts`) holds `detail`, `pdfQty`, `pdfNotes`,
  `pdfPrices`, `pdfCover`, `pdfTerms`, `pdfOptions`, `pdfItemizedAppendix` and `pdfCutSheets`. It is a content field
  and frozen in `docFields.pdfOptions`. Payment terms sit beside it. The state lives in the hook
  (`use-estimator-state.ts` :478–502, `togglePdf` :488).
- **Datasheets.** There is no per-quote switch, only the catalog-wide `part.docNotNeeded` (`part-docs/coverage.ts`
  :124). Every package consumer runs through `specPackageDocs(spec)` (`estimate-output/package-docs-server.ts` :40)
  → `quoteBom` → `resolvePackageDocs(index, skus)` (`part-docs/package.ts` :28). The Quotes-hub client package calls
  `resolvePackageDocs` directly (`client-package-server.ts` :579).
- **Cover PDF and estimate PDF** are chosen per send in the Send & track composer (`steps/send-composer.tsx`
  :227–234). Both start ticked (`composerInitial`, `src/lib/estimate-email/send-ui.ts` :72–83). Neither appears on the
  client's package page.
- **Drawings** (`Quote.packageFiles`) appear on the package page under "Plans & risers" from the pinned revision's
  `docFields.packageFiles` (`package-extras.ts` :30). They are served by `/share/…/file/[fileId]` through
  `packageFileForRevision` (`package-files-server.ts` :104).
- **BOM renderers.** `QuoteDocument` (`estimator/quote-document.tsx`) has no hooks and no `"use client"`, and every
  import is client-safe. `bomViewProps` (`quote-document-view.ts` :107) turns document props into the online BOM view.
  The props come from the pure `quoteDocumentDataFor(q, cust, settings)` (`quote-pdf/quote-document-data.ts`, which
  imports only types from stores). The Estimator already holds every input in the browser: `customers: CustomerLite[]`,
  `companyName`, `logoDark`, sections, groups, vendor quotes, `pdfOpts`, payment terms, the package document, and
  `revNum` / `revDateMs`.

## 4. UI

### 4.1 Tab bar and URL

- A `role="tablist"` row at the top of the Build package step, full width, under the step tabs: **Narrative ·
  BOM quote · Client package**. It uses roving tabindex with ←/→/Home/End, like `review-tabs.tsx`.
- `?ptab=narrative|bom|client`. Narrative is the default and writes no param, mirroring how Build writes no `step`.
  Switching tabs uses `window.history.pushState` through `packageTabSearch()`, the same pattern as `goStep` /
  `stepSearch`.
- An unknown or wrong-case `ptab` reads as Narrative. `ptab` is ignored on any step other than `package`.
- `stepSearch` drops `ptab` whenever it writes a step other than `package`. Build's "open narrative" path
  (`onOpenNarrative`, `estimator-client.tsx` :66) lands on Narrative, and `focusNarrIfPending` switches to Narrative
  before it focuses.
- **The Narrative tab stays mounted while hidden** (`display:none`), not unmounted. The TipTap editor keeps its undo
  history and selection, and the Phase 5 unmount flush / `discardRef` dance (package-step.tsx :97–122) is not
  exercised by every tab switch. BOM quote and Client package mount on first visit and then stay mounted while hidden.

### 4.2 Narrative tab

Today's step, minus what moves to Client package:

- Unchanged: the left pane (systems nav or `DocLeftPane`), the centre (`docBar`, `NarrativeColumn`,
  `PackageDocEditor`), and the review-comment pins.
- Right aside keeps `QuotePeopleFields` (it signs the cover) and `CoverPackagePanel` (Overall summary, Not included,
  Cover PDF download). It also keeps **Design in the Grid →**, which is authoring, through
  `PackageStaffPanel section="grid"` (§4.4).
- `PdfOptionsPanel` and the staff panel's documents block leave this tab.
- The narrative column's presentation `<select>` becomes a read-only line, "Prints as **Itemized** · Change in Client
  package →", which links to `?step=package&ptab=client#systems`. The existing hint "Prints on the quote only in
  Narrative mode." stays. Draft narrative's automatic switch to Narrative stays, because it writes the same field
  (D858).

### 4.3 BOM quote tab

- A centred 820 px column (the `/estimator-preview` BOM layout) rendering
  `<QuoteDocument {...bomViewProps(liveProps)} layout="web" />` with `QUOTE_WEB_CSS`. `QUOTE_WEB_CSS` is scoped to
  `.est-web`, apart from print-only `html, body` rules.
- `liveProps` is built in the browser from the editor state (§7). Every keystroke on Build shows here on the next
  render, with no network call.
- A thin strip above the document:
  - "**Live** — shows unsaved changes. The client sees this view once it's saved and sent."
  - "Open saved preview ↗" → `/estimator-preview/<id>?tab=bom`, shown only when the estimate is saved.
  - When `pdfPrices` is off: "Prices are hidden on client documents (Client package → Line detail)." The view still
    follows the quote's own Prices choice, as `bomViewProps` does on the client's page.
- It is read-only and holds no controls. An empty estimate shows "Add a system on Build to see the BOM."
- The tab is code-split (`next/dynamic`), so `QuoteDocument` and the letterhead import reach only the Build package
  chunk.

### 4.4 Client package tab

There are two columns at ≥ 1200 px and one stacked column below that. A summary line sits across the top, built by the
pure `packageSummaryLine()`:

> **The client gets:** Estimate PDF · Cover PDF · Package page with 2 drawings · 41 of 45 datasheets · 3 cut sheets ·
> Itemized appendix

**Left column: the checklist**

1. **Documents** (`#documents`). One row per document, each with a switch, a one-line "what this does", and a link
   where one exists.
   - *Estimate PDF*: "Attached when you send (Send & track)". Writes `packageSelection.estimatePdf`.
   - *Cover PDF*: "Attached when you send". Writes `packageSelection.coverPdf`. Download ↗ when saved.
   - *BOM (itemized) appendix*: "Every narrative system's full line list after the signature". This **is**
     `pdfOptions.pdfItemizedAppendix`; it is not a new field.
   - *Cut sheets (N)*: "Client-style cut sheets after the estimate". This **is** `pdfOptions.pdfCutSheets`, with
     today's disabled state and title when N = 0, and View cut sheets ↗.
   - *Drawings (N)*: "Plans & risers on the client's package page". Writes `packageSelection.drawings`. Under it sits
     the existing drawings management, moved here from the Narrative aside: list, Upload…, Generate from Grid and
     Remove.
2. **Systems** (`#systems`). The **only** presentation editor (D858). One row per printed system (today's
   `PdfOptionsPanel` filter: systems with revenue, freight or sell), showing:
   - the system name;
   - a segmented **Narrative | Itemized** control;
   - "Alternate" when `sec.alternate`;
   - a warning chip "Narrative with no intro" when the presentation is narrative and the narrative is blank (the
     existing readiness rule, `readiness.ts` :68).

   Group headings follow `normalizeSystemOrder` order.
3. **Estimate PDF — line detail** (`#line-detail`). Today's Show-on-PDF block, unchanged in behaviour:
   - Itemized / By section;
   - Quantities, Descriptions, Prices;
   - Cover note (relabelled **"Cover note (estimate PDF)"** so it isn't confused with the Cover PDF; staff-only
     copy);
   - Options, Terms, Payment terms.

   Itemized appendix and Cut sheets are **not** repeated here; they live under Documents.
4. **Package tools.** The staff panel's remaining block: gap chips, Download all datasheets (the book, from the
   **saved** estimate), Rebuild package, Include Peak header.

**Right column: Datasheets** (`#datasheets`)

- Toolbar:
  - counts: "41 of 45 go to the client · 2 missing";
  - filter chips: **All · Missing · Left out**;
  - buttons **Include all** and **Leave all out**, which act on the filtered rows.
- One row per package BOM product (`specPackageDocs` order), with:
  - a checkbox (ticked = goes to the client);
  - Manufacturer · Model (`partModel`) · description;
  - the datasheet state: a file link ↗ / "covered by S4-26" / "Missing" / "Not needed (catalog)";
  - the effect of leaving it out: "Left out" / "Left out with S4-26".
- Assembly members (#332) indent under a "Part of: <assembly line description>" header. `lineMemberRows(item, …)`
  returns `MemberRow { sku, desc, qty, primary? }` per line, so the parent is the line being expanded. The row builder
  records member SKU → that line's description as it walks the lines.
- A SKU that appears both standalone and as a member is **one row**, because the BOM merges by SKU. One choice governs
  both.
- "Not needed (catalog)" rows have no checkbox; there is nothing to send.
- A **Missing** row can be unticked. That means "not needed on this project", and the gap chip stops counting it. This
  is the per-project counterpart to `docNotNeeded`.
- Rows are built from the **unsaved** BOM (§7.3), so a part added on Build shows here without a Save. A spinner reads
  "Checking datasheets…" while the debounced read runs; a failed read shows "Couldn't load datasheets — Retry".
- New estimates (no id yet) work too. The selection is held in state and rides the first Save.

**Saving.** Presentation and line detail are content: they ride Save and re-render the PDF, as today.
`packageSelection` is not content: each change writes immediately through the header-meta action (latest wins), the
same way `coverSummary` autosaves, and it also rides every Save (D860). A small "Saved" / "Saving…" tick sits beside
the Datasheets toolbar.

### 4.5 Other screens

- **Build section card** (`section-card.tsx` :505): the presentation `<select>` becomes a read-only chip,
  "Customer: Narrative ↗", linking to `?step=package&ptab=client#systems`. This is open question Q4.
- **Customer review → Datasheets tab** (`review-tabs.tsx` `DatasheetsTable`, `review-ui.ts` `datasheetCell` :135):
  left-out rows show "Left out of this package" or "Left out with S4-26" in place of a link.
- **Customer review → Drawings tab:** when drawings are off it notes "Drawings are off for this package (Client
  package)" and still lists the files.
- **Send & track composer:** "Estimate PDF" and "Cover PDF" start ticked from `packageSelection.estimatePdf` /
  `.coverPdf`. The sender can still change them per send. Send waits for any in-flight selection write (§10, R4).

## 5. Data model

### 5.1 `Quote.packageSelection` (new, JSONB doc field)

```ts
// src/lib/estimate-output/package-selection.ts — pure, client-safe
export type PackageSelection = {
  /** Send & track's "Estimate PDF" attachment starts ticked. */
  estimatePdf: boolean;
  /** Send & track's "Cover PDF" attachment starts ticked. */
  coverPdf: boolean;
  /** Plans & risers on the package page (and its file route) for revisions sent with this on. */
  drawings: boolean;
  /** Live catalog SKUs whose datasheet stays out of this project's package. Sorted, unique. */
  excludedDatasheets: string[];
};
export const DEFAULT_PACKAGE_SELECTION: PackageSelection = { estimatePdf: true, coverPdf: true, drawings: true, excludedDatasheets: [] };
export const PACKAGE_SELECTION_MAX_EXCLUDED = 500;
export const PACKAGE_SELECTION_SKU_MAX = 200;
export function normalizePackageSelection(raw: unknown): PackageSelection; // absent / junk → defaults; non-boolean → default; SKUs trimmed, non-empty, ≤ 200 chars, deduped, sorted, capped at 500
export function isDefaultPackageSelection(s: PackageSelection): boolean;
```

**Where it lives.** It is a top-level `Quote` field next to `coverSummary` / `notIncluded`, documented in the `Quote`
type (`stores/quotes.ts` ~:323).

**Rules.**
- It is **not** a `QUOTE_CONTENT_FIELDS` member, because none of it prints on the estimate PDF. A change never stales
  the PDF or the approval.
- It is written by `saveQuoteAction` (when the payload carries it) and `updateQuoteMetaAction` (allowlisted), both
  through `normalizePackageSelection`.
- `update()` keeps it. It is not one of the store-owned fields that `update()` drops.
- `buildQuote` copies it only when the caller sets it, as with `coverSummary`.
- `restoreQuoteRevision` does not touch it, because recall copies payload fields only.

**Frozen per revision.** `QuoteRevisionDocFields` gains `packageSelection?: PackageSelection`. `revisionDocFields()`
(`quotes.ts` :862) adds the key **only when the live quote has one** (`...(d.packageSelection ? { packageSelection:
normalizePackageSelection(d.packageSelection) } : {})`), so revisions cut for untouched quotes are byte-identical to
today. It is never annexed onto a sent revision: a change after send applies at the next send. This differs from
`packageFiles`; see D860.

**Reading.** Readers always go through `normalizePackageSelection`:
- live quote: `normalizePackageSelection(q.packageSelection)`;
- revision: `normalizePackageSelection(rev.docFields?.packageSelection)`.

Absent means defaults (all on, nothing excluded), so every existing quote and revision behaves exactly as today.

**Renames (#304).**
- At save, `excludedDatasheets` maps through `liveRenameRefs().m`, the same source `quoteSpecFollowingRenames` uses.
- At read, `specPackageDocs` adds the excluded SKUs to its `getManyBySku` read, so `movedSkus` covers them. An
  exclusion stored under an old SKU, whether on a frozen revision or a tab opened before the rename, still matches the
  live row.
- The rename engine's quotes step is not changed.

**Never auto-pruned.** An excluded SKU whose line is later removed stays in the list. If the product comes back, it
comes back unticked, and the row shows that.

### 5.2 `PackageSkuDocs` (part-docs/package.ts :17)

It gains `datasheetExcluded?: "self" | "parent"`. `resolvePackageDocs(index, skus, opts?: { excludedDatasheets?:
ReadonlySet<string> })` treats a SKU as excluded in either case:
- **"self"**: the SKU is in the set;
- **"parent"**: its datasheet slot is `covered`, and **every** covering parent in context is in the set. A covered
  accessory follows its fixture.

The rule lives in one pure function, `datasheetExclusion(row, excluded)` in `src/lib/part-docs/exclusions.ts`. The
Client package tab uses it to show a choice instantly, and `resolvePackageDocs` uses it on the server.

For an excluded SKU:
- `datasheet: null`, `datasheetOk: true` (it is not a gap), `datasheetExcluded` set;
- its datasheet document is not `take`n. A document reaches `documents` only through an included SKU.
- `specsheet` and `manual` are unchanged. This is open question Q1.

With `opts` absent the output is **deep-equal** to today's. A harness check proves it on the coverage fixtures.

### 5.3 Unchanged fields reused

- `SpecSection.presentation`: the Systems group writes it through the existing `setSystemPresentation`.
- `pdfOptions.pdfItemizedAppendix` and `.pdfCutSheets`: the Documents rows *BOM appendix* and *Cut sheets*.
- The other `pdfOptions` keys and `paymentTerms`: the Line detail group.

## 6. Every consumer, toggle by toggle

### 6.1 `excludedDatasheets`

| Consumer | File | Change |
|---|---|---|
| Package docs (all callers) | `src/lib/estimate-output/package-docs-server.ts` `specPackageDocs` :40 | New param `sel?: Pick<PackageSelection,"excludedDatasheets"> \| null`. Excluded SKUs join the `getManyBySku` read. Exclusions map through `moved` and pass to `resolvePackageDocs`. `RevisionPackageDocs.bom` keeps every row. Adds a helper `bookRows(docs)` = BOM rows whose datasheet is not excluded |
| Sent revision docs | same, `revisionPackageDocs` :73, `packageDocForRevision` :79 | Read `rev.docFields?.packageSelection`. An excluded document is no longer in `documents`, so `/share/…/doc/[docId]` 404s it |
| Staff gap chip | same, `datasheetGapCount` :89; `package-panel-server.ts` :41/:59 | `datasheetGaps(spec, sel)`; the panel passes `q.packageSelection`. Excluded is never a gap |
| Package page key-product links + Downloads card | `src/lib/estimate-output/package-extras.ts` :16 (via `revisionPackageDocs`) | No code change: `datasheet` is null and `documents` omits the doc. A check pins it |
| Staff package preview | `src/lib/estimate-output/package-live-loader.ts` `liveExtras` :42 | `specPackageDocs(q.spec, q.packageSelection)` |
| Customer review Datasheets tab + checklist | `src/app/(app)/estimator/review-actions.ts` `reviewDocsAction` :92; `package-preview.ts` `reviewDatasheetRows` :126; `review-ui.ts` `datasheetCell` :135 | Pass the selection. Rows carry `excluded`. The cell reads "Left out of this package" / "Left out with X" |
| Staff datasheet book (Build package) | `src/lib/part-docs/datasheet-book-download.ts` `quoteBookPdf` :181 | Pass `q.packageSelection`. Book rows = `bookRows(docs)`: left-out products are not in the index (Q2) |
| Client's Datasheets.pdf | same, `revisionBookPdf` :234 (via `serveSharedBook`) | `specPackageDocs(rev.spec, rev sel)` + `bookRows`. The cache key is unchanged because the selection is frozen per revision |
| Client's package.zip | `src/lib/estimate-output/package-zip-server.ts` `buildRevisionPackageZip` :73–99 | Datasheets and the book from the filtered docs / `bookRows`. `LEFT OUT.txt` never names an excluded product. Specifications.docx keeps the full BOM (a spec is not a datasheet). The per-revision cache stays valid |
| Quotes-hub client package (staff zip) | `src/lib/client-package-server.ts` `quoteSpecParts` :560, `createQuoteClientPackage` :694 | `quoteSpecParts` takes optional `excludedDatasheets`. `createQuoteClientPackage` passes the live quote's. Items carry `datasheetExcluded`, no missing-datasheet gap, the book uses the included rows. The Grid path (`createClientPackage`) is unchanged. Q3 |
| Client package tab rows | new `clientPackageDocsAction` (§7.3) | Returns rows without exclusions applied; the browser applies `datasheetExclusion` |

Not changed: `client-package.ts` :130 (Grid manifest), `rack/submittal-server.ts` :194 (rack submittal), the
catalog-wide Datasheets page.

### 6.2 `drawings`

| Consumer | File | Change |
|---|---|---|
| Package page Plans & risers | `package-extras.ts` :30 | `plansView(revisionShownPackageFiles(rev), base)`. The new helper `revisionShownPackageFiles(rev)` in `package-files.ts` returns `[]` when the revision's selection has drawings off |
| Package file route | `package-files-server.ts` `packageFileForRevision` :104 → `/share/…/file/[fileId]` | Goes through the same helper, so it returns the uniform 404 when drawings are off |
| Staff package preview | `package-live-loader.ts` `liveExtras` (`staffPackageExtras` plans) | Plans `[]` when the live quote's drawings are off |
| Gap chip "No drawings" | `package-gaps.ts` `packageGapChips` :26; `package-panel-server.ts` :92 | `PackageGapCounts` gains `drawingsOff`. With it set, no "No drawings" chip |
| Customer review Drawings tab | `review-actions.ts` + `review-tabs.tsx` | Rows still listed, plus the "off" note (`ReviewDocsView.drawingsOff`) |
| Staff package panel / upload broker | `package-staff-panel.tsx`, `/api/quotes/[id]/package-files/upload` | No change. Uploading while off is allowed; files just don't show |

Not changed: the staff Quotes-hub client package's `drawings/` folder (drawing set or equipment summary).

### 6.3 `estimatePdf` / `coverPdf`

| Consumer | File | Change |
|---|---|---|
| Send composer defaults | `src/lib/estimate-email/send-ui.ts` `composerInitial` :72 | `composerInitial(d, sel?)`: `attachEstimate: sel?.estimatePdf ?? true`, `attachCover: sel?.coverPdf ?? true` |
| Send composer | `steps/send-composer.tsx` | Passes `s.packageSelection`. Waits for any pending selection write before Send |
| Server send | `send-actions.ts` :54, `send-server.ts` :326–361 | No change. It still honours the per-send ticks |

Not changed: portal, v1 share page, `/api/quotes/[id]/pdf`, `/api/quotes/[id]/cover-pdf`. Q5 asks whether the package
page should also offer these files.

### 6.4 `pdfItemizedAppendix`, `pdfCutSheets`, line detail, presentation

No consumer changes. These are existing fields with existing consumers (print route, online/BOM views, cover,
package model, cut-sheet append). Only the editor moves. The staff Quotes-hub client package's `cutsheets/` folder
keeps today's always-on rule (§2).

## 7. Live BOM and live datasheet rows

### 7.1 Chosen approach: client-side props builder

New pure, client-safe module `src/lib/estimate-output/live-bom.ts`:

```ts
export type LiveBomInput = {
  quoteNumber: string; projectName: string; customerId: string | null; custName: string;
  locationId: string | null; contactName: string | null; quoteNote: string; assumptions: string;
  owner: string; preparedBy: string; paymentTerms: string; sections: SpecSection[]; groups: SystemGroup[];
  vendorQuotes: VendorQuote[]; pdfOptions: QuotePdfOptions; document: PackageDoc | null;
  revNum: number; revDateMs: number; source: string | null; customers: CustomerLite[];
  companyName: string; logoDark: string | null; rewardsLine: string;
};
export function liveBomDocumentProps(i: LiveBomInput): QuoteDocumentProps; // = bomViewProps(quoteDocumentDataFor(syntheticQuote, cust, settings)) with revNum/revDateMs/rewardsLine from the input
```

**How it builds the props.**
- It builds a minimal `Quote`-shaped object and calls the **same** `quoteDocumentDataFor` the print route and the
  preview use. This gives the same contact ladder, venue label, sorting, totals, groups and portal extras.
- `DocCustomer` in `quote-document-data.ts` is widened to a structural type that both `CustomerDoc` and `CustomerLite`
  satisfy. This is a type-only change.
- `rewardsLine` comes from the hook's `creditInfo`. `RewardCreditInfo` (`rewards/actions.ts` :66) gains
  `purchasePerksDocLine`, filled from the perks read the action already makes, and it is used only when
  `creditInfo.customerId === customerId`. Otherwise it is empty.
- The tab memoises the props on the hook values it reads and renders `QuoteDocument`.

**Why not a server action** (the rejected alternative):
- Each render would round-trip the whole spec, which also rides the 1,200 kB server-action ceiling `saveQuoteAction`
  already lives under.
- It would need debouncing, so it would lag the editor.
- It would re-read the customer and settings on every keystroke.
- It would add a second props path that could drift.

The browser already holds every input, and `quoteDocumentDataFor` plus `QuoteDocument` are pure and import nothing
server-only (checked: `pricing`, `rewards/points`, `part-image-fallback`, `package-doc/*`, `estimate-groups/groups`,
`quote-pdf/state`, `estimate-number`).

**Known, labelled differences from the next saved render.** The Save may adjust a few things after the server
canonicalises:
- the Rewards credit clamp;
- a #304 rename follow;
- the server's bonus-line rewrite, which the client already mirrors.

The strip says "Live". "Open saved preview ↗" shows the saved one.

### 7.2 Equivalence guarantee

A harness check builds `LiveBomInput` from a saved fixture quote the way the hook would, using `initialFrom`'s
mapping, and asserts that `liveBomDocumentProps(input)` deep-equals `bomViewProps(quoteDocumentDataFor(q, cust,
settings))` with the same `rewardsLine`. A second check renders the live props with `renderToStaticMarkup` and asserts
none of `bonus`, `Package bonus`, `Estimator bonus` or `BON-` appears (the #330 leak rule).

### 7.3 Live datasheet rows

**New server action** `clientPackageDocsAction(input: { sections: BomProjection })`, in new
`src/app/(app)/estimator/client-package-actions.ts` (`"use server"`, `requireUser()` as `reviewDocsAction`):
- It runs `specPackageDocs({ sections }, null)`, with **no exclusions**, so the browser can show both "what it is" and
  "what leaving it out does".
- It returns `ClientDatasheetRow[]`:

  ```ts
  type ClientDatasheetRow = {
    sku: string; mfr: string; model: string; label: string;
    state: "own" | "covered" | "not-needed" | "missing"; coveredBy: string[];
    datasheet: { href: string; name: string } | null;   // staff part-document route only
    partOf: string[];                                     // assembly line descriptions (#332), [] when unknown
  };
  ```

  The rows are built by the pure `clientDatasheetRows(docs, members)` in `package-preview.ts`.

**`BomProjection`** (new pure `src/lib/estimate-output/bom-projection.ts`) holds only the section/item keys that
`quoteBom`, `lineMemberRows`, `isBonusItem` and `isRewardCreditItem` read. That is at least `kind` plus
`sku, desc, qty, labor, bonus, rackId, fixtureId, fixture, components` and the credit-line marker. The implementer derives the exact key list
from those functions, and a harness check proves `quoteBom` on the projection equals `quoteBom` on the full sections.
- The server re-sanitises it: ≤ 200 sections, ≤ 5,000 items in total, strings ≤ 300 chars, numbers finite.
- This keeps the payload a small fraction of a Save's.

**Client behaviour.**
- It runs while the Client package tab is visible.
- It is debounced 800 ms after the projection's JSON key changes, and sequence-guarded so the latest wins.
- It does not run on keystrokes elsewhere until the tab is shown again.
- Exclusion effects are computed in the browser with `datasheetExclusion`, so ticking a box is instant.

## 8. Migration

None. Quotes are JSONB documents. `packageSelection` is optional and normalised on read; absent means today's
behaviour. No backfill.

## 9. Permissions

- **`packageSelection`:** same gate as the fields beside it. `saveQuoteAction` and `updateQuoteMetaAction` use
  `requireUser()`, so a signed-in team user can change it. No new permission (D867).
- **`clientPackageDocsAction`:** `requireUser()`, read-only, the same rule as `reviewDocsAction`. Links are staff
  routes only.
- **Drawings management:** keeps `PackageStaffPanel`'s existing `canSend` / `uploads` checks.
- **Presentation and line detail:** ride Save, unchanged.
- **The client side:** sees only the frozen revision's effect, never the selection object. Package pages ship view
  models (`package-extras-model.ts`), never `docFields`.

## 10. Risks

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | Hiding the Narrative tab instead of unmounting changes TipTap lifecycles (flush on unmount, `discardRef`) | Keep it mounted (`display:none`). Browser-check: type in the document → switch to BOM quote → see the change live → back → undo still works → Save |
| R2 | Live BOM differs from the saved PDF (server clamps) | "Live" strip, saved-preview link, equivalence check (§7.2) |
| R3 | `QuoteDocument` and the letterhead grow the Estimator bundle | `next/dynamic` for the BOM quote tab. Run `next build` in the task gates (memory: a client import of a store breaks only `next build`) |
| R4 | A selection change is still in flight when Send runs, so the revision freezes the old choice | Writes are immediate (no timer) and serialised latest-wins. The composer's Send awaits `selectionSettled()`. Step changes don't need to wait because the write is already in flight |
| R5 | Exclusions keyed by SKU break on a #304 rename | Read-time mapping through `moved` (excluded SKUs join the read) and save-time mapping through `liveRenameRefs` |
| R6 | #332 (`src/lib/quote-line-members.ts`: `expandLine`, `lineMemberRows`, `needsFixtureLookup`, `MemberLine` = `sku, desc, qty, fixture, components, rackId, fixtureId`) is still uncommitted in this worktree while this spec is written, and `quoteBom` may or may not call it when it lands | Task 0 re-reads the merged helper and how `quoteBom` uses it. `BomProjection` must carry every `MemberLine` key (including `components` and `fixture`). `partOf` is derived by walking lines through `lineMemberRows`, not taken from `quoteBom` |
| R7 | A covered accessory still ships its fixture's sheet after the fixture is left out | The "parent" rule (§5.2), pinned by checks |
| R8 | Another session collides on D / punch numbers (memory: two sessions on main) | Recompute D and punch numbers from `origin/main` right before writing docs |
| R9 | Revisions gain a new `docFields` key and existing snapshot checks change | The key is added only when the live quote has a selection; an untouched quote's revision is byte-identical |
| R10 | Staff expect the Client package tab to reflect the client's *sent* package | The tab edits the **next** send. A sent estimate shows a note: "The client's link shows Rev N as sent. Changes here go out with the next send." |

## 11. Open questions for Jeff

**Answered by Jeff 2026-10-12 — all five recommendations confirmed:** Q1 datasheets only (spec sheets and manuals
still ship); Q2 left-out products dropped from the book and its index; Q3 the Quotes-hub client package follows the
choices; Q4 the Build card select becomes a read-only chip; Q5 the Estimate/Cover PDF switches are Send & track
attachment defaults only. The "pending Qn" notes below are resolved accordingly.


Each has a recommendation. The build takes the recommendation only if Jeff confirms it. Unanswered questions stay
open; none is decided by silence.

1. **Q1 — Spec sheets and manuals.** When a product's datasheet is left out, should its spec sheet (Downloads card,
   zip) and manual also be left out? *Recommend: datasheets only, as asked.* Customer-visible.
2. **Q2 — Datasheets.pdf index.** Should left-out products be dropped from the book's index entirely, or listed as
   "Not included"? *Recommend: drop them.* Customer-visible.
3. **Q3 — Quotes-hub client package.** Should the staff "Client package" zip on the Quotes hub follow the per-product
   datasheet choices? *Recommend: yes.* Its cut-sheet and drawing folders stay as they are. Customer-visible.
4. **Q4 — Build card select.** Remove the presentation select from the Build system card and show a read-only
   "Customer: Narrative ↗" chip, so the Client package tab is the one place? *Recommend: yes.* The narrative column's
   select becomes read-only either way. Staff-only.
5. **Q5 — Estimate and Cover PDF switches.** Should they only set the Send & track attachment defaults, or also put
   download links for those PDFs on the client's package page? *Recommend: defaults only, for now.* Customer-visible
   if extended.

Customer-visible behaviour in this design that is **not** a question (it follows directly from Jeff's request):
- a left-out datasheet disappears from the package page, Downloads card, zip and doc route for revisions sent after the
  choice;
- drawings switched off hide Plans & risers for that revision.

### Decision-log entries (D857–D868)

- **D857** — Build package has three tabs (`?ptab=narrative|bom|client`, Narrative default and paramless). The
  Narrative tab stays mounted while hidden. `stepSearch` drops `ptab` off the package step.
- **D858** — The Client package tab's Systems group is the one presentation editor. The narrative column shows it
  read-only with a link. Draft narrative's automatic switch to Narrative stays. The Build card select becomes a
  read-only chip (pending Q4).
- **D859** — The BOM quote tab is built in the browser: `liveBomDocumentProps` = `bomViewProps(quoteDocumentDataFor(…))`
  over editor state. No server action. `rewardsLine` comes from `creditInfo`.
- **D860** — `Quote.packageSelection` (`estimatePdf`, `coverPdf`, `drawings`, `excludedDatasheets`):
  - not content; it autosaves and rides Save;
  - frozen into `docFields.packageSelection` only when set;
  - never annexed after send (unlike `packageFiles`);
  - absent means today's behaviour.
- **D861** — The Estimate PDF and Cover PDF switches set Send & track's attachment defaults only (pending Q5).
- **D862** — The BOM appendix and Cut sheets rows are the existing `pdfItemizedAppendix` / `pdfCutSheets`. No new
  field. The staff Quotes-hub package's `cutsheets/` and `drawings/` folders are unchanged.
- **D863** — Drawings off hides Plans & risers and 404s the file route for revisions sent with it off, and
  suppresses the "No drawings" chip.
- **D864** — The datasheet exclusion:
  - is keyed by live SKU and covers the datasheet slot only (pending Q1);
  - a covered accessory inherits it when every covering parent is excluded;
  - excluded counts as satisfied (no gap);
  - the list is never auto-pruned;
  - it is rename-mapped at read and at save.
- **D865** — Left-out products are absent from the datasheet book's index and never named in `LEFT OUT.txt`. The
  specification (.docx) still covers them (pending Q2).
- **D866** — The staff Quotes-hub client package honours the datasheet exclusions (pending Q3).
- **D867** — No new permission. `packageSelection` uses the Save / header-meta gate (`requireUser`), and the
  datasheet-rows action is `requireUser`, read-only.
- **D868** — Live datasheet rows come from a trimmed `BomProjection` through `clientPackageDocsAction` (debounced
  800 ms, only while the tab is visible). The browser applies the exclusions with the same pure rule the server uses.

### As shipped — deviations from this spec (from the #333 commits, review fixes in 7c8d4a05)

- **Save does not carry `packageSelection`.** §4.4, §5.1 and D860 above say it "rides every Save" and that
  `saveQuoteAction` writes it and `update()` keeps it. As shipped its only writer after create is `setPackageSelection`
  through `updateQuoteMetaAction`; Save never carries it and `update()` drops it, so a Save built before a newer tick
  can't revert it. A new estimate's first Save flushes the selection (through the same action) only when it was edited.
- **Writes merge partials and refuse over-cap.** Only the fields present are merged over the stored value under the row
  lock; a SKU over 200 characters or more than 500 exclusions is refused with a reason, not truncated (read-side
  `normalizePackageSelection` still defaults junk). Renames are followed at write inside `setPackageSelection`.
- **A selection write never bumps `updatedAt`**, so it can't fail an in-flight Send's version check.
- **Send is blocked, not just delayed.** `selectionSettled()` races a 10 s timeout; if the server doesn't hold the latest
  choice, Send stops with "Couldn't save the package choices … nothing was sent" (D861).
- **The datasheet projection is byte-budgeted** (900 kB) on top of the section/item caps, with a "List truncated — N items
  not checked" note (D868).
- **`lineMemberRows` was removed** in #332's review (no callers); `partOf` comes from the member expansion
  (`expandLine`), and the assembly-alias predicate is `isAssemblyLine` (fixture/System/Hardware only).
- **BOM tab:** freezes behind a memoised document while hidden and uses the scoped `QUOTE_WEB_EMBED_CSS` rather than
  `QUOTE_WEB_CSS`.
- Systems lists every system with items, marking unpriced ones "No price yet — not on the PDF", rather than only priced
  systems.

---

## 12. Implementation plan

> **For agentic workers:** use superpowers:subagent-driven-development (or superpowers:executing-plans) task by task.
> Steps use `- [ ]`. TDD: write the failing harness check, run it to see FAIL, implement, then PASS.

**Goal:** Build package becomes Narrative · BOM quote · Client package. A per-project `packageSelection` drives every
document consumer. A live BOM view renders from unsaved state.

**Architecture:**
- Pure rules: `estimate-steps/package-tabs.ts`, `estimate-output/package-selection.ts`, `part-docs/exclusions.ts`,
  `estimate-output/live-bom.ts`, `estimate-output/bom-projection.ts`.
- One server seam per toggle: `specPackageDocs(spec, sel)` and `revisionShownPackageFiles(rev)`.
- The hook owns the state. Three tab components replace the one step body.

**Global constraints**
- Read `AGENTS.md`. Next.js 16: check `node_modules/next/dist/docs/` before touching routing or `next/dynamic`.
  `export PATH="$HOME/.local/node/bin:$PATH"`.
- Never open `.data/pglite`. `npm run test:specs` uses a temp datadir. Never run two tsx/db scripts at once
  (`ps aux | grep tsx` first). Check `df -h` before the suite (memory: temp PGlite dirs fill the disk).
- Never import a server store or a `"use server"` module's internals into a `"use client"` file. Pure modules import
  types only from stores.
- Harness: `scripts/test-review-and-spec.ts`.
  - `ok(cond, msg)` is the assertion, and every message starts `#333`.
  - Every imported binding gets a unique `p3` prefix alias.
  - Pure checks go in a `{ … }` block appended at EOF.
  - Async checks are `async function p3XChecks()` chained `.then(() => p3XChecks())` right before
    `.finally(() => teardownFixtures())`.
  - Fixtures live under `docs/test-fixtures/` (memory: harness fixtures must be committed).
- Run: `npm run test:specs 2>&1 | grep -E "#333|FAIL|ALL PASSED|FAILED"`.
- **Gates per task:**
  - `npx tsc --noEmit` clean;
  - `npm run test:specs` ALL PASSED;
  - `npx eslint <touched files>` with no new errors against a baseline taken from the parent commit (not `git stash`;
    memory: the stash is shared across worktrees);
  - tasks touching client components also run `npx next build`.
- Commit after each task, ending the message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never
  push.
- Byte-identical rule: every task that changes a consumer adds a check that a quote/revision **without**
  `packageSelection` produces exactly today's output.

---

### Task 0: Preconditions

- [ ] Confirm #332 is merged: `git log origin/main --oneline | grep -i "332"`. Merge `origin/main` and read
  `src/lib/quote-line-members.ts` and its use in `quoteBom` (`client-package-server.ts` :363). Tasks 3, 5 and 8 build
  on the merged BOM rule. Do not start Task 8 before #332 is on main.
- [ ] Get Jeff's answers to Q1–Q5. Tasks 3, 5 and 13 have a "per Q" switch point. Do not build an unanswered
  question's recommendation silently; stop and ask.
- [ ] Baselines: `npx tsc --noEmit`; `npm run test:specs | tail -3` (record the PASS count); `npx eslint src` error
  count.

### Task 1: Package tab URL helpers (pure)

**Files:**
- Create: `src/lib/estimate-steps/package-tabs.ts`
- Modify: `src/lib/estimate-steps/steps.ts` (`stepSearch`)
- Test: harness EOF block

**Produces:**
- `PACKAGE_TABS = ["narrative","bom","client"] as const`, `type PackageTab`, `PACKAGE_TAB_LABEL`
  (Narrative / BOM quote / Client package);
- `parsePackageTab(raw)`: unknown, missing or wrong case → `"narrative"`;
- `packageTabSearch(search, tab)`: Narrative deletes `ptab`, keeps every other param;
- `nextPackageTab(tab, key)`: ←/→/Home/End;
- `packageTabId(tab)` / `packageTabPanelId(tab)`.

- [ ] **Failing checks.**
  - `parsePackageTab("client")==="client"`, `parsePackageTab("Client")==="narrative"`, `parsePackageTab(null)==="narrative"`;
  - `packageTabSearch("?id=Q-1&step=package","bom")==="?id=Q-1&step=package&ptab=bom"`;
  - `packageTabSearch("?id=Q-1&step=package&ptab=bom","narrative")==="?id=Q-1&step=package"`;
  - `stepSearch("?id=Q-1&step=package&ptab=client","review")==="?id=Q-1&step=review"` (ptab dropped);
  - `stepSearch("?step=package&ptab=client","package")` keeps `ptab`;
  - `nextPackageTab("client","ArrowRight")==="narrative"`.
- [ ] **Implement.** In `stepSearch`, `if (step !== "package") params.delete("ptab")`.
- [ ] **Gate** (tsc, specs, eslint). Commit `feat(estimator): Build package tab URL helpers (#333)`.

### Task 2: `PackageSelection` model (pure)

**Files:**
- Create: `src/lib/estimate-output/package-selection.ts`
- Test: harness

**Produces:** everything in §5.1, plus:
- `attachDefaults(sel) → { attachEstimate, attachCover }`;
- `selectionKey(sel)`: stable JSON for dirty and settled tracking;
- `packageSummaryLine(input: { sel, pdfItemizedAppendix, pdfCutSheets, cutSheetCount, drawingCount, datasheets: { included, total, missing } | null }) → string`.

- [ ] **Failing checks.**
  - `normalizePackageSelection(undefined)` deep-equals `DEFAULT_PACKAGE_SELECTION`;
  - junk: `{ estimatePdf: "no", excludedDatasheets: [" B ", "A", "A", "", 7, "x".repeat(201)] }` → estimatePdf true,
    exclusions `["A","B"]`;
  - 600 SKUs are capped at 500;
  - `isDefaultPackageSelection` is true on defaults;
  - `packageSummaryLine` copy for an all-default selection, and with drawings off and two exclusions
    (exact strings from §4.4).
- [ ] **Implement.** Pure; no imports beyond types.
- [ ] **Gate.** Commit.

### Task 3: Datasheet exclusion rule + `resolvePackageDocs` option (pure)

**Files:**
- Create: `src/lib/part-docs/exclusions.ts`
- Modify: `src/lib/part-docs/package.ts` (`PackageSkuDocs` :17, `resolvePackageDocs` :28)
- Test: harness, using the existing coverage fixtures (search the harness for `resolvePackageDocs(`)

**Produces:**
- `datasheetExclusion(row: { sku: string; state: "own"|"covered"|"not-needed"|"missing"; coveredBy: readonly string[] }, excluded: ReadonlySet<string>): "self" | "parent" | null`;
- `resolvePackageDocs(index, skus, opts?: { excludedDatasheets?: ReadonlySet<string> })`;
- `PackageSkuDocs.datasheetExcluded?: "self" | "parent"`.

- [ ] **Failing checks.**
  1. With `opts` absent, the output deep-equals the pre-change output on every existing fixture (capture it in the test
     with the current function before the change, or compare against a committed JSON fixture under
     `docs/test-fixtures/pkg-tabs/`).
  2. A fixture with a datasheet excluded "self":
     - `datasheet === null`, `datasheetOk === true`, `datasheetExcluded === "self"`;
     - its document is absent from `documents`;
     - its specsheet and manual are unchanged (**Q1 switch point:** if Jeff says spec sheets follow, null those too and
       flip this check).
  3. An accessory covered only by an excluded fixture: `"parent"`, and the doc is absent.
  4. An accessory covered by two fixtures, one excluded: not excluded, still covered, and the doc is present through
     the included one.
  5. An excluded SKU with no datasheet ("missing") gives `datasheetOk === true`, i.e. no gap.
  6. A "not-needed" SKU in the set gives `"self"`, with no change visible.
- [ ] **Implement.**
  - Compute `ds` as today.
  - `const ex = opts?.excludedDatasheets ? datasheetExclusion({ sku, state: ds.state, coveredBy: ds.state === "covered" ? ds.parents : [] }, opts.excludedDatasheets) : null`.
  - When `ex` is set, skip `take` for the datasheet and set `datasheetOk: true`, `datasheetExcluded: ex`.
- [ ] **Gate.** Commit `feat(part-docs): per-package datasheet exclusions (#333)`.

### Task 4: Store, save and meta paths

**Files:**
- Modify: `src/lib/stores/quotes.ts`: `Quote` type (next to `coverSummary` ~:323); `QuoteRevisionDocFields` (:451);
  `revisionDocFields` (:862); `buildQuote` (~:797, copy when given)
- Modify: `src/app/(app)/estimator/actions.ts`:
  - `SavePayload` (:180–192): `packageSelection?: PackageSelection`;
  - `saveQuoteAction` patch (~:515): normalise + rename-map;
  - `updateQuoteMetaAction` (:1081–1115): allowlist `packageSelection`;
  - return `pdf` unchanged, since it is not content.
- Modify: `src/app/(app)/estimator/page.tsx` `initialFrom` (:154, :234) and `types.ts` `InitialQuote` (:590):
  `packageSelection: PackageSelection`
- Test: harness. Async block with the store fixtures; search the harness for `revisionDocFields(` and
  `updateQuoteMetaAction`.

- [ ] **Failing checks.**
  - `revisionDocFields(q)` has **no** `packageSelection` key when `q.packageSelection` is absent, and has the
    normalised value when set;
  - a store round trip (`create` → `update(id, { packageSelection: … })` → `get`) keeps it;
  - `quoteContentKey` is unchanged by a `packageSelection` change, and `contentChangedAt` is not stamped;
  - the save action normalises a junk payload. Use a source pin on the action's patch line if calling it in the
    harness is impractical; follow the existing #301 `coverSummary` checks as the pattern;
  - the rename map: a fixture rename `OLD→NEW` stored in `catalog_sku_renames` makes a saved `excludedDatasheets:
    ["OLD"]` persist as `["NEW"]`.
- [ ] **Implement.**
  - Save: `...(payload.packageSelection ? { packageSelection: await selectionFollowingRenames(normalizePackageSelection(payload.packageSelection)) } : {})`.
  - Put the helper `selectionFollowingRenames` in `src/lib/stores/catalog-renames.ts`, beside
    `quoteSpecFollowingRenames`.
  - Meta: `if (meta.packageSelection !== undefined) patch.packageSelection = await selectionFollowingRenames(normalizePackageSelection(meta.packageSelection))`.
- [ ] **Gate.** Commit `feat(quotes): packageSelection field, frozen per revision (#333)`.

### Task 5: Server consumers — datasheets

**Files** (§6.1):
- `src/lib/estimate-output/package-docs-server.ts`
- `src/lib/estimate-output/package-panel-server.ts`
- `src/app/(app)/estimator/review-actions.ts`
- `src/lib/estimate-output/package-preview.ts` (`reviewDatasheetRows` + `excluded`)
- `src/lib/estimate-review/review-ui.ts` (`datasheetCell` + copy `leftOut`, `leftOutWith`)
- `src/lib/estimate-output/package-live-loader.ts`
- `src/lib/part-docs/datasheet-book-download.ts`
- `src/lib/estimate-output/package-zip-server.ts`
- `src/lib/client-package-server.ts`

**Interfaces:**
- `specPackageDocs(spec, sel?)`;
- `bookRows(docs: RevisionPackageDocs)`;
- `datasheetGapCount(spec, sel?)`;
- `PanelDeps.datasheetGaps(spec, sel)`;
- `quoteSpecParts({ …, excludedDatasheets? })`.

- [ ] **Failing checks** (async, existing package fixtures; search the harness for `buildRevisionPackageZip(` and
  `specPackageDocs(`):
  1. `revisionPackageDocs(rev)` on a revision with `docFields.packageSelection.excludedDatasheets: [X]`: X's document
     is not in `documents` and `packageDocForRevision(rev, xDocId) === null`.
  2. The same revision without `packageSelection` matches today's output (deep-equal).
  3. Rename: a revision excluding `OLD`, whose part is now `NEW`, still excludes it.
  4. `datasheetGapCount` drops by the excluded-missing count.
  5. `buildRevisionPackageZip` with the fake reader:
     - no `datasheets/` entry for X;
     - the book plan has no row for X (**Q2 switch point**);
     - `LEFT OUT.txt` does not mention X;
     - `specification.docx` still lists X.
  6. `createQuoteClientPackage` with fake deps and a live quote excluding X: no X datasheet, no "missing-datasheet"
     gap for X (**Q3 switch point**).
  7. `reviewDatasheetRows` marks X `excluded: "self"`. `datasheetCell` returns `{ kind: "note", text: "Left out of this package" }`.
  8. Source pin: every `specPackageDocs(` call site except `clientPackageDocsAction` passes a selection argument. Grep
     the call sites in the check so a new caller can't silently skip it.
- [ ] **Implement** per §6.1.
- [ ] **Gate.** Commit `feat(package): every datasheet consumer honours the project's datasheet choices (#333)`.

### Task 6: Server consumers — drawings

**Files:**
- `src/lib/estimate-output/package-files.ts` (`revisionShownPackageFiles`)
- `package-files-server.ts` (:104)
- `package-extras.ts` (:30)
- `package-live-loader.ts` (`liveExtras` plans)
- `package-gaps.ts` (`PackageGapCounts.drawingsOff`)
- `package-panel-server.ts`
- `review-actions.ts` + `package-preview.ts` (`ReviewDocsView.drawingsOff`)
- `steps/review-tabs.tsx` (the note)

- [ ] **Failing checks.**
  - `revisionShownPackageFiles(rev)` is `[]` when the revision's selection has `drawings: false`, and equals
    `visiblePackageFiles(cleanPackageFiles(rev.docFields.packageFiles))` otherwise (including absent);
  - `packageFileForRevision` returns null for an off revision;
  - `packageGapChips({ …, drawings: 0, drawingsOff: true })` has no "No drawings";
  - `loadPackageExtras` plans `[]` for an off revision.
- [ ] **Implement.**
- [ ] **Gate.** Commit.

### Task 7: Live BOM builder (pure) + rewards doc line

**Files:**
- Create: `src/lib/estimate-output/live-bom.ts`
- Modify: `src/lib/quote-pdf/quote-document-data.ts` (widen `DocCustomer` to a structural type; no behaviour change)
- Modify: `src/app/(app)/rewards/actions.ts` (`RewardCreditInfo.purchasePerksDocLine`, from `purchasePerksDocLine(perks)`)
- Test: harness

- [ ] **Failing checks.**
  - Equivalence (§7.2) on two fixtures: a narrative + itemized quote with groups, and a portal-catalog quote with
    freight miles.
  - Leak: `renderToStaticMarkup(<QuoteDocument {...liveBomDocumentProps(withBonus)} layout="web" />)` contains none of
    `bonus` (case-insensitive), `BON-`.
  - An empty `sections` array renders without throwing.
  - `rewardsLine` passes through.
- [ ] **Implement.** Build the synthetic quote with only the fields `quoteDocumentDataFor` reads (`spec: { sections,
  groups, document }`, `pdfOptions`, `paymentTerms`, `source`, `owner`, `preparedBy`, `name`, `customerId`,
  `customer`, `locationId`, `contactName`, `quoteNote`, `assumptions`, `vendorQuotes`, `id`/number fields). Then
  override `revNum` / `revDateMs` / `rewardsLine` and wrap in `bomViewProps`.
- [ ] **Gate** + `npx next build` (the module will be imported client-side in Task 11). Commit.

### Task 8: BOM projection + datasheet-rows action

**Files:**
- Create: `src/lib/estimate-output/bom-projection.ts` (`projectBom(sections)`, `sanitizeBomProjection(raw)`, caps §7.3)
- Create: `src/app/(app)/estimator/client-package-actions.ts` (`"use server"`; `clientPackageDocsAction`)
- Modify: `src/lib/estimate-output/package-preview.ts` (`ClientDatasheetRow`, `clientDatasheetRows(docs, members)`)
- Test: harness

- [ ] **Failing checks.**
  - `quoteBom({ spec: { sections: projectBom(s) } })` deep-equals `quoteBom({ spec: { sections: s } })` on the bonus,
    rack and fixture fixtures;
  - `sanitizeBomProjection` caps (201 sections → 200; 5,001 items → 5,000; a 400-char desc → 300; a NaN qty → 0 or
    dropped, matching `quoteBom`'s `qty <= 0` skip);
  - `clientDatasheetRows` states own / covered / not-needed / missing;
  - `partOf`: a fixture-assembly line (`components`) and a rack line both give their member rows the line's
    description; a SKU that is both standalone and a member is one row with `partOf` listing the assembly.
- [ ] **Implement.** The action calls `requireUser()`, sanitizes, runs `specPackageDocs({ sections }, null)` and maps
  rows. It never throws: it returns `{ ok: false, error }`.
- [ ] **Gate.** Commit.

### Task 9: State hook

**Files:**
- Modify: `src/app/(app)/estimator/use-estimator-state.ts`:
  - state next to `coverSummary` (:469);
  - the Save payload (~:1240) gains `packageSelection`;
  - new setters;
  - the export list (~:2925).

**Produces on `EstimatorState`:**
- `packageSelection`;
- `setPackageDoc(flag: "estimatePdf"|"coverPdf"|"drawings", on: boolean)`;
- `setDatasheetsIncluded(skus: string[], included: boolean)`;
- `selectionSaving: boolean`;
- `selectionSettled(): Promise<void>`;
- `purchasePerksDocLine` (from `creditInfo` when its `customerId` matches).

- [ ] **Behaviour.**
  - Each setter updates state and, when `loadedId` is set, calls `updateQuoteMetaAction(id, { packageSelection })`
    immediately.
  - A ref holds the in-flight promise. A newer write waits for it, then sends the latest value (latest wins).
  - `selectionSettled` resolves when no write is pending.
  - A new quote holds the value until the first Save.
- [ ] **Checks.**
  - Source pins: the Save payload includes `packageSelection`;
  - no `setTimeout` in the selection writer;
  - `selectionSettled` is exported.
  - Plus tsc.
- [ ] **Gate** + `next build`. Commit.

### Task 10: Package step shell + Narrative tab

**Files:**
- Modify: `src/app/(app)/estimator/steps/package-step.tsx`. It becomes the shell: the tab bar reads `ptab` with
  `useSearchParams` and `parsePackageTab`, writes with `pushState(packageTabSearch(...))`, and keeps panels mounted
  hidden after first visit.
- Create: `src/app/(app)/estimator/steps/package-narrative-tab.tsx`. It holds today's body (lines 46–324) minus
  `PdfOptionsPanel` and minus the staff panel's documents block. The right aside keeps `QuotePeopleFields`,
  `CoverPackagePanel` and `PackageStaffPanel section="grid"`.
- Modify: `src/app/(app)/estimator/package-staff-panel.tsx`. `section` becomes
  `"documents" | "grid" | "responses" | undefined`; `"package"` is retired. Documents = gaps, datasheet book, drawings,
  rebuild, Peak header. Grid = Design in the Grid. Check every `section=` caller (`grep -rn "PackageStaffPanel"`).
- Modify: `src/app/(app)/estimator/narrative-column.tsx` (:259–271). The select becomes the read-only "Prints as … ·
  Change in Client package →" link.
- Modify: `estimator-client.tsx` (:66). `onOpenNarrative` → `goStep("package")`, which lands on Narrative because
  `stepSearch` from another step carries no `ptab`. `focusNarrIfPending` switches the tab to Narrative first.
- Test: harness

- [ ] **Checks** (source pins + pure):
  - the narrative column has no `<select` writing `presentation`;
  - `package-step.tsx` renders `role="tablist"`;
  - the hidden Narrative panel uses `display: "none"`, not conditional rendering. Pin the exact pattern.
- [ ] **Gate** + `next build`. Commit.

### Task 11: BOM quote tab

**Files:**
- Create: `src/app/(app)/estimator/steps/package-bom-tab.tsx` (`"use client"`; loaded with `next/dynamic` from the
  shell; renders §4.3 with `liveBomDocumentProps` memoised on the hook values)
- Test: harness pins + browser check

- [ ] **Checks.**
  - The tab imports `liveBomDocumentProps` and `bomViewProps` only through `live-bom.ts`, and nothing from `@/lib/stores/`;
  - the "Open saved preview" href uses `previewPath(id, "bom")`.
- [ ] **Gate** + `next build`. Commit.

### Task 12: Client package tab

**Files:**
- Create: `src/app/(app)/estimator/steps/client-package-tab.tsx` (`"use client"`)
- Create: `src/lib/estimate-output/client-package-ui.ts`. Pure: copy (`CLIENT_PACKAGE_COPY`), row filtering
  (All / Missing / Left out), counts, the bulk-action targets, the row status text through `datasheetExclusion`, and
  the anchors `#documents` `#systems` `#line-detail` `#datasheets`.
- Modify: `src/app/(app)/estimator/preview-doc.tsx`. Split `PdfOptionsPanel` into `PdfLineDetailGroup` (detail,
  qty / notes / prices, "Cover note (estimate PDF)", options, terms, payment terms). Delete the Systems list. The
  appendix and cut-sheet buttons move to the Documents rows.
- Test: harness (pure UI rules) + browser check

- [ ] **Failing checks (pure).**
  - Filters;
  - "41 of 45 go to the client · 2 missing";
  - Include all / Leave all out act on filtered rows only;
  - a "not-needed" row is not selectable;
  - parent-excluded rows read "Left out with S4-26".
- [ ] **Implement.**
  - The rows effect runs `clientPackageDocsAction({ sections: projectBom(s.sections) })` while the tab is visible:
    800 ms debounce on the projection key, sequence guard, Retry.
  - Systems rows call `setSystemPresentation`.
  - The Documents switches call `togglePdf` or `setPackageDoc`.
  - Package tools and drawings: `PackageStaffPanel section="documents"` (when saved; otherwise "Save the estimate to
    add drawings.").
  - A sent estimate shows the R10 note.
- [ ] **Gate** + `next build`. Commit.

### Task 13: Presentation single editor — Build card

**Q4 switch point.** Only if Jeff confirms.

**Files:** `src/app/(app)/estimator/section-card.tsx` (:505, the prop at :140); `steps/build-step.tsx` (:490)

- [ ] Replace the select with the read-only chip linking to `?step=package&ptab=client#systems`, and drop
  `onSetPresentation`.
- [ ] **Check.** Source pin: across `src/app/(app)/estimator/`, `setSystemPresentation(` is called only from
  `client-package-tab.tsx`. Draft narrative's `presentation: "narrative"` write in `narrative.ts` / `narrative-column.tsx`
  is allowed explicitly.
- [ ] **Gate.** Commit.

### Task 14: Send composer defaults

**Files:**
- `src/lib/estimate-email/send-ui.ts` (`composerInitial` :72)
- `steps/send-composer.tsx` (initial fields; Send awaits `s.selectionSettled()`)

- [ ] **Failing checks.**
  - `composerInitial(d)` matches today's output (both true);
  - `composerInitial(d, { ...DEFAULT_PACKAGE_SELECTION, coverPdf: false }).attachCover === false`;
  - source pin: the Send click path awaits `selectionSettled`.
- [ ] **Gate.** Commit.

### Task 15: Docs, smoke, gates, browser check

- [ ] **Numbers.** `git fetch origin`. Then read the last punch number and D-number from
  `origin/main:PUNCHLIST.md` / `DECISIONS.md` **right before writing** (memory: two-session collisions). Replace
  the proposed decision placeholders (done: D857–D868), add punch #333 with Jeff's answers, and add an AGENTS.md phase-status line.
- [ ] **Smoke** (`scripts/smoke-routes.ts` ~:286): add `/estimator?id=Q-2041&step=package&ptab=bom`, `…&ptab=client`
  and `…&ptab=bogus`.
- [ ] **Gates** with real numbers:
  - `npx tsc --noEmit`;
  - `npm run test:specs` (PASS count = baseline + new);
  - `npm run test:smoke`, with the dev server stopped first (memory);
  - eslint against the baseline;
  - `npx next build`.
- [ ] **Browser check** on a scratch datadir (memory: exercising POST routes safely; never the real `.data/pglite`;
  unregister the service worker on first compile; `lsof` the port).
  1. Type on Build → the BOM quote tab updates without Save.
  2. Narrative tab: type in the document, switch tabs, come back, undo still works, Save.
  3. Client package: untick a datasheet → "Saved" tick → reload → still unticked.
  4. Switch drawings off → Send & track's Cover/Estimate ticks follow the switches.
  5. Reload with `?step=package&ptab=client` → the Client package tab opens.
  6. Customer review Datasheets tab shows "Left out".
- [ ] Commit `docs: #333 Build package tabs — decisions, punch item, phase status`.

---

## 13. Testing summary

- **Pure:** tab URL helpers; selection normalise / caps / summary; the exclusion rule including the parent case;
  `resolvePackageDocs` byte-identical without opts; live-BOM equivalence and the bonus leak; BOM projection
  equivalence and caps; client-package UI rules; composer defaults.
- **Store / server:** `docFields` freeze (absent → no key); not content; rename mapping at save and read; every
  datasheet consumer (revision docs, doc route, gap count, zip, book, staff client package, review rows); drawings
  gating (extras, file route, gap chip).
- **Source pins:** every `specPackageDocs` caller passes a selection; one presentation editor; no timer in the
  selection writer; the Narrative panel stays mounted.
- **Gates:** tsc, test:specs, test:smoke, eslint against the baseline, `next build`, plus the browser check (Task 15).
