# #348 Slice 6: Portal read-only bidder view + Reports "Bids by GC/EC" implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to work through this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- **Portal.** A GC or EC company with a portal grant sees, read-only, each bid Peak delivered to it: a **Bid** badge, the due date, the online estimate addressed to that company, and its own PDF at the revision it was sent. There is no Accept, Refresh pricing, Rename, Copy or Quote again.
  - After an award, the bid leaves losing bidders' portals.
  - The awarded bidder keeps it, addressed to them, and also sees later sent revisions that were addressed to them.
  - The owner is still `customerId`. Once the estimate has bidders, the owner's portal shows it as a **BOM with no prices**: no PDF, no Accept (Jeff, Task 3). An estimate with no bidders is unchanged.
  - No portal page names another bidder.
- **Reports.** Reports gets a **Bids by GC/EC** widget. It has one row per bidder company and role:
  - Sent
  - Open
  - GC awarded (decided)
  - Awarded to us
  - Withdrew / no bid
  - Awarded-to-us rate
  - Last sent

  It follows the Sales `?range` period.

**Spec:** `docs/superpowers/specs/2026-10-14-estimate-parties-and-bids-design.md`
- §2 #3 (revised: the owner stays the customer; the awarded bidder gets the portal listing) and #9 (bidders with a grant see the bid read-only).
- §3.3 (bidder state), §3.4 (award).
- §4 (Reports → Sales — Bids by GC/EC).
- §5 (Portal paragraph), §8 (bidder lists are staff-only), §10 item 6.

**Architecture:**
- **One gate module.** `src/lib/quote-pdf/portal-access.ts` already holds every portal read rule for a quote. It is used by the estimate page, the PDF route, the photo route and the Home row. It stays the only gate, and the bidder rule is added to it. Customer access is unchanged: `portalListsQuote` stays customerId-only, so all customer logic stays byte-identical.
  - `portalOnlineEstimateState(q, cid, bids = [])` gains an optional third argument: this company's bidder rows on the quote. The customer branch runs first and returns exactly what it returns today. If the company isn't the customer, the bidder rule decides. If the caller passes no rows, the result is `unavailable`, so a missed call site fails closed.
  - `portalBidPdfSource(q, cid, bids)` is new in the same module, and is derived from the same bidder state.
- **Pure bidder rule.** `src/lib/parties/portal-bid.ts` (browser-safe, no stores) holds `portalBidState(q, cid, rows)`. It works out which revision a bidder company may see, or `revising`, or `unavailable`. `portal-access.ts` composes it.
- **One loader.** `src/lib/parties/portal-bid-server.ts` is the only portal code that reads `record_parties`:
  - `portalBidRowsFor(q, cid)` makes one indexed `listFor("quote", q.id)` read. It returns `[]` without reading when `q.customerId === cid`.
  - `portalBidRowsForCompany(cid)` serves Home.
  - Portal routes and pages never import `stores/parties`, `stores/bids` or `addressee-server` (pinned).
- **Read-only comes from the existing actions.** Every portal write action keeps using `portalListsQuote(q, session.customerId)`: `acceptPortal`, `refreshPortalQuote`, `copyToCart`, `renamePortalQuote` and `serviceRequestFromQuoteId`. A bidder company is never the quote's customer, so every action already refuses a bidder. This slice adds no new write paths, and DB checks pin the refusals. The UI drops the controls: bidders get their own `PortalBidRow`, and the shared `PortalQuoteRow` is untouched.
- **Which revision a bidder sees** (pure, `portalBidState`). The candidate revisions are:
  - the sent revision whose `rev === bid.revSent` (the copy delivered by email or marked submitted);
  - every sent revision whose frozen `docFields.awardedPartyId === party.id`. These are the owner's copies cut after the award, which 2b-i addressed to that bidder.

  The bidder sees the latest candidate. It is never a later revision not addressed or delivered to them, never another bidder's copy, and never an owner-addressed copy.
- **The bidder's online page and PDF are addressed to them.**
  - The page uses `loadQuoteDocumentProps(q, { revision, photos: {href}, bidderPartyId })`. That loader already exists from 2b-ii and is strict: it returns null when there is no valid bidder row.
  - The PDF uses `renderBidderPdf(q.id, partyId, host, proto, { rev })`. It exists already and refuses a `rev` that isn't one of the quote's sent revisions, or a party that isn't a live bidder.
  - The render is on demand (headless Chrome), rate-limited per grant, `maxDuration = 60`. It uses the same render path as the staff Download PDF. See Open question 7 for serving the emailed copy instead.
- **Portal and the v3 client link.** Each bidder's emailed v3 link (2b-ii) stays their only response channel: package page, questions, scope selection, opens. The portal never mints, shows or counts v3 links. Portal views don't count as bidder opens, just as owner portal views don't count.
- **Report.**
  - The pure aggregation `src/lib/parties/bid-report.ts` (`bidsByBidder`) is harness-tested.
  - The loader `src/lib/parties/bid-report-server.ts` runs one bounded `listDocsWhere("record_parties", …)` over sent quote bidder rows only. Then it batches `getMany(quoteIds)` and `getCompanies(companyIds)`.
  - It is memoised in `makeDashboardData` as `bidReport`.
  - The widget `bids-by-bidder` is registered in `src/lib/dashboard/registry.ts` (surface `reports`, timeframe `history`, no perm) and rendered by `src/app/(app)/_dashboard/widgets/bids.tsx`.

**Tech stack:** Next.js 16, TypeScript, doc-store, the `test:specs` harness, `scripts/smoke-routes.ts`.

## Global Constraints

- **Worktree and git.**
  - Worktree `/Users/sm/Downloads/peak-app/.claude/worktrees/parties`, branch `feat/348-estimate-parties` (currently `origin/main` 49bfeee6).
  - Never `git stash`.
  - Never `git add -A`: `.superpowers/sdd/task-4-report.md` is tracked, so stage explicit paths.
  - SDD report files are `.superpowers/sdd/6-task-N-report.md`.
  - Commit trailer, exactly: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Node: `export PATH="$HOME/.local/node/bin:$PATH"` if it's missing.
  - Never deploy a Vercel preview.
- **Fixtures.**
  - `fixtureId(348, …)` with slug prefix **`i`** (`TEST348:i…`).
  - Identity teardown deletes only `like(companies.id | contacts.id | contactEmails.contactId, "TEST348:i%")`.
  - Quotes go through `createFixture`.
  - `record_parties` rows are registered with `registerFixture("record_parties", id)` before `dropFixtures(348)`, the slice-2 precedent (`regAll`).
  - Use far-future `T` values (for example `Date.UTC(2034, 2, 10)`) for report periods so real rows never land in the window.
- **The owner stays the customer.** Nothing here writes `customerId`, the contact, the venue, the tier, `Quote.bid` or any bidder state. The slice is read-only, apart from the dashboard layout (unchanged code) and the existing grant actions.
- **Tenant scoping.**
  - Every portal read derives the company from `resolvePortalViewer` only: a grant, or a team `?preview=<companyId>`.
  - A bidder row counts only when its `companyId === cid`, `recordType === "quote"`, `recordId === q.id`, its role is gc or ec, and `bid` is set. The pure rule re-checks all of these. The loader filters too.
  - Every refusal is the existing uniform answer:
    - the page shows `ONLINE_COPY.portalUnavailable` (200);
    - the PDF and photo routes return `Not found` (404);
    - actions return `PORTAL_NOT_FOUND_COPY`.
- **Bidder lists are staff-only.** No portal surface names another bidder, counts bidders, or says "lost". A losing bidder's portal simply no longer lists the quote.
- **Existing pins to keep or update.** These strings stay:
  - `scripts/test-review-and-spec.ts` ~26631, ~26728–26730, ~26959–26960, ~28471–28473: the portal PDF route keeps `resolvePortalViewer(`, `portalQuotePdfSource(`, `portalQuotePdfPreparing(q, session.customerId)`, `portalQuotePdfUnavailable(q, session.customerId)`, `pdfFileName(displayQuoteNumber(q), src.rev)` and `status: 404`.
  - ~49277 (the page): `resolvePortalViewer(` before `getQuote(`, `loadQuoteDocumentProps(q, {`, `revision: state.rev,`, the unavailable, revising and signed-out cards, and no `notFound(`.
  - ~49290 (the row): `portalOnlineEstimateState(q, cid).kind` in `quote-row.tsx`, which is unchanged.

  These are **updated in Task 2**:
  - ~49277: `portalOnlineEstimateState(q, cid)` becomes `portalOnlineEstimateState(q, cid, bids)`.
  - ~49286 (the photo route): `portalOnlineEstimateState(q, session.customerId)` becomes `portalOnlineEstimateState(q, session.customerId, bids)`.
- **Imports.** `src/lib/parties/portal-bid.ts` and `src/lib/parties/bid-report.ts` are pure: no `@/lib/stores` value imports (type-only is fine), no `@/db`, no `node:`, no `-server`. `bid-row.tsx` is a server component with no client children, so there is no Accept dialog import.
- **Gates for every task:**
  1. Write the failing checks first.
  2. Implement.
  3. `npx tsx scripts/test-bids.ts` reports 0 FAIL (pure checks).
  4. `npx tsc --noEmit` is clean.
  5. `npx eslint <touched files>` shows 0 errors.
  6. `npm run test:specs 2>&1 | tee /tmp/claude-501/specs-348-s6.log` reports ALL PASSED. The DB checks run here.
  7. `npm run build` in Tasks 2, 3 and 5, where server and client boundaries or routes change.
  8. Commit.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/parties/portal-bid.ts` (new, pure) | `PortalBidRow`, `PortalBid`, `PortalBidState`, `portalBidState`, `portalBidCandidates`, `portalBidList`, `portalBidChip`, `portalBidDueAt`, `PORTAL_BID_COPY`. |
| `src/lib/quote-pdf/portal-access.ts` (modify) | `portalOnlineEstimateState(q, cid, bids = [])` composes the bidder rule; new `portalBidPdfSource`. Customer functions unchanged. |
| `src/lib/parties/portal-bid-server.ts` (new, server) | `portalBidRowsFor`, `portalBidRowsForCompany`, `portalBidPdfResponse(…, deps)`, `PORTAL_BID_PDF_PER_MIN`. |
| `src/app/portal/quotes/[id]/page.tsx`, `pdf/route.ts`, `photo/[docId]/route.ts` (modify) | Load bidder rows, pass them to the gate, then a bidder branch: addressed doc, render, the bidder's revision. |
| `src/app/portal/bid-row.tsx` (new, server component) | The read-only bid row: Bid badge, due or status chip, value as sent, Open PDF. |
| `src/app/portal/page.tsx` (modify) | The **Bids** card, only when the company has visible bids. |
| `src/lib/parties/bid-report.ts` (new, pure) | `bidsByBidder`, `bidReportAnchor`, `BID_REPORT_COPY`. |
| `src/lib/parties/bid-report-server.ts` (new, server) | `loadBidReportData` (bounded query + batches). |
| `src/lib/dashboard/registry.ts`, `src/lib/dashboard/data.ts`, `src/app/(app)/_dashboard/renderers.ts` (modify); `src/app/(app)/_dashboard/widgets/bids.tsx` (new) | The widget. |
| `scripts/test-bids.ts`, `scripts/test-review-and-spec.ts`, `scripts/smoke-routes.ts` (modify) | Checks, chain, pins, smoke routes. |
| `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md` | Docs. |

---

### Task 1: Pure bidder-visibility rule and the gate composition

**Files:**
- Create `src/lib/parties/portal-bid.ts`.
- Modify `src/lib/quote-pdf/portal-access.ts`.
- Modify `scripts/test-bids.ts`: add `export function portalBidPureChecks(ok: Ok)`, and add it to the standalone runner after `bidFollowupChecks`.
- Modify `scripts/test-review-and-spec.ts`: import it, and chain `.then(() => portalBidPureChecks(ok))` after `vendorPdfFillChecks(ok)` (~11732).

**Produces (`portal-bid.ts`):**

```ts
/* #348 slice 6 — the portal's bidder rule (spec §5 Portal, decisions #3/#9). Pure and browser-safe: types only from
   stores, no reads. portal-access.ts composes it; portal-bid-server.ts loads the rows. */
import type { Party } from "./rules";
import type { Quote, QuoteRevision } from "@/lib/stores/quotes";
import { bidDueText } from "./bids";

export type PortalBidRow = Pick<Party, "id" | "recordType" | "recordId" | "companyId" | "role" | "bid">;
export type PortalBid = {
  partyId: string;
  role: "gc" | "ec";
  result: "pending" | "awarded";
  /** The sent revision this company sees: its delivered copy (revSent) or a later sent revision addressed to it (award). */
  rev: QuoteRevision;
  via: "sent" | "award";
  /** The due date as that revision printed it (docFields.bid, else the live bid on revisions without one). */
  dueAt: number | null;
};
export type PortalBidState = { kind: "ok"; bid: PortalBid; closed: boolean } | { kind: "revising" } | { kind: "unavailable" };
type BidQuote = Pick<Quote, "id" | "customerId" | "status" | "source" | "quoteType" | "revisions" | "bid">;

/** The sent revisions this party may see, oldest first: rev === revSent (reason "sent"), plus sent revisions frozen
 *  with docFields.awardedPartyId === party.id. Empty when revSent is null / not a safe integer / not a SENT revision. */
export function portalBidCandidates(q: Pick<Quote, "revisions">, row: PortalBidRow): Array<{ rev: QuoteRevision; via: "sent" | "award" }>;

/**
 * The bidder rule. Unavailable unless ALL hold:
 *  - cid non-empty and q.customerId !== cid (the customer rules decide the customer — never this one);
 *  - not Daylite history (isImportedHistoryQuote inlined: source === "daylite"); pdf kind "quote" (system estimates);
 *  - a row with recordType "quote", recordId === q.id, companyId === cid, role gc|ec, bid set, result pending|awarded;
 *  - when q.bid.awardedPartyId is set, the row IS that party (a pending row on an awarded bid never counts);
 *  - at least one candidate revision.
 * Several qualifying rows (the same company as GC and EC): awarded first, then the latest candidate, then gc before ec.
 * Then by status: draft → revising (no content, not listed — the owner's recall rule);
 *  sent → ok (closed false); won → ok only for the awarded row (closed false), else unavailable;
 *  lost → ok closed true (pending or awarded row). The chosen revision is the LATEST candidate.
 */
export function portalBidState(q: BidQuote, cid: string, rows: readonly PortalBidRow[]): PortalBidState;

/** Home's Bids card: every quote with an ok state for this company (draft / unavailable dropped), newest sent first,
 *  split open (status sent) / history (won, lost). Quotes whose customerId === cid are never here (Your quotes lists them). */
export function portalBidList<T extends BidQuote>(quotes: readonly T[], cid: string, rows: readonly PortalBidRow[]): { open: Array<{ q: T; bid: PortalBid; closed: boolean }>; history: Array<{ q: T; bid: PortalBid; closed: boolean }> };

export const PORTAL_BID_COPY = {
  card: "Bids",
  cardSub: (company: string) => `bids ${company} sent you`,
  badge: "Bid",
  due: (when: string) => `Due ${when}`,
  submitted: "Bid submitted",
  awarded: "Awarded",
  closed: "Closed",
} as const;
/** Chip: sent+pending → due text (or "Bid submitted" with no due date); awarded (sent or won) → "Awarded"; lost → "Closed".
 *  Never "Lost", never a count or another company. */
export function portalBidChip(status: string, bid: PortalBid): string;
```

**Produces (`portal-access.ts`):**

```ts
import { portalBidState, type PortalBid, type PortalBidRow } from "@/lib/parties/portal-bid";
export type PortalOnlineState = Exclude<OnlineEstimateState, { kind: "ok" }> | { kind: "ok"; rev: QuoteRevision; closed: boolean; bidder?: PortalBid };

/** #293 slice 3 rule, unchanged for the customer; #348 slice 6 — any other company is decided by the bidder rule over
 *  ITS bidder rows on this quote (`bids`, from portalBidRowsFor). No rows → unavailable (fails closed). */
export function portalOnlineEstimateState(q: Quote, customerId: string, bids: readonly PortalBidRow[] = []): PortalOnlineState;
/** #348 slice 6 — the bidder's own PDF: its ok state's party + revision (closed included), else null. Never for the customer. */
export function portalBidPdfSource(q: Quote, cid: string, bids: readonly PortalBidRow[]): { partyId: string; rev: number; name: string } | null;
```

The customer body of `portalOnlineEstimateState` is moved verbatim into the `q.customerId === customerId` branch. Today's first line (`!customerId || q.customerId !== customerId || imported → unavailable`) becomes: `!customerId || imported → unavailable`, then `q.customerId === customerId` runs the existing logic, else the bidder mapping.

- [ ] **Step 1: Failing checks** (`portalBidPureChecks`). Build quotes with `buildQuote`-like plain objects: revisions `r1` (sent), `r2` (manual), `r3` (sent), `r4` (sent with `docFields.awardedPartyId = A`). Rows A, B (GCs of company `CA` and `CB`) and E (company `CA` as EC).
  - **Delivered copy.**
    - A with `revSent = r1.rev` on a sent quote → ok, `rev === r1`, `via "sent"`, closed false.
    - A with `revSent = r2.rev` (manual) → unavailable.
    - `revSent` null, a non-integer or 999 → unavailable.
  - **Never a later unsent revision.** A at r1 while r3 exists (sent to others) → `rev === r1`, never r3.
  - **Excluded results.** withdrew, no_bid and lost → unavailable.
  - **Award.**
    - `q.bid.awardedPartyId = A`: B pending (stale) → unavailable.
    - A awarded with r4 frozen to A → `rev === r4`, `via "award"`.
    - A r4 frozen to **B** → never a candidate for A.
  - **Status.**
    - draft → revising;
    - won with A awarded → ok;
    - won with A pending and no award → unavailable;
    - lost with A pending → ok, closed true.
  - **Other companies, records and customers.**
    - `cid` of another company → unavailable.
    - A row with `recordId` of another quote, or `recordType: "lead"`, is ignored.
    - `q.customerId === cid` → `portalBidState` unavailable, while `portalOnlineEstimateState(q, cid, rows)` returns exactly the customer answer. Deep-equal against the two-arg call on a matrix of sent, draft, won and lost.
  - **Fails closed.**
    - `portalOnlineEstimateState(q, CA)` with no rows → unavailable.
    - Daylite source → unavailable.
    - `quoteType: "flame_test"` → unavailable.
  - **Row choice.** A (gc, r1) and E (ec, r3) for the same company → E's r3 is chosen. With both at r1 → gc. Awarded E beats pending A.
  - **`portalBidPdfSource`.** It mirrors ok and closed. It is null for revising, unavailable and the customer.
  - **`portalBidList`.** It drops drafts and the customer's own quotes, sorts by issued time descending, and splits open and history.
  - **Chips.** The due text uses `bidDueText`; also "Bid submitted", "Awarded" and "Closed". `JSON.stringify(PORTAL_BID_COPY)` has no `/lost|other bidder/i`.
  - **Due date.** `portalBidDueAt` reads `rev.docFields.bid.dueAt` over the live `q.bid.dueAt`.
  - **Boundary.** `portal-bid.ts` has no `@/lib/stores/` value import (regex `import (?!type)[^;]*@\/lib\/stores`), and no `@/db`, `node:` or `-server`.
- [ ] **Step 2: Implement.** No route changes yet. The default `[]` keeps every existing caller identical.
- [ ] **Step 3: Run** the gates (no build).
- [ ] **Step 4: Commit.** `feat(348): portal bidder rule — which sent revision a bidder company may see, composed into the portal gate`

---

### Task 2: Server loader and the three portal quote routes

**Files:**
- Create `src/lib/parties/portal-bid-server.ts`.
- Modify:
  - `src/app/portal/quotes/[id]/page.tsx`;
  - `src/app/portal/quotes/[id]/pdf/route.ts`;
  - `src/app/portal/quotes/[id]/photo/[docId]/route.ts`.
- Modify `scripts/test-bids.ts`: add `portalBidDbChecks`, chained in `test-review-and-spec.ts` after `portalBidPureChecks`.
- Modify `scripts/test-review-and-spec.ts`: the two pins listed in Global Constraints.

**Produces (`portal-bid-server.ts`):**

```ts
/** This company's bidder rows on one quote — [] without a read when cid is the quote's customer (or empty). */
export async function portalBidRowsFor(q: Pick<Quote, "id" | "customerId">, cid: string): Promise<PortalBidRow[]>;
/** Every quote bidder row of this company (listForCompany — indexed), for Home. */
export async function portalBidRowsForCompany(cid: string): Promise<PortalBidRow[]>;
export const PORTAL_BID_PDF_PER_MIN = 6;
/** The bidder's PDF response: rate limit (key by grant, or `preview:<cid>`) → render(q.id, partyId, host, proto, { rev })
 *  → inline application/pdf, nosniff, private no-store, file name bidderPdfFileName(src.name, companyName, src.rev)
 *  (the revision's name — never a later one). 404 → "Not found"; 503/500 → the render's text. */
export async function portalBidPdfResponse(
  req: Request,
  src: { partyId: string; rev: number; name: string },
  ctx: { quoteId: string; rlKey: string },
  deps: { render?: typeof renderBidderPdf; companyName?: (partyId: string) => Promise<string> } = {}
): Promise<Response>;
```

**Route and page shape** (the customer code below each bidder branch is unchanged):

- **Page.**
  ```ts
  const bids = q ? await portalBidRowsFor(q, cid) : [];
  const state = q ? portalOnlineEstimateState(q, cid, bids) : …;
  ```
  - `ok` with `state.bidder` → `loadQuoteDocumentProps(q, { revision: state.rev, photos: {…}, ...(state.bidder ? { bidderPartyId: state.bidder.partyId } : {}) })`.
  - `pdfHref` is `base + "/pdf"` when `state.bidder` is set, else the existing `portalQuotePdfSource(q, cid)` test.
  - The unavailable card's `pdfHref` stays customer-only.
  - Cut sheets: `onlineCutSheets(q, state.rev)`, the same as the v3 package page.
- **PDF route.**
  - `export const maxDuration = 60;`.
  - After `getQuote`: `const bids = q ? await portalBidRowsFor(q, session.customerId) : []; const bid = q ? portalBidPdfSource(q, session.customerId, bids) : null; if (q && bid) return portalBidPdfResponse(req, bid, { quoteId: q.id, rlKey: preview ? \`portal-bidpdf:preview:${session.customerId}\` : \`portal-bidpdf:${session.grantId}\` });`
  - Then the existing customer code, verbatim.
- **Photo route.** `portalOnlineEstimateState(q, session.customerId, bids)`. The existing `servePhotoForRevision(req, state.rev, docId)` now serves the bidder's revision.

- [ ] **Step 1: Failing checks** (`portalBidDbChecks`).

  **Fixtures:**
  - Companies `iown` (owner), `igc1`, `igc2`, `igc3`, `igc4` and `ioth`, with contacts `ict1` and `ict2` (with emails).
  - Quote `iq`: system, `customerId: iown`. Then `addBidder` for gc1 through gc4.
  - `setStatus(iq, "sent", "Test", { bypassApprovalGate: "engine-owned-flow" })` cuts r1.
  - `recordBidderSend` for gc1, gc2 and gc3 at r1.
  - `updateBidder(gc3, { result: "withdrew" })`.
  - `ses(cid) = { grantId: "PG-i", customerId: cid, name: "T", email: "t@i.test" }`.

  **Checks:**
  1. `portalOnlineEstimateState(q, igc1, await portalBidRowsFor(q, igc1))` is ok, `bidder.partyId === gc1`, `rev.rev === r1`.
  2. **Refused, the same as missing.** Each of these is `unavailable`, and `portalBidPdfSource` is null:
     - gc4 (never sent);
     - gc3 (withdrew);
     - `ioth`;
     - an unknown quote id.
  3. **Unsent revision.** Move to draft and back to sent (cuts r2), and `recordBidderSend` only gc2 at r2. Then:
     - gc1 still sees r1 (state and PDF source);
     - gc2 sees r2.
  4. **Revising.** `setBidDetails` adds an addendum, which moves the quote to draft. Then:
     - gc1 is `revising`;
     - `portalBidList` excludes it;
     - `portalBidPdfSource` is null.
  5. **Award.** Back to sent, then `awardBid(iq, gc1)`. Then:
     - gc2 (lost by award) → unavailable, not in `portalBidList`;
     - gc1 → ok;
     - the owner: `portalOnlineEstimateState(q, iown)` is ok and `portalListsQuote(q, iown)` is true (unchanged);
     - `portalBidRowsFor(q, iown)` → `[]`.
  6. **A revision addressed after the award.** Draft, then sent cuts r3, frozen with `awardedPartyId = gc1`, which gc1 was never emailed. gc1 sees r3 with `via "award"`.
  7. **Won.** `setStatus("won")` → gc1 is ok (in history), and gc2 is still unavailable.
  8. **Read-only.** For `ses(igc1)` on `iq`, each of these returns `PORTAL_NOT_FOUND_COPY`:
     - `acceptPortal`;
     - `refreshPortalQuote`;
     - `copyToCart`;
     - `renamePortalQuote`.

     Also `serviceRequestFromQuoteId(igc1, iq)` is null.
  9. **No other bidder named.** `loadQuoteDocumentProps(q, { revision: rev1, photos: { href: (d) => d }, bidderPartyId: gc1 })`:
     - its `custName` is gc1's company name;
     - `JSON.stringify(props)` contains neither gc2's nor gc3's company name;
     - `rewardsLine === ""`.
  10. **`portalBidPdfResponse` with fakes.**
      - A fake `render` returning `{ ok: true, pdf: Buffer.from("%PDF-1"), fileName: "x" }` → 200, `content-type: application/pdf`, an inline disposition containing `Rev ${rev}`, and the revision's name rather than a later live name (rename the quote first).
      - A fake 404 → 404 "Not found".
      - The seventh call within a minute on one `rlKey` → 429.
  11. **A losing bidder's quote** after `undoAward`: gc2 is pending again and is visible again (it is no longer lost).
  12. **Route pins** (source):
      - page, pdf and photo each contain `portalBidRowsFor(`;
      - the page contains `portalOnlineEstimateState(q, cid, bids)` and `bidderPartyId: state.bidder.partyId`;
      - the PDF route contains `portalBidPdfSource(q, session.customerId, bids)`, `maxDuration = 60`, and its existing customer strings;
      - the photo route contains `portalOnlineEstimateState(q, session.customerId, bids)`.
  13. **Choke-point inventory** (source scan of every `src/app/portal/**/*.{ts,tsx}`):
      - a file calling `getQuote(` must contain `portalBidRowsFor(`, unless it is on an explicit list of none today;
      - no file imports `@/lib/stores/parties`, `@/lib/stores/bids` or `@/lib/parties/addressee-server`;
      - `src/lib/portal-quotes.ts` and `src/lib/portal-service-quotes.ts` still gate every quote with `portalListsQuote(` (count unchanged: 4 and 1).
      - Update the #293t pins at ~49277 and ~49286.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run** the gates plus `npm run build`.
- [ ] **Step 4: Commit.** `feat(348): portal — a bidder company opens its own addressed revision and PDF through the portal gate; losing, withdrawn and unsent are refused`

---

### Task 3: The owner's portal on a bid estimate: BOM only, no prices (Jeff 2026-10-15)

**Jeff's rule.** Once an estimate has bidders, the owner's portal shows it as a bill of materials with **no price on anything**: before the award and after it, for good. There is no PDF (nothing priced can leak) and no Accept. **Portal only.** Staff can still email the owner a priced copy or client link from Send & track, and the owner's v1 and v2 client links are unchanged.

**Definitions:**
- **"Has bidders":** the quote has at least one `record_parties` row with `recordType "quote"`, `recordId === q.id`, role `gc` or `ec`, and `bid` set, whatever the result (withdrew, lost and so on all count).
- **Owner:** `q.customerId === cid`.

**Files:**
- Modify `src/lib/parties/portal-bid.ts`: pure `quoteHasBidders(rows)`.
- Modify `src/lib/parties/portal-bid-server.ts`: `portalQuoteHasBidders(q)` makes one indexed `listFor("quote", q.id)` read and takes no cid. Also `portalBidderQuoteIds(quoteIds)`, one bounded `listDocsWhere("record_parties", …)` over those ids, for Home.
- Modify `src/lib/quote-pdf/portal-access.ts`:
  - `portalOnlineEstimateState(q, cid, bids, { hasBidders })`. When `cid` is the customer and `hasBidders`, an ok state carries `bomOnly: true`. The revision choice is unchanged (the owner's latest sent).
  - `portalQuotePdfSource` and the PDF route refuse when `hasBidders`.
  - The function's existing callers that pass no option keep today's answer. Every portal route passes `hasBidders` explicitly (pinned).
- Modify:
  - `src/app/portal/quotes/[id]/page.tsx`: a `bomOnly` branch renders the new BOM view.
  - `src/app/portal/quotes/[id]/pdf/route.ts`: owner + `hasBidders` → 404 "Not found".
  - `src/app/portal/page.tsx` + `quote-row.tsx`: the owner's row on a bid estimate.
  - The portal write actions.
- Create `src/app/portal/quotes/[id]/bom-view.tsx`, a server component.

**Produces:**
- **The BOM view.**
  - Header: estimate name and number, Rev N, sent date, and "Prepared for <owner company>".
  - Then one block per printed system, built from the chosen revision's frozen sections with `packageBomRows` (`src/lib/estimate-output/bom.ts`; `PackageBomRow` has no money field). Columns: Qty · Manufacturer · Model · Description.
  - There are no totals, prices, alternates' prices, option prices, Rewards line, Accept, PDF link, cut sheets or datasheets.
  - One muted line at the top: `"Pricing for this project comes from your contractor."` (`PORTAL_BID_COPY.ownerBomNote`).
  - Catalog lookups for Manufacturer / Model use the same `packageBomSkus` + catalog read the package page uses (find it in `package-loader.ts`; reuse, don't copy).
- **Home row.** A `bomOnly` owner row:
  - shows the name, number, Rev and sent date, and a chip `PORTAL_BID_COPY.ownerChip = "Scope only"`;
  - has **no value** and no Accept, Refresh pricing, Decline note, PDF link, Copy or Quote again;
  - links to the BOM view.

  Rows without bidders are byte-identical to today. Implement it as a small `bomOnly` prop or a sibling row component; don't fork `PortalQuoteRow`'s money logic.
- **Writes refuse server-side** for the owner when `portalQuoteHasBidders(q)`: `acceptPortal`, `refreshPortalQuote`, `copyToCart`, and any decline or response action the owner's portal row exposes. They return `PORTAL_NOT_FOUND_COPY`, the uniform answer. Staff-side Approve / Decline (the Estimator Portal panel) is unchanged.

- [ ] **Step 1: Failing checks** (`portalBidDbChecks`, extended; the pure parts go in `portalBidPureChecks`).
  - **Pure:**
    - `quoteHasBidders` is true for any gc or ec row with `bid` set, any result. It is false for owner, architect and vendor rows, for a gc row with `bid: null`, and for another quote's row.
    - For the customer with `{ hasBidders: true }`, `portalOnlineEstimateState` gives ok with `bomOnly` true. Without bidders it deep-equals today's answer on the sent, draft, won and lost matrix.
  - **DB:** the owner of `iq`, which has bidders:
    - the page state is `bomOnly`;
    - the PDF source is null and the route returns 404;
    - `acceptPortal`, `refreshPortalQuote` and `copyToCart` return `PORTAL_NOT_FOUND_COPY`;
    - the BOM rows built for the view have no key other than the `PackageBomRow` fields. Assert `Object.keys` for every row.
  - **Unchanged without bidders:** a second owner quote with no bidders behaves exactly as today. Accept still works there (the existing happy path).
  - **Pins:**
    - `bom-view.tsx` imports `packageBomRows`, and contains no `money(`, `fmt(`, `QuoteDocument`, `AcceptDialog` or `pdf`.
    - The page's `bomOnly` branch renders `<BomView` and not the priced document.
    - The PDF route checks `portalQuoteHasBidders(`.
    - Each listed action file contains `portalQuoteHasBidders(`.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run** the gates plus `npm run build`.
- [ ] **Step 4: Commit.** `feat(348): owner's portal on a bid estimate — BOM only, no prices, no PDF, no Accept (Jeff)`

---

### Task 4: Portal Home: the Bids card and the read-only row

**Files:**
- Create `src/app/portal/bid-row.tsx`.
- Modify `src/app/portal/page.tsx`: load in the existing `Promise.all`, and add the card above "Your quotes & estimates" (~:509).
- Modify `scripts/smoke-routes.ts` and `scripts/test-bids.ts` (pins in `portalBidPureChecks`).

**Produces:**
- `page.tsx`:
  - `portalBidRowsForCompany(cid)` joins the `Promise.all`. In a preview the rows are still read, because the preview shows exactly what that company sees.
  - `const bidGroups = portalBidList(quotes, cid, bidRows);`.
  - The card renders only when `bidGroups.open.length + bidGroups.history.length > 0`:
    - heading `PORTAL_BID_COPY.card`;
    - sub `PORTAL_BID_COPY.cardSub(companyName)`;
    - groups "Open" and "History", using the page's `GROUP_HEAD` and `CARD` styles.
- `PortalBidRow({ q, bid, closed, cid, preview })`, a server component:
  - **Title.** `bid.rev.name` (never the live `q.name`), linked to `/portal/quotes/<id>` (`prefetch={false}`, `?preview=` kept).
  - **Meta.** `displayQuoteNumber(q) · Rev N · sent <date>` (`onlineHeaderLine(q, bid.rev)`).
  - **Value.** `money(bid.rev.value)`.
  - **Chips.** `Chip` with `PORTAL_BID_COPY.badge` (accent ink), and the status chip from `portalBidChip(q.status, bid)`.
  - **PDF.** "Open PDF ↗" → `/portal/quotes/<id>/pdf` (+ `?preview=`).
  - **Not rendered:** `AcceptDialog`, `RefreshPricingButton`, `RenameQuote`, `copyQuoteToCart`, "Quote again" and the decline note.
  - It reuses `Chip`, `money` and `fmtDate` from `./quote-row`. It does not change `quote-row.tsx`.
- Smoke routes, all 200 cards with no seeded bids, which compile the page and the bidder branch:
  - `"/portal?preview=northridge"`;
  - `"/portal/quotes/Q-2041?preview=northridge"` (another company's quote → the unavailable card through the bidder branch).

- [ ] **Step 1: Failing checks** (pins).
  - `bid-row.tsx`:
    - has no `"use client"`;
    - does not contain `AcceptDialog`, `RefreshPricingButton`, `RenameQuote`, `copyQuoteToCart` or `Quote again`;
    - contains `bid.rev.name`, `bid.rev.value` and `PORTAL_BID_COPY.badge`;
    - imports nothing from `@/lib/stores/parties`, `@/lib/stores/bids` or `-server`.
  - `page.tsx` contains `portalBidRowsForCompany(cid)` and `portalBidList(quotes, cid, bidRows)`, and still `homePortalQuotes(quotes, cid)` (the #288 pin).
  - The smoke file contains both new routes.
  - Pure: `portalBidList` output items carry only `{ q, bid, closed }` (no party list).
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run** the gates plus `npm run build`, plus `npm run test:smoke` (the two new routes).
- [ ] **Step 4: Commit.** `feat(348): portal Home — a Bids card for bidder companies (Bid badge, due date, their PDF, no Accept)`

---

### Task 5: Pure Bids-by-GC/EC aggregation

**Files:**
- Create `src/lib/parties/bid-report.ts`.
- Modify `scripts/test-bids.ts`: add `bidReportPureChecks`, in the runner and chained after `portalBidDbChecks`.

**Produces:**

```ts
export type BidReportInput = {
  party: Pick<Party, "id" | "companyId" | "role" | "recordId" | "bid">;
  quote: Pick<Quote, "id" | "status" | "bid"> | null;   // null = the quote is gone (orphan row) → skipped
};
export type BidReportRow = {
  companyId: string; name: string; role: "gc" | "ec";
  /** delivered: bid.revSent is a number (email or website) */ sent: number;
  /** sent and result pending */ open: number;
  /** spec "GC awarded": sent and result awarded | lost */ decided: number;
  /** sent and result awarded — the work came to us through this company */ awarded: number;
  /** sent and result withdrew | no_bid */ out: number;
  /** awarded ÷ decided, %, rounded; null when decided = 0 */ rate: number | null;
  lastSentAt: number | null;
};
/** The date a bid falls on for the period: the estimate's bid due date, else the row's last send. null = skipped. */
export function bidReportAnchor(q: Pick<Quote, "bid">, bid: BidderState): number | null;
/** One row per (company, role) with ≥ 1 sent bid anchored in [start, end); a total row over all of them ("All GCs and ECs",
 *  role from the rows only for display). Sorted sent desc, then name. Names from `names`, else "Unknown company". */
export function bidsByBidder(inputs: readonly BidReportInput[], names: ReadonlyMap<string, string>, period: { start: number; end: number }): { rows: BidReportRow[]; total: Omit<BidReportRow, "companyId" | "role"> & { companies: number } };
export const BID_REPORT_COPY = {
  title: "Bids by GC/EC",
  sub: "Bids we sent each general and electrical contractor in this period — how many were decided and how often the award came to us",
  cols: ["Company", "Role", "Sent", "Open", "GC awarded", "Awarded to us", "Withdrew / no bid", "Awarded-to-us rate", "Last sent"],
  empty: "No bids sent in this period.",
  total: "All GCs and ECs",
} as const;
```

- [ ] **Step 1: Failing checks.**
  - **Matrix** over 7 inputs across 3 companies:
    - a GC with 3 sent bids (awarded, lost, pending) → sent 3, open 1, decided 2, awarded 1, rate 50;
    - an EC with a sent no_bid and an unsent pending → sent 1, out 1, decided 0, rate null;
    - the same company as GC and EC → two rows.
  - **Excluded:** an orphan (`quote: null`), a row with `bid: null`, an owner or vendor role, and an unsent awarded row (it counts nowhere; it is impossible in the app but must not inflate the rate).
  - **Period.**
    - The anchor uses `q.bid.dueAt` over `sentAt`.
    - A row with no due date uses `sentAt`.
    - The start is inclusive and the end exclusive.
  - **Total row:** summed counts; the rate is recomputed from the sums, not averaged.
  - `lastSentAt` is the max.
  - **Sort:** sent descending, then name.
  - **Boundary:** pure.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run** the gates.
- [ ] **Step 4: Commit.** `feat(348): Bids by GC/EC — pure per-bidder aggregation (sent, open, GC awarded, awarded to us, rate)`

---

### Task 6: Report loader and the widget

**Files:**
- Create `src/lib/parties/bid-report-server.ts` and `src/app/(app)/_dashboard/widgets/bids.tsx`.
- Modify:
  - `src/lib/dashboard/registry.ts`;
  - `src/lib/dashboard/data.ts`;
  - `src/app/(app)/_dashboard/renderers.ts`;
  - `scripts/test-bids.ts` (`bidReportDbChecks`, chained).

**Produces:**
- `loadBidReportData()`:
  - Query:
    ```ts
    listDocsWhere<Party>("record_parties", { all: [{ path: ["recordType"], is: "quote" }, { path: ["role"], in: ["gc", "ec"] }, { path: ["bid", "revSent"], filled: "text" }] }, { limit: BID_REPORT_MAX })
    ```
    with `BID_REPORT_MAX = 5000`.
  - Then `getMany([...quoteIds])` and `getCompanies([...companyIds])`.
  - Returns `{ inputs, names, truncated: rows.length === BID_REPORT_MAX }`.
  - Only bidder rows are read; there is no full quote scan.
- `data.ts`: `bidReport: once(loadBidReportData)`.
- Registry:
  - `const REPORTS: readonly Surface[] = ["reports"];`
  - the entry, after `pipeline-by-estimator`:
    ```ts
    { id: "bids-by-bidder", title: "Bids by GC/EC", desc: "Bids sent per GC and EC, decided, and the awarded-to-us rate.", size: "full", timeframe: "history", surfaces: REPORTS }
    ```
  - **No `perm`.** Reports is `requireUser`, team-only; the bid list is staff-only by being on a team page.
  - Added to `PRESETS.reports` right after `"pipeline-by-estimator"` (Open question 11). A user with a saved layout is unaffected and can add it from the gallery.
- `widgets/bids.tsx`:
  - `BIDS_RENDERERS = { "bids-by-bidder": async (ctx) => … }` with `periodBounds(ctx.range, ctx.now)` for `[start, end)`.
  - The `pipeline-by-estimator` card and grid style (`pk-card`, a 9.5 px uppercase header row, monospace numbers).
  - Company names link to `/companies/<id>`.
  - The role shows as `ROLE_SHORT`.
  - The rate shows as `—` when null.
  - The last-sent date uses `chicagoShortDate`.
  - The total row is last, in bold.
  - When `truncated`, a muted note "Showing the first 5,000 bids.".
- `renderers.ts`: spread `...BIDS_RENDERERS`. `Record<WidgetId, …>` makes tsc enforce it.

- [ ] **Step 1: Failing checks.**
  - **DB** (`bidReportDbChecks`), with fixtures `TEST348:ir…` (companies) and quote `irq` with due date `T`:
    - two bidders, sent and awarded/lost via `awardBid`, and one unsent;
    - `loadBidReportData()` → inputs include the 2 sent rows and not the unsent one;
    - `bidsByBidder(…, { start: T − 1 day, end: T + 1 day })` gives the awarded company `awarded 1, rate 100`, and the other `decided 1, awarded 0, rate 0`;
    - a period that excludes `T` → no rows.
  - **Renderer.** `await BIDS_RENDERERS["bids-by-bidder"](fakeCtx)` with `fakeCtx.data.bidReport` stubbed returns an element without throwing. Render it with `renderToStaticMarkup`, as other harness blocks do: it contains "Bids by GC/EC", the company name, and "50%".
  - **Pins.**
    - The registry entry has `surfaces` `["reports"]`, no perm and timeframe `history`.
    - `presetFor("reports", ["Admin"])` includes `bids-by-bidder` right after `pipeline-by-estimator`.
    - `presetFor("home", …)` is unchanged (the #43 regression test still passes).
    - `bid-report-server.ts` uses `listDocsWhere("record_parties"` and never `getAll`.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run** the gates plus `npm run build`, plus `npm run test:smoke`. `/reports` now renders the widget through the preset.
- [ ] **Step 4: Commit.** `feat(348): Reports — Bids by GC/EC widget (bounded bidder-row query, Sales period)`

---

### Task 7: Docs, gates, browser pass

- [ ] **Recompute numbers from `origin/main` right before writing.** Today the DECISIONS max is D1157, so the next is D1158, but re-check. Also re-check the PUNCHLIST `## 348.` header (`:12392`) and AGENTS item 62 (`:1420`). Write these decisions:
  1. **The portal bidder rule.** It covers companies with a bidder row on the quote and a delivered (`revSent`) sent revision, or a sent revision frozen as addressed to them. The bidder's result must be pending or awarded; withdrew, no_bid and lost are hidden. Once a bid is awarded, only the awarded row counts. Status rules:
     - draft → being revised (not listed);
     - won → the awarded bidder only;
     - lost → closed.
  2. **One gate.** `portal-access.ts` composes the bidder rule into `portalOnlineEstimateState` (rows passed; omitted rows mean unavailable). Customer rules are unchanged, and every portal write action stays customer-only (`portalListsQuote`). `portal-bid-server.ts` is the only portal reader of `record_parties` (pinned inventory).
  3. **Their copy.** The online page is addressed strictly to the bidder. The PDF is rendered on demand at the bidder's revision (`renderBidderPdf` with rev). It is named after the revision, limited to 6 per minute per grant, and never a later revision.
  4. **Read-only.** There is no Accept, Refresh, Rename, Copy or Quote again. The v3 link stays the bidder's response channel. Portal views aren't counted as opens.
  5. **The report's definitions.** Sent = delivered. Decided ("GC awarded") = awarded + lost. Rate = awarded ÷ decided. Withdrew and no-bid are counted apart. The anchor is the due date, else the last send. One row per company and role. Reports-only, no perm, in the reports preset.
- [ ] **PUNCHLIST #348.**
  - Header: slices 1–6 built.
  - Jeff-gated: the Open questions below.
  - Prod checks:
    - a GC grant on a real bid;
    - the portal PDF render latency on Vercel (≤ 60 s);
    - an awarded GC's portal after a post-award send.
- [ ] **AGENTS item 62.**
  - Rename it to "slices 1, 2a, 2b-i, 2b-ii, 3, 4, 5 + 6" and add the D-range.
  - Add a slice-6 paragraph: the portal bidder rule, the one-gate pin, render-on-demand PDFs, the report and its definitions, and tests in `scripts/test-bids.ts`.
- [ ] **Gates.**
  - `npx tsc --noEmit`;
  - `npx tsx scripts/test-bids.ts`;
  - `npm run test:specs 2>&1 | tee /tmp/claude-501/specs-348-s6.log` (ALL PASSED);
  - eslint on every touched file;
  - `npm run build`;
  - `npm run test:smoke` (the new routes: `/portal?preview=northridge` and `/portal/quotes/Q-2041?preview=northridge`, plus `/reports`).
- [ ] **Browser pass on a scratch datadir, run by the controller** (dev login; never the real `.data/pglite`).
  1. **Staff setup.**
     - Create an owner company and three GC companies, each with a contact with an email.
     - On an estimate for the owner, add the three as bidders; set a due date.
     - Mark GC-C (website) submitted; Gmail is likely off, so email sends save locally and still stamp `revSent`.
     - Send to all bidders, or Mark submitted for each.
  2. **Bidder portal via team preview** (the dev portal path, `resolvePortalViewer`): open `/portal?preview=<GC-A id>`.
     - The Bids card shows the estimate with the Bid badge and "Due …".
     - There is no Accept and no Refresh.
     - The title opens the online estimate "Prepared for GC-A" with Owner: <owner> and no other GC named.
     - Open PDF returns 200 when Chrome is available locally; otherwise note the 503 text and cite DB check Task 2 #10.
  3. **Real grant.**
     - On GC-A's company page, Customer portal → add a person → Copy link.
     - Open `/portal/access?t=…` in the pane: the same view without `?preview`.
  4. **Refusals.**
     - Withdraw GC-B: `/portal?preview=<GC-B>` has no Bids card, and `/portal/quotes/<id>?preview=<GC-B>` shows "This estimate isn't available online."
     - An unrelated company: the same.
  5. **Award GC-A.**
     - GC-C's portal no longer lists it.
     - GC-A's does.
     - The owner's portal (`?preview=<owner>`) still lists it, as **Scope only**: no value, no PDF, no Accept. Opening it shows the BOM with no prices. An owner estimate with no bidders still shows its price and Accept.
  6. **Revising.** Add an addendum, which moves the quote back to Draft. GC-A's Home drops it, and its page shows the being-revised card.
  7. **Reports.** `/reports` shows Bids by GC/EC. The rows have the right counts after the award; Quarter, 6 months and 12 months change the window; the rate shows "—" with nothing decided.
- [ ] **Commit docs.** `docs(348): slice 6 — portal bidder view and Bids by GC/EC decisions, punch, phase 62`

---

## Jeff's answers (2026-10-15, before the build)

- Q1 rate: **awarded ÷ decided** (the default).
- Q4 revisions: **only their latest** (the default).
- Q5 a Lost estimate: **stays visible as "Closed"** to pending and awarded bidders (the default).
- Q8 the owner's portal: **changed**. Once an estimate has bidders, the owner's portal shows it as a **BOM with no prices**, always (before and after the award), with **no PDF** and no Accept. This is **portal only**: Send & track and the owner's client links are unchanged. That is the new Task 3.
- Q2, Q3, Q6, Q7, Q9–Q14 are still open; the plan's defaults stand and are logged as decisions.

## Open questions for Jeff (defaults the plan uses until answered)

1. **"Awarded-to-us rate".** Default: per GC or EC, awarded ÷ (awarded + lost). That is, of the bids through this company where the GC award is known, how often the work came to us. Alternatives: awarded ÷ sent; or Won estimates (status won) through them ÷ decided.
2. **Withdrew and no-bid.** Default: if they were delivered, they count in **Sent**. They show in their own column and are left out of decided and the rate. In the portal they are hidden entirely.
3. **The report's date.** Default: the bid's due date, else the bidder's last send. Note that `sentAt` moves forward on each revision send; there is no first-sent date.
4. **Rev history.** Default: a bidder sees only one revision, the latest one delivered or addressed to them. This matches the owner's portal, which shows only the latest sent revision.
5. **Closed bids.** Default:
   - an estimate marked Lost stays visible to pending and awarded bidders as **Closed**;
   - an estimate marked Won with no award recorded is hidden from every bidder.
6. **Revisions sent after the award.** Default: a sent revision frozen as addressed to the awarded bidder counts as theirs, even if Send & track's To was changed to someone else.
7. **The PDF.** Default: re-rendered on demand at their revision. The content is identical, but it uses the bidder's current contact name. Alternative: serve the exact emailed file. That means storing its path on the bidder row at send, and website rows have no stored file today.
8. **The owner's portal on a bid estimate.** It still offers **Accept**, which is existing behaviour since slice 2. Should Accept be hidden for the owner once an estimate has bidders, and should the owner's row get the Bid badge? Default: unchanged, since the spec says the owner's portal keeps it.
9. **Portal views as opens.** Should portal views count as "Opened" on the Bidders card? Default: no, since owner portal views don't count either.
10. **The awarded bidder's project.** Should the awarded bidder's portal also list the project, where they are the Bill to? Default: not in this slice.
11. **The default layout.** Should the Reports widget be in the default Reports layout? Default: yes, after Pipeline by estimator. A saved layout is unaffected. Alternative: a gallery pick only.
12. **A v3 link inconsistency (from 2b-ii).** An old v3 link offers "View the current version", which is that bidder's v3 at the **latest** sent revision, even if it was never sent to them. The portal never does this. Should the link match? Default: leave the link as is (out of scope).
13. **Website submissions made in Draft.** `markSubmitted` stamps `currentRev`. On a never-sent estimate that is not a sent revision, so the bid stays hidden from the portal until a revision is sent. After a recall to Draft it is the last sent revision, which may not be the file they uploaded. Acceptable?
14. **The due date shown.** Default: as printed on their revision. Alternative: the live due date.

## Risks and how this plan contains them

- **A missed call site leaks a quote.** The bidder rule needs explicit rows, and the default `[]` is unavailable. A source inventory pins every `getQuote(` under `src/app/portal/` to `portalBidRowsFor(`, and bans direct parties and bids store imports there.
- **Read-only bypass through a server action.** Every portal write already gates on `portalListsQuote` (customerId only), and DB checks call each action with a bidder session.
- **A later or unsent revision.** The state picks only `revSent` or award-addressed **sent** revisions. `renderBidderPdf` re-checks that the rev is a sent revision. The page loader is strict (`bidderPartyId`, null when there is no valid row).
- **Naming other bidders.** The document addressee is strict for the bidder, the doc props are checked for other companies' names, and the copy is pinned free of "lost" and counts.
- **Render cost.** Renders are on demand, 6 per minute per grant, and the route has `maxDuration = 60`. Customer PDFs still stream stored copies.
- **Pins in other suites.** The #293t page and photo pins are updated in Task 2. The #222 and #223 PDF-route strings are preserved because the customer code is untouched. The #43 home preset is unchanged.

## Self-review notes

- **Spec §5 Portal:**
  - grant → read-only list ✓ (T2, T3);
  - Bid badge, due date, their PDF, no Accept ✓ (T3, T2);
  - leaves losing bidders after award ✓ (T1, T2 #5);
  - the awarded bidder sees it addressed to them ✓ (T1 award candidates, T2 #6);
  - the owner's portal keeps it ✓ (T2 #5).
- **§4 Reports:** Bids by GC/EC with sent, GC awarded and awarded-to-us rate ✓ (T4, T5).
- **§8:** bidder lists staff-only ✓ (no portal surface lists bidders; the report is team-only).
- **§9:** pure modules in `test:specs`, new routes in smoke ✓.
- **Not built:** portal responses or actions for bidders, bidder project listing, stored emailed-copy serving, owner Accept changes.

### Critical Files for Implementation
- /Users/sm/Downloads/peak-app/.claude/worktrees/parties/src/lib/quote-pdf/portal-access.ts
- /Users/sm/Downloads/peak-app/.claude/worktrees/parties/src/app/portal/quotes/[id]/pdf/route.ts
- /Users/sm/Downloads/peak-app/.claude/worktrees/parties/src/app/portal/quotes/[id]/page.tsx
- /Users/sm/Downloads/peak-app/.claude/worktrees/parties/src/app/portal/page.tsx
- /Users/sm/Downloads/peak-app/.claude/worktrees/parties/src/lib/dashboard/registry.ts
