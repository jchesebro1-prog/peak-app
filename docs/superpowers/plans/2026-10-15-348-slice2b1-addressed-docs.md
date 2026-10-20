# #348 Slice 2b-i — Addressed documents + per-bidder PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Customer documents can be addressed to a bidder: "Prepared for" prints the bidder's company and contact, the Project column adds "Owner: …", and a bid line prints the due date and the addenda acknowledged. After an award every customer document defaults to the awarded bidder. Staff can download a PDF addressed to any bidder from the Bidders card (the website-upload path). Bid writes re-render the saved PDF.

**Architecture:** One pure addressee shape (`DocAddressee`) and one server resolver (`documentAddressee(q, partyId?)`). `quoteDocumentDataFor` takes an optional addressee (4th argument) — the venue keeps coming from the owner customer passed as `cust`. Every loader of a customer document passes `documentAddressee(q)` (awarded default). The print route takes `?bidder=<partyId>` signed into its token (`id~partyId`), and `renderBidderPdf` (copied from `renderCoverPdf`) renders it on demand for `GET /api/quotes/[id]/bidder-pdf/[partyId]`. `Quote.bid` becomes content again (no `updatedAt` bump) and every bid write schedules the PDF.

**Spec:** `docs/superpowers/specs/2026-10-14-estimate-parties-and-bids-design.md` §3.4 (revised), §5 (addressed PDF, website rows' Download PDF). Email send and v3 links are slice 2b-ii.

## Global Constraints

- Worktree `/Users/sm/Downloads/peak-app/.claude/worktrees/parties`, branch `feat/348-estimate-parties`. Never `git stash`; never `git add -A` (`.superpowers/sdd/task-4-report.md` is tracked from older work). Commit trailer exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Fixture scope `fixtureId(348, …)` (use slug prefix `d` for this slice: `TEST348:d…`).
- The owner stays the customer; the venue always resolves from the owner (`cust` = `getCustomer(q.customerId)` as today). Only "Prepared for" / "Attn" change.
- Addressee precedence: an explicit bidder party id (must be a GC/EC bidder row on this quote) → the awarded bidder (`q.bid.awardedPartyId`) → none (today's output, byte-identical).
- Contact on the addressee: the party's `contactId` contact (display name + title); else the bidder company's primary contact; else none.
- Bid line text (exact): `Bid due Oct 21, 2:00 PM · Addenda acknowledged: 1, 2` — either half omitted when empty; whole line omitted when both are empty or when there is no addressee. Owner line under the project name: `Owner: <owner company name>` — only when addressed to a bidder.
- PDF file name (exact shape): `Peak – <project name> – <bidder company> – Rev <n>.pdf` (en dashes, each part with `/\\:*?"<>|` and control chars stripped, collapsed spaces, each part ≤ 60 chars).
- Bid writes: `Quote.bid` back in `QUOTE_CONTENT_FIELDS`; `patchQuoteBid` still does NOT bump `updatedAt`; `bid-actions.ts` calls `scheduleQuotePdf(quoteId)` after a successful setBidDetails / award / undo.
- Download route: staff only (`requireUser`), 404 for an unknown quote, a non-"quote" PDF kind, or a party that isn't a bidder on that quote; `maxDuration = 60`; inline unless `?download=1`.
- Client components never import stores, `@/db`, `node:*` or server-only modules.
- Gates: tsc clean; focused tsx tests 0 FAIL; `npm run test:specs` ALL PASSED for tasks touching harness/DB code; eslint 0 errors on touched files; `npm run build` in Tasks 3 and 4.

---

### Task 1: Pure addressee helpers

**Files:** Create `src/lib/parties/addressee.ts`; modify `scripts/test-bids.ts` (pure checks in `bidChecks`).

**Produces:**
- `type DocAddressee = { companyName: string; contactName: string; contactRole: string; ownerName: string; bidLine: string }`
- `bidDocLine(bid: QuoteBid | null | undefined): string` — `Bid due <bidDueText> · Addenda acknowledged: 1, 2` per the constraint (addenda numbers ascending).
- `bidderPdfFileName(projectName: string, bidderName: string, rev: number): string` per the constraint.
- `addressedHeader(base: { custName: string; hasAttn: boolean; attnLine: string }, a: DocAddressee | null): { custName: string; hasAttn: boolean; attnLine: string; ownerLine: string; bidLine: string }` — with `a` null returns `base` + `ownerLine: ""`, `bidLine: ""`; else `custName = a.companyName`, `hasAttn = !!a.contactName`, `attnLine = a.contactName + (a.contactRole ? " · " + a.contactRole : "")`, `ownerLine = a.ownerName ? "Owner: " + a.ownerName : ""`, `bidLine = a.bidLine`.

Tests (exact expectations): bid with dueAt Oct 21 2 PM CDT + addenda [2,1] → `"Bid due Oct 21, 2:00 PM · Addenda acknowledged: 1, 2"`; no due + addenda [1] → `"Addenda acknowledged: 1"`; due only → `"Bid due Oct 21, 2:00 PM"`; nothing / null → `""`; file name `bidderPdfFileName("Lincoln HS: Rigging/Curtains", "ABC  Construction", 2) === "Peak – Lincoln HS RiggingCurtains – ABC Construction – Rev 2.pdf"`; a 100-char bidder name is cut to 60; `addressedHeader(base, null)` equals base fields + empty lines; with an addressee the four fields switch as specified and `hasAttn` is false when the contact is blank.

Commit: `feat(348): pure addressee helpers — bid line, header switch, bidder PDF name`.

---

### Task 2: Addressed customer documents + bid writes re-render

**Files:**
- Create `src/lib/parties/addressee-server.ts` — `documentAddressee(q: Pick<Quote, "id" | "customer" | "customerId" | "bid">, partyId?: string | null): Promise<DocAddressee | null>` (reads the party with `getDoc("record_parties", id)` and checks `recordType === "quote" && recordId === q.id && bid && (role gc|ec)`; company name via `getCompany`; contact via `getContact(contactId)` (`displayName`, `title`) else `contactsForCompany(companyId)[0]`; ownerName = the owner customer's name (`q.customer`, else `getCompany(q.customerId)?.name`, else ""); `bidLine = bidDocLine(q.bid)`).
- Modify `src/lib/quote-pdf/quote-document-data.ts` — `quoteDocumentDataFor(q, cust, settings, addressee: DocAddressee | null = null)`; compute the header through `addressedHeader(...)`; add `ownerLine` and `bidLine` to the returned props.
- Modify `src/app/(app)/estimator/quote-document.tsx` — props type gains `ownerLine?: string; bidLine?: string`; under the project name print `ownerLine` (same muted style as the venue line) when non-empty; directly under the meta grid print `bidLine` in a muted 11.5px line when non-empty. Nothing renders when both are empty (byte-identical for non-bids).
- Wire every customer-document loader to pass `await documentAddressee(q)`: `src/app/print/quote/[id]/page.tsx`, `src/lib/quote-pdf/document-loader.ts`, `src/lib/estimate-output/cover-loader.ts`, `src/lib/estimate-output/package-live-loader.ts`, `src/lib/estimate-output/live-bom.ts` (it builds from the Estimator's live state — pass null there if `q` lacks `bid`; read it), `src/lib/curtain-cut-sheets/load.ts` (read whether cut sheets print "Prepared for"; if they print the customer name, pass the addressee, else pass nothing).
- Modify `src/lib/stores/quotes.ts` — put `"bid"` back in `QUOTE_CONTENT_FIELDS` (comment: "#348 2b-i: prints as Prepared for (awarded bidder) and the bid line"); keep `patchQuoteBid` without an `updatedAt` bump (update its doc comment: content-changed stamp + scheduled re-render, no version bump so an open composer/approval isn't staled).
- Modify `src/app/(app)/estimator/bid-actions.ts` — after a successful `setBidDetails`, `awardBid`, `undoAward`: `await scheduleQuotePdf(quoteId)` (import from `@/lib/quote-pdf/schedule`). Confirm the Estimator page that hosts these actions exports `maxDuration` ≥ 60 (the render runs in `after()`).
- Tests (`scripts/test-bids.ts` `bidDbChecks`): on a fixture quote with two bidders (one with a contact) — `documentAddressee(q)` is null before award; with `partyId` = a bidder → company/contact/owner/bidLine filled; with a non-bidder or another quote's party id → null (falls back: when the explicit id is invalid return the awarded default, which is null here); after `awardBid` → `documentAddressee(q)` is the awarded bidder. `quoteDocumentDataFor(q, cust, settings, addressee)` → `custName` is the bidder, `ownerLine === "Owner: <owner>"`, venueLabel unchanged vs without addressee; with null → identical object to the 3-arg call (`JSON.stringify` equal). After `setBidDetails` the quote's `contentChangedAt` advanced and `updatedAt` did not.

Commit: `feat(348): customer documents addressed to the bidder / awarded bidder; bid writes re-render the PDF`.

---

### Task 3: Per-bidder PDF render + download

**Files:**
- Modify `src/app/print/quote/[id]/page.tsx` — read `sp.bidder`; when present (string ≤ 64 chars) the token must verify against id `${id}~${bidder}` (`verifyPrintToken(secret, t, "quote", `${id}~${bidder}`, now)`), else against `id` as today; pass `await documentAddressee(q, bidder)` (bidder) or `await documentAddressee(q)` (default).
- Create `src/lib/quote-pdf/bidder-pdf-server.ts` — `renderBidderPdf(quoteId, partyId, host, proto): Promise<{ ok: true; pdf: Buffer; fileName: string } | { ok: false; status: 404 | 500 | 503; error: string }>`, a copy of `renderCoverPdf`'s structure: validate ids (≤ 64), quote exists and `pdfKindForQuoteType(q.quoteType) === "quote"`, the party is a GC/EC bidder row on this quote (else 404), sign `signPrintToken(secret, "quote", `${q.id}~${partyId}`, now)`, render `${origin}/print/quote/${id}?bidder=${partyId}&t=${token}` with the cover's timeout/deadline constants (import them), file name `bidderPdfFileName(q.name, companyName, currentRev(q))`.
- Create `src/app/api/quotes/[id]/bidder-pdf/[partyId]/route.ts` — copy of the cover-pdf route (`maxDuration = 60`, `requireUser`, inline unless `?download=1`).
- Modify `src/lib/parties/bid-vm.ts` (`BidderVM.pdfHref: string` = `/api/quotes/<id>/bidder-pdf/<partyId>?download=1`) and `bid-actions.ts` loader to fill it; `src/app/(app)/estimator/steps/bidder-row.tsx` — a "Download PDF" link (`download` attribute, plain anchor) on every pending bidder row; on website rows it sits next to "Open bid site ↗".
- Tests: a pure check that the print route's token id shape is `${id}~${partyId}` is not useful — instead add to `bidDbChecks`: `renderBidderPdf` with an unknown party → `{ ok:false, status:404 }`; with another quote's bidder → 404 (no render attempted; inject nothing — the 404 paths return before rendering). Verify tsc, eslint, `npm run build`.

Commit: `feat(348): per-bidder PDF — signed print variant, on-demand render, Download PDF on the Bidders card`.

---

### Task 4: Docs, gates, browser pass

- [ ] DECISIONS (next free after origin/main's max, recompute): addressed documents (precedence, venue from owner, awarded default on every customer document, bid line copy); bid is content again with a scheduled re-render but no version bump; per-bidder PDF on demand (not cached, ≈ the cover PDF's cost; slice 2b-ii attaches the same render to emails).
- [ ] PUNCHLIST #348 status: slices 1, 2a, 2b-i built; 2b-ii next. Prod check addition: download a bidder PDF; after Award the estimate PDF reads "Prepared for <GC>".
- [ ] AGENTS phase 62: a 2b-i paragraph.
- [ ] Gates: tsc; test:specs; eslint on touched files; build; smoke (port checks).
- [ ] Browser pass (controller): Bidders card → Download PDF for a bidder (opens/downloads; header shows the bidder + Owner + bid line); Award → the Estimator's customer preview / saved PDF reads Prepared for the GC; non-bid estimate unchanged.
- [ ] Commit docs.
