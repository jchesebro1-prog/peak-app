# Narrative-first client preview — Slice 3 Implementation Plan (#293)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Slice 3 of #293. The customer can open the **latest sent version** of a system estimate online: in the
portal at `/portal/quotes/[id]`, or with no login through a signed link at `/share/quote/[id]/[token]`. Both pages have
a **Narrative / BOM** toggle. Staff copy and revoke the link from the Estimator's customer preview.

**Architecture:**
- **Pure core** (`src/lib/quote-share/view.ts`, client-safe): the one state rule both pages use
  (`onlineEstimateState`), the sent-version view of a quote (`quoteAsOfRevision`), the header line, the share path and
  every customer-facing string. `quote-document-view.ts` gains `bomViewProps` and `offersBomView`.
- **Token** (`src/lib/quote-share/token.ts`, server-only): an HMAC over a nonce stored on the quote, modeled on the
  print token but domain-separated (`share:` vs `print:`).
- **Server.** `quotes.ts` freezes the printed header fields on every new revision (`docFields`) and gains
  `patchShareLink`. `lib/quote-share/links.ts` creates, revokes, describes and resolves links.
  `lib/quote-pdf/document-loader.ts` is the one loader for the two web pages, built from the same pure pieces as the
  print route. `lib/quote-share/photo-response.ts` serves only the photos the sent version prints.
- **UI.** Two server-rendered pages (no client component receives quote data; the toggle is two links), two photo
  routes, a shared `OnlineEstimateView`/`OnlineEstimateCard`, and a small `ClientLinkPanel` client component mounted in
  the customer preview sidebar.

**Tech Stack:** Next.js 16 App Router, TypeScript, React 19 server + client components, Drizzle/PGlite doc-store, tsx
harness (`scripts/test-review-and-spec.ts`), `node:crypto`.

**Spec:** `docs/superpowers/specs/2026-10-01-narrative-client-preview-design.md`. This plan covers Slice 3 only: §1.5,
§1.6, §2.3 (`bomViewProps`), §2.6, §2.7, §5 entire, the §6 rows that apply, §7, §8.3, and the Slice 3 parts of §9–§10.

**Builds on Slices 1–2** (origin/main `83e8b18b`; D539–D545, D549–D552): `QuoteDocument` (`keyProductPhotos`,
`pdfItemizedAppendix`, `ItemizedLines`), `estimator/quote-document-view.ts` (`appendixSystemIds`,
`systemPrintsInBody`), `lib/narrative/photos.ts` (`keyProductPhotoDocs`, `keyProductPhotoDataUris`, `PHOTO_TYPES`),
`scripts/qd293-cases.ts` (renders `QuoteDocument` in Node; harness aliases `p293Props`, `p293Render`, `p293Mod`,
`p293Sections`), and the Slice 1 harness aliases `n293CreateDoc`, `n293Attach`, `n293LinkId`, `n293MergeUpsert`
(module-scope imports, usable from any later block).

## Spec points the shipped code forces this plan to adapt

These are deliberate. Each one is logged in DECISIONS at docs time (Task 6).

1. **The print route is not switched to the loader.** Spec §5.1 moves `print/quote/[id]/page.tsx` onto
   `loadQuoteDocumentProps`. The parallel `feat/292-curtain-cut-sheets` branch rewrites that route's load block and
   render, and three harness pins (#222, #282, #293 slice 1) hold its literal calls. So Slice 3 leaves the print route
   untouched. The loader is built from the **same** pure pieces (`quoteDocumentDataFor`, `purchasePerksDocLine`, the
   photos module), and a harness check pins the two files to the same calls so they can't drift. Converging the print
   route onto the loader is a follow-up after #292 merges.
2. **`bomViewProps` lives in `quote-document-view.ts`,** not `quote-document.tsx`. The latter imports a `.jpg` that the
   harness can't load as a value module (same reason as Slice 1, D543).
3. **`shareLink` is written by a dedicated `patchShareLink`,** not `update()`. `update()` bumps `updatedAt`, which is
   the document's printed revision date, the portal's sort key and the approval version check. A share link is not
   the document.
4. **Actions answer with a message, not `requirePerm`'s redirect.** `requireUser()` + `can("send", user.roles)`,
   returning "Needs the Send permission." (the D542 idiom). The permission is the spec's `send`.
5. **A rate-limited share page is a 200 card, not a 429.** An App Router page can't set a 429. The photo route can, and
   does.
6. **The portal page can show "being revised".** `portalListsQuote` hides every staff draft, so a quote recalled after
   sending would read "isn't available" on the portal, contradicting decision 16. The page uses a new
   `portalOnlineEstimateState(q, cid)`: same customer, not Daylite history, then `onlineEstimateState`. "Revising"
   shows no content, and only to the quote's own customer, who already received it.
7. **The toolbar ⋯ menu gets no client-link items.** That ⋯ is `QuoteNextStep`'s server-evaluated approval menu,
   shared with the Quotes hub. Client link lives in the customer preview sidebar only. Adding it to the toolbar would
   also mean editing `estimator-client.tsx`, which #292 edits.
8. **Photo URLs come from a function,** `photos: { href(docId) }`, not a `routeBase`. The portal's team preview needs
   `?preview=<cid>` on every photo URL.
9. **`docFields.contactName` is `string | null`,** not `string`. `quoteDocumentDataFor` treats a null/absent contact
   as "use the primary contact"; freezing `""` would drop the Attn line on older quotes.
10. **The toggle shows whenever the body left some system un-itemized**: a narrative system, or every system under
    By section (`appendixSystemIds(...).length > 0`). The spec says "a narrative system"; By section also differs from
    the BOM, so the toggle is offered there too.
11. **Smoke can't reach the rendered document.** No seeded quote has a sent revision, so smoke covers the 200 cards
    and compiles the routes. The document path is covered by harness renders and loader DB checks, plus the
    controller's browser check.
12. **Plan-level hardening:** a `/share/:path*` header entry (`Referrer-Policy: no-referrer`, `X-Robots-Tag`), and the
    service worker never caches `/share/` pages (a staff browser with the SW registered would otherwise keep token
    URLs in Cache Storage).
13. **The status action returns the link path only to `send` holders.** Copying a public link is a form of sending.
14. **After #292 merges, the online pages don't show cut sheets.** They're PDF-only (`pdfCutSheets` is ignored by
    `QuoteDocument`). Noted for Jeff.
15. **`shareLinkView` lives in `links.ts`, not `view.ts`,** and takes no origin. It signs the token, which needs
    `node:crypto`, and `view.ts` must stay client-safe. The browser prefixes `window.location.origin` (spec §5.5).

## Global Constraints

**Workspace and environment**
- Work only in `/Users/sm/Downloads/peak-app/.claude/worktrees/narrative`, on branch `feat/293-narrative-client-preview`
  (its HEAD is origin/main `83e8b18b`, which contains Slices 1 and 2). Run `export PATH=$HOME/.local/node/bin:$PATH`
  before any `npx`/`npm`.
- **Never `git stash`.** The stash is shared across worktrees and other sessions. To set work aside, commit it instead.
- **Never open `/Users/sm/Downloads/peak-app/.data/pglite`** (the main checkout's dev DB). `npm run test:specs` uses its
  own `mktemp -d` datadir. Before you run it, check that no stray `tsx` is holding a DB: `ps aux | grep tsx`.
- **Disk is tight** (about 20 GB free, 90 % full when this plan was written, shared with other sessions). Run
  `df -h /System/Volumes/Data` before test:specs or a build. Above ~90 %, clean old temp datadirs with the guarded
  command
  `find $TMPDIR -maxdepth 1 \( -name 'tmp.*' -o -name 'peak-build-db-*' -o -name 'peak-smoke-*' \) -type d -mmin +60 -exec rm -rf {} +`.
  Always keep the `-mmin` guard. Run `rm -rf .next` before every `next build`.
- **A parallel branch, `feat/292-curtain-cut-sheets` (not merged), edits `pdf-options.ts`, `preview-doc.tsx`,
  `estimator-client.tsx`, `src/app/print/quote/[id]/page.tsx`, `src/lib/quote-pdf/token.ts` and
  `src/lib/quote-pdf/render.ts`, and adds `pdfCutSheets`.**
  - Don't touch `pdf-options.ts`, `estimator-client.tsx`, the print route, `quote-pdf/token.ts` or `render.ts` at all.
  - `preview-doc.tsx` gets exactly **one import line and one JSX line**, both add-only (Task 2).
  - `scripts/smoke-routes.ts` gets add-only lines inside `ROUTES` (Tasks 4 and 5).

**Code rules**
- **Client components** (`"use client"`) must never value-import from `@/lib/stores/*`, `@/db/*`, `@/lib/session`,
  `@/lib/blob`, `@/lib/narrative/(library|photos|system-library-index|load-system)`, `@/lib/quote-share/(token|links|photo-response)`
  or `@/lib/quote-pdf/(document-loader|portal-access|quote-document-data|token|storage|render|generate|schedule)`.
  Doing so breaks only `next build`. Type-only imports are fine, and so is importing a `"use server"` actions file.
  `@/lib/quote-share/view` must stay client-safe: it may only value-import `@/lib/quote-pdf/state` and
  `@/lib/estimate-number` (type-only from anything else).
- **`"use server"` files export only async functions.** Types and constants they need live in `view.ts` or `links.ts`.
- **A page file exports only Next's page fields** (`default`, `metadata`/`generateMetadata`, `dynamic`, …). Any other
  export (a constant, a helper) fails `next build`. Put those in a lib module.
- **No AI and no external service** anywhere (D89).
- **Server actions never throw into a transition.** Every `await` of an action from the client is wrapped in
  `try { … } catch { setErr(FAILED) }`, with `FAILED = "Could not reach the server. Try again."`.
- **Confirms are inline, never `window.confirm()`.** It returns false with no dialog in the Capacitor shells.

**Security rules (spec §5.3–§5.6, §7) — every task's requirements include these**
- **Token:** `<exp>.<base64url HMAC-SHA256(AUTH_SECRET, "share:quote:<id>:<nonce>:<exp>")>`. The quote id is in the
  path; the nonce (32 random bytes, base64url) lives only on the quote doc. The secret is `process.env.AUTH_SECRET`, the
  same as the print token. Rotating `AUTH_SECRET` kills every link, by design.
- **Verify fails closed** on: no secret; no stored link; `stored.expiresAt <= 0` (revoked); a token not matching
  `/^(\d{1,15})\.([A-Za-z0-9_-]{43})$/`; `exp !== stored.expiresAt`; `now > exp`; `exp − now > 366 days`; a non-finite
  clock; a MAC mismatch, compared with `timingSafeEqual` (constant time).
- **Expiry:** 60 days by default (`SHARE_DEFAULT_TTL_MS`). **Revoke** writes a fresh nonce **and** `expiresAt: 0`, so
  every earlier token fails twice over.
- **Who:** creating or revoking a link needs `send`. A never-sent, recalled-to-draft or service quote can't get a
  link (the button is disabled and the server refuses). The status read needs a session; it carries the path only for
  `send` holders and never the nonce.
- **What the pages show:** the **latest sent revision** only (`latestSentRevision`). `ok` requires a system quote
  (`pdfKindForQuoteType(quoteType) === "quote"`), a sent revision, and status `sent`, `won` or `lost`. Status `draft`
  with a sent revision is **revising**: the "being revised" card, no content, no PDF link. Lost shows the document
  under "This estimate is closed." Anything else is unavailable.
- **Rendered:** exactly what `QuoteDocument` prints (spec §5.6, "Rendered"). **Never rendered:** `cost` (line,
  component or vendor), `margin`, `tierMargin`, `pricingTier`, `sellOverride` mechanics, `internalNote`, vendor-quote
  `terms`/`notes`/attachment, `link`, `room`, `laborGroups`, `components`, shop/bonus/travel labor lines by name,
  `review`, `history`, the owner's email, other revisions, PDF blob paths, and `shareLink` itself. The pages pass **no
  quote data to any client component**: `QuoteDocument` is a server component and the toggle is two `<Link>`s.
- **Photos:** each photo route recomputes, live, the set of photo doc ids the quote's **latest sent revision** prints
  (`keyProductPhotoDocs(revision sections)`), and serves only a member: PNG/JPEG/WebP only, `nosniff`,
  `cache-control: private, max-age=3600`, an ETag of doc id + sha1(blobKey). Anything else is a plain 404.
- **Error pages are 200 with one generic card.** The share page shows the identical "This link isn’t active. Ask your
  Peak rep for a new one." for a bad, expired, revoked or tampered token, an unknown id, a never-sent quote and a
  service quote. Nothing hints whether a quote exists. The portal page shows "This estimate isn’t available online."
  the same way. (Smoke treats any non-200 as a failure.)
- **Order of checks on the share page and its photo route:** rate limit (per IP) → shape check of id (≤ 64 chars) and
  token (the regex) with **no DB read** → `get(id)` → `verifyShareToken` → `onlineEstimateState`.
- **No write on a public GET.** The share page, the portal page and both photo routes only read. There is no view
  tracking (spec §12 q5).
- **No session on the share route.** It sets and reads neither cookie. The middleware exempts `share/`.
- **No index, no Referer:** `robots: { index: false, follow: false }`, `referrer: "no-referrer"` in the page metadata,
  plus the `/share/:path*` response headers.
- **Rate limits** (in-memory, per instance, best-effort; the 256-bit MAC is the real barrier): share page
  `share-view:<ip>` 60/min; share photos `share-photo:<ip>` 300/min; portal photos `portal-photo:<grantId>` (or
  `portal-photo:preview:<cid>`) 300/min.
- **The nonce alone is not a credential.** `/api/sync/pull` ships whole quote docs to signed-in staff (pre-existing,
  like `pdf.blobPath`), so staff browsers can see a nonce. Without `AUTH_SECRET` it can't make a token.

**Copy (verbatim, all in `ONLINE_COPY`, `view.ts`)**
- `closed`: "This estimate is closed."
- `revising`: "This estimate is being revised — your Peak rep will send the updated version."
- `portalUnavailable`: "This estimate isn’t available online."
- `shareInactive`: "This link isn’t active. Ask your Peak rep for a new one."
- `tooMany`: "Too many requests — try again in a minute."
- `notSent`: "Send the quote first — the link shows the version you sent."
- `revisingStaff`: "The quote is back in draft — send it again to share it."
- `notShareable`: "Only system estimates can be shared online."
- `needsSend`: "Needs the Send permission."
- `revokeConfirm`: "Anyone with the current link will lose access."
- `gone`: "That quote no longer exists."
- `noSecret`: "Client links aren’t set up on this server (AUTH_SECRET is missing)."
- `copied`: "Link copied."
- `copyManual`: "Copy this link:"
- `revoked`: "Link revoked — the old link no longer opens."
- UI labels: "Client link", "Copy client link", "Revoke", "Revoke link", "Cancel", "Expires <Mon D, YYYY> · created by
  <name>", "Narrative", "BOM", "← Back", "Download PDF". Header line: "EST-#### · Rev N · sent <Mon D, YYYY>"
  (America/Chicago).

**Existing harness pins — do not break them**

The harness pins exact source strings in files this plan edits. Keep these exactly:
- `src/middleware.ts`: the substrings `|portal|` and `|print/|`; the matcher stays the first string in `matcher: [ "…" ]`.
- `src/app/portal/quote-row.tsx`: `canAcceptPortal(q, Date.now())`, `portalQuotePdfSource(q, cid)`,
  `portalQuotePdfPreparing(q, cid)`, "Document being prepared", "PDF not available — contact your rep",
  `displayQuoteNumber(q) + " · "`; and never `.margin`, `.procurement`, `.crew` etc. (#220 regex).
- `src/lib/quote-pdf/portal-access.ts`: `portalListsQuote(q, customerId) && portalPdfPreparing(q)` and
  `portalListsQuote(q, customerId) && portalPdfUnavailable(q)`.
- `src/app/(app)/estimator/quote-document.tsx`: no `"use client"`, no hooks, no `onClick=`; the
  `<div style={microLabel}>Prepared by</div>\n              <div style={{ fontWeight: 600 }}>{p.preparedByName}</div>`
  text; `QUOTE_PRINT_CSS`'s `.est-kp` and `.est-appendix` lines; no `tierMargin|pricingTier|PRICING_TIER_LABEL`; and the
  **byte-for-byte baseline** (`docs/superpowers/fixtures/293-quote-document-baseline.json`). A render with no `layout`
  must stay identical.
- `src/app/(app)/estimator/preview-doc.tsx`: never `className="est-doc"` or `customerLines(`; no value import from
  stores/db/quote-pdf server modules (#222 T5 regex).
- `next.config.ts`: the `/api/quotes/:id/pdf` `SAMEORIGIN` entry stays after the global `DENY`.
- `public/sw.js`: `req.mode === "navigate"`, `caches.match("/offline.html")`, `url.searchParams.has("_rsc")`,
  `event.data.type !== "CACHE_ROUTE"`.
- `src/lib/stores/quotes.ts`: Slice 2's `if (out && moved.value) await invalidateSystemLibrarySafely();` in `setStatus`
  and `await invalidateSystemLibrarySafely();` in `remove`.

Every old check that fails means: change your new code, never the old check. If one pins something this spec
deliberately changes, stop and report it.

**Harness**
- Each task appends its checks at the **end** of `scripts/test-review-and-spec.ts`, under a
  `/* ===… #293 slice 3 — <part> …=== */` banner.
- Imports use the `n293t…`/`N293t…` alias prefix (Slice 1 used `n293`, Slice 2 `n293s`). They sit right above their
  block.
- Async DB checks are `async function …293tAsyncChecks()` declarations. Each is chained with
  `.then(() => …293tAsyncChecks())` right after the current last link — at the start of Slice 3 that's
  `.then(() => systemLibrary293sFinalFixAsyncChecks())` — before `.finally(() => teardownFixtures())`.
- Fixtures use `fixtureId(293, "t-<slug>")` and `registerFixture(coll, id)`. Both names are in scope.
- `readFileSync`, `existsSync`, `join` and `dirname` are imported at the top of the harness.

**Gates per task**
- `npx tsc --noEmit`: baseline 0 errors.
- `npm run test:specs`: baseline **10,626 PASS / 0 FAIL** (origin/main `83e8b18b`). It must stay 0 FAIL, with PASS =
  previous + the new checks. Report the real numbers.
- `npx eslint <changed non-harness files>`. Never lint `scripts/test-review-and-spec.ts`: whole-file eslint crashes on it
  (a pre-existing problem). Expect 0 errors.
- `rm -rf .next && env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npx next build` on every task that touches a client
  component or a route (Tasks 2, 4 and 5; Task 6 again).
- The final task adds `npm run test:smoke` (baseline 187/187; Slice 3 adds 6 routes → 193).

**Dates.** Timestamps are epoch-ms numbers.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/lib/quote-share/token.ts` | create | Server-only: `SHARE_DEFAULT_TTL_MS`, `SHARE_MAX_TTL_MS`, `SHARE_TOKEN_RE`, `newShareNonce`, `signShareToken`, `verifyShareToken` |
| `src/lib/quote-share/view.ts` | create | Pure, client-safe: `onlineEstimateState`, `shareEligibility`, `quoteAsOfRevision`, `onlineHeaderLine`, `sharePath`, `onlineView`, `ShareLinkView`, `ShareLinkStatus`, `ONLINE_COPY` |
| `src/app/(app)/estimator/quote-document-view.ts` | modify | + `bomViewProps`, `offersBomView` |
| `src/lib/rate-limit.ts` | modify | + `clientIpFromHeaders`; `clientIp` delegates to it |
| `src/lib/stores/quotes.ts` | modify | `Quote.shareLink`, `QuoteRevisionDocFields`, `QuoteRevision.docFields`, `revisionDocFields`, the `snapshotOf` annex, `patchShareLink` |
| `src/lib/quote-share/links.ts` | create | Server: `shareSecret`, `shareLinkView`, `shareLinkStatus`, `ensureShareLink`, `revokeShareLink`, `resolveSharedQuote`, `SHARE_ID_MAX`, `SHARE_VIEW_PER_MIN`, `SHARE_PHOTO_PER_MIN` |
| `src/app/(app)/estimator/share-actions.ts` | create | `"use server"`: `shareLinkStatusAction`, `getShareLinkAction`, `revokeShareLinkAction` |
| `src/app/(app)/estimator/client-link-panel.tsx` | create | Client: the Client link block |
| `src/app/(app)/estimator/preview-doc.tsx` | modify | Add-only: one import, one JSX line |
| `src/app/(app)/estimator/quote-document.tsx` | modify | `layout?: "sheet" \| "web"`, `QUOTE_WEB_CSS`, two conditional classNames |
| `src/lib/quote-pdf/document-loader.ts` | create | Server: `loadQuoteDocumentProps`, `keyProductPhotoLinks`, `DocPhotos` |
| `src/lib/quote-share/photo-response.ts` | create | Server: `revisionSections`, `photoDocForRevision`, `servePhotoForRevision`, `ONLINE_PHOTO_CACHE` |
| `src/lib/quote-pdf/portal-access.ts` | modify | + `portalOnlineEstimateState` |
| `src/components/online-estimate/online-estimate.tsx` | create | Server components: `OnlineEstimateView`, `OnlineEstimateCard` |
| `src/app/portal/quotes/[id]/page.tsx` | create | The portal estimate page |
| `src/app/portal/quotes/[id]/photo/[docId]/route.ts` | create | Portal photo route |
| `src/app/portal/quote-row.tsx` | modify | The row title links to the online page when it's `ok` or `revising` |
| `src/app/share/layout.tsx` | create | Minimal frame (no team layout, no nav) |
| `src/app/share/quote/[id]/[token]/page.tsx` | create | The share page |
| `src/app/share/quote/[id]/[token]/photo/[docId]/route.ts` | create | Share photo route |
| `src/middleware.ts` | modify | Matcher exempts `share/`; doc comment names it |
| `next.config.ts` | modify | `/share/:path*` headers |
| `public/sw.js` | modify | Never cache `/share/` documents |
| `scripts/smoke-routes.ts` | modify | Add-only: 4 portal + 2 share routes |
| `scripts/test-review-and-spec.ts` | modify | The `#293 slice 3` blocks |
| `PUNCHLIST.md`, `DECISIONS.md`, `AGENTS.md` | modify | Final docs task |

## Task overview

| # | Task | Depends on |
|---|---|---|
| 1 | Pure core: share token, online state, sent-version view, BOM view, IP helper, revision `docFields` | none |
| 2 | Share links: store write, links core, actions, Client link panel | 1 |
| 3 | One loader, `layout="web"`, scoped photo response | 1 |
| 4 | Portal estimate page, portal photo route, portal row link | 1, 3 |
| 5 | Share page, share photo route, middleware, headers, service worker | 1, 2, 3, 4 |
| 6 | Final gates (smoke + build), browser check, docs | 1–5 |

---

### Task 1: Pure core — token, online state, sent-version view, BOM view, IP helper, revision docFields

**Files:**
- Create: `src/lib/quote-share/token.ts`
- Create: `src/lib/quote-share/view.ts`
- Modify: `src/app/(app)/estimator/quote-document-view.ts`
- Modify: `src/lib/rate-limit.ts`
- Modify: `src/lib/stores/quotes.ts` (types, `revisionDocFields`, the `snapshotOf` annex)
- Test: `scripts/test-review-and-spec.ts` (append block `#293 slice 3 — pure rules`)

**Interfaces:**
- **Consumes:** `latestSentRevision`, `pdfKindForQuoteType` (`@/lib/quote-pdf/state`); `displayQuoteNumber`
  (`@/lib/estimate-number`); `appendixSystemIds` (same file as `bomViewProps`); type `QuoteDocumentProps`
  (`./quote-document`, type-only); types `Quote`, `QuoteRevision`, `QuotePdfOptions`.
- **Produces** (exact names, used by Tasks 2–5):
  - `token.ts`: `SHARE_DEFAULT_TTL_MS: number`, `SHARE_MAX_TTL_MS: number`, `SHARE_TOKEN_RE: RegExp`,
    `newShareNonce(): string`, `signShareToken(secret, quoteId, nonce, exp): string`,
    `verifyShareToken(secret, token, quoteId, stored: { nonce: string; expiresAt: number } | null | undefined, nowMs): boolean`.
  - `view.ts`: `type OnlineEstimateState = { kind: "ok"; rev: QuoteRevision; closed: boolean } | { kind: "revising" } | { kind: "unavailable" }`;
    `onlineEstimateState(q)`; `type ShareEligibility = "ok" | "revising" | "not-sent" | "not-shareable"`;
    `shareEligibility(q)`; `quoteAsOfRevision(q: Quote, rev: QuoteRevision): Quote`;
    `onlineHeaderLine(q, rev): string`; `sharePath(quoteId, token): string`;
    `onlineView(raw: string | string[] | undefined): "narrative" | "bom"`;
    `type ShareLinkView = { active: boolean; path: string | null; expiresAt: number; createdAt: number; createdBy: string; revokedAt: number | null; revokedBy: string | null }`;
    `type ShareLinkStatus = { state: ShareEligibility; canSend: boolean; link: ShareLinkView | null }`;
    `ONLINE_COPY` (the verbatim strings in Global Constraints).
  - `quote-document-view.ts`: `bomViewProps(p: QuoteDocumentProps): QuoteDocumentProps`,
    `offersBomView(sections: SpecSection[], detail: "itemized" | "sectioned"): boolean`.
  - `rate-limit.ts`: `clientIpFromHeaders(h: Pick<Headers, "get">): string`.
  - `quotes.ts`: `type QuoteShareLink`, `Quote.shareLink?: QuoteShareLink | null`, `type QuoteRevisionDocFields`,
    `QuoteRevision.docFields?: QuoteRevisionDocFields`, `revisionDocFields(doc: Quote): QuoteRevisionDocFields`.

- [ ] **Step 1: Write the failing harness block.** Append at the end of `scripts/test-review-and-spec.ts`:

```ts
/* ======================================================================
   #293 slice 3 — pure rules: the share token, the online-estimate state,
   the sent-version view of a quote, the BOM view, the client-IP helper
   and the revision docFields annex.
   ====================================================================== */
import {
  SHARE_DEFAULT_TTL_MS as n293tTtl, SHARE_MAX_TTL_MS as n293tMaxTtl, SHARE_TOKEN_RE as n293tTokenRe,
  newShareNonce as n293tNonce, signShareToken as n293tSign, verifyShareToken as n293tVerify,
} from "@/lib/quote-share/token";
import {
  onlineEstimateState as n293tState, shareEligibility as n293tElig, quoteAsOfRevision as n293tAsOf,
  onlineHeaderLine as n293tHeader, sharePath as n293tPath, onlineView as n293tView, ONLINE_COPY as n293tCopy,
} from "@/lib/quote-share/view";
import { bomViewProps as n293tBom, offersBomView as n293tOffersBom } from "@/app/(app)/estimator/quote-document-view";
import { clientIp as n293tIp, clientIpFromHeaders as n293tIpH } from "@/lib/rate-limit";
import { signPrintToken as n293tSignPrint, verifyPrintToken as n293tVerifyPrint } from "@/lib/quote-pdf/token";
import { revisionDocFields as n293tDocFields, type Quote as N293tQuote, type QuoteRevision as N293tRev } from "@/lib/stores/quotes";
{
  const S = "test-secret-293t";
  const NOW = 1_800_000_000_000;

  // ---- token ----
  const nonce = n293tNonce();
  ok(/^[A-Za-z0-9_-]{43}$/.test(nonce) && n293tNonce() !== nonce, "#293t token: a nonce is 32 random bytes, base64url, fresh each call");
  ok(n293tTtl === 60 * 86_400_000 && n293tMaxTtl === 366 * 86_400_000, "#293t token: 60-day default, 366-day ceiling");
  const exp = NOW + n293tTtl;
  const stored = { nonce, expiresAt: exp };
  const tok = n293tSign(S, "Q-1", nonce, exp);
  ok(n293tTokenRe.test(tok) && tok.startsWith(exp + "."), "#293t token: <exp>.<43-char base64url MAC>");
  ok(n293tVerify(S, tok, "Q-1", stored, NOW) && n293tVerify(S, tok, "Q-1", stored, exp), "#293t token: sign → verify (valid up to and including exp)");
  ok(!n293tVerify(S, tok, "Q-2", stored, NOW), "#293t token: another quote id ✗");
  ok(!n293tVerify(S, tok, "Q-1", { nonce: n293tNonce(), expiresAt: exp }, NOW), "#293t token: a rotated nonce ✗");
  ok(!n293tVerify(S, tok, "Q-1", { nonce, expiresAt: 0 }, NOW), "#293t token: revoked (expiresAt 0) ✗");
  ok(!n293tVerify(S, tok, "Q-1", { nonce, expiresAt: exp + 1 }, NOW), "#293t token: exp ≠ stored expiry ✗");
  ok(!n293tVerify(S, tok, "Q-1", stored, exp + 1), "#293t token: expired ✗");
  const far = NOW + n293tMaxTtl + 1;
  ok(!n293tVerify(S, n293tSign(S, "Q-1", nonce, far), "Q-1", { nonce, expiresAt: far }, NOW), "#293t token: a TTL over 366 days ✗");
  const mac = tok.split(".")[1];
  ok(!n293tVerify(S, exp + "." + (mac[0] === "A" ? "B" : "A") + mac.slice(1), "Q-1", stored, NOW), "#293t token: a tampered MAC ✗");
  ok(["", "abc", exp + ".short", "x" + tok, tok + "A", tok.replace(".", "-")].every((t) => !n293tVerify(S, t, "Q-1", stored, NOW)), "#293t token: malformed tokens ✗");
  ok(!n293tVerify(S, tok, "Q-1", stored, NaN) && !n293tVerify(S, tok, "Q-1", stored, Infinity), "#293t token: a non-finite clock fails closed");
  ok(!n293tVerify("", tok, "Q-1", stored, NOW) && !n293tVerify(S, tok, "Q-1", null, NOW) && !n293tVerify("other-secret", tok, "Q-1", stored, NOW) &&
     !n293tVerify(S, tok, "Q-1", { nonce: "", expiresAt: exp }, NOW),
    "#293t token: no secret, no stored link, the wrong secret or an empty nonce ✗");
  const printTok = n293tSignPrint(S, "quote", "Q-1", NOW);
  ok(!n293tVerify(S, printTok, "Q-1", { nonce, expiresAt: Number(printTok.split(".")[0]) }, NOW),
    "#293t token: a print token never verifies as a share token, even with the stored expiry forced to match");
  ok(!n293tVerifyPrint(S, n293tSign(S, "Q-1", nonce, NOW + 60_000), "quote", "Q-1", NOW), "#293t token: a share token never verifies as a print token");
  ok(n293tPath("Q-1", tok) === "/share/quote/Q-1/" + tok, "#293t token: the share path");

  // ---- online state ----
  const rev = (n: number, reason: "manual" | "sent", at: number, extra: Record<string, unknown> = {}) =>
    ({ rev: n, at, by: "t", reason, note: "", name: "Sent name", value: 500, margin: 0.3, status: "sent", spec: { sections: [{ id: "rev" + n }] }, ...extra }) as unknown as N293tRev;
  const quote = (status: string, revisions: N293tRev[], extra: Record<string, unknown> = {}) =>
    ({ id: "Q-9", name: "Live name", customer: "Walk-in", customerId: "c1", locationId: "loc-live", value: 900, margin: 0.2, status, source: "estimator",
       quoteType: "system", owner: "Live Owner", createdAt: 1, updatedAt: 9_000, history: [], review: {}, spec: { sections: [{ id: "live" }] },
       quoteNote: "Live note", pdfOptions: { detail: "itemized" }, vendorQuotes: [{ id: "vq-live" }], revisions, ...extra }) as unknown as N293tQuote;
  const sent = rev(2, "sent", 5000);
  const revs = [rev(1, "manual", 1000), sent, rev(3, "manual", 7000)];
  ok(n293tState(quote("draft", [])).kind === "unavailable" && n293tState(quote("sent", [rev(1, "manual", 1)])).kind === "unavailable",
    "#293t state: never sent (no sent revision) → unavailable");
  const st = n293tState(quote("sent", revs));
  ok(st.kind === "ok" && st.rev.rev === 2 && !st.closed, "#293t state: sent → ok on the LATEST SENT revision, never a later manual one");
  const lost = n293tState(quote("lost", revs));
  const won = n293tState(quote("won", revs));
  ok(lost.kind === "ok" && lost.closed && won.kind === "ok" && !won.closed, "#293t state: lost → ok + closed; won → ok, no banner");
  ok(n293tState(quote("draft", revs)).kind === "revising", "#293t state: recalled to draft after a send → revising");
  ok(["flame_test", "repair", "inspection", "consulting", "rental"].every((t) => n293tState(quote("sent", revs, { quoteType: t })).kind === "unavailable") &&
     n293tState(quote("sent", revs, { quoteType: undefined })).kind === "ok",
    "#293t state: service, consulting and rental quotes → unavailable; an absent quoteType is a system quote");
  ok(n293tElig(quote("sent", revs)) === "ok" && n293tElig(quote("draft", revs)) === "revising" && n293tElig(quote("draft", [])) === "not-sent" &&
     n293tElig(quote("sent", revs, { quoteType: "flame_test" })) === "not-shareable",
    "#293t eligibility: ok / revising / not-sent / not-shareable");

  // ---- the sent version of a quote ----
  const df = { customer: "Sent Cust", locationId: "loc-sent", contactName: "Sent Contact", quoteNote: "Sent note", assumptions: "Sent assumptions",
    installTimeframe: "Q4", preparedBy: "Sent Preparer", owner: "Sent Owner", termsText: "Sent terms", paymentTerms: "Net 30",
    pdfOptions: { detail: "sectioned" }, portalFirm: null, source: "estimator" };
  const withDf = rev(2, "sent", 5000, { docFields: df, spec: { sections: [{ id: "sentSec" }] }, vendorQuotes: [{ id: "vq-sent" }] });
  const live = quote("sent", [rev(1, "manual", 1000), withDf, rev(3, "manual", 7000)], { shareLink: { nonce: "N", expiresAt: 1, createdAt: 1, createdBy: "x" } });
  const a = n293tAsOf(live, withDf);
  ok(a.name === "Sent name" && a.value === 500 && (a.spec as { sections: { id: string }[] }).sections[0].id === "sentSec" &&
     (a.vendorQuotes as { id: string }[])[0].id === "vq-sent" && a.updatedAt === 5000 && a.revisions?.length === 2,
    "#293t as-sent: the revision's name, spec, vendor quotes, value, date and rev number win over the live quote");
  ok(a.quoteNote === "Sent note" && a.owner === "Sent Owner" && a.preparedBy === "Sent Preparer" && a.locationId === "loc-sent" &&
     (a.pdfOptions as { detail: string }).detail === "sectioned",
    "#293t as-sent: docFields win over the live header fields");
  ok(a.shareLink === null, "#293t as-sent: the share link never rides into the document data");
  const b = n293tAsOf(live, sent);
  ok(b.quoteNote === "Live note" && (b.pdfOptions as { detail: string }).detail === "itemized" && b.name === "Sent name",
    "#293t as-sent: a revision cut before #293 (no docFields) reads the live header and the revision's body");
  ok(live.quoteNote === "Live note" && live.revisions?.length === 3 && live.name === "Live name", "#293t as-sent: the live quote is never mutated");
  const day = new Date(5000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
  ok(n293tHeader({ ...live, estNo: 1005 } as N293tQuote, withDf) === "EST-1005 · Rev 2 · sent " + day, "#293t header: EST-#### · Rev N · sent <date>");
  ok(n293tView("bom") === "bom" && n293tView(["bom", "x"]) === "bom" && n293tView("x") === "narrative" && n293tView(undefined) === "narrative",
    "#293t view param: ?view=bom, anything else is the narrative");

  // ---- revision docFields ----
  const frozen = n293tDocFields({ ...live, contactName: undefined, paymentTerms: "Net 30", termsText: "T", portalFirm: { generatedAt: 1, validUntil: 2 } } as unknown as N293tQuote);
  ok(frozen.quoteNote === "Live note" && frozen.owner === "Live Owner" && frozen.locationId === "loc-live" && frozen.paymentTerms === "Net 30" &&
     frozen.termsText === "T" && frozen.portalFirm?.validUntil === 2 && frozen.source === "estimator" && (frozen.pdfOptions as { detail: string } | null)?.detail === "itemized",
    "#293t docFields: the printed header fields are copied");
  ok(frozen.contactName === null, "#293t docFields: an absent contact freezes as null (the document then uses the primary contact, as live)");
  const bare = n293tDocFields({ id: "Q-x", customer: "", status: "draft" } as unknown as N293tQuote);
  ok(bare.pdfOptions === null && bare.portalFirm === null && bare.paymentTerms === null && bare.locationId === null && bare.quoteNote === "",
    "#293t docFields: absent fields read as null / empty");
  ok(!("shareLink" in frozen) && !("margin" in frozen) && !("tierMargin" in frozen) && !("review" in frozen), "#293t docFields: nothing internal is frozen");

  // ---- BOM view ----
  const narr = p293Props({ pdfOptions: { detail: "sectioned", pdfQty: false, pdfNotes: false, pdfPrices: false, pdfItemizedAppendix: true } });
  const bom = n293tBom(narr);
  ok(bom.detail === "itemized" && bom.pdfQty && bom.pdfNotes && bom.pdfPrices === false && bom.pdfItemizedAppendix === false &&
     bom.sections.every((s) => s.presentation === "itemized"),
    "#293t BOM view: every system itemized, quantities and descriptions on, prices kept as chosen, appendix off");
  ok(narr.sections.some((s) => s.presentation === "narrative") && narr.detail === "sectioned", "#293t BOM view: the input props are not mutated");
  const narrHtml = p293Render(p293Props());
  const bomHtml = p293Render(n293tBom(p293Props()));
  ok(narrHtml.includes("Intro para.") && !narrHtml.includes(">Line 5<") && bomHtml.includes(">Line 5<") && !bomHtml.includes("Intro para."),
    "#293t BOM view: the narrative system's intro gives way to its itemized lines");
  const allItemized = p293Sections().map((s) => ({ ...s, presentation: "itemized" as const }));
  ok(n293tOffersBom(p293Sections(), "itemized") && !n293tOffersBom(allItemized, "itemized") && n293tOffersBom(allItemized, "sectioned"),
    "#293t BOM view: the toggle is offered only when the body left some system un-itemized");

  // ---- client IP ----
  const h = new Headers({ "x-forwarded-for": " 203.0.113.9 , 10.0.0.1", "x-real-ip": "198.51.100.1" });
  ok(n293tIpH(h) === "203.0.113.9" && n293tIp(new Request("http://x/", { headers: h })) === "203.0.113.9", "#293t ip: the first x-forwarded-for hop, from headers or a Request");
  ok(n293tIpH(new Headers({ "x-real-ip": " 198.51.100.1 " })) === "198.51.100.1" && n293tIpH(new Headers()) === "", "#293t ip: x-real-ip fallback, else empty");

  // ---- copy ----
  ok(n293tCopy.shareInactive === "This link isn’t active. Ask your Peak rep for a new one." &&
     n293tCopy.revising === "This estimate is being revised — your Peak rep will send the updated version." &&
     n293tCopy.closed === "This estimate is closed." && n293tCopy.portalUnavailable === "This estimate isn’t available online.",
    "#293t copy: the customer-facing cards read as specified");
  const viewSrc = readFileSync(join(process.cwd(), "src/lib/quote-share/view.ts"), "utf8");
  ok(!/^import (?!type)[^\n]*from "(?!@\/lib\/quote-pdf\/state"|@\/lib\/estimate-number")/m.test(viewSrc), "#293t view.ts stays client-safe: value imports only state + estimate-number");
  const tokSrc = readFileSync(join(process.cwd(), "src/lib/quote-share/token.ts"), "utf8");
  ok(tokSrc.includes("timingSafeEqual(want, have)") && tokSrc.includes("`share:quote:${quoteId}:${nonce}:${exp}`"), "#293t token: constant-time compare over the share: domain");
}
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npm run test:specs 2>&1 | tail -5`
Expected: the run aborts with a module-not-found error for `@/lib/quote-share/token` (or tsx's equivalent). That's the
failing state.

- [ ] **Step 3: Create `src/lib/quote-share/token.ts`.**

```ts
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * #293 slice 3 — the client share-link token (spec §2.6, §7). Modeled on the
 * print token (src/lib/quote-pdf/token.ts), domain-separated ("share:" vs
 * "print:") and keyed to a per-quote nonce stored on the quote
 * (Quote.shareLink): `<exp>.<base64url HMAC-SHA256(secret,
 * "share:quote:<id>:<nonce>:<exp>")>`. The nonce lives only in the database,
 * so a token can't be made without AUTH_SECRET, and dies the moment the
 * nonce rotates (Revoke) or the stored expiry changes. Pure: the secret and
 * the clock are parameters. Server-only (node:crypto) — never import from a
 * client component.
 */
export const SHARE_DEFAULT_TTL_MS = 60 * 86_400_000;
export const SHARE_MAX_TTL_MS = 366 * 86_400_000;
export const SHARE_TOKEN_RE = /^(\d{1,15})\.([A-Za-z0-9_-]{43})$/;

/** 32 random bytes, base64url (43 chars). Rotated on every revoke. */
export function newShareNonce(): string {
  return randomBytes(32).toString("base64url");
}

function mac(secret: string, quoteId: string, nonce: string, exp: number): string {
  return createHmac("sha256", secret).update(`share:quote:${quoteId}:${nonce}:${exp}`).digest("base64url");
}

export function signShareToken(secret: string, quoteId: string, nonce: string, exp: number): string {
  if (!secret) throw new Error("AUTH_SECRET is required to sign a share token.");
  if (!nonce || !Number.isSafeInteger(exp) || exp <= 0) throw new Error("A share token needs a nonce and a positive expiry.");
  return `${exp}.${mac(secret, quoteId, nonce, exp)}`;
}

/** Fails closed on anything but a valid, unexpired MAC for exactly this
 *  quote id + stored nonce + stored expiry (spec §2.6). */
export function verifyShareToken(
  secret: string,
  token: string,
  quoteId: string,
  stored: { nonce: string; expiresAt: number } | null | undefined,
  nowMs: number
): boolean {
  if (!secret || typeof token !== "string" || typeof quoteId !== "string" || !quoteId) return false;
  if (!stored || typeof stored.nonce !== "string" || !stored.nonce || typeof stored.expiresAt !== "number") return false;
  if (!(stored.expiresAt > 0)) return false; // revoked, or never created
  // A NaN clock makes both expiry comparisons false — fail closed instead.
  if (!Number.isFinite(nowMs)) return false;
  const m = SHARE_TOKEN_RE.exec(token);
  if (!m) return false;
  const exp = Number(m[1]);
  if (!Number.isSafeInteger(exp) || exp !== stored.expiresAt) return false;
  if (nowMs > exp || exp - nowMs > SHARE_MAX_TTL_MS) return false;
  const want = Buffer.from(mac(secret, quoteId, stored.nonce, exp));
  const have = Buffer.from(m[2]);
  return want.length === have.length && timingSafeEqual(want, have);
}
```

- [ ] **Step 4: Add the types and `revisionDocFields` to `src/lib/stores/quotes.ts`.**

In the `Quote` type, right after the `contentChangedAt?: number;` member (the last one), add:

```ts
  /** #293 slice 3 (spec §1.6) — the client share link. Server-written only
   *  (patchShareLink); never in QUOTE_CONTENT_FIELDS, never snapshotted,
   *  never copied by buildQuote. Browsers get a ShareLinkView, never the nonce. */
  shareLink?: QuoteShareLink | null;
```

Right above `export const QUOTE_CONTENT_FIELDS = [`, add:

```ts
/** #293 slice 3 — `Quote.shareLink`. `expiresAt: 0` = revoked. */
export type QuoteShareLink = {
  /** 32 random bytes, base64url — rotated on revoke. */
  nonce: string;
  expiresAt: number;
  createdAt: number;
  createdBy: string;
  revokedAt?: number | null;
  revokedBy?: string | null;
};
```

Right above `export type QuoteRevision = {`, add:

```ts
/** #293 slice 3 (spec §1.5) — the non-payload fields the customer document
 *  prints, frozen with every new revision so the online page shows the
 *  version that was sent. `contactName` is null when the quote had none
 *  (the document then reads the primary contact, as the live quote does).
 *  Recall ignores it: restoreQuoteRevision copies named payload fields only. */
export type QuoteRevisionDocFields = {
  customer: string;
  locationId: string | null;
  contactName: string | null;
  quoteNote: string;
  assumptions: string;
  installTimeframe: string;
  preparedBy: string;
  owner: string;
  termsText: string;
  paymentTerms: string | null;
  pdfOptions: QuotePdfOptions | null;
  portalFirm: Quote["portalFirm"] | null;
  source: string;
};
```

In `QuoteRevision`, right after the `pdfBlobPath?: string;` member, add:

```ts
  /** #293 slice 3 — the printed header fields as they stood (absent on
   *  revisions cut before #293; the online page then reads the live ones). */
  docFields?: QuoteRevisionDocFields;
```

Right above `/** Build a snapshot of a quote's current priced state. Pure. */`, add:

```ts
/** #293 slice 3 — the header fields a revision freezes (spec §1.5). Pure. */
export function revisionDocFields(doc: Quote): QuoteRevisionDocFields {
  const d = doc as Quote & { paymentTerms?: string | null };
  return {
    customer: d.customer || "",
    locationId: d.locationId ?? null,
    contactName: typeof d.contactName === "string" ? d.contactName : null,
    quoteNote: d.quoteNote || "",
    assumptions: d.assumptions || "",
    installTimeframe: d.installTimeframe || "",
    preparedBy: d.preparedBy || "",
    owner: d.owner || "",
    termsText: d.termsText || "",
    paymentTerms: typeof d.paymentTerms === "string" ? d.paymentTerms : null,
    pdfOptions: d.pdfOptions ?? null,
    portalFirm: d.portalFirm ?? null,
    source: d.source || "",
  };
}
```

In `snapshotOf`, after `vendorQuotes: doc.vendorQuotes ?? null,` add:

```ts
    // #293 slice 3: what the customer document's header printed.
    docFields: revisionDocFields(doc),
```

- [ ] **Step 5: Create `src/lib/quote-share/view.ts`.**

```ts
import type { Quote, QuoteRevision } from "@/lib/stores/quotes";
import { latestSentRevision, pdfKindForQuoteType } from "@/lib/quote-pdf/state";
import { displayQuoteNumber } from "@/lib/estimate-number";

/**
 * #293 slice 3 — the online estimate's pure rules (spec §2.7, decision 16):
 * the one state rule both web pages use, the sent version of a quote, the
 * share path, and every customer-facing string. Client-safe: value imports
 * only quote-pdf/state and estimate-number.
 */

export const ONLINE_COPY = {
  closed: "This estimate is closed.",
  revising: "This estimate is being revised — your Peak rep will send the updated version.",
  portalUnavailable: "This estimate isn’t available online.",
  shareInactive: "This link isn’t active. Ask your Peak rep for a new one.",
  tooMany: "Too many requests — try again in a minute.",
  notSent: "Send the quote first — the link shows the version you sent.",
  revisingStaff: "The quote is back in draft — send it again to share it.",
  notShareable: "Only system estimates can be shared online.",
  needsSend: "Needs the Send permission.",
  revokeConfirm: "Anyone with the current link will lose access.",
  gone: "That quote no longer exists.",
  noSecret: "Client links aren’t set up on this server (AUTH_SECRET is missing).",
  copied: "Link copied.",
  copyManual: "Copy this link:",
  revoked: "Link revoked — the old link no longer opens.",
} as const;

export type OnlineEstimateState =
  | { kind: "ok"; rev: QuoteRevision; closed: boolean }
  | { kind: "revising" }
  | { kind: "unavailable" };

type StateFields = Pick<Quote, "quoteType" | "status" | "revisions">;

/** ok = a system quote with a sent revision, status sent / won / lost (lost
 *  = closed); revising = back in draft after a send (no content shown);
 *  anything else is unavailable. */
export function onlineEstimateState(q: StateFields): OnlineEstimateState {
  if (pdfKindForQuoteType(q.quoteType) !== "quote") return { kind: "unavailable" };
  const rev = latestSentRevision(q.revisions);
  if (!rev) return { kind: "unavailable" };
  if (q.status === "draft") return { kind: "revising" };
  if (q.status === "sent" || q.status === "won" || q.status === "lost") return { kind: "ok", rev, closed: q.status === "lost" };
  return { kind: "unavailable" };
}

export type ShareEligibility = "ok" | "revising" | "not-sent" | "not-shareable";

/** Whether staff may create a link now (only "ok"), and why not. */
export function shareEligibility(q: StateFields): ShareEligibility {
  if (pdfKindForQuoteType(q.quoteType) !== "quote") return "not-shareable";
  const s = onlineEstimateState(q);
  return s.kind === "ok" ? "ok" : s.kind === "revising" ? "revising" : "not-sent";
}

/** The quote as it was sent (spec §5.1): the revision's priced payload, its
 *  frozen header (docFields; the live header on revisions cut before #293),
 *  its date as the document date, and the revision list cut at it so the
 *  document's Rev N is the revision's. Never mutates `q`. */
export function quoteAsOfRevision(q: Quote, rev: QuoteRevision): Quote {
  const revs = Array.isArray(q.revisions) ? q.revisions : [];
  const idx = revs.findIndex((r) => r.rev === rev.rev);
  return {
    ...q,
    ...(rev.docFields ?? {}),
    name: rev.name,
    spec: rev.spec ?? null,
    vendorQuotes: rev.vendorQuotes ?? null,
    value: rev.value,
    updatedAt: rev.at,
    revisions: idx >= 0 ? revs.slice(0, idx + 1) : revs,
    shareLink: null,
  } as unknown as Quote;
}

const chicagoDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });

/** "EST-1005 · Rev 2 · sent Oct 1, 2026". */
export function onlineHeaderLine(q: Pick<Quote, "id" | "estNo" | "estSuffix" | "quoteType">, rev: Pick<QuoteRevision, "rev" | "at">): string {
  return `${displayQuoteNumber(q)} · Rev ${rev.rev} · sent ${chicagoDate(rev.at)}`;
}

export function sharePath(quoteId: string, token: string): string {
  return `/share/quote/${encodeURIComponent(quoteId)}/${token}`;
}

/** `?view=bom` → the BOM; anything else → the narrative (the default). */
export function onlineView(raw: string | string[] | undefined): "narrative" | "bom" {
  return (Array.isArray(raw) ? raw[0] : raw) === "bom" ? "bom" : "narrative";
}

/** What a browser learns about a link — never the nonce. `path` only while
 *  active, and only for a `send` holder. */
export type ShareLinkView = {
  active: boolean;
  path: string | null;
  expiresAt: number;
  createdAt: number;
  createdBy: string;
  revokedAt: number | null;
  revokedBy: string | null;
};

export type ShareLinkStatus = { state: ShareEligibility; canSend: boolean; link: ShareLinkView | null };
```

- [ ] **Step 6: Add `bomViewProps` and `offersBomView` to `src/app/(app)/estimator/quote-document-view.ts`.**

Add `import type { QuoteDocumentProps } from "./quote-document";` under the existing imports (type-only, so the
harness never loads the `.jpg`), then append:

```ts
/** #293 slice 3 (spec §2.3) — the online BOM view: every system itemized,
 *  quantities and descriptions on, the appendix off. Prices keep the quote's
 *  own choice (an estimator who hid prices still hides them). Pure. */
export function bomViewProps(p: QuoteDocumentProps): QuoteDocumentProps {
  return {
    ...p,
    detail: "itemized",
    pdfQty: true,
    pdfNotes: true,
    pdfItemizedAppendix: false,
    sections: p.sections.map((s) => ({ ...s, presentation: "itemized" as const })),
  };
}

/** The Narrative / BOM toggle is offered only when the body left some
 *  system un-itemized — otherwise the document already is the BOM. */
export function offersBomView(sections: SpecSection[], detail: "itemized" | "sectioned"): boolean {
  return appendixSystemIds(sections, detail).length > 0;
}
```

- [ ] **Step 7: Add `clientIpFromHeaders` to `src/lib/rate-limit.ts`.** Replace the existing `clientIp` function with:

```ts
/** Best-effort client IP from proxy headers (empty string if unknown) — for
 *  callers holding only headers, e.g. a page's `await headers()` (#293). */
export function clientIpFromHeaders(h: Pick<Headers, "get">): string {
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return h.get("x-real-ip")?.trim() || "";
}

/** Best-effort client IP from proxy headers (empty string if unknown). */
export function clientIp(req: Request): string {
  return clientIpFromHeaders(req.headers);
}
```

- [ ] **Step 8: Run the gates.**

```bash
export PATH=$HOME/.local/node/bin:$PATH
npx tsc --noEmit
npm run test:specs 2>&1 | tail -3
npx eslint src/lib/quote-share/token.ts src/lib/quote-share/view.ts "src/app/(app)/estimator/quote-document-view.ts" src/lib/rate-limit.ts src/lib/stores/quotes.ts
```
Expected: tsc 0 errors; `ALL PASSED` with PASS = 10,626 + this block's checks, 0 FAIL; eslint 0 errors.

- [ ] **Step 9: Commit.**

```bash
git add src/lib/quote-share/token.ts src/lib/quote-share/view.ts "src/app/(app)/estimator/quote-document-view.ts" src/lib/rate-limit.ts src/lib/stores/quotes.ts scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(quote-share): #293 slice 3 — share token, online state, sent-version view, BOM view, revision docFields

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Share links — store write, links core, actions, Client link panel

**Files:**
- Modify: `src/lib/stores/quotes.ts` (`patchShareLink`)
- Create: `src/lib/quote-share/links.ts`
- Create: `src/app/(app)/estimator/share-actions.ts`
- Create: `src/app/(app)/estimator/client-link-panel.tsx`
- Modify: `src/app/(app)/estimator/preview-doc.tsx` (one import, one JSX line)
- Test: `scripts/test-review-and-spec.ts` (append block `#293 slice 3 — share links` + `shareLinks293tAsyncChecks`)

**Interfaces:**
- **Consumes** (Task 1): `newShareNonce`, `signShareToken`, `verifyShareToken`, `SHARE_DEFAULT_TTL_MS`,
  `SHARE_TOKEN_RE`; `onlineEstimateState`, `shareEligibility`, `sharePath`, `ONLINE_COPY`, `ShareLinkView`,
  `ShareLinkStatus`, `OnlineEstimateState`; `QuoteShareLink`.
- **Produces:**
  - `quotes.ts`: `patchShareLink(id: string, mutate: (doc: Quote) => QuoteShareLink | null | undefined): Promise<Quote | null>`.
  - `links.ts`: `SHARE_ID_MAX = 64`, `SHARE_VIEW_PER_MIN = 60`, `SHARE_PHOTO_PER_MIN = 300`, `shareSecret(): string`,
    `shareLinkView(q, secret, now, withPath = true): ShareLinkView | null`,
    `shareLinkStatus(q, canSend, secret, now): ShareLinkStatus`,
    `type ShareWrite = { ok: true; link: ShareLinkView } | { ok: false; error: string }`,
    `ensureShareLink(quoteId, by, opts?: { now?: number; secret?: string }): Promise<ShareWrite>`,
    `revokeShareLink(quoteId, by, opts?: { now?: number }): Promise<{ ok: true } | { ok: false; error: string }>`,
    `resolveSharedQuote(id, token, opts?: { secret?: string; now?: number }): Promise<{ q: Quote; state: OnlineEstimateState } | null>`.
  - `share-actions.ts`: `shareLinkStatusAction(quoteId)`, `getShareLinkAction(quoteId)`, `revokeShareLinkAction(quoteId)`.
  - `client-link-panel.tsx`: `ClientLinkPanel({ quoteId }: { quoteId: string })`.

- [ ] **Step 1: Write the failing harness block.** Append:

```ts
/* ======================================================================
   #293 slice 3 — share links: the store write (no updatedAt bump, no
   content change), create / re-copy / revoke, resolve for the public page,
   the status a browser sees, the actions and the Client link panel.
   ====================================================================== */
import {
  ensureShareLink as n293tEnsure, revokeShareLink as n293tRevoke, resolveSharedQuote as n293tResolve,
  shareLinkStatus as n293tStatus, shareLinkView as n293tLinkView, SHARE_ID_MAX as n293tIdMax,
} from "@/lib/quote-share/links";
import {
  create as n293tQCreate, update as n293tQUpdate, addQuoteRevision as n293tQAddRev, get as n293tQGet,
  buildQuote as n293tBuild, QUOTE_CONTENT_FIELDS as n293tContentFields,
} from "@/lib/stores/quotes";
{
  ok(!(n293tContentFields as readonly string[]).includes("shareLink"), "#293t links: shareLink is not a content field (a link never re-renders the PDF)");
  ok(n293tBuild("Q-x", { shareLink: { nonce: "n", expiresAt: 9, createdAt: 1, createdBy: "x" } } as never, "system", null, 1).shareLink === undefined,
    "#293t links: buildQuote never copies a share link");
  const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const acts = rd("src/app/(app)/estimator/share-actions.ts");
  ok(/^"use server";/.test(acts) && ["shareLinkStatusAction", "getShareLinkAction", "revokeShareLinkAction"].every((f) => acts.includes(`export async function ${f}(`)) &&
     (acts.match(/await requireUser\(\);/g) || []).length === 3 && (acts.match(/can\("send", user\.roles\)/g) || []).length === 3 && !acts.includes("requirePerm("),
    "#293t actions: three server actions, each behind requireUser; create, revoke and the path need Send (answered inline, never a redirect)");
  ok(!/^export (?!async function)/m.test(acts), "#293t actions: a \"use server\" file exports only async functions");
  const panel = rd("src/app/(app)/estimator/client-link-panel.tsx");
  ok(/^"use client";/.test(panel) && !/^import (?!type)[^\n]*from "@\/(lib\/stores|db|lib\/blob|lib\/session|lib\/quote-share\/(token|links|photo-response)|lib\/quote-pdf\/(document-loader|portal-access|quote-document-data|token))/m.test(panel),
    "#293t panel: a client component with no server-only value import");
  ok(!panel.includes("window.confirm") && !/(^|[^\w.])confirm\(/m.test(panel) && panel.includes("ONLINE_COPY.revokeConfirm") && panel.includes("navigator.clipboard.writeText("),
    "#293t panel: Revoke confirms inline; Copy writes the clipboard (with a manual fallback)");
  ok(panel.includes("Copy client link") && panel.includes("Client link") && panel.includes("created by") && (panel.match(/catch \{/g) || []).length >= 3,
    "#293t panel: copy, expiry line, and every action await wrapped in try/catch");
  const pd = rd("src/app/(app)/estimator/preview-doc.tsx");
  ok(pd.includes('import { ClientLinkPanel } from "./client-link-panel";') && pd.includes("{p.savedQuoteId && <ClientLinkPanel quoteId={p.savedQuoteId} />}"),
    "#293t preview: the Client link block sits in the customer preview sidebar");
  const qs = rd("src/lib/stores/quotes.ts");
  const psl = qs.slice(qs.indexOf("export async function patchShareLink("), qs.indexOf("\n}\n", qs.indexOf("export async function patchShareLink(")));
  ok(psl.includes("patchQuote(id,") && !psl.includes("updatedAt"), "#293t links: patchShareLink writes under the row lock and never touches updatedAt");
}

async function shareLinks293tAsyncChecks(): Promise<void> {
  const S = "test-secret-293t";
  const QS = fixtureId(293, "t-share-sent");
  const QD = fixtureId(293, "t-share-draft");
  const QF = fixtureId(293, "t-share-flame");
  const sec = { id: "sysT", name: "Test293t Lighting", kind: "materials", mfr: "", freightPct: 0, items: [{ id: 1, sku: "T293T", desc: "Fixture", qty: 1, unit: "ea", cost: 10, price: 20 }] };
  await n293tQCreate({ id: QS, name: "#293t share", customer: "Spec fixture", owner: "spec", quoteType: "system", source: "estimator", quoteNote: "Sent note 293t", spec: { sections: [sec], mobs: [] } });
  registerFixture("quotes", QS);
  await n293tQCreate({ id: QD, name: "#293t draft", customer: "Spec fixture", owner: "spec", quoteType: "system", source: "estimator", spec: { sections: [sec], mobs: [] } });
  registerFixture("quotes", QD);
  await n293tQCreate({ id: QF, name: "#293t flame", customer: "Spec fixture", owner: "spec", quoteType: "flame_test", source: "estimator" });
  registerFixture("quotes", QF);

  // A never-sent quote can't get a link, and nothing is written.
  const never = await n293tEnsure(QD, "Tester", { secret: S });
  ok(!never.ok && never.error === n293tCopy.notSent && !(await n293tQGet(QD))?.shareLink, "#293t links (DB): a never-sent quote is refused and nothing is written");
  const flame = await n293tEnsure(QF, "Tester", { secret: S });
  ok(!flame.ok && flame.error === n293tCopy.notShareable, "#293t links (DB): a service quote is refused");
  ok(!(await n293tEnsure(QS, "Tester", { secret: "" })).ok, "#293t links (DB): no AUTH_SECRET → refused");

  // Send it: the new revision carries docFields.
  await n293tQUpdate(QS, { status: "sent" });
  const rev = await n293tQAddRev(QS, { by: "Test", reason: "sent", note: "Sent to customer" });
  ok(rev?.docFields?.quoteNote === "Sent note 293t" && rev.docFields.owner === "spec" && rev.docFields.source === "estimator",
    "#293t docFields (DB): a new revision freezes the printed header fields");

  const before = (await n293tQGet(QS))!;
  const now = Date.now();
  const made = await n293tEnsure(QS, "Tester", { secret: S, now });
  ok(made.ok && made.link.active && made.link.expiresAt === now + 60 * 86_400_000 && made.link.createdBy === "Tester" &&
     !!made.link.path && made.link.path.startsWith(`/share/quote/${encodeURIComponent(QS)}/`) && /\/\d+\.[A-Za-z0-9_-]{43}$/.test(made.link.path),
    "#293t links (DB): Copy client link creates a 60-day link");
  ok(made.ok && !("nonce" in made.link), "#293t links (DB): the browser view never carries the nonce");
  const after = (await n293tQGet(QS))!;
  ok(after.updatedAt === before.updatedAt && after.contentChangedAt === before.contentChangedAt, "#293t links (DB): creating a link moves neither updatedAt nor contentChangedAt");
  const again = await n293tEnsure(QS, "Someone else", { secret: S, now: now + 1000 });
  ok(made.ok && again.ok && again.link.path === made.link.path && again.link.createdBy === "Tester", "#293t links (DB): copying again gives the same link");
  const tok = made.ok ? made.link.path!.split("/").pop()! : "";

  // Resolve (the public page's read).
  const hit = await n293tResolve(QS, tok, { secret: S, now });
  ok(hit?.state.kind === "ok" && hit.state.rev.rev === rev?.rev, "#293t resolve (DB): a valid token opens the latest sent revision");
  ok((await n293tResolve(QS, tok, { secret: S, now: now + 61 * 86_400_000 })) === null, "#293t resolve (DB): an expired link → null");
  ok((await n293tResolve(QD, tok, { secret: S, now })) === null, "#293t resolve (DB): another quote's id → null");
  ok((await n293tResolve(QS, tok.slice(0, -1) + (tok.endsWith("A") ? "B" : "A"), { secret: S, now })) === null, "#293t resolve (DB): a tampered token → null");
  ok((await n293tResolve("Q".repeat(n293tIdMax + 1), tok, { secret: S, now })) === null && (await n293tResolve(QS, "not-a-token", { secret: S, now })) === null,
    "#293t resolve (DB): an oversize id or malformed token → null");

  // What a browser sees.
  const st = n293tStatus((await n293tQGet(QS))!, false, S, now);
  const stSend = n293tStatus((await n293tQGet(QS))!, true, S, now);
  ok(st.state === "ok" && st.link?.active === true && st.link.path === null && stSend.link?.path === (made.ok ? made.link.path : "x"),
    "#293t status (DB): the path is shown only to a Send holder");

  // Recalled to draft → revising; a link can't be created; the old one shows the card.
  await n293tQUpdate(QS, { status: "draft" });
  ok((await n293tResolve(QS, tok, { secret: S, now }))?.state.kind === "revising", "#293t resolve (DB): recalled to draft → revising");
  const refused = await n293tEnsure(QS, "Tester", { secret: S, now });
  ok(!refused.ok && refused.error === n293tCopy.revisingStaff, "#293t links (DB): a recalled quote can't get a new link");
  await n293tQUpdate(QS, { status: "lost" });
  const closed = await n293tResolve(QS, tok, { secret: S, now });
  ok(closed?.state.kind === "ok" && closed.state.closed, "#293t resolve (DB): a lost quote still opens, marked closed");

  // Revoke: the nonce rotates, expiry 0, the old token dies; a new copy is a new link.
  const oldNonce = (await n293tQGet(QS))!.shareLink!.nonce;
  const rv = await n293tRevoke(QS, "Revoker", { now: now + 2000 });
  const revoked = (await n293tQGet(QS))!;
  ok(rv.ok && revoked.shareLink!.expiresAt === 0 && revoked.shareLink!.nonce !== oldNonce && revoked.shareLink!.revokedBy === "Revoker" && revoked.shareLink!.revokedAt === now + 2000,
    "#293t revoke (DB): rotates the nonce, sets expiry 0, records who and when");
  ok((await n293tResolve(QS, tok, { secret: S, now })) === null && n293tLinkView(revoked, S, now)?.active === false, "#293t revoke (DB): the old link stops working at once");
  await n293tQUpdate(QS, { status: "sent" });
  const fresh = await n293tEnsure(QS, "Tester", { secret: S, now: now + 3000 });
  ok(fresh.ok && made.ok && fresh.link.path !== made.link.path, "#293t revoke (DB): Copy client link after a revoke makes a new link");
  ok(!(await n293tRevoke(fixtureId(293, "t-share-never"), "x")).ok, "#293t revoke (DB): an unknown quote is refused");
}
```

Then chain it: after the line `.then(() => systemLibrary293sFinalFixAsyncChecks())` add
`.then(() => shareLinks293tAsyncChecks())`.

- [ ] **Step 2: Run it to verify it fails.**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npm run test:specs 2>&1 | tail -5`
Expected: module-not-found for `@/lib/quote-share/links`.

- [ ] **Step 3: Add `patchShareLink` to `src/lib/stores/quotes.ts`,** right after `setRevisionPdfPath`:

```ts
/**
 * #293 slice 3 — write the client share link (spec §1.6, §5.5). Under the row
 * lock (patchQuote), so the "already active?" decision and the write are one
 * compare-and-set. Never bumps `updatedAt` — the share link isn't the
 * document (updatedAt is its printed date, the portal's sort key and the
 * approval version check) — and never changes content (shareLink isn't a
 * QUOTE_CONTENT_FIELDS member). `mutate` returns the next link, or
 * undefined to leave it.
 */
export async function patchShareLink(
  id: string,
  mutate: (doc: Quote) => QuoteShareLink | null | undefined
): Promise<Quote | null> {
  return patchQuote(id, (doc) => {
    const next = mutate(doc);
    if (next !== undefined) doc.shareLink = next;
  });
}
```

- [ ] **Step 4: Create `src/lib/quote-share/links.ts`.**

```ts
import { get as getQuote, patchShareLink, type Quote } from "@/lib/stores/quotes";
import { SHARE_DEFAULT_TTL_MS, SHARE_TOKEN_RE, newShareNonce, signShareToken, verifyShareToken } from "./token";
import {
  ONLINE_COPY, onlineEstimateState, shareEligibility, sharePath,
  type OnlineEstimateState, type ShareLinkStatus, type ShareLinkView,
} from "./view";

/**
 * #293 slice 3 — client share links, server side (spec §5.3, §5.5, §7).
 * Create (re-copy returns the same link), revoke (rotate the nonce AND set
 * expiry 0), describe for a browser (never the nonce), and resolve a public
 * request. `resolveSharedQuote` only READS — a public GET never writes.
 */

export const SHARE_ID_MAX = 64;
export const SHARE_VIEW_PER_MIN = 60;
export const SHARE_PHOTO_PER_MIN = 300;

export function shareSecret(): string {
  return process.env.AUTH_SECRET || "";
}

export function shareLinkView(q: Pick<Quote, "id" | "shareLink">, secret: string, now: number, withPath = true): ShareLinkView | null {
  const l = q.shareLink;
  if (!l) return null;
  const active = !!secret && typeof l.nonce === "string" && !!l.nonce && l.expiresAt > now;
  return {
    active,
    path: active && withPath ? sharePath(q.id, signShareToken(secret, q.id, l.nonce, l.expiresAt)) : null,
    expiresAt: l.expiresAt,
    createdAt: l.createdAt,
    createdBy: l.createdBy,
    revokedAt: l.revokedAt ?? null,
    revokedBy: l.revokedBy ?? null,
  };
}

/** The Client link panel's read: the path only for a Send holder. */
export function shareLinkStatus(q: Quote, canSend: boolean, secret: string, now: number): ShareLinkStatus {
  return { state: shareEligibility(q), canSend, link: shareLinkView(q, secret, now, canSend) };
}

export type ShareWrite = { ok: true; link: ShareLinkView } | { ok: false; error: string };

function refusalFor(q: Quote): string | null {
  const e = shareEligibility(q);
  if (e === "ok") return null;
  return e === "revising" ? ONLINE_COPY.revisingStaff : e === "not-sent" ? ONLINE_COPY.notSent : ONLINE_COPY.notShareable;
}

/** Copy client link: an active link comes back unchanged; otherwise a fresh
 *  60-day one is written. Refused unless the quote's online state is ok. */
export async function ensureShareLink(quoteId: string, by: string, opts: { now?: number; secret?: string } = {}): Promise<ShareWrite> {
  const now = opts.now ?? Date.now();
  const secret = opts.secret ?? shareSecret();
  if (!secret) return { ok: false, error: ONLINE_COPY.noSecret };
  const cur = await getQuote(quoteId);
  if (!cur) return { ok: false, error: ONLINE_COPY.gone };
  const pre = refusalFor(cur);
  if (pre) return { ok: false, error: pre };
  // Fast path: an active link is returned without a write.
  const live = shareLinkView(cur, secret, now);
  if (live?.active) return { ok: true, link: live };
  let refusal = null as string | null;
  const q = await patchShareLink(quoteId, (doc) => {
    refusal = refusalFor(doc);
    if (refusal) return undefined;
    const l = doc.shareLink;
    if (l && l.nonce && l.expiresAt > now) return undefined; // another request just made one
    return { nonce: newShareNonce(), expiresAt: now + SHARE_DEFAULT_TTL_MS, createdAt: now, createdBy: by, revokedAt: null, revokedBy: null };
  });
  if (!q) return { ok: false, error: ONLINE_COPY.gone };
  if (refusal) return { ok: false, error: refusal };
  const link = shareLinkView(q, secret, now);
  return link?.active ? { ok: true, link } : { ok: false, error: ONLINE_COPY.gone };
}

/** Revoke: a fresh nonce and expiry 0 — every earlier token fails twice over. */
export async function revokeShareLink(quoteId: string, by: string, opts: { now?: number } = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = opts.now ?? Date.now();
  const q = await patchShareLink(quoteId, (doc) => ({
    nonce: newShareNonce(),
    expiresAt: 0,
    createdAt: doc.shareLink?.createdAt ?? now,
    createdBy: doc.shareLink?.createdBy ?? by,
    revokedAt: now,
    revokedBy: by,
  }));
  return q ? { ok: true } : { ok: false, error: ONLINE_COPY.gone };
}

/** The public page's (and its photo route's) one check, in order: shape
 *  (no DB read for a malformed id or token) → get → verify → state. Read-only.
 *  null = show the one "isn't active" card, whatever the cause. */
export async function resolveSharedQuote(
  id: string,
  token: string,
  opts: { secret?: string; now?: number } = {}
): Promise<{ q: Quote; state: OnlineEstimateState } | null> {
  if (typeof id !== "string" || !id || id.length > SHARE_ID_MAX) return null;
  if (typeof token !== "string" || !SHARE_TOKEN_RE.test(token)) return null;
  const secret = opts.secret ?? shareSecret();
  if (!secret) return null;
  const q = await getQuote(id);
  if (!q || q.id !== id) return null;
  if (!verifyShareToken(secret, token, id, q.shareLink, opts.now ?? Date.now())) return null;
  return { q, state: onlineEstimateState(q) };
}
```

- [ ] **Step 5: Create `src/app/(app)/estimator/share-actions.ts`.**

```ts
"use server";

import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { get } from "@/lib/stores/quotes";
import { ensureShareLink, revokeShareLink, shareLinkStatus, shareSecret, type ShareWrite } from "@/lib/quote-share/links";
import { ONLINE_COPY, type ShareLinkStatus } from "@/lib/quote-share/view";

/**
 * #293 slice 3 — the Client link panel's server actions (spec §5.5). Reading
 * the status needs a session; creating, revoking and seeing the link's path
 * need Send (a public link is a form of sending), answered with a message
 * rather than requirePerm's redirect (the D542 idiom).
 */

export async function shareLinkStatusAction(quoteId: string): Promise<{ ok: true; status: ShareLinkStatus } | { ok: false; error: string }> {
  const user = await requireUser();
  const q = await get(String(quoteId || ""));
  if (!q) return { ok: false, error: ONLINE_COPY.gone };
  return { ok: true, status: shareLinkStatus(q, can("send", user.roles), shareSecret(), Date.now()) };
}

export async function getShareLinkAction(quoteId: string): Promise<ShareWrite> {
  const user = await requireUser();
  if (!can("send", user.roles)) return { ok: false, error: ONLINE_COPY.needsSend };
  return ensureShareLink(String(quoteId || ""), user.name);
}

export async function revokeShareLinkAction(quoteId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can("send", user.roles)) return { ok: false, error: ONLINE_COPY.needsSend };
  return revokeShareLink(String(quoteId || ""), user.name);
}
```

- [ ] **Step 6: Create `src/app/(app)/estimator/client-link-panel.tsx`.**

```tsx
"use client";

import { useEffect, useState, useTransition, type CSSProperties } from "react";
import { getShareLinkAction, revokeShareLinkAction, shareLinkStatusAction } from "./share-actions";
import { ONLINE_COPY, type ShareLinkStatus } from "@/lib/quote-share/view";

/**
 * #293 slice 3 — the customer preview's Client link block (spec §5.5): Copy
 * client link (the same link until it expires or is revoked), its expiry and
 * creator, and Revoke behind an inline confirm. The link opens the latest
 * SENT version, so a never-sent or recalled quote has no Copy. Reads its own
 * status on mount — no quote data comes from the Estimator.
 */

const FAILED = "Could not reach the server. Try again.";

const label: CSSProperties = { fontSize: 11, fontWeight: 600, color: "#9aa0ab", textTransform: "uppercase", letterSpacing: ".04em" };
const btn: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 600, textAlign: "center", borderRadius: 8, padding: "9px 16px", border: "none", cursor: "pointer", color: "#16181d", background: "#f1f2f5" };
const off: CSSProperties = { cursor: "not-allowed", opacity: 0.55 };
const small: CSSProperties = { fontSize: 11.5, color: "#5b616e", lineHeight: 1.45 };
const linkBtn: CSSProperties = { background: "none", border: "none", padding: 0, fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 600, cursor: "pointer" };

function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
}

export function ClientLinkPanel({ quoteId }: { quoteId: string }) {
  const [status, setStatus] = useState<ShareLinkStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [manualUrl, setManualUrl] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    shareLinkStatusAction(quoteId).then(
      (r) => {
        if (!live) return;
        if (r.ok) {
          setStatus(r.status);
          setErr(null);
        } else setErr(r.error);
      },
      () => {
        if (live) setErr(FAILED);
      }
    );
    return () => {
      live = false;
    };
  }, [quoteId]);

  const reload = async () => {
    try {
      const r = await shareLinkStatusAction(quoteId);
      if (r.ok) setStatus(r.status);
    } catch {
      /* the panel keeps what it shows */
    }
  };

  const copy = () =>
    start(async () => {
      setErr(null);
      setNote(null);
      setManualUrl(null);
      setConfirmRevoke(false);
      let r: Awaited<ReturnType<typeof getShareLinkAction>>;
      try {
        r = await getShareLinkAction(quoteId);
      } catch {
        setErr(FAILED);
        return;
      }
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      const link = r.link;
      if (!link.path) {
        setErr(FAILED);
        return;
      }
      setStatus((s) => (s ? { ...s, link } : s));
      const url = window.location.origin + link.path;
      try {
        await navigator.clipboard.writeText(url);
        setNote(ONLINE_COPY.copied);
      } catch {
        setManualUrl(url);
        setNote(ONLINE_COPY.copyManual);
      }
    });

  const revoke = () =>
    start(async () => {
      setErr(null);
      setNote(null);
      let r: Awaited<ReturnType<typeof revokeShareLinkAction>>;
      try {
        r = await revokeShareLinkAction(quoteId);
      } catch {
        setErr(FAILED);
        return;
      }
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setConfirmRevoke(false);
      setManualUrl(null);
      setNote(ONLINE_COPY.revoked);
      await reload();
    });

  if (!status) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={label}>Client link</span>
        <span style={small}>{err || "Loading…"}</span>
      </div>
    );
  }
  if (status.state === "not-shareable") return null;

  const link = status.link?.active ? status.link : null;
  const copyDisabled = pending || !status.canSend || status.state !== "ok";
  const copyTitle = !status.canSend
    ? ONLINE_COPY.needsSend
    : status.state === "not-sent"
      ? ONLINE_COPY.notSent
      : status.state === "revising"
        ? ONLINE_COPY.revisingStaff
        : undefined;

  return (
    <div data-testid="client-link" style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 7 }}>
      <span style={label}>Client link</span>
      <button type="button" onClick={copy} disabled={copyDisabled} title={copyTitle} style={{ ...btn, ...(copyDisabled ? off : {}) }}>
        Copy client link
      </button>
      {link && (
        <span style={small}>
          Expires {shortDate(link.expiresAt)} · created by {link.createdBy}
        </span>
      )}
      {link && status.canSend && !confirmRevoke && (
        <button type="button" onClick={() => setConfirmRevoke(true)} disabled={pending} style={{ ...linkBtn, color: "#a33a2b", alignSelf: "flex-start" }}>
          Revoke
        </button>
      )}
      {link && confirmRevoke && (
        <div role="group" aria-label="Revoke the client link" style={{ ...small, display: "flex", flexDirection: "column", gap: 6, padding: "8px 10px", background: "#fdf0ee", border: "1px solid #f3d2cc", borderRadius: 7 }}>
          <span>{ONLINE_COPY.revokeConfirm}</span>
          <span style={{ display: "flex", gap: 12 }}>
            <button type="button" onClick={revoke} disabled={pending} style={{ ...linkBtn, color: "#a33a2b" }}>
              Revoke link
            </button>
            <button type="button" onClick={() => setConfirmRevoke(false)} disabled={pending} style={{ ...linkBtn, color: "#5b616e" }}>
              Cancel
            </button>
          </span>
        </div>
      )}
      {note && <span style={small}>{note}</span>}
      {manualUrl && (
        <input readOnly value={manualUrl} aria-label="Client link" onFocus={(e) => e.currentTarget.select()} style={{ fontSize: 11.5, padding: "6px 8px", border: "1px solid #dfe2e8", borderRadius: 7 }} />
      )}
      {err && (
        <span role="alert" style={{ ...small, color: "#a33a2b" }}>
          {err}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Mount it in `src/app/(app)/estimator/preview-doc.tsx` (add-only, two lines).**
  - After the line `import { QuotePdfViewer } from "@/components/quote-pdf/quote-pdf-viewer";` add:
    `import { ClientLinkPanel } from "./client-link-panel";`
  - Immediately before the `</aside>` that closes the sidebar (right after the
    `{pdfHref && hasFile ? ( … ) : ( … )}` block ends), add:
    `{p.savedQuoteId && <ClientLinkPanel quoteId={p.savedQuoteId} />}`

  Change nothing else in this file. #292 edits the same file in other places.

- [ ] **Step 8: Run the gates.**

```bash
export PATH=$HOME/.local/node/bin:$PATH
npx tsc --noEmit
npm run test:specs 2>&1 | tail -3
npx eslint src/lib/stores/quotes.ts src/lib/quote-share/links.ts "src/app/(app)/estimator/share-actions.ts" "src/app/(app)/estimator/client-link-panel.tsx" "src/app/(app)/estimator/preview-doc.tsx"
df -h /System/Volumes/Data | tail -1
rm -rf .next && env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npx next build 2>&1 | tail -15
```
Expected: tsc 0; ALL PASSED (previous + this block); eslint 0 errors; build OK.

- [ ] **Step 9: Commit.**

```bash
git add src/lib/stores/quotes.ts src/lib/quote-share/links.ts "src/app/(app)/estimator/share-actions.ts" "src/app/(app)/estimator/client-link-panel.tsx" "src/app/(app)/estimator/preview-doc.tsx" scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(estimator): #293 slice 3 — client share links (create, re-copy, revoke) + Client link panel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: One loader, `layout="web"`, scoped photo response

**Files:**
- Modify: `src/app/(app)/estimator/quote-document.tsx`
- Create: `src/lib/quote-pdf/document-loader.ts`
- Create: `src/lib/quote-share/photo-response.ts`
- Test: `scripts/test-review-and-spec.ts` (append block `#293 slice 3 — web document` + `onlineDoc293tAsyncChecks`)

**Interfaces:**
- **Consumes:** `quoteAsOfRevision`, `onlineEstimateState` (Task 1); `quoteDocumentDataFor`
  (`@/lib/quote-pdf/quote-document-data`); `purchasePerksForCompany` (`@/lib/stores/reward-perks`);
  `purchasePerksDocLine` (`@/lib/rewards/purchase-perks`); `keyProductPhotoDocs`, `keyProductPhotoDataUris`,
  `PHOTO_TYPES` (`@/lib/narrative/photos`); `getBlobStream` (`@/lib/blob`).
- **Produces:**
  - `quote-document.tsx`: `QuoteDocumentProps.layout?: "sheet" | "web"`, `QUOTE_WEB_CSS: string`.
  - `document-loader.ts`: `type DocPhotos = "inline" | { href: (docId: string) => string }`,
    `keyProductPhotoLinks(sections, href): Promise<Record<string, { src: string; alt: string }>>`,
    `loadQuoteDocumentProps(q: Quote, opts: { revision?: QuoteRevision | null; photos: DocPhotos }): Promise<QuoteDocumentProps>`.
  - `photo-response.ts`: `revisionSections(rev): SpecSection[]`,
    `photoDocForRevision(rev, docId): Promise<PartDocument | null>`, `ONLINE_PHOTO_CACHE`,
    `servePhotoForRevision(req: Request, rev: QuoteRevision, docId: string): Promise<Response>`.

- [ ] **Step 1: Write the failing harness block.** Append:

```ts
/* ======================================================================
   #293 slice 3 — the web document: layout="web", what the online pages
   must never render, the one loader (sent version, photos as scoped URLs),
   and the photo set a sent revision may serve.
   ====================================================================== */
import { loadQuoteDocumentProps as n293tLoad } from "@/lib/quote-pdf/document-loader";
import { photoDocForRevision as n293tPhotoFor } from "@/lib/quote-share/photo-response";
import { quoteDocumentDataFor as n293tDocData } from "@/lib/quote-pdf/quote-document-data";
{
  const base = JSON.parse(readFileSync(join(process.cwd(), "docs/superpowers/fixtures/293-quote-document-baseline.json"), "utf8")) as Record<string, string>;
  ok(p293Render({ ...p293Props(), layout: "sheet" }) === base.itemized, "#293t web: layout=\"sheet\" renders byte-for-byte as the baseline");
  const web = p293Render({ ...p293Props(), layout: "web" });
  ok(web.includes('class="est-doc est-web"') && web.includes("width:100%;max-width:740px;box-sizing:border-box") && web.includes('class="est-meta"'),
    "#293t web: fluid up to 740px, with the header grid marked for the phone layout");
  const css = (p293Mod() as unknown as { QUOTE_WEB_CSS: string }).QUOTE_WEB_CSS;
  ok(/@media \(max-width: 600px\)[\s\S]*\.est-web \{ padding: 20px 16px !important; \}/.test(css) &&
     /@media \(max-width: 480px\)[\s\S]*\.est-web \.est-kp img \{ float: none !important;/.test(css) &&
     /@media \(max-width: 760px\)[\s\S]*box-shadow: none !important/.test(css) && css.includes(".pk-no-print { display: none !important; }"),
    "#293t web: phone padding < 600px, photo above its paragraph < 480px, sheet chrome only > 760px, page chrome dropped in print");

  // Never rendered (spec §5.6): internal money, notes, vendor terms, review, links.
  const AT = Date.UTC(2026, 9, 1, 15);
  const secret = {
    id: "Q-293T", name: "Never render", customer: "Walk-in", customerId: null, owner: "Pat", preparedBy: "", updatedAt: AT, createdAt: AT, revisions: [],
    quoteNote: "", assumptions: "", paymentTerms: "Net 30", margin: 0.4242, tierMargin: 0.3737, pricingTier: "TIER-SECRET-293",
    review: { note: "REVIEW-SECRET-293" }, history: [{ at: 1, to: "draft", note: "HISTORY-SECRET-293" }],
    shareLink: { nonce: "NONCE-SECRET-293", expiresAt: 1, createdAt: 1, createdBy: "x" }, pdf: { blobPath: "quotes/BLOB-SECRET-293.pdf" },
    spec: { sections: [
      { id: "n", name: "Narr", kind: "materials", mfr: "", freightPct: 0, presentation: "narrative", narrative: "Intro.",
        items: [{ id: 1, sku: "S1", desc: "Line one", qty: 1, unit: "ea", cost: 31337.77, price: 50000, internalNote: "INTERNAL-SECRET-293", link: "https://x.example/LINK-SECRET-293", room: "ROOM-SECRET-293" }],
        keyProducts: [{ lineKey: "1", sku: "S1", text: "Para.", photo: false }] },
      { id: "i", name: "Items", kind: "materials", mfr: "", freightPct: 0,
        items: [{ id: 2, sku: "VQ", desc: "Vendor", qty: 1, unit: "ea", cost: 27182.81, price: 40000, vendorQuoteId: "VQ-S", internalNote: "INTERNAL2-SECRET-293" }] },
    ] },
    vendorQuotes: [{ id: "VQ-S", vendor: "Acme", quoteNumber: "Q1", description: "Motors", display: "itemized", lines: [{ id: 1, description: "Motor", qty: 1, unit: "ea", amount: 27182.81 }],
      terms: "TERMS-SECRET-293", notes: "NOTES-SECRET-293", total: 27182.81, includesFreight: false }],
    pdfOptions: {},
  };
  const props = n293tDocData(secret as never, null, { companyName: "Peak Systems Group", logoDark: null });
  for (const [label, html] of [["narrative", p293Render({ ...props, layout: "web" })], ["BOM", p293Render({ ...n293tBom(props), layout: "web" })]] as const) {
    ok(!/SECRET-293/.test(html) && !html.includes("31,337.77") && !html.includes("27,182.81") && !html.includes("42.42") && !html.includes("37.37"),
      `#293t never rendered (${label}): no cost, margin, tier, internal note, vendor terms/notes, link, room, review, history, nonce or PDF path`);
  }

  const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const loader = rd("src/lib/quote-pdf/document-loader.ts");
  const print = rd("src/app/print/quote/[id]/page.tsx");
  ok(["quoteDocumentDataFor(", "purchasePerksForCompany(", "purchasePerksDocLine(", "keyProductPhotoDataUris(", "getCustomer(", "getSettings("].every((c) => loader.includes(c) && print.includes(c)),
    "#293t loader: the web loader and the print route build the document from the same calls (no drift until the print route moves onto the loader)");
  ok(loader.includes("quoteAsOfRevision(q, opts.revision)") && loader.includes("keyProductPhotoDocs("), "#293t loader: a revision renders as sent; web photos are the printed docs as scoped URLs");
  const pr = rd("src/lib/quote-share/photo-response.ts");
  ok(pr.includes("keyProductPhotoDocs(revisionSections(rev))") && pr.includes("PHOTO_TYPES.has(doc.contentType)") && pr.includes('"x-content-type-options": "nosniff"') &&
     pr.includes('"private, max-age=3600"') && pr.includes('createHash("sha1").update(doc.blobKey)'),
    "#293t photos: only the sent revision's printed photo docs, PNG/JPEG/WebP, nosniff, private 1 h, ETag on id + blobKey hash");
}

async function onlineDoc293tAsyncChecks(): Promise<void> {
  const P = fixtureId(293, "t-doc-part");
  const P2 = fixtureId(293, "t-doc-item-part");
  const QID = fixtureId(293, "t-doc-quote");
  for (const sku of [P, P2]) {
    await n293MergeUpsert(sku, { desc: "Test293t " + sku, category: "Test293 Cat", unit: "ea", list: 10, cost: 5 });
    registerFixture("catalog_parts", sku);
  }
  const mk = async (sku: string, fileName: string) => {
    const d = await n293CreateDoc({ kind: "image", fileName, contentType: "image/webp", size: 1000, blobKey: `part-docs/PD-fixture-293t/${fileName}`, sourceUrl: null, source: "upload", by: "Test" });
    if (!d) throw new Error("#293t doc: fixture document failed to create");
    registerFixture("part_documents", d.id);
    await n293Attach(d.id, [sku], "Test");
    registerFixture("part_document_links", n293LinkId(sku, d.id));
    return d;
  };
  const narrDoc = await mk(P, "t-narr.webp");
  const itemDoc = await mk(P2, "t-item.webp");
  const sections = (intro: string) => [
    { id: "n", name: "Test293t Narrative", kind: "materials", mfr: "", freightPct: 0, presentation: "narrative", narrative: intro,
      items: [{ id: 1, sku: P, desc: "Narr part", qty: 1, unit: "ea", cost: 5, price: 10 }], keyProducts: [{ lineKey: "1", sku: P, text: "Para 293t.", photo: true }] },
    { id: "i", name: "Test293t Itemized", kind: "materials", mfr: "", freightPct: 0,
      items: [{ id: 2, sku: P2, desc: "Item part", qty: 1, unit: "ea", cost: 5, price: 10 }], keyProducts: [{ lineKey: "2", sku: P2, text: "Never prints", photo: true }] },
  ];
  await n293tQCreate({ id: QID, name: "#293t loader", customer: "Spec fixture", owner: "spec", quoteType: "system", source: "estimator", quoteNote: "Sent note", spec: { sections: sections("Sent intro 293t."), mobs: [] } });
  registerFixture("quotes", QID);
  await n293tQUpdate(QID, { status: "sent", pdfOptions: { pdfCover: true } as never });
  await n293tQAddRev(QID, { by: "Test", reason: "sent", note: "Sent" });
  await n293tQUpdate(QID, { name: "Edited after send", quoteNote: "Edited note", spec: { sections: sections("Leaked intro 293t."), mobs: [] } });

  const q = (await n293tQGet(QID))!;
  const st = n293tState(q);
  if (st.kind !== "ok") { ok(false, "#293t loader (DB): fixture quote is ok"); return; }
  const props = await n293tLoad(q, { revision: st.rev, photos: { href: (id) => `/t/photo/${id}` } });
  ok(props.projectName === "#293t loader" && props.quoteNote === "Sent note" && props.revNum === st.rev.rev && props.revDateMs === st.rev.at,
    "#293t loader (DB): the sent version — its name, cover note, Rev N and date — not the edit made after sending");
  ok(props.keyProductPhotos?.[P]?.src === `/t/photo/${narrDoc.id}` && !props.keyProductPhotos?.[P2], "#293t loader (DB): a printed photo becomes its scoped URL; an itemized system's block has none");
  ok(typeof props.rewardsLine === "string", "#293t loader (DB): the purchase-perks line is loaded as on the PDF");
  const html = p293Render({ ...props, layout: "web" });
  ok(html.includes("Sent intro 293t.") && html.includes("Para 293t.") && !html.includes("Leaked intro 293t.") && !html.includes("Edited after send") && !html.includes("Never prints") &&
     html.includes(`src="/t/photo/${narrDoc.id}"`),
    "#293t loader (DB): a quote edited after sending shows the SENT version online, photo included");
  const liveProps = await n293tLoad(q, { photos: { href: (id) => `/t/photo/${id}` } });
  ok(liveProps.projectName === "Edited after send", "#293t loader (DB): without a revision it renders the live quote (the print route's behaviour)");

  ok((await n293tPhotoFor(st.rev, narrDoc.id))?.id === narrDoc.id, "#293t photos (DB): the sent revision's printed photo is servable");
  ok((await n293tPhotoFor(st.rev, itemDoc.id)) === null && (await n293tPhotoFor(st.rev, "PD-no-such")) === null && (await n293tPhotoFor(st.rev, "")) === null,
    "#293t photos (DB): a photo on an itemized system, an unknown id or a blank id is never served");
}
```

Chain `.then(() => onlineDoc293tAsyncChecks())` right after `.then(() => shareLinks293tAsyncChecks())`.

- [ ] **Step 2: Run it to verify it fails.**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npm run test:specs 2>&1 | tail -5`
Expected: module-not-found for `@/lib/quote-pdf/document-loader`.

- [ ] **Step 3: `layout="web"` in `src/app/(app)/estimator/quote-document.tsx`.**

  1. In `QuoteDocumentProps`, after the `keyProductPhotos?: …;` member, add:

```ts
  /** #293 slice 3 — "web" for the portal and share pages: fluid up to the
   *  sheet's 740px, with QUOTE_WEB_CSS's phone rules. Absent / "sheet" renders
   *  byte-for-byte as before (the PDF and the baseline fixture). */
  layout?: "sheet" | "web";
```

  2. Right after the `QUOTE_PRINT_CSS` constant, add:

```ts
/** #293 slice 3 — page CSS for layout="web" (the portal and share pages):
 *  phone padding under 600px with one-column header and signature grids, a
 *  key-product photo full width above its paragraph under 480px, the sheet
 *  chrome (shadow, radius) only above 760px, and the page chrome dropped
 *  when the page is printed. !important because the document's own styles
 *  are inline. */
export const QUOTE_WEB_CSS = `
.est-web { margin: 0 auto; }
@media (max-width: 760px) { .est-web { box-shadow: none !important; border-radius: 0 !important; } }
@media (max-width: 600px) {
  .est-web { padding: 20px 16px !important; }
  .est-web .est-meta, .est-web .est-sig { grid-template-columns: 1fr !important; gap: 10px !important; }
}
@media (max-width: 480px) {
  .est-web .est-kp img { float: none !important; display: block; width: 100% !important; max-height: 3in !important; margin: 0 0 10px 0 !important; }
}
@media print {
  html, body { background: #fff !important; }
  .pk-no-print { display: none !important; }
  .est-web { box-shadow: none !important; padding: 0 !important; max-width: none !important; }
}
`;
```

  3. In `QuoteDocument`, after `const isItemized = p.detail === "itemized";` add `const web = p.layout === "web";`.

  4. Replace the outer div's opening

```tsx
        <div
          className="est-doc"
          style={{
            width: 740,
            background: "#fff",
```

  with

```tsx
        <div
          className={web ? "est-doc est-web" : "est-doc"}
          style={{
            width: web ? "100%" : 740,
            ...(web ? { maxWidth: 740, boxSizing: "border-box" as const } : {}),
            background: "#fff",
```

  5. In the "prepared for / project / prepared by" grid, insert one line between `<div` and `style={{`:

```tsx
            className={web ? "est-meta" : undefined}
```

  React omits an undefined `className`, so the sheet output is unchanged.

- [ ] **Step 4: Create `src/lib/quote-pdf/document-loader.ts`.**

```ts
import { get as getCustomer } from "@/lib/stores/customers";
import { getSettings } from "@/lib/settings";
import { purchasePerksForCompany } from "@/lib/stores/reward-perks";
import { purchasePerksDocLine } from "@/lib/rewards/purchase-perks";
import { keyProductPhotoDataUris, keyProductPhotoDocs, PHOTO_TYPES } from "@/lib/narrative/photos";
import { quoteAsOfRevision } from "@/lib/quote-share/view";
import { quoteDocumentDataFor } from "./quote-document-data";
import type { Quote, QuoteRevision } from "@/lib/stores/quotes";
import type { QuoteDocumentProps } from "@/app/(app)/estimator/quote-document";
import type { SpecSection } from "@/app/(app)/estimator/types";

/**
 * #293 slice 3 (spec §5.1) — the customer QuoteDocument's props, for the
 * portal estimate page and the share page. Built from exactly the calls the
 * print route makes (customer, settings, purchase perks → the pure
 * quoteDocumentDataFor; the photos module), so the PDF and the web pages
 * can't drift. The print route itself stays on its own copy of those calls
 * until #292 merges (it edits that route) — a harness check pins the two to
 * the same calls meanwhile.
 *
 * With `revision`, the document is the quote AS SENT (quoteAsOfRevision):
 * the revision's spec / vendor quotes / name / value / date / Rev N and its
 * frozen header (docFields; the live header on pre-#293 revisions).
 * Photos: "inline" = data URIs (the print route's way); { href } = scoped
 * URLs the photo routes serve.
 */

export type DocPhotos = "inline" | { href: (docId: string) => string };

/** sku → { src: href(docId), alt } for the printed photo-on blocks. Never throws. */
export async function keyProductPhotoLinks(sections: SpecSection[], href: (docId: string) => string): Promise<Record<string, { src: string; alt: string }>> {
  try {
    const docs = await keyProductPhotoDocs(sections);
    const out: Record<string, { src: string; alt: string }> = {};
    for (const [sku, d] of docs) if (d.blobKey && PHOTO_TYPES.has(d.contentType)) out[sku] = { src: href(d.id), alt: d.title || sku };
    return out;
  } catch (e) {
    console.warn("[narrative] key-product photo links unavailable", e instanceof Error ? e.message : e);
    return {};
  }
}

export async function loadQuoteDocumentProps(q: Quote, opts: { revision?: QuoteRevision | null; photos: DocPhotos }): Promise<QuoteDocumentProps> {
  const src = opts.revision ? quoteAsOfRevision(q, opts.revision) : q;
  const [cust, settings, perks] = await Promise.all([
    getCustomer(src.customerId),
    getSettings(),
    // #282 perks+points — the customer's purchase perks line (program on only).
    purchasePerksForCompany(src.customerId),
  ]);
  const doc = quoteDocumentDataFor(src, cust, settings);
  const keyProductPhotos =
    opts.photos === "inline" ? await keyProductPhotoDataUris(doc.sections) : await keyProductPhotoLinks(doc.sections, opts.photos.href);
  return { ...doc, keyProductPhotos, rewardsLine: purchasePerksDocLine(perks) };
}
```

- [ ] **Step 5: Create `src/lib/quote-share/photo-response.ts`.**

```ts
import { createHash } from "node:crypto";
import { getBlobStream } from "@/lib/blob";
import { keyProductPhotoDocs, PHOTO_TYPES } from "@/lib/narrative/photos";
import type { QuoteRevision } from "@/lib/stores/quotes";
import type { SpecSection } from "@/app/(app)/estimator/types";
import type { PartDocument } from "@/lib/part-docs/types";

/**
 * #293 slice 3 (spec §5.4) — the online pages' photos. Both photo routes
 * recompute, live, the photo docs the quote's latest SENT revision prints
 * (keyProductPhotoDocs over that revision's sections: narrative systems'
 * resolved, photo-on blocks of live parts) and serve only a member — PNG,
 * JPEG or WebP, nosniff, private 1 h, an ETag on doc id + blobKey hash (the
 * portal doc route's scheme). Anything else is a plain 404. Read-only.
 */

export const ONLINE_PHOTO_CACHE = "private, max-age=3600";

export function revisionSections(rev: QuoteRevision): SpecSection[] {
  const spec = rev.spec as { sections?: unknown } | null | undefined;
  return spec && Array.isArray(spec.sections) ? (spec.sections as SpecSection[]) : [];
}

export async function photoDocForRevision(rev: QuoteRevision, docId: string): Promise<PartDocument | null> {
  if (typeof docId !== "string" || !docId) return null;
  const docs = await keyProductPhotoDocs(revisionSections(rev));
  for (const d of docs.values()) if (d.id === docId) return d;
  return null;
}

/** A fresh Response per call — a body can be read only once. */
const notFound = () => new Response("Not found", { status: 404 });

export async function servePhotoForRevision(req: Request, rev: QuoteRevision, docId: string): Promise<Response> {
  const doc = await photoDocForRevision(rev, docId);
  if (!doc || !doc.blobKey || !PHOTO_TYPES.has(doc.contentType)) return notFound();
  const etag = `"${doc.id}-${createHash("sha1").update(doc.blobKey).digest("hex").slice(0, 16)}"`;
  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { etag, "cache-control": ONLINE_PHOTO_CACHE } });
  }
  let stream: ReadableStream | null;
  try {
    stream = await getBlobStream(doc.blobKey);
  } catch {
    // Never surface the vendor's own error text to the browser.
    return new Response("Couldn't read the file — try again", { status: 502 });
  }
  if (!stream) return notFound();
  return new Response(stream, {
    headers: {
      "content-type": doc.contentType,
      "cache-control": ONLINE_PHOTO_CACHE,
      etag,
      "x-content-type-options": "nosniff",
    },
  });
}
```

- [ ] **Step 6: Run the gates.**

```bash
export PATH=$HOME/.local/node/bin:$PATH
npx tsc --noEmit
npm run test:specs 2>&1 | tail -3
npx eslint "src/app/(app)/estimator/quote-document.tsx" src/lib/quote-pdf/document-loader.ts src/lib/quote-share/photo-response.ts
```
Expected: tsc 0; ALL PASSED (previous + this block, including every existing `#293 print:` baseline check); eslint 0.

- [ ] **Step 7: Commit.**

```bash
git add "src/app/(app)/estimator/quote-document.tsx" src/lib/quote-pdf/document-loader.ts src/lib/quote-share/photo-response.ts scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(quote-pdf): #293 slice 3 — one web loader (sent version), layout="web", scoped photo response

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Portal estimate page, portal photo route, portal row link

**Files:**
- Modify: `src/lib/quote-pdf/portal-access.ts`
- Create: `src/components/online-estimate/online-estimate.tsx`
- Create: `src/app/portal/quotes/[id]/page.tsx`
- Create: `src/app/portal/quotes/[id]/photo/[docId]/route.ts`
- Modify: `src/app/portal/quote-row.tsx`
- Modify: `scripts/smoke-routes.ts` (add-only, 4 routes)
- Test: `scripts/test-review-and-spec.ts` (append block `#293 slice 3 — portal page`)

**Interfaces:**
- **Consumes:** `onlineEstimateState`, `onlineHeaderLine`, `onlineView`, `ONLINE_COPY` (Task 1); `bomViewProps`,
  `offersBomView` (Task 1); `QUOTE_WEB_CSS`, `QuoteDocumentProps`, `loadQuoteDocumentProps`, `servePhotoForRevision`
  (Task 3); `resolvePortalViewer`, `portalListsQuote`, `isImportedHistoryQuote`, `portalQuotePdfSource`,
  `PortalShell`, `PortalSignedOut`, `portalNav`, `getCart`.
- **Produces:**
  - `portal-access.ts`: `portalOnlineEstimateState(q: Quote, customerId: string): OnlineEstimateState`.
  - `online-estimate.tsx`: `OnlineEstimateView(props)` and `OnlineEstimateCard(props)` (server components; exact prop
    types below).

- [ ] **Step 1: Write the failing harness block.** Append:

```ts
/* ======================================================================
   #293 slice 3 — the portal estimate page: who may see what, the page and
   photo route wiring, the row link, and the smoke routes.
   ====================================================================== */
import { portalOnlineEstimateState as n293tPortalState } from "@/lib/quote-pdf/portal-access";
{
  const rev = { rev: 1, at: 5000, by: "t", reason: "sent", note: "", name: "N", value: 1, margin: 0, status: "sent", spec: { sections: [] } };
  const pq = (extra: Record<string, unknown>) =>
    ({ id: "Q-p", name: "P", customer: "C", customerId: "c1", locationId: null, value: 1, margin: 0, status: "sent", source: "estimator", quoteType: "system",
       owner: "o", createdAt: 1, updatedAt: 1, history: [], review: {}, revisions: [rev], ...extra }) as unknown as N293tQuote;
  ok(n293tPortalState(pq({}), "c1").kind === "ok", "#293t portal: the customer's sent quote → ok");
  ok(n293tPortalState(pq({}), "c2").kind === "unavailable" && n293tPortalState(pq({}), "").kind === "unavailable", "#293t portal: another customer, or no customer → unavailable");
  ok(n293tPortalState(pq({ source: "daylite" }), "c1").kind === "unavailable", "#293t portal: Daylite history → unavailable");
  ok(n293tPortalState(pq({ status: "draft" }), "c1").kind === "revising", "#293t portal: a staff quote recalled after sending → the being-revised card (decision 16), own customer only");
  ok(n293tPortalState(pq({ status: "draft", revisions: [] }), "c1").kind === "unavailable", "#293t portal: a never-sent draft → unavailable");

  const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const resolveLocal = (from: string, spec: string): string | null => {
    const b = spec.startsWith("@/") ? join("src", spec.slice(2)) : spec.startsWith(".") ? join(dirname(from), spec) : null;
    if (!b) return null;
    for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx", ""]) {
      const p = b + ext;
      if ((ext || /\.(ts|tsx)$/.test(p)) && existsSync(join(process.cwd(), p))) return p;
    }
    return null;
  };
  const valueImports = (s: string) => [...s.matchAll(/^import (?!type )[\s\S]*? from "([^"]+)";/gm)].map((m) => m[1]);
  const noClientImports = (file: string) =>
    valueImports(rd(file)).every((spec) => {
      const p = resolveLocal(file, spec);
      return !p || !/^\s*["']use client["']/.test(rd(p));
    });
  const page = rd("src/app/portal/quotes/[id]/page.tsx");
  const comp = rd("src/components/online-estimate/online-estimate.tsx");
  ok(!/["']use client["']/.test(page) && !/["']use client["']/.test(comp) && noClientImports("src/app/portal/quotes/[id]/page.tsx") && noClientImports("src/components/online-estimate/online-estimate.tsx"),
    "#293t portal page: server-rendered; no client component it imports can receive the quote's data");
  ok(page.indexOf("resolvePortalViewer(") > -1 && page.indexOf("resolvePortalViewer(") < page.indexOf("getQuote(") && page.includes("portalOnlineEstimateState(q, cid)") &&
     page.includes("loadQuoteDocumentProps(q, {") && page.includes("revision: state.rev,") && page.includes("ONLINE_COPY.portalUnavailable") && page.includes("ONLINE_COPY.revising") && page.includes("<PortalSignedOut"),
    "#293t portal page: the viewer first, then the one state rule; the sent revision; the signed-out, unavailable and revising cards");
  ok(!page.includes("notFound(") && !/\b(update|patchShareLink|ensureShareLink|revokeShareLink|addQuoteRevision|setStatus|mergeUpsert)\(/.test(page),
    "#293t portal page: every miss is a 200 card; the page never writes");
  ok(comp.includes("<QuoteDocument {...shown} layout=\"web\" />") && comp.includes("bomViewProps(docProps)") && comp.includes("offersBomView(docProps.sections, docProps.detail)") &&
     (comp.match(/prefetch=\{false\}/g) || []).length >= 3 && comp.includes("ONLINE_COPY.closed") && comp.includes("<style>{QUOTE_WEB_CSS}</style>"),
    "#293t online view: the web document, a server-side BOM transform behind two plain links, the closed banner");
  const photo = rd("src/app/portal/quotes/[id]/photo/[docId]/route.ts");
  ok(photo.includes("resolvePortalViewer(") && /rateLimit\(rlKey, 300, 60_000\)/.test(photo) && photo.includes("portalOnlineEstimateState(q, session.customerId)") &&
     photo.includes("servePhotoForRevision(req, state.rev, docId)") && photo.includes("`portal-photo:${session.grantId}`"),
    "#293t portal photos: a portal viewer, 300/min per grant, the quote's own sent revision, only its printed photos");
  const row = rd("src/app/portal/quote-row.tsx");
  ok(row.includes("portalOnlineEstimateState(q, cid).kind") && row.includes("`/portal/quotes/${encodeURIComponent(q.id)}`") && row.includes("Open PDF ↗"),
    "#293t portal row: the title opens the online estimate when it's ok or being revised; the PDF link stays");
  const smoke = rd("scripts/smoke-routes.ts");
  ok(['"/portal/quotes/Q-2041",', '"/portal/quotes/Q-2041?preview=lakefront",', '"/portal/quotes/Q-2041?preview=lakefront&view=bom",', '"/portal/quotes/Q-0?preview=lakefront",'].every((r) => smoke.includes(r)),
    "#293t smoke: the portal estimate page's signed-out, unavailable and BOM-param routes are smoke routes");
}
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npm run test:specs 2>&1 | tail -5`
Expected: tsx reports that `portalOnlineEstimateState` is not exported (or the run aborts on the missing file read).

- [ ] **Step 3: Add `portalOnlineEstimateState` to `src/lib/quote-pdf/portal-access.ts`.**

Change the first import line to
`import { isImportedHistoryQuote, portalListsQuote, type Quote } from "@/lib/stores/quotes";`, add
`import { onlineEstimateState, type OnlineEstimateState } from "@/lib/quote-share/view";`, and append:

```ts
/**
 * #293 slice 3 — the portal estimate page's rule (spec §5.2, decision 16):
 * the quote must be this customer's and not Daylite history; then the one
 * online rule decides. A staff quote recalled to draft after sending shows
 * the "being revised" card (no content) — portalListsQuote hides staff
 * drafts, so the list rule alone would call it unavailable. Content (ok)
 * still requires the portal's list rule.
 */
export function portalOnlineEstimateState(q: Quote, customerId: string): OnlineEstimateState {
  if (!customerId || q.customerId !== customerId || isImportedHistoryQuote(q)) return { kind: "unavailable" };
  const s = onlineEstimateState(q);
  if (s.kind === "ok" && !portalListsQuote(q, customerId)) return { kind: "unavailable" };
  return s;
}
```

- [ ] **Step 4: Create `src/components/online-estimate/online-estimate.tsx`.**

```tsx
import Link from "next/link";
import type { CSSProperties } from "react";
import QuoteDocument, { QUOTE_WEB_CSS, type QuoteDocumentProps } from "@/app/(app)/estimator/quote-document";
import { bomViewProps, offersBomView } from "@/app/(app)/estimator/quote-document-view";
import { ONLINE_COPY } from "@/lib/quote-share/view";

/**
 * #293 slice 3 — the online estimate, shared by the portal page and the share
 * page (spec §5.2–§5.3, §5.7). Server components only: the document is
 * QuoteDocument (layout="web"), the Narrative / BOM toggle is two plain links
 * whose BOM transform runs here on the server, and no client component ever
 * receives the quote's data.
 */

const seg: CSSProperties = { display: "inline-flex", background: "#e4e7ec", borderRadius: 8, padding: 2 };
const segItem = (on: boolean): CSSProperties => ({
  fontSize: 12.5,
  fontWeight: 600,
  padding: "6px 14px",
  borderRadius: 6,
  textDecoration: "none",
  color: on ? "#16181d" : "#5b616e",
  background: on ? "#fff" : "transparent",
  boxShadow: on ? "0 1px 2px rgba(0,0,0,.1)" : "none",
});
const plainLink: CSSProperties = { fontSize: 13, fontWeight: 600, color: "var(--accent)", textDecoration: "none" };

export function OnlineEstimateView({
  docProps,
  view,
  headerLine,
  closed,
  narrativeHref,
  bomHref,
  pdfHref,
  backHref,
}: {
  docProps: QuoteDocumentProps;
  view: "narrative" | "bom";
  headerLine: string;
  closed: boolean;
  narrativeHref: string;
  bomHref: string;
  pdfHref: string | null;
  backHref: string | null;
}) {
  const offers = offersBomView(docProps.sections, docProps.detail);
  const showBom = offers && view === "bom";
  const shown = showBom ? bomViewProps(docProps) : docProps;
  return (
    <div>
      <style>{QUOTE_WEB_CSS}</style>
      <div className="pk-no-print" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", minWidth: 0 }}>
          {backHref && (
            <Link href={backHref} prefetch={false} style={plainLink}>
              ← Back
            </Link>
          )}
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#5b616e" }}>{headerLine}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {offers && (
            <nav aria-label="Estimate view" style={seg}>
              <Link href={narrativeHref} prefetch={false} aria-current={!showBom ? "page" : undefined} style={segItem(!showBom)}>
                Narrative
              </Link>
              <Link href={bomHref} prefetch={false} aria-current={showBom ? "page" : undefined} style={segItem(showBom)}>
                BOM
              </Link>
            </nav>
          )}
          {pdfHref && (
            <a href={pdfHref} target="_blank" rel="noopener noreferrer" style={plainLink}>
              Download PDF
            </a>
          )}
        </div>
      </div>
      {closed && (
        <div role="status" style={{ marginBottom: 14, padding: "11px 16px", background: "#fbf3dd", border: "1px solid #f0e2bd", borderRadius: 10, fontSize: 13, fontWeight: 600, color: "#8a6d1f" }}>
          {ONLINE_COPY.closed}
        </div>
      )}
      <QuoteDocument {...shown} layout="web" />
    </div>
  );
}

/** The one 200 card for every non-document outcome. */
export function OnlineEstimateCard({ title, pdfHref = null, backHref = null }: { title: string; pdfHref?: string | null; backHref?: string | null }) {
  return (
    <div style={{ maxWidth: 460, margin: "48px auto 0", background: "#fff", border: "1px solid #e4e7ec", borderRadius: 14, padding: "30px 28px", textAlign: "center" }}>
      <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.5 }}>{title}</div>
      {(pdfHref || backHref) && (
        <div style={{ display: "flex", justifyContent: "center", gap: 18, marginTop: 14 }}>
          {pdfHref && (
            <a href={pdfHref} target="_blank" rel="noopener noreferrer" style={plainLink}>
              Open PDF ↗
            </a>
          )}
          {backHref && (
            <Link href={backHref} prefetch={false} style={plainLink}>
              ← Back
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Create `src/app/portal/quotes/[id]/page.tsx`.**

```tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getSettings } from "@/lib/settings";
import { get as getCustomer } from "@/lib/stores/customers";
import { get as getQuote } from "@/lib/stores/quotes";
import { getCart } from "@/lib/stores/portal-carts";
import { resolvePortalViewer } from "@/lib/portal-viewer";
import { portalOnlineEstimateState, portalQuotePdfSource } from "@/lib/quote-pdf/portal-access";
import { loadQuoteDocumentProps } from "@/lib/quote-pdf/document-loader";
import { ONLINE_COPY, onlineHeaderLine, onlineView } from "@/lib/quote-share/view";
import { OnlineEstimateCard, OnlineEstimateView } from "@/components/online-estimate/online-estimate";
import { PortalShell } from "../../shell";
import { PortalSignedOut } from "../../signed-out";
import { portalNav } from "../../nav";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettings();
  return { title: `Estimate — ${s.companyName || "Peak Systems Group"}`, robots: { index: false, follow: false } };
}

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

/**
 * Portal estimate page — `/portal/quotes/[id]` (#293 slice 3, spec §5.2). The
 * latest SENT revision as a web page with a Narrative / BOM toggle. The
 * viewer comes from resolvePortalViewer only (a portal grant, or a team
 * preview on ?preview=<cid>); then portalOnlineEstimateState decides: the
 * document (lost = closed banner), the being-revised card, or one 200 card
 * for everything else (unknown, another customer's, never sent, service) —
 * nothing hints whether the quote exists. Read-only.
 */
export default async function PortalQuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp, settings] = await Promise.all([params, searchParams, getSettings()]);
  const companyName = settings.companyName || "Peak Systems Group";
  const { session, preview } = await resolvePortalViewer(one(sp.preview));
  if (!session) {
    return (
      <PortalShell companyName={companyName} logoLight={settings.logoLight || null}>
        <PortalSignedOut companyName={companyName} />
      </PortalShell>
    );
  }
  const cid = session.customerId;
  const [q, cust, cart] = await Promise.all([
    getQuote(id),
    getCustomer(cid),
    // The nav's Cart (N) — never read in a team preview.
    preview ? Promise.resolve(null) : getCart(session.grantId, cid),
  ]);
  const state = q ? portalOnlineEstimateState(q, cid) : ({ kind: "unavailable" } as const);
  const pv = preview ? `preview=${encodeURIComponent(cid)}` : "";
  const withQs = (path: string, extra = "") => {
    const qs = [extra, pv].filter(Boolean).join("&");
    return path + (qs ? "?" + qs : "");
  };
  const base = `/portal/quotes/${encodeURIComponent(id)}`;
  const backHref = withQs("/portal");
  const shell = (children: ReactNode) => (
    <PortalShell
      companyName={companyName}
      logoLight={settings.logoLight || null}
      person={{ name: session.name, customer: cust?.name || "your organization" }}
      nav={portalNav("home", preview ? { previewCid: cid } : { cartCount: cart?.lines.length ?? 0 })}
    >
      {children}
    </PortalShell>
  );

  if (!q || state.kind === "unavailable") {
    const pdfHref = q && portalQuotePdfSource(q, cid) ? withQs(base + "/pdf") : null;
    return shell(<OnlineEstimateCard title={ONLINE_COPY.portalUnavailable} pdfHref={pdfHref} backHref={backHref} />);
  }
  if (state.kind === "revising") return shell(<OnlineEstimateCard title={ONLINE_COPY.revising} backHref={backHref} />);

  const docProps = await loadQuoteDocumentProps(q, {
    revision: state.rev,
    photos: { href: (docId) => withQs(`${base}/photo/${encodeURIComponent(docId)}`) },
  });
  return shell(
    <OnlineEstimateView
      docProps={docProps}
      view={onlineView(sp.view)}
      headerLine={onlineHeaderLine(q, state.rev)}
      closed={state.closed}
      narrativeHref={withQs(base)}
      bomHref={withQs(base, "view=bom")}
      pdfHref={portalQuotePdfSource(q, cid) ? withQs(base + "/pdf") : null}
      backHref={backHref}
    />
  );
}
```

  If `portalNav`'s `cartCount` or `getCart`'s return type differ from what's shown, follow
  `src/app/portal/my-quotes/page.tsx`, which makes exactly these calls.

- [ ] **Step 6: Create `src/app/portal/quotes/[id]/photo/[docId]/route.ts`.**

```ts
import { resolvePortalViewer } from "@/lib/portal-viewer";
import { rateLimit } from "@/lib/rate-limit";
import { get as getQuote } from "@/lib/stores/quotes";
import { portalOnlineEstimateState } from "@/lib/quote-pdf/portal-access";
import { servePhotoForRevision } from "@/lib/quote-share/photo-response";

export const dynamic = "force-dynamic";

/**
 * A key-product photo on the portal estimate page (#293 slice 3, spec §5.4).
 * Portal viewer only; the quote must pass portalOnlineEstimateState as ok,
 * and the doc must be one its latest SENT revision prints. Anything else is
 * a plain 404 — no hint whether the quote or the document exists. Read-only.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await ctx.params;
  const { session, preview } = await resolvePortalViewer(new URL(req.url).searchParams.get("preview") || "");
  if (!session) return new Response("Not found", { status: 404 });
  const rlKey = preview ? `portal-photo:preview:${session.customerId}` : `portal-photo:${session.grantId}`;
  if (!rateLimit(rlKey, 300, 60_000).ok) return new Response("Too many requests", { status: 429 });
  const q = await getQuote(id);
  const state = q ? portalOnlineEstimateState(q, session.customerId) : null;
  if (!state || state.kind !== "ok") return new Response("Not found", { status: 404 });
  return servePhotoForRevision(req, state.rev, docId);
}
```

- [ ] **Step 7: Link the portal row's title in `src/app/portal/quote-row.tsx`.**

  - Add `import { portalOnlineEstimateState, portalQuotePdfPreparing, portalQuotePdfSource } from "@/lib/quote-pdf/portal-access";`
    in place of the existing `portal-access` import line (same module, one more name).
  - Replace the `const title = pdfHref ? ( … ) : ( q.name );` statement with:

```tsx
  // #293 slice 3: the title opens the online estimate when there's a sent
  // version to show (or the being-revised card); else the PDF, as before.
  const online = portalOnlineEstimateState(q, cid).kind;
  const onlineHref =
    online === "ok" || online === "revising"
      ? `/portal/quotes/${encodeURIComponent(q.id)}` + (preview ? `?preview=${encodeURIComponent(cid)}` : "")
      : null;
  const title = onlineHref ? (
    <Link href={onlineHref} prefetch={false} style={{ color: "inherit", textDecoration: "none" }}>
      {q.name}
    </Link>
  ) : pdfHref ? (
    <a href={pdfHref} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none" }}>
      {q.name}
    </a>
  ) : (
    q.name
  );
```

  Leave the "Open PDF ↗" link and everything else unchanged. `Link` is already imported.

- [ ] **Step 8: Add the portal smoke routes to `scripts/smoke-routes.ts` (add-only).** In `ROUTES`, right after the
  `"/portal/service?from=x",` line, add:

```ts
  // #293 slice 3 — the online estimate page. No seeded quote has a sent
  // revision, so these cover the 200 cards (signed out; not available, in a
  // team preview) and compile the page; the document itself is harness-
  // rendered (#293 slice 3 blocks). Q-0 is an unknown id.
  "/portal/quotes/Q-2041",
  "/portal/quotes/Q-2041?preview=lakefront",
  "/portal/quotes/Q-2041?preview=lakefront&view=bom",
  "/portal/quotes/Q-0?preview=lakefront",
```

- [ ] **Step 9: Run the gates.**

```bash
export PATH=$HOME/.local/node/bin:$PATH
npx tsc --noEmit
npm run test:specs 2>&1 | tail -3
npx eslint src/lib/quote-pdf/portal-access.ts src/components/online-estimate/online-estimate.tsx "src/app/portal/quotes/[id]/page.tsx" "src/app/portal/quotes/[id]/photo/[docId]/route.ts" src/app/portal/quote-row.tsx scripts/smoke-routes.ts
df -h /System/Volumes/Data | tail -1
rm -rf .next && env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npx next build 2>&1 | tail -15
```
Expected: tsc 0; ALL PASSED (previous + this block); eslint 0; build OK and its route list shows
`/portal/quotes/[id]` and `/portal/quotes/[id]/photo/[docId]`.

- [ ] **Step 10: Commit.**

```bash
git add src/lib/quote-pdf/portal-access.ts src/components/online-estimate/online-estimate.tsx "src/app/portal/quotes/[id]/page.tsx" "src/app/portal/quotes/[id]/photo/[docId]/route.ts" src/app/portal/quote-row.tsx scripts/smoke-routes.ts scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(portal): #293 slice 3 — online estimate page with Narrative / BOM toggle + scoped photos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Share page, share photo route, middleware, headers, service worker

**Files:**
- Create: `src/app/share/layout.tsx`
- Create: `src/app/share/quote/[id]/[token]/page.tsx`
- Create: `src/app/share/quote/[id]/[token]/photo/[docId]/route.ts`
- Modify: `src/middleware.ts`
- Modify: `next.config.ts`
- Modify: `public/sw.js`
- Modify: `scripts/smoke-routes.ts` (add-only, 2 routes)
- Test: `scripts/test-review-and-spec.ts` (append block `#293 slice 3 — share page`)

**Interfaces:**
- **Consumes:** `resolveSharedQuote`, `SHARE_VIEW_PER_MIN`, `SHARE_PHOTO_PER_MIN` (Task 2); `clientIp`,
  `clientIpFromHeaders`, `rateLimit`; `sharePath`, `onlineHeaderLine`, `onlineView`, `ONLINE_COPY` (Task 1);
  `loadQuoteDocumentProps`, `servePhotoForRevision` (Task 3); `OnlineEstimateView`, `OnlineEstimateCard` (Task 4).
- **Produces:** the public routes `/share/quote/[id]/[token]` and `/share/quote/[id]/[token]/photo/[docId]`.

- [ ] **Step 1: Write the failing harness block.** Append:

```ts
/* ======================================================================
   #293 slice 3 — the share page: outside the team login, one card for
   every failure, no index / no Referer, rate limits, read-only, photos
   scoped to the sent revision, never cached by the service worker.
   ====================================================================== */
{
  const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const mw = rd("src/middleware.ts");
  const m = mw.match(/matcher:\s*\[\s*"([^"]+)"/);
  const re = new RegExp("^" + (m ? m[1].replace(/\\\\/g, "\\") : "$^") + "$");
  ok(!re.test("/share/quote/Q-1/" + "1." + "A".repeat(43)) && !re.test("/share/quote/Q-1/x/photo/PD-1"), "#293t middleware: /share/* skips the team login (it checks its own token)");
  ok(re.test("/shareholders") && re.test("/") && re.test("/catalog/documents") && !re.test("/print/quote/Q-1") && !re.test("/portal/quotes/Q-1"),
    "#293t middleware: only share/ is newly exempt; app pages still go through the login gate");
  ok(mw.includes("|portal|") && mw.includes("|print/|share/|") && mw.includes("/share/quote/[id]/[token]"), "#293t middleware: the exemption sits beside print/ and the doc comment names the route");

  const page = rd("src/app/share/quote/[id]/[token]/page.tsx");
  ok(page.indexOf("rateLimit(") > -1 && page.indexOf("rateLimit(") < page.indexOf("resolveSharedQuote(") && page.includes('"share-view:" + ') && page.includes("SHARE_VIEW_PER_MIN"),
    "#293t share page: the per-IP rate limit runs before anything is read");
  ok(page.includes("robots: { index: false, follow: false }") && page.includes('referrer: "no-referrer"') && page.includes('export const dynamic = "force-dynamic";'),
    "#293t share page: never indexed, never leaks the token in a Referer, never cached");
  ok((page.match(/ONLINE_COPY\.shareInactive/g) || []).length === 1 && page.includes("ONLINE_COPY.revising") && page.includes("ONLINE_COPY.tooMany") && !page.includes("notFound("),
    "#293t share page: one 'isn't active' card for every failure, all 200");
  ok(!page.includes("/pdf") && !page.includes("pdfHref={pdf") && page.includes("pdfHref={null}"), "#293t share page: no PDF link (the PDF route needs a portal session)");
  ok(!/\b(update|patchShareLink|ensureShareLink|revokeShareLink|addQuoteRevision|setStatus|mergeUpsert|rateLimitRefund)\(/.test(page) && !page.includes("cookies(") && !page.includes("auth("),
    "#293t share page: read-only, and it never reads or sets a session");
  ok(!/["']use client["']/.test(page) && !/["']use client["']/.test(rd("src/app/share/layout.tsx")), "#293t share page: server-rendered, with its own minimal layout");
  const photo = rd("src/app/share/quote/[id]/[token]/photo/[docId]/route.ts");
  ok(photo.indexOf("rateLimit(") < photo.indexOf("resolveSharedQuote(") && photo.includes('"share-photo:" + clientIp(req)') && photo.includes("SHARE_PHOTO_PER_MIN") &&
     photo.includes("servePhotoForRevision(req, hit.state.rev, docId)") && photo.includes('hit.state.kind !== "ok"'),
    "#293t share photos: rate-limited per IP, the same token check as the page, only the sent revision's printed photos");
  const cfg = rd("next.config.ts");
  ok(/source: "\/share\/:path\*"[\s\S]{0,300}"Referrer-Policy", value: "no-referrer"[\s\S]{0,200}"X-Robots-Tag", value: "noindex, nofollow"/.test(cfg) &&
     cfg.indexOf('source: "/share/:path*"') > cfg.indexOf('value: "DENY"'),
    "#293t headers: /share/* answers no-referrer + noindex, after the global headers");
  const sw = rd("public/sw.js");
  ok(sw.includes('requested.pathname.startsWith("/share/")') && sw.includes('target.pathname.startsWith("/share/")'), "#293t service worker: a share page (its token in the URL) is never cached");
  const smoke = rd("scripts/smoke-routes.ts");
  ok(smoke.includes(`"/share/quote/Q-2041/0.${"A".repeat(43)}",`) && smoke.includes('"/share/quote/Q-2041/not-a-token",'), "#293t smoke: a well-formed but invalid token and a malformed one are smoke routes (both 200 cards)");
}
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npm run test:specs 2>&1 | tail -5`
Expected: the run aborts reading `src/app/share/quote/[id]/[token]/page.tsx` (ENOENT), or FAILs on the middleware
checks.

- [ ] **Step 3: Exempt `share/` in `src/middleware.ts`.**
  - In the matcher string, replace `|print/|` with `|print/|share/|`. Nothing else in the string changes.
  - In the doc comment, after the sentence ending "…and 404s without one.", add:
    ` /share/quote/[id]/[token] is the client share page (#293 slice 3): a`
    ` public, read-only view of a quote's latest sent version that checks its`
    ` own HMAC token (lib/quote-share) and never reads either session.`

- [ ] **Step 4: Add the `/share/:path*` headers to `next.config.ts`.** In `headers()`, append this entry after the
  `/portal/catalog/doc/:id` entry:

```ts
      // #293 slice 3: the client share page carries its token in the path —
      // never pass it on in a Referer, and never index it.
      {
        source: "/share/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
```

- [ ] **Step 5: Never cache share pages in `public/sw.js`.**
  - In `cacheableDocument`, after the line
    `if (requested.pathname === "/login" || requested.pathname.startsWith("/api/")) return false;` add:
    `  if (requested.pathname.startsWith("/share/")) return false; // #293: a token URL is never kept`
  - In the `CACHE_ROUTE` message handler, change
    `if (target.origin !== self.location.origin || target.pathname.startsWith("/api/") || target.pathname === "/login") return;`
    to
    `if (target.origin !== self.location.origin || target.pathname.startsWith("/api/") || target.pathname === "/login" || target.pathname.startsWith("/share/")) return;`

- [ ] **Step 6: Create `src/app/share/layout.tsx`.**

```tsx
import type { ReactNode } from "react";

/**
 * #293 slice 3 — the client share page's frame: outside the (app) group, so
 * no team layout, nav or session. The root layout still sets the fonts and
 * --accent.
 */
export default function ShareLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "#edeef1", fontFamily: "var(--font-ui)", color: "#16181d" }}>
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "24px 16px 40px" }}>{children}</div>
    </div>
  );
}
```

- [ ] **Step 7: Create `src/app/share/quote/[id]/[token]/page.tsx`.**

```tsx
import type { Metadata } from "next";
import { headers } from "next/headers";
import { clientIpFromHeaders, rateLimit } from "@/lib/rate-limit";
import { resolveSharedQuote, SHARE_VIEW_PER_MIN } from "@/lib/quote-share/links";
import { loadQuoteDocumentProps } from "@/lib/quote-pdf/document-loader";
import { ONLINE_COPY, onlineHeaderLine, onlineView, sharePath } from "@/lib/quote-share/view";
import { OnlineEstimateCard, OnlineEstimateView } from "@/components/online-estimate/online-estimate";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Estimate", robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * The client share page — `/share/quote/[id]/[token]` (#293 slice 3, spec
 * §5.3, §7). No login: the middleware exempts share/, and the page never
 * reads or sets a session. Order: per-IP rate limit → resolveSharedQuote
 * (shape check with no read → get → HMAC verify → online state). Valid + ok:
 * the latest SENT version, layout="web", the Narrative / BOM links, the
 * closed banner when lost, and no PDF link. Valid + revising: the
 * being-revised card. Anything else — bad, expired, revoked or tampered
 * token, unknown id, never sent — the ONE "isn't active" card, 200. Read-only:
 * no view tracking.
 */
export default async function SharedQuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id, token }, sp] = await Promise.all([params, searchParams]);
  const ip = clientIpFromHeaders(await headers());
  if (!rateLimit("share-view:" + ip, SHARE_VIEW_PER_MIN, 60_000).ok) return <OnlineEstimateCard title={ONLINE_COPY.tooMany} />;
  const hit = await resolveSharedQuote(id, token);
  const state = hit?.state;
  if (!hit || !state || state.kind === "unavailable") return <OnlineEstimateCard title={ONLINE_COPY.shareInactive} />;
  if (state.kind === "revising") return <OnlineEstimateCard title={ONLINE_COPY.revising} />;
  const base = sharePath(hit.q.id, token);
  const docProps = await loadQuoteDocumentProps(hit.q, {
    revision: state.rev,
    photos: { href: (docId) => `${base}/photo/${encodeURIComponent(docId)}` },
  });
  return (
    <OnlineEstimateView
      docProps={docProps}
      view={onlineView(sp.view)}
      headerLine={onlineHeaderLine(hit.q, state.rev)}
      closed={state.closed}
      narrativeHref={base}
      bomHref={base + "?view=bom"}
      pdfHref={null}
      backHref={null}
    />
  );
}
```

- [ ] **Step 8: Create `src/app/share/quote/[id]/[token]/photo/[docId]/route.ts`.**

```ts
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { resolveSharedQuote, SHARE_PHOTO_PER_MIN } from "@/lib/quote-share/links";
import { servePhotoForRevision } from "@/lib/quote-share/photo-response";

export const dynamic = "force-dynamic";

/**
 * A key-product photo on the share page (#293 slice 3, spec §5.4). The same
 * token check as the page; the doc must be one the quote's latest SENT
 * revision prints. Anything else is a plain 404. Read-only.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; token: string; docId: string }> }) {
  const { id, token, docId } = await ctx.params;
  if (!rateLimit("share-photo:" + clientIp(req), SHARE_PHOTO_PER_MIN, 60_000).ok) return new Response("Too many requests", { status: 429 });
  const hit = await resolveSharedQuote(id, token);
  if (!hit || hit.state.kind !== "ok") return new Response("Not found", { status: 404 });
  return servePhotoForRevision(req, hit.state.rev, docId);
}
```

- [ ] **Step 9: Add the share smoke routes to `scripts/smoke-routes.ts` (add-only).** Right after the four
  `/portal/quotes/…` lines from Task 4, add (the token is `0.` followed by exactly 43 `A`s):

```ts
  // #293 slice 3 — the signed share page: a well-formed but invalid token
  // (verified and refused) and a malformed one (refused before any read) —
  // both the one 200 "isn't active" card.
  "/share/quote/Q-2041/0.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "/share/quote/Q-2041/not-a-token",
```

  Smoke runs with a team session cookie, which the share route ignores; it can't detect a missing middleware
  exemption — the harness regex check above does.

- [ ] **Step 10: Run the gates.**

```bash
export PATH=$HOME/.local/node/bin:$PATH
npx tsc --noEmit
npm run test:specs 2>&1 | tail -3
npx eslint src/middleware.ts next.config.ts src/app/share/layout.tsx "src/app/share/quote/[id]/[token]/page.tsx" "src/app/share/quote/[id]/[token]/photo/[docId]/route.ts" scripts/smoke-routes.ts
df -h /System/Volumes/Data | tail -1
rm -rf .next && env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npx next build 2>&1 | tail -15
```
Expected: tsc 0; ALL PASSED (previous + this block); eslint 0 (`public/sw.js` isn't linted); build OK, listing
`/share/quote/[id]/[token]` and its photo route.

- [ ] **Step 11: Commit.**

```bash
git add src/middleware.ts next.config.ts public/sw.js src/app/share scripts/smoke-routes.ts scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(share): #293 slice 3 — signed no-login share page, scoped photos, no-referrer/noindex, never SW-cached

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Final gates (smoke + build), browser check, docs

**Files:**
- Modify: `PUNCHLIST.md`, `DECISIONS.md`, `AGENTS.md`

- [ ] **Step 1: Full gates on the branch.**

```bash
export PATH=$HOME/.local/node/bin:$PATH
ps aux | grep -E "tsx|next dev" | grep -v grep   # stop any stray before smoke (it boots its own server)
lsof -nP -iTCP -sTCP:LISTEN | grep -E ":3000|:3100" || true
df -h /System/Volumes/Data | tail -1
npx tsc --noEmit
npm run test:specs 2>&1 | tail -3
git diff --name-only origin/main...HEAD | grep -E '^(src/.*\.(ts|tsx)|next\.config\.ts)$' | xargs npx eslint
rm -rf .next && env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npx next build 2>&1 | tail -20
rm -rf .next && npm run test:smoke 2>&1 | tail -15
```
Expected: tsc 0; test:specs 0 FAIL (record PASS and the slice-3 count = PASS − 10,626); eslint 0 errors on the
changed files; build OK; smoke **193/193 ALL PASSED** (187 + 6). Record every number for the docs.

- [ ] **Step 2: Controller browser check (scratch datadir — never `.data/pglite`).** Follow
  `peak-exercising-post-routes-safely` / `peak-worktree-dev-server-browser-verification-traps` in memory: boot `next dev`
  on a scratch `PGLITE_PATH`, same `AUTH_SECRET` as main, `localhost` not `127.0.0.1`, unregister the SW on first
  compile.
  1. Sign in (dev login, an Admin). Open `/estimator`, link the customer `lakefront`, add a system with one catalog
     line, star it as a key product, set the system to Narrative with an intro, Save.
  2. Customer preview: the **Client link** block shows **Copy client link** disabled, titled "Send the quote first — …".
  3. Send the quote (Approve & send). Back in Customer preview: **Copy client link** → "Link copied." (or the manual
     field), and "Expires <date> · created by <name>".
  4. Edit the intro after sending, Save (don't send).
  5. Open `/portal/quotes/<id>?preview=lakefront`: the **sent** intro shows (not the edit), header
     "EST-#### · Rev N · sent <date>", **Narrative / BOM** toggle (BOM shows the line), Download PDF. `/portal?preview=lakefront`:
     the row title opens this page.
  6. Open the copied link in a private window (no session): the same sent version and toggle, no PDF link; check
     `<meta name="referrer" content="no-referrer">` and the `Referrer-Policy: no-referrer` response header.
  7. Resize to 375 px wide (both pages): no horizontal scroll, the header grid stacks, padding 16 px.
  8. Recall the quote to draft (status → Draft): the share link and the portal page show "This estimate is being
     revised — …" with no content. Send again; mark it Lost: both show the document under "This estimate is closed."
  9. **Revoke** → inline confirm → **Revoke link**: reload the private window → "This link isn’t active. …". A tampered
     token and `/share/quote/Q-0/<token>` show the same card.
  10. No console errors on any page. Local dev has no Blob store, so the photo route isn't exercised end to end
      (harness-covered, as in Slice 1).

- [ ] **Step 3: Recompute the D-numbers across every ref, right before writing.** Other sessions' unmerged branches hold
  numbers (e.g. `feat/photo-sheet` holds D546–D548 and #294).

```bash
git fetch origin --quiet
for r in $(git for-each-ref --format='%(refname)' refs/heads refs/remotes); do
  git show "$r:DECISIONS.md" 2>/dev/null | grep -oE '^## D[0-9]+' | sed 's/## D//'
done | sort -n | tail -1
```
Let `N` = that number + 1 (at the time of writing: max D552 → N = 553, unless a ref holds more). Slice 3 uses
`D{N}`…`D{N+5}`. Also `grep -n "D{N}\|D{N+5}"` every ref's DECISIONS.md once more just before committing.

- [ ] **Step 4: Append the six DECISIONS entries** (substitute the real numbers for `{N}`…`{N+5}`), after D552:

```markdown
## D{N}. The client share link: an HMAC over a stored nonce, 60 days, Revoke rotates (#293 slice 3, 2026-10-01)

Token `<exp>.<base64url HMAC-SHA256(AUTH_SECRET, "share:quote:<id>:<nonce>:<exp>")>`, domain-separated from the print
token; the nonce lives only on the quote (`shareLink`), so a nonce alone can't make a token. Verify fails closed
(no secret, revoked, malformed, exp ≠ stored, expired, over 366 days, non-finite clock, MAC mismatch via
`timingSafeEqual`). Default 60 days; Copy again returns the same link; Revoke writes a fresh nonce AND expiry 0.
Create/revoke need Send, answered inline (`can("send")`, the D542 idiom, not `requirePerm`'s redirect); the status
read gives the path only to Send holders. `shareLink` is written by `patchShareLink`, which never bumps `updatedAt`
(the printed date, the portal sort key and the approval version check) and isn't a content field. Rotating
`AUTH_SECRET` kills every link. (Spec decision 14, §2.6, §5.5, §7.)

## D{N+1}. One online rule; every miss is a 200 card (#293 slice 3, 2026-10-01)

`onlineEstimateState`: a system quote with a sent revision, status sent/won/lost (lost = "This estimate is closed.");
back in draft after a send = "being revised", no content, no PDF. The portal page uses `portalOnlineEstimateState`
(same customer, not Daylite, then the rule) so a recalled staff quote shows "being revised" — `portalListsQuote` hides
staff drafts and would have said "isn't available". The share page shows one identical "isn't active" card for every
failure; the rate-limited page is a 200 card too (an App Router page can't answer 429; the photo routes do). No view
tracking — a public GET never writes. (Spec decisions 14, 16, §2.7, §5.2, §5.3.)

## D{N+2}. Revisions freeze the printed header; the web loader renders the sent version (#293 slice 3, 2026-10-01)

Every new revision carries `docFields` (customer, venue, contact, cover note, assumptions, timeframe, prepared by,
owner, terms, payment terms, `pdfOptions`, `portalFirm`, source); `contactName` freezes as null when absent so the
document still falls back to the primary contact. Recall ignores it. `quoteAsOfRevision` + `loadQuoteDocumentProps`
render the revision's body, header, Rev N and date; older revisions read the live header. The print route is NOT yet
on the loader: #292 rewrites that route and three harness pins hold its calls, so the two are pinned to the same calls
and converge after #292 merges. (Spec §1.5, §5.1.)

## D{N+3}. Narrative / BOM is a server-side view transform behind two links (#293 slice 3, 2026-10-01)

`bomViewProps` (in `quote-document-view.ts`, harness-loadable): every system itemized, quantities and descriptions
on, prices as the quote chose, appendix off. The toggle shows whenever the body left a system un-itemized (a
narrative system, or By section). No client component receives quote data. (Spec decision 15, §2.3, §5.2.)

## D{N+4}. `layout="web"`, scoped photos, no Referer, no SW cache (#293 slice 3, 2026-10-01)

`layout="web"` is fluid to 740 px with `QUOTE_WEB_CSS` (phone padding < 600 px, stacked header/signature grids,
photo above its paragraph < 480 px, sheet chrome > 760 px); without it the document is byte-identical. Photos stream
through two routes that serve only docs the latest sent revision prints (PNG/JPEG/WebP, nosniff, private 1 h, ETag on
id + blobKey hash). `/share/*` answers `Referrer-Policy: no-referrer` + `X-Robots-Tag: noindex, nofollow`, and the
service worker never caches it (token URLs stay out of Cache Storage). (Spec §5.4, §5.7, §7.)

## D{N+5}. Client link lives in the customer preview only (#293 slice 3, 2026-10-01)

The Client link block (Copy client link · Expires … · created by … · Revoke with an inline confirm) sits in the
customer preview sidebar. The toolbar ⋯ is `QuoteNextStep`'s server-evaluated approval menu shared with the Quotes
hub, so the spec's toolbar copy is left out. (Spec §5.5.)
```

- [ ] **Step 5: Update `PUNCHLIST.md` #293.**
  - The heading's "— Slices 1–2 DONE 2026-10-01 (D539–D545, D549–D552)" becomes
    "— Slices 1–3 DONE 2026-10-01 (D539–D545, D549–D552, D{N}–D{N+5})".
  - Replace the line `**Slice 3.** Portal estimate page, signed share link, Narrative / BOM toggle (spec §5, §8.3).`
    with:

```markdown
**Slice 3 DONE (D{N}–D{N+5}).**
- **Portal estimate page** `/portal/quotes/<id>`: the latest SENT version online, Narrative / BOM toggle, Download
  PDF, "This estimate is closed." on a lost quote, "being revised" (no content) when recalled. Portal rows open it.
- **Client link** (customer preview → Client link): Copy client link (60 days, same link until revoked), Revoke. Needs
  Send; a never-sent or recalled quote can't get one.
- **Share page** `/share/quote/<id>/<token>`: no login, read-only, the same document and toggle, no PDF link; one
  "This link isn’t active" card for every failure; no-referrer, noindex, never cached by the service worker.
- **Photos** stream through scoped routes serving only what the sent version prints. New revisions freeze the printed
  header (`docFields`).
- **Plan:** `docs/superpowers/plans/2026-10-01-narrative-slice3.md`.

Gates: tsc 0; test:specs <PASS> PASS / 0 FAIL (<n> for #293 slice 3); test:smoke 193/193 ALL PASSED; `next build` OK;
eslint 0 on the changed src files.
Browser: <one sentence from Step 2's real result>.

**Rollback.** Removing Slice 3 removes the routes: copied links 404 until it's redeployed. `docFields` and `shareLink`
are additive JSONB that older code ignores.
```

  - Under **For Jeff**, add:
    - "Client links: copy them from production only — preview deploys share the production DB and a link copied there
      carries the preview origin."
    - "Spec §12 q4 — is 60 days right for a client link?"
    - "The print route moves onto the shared loader after #292 merges (follow-up)."
    - "After #292 merges, cut sheets stay PDF-only — the online pages don't show them. Want them online too?"

- [ ] **Step 6: Update `AGENTS.md` item 32.** Change its title to
  `32. ✅ **Narrative-first client preview — Slices 1–3** (#293, D539–D545, D549–D552, D{N}–D{N+5}) —` and replace the
  sentence "Slice 3 (client link) follows." with:
  "Slice 3 puts the latest SENT version online: `/portal/quotes/[id]` and a signed no-login
  `/share/quote/[id]/[token]` (HMAC over a stored nonce, 60 days, Revoke rotates; Send to copy), one
  `onlineEstimateState` rule, a server-side Narrative / BOM toggle, `layout=\"web\"`, scoped photo routes, revisions
  freezing the printed header (`docFields`); the print route joins the shared loader after #292 merges."

- [ ] **Step 7: Commit the docs.**

```bash
git add PUNCHLIST.md DECISIONS.md AGENTS.md
git commit -m "$(cat <<'EOF'
docs: #293 slice 3 — PUNCHLIST, DECISIONS, AGENTS

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review (done while writing)

- **Spec coverage.** §1.5 → Task 1 (`docFields`, `revisionDocFields`, snapshot annex) + Task 2 DB check. §1.6 → Task 1
  type + Task 2 store/links. §2.3 `bomViewProps` → Task 1. §2.6 → Task 1. §2.7 → Task 1 (`onlineEstimateState`) +
  Task 2 (`shareLinkView` in links.ts, adaptation: needs `node:crypto`). §5.1 → Task 3 (print route deferred,
  adaptation 1). §5.2 → Task 4. §5.3 → Task 5 (+ `clientIpFromHeaders` in Task 1). §5.4 → Task 3 helper + Tasks 4–5
  routes. §5.5 → Task 2 (toolbar deferred, adaptation 7). §5.6 → Task 3 never-render check + Global Constraints. §5.7
  → Task 3. §6 rows (re-sent → newest sent revision; recalled; lost; won; never-sent; service; pre-#293 revision;
  expired/revoked/tampered; `AUTH_SECRET` rotated) → Tasks 1, 2, 4, 5 checks. §7 → Global Constraints + Tasks 1, 2, 5.
  §8.3 → Task 6 browser check. §9.1 slice 3 → Tasks 1–5 blocks; §9.2 → Tasks 4–5 smoke lines; §9.3 → Task 6 Step 2.
  §10 → Task 6 rollback note and For-Jeff lines.
- **Type consistency.** `OnlineEstimateState`, `ShareLinkView`, `ShareLinkStatus`, `ShareWrite`, `QuoteShareLink`,
  `QuoteRevisionDocFields`, `DocPhotos` are each defined once and used with the same names in later tasks.
