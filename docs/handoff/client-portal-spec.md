# Customer Portal — functional specification (handoff)

Status: written 2026-11-19 from the code in this repository, for a team that will rebuild the
feature in a different application. The portal is being archived here.

How to read this document

- It describes behaviour, not implementation. Where a rule is stated as "MUST", the current code
  enforces it and a rebuild should too.
- "Peak" means the business that owns the app (Peak Systems Group, a theatrical rigging, drapery,
  lighting and AV contractor). "Staff" means signed-in team members. "Customer" means a company in
  the CRM. "Venue" means one of a customer's physical locations.
- Every section ends with a **Source** line listing the repository files it was derived from.
  Paths are relative to the repository root.
- "Not verified" means the behaviour was taken from project notes or a code comment and was not
  traced through the code. Section 12 collects all of these.
- Where project documentation and code disagree, the code is described and the disagreement is
  noted (section 11.3).

Contents

1. Purpose and users
2. Access, sessions and tenant scoping
3. Data model
4. Screens and routes
5. Catalog rules
6. Pricing rules (catalog)
7. Cart, Generate, and the quote lifecycle
8. Service quotes (flame test, inspection)
9. Other customer-facing features (documents, online estimate, bidders, meetings, requests, rewards)
10. Staff side
11. Security rules, known gaps, and doc-versus-code disagreements
12. Not verified

---

## 1. Purpose and users

The portal is a self-service website for Peak's existing customers. It sits beside the staff
application on the same domain under `/portal`. A customer contact who has been given access can:

- see the quotes and estimates Peak has sent their company, open them online or as a PDF, and
  accept them;
- see their projects (name, venue, stage, dates, sometimes value);
- see each venue's compliance status (annual flame test; rigging inspection Level 1 annual and
  Level 2 five-year) and get a quote for the next one;
- browse a product catalog at their own prices, build a cart, and generate a real numbered quote
  with no staff involvement when every line can be priced by rule;
- generate a firm quote for flame testing or a rigging inspection at one or more venues;
- send a free-text request (repairs, new systems, anything else), which becomes a lead for staff;
- exchange files with Peak;
- read meeting summaries that staff chose to share;
- see a rewards level, points and perks, when Peak has turned that program on.

There are three kinds of viewer:

| Viewer | How they get in | What they can do |
| --- | --- | --- |
| Customer contact | A personal access link (a "grant") | Everything above, for their own company only |
| Bidder contact | The same kind of grant, for a contractor company (GC or EC) that Peak sent a bid to | Also sees a read-only "Bids" list for estimates their company bid on (section 9.3) |
| Staff previewer | Signed in to the staff app, opens `/portal?preview=<customerId>` | Sees that customer's portal. Most actions are disabled (section 2.5) |

There is no separate bidder account type. A grant belongs to a company; what that company sees
depends on whether it is the customer of a quote or a bidder on it.

The portal never uses AI. All prices are computed by fixed rules.

**Source:** `src/app/portal/page.tsx`, `src/app/portal/nav.ts`, `src/lib/portal.ts`,
`src/lib/portal-viewer.ts`, `AGENTS.md` (phases 4, 19, 20, 22, 23, 28, 30, 62).

---

## 2. Access, sessions and tenant scoping

### 2.1 What staff authentication it sits outside of

The staff app uses Google sign-in with an invite list. A single middleware redirects every
unauthenticated request to the login page, except a fixed list of public path prefixes. `portal`,
`share/`, `print/` and `d/ds/` are on that list. Nothing under `/portal` is protected by the staff
login. Every portal page, server action and file route therefore authenticates itself, using the
rules below. A rebuild MUST keep this property: there is no shared gate to rely on.

### 2.2 Grants

A grant is one person's access to one company's portal.

| Field | Meaning |
| --- | --- |
| `id` | `PG-` + 10 hex characters |
| `customerId` | The company this grant opens |
| `name`, `email` | The person. `name` is also used to find their personal pricing tier (section 6.1) |
| `dept` | Optional, stored but unused (section 11.2) |
| `tokenEnc` | The access token, AES-256-GCM encrypted at rest |
| `token` | Legacy plaintext token on old grants; still honoured |
| `createdAt`, `createdBy` | Audit |
| `expiresAt` | Hard expiry: creation + 90 days |
| `revokedAt` | Set when staff revoke; null otherwise |
| `lastSeenAt` | Updated at most once every 10 minutes while the person uses the portal |
| `inviteSentAt` | When the sign-in email was last sent (cooldown) |

Rules

- The token is 32 random bytes, hex encoded (64 characters).
- The access link is `/portal/access?t=<token>`.
- A token is valid when it matches a grant that is not revoked and not past `expiresAt`. Matching
  uses a constant-time comparison. Tokens shorter than 32 characters are rejected without a lookup.
- All grants are stored in one settings record (a keyed map), not a table. Lookup scans every
  grant. This is acceptable only because volume is small (section 11.2).
- Revoking writes `revokedAt` under a row lock, re-reading the grant first so a concurrent
  "last seen" update cannot undo it. A revoked grant stops working on the next request; there is
  no session to invalidate separately, because the cookie holds the token itself.
- There is no "extend" or "renew". After 90 days staff create a new grant.

### 2.3 Sign-in flow

1. The person opens `/portal/access?t=<token>`.
2. If the token is valid, the server sets a cookie and redirects to `/portal`.
3. If not, the server deletes any portal cookie and redirects to `/portal?denied=1`, which shows
   "That access link didn't work". The response is the same whether the token never existed, was
   revoked, or expired.

Cookie

| Property | Value |
| --- | --- |
| Name | `pk_portal` |
| Value | The raw token |
| `httpOnly` | yes |
| `sameSite` | `lax` |
| `secure` | yes in production |
| `path` | `/portal` |
| `maxAge` | 90 days |

Every request re-validates the cookie's token against the grants. "Sign out" deletes the cookie
and returns to `/portal`.

### 2.4 Tenant scoping

The session resolved from the cookie is `{ grantId, customerId, name, email }`.

- Every read and write MUST take `customerId` from the session. No portal action accepts a
  customer id from the browser. Where the browser sends an id (a quote, a venue, a document, a
  cart line), the server checks that it belongs to the session's company before using it.
- Server actions that look up the session treat a lookup failure as "signed out" and return
  "Your access link has expired — open the link we sent you again."
- Refusals for things outside the tenant use the same wording or status as "does not exist", so a
  caller cannot probe which ids are real.

### 2.5 Staff preview

A signed-in staff member can open portal pages with `?preview=<customerId>`.

- The preview parameter is honoured only when a staff session exists and the customer exists. It
  then takes precedence over any portal cookie. For anyone else the parameter is ignored.
- The preview session has `grantId = "preview"` and uses the customer's primary contact's name and
  email (so the personal pricing tier of that contact applies).
- Every write path refuses a session whose `grantId` is `"preview"`.
- In preview: the Cart nav item is disabled; Add to quote, Generate, Accept, Refresh pricing,
  Rename, Copy to new quote, file upload, rewards Redeem and "Request a quote" are hidden or
  disabled; prices are shown; the service form is read-only with a price computed once on the
  server.
- A banner on each page says it is a team preview and links back to the customer record. The
  Home banner reads "Actions here still affect real data", although the actions are in fact
  disabled (section 11.2).
- The request form page (`/portal/request`) and the document download route
  (`/portal/documents/<id>`) do not support preview. In preview, document links point at the staff
  download route instead.

### 2.6 Managing grants (staff)

On the customer (company) record there is a "Customer portal" card.

- Staff pick one of the company's contacts that has an email, or type a name and email, and
  create a link.
- On create, the app tries to email the link from the creating staff member's own connected Gmail
  mailbox, with a short welcome note. If that mailbox is not connected or the send fails, the link
  is copied to the clipboard and the card says "Couldn't email it — copy the link instead."
- Each active grant row shows name, email, created date, last seen, and has Copy link, Resend
  link and Revoke.
- Resend is limited to one email per grant per minute ("Just sent — wait a minute before
  resending."), and refused for a revoked or expired grant.
- The emailed thread is deliberately not linked to the customer record, so the token stays in the
  sender's private mailbox and is not shared with the rest of the team.
- The token is never written to logs or error messages.
- The card has a "Preview" link to `/portal?preview=<customerId>`.
- Any signed-in staff member can create, resend and revoke. There is no role check (section 11.3).

Welcome email (plain text)

```
Subject: Your <company name> customer portal

Hi <first name>,

You now have access to the <company name> customer portal for <customer>. You can see your
quotes and venue compliance, and request a quote or service any time.

Your personal sign-in link (no password needed):
<absolute link>

The link is just for you — please don't forward it. It works for 90 days; ask us for a new one
any time.
```

### 2.7 Rate limits

All limits are sliding windows, counted per grant unless stated. In preview they are counted per
previewed customer. The limiter is in-memory per server process (section 11.2).

| Action | Limit | Refusal text |
| --- | --- | --- |
| Catalog page render, part sidebar load, cart page render | 240 / minute | "Too many requests — try again in a minute." |
| Catalog search action | 120 / minute | "Too many searches at once — wait a moment and try again." |
| Fixture live price | 240 / minute | "Too many requests — try again in a minute." |
| Curtain live price (separate budget) | 240 / minute | same |
| Cart edits (add, set quantity, remove, set venue) | 120 / minute, shared | "Too many changes at once — wait a moment and try again." |
| Ask a question about a part | 5 / hour | "You've sent several questions this hour — we'll get back to you soon, or call us." |
| Generate catalog quote | 10 / hour | "You've generated several quotes this hour — try again later, or call us." |
| Generate service quote (separate budget) | 10 / hour | same |
| Service live price | 240 / minute | "Too many price checks — wait a moment and try again." |
| Accept quote | 10 / hour | "You've tried to accept several times — try again later, or call us." |
| Refresh pricing | 10 / hour | "You've refreshed pricing several times this hour — try again later, or call us." |
| Copy to new quote | 20 / hour | "You've copied several quotes this hour — try again later, or call us." |
| Rename quote | 30 / hour | "You've renamed quotes several times this hour — try again later." |
| Catalog document or image file | 300 / minute | HTTP 429 |
| Online estimate photo | 300 / minute | HTTP 429 |
| Bidder PDF (rendered on demand) | 6 / minute | HTTP 429 |
| Sign-in email resend | 1 / minute per grant | "Just sent — wait a minute before resending." |

Rules that apply to several limits

- A limit token is spent only when the request was otherwise valid. Validation refusals do not
  count.
- Generate, Ask and Rename refund the token when the write fails, so a failed attempt does not
  block a retry.
- The free-text request form and the "Send us files" upload have no rate limit (section 11.2).

**Source:** `src/middleware.ts`, `src/lib/portal.ts`, `src/lib/portal-viewer.ts`,
`src/lib/portal-invite.ts`, `src/app/portal/access/route.ts`, `src/app/portal/actions.ts`,
`src/app/portal/signed-out.tsx`, `src/app/(app)/companies/actions.ts`,
`src/app/(app)/companies/[id]/portal-access.tsx`, `src/lib/rate-limit.ts`,
`src/lib/portal-catalog-browse.ts`, `src/lib/portal-part-detail.ts`,
`src/lib/portal-cart-actions.ts`, `src/lib/portal-quotes.ts`, `src/lib/portal-service-quotes.ts`,
`src/app/portal/service/actions.ts`, `src/lib/parties/portal-bid-server.ts`,
`src/app/portal/catalog/doc/[id]/route.ts`, `src/app/portal/quotes/[id]/photo/[docId]/route.ts`.

---

## 3. Data model

The app stores most records as JSON documents in per-collection tables with the shape
`(id, doc, rev, seq, updated_at, received_at, review, deleted)`, plus small "settings blobs"
keyed by name. Field names below are the JSON keys. Timestamps are epoch milliseconds.

### 3.1 Records owned by the portal

| Record | Storage | Id | Notes |
| --- | --- | --- | --- |
| Grants | Settings blob `portal_grants`, a map of id to grant | `PG-` + 10 hex | Section 2.2 |
| Cart | Collection `portal_carts` | The grant id | One cart per grant. Section 3.2 |
| Departments | Settings blob `portal_departments` = `{ departments: [...] }` | Slug of the name | Section 5.4 |
| Portal rules | Four numeric rates in the shared "Estimating Rules" rate store | `portal.validityDays`, `portal.browseMinQuotes`, `portal.browseWindowMonths`, `portal.staleCostMonths` | Defaults 30, 3, 24, 0 |
| Freight rule | Four numeric rates in the same store | `freight.basePct`, `freight.stepMiles`, `freight.stepPct`, `freight.capPct` | Defaults 2, 200, 1, 10. Shared with the staff Estimator |

### 3.2 Cart

```
PortalCart {
  id: string            // = grant id
  customerId: string
  locationId: string | null     // the venue the quote is for
  lines: CartLine[]              // at most 200
  updatedAt: number
}
CartLine {
  lineId: string        // 8 characters, random
  kind: "part" | "fixture" | "curtain"
  sku?: string                           // part
  fixtureId?: string                     // fixture (package)
  fixtureOptions?: { [slot:sku]: qty }   // chosen add-on quantities, integers 0..10000
  curtainInputs?: CurtainRequest         // curtain
  qty: number                            // integer 1..10000
}
CurtainRequest {
  name: string          // 1..80 characters
  fabricSku: string     // "" means "Not sure — recommend one"
  fabricName: string    // always taken from the server's fabric list
  qty: string           // informational copy of the line qty
  width: string         // feet, > 0 and <= 200, two decimals
  height: string        // same
  fullness: "0" | "50" | "75" | "100"
}
```

Rules

- A cart never stores a price. Every view re-prices from the catalog.
- A cart is not a quote. No estimate number is allocated until Generate.
- Reading a cart whose stored `customerId` differs from the session's returns an empty cart; the
  next save overwrites it.
- Adding a part whose SKU is already in the cart adds to that line's quantity. Fixtures and
  curtains always add a new line.
- A quantity above 10,000 is clamped. A quantity below 1 or a non-integer is refused with "Enter a
  quantity from 1 to 10,000."
- Adding a new line to a cart that already has 200 is refused with "Your quote can hold up to 200
  lines."
- After Generate the cart is soft-deleted (it reads as empty).
- Carts are excluded from the offline sync endpoints that staff devices use.

### 3.3 Quote fields the portal reads and writes

Quotes live in the shared `quotes` collection. Internal id `Q-####` (from 2041). Displayed number
`<PREFIX>-<n>` from one shared counter starting at 1001, with an optional `-2`, `-3` suffix:
`EST` system estimate, `FLM` flame test, `RIG` inspection, `REP` repair, `RNT` rental, `CON`
consulting.

| Field | Values | Used for |
| --- | --- | --- |
| `status` | `draft`, `sent`, `won`, `lost` | Customer wording: sent = "Awaiting your review", won = "Accepted", lost = "Declined" |
| `source` | `portal-catalog` (catalog cart), `portal-service` (service intake), `portal-self-serve` (retired builder, legacy data only), `daylite` (imported history), plus staff sources such as `estimator` | Decides listing, "customer-built", refresh eligibility |
| `quoteType` | absent or `system`, `flame_test`, `inspection`, `repair`, `rental`, `consulting` | Type label, which engine re-prices, PDF kind |
| `customerId`, `locationId`, `contactName` | | Tenant scoping, freight, tier lookup |
| `name` | up to 120 characters | Customer-editable on customer-built quotes |
| `value` | number | The total shown to the customer |
| `margin`, `pricingTier`, `tierMargin` | | Staff-only. Stamped at Generate and Refresh. Despite the names they hold markup on cost |
| `owner`, `preparedBy` | staff names | Set to the company's account owner at Generate; `owner` blank means unassigned |
| `spec` | `{ sections: [...], mobs: [] }` | The priced lines of a catalog quote, in the staff Estimator's own format, including cost. Never sent to a browser |
| `flameTest` / `inspection` | sub-document | The priced scope of a service quote: venues with counts, level, trip, rates, totals, contact |
| `portalFirm` | `{ generatedAt, validUntil }` or null | A quote priced entirely by rule and sent automatically |
| `portalReview` | `{ requestedAt, reasons: string[] }` or null | A catalog quote waiting for Peak to price or confirm |
| `portalAcceptance` | `{ at, by, byEmail, purchaseMethod, notes, poDocumentId, signerName, signerTitle, poNumber? }` or null | The customer accepted online |
| `portalDecline` | `{ at, by, note }` or null | Staff declined the acceptance; shown back to the customer |
| `revisions` | list; each has `rev`, `at`, `reason`, `name`, `value`, `spec`, `docFields`, `pdfBlobPath` | A revision with `reason: "sent"` is a frozen copy of what the customer was sent |
| `pdf` | `{ status: pending|ready|failed, savedAt, blobPath, ... }` | The current rendered PDF |
| `bid` | `{ dueAt, addenda, awardedPartyId }` | Bid details when the estimate went to contractors |
| `bidScopeOnly` | `true` or absent | Sticky flag: the owner's portal shows this estimate without prices (section 9.3) |
| `shareLink` | `{ nonce, expiresAt }` | Backing data for public client links (section 9.2) |

Line-level flags inside `spec.sections[].items[]` that the portal sets:

| Flag | Meaning |
| --- | --- |
| `por: true` | Price on request: no price could be computed. `price` is 0 |
| `portalConfirm: true` | A priced curtain that Peak must confirm before the quote is sent |
| `fixture: true`, `fixtureId`, `fixtureOptions`, `components[]` | A package line and how to rebuild it |
| `curtain: true`, `curtainInputs` | A curtain line and how to rebuild it. SKU is `CRT-P` (priced) or `CRT-REQ` (price on request) |

Catalog quotes always have up to three sections, in this order, omitted when empty:
"Equipment & supplies" (`SEC-EQUIP`), "Fixtures" (`SEC-FIXT`), "Drapery & soft goods"
(`SEC-DRAPE`). Each carries `freightPct`, `freightMiles` and `freightAuto: false`.

### 3.4 Records the portal reads but does not own

| Record | What the portal uses |
| --- | --- |
| Customers (companies) with `locations[]` (venues) and `contacts[]` | Names, venue labels, city/state, coordinates or saved travel miles, account `owner`, pricing tier on the company and on each contact |
| Catalog parts | SKU, description, manufacturer, category, unit, cost, list price, price note, price date, `portalVisibility` (`auto`/`show`/`hide`), former SKUs, spec text, fabric area rate |
| Part documents and links | Images, datasheets, spec sheets, manuals; accessory links between parts |
| Fixture assemblies ("packages") | Light engine, lens, lines by slot with quantity (0 = optional add-on), `portalCategory` |
| Manufacturers | A fallback image per manufacturer |
| Leads | Created by requests and part questions; open ones are listed on Home |
| Projects | Listed on Home through a whitelist |
| Flame jobs and inspection records | Compliance chips and count pre-fill |
| Documents (`DOC-` + sequence from 1000) | Shared files (section 9.1) |
| Party rows (`record_parties`, id `pty_` + hash) | Which contractor companies bid on a quote, and their bid state |
| Meetings | Only those with a `share` object linked to the customer |
| Rewards | A whitelisted view (level, progress, points, perks) |

**Source:** `src/db/doc-tables.ts`, `src/lib/portal.ts`, `src/lib/portal-cart-types.ts`,
`src/lib/stores/portal-carts.ts`, `src/lib/stores/portal-departments.ts`,
`src/lib/stores/quotes.ts`, `src/lib/estimate-number.ts`, `src/lib/freight-rule.ts`,
`src/lib/freight-rule-load.ts`, `src/lib/portal-pricing.ts`, `src/lib/document-rules.ts`,
`src/lib/portal-catalog-index.ts`.

---

## 4. Screens and routes

All pages share one layout: a dark top bar with Peak's logo (or an initial), "Customer portal",
the signed-in person's name and company, and Sign out; a navigation row; the content; a footer
line. Navigation: **Home · Catalog · Service · My quotes · Meeting notes · Cart (N)**. The cart
badge is the number of cart lines. Every page shows the signed-out card when there is no valid
session:

- Normal: "Sign in with your access link" with an explanation that the portal uses personal links.
- After a failed link (`?denied=1`): "That access link didn't work".

### 4.1 Route list

| Route | Kind | Purpose |
| --- | --- | --- |
| `/portal` | Page | Home dashboard |
| `/portal/access?t=` | Redirect | Sign-in link landing |
| `/portal/catalog` | Page | Catalog browse, search, part sidebar |
| `/portal/catalog/quote` | Page | Cart |
| `/portal/catalog/doc/<docId>` | File | A catalog image, datasheet, spec sheet or manual |
| `/portal/service` | Page | Flame test / inspection quote intake |
| `/portal/my-quotes` | Page | Quotes the customer built |
| `/portal/quotes/<quoteId>` | Page | Online view of a sent estimate |
| `/portal/quotes/<quoteId>/pdf` | File | The quote's PDF |
| `/portal/quotes/<quoteId>/photo/<docId>` | File | A product photo printed in that estimate |
| `/portal/request` | Page | Free-text request form |
| `/portal/meetings` | Page | Shared meeting summaries |
| `/portal/documents/<docId>` | File | Download a shared document |
| `/portal/documents/upload` | API | Issues a direct-upload token for "Send us files" |
| `/portal/estimate` | Redirect | Retired builder; redirects to `/portal/catalog` |
| `/share/quote/<quoteId>/<token>/...` | Pages and files | Public client links, no portal session (section 9.2) |

### 4.2 Home — `/portal`

Shows, top to bottom:

1. Preview banner (preview only).
2. "Welcome, <first name>" and two buttons: "Shop the catalog" and "+ Request a quote".
3. One-time banners driven by query parameters:
   - `?sent=1`: "Request received — the team has it in their queue…"
   - `?accepted=1`: "Thanks — we've flagged your acceptance… nothing is final until they do."
     With `&filewarn=1`: "Your file didn't attach — you can email it to us, or try again from the
     quote."
   - `?copyerr=1`: "Couldn't copy that quote — try again, or call us."
4. Rewards card, only when the rewards program is on (section 9.6).
5. **Your open requests**: the company's leads in an open stage, newest first. Each shows the
   request type, sent date, contact, and a chip "With our team" or "Quote on its way" (stage
   `quoted`). Empty: "No open requests — use "Request a quote" any time you need us."
6. **My quotes** summary card: "<n> open · View all →", or a prompt to build one from Catalog or
   Service.
7. **Bids** card, only when the company has bid rows (section 9.3): Open and History groups.
8. **Your quotes & estimates**: quotes Peak sent (not customer-built), grouped Open (sent) and
   History (won, lost), newest activity first. (The grouping function also places drafts under
   Open, but the list rule keeps staff drafts out, so in practice Open holds sent quotes.) Empty: "Nothing here
   yet — quotes and estimates we send you will appear here."
9. **Your projects**: Active and History groups. Each row shows name, venue, type, dates (or
   target date), value (only when known and the linked quote is won and is not scope-only), and
   stage chip. Imported historical projects are never listed.
10. **Your venues & compliance**: one row per venue with chips:
    - Flame test: "current — last <date>", a due/overdue label, or "no record".
    - Inspection L1: same. Inspection L2: shown only when a record exists.
    - Each chip has a "Quote it" link to `/portal/service?type=…&level=…&venue=…`. The link is
      emphasised when the item is overdue, due soon, or has no record (L2: only overdue or due
      soon).
    - "Request a repair" link to `/portal/request?service=Repair&venue=…`.
    - Header link "Get a service quote".
    - Empty: "No venues on file yet — mention your venue in a quote request and we'll add it."
11. **Documents** (section 9.1).

A quote row (used on Home and My quotes) shows: name (links to the online view when one exists,
else the PDF, else plain text), number and date, the total, a status chip, "Open PDF ↗" or
"Document being prepared" or "PDF not available — contact your rep", and actions.

Status chip, first match wins:

| Condition | Chip |
| --- | --- |
| Draft, source `portal-catalog`, has `portalReview` | "In review — Peak will confirm pricing" |
| Draft (other) | "In review with our team" |
| Sent, not accepted, past `portalFirm.validUntil` | "Pricing expired" |
| Sent, not accepted, has `portalFirm` still valid | "Valid until <date>" |
| Sent and accepted | "Accepted — awaiting confirmation" |
| Otherwise by status | "Awaiting your review" / "Accepted" / "Declined" |

Actions (all hidden in preview):

- **Accept quote** when acceptance is allowed (section 7.5).
- **Refresh pricing** when expired (section 7.4).
- **Copy to new quote** on `portal-catalog` quotes (section 7.6).
- **Quote again** on any flame-test or inspection quote; opens the service form pre-filled.
- **✎ Rename** on My quotes rows while allowed (section 7.7).
- A staff decline note, when present, is shown under the row.

### 4.3 Catalog — `/portal/catalog`

URL state: `?q=&mfr=&cat=&page=&part=&dept=` (`mfr` and `cat` may repeat). Everything is
linkable and survives refresh.

- Search box: "Search by part number, name or manufacturer". Typing searches after 250 ms.
- Facet rails for Manufacturer and Category with counts. Each facet's counts are computed over
  results filtered by the other facet, so they narrow each other.
- Results: 48 tiles per page, numbered pager. Packages are listed first under "Packages &
  Assemblies", then "Parts".
- A tile shows image (or a placeholder), manufacturer, title, model number, the customer's unit
  price or "Price on request", and an Add button. Package tiles show a "Package" badge and
  "Includes N parts".
- Landing page only (no search, no facets, page 1, no department): department tiles (section 5.4)
  and a "Parts you've quoted before" shelf of up to 12 parts.
- Breadcrumb and "Search all departments" / "Search all products" link when inside a department.
- Empty states: "Search to find a part" (browsing with nothing browsable) and "Nothing matches
  that search" with advice and an "Ask us for a quote" link.
- Rate limited: the page shows "Too many requests — try again in a minute."

Part sidebar (`?part=<sku>` or `?part=fixture:<id>`):

- Image gallery, manufacturer, title, model number, unit price or "Price on request" with "Add it
  to your quote and we'll confirm the price."
- Quantity and "Add to quote". A toast confirms.
- **Documents**: datasheets, spec sheets and manuals. PDFs open in an inline viewer; other types
  get "Open in new tab".
- **Specifications**: the part's authored spec text, when it has one.
- **Goes with**: up to 12 accessory parts, each with price and Add.
- **Ask a question about this part**: a message (required, up to 2,000 characters) and optional
  phone (up to 40). Creates a lead (section 9.5).
- Footer line: "All quotes are subject to Peak review and approval."
- A hidden, deleted or unknown key shows "This item isn't available." with a link to search. The
  wording is identical in all three cases.

Package sidebar: lists included parts (fixed), then optional add-ons each with a quantity and
"+$X each" or "Price on request". The total re-prices on the server after each change. If a
required component can no longer be quoted: "This fixture can't be quoted online right now — ask
us about it."

Curtain configurator (opened from "Request curtain pricing" / "Configure a curtain"): curtain
name, fabric (a list, or "Not sure — recommend one"), quantity, width (ft), height (ft), fullness
(Flat, 50%, 75%, 100%). Shows a live "$X each · $Y total" from the server, or "We'll recommend a
fabric and price it." Hint: "Curtains are confirmed by Peak before your quote is final."

### 4.4 Cart — `/portal/catalog/quote`

- Venue picker: "Choose the venue this is for…". "The venue sets freight & delivery." If the
  company has no venues: "We don't have a venue on file for you yet — ask us to add one."
- Lines: title, detail, quantity stepper (saved 400 ms after the last change), unit and extended
  price, Remove. Price-on-request lines show "Price on request". Curtain lines show "Confirmed by
  Peak". A line whose item was withdrawn shows "No longer available — Left out when you generate —
  remove it or ask us for an alternative."
- Totals: Subtotal; "Freight & delivery — <N> mi" (or without miles when unknown); Total, labelled
  "Total (excludes items pending price)" when any line is price on request. "Plus applicable sales
  tax." "All quotes are subject to Peak review and approval."
- A badge: "Firm quote — Every line is priced — your quote is ready the moment you generate it."
  or "Needs Peak review" with the reason.
- "Name this quote" field, pre-filled with the default name (section 7.7).
- **Generate quote** button, disabled with a reason when: the cart is empty ("Your quote is
  empty."), no venue is picked ("Pick the venue this is for."), or no line is available ("None of
  these items can be quoted right now.").
- Empty cart: a "Browse the catalog" link.

### 4.5 Service — `/portal/service`

URL state: `?type=flame|inspection&level=1|2&venue=<id>` (repeatable) and `?from=<quoteId>`.

- Three pills: "Flame test", "Inspection — Annual (L1)", "Inspection — Five-year (L2)". Default is
  flame test.
- A list of the company's venues, each with a checkbox and a count input (curtains for flame
  tests, line sets for inspections). Counts are pre-filled from history with a note of where the
  number came from (section 8.2).
- A live price panel, re-priced on the server 300 ms after the last change: one line per venue
  (flame) or one summary line (inspection), a Travel line, and the total. Late responses are
  discarded. "Tick at least one venue to see pricing."
- "Name this quote" and **Generate quote**.
- `?from=` pre-fills service, venues and counts from an existing flame or inspection quote of this
  customer (any source). An id that does not resolve is ignored silently.
- No venues: "No venues on file yet — mention your venue in a quote request and we'll add it."
- Errors are shown inline (section 8.1).

### 4.6 My quotes — `/portal/my-quotes`

- Lists quotes the customer built (`source` in `portal-catalog`, `portal-service`,
  `portal-self-serve`) that the portal may list.
- Filters `?show=open|accepted|closed` with counts. Open is the default.
  - Closed: status `lost`.
  - Accepted: status `won`, or accepted online and awaiting Peak.
  - Open: everything else.
- Newest created first. Rows are the shared quote row plus a type label (Catalog, Flame test,
  Inspection, Estimate) and Rename.
- Generate lands here with `?generated=firm|review&q=<quoteId>`:
  - firm: "Your quote <number> is ready — open the PDF or accept it below."
  - review: "Thanks — Peak will confirm pricing on <number> and let you know."
  - The number is shown only if `q` is one of this customer's listed, customer-built quotes.
- Empty states: "No open quotes — build one from the Catalog or Service.", "No accepted quotes
  yet.", "No closed quotes."

### 4.7 Online estimate — `/portal/quotes/<id>`

Section 9.2 gives the rules. The page shows one of:

- the sent estimate as a web page, with an Overview / Itemized toggle (`?view=bom`), a PDF link
  when one may be served, cut sheets when the sent PDF carried them, and a "closed" banner when
  the quote is lost;
- "This estimate is being revised — your Peak rep will send the updated version.";
- "This estimate isn't available online." (used for every refusal, with a PDF link when the PDF
  rule allows one);
- the scope-only bill of materials (section 9.3).

### 4.8 Request — `/portal/request`

Fields: name and email (read-only, from the grant), Venue (the company's venues or "Another / new
venue (describe below)"), Phone (optional, 40 characters), "What do you need?" (Flame testing,
Rigging inspection, Repair, New system / renovation, Something else), "How urgent?" (Standard,
Urgent, Emergency — out of service), "Tell us about it" (required, 4,000 characters).
`?service=` and `?venue=` pre-select. Errors: `?err=details` (details missing), `?err=send`
(could not be saved). On success the customer lands on `/portal?sent=1`.

### 4.9 Meeting notes — `/portal/meetings`

A list of shared meetings, newest first: title, date, and the summary text split into paragraphs.
Empty: "No meeting notes have been shared with you yet." The nav item is always shown.

**Source:** `src/app/portal/shell.tsx`, `src/app/portal/nav.ts`, `src/app/portal/page.tsx`,
`src/app/portal/quote-row.tsx`, `src/app/portal/catalog/page.tsx`,
`src/app/portal/catalog/catalog-client.tsx`, `src/app/portal/catalog/part-sidebar.tsx`,
`src/app/portal/catalog/fixture-config.tsx`, `src/app/portal/catalog/curtain-request.tsx`,
`src/app/portal/catalog/ask-question.tsx`, `src/app/portal/catalog/quote/page.tsx`,
`src/app/portal/catalog/quote/cart-client.tsx`, `src/app/portal/service/page.tsx`,
`src/app/portal/service/service-form.tsx`, `src/app/portal/my-quotes/page.tsx`,
`src/app/portal/quotes/[id]/page.tsx`, `src/app/portal/request/page.tsx`,
`src/app/portal/request/request-form.tsx`, `src/app/portal/meetings/page.tsx`,
`src/app/portal/estimate/page.tsx`, `src/lib/portal-catalog-view.ts`,
`src/lib/portal-my-quotes.ts`, `src/lib/portal-projects.ts`, `src/lib/portal-service-view.ts`.

---

## 5. Catalog rules

### 5.1 The catalog index

The portal does not query the catalog per request. It builds one in-memory index from bulk reads
(all parts, all part documents and links, all packages, all quotes, all manufacturers) and caches
it for 5 minutes per server process. Staff edits to parts or part documents invalidate the cache
in the process that handled the edit; other processes catch up within 5 minutes. The production
catalog is about 37,000 parts.

The index holds cost, so it MUST stay on the server. Pages receive only view models built from an
explicit whitelist of fields.

### 5.2 Visibility of a part

Each part has `portalVisibility`: `auto` (default), `show`, or `hide`. Any other stored value
reads as `auto`.

R-VIS-1. A part is **withheld** (not searchable, not browsable, not quotable, no documents
served) when it is `hide`, or when it is `auto` and its category is "Labor" (case-insensitive).
Labor rows hold internal labor and travel rates.

R-VIS-2. Every part that is not withheld is **quotable**: it can be found by search and added to
a cart.

R-VIS-3. A quotable part is **browsable** (appears with no search text) when:
- visibility is `show`; or
- visibility is `auto` and at least one of: it has a visible image with a stored file; it has a
  datasheet or spec sheet a customer can open (its own, or one that covers it through the
  accessory graph); it appears on at least `browseMinQuotes` (default 3) distinct non-deleted,
  non-imported quotes created in the last `browseWindowMonths` (default 24).

R-VIS-4. A manual alone does not make a part browsable.

R-VIS-5. With search text, results are all quotable parts whose searchable text contains every
search word. Without search text, results are browsable entries only. Searchable text covers SKU,
description, manufacturer, category, manufacturer part number, model number and former SKUs.

R-VIS-6. A part renamed to a new SKU is still found through its former SKU (old bookmarks, old
cart lines).

R-VIS-7. A withheld Labor part may still be a component of a package and is priced inside it, but
is never shown or sold on its own.

Staff see the computed reason under the Auto/Show/Hide control in the part editor, for example
"Browsable: has image" or "Search only — no image, datasheet, or recent quotes".

### 5.3 Packages (fixture assemblies)

R-PKG-1. A package is offered only when its light engine is a quotable part and every required
line (quantity above 0) resolves to a quotable part or a Labor component.

R-PKG-2. Lines with quantity 0 are optional add-ons. An add-on whose part cannot be quoted is not
offered.

R-PKG-3. Packages are always browsable, sort ahead of parts, and rank above them.

R-PKG-4. A package's catalog category is its staff-set "Portal category", or "Other packages"
when blank.

R-PKG-5. A package's image and manufacturer are its light engine's. Its documents are the
documents of its required lines.

### 5.4 Departments

Staff group part categories into named departments (at most 30; names 1–40 characters, unique
ignoring case; a category belongs to at most one department).

R-DEPT-1. Department ids are slugs of the name, stable across renames. The ids `other` and
`packages` are reserved.

R-DEPT-2. "Other" is automatic and never stored: every part category that no department claims.
It is hidden when empty, and does not exist at all when no departments are configured.

R-DEPT-3. "Packages & Assemblies" (`packages`) is built in. It contains every package and no
parts, and exists whether or not departments are configured.

R-DEPT-4. Configured departments and Other contain parts only, never packages.

R-DEPT-5. `?dept=<id>` restricts results, facets and search to that department. An unknown id is
ignored without an error.

R-DEPT-6. Department tiles appear only on the landing page. Each shows a count of browsable items
and a thumbnail from its top-ranked part. The Packages tile comes first when any package exists.

R-DEPT-7. With no departments configured, the catalog behaves as if the feature did not exist,
apart from the Packages tile.

R-DEPT-8. Departments are read fresh on every browse and are not part of the cached index.

The staff editor is one department dropdown per category, with bulk move and a "Start from
suggestions" button that proposes up to ten departments (Projection Screens, Drapery, Lighting,
Audio, Video & Displays, Control & Networking, Rigging, Cable & Connectors, Power, Mounts &
Hardware) from keyword and manufacturer rules. The suggestion rules are specific to Peak's
catalog and are not required for a rebuild.

### 5.5 Images, placeholders and documents

R-DOC-1. A catalog file is served only if its id is in the index's precomputed allow-list:
- visible images (link not marked hidden) with a stored file, of quotable parts;
- datasheets, spec sheets and manuals with a stored file that belong to a quotable part or cover
  one through the accessory graph (a child marked "has its own datasheet" is not covered by its
  parent);
- manufacturer fallback images.

R-DOC-2. Images are served only as PNG, JPEG or WebP. SVG and staff-only drawing kinds are never
served.

R-DOC-3. No session, unknown id and not-allowed id all return the same 404.

R-DOC-4. Responses are `private`, carry `nosniff`, and use an ETag derived from the document id
and its storage key. Images cache for 1 day, documents for 5 minutes.

R-DOC-5. A part with no photo shows a fallback, first match: "Custom Device" (custom category),
the manufacturer's image, "Contact Us" (price on request), "Image Coming Soon". (An "Allowance"
placeholder also exists for quote lines; not verified for the catalog.)

R-DOC-6. The inline PDF viewer requires the document route to be frameable by the same origin
only.

### 5.6 "Parts you've quoted before"

Up to 12 distinct quotable SKUs from this customer's listed quotes, newest quote first, in line
order within a quote. Shown only on page 1 with no search or facet, and never on the Packages
page.

**Source:** `src/lib/portal-catalog-index.ts`, `src/lib/portal-visibility.ts`,
`src/lib/portal-search.ts`, `src/lib/portal-catalog-browse.ts`, `src/lib/portal-catalog-view.ts`,
`src/lib/portal-part-view.ts`, `src/lib/portal-part-detail.ts`, `src/lib/portal-departments.ts`,
`src/lib/stores/portal-departments.ts`, `src/app/portal/catalog/doc/[id]/route.ts`,
`next.config.ts`, `DECISIONS.md` (D407, D408, D412, D442–D445, D533–D535).

---

## 6. Pricing rules (catalog)

The browser never computes or submits a price. Every view, every Generate and every Refresh
re-prices on the server.

### 6.1 Customer tier

R-TIER-1. The tier is resolved in this order: the tier on the company contact whose display name
equals the grant's `name`; else the company's tier; else Base.

R-TIER-2. Each tier has a markup on cost, editable by staff. Defaults: Base 43%, Copper 37%,
Silver 28%, Gold 25%, Platinum 18%, Reseller 11%, Employee 5%.

R-TIER-3. The tier name and markup are never shown to the customer. They are stamped on the quote
for staff.

### 6.2 Unit price of a part

Evaluated in order:

| # | Condition | Result |
| --- | --- | --- |
| 1 | No positive cost and no positive list price | Price on request (reason: no price) |
| 2 | The part has a non-empty price note | Price on request (reason: verify price) |
| 3 | `staleCostMonths` > 0 and the part's price date is older than that many months | Price on request (reason: stale cost). Off by default (0) |
| 4 | Positive cost | `round(cost × (1 + markup), 2)` |
| 5 | Otherwise | `round(list, 2)` |

A month is 30.4375 days. The reason is staff-only and is removed before anything is sent to the
browser.

### 6.3 Unit price of a package

R-FIX-1. Sum over components with quantity above 0: component unit price × quantity. Required
lines use the package's own quantity. Add-ons use the customer's chosen quantity.

R-FIX-2. If any included component is price on request, the whole package is price on request.

R-FIX-3. If a required component cannot be quoted, the package is unavailable.

R-FIX-4. Add-on quantities from the browser are accepted only for keys naming one of this
package's optional lines, as whole numbers 1 to 10,000. Everything else is dropped.

R-FIX-5. The price on a tile is the package with no add-ons.

### 6.4 Curtain price

R-CUR-1. If the customer chose a fabric that has an area rate (dollars per square foot):

```
sewn width (ft)   = finished width × (1 + fullness% / 100)
sewn area (sq ft) = sewn width × finished height
cost each         = round(sewn area × fabric rate × (1 + sewing%), 2)
price each        = round(cost each × (1 + markup), 2)
```

`sewing%` is a staff setting (10% per project notes; the default was not verified in code).
`markup` is the customer's tier markup. The result MUST equal what the staff Estimator computes
for the same inputs.

R-CUR-2. A priced curtain is flagged "needs confirmation". The quote goes to review even though
it has a price (section 7.2).

R-CUR-3. "Not sure — recommend one", or a fabric with no rate, gives a price-on-request line.

R-CUR-4. The fabric list sent to the browser contains SKU and name only. The fabric name stored
on a line always comes from the server's list.

R-CUR-5. Validation messages: "Name the curtain (e.g. Main Grand Drape).", "Pick a fabric from the
list.", "Enter a quantity from 1 to 10,000.", "Enter the width in feet.", "Enter the height in
feet.", "Pick a fullness."

### 6.5 Freight by distance

R-FRT-1. Distance is the drive miles from Peak's nearest office to the cart's venue, from the
venue's saved travel data (manual value, cached route, or straight-line estimate).

R-FRT-2. `freight % = min(cap, base + floor(miles / stepMiles) × step)`. Defaults: base 2%, step
1% per full 200 miles, cap 10%. So 0–199 miles is 2%, 200–399 is 3%, and so on.

R-FRT-3. Unknown distance, or no venue chosen, charges the cap.

R-FRT-4. The freight amount is the percentage applied to the section's **cost** base, using the
staff Estimator's own totals function, so the same quote shows the same freight when staff open
it.

R-FRT-5. The customer sees the freight dollar amount and the miles only. The percentage, and the
fact that the cap was applied because distance is unknown, are never sent to the browser. Showing
a percentage of cost next to a sell subtotal would let the customer work out cost.

### 6.6 Totals and what the browser receives

```
subtotal = sum of sell of all priced lines     (2 decimals)
freight  = per R-FRT-4                          (2 decimals)
total    = subtotal + freight
```

The browser receives: per line `lineId, kind, title, sku, model, qty, unit, unitPrice, extPrice,
por, review, unavailable, detail`; `subtotal`; `freight { amount, miles }`; `total`; `mode`;
`reason`. It never receives cost, list price, markup, tier, freight percentage, the staff
sections, or the reason a line is price on request.

Customer-facing part identity is the model number, not Peak's internal order number.

Sales tax is not computed. The portal prints "Plus applicable sales tax."

**Source:** `src/lib/portal-pricing.ts`, `src/lib/portal-price-rules.ts`,
`src/lib/pricing-tiers.ts`, `src/lib/markup/index.ts`, `src/lib/design/curtain-pricing.ts`,
`src/lib/freight-rule.ts`, `src/lib/freight-rule-load.ts`, `src/lib/portal-cart-rules.ts`,
`src/lib/portal-part-view.ts`, `src/lib/stores/customers.ts`, `DECISIONS.md` (D402, D403, D413,
D437–D439), `OPEN-DECISIONS.md` (item 11-D).

---

## 7. Cart, Generate, and the quote lifecycle

### 7.1 Which quotes a customer can see

R-LIST-1. The portal lists a quote for a company when all hold:
- `customerId` equals the session's company;
- `source` is not `daylite` (imported history is never shown);
- `status` is not `draft`, or `source` is `portal-catalog` or `portal-self-serve`.

R-LIST-2. Consequence: staff drafts are never listed. A `portal-service` quote that staff recall
to draft disappears from the customer's lists until it is sent again. A `portal-catalog` draft
(review quote) stays listed.

R-LIST-3. Home lists listed quotes that are not customer-built. My quotes lists listed quotes
that are customer-built.

Every action below re-checks R-LIST-1 on the server and answers "We couldn't find that quote."
when it fails.

### 7.2 Firm or review

R-MODE-1. A cart is **firm** when no available line is price on request and none needs
confirmation. Otherwise it is **review**.

R-MODE-2. Unavailable lines are ignored for the mode and left out of the quote.

R-MODE-3. The review reason text is one of:
- "N line is price on request" / "N lines are price on request";
- "Curtains are confirmed by Peak (measurements and fabric)";
- "N line(s) … price on request; curtains are confirmed by Peak".

### 7.3 Generate (catalog)

Order of checks; the first failure is returned and nothing is written:

1. Session is writable (not preview), else the expired-link text.
2. Customer exists.
3. Cart has lines, else "Your quote is empty."
4. Cart venue is one of the customer's venues, else "Pick the venue this is for."
5. No Generate already running for this grant in this process, else "Your quote is already being
   generated — one moment."
6. At least one line is available, else "None of these items can be quoted right now."
7. Rate limit.

Then:

R-GEN-1. Create a quote with: name (cleaned customer name, else default); customer, venue,
contact name = grant name; `value` = total; tier and markup stamps; `source: "portal-catalog"`;
`spec` = the priced sections. The quote gets its estimate number at this point.

R-GEN-2. Set `owner` to the company's account owner (blank if none) and `preparedBy` to the same
when there is one.

R-GEN-3. Firm: stamp `portalFirm = { generatedAt: now, validUntil: now + validityDays }`, clear
`portalReview`, start the PDF render, then set status `sent`. This send bypasses the normal
staff approval gate through a bypass reserved for this one path. Setting `sent` cuts a "sent"
revision.

R-GEN-4. Review: stamp `portalReview = { requestedAt, reasons }`, leave status `draft`, start the
PDF render. No lead, task or queue record is created; staff are told through derived bell groups
(section 10.3).

R-GEN-5. If finishing a firm quote fails after the quote exists, it falls back to review with
reason "Couldn't be sent automatically".

R-GEN-6. Once the quote exists, Generate MUST report success whatever else fails. The cart is
cleared in its own error handler. A reported failure would invite a retry that creates a second
quote from the same cart.

R-GEN-7. The rate-limit token is refunded only if no quote was created.

R-GEN-8. The customer is redirected to `/portal/my-quotes?generated=<mode>&q=<quoteId>`.

`validityDays` is at least 1, rounded to a whole number of days of 24 hours each. Default 30.

### 7.4 Expiry and Refresh pricing

R-EXP-1. A firm quote is expired when status is `sent`, it is not accepted, and now is after
`portalFirm.validUntil`. An expired quote cannot be accepted.

R-EXP-2. Refresh is allowed only for `portal-catalog` and `portal-service` quotes that are
expired. Otherwise: "This quote hasn't expired yet." or "This quote can't be refreshed."

R-EXP-3. Catalog refresh rebuilds cart lines from the quote's own saved lines and saved venue,
then re-prices them at today's cost, today's freight rule, and the **current session's** tier.

R-EXP-4. If the result is firm: replace `spec`, `value` and stamps; set a new `portalFirm`; start
the PDF render; add a new "sent" revision noted "Portal price refresh"; copy the PDF onto that
revision. Status stays `sent`. The estimate number does not change.

R-EXP-5. If the result is review (a line became price on request): replace `spec` and `value`,
clear `portalFirm`, set `portalReview`, and move the quote back to `draft`.

R-EXP-6. Service refresh (section 8.5) has no review branch.

R-EXP-7. Lines that can no longer be rebuilt (older saved lines missing their rebuild data) are
dropped. Bonus lines added by staff are skipped. A staff-entered vendor cost on a curtain is never
copied back into a customer cart.

### 7.5 Accept

R-ACC-1. Accept is allowed when: the quote is listed for this company; it is not scope-only
(section 9.3); status is `sent`; there is no `portalAcceptance`; there is no `portalReview`; and
it is not expired.

Refusals: "This quote was already accepted.", "This quote's pricing has expired — refresh it to
get current pricing.", "This quote isn't ready to accept yet."

R-ACC-2. Required inputs:
- purchase method: one of Purchase order (`po`), Credit card (`card`), Check (`check`), Other
  (`other`), else "Pick how you'll purchase.";
- signer name, else "Type your name to accept." (120 characters);
- signer title, else "Type your title to accept." (120 characters).

R-ACC-3. Optional inputs:
- notes, at most 1,000 characters. A longer note is refused, not truncated: "Keep purchasing notes
  under 1,000 characters.";
- PO number, at most 60 characters and not a card number, else "Check the PO number — 60
  characters at most, and never a card number.";
- a PO file.

R-ACC-4. Card-number guard. The notes are refused with "Don't enter card numbers — we'll call you
to take payment." when they contain a run of digit groups (groups separated by single spaces or
dashes) where some contiguous span of whole groups totals 13 to 19 digits and passes the Luhn
check. Whole groups are tested, not every sliding window, so "PO 12345 4111 1111 1111 1111" is
caught while long tracking numbers are not flagged by accident.

R-ACC-5. PO file. The browser uploads the file first through the documents upload flow
(section 9.1) and passes the resulting document id. The server accepts the id only if the
document exists, is not deleted, belongs to this company, and was uploaded by a customer.
Otherwise acceptance is refused: "That purchase order file couldn't be attached — try uploading
it again." If the upload itself fails in the browser, acceptance proceeds without the file and
the landing page shows the "file didn't attach" note.

R-ACC-6. On success, write `portalAcceptance` and clear `portalDecline`. Status stays `sent`.
Acceptance is not binding and does not create a job. Staff confirm by marking the quote Won.

R-ACC-7. Notify staff by creating a to-do titled "<number> accepted online — Accepted by <name>,
<title> — PO <po>", due end of day (Chicago), assigned to the quote's lead estimator if that
person is an active team member, else to every active administrator. A notification failure
never fails the acceptance. No email is sent, because the app has no system mailbox.

R-ACC-8. Staff can decline an acceptance with a note of 1 to 500 characters. This clears
`portalAcceptance` and sets `portalDecline`. Status stays `sent`, so the customer can accept
again. Allowed only on `portal-catalog` and `portal-service` quotes that currently have an
acceptance.

### 7.6 Copy to new quote

R-COPY-1. Available on listed quotes; the button is shown on `portal-catalog` quotes. Rebuilds
cart lines from the quote and re-prices them. Lines now unavailable are skipped. The rest are
appended to the grant's existing cart; nothing already there is changed. A part already in the
cart merges by SKU.

R-COPY-2. Lines that would exceed the 200-line cap are skipped individually.

R-COPY-3. On success the customer lands on the cart. On refusal they land back on the originating
list with the copy-error banner.

### 7.7 Names and renaming

R-NAME-1. Cleaning: collapse whitespace; remove control characters, zero-width space, byte-order
mark and bidirectional override/isolate characters (zero-width joiner and non-joiner are kept);
trim; cap at 120 code points without splitting a grapheme cluster.

R-NAME-2. Default for a catalog quote: "<venue label> — <Mon D, YYYY>", or the company name when
there is no venue label. Default for a service quote: "<first venue> — <date>" or "<first venue>
+ N more — <date>". The date is in the America/Chicago time zone. When the result would exceed
120 characters only the label is shortened; the "+ N more" and date always survive.

R-NAME-3. A customer may rename a quote when it is listed, customer-built, not scope-only, not
accepted, and not won or lost. Refusals: "Give your quote a name.", "Only quotes you built here
can be renamed.", "This quote was accepted — it can't be renamed now.", "This quote is closed and
can't be renamed."

R-NAME-4. Renaming to the same name succeeds without a write and without spending a rate-limit
token.

R-NAME-5. The name is printed on the PDF. After a rename the PDF is re-rendered. If the quote is
`sent`, a new "sent" revision is cut (note "Renamed by customer") and the PDF copied to it, so the
customer's PDF shows the new name.

### 7.8 Staff edits to a portal quote

R-STAFF-1. Saving a portal quote from any staff builder MUST keep its `source`. A portal quote
never becomes a staff quote by being opened and saved.

R-STAFF-2. On a staff save of a `portal-catalog` quote, a price-on-request line that now has a
price above 0 loses its `por` flag. `portalReview` is cleared by a save only when no `por` line
and no `portalConfirm` line remain.

R-STAFF-3. Any transition to `sent` clears `portalReview`. A priced curtain is therefore
"confirmed" by the act of sending.

R-STAFF-4. A review quote that staff later send does not get `portalFirm`, so it has no automatic
expiry.

**Source:** `src/lib/portal-quotes.ts`, `src/lib/portal-quote-mode.ts`,
`src/lib/portal-quote-names.ts`, `src/lib/portal-my-quotes.ts`, `src/lib/stores/quotes.ts`,
`src/lib/stores/portal-carts.ts`, `src/app/portal/actions.ts`,
`src/app/portal/catalog/actions.ts`, `src/app/portal/accept-dialog.tsx`,
`src/app/portal/quote-row.tsx`, `src/app/(app)/estimator/actions.ts`, `DECISIONS.md` (D404–D406,
D414–D416, D525–D526).

---

## 8. Service quotes (flame test, inspection)

Customers can generate a firm quote for:

- flame testing of stage curtains (count = curtains per venue, 1–200);
- rigging inspection, Level 1 annual or Level 2 five-year (count = line sets per venue, 1–300).

Repairs cannot be priced online. "Request a repair" opens the request form.

### 8.1 Validation

A request is `{ service, venues: [{ venueId, count }] }`.

| Condition | Error |
| --- | --- |
| Not an object; unknown service; inspection level not 1 or 2; no venues; a venue id that is not the customer's; a repeated venue; more venues than the customer has | "Pick at least one venue." |
| Flame count not a whole number 1–200 | "Enter the number of curtains (1–200)." |
| Inspection count not a whole number 1–300 | "Enter the number of line sets (1–300)." |
| A requested venue has neither coordinates nor saved travel miles | "We need to confirm travel for <venue> — request a quote instead." (the form turns this into a link to the request form) |

The last rule exists so a venue that cannot be located is never priced with zero travel.

### 8.2 Count pre-fill

For each venue, in the customer's own venue order:

1. the count from the venue's latest **completed** flame job, or latest completed inspection
   record of the **same level**;
2. else the count from the latest quote of that type (and level) that lists the venue;
3. else blank, and the customer types it.

The form shows the source and its year. A record with no level is never treated as Level 1.

### 8.3 Pricing

R-SVC-1. The portal runs the same pricing engines, rates and venue-input helper that the staff
quote builders use. A portal price MUST equal what a staff save would produce for the same venues
and counts with no overrides.

R-SVC-2. Markup: the customer's resolved tier markup; for a customer with no tier, the service's
own default markup (not tier Base).

R-SVC-3. Several venues are priced as one shared trip (office → venue 1 → … → venue n → office).
Travel is counted once, not per venue.

R-SVC-4. Travel mode is automatic. When one trip's drive cost reaches the fly threshold (default
$1,000) travel is priced as flights, lodging, per diem, rental car and travel-day labour.
Customers cannot override it.

R-SVC-5. Flame test model, as documented in the engine:
- travel = round-trip mileage at a per-mile rate + drive time at the labour rate, with minutes
  rounded up to the next 15;
- testing = minutes per curtain (default 5) at the labour rate;
- `cost = max(base fee, travel + testing)` (base fee default $150);
- `total = cost × (1 + markup)`.

R-SVC-6. Inspection model: `total = max(minimum fee, (labour + travel) × (1 + markup))`. Level 2
applies a level multiplier to labour. Detailed rates were not traced (section 12).

R-SVC-7. Rounding. Totals are rounded to the nearest $25, half up. When a floor set the price
(flame base fee, inspection minimum fee) the total is rounded **up** to the next $25, so rounding
cannot take it below the floor.

R-SVC-8. No customer-entered price, no staff overrides, and no lift rental on a portal Generate.
(A lift rental that staff later add to the quote is kept through Refresh pricing at the current
rate.)

R-SVC-9. A service request is never price on request. There is no review mode.

### 8.4 What the customer sees

- Flame: one line per venue, "Flame test — <venue> (<n> curtains)".
- Inspection: one line, "<Annual|Five-year> rigging inspection — <n> line sets across <m> venues".
- One "Travel" amount.
- The total.

The Travel amount is the travel cost scaled to sell: `round(travel cost × total ÷ cost)`, capped
at the total. The remainder is split across flame venues in proportion to each venue's testing
cost, with the last line absorbing the rounding remainder, so lines + travel always equals the
total exactly. Rates, hours, markup, tier, cost and the travel breakdown are never sent.

### 8.5 Generate, refresh and lifecycle

R-SVC-10. Generate order: session writable → customer exists → no Generate in flight → validate
and price → rate limit → create. A refusal before pricing succeeds never spends a rate-limit
token.

R-SVC-11. The created quote has `source: "portal-service"`, `quoteType` `flame_test` or
`inspection`, `locationId` = the first venue, the sub-document from pricing (including the
grant's name and email as contact), and the same owner rule as catalog quotes.

R-SVC-12. It is then sent as firm exactly like R-GEN-3, with the same validity period.

R-SVC-13. From then on it follows section 7: listing, expiry, Accept, Decline, rename, My quotes.

R-SVC-14. Refresh pricing re-prices the **stored** venues, counts and level at today's rates,
using the **quote's own** customer and contact name for the tier (not the caller's session). It
writes the new total and sub-document, a new `portalFirm`, and a new "sent" revision with its PDF.

R-SVC-15. "Quote again" is offered on any listed flame-test or inspection quote, whatever its
source, and pre-fills the form from that quote's scope.

**Source:** `src/lib/portal-service-pricing.ts`, `src/lib/portal-service-scope.ts`,
`src/lib/portal-service-quotes.ts`, `src/lib/portal-service-view.ts`,
`src/lib/service-quote-inputs.ts`, `src/lib/service-pricing.ts`, `src/lib/flametest-engine.ts`,
`src/lib/inspection-engine.ts`, `src/lib/travel-plan.ts`, `src/lib/pricing-tiers.ts`,
`src/app/portal/service/actions.ts`, `src/app/portal/service/page.tsx`,
`src/app/portal/service/service-form.tsx`, `src/lib/portal-quotes.ts`, `DECISIONS.md`
(D420–D430).

---

## 9. Other customer-facing features

### 9.1 Documents ("Send us files")

A document record: `id` (`DOC-` + number), `title`, `fileName`, `mime` (informational), `size`,
`blobPath`, `category`, `visibility` (`internal` or `shared`), `source` (`team` or `customer`),
`customerId` (required, never changes), optional `siteId` (venue) and `projectId`, `notes`,
`uploadedBy`, `uploadedAt`, `seenByTeamAt`.

R-FILE-1. The portal shows a document when it belongs to the session's company, is not deleted,
and is either `shared` or was uploaded by a customer. This one rule decides both the list and the
download.

R-FILE-2. The Home list is grouped company-wide first, then by venue, then by category. Each row
shows title, file name, size, date, and "sent by <name>" or "from <Peak>".

R-FILE-3. Downloads are always served as attachments, never rendered in the browser. Every
refusal (no session, unknown id, another company's file, an internal file) is the same 404.

R-FILE-4. Upload flow:
1. The browser checks the name and size, then asks `/portal/documents/upload` for a one-time
   direct-upload token.
2. The server issues a token only for a valid session, and only for a storage path under
   `documents/<session company>/<upload key>/`. Maximum size 100 MB.
3. The browser uploads straight to private object storage. File bytes do not pass through the
   application server.
4. The browser calls a finalize action. The server confirms the path is in scope and not already
   recorded, reads the first bytes, and creates the document record.

R-FILE-5. A customer upload is always forced to: this company, `shared`, source `customer`, no
project, unseen by the team. The customer may choose a venue (their own) and a category, and add
a note.

R-FILE-6. Refused files: empty; over 100 MB; any dot-separated segment of the name is a program
or script extension (exe, msi, bat, cmd, com, scr, pif, vbs, vbe, js, jse, wsf, wsh, ps1, psm1,
sh, bash, zsh, app, dmg, pkg, jar, apk, deb, rpm, dll, so, dylib); the leading bytes identify a
Windows, Linux or Mac executable. A refused upload's stored bytes are deleted (best effort).

R-FILE-7. File names are cleaned of control and bidirectional-override characters before display
or use in headers.

R-FILE-8. Staff get a bell group "New documents from customers", one item per company with
unseen customer uploads. Downloading a file or "Mark seen" clears it.

R-FILE-9. If object storage is not configured, upload answers 503 "File storage isn't configured
on this deployment."

### 9.2 Online estimate view and PDFs

**Which version is shown.** The online page and the PDF always show the latest revision that was
actually sent, never the live quote, so later staff edits are not visible until re-sent.

R-ONL-1. Online state of a quote for its own customer:

| Condition | State |
| --- | --- |
| Quote is imported history, or not a system estimate (service quotes have no online page), or has no sent revision | Unavailable |
| Status `draft` after having been sent | "Being revised" (no content) |
| Status `sent` or `won` | Shown |
| Status `lost` | Shown with "This estimate is closed." |
| Shown, but the list rule R-LIST-1 fails | Unavailable |

R-ONL-2. The page prints the revision's own name, header fields, revision number and issue date
as frozen when it was sent, so the page and the PDF agree.

R-ONL-3. Photos on the page are served through a route that checks the same state and that the
photo is one that revision prints.

R-PDF-1. PDF served to a customer:
- if the quote has ever been sent: only the PDF stored on the latest sent revision;
- if never sent (a customer's own review draft): the current rendered PDF, if ready.

R-PDF-2. If the sent revision's PDF is still rendering: 404 with "This quote's PDF is being
prepared — try again in a minute." If it can never arrive (sent before PDFs were stored, edited
after sending, or the render failed): 404 with "No PDF is available for this version — please
contact your rep." Anything else: plain 404.

R-PDF-3. PDFs are served inline, `private, no-store`, `nosniff`.

R-PDF-4. PDFs are rendered by headless Chrome from internal print pages protected by signed,
short-lived tokens. The print pages are not reachable with a portal session. (Token format not
traced; section 12.)

**Public client links (`/share/quote/<id>/<token>`).** These are a separate mechanism from the
portal: staff create a link for a sent estimate and email it. No account or cookie is involved.

- The token is an HMAC-SHA256 over the quote id, a per-quote random nonce stored on the quote,
  and an expiry, using the server secret. Default life 60 days, maximum 366.
- "Revoke" rotates the nonce and kills every link for that quote at once.
- Three token shapes exist: v1 (latest sent version), v2 (pinned to one sent revision; opens a
  richer "package" page), v3 (pinned to a revision and addressed to one bidder).
- Every invalid case (bad, expired, revoked, tampered, unknown id, never sent) shows the same
  card: "This link isn't active. Ask your Peak rep for a new one." with HTTP 200.
- Rate limits are per IP address: 60 page views/minute, 300 photos/minute, 120 datasheets/minute,
  120 files/minute, 6 zip or datasheet-book downloads per 10 minutes, 30 open-beacons/minute.
- The package page offers per-product datasheets, a zip, plans and risers, and two forms (choose
  scopes; ask a question). Form submissions are limited to 5 per 10 minutes per IP and 30 per day
  per quote, create a staff task, and never change the quote's status.
- Opens are counted by a JavaScript beacon, so link scanners are not counted, and staff are not
  counted.
- Pages are marked noindex and send no referrer.

The package page internals are outside the portal and were not traced in detail (section 12).

### 9.3 Bidders (GC / EC) and the owner's "Scope only" view

Peak sometimes sends one estimate to several contractors (general or electrical) bidding on an
owner's project. The owner stays the quote's customer. Each contractor is a party row on the
quote with role `gc` or `ec` and bid state: `result` (`pending`, `awarded`, `lost`, `withdrew`,
`no bid`), `revSent` (which sent revision it received), and send details.

**Bidder rule.** A company that is not the quote's customer sees the estimate, read-only, only
when all hold:

- B1. The quote is a system estimate and not imported history.
- B2. The company has a party row on this quote with role `gc` or `ec`, bid state present, and
  result `pending` or `awarded`.
- B3. If the bid has been awarded, the row is the awarded one. A pending row on a bid awarded to
  someone else sees nothing.
- B4. At least one sent revision is "theirs": the revision delivered to them (`revSent`), or any
  sent revision frozen as addressed to them after an award. The latest such revision is shown.
- B5. By quote status: `draft` → "being revised", and not listed; `sent` → shown; `won` → shown
  only to the awarded row; `lost` → shown as closed.
- B6. If the company holds both a GC and an EC row: awarded first, then the later revision, then
  GC.

What a bidder gets:

- A **Bids** card on Home with Open (status sent) and History groups. Each row shows the
  revision's own name, a "Bid" badge, and a chip: "Due <date>" or "Bid submitted" (pending),
  "Awarded", or "Closed". The chip never says "Lost" and never names or counts other bidders.
- The online page addressed to them ("Prepared for <contractor>").
- Their own PDF, rendered on demand for exactly that revision (6 per minute). A render failure
  shows "The PDF couldn't be made right now — try again in a minute."; the technical error is
  logged, not shown.
- No Accept, Refresh, Rename, Copy, or Quote again. Every portal write stays customer-only.
- The awarded bidder's portal does not list the resulting project.

**Owner "Scope only" rule.** Once an estimate has, or has ever had, a GC/EC bidder, the owner's
portal shows it without any price.

- S1. An estimate is scope-only when its `bidScopeOnly` flag is set, or any GC/EC party row with
  bid state exists on it, including removed (soft-deleted) rows and rows whose result is lost,
  withdrew or no bid.
- S2. The flag is set when a bidder is added and is never cleared. A new estimate split or copied
  from a scope-only one for the same customer inherits it. If the check cannot be completed, the
  new estimate is flagged (fail closed).
- S3. The owner's list row shows name, number, revision and sent date, and a "Scope only" chip.
  No value, no PDF link, no actions.
- S4. The owner's page shows a bill of materials for the latest sent revision: one block per
  printed system (alternates excluded), rows with manufacturer, model, description and quantity.
  Quantities are omitted when the estimate hides them. Vendor-quoted lines show the description
  only. A note reads "Pricing for this project comes from your contractor."
- S5. The owner's PDF route returns 404 and the photo route returns 404.
- S6. Accept, Refresh pricing, Copy to new quote and Rename are refused on the server with the
  not-found text.
- S7. A project built from a scope-only quote never shows its value on Home.
- S8. This applies to the portal only. Staff screens and the owner's public client links are
  unchanged.

### 9.4 Meetings shared with the customer

R-MTG-1. The portal lists a meeting only when staff explicitly shared it (it has a `share`
object) and it is linked to the session's company.

R-MTG-2. Only the title, start date and the share summary are shown. The summary is text staff
edited before sharing (up to 8,000 characters). The transcript, attendees, to-dos and links are
never sent.

R-MTG-3. A shared meeting is visible to every grant of that company.

### 9.5 Requests and part questions

Both create a lead for staff with source `existing`, no owner (which places it in the staff
response queue), linked to the session's company, with the grant's name and email.

- Request form: message "[Portal request — <name>] <venue or "Venue TBD"> · <service> · <urgency>"
  followed by the details. Service and urgency values not on the allowed lists fall back to
  "Something else" and "Standard". The venue must be one of the company's; otherwise it is
  treated as not chosen. The venue's city and state are copied to the lead (state defaults to
  "WI").
- Part question: interest "Product question"; message "[Portal question — <SKU>] <title>" followed
  by the question. For a package the SKU is its light engine's. A hidden or unknown part is
  refused with "This item isn't available."

Open leads appear on Home under "Your open requests".

### 9.6 Rewards card

Shown only when Peak's rewards program is on. It displays the company's level, progress to the
next level, a points balance (never a dollar balance), available perks with "Free" or "N points"
and a Redeem button, standing purchase perks, and redemptions awaiting fulfilment. Redeem is
scoped to the grant's company, refuses a preview, and re-checks eligibility and the displayed
cost on the server. Internals were not traced (section 12).

**Source:** `src/lib/document-rules.ts`, `src/lib/document-files.ts`,
`src/lib/documents-upload.ts`, `src/app/portal/documents-actions.ts`,
`src/app/portal/documents/upload/route.ts`, `src/app/portal/documents/[id]/route.ts`,
`src/app/portal/documents-section.tsx`, `src/app/portal/document-upload.tsx`,
`src/lib/nav-counts.ts`, `src/lib/quote-pdf/portal-access.ts`, `src/lib/quote-pdf/state.ts`,
`src/lib/quote-pdf/http.ts`, `src/lib/quote-share/view.ts`, `src/lib/quote-share/token.ts`,
`src/lib/quote-share/links.ts`, `src/lib/estimate-output/responses.ts`,
`src/app/portal/quotes/[id]/page.tsx`, `src/app/portal/quotes/[id]/pdf/route.ts`,
`src/app/portal/quotes/[id]/photo/[docId]/route.ts`, `src/app/share/quote/[id]/[token]/page.tsx`,
`src/app/share/quote/[id]/[token]/actions.ts`, `src/lib/parties/portal-bid.ts`,
`src/lib/parties/portal-bid-server.ts`, `src/lib/parties/portal-owner-bom.ts`,
`src/app/portal/bid-row.tsx`, `src/app/portal/quote-row.tsx`, `src/lib/meetings/portal.ts`,
`src/lib/meetings/visibility.ts`, `src/app/portal/meetings/page.tsx`,
`src/app/portal/actions.ts`, `src/lib/portal-leads.ts`, `src/lib/portal-cart-actions.ts`,
`src/app/portal/rewards-card.tsx`, `DECISIONS.md` (D1166–D1171, D1177–D1184), `AGENTS.md`
(phases 32, 40, 62).

---

## 10. Staff side

### 10.1 Portal access card

On the company record. Section 2.6.

### 10.2 Portal quotes queue — `/quotes/portal`

A staff page (any signed-in staff member) listing every customer-built quote, across all
customers.

Row status, first match wins:

| Condition | Status |
| --- | --- |
| Quote status `won` | Won |
| Quote status `lost` | Lost |
| `sent` with an acceptance | Accepted — confirm |
| Has `portalReview` and is not `sent` | Needs review |
| `sent`, firm, past `validUntil` | Expired |
| `sent` | Sent |
| Otherwise | Draft |

- Type: Flame test, Inspection, or Catalog (everything else).
- Filters as links: **Needs action** (default; Needs review + Accepted — confirm), All, and each
  status, with counts; a type filter; a search over quote name, number and company.
- `?focus=<quoteId>` forces All and highlights the row. Bell items use this.
- Sort: rows needing action first, then newest created.
- Each row has Open (into that quote's own builder).
- "Accepted — confirm" rows also have:
  - **Approve**. Catalog: marks the quote Won through the normal status action, which is subject
    to the normal approval gate. Flame/inspection: approves at the accepted price (R-APP-1).
  - **Decline…** with a note (R-ACC-8). Not offered on legacy `portal-self-serve` quotes.

R-APP-1. A `portal-service` quote that is `sent` and accepted MUST be approved at the price the
customer accepted. The builders' ordinary approve re-prices at today's rates before marking Won;
that step is skipped for this case. Marking Won creates the flame job or the inspection records
as usual.

### 10.3 Bell groups

Derived on every request from quote data. No notification records are stored.

| Group | Contents | Who sees it |
| --- | --- | --- |
| Portal quotes to review | `portal-catalog` quotes with `portalReview` | The quote's owner, or everyone when unowned |
| New portal quotes | Firm portal quotes (`portal-catalog` or `portal-service`), status `sent`, generated in the last 72 hours | Same |
| Portal acceptances to confirm | Any `sent` quote with a portal acceptance | Everyone |
| New documents from customers | One per company with unseen customer uploads | Everyone |

Review, New and customer-built Accepted items link to the queue with `?focus=`. An acceptance of
a Peak-sent estimate links to the main quotes list instead, because the queue lists
customer-built quotes only.

### 10.4 Portal panel in the builders

Shown at the top of the Estimator for a `portal-catalog` quote and of the flame-test and
inspection builders for a `portal-service` quote. It shows:

- a review banner listing each price-on-request line, with a heading that says what still blocks
  sending: "Needs Peak's price before it can be sent", "Curtains need Peak's confirmation before
  it can be sent", or "Needs Peak's price and a curtain check before it can be sent";
- the customer's acceptance: who, when, signer name and title, purchase method, PO number, notes,
  and the PO file;
- Approve and Decline;
- the firm quote's validity date.

The main quotes list also shows a "Portal" chip on portal quotes (per project notes; not
verified).

### 10.5 Staff settings that drive the portal

| Setting | Where | Effect |
| --- | --- | --- |
| Tier markups | Estimating Rules → Customer tiers | Every portal price |
| Company and contact tier | Customer record | Which markup applies |
| Freight rule (4 values) | Estimating Rules | Freight on every catalog quote |
| Portal rules (4 values) | Estimating Rules | Validity days; browse thresholds; stale-cost months |
| Curtain sewing % | Estimating Rules | Curtain prices |
| Flame, inspection and travel rates | Estimating Rules | Service prices |
| Part visibility Auto/Show/Hide | Catalog part editor | Section 5.2 |
| Part images and documents | Catalog → Datasheets | Browsability and the sidebar |
| Package "Portal category" | Design → Assemblies | Packages grouping |
| Departments | Catalog → Departments (administrators only) | Landing tiles and scoping |
| Document categories | Settings | Upload category list |
| Company name, light logo, accent colour | Settings → Branding | Portal chrome |
| Venue coordinates / travel miles | Customer record | Freight, service travel |
| Account owner | Customer record | Owner of generated quotes |

**Source:** `src/app/(app)/quotes/portal/page.tsx`, `src/app/(app)/quotes/portal/queue-actions.tsx`,
`src/lib/portal-quote-queue.ts`, `src/lib/portal-bell.ts`, `src/lib/nav-counts.ts`,
`src/app/(app)/estimator/portal-panel.tsx`, `src/app/(app)/estimator/actions.ts`,
`src/lib/portal-quote-mode.ts`, `src/lib/freight-rule-load.ts`, `src/components/nav/nav-data.ts`,
`DECISIONS.md` (D405, D426, D429, D527–D528).

---

## 11. Security rules, known gaps, and disagreements

### 11.1 Security rules worth preserving

Never sent to a browser

1. Cost, list price, markup or margin, tier name.
2. The freight percentage and whether the cap was applied for unknown distance.
3. Why a line is price on request.
4. The staff-format priced sections of a quote.
5. Fabric area rates (the fabric list is SKU and name only).
6. Service rates, hours, and the travel breakdown.
7. Internal labour and travel catalog rows.
8. Meeting transcripts, attendees and to-dos.
9. Project margin, procurement, crew, time logs, notes, tasks and owner. Project views go through
   one whitelist function.
10. Other bidders' names, counts or results.
11. Any price on a scope-only estimate.
12. Access tokens in logs or error messages.

Structural rules

13. View models are built by copying a named list of fields, never by spreading a server object.
14. The customer id always comes from the session. Every id from the browser is re-checked
    against the session's company on the server.
15. Preview sessions cannot write. The check is on the server, in every write path.
16. "Not found" and "not yours" are indistinguishable in wording and status code.
17. Files: images only as PNG/JPEG/WebP; documents as attachments; `nosniff`; `private` caching;
    never SVG.
18. Uploads go to private storage under a path scoped to the company; the server re-checks the
    path, name, size and leading bytes before recording anything.
19. A PO file id on acceptance must be the customer's own upload.
20. Card numbers are refused in acceptance notes and PO numbers.
21. Access tokens are encrypted at rest and compared in constant time.
22. Revocation takes effect on the next request.
23. A portal quote keeps its `source` through any staff save.
24. Once a quote exists, Generate reports success, to prevent duplicates.
25. The customer always sees the last **sent** revision, never live edits.
26. Scope-only is sticky and fails closed.
27. Print pages used to render PDFs are protected by signed tokens and are not portal-reachable.
28. Public client links are HMAC-signed, expire, and can be revoked per quote.

### 11.2 Known gaps and open questions

1. **Rate limits are per process and in memory.** They reset on restart and are not shared
   between server instances. On a multi-instance or serverless host the effective limits are
   higher than stated. The code comments say to move to a shared store if more than one instance
   runs. The same applies to the "Generate already in flight" guard.
2. **Catalog index cache is per process**, 5 minutes. A hidden part can stay visible in other
   instances for up to 5 minutes.
3. **Grants are one settings record**, scanned in full on every request. Fine for hundreds, not
   for many thousands.
4. **No rate limit** on the free-text request form or on "Send us files".
5. **Department scoping within a customer is not implemented.** Grants carry an unused `dept`
   field. Every grant sees the company's whole portal. This is a standing open question with the
   owner.
6. **Shared meetings are visible to every grant of the company** (accepted by the owner).
7. **Acceptance is non-binding** and there is no e-signature evidence beyond typed name, title,
   time and the grant's identity.
8. **Staff are notified by in-app to-do and bell only.** There is no email, because the app has
   no system mailbox.
9. **No customer notification** when a review quote is priced and sent, when an acceptance is
   approved or declined, or when a document is shared. The customer sees changes on next visit.
10. **Freight margin exposure.** Freight is a percentage of cost, shown as a dollar amount. A
    customer could estimate cost from it on a well-known item. Accepted knowingly so the number
    matches the staff tool.
11. **Tier lookup by display name.** A grant whose name does not exactly match a contact's
    display name gets the company tier, not the person's.
12. **Catalog refresh uses the caller's tier; service refresh uses the quote's own contact.** Two
    people at one company with different tiers can get different refreshed catalog prices.
13. **Review quotes that staff send have no expiry**, because `portalFirm` is not set on a staff
    send.
14. **Sales tax is not calculated.**
15. **Repairs cannot be priced online.**
16. **Service quotes have no online estimate page**, only a PDF.
17. **Bidder portal views are not counted as "opens".** The bidder PDF is re-rendered rather than
    being the emailed file. Both were defaults awaiting the owner's confirmation.
18. **Preview banner wording** on Home says actions affect real data, while actions are disabled.
19. **Any staff member can create and revoke grants and decline acceptances.** No permission is
    required beyond being signed in.
20. **The cart page in preview** shows an empty cart, because a preview has no cart.
21. **Legacy data**: `portal-self-serve` quotes (from the retired builder) and plaintext `token`
    fields on old grants still exist and are handled.
22. **Owner-pending production checks** recorded in project notes: try the catalog, service and
    curtain flows with a real customer grant; compare a multi-venue service quote against the
    staff builder; set a Portal category on each package; configure departments (nothing shows
    until they are); set the production origin used for PDF rendering.

### 11.3 Where documentation and code disagree

| Topic | Documentation says | Code does |
| --- | --- | --- |
| Session length | Decision D60: cookie lives 6 months | Cookie and grant both expire at 90 days |
| Who manages grants | A code comment calls grants "admin-managed" | Any signed-in staff member |
| Price formula | Decision D413: `cost ÷ (1 − tier margin)` | `cost × (1 + markup)`, after a later company-wide change from margin to markup. Stored fields are still named `margin` / `tierMargin` |
| Quote source value | The brief for this document named a source `portal` | Values are `portal-catalog`, `portal-service`, and legacy `portal-self-serve`. There is no plain `portal` |
| Navigation | Phase 28 notes list Home · Catalog · Service · My quotes · Cart | Also includes Meeting notes |
| Curtain cart type | A type comment says curtain requests are "always price on request" | Curtains with a rated fabric are priced (and flagged for confirmation) |
| Portal quote visibility | Decision D62: "Drafts never appear" | The customer's own `portal-catalog` and `portal-self-serve` drafts are listed as "In review" |
| Sign-in link delivery | Decision D60: staff copy the link by hand | The link is emailed from the staff member's mailbox, with copy as fallback |

**Source:** `src/lib/rate-limit.ts`, `src/lib/portal.ts`, `src/lib/portal-catalog-index.ts`,
`src/lib/portal-pricing.ts`, `src/lib/portal-quotes.ts`, `src/lib/portal-projects.ts`,
`src/app/(app)/companies/actions.ts`, `src/app/portal/page.tsx`, `src/app/portal/nav.ts`,
`src/lib/portal-cart-types.ts`, `DECISIONS.md` (D60–D63, D403, D413, D1176–D1184),
`MASTER-QUESTIONS.md` (F15, F16, R4), `AGENTS.md`.

---

## 12. Not verified

The following were taken from project notes or comments, or were only partly read. A rebuild
team should confirm them with the owner before relying on them.

1. The rendered content and layout of the online estimate page (overview, itemized view, cut
   sheets). Only the access rules were traced.
2. The public client-link "package" page (v2 and v3 tokens): datasheet links, zip, plans and
   risers, scope-selection and question forms, open counting. The limits in section 9.2 were read
   from constants; the flows were not traced.
3. The print-route token format and lifetime used for PDF rendering.
4. Inspection engine details: labour formula, level multiplier, minimum fee value. Flame-test
   defaults ($150 base fee, 5 minutes per curtain, 15-minute rounding) are from the engine's
   header comment, not from the stored rates.
5. Fly-mode travel calculation beyond the threshold rule and default allowances.
6. The default curtain sewing percentage (10% per project notes).
7. Default tier markups are the code defaults; production values may differ.
8. The rewards card and Redeem rules.
9. The exact fields shown in the staff Portal panel and the columns of the staff queue table.
   Their rules were read; their full markup was not.
10. The "Portal" chip on the main staff quotes list.
11. The approval gate that applies when staff Approve a catalog quote (who may mark Won).
12. How venue travel miles are computed and cached (manual, routed, or straight-line).
13. The full document-category default list and how categories are edited.
14. The "Allowance" image placeholder in the catalog context.
15. The accept dialog's remaining client-side validation and the exact category assigned to an
    uploaded PO file.
16. Performance at scale. The Home page loads all quotes, leads, projects and renewals and
    filters them in memory on each view; this was not assessed for large data sets.
17. Automated test coverage. Tests exist for the invite email, parties and bids
    (`scripts/test-portal-invite.ts`, `scripts/test-parties.ts`, `scripts/test-bids.ts`); which
    other portal rules are covered was not checked.
18. That the Departments editor is restricted to administrators (stated in project notes).
