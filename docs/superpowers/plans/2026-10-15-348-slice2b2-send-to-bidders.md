# #348 Slice 2b-ii: Send to bidders, client link v3, revision re-send (implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each bidder gets its own email from the sender's Gmail. The email carries a PDF addressed to that bidder and a client link (v3) that only that bidder holds. The Bidders card can Send / Retry one row, run **Send to all bidders** or **Send revision to bidders** one row at a time with progress, Copy a bidder's link, and show "Opened N×". A v3 link opens the package addressed to its bidder. Its opens count on that bidder's row, and any response it sends is tagged with the bidder. Revoke kills it together with the owner's links.

**Architecture:**
- **Shared send pipeline.** `sendBidderEmail` lives in `src/lib/estimate-email/send-server.ts`. It reuses the same ordered steps as `sendEstimateEmail`: `preflight` → `withClaim` → `prepareClaimed` → `markAndLink` → `threadSpecFor` → `createAndSendThread`. Two internals get one optional hook each:
  - `prepareClaimed(…, more?)` renders the bidder PDF inside the "attachments before anything is marked" window.
  - `markAndLink(…, linkFor?)` mints the v3 link after the revision is known.
  Bidder-only side effects are new deps on `BidderEmailDeps = EstimateEmailDeps & {…}`. The existing deps type and its harness fakes stay unchanged.
- **Bidder state writes.** Bidder state is written only by new store functions in `src/lib/stores/bids.ts`. Each runs under `withQuoteRowLock`, and the email record plus the row stamp are one transaction.
- **v3 token.** A new token shape in `src/lib/quote-share/token.ts`, accepted everywhere v2 is (`isPackageToken`). `resolveSharedPackage` returns an optional `bidder`.
- **Bidder PDF source.** On a sent quote the bidder PDF renders from the latest SENT revision (a new `&rev=` print variant). On a draft it renders the live quote, which the first send then cuts as the new revision.
- **The walk.** The browser walks bidders with one server call per row. The per-quote claim keeps it to one send at a time.

**Spec:** `docs/superpowers/specs/2026-10-14-estimate-parties-and-bids-design.md`:
- §5: send to all, website rows, revisions, client link v3.
- §3.3: `BidderState`.
- §3.4 (revised): the owner stays the customer; the awarded bidder is the addressee.

Out of scope: portal (slice 6), Reports, AI, and Activity card changes beyond tagging.

**Prerequisite (met — commit 98dddead):** the 2b-i review fix. It adds:
- `QuoteRevisionDocFields.awardedPartyId` / `.bid`.
- `revisionAddressee` in `document-loader.ts`.
- `addresseeContact` / `awardedRecipient` / `touchAwardedAddressee`.
- `touchQuoteContent`.
- the package "Owner:" meta.

This plan builds on all of it. Task 3 generalizes `awardedRecipient`.

## Global Constraints

- **Worktree and git.**
  - Worktree `/Users/sm/Downloads/peak-app/.claude/worktrees/parties`, branch `feat/348-estimate-parties`.
  - Never `git stash`. Never `git add -A`: `.superpowers/sdd/task-4-report.md` is tracked, so stage explicit paths.
  - Commit trailer exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Node: `export PATH="$HOME/.local/node/bin:$PATH"` if missing.
- **Fixtures.** Use `fixtureId(348, …)` with slug prefix **`e`** for this slice (`TEST348:e…`). The identity teardown deletes `like(…, "TEST348:e%")` only.
- **The owner stays the customer.** Nothing here writes `customerId`, `customer`, `contactName`, `locationId`, `pricingTier` or `tierMargin`. A bidder email's thread is filed under the bidder company (`customerId` = the bidder's `companyId`) but linked to the quote.
- **Lock order.**
  - Every bidder-state write takes the quote ROW lock first (`withQuoteRowLock`), then reads the party, then `setPartyBid`.
  - The send pipeline never holds the row lock across the render or Gmail. It holds only the store-owned `Quote.emailSending` claim.
- **Revision numbering (D-next-4).**
  - `currentRev(q)` becomes "the `rev` of the latest SENT revision; before any send, `max(1, revisions.length)`".
  - An email stamps `revSent = m.rev.rev` (the sent revision the email carried, read after `markAndLink`).
  - On a `draft` quote every pending email row needs the send, because the send cuts a new revision.
  - On a `sent` quote a row needs it iff `revSent == null || revSent < latestSentRev`.
  - The PDF's printed "Rev N" still follows D567 and may read lower on a re-send. The card, file name and subject use `rev`.
- **Permissions.**
  - Emailing a bidder needs `can("send") || can("approve")` (the pipeline's own rule).
  - Copy link needs `can("send")` (the Client link rule).
  - Panel reads need `requireUser()`. Bidder edits keep `can("create")`.
- **Imports.** Client components never import `src/lib/stores/*`, `@/db`, `node:*` or server-only modules (`addressee-server`, `bid-panel-server`, `send-server`, `links`, `token`).
- **Time budget.** Each bidder send runs under the Estimator page's `maxDuration = 120` and the 120 s claim:
  - bidder render ≤ `COVER_RENDER_DEADLINE_MS` (55 s)
  - Gmail send ≤ 20 s (`gapi` timeout) plus token refresh
  - mark sent + the revision PDF copy (first call only)
  - reads
  Expect about 85 s at worst. Never render or send more than one bidder per call.
- **Gates.**
  - tsc clean.
  - `npx tsx scripts/test-bids.ts` 0 FAIL (pure + fake-deps halves).
  - `npm run test:specs` ALL PASSED for tasks touching harness / DB code.
  - eslint 0 errors on touched files.
  - `npm run build` in Tasks 5, 8 and 9.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/parties/bids.ts` (modify) | `currentRev` redefinition; `bidderSentState`, `bidderFailedState`, `nextBidderOpens`, `bidderOpensText/Title`; `bidderStatusText` (email vs website wording, "Send failed"). |
| `src/lib/parties/rules.ts` (modify) | `BidderState.failed.unknown?`, `BidderState.opens?`. |
| `src/lib/parties/bid-send.ts` (new, pure) | `BID_SEND_COPY`, `latestSentRev`, `bidderPdfRev`, `bidderEmailNeed`, `bidderSendPlan`, `bidderAlreadyHas`, `addendaSinceRow`, `addendaAfterLatestSend`, `bidderSubject`, `bidWalkSummary`, `isPartyId`. |
| `src/lib/estimate-email/compose.ts` (modify) | `bidderEmailDefaults`, `isBidderFileName`, `bidderFileOf`. |
| `src/lib/quote-share/token.ts` (modify) | v3: `SHARE_TOKEN_V3_RE`, `signShareTokenV3`, `verifyShareTokenV3`, `parseShareToken` v3, `isPackageToken`. |
| `src/lib/quote-share/package-view.ts` (modify) | `PACKAGE_COPY.bidClosed`, `bidderCanAct`, `packageBanner(…, bidClosed)`. |
| `src/lib/estimate-output/responses.ts` (modify) | `ClientResponse.partyId?`; `responseOf` keeps it; bidder-naming note/task text; `responseRows(…, bidderNameOf?)`. |
| `src/lib/stores/quotes.ts` (modify) | `EstimateEmailEntry.partyId?`; `recordEstimateEmail` keeps a valid one. |
| `src/lib/stores/bids.ts` (modify) | `recordBidderSend`, `markBidderSendFailed`, `recordBidderOpen`. |
| `src/lib/parties/addressee-server.ts` (modify) | `bidderRecipient(party)`; `awardedRecipient` uses it. |
| `src/app/print/quote/[id]/page.tsx` (modify) | `&rev=` bidder variant (token id `${id}~${partyId}~r${rev}`), renders `quoteAsOfRevision`. |
| `src/lib/quote-pdf/bidder-pdf-server.ts` (modify) | `renderBidderPdf(…, opts: { rev })`. |
| `src/app/api/quotes/[id]/bidder-pdf/[partyId]/route.ts` (modify) | Renders `bidderPdfRev(q)`. |
| `src/app/api/quotes/[id]/pdf/route.ts` (modify) | Serves a stored `?file=bidder-…pdf`. |
| `src/lib/quote-share/links.ts` (modify) | `SharedBidder`, `SharedPackage.bidder?`, `bidderSharePath`, `bidderLinkPath`, v3 in `resolveSharedPackage`, bidder branch in `recordSharedOpen`. |
| `src/lib/quote-pdf/document-loader.ts`, `src/lib/estimate-output/package-loader.ts`, `src/lib/estimate-output/package-model.ts` (modify) | `bidderPartyId` (strict addressee), `bidClosed` banner. |
| `src/app/share/quote/[id]/[token]/page.tsx`, `package-page.tsx`, `datasheets.pdf/route.ts`, `package.zip/route.ts`, `doc/[docId]/route.ts`, `file/[fileId]/route.ts`, `photo/[docId]/route.ts` (modify) | `isPackageToken`; bidder-aware `canAct`. |
| `src/lib/estimate-output/responses-server.ts`, `src/lib/estimate-output/package-panel-server.ts` (modify) | Tag + name the bidder. |
| `src/lib/estimate-email/send-server.ts` (modify) | `sendBidderEmail`, `BidderEmailDeps`, `liveBidderEmailDeps`; the two optional hooks. |
| `src/lib/estimate-email/request-where.ts`, `src/lib/estimate-email/sender-mailbox.ts` (new, server-only) | Extracted from `send-actions.ts` so both action files share one rule. |
| `src/lib/parties/bid-panel-server.ts` (new, server-only) | `loadBidPanel` (moved from `bid-actions.ts`), plan / link / opens fields. |
| `src/lib/parties/bid-vm.ts` (modify) | VM additions; `BidPanelResult` moves here. |
| `src/app/(app)/estimator/bid-send-actions.ts` (new, `"use server"`) | `sendToBidderAction`, `bidderEmailDefaultsAction`, `bidderLinkAction`. |
| `src/app/(app)/estimator/bid-actions.ts`, `send-actions.ts` (modify) | Use `loadBidPanel` / the extracted helpers. |
| `src/app/(app)/estimator/steps/bidders-card.tsx`, `bidder-row.tsx` (modify), `bidder-send-panel.tsx` (new), `send-step.tsx` (modify) | UI. |
| `scripts/test-bids.ts` (modify), `scripts/test-review-and-spec.ts` (modify) | `bidSendChecks` (pure), `bidSendFakeChecks` (fake deps), `bidSendDbChecks` (DB); chained after `bidDbChecks`. |
| `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md` | Docs. |

---

### Task 1: Pure bidder-send rules

**Files:**
- Modify `src/lib/parties/bids.ts`, `src/lib/parties/rules.ts`, `src/lib/estimate-email/compose.ts`.
- Create `src/lib/parties/bid-send.ts`.
- Modify `scripts/test-bids.ts`:
  - add `export async function bidSendChecks(ok: Ok)` and call it from the file's own runner after `bidChecks`;
  - in `scripts/test-review-and-spec.ts` chain `.then(() => bidSendChecks(ok))` right after `.then(() => bidDbChecks(ok))`.

**Produces:**

`rules.ts` changes to `BidderState`:
- `failed?: { at: number; error: string; unknown?: boolean } | null`
- add `opens?: { count: number; lastAt: number } | null`

`bids.ts`:
- `currentRev(q: { revisions?: unknown[] | null }): number`. Walk `revisions` from the end. The first entry that is an object with `reason === "sent"` and a safe-integer `rev` returns that `rev`. Otherwise return `Math.max(1, q.revisions?.length || 1)`. Inline the loop; do not import `quote-pdf/state` here, to keep `bids.ts` import-light.
- `bidderSentState(bid: BidderState, rev: number, by: string, threadId: string, at: number): BidderState` returns `{ ...bid, revSent: rev, sentAt: at, sentBy: by, threadId, failed: null }`.
- `bidderFailedState(bid: BidderState, f: { at: number; error: string; unknown?: boolean }, threadId?: string | null): BidderState`. It sets `failed: { at, error: error.slice(0, 300), ...(unknown ? { unknown: true } : {}) }`, sets `threadId` only when given, and leaves `revSent` / `sentAt` untouched.
- `nextBidderOpens(prev: unknown, now: number): { count: number; lastAt: number } | null`:
  - returns null when `now` is not finite or ≤ 0;
  - a malformed `prev` starts at `{ count: 1, lastAt: now }`;
  - otherwise `{ count: min(count + 1, 1_000_000), lastAt: max(lastAt, now) }`.
- `bidderOpensText(o): string` returns `""` or `` `Opened ${count}×` ``.
- `bidderOpensTitle(o): string` returns `""` or `` `Last opened ${chicagoShortDate(lastAt)}, ${chicagoTime(lastAt)}` ``.
- `bidderStatusText(bid, rev)`, in this order:
  1. a result other than pending returns its label;
  2. `bid.failed && (revSent == null || revSent < rev)` returns `"Send failed"`;
  3. `revSent == null` returns `"Not sent"` (email) or `"Not submitted"` (website);
  4. `revSent < rev` returns `` `Needs Rev ${rev}` ``;
  5. otherwise `` `${website ? "Submitted" : "Sent"} Rev ${revSent}${date}` ``.

`bid-send.ts` (browser-safe; value imports only `./bids`, types only otherwise):
- `isPartyId(v: unknown): v is string`, which tests `/^pty_[0-9a-f]{16}$/`.
- `latestSentRev(q: { revisions?: unknown[] | null }): number | null`.
- `bidderPdfRev(q: { status: string; revisions? }): number | null`. Draft returns null (render live). Anything else returns `latestSentRev(q)`.
- `type SendRow = { id: string; bid: BidderState; email: string }`.
- `bidderEmailNeed(q: { status: string; revisions? }, row: SendRow): "send" | "revision" | "retry" | null`:
  - null unless status is draft or sent, the result is `pending`, `submitVia === "email"` and `email.trim()` is set;
  - on `sent` with `latestSentRev = L`, null when `revSent != null && revSent >= L`;
  - then `"retry"` when `bid.failed`;
  - else `"send"` when `revSent == null`, else `"revision"`.
- `bidderSendPlan(q, rows): { ids: string[]; label: string | null; noEmail: number }`:
  - `ids` = rows whose need is non-null and `!bid.failed?.unknown`, in input order;
  - `label` is null when `ids` is empty, `"Send revision to bidders"` when any planned row has `revSent != null`, else `"Send to all bidders"`;
  - `noEmail` counts pending email rows with a blank email (only while the status is draft or sent).
- `bidderAlreadyHas(q, bid): boolean` is `status === "sent" && L != null && bid.revSent != null && bid.revSent >= L`.
- `addendaSinceRow(q: { bid?: { addenda?: Array<{ no: number; receivedAt: number }> } | null; revisions? }, bid: BidderState): number[]`:
  - `[]` when `revSent == null`;
  - else the live addenda numbers missing from revision `revSent`'s `docFields.bid.addenda`;
  - fallback when that revision has no frozen bid: live addenda with `receivedAt > (bid.sentAt ?? 0)`;
  - sorted ascending.
- `addendaAfterLatestSend(q): number[]` returns the live addenda numbers missing from the latest SENT revision's frozen `docFields.bid.addenda`. It returns `[]` when there is no sent revision or the revision has no frozen bid.
- `bidderSubject(base: string, estimateName: string, newAddenda: number[]): string`:
  - `[]` returns `base`;
  - one number returns `` `Revised bid — ${estimateName} (Addendum ${n})` ``;
  - several return `` `Revised bid — ${estimateName} (Addenda ${list.join(", ")})` ``;
  - the result is sliced to 300 characters.
- `bidWalkSummary(s: { total: number; sent: number; failed: number; local: number; stoppedError?: string | null }): string`:
  - With `stoppedError`: `` `Stopped after ${sent} of ${total}: ${stoppedError}` ``.
  - Else, with `failed === 0`: `` `Sent to ${sent} bidder${sent === 1 ? "" : "s"}.` ``
  - Else: `` `Sent to ${sent} of ${total} bidders — ${failed} failed. Retry ${failed === 1 ? "it" : "them"} below.` ``
  - Then, when `local > 0`, append `" Saved locally — Gmail isn’t connected."`.
- `BID_SEND_COPY` (exact strings):
  - `sendAll`: `"Send to all bidders"`
  - `sendRevision`: `"Send revision to bidders"`
  - `progress: (i, n) => `Sending ${i} of ${n}…``
  - `stop`: `"Stop"`
  - `rowSend`: `"Send"`
  - `rowRevision`: `"Send revision"`
  - `rowRetry`: `"Retry"`
  - `copyLink`: `"Copy link"`
  - `noEmailChip`: `"No email"`
  - `noEmailTitle`: `"Add an email for this contact on the company page."`
  - `composeTitle`: `"Email bidders"`
  - `recipients: (names) => `To: ${names.join(", ")} (${names.length} bidder${names.length === 1 ? "" : "s"})``
  - `linkHint`: `"Keep {link} where each bidder’s own link should go."`
  - `revisedHint: (subject) => `Bidders who missed an addendum get “${subject}”.``
  - `sendN: (n) => `Send to ${n} bidder${n === 1 ? "" : "s"}``
  - `cancel`: `"Cancel"`
  - `gone`: `"That bidder wasn't found."`
  - `notPending`: `"Only a pending bidder can be emailed."`
  - `website`: `"This bidder submits through their bid website — use Download PDF and Mark submitted."`
  - `noEmail: (who) => `${who} has no email address — add one on the company page.``
  - `unknownRetry`: `"Gmail didn’t answer in time for this bidder — check your Gmail Sent folder, then Retry."`
  - `unknownConfirm: (co) => `Gmail didn’t answer in time when this went to ${co}. Check your Gmail Sent folder first — send it again anyway?``
  - `tooLarge`: `"The bidder PDF is over 15 MB — too large to email."`
  - `recordFailed`: `"Sent — but the bidder row couldn’t be updated. Check Activity before sending again."`
  - `addendumHint: (nos) => `Addendum ${nos.join(", ")} came in after the last send — move the estimate back to Draft, then Send revision to bidders.``
  - `linkCopied`: `"Link copied."`

`compose.ts`:
- `bidderEmailDefaults(i: { projectName: string; estimateNumber: string; senderName: string; signature?: string }): { subject: string; body: string }`.
  - subject: `` `Bid — ${project} (${est})` ``, or `` `Bid — ${est}` `` when the project is blank.
  - body, lines joined with `\n`:
    ```
    Hello,

    Attached is our bid for <project> (<est>).

    You can also view the full package online here: {link}

    Let me know if you have any questions.

    Thanks,
    <sender>
    ```
    The "for <project>" and "(<est>)" parts are omitted when blank. The signature is added with `withSignature(body, signature, "add")` exactly as in `estimateEmailDefaults`.
- `isBidderFileName(name: unknown): name is string`, which tests `/^bidder-([0-9a-f]{16})-r([1-9]\d{0,5})-(\d{10,16})(?:-[A-Za-z0-9]{1,64})?\.pdf$/`.
- `bidderFileOf(name): { partyId: string; rev: number } | null`, where `partyId = "pty_" + hex`.

- [ ] **Step 1: Failing tests.** Add `bidSendChecks` with these exact expectations (`R = (rev, reason) => ({ rev, reason, at: 1, by: "u" })`):
  - `currentRev`:
    - `currentRev({ revisions: [R(1,"sent"), R(2,"manual")] }) === 1`
    - `currentRev({ revisions: [R(1,"manual"), R(2,"sent"), R(3,"manual")] }) === 2`
    - `currentRev({ revisions: [R(1,"manual"), R(2,"manual")] }) === 2`
    - the 2a check `currentRev({ revisions: [1,2,3] }) === 3` still passes.
  - `bidderPdfRev`:
    - `{status:"draft", revisions:[R(1,"sent")]}` → `null`
    - `{status:"sent", revisions:[R(1,"sent"),R(2,"manual")]}` → `1`
    - `{status:"won", revisions:[R(1,"sent"),R(3,"sent")]}` → `3`
    - `{status:"sent", revisions:[]}` → `null`
  - `bidderEmailNeed` (draft, never sent; row with email `a@x.test`):
    - revSent null → `"send"`
    - revSent 1 → `"revision"`
    - `failed` set → `"retry"`
    - website → `null`
    - blank email → `null`
    - withdrew → `null`
    - `won` → `null`
  - `bidderEmailNeed` (sent, revisions `[R(1,"sent"),R(2,"sent")]`): revSent 2 → `null`; revSent 1 → `"revision"`.
  - `bidderSendPlan` on that sent quote. Rows: a (email, never sent), b (revSent 1), c (website), d (blank email), e (`failed.unknown`). Result: `ids.join() === "a,b"`, `label === "Send revision to bidders"`, `noEmail === 1`.
    - With only row a on a never-sent draft: `label === "Send to all bidders"`.
    - Everything at revSent 2: `ids.length === 0 && label === null`.
  - `bidderAlreadyHas`: sent at rev 2 with revSent 2 → true; the same row on a draft → false.
  - `addendaSinceRow`:
    - revision 1 frozen addenda [1], live [1,2], revSent 1 → `[2]`;
    - revSent null → `[]`;
    - no frozen bid, live `[{no:3, receivedAt: 50}]`, `sentAt: 40` → `[3]`; with `sentAt: 60` → `[]`.
  - `bidderSubject`:
    - `("Bid — Gym (EST-1042)", "Gym", [])` returns base;
    - `[2]` → `"Revised bid — Gym (Addendum 2)"`;
    - `[2,3]` → `"Revised bid — Gym (Addenda 2, 3)"`;
    - a 400-character name gives a result of length ≤ 300.
  - `bidderEmailDefaults({ projectName: "Gym", estimateNumber: "EST-1042", senderName: "Sam Mills" })`:
    - subject `"Bid — Gym (EST-1042)"`;
    - body equals `"Hello,\n\nAttached is our bid for Gym (EST-1042).\n\nYou can also view the full package online here: {link}\n\nLet me know if you have any questions.\n\nThanks,\nSam Mills"`;
    - a blank project gives `"Bid — EST-1042"`.
  - `bidderSentState(B({ failed: { at: 1, error: "x" } }), 4, "u1", "C-1", 99)`:
    - `revSent === 4 && sentAt === 99 && sentBy === "u1" && threadId === "C-1" && failed === null`;
    - `bidderFailedState(B({ revSent: 2 }), { at: 5, error: "e", unknown: true }, "C-2")` keeps `revSent === 2` and has `failed.unknown === true && threadId === "C-2"`.
  - `nextBidderOpens(null, 10)` → `{ count: 1, lastAt: 10 }`; `nextBidderOpens({ count: 2, lastAt: 20 }, 15)` → `{ count: 3, lastAt: 20 }`; `nextBidderOpens(null, NaN) === null`.
  - `bidderOpensText({ count: 3, lastAt: OCT21_2PM }) === "Opened 3×"` and `bidderOpensText(null) === ""`.
  - `bidderStatusText`:
    - email never sent → `"Not sent"`; website never sent → `"Not submitted"`;
    - email `B({ revSent: 1, sentAt: OCT21_2PM })` at rev 1 → `"Sent Rev 1 · Oct 21"`; website → `"Submitted Rev 1 · Oct 21"`;
    - `B({ revSent: 1, failed: {at:1,error:"x"} })` at rev 2 → `"Send failed"`.
    - Update the two 2a expectations (`"Not submitted"`, `"Submitted Rev 1 · Oct 21"`) to build `B({ submitVia: "website", … })`. Change only those two lines.
  - `bidWalkSummary`:
    - `{total:3,sent:3,failed:0,local:0}` → `"Sent to 3 bidders."`
    - `{total:1,sent:1,failed:0,local:0}` → `"Sent to 1 bidder."`
    - `{total:4,sent:3,failed:1,local:0}` → `"Sent to 3 of 4 bidders — 1 failed. Retry it below."`
    - `{total:4,sent:2,failed:2,local:2}` → `"Sent to 2 of 4 bidders — 2 failed. Retry them below. Saved locally — Gmail isn’t connected."`
    - `{total:4,sent:1,failed:0,local:0,stoppedError:"Needs approval."}` → `"Stopped after 1 of 4: Needs approval."`
  - `isBidderFileName`:
    - `"bidder-0123456789abcdef-r2-1760000000000.pdf"` → true; the same with `-AbC123` before `.pdf` → true;
    - `"bidder-0123-r2-1760000000000.pdf"`, `"../bidder-0123456789abcdef-r2-1760000000000.pdf"` and `"cover-1760000000000.pdf"` → false;
    - `bidderFileOf(<the first>)` deep-equals `{ partyId: "pty_0123456789abcdef", rev: 2 }`.
- [ ] **Step 2:** `npx tsx scripts/test-bids.ts` fails (module missing).
- [ ] **Step 3: Implement** as specified. Then grep: `bid-send.ts` imports nothing from `stores/`, `@/db` or `node:`.
- [ ] **Step 4:** `npx tsx scripts/test-bids.ts` → 0 FAIL; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** `feat(348): pure bidder-send rules — send plan, revision numbering, subjects, bidder email defaults`.

---

### Task 2: Pure link and response rules (v3 token, bidder-aware package and responses)

**Files:**
- Modify `src/lib/quote-share/token.ts`, `src/lib/quote-share/package-view.ts`, `src/lib/estimate-output/responses.ts`.
- Add to `bidSendChecks`.

**Produces:**

`token.ts`:
- `export const SHARE_TOKEN_V3_RE = /^([1-9]\d{0,14})\.([1-9]\d{0,5})\.([0-9a-f]{16})\.([A-Za-z0-9_-]{43})$/`. Four dot-separated parts, so it never overlaps v1 (two parts) or v2 (three parts, a 43-character MAC third).
- `signShareTokenV3(secret: string, quoteId: string, rev: number, partyId: string, nonce: string, exp: number): string`:
  - throws like v2 on a missing secret, nonce, bad expiry or bad rev;
  - throws `"A v3 share token needs a bidder party id (pty_ + 16 hex)."` unless `/^pty_[0-9a-f]{16}$/`;
  - returns `` `${exp}.${rev}.${hex}.${mac}` ``, where `mac = base64url HMAC-SHA256(secret, `share:bidder:${quoteId}:${rev}:${partyId}:${nonce}:${exp}`)`. The prefix `share:bidder:` is domain-separated from v1 and v2's `share:quote:`.
- `verifyShareTokenV3(secret, token, quoteId, stored, nowMs): { rev: number; partyId: string } | null`. It follows exactly v2's fail-closed checks (stored nonce, stored expiry equality, max TTL, NaN clock, timing-safe compare).
- `ParsedShareToken` gains `{ v: 3; exp: number; rev: number; partyId: string }`; `parseShareToken` recognizes it.
- `isPackageToken(token: unknown): boolean` is true for v2 or v3. `isShareTokenV2` is unchanged (still false for v3).

`package-view.ts`:
- `PACKAGE_COPY.bidClosed = "This bid is closed."`
- `bidderCanAct(result: string | null | undefined): boolean` is true for `null` / `undefined` (the owner's v2), `"pending"` and `"awarded"`, and false for anything else.
- `packageBanner(s, currentHref, bidClosed = false)`. When `bidClosed`, return `{ tone: "info", text: PACKAGE_COPY.bidClosed, href: null, linkText: null }` before every other rule. It reveals nothing about the award.

`responses.ts`:
- `ClientResponse.partyId?: string`. `responseOf` keeps it only when it matches the party id shape.
- `responseNoteText(r, number, revNo, bidderName = "")` and `responseTaskTitle(r, number, revNo, bidderName = "")`. With a non-blank `bidderName` (the client-link wording is unchanged otherwise):
  - note head, accept: `` `${bidder} (bidder) selected scopes on ${number} Rev ${revNo} (bid link): ${names} — ${fmt(total)} before any Rewards credit.` ``
  - note head, question: `` `Question from ${bidder} (bidder) on ${number} Rev ${revNo} (bid link).` ``
  - task title, accept: `` `${bidder} accepted ${number} Rev ${revNo} — ${names} (${fmt(total)})` ``
  - task title, question: `` `Bidder question — ${number} · ${bidder}` ``
- `responseRows(raw, revNoOf, bidderNameOf?: (partyId: string) => string)`. When the response has a `partyId` and `bidderNameOf` returns a non-blank name, `who` is prefixed with `` `${name} (bidder)` `` (joined with `" · "`).

- [ ] **Step 1: Failing tests.** Use secret `"s3cret"`, `P = "pty_0123456789abcdef"`, `Q = "pty_fedcba9876543210"`, `L = { nonce: "N".repeat(43), expiresAt: 2_000_000_000_000 }` and `NOW = 1_999_000_000_000`.
  - `t = signShareTokenV3("s3cret","Q-1",2,P,L.nonce,L.expiresAt)`:
    - `SHARE_TOKEN_V3_RE.test(t)`;
    - `verifyShareTokenV3("s3cret", t, "Q-1", L, NOW)` deep-equals `{ rev: 2, partyId: P }`.
  - Each of these returns null or false:
    - verify against `"Q-2"`;
    - a rotated nonce;
    - `nowMs > exp`;
    - a token whose hex part is swapped for Q's (MAC unchanged);
    - the rev part changed to 3;
    - `verifyShareTokenV2("s3cret", t, "Q-1", L, NOW)`;
    - `verifyShareToken(…)`.
  - `verifyShareTokenV3` of a v2 token → null.
  - `parseShareToken(t)` deep-equals `{ v: 3, exp: L.expiresAt, rev: 2, partyId: P }`.
  - `isPackageToken(t) && isPackageToken(v2) && !isPackageToken(v1) && !isShareTokenV2(t)`.
  - `signShareTokenV3` with `"pty_XYZ"` throws.
  - `bidderCanAct`: `(null) && ("pending") && ("awarded")` and `!("lost") && !("withdrew") && !("no_bid")`.
  - `packageBanner({ kind: "superseded", … }, "/x", true)?.text === "This bid is closed."`; `packageBanner(okState, null, false) === null`.
  - Response text, with `r = { kind: "accept", sectionNames: ["Rigging","Curtains"], total: 12500, name: "Pat", email: "pat@x.test", message: "", sectionIds: [] }`:
    - `responseNoteText(r, "EST-1042", 2, "Miron Construction")` starts with `` `Miron Construction (bidder) selected scopes on EST-1042 Rev 2 (bid link): Rigging, Curtains — ${fmt(12500)} before any Rewards credit.` ``;
    - `responseTaskTitle(r, "EST-1042", 2, "Miron Construction") === `Miron Construction accepted EST-1042 Rev 2 — Rigging, Curtains (${fmt(12500)})``;
    - question title `"Bidder question — EST-1042 · Miron Construction"`;
    - with `""` both equal today's strings.
  - `cleanClientResponses([{ …valid, partyId: P }])[0].partyId === P`; a bad `partyId: "x"` is dropped.
  - `responseRows([{ …, partyId: P }], (n) => n, (id) => id === P ? "Miron" : "")[0].who.startsWith("Miron (bidder) · Pat")`.
- [ ] **Step 2–4:** fail, implement, then 0 FAIL and tsc clean.
- [ ] **Step 5: Commit** `feat(348): v3 bidder share token + bidder-aware package and response rules`.

---

### Task 3: Store writers (bidder sends, failures, opens) and the bidder recipient

**Files:**
- Modify `src/lib/stores/quotes.ts`, `src/lib/stores/bids.ts`, `src/lib/parties/addressee-server.ts`.
- `scripts/test-bids.ts`: new `bidSendDbChecks(ok)` with `TEST348:e` fixtures and its own `dropBidSendIdentityFixtures()`; chain it after `bidSendChecks` in `test-review-and-spec.ts`.

**Produces:**
- `quotes.ts`:
  - `EstimateEmailEntry.partyId?: string`.
  - `recordEstimateEmail` copies `partyId` into `clean` only when it matches `/^pty_[0-9a-f]{16}$/`. Dedupe by `threadId`, no `updatedAt` bump and not content: all unchanged.
- `bids.ts`. All three run `withQuoteRowLock(quoteId, …)`, re-read the party with `getDoc("record_parties", partyId)`, and require `recordType === "quote" && recordId === quoteId && isBidder(p)`; otherwise they return false and write nothing.
  - `recordBidderSend(quoteId: string, partyId: string, entry: EstimateEmailEntry, outcome: { kind: "sent" } | { kind: "failed"; error: string; unknown?: boolean }, by: string): Promise<boolean>`:
    - `recordEstimateEmail(quoteId, { ...entry, partyId })`, which is idempotent by thread;
    - then `setPartyBid(partyId, kind === "sent" ? bidderSentState(bid, entry.rev, by, entry.threadId, entry.at) : bidderFailedState(bid, { at: entry.at, error, unknown }, entry.threadId))`;
    - returns whether the party write happened.
    - It does not require `pending`: a bidder awarded while its email was in flight still gets the true `revSent`.
  - `markBidderSendFailed(quoteId, partyId, f: { at: number; error: string; unknown?: boolean }): Promise<boolean>` sets `bidderFailedState(bid, f)`.
  - `recordBidderOpen(quoteId, partyId, now): Promise<boolean>`. `next = nextBidderOpens(bid.opens, now)`; null returns false; else `setPartyBid` with `{ ...bid, opens: next }`. It never touches `Quote.shareOpens` and never takes the quote's `patchQuote` path.
- `addressee-server.ts`:
  - `bidderRecipient(party: Pick<Party, "contactId" | "companyId">): Promise<{ contactId: string | null; name: string; firstName: string; email: string }>`. It uses `addresseeContact(party)` plus that contact's first `emailsFor` email, trimmed; `""` when none.
  - `awardedRecipient` is re-implemented on top of it with the same output shape.

- [ ] **Step 1: Failing DB checks.** In `bidSendDbChecks`, inside `try { … } finally { regAll; dropFixtures(348); dropBidSendIdentityFixtures() }`:
  - Fixtures: companies `eown` ("Send Owner"), `egc1` ("Send GC One"), `egc2` ("Send GC Two"); contact `ect1` (Gee Ceeone, at egc1) with `setEmails(ect1, [{ value: "gee@e.test", label: "work", isPrimary: true }])`; contact `ect2` at egc2, flagged primary on that company and with no email.
  - Quote `eq` via `buildQuote(…, "system", …)` with customer eown. Bidders: g1 (egc1, contact ect1, email), g2 (egc2, no contact, email), g3 (egc1 role `ec`, website).
  - Checks:
    1. `bidderRecipient(g1 party)` → `{ contactId: ect1, email: "gee@e.test", firstName: "Gee" }`; `bidderRecipient(g2 party)` → `contactId === ect2 && email === ""`.
    2. Record a send: `const u0 = (await getQuote(eq)).updatedAt;` then `recordBidderSend(eq, g1, { threadId: "C-e1", rev: 1, at: T, by: "Test", to: "gee@e.test" }, { kind: "sent" }, "u1")` → true. g1's bid has `revSent === 1 && sentAt === T && sentBy === "u1" && threadId === "C-e1" && failed === null`. `estimateEmails.at(-1)` deep-equals `{ threadId: "C-e1", rev: 1, at: T, by: "Test", to: "gee@e.test", partyId: g1 }`. `updatedAt === u0`.
    3. Record an unknown failure: `recordBidderSend(eq, g2, { threadId: "C-e2", rev: 1, … }, { kind: "failed", error: "Gmail didn’t answer…", unknown: true }, "u1")` → g2 `failed.unknown === true`, `revSent == null`, `threadId === "C-e2"`.
    4. `markBidderSendFailed(eq, g3, { at: T, error: "x" })` → true, and g3's `failed.error === "x"`. `markBidderSendFailed(fixtureId(348, "eq2"), g1, …)` → false; g1 is unchanged (a party of another quote).
    5. `recordBidderOpen(eq, g1, T)` then `(eq, g1, T + 5)` → `opens` deep-equals `{ count: 2, lastAt: T + 5 }`, and the quote's `shareOpens` is unchanged (`undefined`).
    6. `recordEstimateEmail(eq, { threadId: "C-e3", rev: 1, at: T, by: "x", to: "y", partyId: "nope" })` → the stored entry has no `partyId` key.
- [ ] **Step 2:** `npm run test:specs > /tmp/claude-501/specs-348-2b2-t3.log 2>&1`. Expect failures only from these checks.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** tsc; test:specs ALL PASSED; eslint on touched files.
- [ ] **Step 5: Commit** `feat(348): bidder send/open writers under the quote row lock; emails remember the bidder`.

---

### Task 4: Bidder PDF from the sent revision; stored bidder copies served to the team

**Files:**
- Modify `src/app/print/quote/[id]/page.tsx`, `src/lib/quote-pdf/bidder-pdf-server.ts`, `src/app/api/quotes/[id]/bidder-pdf/[partyId]/route.ts`, `src/app/api/quotes/[id]/pdf/route.ts`.
- Add to `bidSendDbChecks`.

**Produces:**
- **Print route.**
  - `sp.rev` is accepted only together with a valid `bidder` and must match `/^[1-9]\d{0,5}$/`. A `rev` without a bidder, a malformed rev or a repeated rev is a 404.
  - Token id: `` rev ? `${id}~${bidder}~r${rev}` : `${id}~${bidder}` `` (`bidder` alone stays as 2b-i).
  - With `rev`: `revision = q.revisions.find(r => r.rev === rev && r.reason === "sent")`, 404 when missing; `src = quoteAsOfRevision(q, revision)`.
  - Then `documentAddressee(src, bidder, { strict: true })`, `getCustomer(src.customerId)`, `purchasePerksForCompany(src.customerId)`, `quoteDocumentDataFor(src, …)` and `keyProductPhotoDataUris(doc.sections, doc.document)`. Cut sheets keep loading live (`loadCutSheets(id)`), as today.
  - Keep the `#293t` "same calls" pin passing; all six call names stay in the file.
- **`renderBidderPdf`.** New signature `renderBidderPdf(quoteId, partyId, host, proto, opts: { rev?: number | null } = {})`.
  - With a `rev` that isn't one of the quote's SENT revisions → `{ ok: false, status: 404, error: "Not found" }`, before the secret or origin check and before any render.
  - Signs `` `${q.id}~${party.id}~r${rev}` `` and adds `&rev=${rev}` to the URL.
  - `fileName = bidderPdfFileName(q.name, company.name, rev ?? currentRev(q))`.
- **Download route.** Passes `{ rev: bidderPdfRev(q) }`. It needs the quote, so read it with `get` first; keep every 404 identical. The website path's Download PDF is now the version that was sent once the quote is sent, and the draft while draft.
- **`pdf` route.** A `file` that `isBidderFileName` matches is served from `pdfStoragePath(q.id, file.slice(0, -4))`. The download name is `bidderPdfFileName(q.name, company?.name ?? "", rev)`; the company comes from the party, which must be a quote party on THIS quote (`recordId === q.id`), else `""`. Cover files are unchanged; anything else is a 404.

- [ ] **Step 1: Failing checks** (in `bidSendDbChecks`, after Task 3's block):
  - `renderBidderPdf(eq, g1, "localhost:3000", "http", { rev: 9 })` → `{ ok: false, status: 404 }`, rendering nothing (the quote has no sent rev 9).
  - Token cross-checks with `signPrintToken` / `verifyPrintToken` at a fixed `now`:
    - a `${eq}~${g1}` token does not verify as `${eq}~${g1}~r1`;
    - the reverse fails too;
    - `${eq}~${g1}~r1` does not verify as `${eq}~${g1}~r2` or `${eq}~${g2}~r1`.
  - Source pin: the print route text includes `"~r${"` (the rev token suffix) and `"quoteAsOfRevision("`; the download route text includes `bidderPdfRev(`.
- [ ] **Step 2–3:** implement.
- [ ] **Step 4:** tsc; test:specs; eslint.
- [ ] **Step 5: Commit** `feat(348): bidder PDF from the sent revision; stored bidder copies served to the team`.

---

### Task 5: Bidder links (v3) on the server, the share page and every package route

**Files:**
- Modify:
  - `src/lib/quote-share/links.ts`
  - `src/lib/quote-pdf/document-loader.ts`
  - `src/lib/estimate-output/package-loader.ts`
  - `src/lib/estimate-output/package-model.ts`
  - `src/app/share/quote/[id]/[token]/page.tsx`
  - `package-page.tsx`
  - `datasheets.pdf/route.ts`
  - `package.zip/route.ts`
  - `doc/[docId]/route.ts`
  - `file/[fileId]/route.ts`
  - `photo/[docId]/route.ts`
  - `src/lib/estimate-output/responses-server.ts`
  - `src/lib/estimate-output/package-panel-server.ts`
- Add to `bidSendDbChecks`.

**Produces (`links.ts`):**
- `export type SharedBidder = { partyId: string; companyId: string; companyName: string; result: BidderState["result"] }`.
- `SharedPackage` gains `bidder?: SharedBidder | null`. It is optional so existing harness literals still type-check.
- `bidderSharePath(q: Pick<Quote, "id" | "shareLink" | "revisions">, partyId: string, rev: number, secret: string, now: number): string | null`. Returns null unless the link is active (`nonce`, `expiresAt > now`), `rev` is one of `q`'s SENT revisions and `partyId` has the right shape. Else `sharePath(q.id, signShareTokenV3(…))`.
- `bidderLinkPath(quoteId: string, partyId: string, by: string, opts: { rev?: number; secret?: string; now?: number } = {}): Promise<{ ok: true; path: string; rev: number } | { ok: false; error: string }>`:
  - calls `ensureShareLink(quoteId, by, opts)` and passes its refusals through (`ONLINE_COPY.notSent`, `revisingStaff`, `noSecret`, `gone`);
  - re-reads the quote;
  - checks `bidderPartyFor(q.id, partyId)` (else `BID_SEND_COPY.gone`);
  - picks `rev = opts.rev ?? latestSentRev(q)`;
  - path from `bidderSharePath` (null → `ONLINE_COPY.gone`).
- `resolveSharedPackage(id, token, opts)`:
  - The shape gate becomes `parsed.v === 2 || parsed.v === 3`.
  - v2: exactly as today, with `bidder: null`.
  - v3: `verifyShareTokenV3` → `bidderPartyFor(q.id, partyId)` → `getCompany`. Any miss → null (the one "isn't active" card).
  - The superseded `currentPath` for v3 re-signs **v3** for the same party at `latestRev`; it never falls back to the owner's v2.
- `recordSharedOpen`:
  - when `hit.bidder`, the slot is `` `share-open:${q.id}:${rev}:${partyId}:${openIpKey(ip)}` `` and the write is `recordBidderOpen(q.id, partyId, now)`, with the refund-on-failure logic unchanged;
  - otherwise unchanged. Bidder opens never reach `Quote.shareOpens`, so the owner's "Opened" chip and Client link rows are unaffected.

**Produces (pages and loaders):**
- `loadQuoteDocumentProps`: the web variant of `LoadQuoteDocumentOpts` gains `bidderPartyId?: string`.
  - When set, the addressee is `documentAddressee(src, bidderPartyId, { strict: true })`, and the loader returns **null** when that is null (fail closed).
  - Otherwise the in-flight `revisionAddressee` applies.
- `loadPackageViewProps(hit, …)` passes `bidderPartyId: hit.bidder?.partyId` and `bidClosed: !!hit.bidder && !bidderCanAct(hit.bidder.result)`.
- `PackageViewInput.bidClosed?: boolean`, forwarded as `packageBanner(i.state, i.currentHref, i.bidClosed === true)`.
- `page.tsx`: `isShareTokenV2(token)` becomes `isPackageToken(token)`.
- `package-page.tsx`: `canAct: canAct(hit.state) && bidderCanAct(hit.bidder?.result ?? null)`.

**Sub-routes.** A v3 link sees exactly the v2 view of the same pinned revision; nothing in these routes is addressed:

| Route | Today | With v3 |
|---|---|---|
| `datasheets.pdf` | `isShareTokenV2` gate | `isPackageToken`. Same pinned-revision book, same `share-zip:` per-IP bucket, same Blob cache key (quote, rev, cover fingerprint). The cover stays owner-addressed (D1079) and names no bidder, so sharing the cache is safe. |
| `package.zip` | `isShareTokenV2` gate | `isPackageToken`. Same zip and cache; the spec docx carries only the owner name, which the bidder PDF prints anyway. |
| `doc/[docId]` | `isShareTokenV2` gate | `isPackageToken`. A doc the pinned revision lists. |
| `file/[fileId]` | `isShareTokenV2` gate | `isPackageToken`. A frozen drawing of the pinned revision. |
| `photo/[docId]` | v2 branch, else the v1 rule | The branch condition becomes `isPackageToken`, so v3 can never fall through to v1's latest-sent rule. |

A v3 for a removed bidder resolves null, which is a uniform 404 on every route. A lost bidder's downloads still work (read-only information; D-next-2).

**Produces (responses):**
- `submitClientResponse`:
  - after `canAct`, `if (hit.bidder && !bidderCanAct(hit.bidder.result)) return { ok: false, error: CLIENT_ACTION_COPY.closed }`;
  - writes `{ ...clean.value, ...(hit.bidder ? { partyId: hit.bidder.partyId } : {}) }`;
  - `SubmitDeps.notify` becomes `(q, r, users, now, bidderName?: string)`. The default wraps `notifyClientResponse(q, r, users, now, {}, bidderName)`, whose signature gains a 6th parameter `bidderName = ""` passed to both text helpers.
  - The actor stays `CLIENT_LINK_ACTOR`; status never changes. The race where an award lands between this check and `appendClientResponse` writes a harmless note and is accepted.
- `package-panel-server`: `bidderNameOf` from `listBidders(q.id)` plus `getCompany` (try/catch → empty map) is passed to `responseRows`.

- [ ] **Step 1: Failing DB checks.** On a second fixture quote `es` (system type; customer eown; bidders sg1 = egc1/ect1 email, sg2 = egc2):
  1. `setStatus(es, "sent", "Test", { bypassApprovalGate: "engine-owned-flow" })` cuts rev 1; `ensureShareLink(es, "Test", { secret: "s3cret" })`.
  2. `bidderLinkPath(es, sg1, "Test", { secret: "s3cret" })` → `ok && rev === 1 && path.startsWith("/share/quote/")`, and the token parses as v3 with `partyId === sg1`.
  3. `resolveSharedPackage(es, tok1, { secret })` → `bidder.companyName === "Send GC One" && bidder.result === "pending" && rev.rev === 1`. A v2 token for the same quote gives `bidder === null`.
  4. `loadQuoteDocumentProps(hit.q, { revision: hit.rev, photos: { href: (d) => d }, bidderPartyId: sg1 })` → `custName === "Send GC One"` and `ownerLine === "Owner: Send Owner"`. With `bidderPartyId: "pty_0000000000000000"` → `null`.
  5. Remove sg2's bidder row (`setPartyBid(sg2, null)`); its previously minted v3 now resolves null. Restore it with `setPartyBid(sg2, newBidderState())`.
  6. `recordSharedOpen(es, tok1, "203.0.113.7", { secret })` → true. A second call from the same IP → false (dedupe). sg1's `opens.count === 1`, and the quote's `shareOpens` has no key for rev 1.
  7. `submitClientResponse("question", es, tok1, { name: "Pat", message: "Hi" }, "203.0.113.8", { secret, users: async () => [], notify: async (_q, r, _u, _n, b) => { seen = { r, b }; } })` → ok. `seen.r.partyId === sg1`, `seen.b === "Send GC One"`, and the stored response has `partyId === sg1`.
  8. Award sg2 (`awardBid`), so sg1 becomes `lost`. `resolveSharedPackage` still returns sg1 with `result === "lost"`. `submitClientResponse` from tok1 → `{ ok: false, error: CLIENT_ACTION_COPY.closed }`. `packageBanner(state, null, true)?.text === "This bid is closed."`. Undo the award afterwards.
  9. Revoke: `revokeShareLink(es, "Test")`, then tok1 resolves null.
  10. Source pins:
      - each of the five sub-route files includes `isPackageToken(` and not `isShareTokenV2(`;
      - `page.tsx` includes `isPackageToken(token)`;
      - `package-page.tsx` includes `bidderCanAct(`.
- [ ] **Step 2–3:** implement.
- [ ] **Step 4:** tsc; test:specs ALL PASSED; eslint; `npm run build`.
- [ ] **Step 5: Commit** `feat(348): bidder links (v3) — addressed package page, bidder opens, tagged responses, v3 on every package route`.

---

### Task 6: Send to one bidder through the ordered estimate-email pipeline

**Files:**
- Modify `src/lib/estimate-email/send-server.ts`.
- Add `bidSendFakeChecks(ok)` (fake deps, no DB) to `scripts/test-bids.ts`, chained before `bidSendDbChecks` and run by the file's own runner.

**Why parameterize instead of duplicating:** the module's value is its fixed order:
- claim after the cheap preflight;
- preflight again under the claim;
- attachments before anything is marked;
- re-read before marking;
- the approval gate on first send;
- `noAutoRetry` holds;
- "never resend blind" on Gmail timeouts.

A copy would drift. The bidder path differs only in four places (recipient, attachment, link, record), and each is a hook or dep. The customer path's code and its harness fakes stay unchanged.

**Produces:**
- `prepareClaimed(deps, actor, first, input, mode, more?: (p: Prepared) => Promise<Prepared | Refusal>)`. `more` runs after `attach` and before the final re-read. `Refusal` gains `scope?: "row"`. `Prepared` gains `bidderPdf?: { bytes: Buffer; rev: number | null }`.
- `markAndLink(deps, actor, p, asOf, linkFor?: (q: Quote, rev: QuoteRevision) => Promise<string>)`:
  - without `linkFor` the call order is unchanged (`ensureLink` first);
  - with it, the fresh quote and `rev` are resolved first, then `url = await linkFor(fresh, rev)`;
  - the `p.estimate && !rev.pdfBlobPath` guard is unchanged (bidder mode has no `p.estimate`).
- Types:
  - `export type BidderTarget = { partyId: string; companyId: string; companyName: string; contactName: string; email: string; bid: BidderState }`
  - `export type BidderEmailInput = { subject: string; body: string; asOf?: number; retryUnknown?: boolean }`
  - `export type BidderRenderResult = { ok: true; pdf: Buffer } | { ok: false; error: string; scope: "quote" | "row" }`
  - `export type BidderEmailDeps = EstimateEmailDeps & {` with:
    - `getBidder(quoteId, partyId): Promise<BidderTarget | null>`
    - `renderBidderPdf(q: Quote, partyId: string, rev: number | null): Promise<BidderRenderResult>`
    - `storeBidderPdf(quoteId, partyId, rev, bytes, now): Promise<string | null>`
    - `bidderLink(quoteId, partyId, rev): Promise<string>` (absolute v3 URL; throws `EstimateEmailError`)
    - `recordBidderSend(quoteId, partyId, entry, outcome, by): Promise<boolean>`
    - `markBidderFailed(quoteId, partyId, f): Promise<boolean>`
    - `}`
  - `export type BidderSendResult = | { ok: true; partyId: string; threadId: string; delivery: "gmail" | "local"; rev: number; status: QuoteStatus; warning?: string } | { ok: true; partyId: string; skipped: true; rev: number } | { ok: false; partyId: string; error: string; scope: "quote" | "row"; markedSent?: boolean }`
- `export async function sendBidderEmail(deps: BidderEmailDeps, actor: SendActor, quoteId: string, partyId: string, input: BidderEmailInput): Promise<BidderSendResult>`. The order:
  1. `isPartyId(partyId)`, else row `BID_SEND_COPY.gone`. Then `t0 = deps.getBidder`; null → row `gone`.
  2. Row refusals, with **no stamp and no claim**:
     - not pending → `notPending`;
     - website → `website`;
     - blank email → `noEmail(t0.contactName || t0.companyName)`;
     - `t0.bid.failed?.unknown && !input.retryUnknown` → `unknownRetry`.
  3. `est = { to: t0.email, cc: "", subject: input.subject, body: input.body, attachEstimate: false, attachCover: false, followUpDays: 0, asOf: input.asOf }`. Then `preflight(deps, actor, quoteId, est, "send")`; a refusal is scope **quote**.
  4. `bidderAlreadyHas(c.q, t0.bid)` → `{ ok: true, skipped: true, rev }` (no claim).
  5. `withClaim` (busy → scope quote `SEND_COPY.inProgress`). Under it:
     - `t = deps.getBidder` again, with the row refusals and `bidderAlreadyHas` re-checked. This is the idempotency point: a double click or a second tab sees the first send's stamp, returns `skipped`, and never emails twice for the same rev.
     - `prepareClaimed(…, more)`. In `more`: `rev = bidderPdfRev(p.q)`; `r = deps.renderBidderPdf(p.q, partyId, rev)`. A failure returns `{ ok: false, error, scope: r.scope }` (row only for `"row"`). Then `!attachmentsFit([bytes.length])` → scope quote `BID_SEND_COPY.tooLarge`.
     - A `prepareClaimed` refusal with `scope: "row"` → `markBidderFailed(quoteId, partyId, { at: now, error })` → row. Any other refusal → quote.
     - `markAndLink(deps, actor, p, input.asOf, (q, rev) => deps.bidderLink(q.id, partyId, rev.rev))`. A failure is scope quote, with `markedSent` carried.
     - **Revision guard:** `p.bidderPdf.rev !== null && p.bidderPdf.rev !== m.rev.rev` → scope quote `SEND_COPY.changedSince`. This covers a portal price refresh cutting a sent revision during the render; nothing is emailed.
     - `spec = { ...(await threadSpecFor(deps, actor, p, m)), customerId: t.companyId, customer: t.companyName, contactName: t.contactName, subject: bidderSubject(p.subject, (m.q.name || "").trim() || displayQuoteNumber(m.q), addendaSinceRow(m.q, t.bid)), attachments: [att] }`.
     - `att` is named `bidderPdfFileName(m.q.name, t.companyName, m.rev.rev)`. It is stored with `deps.storeBidderPdf` (a throw is logged and counts as null) and becomes `{ name, mime: "application/pdf", size, pdfPath, href: coverPdfHref(q.id, pdfPath) }`. When the store returns null, it rides inline as `dataUrl: "data:application/pdf;base64,…"` (the cover's precedent).
     - `deps.createAndSendThread(spec)`:
       - a throw → `markBidderFailed(…, { error: SEND_COPY.notSent })` (with `threadId` when the error carries one) → row, `markedSent` carried;
       - delivery `failed` / `unknown` → `recordBidderSend(…, entry, { kind: "failed", error: unknown ? SEND_COPY.gmailUnknownResend : SEND_COPY.gmailFailedResend, unknown })` → row;
       - `gmail` / `local` → `recordBidderSend(…, { kind: "sent" }, actor.id)`. False or a throw gives an ok result with `warning: BID_SEND_COPY.recordFailed`.
     - The entry is `{ threadId, rev: m.rev.rev, at: now, by: actor.name, to: t.email }`.
     - No follow-up task (one per bidder would flood Tasks), no cover, no Cc, no Open-in-Inbox mode.
- `liveBidderEmailDeps(opts)` = `{ ...liveEstimateEmailDeps(opts), … }`:
  - `getBidder`: `bidderPartyFor` + `getCompany` + `bidderRecipient`.
  - `renderBidderPdf`: `renderBidderPdfLive(q.id, partyId, host, proto, { rev })`. Status 503 → scope quote (Chrome, secret or origin unavailable affects every row); 404 / 500 → row.
  - `storeBidderPdf`: ``pdfStorage().put(pdfStoragePath(quoteId, `bidder-${partyId.slice(4)}-r${rev}-${now}`), bytes)``, null when storage is unavailable or throws.
  - `bidderLink`: `bidderLinkPath(quoteId, partyId, actor.name, { rev })`, then `origin + path`; a refusal → `EstimateEmailError`.
  - `recordBidderSend` / `markBidderFailed`: the Task 3 store calls.

- [ ] **Step 1: Failing fake-deps checks** (`bidSendFakeChecks`). Copy the `p3SendAsyncChecks` fakes:
  - `baseQuote` Q-P3S, `fakes()`, `NOW`, `SAM`; the fake `sendQuote` cuts rev 4 with `pdfBlobPath`.
  - Add fakes that push to `calls`:
    - `getBidder` → `"getBidder"`;
    - `renderBidderPdf` → `"renderBidderPdf:" + (rev ?? "live")`, returning `%PDF-bidder`;
    - `storeBidderPdf` → `"storeBidderPdf"`, returning `` `quote-pdfs/${id}/bidder-0123456789abcdef-r${rev}-${now}.pdf` ``;
    - `bidderLink` → `"bidderLink:" + rev`, returning `"https://app.test/share/quote/Q-P3S/v3tok"`;
    - `recordBidderSend` → `"recordBidderSend:" + outcome.kind`;
    - `markBidderFailed` → `"markBidderFailed"`.
  - Target: `{ partyId: "pty_0123456789abcdef", companyId: "co-gc", companyName: "Miron Construction", contactName: "Gee Ceeone", email: "gee@miron.test", bid: newBidderState("email") }`.

  Expectations:
  1. **Draft happy path.**
     - `ok && rev === 4 && status === "sent" && delivery === "local"`.
     - `calls.join(" > ") === "getBidder > claimSend > getBidder > applySignature > renderBidderPdf:live > sendQuote > bidderLink:4 > storeBidderPdf > createAndSendThread > recordBidderSend:sent > releaseSend"`.
     - Thread: `to === "gee@miron.test" && cc === "" && customerId === "co-gc" && customer === "Miron Construction" && contactName === "Gee Ceeone" && link.id === "Q-P3S"`.
     - The body contains the v3 URL and no `{link}`; the subject is the input base.
     - One attachment, named `"Peak – North HS Auditorium – Miron Construction – Rev 4.pdf"`, with `pdfPath === `quote-pdfs/Q-P3S/bidder-0123456789abcdef-r4-${NOW}.pdf``, `href === `/api/quotes/Q-P3S/pdf?file=bidder-0123456789abcdef-r4-${NOW}.pdf&download=1`` and `dataUrl === undefined`.
     - `addFollowUpTask` was never called; `releaseSend` got the claim taken.
  2. **Re-send on a sent quote.** Revisions `[{ rev: 2, reason: "sent", pdfBlobPath }]`; bid `revSent: 1`, frozen rev 1 `docFields.bid.addenda [{no:1}]`; live bid addenda `[1, 2]`.
     - No `sendQuote`; `renderBidderPdf:2`; `bidderLink:2`.
     - Subject `"Revised bid — North HS Auditorium (Addendum 2)"`.
     - The entry passed to `recordBidderSend` has `rev === 2`.
  3. **Already sent.** Sent quote rev 2, bid `revSent: 2` → `{ ok: true, skipped: true, rev: 2 }`; `calls.join() === "getBidder"`.
  4. **Double click.** `getBidder` returns `revSent: 1`, then `revSent: 2` on the second call → `skipped`; `calls === "getBidder > claimSend > getBidder > releaseSend"`.
  5. **Row refusals** (each: `scope === "row"`, no `claimSend`, no `markBidderFailed`):
     - website → `BID_SEND_COPY.website`;
     - blank email → `BID_SEND_COPY.noEmail("Gee Ceeone")`;
     - withdrew → `notPending`;
     - `getBidder` null → `gone`;
     - `failed.unknown` without `retryUnknown` → `unknownRetry`. With `retryUnknown: true` it proceeds and ok.
  6. **Quote refusals** (each: `scope === "quote"`, no claim, no stamp):
     - VIEWER → `SEND_COPY.needsPerm`;
     - won → `SEND_COPY.closed`;
     - `contentChangedAt: 99` → `SEND_COPY.pdfStale`;
     - `asOf: 76` → `SEND_COPY.changedSince`;
     - a busy claim → `SEND_COPY.inProgress`.
  7. **Render fails (row).** `renderBidderPdf` returns `{ ok: false, error: "The bidder PDF couldn’t be rendered — try again.", scope: "row" }` → scope row; `markBidderFailed` is called with that error; no `sendQuote`; `st.q.status === "draft"`; the claim is released.
  8. **Render unavailable (quote).** The same with `scope: "quote"` → no `markBidderFailed`.
  9. **Approval gate.** `sendQuote` returns `{ ok: false, error: "Needs approval first." }` → scope quote, that error, no thread, no stamp.
  10. **`createAndSendThread` throws on a draft.** `scope === "row" && markedSent === true && error === SEND_COPY.notSent`; `markBidderFailed` called.
  11. **Gmail refused / unknown.**
      - `delivery: "failed"` → `recordBidderSend:failed`, outcome error `SEND_COPY.gmailFailedResend`, `unknown` falsy.
      - `"unknown"` → error `SEND_COPY.gmailUnknownResend` with `unknown === true`; scope row.
  12. **Revision guard.** The fake `renderBidderPdf` appends `{ rev: 3, reason: "sent" }` to `st.q.revisions` without touching `updatedAt` → scope quote `SEND_COPY.changedSince`; `createAndSendThread` is never called.
  13. **Storage down.** `storeBidderPdf` returns null → the attachment has `dataUrl.startsWith("data:application/pdf;base64,")` and no `pdfPath`.
  14. **Too large.** `renderBidderPdf` returns a 15 MB + 1 byte buffer → scope quote `BID_SEND_COPY.tooLarge`; nothing marked.
  15. **Record fails.** `recordBidderSend` returns false → `ok && warning === BID_SEND_COPY.recordFailed`.
  16. **Customer path untouched.** The existing `#P3 send` checks still pass (run `test:specs`).
- [ ] **Step 2–3:** implement.
- [ ] **Step 4:** `npx tsx scripts/test-bids.ts` 0 FAIL; tsc; test:specs ALL PASSED; eslint.
- [ ] **Step 5: Commit** `feat(348): send to one bidder through the ordered estimate-email pipeline`.

---

### Task 7: Server actions and the shared bid panel loader

**Files:**
- Create:
  - `src/lib/parties/bid-panel-server.ts`
  - `src/lib/estimate-email/request-where.ts`
  - `src/lib/estimate-email/sender-mailbox.ts`
  - `src/app/(app)/estimator/bid-send-actions.ts`
- Modify:
  - `src/app/(app)/estimator/bid-actions.ts`
  - `src/app/(app)/estimator/send-actions.ts` (use the two extracted helpers; behaviour identical)
  - `src/lib/parties/bid-vm.ts`
  - `scripts/test-bids.ts` (DB checks)

**Produces:**
- `request-where.ts`: `requestWhere(): Promise<{ origin: string; host: string | null; proto: string | null } | { error: string }>`, moved verbatim from `send-actions.ts`.
- `sender-mailbox.ts`: `senderMailbox(userId: string, fallbackEmail: string): Promise<{ gmailConnected: boolean; fromAddress: string }>`, the Gmail lookup block moved from `estimateEmailDefaultsAction`.
- `bid-vm.ts`:
  - `BidderVM` gains:
    - `contactEmail` (now the `bidderRecipient` email, i.e. what the send will use);
    - `sendLabel: "" | "Send" | "Send revision" | "Retry"` (from `bidderEmailNeed`; blank when null or no send permission);
    - `failedText: string`;
    - `failedUnknown: boolean`;
    - `noEmail: boolean`;
    - `opensText: string`;
    - `opensTitle: string`;
    - `revisedSubject: string` (`bidderSubject(defaults.subject, name, addendaSinceRow(q, bid))` when that list is non-empty, else `""`).
  - `BidPanelVM` gains `canSend: boolean`, `canCopyLink: boolean`, `plan: { ids: string[]; label: string | null; noEmail: number }` and `addendaAfterSend: number[]` (only when `status === "sent"`).
  - `export type BidPanelResult = { ok: true; panel: BidPanelVM; note?: string } | { ok: false; error: string }` moves here; `bid-actions.ts` re-exports it as a type.
- `bid-panel-server.ts`: `loadBidPanel(quoteId: string, viewer: { canEdit: boolean; canSend: boolean; canLink: boolean }): Promise<BidPanelResult>`. This is today's `loadPanel` plus the fields above:
  - `canCopyLink = viewer.canLink && shareEligibility(q) === "ok"`;
  - `rev = currentRev(q)` with the new definition;
  - the plan from `bidderSendPlan(q, rows with recipient emails)`, empty when `!canSend`.
  - `bid-actions.ts`'s `bidPanelAction` and `mutate` call it with `viewerOf(user)` = `{ canEdit: can("create"), canSend: can("send") || can("approve"), canLink: can("send") }`.
- `bid-send-actions.ts` (`"use server"`):
  - `sendToBidderAction(quoteId: string, partyId: string, input: unknown): Promise<BidderSendActionResult>`:
    - requireUser; send|approve, else `{ ok: false, partyId, scope: "quote", error: SEND_COPY.needsPerm }`;
    - `shareSecret()`, else `ONLINE_COPY.noSecret` (scope quote);
    - `requestWhere()`;
    - clean the input: `subject` / `body` strings, `asOf` a finite number, `retryUnknown === true`;
    - `sendBidderEmail(liveBidderEmailDeps({ ...where, actor }), …)`;
    - then **always** `revalidatePath("/", "layout")` and return `{ ...r, panel, status, next }` from `loadBidPanel` plus the same `freshView` logic (status + `quoteNextStepFor`). The client gets the row stamps, the possible draft → sent move and the next `asOf` in one round trip.
    - `BidderSendActionResult = BidderSendResult & { panel?: BidPanelVM; status?: QuoteStatus; next?: QuoteNextStepView | null }`.
  - `bidderEmailDefaultsAction(quoteId): Promise<{ ok: true; subject: string; body: string; gmailConnected: boolean; fromAddress: string } | { ok: false; error: string }>`. Uses `bidderEmailDefaults` + `signatureFor(user.name)` + `senderMailbox`.
  - `bidderLinkAction(quoteId, partyId): Promise<{ ok: true; path: string } | { ok: false; error: string }>`. `can("send")`, else `ONLINE_COPY.needsSend`; then `bidderLinkPath(quoteId, partyId, user.name)`.

- [ ] **Steps:**
  1. Extract the helpers. Confirm with a `git diff` read-through that `sendEstimateEmailAction` and `estimateEmailDefaultsAction` behave identically, and that the harness pin `canSendOrApprove(user)` before `liveEstimateEmailDeps(` still holds.
  2. DB checks in `bidSendDbChecks` on quote `eq` (draft; g1 email + contact email, g2 email with no email, g3 website):
     - `loadBidPanel(eq, { canEdit: true, canSend: true, canLink: true })`:
       - `plan.ids` deep-equals `[g1]`, `plan.label === "Send to all bidders"`, `plan.noEmail === 1`, `canCopyLink === false` (never sent);
       - g1 `sendLabel === "Send"`; g2 `noEmail === true`; g3 `sendLabel === ""`.
     - With `canSend: false` → `plan.ids.length === 0` and every `sendLabel === ""`.
  3. Verify: tsc; eslint; test:specs.
  4. **Commit** `feat(348): bidder send / link / defaults actions and the shared bid panel loader`.

---

### Task 8: Bidders card (Send / Retry, Send to all with progress, Copy link, Opened chip)

**Files:**
- Modify `src/app/(app)/estimator/steps/bidders-card.tsx`, `bidder-row.tsx`, `send-step.tsx`.
- Create `src/app/(app)/estimator/steps/bidder-send-panel.tsx`.

**Produces:**
- `send-step.tsx` passes `sendCtx` to `BiddersCard`:
  - `versionToSend: async () => (pdfDirty ? await saveNow() : next?.asOf)`
  - `selectionSettled`
  - `applySync`
  - `onSent: () => setTrackKey((k) => k + 1)`
  - The prop type is `BidSendCtx = { versionToSend: () => Promise<number | undefined | false>; selectionSettled: () => Promise<boolean>; applySync: (s: NonNullable<ReturnType<typeof sendSync>>) => void; onSent: () => void }`.
- `bidder-send-panel.tsx` (client) is an inline panel like the Add-bidder block:
  - title `BID_SEND_COPY.composeTitle`;
  - `recipients(names)`;
  - `SEND_UI_COPY.gmailOff` when `!gmailConnected`, else `SEND_UI_COPY.from(fromAddress)`;
  - a subject input (aria-label `"Bidder email subject"`) and a body textarea (aria-label `"Bidder email message"`), both prefilled from `bidderEmailDefaultsAction` (loaded once per card mount);
  - `linkHint`;
  - `revisedHint(row.revisedSubject)` when any targeted row has one;
  - buttons `sendN(n)` and `cancel`.
  - It emits `onSend({ subject, body })`.
- `bidders-card.tsx`:
  - **Header.**
    - `panel.plan.label` as a primary button (hidden when null, `!canSend` or while walking).
    - While walking: `progress(i, n)` in an `aria-live="polite"` span plus a `Stop` button (sets `stopRef`; the in-flight row finishes).
    - When `panel.addendaAfterSend.length`: the amber line `addendumHint(nos)`.
  - **Walk** `walk(ids, compose, { retryUnknown })`:
    1. `if (!(await sendCtx.selectionSettled()))` → `SEND_UI_COPY.selectionNotSaved`.
    2. `asOf = await sendCtx.versionToSend()`; `false` → return.
    3. For each id, sequentially: `sendToBidderAction(quoteId, id, { ...compose, asOf, retryUnknown })`. A thrown call counts as scope quote with `SEND_UI_COPY.failed`.
    4. After each call: `setPanel(r.panel)` when present; `const s = sendSync(r); if (s) sendCtx.applySync(s)`; `if (r.next) asOf = r.next.asOf || undefined`.
    5. Tally: ok + not skipped → sent (local when `delivery === "local"`); skipped → neither; row failure → failed.
    6. `!r.ok && r.scope === "quote"` → stop with `r.error`.
    7. At the end: `setNote(bidWalkSummary(…))`, `sendCtx.onSent()`, `postChanged("quote", quoteId)` and the `peak:bid-changed` event.
    - The header button opens the panel for `panel.plan.ids`.
    - A row's Send / Send revision opens it for `[b.id]`.
    - A row's Retry with `failedUnknown` first asks `window.confirm(unknownConfirm(company))`, then walks with `retryUnknown: true`.
  - All other mutations are disabled while walking.
- `bidder-row.tsx`:
  - The `sendLabel` button (aria-label `` `${b.sendLabel} — ${b.companyName}` ``).
  - The `failedText` line, `role="alert"`, when set.
  - A `No email` chip with title `noEmailTitle` when `b.noEmail`.
  - The `opensText` chip with `title={b.opensTitle}`.
  - `Copy link` (aria-label `` `Copy link — ${b.companyName}` ``) when `panel.canCopyLink`. It calls `bidderLinkAction`, writes `window.location.origin + path` to the clipboard (fallback `window.prompt(ONLINE_COPY.copyManual, url)`) and shows `BID_SEND_COPY.linkCopied` inline.
  - **Mark submitted only on website rows:** `b.result === "pending" && b.submitVia === "website"`.
  - Keep the in-flight 2b-i Download PDF changes as they are.

- [ ] **Steps:**
  1. Implement.
  2. Verify:
     - `npx tsc --noEmit`;
     - eslint on the four files;
     - grep shows no `stores/`, `@/db`, `node:`, `addressee-server`, `bid-panel-server`, `send-server`, `quote-share/links` or `quote-share/token` import in any of them;
     - `npm run build`.
  3. **Commit** `feat(348): Bidders card — Send / Retry, Send to all bidders with progress, Copy link, Opened chip`.

---

### Task 9: Docs, gates, browser pass

- [ ] Recompute numbers from `origin/main` right before writing (DECISIONS max, PUNCHLIST, AGENTS phase). Turn D-next-1 … D-next-11 into real numbers:
  1. **Client link v3.**
     - Shape `<exp>.<rev>.<16 hex>.<mac>`; MAC over `share:bidder:<id>:<rev>:<partyId>:<nonce>:<exp>`.
     - Same nonce and expiry as v1/v2, so Revoke (and expiry) kills bidder links too.
     - Pinned to a sent revision like v2; "View the current version" stays v3 for the same bidder.
  2. **What a v3 page shows.**
     - Addressed strictly to its bidder (`Prepared for` + `Owner:`).
     - A removed bidder → the one "isn't active" card.
     - Lost / withdrew / no bid → the page still opens read-only with "This bid is closed." and no client actions (reveals nothing about who won). Pending and awarded can respond.
     - Responses carry `partyId`; the note and task name the bidder.
  3. **Bidder opens.** They count on the bidder row (`opens: {count, lastAt}`, 30-minute per-IP dedupe), never in `Quote.shareOpens`, so the owner's "Opened" chip is unchanged. Every package sub-route accepts v3 with v2's pinned-revision rules; datasheets / zip caches are shared because they name no bidder.
  4. **Revision numbering.** Bidder revisions are sent revisions (`currentRev` = latest SENT rev); an email stamps the rev it carried; the printed Rev still follows D567 (open question D626).
  5. **Bidder email PDF.** It is the sent revision rendered for the bidder (draft → live, then cut). It is stored by reference at `quote-pdfs/<id>/bidder-<hex>-r<rev>-<ms>.pdf` (flat folder, so the bridge's `pdfPathFitsLink` admits it). This deviates from the spec's `rev-<n>/bidder-<partyId>.pdf`. The website rows' Download PDF follows the same source rule.
  6. **One pipeline.**
     - `sendBidderEmail` reuses the ordered estimate-email steps through two optional hooks.
     - No cover, Cc or follow-up task; the thread is filed under the bidder company and linked to the quote.
     - The first successful (or failed-after-mark) bidder send moves the quote to Sent with the approval gate, exactly as today.
  7. **The walk.**
     - One server call per bidder under the per-quote claim.
     - Quote-level refusals stop the walk; row-level failures stamp `failed` and continue.
     - Idempotency: a re-check under the claim returns `skipped`.
     - A Gmail timeout is `failed.unknown`, excluded from Send to all, and its Retry needs a confirm.
  8. **Subjects.** Same body for everyone; the subject is "Revised bid — … (Addendum N)" for rows whose last revision lacked a now-listed addendum, else the sender's subject.
  9. **Mark submitted** is for website rows only; email rows Send / Retry.
  10. **Acknowledging an addendum** after a send is a new revision (move to Draft, then Send revision to bidders); the card hints at it.
  11. **"Local" delivery** (Gmail not connected) stamps sent, the same as the composer, and the walk summary says so.
- [ ] PUNCHLIST #348: slices 1, 2a, 2b-i, 2b-ii built; next is slice 3. Prod check addition: send to two bidders from a Gmail-connected account; open one link in a private window; Revoke kills it.
- [ ] AGENTS phase 62: add a 2b-ii paragraph.
- [ ] Gates: tsc; `npx tsx scripts/test-bids.ts`; `npm run test:specs`; eslint on all touched files; `npm run build`; `npm run test:smoke` (port checks as in prior slices).
- [ ] Browser pass on a scratch datadir (controller; Gmail is not connected, so deliveries are local):
  1. Set up an estimate with two email bidders (contacts with emails) and one website bidder; set a bid due date and Addendum 1.
  2. **Send to all bidders.**
     - The panel shows recipients and the subject "Bid — …".
     - "Sending 1 of 2…" → "Sending 2 of 2…".
     - The status becomes Sent.
     - Rows read "Sent Rev 1 · <date>".
     - Activity lists two emails.
     - The website row is untouched and still has Mark submitted.
  3. Run Send to all again: no button (everything is current).
  4. **Copy link** on one row, then open it in a private window:
     - "Prepared for <GC>", "Owner: …", bid line;
     - Ask a question → the quote note / task says "(bidder)";
     - back in the app the row shows "Opened 1×".
  5. **v3 sub-routes:** the zip, datasheets PDF, a doc, a file and a photo from that page all download / load.
  6. **Revision:** move to Draft, add Addendum 2, then "Send revision to bidders". The subject reads "Revised bid — … (Addendum 2)" and rows read "Sent Rev 2".
  7. **Award** the other GC: the first link shows "This bid is closed." with no actions.
  8. **Revoke** the client link: the v3 link shows the inactive card.
  9. **Retry:** force a row failure (temporarily blank a contact email → "No email" chip; or stop the render service) and check Failed + Retry. Double-click Send on a row and confirm only one email is recorded.
- [ ] Commit docs: `docs(348): slice 2b-ii — decisions, punch, phase 62`.

---

## Risks and how this plan contains them

- **120 s budget.** One bidder per call: render ≤ 55 s deadline, Gmail ≤ 20 s, and the first call also pays `setStatus` + the revision PDF copy. Never batch bidders server-side. A Vercel kill mid-call leaves the claim to expire (120 s) and the row unstamped. The email may or may not have left, which is the same exposure as the customer composer; the Activity thread is the record.
- **Claim semantics.** `Quote.emailSending` is shared with the owner composer, so a bidder walk and a customer send can't interleave; the loser gets "Another send of this estimate is in progress." and the walk stops (scope quote). Rows are re-read under the claim.
- **Idempotency.**
  - A double click, two tabs or a re-run walk: the second call sees `revSent >= latestSentRev` under the claim and returns `skipped`.
  - Residual risk: the email left but `recordBidderSend` failed. The thread exists and the row says "Needs …"; the result carries `recordFailed` ("check Activity before sending again").
  - Gmail `unknown` rows are excluded from Send to all and need a confirmed Retry.
- **`asOf` across the walk.** Only the first draft → sent call changes `updatedAt`; each result returns the fresh `next.asOf`. An edit landing between the post-send read and the next call is a narrow race (accepted). Any later edit stops the walk with "changed since".
- **Next.js server-action queue.** Actions from one page run serially, so an autosave queued during a walk waits for the in-flight row (≤ 120 s), then runs before the next row. Document this in AGENTS; there are no parallel calls.
- **Gmail quota.** Per-user daily send limits (Workspace ~2,000 / day) and per-second API quotas are far above a sequential walk of 5–30 bidders at seconds per row. A quota refusal surfaces as `failed` (row) and the walk continues; the user retries later.
- **Revision races.** A portal price refresh can cut a sent revision during a render. The `p.bidderPdf.rev !== m.rev.rev` guard refuses before anything is emailed.
- **v2-only assumptions.** Every `isShareTokenV2` gate is listed in Task 5 and switched to `isPackageToken`. The photo route's v1 fallback can't catch v3. `resolveSharedQuote` (v1) rejects v3 by shape. The staff Client link panel, the hub "Opened" chip and the lead drawer read `shareOpens` only, so bidder opens never change them.
- **Blob growth.** One stored bidder PDF per bidder per send, the cover precedent; there is no cleanup in this slice (note in PUNCHLIST).
- **Owner Rewards line on bidder copies.** The bidder PDF and page print the owner's purchase-perks line (same price for everyone, decision 2). Flag this for Jeff in the punch notes; no change here.

## Self-review notes

- Spec §5 coverage:
  - addressed PDF per bidder ✓ (2b-i plus T4's sent-revision source);
  - Bidders card rows (Sent Rev / Needs Rev / opens) ✓ T1/T7/T8;
  - Send to all, one call per bidder, failed + continue, first send moves to Sent ✓ T6/T8;
  - website rows unchanged ✓ T8;
  - revisions and the subject rule ✓ T1/T6;
  - client link v3 (addressed, opens to the bidder, tagged responses, v1/v2 keep working) ✓ T2/T5;
  - portal → slice 6.
- §3.3 `BidderState`: `failed.unknown` and `opens` are additive ✓ T1.
- §3.4 revised: the owner stays the customer; bidder threads are filed under the bidder company only ✓.
- §8: "A failed bidder render or send never blocks other bidders" ✓ (row scope).

### Critical Files for Implementation
- /Users/sm/Downloads/peak-app/.claude/worktrees/parties/src/lib/estimate-email/send-server.ts
- /Users/sm/Downloads/peak-app/.claude/worktrees/parties/src/lib/quote-share/links.ts
- /Users/sm/Downloads/peak-app/.claude/worktrees/parties/src/lib/quote-share/token.ts
- /Users/sm/Downloads/peak-app/.claude/worktrees/parties/src/lib/stores/bids.ts
- /Users/sm/Downloads/peak-app/.claude/worktrees/parties/src/app/(app)/estimator/steps/bidders-card.tsx