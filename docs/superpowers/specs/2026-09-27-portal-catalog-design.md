# Portal Catalog — customers browse, configure and quote the catalog themselves

Date: 2026-09-27 · Branch `feat/portal-catalog` (off `origin/main` 90a9f830) · Punch **#242**
(proposed — recompute the next free punch/D numbers from `origin/main` right before writing docs).

Jeff (2026-09-27):

> Can we brainstorm how we get it so the customer can quote their own catalog items and generate
> their own quotes? I am thinking that it is similar to the estimator however they don't get choices
> on margin or freight and it is only the selector for curtains, fixtures, and catalog. I was also
> thinking that the catalog should start having datasheet and images linked to it that can be
> displayed as a side bar. … I like how full compass or sweetwater does their stuff where you
> explore a website but I also don't want to build out the entire website for it.

Closes MASTER-QUESTIONS **S19** ("what is the customer actually looking for?"). Supersedes the
IDEAS #48 `/portal/estimate` page (archived here) and the stale D63 note that #48 "stays parked".

## Picks confirmed in chat

1. **Who:** existing customers only, behind the portal magic-link login. A future public sign-up
   would *create a customer + grant*, so every quoting user always has a customer and a pricing tier.
2. **Firm vs review:** catalog parts, fixture assemblies (all catalog parts) and the auto-priced
   service quotes are **firm**; curtains go to **Peak review**. *Every* customer quote carries the
   line "All quotes are subject to Peak review and approval."
3. **Visibility:** rule by default + per-part override. **Quotable** = the whole catalog (minus
   hidden). **Browsable** = has an image, or a datasheet, or is frequently quoted.
4. **Unpriced parts** (no cost and no list, "verify price" note, optionally stale cost) show
   **Price on request** and make the whole quote a review quote.
5. **Freight — a new standard, also the Estimator's default:** 2% under 200 drive-miles from the
   shop, +1% per additional 200 miles, **cap 10%**. Unknown distance → cap.
6. **Tax:** no line; "plus applicable sales tax".
7. **Images:** all four sources — upload, fetch from URL, DaVinci image import, datasheet page-1
   thumbnail — in that priority.
8. **Navigation:** full search + **Manufacturer** and **Category** facets usable in either order.
   The department tree is a later follow-up.
9. **Accept** = intent to order pending Peak approval, with **how they'll purchase** (PO · Credit card
   · Check · Other) + **purchasing notes** (+ optional PO file).
10. **Sidebar:** image gallery, name/mfr/part #/price, documents viewed inline, spec text, "Goes
    with" accessories, qty + add, "Ask a question about this part". Fixtures configure in the sidebar.
11. **Architecture:** approach 1 — a new `/portal/catalog` on shared pure modules. Firm quotes valid
    **30 days**. `/portal/estimate` is **archived**; curtains become a no-price **Request curtain
    pricing** panel inside the same module (a priced curtain configurator is a later follow-up, so
    customers only ever use one module).

**Scope note:** self-serve *service* quotes (flame test / repair / inspection) are pick 2's firm
category but are a **separate sub-project** with its own spec → plan cycle. This spec covers the
catalog module only; its freight rule, firm/review split and accept/approve flow are built so the
service sub-project plugs into them.

---

## 1. Catalog media and visibility

### 1.1 Images are a third part-document kind

`src/lib/part-docs/types.ts`:

- `PartDocKind` = `"datasheet" | "specsheet" | "image"`; `PART_DOC_KINDS`, `PART_DOC_KIND_LABEL`
  (`image: "Image"`) and `isPartDocKind` follow.
- `PartDocumentSource` gains `"datasheet-render"`.
- `PartDocumentLink` gains `sort?: number` (gallery order, ascending; missing = after sorted) and
  `hidden?: boolean` (kept linked, never shown to a customer — how a bad auto-thumbnail is
  suppressed without deleting it).

An image is an ordinary shared `part_documents` row linked through `part_document_links`, so one
photo covers a product family exactly as one datasheet does. Upload validation (magic bytes) adds
PNG, JPEG, WebP; images are capped at 10 MB (datasheets keep 25 MB). Accessory **coverage** (the
#207 rule) applies to datasheets/spec sheets only — an accessory never borrows its fixture's photo.

**Sources, in priority order** — the portal shows a part's visible images sorted by source rank then
`sort`:

1. `upload` — part editor Documents section + Upload many (filename matching, as #207).
2. `fetch` — "Add image from URL" through the shared `guardedFetchBytes` SSRF guard.
3. `davinci` — an admin/CLI batch (`npm run images:davinci`) matching the DaVinci image export to
   parts the way the DaVinci datasheet pre-fill matches documents. Only adds to parts with no image.
4. `datasheet-render` — an admin batch rendering page 1 of a part's own datasheet to a PNG
   thumbnail stored as its own image document. Skipped when the part already has any image of rank
   1–3; a later rank 1–3 image outranks it automatically. Rendering uses the headless Chromium already
   used for #222 saved PDFs (`@sparticuz/chromium` + `puppeteer-core`, `src/lib/quote-pdf/render.ts`)
   — no new dependency.

Both batch jobs are resumable and time-budgeted (the #207 fetch pattern: 45 s budget, cursor,
per-item result kept until a later success).

### 1.2 Customers can open documents

New route `src/app/portal/catalog/doc/[id]/route.ts` (distinct from #218's customer-upload route
`/portal/documents/[id]`). It serves a document only when **all** hold:

- a valid `portalSession()` (or a team preview, via `resolvePortalViewer`);
- the document is linked (not `hidden`) to at least one part that is **quotable** for that customer
  (§1.3), or covers such a part through the accessory graph (datasheets/spec sheets only).

Anything else → plain 404, no hint whether it exists. The team route `/api/part-documents/[id]`
stays team-only; the `pk_portal` cookie never authorizes a team route. Images are served with a
long private cache (`Cache-Control: private, max-age=86400`) and the document id as ETag.

### 1.3 Visibility

`CatalogPart.portalVisibility?: "auto" | "show" | "hide"` (missing = `auto`). Written only
through the existing catalog write path (`mergeUpsert`), never cleared by a price-book import.

A pure `src/lib/portal-visibility.ts`:

```ts
type VisibilityFacts = {
  visibility: "auto" | "show" | "hide";
  hasVisibleImage: boolean;
  hasDatasheet: boolean;       // own datasheet/specsheet, or covered by a parent
  quoteCount: number;          // quotes containing the SKU within the window
};
type BrowseRule = { minQuotes: number; windowMonths: number };

quotable(f) → f.visibility !== "hide"
browsable(f, rule) → f.visibility === "show"
  || (f.visibility === "auto" && (f.hasVisibleImage || f.hasDatasheet || f.quoteCount >= rule.minQuotes))
browseReason(f, rule) → "Shown by override" | "Hidden by override" | "Has image" | "Has datasheet"
  | "Quoted N times" | "Not browsable — no image, datasheet, or recent quotes"
```

`quoteCount` counts distinct non-deleted quotes (any status, any customer, excluding Daylite
imports) whose spec lines carry the SKU and whose `createdAt` falls inside the
window. It is computed server-side into a cached per-SKU map (recomputed at most hourly and on
catalog/document writes), not per request.

**Search** always covers every **quotable** part. **Browsable** only governs what appears with no
search term (the landing grid and bare facet listings).

The hard-coded `CUSTOMER_CATEGORIES` list and `buyable()` in `src/lib/portal-catalog.ts` are
removed; that module is replaced by the pricing + visibility modules here.

---

## 2. Pricing and freight

### 2.1 `src/lib/portal-pricing.ts` (server-only)

The browser never computes or submits a price. The server prices at add-to-cart, cart view,
generate, accept and refresh.

- **Tier:** `resolveTier(customerId, grant.name)` (`src/lib/pricing-tiers.ts:65`) — contact tier when
  the grant's name matches one of the company's people, else company tier, else Base.
- **Unit price** = `cost ÷ (1 − tierMargin)`, rounded to cents; when there is no cost, `list`.
  (OPEN-DECISIONS 11-D, today's portal rule.)
- **Price on request (POR)** when any of: no cost and no list (or both ≤ 0); a non-empty `note`
  ("verify price"); **stale cost** — `pricedAt` older than N months, *only* when the setting is on
  (default **off**).
- **Fixture assemblies:** resolved through `resolveFixture` / `fixtureAssembliesFrom`
  (`src/lib/fixture-assemblies.ts`) with the customer's chosen options; the unit price is the sum of
  the chosen components' tier prices × their quantities. Any POR component → the fixture line is POR.
  A fixture is offered only when every *required* component is quotable.
- **Curtains:** always POR in this build.
- **Tax:** none. Documents print "Plus applicable sales tax."

Returned shape is sell-only: `{ sku, unitPrice: number | null, por: boolean, porReason?: string }`.
Cost, margin and tier name never leave the server.

### 2.2 `src/lib/freight-rule.ts` (pure)

```ts
type FreightRule = { basePct: number; stepMiles: number; stepPct: number; capPct: number };
// defaults { basePct: 2, stepMiles: 200, stepPct: 1, capPct: 10 }
freightPctForMiles(miles: number | null, rule): { pct: number; atCapUnknown: boolean }
  // miles null/NaN/negative → { pct: capPct, atCapUnknown: true }
  // else pct = min(capPct, basePct + floor(miles / stepMiles) * stepPct)
```

| miles | pct |
|---|---|
| 0–199 | 2 |
| 200–399 | 3 |
| … | +1 per 200 |
| 1,600+ | 10 (cap) |

**Miles** = one-way drive miles from the quote-origin office (`quoteOrigin(officesFromSettings())`,
`src/lib/geo.ts:180`) to the venue, via the cached real route (`routeCached` → `driveMiles`
fallback), the same path the service quote engines use.

**Freight base** = the freight-bearing equipment total, the Estimator's `systemFreightBase` rule
(`src/app/(app)/estimator/pricing.ts:169`) applied to sell. Labor carries no freight.

**Where it applies:**

- **Portal:** always, no override. The cart and PDF show "Freight (412 mi) — 4%".
- **Estimator:** the default `freightPct` for **new sections** once the quote has a venue
  (replacing the hard-coded `2` at `estimator-client.tsx:107`). Pre-filled, not locked; a section
  whose freight staff never touched re-computes when the venue changes. Unknown distance → cap plus
  a small section flag "Freight at max — venue not located". Saved quotes are not rewritten.
- **Quick Design** keeps `system.freightPct` (follow-up, §7).

### 2.3 Firm vs review

`quoteMode(lines) → "firm" | "review"`: **review** iff any line is POR (including every curtain
line); otherwise **firm**. Pure, in `portal-pricing.ts`'s pure sibling `src/lib/portal-quote-mode.ts`
so the cart UI can show the badge from the server-priced lines.

---

## 3. The portal browse experience

### 3.1 `/portal/catalog`

Replaces "Estimate" in the portal nav (`src/app/portal/shell.tsx`). `/portal/estimate` redirects
here (the page and `estimate-builder.tsx` are deleted; `submitPortalEstimate` is removed).

- **Search** box: SKU, description, manufacturer, manufacturer part/model numbers; server-side
  query, **48 per page** with numbered paging (like the companies directory — never endless scroll).
- **Facet rail:** **Manufacturer** and **Category**, each with counts computed over the *current*
  result set, so picking either narrows the other — either order works. Each facet list has its
  own filter box. Selected facets show as removable chips.
- **No search term:** the browsable set (§1.3) + a **"Parts you've quoted before"** shelf (distinct
  SKUs from this company's own app-era quotes, newest first, max 12, quotable only).
- **Result tiles:** image (or a datasheet icon, or a neutral placeholder), name, manufacturer, part
  number, price or "Price on request", quick **Add** (qty 1). Fixture assemblies show a "Configure"
  button instead of Add.
- URL state: `?q=&mfr=&cat=&page=&part=` so a search and an open sidebar are linkable and survive
  refresh.

### 3.2 Part sidebar

Right-hand panel; a full-screen sheet under 768 px.

1. Image gallery (visible images, §1.1 order).
2. Name, manufacturer, part number, unit, price or "Price on request".
3. **Documents** — datasheet/spec sheet (own or covered), opened inline in a viewer via
   `/portal/catalog/doc/[id]`, with an "Open in new tab" link.
4. Spec text (the part's authored `spec*` fields, when present).
5. **Goes with** — accessories from `part_accessory_links`, quotable only, each with its own Add.
6. Qty + **Add to quote**.
7. **Ask a question about this part** — name/email pre-filled from the grant, a message box;
   creates a lead in the Leads SLA queue like `submitPortalRequest` (source `"existing"`, no owner),
   pre-linked to the customer and carrying the SKU.

**Fixture assemblies:** the sidebar becomes the configurator — one picker per option box (lens,
data, power, mounting, accessories), required boxes marked, a live server-priced total, then Add.
The chosen options are saved on the cart line and re-resolved on the server at every pricing step.

### 3.3 Request curtain pricing

A header button opens a panel with the **same inputs as the Estimator's curtain configurator**
(`src/app/(app)/estimator/curtain-modal.tsx`), reusing the browser-side `curtain-geom.ts` for
geometry only — **no price is shown**. Submitting adds a line "Curtain — price on request" with the
inputs stored on the line, which makes the quote a review quote.

### 3.4 Cart — `/portal/catalog/quote`

Header chip "Quote (N)" links here.

- **Venue** picker (the customer's venues) — required before Generate; it drives freight.
- Lines: qty edit, remove, fixture options summary, curtain inputs summary, POR marker.
- Subtotal · Freight (miles, %) · Total. POR lines show "—" and the total reads "Total (excludes
  items pending price)".
- Badge **Firm quote** or **Needs Peak review** with the reason ("2 lines are price on request").
- The standing line *"All quotes are subject to Peak review and approval."*
- **Generate quote**.

---

## 4. Cart → quote lifecycle

Existing statuses `draft · sent · won · lost` (`src/lib/stores/quotes.ts:51`). New quotes carry
`source: "portal-catalog"` and `quoteType` = the Estimator's type, so #221's `quoteBuilderHref`
opens them in the Estimator. The Quotes hub shows a **Portal** badge for this source.

The spec subdoc is the Estimator's `{ sections, mobs }` shape: one section per line kind
(`SEC-EQUIP`, `SEC-FIXT`, `SEC-DRAPE`), each with the portal `freightPct`; items carry
`{ sku, desc, qty, unit, cost, price, … }` with **cost filled server-side** so staff see real
margins, plus `por?: true`, `fixtureOptions?`, `curtainInputs?`.

### 4.1 Cart

The cart is **not** a quote row. Every quote insert gets an estimate number immediately (#223:
`numberNewDoc` → `assign_estimate_numbers()`), so a cart-as-draft-quote would burn a number per
abandoned cart and need a "hide carts" exception on every staff surface. Instead:

- A new doc collection **`portal_carts`**, one document per portal grant (`id` = grant id):
  `{ id, customerId, venueId?, lines: CartLine[], updatedAt }`, where `CartLine` =
  `{ lineId, kind: "part" | "fixture" | "curtain", sku?, fixtureId?, fixtureOptions?, curtainInputs?, qty }`.
  **No prices are stored on the cart** — they are computed on every read (§2.1).
- Carts never appear on any staff surface, so no exclusion logic is needed anywhere.
- **Generate** creates the quote (§4.2/§4.3) — that insert is what allocates the estimate number —
  then empties the cart.
- A cart untouched for 90 days is simply shown empty-with-notice on next visit (cleanup of the rows
  themselves is a follow-up).

### 4.2 Generate — firm path

- Create the quote (the insert allocates its estimate number, #223); `status: "sent"`; stamp
  `portalFirm: { generatedAt, validUntil: generatedAt + validityDays }`.
- Generate the saved PDF (#222) with the review line, freight with miles, "Plus applicable sales tax"
  and "Valid until <date>".
- **Owner** = the company's account owner; none → unassigned (Sales queue).
- Bell notice to the owner: "Portal quote EST-1107 generated — $4,812".
- The portal lists it with its PDF and **Accept**.

### 4.3 Generate — review path

- Create the quote as `draft` (numbered on insert, so the customer has a reference); stamp
  `portalReview: { requestedAt, reasons: string[] }`.
- A **"Portal quote needs review"** item in the Leads SLA queue for the owner (unassigned → queue).
- The customer sees it as **"In review — Peak will confirm pricing"** (the existing
  `portalListsQuote` rule already lists a customer's own portal drafts; it is extended to
  `portal-catalog`).
- Staff price the POR lines in the Estimator (a banner lists them) and **send** normally; sending
  clears `portalReview`. From then it is an ordinary sent quote the customer can accept. Staff-sent
  quotes keep their normal terms — `portalFirm.validUntil` applies only to firm generations and
  refreshes.

### 4.4 Accept

Allowed when `portalCanAcceptQuote` holds (sent, this customer's, not already accepted) **and**,
for a firm generation, `now ≤ validUntil`.

The dialog asks:

- **How will you purchase?** PO · Credit card · Check · Other (required).
- **Purchasing notes** (optional, 1,000 chars), helper text *"Don't enter card numbers — we'll call
  you to take payment."* A server check rejects text containing a 13–19 digit run that passes Luhn,
  with that same message.
- **PO file** (optional) through the #218 portal upload, linked to the quote.

`portalAcceptance` extends to `{ at, by, byEmail, purchaseMethod, notes?, poDocumentId? }`
(additive; old records stay valid). The owner gets a to-do **"Approve portal order EST-1107"**.

Staff, on the quote: **Approve** → `won` through the normal status path (the normal Won flow runs).
**Decline with note** → clears `portalAcceptance`, stores `portalDecline: { at, by, note }` shown in
the portal; the quote stays `sent`.

### 4.5 Expiry and refresh

Past `validUntil`, Accept is disabled and **Refresh pricing** appears. Refresh re-prices every line
at current cost + tier and the venue's current freight, as a **new revision** (so #222's saved PDFs
stay truthful), and restarts `validUntil`. If any line is now POR, the refreshed quote takes the
review path (§4.3) instead.

### 4.6 Editing

Customers never edit a generated quote. **Copy to new quote** loads its lines (options and curtain
inputs included) into the customer's cart, replacing nothing already there without asking.

---

## 5. Staff side and settings

**Estimating Rules → "Portal & freight"** group (`src/lib/stores/pricing.ts` rate rows):
`freight.basePct` 2 · `freight.stepMiles` 200 · `freight.stepPct` 1 · `freight.capPct` 10 ·
`portal.validityDays` 30 · `portal.browseMinQuotes` 3 · `portal.browseWindowMonths` 24 ·
`portal.staleCostMonths` 0 (= off).

**Catalog part editor:** Customer visibility (Auto · Show · Hide) with `browseReason` shown beside
it. Images appear in the Documents section with drag order and a hide toggle.

**Catalog → Datasheets** (`/catalog/documents`): an **Image** slot column and filter ("quoted parts
missing an image"); Upload many accepts images; "Add image from URL"; admin buttons for the
**DaVinci image import** and **Datasheet thumbnails** batches (§1.1).

**Quotes:** Portal badge; a review banner listing POR lines; on an accepted quote, the purchase
method, notes and PO file with **Approve** / **Decline with note**.

**Company record:** a "Portal activity" line — "3 portal quotes · 1 awaiting approval".

---

## 6. Security, errors, testing

### Security

- Every portal action and route takes `customerId` from `portalSession()` / `resolvePortalViewer`
  only; a submitted customer id is ignored.
- Prices are server-canonical; client-sent prices are ignored. Cost, margin and tier never cross to
  the browser — search results, sidebar, cart and PDF carry sell only.
- A `hide` part cannot be added, including by typed SKU or a stale cart; documents serve only per
  §1.2.
- Rate limits (the Displays API limiter pattern) on search (per grant) and "Ask a question".
- No card data is stored (§4.4 Luhn check).

### Errors

- Expired grant on any action → the standard "Your access link has expired — open the link we sent
  you again."
- A cart line whose part became hidden or deleted → "No longer available", excluded from Generate.
- Venue without a location → freight at cap; staff-side flag.
- PDF still rendering → the existing #222 "being prepared" response.
- Generate on an empty cart or without a venue → disabled with the reason.

### Testing

- **Pure specs:** `freightPctForMiles` (0, 199, 200, 399, 1,599, 1,600, 5,000, null, negative,
  custom rules); `quotable` / `browsable` / `browseReason` across every visibility × fact combo;
  `quoteMode`; unit pricing (cost path, list fallback, each POR reason, stale-cost on/off); fixture
  pricing with a POR component and a hidden required component; `validUntil` / accept eligibility;
  the Luhn guard.
- **DB-backed specs:** cart create/one-per-grant (no quote row, no estimate number until Generate); generate firm (number, sent, validUntil, owner,
  notice) and review (draft, queue item, portal listing); accept → approve → won; accept → decline;
  expiry → refresh as a new revision, and refresh flipping to review; doc route allow/deny (hidden
  link, hidden part, other customer, accessory coverage, image not coverable); Estimator new-section freight default from a venue.
- **Smoke GETs:** `/portal/catalog`, `/portal/catalog/quote`, `/portal/estimate` → redirect.
- The four gates (tsc, test:specs, test:smoke, eslint vs baseline) plus `next build` (the portal
  pages are client-heavy; guard against a client component importing a store).

---

## 7. Out of scope — follow-ups to log

- **Self-serve service quotes** (flame test / repair / inspection) — separate sub-project, next
  spec; reuses §2.3 and §4.
- **Priced curtain configurator** in the same module (replaces §3.3).
- **Department tree** navigation over the facets.
- **Quick Design** adopting the freight rule.
- **Public sign-up** (creates a customer + grant) and public browse.
- Stock / lead time; online card payment.
- Abandoned-cart row cleanup.
- Stale-doc cleanup: `DECISIONS.md` D60 (grant length 6 months vs the 90-day code) and D63 (#48
  "parked") are out of date.
