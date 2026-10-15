# Estimate parties, bids & vendor links — design (#346)

**Date:** 2026-10-14 · **Punch item:** #346 · **Decisions:** D1052+ · **Migration:** 0041
**Status:** approved in brainstorm (Jeff, 2026-10-14) — every section confirmed.

## 1. Problem

An estimate links to exactly one company (`Quote.customerId`). That one id
drives the letter header, pricing tier, portal listing, client link, Inbox
send and win/loss reporting. Real bid jobs involve many companies:

- The **owner / venue** (e.g. Manitowoc Public School District).
- Several **general contractors (GCs)** bidding the owner — Peak sends each the
  same package; whoever wins the GC award becomes Peak's customer.
- On some jobs part of Peak's scope goes through the **electrical contractors
  (ECs)** instead: rigging & curtains to the GCs, AV & lighting to the ECs.
  Other times everything goes to the GCs.
- An **architect**, a **theatre / AV consultant**, an **electrical
  contractor**, others.
- **Vendors** whose quotes and emails feed the estimate and later the
  project's procurement.

Jeff's core requirement: *track one lead / opportunity that may have multiple
estimates for different scopes, or a single estimate with many scopes.*

## 2. Decisions taken in the brainstorm

| # | Decision |
|---|---|
| 1 | Bid shape: both — the same scope to several GCs/ECs **and** owner/architect/consultant roles on the job. |
| 2 | Every bidder's copy is **identical** (scope and price); only the addressee changes. |
| 3 | **Award** picks the winning bidder, who becomes the estimate's customer. Losing bidders are "lost the award", never "Peak lost". |
| 4 | Before award, the estimate's customer is the **owner / venue**. |
| 5 | Roles: Owner · GC · EC · Architect · Theatre/AV consultant · Vendor · Other (typed label). |
| 6 | Vendors: a vendor quote links a vendor **company**; vendor emails file to an estimate/project; a vendor PDF on an email becomes a vendor quote; all of it carries to the project. |
| 7 | Sending: **one email per bidder**, each with its own addressed PDF + client link. |
| 8 | Bid details: due date/time, addenda log, per-bidder result. |
| 9 | Bidders with a portal grant see the bid **read-only**. |
| 10 | Storage: **one junction table** (`record_parties`), not a JSONB list and not per-GC copies. |
| 11 | Parties live on the **lead** too and carry lead → estimate → project. |
| 12 | Split scopes = **separate estimates per bidder path** under one lead (plus "Split systems into a new estimate"). |
| 13 | **One project per won estimate**, each billed to its own customer, all tied to the same lead. |
| 14 | **Award is separate from Won.** Lead value = **sum of its open + won estimates**. |
| 15 | Revision re-sends use the **same email** for every bidder. |
| 16 | Many GCs take bids through **their own bid website** (PDF upload) — a first-class submission path. |
| 17 | **Read the PDF** (AI extraction of vendor quotes) is in this build, with an accuracy loop so it can be refined. Haiku first, Sonnet on Try harder. |

## 3. Data model

### 3.1 `record_parties` (migration 0041)

One row per company playing a role on a record.

| column | type | notes |
|---|---|---|
| `id` | text PK | `pty_<16 hex>` |
| `record_type` | text | `lead` · `quote` · `project` |
| `record_id` | text | the record's id |
| `company_id` | text | a real Customers-directory company; required |
| `contact_id` | text null | the person we deal with there |
| `role` | text | `owner` · `gc` · `ec` · `architect` · `consultant` · `vendor` · `other` |
| `role_label` | text null | only for `other` |
| `bid` | jsonb null | **quote rows only**, set iff this row is a bidder (§3.3) |
| `created_at` / `created_by` | bigint / text | |
| `updated_at` | bigint | |

Indexes: `(record_type, record_id)`; `(company_id)`; unique
`(record_type, record_id, company_id, role)`.

Rules (pure, `src/lib/parties/rules.ts`):
- One row per (record, company, role). A company may hold two roles on one
  record (e.g. a GC that is also the EC).
- `bid` only on `record_type = 'quote'` rows with role `gc` or `ec`.
- `role_label` required (≤ 60 chars) iff role `other`, else null.
- At most one `owner` row per record.

Store: `src/lib/stores/parties.ts` — `listFor(recordType, id)`,
`listForCompany(companyId)`, `add`, `update`, `remove`, `copyParties(from, to,
filter)`. All writes go through it.

### 3.2 Bid fields on the estimate

`Quote.bid?: { dueAt: number | null; addenda: BidAddendum[]; awardedPartyId?: string | null } | null`
where `BidAddendum = { no: number; receivedAt: number; note: string }`.
An estimate is a **bid** iff it has ≥ 1 bidder row. `Quote.bid` holds the
estimate-level details only. Store-owned writer `setBidDetails`.

### 3.3 Bidder state (`record_parties.bid`)

```ts
type BidderState = {
  result: "pending" | "awarded" | "lost" | "withdrew" | "no_bid";
  submitVia: "email" | "website";
  bidSiteUrl?: string;          // this job's invite link; overrides the company default
  gcBidNo?: string;             // the GC's own bid / package number
  revSent?: number | null;      // revision last delivered (email or website)
  sentAt?: number | null;
  sentBy?: string | null;
  confirmation?: string;        // website submission confirmation # / note
  threadId?: string | null;     // the email thread for this bidder
  failed?: { at: number; error: string } | null;
  lostByAward?: boolean;        // set by awardBid so undoAward restores only these
};
```

`Company.bidSiteUrl?: string` — the company's default bid website.

### 3.4 Customer of record and award

- Before award, `Quote.customerId` = the owner (the record's `owner` party).
  The estimator keeps the two in step: setting the customer sets/updates the
  owner party when the estimate is a bid.
- **`awardBid(quoteId, partyId, by)`** — store-owned, one transaction:
  winner `result: awarded`; other `pending` bidders → `lost`; `customerId` /
  contact → the winner's company/contact **without re-stamping the pricing
  tier**; a `history` note; `Quote.bid.awardedPartyId` set. Allowed only while
  status is draft or sent. **`undoAward`** reverses it until the quote is Won
  (restores the owner as customer, bidders with `lostByAward` →
  `pending`).
- **Won** is unchanged: `setStatus("won")` → `spawnFromQuote` → one project.

### 3.5 Carry-over

Copied **once** at each hand-off; afterwards each list is its own:
- lead → estimate (estimate created with `leadId`): owner, architect,
  consultant, vendor, other rows. GC/EC rows are **not** copied as bidders —
  the estimator ticks bidders from the lead's GC/EC list.
- estimate → project (`spawnProject`): every row; the awarded bidder becomes
  the project's customer as it already is via `customerId`. Bid state stays on
  the quote rows.
- Adding a GC/EC bidder on an estimate also adds a plain `gc`/`ec` row on its
  lead if missing.

### 3.6 Lead value

When a lead has ≥ 2 estimates, its board value = sum of its draft/sent/won
estimates' values (lost excluded). With 0–1 estimates, unchanged. Pure
`leadRollupValue(lead, quotes)`.

### 3.7 Vendors

- `VendorQuote.vendorCompanyId?: string | null`; `vendor` text stays as
  display / fallback.
- Saving a vendor quote with a company adds a `vendor` party on the quote if
  missing.
- `VendorQuote.extracted?: { runId: string; model: string; at: number; data:
  VendorPdfExtraction } | null` — the Read-the-PDF result kept for the
  accuracy report (§7).

## 4. Screens

- **Lead drawer** — *Job* card (parties grouped by role; add/remove; company
  + contact picker) and *Estimates* list (path GC/EC, due, award state,
  value). Lead value shows the rollup.
- **Estimator header** — Parties chip row (opens a Parties dialog: same
  editor plus "Bidders: tick from the lead's GCs/ECs, or add one"); **Bid**
  chip with due date + addenda count (opens Bid details dialog: due
  date/time, addenda log add/remove).
- **Build** — **Split systems into a new estimate…**: tick systems → a new
  `-N` estimate on the same lead with the same header, tier, owner and
  non-bidder parties; the systems move (removed from the source). Refused on
  a sent/won/lost source.
- **Send & track** — **Bidders card** (§5), **Award…** dialog, existing Won.
- **Company page** — *Bids & roles*: open bids where a bidder (result),
  jobs where owner/architect/consultant/other; vendors also *Quotes we've
  received*.
- **Quotes hub** — *Bid* badge + due; "Out to bid" filter. ⌘K matches
  bidder company names.
- **Home + Morning triage** — *Bid due today/tomorrow*, naming bidders not
  submitted at the current revision.
- **Reports → Sales** — *Bids by GC/EC*: bids sent, GC awarded (any
  bidder of ours result `awarded` or `lost`), awarded-to-us rate.

## 5. Sending to bidders

- **Addressed PDF per bidder.** The estimate print route takes an optional
  bidder party id (signed into the print token). Header: *Prepared for*
  bidder company + contact; *Project:* job name, *Owner:* owner company; *Bid
  due*, *Addenda acknowledged: 1, 2* when set. No other bidder is named.
  Stored at `quote-pdf/<quoteId>/rev-<n>/bidder-<partyId>.pdf`. `Quote.pdf`
  (customer copy) unchanged.
- **Bidders card** rows: company · contact · email · submit-via ·
  result chip · *Sent Rev 2 · Oct 14* or *Needs Rev 3* · opens.
- **Send to all bidders** — email rows only, pending, `revSent < current
  rev`. The browser walks rows **one server call per bidder** with progress;
  a failed row is marked `failed` and the walk continues. Each call runs the
  existing ordered send (`estimate-email/send-server.ts`) with the bidder's
  addressed PDF and v3 link; success stamps `revSent/sentAt/threadId`. The
  first successful send moves the quote to Sent.
- **Website rows** — Download PDF (`Peak – <job> – <estimate name> –
  <bidder> – Rev N.pdf`), Open bid site ↗, **Mark submitted** (optional
  confirmation) → stamps `revSent/sentAt`.
- **Revisions** — after a new revision, rows with `revSent < rev` show
  *Needs Rev N*; **Send revision to bidders** = Send to all; same email text
  for everyone, subject "Revised bid — <estimate> (Addendum N)" when an
  addendum is newer than the row's last send.
- **Client link v3** = v2 + party id: package page reads *Prepared for* the
  bidder; opens attributed to the bidder row; client responses tagged with
  the bidder. v1/v2 links keep working.
- **Portal** — a bidder company with a grant lists the bid read-only (Bid
  badge, due date, their PDF, no Accept). After award it leaves losing
  bidders' portals; the winner sees it as a normal quote (it is now their
  `customerId`).

## 6. Vendors

- **Vendor quote modal** — *Vendor* becomes a company picker over
  vendor/manufacturer companies, typed text fallback.
- **Inbox** — on a thread, **File to estimate / project…** links the thread
  (`link: {type: "quote"|"project"}`), keeps the vendor as its company, adds a
  `vendor` party. **Add as vendor quote…** (thread with a PDF attachment)
  opens the Estimator's vendor quote modal pre-filled (vendor company,
  attachment copied to Blob, quote # parsed from the subject).
- **Vendors card** on Build package + Send & track: per vendor, its quotes
  and filed threads.
- **Project Procurement** reads the estimate's vendor quotes + threads, plus
  threads filed to the project.

## 7. Read the PDF (Assist feature `vendorpdf`)

- Opt-in feature (`OPT_IN_FEATURES`), pilot users only, through `runAssist`
  (gate, cap, rate limit, `assist_runs` log). Haiku 5.5; **Try harder** on
  Sonnet 5.5. Env override `ASSIST_MODEL_VENDORPDF`.
- Input: the PDF as a document block, ≤ 32 MB and ≤ 100 pages; larger →
  "too large to read; enter by hand". The PDF is untrusted data.
- Output (zod, all optional): vendor, quoteNumber, quoteDate, validUntil,
  leadTime, shipFrom, lines[{description, mfrPartNumber, qty, unit,
  unitPrice, amount}], freight, tax, total, paymentTerms, notes.
- Deterministic checks (pure `src/lib/vendor-pdf/checks.ts`): line math,
  sum vs. total (flag, never fix), catalog match by model # / former SKU,
  vendor company match, includes-freight pre-tick.
- Fills the modal only; nothing saves on its own.
- On save, `VendorQuote.extracted` keeps the raw result; the Assist report
  gains *Vendor PDFs*: lines kept / edited / deleted / added, total changed,
  math flags, by vendor and model (pure `src/lib/vendor-pdf/diff.ts`).

## 8. Permissions & safety

- Parties + sending: whoever can edit the estimate. Award / undo award:
  `create`. Bidder lists are staff-only.
- Award never re-stamps the tier or re-prices.
- Deleting a company on a party row is refused with the list of records.
- Go-live wipe: parties go with their records.
- A failed bidder render/send never blocks other bidders.

## 9. Testing

Pure modules with `test:specs` checks: party rules, send planning
(who gets what at each revision), award transitions, lead rollup, split
systems, vendor-PDF checks and diff. New pages in smoke routes. One
scratch-datadir POST pass: add bidders → award → Won → project carries
parties.

## 10. Build order (each slice ships alone)

1. **Parties core** — table + store, lead Job card, estimate Parties
   dialog/chips, company *Bids & roles*, carry-over, lead value rollup.
2. **Bids** — bid fields + addenda, Bidders card, addressed PDFs + v3 links,
   send to all, website path, Award / undo, due-date surfacing (Home,
   triage, hub).
3. **Split systems into a new estimate.**
4. **Vendors** — company-linked vendor quotes, file vendor threads, Add as
   vendor quote, Vendors card, project Procurement read-through.
5. **Read the PDF** — `vendorpdf` feature, checks, accuracy report.
6. **Portal** read-only bidder view + **Reports** *Bids by GC/EC*.

## 11. Not in scope

Per-system bidders inside one estimate; one project with several
contracts; scraping GC bid websites; auto-submitting to bid sites; AI
anything beyond Read the PDF.
