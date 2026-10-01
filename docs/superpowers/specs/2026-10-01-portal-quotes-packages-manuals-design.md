# Portal quotes, Packages & Assemblies, primary photo + Manual

Date: 2026-10-01 · Punch #288 / #289 / #290 (renumber at merge if taken) · Owner approval: Jeff, 2026-10-01 ("A", "B",
"A — default Venue name and date", "A", "write and build and implement without my input")

Three independently shippable parts, built in order.

---

## Part 1 (#288) — customer-named quotes, My quotes, internal Portal quotes queue

### 1.1 Terms

- **Customer-built quote:** `source ∈ {"portal-catalog", "portal-service", "portal-self-serve"}`. The legacy
  `portal-self-serve` is included. One pure helper, `isCustomerBuiltQuote(q)`, is the only definition. Put it in a
  client-safe module, e.g. `src/lib/portal-quote-mode.ts` or a new `src/lib/portal-quote-kind.ts`.
- **Peak-sent estimate:** anything else that `portalListsQuote` lists.

### 1.2 Default names

`defaultPortalQuoteName(...)` (pure):

- **Catalog cart:**
  - With a venue: `"<venue label> — <Mon D, YYYY>"`. The venue label is the same one `generatePortalQuote` resolves
    today (`label || locationName`).
  - Without a venue: `"<company name> — <Mon D, YYYY>"`.
- **Service:**
  - One venue: `"<first venue label> — <date>"`.
  - Several: `"<first venue label> + N more — <date>"`.
- **Date:** formatted `en-US` `{ month: "short", day: "numeric", year: "numeric" }` in `America/Chicago`.
- **Limits:** names are trimmed, control characters stripped, and capped at 120 characters. These are the same rules
  for a typed name.

### 1.3 Naming at Generate

- **Catalog:** the cart page (`/portal/catalog/quote`) shows a **Name this quote** text box above Generate, pre-filled
  with the default for the cart's current venue (recomputed when the venue changes). `generateQuote` and
  `generatePortalQuote` take an optional `name`. Blank means the default. This replaces today's
  `"Portal quote — <venue>"`.
- **Service:** the `/portal/service` form gets the same box above its Generate button, defaulted from the selected
  venues. This replaces `serviceQuoteName(...)` as the stored name. The type stays visible through the quote's type
  chip.

### 1.4 Rename

- **Lib body:** `renamePortalQuote(session, quoteId, name)` in `src/lib`. Its `"use server"` wrapper lives in
  `src/app/portal/actions.ts`.
- **Refusals:**
  - a preview or unwritable session (the same `writable` rule);
  - a quote not listed for this customer (`portalListsQuote`);
  - a quote that isn't customer-built;
  - an accepted quote: `portalAcceptance` set, or status `won`/`lost`;
  - an empty name after cleaning.
- **Rate limit:** `rateLimit("portal-rename:"+grantId, 30, 1h)`.
- **Write:** through `update(id, { name })`.
- **PDF:** `name` is a printed content field (`QUOTE_CONTENT_FIELDS`), so after the write the action calls
  `scheduleQuotePdf(id)` exactly as Generate does. A sent quote's customer PDF then shows the new name.
- **Staff:** they keep renaming in the builders as today. It's the same field, so customer and staff always see the
  same name.

### 1.5 My quotes (portal)

- **Route:** `/portal/my-quotes`.
- **What it lists:** customer-built quotes for the session's customer (`portalListsQuote` and `isCustomerBuiltQuote`).
- **Filters:** **Open**, the default (draft / sent / under review / expired-but-refreshable), then **Accepted** (won,
  or `portalAcceptance` set) and **Closed** (lost / declined). Newest first.
- **Rows:** the **same row component and actions Home uses today**: Accept dialog, Refresh pricing, Copy to new quote,
  Quote again, PDF link, and the chips. Extract Home's `quoteRow` into a shared component file; don't duplicate it.
  Each row adds:
  - the name as the row title, with a ✎ **Rename** inline edit (input + Save/Cancel) while renamable;
  - the estimate number and type label.
- **After Generate:** both flows redirect to `/portal/my-quotes?generated=<mode>&q=<id>` instead of `/portal?…`. The
  "generated" banner moves with it.
- **Preview** (`previewCid`): the page renders read-only. Rename and the row actions are hidden or disabled, the same
  way Home handles preview.

### 1.6 Home and nav

- **Home** lists **Peak-sent estimates only**. Customer-built quotes are excluded from its Open/History. Home adds a
  compact **My quotes** card: "N open · View all →", or an empty-state line linking to the Catalog / Service.
- **Nav:** `Home · Catalog · Service · My quotes · Cart (N)`.
  - "Quote" is renamed **Cart**, with the same href and badge.
  - **My quotes** is a new item. It's enabled in preview, with `?preview=`.
  - `portalNav`'s `active` union gains `"my-quotes"`.

### 1.7 Portal quotes queue (staff)

- **Route:** `/quotes/portal` under the **Estimating** nav group, labelled **Portal quotes**, next to Quotes. Add it to
  `activeKeyFor`. Access is `requireUser()`, like the Quotes hub.
- **What it lists:** every non-deleted customer-built quote.
- **Columns:**
  - Est # (`displayQuoteNumber`), the quote name, company, type (Catalog / Flame test / Inspection), status, total,
    created, valid until.
  - **Status values:**
    - **Needs review** (`portalReview` and not sent);
    - **Accepted — confirm** (`portalAcceptance` set and status `sent`);
    - **Sent** (firm and still valid);
    - **Expired** (firm and past `validUntil`, not accepted);
    - **Won**, **Lost**, **Draft**.
- **Filters:** status, plus type and a text search over name, company and Est #.
  - The status filter defaults to **Needs action** = Needs review ∪ Accepted — confirm, then the other statuses.
  - The status counts show on the filter chips.
- **Row actions:**
  - **Open** (`quoteBuilderHref`).
  - For **Accepted — confirm** rows:
    - **Approve** runs the type's existing approve: the catalog uses the Quotes hub's `setQuoteStatus(..., "won")`
      path; flame and inspection use `approveFlameQuote` / `approveInspectionQuote`.
    - **Decline** opens a small note prompt that calls `declinePortalAcceptanceAction`.
  - No new pricing logic, no new approve semantics.
- **Bell:** the three portal bell groups ("Portal quotes to review", "New portal quotes", "Portal acceptances to
  confirm") link each item to `/quotes/portal?focus=<id>`, which highlights and scrolls to that row (filter forced to
  All). They no longer link to the builder or the hub.

### 1.8 Tests

- **Harness (pure):**
  - `defaultPortalQuoteName` covers every case.
  - Name cleaning: trim, control characters, the 120-character cap, blank → default.
  - `isCustomerBuiltQuote`.
  - The queue's status classifier and its filter/sort, as a pure view model.
  - `portalNav` with the new items.
- **Harness (DB):**
  - Generate with a typed name stores it; generate with a blank name stores the default.
  - `renamePortalQuote`:
    - succeeds on a sent customer-built quote, and reschedules the PDF (check through the existing PDF-state seam);
    - refuses an accepted quote, a Peak-sent quote, another customer's quote and preview.
  - Home's list excludes customer-built quotes. My quotes lists only them.
- **Smoke:** `/portal/my-quotes` (portal session as the smoke harness does) and `/quotes/portal`.

---

## Part 2 (#289) — Packages & Assemblies in the portal catalog

### 2.1 Portal category on assemblies

- **New field:** `portalCategory?: string` on `FixtureRecord`.
  - It's meaningful only for `kind: "fixture"`, the only kind the portal offers (D409).
  - Clean it: trim, collapse whitespace, cap at 60 characters, empty → absent.
  - Add it to `FixtureInput`/`CleanFixture`, both return branches of `sanitizeFixtureInput`, and
    `OPTIONAL_FIXTURE_FIELDS`.
- **Builder:** the fixture branch of the form gains a **Portal category** input next to Description. A `<datalist>` of
  the categories already used across fixtures backs it, with the placeholder "e.g. Lighting packages". Saving already
  invalidates the portal index.

### 2.2 Index, departments and search

- **Index:** a fixture entry's `category` becomes `portalCategory || "Other packages"`, replacing "Fixture
  assemblies".
- **Reserved department:** a department id `PACKAGES_DEPT = "packages"`, reserved like `"other"`. `sanitizeDepartments`
  refuses it.
- **Departments hold parts only:**
  - A department's filter, facets and tile counts apply to `kind: "part"` entries only.
  - Fixtures never match a configured department or **Other**.
  - The Departments editor's known categories come from part entries only, so "Fixture assemblies" disappears from
    it.
  - Remove the suggestion regex's `fixture assemblies` term.
  - A saved department that still lists "Fixture assemblies" is harmless: it matches nothing, and the next save drops
    it.
- **Landing:** when at least one fixture is browsable, a **Packages & Assemblies** tile appears first. It shows the
  count of browsable fixtures, uses the top-ranked fixture's engine image as its thumbnail, and links to
  `?dept=packages`.
- **`?dept=packages`:** shows only fixtures. The Category facet lists their portal categories, the breadcrumb reads
  "Packages & Assemblies", and search inside is scoped to fixtures. The dead-end "Search all departments" link works as
  it does for other departments.
- **Search with no department:** results are split into two headed groups, **Packages & Assemblies** first and then
  **Parts**, each with its own count. Both come from the one search, so facets stay as they are.
- **Shops with no departments configured:** browse as today, except the packages split and tile.
- **Fixture tile:**
  - a **Package** badge;
  - "Includes N parts" instead of `mfr · sku`, where N is the count of required lines;
  - the existing Configure link.
- **Fixture sidebar:** labels "Package" instead of "Fixture assembly".

### 2.3 Tests

- **Harness:** cover the index category from `portalCategory`, sanitize, and departments excluding fixtures (filter,
  facets, tiles, editor known categories). Also cover `?dept=packages` browse/search scoping, the landing tile (present
  or absent), the search split, and that `"packages"` is reserved.
- **Smoke:** `/portal/catalog?dept=packages`.

---

## Part 3 (#290) — primary photo + Manual document type

### 3.1 Make primary

- **Button:** in the part editor's Images gallery, a **★ Make primary** button on every real (non-datasheet-render)
  image that isn't already first.
- **Behavior:** it moves that image to index 0 of the real-image group and persists through the existing
  `setImageOrderAction`, sending the full id list with hidden images included. A pure helper `moveImageToFront(ids,
  id, autoBoundary)` does the reorder.
- **First image:** gets a small **Primary** tag.
- **Result:** the portal tile and gallery already use the first visible image, so nothing else changes.

### 3.2 Manual document type

`PartDocKind` gains `"manual"`, and `DOC_SLOT_KINDS` becomes `["datasheet", "specsheet", "manual"]`, label "Manual".
Everything slot-generic picks it up; every hard-coded place is updated.

- **Types and files:**
  - `ALLOWED_TYPES.manual` is PDF only, with the 25 MB cap.
  - Fix `checkDocumentBytes` so its message names the right kind. It currently always says "Datasheets must be PDF
    files."
  - Upload preflight allows `.pdf` for manual.
  - `DocNotNeeded` gains `manual`.
- **Coverage:**
  - `ByKind` / `empty()` gain `manual`.
  - Stop `slot[doc.kind].push` from throwing for unknown kinds.
  - `urlKindOf` maps `"manual"`.
  - The catalog `docs` filter keeps `kind: "manual"` links as manual URLs.
  - Accessory coverage applies to manuals the same way it does to spec sheets.
- **Views:**
  - `DocumentRow` gains `manual`. `documentRow` and `partDocsView` iterate `DOC_SLOT_KINDS` instead of hard-coding.
  - New filter **Missing manual**.
  - A progress line "N of M quoted parts have a manual".
- **Datasheets page:** a **Manual** column. Bulk Fetch links, Mark not needed and Attach existing work for manual.
- **Part editor:** the slots grid shows three slots.
- **Kind guessing:** `guessKind` returns `manual` when the name matches
  `/manual|user[\s_-]*guide|owner'?s[\s_-]*guide|instruction|quick[\s_-]*start/i`. This is checked before the
  spec-sheet rule, so "user guide" means manual while "guide spec" stays a spec sheet. Upload many's kind select lists
  Manual.
- **Fetch:** `buildFetchContext` / `candidateUrls` include catalog manual URLs.
- **Portal:**
  - `docMeta` and `datasheetIdsFor` include manual, so the portal part sidebar lists **Manual** documents.
  - `PartDocVM.kind` gains `manual`; stop coercing unknown kinds to datasheet.
  - The doc route serves manuals with the same cache rule as datasheets.
- **Client package:** a "Manuals" folder.
- **Displays API:** unchanged (datasheets only).
- **Importer:** no new column in this build. Follow-up: a "Manual URL" column fed by the photo-sourcing manifest's
  `manual_url`.

### 3.3 Tests

- **Harness:**
  - `moveImageToFront`.
  - `guessKind` cases ("X manual.pdf", "User Guide", "guide spec" stays a spec sheet).
  - The manual slot through coverage, views and filters.
  - The `checkDocumentBytes` message per kind.
  - The portal doc meta including a manual.
  - The existing #207/#245 suites stay green.
- **Smoke:** `/catalog/documents?show=missing-manual`.

---

## Shipping

- **Per part:** each part gets its own branch, task reviews, a final review, gates (tsc, test:specs, eslint, next
  build, test:smoke), a merge to main and a deploy, in order 1 → 2 → 3.
- **Docs per part:** DECISIONS entries plus a PUNCHLIST entry, with numbers recomputed from origin/main right before
  writing.
- **No migrations:** quotes and fixtures are JSON docs, and the new fields are optional.

## As built — Part 1

Shipped on `feat/288-portal-quotes` (D525–D528, punch #288). Deviations from the sections above:

- **Peak-sent acceptances keep their hub link.** The queue lists customer-built quotes only (§1.7), so the bell's
  "Portal acceptances to confirm" links a Peak-sent estimate to `/quotes?id=<id>`; customer-built ones link
  `/quotes/portal?focus=<id>`.
- **Flame / inspection Approve redirects to the builder.** It calls the existing engine-owned action, which redirects
  to that builder (`?id=…&approved=1`); catalog Approve stays on the queue.
- **Approve is offered only where the existing action can succeed:** any accepted catalog row; flame and inspection
  only when `approveKeepsAcceptedPrice` holds, otherwise the row shows Open only.
- **Legacy `portal-self-serve` Decline is refused inline.** `declinePortalAcceptance` accepts only `portal-catalog`
  and `portal-service`; the action's own message shows on the row.
- **Name box keeps typed names:** the default recomputes on venue change only until the customer types their own.
- **Gates:** tsc 0; test:specs 10,176 PASS; test:smoke 184 PASS / 0 FAIL; `next build` OK.

## As built — Part 2

Shipped on `feat/289-portal-packages` (D533–D535, punch #289). Deviations from §2:

- **"Includes 1 part" is singular.** The tile pluralises as "1 part" / "N parts"; N is the included lines the sidebar
  lists (`includedLines`), labour component rows counted.
- **Landing and breadcrumb copy follows whether departments are configured.** `browseCatalog` reports
  `hasDepartments`. The landing heading reads "Departments" when they are and "Browse" when not; `?dept=packages` shows
  "All departments" / "Search all departments" when they are, and "All products" / "Search all products" only when no
  departments are configured.
- **Groups only when there is a package hit.** The Packages & Assemblies / Parts split renders only with no department
  chosen and at least one package result; otherwise results render as before, with no empty "Packages (0)" heading.
- **Thumbnail tie-break.** Every fixture ranks 1000, so the tile's thumbnail is the first fixture with an engine image
  in rank-then-title order, matching the packages page.
- **Gates:** tsc 0; test:specs 10,264 PASS; test:smoke ALL PASSED (incl. `dept=packages`); `next build` OK.

## As built — Part 3

Shipped on `feat/290-primary-photo-manual` (D536–D538, punch #290). Deviations from §3:

- **Primary tag marks the first visible real image.** A hidden first image passes the tag to the next visible real one;
  a datasheet-render thumbnail never carries it, and ★ Make primary is not offered on hidden images.
- **Unknown document kinds are dropped in the customer view**, not coerced to datasheet.
- **Rollback hazard:** never instant-rollback past #290 once a manual document exists (pre-#290 code throws building
  the coverage index on any manual); no manuals on a preview deploy before #290 is on production.
- **A Word file is still guessed as a spec sheet.** The Word-extension rule runs before the manual name rule, so
  "Manual.docx" stays a spec sheet; a manual is PDF only.
- **A manual alone does not make a part browsable in the portal.** The browse rule stays datasheet or spec sheet; the
  portal tile's document icon does show for a manual-only part.
- **Datasheet-only paths unchanged:** Displays API, DaVinci pre-fill, catalog-wide thumbnail targets; the client
  package gap report does not flag a missing manual.
- **Added:** the "Parts you've quoted before" shelf is hidden on the Packages page (`showQuotedBeforeShelf`).
- **Two older checks updated:** #207 `urlKindOf("manual")` now maps to `"manual"`; the #245 message now names three
  coverage slots.
- **Datasheets table** minWidth is 1080 for the extra column; it scrolls horizontally on narrow screens.
- **Gates:** tsc 0; test:specs 10,373 PASS / ALL PASSED; test:smoke 187/187; `next build` OK.
