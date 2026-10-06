# Two-prong estimate output — Slice B Implementation Plan (#301)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Slice B (spec Phases 3 + 6) of #301. The client link becomes a **per-revision, frozen estimate package**: a
v2 token pins one sent revision, and the share page renders a new `PackageView` for it. The page has a header with the
grand total, the overall summary, one section per scope (client goals, intro, key products with photos, scope price),
a Narrative / BOM toggle (Qty · Manufacturer · Part · Description, no prices), add options, Not included, and the
estimate's own totals lines. A newer send shows a **superseded** banner, a recall shows **revising**, and a lost quote
shows **closed**. Staff copy the v2 link and see each sent revision's **opens**, which a client-side beacon records.
Opens also show as a chip on the Quotes hub row and as a line in the lead drawer.

**Architecture:**
- **Pure, client-safe core:** `src/lib/quote-share/package-view.ts` (`packageState`, `canAct`, banners, per-rev rows,
  opens chip/line, all customer copy), `src/lib/estimate-output/opens.ts` (`nextOpens`, cleaning, the summary string),
  `src/lib/estimate-output/bom.ts` (BOM rows with **no money field**), `src/lib/estimate-output/package-model.ts` (frozen
  fields, the photo set, `packageViewModel`). `scopes.ts` (Slice A) gains `introBlocks` + `keyProducts`.
- **Server:** `token.ts` gains v2 sign/parse/verify; `links.ts` gains `pathV2`, `resolveSharedPackage`,
  `recordSharedOpen` and the per-rev rows; `quotes.ts` gains the store-owned `shareOpens` + `recordShareOpen`;
  `src/lib/estimate-output/package-loader.ts` builds the page props from the existing web loader.
- **UI:** `src/components/estimate-output/package-view.tsx` (server component, pure props, no image import, Slice C
  mount points). The share page branches to `package-page.tsx` on a v2 token. An `OpenBeacon` client island calls
  `recordShareOpenAction`. The photo route accepts both token versions. The Client link panel copies v2 and lists
  each sent revision with its opens. Plus the Quotes hub chip and the lead-drawer line.

**Tech Stack:** Next.js 16 App Router, TypeScript, React 19 server + client components, Drizzle/PGlite doc-store,
`node:crypto`, tsx harness (`scripts/test-review-and-spec.ts`), `react-dom/server` for Node renders.

**Spec:** `docs/superpowers/specs/2026-10-05-two-prong-estimate-output-design.md`. This plan covers **Slice B only**:
§2 (`token.ts` v2, `package-view.ts`, `bom.ts`, `opens.ts`, and the `scopes.ts` narrative/key-product/BOM extension),
§5 (Phase 3), §6's photo-route line, §8 (Phase 6), D-g, D-h, D-o and the Slice B rows of §11–§12. The "Spec-review
corrections" R1–R20 override the earlier decisions where they conflict. **R1, R6, R11, R12, R18** apply here.

**Builds on:** Slice A (`docs/superpowers/plans/2026-10-05-estimate-output-slice-a.md`) as landed on
`feat/301-estimate-package`: `src/lib/estimate-output/{fields,scopes}.ts` (on disk since `e752d76f`), and
`goals.ts`, `cover.ts`, `cover-loader.ts`, `stores/estimate-output-defaults.ts`, `components/estimate-output/cover-document.tsx`
(landing now). Also #293 slice 3: `quote-share/{token,links,view,photo-response}.ts`, `quote-pdf/document-loader.ts`
(`loadQuoteDocumentProps`, `keyProductPhotoLinks`), `components/online-estimate/online-estimate.tsx`
(`OnlineEstimateCard`), the share page and photo route, and the `ClientLinkPanel`. **Before each task, read the real
Slice A code it touches.** Where a Slice A name differs from what this plan quotes, use the real one and say so in the
task report.

## Spec points the shipped code forces this plan to adapt

These are deliberate. Each one is logged in DECISIONS at docs time (Task 11).

1. **`ShareLinkView.path` stays the v1 path; the v2 path is a new optional `pathV2`.** The #293t harness pins
   `made.link.path` to the v1 shape (`/\/\d+\.[A-Za-z0-9_-]{43}$/`) and resolves it with the v1 `resolveSharedQuote`.
   Copy client link now copies `link.pathV2 ?? link.path`. The cover's link line (Slice A `coverShareUrl`) prints
   `pathV2 ?? path`. Existing v1 links keep #293's behavior: latest sent, no actions, no tracking.
2. **The v2 page lives in its own server component** (`src/app/share/quote/[id]/[token]/package-page.tsx`). `page.tsx`
   only adds one early branch after the rate limit. The #293t pins require exactly one `ONLINE_COPY.shareInactive` in
   `page.tsx`, no `shareLink` / `quoteAsOfRevision` / `auth(` / `cookies(` there, and `rateLimit(` before
   `resolveSharedQuote(`.
3. **The package page never calls `quoteAsOfRevision`.** A #293t binding pin allows that call only in
   `document-loader.ts` and `view.ts`. The package loader goes through `loadQuoteDocumentProps(q, { revision, photos:
   { href } })`, which already fails closed for anything but this quote's own sent revision.
4. **R12 reads `rev.docFields` directly.** `quoteAsOfRevision` spreads `docFields` over the **live** quote. On a
   revision cut before #301 (no `coverSummary` key) the as-sent quote would therefore carry the live, unsent summary.
   `packageFrozenFields(rev.docFields, default)` reads the frozen keys only: absent → `""`. `notIncluded: null` (the
   quote never stored one — Slice A adaptation 9) → today's Settings default, the same rule the cover printed. A string
   is used as is.
5. **Key products show on every scope, not only Narrative-presentation ones.** QuoteDocument prints key products only
   for `presentation: "narrative"` systems, and `keyProductPhotoDocs` reads photos only for those. The package's
   Narrative view is page-wide, so the v2 photo set is every printed system's blocks with the presentation forced to
   narrative (`packagePhotoSections`). The v1 photo set is unchanged. A scope with no intro and no key products shows
   its cover paragraph. If that paragraph is the staff placeholder, the scope shows "The full parts list for this
   scope is under BOM." instead. `[needs a paragraph]` never reaches a client.
6. **BOM rows attach in `package-model.ts`, not `scopes.ts`.** Slice A's harness pins `scopes.ts` to value-import only
   pricing, narrative, quote-document-view, rewards/points and `./fields`. `OutputScope` gains `introBlocks` and
   `keyProducts`, both from `narrative.ts`. `packageViewModel` adds each scope's `bom`.
7. **`canAct` = ok and status `sent`.** Won, lost, superseded, revising and inactive pages get no actions. Slice C uses
   this rule. Accepting a won quote is meaningless, and D-m never changes status.
8. **Open dedupe reuses `rateLimit(key, 1, 30 min)`.** The key is `share-open:<id>:<rev>:<sha256(ip)[0..16]>`. Under
   `next dev` the limiter's map resets per request (the note in `rate-limit.ts`), so every reload counts there. Dedupe
   is visible only under `next start` or production. The browser check expects +1 per reload.
9. **Server actions under `Referrer-Policy: no-referrer`.** Next compares `Origin` with `Host`
   (`node_modules/next/dist/server/app-render/action-handler.js:427-458`). A fetch-mode action call keeps a real
   `Origin` under no-referrer. A no-JS form post would send `Origin: null` and be refused. The beacon uses the fetch
   path. The browser check proves it (the open count moves). Slice C's forms must stay JS-submitted.
10. **v2 domain separation** uses the spec's string verbatim: `share:quote:<id>:<rev>:<nonce>:<exp>`. A v1 string has
    five `:`-separated fields after `share`; a v2 string has six. The nonce is base64url with no `:`. Each quote's nonce
    is its own 32 random bytes, so neither MAC can stand in for the other. The harness checks both directions.
11. **Per-rev rows are visible to any signed-in user** (the status action is `requireUser` only). Paths stay
    Send-only. The rows carry no paths, only Rev N, superseded and opens.
12. **The lead drawer reads the converted quote it already loads** (`leadRec.convertedQuoteId` in `leads/page.tsx`
    `:314`). There is no new query and no `leadId` scan.
13. **Opens are recorded for v2 links only.** The v1 page stays byte-for-byte #293.

## Global Constraints

**Workspace and environment**
- Work only in `/Users/sm/Downloads/peak-app-299`, branch `feat/301-estimate-package`. Run
  `export PATH=$HOME/.local/node/bin:$PATH` before any `npx`/`npm`. Other agents may be committing on this branch:
  **`git add` only your own files, never `git stash`, never `git reset`.** Pull nothing; commit on top.
- Read `AGENTS.md` first. For any Next API you touch, read its doc under `node_modules/next/dist/docs/01-app/`:
  `03-api-reference/04-functions/headers.md` (`headers()` is **async**), `03-api-reference/01-directives/use-server.md`,
  `02-guides/data-security.md` ("Allowed origins"), `03-api-reference/03-file-conventions/page.md` (`params` /
  `searchParams` are Promises), `03-api-reference/03-file-conventions/route.md`.
- **Never open `/Users/sm/Downloads/peak-app/.data/pglite`.** `npm run test:specs` and `npm run test:smoke` use their own
  temp datadirs. Before either, `ps aux | grep -E "tsx|next dev" | grep -v grep` and stop strays.
- **Disk:** `df -h /System/Volumes/Data | tail -1` before test:specs or a build. Above ~90 %, run
  `find $TMPDIR -maxdepth 1 \( -name 'tmp.*' -o -name 'peak-build-db-*' -o -name 'peak-smoke-*' \) -type d -mmin +60 -exec rm -rf {} +`.
  `rm -rf .next` before every `next build`.

**Code rules**
- **Client components** (`"use client"`) never value-import `@/lib/stores/*`, `@/db/*`, `@/lib/session`, `@/lib/blob`,
  `@/lib/users`, `@/lib/settings`, `@/lib/narrative/(library|photos)`, `@/lib/quote-share/(token|links|photo-response)`,
  `@/lib/quote-pdf/*` server modules, `@/lib/estimate-output/(package-loader|cover-loader|survey-goals-server)`.
  Type-only imports and `"use server"` action files are fine. Only `next build` shows that break.
- **Pure, client-safe files** — `quote-share/package-view.ts`, `estimate-output/{opens,bom,package-model}.ts`, and
  `components/estimate-output/package-view.tsx` — value-import only what their harness purity pin lists. Never
  value-import `quote-document.tsx` (it imports a `.jpg`).
- **`"use server"` files export only async functions.** **A page file exports only Next's page fields**; a route file only
  `GET` + segment config.
- **No AI and no external service** (D89).
- **Server actions never throw into a transition.** A client `await` of an action sits in `try { … } catch { … }`
  (the beacon swallows failures; it has no UI).
- **No `window.confirm()`.** **Timestamps are epoch-ms numbers.**

**Never on the client page (spec §10)** — cost, margin, tier, line/unit sell, `sellOverride`, internal notes, room, labor
groups, vendor terms/notes, owner email, datasheet gaps, response lists, **opens**, `shareLink`, nonces, blob paths,
any other revision's content. `PackageBomRow` has no money field. `PackageViewProps` carries only formatted strings and
blocks.

**Token and state rules (D-g, D-h, R11)**
- v2 token = `<exp>.<rev>.<mac>`, `exp` and `rev` with no leading zero, `rev` 1–6 digits, MAC = base64url HMAC-SHA256 over
  `share:quote:<id>:<rev>:<nonce>:<exp>`. The nonce and expiry are the existing per-quote `shareLink` (no storage change).
  Revoke kills every token.
- `rev` = `QuoteRevision.rev` (1-based array position, manual snapshots included). Everything printed says
  `sentDocumentStamp(q, rev).revNo` ("Rev 2").
- State precedence: not a system quote / pinned rev missing or not `sent` / status outside sent·won·lost·draft →
  **inactive**; pinned ≠ latest sent → **superseded**; status draft → **revising**; else **ok** (`closed` = lost,
  `won` = won).

**Copy (verbatim)**
- Banners: `A newer version of this estimate was sent <Mon D, YYYY>.` + link `View the current version`;
  `Peak is revising this estimate.`; closed = `ONLINE_COPY.closed` (`This estimate is closed.`).
- Page: `Summary`, `Your goals`, `Narrative`, `BOM`, BOM headers `Qty` `Manufacturer` `Part` `Description`,
  `The full parts list for this scope is under BOM.`, `No parts listed for this scope.`, `Add options`, `Not included`,
  title fallback `Estimate`.
- Opens: `Rev 2 · opened 3× · first Oct 5 · last Oct 6`, `Rev 2 · not opened yet`, an older rev
  `Rev 1 — superseded · …`; hub chip `Opened` (title `Client link — <rows>`); lead drawer `Client link — <latest row>`.

**Existing harness pins — do not break them** (every old check that fails means change your new code, never the check)
- `src/app/share/quote/[id]/[token]/page.tsx`: everything in the `#293t share page` block (`scripts/test-review-and-spec.ts`
  ~`:48189-48224`). That includes `rateLimit(` before `resolveSharedQuote(`, exactly one `ONLINE_COPY.shareInactive`,
  `pdfHref={null}`, `revision: ok.rev`, `!docProps`, `clientIpFromHeaders(await headers()) || "unknown"`, and none of
  `update(` `patchShareLink(` `ensureShareLink(` `revokeShareLink(` `addQuoteRevision(` `setStatus(` `mergeUpsert(`
  `rateLimitRefund(` `cookies(` `auth(` `quoteAsOfRevision` `shareLink` `generateMetadata`.
- `src/app/share/quote/[id]/[token]/photo/[docId]/route.ts`: `rateLimit(` before `resolveSharedQuote(`,
  `rateLimit("share-photo:" + (clientIp(req) || "unknown"), SHARE_PHOTO_PER_MIN, 60_000)`,
  `servePhotoForRevision(req, hit.state.rev, docId)`, `hit.state.kind !== "ok"`, no `quoteAsOfRevision` / `shareLink`.
- `src/lib/quote-share/photo-response.ts`: `keyProductPhotoDocs(revisionSections(rev))`, `PHOTO_TYPES.has(doc.contentType)`,
  `"x-content-type-options": "nosniff"`, `"private, max-age=3600"`, `createHash("sha1").update(doc.blobKey)`.
- `src/lib/quote-share/token.ts`: `timingSafeEqual(want, have)`, `` `share:quote:${quoteId}:${nonce}:${exp}` ``,
  the `/api/sync/pull ships whole quote` comment.
- `src/lib/quote-share/view.ts`: value imports only `@/lib/quote-pdf/state` and `@/lib/estimate-number`.
- `src/lib/quote-share/links.ts`: no `newShareNonce`, no `shareLink =`, `let refusal = null as string | null;`,
  `if (!cur.shareLink) return { ok: true };` before the revoke call.
- `src/lib/stores/quotes.ts`: `patchShareLink` is the only `.shareLink = ` writer; `update()` keeps
  `delete clean.shareLink;`.
- `src/app/(app)/estimator/client-link-panel.tsx`: `"use client"`, no server value import, `navigator.clipboard.writeText(`,
  `ONLINE_COPY.revokeConfirm`, `Copy client link`, `created by`, ≥ 3 `catch {`, ≥ 4 `await reload();`, the focus /
  visibilitychange listeners, no `confirm(`.
- `src/app/(app)/estimator/share-actions.ts`: unchanged.
- Binding: `quoteAsOfRevision(` is called only in `document-loader.ts` and `view.ts`; no client component imports
  `quote-pdf/document-loader` or `quote-share/photo-response`.
- Slice A: `scopes.ts` value-import pin; the `coverShareUrl` checks (a link with no `pathV2` still prints its `path`).
- `src/middleware.ts`, `next.config.ts`, `public/sw.js`, `src/app/share/layout.tsx`,
  `src/components/online-estimate/online-estimate.tsx`, `src/lib/quote-pdf/document-loader.ts`,
  `src/app/(app)/estimator/quote-document.tsx`: **not edited**.

**Harness**
- Each task appends its sync checks at the **end** of `scripts/test-review-and-spec.ts` under a
  `/* ===… #301 slice B — <part> …=== */` banner. Imports use the `e301b<x>` / `E301b<x>` alias prefix (`e301bt` token,
  `e301bs` state/opens, `e301bl` links, `e301bb` BOM/model, `e301bv` view, `e301bp` page/loader, `e301bc` panel, `e301bw`
  open writes, `e301bd` displays) and sit right above their block.
- Async DB checks: Task 3 declares `async function estimateOutput301BAsyncChecks()` and chains it with
  `.then(() => estimateOutput301BAsyncChecks())` **right after** `.then(() => estimateOutput301AAsyncChecks())` (the
  current last link, `scripts/test-review-and-spec.ts:10794`), before `.finally(() => teardownFixtures())`. Later tasks add
  their own `async function e301b<Part>AsyncChecks()` and append one `await e301b<Part>AsyncChecks();` line at the end of
  `estimateOutput301BAsyncChecks`'s body.
- Fixtures: `const { fixtureId } = await import("./test-fixtures");` inside each async function. `registerFixture(coll, id)`
  is in module scope. Use `fixtureId(301, "b-<slug>")`. `readFileSync`, `join`, `p293Props`, `p293Sections` are module scope.

**Gates per task** (report real numbers)
- `npx tsc --noEmit` → 0 errors.
- `npm run test:specs 2>&1 | tail -3` → `ALL PASSED`, 0 FAIL. Baseline: whatever Slice A's last task reports (re-measure in
  Task 1 Step 0). Every later task reports PASS = previous + its new checks.
- ESLint: **before the first edit** of each task, `npx eslint <the non-harness files that task modifies>` and note the counts.
  Afterwards, run the same command plus the task's new files: no new errors or warnings. Never lint
  `scripts/test-review-and-spec.ts` (it crashes whole-file eslint; pre-existing).
- `rm -rf .next && env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npx next build 2>&1 | tail -20` on Tasks 6, 7, 8, 9 (routes /
  client components) and again in Task 10.
- Task 10 adds `npm run test:smoke` (baseline = Slice A's final count, expected **209**). This slice adds 3 routes →
  **212/212**.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/lib/quote-share/token.ts` | modify | `SHARE_TOKEN_V2_RE`, `signShareTokenV2`, `verifyShareTokenV2`, `ParsedShareToken`, `parseShareToken`, `isShareTokenV2` |
| `src/lib/estimate-output/opens.ts` | create | Pure: `ShareOpenStat`, `ShareOpens`, `SHARE_OPEN_DEDUPE_MS`, `MAX_OPEN_REVS`, `cleanOpens`, `opensFor`, `nextOpens`, `opensSummary` |
| `src/lib/quote-share/package-view.ts` | create | Pure: `PACKAGE_COPY`, `PackageState`, `VisiblePackageState`, `packageState`, `canAct`, `PackageBanner`, `packageBanner`, `SentRevRow`, `sentRevisionRows`, `opensChip`, `latestOpensLine` |
| `src/lib/quote-share/view.ts` | modify | `ShareLinkView.pathV2?`; `ShareLinkStatus.sentRevs` |
| `src/lib/quote-share/links.ts` | modify | `pathV2`; `sentRevs`; `SharedPackage`; `resolveSharedPackage`; `recordSharedOpen`; `SHARE_OPEN_PER_MIN` |
| `src/lib/estimate-output/cover.ts` | modify | `coverShareUrl` prints `pathV2 ?? path` |
| `src/lib/estimate-output/scopes.ts` | modify | `OutputScope.introBlocks`, `.keyProducts` |
| `src/lib/estimate-output/bom.ts` | create | Pure: `PackageBomRow`, `BomCatalogPart`, `LABOR_BOM_DESC`, `MAX_BOM_SKUS`, `bomCatalogSku`, `packageBomSkus`, `packageBomRows` |
| `src/lib/estimate-output/package-model.ts` | create | Pure: `packageFrozenFields`, `packagePhotoSections`, `PackageKeyProduct`, `PackageScopeView`, `PackageViewProps`, `PackageViewInput`, `packageViewModel` |
| `src/components/estimate-output/package-view.tsx` | create | Server component: `PackageView` (default), `PackageSlots`, `PACKAGE_WEB_CSS` |
| `src/lib/estimate-output/package-loader.ts` | create | Server: `loadPackageViewProps` |
| `src/lib/quote-share/photo-response.ts` | modify | `packagePhotoDocForRevision`, `servePackagePhotoForRevision` (shared `serveDoc`) |
| `src/app/share/quote/[id]/[token]/package-page.tsx` | create | Server: `SharedPackagePage` |
| `src/app/share/quote/[id]/[token]/page.tsx` | modify | v2 branch after the rate limit |
| `src/app/share/quote/[id]/[token]/photo/[docId]/route.ts` | modify | v2 branch before the v1 resolve |
| `src/app/share/quote/[id]/[token]/actions.ts` | create | `"use server"`: `recordShareOpenAction` |
| `src/app/share/quote/[id]/[token]/open-beacon.tsx` | create | Client: `OpenBeacon` |
| `src/lib/stores/quotes.ts` | modify | `Quote.shareOpens`; `recordShareOpen`; `update()` strips it |
| `src/app/(app)/estimator/client-link-panel.tsx` | modify | Copy v2; per-rev opens list |
| `src/app/(app)/quotes/page.tsx` | modify | `Opened` chip |
| `src/app/(app)/leads/{types.ts,lib.ts,lead-drawer.tsx}` | modify | `quoteOpensLine` |
| `scripts/smoke-routes.ts` | modify | +3 routes |
| `scripts/test-review-and-spec.ts` | modify | The `#301 slice B` blocks |
| `PUNCHLIST.md`, `DECISIONS.md`, `AGENTS.md` | modify | Task 11 |

## Task overview

| # | Task | Depends on |
|---|---|---|
| 1 | v2 rev-pinned share token: sign / parse / verify | Slice A landed |
| 2 | Pure package state + opens: `packageState`, `canAct`, banners, per-rev rows, `nextOpens` | 1 |
| 3 | Links server: `pathV2`, `resolveSharedPackage`, per-rev status rows, cover link line → v2 | 1, 2 |
| 4 | BOM rows + scope extension + the pure package model | 2 |
| 5 | `PackageView` component + web/print CSS + Slice C mount points | 4 |
| 6 | Package loader, share page v2 branch, photo route v2, smoke routes | 3, 4, 5 |
| 7 | Client link panel: Copy v2 + per-rev list | 3 |
| 8 | Open tracking: store-owned `shareOpens`, `recordSharedOpen`, action, beacon | 3, 6 |
| 9 | Opens display: Quotes hub chip + lead drawer line | 2, 8 |
| 10 | Final gates (smoke + build) and the browser check | 1–9 |
| 11 | Docs: DECISIONS, PUNCHLIST #301, AGENTS.md | 10 |

---

### Task 1: v2 rev-pinned share token

**Files:**
- Modify: `src/lib/quote-share/token.ts` (append after `verifyShareToken`, `:59`)
- Test: harness block `#301 slice B — token`

**Interfaces:**
- **Consumes:** `SHARE_TOKEN_RE`, `SHARE_MAX_TTL_MS`, the private `mac` idiom (`token.ts`).
- **Produces** (Tasks 3, 6, 8):
  `SHARE_TOKEN_V2_RE: RegExp`;
  `signShareTokenV2(secret: string, quoteId: string, rev: number, nonce: string, exp: number): string`;
  `verifyShareTokenV2(secret: string, token: string, quoteId: string, stored: { nonce: string; expiresAt: number } | null | undefined, nowMs: number): number | null`
  (the pinned rev, or null);
  `type ParsedShareToken = { v: 1; exp: number } | { v: 2; exp: number; rev: number }`;
  `parseShareToken(token: unknown): ParsedShareToken | null`; `isShareTokenV2(token: unknown): boolean`.

- [ ] **Step 0: Baselines.**

```bash
cd /Users/sm/Downloads/peak-app-299 && export PATH=$HOME/.local/node/bin:$PATH
git log --oneline -3
ls src/lib/estimate-output/ src/components/estimate-output/ src/lib/stores/estimate-output-defaults.ts   # Slice A must have landed (cover.ts, cover-loader.ts, the defaults store)
ps aux | grep -E "tsx|next dev" | grep -v grep
df -h /System/Volumes/Data | tail -1
npx tsc --noEmit && echo TSC_OK
npm run test:specs 2>&1 | tail -3          # record PASS / 0 FAIL — the Slice B baseline
npx eslint src/lib/quote-share/token.ts
```
If Slice A's `cover.ts` / `cover-loader.ts` / `estimate-output-defaults.ts` are not on the branch yet, stop and report.
Tasks 3 and 6 need them.

- [ ] **Step 1: Write the failing harness block.** Append at the end of `scripts/test-review-and-spec.ts`:

```ts
/* ======================================================================
   #301 slice B — token: the v2 rev-pinned share token (D-g, R11) —
   sign / parse / verify, domain separation from v1 and print tokens,
   tamper and shape refusals.
   ====================================================================== */
import {
  SHARE_TOKEN_RE as e301btV1Re, SHARE_TOKEN_V2_RE as e301btV2Re, signShareToken as e301btSign1, verifyShareToken as e301btVerify1,
  signShareTokenV2 as e301btSign2, verifyShareTokenV2 as e301btVerify2, parseShareToken as e301btParse, isShareTokenV2 as e301btIsV2,
  newShareNonce as e301btNonce,
} from "@/lib/quote-share/token";
import { signPrintToken as e301btSignPrint } from "@/lib/quote-pdf/token";
{
  const S = "test-secret-301b";
  const NOW = 1_800_000_000_000;
  const nonce = e301btNonce();
  const exp = NOW + 60 * 86_400_000;
  const stored = { nonce, expiresAt: exp };
  const t2 = e301btSign2(S, "Q-1", 3, nonce, exp);
  ok(e301btV2Re.test(t2) && t2.startsWith(`${exp}.3.`) && !e301btV1Re.test(t2), "#301 token v2: <exp>.<rev>.<mac>, never mistaken for a v1 token");
  ok(e301btVerify2(S, t2, "Q-1", stored, NOW) === 3 && e301btVerify2(S, t2, "Q-1", stored, exp) === 3, "#301 token v2: sign → verify returns the pinned rev (valid through exp)");
  const t1 = e301btSign1(S, "Q-1", nonce, exp);
  ok(e301btVerify2(S, t1, "Q-1", stored, NOW) === null && !e301btVerify1(S, t2, "Q-1", stored, NOW), "#301 token v2: v1 and v2 never verify as each other");
  const mac = t2.split(".")[2];
  ok(e301btVerify2(S, `${exp}.4.${mac}`, "Q-1", stored, NOW) === null, "#301 token v2: the rev is inside the MAC — a token edited to another rev ✗");
  ok(e301btVerify2(S, t2, "Q-2", stored, NOW) === null && e301btVerify2(S, t2, "Q-1", { nonce: e301btNonce(), expiresAt: exp }, NOW) === null &&
     e301btVerify2(S, t2, "Q-1", { nonce, expiresAt: 0 }, NOW) === null && e301btVerify2(S, t2, "Q-1", stored, exp + 1) === null &&
     e301btVerify2(S, t2, "Q-1", { nonce, expiresAt: exp + 1 }, NOW) === null,
    "#301 token v2: another quote, a rotated nonce, revoked, expired, a changed expiry ✗");
  ok(e301btVerify2(S, `${exp}.3.${mac[0] === "A" ? "B" : "A"}${mac.slice(1)}`, "Q-1", stored, NOW) === null, "#301 token v2: a tampered MAC ✗");
  ok(["", `${exp}.0.${mac}`, `${exp}.03.${mac}`, `0${t2}`, `${t2}A`, `${exp}.1234567.${mac}`, `${exp}.-1.${mac}`, `${exp}.3`].every((t) => e301btVerify2(S, t, "Q-1", stored, NOW) === null),
    "#301 token v2: malformed tokens (rev 0, a leading zero, an oversize rev, extra chars, no MAC) ✗");
  ok(e301btVerify2(S, t2, "Q-1", stored, NaN) === null && e301btVerify2("", t2, "Q-1", stored, NOW) === null && e301btVerify2("other", t2, "Q-1", stored, NOW) === null &&
     e301btVerify2(S, t2, "Q-1", null, NOW) === null && e301btVerify2(S, t2, "Q-1", { nonce: "", expiresAt: exp }, NOW) === null,
    "#301 token v2: no clock, no secret, the wrong secret, no stored link, an empty nonce ✗");
  const far = NOW + 367 * 86_400_000;
  ok(e301btVerify2(S, e301btSign2(S, "Q-1", 3, nonce, far), "Q-1", { nonce, expiresAt: far }, NOW) === null, "#301 token v2: a TTL over 366 days ✗");
  const pt = e301btSignPrint(S, "quote", "Q-1", NOW);
  ok(e301btVerify2(S, pt, "Q-1", { nonce, expiresAt: Number(pt.split(".")[0]) }, NOW) === null, "#301 token v2: a print token never verifies as a share token");
  const p1 = e301btParse(t1);
  const p2 = e301btParse(t2);
  ok(p1?.v === 1 && p1.exp === exp && p2?.v === 2 && p2.exp === exp && p2.rev === 3 && e301btParse("not-a-token") === null && e301btParse(42) === null && e301btParse(null) === null,
    "#301 token parse: v1 | v2 | null");
  ok(e301btIsV2(t2) && !e301btIsV2(t1) && !e301btIsV2("1.1.short") && !e301btIsV2(undefined), "#301 token: isShareTokenV2");
  let threw = 0;
  for (const bad of [0, -1, 1.5, NaN, 1_000_000]) {
    try {
      e301btSign2(S, "Q-1", bad, nonce, exp);
    } catch {
      threw++;
    }
  }
  ok(threw === 5, "#301 token v2: signing refuses a rev that isn't an integer 1–999,999");
  const src = readFileSync(join(process.cwd(), "src/lib/quote-share/token.ts"), "utf8");
  ok(src.includes("`share:quote:${quoteId}:${rev}:${nonce}:${exp}`") && src.includes("`share:quote:${quoteId}:${nonce}:${exp}`") &&
     (src.match(/timingSafeEqual\(want, have\)/g) || []).length === 2,
    "#301 token v2: MAC over share:quote:<id>:<rev>:<nonce>:<exp>; v1 unchanged; both compare in constant time");
}
```

- [ ] **Step 2: Run it to verify it fails.** `npm run test:specs 2>&1 | tail -5` → a TS/import error on `signShareTokenV2`.

- [ ] **Step 3: Append to `src/lib/quote-share/token.ts`** (leave everything above `:59` byte-identical):

```ts

/* ---------------------------------------------------------------------
 * #301 slice B (D-g, R11) — the v2, revision-pinned token:
 * `<exp>.<rev>.<base64url HMAC-SHA256(secret,
 * "share:quote:<id>:<rev>:<nonce>:<exp>")>`. Same per-quote nonce and
 * expiry as v1 (Quote.shareLink — no storage change), so Revoke kills
 * every v1 AND v2 token at once. `rev` is QuoteRevision.rev (the 1-based
 * array position, manual snapshots included) and sits inside the MAC, so a
 * token can't be moved to another revision. Domain separation from v1: the
 * v2 string has one more `:` field, and the nonce (base64url, never `:`)
 * is each quote's own random value — neither MAC can stand in for the
 * other. The shapes never overlap either: v1's MAC group has no `.`.
 * --------------------------------------------------------------------- */
export const SHARE_TOKEN_V2_RE = /^([1-9]\d{0,14})\.([1-9]\d{0,5})\.([A-Za-z0-9_-]{43})$/;
const MAX_TOKEN_REV = 999_999;

function macV2(secret: string, quoteId: string, rev: number, nonce: string, exp: number): string {
  return createHmac("sha256", secret).update(`share:quote:${quoteId}:${rev}:${nonce}:${exp}`).digest("base64url");
}

export function signShareTokenV2(secret: string, quoteId: string, rev: number, nonce: string, exp: number): string {
  if (!secret) throw new Error("AUTH_SECRET is required to sign a share token.");
  if (!nonce || !Number.isSafeInteger(exp) || exp <= 0) throw new Error("A share token needs a nonce and a positive expiry.");
  if (!Number.isSafeInteger(rev) || rev < 1 || rev > MAX_TOKEN_REV) throw new Error("A v2 share token needs a revision number 1–999,999.");
  return `${exp}.${rev}.${macV2(secret, quoteId, rev, nonce, exp)}`;
}

/** The pinned revision when `token` is a valid, unexpired v2 MAC for exactly
 *  this quote id + stored nonce + stored expiry; null otherwise (fails closed). */
export function verifyShareTokenV2(
  secret: string,
  token: string,
  quoteId: string,
  stored: { nonce: string; expiresAt: number } | null | undefined,
  nowMs: number
): number | null {
  if (!secret || typeof token !== "string" || typeof quoteId !== "string" || !quoteId) return null;
  if (!stored || typeof stored.nonce !== "string" || !stored.nonce || typeof stored.expiresAt !== "number") return null;
  if (!(stored.expiresAt > 0)) return null;
  if (!Number.isFinite(nowMs)) return null;
  const m = SHARE_TOKEN_V2_RE.exec(token);
  if (!m) return null;
  const exp = Number(m[1]);
  const rev = Number(m[2]);
  if (!Number.isSafeInteger(exp) || exp !== stored.expiresAt || !Number.isSafeInteger(rev) || rev < 1) return null;
  if (nowMs > exp || exp - nowMs > SHARE_MAX_TTL_MS) return null;
  const want = Buffer.from(macV2(secret, quoteId, rev, stored.nonce, exp));
  const have = Buffer.from(m[3]);
  return want.length === have.length && timingSafeEqual(want, have) ? rev : null;
}

export type ParsedShareToken = { v: 1; exp: number } | { v: 2; exp: number; rev: number };

/** Shape only — never a verification. */
export function parseShareToken(token: unknown): ParsedShareToken | null {
  if (typeof token !== "string") return null;
  const m1 = SHARE_TOKEN_RE.exec(token);
  if (m1) return { v: 1, exp: Number(m1[1]) };
  const m2 = SHARE_TOKEN_V2_RE.exec(token);
  if (m2) return { v: 2, exp: Number(m2[1]), rev: Number(m2[2]) };
  return null;
}

export function isShareTokenV2(token: unknown): boolean {
  return parseShareToken(token)?.v === 2;
}
```

- [ ] **Step 4: Run the gates** (tsc 0; test:specs ALL PASSED, PASS = baseline + 14; eslint on `token.ts` no new findings).

- [ ] **Step 5: Commit.**

```bash
git add src/lib/quote-share/token.ts scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(quote-share): #301 slice B — v2 rev-pinned share token (sign / parse / verify)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Pure package state + opens

**Files:**
- Create: `src/lib/estimate-output/opens.ts`, `src/lib/quote-share/package-view.ts`
- Test: harness block `#301 slice B — package state + opens`

**Interfaces:**
- **Consumes:** `latestSentRevision`, `pdfKindForQuoteType` (`@/lib/quote-pdf/state`); `ONLINE_COPY`, `sentDocumentStamp`
  (`./view`); types `Quote`, `QuoteRevision`.
- **Produces** (Tasks 3–9):
  - `opens.ts`: `type ShareOpenStat = { first: number; last: number; count: number }`;
    `type ShareOpens = Record<string, ShareOpenStat>`; `SHARE_OPEN_DEDUPE_MS = 1_800_000`; `MAX_OPEN_REVS = 100`;
    `cleanOpens(raw: unknown): ShareOpens`; `opensFor(raw: unknown, rev: number): ShareOpenStat | null`;
    `nextOpens(prev: unknown, rev: number, now: number): ShareOpens | null` (null = nothing to write);
    `opensSummary(s: ShareOpenStat | null): string`.
  - `package-view.ts`: `PACKAGE_COPY`; `type PackageState`; `type VisiblePackageState`;
    `packageState(q: Pick<Quote, "quoteType" | "status" | "revisions">, pinnedRev: number): PackageState`;
    `canAct(s: PackageState): boolean`; `type PackageBanner = { tone: "info" | "warn"; text: string; href: string | null; linkText: string | null }`;
    `packageBanner(s: VisiblePackageState, currentHref: string | null): PackageBanner | null`;
    `type OpensSource = { revisions?: QuoteRevision[] | null; shareOpens?: unknown }`;
    `type SentRevRow = { rev: number; revNo: number; sentAt: number; latest: boolean; opens: ShareOpenStat | null; line: string }`;
    `sentRevisionRows(q: OpensSource | null | undefined): SentRevRow[]` (newest first);
    `opensChip(q: OpensSource | null | undefined): { label: string; title: string } | null`;
    `latestOpensLine(q: OpensSource | null | undefined): string`.

- [ ] **Step 1: Write the failing harness block.** Append:

```ts
/* ======================================================================
   #301 slice B — package state + opens: the D-h state matrix
   (ok / superseded / revising / inactive), canAct, the banners, the
   per-revision rows (R11 "Rev N"), and the pure open counter (D-o).
   ====================================================================== */
import {
  packageState as e301bsState, canAct as e301bsCanAct, packageBanner as e301bsBanner, sentRevisionRows as e301bsRows,
  opensChip as e301bsChip, latestOpensLine as e301bsLatest, PACKAGE_COPY as e301bsCopy,
} from "@/lib/quote-share/package-view";
import { nextOpens as e301boNext, cleanOpens as e301boClean, opensFor as e301boFor, opensSummary as e301boSummary, MAX_OPEN_REVS as e301boMax, SHARE_OPEN_DEDUPE_MS as e301boDedupe } from "@/lib/estimate-output/opens";
import { ONLINE_COPY as e301bsOnline } from "@/lib/quote-share/view";
import type { Quote as E301bsQuote, QuoteRevision as E301bsRev } from "@/lib/stores/quotes";
{
  const AT1 = Date.UTC(2026, 9, 5, 15);
  const AT3 = Date.UTC(2026, 9, 6, 15);
  const rev = (n: number, reason: "manual" | "sent", at: number) =>
    ({ rev: n, at, by: "t", reason, note: "", name: "N", value: 1, margin: 0, status: "sent" }) as unknown as E301bsRev;
  const revs = [rev(1, "sent", AT1), rev(2, "manual", AT1 + 1), rev(3, "sent", AT3), rev(4, "manual", AT3 + 1)];
  const q = (status: string, extra: Record<string, unknown> = {}) => ({ quoteType: "system", status, revisions: revs, ...extra }) as unknown as E301bsQuote;

  // ---- state matrix (D-h) ----
  const ok3 = e301bsState(q("sent"), 3);
  ok(ok3.kind === "ok" && ok3.rev.rev === 3 && !ok3.closed && !ok3.won && e301bsCanAct(ok3), "#301 state: the latest sent rev of a sent quote → ok, actions on");
  const won = e301bsState(q("won"), 3);
  const lost = e301bsState(q("lost"), 3);
  ok(won.kind === "ok" && won.won && !e301bsCanAct(won) && lost.kind === "ok" && lost.closed && !e301bsCanAct(lost), "#301 state: won → ok (won), lost → ok (closed); neither can act");
  const sup = e301bsState(q("sent"), 1);
  ok(sup.kind === "superseded" && sup.rev.rev === 1 && sup.latestRev === 3 && sup.sentAt === AT3 && !e301bsCanAct(sup), "#301 state: an older sent rev → superseded, pointing at the latest (its send date); no actions");
  const rv = e301bsState(q("draft"), 3);
  ok(rv.kind === "revising" && rv.rev.rev === 3 && !e301bsCanAct(rv) && e301bsState(q("draft"), 1).kind === "superseded", "#301 state: recalled to draft → revising on the latest; an older rev stays superseded");
  ok([e301bsState(q("sent"), 2), e301bsState(q("sent"), 9), e301bsState(q("sent", { quoteType: "flame_test" }), 3), e301bsState(q("archived"), 3), e301bsState(q("sent", { revisions: [] }), 1)]
     .every((s) => s.kind === "inactive" && !e301bsCanAct(s)),
    "#301 state: a manual rev, an unknown rev, a service quote, an unknown status, no revisions → inactive");
  ok(e301bsState(q("sent", { quoteType: undefined }), 3).kind === "ok", "#301 state: an absent quoteType is a system quote");

  // ---- banners ----
  const b = e301bsBanner(sup as never, "/share/quote/Q-1/x");
  ok(!!b && b.tone === "info" && b.text === "A newer version of this estimate was sent Oct 6, 2026." && b.href === "/share/quote/Q-1/x" && b.linkText === "View the current version",
    "#301 banner: superseded names the newer send's date and links the current version");
  ok(e301bsBanner(sup as never, null)?.href === null && e301bsBanner(rv as never, null)?.text === "Peak is revising this estimate." && e301bsBanner(lost as never, null)?.text === e301bsOnline.closed &&
     e301bsBanner(ok3 as never, null) === null && e301bsBanner(won as never, null) === null,
    "#301 banner: revising, closed, none for an open or won estimate");

  // ---- opens (pure) ----
  const o1 = e301boNext(undefined, 3, AT1);
  const o2 = e301boNext(o1, 3, AT3);
  ok(JSON.stringify(o1) === JSON.stringify({ "3": { first: AT1, last: AT1, count: 1 } }) && o2?.["3"].count === 2 && o2["3"].first === AT1 && o2["3"].last === AT3,
    "#301 opens: first open, then count + last move, first stays");
  ok(e301boNext(o2, 0, AT1) === null && e301boNext(o2, 1.5, AT1) === null && e301boNext(o2, 3, NaN) === null && e301boNext(o2, 1_000_000, AT1) === null, "#301 opens: a bad rev or clock writes nothing");
  const many: Record<string, unknown> = {};
  for (let i = 1; i <= e301boMax; i++) many[String(i)] = { first: 1, last: 1, count: 1 };
  ok(e301boNext(many, e301boMax + 1, AT1) === null && e301boNext(many, 5, AT1)?.["5"].count === 2, "#301 opens: capped at 100 revisions (an existing one still counts)");
  ok(JSON.stringify(e301boClean({ "1": { first: 5, last: 4, count: 1 }, "x": { first: 1, last: 1, count: 1 }, "__proto__": 1, "2": { first: 1, last: 2, count: 0 }, "3": { first: 1, last: 2, count: 2 } })) ===
     JSON.stringify({ "3": { first: 1, last: 2, count: 2 } }) && JSON.stringify(e301boClean([])) === "{}" && e301boFor(null, 3) === null,
    "#301 opens: junk rows, keys and shapes are dropped on read");
  ok(e301boSummary(null) === "not opened yet" && e301boSummary({ first: AT1, last: AT3, count: 3 }) === "opened 3× · first Oct 5 · last Oct 6" && e301boDedupe === 30 * 60_000,
    "#301 opens: the summary line (Chicago dates) and the 30-minute dedupe window");

  // ---- per-revision rows (R11) ----
  const withOpens = { revisions: revs, shareOpens: { "1": { first: AT1, last: AT3, count: 2 } } };
  const rows = e301bsRows(withOpens);
  ok(rows.length === 2 && rows[0].rev === 3 && rows[0].revNo === 2 && rows[0].latest && rows[0].line === "Rev 2 · not opened yet" &&
     rows[1].rev === 1 && rows[1].revNo === 1 && !rows[1].latest && rows[1].line === "Rev 1 — superseded · opened 2× · first Oct 5 · last Oct 6",
    "#301 rows: sent revisions newest first, printed as Rev N (sentDocumentStamp — rev 3 prints Rev 2), with their opens");
  ok(e301bsRows({ revisions: [rev(1, "manual", 1)] }).length === 0 && e301bsRows(null).length === 0, "#301 rows: none before the first send");
  const chip = e301bsChip(withOpens);
  ok(chip?.label === "Opened" && chip.title === "Client link — Rev 1 — superseded · opened 2× · first Oct 5 · last Oct 6" && e301bsChip({ revisions: revs }) === null,
    "#301 chip: \"Opened\" once any sent revision was opened, the rows in its title");
  ok(e301bsLatest(withOpens) === "Client link — Rev 2 · not opened yet" && e301bsLatest({ revisions: revs }) === "" && e301bsCopy.clientLink === "Client link",
    "#301 lead line: the latest revision's row once anything was opened, else nothing");

  // ---- purity ----
  const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  ok(!/^import (?!type)[^\n]*from "(?!@\/lib\/quote-pdf\/state"|\.\/view"|@\/lib\/estimate-output\/opens")/m.test(rd("src/lib/quote-share/package-view.ts")) &&
     !/^import (?!type)/m.test(rd("src/lib/estimate-output/opens.ts")),
    "#301 purity: package-view.ts value-imports only quote-pdf/state, ./view and opens; opens.ts imports nothing");
}
```

- [ ] **Step 2: Run it to verify it fails** (module not found `@/lib/quote-share/package-view`).

- [ ] **Step 3: Create `src/lib/estimate-output/opens.ts`.**

```ts
/**
 * #301 slice B (D-o, R18) — how many times a client opened each sent
 * revision's package link. Pure and client-safe. `Quote.shareOpens` is
 * store-owned (recordShareOpen, under the row lock); everything that reads
 * it goes through cleanOpens, so a malformed doc never throws.
 */

export type ShareOpenStat = { first: number; last: number; count: number };
export type ShareOpens = Record<string, ShareOpenStat>;

/** One open per IP-hash per revision per 30 minutes (in-memory; see links.ts). */
export const SHARE_OPEN_DEDUPE_MS = 30 * 60_000;
export const MAX_OPEN_REVS = 100;
const MAX_COUNT = 1_000_000;
const REV_KEY = /^[1-9]\d{0,5}$/;

function statOf(v: unknown): ShareOpenStat | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const first = typeof o.first === "number" ? o.first : NaN;
  const last = typeof o.last === "number" ? o.last : NaN;
  const count = typeof o.count === "number" ? o.count : NaN;
  if (!(first > 0) || !(last >= first) || !Number.isSafeInteger(count) || count < 1) return null;
  return { first, last, count: Math.min(count, MAX_COUNT) };
}

export function cleanOpens(raw: unknown): ShareOpens {
  const out: ShareOpens = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!REV_KEY.test(k)) continue;
    const s = statOf(v);
    if (s) out[k] = s;
  }
  return out;
}

export function opensFor(raw: unknown, rev: number): ShareOpenStat | null {
  return cleanOpens(raw)[String(rev)] ?? null;
}

/** shareOpens after one more open of `rev` at `now`; null = nothing to write. */
export function nextOpens(prev: unknown, rev: number, now: number): ShareOpens | null {
  if (!Number.isSafeInteger(rev) || rev < 1 || rev > 999_999 || !Number.isFinite(now) || now <= 0) return null;
  const cur = cleanOpens(prev);
  const key = String(rev);
  const s = cur[key];
  if (!s && Object.keys(cur).length >= MAX_OPEN_REVS) return null;
  cur[key] = s ? { first: s.first, last: Math.max(s.last, now), count: Math.min(s.count + 1, MAX_COUNT) } : { first: now, last: now, count: 1 };
  return cur;
}

const shortDate = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });

/** "opened 3× · first Oct 5 · last Oct 6" | "not opened yet". */
export function opensSummary(s: ShareOpenStat | null): string {
  if (!s) return "not opened yet";
  return `opened ${s.count}× · first ${shortDate(s.first)} · last ${shortDate(s.last)}`;
}
```

- [ ] **Step 4: Create `src/lib/quote-share/package-view.ts`.**

```ts
import type { Quote, QuoteRevision } from "@/lib/stores/quotes";
import { latestSentRevision, pdfKindForQuoteType } from "@/lib/quote-pdf/state";
import { ONLINE_COPY, sentDocumentStamp } from "./view";
import { opensFor, opensSummary, type ShareOpenStat } from "@/lib/estimate-output/opens";

/**
 * #301 slice B — the estimate package's pure rules (spec §2, D-h, R11):
 * which state a rev-pinned (v2) link is in, whether its page may take client
 * actions (Slice C), the banner, and the staff-side per-revision rows with
 * their opens. Client-safe: value imports only quote-pdf/state, ./view and
 * estimate-output/opens.
 */

export const PACKAGE_COPY = {
  titleFallback: "Estimate",
  revising: "Peak is revising this estimate.",
  supersededLead: "A newer version of this estimate was sent",
  viewCurrent: "View the current version",
  summary: "Summary",
  goals: "Your goals",
  narrative: "Narrative",
  bom: "BOM",
  bomHead: ["Qty", "Manufacturer", "Part", "Description"],
  seeBom: "The full parts list for this scope is under BOM.",
  noParts: "No parts listed for this scope.",
  options: "Add options",
  notIncluded: "Not included",
  clientLink: "Client link",
  openedChip: "Opened",
} as const;

export type PackageState =
  | { kind: "ok"; rev: QuoteRevision; closed: boolean; won: boolean }
  | { kind: "superseded"; rev: QuoteRevision; latestRev: number; sentAt: number }
  | { kind: "revising"; rev: QuoteRevision }
  | { kind: "inactive" };
export type VisiblePackageState = Exclude<PackageState, { kind: "inactive" }>;

const SHOWN_STATUSES = new Set(["sent", "won", "lost", "draft"]);

/** D-h. Precedence: inactive (not a system quote, the pinned rev isn't one of
 *  this quote's SENT revisions, or an unknown status) → superseded (a newer
 *  send exists) → revising (recalled to draft) → ok (closed = lost). */
export function packageState(q: Pick<Quote, "quoteType" | "status" | "revisions">, pinnedRev: number): PackageState {
  if (pdfKindForQuoteType(q.quoteType) !== "quote") return { kind: "inactive" };
  const revs = Array.isArray(q.revisions) ? q.revisions : [];
  const rev = revs.find((r) => !!r && r.rev === pinnedRev && r.reason === "sent");
  const latest = latestSentRevision(revs);
  if (!rev || !latest || !SHOWN_STATUSES.has(q.status)) return { kind: "inactive" };
  if (latest !== rev) return { kind: "superseded", rev, latestRev: latest.rev, sentAt: sentDocumentStamp({ revisions: revs }, latest).issuedAt };
  if (q.status === "draft") return { kind: "revising", rev };
  return { kind: "ok", rev, closed: q.status === "lost", won: q.status === "won" };
}

/** Slice C's client actions: only the current version of an open (sent) estimate. */
export function canAct(s: PackageState): boolean {
  return s.kind === "ok" && !s.closed && !s.won;
}

export type PackageBanner = { tone: "info" | "warn"; text: string; href: string | null; linkText: string | null };

const longDate = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });

export function packageBanner(s: VisiblePackageState, currentHref: string | null): PackageBanner | null {
  if (s.kind === "superseded")
    return { tone: "info", text: `${PACKAGE_COPY.supersededLead} ${longDate(s.sentAt)}.`, href: currentHref, linkText: currentHref ? PACKAGE_COPY.viewCurrent : null };
  if (s.kind === "revising") return { tone: "warn", text: PACKAGE_COPY.revising, href: null, linkText: null };
  if (s.closed) return { tone: "warn", text: ONLINE_COPY.closed, href: null, linkText: null };
  return null;
}

export type OpensSource = { revisions?: QuoteRevision[] | null; shareOpens?: unknown };
export type SentRevRow = { rev: number; revNo: number; sentAt: number; latest: boolean; opens: ShareOpenStat | null; line: string };

/** Staff-side: every sent revision, newest first — "Rev 2 · opened 3× · …",
 *  "Rev 1 — superseded · not opened yet". Never carries a path. */
export function sentRevisionRows(q: OpensSource | null | undefined): SentRevRow[] {
  const revs = Array.isArray(q?.revisions) ? (q!.revisions as QuoteRevision[]) : [];
  const latest = latestSentRevision(revs);
  const rows: SentRevRow[] = [];
  for (const r of revs) {
    if (!r || r.reason !== "sent") continue;
    const { revNo, issuedAt } = sentDocumentStamp({ revisions: revs }, r);
    const opens = opensFor(q?.shareOpens, r.rev);
    const isLatest = r === latest;
    rows.push({ rev: r.rev, revNo, sentAt: issuedAt, latest: isLatest, opens, line: `Rev ${revNo}${isLatest ? "" : " — superseded"} · ${opensSummary(opens)}` });
  }
  return rows.reverse();
}

/** The Quotes hub chip: "Opened" once any sent revision's link was opened. */
export function opensChip(q: OpensSource | null | undefined): { label: string; title: string } | null {
  const opened = sentRevisionRows(q).filter((r) => r.opens);
  if (!opened.length) return null;
  return { label: PACKAGE_COPY.openedChip, title: `${PACKAGE_COPY.clientLink} — ${opened.map((r) => r.line).join("; ")}` };
}

/** The lead drawer's line: the latest revision's row, once anything was opened. */
export function latestOpensLine(q: OpensSource | null | undefined): string {
  const rows = sentRevisionRows(q);
  if (!rows.some((r) => r.opens)) return "";
  return `${PACKAGE_COPY.clientLink} — ${rows[0].line}`;
}
```

- [ ] **Step 5: Run the gates** (tsc 0; test:specs ALL PASSED, PASS = previous + 18; eslint on both new files clean).

- [ ] **Step 6: Commit.**

```bash
git add src/lib/estimate-output/opens.ts src/lib/quote-share/package-view.ts scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(quote-share): #301 slice B — pure package state (ok/superseded/revising/inactive), banners, per-rev rows, open counter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Links server — `pathV2`, `resolveSharedPackage`, per-rev status, cover link → v2

**Files:**
- Modify: `src/lib/quote-share/view.ts:140-152` (`ShareLinkView`, `ShareLinkStatus`)
- Modify: `src/lib/quote-share/links.ts:1-6` (imports), `:25-43` (`shareLinkView`, `shareLinkStatus`), append after
  `resolveSharedQuote` (`:111`)
- Modify: `src/lib/estimate-output/cover.ts` (`coverShareUrl`, Slice A Task 7)
- Test: harness block `#301 slice B — links`; declares `estimateOutput301BAsyncChecks` + `e301bLinksAsyncChecks`

**Interfaces:**
- **Consumes:** Task 1 (`signShareTokenV2`, `verifyShareTokenV2`, `parseShareToken`); Task 2 (`packageState`,
  `VisiblePackageState`, `sentRevisionRows`, `SentRevRow`); `latestSentRevision`; `sharePath`; `getQuote`.
- **Produces** (Tasks 6–8):
  `ShareLinkView.pathV2?: string | null`; `ShareLinkStatus.sentRevs: SentRevRow[]`;
  `type SharedPackage = { q: Quote; rev: QuoteRevision; state: VisiblePackageState; currentPath: string | null }`;
  `resolveSharedPackage(id: string, token: string, opts?: { secret?: string; now?: number }): Promise<SharedPackage | null>`;
  `coverShareUrl` now prints `link.pathV2 ?? link.path`.

- [ ] **Step 1: Write the failing harness block.** Append:

```ts
/* ======================================================================
   #301 slice B — links: the v2 path on a link view (latest sent rev),
   resolveSharedPackage (shape → get → v2 verify → state; a superseded
   page gets the current version's path), the per-rev status rows, and
   the cover's link line moving to v2.
   ====================================================================== */
import { shareLinkView as e301blView, resolveSharedPackage as e301blResolve } from "@/lib/quote-share/links";
import { signShareToken as e301blSign1, signShareTokenV2 as e301blSign2 } from "@/lib/quote-share/token";
import { coverShareUrl as e301blCoverUrl } from "@/lib/estimate-output/cover";
{
  const S = "test-secret-301bl";
  const NOW = 1_800_000_000_000;
  const exp = NOW + 86_400_000;
  const link = { nonce: "N".repeat(43), expiresAt: exp, createdAt: 1, createdBy: "x" };
  const revs = [{ rev: 1, reason: "sent", at: 1 }, { rev: 2, reason: "manual", at: 2 }, { rev: 3, reason: "sent", at: 3 }];
  const v = e301blView({ id: "Q-1", shareLink: link, revisions: revs } as never, S, NOW);
  ok(v?.path === "/share/quote/Q-1/" + e301blSign1(S, "Q-1", link.nonce, exp) && v?.pathV2 === "/share/quote/Q-1/" + e301blSign2(S, "Q-1", 3, link.nonce, exp),
    "#301 links: the view keeps the v1 path and adds the v2 path pinned to the latest SENT rev");
  ok(e301blView({ id: "Q-1", shareLink: link, revisions: [revs[1]] } as never, S, NOW)?.pathV2 === null &&
     e301blView({ id: "Q-1", shareLink: link, revisions: revs } as never, S, NOW, false)?.pathV2 === null &&
     e301blView({ id: "Q-1", shareLink: { ...link, expiresAt: 0 }, revisions: revs } as never, S, NOW)?.pathV2 === null,
    "#301 links: no v2 path before a send, without Send, or once revoked");
  const lv = { active: true, path: "/share/quote/Q-1/1.v1", pathV2: "/share/quote/Q-1/1.3.v2", expiresAt: 9, createdAt: 1, createdBy: "x", revokedAt: null, revokedBy: null };
  ok(e301blCoverUrl("https://app.test/", lv, "ok") === "https://app.test/share/quote/Q-1/1.3.v2" && e301blCoverUrl("https://app.test", { ...lv, pathV2: undefined }, "ok") === "https://app.test/share/quote/Q-1/1.v1" &&
     e301blCoverUrl("https://app.test", lv, "revising") === null,
    "#301 cover: the link line prints the v2 (rev-pinned) link; a view without one still prints its path");
  const lk = readFileSync(join(process.cwd(), "src/lib/quote-share/links.ts"), "utf8");
  const rsp = lk.slice(lk.indexOf("export async function resolveSharedPackage("));
  ok(rsp.indexOf("parseShareToken(") < rsp.indexOf("getQuote(") && rsp.indexOf("getQuote(") < rsp.indexOf("verifyShareTokenV2(") && rsp.indexOf("verifyShareTokenV2(") < rsp.indexOf("packageState("),
    "#301 links: resolveSharedPackage checks shape before any read, then get → verify → state (read-only)");
  ok(!/\b(update|patchShareLink|addQuoteRevision|setStatus)\(/.test(rsp.slice(0, rsp.indexOf("\n}\n"))), "#301 links: resolving a package never writes");
}

async function e301bLinksAsyncChecks(): Promise<void> {
  const { fixtureId } = await import("./test-fixtures");
  const Q = await import("@/lib/stores/quotes");
  const L = await import("@/lib/quote-share/links");
  const S = "test-secret-301bl";
  const QID = fixtureId(301, "b-links");
  const sec = { id: "s1", name: "Stage lighting", kind: "materials", mfr: "", freightPct: 0, items: [{ id: 1, sku: "A", desc: "Fixture", qty: 1, unit: "ea", cost: 10, price: 20 }] };
  await Q.create({ id: QID, name: "#301b links", customer: "Spec fixture", owner: "spec", quoteType: "system", source: "estimator", spec: { sections: [sec], mobs: [] } });
  registerFixture("quotes", QID);
  await Q.update(QID, { status: "sent" });
  await Q.addQuoteRevision(QID, { by: "Test", reason: "sent" }); // rev 1
  const now = Date.now();
  const made = await L.ensureShareLink(QID, "Tester", { secret: S, now });
  const tok1 = made.ok ? made.link.path!.split("/").pop()! : "";
  const tokA = made.ok && made.link.pathV2 ? made.link.pathV2.split("/").pop()! : "";
  ok(made.ok && /^\d+\.1\.[A-Za-z0-9_-]{43}$/.test(tokA), "#301 links (DB): Copy client link returns a v2 path pinned to rev 1");
  const a = await L.resolveSharedPackage(QID, tokA, { secret: S, now });
  ok(a?.state.kind === "ok" && a.rev.rev === 1 && a.currentPath === null, "#301 links (DB): a v2 token opens its pinned revision");
  ok((await L.resolveSharedQuote(QID, tok1, { secret: S, now }))?.state.kind === "ok" && (await L.resolveSharedQuote(QID, tokA, { secret: S, now })) === null &&
     (await L.resolveSharedPackage(QID, tok1, { secret: S, now })) === null,
    "#301 links (DB): v1 keeps #293's resolve; v1 and v2 never cross");

  // A manual snapshot, then a second send: rev 3, printed "Rev 2" (R11).
  await Q.addQuoteRevision(QID, { by: "Test", reason: "manual" });
  await Q.addQuoteRevision(QID, { by: "Test", reason: "sent" });
  const view2 = L.shareLinkView((await Q.get(QID))!, S, now);
  const tokB = view2?.pathV2?.split("/").pop() || "";
  ok(/^\d+\.3\.[A-Za-z0-9_-]{43}$/.test(tokB) && view2?.path === (made.ok ? made.link.path : "x"), "#301 links (DB): after a re-send the v2 path pins the new rev; the v1 path is unchanged");
  const sup = await L.resolveSharedPackage(QID, tokA, { secret: S, now });
  ok(sup?.state.kind === "superseded" && sup.rev.rev === 1 && sup.currentPath === view2?.pathV2, "#301 links (DB): the old v2 link → superseded, pointing at the current version");
  const st = L.shareLinkStatus((await Q.get(QID))!, true, S, now);
  ok(st.sentRevs.map((r) => r.line).join(" | ") === "Rev 2 · not opened yet | Rev 1 — superseded · not opened yet", "#301 links (DB): the status lists each sent rev, newest first, as Rev N");

  await Q.update(QID, { status: "draft" });
  ok((await L.resolveSharedPackage(QID, tokB, { secret: S, now }))?.state.kind === "revising" && (await L.resolveSharedPackage(QID, tokA, { secret: S, now }))?.state.kind === "superseded",
    "#301 links (DB): recalled → the current link shows revising, the old one stays superseded");
  await Q.update(QID, { status: "lost" });
  const closed = await L.resolveSharedPackage(QID, tokB, { secret: S, now });
  ok(closed?.state.kind === "ok" && closed.state.closed, "#301 links (DB): lost → ok, closed");
  await L.revokeShareLink(QID, "Revoker");
  ok((await L.resolveSharedPackage(QID, tokA, { secret: S, now })) === null && (await L.resolveSharedPackage(QID, tokB, { secret: S, now })) === null,
    "#301 links (DB): Revoke kills every v2 token");
  ok((await L.resolveSharedPackage("Q".repeat(65), tokB, { secret: S, now })) === null && (await L.resolveSharedPackage(QID, "nope", { secret: S, now })) === null,
    "#301 links (DB): an oversize id or a malformed token → null");
}
```

  Then add, right after `.then(() => estimateOutput301AAsyncChecks())` in the chain (`:10794`):

```ts
  .then(() => estimateOutput301BAsyncChecks())
```

  And append at the end of the file:

```ts
/* #301 slice B — DB checks. Later slice B tasks append one
   `await e301b<Part>AsyncChecks();` line at the end of this body. */
async function estimateOutput301BAsyncChecks(): Promise<void> {
  await e301bLinksAsyncChecks();
}
```

- [ ] **Step 2: Run it to verify it fails** (`pathV2` / `resolveSharedPackage` don't exist; tsc errors on `sentRevs`).

- [ ] **Step 3: `src/lib/quote-share/view.ts`.** Add a type import at the top (type-only, so the #293t value-import pin
  holds):

```ts
import type { SentRevRow } from "./package-view";
```

  Replace the `ShareLinkView` / `ShareLinkStatus` block (`:140-152`) with:

```ts
/** What a browser learns about a link — never the nonce. `path` (v1, #293)
 *  and `pathV2` (#301 slice B — pinned to the latest SENT revision) only
 *  while active, and only for a `send` holder. `pathV2` is optional so
 *  older literal views (harness fixtures) stay valid. */
export type ShareLinkView = {
  active: boolean;
  path: string | null;
  pathV2?: string | null;
  expiresAt: number;
  createdAt: number;
  createdBy: string;
  revokedAt: number | null;
  revokedBy: string | null;
};

/** `sentRevs` (#301 slice B) — every sent revision with its opens, for any
 *  signed-in user; it carries no path. */
export type ShareLinkStatus = { state: ShareEligibility; canSend: boolean; link: ShareLinkView | null; sentRevs: SentRevRow[] };
```

- [ ] **Step 4: `src/lib/quote-share/links.ts`.** Replace the imports (`:1-6`) with:

```ts
import { get as getQuote, patchShareLink, type Quote, type QuoteRevision } from "@/lib/stores/quotes";
import { latestSentRevision } from "@/lib/quote-pdf/state";
import { parseShareToken, SHARE_TOKEN_RE, signShareToken, signShareTokenV2, verifyShareToken, verifyShareTokenV2 } from "./token";
import {
  ONLINE_COPY, onlineEstimateState, shareEligibility, sharePath,
  type OnlineEstimateState, type ShareLinkStatus, type ShareLinkView,
} from "./view";
import { packageState, sentRevisionRows, type VisiblePackageState } from "./package-view";
```

  Replace `shareLinkView` and `shareLinkStatus` (`:25-43`) with:

```ts
export function shareLinkView(q: Pick<Quote, "id" | "shareLink" | "revisions">, secret: string, now: number, withPath = true): ShareLinkView | null {
  const l = q.shareLink;
  if (!l) return null;
  const active = !!secret && typeof l.nonce === "string" && !!l.nonce && l.expiresAt > now;
  // #301 slice B: the copyable link pins the latest SENT revision (D-g).
  const latest = active && withPath ? latestSentRevision(q.revisions) : null;
  return {
    active,
    path: active && withPath ? sharePath(q.id, signShareToken(secret, q.id, l.nonce, l.expiresAt)) : null,
    pathV2: latest ? sharePath(q.id, signShareTokenV2(secret, q.id, latest.rev, l.nonce, l.expiresAt)) : null,
    expiresAt: l.expiresAt,
    createdAt: l.createdAt,
    createdBy: l.createdBy,
    revokedAt: l.revokedAt ?? null,
    revokedBy: l.revokedBy ?? null,
  };
}

/** The Client link panel's read: the paths only for a Send holder; the
 *  per-revision rows (no paths) for anyone signed in. */
export function shareLinkStatus(q: Quote, canSend: boolean, secret: string, now: number): ShareLinkStatus {
  return { state: shareEligibility(q), canSend, link: shareLinkView(q, secret, now, canSend), sentRevs: sentRevisionRows(q) };
}
```

  (`sentRevisionRows(q)` reads `q.shareOpens` structurally. Until Task 8 adds the field to `Quote`, it reads
  `undefined`, so there are no opens yet.)

  Append after `resolveSharedQuote` (`:111`):

```ts
/** #301 slice B — a rev-pinned (v2) package link, resolved. `currentPath`:
 *  the v2 link to the latest sent revision when this one is superseded. */
export type SharedPackage = { q: Quote; rev: QuoteRevision; state: VisiblePackageState; currentPath: string | null };

/** The package page's (and its photo route's) one check, in order: shape
 *  (no DB read for a malformed id or a non-v2 token) → get → v2 verify →
 *  packageState. Read-only. null = the one "isn't active" card. */
export async function resolveSharedPackage(
  id: string,
  token: string,
  opts: { secret?: string; now?: number } = {}
): Promise<SharedPackage | null> {
  if (typeof id !== "string" || !id || id.length > SHARE_ID_MAX) return null;
  const parsed = parseShareToken(token);
  if (!parsed || parsed.v !== 2) return null;
  const secret = opts.secret ?? shareSecret();
  if (!secret) return null;
  const q = await getQuote(id);
  if (!q || q.id !== id || !q.shareLink) return null;
  const rev = verifyShareTokenV2(secret, token, id, q.shareLink, opts.now ?? Date.now());
  if (rev == null) return null;
  const state = packageState(q, rev);
  if (state.kind === "inactive") return null;
  const l = q.shareLink;
  const currentPath = state.kind === "superseded" ? sharePath(id, signShareTokenV2(secret, id, state.latestRev, l.nonce, l.expiresAt)) : null;
  return { q, rev: state.rev, state, currentPath };
}
```

- [ ] **Step 5: `src/lib/estimate-output/cover.ts`** (Slice A). Replace `coverShareUrl` with:

```ts
/** The cover's link line: the active link's v2 (rev-pinned) path — #301
 *  slice B — else its v1 path (a view built without pathV2), only while the
 *  online page would show the estimate. */
export function coverShareUrl(origin: string | null, link: ShareLinkView | null, state: OnlineEstimateState["kind"]): string | null {
  const path = link ? (link.pathV2 ?? link.path) : null;
  if (!origin || !link || !link.active || !path || state !== "ok") return null;
  return origin.replace(/\/+$/, "") + path;
}
```

- [ ] **Step 6: Run the gates** (tsc 0; test:specs ALL PASSED, PASS = previous + 5 sync + 10 DB; every #293t links/status
  check and Slice A's `#301 link` / `#301 loader` checks still pass; eslint on `view.ts`, `links.ts`, `cover.ts` no new
  findings).

- [ ] **Step 7: Commit.**

```bash
git add src/lib/quote-share/view.ts src/lib/quote-share/links.ts src/lib/estimate-output/cover.ts scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(quote-share): #301 slice B — v2 link path, resolveSharedPackage, per-rev status rows; cover link line → v2

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: BOM rows, the scope extension, and the pure package model

**Files:**
- Modify: `src/lib/estimate-output/scopes.ts:1-75` (import + `OutputScope` + `outputScopes`)
- Create: `src/lib/estimate-output/bom.ts`, `src/lib/estimate-output/package-model.ts`
- Test: harness block `#301 slice B — BOM + model`

**Interfaces:**
- **Consumes:** `customerLines` (`pricing.ts:1142`); `systemPrintsInBody`; `isPlaceholderSku` (`@/lib/specs/record-keys`);
  `PLACEHOLDER_SRC` (`@/lib/part-image-fallback`); `fmt`; Slice A `outputScopes`, `addOptions`, `coverTotals`,
  `coverSummaryText`, `notIncludedItems`, `LABOR_COVER`; Task 2 `PACKAGE_COPY`, `packageBanner`, `VisiblePackageState`;
  types `QuoteDocumentProps`, `SpecSection`, `SpecItem`, `VendorQuote`, `QuoteRevisionDocFields`, `NarrativeBlock`,
  `PrintableKeyProduct`.
- **Produces** (Tasks 5, 6):
  - `scopes.ts`: `OutputScope.introBlocks: NarrativeBlock[]`, `OutputScope.keyProducts: PrintableKeyProduct[]`.
  - `bom.ts`: `type PackageBomRow = { key: string; qty: number | null; unit: string; manufacturer: string; part: string; description: string }`;
    `type BomCatalogPart = { mfr?: string | null; manufacturerPartNumber?: string | null }`; `LABOR_BOM_DESC`;
    `MAX_BOM_SKUS = 2000`; `bomCatalogSku(it): string`; `packageBomSkus(sections: SpecSection[]): string[]`;
    `packageBomRows(sec: SpecSection, catalog: ReadonlyMap<string, BomCatalogPart>, vendorQuotes?: readonly VendorQuote[]): PackageBomRow[]`.
  - `package-model.ts`: `packageFrozenFields(df, defaultNotIncluded): { coverSummary: string; notIncluded: string }`;
    `packagePhotoSections(sections: SpecSection[]): SpecSection[]`; `type PackageKeyProduct`; `type PackageScopeView`;
    `type PackageViewProps`; `type PackageViewInput`; `packageViewModel(i: PackageViewInput): PackageViewProps`.

- [ ] **Step 1: Write the failing harness block.** Append:

```ts
/* ======================================================================
   #301 slice B — BOM + model: R6 BOM rows (line fields first, catalog
   second, labor dropped except a labor system's one row, no money field),
   the scope extension, R12 frozen fields, the v2 photo set, and the pure
   package page model (never the staff placeholder, never a line price).
   ====================================================================== */
import { packageBomRows as e301bbRows, packageBomSkus as e301bbSkus, LABOR_BOM_DESC as e301bbLabor, bomCatalogSku as e301bbSku } from "@/lib/estimate-output/bom";
import { packageFrozenFields as e301bmFrozen, packagePhotoSections as e301bmPhotoSecs, packageViewModel as e301bmModel } from "@/lib/estimate-output/package-model";
import { outputScopes as e301bbScopes } from "@/lib/estimate-output/scopes";
import { narrativeBlocks as e301bbBlocks } from "@/app/(app)/estimator/narrative";
import { withRewardCredit as e301bbCredit } from "@/lib/rewards/credit-line";
import { fmt as e301bbFmt } from "@/app/(app)/estimator/pricing";
import type { SpecSection as E301bbSec } from "@/app/(app)/estimator/types";
{
  // ---- scope extension ----
  const kpSecs = p293Sections().map((s) => (s.id === "s2" ? { ...s, keyProducts: [{ lineKey: "5", sku: "SKU-5", text: "A bright fresnel.\n\nMore.", photo: true }] } : s)) as E301bbSec[];
  const sc = e301bbScopes(p293Props({ sections: kpSecs }));
  ok(JSON.stringify(sc[1].introBlocks) === JSON.stringify(e301bbBlocks("Intro para.\n\n- One\n- Two")) && sc[1].keyProducts.length === 1 && sc[1].keyProducts[0].heading === "Line 5" &&
     sc[0].introBlocks.length === 0 && sc[0].keyProducts.length === 0, "#301 scopes: each scope carries its intro blocks and printable key products");

  // ---- BOM rows (R6) ----
  const L = (id: number, extra: Record<string, unknown> = {}) => ({ id, sku: "SKU-" + id, desc: "Line " + id, qty: 2, unit: "ea", cost: 7.77, price: 13.37, internalNote: "INTERNAL-301B", ...extra });
  const mat = { id: "m", name: "Gear", kind: "materials", mfr: "", freightPct: 0, room: "ROOM-301B", items: [
    L(1), L(2, { manufacturer: "LineCo", manufacturerPartNumber: "LC-2" }), L(3, { allowance: true }), L(4, { custom: true, sku: "CUSTOM" }),
    L(5, { labor: true, sku: "LAB-1", unit: "hr" }), L(6, { option: true }), L(7, { vendorQuoteId: "VQ-1" }),
  ] } as unknown as E301bbSec;
  const cat = new Map([["SKU-1", { mfr: "CatCo", manufacturerPartNumber: "CC-1" }], ["SKU-2", { mfr: "Other", manufacturerPartNumber: "X" }], ["SKU-3", { mfr: "Nope" }]]);
  const vqs = [{ id: "VQ-1", vendor: "Acme", quoteNumber: "Q9", description: "Motors", lines: [], terms: "TERMS-301B", notes: "", total: 1, includesFreight: false, display: "single" }] as never;
  const rows = e301bbRows(mat, cat, vqs);
  ok(rows.map((r) => r.key).join(",") === "1,2,3,4,7", "#301 BOM: labor and option lines never appear (customerLines + the labor drop)");
  ok(rows[0].manufacturer === "CatCo" && rows[0].part === "CC-1" && rows[1].manufacturer === "LineCo" && rows[1].part === "LC-2",
    "#301 BOM: the line's own manufacturer / part # first, the catalog part second");
  ok(rows[2].description === "Budget allowance — Line 3" && rows[2].manufacturer === "" && rows[3].manufacturer === "" && rows[3].part === "",
    "#301 BOM: an allowance or a placeholder-sku custom line never borrows a catalog part");
  ok(rows[4].description === "Acme · Q9 — Motors" && !JSON.stringify(rows).includes("TERMS-301B"), "#301 BOM: a vendor line reads like the document's, never its terms");
  ok(rows.every((r) => Object.keys(r).sort().join(",") === "description,key,manufacturer,part,qty,unit") && rows[0].qty === 2 && rows[0].unit === "ea",
    "#301 BOM: a row has exactly Qty · Unit · Manufacturer · Part · Description (+ key) — no money field");
  const lab = e301bbRows({ id: "l", name: "Install", kind: "labor", mfr: "", freightPct: 0, items: [L(9, { labor: true })] } as unknown as E301bbSec, cat);
  ok(lab.length === 1 && lab[0].description === e301bbLabor && lab[0].qty === null && e301bbLabor === "Installation, commissioning & project management",
    "#301 BOM: a labor system is one row, the document's own wording (R2/R6)");
  const credited = e301bbCredit([mat], 10, 999) as E301bbSec[];
  ok(e301bbRows(credited[0], cat, vqs).length === rows.length, "#301 BOM: the Rewards credit line never appears");
  ok(e301bbSkus([mat, { ...mat, id: "m2" } as E301bbSec, { id: "z", name: "Zero", kind: "materials", mfr: "", freightPct: 0, items: [] } as unknown as E301bbSec]).join(",") === "SKU-1,SKU-2" &&
     e301bbSku({ sku: " SKU-9 " } as never) === "SKU-9" && e301bbSku({ sku: "AI" } as never) === "",
    "#301 BOM: the catalog lookup list — printed systems only, deduped, never allowance / vendor / placeholder skus");

  // ---- frozen fields (R12) ----
  ok(JSON.stringify(e301bmFrozen(undefined, "D")) === JSON.stringify({ coverSummary: "", notIncluded: "" }) &&
     JSON.stringify(e301bmFrozen({ customer: "C" } as never, "D")) === JSON.stringify({ coverSummary: "", notIncluded: "" }) &&
     JSON.stringify(e301bmFrozen({ coverSummary: "S", notIncluded: null } as never, "D")) === JSON.stringify({ coverSummary: "S", notIncluded: "D" }) &&
     e301bmFrozen({ notIncluded: "" } as never, "D").notIncluded === "" && e301bmFrozen({ notIncluded: "X" } as never, "D").notIncluded === "X",
    "#301 frozen: only the revision's own keys — absent (pre-#301) → empty, never the live quote; null → the default list; a string as sent");

  // ---- v2 photo set ----
  const psIn = p293Sections();
  const ps = e301bmPhotoSecs(psIn);
  ok(ps.length === psIn.length && ps.every((s) => s.presentation === "narrative") && psIn[0].presentation === undefined && ps[1] === psIn[1],
    "#301 photos: the package's photo set treats every system as narrative (key products show on every scope); the input is never mutated");

  // ---- the model ----
  const doc = { ...p293Props({ sections: kpSecs, pdfOptions: { pdfOptions: true } }), rewardsLine: "Your Gold rewards: Free freight" };
  const okState = { kind: "ok", rev: { rev: 1 }, closed: false, won: false } as never;
  const m = e301bmModel({ doc, photos: { "SKU-5": { src: "/p/5", alt: "Five" } }, catalog: new Map(), frozen: { coverSummary: "", notIncluded: "Permits\nPainting" },
    state: okState, headerLine: "EST-1 · Rev 1 · sent Oct 5, 2026", currentHref: null, view: "narrative", base: "/share/quote/Q-293/t", letterheadSrc: "/_test/lh.jpg" });
  ok(m.title === "Narrative test" && m.customer === "Walk-in" && m.headerLine.startsWith("EST-1") && m.total === e301bbFmt(doc.t.grand) &&
     m.logo.src === "/_test/lh.jpg" && m.logo.full && m.banner === null && m.narrativeHref === "/share/quote/Q-293/t" && m.bomHref === "/share/quote/Q-293/t?view=bom",
    "#301 model: header (title, customer, Rev stamp, grand total), letterhead, no banner on an open estimate, the two view links");
  ok(m.scopes.map((s) => `${s.num}:${s.name}`).join("|") === "1:Rigging|2:Lighting|3:Install|4:Empty narrative" && m.scopes[1].keyProducts[0].photo?.src === "/p/5" &&
     m.scopes[1].fallback === null && m.scopes[0].fallback === "The full parts list for this scope is under BOM." && m.scopes[2].fallback === "Installation, commissioning & project management." &&
     m.scopes[3].fallback === "The full parts list for this scope is under BOM.",
    "#301 model: every printed scope; key-product photos; a scope with no text says where its parts are; labor reads the labor wording");
  ok(!JSON.stringify(m).includes("[needs a paragraph]"), "#301 model: the staff placeholder never reaches a client");
  ok(m.summary === "This estimate includes 4 scopes: Rigging, Lighting, Install and Empty narrative." && m.notIncluded.join("|") === "Permits|Painting" &&
     m.options.length === 1 && m.options[0].label === "ADD OPTION 1" && m.totals.rewardsLine === "Your Gold rewards: Free freight" && m.scopes[0].bom.length === 3,
    "#301 model: summary sentence, Not included items, add options, the totals lines (R1), BOM rows per scope");
  const sup = e301bmModel({ doc, photos: {}, catalog: new Map(), frozen: { coverSummary: "Ours.", notIncluded: "" }, state: { kind: "superseded", rev: { rev: 1 }, latestRev: 3, sentAt: Date.UTC(2026, 9, 6, 15) } as never,
    headerLine: "x", currentHref: "/share/quote/Q-293/cur", view: "bom", base: "/b", letterheadSrc: "/lh" });
  ok(sup.banner?.href === "/share/quote/Q-293/cur" && sup.summary === "Ours." && sup.view === "bom" && sup.notIncluded.length === 0, "#301 model: superseded banner with the current link; the typed summary; the BOM view");
  const pricey = [{ id: "p", name: "Pricey", kind: "materials", mfr: "", freightPct: 0, room: "ROOM-301B", items: [L(1), L(2, { price: 11.11, qty: 1 })] }] as unknown as E301bbSec[];
  const pm = e301bmModel({ doc: p293Props({ sections: pricey }), photos: {}, catalog: new Map(), frozen: { coverSummary: "", notIncluded: "" }, state: okState, headerLine: "x",
    currentHref: null, view: "bom", base: "/b", letterheadSrc: "/lh" });
  const pj = JSON.stringify(pm);
  ok(pm.scopes[0].price === "$37.85" && !pj.includes("26.74") && !pj.includes("13.37") && !pj.includes("11.11") && !pj.includes("7.77") && !pj.includes("INTERNAL-301B") && !pj.includes("ROOM-301B"),
    "#301 model: the scope price only — never a line or unit price, cost, internal note or room (§10)");
  const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  ok(!/^import (?!type)[^\n]*from "(?!@\/app\/\(app\)\/estimator\/(pricing|quote-document-view)"|@\/lib\/specs\/record-keys")/m.test(rd("src/lib/estimate-output/bom.ts")) &&
     !/^import (?!type)[^\n]*from "(?!@\/app\/\(app\)\/estimator\/pricing"|\.\/scopes"|\.\/bom"|@\/lib\/quote-share\/package-view"|@\/lib\/part-image-fallback")/m.test(rd("src/lib/estimate-output/package-model.ts")),
    "#301 purity: bom.ts and package-model.ts are pure and client-safe");
}
```

  (`psIn[1]` — Lighting — is already narrative, so `packagePhotoSections` returns that very object; `psIn[0]` — Rigging,
  itemized — gets a copy and the input stays untouched.)

- [ ] **Step 2: Run it to verify it fails** (module not found `@/lib/estimate-output/bom`).

- [ ] **Step 3: Extend `src/lib/estimate-output/scopes.ts`.** Change the narrative import line (`:5`) to:

```ts
import { narrativeBlocks, printableKeyProducts, type NarrativeBlock, type PrintableKeyProduct } from "@/app/(app)/estimator/narrative";
```

  Add two fields to `OutputScope` (after `cover: CoverParagraph;`):

```ts
  /** #301 slice B — the intro as printable blocks, and the resolved key
   *  products (the package page shows them on every scope). */
  introBlocks: NarrativeBlock[];
  keyProducts: PrintableKeyProduct[];
```

  and to the object `outputScopes` builds (after `cover: coverParagraphFor(sec),`):

```ts
    introBlocks: narrativeBlocks(sec.narrative),
    keyProducts: printableKeyProducts(sec),
```

- [ ] **Step 4: Create `src/lib/estimate-output/bom.ts`.**

```ts
import type { SpecItem, SpecSection, VendorQuote } from "@/app/(app)/estimator/types";
import { customerLines } from "@/app/(app)/estimator/pricing";
import { systemPrintsInBody } from "@/app/(app)/estimator/quote-document-view";
import { isPlaceholderSku } from "@/lib/specs/record-keys";

/**
 * #301 slice B (spec §2, R6) — the package page's parts list: Qty ·
 * Manufacturer · Part · Description from the customer's own rows
 * (customerLines — options, the Rewards credit and the overhead lines never
 * appear). Manufacturer / Part come from the line first (frozen with the
 * revision), then the catalog part by sku, else blank. Labor lines are
 * dropped, except that a labor system is its one document row. PackageBomRow
 * has NO money field — nothing priced can leak through it. Pure.
 */

export type PackageBomRow = { key: string; qty: number | null; unit: string; manufacturer: string; part: string; description: string };
export type BomCatalogPart = { mfr?: string | null; manufacturerPartNumber?: string | null };

export const LABOR_BOM_DESC = "Installation, commissioning & project management";
export const MAX_BOM_SKUS = 2000;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** The sku to look up in the catalog — "" for an allowance, a vendor line,
 *  or a blank / oversize / placeholder sku (CUSTOM, AI…). */
export function bomCatalogSku(it: Pick<SpecItem, "sku"> & Partial<Pick<SpecItem, "allowance" | "vendorQuoteId">>): string {
  if (it.allowance || it.vendorQuoteId) return "";
  const s = str(it.sku);
  if (!s || s.length > 128 || isPlaceholderSku(s)) return "";
  return s;
}

/** The skus the page's BOM needs from the catalog (printed systems only). */
export function packageBomSkus(sections: SpecSection[]): string[] {
  const out = new Set<string>();
  for (const sec of Array.isArray(sections) ? sections : []) {
    if (!sec || sec.kind === "labor" || !systemPrintsInBody(sec)) continue;
    for (const cl of customerLines(sec)) {
      if (!cl.item || cl.item.labor) continue;
      const s = bomCatalogSku(cl.item);
      if (s) out.add(s);
      if (out.size >= MAX_BOM_SKUS) return [...out];
    }
  }
  return [...out];
}

export function packageBomRows(sec: SpecSection, catalog: ReadonlyMap<string, BomCatalogPart>, vendorQuotes: readonly VendorQuote[] = []): PackageBomRow[] {
  if (!sec) return [];
  if (sec.kind === "labor") return [{ key: "labor", qty: null, unit: "", manufacturer: "", part: "", description: LABOR_BOM_DESC }];
  const rows: PackageBomRow[] = [];
  for (const cl of customerLines(sec)) {
    const it = cl.item;
    if (!it || it.labor) continue;
    const vq = it.vendorQuoteId ? vendorQuotes.find((v) => v.id === it.vendorQuoteId) : undefined;
    const sku = bomCatalogSku(it);
    const part = sku ? catalog.get(sku) : undefined;
    rows.push({
      key: String(it.id),
      qty: typeof it.qty === "number" && Number.isFinite(it.qty) ? it.qty : null,
      unit: str(it.unit),
      manufacturer: str(it.manufacturer) || str(part?.mfr),
      part: str(it.manufacturerPartNumber) || str(part?.manufacturerPartNumber),
      description: vq
        ? `${vq.vendor} · ${vq.quoteNumber} — ${vq.description}`
        : it.allowance
          ? "Budget allowance — " + str(it.desc)
          : str(it.desc),
    });
  }
  return rows;
}
```

- [ ] **Step 5: Create `src/lib/estimate-output/package-model.ts`.**

```ts
import type { QuoteDocumentProps } from "@/app/(app)/estimator/quote-document";
import type { SpecSection } from "@/app/(app)/estimator/types";
import type { NarrativeBlock } from "@/app/(app)/estimator/narrative";
import type { QuoteRevisionDocFields } from "@/lib/stores/quotes";
import { fmt } from "@/app/(app)/estimator/pricing";
import { PLACEHOLDER_SRC } from "@/lib/part-image-fallback";
import { addOptions, coverSummaryText, coverTotals, notIncludedItems, outputScopes } from "./scopes";
import { packageBomRows, type BomCatalogPart, type PackageBomRow } from "./bom";
import { PACKAGE_COPY, packageBanner, type PackageBanner, type VisiblePackageState } from "@/lib/quote-share/package-view";

/**
 * #301 slice B — the estimate package page's props (spec §5), built from the
 * SENT revision's customer document (QuoteDocumentProps, R20) so prices and
 * totals can't drift from the PDF (R1). Pure and client-safe. Carries only
 * formatted strings and printable blocks: scope prices, the totals lines and
 * add-option prices — never a line or unit price, cost, margin, internal
 * note or room (§10).
 */

/** R12 — the cover fields exactly as the revision froze them. Absent (a
 *  revision cut before #301) → empty, never the live quote. notIncluded null
 *  = the quote never stored one → the Settings default (the cover's rule). */
export function packageFrozenFields(
  df: Partial<QuoteRevisionDocFields> | null | undefined,
  defaultNotIncluded: string
): { coverSummary: string; notIncluded: string } {
  const coverSummary = df && typeof df.coverSummary === "string" ? df.coverSummary : "";
  const notIncluded = df && typeof df.notIncluded === "string" ? df.notIncluded : df && df.notIncluded === null ? defaultNotIncluded : "";
  return { coverSummary, notIncluded };
}

/** The v2 photo set: every system's key products, whatever its presentation
 *  (QuoteDocument prints them for Narrative systems only; the package's
 *  Narrative view is page-wide). Never mutates the input. */
export function packagePhotoSections(sections: SpecSection[]): SpecSection[] {
  return (Array.isArray(sections) ? sections : []).map((s) => (s && (s.presentation || "itemized") !== "narrative" ? { ...s, presentation: "narrative" as const } : s));
}

export type PackageKeyProduct = { sku: string; heading: string; blocks: NarrativeBlock[]; photo: { src: string; alt: string } | null };

export type PackageScopeView = {
  id: string;
  num: number;
  name: string;
  price: string;
  goals: string;
  intro: NarrativeBlock[];
  keyProducts: PackageKeyProduct[];
  /** Shown in Narrative view when the scope has no intro and no key products. */
  fallback: string | null;
  bom: PackageBomRow[];
};

export type PackageViewProps = {
  logo: { src: string; full: boolean };
  companyName: string;
  title: string;
  customer: string;
  venue: string;
  headerLine: string;
  totalLabel: string;
  total: string;
  banner: PackageBanner | null;
  summary: string;
  view: "narrative" | "bom";
  narrativeHref: string;
  bomHref: string;
  scopes: PackageScopeView[];
  totals: { creditLabel: string | null; creditAmount: string | null; totalLabel: string; total: string; rewardsLine: string; standingLines: string[] };
  options: Array<{ label: string; desc: string; reason: string; price: string }>;
  notIncluded: string[];
};

export type PackageViewInput = {
  doc: QuoteDocumentProps;
  photos: Record<string, { src: string; alt: string }>;
  catalog: ReadonlyMap<string, BomCatalogPart>;
  frozen: { coverSummary: string; notIncluded: string };
  state: VisiblePackageState;
  headerLine: string;
  currentHref: string | null;
  view: "narrative" | "bom";
  base: string;
  letterheadSrc: string;
};

export function packageViewModel(i: PackageViewInput): PackageViewProps {
  const d = i.doc;
  const scopes = outputScopes(d);
  const byId = new Map((d.sections || []).map((s) => [s.id, s] as const));
  const t = coverTotals(d);
  return {
    logo: d.logoDark ? { src: d.logoDark, full: false } : { src: i.letterheadSrc, full: true },
    companyName: d.companyName,
    title: (d.projectName || "").trim() || PACKAGE_COPY.titleFallback,
    customer: d.custName,
    venue: d.venueLabel,
    headerLine: i.headerLine,
    totalLabel: t.totalLabel,
    total: fmt(t.total),
    banner: packageBanner(i.state, i.currentHref),
    summary: coverSummaryText(i.frozen.coverSummary, scopes.map((s) => s.name)),
    view: i.view,
    narrativeHref: i.base,
    bomHref: i.base + "?view=bom",
    scopes: scopes.map((s) => {
      const keyProducts: PackageKeyProduct[] = s.keyProducts.map((kp) => ({
        sku: kp.sku,
        heading: kp.heading,
        blocks: kp.blocks,
        photo: kp.photo ? (i.photos[kp.sku] ?? (kp.placeholder ? { src: PLACEHOLDER_SRC[kp.placeholder], alt: "" } : null)) : null,
      }));
      const hasText = s.introBlocks.length > 0 || keyProducts.length > 0;
      const sec = byId.get(s.id);
      return {
        id: s.id,
        num: s.num,
        name: s.name,
        price: fmt(s.price),
        goals: s.clientGoals,
        intro: s.introBlocks,
        keyProducts,
        fallback: hasText ? null : s.cover.source === "missing" ? PACKAGE_COPY.seeBom : s.cover.text,
        bom: sec ? packageBomRows(sec, i.catalog, d.vendorQuotes || []) : [],
      };
    }),
    totals: {
      creditLabel: t.creditLabel,
      creditAmount: t.credit > 0 ? "−" + fmt(t.credit) : null,
      totalLabel: t.totalLabel,
      total: fmt(t.total),
      rewardsLine: t.rewardsLine,
      standingLines: t.standingLines,
    },
    options: addOptions(d).map((o) => ({ label: o.label, desc: o.desc, reason: o.reason, price: fmt(o.price) })),
    notIncluded: notIncludedItems(i.frozen.notIncluded),
  };
}
```

- [ ] **Step 6: Run the gates** (tsc 0; test:specs ALL PASSED, PASS = previous + 18, and Slice A's scopes block unchanged;
  eslint on `scopes.ts`, `bom.ts`, `package-model.ts` no new findings).

- [ ] **Step 7: Commit.**

```bash
git add src/lib/estimate-output/scopes.ts src/lib/estimate-output/bom.ts src/lib/estimate-output/package-model.ts scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(estimate-output): #301 slice B — BOM rows (no money field), scope intro/key products, pure package model (R6, R12)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `PackageView` component

**Files:**
- Create: `src/components/estimate-output/package-view.tsx`
- Test: harness block `#301 slice B — package view`

**Interfaces:**
- **Consumes:** `PackageViewProps`, `PackageScopeView` (Task 4); `PACKAGE_COPY` (Task 2); `NarrativeBlock` (type).
- **Produces** (Task 6): `PackageView` (default export) with props `{ model: PackageViewProps; slots?: PackageSlots }`;
  `type PackageSlots = { plans?: ReactNode; downloads?: ReactNode; actions?: ReactNode; keyProductExtra?: Record<string, ReactNode> }`;
  `PACKAGE_WEB_CSS: string`.

- [ ] **Step 1: Write the failing harness block.** Append:

```ts
/* ======================================================================
   #301 slice B — package view: the server-rendered page (spec §5 order),
   the BOM view (no prices), banners, Slice C mount points, web + print
   CSS, and a Node render (no image import, no hooks).
   ====================================================================== */
import PackageView301 from "@/components/estimate-output/package-view";
import { PACKAGE_WEB_CSS as e301bvCss } from "@/components/estimate-output/package-view";
import { createElement as e301bvEl } from "react";
import { renderToStaticMarkup as e301bvRender } from "react-dom/server";
{
  const secs = p293Sections().map((s) =>
    s.id === "s2" ? { ...s, clientGoals: "Even front light.", keyProducts: [{ lineKey: "5", sku: "SKU-5", text: "A bright fresnel.", photo: true }] } : s) as E301bbSec[];
  const doc = { ...p293Props({ sections: secs, pdfOptions: { pdfOptions: true } }), rewardsLine: "Your Gold rewards: Free freight" };
  const base = { doc, photos: { "SKU-5": { src: "/share/quote/Q-293/t/photo/PD-5", alt: "Five" } }, catalog: new Map([["SKU-1", { mfr: "CatCo", manufacturerPartNumber: "CC-1" }]]),
    frozen: { coverSummary: "Our summary.", notIncluded: "Permits\nPainting" }, state: { kind: "ok", rev: { rev: 1 }, closed: false, won: false } as never,
    headerLine: "EST-1 · Rev 1 · sent Oct 5, 2026", currentHref: null, base: "/share/quote/Q-293/t", letterheadSrc: "/_test/lh.jpg" };
  const narr = e301bvRender(e301bvEl(PackageView301, { model: e301bmModel({ ...base, view: "narrative" }) }));
  const order = ["Narrative test", "EST-1 · Rev 1", "Our summary.", ">Narrative<", ">Rigging<", "Your goals", "Even front light.", "A bright fresnel.", ">Install<", "ADD OPTION 1", "Not included", "Permits"]
    .map((s) => narr.indexOf(s));
  ok(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), `#301 view: §5 order — header, summary, toggle, scopes (goals, intro, key products), options, Not included (${order.join(",")})`);
  ok(narr.includes('src="/share/quote/Q-293/t/photo/PD-5"') && narr.includes('aria-current="page"') && narr.includes('href="/share/quote/Q-293/t?view=bom"') &&
     !narr.includes("<table") && !narr.includes("[needs a paragraph]") && narr.includes("Your Gold rewards: Free freight"),
    "#301 view: Narrative — key-product photos via the scoped route, the BOM link, no table, no staff placeholder, the totals lines");
  const bom = e301bvRender(e301bvEl(PackageView301, { model: e301bmModel({ ...base, view: "bom" }) }));
  const tables = bom.match(/<table[\s\S]*?<\/table>/g) || [];
  ok(tables.length === 4 && tables.every((t) => !t.includes("$")) && bom.includes(">Manufacturer<") && bom.includes(">CatCo<") && bom.includes(">CC-1<") && !bom.includes("A bright fresnel."),
    "#301 view: BOM — one table per scope, Qty · Manufacturer · Part · Description, no price anywhere in a table");
  ok(!narr.includes("data-mount") && !bom.includes("data-mount"), "#301 view: no Slice C section renders without its slot");
  const slotted = e301bvRender(e301bvEl(PackageView301, { model: e301bmModel({ ...base, view: "narrative" }), slots: { plans: "PLANS-SLOT", downloads: "DL-SLOT", actions: "ACT-SLOT", keyProductExtra: { "SKU-5": "DS-SLOT" } } }));
  const so = ["A bright fresnel.", "DS-SLOT", "PLANS-SLOT", "ADD OPTION 1", "Not included", "DL-SLOT", "ACT-SLOT"].map((s) => slotted.indexOf(s));
  ok(so.every((v, i) => v >= 0 && (i === 0 || v > so[i - 1])) && slotted.includes('data-mount="plans"') && slotted.includes('data-mount="downloads"') && slotted.includes('data-mount="actions"'),
    `#301 view: Slice C mount points — datasheet under its key product, plans before options, downloads then actions last (${so.join(",")})`);
  const sup = e301bvRender(e301bvEl(PackageView301, { model: e301bmModel({ ...base, view: "narrative", currentHref: "/share/quote/Q-293/cur",
    state: { kind: "superseded", rev: { rev: 1 }, latestRev: 3, sentAt: Date.UTC(2026, 9, 6, 15) } as never }) }));
  ok(sup.includes('role="status"') && sup.includes("A newer version of this estimate was sent Oct 6, 2026.") && sup.includes('href="/share/quote/Q-293/cur"') && sup.includes("View the current version"),
    "#301 view: the superseded banner links the current version");
  ok(e301bvCss.includes("@media (max-width: 600px)") && e301bvCss.includes("@media print") && e301bvCss.includes(".pkg-bom-wrap { overflow-x: auto"),
    "#301 view: phone rules, a print stylesheet, and a BOM that scrolls inside its card (no page-wide horizontal scroll)");
  const comp = readFileSync(join(process.cwd(), "src/components/estimate-output/package-view.tsx"), "utf8");
  ok(!comp.includes('"use client"') && !/\buse(State|Effect|Ref|Transition)\(/.test(comp) && !comp.includes("onClick=") && !comp.includes(".jpg") && !comp.includes("next/link") &&
     !/^import (?!type)[^\n]*from "(?!react"|@\/lib\/quote-share\/package-view")/m.test(comp),
    "#301 view: a server component with pure props — no hooks, handlers, image import or server module");
}
```

- [ ] **Step 2: Run it to verify it fails** (module not found).

- [ ] **Step 3: Create `src/components/estimate-output/package-view.tsx`.**

```tsx
import { Fragment, type ReactNode } from "react";
import type { NarrativeBlock } from "@/app/(app)/estimator/narrative";
import type { PackageScopeView, PackageViewProps } from "@/lib/estimate-output/package-model";
import { PACKAGE_COPY } from "@/lib/quote-share/package-view";

/**
 * #301 slice B — the estimate package page (spec §5): a server component
 * with pure props (packageViewModel), no image import (the share page passes
 * the letterhead src — the D543 rule), no hooks, no handlers. The Narrative
 * / BOM toggle is two plain links (`?view=bom`), resolved on the server.
 *
 * Slice C mount points (render nothing until given):
 *   slots.keyProductExtra[sku] — under each key product (its datasheet link);
 *   slots.plans                — Plans & risers, after the totals;
 *   slots.downloads            — Downloads, after Not included;
 *   slots.actions              — Client actions, last.
 */

export type PackageSlots = {
  plans?: ReactNode;
  downloads?: ReactNode;
  actions?: ReactNode;
  keyProductExtra?: Record<string, ReactNode>;
};

export const PACKAGE_WEB_CSS = `
.pkg { display: flex; flex-direction: column; gap: 14px; font-size: 14px; line-height: 1.55; color: #16181d; }
.pkg-card { background: #fff; border: 1px solid #e4e7ec; border-radius: 12px; padding: 22px 26px; }
.pkg-logo-full { display: block; width: 100%; height: auto; margin-bottom: 16px; }
.pkg-logo { display: block; max-height: 64px; max-width: 100%; object-fit: contain; margin-bottom: 16px; }
.pkg-head-row { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; border-top: 3px solid var(--accent); padding-top: 14px; }
.pkg-title { margin: 0; font-size: 22px; font-weight: 700; line-height: 1.25; }
.pkg-meta { color: #5b616e; font-size: 13px; margin-top: 4px; }
.pkg-stamp { font-family: var(--font-mono); font-size: 12px; color: #5b616e; margin-top: 6px; }
.pkg-grand { text-align: right; }
.pkg-grand span { display: block; font-size: 11px; font-weight: 700; color: #5b616e; text-transform: uppercase; letter-spacing: .04em; }
.pkg-grand strong { font-size: 24px; font-variant-numeric: tabular-nums; }
.pkg-banner { padding: 11px 16px; border-radius: 10px; font-size: 13px; font-weight: 600; }
.pkg-banner-info { background: #e9eefb; border: 1px solid #d4ddf3; color: #3155a8; }
.pkg-banner-warn { background: #fbf3dd; border: 1px solid #f0e2bd; color: #8a6d1f; }
.pkg-banner a { color: inherit; text-decoration: underline; margin-left: 6px; }
.pkg h2 { margin: 0 0 10px; font-size: 16px; font-weight: 700; }
.pkg h3 { margin: 0 0 6px; font-size: 14px; font-weight: 700; }
.pkg-p { margin: 0 0 10px; }
.pkg-pre { white-space: pre-line; }
.pkg-ul { margin: 0 0 10px; padding-left: 20px; }
.pkg-toggle { display: inline-flex; align-self: flex-start; background: #e4e7ec; border-radius: 8px; padding: 2px; }
.pkg-toggle a { font-size: 12.5px; font-weight: 600; padding: 6px 14px; border-radius: 6px; text-decoration: none; color: #5b616e; }
.pkg-toggle a[aria-current="page"] { background: #fff; color: #16181d; box-shadow: 0 1px 2px rgba(0,0,0,.1); }
.pkg-scope-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; border-bottom: 1px solid #eef0f3; padding-bottom: 8px; margin-bottom: 12px; }
.pkg-scope-head h2 { margin: 0; }
.pkg-num { display: inline-block; min-width: 24px; color: color-mix(in srgb, var(--accent) 70%, #000); }
.pkg-price { font-weight: 700; font-variant-numeric: tabular-nums; }
.pkg-goals { background: #f7f8fa; border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; }
.pkg-label { font-size: 11px; font-weight: 700; color: #5b616e; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 4px; }
.pkg-kp { overflow: hidden; margin-top: 14px; }
.pkg-kp img { float: right; width: 34%; max-height: 2.4in; object-fit: contain; margin: 0 0 8px 14px; }
.pkg-bom-wrap { overflow-x: auto; }
.pkg-bom { width: 100%; border-collapse: collapse; font-size: 13px; }
.pkg-bom th { text-align: left; font-size: 11px; font-weight: 700; color: #5b616e; text-transform: uppercase; letter-spacing: .04em; border-bottom: 1px solid #e4e7ec; padding: 6px 8px; }
.pkg-bom td { border-bottom: 1px solid #f0f1f4; padding: 6px 8px; vertical-align: top; }
.pkg-bom .pkg-qty { white-space: nowrap; font-variant-numeric: tabular-nums; }
.pkg-row { display: flex; justify-content: space-between; gap: 12px; }
.pkg-total { font-size: 18px; font-weight: 700; }
.pkg-muted { color: #5b616e; font-size: 12.5px; }
.pkg-opts { margin: 0; padding-left: 0; list-style: none; }
.pkg-opts li { margin-bottom: 8px; }
@media (max-width: 600px) {
  .pkg-card { padding: 18px 16px; }
  .pkg-grand { text-align: left; }
  .pkg-kp img { float: none; display: block; width: 100%; max-height: 3in; margin: 0 0 10px; }
}
@page { size: letter; margin: 0.6in; }
@media print {
  html, body { background: #fff !important; }
  .pk-no-print { display: none !important; }
  .pkg-card { border: 0; border-radius: 0; padding: 0 0 12px; }
  .pkg-kp, .pkg-goals, .pkg-bom tr, .pkg-row { break-inside: avoid; page-break-inside: avoid; }
  .pkg-scope-head { break-after: avoid; page-break-after: avoid; }
}
`;

function Blocks({ blocks }: { blocks: NarrativeBlock[] }) {
  return (
    <>
      {blocks.map((b, i) =>
        b.kind === "p" ? (
          <p key={i} className="pkg-p">
            {b.lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {l}
              </Fragment>
            ))}
          </p>
        ) : (
          <ul key={i} className="pkg-ul">
            {b.items.map((it, j) => (
              <li key={j}>{it}</li>
            ))}
          </ul>
        )
      )}
    </>
  );
}

function Scope({ s, bom, extra }: { s: PackageScopeView; bom: boolean; extra: Record<string, ReactNode> }) {
  return (
    <section className="pkg-card pkg-scope" data-scope={s.id}>
      <div className="pkg-scope-head">
        <h2>
          <span className="pkg-num">{s.num}</span>
          {s.name}
        </h2>
        <span className="pkg-price">{s.price}</span>
      </div>
      {s.goals && (
        <div className="pkg-goals">
          <div className="pkg-label">{PACKAGE_COPY.goals}</div>
          <p className="pkg-p pkg-pre" style={{ margin: 0 }}>
            {s.goals}
          </p>
        </div>
      )}
      {!bom && (
        <>
          <Blocks blocks={s.intro} />
          {s.fallback && <p className="pkg-p">{s.fallback}</p>}
          {s.keyProducts.map((kp) => (
            <div key={kp.sku} className="pkg-kp">
              {kp.photo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={kp.photo.src} alt={kp.photo.alt} />
              )}
              <h3>{kp.heading}</h3>
              <Blocks blocks={kp.blocks} />
              {extra[kp.sku]}
            </div>
          ))}
        </>
      )}
      {bom &&
        (s.bom.length ? (
          <div className="pkg-bom-wrap">
            <table className="pkg-bom">
              <thead>
                <tr>
                  {PACKAGE_COPY.bomHead.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.bom.map((r) => (
                  <tr key={r.key}>
                    <td className="pkg-qty">{r.qty == null ? "" : `${r.qty}${r.unit ? " " + r.unit : ""}`}</td>
                    <td>{r.manufacturer}</td>
                    <td>{r.part}</td>
                    <td>{r.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="pkg-muted">{PACKAGE_COPY.noParts}</p>
        ))}
    </section>
  );
}

export default function PackageView({ model: m, slots = {} }: { model: PackageViewProps; slots?: PackageSlots }) {
  const bom = m.view === "bom";
  const extra = slots.keyProductExtra || {};
  return (
    <div className="pkg" data-view={m.view}>
      <style>{PACKAGE_WEB_CSS}</style>
      <header className="pkg-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={m.logo.src} alt={m.companyName} className={m.logo.full ? "pkg-logo-full" : "pkg-logo"} />
        <div className="pkg-head-row">
          <div style={{ minWidth: 0 }}>
            <h1 className="pkg-title">{m.title}</h1>
            <div className="pkg-meta">{[m.customer, m.venue].filter(Boolean).join(" · ")}</div>
            <div className="pkg-stamp">{m.headerLine}</div>
          </div>
          <div className="pkg-grand">
            <span>{m.totalLabel}</span>
            <strong>{m.total}</strong>
          </div>
        </div>
      </header>
      {m.banner && (
        <div role="status" className={`pkg-banner pkg-banner-${m.banner.tone}`}>
          {m.banner.text}
          {m.banner.href && m.banner.linkText && <a href={m.banner.href}>{m.banner.linkText}</a>}
        </div>
      )}
      {m.summary && (
        <section className="pkg-card">
          <h2>{PACKAGE_COPY.summary}</h2>
          <p className="pkg-p pkg-pre" style={{ margin: 0 }}>
            {m.summary}
          </p>
        </section>
      )}
      <nav aria-label="Estimate view" className="pkg-toggle pk-no-print">
        <a href={m.narrativeHref} aria-current={!bom ? "page" : undefined}>
          {PACKAGE_COPY.narrative}
        </a>
        <a href={m.bomHref} aria-current={bom ? "page" : undefined}>
          {PACKAGE_COPY.bom}
        </a>
      </nav>
      {m.scopes.map((s) => (
        <Scope key={s.id} s={s} bom={bom} extra={extra} />
      ))}
      <section className="pkg-card">
        {m.totals.creditLabel && m.totals.creditAmount && (
          <div className="pkg-row">
            <span>{m.totals.creditLabel}</span>
            <span>{m.totals.creditAmount}</span>
          </div>
        )}
        <div className="pkg-row pkg-total">
          <span>{m.totals.totalLabel}</span>
          <span>{m.totals.total}</span>
        </div>
        {m.totals.rewardsLine && <div className="pkg-muted">{m.totals.rewardsLine}</div>}
        {m.totals.standingLines.map((l, i) => (
          <div key={i} className="pkg-muted">
            {l}
          </div>
        ))}
      </section>
      {slots.plans && <section data-mount="plans">{slots.plans}</section>}
      {m.options.length > 0 && (
        <section className="pkg-card">
          <h2>{PACKAGE_COPY.options}</h2>
          <ul className="pkg-opts">
            {m.options.map((o) => (
              <li key={o.label}>
                <div className="pkg-row">
                  <strong>
                    {o.label} — {o.desc}
                  </strong>
                  <span className="pkg-price">{o.price}</span>
                </div>
                {o.reason && <div className="pkg-muted">{o.reason}</div>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {m.notIncluded.length > 0 && (
        <section className="pkg-card">
          <h2>{PACKAGE_COPY.notIncluded}</h2>
          <ul className="pkg-ul" style={{ margin: 0 }}>
            {m.notIncluded.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      )}
      {slots.downloads && <section data-mount="downloads">{slots.downloads}</section>}
      {slots.actions && <section data-mount="actions">{slots.actions}</section>}
    </div>
  );
}
```

  The harness's §5-order check finds the toggle by `">Narrative<"`. The title `Narrative test` renders as
  `>Narrative test<`, so it doesn't match. Keep the logo's `alt` as the company name, not the title.

- [ ] **Step 4: Run the gates** (tsc 0; test:specs ALL PASSED, PASS = previous + 8; eslint on the new file clean).

- [ ] **Step 5: Commit.**

```bash
git add src/components/estimate-output/package-view.tsx scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(estimate-output): #301 slice B — PackageView: header + total, scopes, Narrative/BOM, options, Not included, Slice C mounts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Package loader, share page v2 branch, photo route v2, smoke

**Files:**
- Create: `src/lib/estimate-output/package-loader.ts`, `src/app/share/quote/[id]/[token]/package-page.tsx`
- Modify: `src/lib/quote-share/photo-response.ts` (whole file, behavior-preserving refactor + two exports)
- Modify: `src/app/share/quote/[id]/[token]/page.tsx:1-35`, `src/app/share/quote/[id]/[token]/photo/[docId]/route.ts`
- Modify: `scripts/smoke-routes.ts` (`ROUTES` after `:230`; `DYNAMIC_ROUTES` after `:343`)
- Test: harness block `#301 slice B — page + loader`; `e301bPageAsyncChecks`

**Interfaces:**
- **Consumes:** `loadQuoteDocumentProps`, `keyProductPhotoLinks` (`document-loader.ts`); `getMany` (`stores/catalog`);
  `getEstimateOutputDefaults` (Slice A, `stores/estimate-output-defaults.ts`); `onlineHeaderLine`, `sharePath`,
  `onlineView`, `ONLINE_COPY`; Tasks 1–5.
- **Produces:** `loadPackageViewProps(hit: SharedPackage, opts: { base: string; view: "narrative" | "bom"; letterheadSrc: string }): Promise<PackageViewProps | null>`;
  `packagePhotoDocForRevision(rev, docId)`; `servePackagePhotoForRevision(req, rev, docId)`;
  `SharedPackagePage({ id, token, view })` (async server component); `GET /share/quote/[id]/<v2>` and its `photo/[docId]`.

- [ ] **Step 1: Write the failing harness block.** Append:

```ts
/* ======================================================================
   #301 slice B — page + loader: the share page's v2 branch, the package
   loader (frozen fields from the pinned revision only — R12), the v2
   photo set, the photo route accepting either token, smoke routes.
   ====================================================================== */
{
  const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const page = rd("src/app/share/quote/[id]/[token]/page.tsx");
  ok(page.indexOf("rateLimit(") < page.indexOf("isShareTokenV2(token)") && page.indexOf("isShareTokenV2(token)") < page.indexOf("resolveSharedQuote(") &&
     page.includes("<SharedPackagePage id={id} token={token} view={onlineView(sp.view)} />"),
    "#301 page: a v2 token branches to the package after the rate limit and before the v1 resolve");
  const pp = rd("src/app/share/quote/[id]/[token]/package-page.tsx");
  ok(pp.includes("resolveSharedPackage(id, token)") && pp.includes("loadPackageViewProps(") && (pp.match(/ONLINE_COPY\.shareInactive/g) || []).length === 1 &&
     pp.includes("<PackageView model={model} slots={{}} />") && pp.includes("Slice C") && !pp.includes('"use client"') && !/\b(update|patchShareLink|recordShareOpen)\(/.test(pp) &&
     !pp.includes("quoteAsOfRevision") && !pp.includes("auth(") && !pp.includes("cookies("),
    "#301 page: the package page resolves, loads, renders PackageView with the Slice C mounts empty, one inactive card; read-only, no session");
  const loader = rd("src/lib/estimate-output/package-loader.ts");
  ok(loader.includes("loadQuoteDocumentProps(hit.q, { revision: hit.rev, photos: { href } })") && loader.includes("packageFrozenFields(hit.rev.docFields,") &&
     loader.includes("keyProductPhotoLinks(packagePhotoSections(doc.sections), href)") && !loader.includes("quoteAsOfRevision") && !/\bq\.(coverSummary|notIncluded|packageFiles)\b/.test(loader),
    "#301 loader: the sent revision through the web loader; cover fields from the pinned revision only (R12); every scope's photos");
  const photo = rd("src/app/share/quote/[id]/[token]/photo/[docId]/route.ts");
  ok(photo.indexOf("rateLimit(") < photo.indexOf("isShareTokenV2(token)") && photo.indexOf("isShareTokenV2(token)") < photo.indexOf("resolveSharedQuote(") &&
     photo.includes("servePackagePhotoForRevision(req, pkg.rev, docId)"),
    "#301 photos: the share photo route takes a v2 token (the pinned revision's package photo set) or a v1 one (#293's)");
  const pr = rd("src/lib/quote-share/photo-response.ts");
  ok(pr.includes("keyProductPhotoDocs(packagePhotoSections(revisionSections(rev)))") && pr.includes("async function serveDoc("), "#301 photos: one serving path, two photo sets");
  const smoke = rd("scripts/smoke-routes.ts");
  ok(smoke.includes(`"/share/quote/Q-2041/1.1.${"A".repeat(43)}",`) && smoke.includes(`"/share/quote/Q-2041/1.1.${"A".repeat(43)}?view=bom",`) &&
     smoke.includes(`{ route: "/share/quote/Q-2041/1.1.${"A".repeat(43)}/photo/PD-1", expectNotFound: true }`),
    "#301 smoke: a well-formed but invalid v2 token (page + BOM view → the 200 card; photo → 404)");
}

async function e301bPageAsyncChecks(): Promise<void> {
  const { fixtureId } = await import("./test-fixtures");
  const Q = await import("@/lib/stores/quotes");
  const L = await import("@/lib/quote-share/links");
  const C = await import("@/lib/stores/catalog");
  const { loadPackageViewProps } = await import("@/lib/estimate-output/package-loader");
  const { packagePhotoDocForRevision } = await import("@/lib/quote-share/photo-response");
  const S = "test-secret-301bp";
  const QID = fixtureId(301, "b-page");
  const SKU = fixtureId(301, "b-bom-part");
  await C.upsert({ sku: SKU, desc: "Fixture 301b", category: "Other", unit: "ea", list: 10, cost: 5, mfr: "Acme Lights", manufacturerPartNumber: "AL-100" });
  registerFixture("catalog_parts", SKU);
  const sec = { id: "s1", name: "Stage lighting", kind: "materials", mfr: "", freightPct: 0, clientGoals: "Even light.", narrative: "Frozen intro.",
    items: [{ id: 1, sku: SKU, desc: "Fixture", qty: 2, unit: "ea", cost: 10, price: 25 }] };
  await Q.create({ id: QID, name: "#301b page", customer: "Spec fixture", owner: "spec", quoteType: "system", source: "estimator", coverSummary: "Frozen summary.", notIncluded: "Permits",
    spec: { sections: [sec], mobs: [] } });
  registerFixture("quotes", QID);
  await Q.update(QID, { status: "sent" });
  await Q.addQuoteRevision(QID, { by: "Test", reason: "sent" });
  const made = await L.ensureShareLink(QID, "Tester", { secret: S });
  const tok = made.ok && made.link.pathV2 ? made.link.pathV2.split("/").pop()! : "";
  // Edits after the send must never reach the page (R12).
  await Q.update(QID, { coverSummary: "LIVE-UNSENT-301B", notIncluded: "LIVE-UNSENT-301B", spec: { sections: [{ ...sec, narrative: "LIVE-UNSENT-301B" }], mobs: [] } });
  const hit = await L.resolveSharedPackage(QID, tok, { secret: S });
  const base = "/share/quote/" + encodeURIComponent(QID) + "/" + tok;
  const props = hit ? await loadPackageViewProps(hit, { base, view: "bom", letterheadSrc: "/_test/lh.jpg" }) : null;
  ok(!!props && props.summary === "Frozen summary." && props.notIncluded.join("|") === "Permits" && props.scopes[0].intro.length === 1 && props.scopes[0].goals === "Even light." &&
     !JSON.stringify(props).includes("LIVE-UNSENT-301B"),
    "#301 loader (DB): the page shows the version that was sent — unsent edits to the summary, Not included or systems never leak (R12)");
  ok(props?.scopes[0].bom[0]?.manufacturer === "Acme Lights" && props?.scopes[0].bom[0]?.part === "AL-100" && props?.scopes[0].price === "$50.00" && props?.view === "bom",
    "#301 loader (DB): BOM manufacturer / part # from the catalog (getMany); the scope price");
  ok(hit ? (await packagePhotoDocForRevision(hit.rev, "PD-NOPE-301B")) === null : false, "#301 photos (DB): a doc outside the revision's photo set is never served");
}
```

  Append `await e301bPageAsyncChecks();` at the end of `estimateOutput301BAsyncChecks`'s body.

- [ ] **Step 2: Run it to verify it fails** (ENOENT on `package-page.tsx`; module not found `package-loader`).

- [ ] **Step 3: Refactor `src/lib/quote-share/photo-response.ts`.** Replace the file's body below the imports, and add
  one import:

```ts
import { packagePhotoSections } from "@/lib/estimate-output/package-model";
```

```ts
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

/** #301 slice B — the package page's photo set: every printed system's key
 *  products, whatever its presentation (package-model.ts packagePhotoSections). */
export async function packagePhotoDocForRevision(rev: QuoteRevision, docId: string): Promise<PartDocument | null> {
  if (typeof docId !== "string" || !docId) return null;
  const docs = await keyProductPhotoDocs(packagePhotoSections(revisionSections(rev)));
  for (const d of docs.values()) if (d.id === docId) return d;
  return null;
}

/** A fresh Response per call — a body can be read only once. */
const notFound = () => new Response("Not found", { status: 404 });

async function serveDoc(req: Request, doc: PartDocument | null): Promise<Response> {
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

export async function servePhotoForRevision(req: Request, rev: QuoteRevision, docId: string): Promise<Response> {
  return serveDoc(req, await photoDocForRevision(rev, docId));
}

export async function servePackagePhotoForRevision(req: Request, rev: QuoteRevision, docId: string): Promise<Response> {
  return serveDoc(req, await packagePhotoDocForRevision(rev, docId));
}
```

  The #293t pin wants the literal `"private, max-age=3600"`. It is still in `ONLINE_PHOTO_CACHE`. Keep the doc comment
  at the top and add one line: "#301 slice B: the v2 package page serves a wider set
  (packagePhotoDocForRevision); both go through serveDoc."

- [ ] **Step 4: Create `src/lib/estimate-output/package-loader.ts`.**

```ts
import { getMany } from "@/lib/stores/catalog";
import { getEstimateOutputDefaults } from "@/lib/stores/estimate-output-defaults";
import { keyProductPhotoLinks, loadQuoteDocumentProps } from "@/lib/quote-pdf/document-loader";
import { onlineHeaderLine } from "@/lib/quote-share/view";
import type { SharedPackage } from "@/lib/quote-share/links";
import { packageBomSkus, type BomCatalogPart } from "./bom";
import { packageFrozenFields, packagePhotoSections, packageViewModel, type PackageViewProps } from "./package-model";

/**
 * #301 slice B — the package page's props for a resolved v2 link. The
 * document is the pinned SENT revision through the #293 web loader (which
 * fails closed for anything else and is the only place an as-sent quote is
 * built). The cover fields come from that revision's docFields only (R12 —
 * never the live quote). Photos: every scope's key products (the v2 set).
 * BOM: line fields first, then the catalog by sku (R6). Server-only.
 */
export async function loadPackageViewProps(
  hit: SharedPackage,
  opts: { base: string; view: "narrative" | "bom"; letterheadSrc: string }
): Promise<PackageViewProps | null> {
  const href = (docId: string) => `${opts.base}/photo/${encodeURIComponent(docId)}`;
  const doc = await loadQuoteDocumentProps(hit.q, { revision: hit.rev, photos: { href } });
  if (!doc) return null;
  const [photos, catalog, defaults] = await Promise.all([
    keyProductPhotoLinks(packagePhotoSections(doc.sections), href),
    catalogFor(packageBomSkus(doc.sections)),
    getEstimateOutputDefaults(),
  ]);
  return packageViewModel({
    doc,
    photos,
    catalog,
    frozen: packageFrozenFields(hit.rev.docFields, defaults.notIncluded),
    state: hit.state,
    headerLine: onlineHeaderLine(hit.q, hit.rev),
    currentHref: hit.currentPath,
    view: opts.view,
    base: opts.base,
    letterheadSrc: opts.letterheadSrc,
  });
}

/** Never fails the page: a catalog read error leaves Manufacturer / Part blank. */
async function catalogFor(skus: string[]): Promise<Map<string, BomCatalogPart>> {
  const out = new Map<string, BomCatalogPart>();
  if (!skus.length) return out;
  try {
    for (const p of await getMany(skus)) out.set(p.sku, { mfr: p.mfr ?? null, manufacturerPartNumber: p.manufacturerPartNumber ?? null });
  } catch (e) {
    console.warn("[package] catalog lookup failed", e instanceof Error ? e.message : e);
  }
  return out;
}
```

  (If Slice A named the defaults reader differently, use the real export. Its return has `notIncluded: string`.)

- [ ] **Step 5: Create `src/app/share/quote/[id]/[token]/package-page.tsx`.**

```tsx
import letterhead from "@/app/(app)/estimator/peak-letterhead.jpg";
import PackageView from "@/components/estimate-output/package-view";
import { OnlineEstimateCard } from "@/components/online-estimate/online-estimate";
import { loadPackageViewProps } from "@/lib/estimate-output/package-loader";
import { resolveSharedPackage } from "@/lib/quote-share/links";
import { ONLINE_COPY, sharePath } from "@/lib/quote-share/view";

/**
 * #301 slice B — the v2 (rev-pinned) share link's page: the estimate package
 * (spec §5). The share page has already rate-limited the request. Order:
 * resolveSharedPackage (shape → get → v2 verify → state) → the package
 * loader (the pinned SENT revision; fails closed). Every miss is the ONE
 * "isn't active" card, 200. Read-only and session-free.
 *
 * Slice C mounts: `slots` stays `{}` until Plans & risers (plans),
 * datasheet links (keyProductExtra), Downloads (downloads) and Client actions
 * (actions — gated on canAct(hit.state)) land.
 */
export async function SharedPackagePage({ id, token, view }: { id: string; token: string; view: "narrative" | "bom" }) {
  const hit = await resolveSharedPackage(id, token);
  const model = hit ? await loadPackageViewProps(hit, { base: sharePath(hit.q.id, token), view, letterheadSrc: letterhead.src }) : null;
  if (!hit || !model) return <OnlineEstimateCard title={ONLINE_COPY.shareInactive} />;
  return <PackageView model={model} slots={{}} />;
}
```

- [ ] **Step 6: `src/app/share/quote/[id]/[token]/page.tsx`.** Add two imports after `:7`:

```tsx
import { isShareTokenV2 } from "@/lib/quote-share/token";
import { SharedPackagePage } from "./package-page";
```

  After the rate-limit line (`:33`) insert:

```tsx
  // #301 slice B — a v2 (rev-pinned) token opens the estimate package; a v1
  // token keeps #293's page below, unchanged.
  if (isShareTokenV2(token)) return <SharedPackagePage id={id} token={token} view={onlineView(sp.view)} />;
```

  In the doc comment, replace the last line, `Read-only: no view tracking.`, with:
  `Read-only: no view tracking here (#301 slice B: a v2 package page records opens through its client beacon only).`

- [ ] **Step 7: The photo route.** Replace `src/app/share/quote/[id]/[token]/photo/[docId]/route.ts`'s imports and `GET` with:

```ts
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { resolveSharedPackage, resolveSharedQuote, SHARE_PHOTO_PER_MIN } from "@/lib/quote-share/links";
import { servePackagePhotoForRevision, servePhotoForRevision } from "@/lib/quote-share/photo-response";
import { isShareTokenV2 } from "@/lib/quote-share/token";

export const dynamic = "force-dynamic";

/**
 * A key-product photo on the share page (#293 slice 3, spec §5.4). Per-IP
 * rate limit first (no client IP = one fixed "unknown" key). A v2 token
 * (#301 slice B) serves only its PINNED revision's package photo set,
 * whatever the page's state (ok, superseded, revising). A v1 token keeps
 * #293's check: the doc must be one the quote's latest SENT revision prints.
 * Anything else is a plain 404. Read-only.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; token: string; docId: string }> }) {
  const { id, token, docId } = await ctx.params;
  if (!rateLimit("share-photo:" + (clientIp(req) || "unknown"), SHARE_PHOTO_PER_MIN, 60_000).ok) return new Response("Too many requests", { status: 429 });
  if (isShareTokenV2(token)) {
    const pkg = await resolveSharedPackage(id, token);
    if (!pkg) return new Response("Not found", { status: 404 });
    return servePackagePhotoForRevision(req, pkg.rev, docId);
  }
  const hit = await resolveSharedQuote(id, token);
  if (!hit || hit.state.kind !== "ok") return new Response("Not found", { status: 404 });
  return servePhotoForRevision(req, hit.state.rev, docId);
}
```

- [ ] **Step 8: Smoke routes.** In `scripts/smoke-routes.ts` `ROUTES`, after `"/share/quote/Q-2041/not-a-token",` (`:230`):

```ts
  // #301 slice B — a well-formed v2 (rev-pinned) token that fails the HMAC
  // verify: the package page compiles and answers the same 200 card, in
  // both views.
  "/share/quote/Q-2041/1.1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "/share/quote/Q-2041/1.1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA?view=bom",
```

  In `DYNAMIC_ROUTES`, after the `/api/racks/SA-NOPE/submittal` entry (`:343`):

```ts
  // #301 slice B — the share photo route with a v2 token that fails the verify: a clean 404.
  { route: "/share/quote/Q-2041/1.1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/photo/PD-1", expectNotFound: true },
```

  (43 `A`s each. Count them. The harness check builds the same string with `"A".repeat(43)`.)

- [ ] **Step 9: Run the gates.** tsc 0; test:specs ALL PASSED (PASS = previous + 6 sync + 3 DB; every `#293t share page`,
  `#293t share photos`, `#293t photos` and `#293t binding` check still passes); eslint on the five src files; then
  `rm -rf .next && env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npx next build 2>&1 | tail -20` → OK. The page imports a
  `.jpg`, a client island is coming next, and `next build` is the only gate that sees a client/server import break.

- [ ] **Step 10: Commit.**

```bash
git add src/lib/estimate-output/package-loader.ts src/lib/quote-share/photo-response.ts "src/app/share/quote/[id]/[token]/package-page.tsx" \
  "src/app/share/quote/[id]/[token]/page.tsx" "src/app/share/quote/[id]/[token]/photo/[docId]/route.ts" scripts/smoke-routes.ts scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(share): #301 slice B — v2 links open the estimate package (frozen, rev-pinned); photo route takes either token

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Client link panel — Copy v2 + per-rev list

**Files:**
- Modify: `src/app/(app)/estimator/client-link-panel.tsx:98-104` (copy path), `:157-186` (render)
- Test: harness block `#301 slice B — client link panel`

**Interfaces:**
- **Consumes:** `ShareLinkStatus.sentRevs`, `ShareLinkView.pathV2` (Task 3). No new action.
- **Produces:** the panel copies the v2 link and renders `data-testid="client-link-revs"` with one line per sent revision.

- [ ] **Step 1: Write the failing harness block.** Append:

```ts
/* ======================================================================
   #301 slice B — client link panel: Copy client link copies the v2
   (rev-pinned) link; every sent revision is listed with its opens.
   ====================================================================== */
{
  const panel = readFileSync(join(process.cwd(), "src/app/(app)/estimator/client-link-panel.tsx"), "utf8");
  ok(panel.includes("const path = link.pathV2 ?? link.path;") && panel.includes("const url = window.location.origin + path;") && !panel.includes("window.location.origin + link.path"),
    "#301 panel: Copy client link copies the v2 link to the latest sent revision");
  ok(panel.includes('data-testid="client-link-revs"') && panel.includes("status.sentRevs.map((r) =>") && panel.includes("{r.line}") && panel.includes("key={r.rev}"),
    "#301 panel: one line per sent revision (Rev N, superseded, opens)");
  ok(/^"use client";/.test(panel) && !/^import (?!type)[^\n]*from "@\/(lib\/stores|db|lib\/blob|lib\/session|lib\/quote-share\/(token|links|photo-response|package-view))/m.test(panel),
    "#301 panel: still a client component with no server value import (the rows come from the status action)");
}
```

- [ ] **Step 2: Run it to verify it fails.**

- [ ] **Step 3: The copy path.** In `copy` (`:98-104`), replace

```tsx
      const link = r.link;
      if (!link.path) {
        setErr(FAILED);
        return;
      }
      setStatus((s) => (s ? { ...s, link } : s));
      const url = window.location.origin + link.path;
```

  with

```tsx
      const link = r.link;
      // #301 slice B: the copyable link pins the latest sent revision (v2).
      const path = link.pathV2 ?? link.path;
      if (!path) {
        setErr(FAILED);
        return;
      }
      setStatus((s) => (s ? { ...s, link } : s));
      const url = window.location.origin + path;
```

- [ ] **Step 4: The per-rev list.** After the `{link && (<span style={small}>Expires … created by …</span>)}` block
  (`:163-167`), insert:

```tsx
      {status.sentRevs.length > 0 && (
        <div data-testid="client-link-revs" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {status.sentRevs.map((r) => (
            <span key={r.rev} style={{ ...small, color: r.latest ? "#3a3f4a" : "#9aa0ab" }}>
              {r.line}
            </span>
          ))}
        </div>
      )}
```

  Also update the file's doc comment. Append: "#301 slice B: Copy copies the v2 link (pinned to the latest sent revision);
  every sent revision is listed with its opens (a superseded one keeps working with a banner)."

- [ ] **Step 5: Run the gates** (tsc 0; test:specs ALL PASSED, PASS = previous + 3, every `#293t panel` / `#293t final 9`
  check still passes; eslint on the panel; `next build` OK).

- [ ] **Step 6: Commit.**

```bash
git add "src/app/(app)/estimator/client-link-panel.tsx" scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(estimator): #301 slice B — Client link panel copies the rev-pinned link and lists each sent revision with its opens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Open tracking — store-owned `shareOpens`, `recordSharedOpen`, action, beacon

**Files:**
- Modify: `src/lib/stores/quotes.ts` (`Quote` after `notIncluded?: string;` `:321`; `update()` `:753-765`; append
  `recordShareOpen` after `patchShareLink`, `~:1025`; one import)
- Modify: `src/lib/quote-share/links.ts` (append `recordSharedOpen`, `SHARE_OPEN_PER_MIN`; one import)
- Create: `src/app/share/quote/[id]/[token]/actions.ts`, `src/app/share/quote/[id]/[token]/open-beacon.tsx`
- Modify: `src/app/share/quote/[id]/[token]/package-page.tsx` (mount the beacon)
- Test: harness block `#301 slice B — opens`; `e301bOpensAsyncChecks`

**Interfaces:**
- **Consumes:** `nextOpens`, `ShareOpens`, `SHARE_OPEN_DEDUPE_MS` (Task 2); `resolveSharedPackage` (Task 3); `rateLimit`,
  `clientIpFromHeaders`; `getOptionalUser`; `headers` (async).
- **Produces:** `Quote.shareOpens?: ShareOpens | null`;
  `recordShareOpen(id: string, rev: number, now: number): Promise<boolean>` (quotes.ts);
  `recordSharedOpen(id: string, token: string, ip: string, opts?: { secret?: string; now?: number }): Promise<boolean>` and
  `SHARE_OPEN_PER_MIN = 30` (links.ts); `recordShareOpenAction(id: string, token: string): Promise<void>`;
  `OpenBeacon({ id, token })`.

- [ ] **Step 1: Write the failing harness block.** Append:

```ts
/* ======================================================================
   #301 slice B — opens (R18): the store-owned counter (row lock, no
   updatedAt / contentChangedAt move, update() can't write it), the
   per-IP-hash 30-minute dedupe, v2 only, team users skipped, the beacon.
   ====================================================================== */
{
  const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const qs = rd("src/lib/stores/quotes.ts");
  const upd = qs.slice(qs.indexOf("export async function update("), qs.indexOf("\n}\n", qs.indexOf("export async function update(")));
  const rso = qs.slice(qs.indexOf("export async function recordShareOpen("), qs.indexOf("\n}\n", qs.indexOf("export async function recordShareOpen(")));
  ok(upd.includes("delete clean.shareOpens;") && rso.includes("patchQuote(id,") && !rso.includes("updatedAt") && rso.includes('r.reason === "sent"') &&
     (qs.match(/\.shareOpens = /g) || []).length === (rso.match(/\.shareOpens = /g) || []).length,
    "#301 opens: recordShareOpen is the only writer (row lock, sent revisions only, never updatedAt); update() drops a caller's shareOpens");
  const acts = rd("src/app/share/quote/[id]/[token]/actions.ts");
  ok(/^"use server";/.test(acts) && !/^export (?!async function)/m.test(acts) && acts.includes("export async function recordShareOpenAction(id: string, token: string): Promise<void>") &&
     acts.indexOf("getOptionalUser()") < acts.indexOf("recordSharedOpen(") && acts.includes("clientIpFromHeaders(await headers())") && acts.includes("catch (e)"),
    "#301 opens: the action skips team users first, keys on the client IP, never throws and returns nothing");
  const lk = rd("src/lib/quote-share/links.ts");
  ok(lk.includes("rateLimit(`share-open:${hit.q.id}:${hit.rev.rev}:${ipKey(ip)}`, 1, SHARE_OPEN_DEDUPE_MS)") && lk.includes('createHash("sha256")'),
    "#301 opens: one open per IP-hash per revision per 30 minutes (the in-memory limiter)");
  const beacon = rd("src/app/share/quote/[id]/[token]/open-beacon.tsx");
  ok(/^"use client";/.test(beacon) && beacon.includes("useEffect(") && beacon.includes("sent.current") && beacon.includes('from "./actions"') &&
     !/^import (?!type)[^\n]*from "@\/(lib|db)\//m.test(beacon) && beacon.includes("return null;"),
    "#301 opens: a JS beacon (link scanners don't run it), once per page load, no server import, renders nothing");
  const pp = rd("src/app/share/quote/[id]/[token]/package-page.tsx");
  ok(pp.includes("<OpenBeacon id={hit.q.id} token={token} />") && pp.indexOf("<PackageView") < pp.indexOf("<OpenBeacon"), "#301 opens: the package page mounts the beacon");
}

async function e301bOpensAsyncChecks(): Promise<void> {
  const { fixtureId } = await import("./test-fixtures");
  const Q = await import("@/lib/stores/quotes");
  const L = await import("@/lib/quote-share/links");
  const S = "test-secret-301bw";
  const QID = fixtureId(301, "b-opens");
  const sec = { id: "s1", name: "Stage lighting", kind: "materials", mfr: "", freightPct: 0, items: [{ id: 1, sku: "A", desc: "Fixture", qty: 1, unit: "ea", cost: 10, price: 20 }] };
  await Q.create({ id: QID, name: "#301b opens", customer: "Spec fixture", owner: "spec", quoteType: "system", source: "estimator", spec: { sections: [sec], mobs: [] } });
  registerFixture("quotes", QID);
  await Q.update(QID, { status: "sent" });
  await Q.addQuoteRevision(QID, { by: "Test", reason: "sent" });
  const made = await L.ensureShareLink(QID, "Tester", { secret: S });
  const tok2 = made.ok && made.link.pathV2 ? made.link.pathV2.split("/").pop()! : "";
  const tok1 = made.ok && made.link.path ? made.link.path.split("/").pop()! : "";
  const before = (await Q.get(QID))!;
  const salt = String(Date.now() % 100_000);
  const ipA = "198.51.100.1-" + salt;
  const ipB = "198.51.100.2-" + salt;
  ok((await L.recordSharedOpen(QID, tok2, ipA, { secret: S })) === true && (await L.recordSharedOpen(QID, tok2, ipA, { secret: S })) === false &&
     (await L.recordSharedOpen(QID, tok2, ipB, { secret: S })) === true,
    "#301 opens (DB): the first open from an IP counts, a repeat inside 30 minutes doesn't, another IP does");
  const after = (await Q.get(QID))!;
  ok(after.shareOpens?.["1"]?.count === 2 && after.updatedAt === before.updatedAt && after.contentChangedAt === before.contentChangedAt,
    "#301 opens (DB): two opens on rev 1; neither updatedAt nor contentChangedAt moved");
  ok((await L.recordSharedOpen(QID, tok1, "198.51.100.3-" + salt, { secret: S })) === false, "#301 opens (DB): a v1 link records nothing (#293 unchanged)");
  await Q.update(QID, { shareOpens: { "1": { first: 1, last: 1, count: 999 } } } as never);
  ok((await Q.get(QID))!.shareOpens?.["1"]?.count === 2, "#301 opens (DB): update() can't overwrite the counter");
  ok((await Q.recordShareOpen(QID, 99, Date.now())) === false && (await Q.recordShareOpen(QID, 1, NaN)) === false, "#301 opens (DB): only a sent revision, only a real clock");
  ok(L.shareLinkStatus((await Q.get(QID))!, true, S, Date.now()).sentRevs[0].line.startsWith("Rev 1 · opened 2× · first "), "#301 opens (DB): the Client link panel's row shows the count");
  await L.revokeShareLink(QID, "Revoker");
  ok((await L.recordSharedOpen(QID, tok2, "198.51.100.4-" + salt, { secret: S })) === false, "#301 opens (DB): a revoked link records nothing");
}
```

  Append `await e301bOpensAsyncChecks();` at the end of `estimateOutput301BAsyncChecks`'s body.

- [ ] **Step 2: Run it to verify it fails.**

- [ ] **Step 3: `src/lib/stores/quotes.ts`.** Add an import beside the token import (`:24`):

```ts
import { nextOpens, type ShareOpens } from "@/lib/estimate-output/opens";
```

  Add to `Quote` after `notIncluded?: string;`:

```ts
  /** #301 slice B (D-o, R18) — client opens of the rev-pinned package link,
   *  per sent revision (rev → first / last / count). Written only by
   *  recordShareOpen under the row lock; update() drops it; never content,
   *  never snapshotted, never copied by buildQuote. Staff-only. */
  shareOpens?: ShareOpens | null;
```

  In `update()`, after `delete clean.shareLink;`:

```ts
    // #301 slice B: the open counter is recordShareOpen's alone.
    delete clean.shareOpens;
```

  Append after `patchShareLink`'s closing brace:

```ts
/**
 * #301 slice B — the ONLY writer of `Quote.shareOpens`: one more open of a
 * SENT revision, under the row lock. Never bumps `updatedAt` (the printed
 * date / sort key / approval version) and never changes content
 * (shareOpens isn't a QUOTE_CONTENT_FIELDS member). false = nothing written
 * (unknown quote, not a sent revision, a bad clock, or the 100-revision cap).
 */
export async function recordShareOpen(id: string, rev: number, now: number): Promise<boolean> {
  if (!Number.isSafeInteger(rev) || rev < 1 || !Number.isFinite(now)) return false;
  let wrote = false;
  await patchQuote(id, (doc) => {
    const revs = Array.isArray(doc.revisions) ? doc.revisions : [];
    if (!revs.some((r) => !!r && r.rev === rev && r.reason === "sent")) return;
    const next = nextOpens(doc.shareOpens, rev, now);
    if (!next) return;
    doc.shareOpens = next;
    wrote = true;
  });
  return wrote;
}
```

  (`patchQuote` returns null for an unknown id and the callback never runs, so `wrote` stays false.)

- [ ] **Step 4: `src/lib/quote-share/links.ts`.** Add imports:

```ts
import { createHash } from "node:crypto";
import { rateLimit } from "@/lib/rate-limit";
import { recordShareOpen } from "@/lib/stores/quotes";
import { SHARE_OPEN_DEDUPE_MS } from "@/lib/estimate-output/opens";
```

  (Merge `recordShareOpen` into the existing `@/lib/stores/quotes` import line instead of adding a second one.) Append:

```ts
/** Cheap per-IP guard before any read, for the open beacon. */
export const SHARE_OPEN_PER_MIN = 30;

/** The dedupe key never holds the raw IP. */
function ipKey(ip: string): string {
  return createHash("sha256").update(ip || "unknown").digest("base64url").slice(0, 16);
}

/**
 * #301 slice B (D-o, R18) — record one client open of a v2 package link.
 * v1 links and anything resolveSharedPackage refuses record nothing. At
 * most one open per IP-hash per pinned revision per 30 minutes — in memory
 * (the rate limiter), so a restart or a second instance can count one more;
 * best-effort by design. The caller has already skipped team users.
 */
export async function recordSharedOpen(id: string, token: string, ip: string, opts: { secret?: string; now?: number } = {}): Promise<boolean> {
  const hit = await resolveSharedPackage(id, token, opts);
  if (!hit) return false;
  if (!rateLimit(`share-open:${hit.q.id}:${hit.rev.rev}:${ipKey(ip)}`, 1, SHARE_OPEN_DEDUPE_MS).ok) return false;
  return recordShareOpen(hit.q.id, hit.rev.rev, opts.now ?? Date.now());
}
```

- [ ] **Step 5: Create `src/app/share/quote/[id]/[token]/actions.ts`.**

```ts
"use server";

import { headers } from "next/headers";
import { getOptionalUser } from "@/lib/session";
import { clientIpFromHeaders, rateLimit } from "@/lib/rate-limit";
import { recordSharedOpen, SHARE_OPEN_PER_MIN } from "@/lib/quote-share/links";

/**
 * #301 slice B — the package page's server actions. Public (the share route
 * is outside the team login). Every action re-verifies the v2 token itself.
 * Slice C adds submitScopeSelection / askQuestion here.
 */

/** R18 — one client open. Called from the page's JS beacon, so link-preview
 *  bots and mail scanners (which don't run JS) aren't counted. Team members
 *  previewing the link are skipped. Never throws; reveals nothing. */
export async function recordShareOpenAction(id: string, token: string): Promise<void> {
  try {
    if (typeof id !== "string" || typeof token !== "string") return;
    if (await getOptionalUser()) return;
    const ip = clientIpFromHeaders(await headers()) || "unknown";
    if (!rateLimit("share-open-ip:" + ip, SHARE_OPEN_PER_MIN, 60_000).ok) return;
    await recordSharedOpen(id, token, ip);
  } catch (e) {
    console.warn("[share] open not recorded", e instanceof Error ? e.message : e);
  }
}
```

- [ ] **Step 6: Create `src/app/share/quote/[id]/[token]/open-beacon.tsx`.**

```tsx
"use client";

import { useEffect, useRef } from "react";
import { recordShareOpenAction } from "./actions";

/** #301 slice B — records one open per page load (R18). Strict Mode's
 *  double effect is absorbed by the ref; failures are swallowed (no UI). */
export function OpenBeacon({ id, token }: { id: string; token: string }) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    recordShareOpenAction(id, token).catch(() => undefined);
  }, [id, token]);
  return null;
}
```

- [ ] **Step 7: Mount it** in `package-page.tsx`: add `import { OpenBeacon } from "./open-beacon";` and change the
  last return to

```tsx
  return (
    <>
      <PackageView model={model} slots={{}} />
      <OpenBeacon id={hit.q.id} token={token} />
    </>
  );
```

  The Task 6 pin `pp.includes("<PackageView model={model} slots={{}} />")` still holds.

- [ ] **Step 8: Run the gates** (tsc 0; test:specs ALL PASSED, PASS = previous + 5 sync + 7 DB; the #293t
  `patchShareLink is the only shareLink writer` and `update() drops a caller's shareLink` checks still pass; eslint on
  `quotes.ts`, `links.ts`, `package-page.tsx` and the two new files; `next build` OK).

- [ ] **Step 9: Commit.**

```bash
git add src/lib/stores/quotes.ts src/lib/quote-share/links.ts "src/app/share/quote/[id]/[token]/actions.ts" "src/app/share/quote/[id]/[token]/open-beacon.tsx" \
  "src/app/share/quote/[id]/[token]/package-page.tsx" scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(share): #301 slice B — package link opens: JS beacon, store-owned counter per sent rev, 30-min IP-hash dedupe, team skipped

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Opens display — Quotes hub chip + lead drawer line

**Files:**
- Modify: `src/app/(app)/quotes/page.tsx` (import; the row map `:544-558`; the chip before
  `{reviewLimit && <ReviewLimitChip` `:698`)
- Modify: `src/app/(app)/leads/types.ts:87-89` (`DrawerDetailVM`), `src/app/(app)/leads/lib.ts:100`, `:200`,
  `src/app/(app)/leads/lead-drawer.tsx:1153`
- Test: harness block `#301 slice B — opens display`

**Interfaces:**
- **Consumes:** `opensChip`, `latestOpensLine` (Task 2); `Quote.shareOpens` (Task 8).
- **Produces:** `DrawerDetailVM.quoteOpensLine: string`; the hub's `data-testid="quote-opened-chip"`; the drawer's
  `data-testid="lead-quote-opens"`.

- [ ] **Step 1: Write the failing harness block.** Append:

```ts
/* ======================================================================
   #301 slice B — opens display (§8): the Quotes hub "Opened" chip and the
   lead drawer's Client link line, both from the pure package-view rules.
   ====================================================================== */
{
  const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const hub = rd("src/app/(app)/quotes/page.tsx");
  ok(hub.includes('import { opensChip } from "@/lib/quote-share/package-view";') && hub.includes("const opened = opensChip(q);") && hub.includes('data-testid="quote-opened-chip"') &&
     hub.includes("title={opened.title}") && hub.indexOf('data-testid="quote-opened-chip"') < hub.indexOf("{reviewLimit && <ReviewLimitChip"),
    "#301 hub: an \"Opened\" chip on a quote whose client link was opened (rows in its title)");
  const lib = rd("src/app/(app)/leads/lib.ts");
  ok(lib.includes("quoteOpensLine: latestOpensLine(convertedQuote),") && lib.includes('import { latestOpensLine } from "@/lib/quote-share/package-view";'),
    "#301 lead: the drawer view-model carries the converted quote's Client link line");
  ok(rd("src/app/(app)/leads/types.ts").includes("quoteOpensLine: string;"), "#301 lead: DrawerDetailVM.quoteOpensLine");
  const drawer = rd("src/app/(app)/leads/lead-drawer.tsx");
  ok(drawer.includes('data-testid="lead-quote-opens"') && drawer.includes("{vm.quoteOpensLine}") && drawer.indexOf('data-testid="lead-quote-opens"') < drawer.indexOf("{/* footer actions */}"),
    "#301 lead: the drawer shows the line above its footer");
}
```

- [ ] **Step 2: Run it to verify it fails.**

- [ ] **Step 3: Quotes hub.** Add the import after `:31`:

```tsx
import { opensChip } from "@/lib/quote-share/package-view";
```

  In the row map, after `const reviewLimit = reviewLimitChip(q, limitCtx, me);` (`:546`):

```tsx
          // #301 slice B: the client opened the package link (any sent revision).
          const opened = opensChip(q);
```

  Immediately before `{reviewLimit && <ReviewLimitChip chip={reviewLimit} variant="pill" />}` (`:698`):

```tsx
                    {opened && (
                      <span
                        data-testid="quote-opened-chip"
                        title={opened.title}
                        style={{
                          flexShrink: 0,
                          fontSize: 9,
                          fontWeight: 700,
                          letterSpacing: ".04em",
                          textTransform: "uppercase",
                          color: "#3155a8",
                          background: "#e9eefb",
                          border: "1px solid #d4ddf3",
                          padding: "2px 6px",
                          borderRadius: 4,
                        }}
                      >
                        {opened.label}
                      </span>
                    )}
```

- [ ] **Step 4: Lead drawer.** `types.ts`, after `quoteNumber: string;` in `DrawerDetailVM`:

```ts
  /** #301 slice B — "Client link — Rev 2 · opened 3× · …" for the converted
   *  quote once its package link was opened ("" otherwise). */
  quoteOpensLine: string;
```

  `lib.ts`: add the imports

```ts
import { latestOpensLine } from "@/lib/quote-share/package-view";
import type { QuoteRevision } from "@/lib/stores/quotes";
```

  change the signature (`:100`) to

```ts
export function buildDrawerVM(
  l: LeadRecord,
  convertedQuote: (QuoteNumberFields & { id: string; revisions?: QuoteRevision[] | null; shareOpens?: unknown }) | null = null
): DrawerDetailVM {
```

  and after `quoteNumber: …,` (`:200`) add

```ts
    quoteOpensLine: latestOpensLine(convertedQuote),
```

  `lead-drawer.tsx`: immediately before `{/* footer actions */}` (`:1153`):

```tsx
                  {vm.quoteOpensLine && (
                    <div data-testid="lead-quote-opens" style={{ padding: "0 22px 10px", fontSize: 11.5, color: "#5b616e" }}>
                      {vm.quoteOpensLine}
                    </div>
                  )}
```

  (Check the JSX sibling context at `:1153`. If the comment sits inside a flex container whose children are the
  scroll body and the sticky footer, the new `div` becomes the last child before the footer. That is the intended
  place. `leads/page.tsx` already passes the full `Quote` from `getQuote(leadRec.convertedQuoteId)`, so it needs no
  change.)

- [ ] **Step 5: Run the gates** (tsc 0; test:specs ALL PASSED, PASS = previous + 4, and every `#223 lead drawer` /
  hub check still passes; eslint on the four files; `next build` OK).

- [ ] **Step 6: Commit.**

```bash
git add "src/app/(app)/quotes/page.tsx" "src/app/(app)/leads/types.ts" "src/app/(app)/leads/lib.ts" "src/app/(app)/leads/lead-drawer.tsx" scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(quotes): #301 slice B — "Opened" chip on the Quotes hub; lead drawer shows the client link's opens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Final gates and the browser check

**Files:** none (verification only). If anything fails, fix it in the owning task's files and land the fix as a new
commit.

- [ ] **Step 1: Full gates on the branch.**

```bash
cd /Users/sm/Downloads/peak-app-299 && export PATH=$HOME/.local/node/bin:$PATH
ps aux | grep -E "tsx|next dev" | grep -v grep          # stop strays (smoke boots its own server)
lsof -nP -iTCP -sTCP:LISTEN | grep -E ":3000|:3100|:3301" || true
df -h /System/Volumes/Data | tail -1
npx tsc --noEmit && echo TSC_OK
npm run test:specs 2>&1 | tail -3
git diff --name-only faed74b5...HEAD | grep -E '^src/.*\.(ts|tsx)$' | xargs npx eslint
npx eslint scripts/smoke-routes.ts
rm -rf .next && env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npx next build 2>&1 | tail -20
rm -rf .next && npm run test:smoke 2>&1 | tail -15
```
Expected: tsc 0; test:specs 0 FAIL (record PASS and the slice-B count = PASS − Task 1's baseline); eslint no new findings
against the per-task baselines; build OK; smoke **212/212 ALL PASSED** (Slice A's count + 3). Record every number for the
docs.

- [ ] **Step 2: Browser check on a scratch datadir (never `.data/pglite`).** Follow the memory notes
  `peak-exercising-post-routes-safely` and `peak-worktree-dev-server-browser-verification-traps`: the same `AUTH_SECRET` as
  the main checkout (from `.env.local`), `localhost` not `127.0.0.1`, `lsof` the port first, and unregister the service
  worker on first compile. Don't click any upload or import: the dev server loads the real Blob token.

```bash
SCRATCH=$(mktemp -d) && echo $SCRATCH
PGLITE_PATH=$SCRATCH NEXT_TELEMETRY_DISABLED=1 npx next dev -p 3301   # run in the background
```
  1. Sign in (dev login, an Admin holding `send` + `approve`). Open `/leads`, pick a seeded open lead, **Convert to
     customer + quote** (tick skip-survey with reason `test` if asked). Build it in the Estimator: system `Stage
     lighting` with a two-paragraph intro, one catalog line ★ as a key product, Client goals `Even front light.`; a
     second system `Rigging` with one line and no text. Overall summary blank; Not included = the default list. Save.
  2. Approve & send. Customer preview → **Client link → Copy client link**. The copied/manual URL's last segment
     matches `^\d+\.1\.[A-Za-z0-9_-]{43}$`. Below it: `Rev 1 · not opened yet`.
  3. Open the link **in this signed-in tab**. The package renders in this order: the header with the grand total equal
     to the estimate PDF's Total, the `EST-#### · Rev 1 · sent …` stamp, `Summary` (`This estimate includes 2 scopes:
     Stage lighting and Rigging.`), the toggle, then `1 Stage lighting` with its price, `Your goals`, the intro, and the
     key product (photo or placeholder). `2 Rigging` reads `The full parts list for this scope is under BOM.` Then the
     totals and `Not included`. **BOM**: one table per scope, columns Qty / Manufacturer / Part / Description, no `$` in
     any table. Back in the preview the panel still reads `not opened yet` (team users are skipped).
  4. Sign out (`/api/auth/signout`), open the same link, reload once, sign back in. The panel reads
     `Rev 1 · opened 2× · first … · last …` (under `next dev` every reload counts — adaptation 8). This proves the server
     action passes Next's origin check under `Referrer-Policy: no-referrer` (adaptation 9). The Quotes hub row shows
     **Opened** with the row in its title. The lead's drawer shows `Client link — Rev 1 · opened 2× · …`.
  5. Edit the quote (change a line qty), Save, Approve & send again. **Copy client link** now copies a `.2.` (or later
     rev) token. The panel lists `Rev 2 · not opened yet` and `Rev 1 — superseded · opened 2× · …`. The **old** link
     shows the blue banner `A newer version of this estimate was sent <date>.` + **View the current version**, still
     with the Rev 1 content and price. The link opens the new version with no banner.
  6. Customer preview → **Open cover ↗**: the cover's link line prints the new v2 URL.
  7. Recall the quote to draft. The current link shows `Peak is revising this estimate.` over the frozen Rev 2 content.
     The old link stays superseded. Edit the Overall summary (unsaved draft edits): the link page doesn't change (R12).
  8. **Revoke** (inline confirm). Both links show `This link isn’t active. Ask your Peak rep for a new one.`
  9. A v1 link still works: from the Rev 2 state before revoking (or after a fresh Copy), take `link.path` from the
     status action's response in the network panel. It opens #293's online estimate, unchanged.
  10. Narrow to 375 px (`resize_window` preset mobile, then reload) on the package page: 16 px gutters, the BOM scrolls
      inside its card, no horizontal page scroll. No console errors on any page. Reset the viewport to desktop.
  11. Stop the dev server (`lsof -nP -iTCP:3301 -sTCP:LISTEN`, then kill that PID) and `rm -rf "$SCRATCH"`.

- [ ] **Step 3: Record** the gate numbers and one sentence of the browser result for Task 11. Do not commit anything
  here unless a fix was needed.

---

### Task 11: Docs

**Files:**
- Modify: `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md`

- [ ] **Step 1: Recompute the D-number right before writing.** Slice A has taken numbers after D612, and other branches
  may hold more.

```bash
git fetch origin --quiet
for r in $(git for-each-ref --format='%(refname)' refs/heads refs/remotes); do
  git show "$r:DECISIONS.md" 2>/dev/null | grep -oE '^## D[0-9]+' | sed 's/## D//'
done | sort -n | tail -1
grep -n "^## 301\." PUNCHLIST.md
```
  Let `N` = max D + 1. Read the end of `DECISIONS.md` to see what Slice A used. Punch **#301** already exists (Slice A's
  entry): **edit it**, don't add a new one. Run `grep` across every ref's DECISIONS.md for `D{N}` once more just before
  committing.

- [ ] **Step 2: Append six DECISIONS entries** after the current last entry (use the real numbers):

```markdown
## D{N}. The client link pins a sent revision: v2 tokens (#301 slice B, 2026-10-05)

Copy client link now copies a v2 token `<exp>.<rev>.<mac>`. The MAC (HMAC-SHA256 with AUTH_SECRET) covers
`share:quote:<id>:<rev>:<nonce>:<exp>`. It reuses the quote's one nonce and expiry (no storage change), so Revoke still
kills every link. `rev` is `QuoteRevision.rev` (manual snapshots count); every page prints the PDF's "Rev N"
(`sentDocumentStamp`). v1 links (`<exp>.<mac>`) keep #293's page exactly: latest sent, no tracking. `ShareLinkView.path`
stays v1 (a #293 pin), and the v2 path is `pathV2`. The cover's link line prints `pathV2`. The two shapes never
overlap, and the MAC strings differ by a field (`token.ts`).

## D{N+1}. Package link states: ok / superseded / revising / closed (#301 slice B, 2026-10-05)

`packageState` (`quote-share/package-view.ts`). A pinned revision that isn't the latest sent one shows the frozen page
under "A newer version of this estimate was sent <date>." + View the current version (the v2 link to the latest). A
quote recalled to draft shows the pinned page under "Peak is revising this estimate." This replaces #293 decision 16 for
v2 links: the client keeps what was sent, and Revoke is the kill switch. A lost quote shows "This estimate is closed."
`canAct` (Slice C's client actions) is true only for the latest revision of a `sent` quote. Won, lost, superseded and
revising pages get no actions.

## D{N+2}. The package page reads only what was sent (#301 slice B, 2026-10-05)

The page goes through #293's web loader (`loadQuoteDocumentProps` with the pinned revision, which fails closed). The
overall summary and Not included come from that revision's `docFields` only (R12). `quoteAsOfRevision` spreads
`docFields` over the live quote, so a revision cut before #301 would otherwise show live, unsent text. A missing key reads
empty. `notIncluded: null` (never stored) reads today's Settings default, the same rule the cover printed.

## D{N+3}. The package BOM: line fields, then the catalog; no money field (#301 slice B, 2026-10-05)

`packageBomRows` (`estimate-output/bom.ts`, R6) reads the customer's own rows (`customerLines`: no options, credit or
overhead lines). Manufacturer and Part come from the line, else the catalog part by sku (`getMany`), else blank.
Allowance, vendor and placeholder-sku lines never borrow a catalog part. Labor lines are dropped, except that a labor
system is its one document row. `PackageBomRow` has no money field, and the harness checks the keys and the rendered
tables.

## D{N+4}. Key products on every scope; the page never shows the staff placeholder (#301 slice B, 2026-10-05)

The package's Narrative view is page-wide, so key products and their photos show on every scope, not only on
Narrative-presentation systems. The v2 photo route serves the pinned revision's `packagePhotoSections` set. The v1 set
is unchanged. A scope with no intro and no key products shows its cover override (or the labor wording). Failing that,
it shows "The full parts list for this scope is under BOM." `[needs a paragraph]` is staff-only. Slice C mount points
(plans, downloads, actions, per-key-product datasheet links) render nothing until filled.

## D{N+5}. Package link opens: a JS beacon, per sent revision (#301 slice B, 2026-10-05)

R18: the page's `OpenBeacon` calls `recordShareOpenAction` once per load, so link scanners that don't run JS aren't
counted. Signed-in team members are skipped. The action dedupes one open per IP-hash per revision per 30 minutes in
memory (best-effort; under `next dev` every reload counts). `Quote.shareOpens` is store-owned: `recordShareOpen` writes
it under the row lock, never moves `updatedAt`, and `update()` drops it. It shows in the Client link panel (one row per
sent revision), as the Quotes hub's **Opened** chip, and in the lead drawer. v1 links record nothing. The action is
fetch-based, so it passes Next's Origin check under `Referrer-Policy: no-referrer`. A no-JS form would not (a Slice C
constraint).
```

- [ ] **Step 3: PUNCHLIST.md #301.** In the existing `## 301.` entry, change the heading's status to
  `— Slices A–B DONE 2026-10-05 (D…–D{N+5})` (keep Slice A's range), and replace its `**Slice B** (spec Phases 3 + 6): …`
  line with:

```markdown
**Slice B DONE (D{N}–D{N+5}).** Plan: `docs/superpowers/plans/2026-10-05-estimate-output-slice-b.md`.
- **Client link → package page:** Copy client link copies a link pinned to the latest sent revision. It opens a frozen
  estimate package: header + grand total, Summary, one card per scope (price, Your goals, intro, key products with
  photos), Narrative / BOM (Qty · Manufacturer · Part · Description, no prices), totals, Add options, Not included.
- **After a re-send / recall / loss:** the old link says a newer version was sent and links it. A recall shows "Peak is
  revising this estimate." A lost quote shows "closed". Revoke kills every link. Old (#293) links keep working as before.
- **Opens:** the Client link panel lists each sent revision with its opens. The Quotes hub shows **Opened**, and the lead
  drawer shows the line. Team members opening the link aren't counted.

Gates: tsc 0; test:specs <PASS> PASS / 0 FAIL (<n> for #301 slice B); test:smoke 212/212 ALL PASSED; `next build` OK;
eslint no new findings on the changed src files.
Browser: <one sentence from Task 10 Step 2's real result>.

**For Jeff (Slice B).**
1. Copy client links from **production** only (a preview deploy writes the production DB and prints its own origin).
2. Links you already sent are old-style: they keep showing the latest sent version, with no banner and no tracking. Copy
   a fresh link to get the frozen package.
3. Opens count once per device per half hour. They are a signal, not proof. Mail scanners that run JS can still count
   once.
```

  Keep the existing **Slice C** line.

- [ ] **Step 4: AGENTS.md** — in item 40 (#301), change `Slices B (rev-pinned package page) and C (downloads, drawings,
  client actions) follow.` to:

```markdown
    Slice B ✅ (D{N}–D{N+5}): Copy client link mints a v2 token pinned to the latest sent revision
    (`quote-share/token.ts`; `pathV2`, `resolveSharedPackage` in `links.ts`); `/share/quote/[id]/<v2>` renders the frozen
    estimate package (`components/estimate-output/package-view.tsx` via `package-page.tsx` + `estimate-output/
    package-loader.ts`; pure `package-model.ts`, `bom.ts`, `quote-share/package-view.ts`) with superseded / revising /
    closed banners and Slice C mount points; opens are a JS beacon (`recordShareOpenAction` → store-owned
    `Quote.shareOpens`) shown in the Client link panel, the Quotes hub chip and the lead drawer. Slice C (downloads,
    drawings, client actions) follows.
```

- [ ] **Step 5: Commit the docs.**

```bash
git add PUNCHLIST.md DECISIONS.md AGENTS.md
git commit -m "$(cat <<'EOF'
docs: #301 slice B — PUNCHLIST, DECISIONS, AGENTS

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review (done while writing)

- **Spec coverage (Slice B).** §2 `token.ts` v2 → Task 1; `package-view.ts` → Task 2; `bom.ts` → Task 4; `opens.ts` →
  Task 2 (+ store in Task 8); the `scopes.ts` narrative / key products / BOM extension → Task 4 (adaptation 6). §5: share
  page branch → Task 6; PackageView sections 1–4 + 6 → Tasks 4–5; sections 5 / 7 / 8 → mount points (Task 5, Slice C);
  web layout, print CSS, noindex / no-referrer (unchanged metadata + next.config) → Tasks 5–6; Client link panel v2 copy +
  per-rev list → Tasks 3, 7. §6 photo route accepts either token → Task 6. §8 + D-o / R18 → Tasks 8–9. D-g → Tasks 1, 3;
  D-h → Tasks 2–3, 5; R1 totals lines → Task 4 (`coverTotals`) + Task 5 render; R6 → Task 4; R11 → Tasks 1–3; R12 → Tasks
  4, 6 (DB check with unsent edits); R18 → Task 8. Cover link line → v2 → Task 3. §11 Slice B harness rows (v1/v2 parse /
  verify / domain / tamper, the packageState matrix incl. lost / revoked / expired / v1, BOM no money keys, opens dedupe,
  `update()` strips `shareOpens`) → Tasks 1–4, 8; smoke → Task 6; browser → Task 10.
- **Placeholders.** None. Every code step carries its code. The two "if Slice A named it differently" notes name the
  exact fallback, and so do the Task 4 currency-format note and the photo-set check correction.
- **Type consistency.** `PackageState` / `VisiblePackageState` / `PackageBanner` / `SentRevRow` / `OpensSource` (Task 2),
  `SharedPackage` (Task 3), `PackageBomRow` / `BomCatalogPart` (Task 4), `PackageViewProps` / `PackageViewInput` /
  `PackageScopeView` / `PackageKeyProduct` (Task 4), `PackageSlots` (Task 5), `ShareOpenStat` / `ShareOpens` (Task 2) are
  each defined once and used with the same names. `resolveSharedPackage(id, token, opts)` and
  `recordSharedOpen(id, token, ip, opts)` have the same signature everywhere. `loadPackageViewProps(hit, { base, view,
  letterheadSrc })` matches its harness and page callers.
