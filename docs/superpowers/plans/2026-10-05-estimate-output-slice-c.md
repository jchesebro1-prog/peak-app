# Two-prong estimate output — Slice C Implementation Plan (#301)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Slice C (spec Phases 4 + 5) of #301. The rev-pinned package page (Slice B) gains its four empty mount
points: a **Datasheet** link under each key product, **Plans & risers** (uploaded drawings, or the linked Grid design's
drawing set rendered to PDF), **Downloads** (one zip of datasheets, spec sheets and `Specifications.docx`, cached per sent
revision in private Blob), and **client actions** (check scopes + submit with a live "Selected scopes" total, ask a
question). A response notifies the lead estimator (task), lands a system note on the quote/customer timeline and a
system activity on the lead, and never changes status. Staff see responses, gap chips and the drawings list, and can
upload, remove, generate from the Grid and rebuild the cached zip, all from the Client link panel.

**Architecture:**
- **Pure, client-safe core:** `estimate-output/package-files.ts` (the `PackageFile` record, upload paths, magic-byte sniff,
  the upload-overrides-grid rule), `estimate-output/responses.ts` (the `ClientResponse` record, sanitize + caps, copy,
  task/note text, R16 assignees, staff rows), `estimate-output/package-gaps.ts` (gap counts and chips),
  `estimate-output/package-zip.ts` (caps, names, cache paths, `LEFT OUT.txt`), `estimate-output/package-extras-model.ts`
  (the page's datasheet / downloads / plans view models), `design/grid-set-print.ts` (set ids, asset token ids).
- **Store:** `quotes.ts` gains store-owned `packageFiles` + `clientResponses` (row-locked writers, `update()` strips them,
  `packageFiles` frozen in `docFields` and annexed onto the latest sent revision, R13).
- **Server:** a scoped coverage loader (`part-docs/load.ts` `loadScopedCoverage`, no whole-catalog list), the
  revision's package documents (`package-docs-server.ts`), `quoteSpecParts` extracted from `client-package-server.ts`,
  the zip builder + cache (`package-zip-server.ts`), upload finalize / serve / Grid generate (`package-files-server.ts`),
  responses (`responses-server.ts`), the staff panel read (`package-panel-server.ts`), and the drawing set's data loader
  (`design/drawing-set-data.ts`) shared by the team page and a new signed print route.
- **UI:** server components for the page's extras (`components/estimate-output/package-extras.tsx`), a slot builder
  (`share/.../package-slots.tsx`), two client islands (`scope-selection.tsx`, `question-form.tsx`), the staff
  `PackageStaffPanel` mounted from `ClientLinkPanel`, and the shared `DrawingSetSheets` server component.

**Tech Stack:** Next.js 16 App Router, TypeScript, React 19 server + client components, Drizzle/PGlite doc-store,
`@vercel/blob` 2.6 (`put` with `allowOverwrite`, `@vercel/blob/client` `upload` / `handleUpload`), puppeteer-core via
`renderPrintRouteToPdf`, `node:crypto`, tsx harness (`scripts/test-review-and-spec.ts`).

**Spec:** `docs/superpowers/specs/2026-10-05-two-prong-estimate-output-design.md`. This plan covers **Slice C only**: §6
(Phase 4 — datasheets, zip, package files, Grid set, gap chips), §7 (Phase 5 — client actions), D-j, D-k, D-l, D-m, D-n,
§2 `responses.ts`, §10 and the Slice C rows of §11–§12. The "Spec-review corrections" override the earlier decisions:
**R1** (live total = "Selected scopes", pre-credit, + Rewards credit note), **R8, R9, R10, R12, R13, R15, R16** apply here.

**Builds on** (read the real code before each task; where a name differs, use the real one and say so in the task
report):
- Slice A (`docs/superpowers/plans/2026-10-05-estimate-output-slice-a.md`): `estimate-output/{fields,scopes}.ts`
  (`outputScopes`, `OutputScope.isLabor/.clientGoals/.price`, `cleanPlainText`), `cover.ts`, `quote-pdf/token.ts`
  `PrintTokenKind` with `"cover"`.
- Slice B (`docs/superpowers/plans/2026-10-05-estimate-output-slice-b.md`): `quote-share/token.ts`
  (`isShareTokenV2`), `quote-share/links.ts` (`SharedPackage = { q; rev; state: VisiblePackageState; currentPath }`,
  `resolveSharedPackage(id, token, opts?)`), `quote-share/package-view.ts` (`canAct(state)` = ok **and** status `sent`,
  Slice B adaptation 7), `estimate-output/package-model.ts` (`PackageViewProps.totals.creditAmount`), `bom.ts`,
  `components/estimate-output/package-view.tsx` (`PackageView`, `PackageSlots = { plans?; downloads?; actions?;
  keyProductExtra?: Record<sku, ReactNode> }`, `PACKAGE_WEB_CSS` classes `pkg-card pkg-p pkg-muted pkg-row pkg-ul
  pkg-goals pkg-label pkg-price`), `share/quote/[id]/[token]/{package-page.tsx,actions.ts,open-beacon.tsx}`.
- #293 slice 3: `quote-share/photo-response.ts` (`revisionSections(rev)`), `quote-share/view.ts` (`onlineEstimateState`,
  `sentDocumentStamp`, `sharePath`, `ONLINE_COPY`), `ClientLinkPanel`.
- #207 / #296: `part-docs/{coverage,package,load}.ts`, `client-package-server.ts` (`quoteBom`), `rack/submittal-server.ts`
  (the 25 MB / 60 MB caps and `readCapped`), `zip.ts` (`createStoredZip`).
- #218: the `documents` upload pattern (`components/documents/upload-client.ts`, `api/documents/upload/route.ts`,
  `documents-upload.ts`).
- #209 / #300: `design/grid/[id]/set/page.tsx`, `plan-sheet-figure.tsx` (`data-plan-figure` + `data-ready` /
  `data-error`), `object-symbols(-server).ts`, `api/grid-sheets/[id]/route.ts`.

## Spec points the shipped code forces this plan to adapt

Each one is logged in DECISIONS at docs time (Task 11).

1. **Scoped coverage, not `loadPartDocsState`.** The share routes and page must not list the whole catalog or the whole
   part-document tables per request. `loadScopedCoverage(parts)` reads only the links of the revision's skus
   (`documentLinksForParts`), those documents (`getDocuments`) and the accessory links whose accessory is one of those
   skus (`listDocsByField`). Coverage is computed in the quote's own context (every covering parent must be on the quote),
   so this gives the same answer as the full index. A harness DB check compares the two. It runs no legacy
   `datasheetBlobKey` backfill: a public request never writes.
2. **The zip carries datasheets, spec sheets and `Specifications.docx` only** (D-l). Manuals, cut sheets, rack sheets and
   the rack D94 section stay in the staff client package. Rack lines still expand to their members through `quoteBom`,
   so member datasheets are included. `Specifications.docx` is added only when at least one BOM row assembles into a
   section. A revision with nothing to download answers `404 Nothing to download for this estimate.`, and the page shows
   no Downloads card.
3. **The zip cache uses a fixed path.** `putBlob` adds a random suffix, so a new `putBlobAt` writes
   `estimate-package/<quote>/rev-<rev>.zip` with `addRandomSuffix: false, allowOverwrite: true`. Only a build with nothing
   left out, or with only size-cap omissions, is cached. A timeout or an unreadable file is never frozen into the cache.
   **Under `next dev` the cache is off unless `ESTIMATE_PACKAGE_CACHE=1`.** A scratch datadir reuses quote ids like
   `Q-2041`, and `.env.local` carries the production Blob token, so a local cache write could serve a stranger's zip to a
   real client.
4. **Datasheet links, Downloads and Plans show in every visible state** (ok, superseded, revising, closed), like the
   photos: they are part of what was sent. Only client actions are gated by `canAct`.
5. **Generate from Grid makes ONE PDF of kind `drawing`.** It is one Chrome render (cover + plan sheets + E-501 riser +
   schedules at 11×17). Two renders do not fit the Estimator page's `maxDuration = 120`, which the server action runs
   under. The same-kind override rule (D-j) is unchanged, and the Upload kind select defaults to **Drawing set**, so an
   uploaded set replaces the Grid one.
6. **R8(b) membership is proven by per-asset print tokens.** The signed print page signs each asset URL it draws:
   `signPrintToken(secret, "grid-set", "<setId>|sheet|<id>")`, and the same for `|doc|`. The page signs only sheets and
   symbol drawings it computed for that project and option, so a valid asset token is the membership proof. Recomputing
   the symbol set per asset request would load the whole catalog once per image. The sheet route also re-checks
   `sheet.projectId` and `project.sheetIds`.
7. **Six old source reads point at moved code.** Extracting the set body (R8a) moves strings that #209, #211 and #223
   pin in `set/page.tsx` (five reads), and sharing the sheet proxy's body moves the #209 I6 route literals (one read). Each
   set-page read becomes `gridSetSources301()` (page + data loader + sheets component), and the route read covers the
   route + `grid-sheet-serve.ts`. The assertions are unchanged, except the #209 I6 sheet-URL literal, which now names the
   team asset resolver (Task 9 Step 1 lists the exact edits). Precedent: the `#299: moved with the schedule build`
   re-pointing.
8. **One Slice B pin names the empty mounts.** The Slice B "page + loader" block asserts
   `<PackageView model={model} slots={{}} />`. Slice C fills the slots, so it becomes
   `<PackageView model={model} slots={slots} />`. No other Slice B check is edited.
9. **Removing a drawing keeps its blob while any revision still lists it.** A superseded link keeps showing what it was
   sent.
10. **Gap chips read the live quote** (the staff's working copy, what the next send will carry). The live BOM's datasheet
    coverage uses the same scoped loader.
11. **R16 + active.** A task goes to the lead estimator only when that user is active. Otherwise it goes to every
    **active** `approve` holder. A task for an archived user would never be seen.
12. **The annex skips a revision with no `docFields`** (one cut before #293). Creating `docFields` there would switch that
    revision's header from the live fallback to a partial frozen copy.
13. **The forms exist only after hydration.** The server snapshot renders "Turn on JavaScript to respond here, or reply
    to Peak's email." A `<form>` without JS would submit by GET and put a name and email in the URL, and a no-JS POST
    fails Next's Origin check under `no-referrer` (Slice B adaptation 9). The forms use `method="post"` plus
    `preventDefault`, and submit through the server actions only.
14. **A honeypot hit gets the normal-looking confirmation and writes nothing.**
15. **Staff actions live in a new `estimator/package-actions.ts`** (#293 pins `share-actions.ts` unchanged). The staff UI is
    a separate client component (`package-staff-panel.tsx`), mounted from `ClientLinkPanel` by one line, so none of the
    #293 panel pins move.
16. **Generate from Grid is a server action** (it gets Next's Origin check) with 25 s render steps:
    20 + 25 + 10 + 25 (`waitFor`) + 25 = 105 s, inside 120 s.

## Global Constraints

**Workspace and environment**
- Work only in `/Users/sm/Downloads/peak-app-299`, branch `feat/301-estimate-package`. Run
  `export PATH=$HOME/.local/node/bin:$PATH` before any `npx`/`npm`. Other agents commit on this branch:
  **`git add` only your own files, never `git stash`, never `git reset`.**
- Read `AGENTS.md` first. For every Next API you touch, read its doc under `node_modules/next/dist/docs/01-app/`:
  `03-api-reference/03-file-conventions/route.md` (a dotted segment such as `package.zip/route.ts` is a static segment,
  like the doc's `app/rss.xml/route.ts`), `03-api-reference/03-file-conventions/page.md` (`params` / `searchParams` are
  Promises), `03-api-reference/04-functions/headers.md` (`headers()` is async),
  `03-api-reference/01-directives/use-server.md`, `02-guides/data-security.md` ("Allowed origins"),
  `03-api-reference/03-file-conventions/02-route-segment-config/` (`maxDuration`, `dynamic`).
- **Never open `/Users/sm/Downloads/peak-app/.data/pglite`.** `npm run test:specs` / `npm run test:smoke` use their own temp
  datadirs. Before either: `ps aux | grep -E "tsx|next dev" | grep -v grep` and stop strays.
- **Disk:** `df -h /System/Volumes/Data | tail -1` before test:specs or a build. Above ~90 %:
  `find $TMPDIR -maxdepth 1 \( -name 'tmp.*' -o -name 'peak-build-db-*' -o -name 'peak-smoke-*' \) -type d -mmin +60 -exec rm -rf {} +`.
  `rm -rf .next` before every `next build`.
- **Blob:** tests never touch real Blob. Every server function that reads or writes Blob takes a `deps` argument (the
  `documents-upload.ts` / `verify-upload.ts` idiom), and the harness passes fakes. An async check that reaches a live
  Blob call first does `delete process.env.BLOB_READ_WRITE_TOKEN` and restores it in a `finally` (the #222 T4 idiom,
  `scripts/test-review-and-spec.ts` `quotePdfRoutes222AsyncChecks`). In the browser check, never click Upload,
  Generate from Grid or Rebuild (memory: the dev server loads the real Blob token).

**Code rules**
- **Client components** (`"use client"`) never value-import `@/lib/stores/*`, `@/db/*`, `@/lib/session`, `@/lib/blob`,
  `@/lib/users`, `@/lib/settings`, `@/lib/quote-share/(token|links|photo-response)`, `@/lib/quote-pdf/*`, or any
  `estimate-output/*-server.ts` / `package-extras.ts` / `package-loader.ts`. Type-only imports and `"use server"` files are
  fine. Only `next build` sees this break.
- **Pure files** (`package-files.ts`, `responses.ts`, `package-gaps.ts`, `package-zip.ts`, `package-extras-model.ts`,
  `design/grid-set-print.ts`) value-import only what their harness purity pin lists.
- **`"use server"` files export only async functions** (no `export type`, no constants). A page file exports only Next's
  page fields; a route file only its methods + segment config.
- **No AI and no external service** (D89). **No `window.confirm()`** (inline confirms). **Timestamps are epoch-ms.**
- **Server actions never throw into a transition.** Every client `await` of an action sits in `try { … } catch { … }`.
- **Status never changes on a client response** (D-m, decision 11). No `setStatus`, `update(` or stage write in the
  response path.

**Never on the client page or in a client island (spec §10)** — cost, margin, tier, line/unit sell, internal notes, room,
owner email, datasheet gaps, response lists, opens, `shareLink`, nonces, **blob paths**, `packageFiles` records, any other
revision's content. Islands receive only scope ids, names, prices (scope totals, already on the page), the credit note,
`id`, `token`.

**Caps and limits (verbatim)**
- Datasheet route: 120 / min / IP. File route: 120 / min / IP. Zip: 6 / 10 min / IP. Responses: 5 / 10 min / IP and
  30 / day / quote. Name ≤ 120, title ≤ 120, email ≤ 200 (shape-checked, optional), message ≤ 4,000. ≤ 200 responses per
  quote. ≤ 12 package files. Package file ≤ 25 MB, PDF / PNG / JPEG / WebP only. Zip: 25 MB per document, 60 MB total,
  45 s deadline.

**Copy (verbatim)**
- Page: `Datasheet — <file name>`, `Plans & risers`, `Downloads`, `Download all (.zip)`, `Individual files (N)`,
  `Choose your scopes`, `Selected scopes`, `Submit selection`, `Ask a question or request changes`, `Send`,
  `A Rewards credit of $X applies to your order.`, `Thanks — <Lead estimator> has been notified.` (no lead estimator →
  `Thanks — Peak Systems Group has been notified.`).
- Zip: `LEFT OUT.txt`, `Left out — package size limit`, `Left out — ran out of time`, `Left out — the file couldn't be read`,
  `Left out — the file is missing`.
- Staff chips: `N parts without a datasheet` (`1 part …`), `No drawings`, `N key products need a paragraph`
  (`1 key product needs …`), `No client goals on N scopes` (`… 1 scope`).
- Task titles: `Client accepted EST-1042 Rev 2 — Lighting, Rigging ($48,250.00)`, `Client question — EST-1042`.

**Existing harness pins — do not break them** (a failing old check means change the new code, except the edits named in
adaptations 7 and 8)
- Everything Slice B lists under its own "Existing harness pins", plus Slice B's own blocks. That includes `page.tsx`'s
  rate-limit order, the photo route, `token.ts`, `view.ts` value imports, `links.ts` (no `newShareNonce`, no `shareLink =`),
  `quotes.ts` (`patchShareLink` is the only `.shareLink = ` writer; `update()` keeps `delete clean.shareLink;` and Slice B's
  `delete clean.shareOpens;`), `client-link-panel.tsx` (`"use client"`, `navigator.clipboard.writeText(`,
  `ONLINE_COPY.revokeConfirm`, ≥ 3 `catch {`, ≥ 4 `await reload();`, the focus/visibilitychange listeners, no `confirm(`,
  no server value import), and `share-actions.ts` unchanged.
- `client-package-server.ts`: `const rackFixtures` before
  `const bom = quoteBom(quote, (id) => rackFixtures.get(id), internalSkuCheck(catalog));`; two
  `buildSpecDocx({ ...spec, racks: rackRun.spec })`; two `racks: rackRun.index`; each builder's
  `cutSheetDeadline(Date.now())` before `blobEnabled()`; two `00-package-index.json` lines with
  `cutSheets: { sheets: cutSheets.sheets }`; `client-packages/quote-${safeName(quote.id)}/`;
  `{ label: "Quote", value: displayQuoteNumber(quote) }`; `reduce((n, p) => n + placementQty(p), 0)`; `packageNeedsFixtures(`.
- `quote-pdf/render.ts`: the `#222 final-B` renderOnce checks (landed-URL re-check between `page.evaluate(` and
  `page.pdf(`; the `[{,]\s*timeout\s*[,}]` step count and `RENDER_WORST_CASE_MS`), `setRequestInterception(true)`,
  `redirectChain().length > 0`, `Promise.race([document.fonts.ready`.
- `api/grid-sheets/[id]/route.ts`: `decodeDataUrl(sheet.dataUrl)` and `sandbox` (re-pointed by adaptation 7 to the route +
  `src/lib/grid-sheet-serve.ts`; both literals move with the code).
- `set/page.tsx` pins (re-pointed by adaptation 7, assertions unchanged): `printPageCss(size)`, `buildSheetList(`,
  `riserViewForOption(`, `resolveOptionId(project, requestedOption)`, `<PrintButton accent={accent} waitFor="[data-plan-figure]" />`,
  `resolveGeneralNotes(set, settings.gridStandardNotes)`, `scheduleWiresFromView(view)`, the `pk-dw-num` span,
  `qty: f.qty`, `` `${desc} ×${qty}` ``, `` `${tag} ×${qty}` ``, `optionQuoteNo`, no `src.dataUrl`.
- `src/middleware.ts`, `next.config.ts`, `public/sw.js`, `src/app/share/layout.tsx`, `quote-document.tsx`,
  `document-loader.ts`, `share-actions.ts`: **not edited**. (`/share/` and `/print/` are already exempt from the team
  login; `/share/:path*` already gets `no-referrer`; the service worker already skips `/share/`.)

**Harness**
- Each task appends its sync checks at the **end** of `scripts/test-review-and-spec.ts` under a
  `/* ===… #301 slice C — <part> …=== */` banner. Import aliases use the `e301c<x>` / `E301c<x>` prefix (`e301cf` files,
  `e301cr` responses/gaps, `e301cs` store, `e301cd` docs, `e301cz` zip, `e301cu` uploads, `e301ca` actions, `e301cp` panel,
  `e301cg` grid), imported right above their block.
- Async DB checks: Task 3 declares `async function estimateOutput301CAsyncChecks()` and chains it with
  `.then(() => estimateOutput301CAsyncChecks())` **right after** `.then(() => estimateOutput301BAsyncChecks())` and before
  `.finally(() => teardownFixtures())`. Later tasks add their own `async function e301c<Part>AsyncChecks()` and append one
  `await e301c<Part>AsyncChecks();` line at the end of `estimateOutput301CAsyncChecks`'s body.
- Fixtures: `const { fixtureId } = await import("./test-fixtures");` inside each async function; `registerFixture(coll, id)`
  is module scope. Use `fixtureId(301, "c-<slug>")`. `readFileSync` and `join` are module scope.

**Gates per task** (report real numbers)
- `npx tsc --noEmit` → 0 errors.
- `npm run test:specs 2>&1 | tail -3` → `ALL PASSED`, 0 FAIL. Baseline: Slice B's final count (re-measure in Task 1
  Step 0). Every later task reports PASS = previous + its new checks.
- ESLint: **before the first edit** of each task, `npx eslint <the non-harness src files the task modifies>` and note the
  counts. Afterwards, run the same command plus the task's new files: no new errors or warnings. Never lint
  `scripts/test-review-and-spec.ts` (whole-file eslint crashes on it; pre-existing).
- `rm -rf .next && env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npx next build 2>&1 | tail -20` on Tasks 4–9 (routes and
  client components) and again in Task 10.
- Task 10 adds `npm run test:smoke` (baseline = Slice B's final, expected **212**). This slice adds 6 → **218/218**.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/lib/estimate-output/package-files.ts` | create | Pure: `PackageFile*` types/consts, `isPackageFileId/Kind`, upload paths, `sniffPackageFile`, `packageFileName`, `cleanPackageFiles`, `appendPackageFile`, `visiblePackageFiles`, `packageBlobReferenced`, `packageFileRows`, `newPackageFileId` |
| `src/lib/estimate-output/responses.ts` | create | Pure: `ClientResponse*` types, caps, `CLIENT_ACTION_COPY`, `ClientActionResult`, `responseScopes`, `sanitizeClientResponse`, `cleanClientResponses`, `appendResponseTo`, task/note text, `matchRosterName`, `leadEstimator`, `responseAssignees`, `confirmationText`, `chicagoDayEnd`, `responseRows`, `creditNoteText` |
| `src/lib/estimate-output/package-gaps.ts` | create | Pure: `keyProductsNeedingText`, `scopesWithoutGoals`, `packageGapChips` |
| `src/lib/stores/quotes.ts` | modify | `Quote.packageFiles/.clientResponses`; `docFields.packageFiles`; `update()` strips; `addPackageFile`, `removePackageFile`, `appendClientResponse` |
| `src/lib/stores/part-accessory-links.ts` | modify | `accessoryLinksForAccessories(skus)` |
| `src/lib/part-docs/load.ts` | modify | `loadScopedCoverage(parts)` |
| `src/lib/estimate-output/package-docs-server.ts` | create | `revisionPackageDocs`, `packageDocForRevision`, `datasheetGapCount` |
| `src/lib/estimate-output/package-extras-model.ts` | create | Pure view types + `datasheetLinks`, `downloadsView`, `downloadsSummary`, `plansView`, `EMPTY_EXTRAS` |
| `src/lib/estimate-output/package-extras.ts` | create | Server: `loadPackageExtras(hit, base)` |
| `src/components/estimate-output/package-extras.tsx` | create | Server components: `DatasheetLink`, `PackageDownloads`, `PackagePlans` |
| `src/app/share/quote/[id]/[token]/package-slots.tsx` | create | `buildPackageSlots(extras, ctx)` |
| `src/app/share/quote/[id]/[token]/package-page.tsx` | modify | Loads extras, passes slots |
| `src/app/share/quote/[id]/[token]/doc/[docId]/route.ts` | create | Datasheet / spec sheet download |
| `src/lib/quote-share/links.ts` | modify | `SHARE_DOC_PER_MIN`, `SHARE_FILE_PER_MIN`, `SHARE_ZIP_PER_WINDOW`, `SHARE_ZIP_WINDOW_MS` |
| `src/lib/client-package-server.ts` | modify | `quoteSpecParts` extracted (behavior-preserving) |
| `src/lib/blob.ts` | modify | `putBlobAt` |
| `src/lib/zip.ts` | modify | `zipStream` |
| `src/lib/rack/submittal-server.ts` | modify | `export` on `readCapped` |
| `src/lib/estimate-output/package-zip.ts` | create | Pure: caps, names, cache paths, `leftOutText`, `zipCacheable`, `packageZipCacheOn` |
| `src/lib/estimate-output/package-zip-server.ts` | create | `buildRevisionPackageZip`, `servePackageZip`, `clearPackageZipCache` |
| `src/app/share/quote/[id]/[token]/package.zip/route.ts` | create | The zip download |
| `src/app/api/quotes/[id]/package-files/upload/route.ts` | create | Blob client-upload token broker |
| `src/lib/estimate-output/package-files-server.ts` | create | `finalizePackageFileUpload`, `removePackageFileAndBlob`, `packageFileForRevision`, `servePackageFile`, `generateGridDrawingSet` (Task 9) |
| `src/app/(app)/estimator/package-file-upload.ts` | create | Browser half: `putPackageFile` |
| `src/app/(app)/estimator/package-actions.ts` | create | `"use server"`: add/remove file, panel read, rebuild, generate from Grid |
| `src/app/share/quote/[id]/[token]/file/[fileId]/route.ts` | create | Serves the pinned revision's visible package files |
| `src/lib/estimate-output/responses-server.ts` | create | `submitClientResponse`, `notifyClientResponse` |
| `src/app/share/quote/[id]/[token]/actions.ts` | modify | `submitScopeSelection`, `askQuestion` |
| `src/app/share/quote/[id]/[token]/scope-selection.tsx` | create | Client island |
| `src/app/share/quote/[id]/[token]/question-form.tsx` | create | Client island |
| `src/lib/estimate-output/package-panel-server.ts` | create | `loadPackagePanel` |
| `src/app/(app)/estimator/package-staff-panel.tsx` | create | Client: Drawings, Responses, gap chips, Rebuild, Generate from Grid |
| `src/app/(app)/estimator/client-link-panel.tsx` | modify | Mounts `PackageStaffPanel` (one import, one line) |
| `src/lib/stores/grid-projects.ts` | modify | `gridProjectForQuote` |
| `src/lib/design/grid-set-print.ts` | create | Pure: `gridSetId`, `parseGridSetId`, `gridSetAssetTokenId`, `GRID_SET_WAIT_FOR`, `GRID_SET_STEP_MS`, `gridSetFileName` |
| `src/lib/design/drawing-set-data.ts` | create | Server: `DrawingSetAssets`, `TEAM_DRAWING_SET_ASSETS`, `rehrefSymbolUrls`, `loadDrawingSetData` |
| `src/components/drawing/drawing-set-sheets.tsx` | create | Server component: `DrawingSetSheets` (the moved set body) |
| `src/app/(app)/design/grid/[id]/set/page.tsx` | modify | Uses the loader + `DrawingSetSheets` |
| `src/lib/grid-sheet-serve.ts` | create | `serveGridSheet` (moved from the proxy route) |
| `src/app/api/grid-sheets/[id]/route.ts` | modify | Calls `serveGridSheet` |
| `src/lib/quote-pdf/token.ts` | modify | `PrintTokenKind` + `"grid-set"` |
| `src/lib/quote-pdf/render.ts` | modify | `waitFor` option, `RENDER_WAIT_FOR_TIMEOUT_MS` |
| `src/app/print/grid-set/[id]/page.tsx` | create | Signed print page |
| `src/app/print/grid-set/[id]/asset/sheet/[sheetId]/route.ts` | create | Token-scoped plan-sheet source |
| `src/app/print/grid-set/[id]/asset/doc/[docId]/route.ts` | create | Token-scoped symbol / riser drawing |
| `scripts/smoke-routes.ts` | modify | +6 routes |
| `scripts/test-review-and-spec.ts` | modify | The `#301 slice C` blocks; the adaptation 7 + 8 pin edits |
| `PUNCHLIST.md`, `DECISIONS.md`, `AGENTS.md` | modify | Task 11 |

## Task overview

| # | Task | Depends on |
|---|---|---|
| 1 | Pure package files: record, paths, sniff, override rule | Slice B landed |
| 2 | Pure responses + gap chips | 1 |
| 3 | Store-owned `packageFiles` + `clientResponses` (row-locked, `update()` strips, docFields, R13 annex) | 1, 2 |
| 4 | Scoped coverage, revision documents, datasheet route, per-key-product links, slot plumbing | 3 |
| 5 | Package zip: `quoteSpecParts` refactor, builder with caps, Blob cache, route, Downloads card | 4 |
| 6 | Package files: upload broker + finalize, remove, file route, Plans & risers card | 3, 4 |
| 7 | Client actions: server actions, notifications, islands, live total | 3, 4 |
| 8 | Staff panel: Drawings, Responses, gap chips, Rebuild package | 5, 6, 7 |
| 9 | Grid drawing set print + Generate from Grid (LAST feature task) | 6, 8 |
| 10 | Final gates (smoke + build) and the browser check | 1–9 |
| 11 | Docs: DECISIONS, PUNCHLIST #301, AGENTS item 40 | 10 |

If Task 9 slips, Tasks 10–11 run without it: the upload override (Task 6) works alone, and the panel's Generate button
does not exist until Task 9 adds it.

---
### Task 1: Pure package files — record, upload paths, sniff, override rule

**Files:**
- Create: `src/lib/estimate-output/package-files.ts`
- Test: harness block `#301 slice C — package files (pure)`

**Interfaces:**
- **Consumes:** `cleanText`, `displayFileName`, `formatBytes`, `isUploadKey`, `safeFileName` (`@/lib/document-files`);
  `sniffDocumentType`, `sniffImageType` (`@/lib/part-docs/files`).
- **Produces** (Tasks 3, 4, 6, 8, 9): `type PackageFileKind = "plan" | "riser" | "drawing"`;
  `type PackageFileSource = "upload" | "grid"`; `PACKAGE_FILE_TYPES`; `type PackageFileType`;
  `type PackageFile = { id; kind; name; blobPath; contentType: PackageFileType; size; source; addedAt; addedBy }`;
  `PACKAGE_FILE_KINDS`, `PACKAGE_FILE_KIND_LABEL`, `MAX_PACKAGE_FILES = 12`, `MAX_PACKAGE_FILE_BYTES`,
  `PACKAGE_FILE_SNIFF_BYTES = 1024`, `PACKAGE_FILE_PREFIX = "estimate-files/"`, `PACKAGE_FILE_ACCEPT`, `PACKAGE_FILES_COPY`;
  `isPackageFileId(v)`, `isPackageFileKind(v)`, `newPackageFileId(): string`, `quotePathSegment(id)`,
  `packageFileUploadPrefix(quoteId, uploadKey)`, `packageFileBlobPath(quoteId, uploadKey, fileName)`,
  `packageFilePathInScope(pathname, quoteId, uploadKey)`, `gridSetBlobPath(quoteId)`,
  `sniffPackageFile(bytes): PackageFileType | null`, `packageFileName(raw, type)`, `cleanPackageFiles(raw): PackageFile[]`,
  `appendPackageFile(list, file): PackageFile[] | null`, `visiblePackageFiles(files)`,
  `packageBlobReferenced(q, blobPath): boolean`, `type PackageFileRow`, `packageFileRows(files)`.

- [ ] **Step 0: Baseline.** `npm run test:specs 2>&1 | tail -3` on the branch as it stands (Slice B landed). Record PASS.

- [ ] **Step 1: Write the failing harness block.** Append:

```ts
/* ======================================================================
   #301 slice C — package files (pure): the PackageFile record (D-j), the
   upload path scope (a client blobPath is untrusted), the magic-byte
   sniff (PDF / PNG / JPEG / WebP only), cleaning on read, the 12 cap,
   and decision 9 — an upload of a kind hides Grid files of that kind.
   ====================================================================== */
import {
  sniffPackageFile as e301cfSniff, packageFilePathInScope as e301cfInScope, packageFileBlobPath as e301cfPath, packageFileName as e301cfName,
  cleanPackageFiles as e301cfClean, appendPackageFile as e301cfAppend, visiblePackageFiles as e301cfVisible, packageBlobReferenced as e301cfRef,
  packageFileRows as e301cfRows, newPackageFileId as e301cfNewId, isPackageFileId as e301cfIsId, gridSetBlobPath as e301cfGridPath,
  MAX_PACKAGE_FILES as e301cfMax, MAX_PACKAGE_FILE_BYTES as e301cfMaxBytes, type PackageFile as E301cfFile,
} from "@/lib/estimate-output/package-files";
{
  const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);
  const ascii = (s: string) => new TextEncoder().encode(s);
  ok(e301cfSniff(ascii("%PDF-1.7\n%âãÏÓ")) === "application/pdf" && e301cfSniff(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) === "image/png" &&
     e301cfSniff(bytes(0xff, 0xd8, 0xff, 0xe0)) === "image/jpeg" && e301cfSniff(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50)) === "image/webp",
    "#301 files: PDF, PNG, JPEG and WebP sniff by their bytes");
  ok(e301cfSniff(ascii("<svg xmlns='http://www.w3.org/2000/svg'/>")) === null && e301cfSniff(ascii("MZ\x90\x00")) === null && e301cfSniff(ascii("<html>")) === null &&
     e301cfSniff(new Uint8Array(0)) === null,
    "#301 files: SVG, programs, HTML and empty files are refused");
  const key = "UP-0123456789abcdef";
  const good = e301cfPath("Q-2041", key, "Main plan (rev 2).pdf");
  ok(good === "estimate-files/Q-2041/UP-0123456789abcdef/Main_plan_rev_2_.pdf" && e301cfInScope(good + "-AbCd12", "Q-2041", key),
    "#301 files: the upload path is estimate-files/<quote>/<key>/<safe name> (Blob's random suffix allowed)");
  ok(!e301cfInScope(good, "Q-2042", key) && !e301cfInScope(good, "Q-2041", "UP-ffffffffffffffff") && !e301cfInScope("estimate-files/Q-2041/UP-0123456789abcdef/../x.pdf", "Q-2041", key) &&
     !e301cfInScope("estimate-files/Q-2041/UP-0123456789abcdef/a/b.pdf", "Q-2041", key) && !e301cfInScope(42, "Q-2041", key) && !e301cfInScope(good, "Q-2041", "UP-bad"),
    "#301 files: another quote's path, another key, .., a nested path, a non-string and a bad key are out of scope");
  ok(e301cfName("Plan.PDF", "application/pdf") === "Plan.PDF" && e301cfName("riser.png", "image/jpeg") === "riser.jpg" && e301cfName("set", "application/pdf") === "set.pdf" &&
     e301cfName("a/b\\c.jpeg", "image/jpeg") === "c.jpeg",
    "#301 files: the stored name keeps the user's name with an extension that matches the bytes");
  const f = (id: string, extra: Partial<E301cfFile> = {}): E301cfFile =>
    ({ id, kind: "plan", name: "Plan.pdf", blobPath: "estimate-files/Q-1/UP-0123456789abcdef/Plan.pdf", contentType: "application/pdf", size: 10, source: "upload", addedAt: 1, addedBy: "T", ...extra });
  const id = (n: number) => "PF-" + n.toString(16).padStart(12, "0");
  const junk = [f(id(1)), f("PF-bad"), f(id(2), { kind: "photo" as never }), f(id(3), { blobPath: "documents/x.pdf" }), f(id(4), { blobPath: "estimate-files/../x" }),
    f(id(5), { contentType: "image/svg+xml" as never }), f(id(6), { size: 0 }), f(id(7), { size: e301cfMaxBytes + 1 }), f(id(8), { source: "ai" as never }), f(id(1)), null, "x"];
  ok(e301cfClean(junk).map((x) => x.id).join() === id(1) && e301cfClean({}).length === 0, "#301 files: junk rows, duplicate ids and bad shapes are dropped on read");
  const twelve = Array.from({ length: e301cfMax }, (_, i) => f(id(100 + i)));
  ok(e301cfClean([...twelve, f(id(999))]).length === 12 && e301cfAppend(twelve, f(id(999))) === null && e301cfAppend([f(id(1))], f(id(2)))?.length === 2 && e301cfAppend([f(id(1))], f(id(1))) === null,
    "#301 files: at most 12 per quote; a duplicate id is refused");
  const gridPlan = f(id(20), { source: "grid", kind: "plan" });
  const gridSet = f(id(21), { source: "grid", kind: "drawing" });
  const upPlan = f(id(22), { kind: "plan" });
  ok(e301cfVisible([gridPlan, gridSet, upPlan]).map((x) => x.id).join() === [id(21), id(22)].join() && e301cfVisible([gridPlan, gridSet]).length === 2,
    "#301 files: an uploaded plan hides the Grid plan, never the Grid drawing set (decision 9, same kind only)");
  const rows = e301cfRows([gridPlan, upPlan]);
  ok(rows[0].hidden && rows[0].sourceLabel === "From the Grid" && rows[0].kindLabel === "Plan" && !rows[1].hidden && rows[1].sizeLabel === "10 B",
    "#301 files: staff rows say what the client can't see (an overridden Grid file)");
  const q = { packageFiles: [f(id(30))], revisions: [{ docFields: { packageFiles: [f(id(31), { blobPath: "estimate-files/Q-1/UP-0123456789abcdef/Old.pdf" })] } }, { docFields: null }] };
  ok(e301cfRef(q, f(id(30)).blobPath) && e301cfRef(q, "estimate-files/Q-1/UP-0123456789abcdef/Old.pdf") && !e301cfRef(q, "estimate-files/Q-1/UP-0123456789abcdef/Gone.pdf"),
    "#301 files: a blob is still referenced by the quote's list or by any revision's frozen list");
  ok(e301cfIsId(e301cfNewId()) && e301cfNewId() !== e301cfNewId() && e301cfGridPath("Q 2041/x") === "estimate-files/Q_2041_x/grid/drawing-set.pdf",
    "#301 files: ids are PF- + 12 hex; the Grid set has its own folder");
  const src = readFileSync(join(process.cwd(), "src/lib/estimate-output/package-files.ts"), "utf8");
  ok(!/^import (?!type)[^\n]*from "(?!@\/lib\/document-files"|@\/lib\/part-docs\/files")/m.test(src), "#301 files purity: value imports only document-files and part-docs/files");
}
```

- [ ] **Step 2: Run it to verify it fails.** `npm run test:specs 2>&1 | grep -E "Cannot find module|FAIL" | head` → module not found
  `@/lib/estimate-output/package-files`.

- [ ] **Step 3: Create `src/lib/estimate-output/package-files.ts`.**

```ts
import { cleanText, displayFileName, formatBytes, isUploadKey, safeFileName } from "@/lib/document-files";
import { sniffDocumentType, sniffImageType } from "@/lib/part-docs/files";

/**
 * #301 slice C (D-j, R13) — the drawings an estimate package shows under
 * "Plans & risers": uploads (PDF / PNG / JPEG / WebP ≤ 25 MB, magic-byte
 * checked, private Blob, direct from the browser like the documents
 * collection) and the linked Grid design's drawing set. Pure and
 * client-safe. `Quote.packageFiles` is store-owned (addPackageFile /
 * removePackageFile); every reader goes through cleanPackageFiles. The
 * client page never sees a record — only `/share/.../file/<id>` links.
 */

export type PackageFileKind = "plan" | "riser" | "drawing";
export type PackageFileSource = "upload" | "grid";
export const PACKAGE_FILE_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"] as const;
export type PackageFileType = (typeof PACKAGE_FILE_TYPES)[number];

export type PackageFile = {
  id: string;
  kind: PackageFileKind;
  name: string;
  /** Private Blob pathname — server-only, never sent to a client page. */
  blobPath: string;
  contentType: PackageFileType;
  size: number;
  source: PackageFileSource;
  addedAt: number;
  addedBy: string;
};

/** Upload select order: Drawing set first (it replaces a Grid set — Slice C adaptation 5). */
export const PACKAGE_FILE_KINDS: readonly PackageFileKind[] = ["drawing", "plan", "riser"];
export const PACKAGE_FILE_KIND_LABEL: Record<PackageFileKind, string> = { drawing: "Drawing set", plan: "Plan", riser: "Riser" };
export const MAX_PACKAGE_FILES = 12;
export const MAX_PACKAGE_FILE_BYTES = 25 * 1024 * 1024;
export const PACKAGE_FILE_SNIFF_BYTES = 1024;
export const PACKAGE_FILE_PREFIX = "estimate-files/";
export const PACKAGE_FILE_ACCEPT = "application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp";

export const PACKAGE_FILES_COPY = {
  wrongType: "Drawings must be PDF, PNG, JPEG or WebP files.",
  tooBig: "That file is over 25 MB.",
  empty: "That file is empty.",
  full: `An estimate holds at most ${MAX_PACKAGE_FILES} drawings — remove one first.`,
  notThisQuote: "That upload does not belong to this quote.",
  alreadySaved: "That file is already saved.",
  noStorage: "File storage isn’t configured on this server.",
  noArrival: "The upload didn’t arrive — try again.",
  unreadable: "Couldn’t read the uploaded file — try again.",
  gone: "That drawing is already gone.",
  failed: "Couldn’t save the drawing — try again.",
} as const;

const EXT: Record<PackageFileType, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const ID_RE = /^PF-[0-9a-f]{12}$/;

export function isPackageFileId(v: unknown): v is string {
  return typeof v === "string" && ID_RE.test(v);
}

export function isPackageFileKind(v: unknown): v is PackageFileKind {
  return v === "plan" || v === "riser" || v === "drawing";
}

/** `PF-` + 12 lowercase hex (Web Crypto — works in Node and the browser). */
export function newPackageFileId(): string {
  return "PF-" + globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

/** One path segment for a quote id (ids are `Q-####` today; anything odd folds to `_`). */
export function quotePathSegment(quoteId: string): string {
  return String(quoteId ?? "").replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 64) || "_";
}

export function packageFileUploadPrefix(quoteId: string, uploadKey: string): string {
  return `${PACKAGE_FILE_PREFIX}${quotePathSegment(quoteId)}/${uploadKey}/`;
}

/** `estimate-files/<quote>/<uploadKey>/<safe name>` — Blob appends a random suffix. */
export function packageFileBlobPath(quoteId: string, uploadKey: string, fileName: string): string {
  return packageFileUploadPrefix(quoteId, uploadKey) + safeFileName(fileName);
}

/** Does a CLIENT-SUPPLIED pathname sit directly under this quote's upload key? */
export function packageFilePathInScope(pathname: unknown, quoteId: string, uploadKey: string): pathname is string {
  if (typeof pathname !== "string" || !quoteId || !isUploadKey(uploadKey)) return false;
  const prefix = packageFileUploadPrefix(quoteId, uploadKey);
  if (!pathname.startsWith(prefix) || pathname.includes("..")) return false;
  const rest = pathname.slice(prefix.length);
  return rest.length > 0 && rest.length <= 200 && /^[A-Za-z0-9._-]+$/.test(rest);
}

/** The Grid-generated set's pathname (putBlob adds a random suffix). */
export function gridSetBlobPath(quoteId: string): string {
  return `${PACKAGE_FILE_PREFIX}${quotePathSegment(quoteId)}/grid/drawing-set.pdf`;
}

/** What the bytes really are — the four accepted types, else null (SVG,
 *  HTML, programs and anything unknown are refused). */
export function sniffPackageFile(bytes: Uint8Array): PackageFileType | null {
  const img = sniffImageType(bytes);
  if (img) return img;
  return sniffDocumentType(bytes) === "pdf" ? "application/pdf" : null;
}

/** The user's file name with an extension that matches the bytes. */
export function packageFileName(raw: unknown, type: PackageFileType): string {
  const name = displayFileName(raw);
  const ext = EXT[type];
  const matches = type === "image/jpeg" ? /\.jpe?g$/i.test(name) : new RegExp(`\\.${ext}$`, "i").test(name);
  return matches ? name : `${name.replace(/\.(pdf|png|jpe?g|webp)$/i, "")}.${ext}`;
}

function fileOf(v: unknown): PackageFile | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (!isPackageFileId(o.id) || !isPackageFileKind(o.kind)) return null;
  if (typeof o.blobPath !== "string" || !o.blobPath.startsWith(PACKAGE_FILE_PREFIX) || o.blobPath.includes("..")) return null;
  if (!(PACKAGE_FILE_TYPES as readonly string[]).includes(o.contentType as string)) return null;
  if (o.source !== "upload" && o.source !== "grid") return null;
  const size = Number(o.size);
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_PACKAGE_FILE_BYTES) return null;
  const addedAt = Number(o.addedAt);
  return {
    id: o.id,
    kind: o.kind,
    name: cleanText(o.name, 180) || "file",
    blobPath: o.blobPath,
    contentType: o.contentType as PackageFileType,
    size,
    source: o.source,
    addedAt: Number.isFinite(addedAt) ? addedAt : 0,
    addedBy: cleanText(o.addedBy, 120),
  };
}

/** Every read of a stored list: junk rows and duplicate ids dropped, at most 12. */
export function cleanPackageFiles(raw: unknown): PackageFile[] {
  if (!Array.isArray(raw)) return [];
  const out: PackageFile[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    const file = fileOf(v);
    if (!file || seen.has(file.id)) continue;
    seen.add(file.id);
    out.push(file);
    if (out.length >= MAX_PACKAGE_FILES) break;
  }
  return out;
}

/** The list with `file` appended, or null (full, or the id is already there). */
export function appendPackageFile(list: unknown, file: PackageFile): PackageFile[] | null {
  const cur = cleanPackageFiles(list);
  if (cur.length >= MAX_PACKAGE_FILES || cur.some((f) => f.id === file.id)) return null;
  return [...cur, file];
}

/** Decision 9 / D-j: an uploaded file of a kind hides Grid files of that kind. */
export function visiblePackageFiles(files: readonly PackageFile[]): PackageFile[] {
  const uploaded = new Set(files.filter((f) => f.source === "upload").map((f) => f.kind));
  return files.filter((f) => f.source === "upload" || !uploaded.has(f.kind));
}

type RefSource = { packageFiles?: unknown; revisions?: Array<{ docFields?: { packageFiles?: unknown } | null } | null> | null };

/** Still listed anywhere — the quote's own list or any revision's frozen one
 *  (a superseded link keeps showing what it was sent). */
export function packageBlobReferenced(q: RefSource, blobPath: string): boolean {
  if (cleanPackageFiles(q.packageFiles).some((f) => f.blobPath === blobPath)) return true;
  return (q.revisions || []).some((r) => cleanPackageFiles(r?.docFields?.packageFiles).some((f) => f.blobPath === blobPath));
}

export type PackageFileRow = {
  id: string;
  kind: PackageFileKind;
  kindLabel: string;
  name: string;
  sizeLabel: string;
  source: PackageFileSource;
  sourceLabel: string;
  /** True for a Grid file an upload of the same kind hides from the client. */
  hidden: boolean;
};

/** The staff Drawings list — never a blob path. */
export function packageFileRows(files: readonly PackageFile[]): PackageFileRow[] {
  const shown = new Set(visiblePackageFiles(files).map((f) => f.id));
  return files.map((f) => ({
    id: f.id,
    kind: f.kind,
    kindLabel: PACKAGE_FILE_KIND_LABEL[f.kind],
    name: f.name,
    sizeLabel: formatBytes(f.size),
    source: f.source,
    sourceLabel: f.source === "grid" ? "From the Grid" : "Uploaded",
    hidden: !shown.has(f.id),
  }));
}
```

  Check: `safeFileName("Main plan (rev 2).pdf")` folds `" (" → "_"`, `" 2)" → "_2_"` — if the harness's expected path
  string differs from what `safeFileName` actually returns, fix the **expected string in your new check** to the real
  output (it is this task's own check) and say so in the report.

- [ ] **Step 4: Run the gates.** tsc 0; test:specs ALL PASSED (PASS = baseline + 12); eslint on the new file clean.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/estimate-output/package-files.ts scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(estimate-output): #301 slice C — pure package files: record, upload scope, magic-byte sniff, upload-overrides-grid rule

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Pure responses + gap chips

**Files:**
- Create: `src/lib/estimate-output/responses.ts`, `src/lib/estimate-output/package-gaps.ts`
- Test: harness block `#301 slice C — responses + gaps (pure)`

**Interfaces:**
- **Consumes:** `cleanText` (`@/lib/document-files`); `fmt` (`@/app/(app)/estimator/pricing`); `permsFor` (`@/lib/team`);
  `outputScopes` (`./scopes`); `printableKeyProducts` (`@/app/(app)/estimator/narrative`); `systemPrintsInBody`
  (`@/app/(app)/estimator/quote-document-view`); type `SpecSection`.
- **Produces** (Tasks 3, 7, 8):
  - `responses.ts`: `type ClientResponseKind = "accept" | "question"`;
    `type ClientResponse = { id; kind; rev; at; name; email; title?; message; sectionIds: string[]; sectionNames: string[]; total: number }`;
    `type CleanResponse = Omit<ClientResponse, "id" | "rev" | "at">`; `MAX_CLIENT_RESPONSES = 200`; the caps and rate
    constants; `CLIENT_ACTION_COPY`; `CLIENT_LINK_ACTOR = "Client link"`; `PEAK_NAME = "Peak Systems Group"`;
    `type ClientActionResult = { ok: true; confirmation: string } | { ok: false; error: string }`;
    `type ResponseScope = { id: string; name: string; price: number; priceLabel: string }`;
    `responseScopes(sections): ResponseScope[]`; `selectedTotal(scopes): number`;
    `sanitizeClientResponse(kind, input, scopes): { ok: true; value: CleanResponse } | { ok: false; error: string }`;
    `newResponseId(): string`; `isClientResponseId(v)`; `cleanClientResponses(raw): ClientResponse[]`;
    `appendResponseTo(list, r): ClientResponse[] | null`; `responseTaskTitle(r, number, revNo)`;
    `responseNoteText(r, number, revNo)`; `type RosterUser`; `matchRosterName(name, users)`;
    `leadEstimator(owner, preparedBy, users)`; `responseAssignees(owner, preparedBy, users)`;
    `confirmationText(leadName)`; `chicagoDayEnd(now)`; `type ResponseRow`; `responseRows(raw, revNoOf)`;
    `creditNoteText(creditAmount)`.
  - `package-gaps.ts`: `type PackageGapCounts = { noDatasheet; drawings; keyProductsNeedText; scopesNoGoals }`;
    `keyProductsNeedingText(sections)`, `scopesWithoutGoals(sections)`, `packageGapChips(c): string[]`.

- [ ] **Step 1: Write the failing harness block.** Append:

```ts
/* ======================================================================
   #301 slice C — responses + gaps (pure): D-m records, D-n caps and the
   section filter, R16 assignees (+ active), the task/note text, the
   Chicago due time, staff rows, the R1 credit note, and the gap chips.
   ====================================================================== */
import {
  sanitizeClientResponse as e301crSan, responseScopes as e301crScopes, cleanClientResponses as e301crClean, appendResponseTo as e301crAppend,
  responseTaskTitle as e301crTitle, responseNoteText as e301crNote, responseAssignees as e301crAssignees, leadEstimator as e301crLead,
  confirmationText as e301crThanks, chicagoDayEnd as e301crDayEnd, responseRows as e301crRows, creditNoteText as e301crCredit,
  newResponseId as e301crNewId, isClientResponseId as e301crIsId, CLIENT_ACTION_COPY as e301crCopy, MAX_CLIENT_RESPONSES as e301crMax,
  type ClientResponse as E301crResp,
} from "@/lib/estimate-output/responses";
import { packageGapChips as e301crChips, keyProductsNeedingText as e301crKpText, scopesWithoutGoals as e301crNoGoals } from "@/lib/estimate-output/package-gaps";
import type { SpecSection as E301crSec } from "@/app/(app)/estimator/types";
{
  const scopes = [{ id: "s1", name: "Lighting", price: 28500, priceLabel: "$28,500.00" }, { id: "s2", name: "Rigging", price: 19750.5, priceLabel: "$19,750.50" }];
  const acc = e301crSan("accept", { name: "  Pat Doe ", email: "pat@school.org", title: "Facilities", message: "Go.", sectionIds: ["s2", "s1", "s1", "nope", 7] }, scopes);
  ok(acc.ok && acc.value.name === "Pat Doe" && acc.value.sectionIds.join() === "s1,s2" && acc.value.sectionNames.join() === "Lighting,Rigging" && acc.value.total === 48250.5 &&
     acc.value.title === "Facilities" && acc.value.kind === "accept",
    "#301 responses: accept keeps only the pinned revision's scopes (document order, deduped) and totals them server-side");
  const refusals = [
    e301crSan("accept", { name: " ", sectionIds: ["s1"] }, scopes), e301crSan("accept", { name: "P", sectionIds: [] }, scopes),
    e301crSan("accept", { name: "P", sectionIds: ["s1"], email: "not-an-email" }, scopes), e301crSan("question", { name: "P", message: "  " }, scopes),
    e301crSan("accept", null, scopes),
  ];
  ok(refusals.every((r) => !r.ok) && refusals.map((r) => (!r.ok ? r.error : "")).join("|") ===
     [e301crCopy.needName, e301crCopy.needScope, e301crCopy.badEmail, e301crCopy.needMessage, e301crCopy.needName].join("|"),
    "#301 responses: a name is required, accept needs a scope, a question needs a message, a bad email is refused");
  const long = e301crSan("question", { name: "N".repeat(500), email: "", title: "T".repeat(500), message: "M".repeat(9000), sectionIds: ["s1"] }, scopes);
  ok(long.ok && long.value.name.length === 120 && long.value.message.length === 4000 && long.value.sectionIds.length === 0 && long.value.total === 0 && !("title" in long.value),
    "#301 responses: caps (name 120, message 4,000); a question carries no scopes, total or title");
  const e2 = e301crSan("accept", { name: "P", email: "e".repeat(300) + "@x.io", sectionIds: ["s1"] }, scopes);
  const nl = e301crSan("accept", { name: "A\nB", sectionIds: ["s1"] }, scopes);
  ok(!e2.ok && e2.error === e301crCopy.badEmail && nl.ok && !/[\n\r]/.test(nl.value.name),
    "#301 responses: an email over 200 characters is refused (never truncated into another address); a name never carries a line break");
  const secs = [
    { id: "s1", name: "Lighting", kind: "materials", items: [{ id: 1, sku: "A", desc: "A", qty: 1, unit: "ea", cost: 1, price: 100 }] },
    { id: "s3", name: "Install", kind: "labor", items: [{ id: 2, sku: "", desc: "Labor", qty: 1, unit: "ea", cost: 1, price: 50, labor: true }] },
  ] as unknown as E301crSec[];
  ok(e301crScopes(secs).map((s) => `${s.id}:${s.price}:${s.priceLabel}`).join() === "s1:100:$100.00,s3:50:$50.00",
    "#301 responses: the choosable scopes are the printed systems, labor included (R2), priced as the page prices them");
  // ---- records ----
  const r = (n: number, extra: Partial<E301crResp> = {}): E301crResp =>
    ({ id: "CR-" + n.toString(16).padStart(12, "0"), kind: "accept", rev: 3, at: n, name: "Pat", email: "", message: "", sectionIds: ["s1"], sectionNames: ["Lighting"], total: 100, ...extra });
  ok(e301crClean([r(1), r(1), { ...r(2), kind: "hack" }, { ...r(3), id: "x" }, { ...r(4), rev: 0 }, { ...r(5), total: -1 }, null, r(6)]).map((x) => x.at).join() === "1,6",
    "#301 responses: junk, duplicate ids, bad kinds / revs / totals are dropped on read");
  const full = Array.from({ length: e301crMax }, (_, i) => r(i + 1));
  ok(e301crAppend(full, r(999)) === null && e301crAppend([r(1)], r(2))?.length === 2 && e301crIsId(e301crNewId()) && e301crNewId() !== e301crNewId(),
    "#301 responses: at most 200 per quote; ids are CR- + 12 hex");
  // ---- text ----
  const a = { kind: "accept" as const, name: "Pat Doe", email: "pat@school.org", title: "Facilities", message: "Please start in June.", sectionIds: ["s1", "s2"], sectionNames: ["Lighting", "Rigging"], total: 48250 };
  ok(e301crTitle(a, "EST-1042", 2) === "Client accepted EST-1042 Rev 2 — Lighting, Rigging ($48,250.00)" &&
     e301crTitle({ ...a, kind: "question" }, "EST-1042", 2) === "Client question — EST-1042",
    "#301 responses: the task titles (D-m)");
  ok(e301crNote(a, "EST-1042", 2) === "Client selected scopes on EST-1042 Rev 2 (client link): Lighting, Rigging — $48,250.00 before any Rewards credit.\nFrom: Pat Doe · Facilities · pat@school.org\nMessage: Please start in June." &&
     e301crNote({ ...a, kind: "question", title: undefined, email: "", message: "Is rigging inspected?" }, "EST-1042", 2) === "Client question on EST-1042 Rev 2 (client link).\nFrom: Pat Doe\nMessage: Is rigging inspected?",
    "#301 responses: the note / activity text names the scopes, the pre-credit total, who, and the message");
  // ---- R16 assignees ----
  const U = (id: string, name: string, roles: string[], status = "active") => ({ id, name, roles, status });
  const users = [U("u1", "Jeff Chesebro", ["Admin"]), U("u2", "Sam Lee", ["Estimator"]), U("u3", "Ana Ruiz", ["Manager"]), U("u4", "Old Hand", ["Admin"], "archived"), U("u5", "Twin", ["Estimator"]), U("u6", "twin", ["Estimator"])];
  ok(e301crAssignees("  sam lee ", "", users).map((u) => u.id).join() === "u2" && e301crAssignees("", "Sam Lee", users).map((u) => u.id).join() === "u2" &&
     e301crAssignees("Nobody", "Twin", users).map((u) => u.id).join() === "u1,u3" && e301crAssignees("Old Hand", "", users).map((u) => u.id).join() === "u1,u3",
    "#301 responses: R16 — the lead estimator (owner, else Prepared by; exact, unique) if active, else every active approve holder");
  ok(e301crLead("Twin", "", users) === null && e301crThanks("Jeff Chesebro") === "Thanks — Jeff Chesebro has been notified." && e301crThanks(null) === "Thanks — Peak Systems Group has been notified.",
    "#301 responses: an ambiguous name resolves to nobody; the confirmation names the lead estimator");
  ok(e301crDayEnd(Date.UTC(2026, 9, 5, 15)) === Date.UTC(2026, 9, 6, 4, 59) && e301crDayEnd(Date.UTC(2026, 0, 15, 15)) === Date.UTC(2026, 0, 16, 5, 59),
    "#301 responses: tasks are due 11:59 PM Chicago today (CDT and CST)");
  const rows = e301crRows([r(10, { at: Date.UTC(2026, 9, 5, 19, 14) }), r(11, { at: Date.UTC(2026, 9, 6, 15), kind: "question", sectionIds: [], sectionNames: [], total: 0, message: "Q?" })], (rev) => rev - 1);
  ok(rows.length === 2 && rows[0].kindLabel === "Question" && rows[0].total === "" && rows[1].kindLabel === "Selected scopes" && rows[1].total === "$100.00" &&
     rows[1].revLabel === "Rev 2" && rows[1].when === "Oct 5, 2:14 PM",
    "#301 responses: staff rows newest first, printed Rev N, Chicago time");
  ok(e301crCredit("−$1,250.00") === "A Rewards credit of $1,250.00 applies to your order." && e301crCredit(null) === null,
    "#301 responses: R1 — the credit note under the live total");
  // ---- gaps ----
  const kpSecs = [
    { id: "a", name: "Lighting", kind: "materials", clientGoals: "", keyProducts: [{ lineKey: "1", sku: "A", text: "", photo: true }, { lineKey: "2", sku: "B", text: "Para.", photo: true }],
      items: [{ id: 1, sku: "A", desc: "A", qty: 1, unit: "ea", cost: 1, price: 10 }, { id: 2, sku: "B", desc: "B", qty: 1, unit: "ea", cost: 1, price: 10 }] },
    { id: "b", name: "Labor", kind: "labor", items: [{ id: 3, sku: "", desc: "L", qty: 1, unit: "ea", cost: 1, price: 5, labor: true }] },
    { id: "c", name: "Rigging", kind: "materials", clientGoals: "Safe.", items: [{ id: 4, sku: "C", desc: "C", qty: 1, unit: "ea", cost: 1, price: 10 }] },
  ] as unknown as E301crSec[];
  ok(e301crKpText(kpSecs) === 1 && e301crNoGoals(kpSecs) === 1, "#301 gaps: key products with no paragraph; scopes with no client goals (labor never counts)");
  ok(e301crChips({ noDatasheet: 3, drawings: 0, keyProductsNeedText: 1, scopesNoGoals: 2 }).join("|") === "3 parts without a datasheet|No drawings|1 key product needs a paragraph|No client goals on 2 scopes" &&
     e301crChips({ noDatasheet: 1, drawings: 2, keyProductsNeedText: 2, scopesNoGoals: 1 }).join("|") === "1 part without a datasheet|2 key products need a paragraph|No client goals on 1 scope" &&
     e301crChips({ noDatasheet: 0, drawings: 1, keyProductsNeedText: 0, scopesNoGoals: 0 }).length === 0,
    "#301 gaps: the staff chips (only the gaps that exist)");
  const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  ok(!/^import (?!type)[^\n]*from "(?!@\/lib\/document-files"|@\/app\/\(app\)\/estimator\/pricing"|@\/lib\/team"|\.\/scopes")/m.test(rd("src/lib/estimate-output/responses.ts")) &&
     !/^import (?!type)[^\n]*from "(?!@\/app\/\(app\)\/estimator\/narrative"|@\/app\/\(app\)\/estimator\/quote-document-view"|\.\/scopes")/m.test(rd("src/lib/estimate-output/package-gaps.ts")),
    "#301 responses/gaps purity: client-safe value imports only");
}
```

- [ ] **Step 2: Run it to verify it fails** (module not found).

- [ ] **Step 3: Create `src/lib/estimate-output/responses.ts`.**

```ts
import type { SpecSection } from "@/app/(app)/estimator/types";
import { fmt } from "@/app/(app)/estimator/pricing";
import { cleanText } from "@/lib/document-files";
import { permsFor } from "@/lib/team";
import { outputScopes } from "./scopes";

/**
 * #301 slice C (D-m, D-n, R1, R15, R16) — what a client sends from the
 * package page: a scope selection ("accept") or a question. Pure and
 * client-safe. `Quote.clientResponses` is store-owned (appendClientResponse,
 * under the row lock); a response never changes the quote's status.
 */

export type ClientResponseKind = "accept" | "question";
export type ClientResponse = {
  id: string;
  kind: ClientResponseKind;
  /** QuoteRevision.rev the client was looking at (R11 — staff print "Rev N"). */
  rev: number;
  at: number;
  name: string;
  email: string;
  title?: string;
  message: string;
  sectionIds: string[];
  sectionNames: string[];
  /** Σ the selected scopes' prices, pre-credit (R1). 0 for a question. */
  total: number;
};
export type CleanResponse = Omit<ClientResponse, "id" | "rev" | "at">;
export type ClientActionResult = { ok: true; confirmation: string } | { ok: false; error: string };
export type ResponseScope = { id: string; name: string; price: number; priceLabel: string };

export const MAX_CLIENT_RESPONSES = 200;
export const RESPONSE_NAME_MAX = 120;
export const RESPONSE_TITLE_MAX = 120;
export const RESPONSE_EMAIL_MAX = 200;
export const RESPONSE_MESSAGE_MAX = 4_000;
export const RESPONSE_IP_LIMIT = 5;
export const RESPONSE_IP_WINDOW_MS = 10 * 60_000;
export const RESPONSE_QUOTE_LIMIT = 30;
export const RESPONSE_QUOTE_WINDOW_MS = 24 * 60 * 60_000;
/** Who the note, the lead activity and the task say did it. */
export const CLIENT_LINK_ACTOR = "Client link";
/** R16: no lead estimator → the company. */
export const PEAK_NAME = "Peak Systems Group";

export const CLIENT_ACTION_COPY = {
  chooseTitle: "Choose your scopes",
  chooseHelp: "Check the scopes you want and submit. Peak will follow up to confirm.",
  selectedTotal: "Selected scopes",
  submitSelection: "Submit selection",
  askTitle: "Ask a question or request changes",
  send: "Send",
  sending: "Sending…",
  name: "Your name",
  title: "Title",
  email: "Email",
  note: "Note",
  message: "Message",
  needName: "Enter your name.",
  needScope: "Check at least one scope.",
  needMessage: "Enter a message.",
  badEmail: "Check the email address.",
  tooMany: "Too many submissions — try again later.",
  inactive: "This link isn’t active. Ask your Peak rep for a new one.",
  superseded: "A newer version of this estimate was sent — open the current version to respond.",
  closed: "This estimate can’t take responses right now.",
  full: "This estimate can’t take more responses online — contact Peak directly.",
  failed: "Couldn’t send — try again.",
  noJs: "Turn on JavaScript to respond here, or reply to Peak’s email.",
} as const;

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
const ID_RE = /^CR-[0-9a-f]{12}$/;

/** The page's scopes as a client can choose them — the printed systems, labor included (R2). */
export function responseScopes(sections: SpecSection[]): ResponseScope[] {
  return outputScopes({ sections }).map((s) => ({ id: s.id, name: s.name, price: s.price, priceLabel: fmt(s.price) }));
}

export function selectedTotal(scopes: ReadonlyArray<Pick<ResponseScope, "price">>): number {
  return Math.round(scopes.reduce((n, s) => n + (Number.isFinite(s.price) ? s.price : 0), 0) * 100) / 100;
}

/** D-n — every field cleaned and capped; `sectionIds` filtered to the pinned revision's scopes. */
export function sanitizeClientResponse(
  kind: ClientResponseKind,
  input: unknown,
  scopes: readonly ResponseScope[]
): { ok: true; value: CleanResponse } | { ok: false; error: string } {
  const o = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const name = cleanText(o.name, RESPONSE_NAME_MAX);
  if (!name) return { ok: false, error: CLIENT_ACTION_COPY.needName };
  const rawEmail = typeof o.email === "string" ? o.email.trim() : "";
  if (rawEmail.length > RESPONSE_EMAIL_MAX) return { ok: false, error: CLIENT_ACTION_COPY.badEmail };
  const email = cleanText(rawEmail, RESPONSE_EMAIL_MAX);
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: CLIENT_ACTION_COPY.badEmail };
  const message = cleanText(o.message, RESPONSE_MESSAGE_MAX, { multiline: true });
  if (kind === "question") {
    if (!message) return { ok: false, error: CLIENT_ACTION_COPY.needMessage };
    return { ok: true, value: { kind, name, email, message, sectionIds: [], sectionNames: [], total: 0 } };
  }
  const title = cleanText(o.title, RESPONSE_TITLE_MAX);
  const want = new Set(Array.isArray(o.sectionIds) ? o.sectionIds.slice(0, 200).filter((x): x is string => typeof x === "string") : []);
  const picked = scopes.filter((s) => want.has(s.id));
  if (!picked.length) return { ok: false, error: CLIENT_ACTION_COPY.needScope };
  return {
    ok: true,
    value: {
      kind,
      name,
      email,
      ...(title ? { title } : {}),
      message,
      sectionIds: picked.map((s) => s.id),
      sectionNames: picked.map((s) => s.name),
      total: selectedTotal(picked),
    },
  };
}

export function newResponseId(): string {
  return "CR-" + globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

export function isClientResponseId(v: unknown): v is string {
  return typeof v === "string" && ID_RE.test(v);
}

const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 200) : []);

function responseOf(v: unknown): ClientResponse | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (!isClientResponseId(o.id) || (o.kind !== "accept" && o.kind !== "question")) return null;
  const rev = Number(o.rev);
  const at = Number(o.at);
  const total = Number(o.total);
  if (!Number.isSafeInteger(rev) || rev < 1 || !Number.isFinite(at) || !Number.isFinite(total) || total < 0) return null;
  const title = cleanText(o.title, RESPONSE_TITLE_MAX);
  return {
    id: o.id,
    kind: o.kind,
    rev,
    at,
    name: cleanText(o.name, RESPONSE_NAME_MAX),
    email: cleanText(o.email, RESPONSE_EMAIL_MAX),
    ...(title ? { title } : {}),
    message: cleanText(o.message, RESPONSE_MESSAGE_MAX, { multiline: true }),
    sectionIds: strList(o.sectionIds),
    sectionNames: strList(o.sectionNames),
    total,
  };
}

/** Every read of the stored list: junk and duplicate ids dropped. */
export function cleanClientResponses(raw: unknown): ClientResponse[] {
  if (!Array.isArray(raw)) return [];
  const out: ClientResponse[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    const r = responseOf(v);
    if (!r || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

/** The list with `r` appended, or null at the 200 cap. */
export function appendResponseTo(list: unknown, r: ClientResponse): ClientResponse[] | null {
  const cur = cleanClientResponses(list);
  if (cur.length >= MAX_CLIENT_RESPONSES) return null;
  return [...cur, r];
}

export function responseTaskTitle(r: Pick<CleanResponse, "kind" | "sectionNames" | "total">, number: string, revNo: number): string {
  return r.kind === "accept" ? `Client accepted ${number} Rev ${revNo} — ${r.sectionNames.join(", ")} (${fmt(r.total)})` : `Client question — ${number}`;
}

export function responseNoteText(r: CleanResponse, number: string, revNo: number): string {
  const who = [r.name, r.title, r.email].filter(Boolean).join(" · ");
  const head =
    r.kind === "accept"
      ? `Client selected scopes on ${number} Rev ${revNo} (client link): ${r.sectionNames.join(", ")} — ${fmt(r.total)} before any Rewards credit.`
      : `Client question on ${number} Rev ${revNo} (client link).`;
  return [head, `From: ${who}`, r.message ? `Message: ${r.message}` : ""].filter(Boolean).join("\n");
}

export type RosterUser = { id: string; name: string; status?: string | null; roles?: string[] | null };

const norm = (s: unknown) => (typeof s === "string" ? s : "").trim().toLowerCase();

/** R16: exact, case-insensitive, trimmed name — unique only. */
export function matchRosterName<T extends { name: string }>(name: string | null | undefined, users: readonly T[]): T | null {
  const n = norm(name);
  if (!n) return null;
  const hits = users.filter((u) => norm(u.name) === n);
  return hits.length === 1 ? hits[0] : null;
}

/** R16: the quote's Lead estimator (`owner`), else Prepared by. */
export function leadEstimator<T extends { name: string }>(owner: string | null | undefined, preparedBy: string | null | undefined, users: readonly T[]): T | null {
  return matchRosterName(owner, users) ?? matchRosterName(preparedBy, users);
}

const isActive = (u: RosterUser) => (u.status ?? "active") === "active";

/** R16 + Slice C adaptation 11: the lead estimator when active, else every active approve holder. */
export function responseAssignees<T extends RosterUser>(owner: string | null | undefined, preparedBy: string | null | undefined, users: readonly T[]): T[] {
  const lead = leadEstimator(owner, preparedBy, users);
  if (lead && isActive(lead)) return [lead];
  return users.filter((u) => isActive(u) && !!permsFor(u.roles || []).approve);
}

export function confirmationText(leadName: string | null): string {
  return `Thanks — ${(leadName || "").trim() || PEAK_NAME} has been notified.`;
}

/** 11:59 PM Chicago on the day `now` falls on there (the task's "due today"). */
export function chicagoDayEnd(now: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value])) as Record<string, string>;
  const wallAsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const offset = wallAsUtc - Math.floor(now / 1000) * 1000; // Chicago wall clock − UTC
  return Date.UTC(+p.year, +p.month - 1, +p.day, 23, 59, 0) - offset;
}

export type ResponseRow = { id: string; kindLabel: string; revLabel: string; who: string; scopes: string; total: string; message: string; when: string };

const chicagoStamp = (ms: number) =>
  new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });

/** The staff list, newest first. `revNoOf` maps QuoteRevision.rev → the printed Rev N. */
export function responseRows(raw: unknown, revNoOf: (rev: number) => number): ResponseRow[] {
  return cleanClientResponses(raw)
    .sort((a, b) => b.at - a.at)
    .map((r) => ({
      id: r.id,
      kindLabel: r.kind === "accept" ? "Selected scopes" : "Question",
      revLabel: `Rev ${revNoOf(r.rev)}`,
      who: [r.name, r.title, r.email].filter(Boolean).join(" · "),
      scopes: r.sectionNames.join(", "),
      total: r.kind === "accept" ? fmt(r.total) : "",
      message: r.message,
      when: chicagoStamp(r.at),
    }));
}

/** R1 — under the live "Selected scopes" total. `creditAmount` is the page's formatted "−$X". */
export function creditNoteText(creditAmount: string | null | undefined): string | null {
  const amt = (creditAmount || "").replace(/^[−-]\s*/, "").trim();
  return amt ? `A Rewards credit of ${amt} applies to your order.` : null;
}
```

  If `toLocaleString` prints the stamp with a narrow no-break space before `PM` (newer ICU), the harness check
  `rows[1].when === "Oct 5, 2:14 PM"` fails. In that case replace ` ` with a plain space inside `chicagoStamp`
  (`.replace(/ /g, " ")`). Don't change the check.

- [ ] **Step 4: Create `src/lib/estimate-output/package-gaps.ts`.**

```ts
import type { SpecSection } from "@/app/(app)/estimator/types";
import { printableKeyProducts } from "@/app/(app)/estimator/narrative";
import { systemPrintsInBody } from "@/app/(app)/estimator/quote-document-view";
import { outputScopes } from "./scopes";

/**
 * #301 slice C (spec §6) — the staff-only gap chips in the Client link
 * panel (decision 13: the client page lists only what's included). Pure.
 * Counts come from the LIVE quote — the next send (Slice C adaptation 10).
 */

export type PackageGapCounts = { noDatasheet: number; drawings: number; keyProductsNeedText: number; scopesNoGoals: number };

/** Key products on printed systems whose paragraph is blank. */
export function keyProductsNeedingText(sections: SpecSection[]): number {
  return (sections || []).filter(systemPrintsInBody).reduce((n, s) => n + printableKeyProducts(s).filter((k) => k.blocks.length === 0).length, 0);
}

/** Printed, non-labor scopes with no client goals (labor never matches a discipline — R2). */
export function scopesWithoutGoals(sections: SpecSection[]): number {
  return outputScopes({ sections: sections || [] }).filter((s) => !s.isLabor && !s.clientGoals).length;
}

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function packageGapChips(c: PackageGapCounts): string[] {
  const out: string[] = [];
  if (c.noDatasheet > 0) out.push(`${n(c.noDatasheet, "part", "parts")} without a datasheet`);
  if (c.drawings === 0) out.push("No drawings");
  if (c.keyProductsNeedText > 0) out.push(`${n(c.keyProductsNeedText, "key product needs", "key products need")} a paragraph`);
  if (c.scopesNoGoals > 0) out.push(`No client goals on ${n(c.scopesNoGoals, "scope", "scopes")}`);
  return out;
}
```

  Before writing it, confirm `systemPrintsInBody` is exported from `src/app/(app)/estimator/quote-document-view.ts`
  (`grep -n "export function systemPrintsInBody" src/app/\(app\)/estimator/quote-document-view.ts`). Slice A's `scopes.ts`
  already imports it from there.

- [ ] **Step 5: Run the gates** (tsc 0; test:specs PASS = previous + 17; eslint on both new files clean).

- [ ] **Step 6: Commit.**

```bash
git add src/lib/estimate-output/responses.ts src/lib/estimate-output/package-gaps.ts scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(estimate-output): #301 slice C — pure client responses (sanitize, caps, R16 assignees, task/note text) + staff gap chips

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Store-owned `packageFiles` + `clientResponses`

**Files:**
- Modify: `src/lib/stores/quotes.ts` (imports; `Quote` after Slice B's `shareOpens`; `QuoteRevisionDocFields`;
  `update()`; `revisionDocFields()`; append three writers after Slice B's `recordShareOpen`)
- Test: harness block `#301 slice C — store`; declares `estimateOutput301CAsyncChecks` + `e301cStoreAsyncChecks`

**Interfaces:**
- **Consumes:** Task 1 (`cleanPackageFiles`, `appendPackageFile`, `type PackageFile`); Task 2 (`appendResponseTo`,
  `type ClientResponse`, `type CleanResponse`); `onlineEstimateState` (`@/lib/quote-share/view`); `patchQuote` (private).
- **Produces** (Tasks 5–9):
  `Quote.packageFiles?: PackageFile[] | null`; `Quote.clientResponses?: ClientResponse[] | null`;
  `QuoteRevisionDocFields.packageFiles?: PackageFile[]`;
  `type PackageFileWrite = { ok: true; quote: Quote; file: PackageFile; annexedRev: number | null } | { ok: false; reason: "gone" | "full" | "missing" }`;
  `addPackageFile(id: string, file: PackageFile): Promise<PackageFileWrite>`;
  `removePackageFile(id: string, fileId: string): Promise<PackageFileWrite>`;
  `type ClientResponseWrite = { ok: true; response: ClientResponse } | { ok: false; reason: "gone" | "state" | "full" }`;
  `appendClientResponse(id: string, pinnedRev: number, r: CleanResponse, now: number, newId: string): Promise<ClientResponseWrite>`.

- [ ] **Step 1: Write the failing harness block.** Append:

```ts
/* ======================================================================
   #301 slice C — store: packageFiles + clientResponses are store-owned
   (row lock, no updatedAt / contentChangedAt move, update() can't write
   them); packageFiles freeze into docFields and are annexed onto the
   latest SENT revision while the online state is ok (R13); a response is
   appended only for the latest sent revision of a sent quote (D-m).
   ====================================================================== */
{
  const qs = readFileSync(join(process.cwd(), "src/lib/stores/quotes.ts"), "utf8");
  const fnBody = (h: string) => qs.slice(qs.indexOf(h), qs.indexOf("\n}\n", qs.indexOf(h)));
  const upd = fnBody("export async function update(");
  ok(upd.includes("delete clean.packageFiles;") && upd.includes("delete clean.clientResponses;") && upd.includes("delete clean.shareLink;"),
    "#301 store: update() drops a caller's packageFiles and clientResponses (and still shareLink)");
  const writers = ["export async function addPackageFile(", "export async function removePackageFile(", "export async function appendClientResponse("].map(fnBody);
  ok(writers.every((w) => w.includes("patchQuote(id,") && !w.includes("updatedAt")) &&
     (qs.match(/\.packageFiles = /g) || []).length === (writers[0] + writers[1] + fnBody("function annexPackageFiles(")).match(/\.packageFiles = /g)?.length &&
     (qs.match(/\.clientResponses = /g) || []).length === 1,
    "#301 store: the three writers are the only writers, under the row lock, and never move updatedAt");
  ok(fnBody("export function revisionDocFields(").includes("packageFiles: cleanPackageFiles(d.packageFiles)") &&
     !qs.slice(qs.indexOf("export const QUOTE_CONTENT_FIELDS"), qs.indexOf("] as const;", qs.indexOf("export const QUOTE_CONTENT_FIELDS"))).includes("packageFiles"),
    "#301 store: every new revision freezes the drawings list; attaching one is not content (the PDF never goes stale)");
  const annex = fnBody("function annexPackageFiles(");
  ok(annex.includes("onlineEstimateState(doc)") && annex.includes("!r.docFields") && annex.includes("packageFiles: cleanPackageFiles(doc.packageFiles)"),
    "#301 store: R13 — the annex mirrors the list onto the latest sent revision only while the online state is ok, and never creates docFields");
}

async function estimateOutput301CAsyncChecks(): Promise<void> {
  await e301cStoreAsyncChecks();
}

async function e301cStoreAsyncChecks(): Promise<void> {
  const { fixtureId } = await import("./test-fixtures");
  const Q = await import("@/lib/stores/quotes");
  const F = await import("@/lib/estimate-output/package-files");
  const QID = fixtureId(301, "c-store");
  const sec = { id: "s1", name: "Stage lighting", kind: "materials", mfr: "", freightPct: 0, items: [{ id: 1, sku: "A", desc: "Fixture", qty: 1, unit: "ea", cost: 10, price: 20 }] };
  await Q.create({ id: QID, name: "#301c store", customer: "Spec fixture", owner: "spec", quoteType: "system", source: "estimator", spec: { sections: [sec], mobs: [] } });
  registerFixture("quotes", QID);
  const file = (n: number, extra: Record<string, unknown> = {}) => ({
    id: "PF-" + n.toString(16).padStart(12, "0"), kind: "plan" as const, name: `Plan ${n}.pdf`, blobPath: `estimate-files/${QID}/UP-0123456789abcdef/p${n}.pdf`,
    contentType: "application/pdf" as const, size: 100, source: "upload" as const, addedAt: n, addedBy: "T", ...extra });
  const before = (await Q.get(QID))!;
  const a1 = await Q.addPackageFile(QID, file(1));
  const q1 = (await Q.get(QID))!;
  ok(a1.ok && a1.annexedRev === null && F.cleanPackageFiles(q1.packageFiles).length === 1 && q1.updatedAt === before.updatedAt && q1.contentChangedAt === before.contentChangedAt,
    "#301 store (DB): a drawing on an unsent quote is listed, annexes nothing, moves neither updatedAt nor contentChangedAt");
  await Q.update(QID, { status: "sent" });
  await Q.addQuoteRevision(QID, { by: "Test", reason: "sent" }); // rev 1
  const sent1 = (await Q.get(QID))!.revisions!.at(-1)!;
  ok(F.cleanPackageFiles(sent1.docFields?.packageFiles).map((f) => f.id).join() === file(1).id, "#301 store (DB): a send freezes the drawings in the revision's docFields");
  const a2 = await Q.addPackageFile(QID, file(2));
  const r1 = (await Q.get(QID))!.revisions!.find((r) => r.rev === 1)!;
  ok(a2.ok && a2.annexedRev === 1 && F.cleanPackageFiles(r1.docFields?.packageFiles).length === 2, "#301 store (DB): R13 — a drawing added after the send is annexed onto the sent revision");
  await Q.update(QID, { status: "draft" });
  const a3 = await Q.addPackageFile(QID, file(3));
  const r1b = (await Q.get(QID))!.revisions!.find((r) => r.rev === 1)!;
  ok(a3.ok && a3.annexedRev === null && F.cleanPackageFiles(r1b.docFields?.packageFiles).length === 2, "#301 store (DB): while revising, a new drawing waits for the next send");
  await Q.update(QID, { packageFiles: [], clientResponses: [{ id: "CR-000000000001" }] } as never);
  const q2 = (await Q.get(QID))!;
  ok(F.cleanPackageFiles(q2.packageFiles).length === 3 && !q2.clientResponses, "#301 store (DB): update() can't overwrite or plant either list");
  const rm = await Q.removePackageFile(QID, file(1).id);
  const gone = await Q.removePackageFile(QID, file(1).id);
  ok(rm.ok && rm.file.id === file(1).id && !gone.ok && gone.reason === "missing" && F.cleanPackageFiles((await Q.get(QID))!.revisions!.find((r) => r.rev === 1)!.docFields?.packageFiles).length === 2,
    "#301 store (DB): remove returns the removed record; while revising the sent revision keeps its frozen list");
  const have = F.cleanPackageFiles((await Q.get(QID))!.packageFiles).length;
  const full = await Promise.all(Array.from({ length: 12 }, (_, i) => Q.addPackageFile(QID, file(100 + i))));
  ok(full.filter((w) => !w.ok && w.reason === "full").length === have && F.cleanPackageFiles((await Q.get(QID))!.packageFiles).length === 12,
    "#301 store (DB): the 12 cap holds under concurrent adds (row lock)");
  // ---- responses ----
  const clean = { kind: "accept" as const, name: "Pat", email: "", message: "", sectionIds: ["s1"], sectionNames: ["Stage lighting"], total: 20 };
  const draftTry = await Q.appendClientResponse(QID, 1, clean, Date.now(), "CR-00000000000a");
  await Q.update(QID, { status: "sent" });
  const okTry = await Q.appendClientResponse(QID, 1, clean, Date.now(), "CR-00000000000b");
  const after = (await Q.get(QID))!;
  ok(!draftTry.ok && draftTry.reason === "state" && okTry.ok && okTry.response.rev === 1 && after.status === "sent" && after.clientResponses?.length === 1,
    "#301 store (DB): a response is refused while revising, appended on the latest sent revision of a sent quote, and the status never changes");
  await Q.addQuoteRevision(QID, { by: "Test", reason: "sent" }); // rev 2 supersedes rev 1
  const old = await Q.appendClientResponse(QID, 1, clean, Date.now(), "CR-00000000000c");
  const unknown = await Q.appendClientResponse("Q-NOPE-301C", 1, clean, Date.now(), "CR-00000000000d");
  await Q.update(QID, { status: "won" });
  const won = await Q.appendClientResponse(QID, 2, clean, Date.now(), "CR-00000000000e");
  ok(!old.ok && old.reason === "state" && !unknown.ok && unknown.reason === "gone" && !won.ok && won.reason === "state",
    "#301 store (DB): a superseded revision, an unknown quote and a won quote take no response");
}
```

  Then add `.then(() => estimateOutput301CAsyncChecks())` right after the `.then(() => estimateOutput301BAsyncChecks())`
  line of the chain.

- [ ] **Step 2: Run it to verify it fails** (`Q.addPackageFile is not a function`; the source checks fail).

- [ ] **Step 3: `src/lib/stores/quotes.ts` — imports.** Beside the existing imports add:

```ts
import { appendPackageFile, cleanPackageFiles, type PackageFile } from "@/lib/estimate-output/package-files";
import { appendResponseTo, type CleanResponse, type ClientResponse } from "@/lib/estimate-output/responses";
import { onlineEstimateState } from "@/lib/quote-share/view";
```

  (`view.ts` imports `quotes.ts` for types only, so there is no runtime cycle. `responses.ts` reaches `estimator/pricing.ts`,
  which imports nothing from `stores/`.)

- [ ] **Step 4: The fields.** In `Quote`, after Slice B's `shareOpens?: ShareOpens | null;` add:

```ts
  /** #301 slice C (D-j, R13) — drawings shown under "Plans & risers" on the
   *  package page. Written only by addPackageFile / removePackageFile under
   *  the row lock (update() drops it); frozen into every new revision's
   *  docFields and annexed onto the latest sent revision while the online
   *  state is ok. Not content: attaching one never stales the estimate PDF.
   *  `blobPath` never leaves the server (the page links /share/.../file/<id>). */
  packageFiles?: PackageFile[] | null;
  /** #301 slice C (D-m) — client scope selections and questions from the
   *  package page, append-only, ≤ 200. Written only by appendClientResponse;
   *  update() drops it; never content, never snapshotted. Staff-only. */
  clientResponses?: ClientResponse[] | null;
```

  In `QuoteRevisionDocFields`, after `notIncluded?: string | null;` add:

```ts
  /** #301 slice C — the drawings as sent (and as annexed while this was the
   *  latest sent revision, R13). Absent on older revisions = none. */
  packageFiles?: PackageFile[];
```

- [ ] **Step 5: `update()`.** After Slice B's `delete clean.shareOpens;` add:

```ts
    // #301 slice C: the drawings list and the client responses have their own writers.
    delete clean.packageFiles;
    delete clean.clientResponses;
```

- [ ] **Step 6: `revisionDocFields()`.** After `notIncluded: typeof d.notIncluded === "string" ? d.notIncluded : null,` add:

```ts
    packageFiles: cleanPackageFiles(d.packageFiles),
```

- [ ] **Step 7: The writers.** Append after Slice B's `recordShareOpen`:

```ts
/** #301 slice C (R13) — mirror the drawings list onto the latest SENT
 *  revision while the online state is ok (a recalled quote's new drawings
 *  wait for the next send). Never creates docFields on a revision cut
 *  before #293 (Slice C adaptation 12). Returns the annexed rev, or null. */
function annexPackageFiles(doc: Quote): number | null {
  const s = onlineEstimateState(doc);
  if (s.kind !== "ok") return null;
  const r = (doc.revisions || []).find((x) => x.rev === s.rev.rev);
  if (!r || !r.docFields) return null;
  r.docFields = { ...r.docFields, packageFiles: cleanPackageFiles(doc.packageFiles) };
  return r.rev;
}

export type PackageFileWrite =
  | { ok: true; quote: Quote; file: PackageFile; annexedRev: number | null }
  | { ok: false; reason: "gone" | "full" | "missing" };

/** #301 slice C — the ONLY adder to `Quote.packageFiles` (≤ 12). Row-locked;
 *  never bumps updatedAt (the drawing isn't the document). */
export async function addPackageFile(id: string, file: PackageFile): Promise<PackageFileWrite> {
  let reason: "full" | null = null;
  let annexedRev: number | null = null;
  const quote = await patchQuote(id, (doc) => {
    const next = appendPackageFile(doc.packageFiles, file);
    if (!next) {
      reason = "full";
      return;
    }
    doc.packageFiles = next;
    annexedRev = annexPackageFiles(doc);
  });
  if (!quote) return { ok: false, reason: "gone" };
  if (reason) return { ok: false, reason };
  return { ok: true, quote, file, annexedRev };
}

/** #301 slice C — the ONLY remover. The blob is the caller's to delete, and
 *  only when no revision still lists it (packageBlobReferenced). */
export async function removePackageFile(id: string, fileId: string): Promise<PackageFileWrite> {
  let removed: PackageFile | null = null;
  let annexedRev: number | null = null;
  const quote = await patchQuote(id, (doc) => {
    const cur = cleanPackageFiles(doc.packageFiles);
    removed = cur.find((f) => f.id === fileId) ?? null;
    if (!removed) return;
    doc.packageFiles = cur.filter((f) => f.id !== fileId);
    annexedRev = annexPackageFiles(doc);
  });
  if (!quote) return { ok: false, reason: "gone" };
  if (!removed) return { ok: false, reason: "missing" };
  return { ok: true, quote, file: removed, annexedRev };
}

export type ClientResponseWrite = { ok: true; response: ClientResponse } | { ok: false; reason: "gone" | "state" | "full" };

/**
 * #301 slice C (D-m) — the ONLY writer of `Quote.clientResponses`. Under the
 * row lock the pinned revision must still be the latest sent one and the
 * quote must be `sent` (canAct — a recall, a re-send, a win or a loss since
 * the page loaded refuses). Append-only, ≤ 200. Never changes status, never
 * bumps updatedAt.
 */
export async function appendClientResponse(id: string, pinnedRev: number, r: CleanResponse, now: number, newId: string): Promise<ClientResponseWrite> {
  let out: ClientResponseWrite = { ok: false, reason: "gone" };
  await patchQuote(id, (doc) => {
    const s = onlineEstimateState(doc);
    if (s.kind !== "ok" || s.rev.rev !== pinnedRev || doc.status !== "sent") {
      out = { ok: false, reason: "state" };
      return;
    }
    const response: ClientResponse = { ...r, id: newId, rev: pinnedRev, at: now };
    const next = appendResponseTo(doc.clientResponses, response);
    if (!next) {
      out = { ok: false, reason: "full" };
      return;
    }
    doc.clientResponses = next;
    out = { ok: true, response };
  });
  return out;
}
```

  `patchQuote` returns null for an unknown id and never runs the callback, so `out` stays `gone`. TypeScript narrows
  `reason` / `removed` / `out` to their initialisers because it can't see the callback's assignments (the
  `let refusal = null as string | null;` problem `links.ts` solves the same way). If tsc complains, widen with
  `null as "full" | null`, `null as PackageFile | null`, and `{ ok: false, reason: "gone" } as ClientResponseWrite`.

- [ ] **Step 8: Run the gates** (tsc 0; test:specs PASS = previous + 4 sync + 9 DB; every `#293t` store check and Slice A's
  `#301 fields` / Slice B's `#301 opens` checks still pass; eslint on `quotes.ts` no new findings).

- [ ] **Step 9: Commit.**

```bash
git add src/lib/stores/quotes.ts scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(quotes): #301 slice C — store-owned packageFiles (frozen + R13 annex) and clientResponses (latest sent rev only, status untouched)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 4: Scoped coverage, revision documents, datasheet route, per-key-product links

**Files:**
- Modify: `src/lib/stores/part-accessory-links.ts` (import line `:2`; append `accessoryLinksForAccessories`)
- Modify: `src/lib/part-docs/load.ts` (imports; append `loadScopedCoverage`)
- Create: `src/lib/estimate-output/package-docs-server.ts`, `src/lib/estimate-output/package-extras-model.ts`,
  `src/lib/estimate-output/package-extras.ts`, `src/components/estimate-output/package-extras.tsx`,
  `src/app/share/quote/[id]/[token]/package-slots.tsx`, `src/app/share/quote/[id]/[token]/doc/[docId]/route.ts`
- Modify: `src/lib/quote-share/links.ts` (constants beside `SHARE_PHOTO_PER_MIN`),
  `src/app/share/quote/[id]/[token]/package-page.tsx`, `scripts/smoke-routes.ts`
- Modify (adaptation 8): the one Slice B check that holds `<PackageView model={model} slots={{}} />`
- Test: harness block `#301 slice C — documents`; `e301cDocsAsyncChecks`

**Interfaces:**
- **Consumes:** `documentLinksForParts`, `getDocuments` (`stores/part-documents`); `listDocsByField` (`@/db/doc-store`);
  `buildCoverageIndex`, `CoverageIndex`, `CoveragePartInput` (`part-docs/coverage`); `resolvePackageDocs`,
  `PackageDocument`, `PackageSkuDocs` (`part-docs/package`); `quoteBom` (`client-package-server`); `internalSkuCheck`
  (`design/grid-virtual-parts`); `getMany` (`stores/catalog`); `listFixtures`; `isDocumentId`; Slice B
  `resolveSharedPackage`, `SharedPackage`, `isShareTokenV2`, `PackageSlots`; Task 2 `ResponseScope` (type).
- **Produces** (Tasks 5–8):
  - `accessoryLinksForAccessories(skus: readonly string[]): Promise<PartAccessoryLink[]>`;
    `loadScopedCoverage(parts: ReadonlyArray<CoveragePartInput>): Promise<CoverageIndex>`.
  - `package-docs-server.ts`: `type RevisionPackageDocs = { bom; parts: CatalogPart[]; index: CoverageIndex; bySku: Map<string, PackageSkuDocs>; documents: PackageDocument[] }`;
    `specPackageDocs(spec: unknown)`, `revisionPackageDocs(rev: Pick<QuoteRevision, "spec">)`,
    `packageDocForRevision(rev, docId): Promise<PartDocument | null>`, `datasheetGapCount(spec: unknown): Promise<number>`.
  - `package-extras-model.ts`: `DatasheetLinkView = { href; name }`;
    `PackageDownloadsView = { zipHref: string; files: Array<{ href: string; name: string; kindLabel: string }>; specifications: boolean }`;
    `PackagePlanView = { href; name; kindLabel; sizeLabel; isImage: boolean }`; `PackageActionsView = { scopes: ResponseScope[] }`;
    `PackageExtras = { datasheets: Record<string, DatasheetLinkView>; downloads: PackageDownloadsView | null; plans: PackagePlanView[]; actions: PackageActionsView | null }`;
    `EMPTY_EXTRAS`; `packageDocHref(base, docId)`; `datasheetLinks(bySku, base)`.
  - `loadPackageExtras(hit: SharedPackage, base: string): Promise<PackageExtras>` (never throws).
  - `DatasheetLink({ link })`; `buildPackageSlots(x: PackageExtras): PackageSlots`.
  - `links.ts`: `SHARE_DOC_PER_MIN = 120`, `SHARE_FILE_PER_MIN = 120`, `SHARE_ZIP_PER_WINDOW = 6`, `SHARE_ZIP_WINDOW_MS = 600_000`.
  - `GET /share/quote/[id]/<v2>/doc/[docId]`.

- [ ] **Step 1: Write the failing harness block.** Append:

```ts
/* ======================================================================
   #301 slice C — documents: the scoped coverage loader (same answer as
   the full index, no table scan), the revision's package documents, the
   datasheet route (v2 only, blob-backed datasheet / spec sheet of the
   pinned revision, attachment, nosniff, 120/min/IP), and the
   per-key-product Datasheet link in the page's mount point.
   ====================================================================== */
import { datasheetLinks as e301cdLinks, EMPTY_EXTRAS as e301cdEmpty } from "@/lib/estimate-output/package-extras-model";
import { DatasheetLink as E301cdLink } from "@/components/estimate-output/package-extras";
import { createElement as e301cdEl } from "react";
import { renderToStaticMarkup as e301cdRender } from "react-dom/server";
{
  const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const links = e301cdLinks(new Map([["SKU-1", { datasheet: { documentId: "PD-1", name: "ColorSource.pdf" } }], ["SKU-2", { datasheet: null }]]), "/share/quote/Q-1/t");
  ok(JSON.stringify(links) === JSON.stringify({ "SKU-1": { href: "/share/quote/Q-1/t/doc/PD-1", name: "ColorSource.pdf" } }) &&
     e301cdEmpty.downloads === null && e301cdEmpty.plans.length === 0 && e301cdEmpty.actions === null,
    "#301 docs: a key product's datasheet link is the scoped doc route; parts without one get none");
  const html = e301cdRender(e301cdEl(E301cdLink, { link: { href: "/share/quote/Q-1/t/doc/PD-1", name: "ColorSource.pdf" } }));
  ok(html.includes('href="/share/quote/Q-1/t/doc/PD-1"') && html.includes("Datasheet — ColorSource.pdf") && html.includes("download"), "#301 docs: the link reads \"Datasheet — <file>\" and downloads");
  const route = rd("src/app/share/quote/[id]/[token]/doc/[docId]/route.ts");
  ok(route.indexOf("rateLimit(") < route.indexOf("isShareTokenV2(token)") && route.indexOf("isShareTokenV2(token)") < route.indexOf("resolveSharedPackage(") &&
     route.indexOf("resolveSharedPackage(") < route.indexOf("packageDocForRevision(pkg.rev, docId)") &&
     route.includes('rateLimit("share-doc:" + (clientIp(req) || "unknown"), SHARE_DOC_PER_MIN, 60_000)') && route.includes("attachmentDisposition(doc.fileName)") &&
     route.includes('"x-content-type-options": "nosniff"') && !route.includes("quoteAsOfRevision") && !/\b(update|patchQuote|setStatus)\(/.test(route),
    "#301 docs: the route rate-limits first, takes only a v2 token, serves only the pinned revision's documents, as an attachment; read-only");
  const srv = rd("src/lib/estimate-output/package-docs-server.ts");
  ok(srv.includes("loadScopedCoverage(parts)") && !srv.includes("listCatalog") && !srv.includes("loadPartDocsState") && srv.includes("quoteBom(src, rackOf, internalSkuCheck(parts0))"),
    "#301 docs: the revision's documents use the scoped loader and the client package's BOM rule — never the whole catalog");
  const load = rd("src/lib/part-docs/load.ts");
  const scoped = load.slice(load.indexOf("export async function loadScopedCoverage("));
  ok(scoped.includes("documentLinksForParts(skus)") && scoped.includes("accessoryLinksForAccessories(skus)") && !scoped.includes("backfillLegacyDatasheets") && !scoped.includes("allDocuments("),
    "#301 docs: scoped coverage reads three filtered queries and never backfills (a public read never writes)");
  const pp = rd("src/app/share/quote/[id]/[token]/package-page.tsx");
  ok(pp.includes("loadPackageExtras(hit, base)") && pp.includes("<PackageView model={model} slots={slots} />") && !pp.includes("slots={{}}"),
    "#301 docs: the package page fills the Slice B mount points");
  ok(rd("src/lib/estimate-output/package-extras.ts").includes("catch (e)") && !/^import (?!type)[^\n]*from "(?!\.\/package-files"|@\/lib\/document-files")/m.test(rd("src/lib/estimate-output/package-extras-model.ts")),
    "#301 docs: extras never fail the page; the view model is pure");
  const smoke = rd("scripts/smoke-routes.ts");
  ok(smoke.includes(`{ route: "/share/quote/Q-2041/1.1.${"A".repeat(43)}/doc/PD-1", expectNotFound: true }`), "#301 smoke: the datasheet route with a bad v2 token is a clean 404");
}

async function e301cDocsAsyncChecks(): Promise<void> {
  const { fixtureId } = await import("./test-fixtures");
  const C = await import("@/lib/stores/catalog");
  const D = await import("@/lib/stores/part-documents");
  const A = await import("@/lib/stores/part-accessory-links");
  const Q = await import("@/lib/stores/quotes");
  const { loadScopedCoverage, loadPartDocsState } = await import("@/lib/part-docs/load");
  const { resolvePackageDocs } = await import("@/lib/part-docs/package");
  const S = await import("@/lib/estimate-output/package-docs-server");
  const [P, ACC, X, Y] = ["fix", "acc", "x", "y"].map((s) => fixtureId(301, "c-doc-" + s));
  for (const sku of [P, ACC, X, Y]) {
    await C.upsert({ sku, desc: "Part " + sku, category: "Other", unit: "ea", list: 10, cost: 5 });
    registerFixture("catalog_parts", sku);
  }
  const mk = async (kind: "datasheet" | "specsheet" | "image", fileName: string, contentType: string) => {
    const d = await D.createDocument({ kind, fileName, contentType, size: 1000, blobKey: `part-docs/PD-fixture-301c/${fileName}`, sourceUrl: null, source: "upload", by: "Test" });
    if (!d) throw new Error("#301c docs: fixture document failed");
    registerFixture("part_documents", d.id);
    return d;
  };
  const ds = await mk("datasheet", "fixture-301c.pdf", "application/pdf");
  const ss = await mk("specsheet", "x-301c.pdf", "application/pdf");
  const img = await mk("image", "x-301c.png", "image/png");
  for (const [doc, sku] of [[ds, P], [ss, X], [img, X]] as const) {
    await D.attachDocument(doc.id, [sku], "Test");
    registerFixture("part_document_links", D.documentLinkId(sku, doc.id));
  }
  const ref = fixtureId(301, "c-doc-scope");
  await A.syncAccessoryLinks({ source: "manual", sourceRef: ref }, [{ parentSku: P, accessorySku: ACC }]);
  registerFixture("part_accessory_links", A.accessoryLinkId("manual", ref, P, ACC));
  const parts = await C.getMany([P, ACC, X, Y]);
  const ctx = [P, ACC, X, Y];
  const scoped = resolvePackageDocs(await loadScopedCoverage(parts), ctx);
  const full = resolvePackageDocs((await loadPartDocsState(parts)).index, ctx);
  const shape = (r: typeof scoped) => JSON.stringify({ by: [...r.bySku.entries()].sort(), docs: r.documents.map((d) => ({ ...d, skus: [...d.skus].sort() })).sort((a, b) => a.documentId.localeCompare(b.documentId)) });
  ok(shape(scoped) === shape(full) && scoped.bySku.get(ACC)?.datasheet?.documentId === ds.id, "#301 docs (DB): the scoped coverage gives the full index's answer (the accessory is covered by its fixture's datasheet)");
  const QID = fixtureId(301, "c-docs");
  const line = (id: number, sku: string) => ({ id, sku, desc: sku, qty: 1, unit: "ea", cost: 1, price: 2 });
  await Q.create({ id: QID, name: "#301c docs", customer: "Spec fixture", owner: "spec", quoteType: "system", source: "estimator",
    spec: { sections: [{ id: "s1", name: "Lighting", kind: "materials", mfr: "", freightPct: 0, items: [line(1, P), line(2, ACC), line(3, X), line(4, Y)] }], mobs: [] } });
  registerFixture("quotes", QID);
  await Q.update(QID, { status: "sent" });
  const rev = (await Q.addQuoteRevision(QID, { by: "Test", reason: "sent" }))!;
  const docs = await S.revisionPackageDocs(rev);
  ok(docs.documents.map((d) => d.documentId).sort().join() === [ds.id, ss.id].sort().join() && docs.bySku.get(ACC)?.datasheet?.documentId === ds.id,
    "#301 docs (DB): a revision's package documents are its datasheets and spec sheets (images never)");
  ok((await S.packageDocForRevision(rev, ds.id))?.id === ds.id && (await S.packageDocForRevision(rev, ss.id))?.id === ss.id &&
     (await S.packageDocForRevision(rev, img.id)) === null && (await S.packageDocForRevision(rev, "PD-NOPE-301C")) === null && (await S.packageDocForRevision(rev, "../x")) === null,
    "#301 docs (DB): the route serves only the revision's datasheets / spec sheets");
  ok((await S.datasheetGapCount(rev.spec)) === 2, "#301 docs (DB): the gap count — X (spec sheet only) and Y (nothing) have no datasheet; the accessory is covered");
}
```

  Append `await e301cDocsAsyncChecks();` to `estimateOutput301CAsyncChecks`'s body.

  `createDocument`'s input (`NewPartDocument`, `stores/part-documents.ts:67`), `attachDocument`, `documentLinkId`,
  `syncAccessoryLinks` and `accessoryLinkId` are the real exports used by the #293 / #207 fixtures. If a field name differs
  (e.g. `by` vs `uploadedBy`), use the real one.

- [ ] **Step 2: Adaptation 8 — re-point the one Slice B mount pin.** In `scripts/test-review-and-spec.ts`, in the Slice B
  `#301 slice B — page + loader` block, change `pp.includes("<PackageView model={model} slots={{}} />")` to
  `pp.includes("<PackageView model={model} slots={slots} />")`. It is the only Slice B check that names the empty mount
  (the `#301 slice B — opens` block checks only that `<PackageView` comes before `<OpenBeacon`). No other Slice B check
  changes.

- [ ] **Step 3: Run it to verify it fails** (module not found `package-extras-model`).

- [ ] **Step 4: `src/lib/stores/part-accessory-links.ts`.** Add `listDocsByField` to the `@/db/doc-store` import and append:

```ts
/** #301 slice C — the live links whose ACCESSORY is one of `skus`, filtered
 *  in SQL: a per-request coverage read for one quote never lists the graph. */
export async function accessoryLinksForAccessories(skus: readonly string[]): Promise<PartAccessoryLink[]> {
  return listDocsByField<PartAccessoryLink>("part_accessory_links", "accessorySku", skus);
}
```

- [ ] **Step 5: `src/lib/part-docs/load.ts`.** Add imports:

```ts
import { accessoryLinksForAccessories } from "@/lib/stores/part-accessory-links";
import { documentLinksForParts, getDocuments } from "@/lib/stores/part-documents";
```

  (merge into the existing `@/lib/stores/part-documents` / `part-accessory-links` import lines) and append:

```ts
/**
 * #301 slice C — the coverage index for ONE quote's parts (Slice C
 * adaptation 1), from three filtered reads: those parts' document links,
 * those documents, and the accessory links whose accessory is one of them.
 * Coverage in a quote's context only follows parents that are on the same
 * quote, so `slotCoverage(index, sku, kind, context)` with `context` = these
 * skus answers exactly as the full index would. No legacy backfill: the
 * package routes are public reads and never write.
 */
export async function loadScopedCoverage(parts: ReadonlyArray<CoveragePartInput>): Promise<CoverageIndex> {
  const skus = [...new Set(parts.map((p) => p.sku).filter(Boolean))];
  if (!skus.length) return buildCoverageIndex({ documents: [], links: [], accessoryLinks: [], parts: [] });
  const [links, accessoryLinks] = await Promise.all([documentLinksForParts(skus), accessoryLinksForAccessories(skus)]);
  const documents = await getDocuments(links.map((l) => l.documentId));
  return buildCoverageIndex({ documents, links, accessoryLinks, parts: [...parts] });
}
```

  (`CoveragePartInput`, `CoverageIndex` and `buildCoverageIndex` are already imported in `load.ts`.)

- [ ] **Step 6: Create `src/lib/estimate-output/package-docs-server.ts`.**

```ts
import { quoteBom } from "@/lib/client-package-server";
import { internalSkuCheck } from "@/lib/design/grid-virtual-parts";
import type { FixtureRecord } from "@/lib/fixture-assemblies";
import type { CoverageIndex } from "@/lib/part-docs/coverage";
import { loadScopedCoverage } from "@/lib/part-docs/load";
import { resolvePackageDocs, type PackageDocument, type PackageSkuDocs } from "@/lib/part-docs/package";
import { isDocumentId, type PartDocument } from "@/lib/part-docs/types";
import { getMany, type CatalogPart } from "@/lib/stores/catalog";
import { listFixtures } from "@/lib/stores/fixtures";
import type { Quote, QuoteRevision } from "@/lib/stores/quotes";

/**
 * #301 slice C (D-l) — the documents an estimate package offers, for one
 * quote spec (a sent revision's for the client; the live quote's for the
 * staff gap chip). The staff client package's BOM rule (quoteBom: rack
 * lines expand into their members, labor / credit / zero-qty lines drop
 * out) and its coverage rule (resolvePackageDocs in the quote's own
 * context), over scoped reads only (Slice C adaptation 1). Server-only.
 */

export type RevisionPackageDocs = {
  bom: Array<{ sku: string; desc: string; qty: number }>;
  parts: CatalogPart[];
  index: CoverageIndex;
  bySku: Map<string, PackageSkuDocs>;
  documents: PackageDocument[];
};

function hasAssemblyLines(spec: unknown): boolean {
  const s = spec as { sections?: Array<{ items?: Array<{ rackId?: unknown; fixtureId?: unknown }> }> } | null | undefined;
  return (s?.sections || []).some((sec) => (sec?.items || []).some((it) => !!it?.rackId || !!it?.fixtureId));
}

export async function specPackageDocs(spec: unknown): Promise<RevisionPackageDocs> {
  const src = { spec } as Pick<Quote, "spec">;
  const fixtures = hasAssemblyLines(spec) ? new Map((await listFixtures()).map((f) => [f.id, f] as const)) : new Map<string, FixtureRecord>();
  const rackOf = (id: string) => fixtures.get(id);
  // Pass 1 lists every sku a rack expands to, so one getMany covers the
  // internal-row check pass 2 needs (labor members drop out, #296).
  const parts0 = await getMany(quoteBom(src, rackOf).map((r) => r.sku));
  const bom = quoteBom(src, rackOf, internalSkuCheck(parts0));
  const inBom = new Set(bom.map((r) => r.sku));
  const parts = parts0.filter((p) => inBom.has(p.sku));
  const index = await loadScopedCoverage(parts);
  const known = new Set(parts.map((p) => p.sku));
  const { bySku, documents } = resolvePackageDocs(index, bom.filter((r) => known.has(r.sku)).map((r) => r.sku));
  return { bom, parts, index, bySku, documents };
}

export function revisionPackageDocs(rev: Pick<QuoteRevision, "spec">): Promise<RevisionPackageDocs> {
  return specPackageDocs(rev.spec);
}

const SERVED_KINDS: ReadonlySet<string> = new Set(["datasheet", "specsheet"]);

/** The blob-backed datasheet / spec sheet `docId` IF this revision's package lists it; else null. */
export async function packageDocForRevision(rev: Pick<QuoteRevision, "spec">, docId: string): Promise<PartDocument | null> {
  if (!isDocumentId(docId)) return null;
  const d = await revisionPackageDocs(rev);
  if (!d.documents.some((x) => x.documentId === docId && SERVED_KINDS.has(x.kind))) return null;
  const doc = d.index.docsById.get(docId);
  return doc && doc.blobKey && SERVED_KINDS.has(doc.kind) ? doc : null;
}

/** Staff gap chip: catalog parts on this spec whose datasheet slot is not satisfied. */
export async function datasheetGapCount(spec: unknown): Promise<number> {
  const d = await specPackageDocs(spec);
  return [...d.bySku.values()].filter((x) => !x.datasheetOk).length;
}
```

- [ ] **Step 7: Create `src/lib/estimate-output/package-extras-model.ts`.**

```ts
import type { PackageSkuDocs } from "@/lib/part-docs/package";
import type { ResponseScope } from "./responses";

/**
 * #301 slice C — what fills the package page's Slice B mount points, as
 * plain view models (hrefs, names, labels — never a blob path, a gap or a
 * record). Pure and client-safe. Built server-side by package-extras.ts.
 */

export type DatasheetLinkView = { href: string; name: string };
export type PackageDownloadsView = { zipHref: string; files: Array<{ href: string; name: string; kindLabel: string }>; specifications: boolean };
export type PackagePlanView = { href: string; name: string; kindLabel: string; sizeLabel: string; isImage: boolean };
export type PackageActionsView = { scopes: ResponseScope[] };
export type PackageExtras = {
  /** key-product sku → its datasheet link (keyProductExtra). */
  datasheets: Record<string, DatasheetLinkView>;
  downloads: PackageDownloadsView | null;
  plans: PackagePlanView[];
  /** Present only when the page may act (canAct) — package-slots decides. */
  actions: PackageActionsView | null;
};

export const EMPTY_EXTRAS: PackageExtras = { datasheets: {}, downloads: null, plans: [], actions: null };

export function packageDocHref(base: string, docId: string): string {
  return `${base}/doc/${encodeURIComponent(docId)}`;
}

export function datasheetLinks(bySku: ReadonlyMap<string, Pick<PackageSkuDocs, "datasheet">>, base: string): Record<string, DatasheetLinkView> {
  const out: Record<string, DatasheetLinkView> = {};
  for (const [sku, d] of bySku) if (d.datasheet) out[sku] = { href: packageDocHref(base, d.datasheet.documentId), name: d.datasheet.name };
  return out;
}
```

- [ ] **Step 8: Create `src/lib/estimate-output/package-extras.ts`.**

```ts
import type { SharedPackage } from "@/lib/quote-share/links";
import { revisionPackageDocs } from "./package-docs-server";
import { datasheetLinks, EMPTY_EXTRAS, type PackageExtras } from "./package-extras-model";

/**
 * #301 slice C — the package page's extras for a resolved v2 link: the
 * pinned SENT revision's documents (datasheets per key product; Task 5
 * adds Downloads, Task 6 Plans & risers, Task 7 the client actions' scopes).
 * Server-only. Never throws — a failed read leaves that card out.
 */
export async function loadPackageExtras(hit: SharedPackage, base: string): Promise<PackageExtras> {
  const extras: PackageExtras = { ...EMPTY_EXTRAS, datasheets: {}, plans: [] };
  try {
    const docs = await revisionPackageDocs(hit.rev);
    extras.datasheets = datasheetLinks(docs.bySku, base);
  } catch (e) {
    console.warn("[package] documents unavailable", e instanceof Error ? e.message : e);
  }
  return extras;
}
```

- [ ] **Step 9: Create `src/components/estimate-output/package-extras.tsx`.**

```tsx
import type { CSSProperties } from "react";
import type { DatasheetLinkView } from "@/lib/estimate-output/package-extras-model";

/**
 * #301 slice C — the package page's extra cards (server components, pure
 * props). They render inside PackageView's mount points and use its
 * PACKAGE_WEB_CSS classes (pkg-card, pkg-p, pkg-muted, pkg-ul).
 */

export const PKG_LINK: CSSProperties = { color: "var(--accent)", fontWeight: 600, textDecoration: "none" };

export function DatasheetLink({ link }: { link: DatasheetLinkView }) {
  return (
    <p className="pkg-p pkg-muted" style={{ marginTop: 6 }}>
      <a href={link.href} download style={PKG_LINK}>
        {`Datasheet — ${link.name}`}
      </a>
    </p>
  );
}
```

- [ ] **Step 10: Create `src/app/share/quote/[id]/[token]/package-slots.tsx`.**

```tsx
import type { ReactNode } from "react";
import type { PackageSlots } from "@/components/estimate-output/package-view";
import { DatasheetLink } from "@/components/estimate-output/package-extras";
import type { PackageExtras } from "@/lib/estimate-output/package-extras-model";

/**
 * #301 slice C — fills PackageView's Slice B mount points from the loaded
 * extras. A server module (no "use client"). An empty part leaves its
 * mount point out, so the section never renders.
 */
export function buildPackageSlots(x: PackageExtras): PackageSlots {
  const keyProductExtra: Record<string, ReactNode> = {};
  for (const [sku, link] of Object.entries(x.datasheets)) keyProductExtra[sku] = <DatasheetLink link={link} />;
  return { keyProductExtra };
}
```

- [ ] **Step 11: `package-page.tsx`.** Add imports:

```tsx
import { loadPackageExtras } from "@/lib/estimate-output/package-extras";
import { buildPackageSlots } from "./package-slots";
```

  Replace the body of `SharedPackagePage` (Slice B Task 8's version) with:

```tsx
  const hit = await resolveSharedPackage(id, token);
  const base = hit ? sharePath(hit.q.id, token) : "";
  const model = hit ? await loadPackageViewProps(hit, { base, view, letterheadSrc: letterhead.src }) : null;
  if (!hit || !model) return <OnlineEstimateCard title={ONLINE_COPY.shareInactive} />;
  const slots = buildPackageSlots(await loadPackageExtras(hit, base));
  return (
    <>
      <PackageView model={model} slots={slots} />
      <OpenBeacon id={hit.q.id} token={token} />
    </>
  );
```

  and change the doc comment's "Slice C mounts: `slots` stays `{}` until …" paragraph to "Slice C: the mount points are
  filled by buildPackageSlots(loadPackageExtras(…)) — datasheet links, Downloads, Plans & risers, client actions (gated on
  canAct)."

- [ ] **Step 12: `links.ts` constants.** After `export const SHARE_PHOTO_PER_MIN = 300;` add:

```ts
/** #301 slice C — the package page's downloads (spec §6, R10). */
export const SHARE_DOC_PER_MIN = 120;
export const SHARE_FILE_PER_MIN = 120;
export const SHARE_ZIP_PER_WINDOW = 6;
export const SHARE_ZIP_WINDOW_MS = 10 * 60_000;
```

- [ ] **Step 13: Create `src/app/share/quote/[id]/[token]/doc/[docId]/route.ts`.**

```ts
import { getBlobStream } from "@/lib/blob";
import { attachmentDisposition } from "@/lib/document-files";
import { packageDocForRevision } from "@/lib/estimate-output/package-docs-server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { resolveSharedPackage, SHARE_DOC_PER_MIN } from "@/lib/quote-share/links";
import { isShareTokenV2 } from "@/lib/quote-share/token";

export const dynamic = "force-dynamic";

/** A fresh Response per call — a body can be read only once. */
const notFound = () => new Response("Not found", { status: 404 });

/**
 * #301 slice C (spec §6) — one datasheet or spec sheet from the package
 * page. Per-IP rate limit first; a v2 token only; the document must be a
 * blob-backed datasheet / spec sheet the PINNED revision's package lists
 * (any visible state — it was sent). Attachment, nosniff. Read-only.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; token: string; docId: string }> }) {
  const { id, token, docId } = await ctx.params;
  if (!rateLimit("share-doc:" + (clientIp(req) || "unknown"), SHARE_DOC_PER_MIN, 60_000).ok) return new Response("Too many requests", { status: 429 });
  if (!isShareTokenV2(token)) return notFound();
  const pkg = await resolveSharedPackage(id, token);
  if (!pkg) return notFound();
  const doc = await packageDocForRevision(pkg.rev, docId);
  if (!doc || !doc.blobKey) return notFound();
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
      "content-type": doc.contentType || "application/octet-stream",
      "content-disposition": attachmentDisposition(doc.fileName),
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=300",
    },
  });
}
```

- [ ] **Step 14: Smoke.** In `scripts/smoke-routes.ts` `DYNAMIC_ROUTES`, after Slice B's v2 photo entry, add:

```ts
  // #301 slice C — the package datasheet route with a v2 token that fails the verify: a clean 404.
  { route: "/share/quote/Q-2041/1.1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/doc/PD-1", expectNotFound: true },
```

  (43 `A`s.)

- [ ] **Step 15: Run the gates.** tsc 0; test:specs PASS = previous + 8 sync + 4 DB, every Slice B check still passing (with
  the one re-pointed pin); eslint on the modified + new src files; `rm -rf .next && … next build` OK.

- [ ] **Step 16: Commit.**

```bash
git add src/lib/stores/part-accessory-links.ts src/lib/part-docs/load.ts src/lib/estimate-output/package-docs-server.ts \
  src/lib/estimate-output/package-extras-model.ts src/lib/estimate-output/package-extras.ts src/components/estimate-output/package-extras.tsx \
  "src/app/share/quote/[id]/[token]/package-slots.tsx" "src/app/share/quote/[id]/[token]/package-page.tsx" \
  "src/app/share/quote/[id]/[token]/doc/[docId]/route.ts" src/lib/quote-share/links.ts scripts/smoke-routes.ts scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(share): #301 slice C — package datasheets: scoped coverage, the revision's documents, doc route, a Datasheet link per key product

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Package zip — `quoteSpecParts`, the builder, the Blob cache, the route, Downloads

**Files:**
- Modify: `src/lib/client-package-server.ts` (`createQuoteClientPackage` middle → `quoteSpecParts`; new export)
- Modify: `src/lib/blob.ts` (`putBlobAt`), `src/lib/zip.ts` (`zipStream`), `src/lib/rack/submittal-server.ts:145`
  (`export async function readCapped`)
- Create: `src/lib/estimate-output/package-zip.ts`, `src/lib/estimate-output/package-zip-server.ts`,
  `src/app/share/quote/[id]/[token]/package.zip/route.ts`
- Modify: `package-extras-model.ts` (`downloadsView`, `downloadsSummary`), `package-extras.ts` (downloads),
  `components/estimate-output/package-extras.tsx` (`PackageDownloads`), `package-slots.tsx` (downloads), `scripts/smoke-routes.ts`
- Test: harness block `#301 slice C — zip`; `e301cZipAsyncChecks`

**Interfaces:**
- **Consumes:** Task 4 (`revisionPackageDocs`, `RevisionPackageDocs`, `PackageDownloadsView`); `matchBom`, `assemble`,
  `SpecCatalogPart`, `AssembledSpec` (`bid-spec`); `buildSpecDocx`; `allSections`; `packageEntryName`; `safeName`;
  `createStoredZip`; `CutSheetDeadlineError` (`curtain-cut-sheets/deadline`); `hasPrintableSpec` (`specs/articles`);
  `sentDocumentStamp`; `displayQuoteNumber`; `attachmentDisposition`; Slice B `SharedPackage`.
- **Produces** (Task 8):
  - `quoteSpecParts(input: { quote: Pick<Quote, "id" | "name" | "customer">; bom; catalog: SpecCatalogPart[]; docIndex: CoverageIndex; sections; by: string; date: number })`
    → `{ matched; spec: AssembledSpec; packageDocs; items; gaps: ClientPackageGap[]; covered }`.
  - `putBlobAt(pathname, bytes, contentType): Promise<{ url; pathname }>`; `zipStream(buf: Buffer): ReadableStream<Uint8Array>`;
    `readCapped` exported.
  - `package-zip.ts`: `PACKAGE_ZIP_DOC_MAX_BYTES`, `PACKAGE_ZIP_TOTAL_MAX_BYTES`, `PACKAGE_ZIP_DEADLINE_MS = 45_000`,
    `PACKAGE_ZIP_CACHE_PREFIX = "estimate-package/"`, `SPEC_DOCX_NAME = "Specifications.docx"`, `LEFT_OUT_NAME = "LEFT OUT.txt"`,
    `LEFT_OUT_REASON`, `type LeftOut = { name: string; reason: string }`, `packageZipCacheDir(quoteId)`,
    `packageZipCachePath(quoteId, rev)`, `packageZipFileName(number, revNo)`, `leftOutText(rows)`, `zipCacheable(rows)`,
    `packageZipCacheOn(env, blobOn)`, `NOTHING_TO_DOWNLOAD`.
  - `package-zip-server.ts`: `type BuiltPackageZip`; `buildRevisionPackageZip(q, rev, deps?)`;
    `servePackageZip(pkg, deps?): Promise<Response>`; `clearPackageZipCache(quoteId): Promise<number>`.
  - `downloadsView(documents, specifications, base)`, `downloadsSummary(view)`, `PackageDownloads({ view })`.
  - `GET /share/quote/[id]/<v2>/package.zip`.

- [ ] **Step 1: Write the failing harness block.** Append:

```ts
/* ======================================================================
   #301 slice C — zip (R10): datasheets + spec sheets + Specifications.docx
   built in memory with the rack caps (25 MB / doc, 60 MB total, 45 s) and
   a LEFT OUT.txt; cached in private Blob per (quote, rev) on the first
   download, streamed after; 6 / 10 min / IP. quoteSpecParts is the staff
   client package's own spec step, extracted with no behavior change.
   ====================================================================== */
import {
  packageZipCachePath as e301czPath, packageZipFileName as e301czName, leftOutText as e301czLeftOut, zipCacheable as e301czCacheable,
  packageZipCacheOn as e301czCacheOn, LEFT_OUT_REASON as e301czReason, PACKAGE_ZIP_DOC_MAX_BYTES as e301czDocMax, PACKAGE_ZIP_TOTAL_MAX_BYTES as e301czTotalMax,
  PACKAGE_ZIP_DEADLINE_MS as e301czDeadline,
} from "@/lib/estimate-output/package-zip";
import { quoteSpecParts as e301czSpecParts } from "@/lib/client-package-server";
import { buildCoverageIndex as e301czIndex } from "@/lib/part-docs/coverage";
import { downloadsView as e301czView, downloadsSummary as e301czSummary } from "@/lib/estimate-output/package-extras-model";
import { PackageDownloads as E301czDownloads } from "@/components/estimate-output/package-extras";
import { createElement as createElement301cz } from "react";
import { renderToStaticMarkup as renderToStaticMarkup301cz } from "react-dom/server";
{
  const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  ok(e301czPath("Q-2041", 3) === "estimate-package/Q-2041/rev-3.zip" && e301czPath("Q 1/x", 1) === "estimate-package/Q_1_x/rev-1.zip" &&
     e301czName("EST-1042", 2) === "EST-1042 Rev 2 package.zip" && e301czDocMax === 25 * 1024 * 1024 && e301czTotalMax === 60 * 1024 * 1024 && e301czDeadline === 45_000,
    "#301 zip: the cache path per (quote, rev), the download name, the rack caps");
  const lo = e301czLeftOut([{ name: "datasheets/Big.pdf", reason: e301czReason.tooBig }]);
  ok(lo.includes("datasheets/Big.pdf — Left out — package size limit") && lo.endsWith("\r\n") && e301czReason.late === "Left out — ran out of time",
    "#301 zip: LEFT OUT.txt names each file and why");
  ok(e301czCacheable([]) && e301czCacheable([{ name: "a", reason: e301czReason.tooBig }]) && !e301czCacheable([{ name: "a", reason: e301czReason.late }]) &&
     !e301czCacheable([{ name: "a", reason: e301czReason.unreadable }]) && !e301czCacheable([{ name: "a", reason: e301czReason.missing }]),
    "#301 zip: only a complete build (or one cut only by the size cap) is cached — a timeout is never frozen");
  ok(e301czCacheOn({ NODE_ENV: "production" }, true) && !e301czCacheOn({ NODE_ENV: "production" }, false) && !e301czCacheOn({ NODE_ENV: "development" }, true) &&
     e301czCacheOn({ NODE_ENV: "development", ESTIMATE_PACKAGE_CACHE: "1" }, true),
    "#301 zip: no cache without Blob, and none under next dev unless ESTIMATE_PACKAGE_CACHE=1 (a scratch DB reuses real quote ids)");
  // quoteSpecParts (pure): a ready part assembles; a part with no spec and an unknown sku are gaps.
  const cat = [
    { id: "R", sku: "R", desc: "Ready part", category: "Other", unit: "ea", list: 1, cost: 1, specSectionId: "ss-1", specBody: "Provide the fixture." },
    { id: "N", sku: "N", desc: "No spec", category: "Other", unit: "ea", list: 1, cost: 1 },
  ] as never[];
  const sp = e301czSpecParts({ quote: { id: "Q-1", name: "Hall", customer: "C" }, bom: [{ sku: "R", desc: "Ready", qty: 2 }, { sku: "N", desc: "No spec", qty: 1 }, { sku: "Z", desc: "Unknown", qty: 1 }],
    catalog: cat, docIndex: e301czIndex({ documents: [], links: [], accessoryLinks: [], parts: [] }), sections: [{ id: "ss-1", number: "11 61 23", title: "Lighting", sort: 1, part1: [], part3: [] }] as never[], by: "T", date: 1 });
  ok(sp.spec.sections.length === 1 && sp.spec.engagementId === "quote:Q-1" && sp.gaps.map((g) => `${g.kind}:${g.sku}`).sort().join() === "missing-catalog:Z,missing-datasheet:N,missing-datasheet:R,missing-spec:N" && sp.items.length === 3,
    "#301 zip: quoteSpecParts assembles the ready rows and reports the same gaps the client package did");
  const cps = rd("src/lib/client-package-server.ts");
  const qcp = cps.slice(cps.indexOf("export async function createQuoteClientPackage("));
  ok(qcp.includes("quoteSpecParts({ quote, bom, catalog, docIndex, sections: await allSections(), by, date: Date.now() })") &&
     qcp.indexOf("const bom = quoteBom(quote, (id) => rackFixtures.get(id), internalSkuCheck(catalog));") < qcp.indexOf("quoteSpecParts("),
    "#301 zip: the staff quote package builds its spec through quoteSpecParts (the #296 BOM line unchanged)");
  ok(/addRandomSuffix: false,\s*allowOverwrite: true/.test(rd("src/lib/blob.ts")) && rd("src/lib/rack/submittal-server.ts").includes("export async function readCapped("),
    "#301 zip: putBlobAt writes a fixed path; readCapped is shared with the rack submittal");
  const route = rd("src/app/share/quote/[id]/[token]/package.zip/route.ts");
  ok(route.indexOf("rateLimit(") < route.indexOf("isShareTokenV2(token)") && route.indexOf("isShareTokenV2(token)") < route.indexOf("resolveSharedPackage(") &&
     route.indexOf("resolveSharedPackage(") < route.indexOf("servePackageZip(pkg)") && route.includes("SHARE_ZIP_PER_WINDOW, SHARE_ZIP_WINDOW_MS") &&
     route.includes("export const maxDuration = 60;"),
    "#301 zip: the route rate-limits (6 / 10 min / IP), takes only a v2 token, then serves the pinned revision's zip");
  const srv = rd("src/lib/estimate-output/package-zip-server.ts");
  ok(srv.includes("readCapped(") && srv.includes("packageEntryName(") && srv.includes("buildSpecDocx(sp.spec)") && srv.includes("zipCacheable(built.leftOut)") &&
     !srv.includes("listCatalog") && !/\b(update|patchQuote|setStatus)\(/.test(srv),
    "#301 zip: capped reads, unique entry names, the D94 docx, cache only a clean build; never the whole catalog, never a quote write");
  const v = e301czView([{ documentId: "PD-1", name: "A.pdf", kind: "datasheet", skus: ["A"] }, { documentId: "PD-2", name: "B.docx", kind: "specsheet", skus: ["B"] }, { documentId: "PD-3", name: "M.pdf", kind: "manual", skus: ["C"] }], true, "/b");
  ok(!!v && v.zipHref === "/b/package.zip" && v.files.map((f) => `${f.kindLabel}:${f.href}`).join() === "Datasheet:/b/doc/PD-1,Spec sheet:/b/doc/PD-2" &&
     e301czSummary(v) === "1 datasheet · 1 spec sheet · Specifications (Word)" && e301czView([], false, "/b") === null && e301czView([], true, "/b")?.files.length === 0,
    "#301 zip: Downloads lists datasheets and spec sheets (never manuals); nothing to offer → no card");
  const html = renderToStaticMarkup301cz(createElement301cz(E301czDownloads, { view: v! }));
  ok(html.includes(">Downloads<") && html.includes('href="/b/package.zip"') && html.includes("Download all (.zip)") && html.includes("Individual files (2)") && !html.includes("part-docs/"),
    "#301 zip: the Downloads card — one zip button, the individual files, no storage path");
  const smoke = rd("scripts/smoke-routes.ts");
  ok(smoke.includes(`{ route: "/share/quote/Q-2041/1.1.${"A".repeat(43)}/package.zip", expectNotFound: true }`), "#301 smoke: the zip with a bad v2 token is a clean 404");
}

async function e301cZipAsyncChecks(): Promise<void> {
  const { fixtureId } = await import("./test-fixtures");
  const C = await import("@/lib/stores/catalog");
  const D = await import("@/lib/stores/part-documents");
  const Q = await import("@/lib/stores/quotes");
  const SS = await import("@/lib/stores/spec-sections");
  const Z = await import("@/lib/estimate-output/package-zip-server");
  const { LEFT_OUT_REASON } = await import("@/lib/estimate-output/package-zip");
  const { zipStream } = await import("@/lib/zip");
  const back = Buffer.from(await new Response(zipStream(Buffer.from("x".repeat(700_000)))).arrayBuffer());
  ok(back.length === 700_000, "#301 zip (stream): zipStream yields the whole buffer in chunks");
  const section = await SS.createSection({ number: "11 61 99", title: "#301c zip section", sort: 1, by: "Test" });
  registerFixture("spec_sections", section.id);
  const [P, BIG, BAD] = ["p", "big", "bad"].map((s) => fixtureId(301, "c-zip-" + s));
  for (const sku of [P, BIG, BAD]) {
    await C.upsert({ sku, desc: "Zip part " + sku, category: "Other", unit: "ea", list: 10, cost: 5 });
    registerFixture("catalog_parts", sku);
  }
  await C.mergeUpsert(P, { specSectionId: section.id, specBody: "Provide the #301c fixture." } as never);
  const mk = async (sku: string, fileName: string, size: number) => {
    const d = await D.createDocument({ kind: "datasheet", fileName, contentType: "application/pdf", size, blobKey: `part-docs/PD-fixture-301cz/${fileName}`, sourceUrl: null, source: "upload", by: "Test" });
    if (!d) throw new Error("#301c zip: fixture document failed");
    registerFixture("part_documents", d.id);
    await D.attachDocument(d.id, [sku], "Test");
    registerFixture("part_document_links", D.documentLinkId(sku, d.id));
    return d;
  };
  await mk(P, "ok-301c.pdf", 2_000);
  await mk(BIG, "big-301c.pdf", 26 * 1024 * 1024);
  await mk(BAD, "bad-301c.pdf", 1_000);
  const QID = fixtureId(301, "c-zip");
  const line = (id: number, sku: string) => ({ id, sku, desc: sku, qty: 1, unit: "ea", cost: 1, price: 2 });
  await Q.create({ id: QID, name: "#301c zip", customer: "Spec fixture", owner: "spec", quoteType: "system", source: "estimator",
    spec: { sections: [{ id: "s1", name: "Lighting", kind: "materials", mfr: "", freightPct: 0, items: [line(1, P), line(2, BIG), line(3, BAD)] }], mobs: [] } });
  registerFixture("quotes", QID);
  await Q.update(QID, { status: "sent" });
  const rev = (await Q.addQuoteRevision(QID, { by: "Test", reason: "sent" }))!;
  const q = (await Q.get(QID))!;
  const body = Buffer.from("%PDF-1.7 fixture-301c");
  const read = async (key: string) => {
    if (key.endsWith("bad-301c.pdf")) throw new Error("boom");
    return new Response(body).body;
  };
  const built = await Z.buildRevisionPackageZip(q, rev, { read, sections: async () => [section] });
  // Stored (uncompressed) entries: names and bytes appear as-is; LEFT OUT.txt is UTF-8 (its "—").
  const has = (text: string) => !!built && built.zip.includes(Buffer.from(text, "utf8"));
  ok(!!built && has("Specifications.docx") && has("datasheets/ok-301c.pdf") && has("%PDF-1.7 fixture-301c") && has("LEFT OUT.txt") &&
     has("datasheets/big-301c.pdf — " + LEFT_OUT_REASON.tooBig) && has("datasheets/bad-301c.pdf — " + LEFT_OUT_REASON.unreadable) && built.datasheets === 1 && built.specifications,
    "#301 zip (DB): Specifications.docx, the readable datasheet, and LEFT OUT.txt naming the oversize and unreadable ones");
  const late = await Z.buildRevisionPackageZip(q, rev, { read, sections: async () => [section], now: (() => { let t = 0; return () => (t += 50_000); })() });
  ok(!!late && late.leftOut.some((l) => l.reason === LEFT_OUT_REASON.late), "#301 zip (DB): past the 45 s deadline, the rest is left out as late");
  const pkg = { q, rev, state: { kind: "ok", rev, closed: false, won: false }, currentPath: null } as never;
  const puts: string[] = [];
  let builds = 0;
  let cached: Buffer | null = null;
  const deps = {
    cacheOn: true,
    get: async () => (cached ? new Response(cached).body : null),
    put: async (path: string, bytes: Buffer) => { puts.push(path); cached = bytes; },
    build: async () => { builds++; return { zip: Buffer.from("ZIP"), leftOut: [], datasheets: 1, specsheets: 0, specifications: false }; },
  };
  const r1 = await Z.servePackageZip(pkg, deps);
  const r2 = await Z.servePackageZip(pkg, deps);
  ok(r1.status === 200 && r2.status === 200 && builds === 1 && puts.join() === `estimate-package/${QID}/rev-${rev.rev}.zip` && (await r2.text()) === "ZIP" &&
     /attachment; filename="EST-\d+ Rev 1 package\.zip"/.test(r1.headers.get("content-disposition") || "") && r1.headers.get("content-type") === "application/zip",
    "#301 zip (serve): the first download builds and caches; the second streams the cache");
  const noCache = await Z.servePackageZip(pkg, { ...deps, get: async () => null, build: async () => ({ zip: Buffer.from("Z2"), leftOut: [{ name: "a", reason: LEFT_OUT_REASON.late }], datasheets: 0, specsheets: 0, specifications: false }) });
  const empty = await Z.servePackageZip(pkg, { ...deps, get: async () => null, build: async () => null });
  ok(noCache.status === 200 && puts.length === 1 && empty.status === 404 && (await empty.text()) === "Nothing to download for this estimate.",
    "#301 zip (serve): a timed-out build is served but not cached; nothing to include → 404");
}
```

  Append `await e301cZipAsyncChecks();` to `estimateOutput301CAsyncChecks`'s body. `createSection` normalizes
  `part2Style` / `quantities`; pass only what its signature requires.

- [ ] **Step 2: Run it to verify it fails.**

- [ ] **Step 3: Extract `quoteSpecParts` in `src/lib/client-package-server.ts`.** Add, above `createClientPackage`:

```ts
/**
 * #301 slice C — one quote BOM's spec, package documents, items and gaps,
 * from a given catalog slice and coverage index. No record, no zip, no
 * Blob. The staff quote package (below) and the estimate package's
 * Specifications.docx (estimate-output/package-zip-server.ts) both use it.
 * #207: the quote's own SKUs are the coverage context — an accessory rides
 * on a fixture only when that fixture is on this quote.
 */
export function quoteSpecParts(input: {
  quote: Pick<Quote, "id" | "name" | "customer">;
  bom: Array<{ sku: string; desc: string; qty: number }>;
  catalog: SpecCatalogPart[];
  docIndex: CoverageIndex;
  sections: Awaited<ReturnType<typeof allSections>>;
  by: string;
  date: number;
}) {
  const { quote, bom, catalog, docIndex } = input;
  const bySku = new Map(catalog.map((part) => [part.sku, part]));
  const matched = matchBom(bom, catalog);
  const spec = assemble(matched.rows, input.sections, {
    projectName: quote.name,
    customer: quote.customer,
    engagementId: `quote:${quote.id}`,
    preparedBy: input.by,
    date: input.date,
  });
  const packageDocs = resolvePackageDocs(docIndex, bom.filter((row) => bySku.has(row.sku)).map((row) => row.sku));
  const items = bom.map((row) => {
    const part = bySku.get(row.sku);
    const docs = packageDocs.bySku.get(row.sku);
    return {
      sku: row.sku,
      description: row.desc,
      qty: row.qty,
      catalogId: part?.id || null,
      datasheet: docs?.datasheet ?? null,
      datasheetCoveredBy: docs?.datasheetCoveredBy ?? [],
      specsheet: docs?.specsheet ?? null,
      manual: docs?.manual ?? null,
    };
  });
  const gaps: ClientPackageGap[] = matched.rows.filter((row) => row.bucket !== "ready").map((row) => ({ kind: row.bucket === "no-match" ? "missing-catalog" : "missing-spec", sku: row.row.sku, description: row.row.desc, qty: row.row.qty, catalogId: row.part?.id || null }));
  for (const item of items) {
    if (item.catalogId && !packageDocs.bySku.get(item.sku)?.datasheetOk) gaps.push({ kind: "missing-datasheet", sku: item.sku, description: item.description, qty: item.qty, catalogId: item.catalogId });
  }
  const covered = items.filter((item) => item.datasheetCoveredBy.length).map((item) => coveredNote(item.sku, item.datasheetCoveredBy));
  return { matched, spec, packageDocs, items, gaps, covered };
}
```

  In `createQuoteClientPackage`, delete `const bySku = new Map(catalog.map((part) => [part.sku, part]));` and replace the
  block from `const matched = matchBom(bom, catalog);` through `const covered = …;` (everything between the
  `const bom = quoteBom(…)` line and `const packageName = …`) with:

```ts
  const { spec, packageDocs, items, gaps, covered } = quoteSpecParts({ quote, bom, catalog, docIndex, sections: await allSections(), by, date: Date.now() });
```

  The rest of the builder is unchanged: it still reads `spec`, `packageDocs`, `items`, `gaps` (pushes into it) and
  `covered`, and still writes `buildSpecDocx({ ...spec, racks: rackRun.spec })`. Every `client-package-server.ts` pin in
  Global Constraints must still pass.

- [ ] **Step 4: `src/lib/blob.ts`.** After `putBlob` add:

```ts
/**
 * #301 slice C — write a private blob at an EXACT pathname, replacing any
 * earlier one (the estimate package's per-revision zip cache). Unlike
 * putBlob there is no random suffix, so a later read finds it by name.
 */
export async function putBlobAt(pathname: string, bytes: Buffer, contentType: string): Promise<{ url: string; pathname: string }> {
  const res = await put(pathname, bytes, {
    access: "private",
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return { url: res.url, pathname: res.pathname };
}
```

- [ ] **Step 5: `src/lib/zip.ts`.** Append:

```ts
const STREAM_CHUNK = 256 * 1024;

/** #301 slice C — a buffered zip as a stream of 256 KB slices (a buffered
 *  function response is capped around 4.5 MB on Vercel; real datasheets pass
 *  that). The rack submittal route's `chunked`, shared. */
export function zipStream(buf: Buffer): ReadableStream<Uint8Array> {
  const view = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let at = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= view.byteLength) return controller.close();
      controller.enqueue(view.subarray(at, Math.min(at + STREAM_CHUNK, view.byteLength)));
      at += STREAM_CHUNK;
    },
  });
}
```

- [ ] **Step 6: `src/lib/rack/submittal-server.ts:145`.** Change `async function readCapped(` to
  `export async function readCapped(` and add one line above it: `/** Shared with the estimate package zip (#301 slice C). */`.

- [ ] **Step 7: Create `src/lib/estimate-output/package-zip.ts`.**

```ts
import { quotePathSegment } from "./package-files";

/**
 * #301 slice C (D-l, R10) — the estimate package zip's pure rules: the
 * rack submittal's caps, the per-revision cache path, the download name,
 * and LEFT OUT.txt. Client-safe.
 */

export const PACKAGE_ZIP_DOC_MAX_BYTES = 25 * 1024 * 1024;
export const PACKAGE_ZIP_TOTAL_MAX_BYTES = 60 * 1024 * 1024;
export const PACKAGE_ZIP_DEADLINE_MS = 45_000;
export const PACKAGE_ZIP_CACHE_PREFIX = "estimate-package/";
export const SPEC_DOCX_NAME = "Specifications.docx";
export const LEFT_OUT_NAME = "LEFT OUT.txt";
export const NOTHING_TO_DOWNLOAD = "Nothing to download for this estimate.";
export const LEFT_OUT_REASON = {
  tooBig: "Left out — package size limit",
  late: "Left out — ran out of time",
  unreadable: "Left out — the file couldn't be read",
  missing: "Left out — the file is missing",
} as const;

export type LeftOut = { name: string; reason: string };

export function packageZipCacheDir(quoteId: string): string {
  return `${PACKAGE_ZIP_CACHE_PREFIX}${quotePathSegment(quoteId)}/`;
}

export function packageZipCachePath(quoteId: string, rev: number): string {
  return `${packageZipCacheDir(quoteId)}rev-${rev}.zip`;
}

export function packageZipFileName(number: string, revNo: number): string {
  return `${number} Rev ${revNo} package.zip`;
}

export function leftOutText(rows: readonly LeftOut[]): string {
  return ["These files were left out of this download. Ask your Peak rep for them.", "", ...rows.map((r) => `${r.name} — ${r.reason}`)].join("\r\n") + "\r\n";
}

/** Freeze a build in the cache only when nothing transient went wrong: the
 *  size cap is deterministic; a timeout, an unreadable or a missing file is not. */
export function zipCacheable(rows: readonly LeftOut[]): boolean {
  return rows.every((r) => r.reason === LEFT_OUT_REASON.tooBig);
}

/** Slice C adaptation 3: Blob must be on, and `next dev` (a scratch datadir
 *  reusing real quote ids next to the production Blob token) caches only on
 *  an explicit ESTIMATE_PACKAGE_CACHE=1. */
export function packageZipCacheOn(env: { NODE_ENV?: string; ESTIMATE_PACKAGE_CACHE?: string }, blobOn: boolean): boolean {
  return blobOn && (env.NODE_ENV !== "development" || env.ESTIMATE_PACKAGE_CACHE === "1");
}
```

  Purity: `package-zip.ts` value-imports only `./package-files`.

- [ ] **Step 8: Create `src/lib/estimate-output/package-zip-server.ts`.**

```ts
import { buildSpecDocx } from "@/lib/bid-spec-docx";
import type { SpecCatalogPart } from "@/lib/bid-spec";
import { blobEnabled, deleteBlobsUnder, getBlobStream, putBlobAt, safeName } from "@/lib/blob";
import { quoteSpecParts } from "@/lib/client-package-server";
import { CutSheetDeadlineError } from "@/lib/curtain-cut-sheets/deadline";
import { attachmentDisposition } from "@/lib/document-files";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { packageEntryName } from "@/lib/part-docs/package";
import { readCapped } from "@/lib/rack/submittal-server";
import type { SharedPackage } from "@/lib/quote-share/links";
import { sentDocumentStamp } from "@/lib/quote-share/view";
import { allSections } from "@/lib/stores/spec-sections";
import type { Quote, QuoteRevision } from "@/lib/stores/quotes";
import { createStoredZip, zipStream, type ZipFile } from "@/lib/zip";
import { revisionPackageDocs } from "./package-docs-server";
import {
  LEFT_OUT_NAME, LEFT_OUT_REASON, leftOutText, NOTHING_TO_DOWNLOAD, PACKAGE_ZIP_DEADLINE_MS, PACKAGE_ZIP_DOC_MAX_BYTES,
  PACKAGE_ZIP_TOTAL_MAX_BYTES, packageZipCacheDir, packageZipCacheOn, packageZipCachePath, packageZipFileName, SPEC_DOCX_NAME, zipCacheable,
  type LeftOut,
} from "./package-zip";

/**
 * #301 slice C (D-l, R10) — the estimate package zip for one SENT revision:
 * Specifications.docx (the D94 assemble over the revision's own BOM), then
 * every datasheet and spec sheet the revision's package lists, read with the
 * rack submittal's caps and a 45 s deadline, plus LEFT OUT.txt for anything
 * skipped. Built in memory; cached in private Blob per (quote, rev) on the
 * first download. Server-only. `deps` exists for the spec harness.
 */

export type BuiltPackageZip = { zip: Buffer; leftOut: LeftOut[]; datasheets: number; specsheets: number; specifications: boolean } | null;

type ZipDeps = {
  read: (blobKey: string, signal: AbortSignal) => Promise<ReadableStream | null>;
  sections: () => Promise<Awaited<ReturnType<typeof allSections>>>;
  now: () => number;
};

const liveZipDeps: ZipDeps = {
  read: (blobKey, signal) => getBlobStream(blobKey, { signal }),
  sections: allSections,
  now: Date.now,
};

export async function buildRevisionPackageZip(q: Quote, rev: QuoteRevision, deps: Partial<ZipDeps> = {}): Promise<BuiltPackageZip> {
  const d: ZipDeps = { ...liveZipDeps, ...deps };
  const deadline = d.now() + PACKAGE_ZIP_DEADLINE_MS;
  const docs = await revisionPackageDocs(rev);
  const files: ZipFile[] = [];
  const leftOut: LeftOut[] = [];

  const df = rev.docFields;
  const sp = quoteSpecParts({
    quote: { id: q.id, name: rev.name || q.name, customer: df?.customer ?? q.customer ?? "" },
    bom: docs.bom,
    catalog: docs.parts as SpecCatalogPart[],
    docIndex: docs.index,
    sections: await d.sections(),
    by: df?.preparedBy || df?.owner || q.owner || "Peak Systems Group",
    date: rev.at,
  });
  const specifications = sp.spec.sections.length > 0;
  if (specifications) files.push({ name: SPEC_DOCX_NAME, data: await buildSpecDocx(sp.spec) });

  const used = new Set<string>();
  let total = 0;
  let datasheets = 0;
  let specsheets = 0;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(new CutSheetDeadlineError()), Math.max(0, deadline - d.now()));
  try {
    for (const doc of docs.documents) {
      if (doc.kind !== "datasheet" && doc.kind !== "specsheet") continue;
      const name = packageEntryName(doc, used, safeName);
      const meta = docs.index.docsById.get(doc.documentId);
      if (!meta?.blobKey) {
        leftOut.push({ name, reason: LEFT_OUT_REASON.missing });
        continue;
      }
      if (meta.size > PACKAGE_ZIP_DOC_MAX_BYTES || total + meta.size > PACKAGE_ZIP_TOTAL_MAX_BYTES) {
        leftOut.push({ name, reason: LEFT_OUT_REASON.tooBig });
        continue;
      }
      if (d.now() >= deadline || abort.signal.aborted) {
        leftOut.push({ name, reason: LEFT_OUT_REASON.late });
        continue;
      }
      try {
        const stream = await d.read(meta.blobKey, abort.signal);
        if (!stream) {
          leftOut.push({ name, reason: LEFT_OUT_REASON.missing });
          continue;
        }
        const bytes = await readCapped(stream as ReadableStream<Uint8Array>, Math.min(PACKAGE_ZIP_DOC_MAX_BYTES, PACKAGE_ZIP_TOTAL_MAX_BYTES - total));
        if (bytes === "too-big") {
          leftOut.push({ name, reason: LEFT_OUT_REASON.tooBig });
          continue;
        }
        total += bytes.length;
        files.push({ name, data: bytes });
        if (doc.kind === "datasheet") datasheets++;
        else specsheets++;
      } catch (e) {
        console.warn(`[package] ${doc.documentId}: ${e instanceof Error ? e.message : String(e)}`);
        leftOut.push({ name, reason: abort.signal.aborted ? LEFT_OUT_REASON.late : LEFT_OUT_REASON.unreadable });
      }
    }
  } finally {
    clearTimeout(timer);
  }
  if (!files.length && !leftOut.length) return null;
  if (leftOut.length) files.push({ name: LEFT_OUT_NAME, data: Buffer.from(leftOutText(leftOut), "utf8") });
  return { zip: createStoredZip(files), leftOut, datasheets, specsheets, specifications };
}

type ServeDeps = {
  cacheOn: boolean;
  get: (path: string) => Promise<ReadableStream | null>;
  put: (path: string, bytes: Buffer) => Promise<void>;
  build: (q: Quote, rev: QuoteRevision) => Promise<BuiltPackageZip>;
};

const textResponse = (body: string, status: number) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" } });

/** The download: the cached blob when there is one, else build, cache a clean build, and stream. */
export async function servePackageZip(pkg: SharedPackage, deps: Partial<ServeDeps> = {}): Promise<Response> {
  const d: ServeDeps = {
    cacheOn: packageZipCacheOn(process.env, blobEnabled()),
    get: (path) => getBlobStream(path),
    put: async (path, bytes) => {
      await putBlobAt(path, bytes, "application/zip");
    },
    build: (q, rev) => buildRevisionPackageZip(q, rev),
    ...deps,
  };
  const { revNo } = sentDocumentStamp(pkg.q, pkg.rev);
  const headers = {
    "content-type": "application/zip",
    "content-disposition": attachmentDisposition(packageZipFileName(displayQuoteNumber(pkg.q), revNo)),
    "x-content-type-options": "nosniff",
    "cache-control": "private, no-store",
  };
  const path = packageZipCachePath(pkg.q.id, pkg.rev.rev);
  if (d.cacheOn) {
    try {
      const cached = await d.get(path);
      if (cached) return new Response(cached, { headers });
    } catch (e) {
      console.warn("[package] zip cache read failed", e instanceof Error ? e.message : e);
    }
  }
  const built = await d.build(pkg.q, pkg.rev);
  if (!built) return textResponse(NOTHING_TO_DOWNLOAD, 404);
  if (d.cacheOn && zipCacheable(built.leftOut)) {
    try {
      await d.put(path, built.zip);
    } catch (e) {
      console.warn("[package] zip cache write failed", e instanceof Error ? e.message : e);
    }
  }
  return new Response(zipStream(built.zip), { headers });
}

/** Staff "Rebuild package": drop every cached revision zip of this quote. */
export async function clearPackageZipCache(quoteId: string): Promise<number> {
  if (!blobEnabled()) return 0;
  return deleteBlobsUnder(packageZipCacheDir(quoteId));
}
```

- [ ] **Step 9: Create `src/app/share/quote/[id]/[token]/package.zip/route.ts`.**

```ts
import { servePackageZip } from "@/lib/estimate-output/package-zip-server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { resolveSharedPackage, SHARE_ZIP_PER_WINDOW, SHARE_ZIP_WINDOW_MS } from "@/lib/quote-share/links";
import { isShareTokenV2 } from "@/lib/quote-share/token";

export const dynamic = "force-dynamic";
/** A 45 s build deadline plus the docx and the response. */
export const maxDuration = 60;

const notFound = () => new Response("Not found", { status: 404 });

/**
 * #301 slice C (D-l, R10) — "Download all (.zip)" on the package page.
 * 6 / 10 min / IP first; a v2 token only; any visible state (it was sent).
 * Read-only except for the Blob cache of the pinned revision's zip.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; token: string }> }) {
  const { id, token } = await ctx.params;
  if (!rateLimit("share-zip:" + (clientIp(req) || "unknown"), SHARE_ZIP_PER_WINDOW, SHARE_ZIP_WINDOW_MS).ok) return new Response("Too many requests", { status: 429 });
  if (!isShareTokenV2(token)) return notFound();
  const pkg = await resolveSharedPackage(id, token);
  if (!pkg) return notFound();
  try {
    return await servePackageZip(pkg);
  } catch (e) {
    console.error("[package] zip build failed", e);
    return new Response("The download couldn’t be built — try again.", { status: 500 });
  }
}
```

- [ ] **Step 10: Downloads view + card.** Append to `package-extras-model.ts`:

```ts
import type { PackageDocument } from "@/lib/part-docs/package";
```

  (merge into the existing `@/lib/part-docs/package` type import) and:

```ts
/** Datasheets and spec sheets only (never manuals — D-l). Nothing to offer → no card. */
export function downloadsView(documents: readonly Pick<PackageDocument, "documentId" | "name" | "kind">[], specifications: boolean, base: string): PackageDownloadsView | null {
  const files = documents
    .filter((d) => d.kind === "datasheet" || d.kind === "specsheet")
    .map((d) => ({ href: packageDocHref(base, d.documentId), name: d.name, kindLabel: d.kind === "datasheet" ? "Datasheet" : "Spec sheet" }));
  if (!files.length && !specifications) return null;
  return { zipHref: `${base}/package.zip`, files, specifications };
}

export function downloadsSummary(v: PackageDownloadsView): string {
  const ds = v.files.filter((f) => f.kindLabel === "Datasheet").length;
  const ss = v.files.length - ds;
  const parts = [ds ? `${ds} datasheet${ds === 1 ? "" : "s"}` : "", ss ? `${ss} spec sheet${ss === 1 ? "" : "s"}` : "", v.specifications ? "Specifications (Word)" : ""];
  return parts.filter(Boolean).join(" · ");
}
```

  In `package-extras.ts`, import `downloadsView` and `hasPrintableSpec` (`@/lib/specs/articles`), and after
  `extras.datasheets = …` add:

```ts
    const specReady = docs.parts.some((p) => !!(p as { specSectionId?: string }).specSectionId && hasPrintableSpec(p as { specBody?: string; specState?: "authored" | "draft" }));
    extras.downloads = downloadsView(docs.documents, specReady, base);
```

  In `components/estimate-output/package-extras.tsx` add (import `downloadsSummary` and the view type):

```tsx
export function PackageDownloads({ view }: { view: PackageDownloadsView }) {
  return (
    <div className="pkg-card">
      <h2>Downloads</h2>
      <p className="pkg-p">
        <a href={view.zipHref} download style={{ ...PKG_LINK, display: "inline-block", border: "1px solid var(--accent)", borderRadius: 8, padding: "8px 14px" }}>
          Download all (.zip)
        </a>
      </p>
      <p className="pkg-muted" style={{ margin: "0 0 8px" }}>
        {downloadsSummary(view)}
      </p>
      {view.files.length > 0 && (
        <details>
          <summary className="pkg-muted" style={{ cursor: "pointer" }}>{`Individual files (${view.files.length})`}</summary>
          <ul className="pkg-ul" style={{ marginTop: 8 }}>
            {view.files.map((f) => (
              <li key={f.href}>
                <a href={f.href} download style={PKG_LINK}>
                  {f.name}
                </a>{" "}
                <span className="pkg-muted">{f.kindLabel}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
```

  In `package-slots.tsx`, import `PackageDownloads` and return
  `{ keyProductExtra, ...(x.downloads ? { downloads: <PackageDownloads view={x.downloads} /> } : {}) }`.

- [ ] **Step 11: Smoke.** After the Task 4 entry in `DYNAMIC_ROUTES`:

```ts
  // #301 slice C — the package zip with a v2 token that fails the verify: a clean 404, nothing built.
  { route: "/share/quote/Q-2041/1.1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/package.zip", expectNotFound: true },
```

- [ ] **Step 12: Run the gates.** tsc 0; test:specs PASS = previous + 12 sync + 5 DB, and every `#207`, `#211`, `#223`, `#292`,
  `#296` client-package check still passes; eslint on the 11 src files; `next build` OK (confirm the `package.zip` segment
  appears in the route list).

- [ ] **Step 13: Commit.**

```bash
git add src/lib/client-package-server.ts src/lib/blob.ts src/lib/zip.ts src/lib/rack/submittal-server.ts src/lib/estimate-output/package-zip.ts \
  src/lib/estimate-output/package-zip-server.ts "src/app/share/quote/[id]/[token]/package.zip/route.ts" src/lib/estimate-output/package-extras-model.ts \
  src/lib/estimate-output/package-extras.ts src/components/estimate-output/package-extras.tsx "src/app/share/quote/[id]/[token]/package-slots.tsx" \
  scripts/smoke-routes.ts scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(share): #301 slice C — package zip: datasheets + spec sheets + Specifications.docx, rack caps, LEFT OUT.txt, per-revision Blob cache

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 6: Package files — upload broker + finalize, remove, file route, Plans & risers

**Files:**
- Create: `src/app/api/quotes/[id]/package-files/upload/route.ts`, `src/lib/estimate-output/package-files-server.ts`,
  `src/app/(app)/estimator/package-file-upload.ts`, `src/app/(app)/estimator/package-actions.ts`,
  `src/app/share/quote/[id]/[token]/file/[fileId]/route.ts`
- Modify: `package-extras-model.ts` (`plansView`), `package-extras.ts` (plans), `components/estimate-output/package-extras.tsx`
  (`PackagePlans`), `package-slots.tsx` (plans), `scripts/smoke-routes.ts`
- Test: harness block `#301 slice C — package files`; `e301cFilesAsyncChecks`

**Interfaces:**
- **Consumes:** Task 1 (everything in `package-files.ts`); Task 3 (`addPackageFile`, `removePackageFile`); `getBlobHead`,
  `deleteBlob`, `getBlobStream`, `blobEnabled`; `handleUpload` (`@vercel/blob/client`); `upload` (browser);
  `getOptionalUser`, `requireUser`; `can`; `pdfKindForQuoteType`; `ONLINE_COPY`; `contentDisposition` (`part-docs/files`);
  `newUploadKey`, `isUploadKey`, `parseUploadKey`, `cleanText`, `formatBytes` (`document-files`); Slice B `resolveSharedPackage`.
- **Produces** (Tasks 8, 9):
  - `package-files-server.ts`: `type FileDeps = { head; remove; stream; now: () => number; newId: () => string }`;
    `finalizePackageFileUpload(quoteId, input, by, deps?): Promise<{ ok: true; file: PackageFile } | { ok: false; error: string }>`;
    `removePackageFileAndBlob(quoteId, fileId, deps?): Promise<{ ok: true } | { ok: false; error: string }>`;
    `packageFileForRevision(rev, fileId): PackageFile | null`; `servePackageFile(req, file, deps?): Promise<Response>`.
  - `package-actions.ts`: `addPackageFileAction(quoteId, input)`, `removePackageFileAction(quoteId, fileId)` →
    `{ ok: true } | { ok: false; error: string }`.
  - `putPackageFile(file: File, quoteId: string): Promise<{ ok: true; uploadKey: string; pathname: string } | { ok: false; error: string }>`.
  - `plansView(files, base): PackagePlanView[]`; `PackagePlans({ plans })`.
  - `POST /api/quotes/[id]/package-files/upload`; `GET /share/quote/[id]/<v2>/file/[fileId]`.

- [ ] **Step 1: Write the failing harness block.** Append:

```ts
/* ======================================================================
   #301 slice C — package files: the Blob client-upload broker (Send only,
   this quote's path, 25 MB), finalize (path scope → head sniff → store;
   a refusal deletes only the caller's own unrecorded blob), remove (the
   blob goes only when no revision lists it), the share file route (the
   pinned revision's VISIBLE files only — R12), and Plans & risers.
   ====================================================================== */
import { plansView as e301cuPlans } from "@/lib/estimate-output/package-extras-model";
import { PackagePlans as E301cuPlans } from "@/components/estimate-output/package-extras";
import { createElement as e301cuEl } from "react";
import { renderToStaticMarkup as e301cuRender } from "react-dom/server";
{
  const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const broker = rd("src/app/api/quotes/[id]/package-files/upload/route.ts");
  const gate = broker.slice(broker.indexOf("onBeforeGenerateToken"));
  ok(gate.indexOf("getOptionalUser()") < gate.indexOf('can("send", u.roles)') && gate.indexOf('can("send", u.roles)') < gate.indexOf("packageFilePathInScope(pathname, q.id, uploadKey)") &&
     broker.includes("maximumSizeInBytes: MAX_PACKAGE_FILE_BYTES") && broker.includes("addRandomSuffix: true") && broker.includes("blobEnabled()") && !broker.includes("onUploadCompleted"),
    "#301 uploads: the token broker grants one path under this quote's upload key, to a Send holder, ≤ 25 MB, no callback");
  const srv = rd("src/lib/estimate-output/package-files-server.ts");
  const fin = srv.slice(srv.indexOf("export async function finalizePackageFileUpload("), srv.indexOf("export async function removePackageFileAndBlob("));
  ok(fin.indexOf("packageFilePathInScope(") < fin.indexOf("packageBlobReferenced(") && fin.indexOf("packageBlobReferenced(") < fin.indexOf("d.head(") &&
     fin.indexOf("d.head(") < fin.indexOf("sniffPackageFile(") && fin.indexOf("sniffPackageFile(") < fin.indexOf("addPackageFile("),
    "#301 uploads: finalize checks the path, never touches a recorded blob, sniffs the real bytes, then records");
  const fileRoute = rd("src/app/share/quote/[id]/[token]/file/[fileId]/route.ts");
  ok(fileRoute.indexOf("rateLimit(") < fileRoute.indexOf("isShareTokenV2(token)") && fileRoute.indexOf("isShareTokenV2(token)") < fileRoute.indexOf("resolveSharedPackage(") &&
     fileRoute.includes("packageFileForRevision(pkg.rev, fileId)") && fileRoute.includes("SHARE_FILE_PER_MIN") && !fileRoute.includes("q.packageFiles"),
    "#301 uploads: the file route serves only the pinned revision's frozen list (R12), v2 only, 120/min/IP");
  const acts = rd("src/app/(app)/estimator/package-actions.ts");
  ok(/^"use server";/.test(acts) && !/^export (?!async function)/m.test(acts) && (acts.match(/await requireUser\(\);/g) || []).length >= 2 &&
     (acts.match(/if \(!can\("send", user\.roles\)\) return \{ ok: false, error: ONLINE_COPY\.needsSend \};/g) || []).length >= 2,
    "#301 uploads: the staff actions need a session and Send, answer with a message, export only async functions");
  const client = rd("src/app/(app)/estimator/package-file-upload.ts");
  ok(client.includes('from "@vercel/blob/client"') && client.includes("packageFileBlobPath(quoteId, uploadKey, file.name)") && !/from "@\/lib\/(stores|blob|session)/.test(client),
    "#301 uploads: the browser half uploads straight to Blob under the quote's key, with no server import");
  const f = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: "plan", name: "Plan.pdf", blobPath: "estimate-files/Q/UP-0123456789abcdef/x", contentType: "application/pdf", size: 2048, source: "upload", addedAt: 1, addedBy: "T", ...extra }) as never;
  const plans = e301cuPlans([f("PF-000000000001"), f("PF-000000000002", { source: "grid" }), f("PF-000000000003", { kind: "riser", contentType: "image/png", name: "Riser.png" })], "/b");
  ok(plans.map((p) => `${p.kindLabel}|${p.href}|${p.isImage}`).join() === "Plan|/b/file/PF-000000000001|false,Riser|/b/file/PF-000000000003|true" && plans[0].sizeLabel === "2 KB",
    "#301 uploads: Plans & risers lists the visible files only (an upload hides the Grid file of its kind)");
  const html = e301cuRender(e301cuEl(E301cuPlans, { plans }));
  ok(html.includes("Plans &amp; risers") && html.includes('href="/b/file/PF-000000000001"') && html.includes('src="/b/file/PF-000000000003"') && !html.includes("estimate-files/"),
    "#301 uploads: the card links each file (images previewed) and never prints a blob path");
  ok(rd("scripts/smoke-routes.ts").includes(`{ route: "/share/quote/Q-2041/1.1.${"A".repeat(43)}/file/PF-000000000001", expectNotFound: true }`), "#301 smoke: the file route with a bad v2 token is a clean 404");
}

async function e301cFilesAsyncChecks(): Promise<void> {
  const { fixtureId } = await import("./test-fixtures");
  const Q = await import("@/lib/stores/quotes");
  const F = await import("@/lib/estimate-output/package-files");
  const S = await import("@/lib/estimate-output/package-files-server");
  const QID = fixtureId(301, "c-files");
  await Q.create({ id: QID, name: "#301c files", customer: "Spec fixture", owner: "spec", quoteType: "system", source: "estimator",
    spec: { sections: [{ id: "s1", name: "Lighting", kind: "materials", mfr: "", freightPct: 0, items: [{ id: 1, sku: "A", desc: "A", qty: 1, unit: "ea", cost: 1, price: 2 }] }], mobs: [] } });
  registerFixture("quotes", QID);
  const key = "UP-00000000000301c0";
  const path = (n: string) => F.packageFileBlobPath(QID, key, n) + "-Sfx01";
  const removed: string[] = [];
  let idN = 0;
  const deps = (bytes: Uint8Array, size: number) => ({
    head: async () => ({ bytes, size }),
    remove: async (p: string) => { removed.push(p); },
    now: () => 1_000,
    newId: () => "PF-" + (++idN).toString(16).padStart(12, "c"),
  });
  const pdf = new TextEncoder().encode("%PDF-1.7 fixture");
  const okRes = await S.finalizePackageFileUpload(QID, { uploadKey: key, blobPath: path("plan.pdf"), fileName: "Main plan.pdf", kind: "plan" }, "Tester", deps(pdf, 4096));
  ok(okRes.ok && okRes.file.kind === "plan" && okRes.file.contentType === "application/pdf" && okRes.file.size === 4096 && okRes.file.source === "upload" &&
     F.cleanPackageFiles((await Q.get(QID))!.packageFiles).length === 1 && removed.length === 0,
    "#301 uploads (DB): a real PDF under this quote's key is recorded as a plan");
  const again = await S.finalizePackageFileUpload(QID, { uploadKey: key, blobPath: path("plan.pdf"), fileName: "x.pdf", kind: "plan" }, "Tester", deps(pdf, 4096));
  ok(!again.ok && again.error === F.PACKAGE_FILES_COPY.alreadySaved && removed.length === 0, "#301 uploads (DB): replaying a recorded path is refused and never deletes that blob");
  const svg = await S.finalizePackageFileUpload(QID, { uploadKey: key, blobPath: path("x.svg"), fileName: "x.svg", kind: "plan" }, "Tester", deps(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"), 100));
  const big = await S.finalizePackageFileUpload(QID, { uploadKey: key, blobPath: path("big.pdf"), fileName: "big.pdf", kind: "plan" }, "Tester", deps(pdf, F.MAX_PACKAGE_FILE_BYTES + 1));
  ok(!svg.ok && svg.error === F.PACKAGE_FILES_COPY.wrongType && !big.ok && big.error === F.PACKAGE_FILES_COPY.tooBig && removed.join() === [path("x.svg"), path("big.pdf")].join(),
    "#301 uploads (DB): SVG and oversize files are refused and their own unrecorded blobs deleted");
  const foreign = await S.finalizePackageFileUpload(QID, { uploadKey: key, blobPath: "estimate-files/Q-OTHER/UP-00000000000301c0/a.pdf", fileName: "a.pdf", kind: "plan" }, "Tester", deps(pdf, 10));
  ok(!foreign.ok && foreign.error === F.PACKAGE_FILES_COPY.notThisQuote && removed.length === 2, "#301 uploads (DB): another quote's path is refused and never deleted");
  // remove: a never-sent file's blob goes; a file a sent revision froze keeps its blob.
  const r1 = await S.removePackageFileAndBlob(QID, okRes.ok ? okRes.file.id : "", { remove: async (p: string) => { removed.push(p); } });
  ok(r1.ok && removed.at(-1) === path("plan.pdf"), "#301 uploads (DB): removing a file nothing else lists deletes its blob");
  const kept = await S.finalizePackageFileUpload(QID, { uploadKey: key, blobPath: path("riser.pdf"), fileName: "Riser.pdf", kind: "riser" }, "Tester", deps(pdf, 4096));
  await Q.update(QID, { status: "sent" });
  const rev = (await Q.addQuoteRevision(QID, { by: "Test", reason: "sent" }))!;
  await Q.update(QID, { status: "draft" });
  const before = removed.length;
  const r2 = await S.removePackageFileAndBlob(QID, kept.ok ? kept.file.id : "", { remove: async (p: string) => { removed.push(p); } });
  ok(r2.ok && removed.length === before, "#301 uploads (DB): a file a sent revision still lists keeps its blob (the old link still shows it)");
  ok(kept.ok && S.packageFileForRevision(rev, kept.file.id)?.id === kept.file.id && S.packageFileForRevision(rev, "PF-ffffffffffff") === null && S.packageFileForRevision(rev, "../x") === null,
    "#301 uploads (DB): the share route resolves only the pinned revision's frozen files");
  const stream = async () => new Response("%PDF-1.7 served").body;
  const res = kept.ok ? await S.servePackageFile(new Request("http://x/"), kept.file, { stream }) : new Response(null, { status: 500 });
  const etag = res.headers.get("etag") || "";
  const res304 = kept.ok ? await S.servePackageFile(new Request("http://x/", { headers: { "if-none-match": etag } }), kept.file, { stream }) : new Response(null, { status: 500 });
  ok(res.status === 200 && res.headers.get("content-type") === "application/pdf" && /^inline; filename="Riser\.pdf"/.test(res.headers.get("content-disposition") || "") &&
     res.headers.get("x-content-type-options") === "nosniff" && res.headers.get("cache-control") === "private, max-age=3600" && res304.status === 304 && (await res.text()) === "%PDF-1.7 served",
    "#301 uploads (serve): inline with its real type, nosniff, private cache, an ETag");
}
```

  Append `await e301cFilesAsyncChecks();` to `estimateOutput301CAsyncChecks`'s body.

- [ ] **Step 2: Run it to verify it fails.**

- [ ] **Step 3: Create `src/app/api/quotes/[id]/package-files/upload/route.ts`.**

```ts
import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { blobEnabled } from "@/lib/blob";
import { parseUploadKey } from "@/lib/document-files";
import { MAX_PACKAGE_FILE_BYTES, PACKAGE_FILE_TYPES, PACKAGE_FILES_COPY, packageFilePathInScope } from "@/lib/estimate-output/package-files";
import { pdfKindForQuoteType } from "@/lib/quote-pdf/state";
import { ONLINE_COPY } from "@/lib/quote-share/view";
import { getOptionalUser } from "@/lib/session";
import { get as getQuote } from "@/lib/stores/quotes";
import { can } from "@/lib/team";

// Token minting only — no bytes pass through this function.
export const maxDuration = 30;

class UploadRefused extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

/**
 * #301 slice C (D-j) — Vercel Blob client-upload broker for an estimate's
 * drawings (the #218 documents route's pattern). Only
 * `blob.generate-client-token` (no onUploadCompleted, so no callback and no
 * middleware exemption). The grant is for ONE path:
 * `estimate-files/<quote>/<uploadKey>/…` of a system quote, to a signed-in
 * Send holder, ≤ 25 MB. finalize (addPackageFileAction) re-checks the real
 * bytes before anything is recorded.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  if (!blobEnabled()) return NextResponse.json({ reason: "blob-disabled", error: PACKAGE_FILES_COPY.noStorage }, { status: 503 });
  const { id } = await ctx.params;
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (body.type !== "blob.generate-client-token") return NextResponse.json({ error: "unsupported event" }, { status: 400 });
  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const u = await getOptionalUser();
        if (!u) throw new UploadRefused(401, "unauthorized");
        if (!can("send", u.roles)) throw new UploadRefused(403, ONLINE_COPY.needsSend);
        const uploadKey = parseUploadKey(clientPayload);
        if (!uploadKey) throw new UploadRefused(400, "clientPayload must be {uploadKey}");
        const q = await getQuote(id);
        if (!q || pdfKindForQuoteType(q.quoteType) !== "quote") throw new UploadRefused(404, ONLINE_COPY.gone);
        if (!packageFilePathInScope(pathname, q.id, uploadKey)) throw new UploadRefused(400, PACKAGE_FILES_COPY.notThisQuote);
        return {
          maximumSizeInBytes: MAX_PACKAGE_FILE_BYTES,
          allowedContentTypes: [...PACKAGE_FILE_TYPES, "application/octet-stream"],
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ quoteId: q.id, uploadKey }),
        };
      },
    });
    return NextResponse.json(json);
  } catch (e) {
    if (e instanceof UploadRefused) return NextResponse.json({ error: e.message }, { status: e.status });
    // Never show the vendor's own error to the browser — only our refusals.
    return NextResponse.json({ error: "Upload could not be authorized." }, { status: 400 });
  }
}
```

  The route sits under `/api/`, so the middleware's team-session gate already applies (the documents broker relies on the
  same).

- [ ] **Step 4: Create `src/lib/estimate-output/package-files-server.ts`.**

```ts
import { createHash } from "node:crypto";
import { deleteBlob, getBlobHead, getBlobStream } from "@/lib/blob";
import { cleanText, isUploadKey } from "@/lib/document-files";
import { contentDisposition } from "@/lib/part-docs/files";
import { pdfKindForQuoteType } from "@/lib/quote-pdf/state";
import { ONLINE_COPY } from "@/lib/quote-share/view";
import { addPackageFile, get as getQuote, removePackageFile, type QuoteRevision } from "@/lib/stores/quotes";
import {
  cleanPackageFiles, isPackageFileId, isPackageFileKind, MAX_PACKAGE_FILE_BYTES, newPackageFileId, PACKAGE_FILE_SNIFF_BYTES, PACKAGE_FILES_COPY,
  packageBlobReferenced, packageFileName, packageFilePathInScope, sniffPackageFile, visiblePackageFiles, type PackageFile,
} from "./package-files";

/**
 * #301 slice C (D-j, R13) — the server half of an estimate's drawings.
 * finalize turns a browser upload into a PackageFile (the documents
 * collection's order: path scope → never a recorded blob → the head Blob
 * really holds → record); remove drops the record and the blob only when no
 * revision still lists it; the share route reads the PINNED revision's
 * frozen list (R12). Server-only. `deps` exists for the spec harness.
 */

type FileDeps = {
  head: (pathname: string, max: number) => Promise<{ bytes: Uint8Array; size: number } | null>;
  remove: (pathname: string) => Promise<void>;
  stream: (pathname: string) => Promise<ReadableStream | null>;
  now: () => number;
  newId: () => string;
};

const liveDeps: FileDeps = { head: getBlobHead, remove: deleteBlob, stream: (p) => getBlobStream(p), now: Date.now, newId: newPackageFileId };

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

export async function finalizePackageFileUpload(quoteId: string, input: unknown, by: string, deps: Partial<FileDeps> = {}): Promise<Result<{ file: PackageFile }>> {
  const d: FileDeps = { ...liveDeps, ...deps };
  const inp = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const q = await getQuote(String(quoteId || ""));
  if (!q || pdfKindForQuoteType(q.quoteType) !== "quote") return { ok: false, error: ONLINE_COPY.gone };
  const uploadKey = inp.uploadKey;
  if (!isUploadKey(uploadKey) || !packageFilePathInScope(inp.blobPath, q.id, uploadKey)) return { ok: false, error: PACKAGE_FILES_COPY.notThisQuote };
  const blobPath = inp.blobPath;
  // A path any list already holds may be someone's real file (a replay or a retry) — never touch it.
  if (packageBlobReferenced(q, blobPath)) return { ok: false, error: PACKAGE_FILES_COPY.alreadySaved };

  const refuse = async (error: string): Promise<Result<{ file: PackageFile }>> => {
    try {
      const cur = await getQuote(q.id);
      if (!cur || !packageBlobReferenced(cur, blobPath)) await d.remove(blobPath);
    } catch {
      /* best effort — the refusal stands either way */
    }
    return { ok: false, error };
  };

  let head: { bytes: Uint8Array; size: number } | null;
  try {
    head = await d.head(blobPath, PACKAGE_FILE_SNIFF_BYTES);
  } catch {
    return { ok: false, error: PACKAGE_FILES_COPY.unreadable };
  }
  if (!head) return { ok: false, error: PACKAGE_FILES_COPY.noArrival };
  if (!(head.size > 0)) return refuse(PACKAGE_FILES_COPY.empty);
  if (head.size > MAX_PACKAGE_FILE_BYTES) return refuse(PACKAGE_FILES_COPY.tooBig);
  const type = sniffPackageFile(head.bytes);
  if (!type) return refuse(PACKAGE_FILES_COPY.wrongType);

  const file: PackageFile = {
    id: d.newId(),
    kind: isPackageFileKind(inp.kind) ? inp.kind : "drawing",
    name: packageFileName(inp.fileName, type),
    blobPath,
    contentType: type,
    size: head.size,
    source: "upload",
    addedAt: d.now(),
    addedBy: cleanText(by, 120),
  };
  const res = await addPackageFile(q.id, file);
  if (!res.ok) return refuse(res.reason === "full" ? PACKAGE_FILES_COPY.full : ONLINE_COPY.gone);
  return { ok: true, file };
}

export async function removePackageFileAndBlob(quoteId: string, fileId: string, deps: Partial<Pick<FileDeps, "remove">> = {}): Promise<Result<object>> {
  const remove = deps.remove ?? liveDeps.remove;
  if (!isPackageFileId(fileId)) return { ok: false, error: PACKAGE_FILES_COPY.gone };
  const res = await removePackageFile(String(quoteId || ""), fileId);
  if (!res.ok) return { ok: false, error: res.reason === "gone" ? ONLINE_COPY.gone : PACKAGE_FILES_COPY.gone };
  if (!packageBlobReferenced(res.quote, res.file.blobPath)) {
    try {
      await remove(res.file.blobPath);
    } catch (e) {
      console.warn("[package] drawing blob not deleted", e instanceof Error ? e.message : e);
    }
  }
  return { ok: true };
}

/** R12 — the pinned revision's frozen, VISIBLE files only (never the live list). */
export function packageFileForRevision(rev: Pick<QuoteRevision, "docFields">, fileId: string): PackageFile | null {
  if (!isPackageFileId(fileId)) return null;
  return visiblePackageFiles(cleanPackageFiles(rev.docFields?.packageFiles)).find((f) => f.id === fileId) ?? null;
}

const notFound = () => new Response("Not found", { status: 404 });
const FILE_CACHE = "private, max-age=3600";

/** Inline (PDF / image — the only types finalize records), nosniff, private, an ETag on id + path. */
export async function servePackageFile(req: Request, file: PackageFile, deps: Partial<Pick<FileDeps, "stream">> = {}): Promise<Response> {
  const read = deps.stream ?? liveDeps.stream;
  const etag = `"${file.id}-${createHash("sha1").update(file.blobPath).digest("hex").slice(0, 16)}"`;
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag, "cache-control": FILE_CACHE } });
  let stream: ReadableStream | null;
  try {
    stream = await read(file.blobPath);
  } catch {
    return new Response("Couldn't read the file — try again", { status: 502 });
  }
  if (!stream) return notFound();
  return new Response(stream, {
    headers: {
      "content-type": file.contentType,
      "content-disposition": contentDisposition(file.name),
      "cache-control": FILE_CACHE,
      etag,
      "x-content-type-options": "nosniff",
    },
  });
}
```

- [ ] **Step 5: Create `src/app/(app)/estimator/package-file-upload.ts`.**

```ts
import { upload } from "@vercel/blob/client";
import { newUploadKey } from "@/lib/document-files";
import { MAX_PACKAGE_FILE_BYTES, PACKAGE_FILES_COPY, packageFileBlobPath } from "@/lib/estimate-output/package-files";

/**
 * #301 slice C — browser half of a drawing upload (the #218 documents
 * pattern): preflight the size, mint an upload key, send the bytes straight
 * to private Blob through the quote's token broker. The caller then calls
 * addPackageFileAction with the key + pathname; the server re-checks
 * everything. Imported only by client components; client-safe imports only.
 */
export type PutPackageFile = { ok: true; uploadKey: string; pathname: string } | { ok: false; error: string };

export async function putPackageFile(file: File, quoteId: string): Promise<PutPackageFile> {
  if (!file.size) return { ok: false, error: PACKAGE_FILES_COPY.empty };
  if (file.size > MAX_PACKAGE_FILE_BYTES) return { ok: false, error: PACKAGE_FILES_COPY.tooBig };
  const uploadKey = newUploadKey();
  try {
    const res = await upload(packageFileBlobPath(quoteId, uploadKey, file.name), file, {
      access: "private",
      handleUploadUrl: `/api/quotes/${encodeURIComponent(quoteId)}/package-files/upload`,
      clientPayload: JSON.stringify({ uploadKey }),
      contentType: file.type || "application/octet-stream",
      multipart: file.size > 5 * 1024 * 1024,
    });
    return { ok: true, uploadKey, pathname: res.pathname };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return {
      ok: false,
      error: /client token/i.test(msg) ? "Upload refused — file storage may not be configured, or your session ended." : msg || "Upload failed — try again.",
    };
  }
}
```

- [ ] **Step 6: Create `src/app/(app)/estimator/package-actions.ts`.**

```ts
"use server";

import { finalizePackageFileUpload, removePackageFileAndBlob } from "@/lib/estimate-output/package-files-server";
import { PACKAGE_FILES_COPY } from "@/lib/estimate-output/package-files";
import { ONLINE_COPY } from "@/lib/quote-share/view";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";

/**
 * #301 slice C — the staff package panel's server actions (Slice C
 * adaptation 15: share-actions.ts stays #293's). Reading needs a session;
 * every write needs Send (the drawings and the zip are what the client
 * link shows), answered with a message, never requirePerm's redirect.
 */

export async function addPackageFileAction(quoteId: string, input: { uploadKey: string; blobPath: string; fileName: string; kind: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can("send", user.roles)) return { ok: false, error: ONLINE_COPY.needsSend };
  try {
    const r = await finalizePackageFileUpload(String(quoteId || ""), input, user.name);
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  } catch (e) {
    console.error("[package] add drawing failed", e);
    return { ok: false, error: PACKAGE_FILES_COPY.failed };
  }
}

export async function removePackageFileAction(quoteId: string, fileId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can("send", user.roles)) return { ok: false, error: ONLINE_COPY.needsSend };
  try {
    const r = await removePackageFileAndBlob(String(quoteId || ""), String(fileId || ""));
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  } catch (e) {
    console.error("[package] remove drawing failed", e);
    return { ok: false, error: PACKAGE_FILES_COPY.failed };
  }
}
```

- [ ] **Step 7: Create `src/app/share/quote/[id]/[token]/file/[fileId]/route.ts`.**

```ts
import { packageFileForRevision, servePackageFile } from "@/lib/estimate-output/package-files-server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { resolveSharedPackage, SHARE_FILE_PER_MIN } from "@/lib/quote-share/links";
import { isShareTokenV2 } from "@/lib/quote-share/token";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404 });

/**
 * #301 slice C (D-j, R12) — one drawing from the package page's Plans &
 * risers: 120/min/IP first, a v2 token only, a file the PINNED revision's
 * frozen list shows (an overridden Grid file is not served). Read-only.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; token: string; fileId: string }> }) {
  const { id, token, fileId } = await ctx.params;
  if (!rateLimit("share-file:" + (clientIp(req) || "unknown"), SHARE_FILE_PER_MIN, 60_000).ok) return new Response("Too many requests", { status: 429 });
  if (!isShareTokenV2(token)) return notFound();
  const pkg = await resolveSharedPackage(id, token);
  if (!pkg) return notFound();
  const file = packageFileForRevision(pkg.rev, fileId);
  if (!file) return notFound();
  return servePackageFile(req, file);
}
```

- [ ] **Step 8: Plans & risers on the page.** Append to `package-extras-model.ts` (value imports from `./package-files` and
  `@/lib/document-files` are the purity pin's allowance):

```ts
import { PACKAGE_FILE_KIND_LABEL, visiblePackageFiles, type PackageFile } from "./package-files";
import { formatBytes } from "@/lib/document-files";

export function packageFileHref(base: string, fileId: string): string {
  return `${base}/file/${encodeURIComponent(fileId)}`;
}

/** The pinned revision's visible files (decision 9) as links — never a blob path. */
export function plansView(files: readonly PackageFile[], base: string): PackagePlanView[] {
  return visiblePackageFiles(files).map((f) => ({
    href: packageFileHref(base, f.id),
    name: f.name,
    kindLabel: PACKAGE_FILE_KIND_LABEL[f.kind],
    sizeLabel: formatBytes(f.size),
    isImage: f.contentType !== "application/pdf",
  }));
}
```

  (Put both imports at the top of the file with the others.) In `package-extras.ts`, import `plansView` and
  `cleanPackageFiles`, and after the `try { … } catch { … }` block add:

```ts
  // R12 — the pinned revision's frozen list only, never the live quote's.
  extras.plans = plansView(cleanPackageFiles(hit.rev.docFields?.packageFiles), base);
```

  In `components/estimate-output/package-extras.tsx` add (import `PackagePlanView`):

```tsx
export function PackagePlans({ plans }: { plans: PackagePlanView[] }) {
  return (
    <div className="pkg-card">
      <h2>Plans &amp; risers</h2>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {plans.map((p) => (
          <li key={p.href} style={{ marginBottom: 12 }}>
            {p.isImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.href} alt={p.name} loading="lazy" style={{ display: "block", maxWidth: "100%", maxHeight: 360, objectFit: "contain", marginBottom: 6 }} />
            )}
            <a href={p.href} target="_blank" rel="noopener noreferrer" style={PKG_LINK}>
              {p.name}
            </a>{" "}
            <span className="pkg-muted">{`${p.kindLabel} · ${p.sizeLabel}`}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

  In `package-slots.tsx`, import `PackagePlans` and add `...(x.plans.length ? { plans: <PackagePlans plans={x.plans} /> } : {})`
  to the returned object.

- [ ] **Step 9: Smoke.** After the Task 5 entry:

```ts
  // #301 slice C — the package file route with a v2 token that fails the verify: a clean 404.
  { route: "/share/quote/Q-2041/1.1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/file/PF-000000000001", expectNotFound: true },
```

- [ ] **Step 10: Run the gates.** tsc 0; test:specs PASS = previous + 8 sync + 8 DB; eslint on the 9 src files; `next build` OK
  (the client helper imports `@vercel/blob/client` like `components/documents/upload-client.ts` already does).

- [ ] **Step 11: Commit.**

```bash
git add "src/app/api/quotes/[id]/package-files/upload/route.ts" src/lib/estimate-output/package-files-server.ts "src/app/(app)/estimator/package-file-upload.ts" \
  "src/app/(app)/estimator/package-actions.ts" "src/app/share/quote/[id]/[token]/file/[fileId]/route.ts" src/lib/estimate-output/package-extras-model.ts \
  src/lib/estimate-output/package-extras.ts src/components/estimate-output/package-extras.tsx "src/app/share/quote/[id]/[token]/package-slots.tsx" \
  scripts/smoke-routes.ts scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(estimate-output): #301 slice C — package drawings: direct-to-Blob upload (magic-byte checked), remove, frozen file route, Plans & risers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Client actions — server actions, notifications, islands, live total

**Files:**
- Create: `src/lib/estimate-output/responses-server.ts`, `src/app/share/quote/[id]/[token]/scope-selection.tsx`,
  `src/app/share/quote/[id]/[token]/question-form.tsx`
- Modify: `src/app/share/quote/[id]/[token]/actions.ts` (two actions), `package-extras.ts` (actions scopes),
  `package-slots.tsx` (actions, `ctx`), `package-page.tsx` (passes `ctx`)
- Test: harness block `#301 slice C — client actions`; `e301cActionsAsyncChecks`

**Interfaces:**
- **Consumes:** Task 2 (`sanitizeClientResponse`, `responseScopes`, `responseAssignees`, `leadEstimator`, `confirmationText`,
  `responseTaskTitle`, `responseNoteText`, `chicagoDayEnd`, `newResponseId`, `creditNoteText`, `CLIENT_ACTION_COPY`,
  caps, `CLIENT_LINK_ACTOR`, `ClientActionResult`, `ResponseScope`); Task 3 (`appendClientResponse`); Slice B
  (`resolveSharedPackage`, `canAct`); `revisionSections`; `addNoteRecord`; `logActivity`; `createTask`; `allUsers`;
  `displayQuoteNumber`; `sentDocumentStamp`; `rateLimit`, `clientIpFromHeaders`; `headers` (async).
- **Produces:** `submitClientResponse(kind, id, token, input, ip, deps?): Promise<ClientActionResult>`;
  `notifyClientResponse(q, r, users, now, deps?): Promise<void>`; actions `submitScopeSelection(id, token, input)`,
  `askQuestion(id, token, input)`; islands `ScopeSelection({ id, token, scopes, creditNote })`, `QuestionForm({ id, token })`;
  `buildPackageSlots(x, ctx: { id: string; token: string; canAct: boolean; creditNote: string | null })`.

- [ ] **Step 1: Write the failing harness block.** Append:

```ts
/* ======================================================================
   #301 slice C — client actions (D-m, D-n, R1, R15, R16): two server
   actions that re-verify the v2 token, the pinned rev = latest sent and
   canAct on every submit; per-IP 5/10 min + per-quote 30/day; a honeypot;
   a system note on the quote + customer, a system activity on the lead,
   one task per assignee; no status change. Two JS-only islands.
   ====================================================================== */
{
  const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const srv = rd("src/lib/estimate-output/responses-server.ts");
  const sub = srv.slice(srv.indexOf("export async function submitClientResponse("), srv.indexOf("export async function notifyClientResponse("));
  const order = ["o.website", "RESPONSE_IP_LIMIT", "resolveSharedPackage(", "canAct(hit.state)", "RESPONSE_QUOTE_LIMIT", "sanitizeClientResponse(", "appendClientResponse(", "notify("].map((s) => sub.indexOf(s));
  ok(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), `#301 actions: honeypot → IP limit → token → canAct → quote limit → sanitize → append → notify (${order.join(",")})`);
  ok(!/\b(setStatus|update|setQuoteStage|patchShareLink)\(/.test(srv) && srv.includes('type: "system"') && srv.includes('parentKind: "quote"') && srv.includes("system: true") &&
     srv.includes("responseAssignees(q.owner, q.preparedBy, users)"),
    "#301 actions: never a status or stage write; a system note (R15), a system lead activity, a task per R16 assignee");
  const acts = rd("src/app/share/quote/[id]/[token]/actions.ts");
  ok(/^"use server";/.test(acts) && !/^export (?!async function)/m.test(acts) && acts.includes('submitClientResponse("accept", String(id || ""), String(token || ""), input, ip)') &&
     acts.includes('submitClientResponse("question", String(id || ""), String(token || ""), input, ip)') && (acts.match(/clientIpFromHeaders\(await headers\(\)\)/g) || []).length >= 3 &&
     (acts.match(/catch \(e\)/g) || []).length >= 3,
    "#301 actions: two public actions keyed on the client IP, never throwing; only async exports");
  for (const f of ["scope-selection.tsx", "question-form.tsx"]) {
    const src = rd("src/app/share/quote/[id]/[token]/" + f);
    ok(/^"use client";/.test(src) && src.includes("useSyncExternalStore(") && src.includes('method="post"') && src.includes("e.preventDefault()") &&
       src.includes('name="website"') && src.includes("CLIENT_ACTION_COPY.noJs") && src.includes('from "./actions"') && (src.match(/catch \{/g) || []).length >= 1 &&
       !/^import (?!type)[^\n]*from "@\/(lib\/(stores|blob|session|users|settings|quote-share|quote-pdf)|db)\//m.test(src) && !src.includes("confirm("),
      `#301 actions: ${f} renders only after hydration, posts through the server action, has a honeypot, imports nothing server-side`);
  }
  const sel = rd("src/app/share/quote/[id]/[token]/scope-selection.tsx");
  ok(sel.includes("CLIENT_ACTION_COPY.selectedTotal") && sel.includes("creditNote") && sel.includes("selectedTotal(scopes.filter("),
    "#301 actions: the live \"Selected scopes\" total (pre-credit) and the Rewards credit note (R1)");
  const slots = rd("src/app/share/quote/[id]/[token]/package-slots.tsx");
  ok(slots.includes("x.actions && ctx.canAct") && rd("src/app/share/quote/[id]/[token]/package-page.tsx").includes("canAct: canAct(hit.state)"),
    "#301 actions: the forms show only when the page can act (latest sent revision of a sent quote)");
}

async function e301cActionsAsyncChecks(): Promise<void> {
  const { fixtureId } = await import("./test-fixtures");
  const Q = await import("@/lib/stores/quotes");
  const L = await import("@/lib/quote-share/links");
  const R = await import("@/lib/estimate-output/responses-server");
  const T = await import("@/lib/stores/tasks");
  const N = await import("@/lib/stores/notes");
  const S = "test-secret-301ca";
  const QID = fixtureId(301, "c-actions");
  const sec = (id: string, name: string, price: number) => ({ id, name, kind: "materials", mfr: "", freightPct: 0, items: [{ id: 1, sku: "A-" + id, desc: name, qty: 1, unit: "ea", cost: 1, price }] });
  await Q.create({ id: QID, name: "#301c actions", customer: "Spec fixture", customerId: null, owner: "Lead 301C", quoteType: "system", source: "estimator",
    spec: { sections: [sec("s1", "Lighting", 28500), sec("s2", "Rigging", 19750)], mobs: [] } });
  registerFixture("quotes", QID);
  await Q.update(QID, { status: "sent" });
  await Q.addQuoteRevision(QID, { by: "Test", reason: "sent" });
  const made = await L.ensureShareLink(QID, "Tester", { secret: S });
  const tok = made.ok && made.link.pathV2 ? made.link.pathV2.split("/").pop()! : "";
  const users = [{ id: "u-301c", name: "Lead 301C", status: "active", roles: ["Estimator"] }];
  const calls: string[] = [];
  const notify = async (_q: unknown, r: { kind: string; total: number }) => { calls.push(`${r.kind}:${r.total}`); };
  const salt = String(Date.now() % 100_000);
  const deps = { secret: S, users: async () => users, notify };
  const acc = await R.submitClientResponse("accept", QID, tok, { name: "Pat Doe", email: "pat@school.org", sectionIds: ["s2", "s1", "bogus"] }, "203.0.113.1-" + salt, deps);
  const q1 = (await Q.get(QID))!;
  ok(acc.ok && acc.confirmation === "Thanks — Lead 301C has been notified." && q1.status === "sent" && q1.clientResponses?.length === 1 &&
     q1.clientResponses[0].total === 48250 && q1.clientResponses[0].sectionNames.join() === "Lighting,Rigging" && calls.join() === "accept:48250",
    "#301 actions (DB): a selection is stored with the server's own total, the lead estimator is named, the status stays sent");
  const hp = await R.submitClientResponse("question", QID, tok, { name: "Bot", message: "spam", website: "http://spam" }, "203.0.113.2-" + salt, deps);
  ok(hp.ok && (await Q.get(QID))!.clientResponses?.length === 1 && calls.length === 1, "#301 actions (DB): a honeypot hit looks fine and writes nothing");
  const ip = "203.0.113.3-" + salt;
  const burst = [];
  for (let i = 0; i < 6; i++) burst.push(await R.submitClientResponse("question", QID, tok, { name: "Q", message: "Hi " + i }, ip, deps));
  ok(burst.slice(0, 5).every((r) => r.ok) && !burst[5].ok && (burst[5] as { error: string }).error === "Too many submissions — try again later.",
    "#301 actions (DB): 5 per IP per 10 minutes");
  const v1 = made.ok && made.link.path ? made.link.path.split("/").pop()! : "";
  const bad = await R.submitClientResponse("question", QID, v1, { name: "Q", message: "v1" }, "203.0.113.4-" + salt, deps);
  await Q.addQuoteRevision(QID, { by: "Test", reason: "sent" }); // supersedes rev 1
  const sup = await R.submitClientResponse("question", QID, tok, { name: "Q", message: "old" }, "203.0.113.5-" + salt, deps);
  ok(!bad.ok && !sup.ok && (sup as { error: string }).error.startsWith("A newer version of this estimate was sent"),
    "#301 actions (DB): a v1 link and a superseded revision take no response");
  // The real side effects (R15, R16): a system note on the quote, a task to the assignee; no lead → no activity.
  const q2 = (await Q.get(QID))!;
  const r0 = q2.clientResponses![0];
  await R.notifyClientResponse(q2, r0, users, Date.UTC(2026, 9, 5, 15));
  const tasks = (await T.tasksForQuote(QID)).filter((t) => t.assigneeUserId === "u-301c");
  const notes = (await N.allNotes()).filter((n) => n.parentKind === "quote" && n.parentId === QID);
  for (const t of tasks) registerFixture("tasks", t.id);
  for (const n of notes) registerFixture("notes", n.id);
  ok(tasks.length === 1 && /^Client accepted EST-\d+ Rev 1 — Lighting, Rigging \(\$48,250\.00\)$/.test(tasks[0].title) && tasks[0].dueAt === Date.UTC(2026, 9, 6, 4, 59) &&
     notes.length === 1 && notes[0].system && notes[0].by === "Client link" && notes[0].text.includes("$48,250.00 before any Rewards credit"),
    "#301 actions (DB): one task to the lead estimator due tonight, one system note naming the scopes and pre-credit total");
  const seen: string[] = [];
  await R.notifyClientResponse({ ...q2, leadId: "L-301C", owner: "Nobody" }, r0, [...users, { id: "u-a", name: "Approver", status: "active", roles: ["Manager"] }], Date.now(), {
    addNote: async () => { seen.push("note"); throw new Error("note down"); },
    logActivity: async (leadId: string, a: { type?: string }) => { seen.push(`act:${leadId}:${a.type}`); return null; },
    createTask: async (t: { assigneeUserId?: string | null }) => { seen.push(`task:${t.assigneeUserId}`); return {} as never; },
  });
  ok(seen.join() === "note,act:L-301C:system,task:u-a", "#301 actions (DB): a failing step never stops the rest; the lead gets a system activity; no lead estimator → every active approver");
}
```

  Append `await e301cActionsAsyncChecks();` to `estimateOutput301CAsyncChecks`'s body.

- [ ] **Step 2: Run it to verify it fails.**

- [ ] **Step 3: Create `src/lib/estimate-output/responses-server.ts`.**

```ts
import { displayQuoteNumber } from "@/lib/estimate-number";
import { canAct } from "@/lib/quote-share/package-view";
import { resolveSharedPackage } from "@/lib/quote-share/links";
import { revisionSections } from "@/lib/quote-share/photo-response";
import { sentDocumentStamp } from "@/lib/quote-share/view";
import { rateLimit } from "@/lib/rate-limit";
import { logActivity } from "@/lib/stores/leads";
import { addNoteRecord } from "@/lib/stores/notes";
import { appendClientResponse, type Quote } from "@/lib/stores/quotes";
import { createTask } from "@/lib/stores/tasks";
import { allUsers } from "@/lib/users";
import {
  chicagoDayEnd, CLIENT_ACTION_COPY, CLIENT_LINK_ACTOR, confirmationText, leadEstimator, newResponseId, PEAK_NAME, RESPONSE_IP_LIMIT,
  RESPONSE_IP_WINDOW_MS, RESPONSE_QUOTE_LIMIT, RESPONSE_QUOTE_WINDOW_MS, responseAssignees, responseNoteText, responseScopes, responseTaskTitle,
  sanitizeClientResponse, type ClientActionResult, type ClientResponse, type ClientResponseKind, type RosterUser,
} from "./responses";

/**
 * #301 slice C (D-m, D-n, R15, R16) — a client's scope selection or question
 * from the package page. Every submit re-verifies: the v2 token, the pinned
 * revision is the latest sent one and the quote is `sent` (canAct; the store
 * re-checks under the row lock), then the per-IP and per-quote limits, the
 * honeypot and the field caps. Side effects are best-effort after the
 * write. Status never changes (decision 11). No cookies. Server-only.
 */

type SubmitDeps = {
  secret?: string;
  now?: () => number;
  users?: () => Promise<RosterUser[]>;
  notify?: (q: Quote, r: ClientResponse, users: RosterUser[], now: number) => Promise<void>;
};

export async function submitClientResponse(kind: ClientResponseKind, id: string, token: string, input: unknown, ip: string, deps: SubmitDeps = {}): Promise<ClientActionResult> {
  const o = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  // Honeypot: a filled hidden field looks like a success and writes nothing (adaptation 14).
  if (typeof o.website === "string" && o.website.trim()) return { ok: true, confirmation: confirmationText(PEAK_NAME) };
  if (!rateLimit(`share-respond-ip:${ip || "unknown"}`, RESPONSE_IP_LIMIT, RESPONSE_IP_WINDOW_MS).ok) return { ok: false, error: CLIENT_ACTION_COPY.tooMany };
  const now = (deps.now ?? Date.now)();
  const hit = await resolveSharedPackage(id, token, { secret: deps.secret, now });
  if (!hit) return { ok: false, error: CLIENT_ACTION_COPY.inactive };
  if (!canAct(hit.state)) return { ok: false, error: hit.state.kind === "superseded" ? CLIENT_ACTION_COPY.superseded : CLIENT_ACTION_COPY.closed };
  if (!rateLimit(`share-respond-quote:${hit.q.id}`, RESPONSE_QUOTE_LIMIT, RESPONSE_QUOTE_WINDOW_MS).ok) return { ok: false, error: CLIENT_ACTION_COPY.tooMany };
  const clean = sanitizeClientResponse(kind, o, responseScopes(revisionSections(hit.rev)));
  if (!clean.ok) return clean;
  const res = await appendClientResponse(hit.q.id, hit.rev.rev, clean.value, now, newResponseId());
  if (!res.ok) return { ok: false, error: res.reason === "full" ? CLIENT_ACTION_COPY.full : res.reason === "state" ? CLIENT_ACTION_COPY.closed : CLIENT_ACTION_COPY.inactive };
  let users: RosterUser[] = [];
  try {
    users = await (deps.users ?? allUsers)();
  } catch (e) {
    console.error("[client-response] roster unavailable", e instanceof Error ? e.message : e);
  }
  const notify = deps.notify ?? notifyClientResponse;
  try {
    await notify(hit.q, res.response, users, now);
  } catch (e) {
    console.error("[client-response] notify failed", e instanceof Error ? e.message : e);
  }
  return { ok: true, confirmation: confirmationText(leadEstimator(hit.q.owner, hit.q.preparedBy, users)?.name ?? null) };
}

type NotifyDeps = {
  addNote: (input: Parameters<typeof addNoteRecord>[0], me: string) => Promise<unknown>;
  logActivity: (leadId: string, a: { type?: string; by?: string; at?: number; note?: string }, me: string) => Promise<unknown>;
  createTask: (input: Parameters<typeof createTask>[0], me: { id: string; name: string }) => Promise<unknown>;
};

const liveNotify: NotifyDeps = { addNote: addNoteRecord, logActivity, createTask };

/** R15 + R16: a system note on the quote (customer timeline), a system
 *  activity on the lead (never `note` — that stamps firstContactAt), one
 *  task per assignee. Each step on its own: one failing never stops the rest. */
export async function notifyClientResponse(q: Quote, r: ClientResponse, users: RosterUser[], now: number, deps: Partial<NotifyDeps> = {}): Promise<void> {
  const d: NotifyDeps = { ...liveNotify, ...deps };
  const number = displayQuoteNumber(q);
  const rev = (q.revisions || []).find((x) => x.rev === r.rev);
  const revNo = rev ? sentDocumentStamp(q, rev).revNo : r.rev;
  const text = responseNoteText(r, number, revNo);
  const steps: Array<() => Promise<unknown>> = [
    () => d.addNote({ parentKind: "quote", parentId: q.id, customerId: q.customerId ?? null, text, system: true }, CLIENT_LINK_ACTOR),
    ...(q.leadId ? [() => d.logActivity(q.leadId as string, { type: "system", by: CLIENT_LINK_ACTOR, at: now, note: text }, CLIENT_LINK_ACTOR)] : []),
    ...responseAssignees(q.owner, q.preparedBy, users).map((u) => () =>
      d.createTask(
        {
          title: responseTaskTitle(r, number, revNo),
          section: "Review",
          quoteId: q.id,
          assigneeUserId: u.id,
          assigneeName: u.name,
          dueAt: chicagoDayEnd(now),
          notes: text,
          ...(q.customerId ? { customerId: q.customerId } : {}),
          ...(q.leadId ? { leadId: q.leadId } : {}),
        },
        { id: "system", name: CLIENT_LINK_ACTOR }
      )
    ),
  ];
  for (const step of steps) {
    try {
      await step();
    } catch (e) {
      console.error("[client-response] side effect failed", e instanceof Error ? e.message : e);
    }
  }
}
```

  `logActivity`'s third parameter is `me` (`stores/leads.ts:576`); `by` in the input wins over it. If the real
  `LogActivityInput` type rejects the literal, cast the `type` as `"system"`.

- [ ] **Step 4: `src/app/share/quote/[id]/[token]/actions.ts`.** Add imports:

```ts
import { submitClientResponse } from "@/lib/estimate-output/responses-server";
import { CLIENT_ACTION_COPY, type ClientActionResult } from "@/lib/estimate-output/responses";
```

  Append:

```ts
/** D-m — "Submit selection". JS-only (Slice B adaptation 9: a fetch-mode
 *  action keeps a real Origin under no-referrer). Never throws. */
export async function submitScopeSelection(id: string, token: string, input: unknown): Promise<ClientActionResult> {
  try {
    const ip = clientIpFromHeaders(await headers()) || "unknown";
    return await submitClientResponse("accept", String(id || ""), String(token || ""), input, ip);
  } catch (e) {
    console.error("[share] selection not recorded", e instanceof Error ? e.message : e);
    return { ok: false, error: CLIENT_ACTION_COPY.failed };
  }
}

/** D-m — "Ask a question or request changes". Never throws. */
export async function askQuestion(id: string, token: string, input: unknown): Promise<ClientActionResult> {
  try {
    const ip = clientIpFromHeaders(await headers()) || "unknown";
    return await submitClientResponse("question", String(id || ""), String(token || ""), input, ip);
  } catch (e) {
    console.error("[share] question not recorded", e instanceof Error ? e.message : e);
    return { ok: false, error: CLIENT_ACTION_COPY.failed };
  }
}
```

  Update the file's doc comment: replace "Slice C adds submitScopeSelection / askQuestion here." with "Slice C:
  submitScopeSelection / askQuestion (responses-server.ts re-verifies everything per submit)."

- [ ] **Step 5: Create `src/app/share/quote/[id]/[token]/scope-selection.tsx`.**

```tsx
"use client";

import { useState, useSyncExternalStore, useTransition, type CSSProperties, type FormEvent } from "react";
import { fmt } from "@/app/(app)/estimator/pricing";
import { CLIENT_ACTION_COPY, selectedTotal, type ClientActionResult, type ResponseScope } from "@/lib/estimate-output/responses";
import { submitScopeSelection } from "./actions";

/**
 * #301 slice C (spec §7, R1) — "Choose your scopes": a checkbox per scope
 * (all checked), the live "Selected scopes" total (pre-credit) with the
 * Rewards credit note, name / title / email / note, Submit selection. It
 * renders only after hydration (adaptation 13): without JS there is no form
 * to post a name into a URL. Receives only scope ids, names and prices.
 */

const subscribeNothing = () => () => {};
const input: CSSProperties = { width: "100%", boxSizing: "border-box", font: "inherit", fontSize: 14, padding: "8px 10px", border: "1px solid #d5d9e0", borderRadius: 8 };
const hidden: CSSProperties = { position: "absolute", left: -10000, width: 1, height: 1, overflow: "hidden" };
const btn: CSSProperties = { font: "inherit", fontWeight: 700, fontSize: 14, color: "#fff", background: "var(--accent)", border: "none", borderRadius: 8, padding: "10px 18px", cursor: "pointer" };

export function ScopeSelection({ id, token, scopes, creditNote }: { id: string; token: string; scopes: ResponseScope[]; creditNote: string | null }) {
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const [picked, setPicked] = useState<string[]>(() => scopes.map((s) => s.id));
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [website, setWebsite] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const total = selectedTotal(scopes.filter((s) => picked.includes(s.id)));

  if (!hydrated) return <p className="pkg-muted">{CLIENT_ACTION_COPY.noJs}</p>;
  if (done)
    return (
      <div role="status" className="pkg-goals">
        {done}
      </div>
    );

  const toggle = (sid: string) => setPicked((cur) => (cur.includes(sid) ? cur.filter((x) => x !== sid) : [...cur, sid]));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    start(async () => {
      let r: ClientActionResult;
      try {
        r = await submitScopeSelection(id, token, { name, title, email, message: note, sectionIds: picked, website });
      } catch {
        setErr(CLIENT_ACTION_COPY.failed);
        return;
      }
      if (r.ok) setDone(r.confirmation);
      else setErr(r.error);
    });
  };

  return (
    <form method="post" onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <p className="pkg-muted" style={{ margin: 0 }}>
        {CLIENT_ACTION_COPY.chooseHelp}
      </p>
      {scopes.map((s) => (
        <label key={s.id} className="pkg-row" style={{ alignItems: "center", cursor: "pointer" }}>
          <span>
            <input type="checkbox" checked={picked.includes(s.id)} onChange={() => toggle(s.id)} style={{ marginRight: 8 }} />
            {s.name}
          </span>
          <span className="pkg-price">{s.priceLabel}</span>
        </label>
      ))}
      <div className="pkg-row pkg-total" aria-live="polite">
        <span>{CLIENT_ACTION_COPY.selectedTotal}</span>
        <span>{fmt(total)}</span>
      </div>
      {creditNote && <div className="pkg-muted">{creditNote}</div>}
      <input aria-label={CLIENT_ACTION_COPY.name} placeholder={CLIENT_ACTION_COPY.name} required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} style={input} />
      <input aria-label={CLIENT_ACTION_COPY.title} placeholder={CLIENT_ACTION_COPY.title} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} style={input} />
      <input aria-label={CLIENT_ACTION_COPY.email} placeholder={CLIENT_ACTION_COPY.email} type="email" maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} style={input} />
      <textarea aria-label={CLIENT_ACTION_COPY.note} placeholder={CLIENT_ACTION_COPY.note} maxLength={4000} rows={3} value={note} onChange={(e) => setNote(e.target.value)} style={input} />
      <div aria-hidden="true" style={hidden}>
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
      </div>
      {err && (
        <div role="alert" style={{ color: "#a33a2b", fontSize: 13 }}>
          {err}
        </div>
      )}
      <button type="submit" disabled={pending || !picked.length} style={{ ...btn, opacity: pending || !picked.length ? 0.6 : 1, alignSelf: "flex-start" }}>
        {pending ? CLIENT_ACTION_COPY.sending : CLIENT_ACTION_COPY.submitSelection}
      </button>
    </form>
  );
}
```

  `fmt` comes from `estimator/pricing.ts`, a client-safe module the Estimator's client already imports.

- [ ] **Step 6: Create `src/app/share/quote/[id]/[token]/question-form.tsx`.**

```tsx
"use client";

import { useState, useSyncExternalStore, useTransition, type CSSProperties, type FormEvent } from "react";
import { CLIENT_ACTION_COPY, type ClientActionResult } from "@/lib/estimate-output/responses";
import { askQuestion } from "./actions";

/** #301 slice C (spec §7) — "Ask a question or request changes". Hydration-only, like ScopeSelection. */

const subscribeNothing = () => () => {};
const input: CSSProperties = { width: "100%", boxSizing: "border-box", font: "inherit", fontSize: 14, padding: "8px 10px", border: "1px solid #d5d9e0", borderRadius: 8 };
const hidden: CSSProperties = { position: "absolute", left: -10000, width: 1, height: 1, overflow: "hidden" };
const btn: CSSProperties = { font: "inherit", fontWeight: 700, fontSize: 14, color: "#16181d", background: "#f1f2f5", border: "none", borderRadius: 8, padding: "10px 18px", cursor: "pointer" };

export function QuestionForm({ id, token }: { id: string; token: string }) {
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!hydrated) return <p className="pkg-muted">{CLIENT_ACTION_COPY.noJs}</p>;
  if (done)
    return (
      <div role="status" className="pkg-goals">
        {done}
      </div>
    );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    start(async () => {
      let r: ClientActionResult;
      try {
        r = await askQuestion(id, token, { name, email, message, website });
      } catch {
        setErr(CLIENT_ACTION_COPY.failed);
        return;
      }
      if (r.ok) setDone(r.confirmation);
      else setErr(r.error);
    });
  };

  return (
    <form method="post" onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <input aria-label={CLIENT_ACTION_COPY.name} placeholder={CLIENT_ACTION_COPY.name} required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} style={input} />
      <input aria-label={CLIENT_ACTION_COPY.email} placeholder={CLIENT_ACTION_COPY.email} type="email" maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} style={input} />
      <textarea aria-label={CLIENT_ACTION_COPY.message} placeholder={CLIENT_ACTION_COPY.message} required maxLength={4000} rows={4} value={message} onChange={(e) => setMessage(e.target.value)} style={input} />
      <div aria-hidden="true" style={hidden}>
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
      </div>
      {err && (
        <div role="alert" style={{ color: "#a33a2b", fontSize: 13 }}>
          {err}
        </div>
      )}
      <button type="submit" disabled={pending} style={{ ...btn, opacity: pending ? 0.6 : 1, alignSelf: "flex-start" }}>
        {pending ? CLIENT_ACTION_COPY.sending : CLIENT_ACTION_COPY.send}
      </button>
    </form>
  );
}
```

- [ ] **Step 7: Wire the scopes and the slot.** In `package-extras.ts`, import `responseScopes` and `revisionSections`
  (`@/lib/quote-share/photo-response`) and, after the plans line, add:

```ts
  // The choosable scopes (ids, names, prices) — the forms show only when the page can act (package-slots).
  extras.actions = { scopes: responseScopes(revisionSections(hit.rev)) };
```

  In `package-slots.tsx`, import `CLIENT_ACTION_COPY`, `ScopeSelection` (`./scope-selection`) and `QuestionForm`
  (`./question-form`), change the signature to
  `export function buildPackageSlots(x: PackageExtras, ctx: { id: string; token: string; canAct: boolean; creditNote: string | null }): PackageSlots`,
  and add to the returned object:

```tsx
    ...(x.actions && ctx.canAct
      ? {
          actions: (
            <>
              <div className="pkg-card">
                <h2>{CLIENT_ACTION_COPY.chooseTitle}</h2>
                <ScopeSelection id={ctx.id} token={ctx.token} scopes={x.actions.scopes} creditNote={ctx.creditNote} />
              </div>
              <div className="pkg-card" style={{ marginTop: 14 }}>
                <h2>{CLIENT_ACTION_COPY.askTitle}</h2>
                <QuestionForm id={ctx.id} token={ctx.token} />
              </div>
            </>
          ),
        }
      : {}),
```

  In `package-page.tsx`, import `canAct` (`@/lib/quote-share/package-view`) and `creditNoteText`
  (`@/lib/estimate-output/responses`), and change the slots line to:

```tsx
  const slots = buildPackageSlots(await loadPackageExtras(hit, base), {
    id: hit.q.id,
    token,
    canAct: canAct(hit.state),
    creditNote: creditNoteText(model.totals.creditAmount),
  });
```

- [ ] **Step 8: Run the gates.** tsc 0; test:specs PASS = previous + 7 sync + 6 DB (Slice B's `#301 slice B — opens` block
  still passes — `actions.ts` keeps `recordShareOpenAction` and its own checks); eslint on the 7 files; `next build` OK.
  `next build` is the gate that catches an island pulling a server module.

- [ ] **Step 9: Commit.**

```bash
git add src/lib/estimate-output/responses-server.ts "src/app/share/quote/[id]/[token]/actions.ts" "src/app/share/quote/[id]/[token]/scope-selection.tsx" \
  "src/app/share/quote/[id]/[token]/question-form.tsx" src/lib/estimate-output/package-extras.ts "src/app/share/quote/[id]/[token]/package-slots.tsx" \
  "src/app/share/quote/[id]/[token]/package-page.tsx" scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(share): #301 slice C — client actions: choose scopes (live total) + ask a question; note, lead activity, task; status untouched

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 8: Staff panel — Drawings, Responses, gap chips, Rebuild package

**Files:**
- Create: `src/lib/estimate-output/package-panel-server.ts`, `src/app/(app)/estimator/package-staff-panel.tsx`
- Modify: `src/app/(app)/estimator/package-actions.ts` (`packagePanelAction`, `rebuildPackageZipAction`),
  `src/app/(app)/estimator/client-link-panel.tsx` (one import, one mount line, one doc-comment sentence)
- Test: harness block `#301 slice C — staff panel`; `e301cPanelAsyncChecks`

**Interfaces:**
- **Consumes:** Task 1 (`cleanPackageFiles`, `packageFileRows`, `visiblePackageFiles`, `PACKAGE_FILE_*`); Task 2
  (`responseRows`, `packageGapChips`, `keyProductsNeedingText`, `scopesWithoutGoals`); Task 4 (`datasheetGapCount`);
  Task 5 (`clearPackageZipCache`); Task 6 (`putPackageFile`, `addPackageFileAction`, `removePackageFileAction`);
  `blobEnabled`; `sentDocumentStamp`.
- **Produces** (Task 9): `type PackagePanel = { canSend: boolean; uploads: boolean; files: PackageFileRow[]; responses: ResponseRow[]; gaps: string[] }`;
  `loadPackagePanel(q, canSend, deps?): Promise<PackagePanel>`; `packagePanelAction(quoteId)` →
  `{ ok: true; panel: PackagePanel } | { ok: false; error: string }`; `rebuildPackageZipAction(quoteId)` →
  `{ ok: true; removed: number } | { ok: false; error: string }`; `PackageStaffPanel({ quoteId })`.

- [ ] **Step 1: Write the failing harness block.** Append:

```ts
/* ======================================================================
   #301 slice C — staff panel: the Client link panel gains the package's
   staff side — gap chips (decision 13: staff-only), Drawings (list,
   Upload…, remove behind an inline confirm), client responses newest
   first, and Rebuild package. A separate client component, mounted by one
   line, so the #293 panel pins stay put.
   ====================================================================== */
{
  const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const panel = rd("src/app/(app)/estimator/package-staff-panel.tsx");
  ok(/^"use client";/.test(panel) && panel.includes('data-testid="package-staff"') && panel.includes('data-testid="package-gaps"') && panel.includes('data-testid="package-responses"') &&
     panel.includes("putPackageFile(file, quoteId)") && panel.indexOf("putPackageFile(file, quoteId)") < panel.indexOf("addPackageFileAction(") &&
     panel.includes("rebuildPackageZipAction(") && panel.includes("removePackageFileAction(") && !panel.includes("confirm(") && (panel.match(/catch \{/g) || []).length >= 4 &&
     !/^import (?!type)[^\n]*from "@\/(lib\/(stores|blob|session|users|settings)|db)\//m.test(panel) && !panel.includes("estimate-files/"),
    "#301 panel: a client component — upload to Blob then finalize, remove with an inline confirm, rebuild; no server import; never builds a storage path itself");
  const clp = rd("src/app/(app)/estimator/client-link-panel.tsx");
  ok(clp.includes('import { PackageStaffPanel } from "./package-staff-panel";') && clp.includes("<PackageStaffPanel quoteId={quoteId} />") &&
     (clp.match(/await reload\(\);/g) || []).length >= 4 && (clp.match(/catch \{/g) || []).length >= 3,
    "#301 panel: the Client link panel mounts it in one line; its own #293 shape is unchanged");
  const acts = rd("src/app/(app)/estimator/package-actions.ts");
  const read = acts.slice(acts.indexOf("export async function packagePanelAction("));
  ok(read.indexOf("await requireUser();") < read.indexOf("getQuote(") && read.includes('loadPackagePanel(q, can("send", user.roles))') &&
     acts.slice(acts.indexOf("export async function rebuildPackageZipAction(")).includes("clearPackageZipCache(q.id)"),
    "#301 panel: any signed-in user reads the panel (Send decides the buttons); Rebuild clears this quote's cached zips");
}

async function e301cPanelAsyncChecks(): Promise<void> {
  const { fixtureId } = await import("./test-fixtures");
  const Q = await import("@/lib/stores/quotes");
  const P = await import("@/lib/estimate-output/package-panel-server");
  const QID = fixtureId(301, "c-panel");
  const items = [{ id: 1, sku: "A", desc: "A", qty: 1, unit: "ea", cost: 1, price: 2 }, { id: 2, sku: "B", desc: "B", qty: 1, unit: "ea", cost: 1, price: 2 }];
  await Q.create({ id: QID, name: "#301c panel", customer: "Spec fixture", owner: "spec", quoteType: "system", source: "estimator",
    spec: { sections: [
      { id: "s1", name: "Lighting", kind: "materials", mfr: "", freightPct: 0, clientGoals: "", keyProducts: [{ lineKey: "1", sku: "A", text: "", photo: true }], items },
      { id: "s2", name: "Rigging", kind: "materials", mfr: "", freightPct: 0, clientGoals: "Safe flying.", items },
    ], mobs: [] } });
  registerFixture("quotes", QID);
  const deps = { datasheetGaps: async () => 2, uploads: () => false };
  const p1 = await P.loadPackagePanel((await Q.get(QID))!, false, deps);
  ok(p1.gaps.join("|") === "2 parts without a datasheet|No drawings|1 key product needs a paragraph|No client goals on 1 scope" && !p1.canSend && !p1.uploads && p1.files.length === 0 && p1.responses.length === 0,
    "#301 panel (DB): the four gap chips from the live quote; Send and storage flags pass through");
  await Q.addPackageFile(QID, { id: "PF-0000000301c1", kind: "plan", name: "Plan.pdf", blobPath: `estimate-files/${QID}/UP-0123456789abcdef/p.pdf`, contentType: "application/pdf", size: 10, source: "upload", addedAt: 1, addedBy: "T" });
  await Q.update(QID, { status: "sent" });
  await Q.addQuoteRevision(QID, { by: "Test", reason: "sent" });
  const base = { kind: "question" as const, name: "Pat", email: "", message: "Q", sectionIds: [], sectionNames: [], total: 0 };
  await Q.appendClientResponse(QID, 1, base, Date.UTC(2026, 9, 5, 15), "CR-0000000301c1");
  await Q.appendClientResponse(QID, 1, { ...base, message: "Later" }, Date.UTC(2026, 9, 6, 15), "CR-0000000301c2");
  const p2 = await P.loadPackagePanel((await Q.get(QID))!, true, { ...deps, datasheetGaps: async () => { throw new Error("down"); } });
  ok(!p2.gaps.includes("No drawings") && !p2.gaps.some((g) => g.includes("datasheet")) && p2.files[0]?.name === "Plan.pdf" && p2.canSend &&
     p2.responses.map((r) => r.message).join() === "Later,Q" && p2.responses[0].revLabel === "Rev 1",
    "#301 panel (DB): a drawing clears \"No drawings\"; a failed datasheet count shows no chip; responses newest first as Rev N");
}
```

  Append `await e301cPanelAsyncChecks();` to `estimateOutput301CAsyncChecks`'s body.

- [ ] **Step 2: Run it to verify it fails.**

- [ ] **Step 3: Create `src/lib/estimate-output/package-panel-server.ts`.**

```ts
import type { SpecSection } from "@/app/(app)/estimator/types";
import { blobEnabled } from "@/lib/blob";
import { sentDocumentStamp } from "@/lib/quote-share/view";
import type { Quote } from "@/lib/stores/quotes";
import { datasheetGapCount } from "./package-docs-server";
import { keyProductsNeedingText, packageGapChips, scopesWithoutGoals } from "./package-gaps";
import { cleanPackageFiles, packageFileRows, visiblePackageFiles, type PackageFileRow } from "./package-files";
import { responseRows, type ResponseRow } from "./responses";

/**
 * #301 slice C (spec §6, §7) — the staff side of the Client link panel:
 * gap chips from the LIVE quote (the next send — Slice C adaptation 10),
 * the drawings list (never a blob path), and client responses newest first
 * as "Rev N". Server-only. `deps` exists for the spec harness.
 */

export type PackagePanel = { canSend: boolean; uploads: boolean; files: PackageFileRow[]; responses: ResponseRow[]; gaps: string[] };

type PanelDeps = { datasheetGaps: (spec: unknown) => Promise<number>; uploads: () => boolean };
const liveDeps: PanelDeps = { datasheetGaps: datasheetGapCount, uploads: blobEnabled };

function liveSections(q: Quote): SpecSection[] {
  const s = q.spec as { sections?: unknown } | null | undefined;
  return s && Array.isArray(s.sections) ? (s.sections as SpecSection[]) : [];
}

export async function loadPackagePanel(q: Quote, canSend: boolean, deps: Partial<PanelDeps> = {}): Promise<PackagePanel> {
  const d: PanelDeps = { ...liveDeps, ...deps };
  const sections = liveSections(q);
  const files = cleanPackageFiles(q.packageFiles);
  let noDatasheet = 0;
  try {
    noDatasheet = await d.datasheetGaps(q.spec);
  } catch (e) {
    console.warn("[package] datasheet gap count failed", e instanceof Error ? e.message : e);
  }
  const revNoOf = (rev: number) => {
    const r = (q.revisions || []).find((x) => x.rev === rev);
    return r ? sentDocumentStamp(q, r).revNo : rev;
  };
  return {
    canSend,
    uploads: d.uploads(),
    files: packageFileRows(files),
    responses: responseRows(q.clientResponses, revNoOf),
    gaps: packageGapChips({
      noDatasheet,
      drawings: visiblePackageFiles(files).length,
      keyProductsNeedText: keyProductsNeedingText(sections),
      scopesNoGoals: scopesWithoutGoals(sections),
    }),
  };
}
```

- [ ] **Step 4: `package-actions.ts`.** Add imports:

```ts
import { clearPackageZipCache } from "@/lib/estimate-output/package-zip-server";
import { loadPackagePanel, type PackagePanel } from "@/lib/estimate-output/package-panel-server";
import { get as getQuote } from "@/lib/stores/quotes";
```

  Append:

```ts
/** The panel's read: any signed-in user; Send decides which buttons work. */
export async function packagePanelAction(quoteId: string): Promise<{ ok: true; panel: PackagePanel } | { ok: false; error: string }> {
  const user = await requireUser();
  try {
    const q = await getQuote(String(quoteId || ""));
    if (!q) return { ok: false, error: ONLINE_COPY.gone };
    return { ok: true, panel: await loadPackagePanel(q, can("send", user.roles)) };
  } catch (e) {
    console.error("[package] panel read failed", e);
    return { ok: false, error: PACKAGE_FILES_COPY.failed };
  }
}

/** R10 — "Rebuild package": the next download builds a fresh zip. */
export async function rebuildPackageZipAction(quoteId: string): Promise<{ ok: true; removed: number } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can("send", user.roles)) return { ok: false, error: ONLINE_COPY.needsSend };
  try {
    const q = await getQuote(String(quoteId || ""));
    if (!q) return { ok: false, error: ONLINE_COPY.gone };
    return { ok: true, removed: await clearPackageZipCache(q.id) };
  } catch (e) {
    console.error("[package] rebuild failed", e);
    return { ok: false, error: PACKAGE_FILES_COPY.failed };
  }
}
```

- [ ] **Step 5: Create `src/app/(app)/estimator/package-staff-panel.tsx`.**

```tsx
"use client";

import { useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import { addPackageFileAction, packagePanelAction, rebuildPackageZipAction, removePackageFileAction } from "./package-actions";
import { putPackageFile } from "./package-file-upload";
import { PACKAGE_FILE_ACCEPT, PACKAGE_FILE_KIND_LABEL, PACKAGE_FILE_KINDS, PACKAGE_FILES_COPY, type PackageFileKind } from "@/lib/estimate-output/package-files";
import type { PackagePanel } from "@/lib/estimate-output/package-panel-server";

/**
 * #301 slice C — the package's staff side under the Client link block:
 * gap chips (staff-only, decision 13), Drawings (Upload… straight to Blob,
 * remove behind an inline confirm), client responses newest first, and
 * Rebuild package. Reads its own state (packagePanelAction) on mount and
 * after each action — no quote data comes from the Estimator.
 */

const FAILED = "Could not reach the server. Try again.";
const label: CSSProperties = { fontSize: 11, fontWeight: 600, color: "#9aa0ab", textTransform: "uppercase", letterSpacing: ".04em", marginTop: 6 };
const small: CSSProperties = { fontSize: 11.5, color: "#5b616e", lineHeight: 1.45 };
const chip: CSSProperties = { fontSize: 11, fontWeight: 600, color: "#8a6d1f", background: "#fbf3dd", border: "1px solid #f0e2bd", borderRadius: 999, padding: "2px 8px" };
const btn: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 600, borderRadius: 8, padding: "7px 12px", border: "none", cursor: "pointer", color: "#16181d", background: "#f1f2f5" };
const off: CSSProperties = { cursor: "not-allowed", opacity: 0.55 };
const linkBtn: CSSProperties = { background: "none", border: "none", padding: 0, fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 600, cursor: "pointer" };

export function PackageStaffPanel({ quoteId }: { quoteId: string }) {
  const [panel, setPanel] = useState<PackagePanel | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [kind, setKind] = useState<PackageFileKind>("drawing");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    packagePanelAction(quoteId).then(
      (r) => {
        if (!live) return;
        if (r.ok) setPanel(r.panel);
        else setErr(r.error);
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
      const r = await packagePanelAction(quoteId);
      if (r.ok) setPanel(r.panel);
    } catch {
      /* keep what is shown */
    }
  };

  const upload = (file: File) =>
    start(async () => {
      setErr(null);
      setNote(null);
      const put = await putPackageFile(file, quoteId);
      if (!put.ok) {
        setErr(put.error);
        return;
      }
      let r: Awaited<ReturnType<typeof addPackageFileAction>>;
      try {
        r = await addPackageFileAction(quoteId, { uploadKey: put.uploadKey, blobPath: put.pathname, fileName: file.name, kind });
      } catch {
        setErr(FAILED);
        return;
      }
      if (r.ok) setNote(`${file.name} added.`);
      else setErr(r.error);
      await reload();
    });

  const remove = (fileId: string) =>
    start(async () => {
      setErr(null);
      setNote(null);
      let r: Awaited<ReturnType<typeof removePackageFileAction>>;
      try {
        r = await removePackageFileAction(quoteId, fileId);
      } catch {
        setErr(FAILED);
        return;
      }
      setConfirmId(null);
      if (!r.ok) setErr(r.error);
      await reload();
    });

  const rebuild = () =>
    start(async () => {
      setErr(null);
      setNote(null);
      let r: Awaited<ReturnType<typeof rebuildPackageZipAction>>;
      try {
        r = await rebuildPackageZipAction(quoteId);
      } catch {
        setErr(FAILED);
        return;
      }
      if (r.ok) setNote(r.removed ? "The next download builds a fresh package." : "No saved package yet — the next download builds one.");
      else setErr(r.error);
    });

  if (!panel) return <span style={small}>{err || "Loading the client package…"}</span>;
  const canUpload = panel.canSend && panel.uploads && !pending;

  return (
    <div data-testid="package-staff" style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
      {panel.gaps.length > 0 && (
        <div data-testid="package-gaps" style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {panel.gaps.map((g) => (
            <span key={g} style={chip}>
              {g}
            </span>
          ))}
        </div>
      )}

      <span style={label}>Drawings</span>
      {panel.files.length === 0 && <span style={small}>No drawings yet.</span>}
      {panel.files.map((f) => (
        <div key={f.id} style={{ ...small, display: "flex", flexDirection: "column", gap: 2 }}>
          <span>
            <strong style={{ color: "#16181d" }}>{f.name}</strong> · {f.kindLabel} · {f.sourceLabel} · {f.sizeLabel}
          </span>
          {f.hidden && <span style={{ color: "#8a6d1f" }}>Hidden from the client — an upload of this kind replaces it.</span>}
          {panel.canSend && confirmId !== f.id && (
            <button type="button" onClick={() => setConfirmId(f.id)} disabled={pending} style={{ ...linkBtn, color: "#a33a2b", alignSelf: "flex-start" }}>
              Remove
            </button>
          )}
          {confirmId === f.id && (
            <span role="group" aria-label={`Remove ${f.name}`} style={{ display: "flex", gap: 12 }}>
              <span>It disappears from the current client link.</span>
              <button type="button" onClick={() => remove(f.id)} disabled={pending} style={{ ...linkBtn, color: "#a33a2b" }}>
                Remove drawing
              </button>
              <button type="button" onClick={() => setConfirmId(null)} disabled={pending} style={{ ...linkBtn, color: "#5b616e" }}>
                Cancel
              </button>
            </span>
          )}
        </div>
      ))}
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <select aria-label="Drawing kind" value={kind} onChange={(e) => setKind(e.target.value as PackageFileKind)} disabled={!canUpload} style={{ fontSize: 12.5, padding: "6px 8px", borderRadius: 7, border: "1px solid #dfe2e8" }}>
          {PACKAGE_FILE_KINDS.map((k) => (
            <option key={k} value={k}>
              {PACKAGE_FILE_KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => fileInput.current?.click()} disabled={!canUpload} style={{ ...btn, ...(canUpload ? {} : off) }}>
          Upload…
        </button>
        <input
          ref={fileInput}
          type="file"
          accept={PACKAGE_FILE_ACCEPT}
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) upload(file);
          }}
        />
      </div>
      {!panel.uploads && <span style={small}>{PACKAGE_FILES_COPY.noStorage}</span>}

      <span style={label}>Client responses</span>
      {panel.responses.length === 0 ? (
        <span style={small}>No responses yet.</span>
      ) : (
        <ul data-testid="package-responses" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {panel.responses.map((r) => (
            <li key={r.id} style={small}>
              <strong style={{ color: "#16181d" }}>{r.kindLabel}</strong> · {r.revLabel} · {r.when}
              <br />
              {r.who}
              {r.scopes && (
                <>
                  <br />
                  {r.scopes}
                  {r.total && ` — ${r.total}`}
                </>
              )}
              {r.message && (
                <>
                  <br />
                  <span style={{ whiteSpace: "pre-line" }}>{r.message}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <button type="button" onClick={rebuild} disabled={!panel.canSend || pending} style={{ ...linkBtn, color: "var(--accent)", alignSelf: "flex-start", marginTop: 4, ...(panel.canSend ? {} : off) }}>
        Rebuild package
      </button>
      <span style={small}>The download zip is saved after its first download. Rebuild after adding datasheets.</span>
      {note && <span style={small}>{note}</span>}
      {err && (
        <span role="alert" style={{ ...small, color: "#a33a2b" }}>
          {err}
        </span>
      )}
    </div>
  );
}
```

  `putPackageFile` never throws (its own try/catch); every action call sits in a try/catch (four `catch {`).

- [ ] **Step 6: Mount it.** In `client-link-panel.tsx` add `import { PackageStaffPanel } from "./package-staff-panel";` after the
  `share-actions` import, and insert `<PackageStaffPanel quoteId={quoteId} />` as the last child of the main returned
  `<div data-testid="client-link" …>`, after the `{err && (…)}` block. Append to the file's doc comment: "#301 slice C:
  the package's staff side (gaps, drawings, responses, Rebuild) is PackageStaffPanel, mounted last."

- [ ] **Step 7: Run the gates** (tsc 0; test:specs PASS = previous + 3 sync + 2 DB; every `#293t panel` / `#293t final 9` and
  Slice B `#301 panel` check still passes; eslint on the four files; `next build` OK).

- [ ] **Step 8: Commit.**

```bash
git add src/lib/estimate-output/package-panel-server.ts "src/app/(app)/estimator/package-staff-panel.tsx" "src/app/(app)/estimator/package-actions.ts" \
  "src/app/(app)/estimator/client-link-panel.tsx" scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(estimator): #301 slice C — Client link panel: gap chips, Drawings (upload/remove), client responses, Rebuild package

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Grid drawing set print + Generate from Grid (LAST feature task)

**Files:**
- Modify: `src/lib/stores/grid-projects.ts` (append `gridProjectForQuote`)
- Create: `src/lib/design/grid-set-print.ts`, `src/lib/design/drawing-set-data.ts`, `src/components/drawing/drawing-set-sheets.tsx`,
  `src/lib/grid-sheet-serve.ts`, `src/app/print/grid-set/[id]/page.tsx`, `src/app/print/grid-set/[id]/asset/sheet/[sheetId]/route.ts`,
  `src/app/print/grid-set/[id]/asset/doc/[docId]/route.ts`
- Modify: `src/app/(app)/design/grid/[id]/set/page.tsx` (whole file), `src/app/api/grid-sheets/[id]/route.ts` (body → `serveGridSheet`),
  `src/lib/quote-pdf/token.ts:17`, `src/lib/quote-pdf/render.ts` (`waitFor`), `src/lib/estimate-output/package-files-server.ts`
  (`generateGridDrawingSet`), `package-panel-server.ts` (`grid`), `package-actions.ts` (`generateGridDrawingsAction`),
  `package-staff-panel.tsx` (button), `scripts/smoke-routes.ts`
- Modify (adaptation 7): six source reads in `scripts/test-review-and-spec.ts`
- Test: harness block `#301 slice C — Grid set`; `e301cGridAsyncChecks`

**Interfaces:**
- **Consumes:** `listProjects`, `getProject`, `ensureOptions`, `hasOption`; everything the old set page imported; `signPrintToken`,
  `verifyPrintToken`; `renderPrintRouteToPdf`, `PdfRenderUnavailable`; `printOriginFor`; `putBlob`, `deleteBlob`, `blobEnabled`;
  Task 1 (`gridSetBlobPath`, `newPackageFileId`, `cleanPackageFiles`, `MAX_PACKAGE_FILE_BYTES`); Task 3 (`addPackageFile`);
  Task 6 (`removePackageFileAndBlob`).
- **Produces:**
  - `gridProjectForQuote(quoteId): Promise<{ project: GridProject; optionId: string } | null>`.
  - `grid-set-print.ts`: `gridSetId(projectId, optionId)`, `parseGridSetId(id): { projectId; optionId } | null`,
    `gridSetAssetTokenId(setId, kind: "sheet" | "doc", assetId)`, `gridSetPrintUrl(origin, setId, token)`,
    `GRID_SET_WAIT_FOR`, `GRID_SET_STEP_MS = 25_000`, `gridSetFileName(projectName)`, `GRID_SET_COPY`.
  - `drawing-set-data.ts`: `DrawingSetAssets = { sheet: (src: Pick<GridSheet, "id">) => string; doc: (docId: string) => string }`,
    `TEAM_DRAWING_SET_ASSETS`, `rehrefSymbolUrls(urls, doc)`, `SCHEDULE_ROWS_PER_COLUMN`,
    `loadDrawingSetData(project, { requestedOption?, requestedSize?, assets })`, `type DrawingSetData`.
  - `DrawingSetSheets({ data, assets })`; `serveGridSheet(sheet): Promise<Response>`.
  - `PrintTokenKind` + `"grid-set"`; `renderPrintRouteToPdf(url, { timeoutMs?, signal?, waitFor? })`; `RENDER_WAIT_FOR_TIMEOUT_MS = 30_000`.
  - `generateGridDrawingSet(quoteId, by, origin, deps?)`; `generateGridDrawingsAction(quoteId)`; `PackagePanel.grid: { label: string } | null`.

- [ ] **Step 1: Adaptation 7 — re-point the moved-code reads.** In `scripts/test-review-and-spec.ts`, change exactly these
  reads (assertions untouched except item 7):
  1. `const gdsSetSrc = readFileSync(join(process.cwd(), "src/app/(app)/design/grid/[id]/set/page.tsx"), "utf8");` →
     `const gdsSetSrc = gridSetSources301();`
  2. `const gdsSetPageSrc2 = readFileSync(join(process.cwd(), "src/app/(app)/design/grid/[id]/set/page.tsx"), "utf8");` →
     `const gdsSetPageSrc2 = gridSetSources301();`
  3. `const fnSetSrc = readFileSync(join(process.cwd(), "src/app/(app)/design/grid/[id]/set/page.tsx"), "utf8");` →
     `const fnSetSrc = gridSetSources301();`
  4. `const set7 = readFileSync(join(process.cwd(), "src/app/(app)/design/grid/[id]/set/page.tsx"), "utf8");` →
     `const set7 = gridSetSources301();`
  5. `e223Src("src/app/(app)/design/grid/[id]/set/page.tsx").includes("optionQuoteNo")` → `gridSetSources301().includes("optionQuoteNo")`
  6. `const fnRouteSrc = readFileSync(join(process.cwd(), "src/app/api/grid-sheets/[id]/route.ts"), "utf8");` →
     `const fnRouteSrc = ["src/app/api/grid-sheets/[id]/route.ts", "src/lib/grid-sheet-serve.ts"].map((p) => readFileSync(join(process.cwd(), p), "utf8")).join("\n");`
  7. In the `#209 I6` assertion, replace `fnSetSrc.includes("src: \`/api/grid-sheets/${encodeURIComponent(src.id)}\`")` with
     `fnSetSrc.includes("sheet: (src) => \`/api/grid-sheets/${encodeURIComponent(src.id)}\`") && fnSetSrc.includes("src: assets.sheet(src)")`
     (the team assets resolver now holds the proxy URL; the intent — every sheet through the proxy, never a data-URL — is unchanged).

  Add this function at the end of the file, inside the Task 9 block below (a hoisted declaration):

```ts
/** #301 slice C (adaptation 7): the drawing set's body moved out of set/page.tsx
 *  into a data loader and a sheets component; the #209 / #211 / #223 source pins read all three. */
function gridSetSources301(): string {
  return ["src/app/(app)/design/grid/[id]/set/page.tsx", "src/lib/design/drawing-set-data.ts", "src/components/drawing/drawing-set-sheets.tsx"]
    .map((p) => readFileSync(join(process.cwd(), p), "utf8"))
    .join("\n");
}
```

- [ ] **Step 2: Write the failing harness block.** Append:

```ts
/* ======================================================================
   #301 slice C — Grid set (R8, R9, D-k): gridProjectForQuote; the drawing
   set body shared by the team page and a signed /print/grid-set/[id]
   (id = <project>~<option>); per-asset print tokens for sheet sources and
   symbol drawings; renderPrintRouteToPdf's waitFor; Generate from Grid
   stores ONE "drawing" PDF (source grid) and replaces an earlier one.
   ====================================================================== */
import {
  gridSetId as e301cgId, parseGridSetId as e301cgParse, gridSetAssetTokenId as e301cgAssetId, gridSetPrintUrl as e301cgUrl, gridSetFileName as e301cgFile,
  GRID_SET_WAIT_FOR as e301cgWait, GRID_SET_STEP_MS as e301cgStep,
} from "@/lib/design/grid-set-print";
import { signPrintToken as e301cgSign, verifyPrintToken as e301cgVerify } from "@/lib/quote-pdf/token";
import { RENDER_LAUNCH_TIMEOUT_MS as e301cgLaunch, RENDER_FONTS_TIMEOUT_MS as e301cgFonts, RENDER_WAIT_FOR_TIMEOUT_MS as e301cgWaitCap } from "@/lib/quote-pdf/render";
{
  const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  ok(e301cgId("GRD-5001", "opt-base") === "GRD-5001~opt-base" && JSON.stringify(e301cgParse("GRD-5001~opt-base")) === JSON.stringify({ projectId: "GRD-5001", optionId: "opt-base" }) &&
     ["", "GRD-1", "GRD-1~", "~opt", "a~b~c", "../x~y", "GRD 1~opt", "G".repeat(81) + "~o"].every((s) => e301cgParse(s) === null),
    "#301 grid: a set id is <project>~<option>, strictly shaped");
  ok(e301cgAssetId("GRD-1~opt-1", "sheet", "gs-1") === "GRD-1~opt-1|sheet|gs-1" && e301cgUrl("https://app.test/", "GRD-1~opt-1", "1.x") === "https://app.test/print/grid-set/GRD-1~opt-1?t=1.x" &&
     e301cgFile("Lakefront HS / Main") === "Lakefront HS - Main — drawing set.pdf",
    "#301 grid: asset token ids, the print URL, the stored file name");
  const NOW = 1_800_000_000_000;
  const page = e301cgSign("s3", "grid-set", "GRD-1~opt-1", NOW);
  const asset = e301cgSign("s3", "grid-set", "GRD-1~opt-1|sheet|gs-1", NOW);
  ok(e301cgVerify("s3", page, "grid-set", "GRD-1~opt-1", NOW) && !e301cgVerify("s3", page, "grid-set", "GRD-1~opt-1|sheet|gs-1", NOW) &&
     !e301cgVerify("s3", asset, "grid-set", "GRD-1~opt-1", NOW) && !e301cgVerify("s3", asset, "grid-set", "GRD-1~opt-1|sheet|gs-2", NOW) && !e301cgVerify("s3", page, "rack", "GRD-1~opt-1", NOW),
    "#301 grid: the page token and each asset token are separate (R8b — an asset token proves the page drew that asset)");
  ok(e301cgWait === '[data-plan-figure]:not([data-ready="1"]):not([data-error="1"])' && e301cgLaunch + 2 * e301cgStep + e301cgFonts + Math.min(e301cgStep, e301cgWaitCap) <= 110_000,
    "#301 grid: R8c — wait for every plan figure to settle; one render's worst case fits the 120 s action with room to store it");
  const rs = rd("src/lib/quote-pdf/render.ts");
  const body = rs.slice(rs.indexOf("async function renderOnce("));
  ok(body.indexOf("page.evaluate(") < body.indexOf("page.waitForFunction(") && body.indexOf("page.waitForFunction(") < body.indexOf("landedOnRequested(url, page.url())") &&
     body.includes("timeout: Math.min(timeout, RENDER_WAIT_FOR_TIMEOUT_MS)") && body.includes("if (waitFor)"),
    "#301 grid: waitFor runs after the fonts wait and before the landed re-check and page.pdf(); a selector still matching fails the render");
  ok(/export type PrintTokenKind = [^;]*"grid-set"/.test(rd("src/lib/quote-pdf/token.ts")), "#301 grid: \"grid-set\" is a print token kind");
  const pp = rd("src/app/print/grid-set/[id]/page.tsx");
  ok(pp.indexOf("tokenOk(") < pp.indexOf("parseGridSetId(") && pp.indexOf("parseGridSetId(") < pp.indexOf("getProject(") && pp.includes("hasOption(project, parsed.optionId)") &&
     pp.includes("<DrawingSetSheets data={data} assets={assets} />") && pp.includes("printPageCss(data.size)") && !pp.includes("requireUser") && pp.includes('requestedSize: "b"'),
    "#301 grid: the print page checks its token before any read, needs an exact option, prints the shared sheets at 11×17");
  for (const [f, kind] of [["src/app/print/grid-set/[id]/asset/sheet/[sheetId]/route.ts", "sheet"], ["src/app/print/grid-set/[id]/asset/doc/[docId]/route.ts", "doc"]] as const) {
    const src = rd(f);
    ok(src.indexOf("verifyPrintToken(") < src.indexOf(kind === "sheet" ? "getProject(" : "getDocument(") && src.includes(`gridSetAssetTokenId(id, "${kind}", `),
      `#301 grid: the ${kind} asset route verifies its own asset token before any read`);
  }
  ok(rd("src/app/print/grid-set/[id]/asset/sheet/[sheetId]/route.ts").includes("sheet.projectId !== project.id || !(project.sheetIds || []).includes(sheet.id)") &&
     rd("src/app/print/grid-set/[id]/asset/doc/[docId]/route.ts").includes('doc.kind !== "symbol" && doc.kind !== "riser"'),
    "#301 grid: a sheet must belong to the project; a doc must be a symbol / riser drawing");
  const team = rd("src/app/(app)/design/grid/[id]/set/page.tsx");
  ok(team.includes("loadDrawingSetData(project, { requestedOption, requestedSize, assets: TEAM_DRAWING_SET_ASSETS })") && team.includes("<DrawingSetSheets data={data} assets={TEAM_DRAWING_SET_ASSETS} />") &&
     team.includes("await requireUser();") && team.includes("<SetSettingsPanel"),
    "#301 grid: the team page keeps its session gate, toolbar and settings panel, and renders the shared sheets");
  const sheets = rd("src/components/drawing/drawing-set-sheets.tsx");
  ok(!sheets.includes('"use client"') && !sheets.includes("/api/grid-sheets/") && !sheets.includes("/api/part-documents/") && sheets.includes("assets.sheet(src)"),
    "#301 grid: the shared sheets component takes every asset URL from its resolver");
  const gen = rd("src/lib/estimate-output/package-files-server.ts");
  const g = gen.slice(gen.indexOf("export async function generateGridDrawingSet("));
  ok(g.indexOf("d.find(q.id)") < g.indexOf('signPrintToken(d.secret, "grid-set", setId, d.now())') && g.indexOf('signPrintToken(d.secret, "grid-set", setId, d.now())') < g.indexOf("d.render(") &&
     g.includes("waitFor: GRID_SET_WAIT_FOR") && g.includes('kind: "drawing"') && g.includes('source: "grid"'),
    "#301 grid: Generate signs the token right before the one render and stores a Grid drawing set");
  const acts = rd("src/app/(app)/estimator/package-actions.ts");
  ok(acts.slice(acts.indexOf("export async function generateGridDrawingsAction(")).includes("printOriginFor(process.env,"), "#301 grid: the action prints from the request's own origin (printOriginFor)");
  const smoke = rd("scripts/smoke-routes.ts");
  ok(smoke.includes('{ route: "/print/grid-set/GRD-5001~opt-base", expectNotFound: true }') && smoke.includes('{ route: "/print/grid-set/GRD-5001~opt-base/asset/sheet/gs-1", expectNotFound: true }') &&
     smoke.includes('{ route: "/print/grid-set/GRD-5001~opt-base/asset/doc/PD-1", expectNotFound: true }'),
    "#301 smoke: the print page and both asset routes without a token are clean 404s");
}

async function e301cGridAsyncChecks(): Promise<void> {
  const { fixtureId } = await import("./test-fixtures");
  const G = await import("@/lib/stores/grid-projects");
  const Q = await import("@/lib/stores/quotes");
  const F = await import("@/lib/estimate-output/package-files");
  const S = await import("@/lib/estimate-output/package-files-server");
  const { rehrefSymbolUrls } = await import("@/lib/design/drawing-set-data");
  ok(JSON.stringify(rehrefSymbolUrls({ p1: { plan: "/api/part-documents/PD-1", riser: "/api/part-documents/PD-2" }, p2: { plan: "https://evil/x" } }, (id) => `/print/x/asset/doc/${id}?t=T`)) ===
     JSON.stringify({ p1: { plan: "/print/x/asset/doc/PD-1?t=T", riser: "/print/x/asset/doc/PD-2?t=T" } }),
    "#301 grid: symbol URLs are re-pointed at the print-scoped asset route; anything unexpected falls back to the generic symbol");
  const QID = fixtureId(301, "c-grid");
  await Q.create({ id: QID, name: "#301c grid", customer: "Spec fixture", owner: "spec", quoteType: "system", source: "grid",
    spec: { sections: [{ id: "s1", name: "Lighting", kind: "materials", mfr: "", freightPct: 0, items: [{ id: 1, sku: "A", desc: "A", qty: 1, unit: "ea", cost: 1, price: 2 }] }], mobs: [] } });
  registerFixture("quotes", QID);
  const project = await G.createProject({ name: "#301c grid design", customer: "Spec fixture", customerId: null, by: "Test" });
  registerFixture("grid_projects", project.id);
  const { ensureOptions } = await import("@/lib/design/grid-options");
  const optionId = ensureOptions(project).options[0].id;
  ok((await G.gridProjectForQuote(QID)) === null, "#301 grid (DB): no design is linked yet");
  await G.setOptionQuote(project.id, optionId, QID);
  const hit = await G.gridProjectForQuote(QID);
  ok(hit?.project.id === project.id && hit.optionId === optionId, "#301 grid (DB): R9 — the design whose option minted this quote");
  const puts: string[] = [];
  const removed: string[] = [];
  let n = 0;
  const deps = {
    secret: "s3cret-301cg",
    blobOn: true,
    now: () => 1_800_000_000_000,
    newId: () => "PF-" + (++n).toString(16).padStart(12, "e"),
    render: async (url: string, opts: { waitFor?: string; timeoutMs?: number }) => {
      if (!url.startsWith(`https://app.test/print/grid-set/${encodeURIComponent(project.id + "~" + optionId)}?t=`) || opts.waitFor !== '[data-plan-figure]:not([data-ready="1"]):not([data-error="1"])' || opts.timeoutMs !== 25_000) throw new Error("bad render call " + url);
      return Buffer.from("%PDF-1.7 grid set");
    },
    put: async (path: string) => { puts.push(path); return { url: "u", pathname: path + "-Sfx" + puts.length }; },
    remove: async (p: string) => { removed.push(p); },
  };
  const g1 = await S.generateGridDrawingSet(QID, "Tester", "https://app.test", deps);
  const g2 = await S.generateGridDrawingSet(QID, "Tester", "https://app.test", deps);
  const files = F.cleanPackageFiles((await Q.get(QID))!.packageFiles);
  ok(g1.ok && g2.ok && files.length === 1 && files[0].source === "grid" && files[0].kind === "drawing" && files[0].name === "#301c grid design — drawing set.pdf" &&
     puts.every((p) => p === `estimate-files/${QID}/grid/drawing-set.pdf`) && removed.join() === `estimate-files/${QID}/grid/drawing-set.pdf-Sfx1`,
    "#301 grid (DB): Generate stores one Grid drawing set; generating again replaces it (the old blob goes)");
  const noBlob = await S.generateGridDrawingSet(QID, "Tester", "https://app.test", { ...deps, blobOn: false });
  const noGrid = await S.generateGridDrawingSet(fixtureId(301, "c-grid-none"), "Tester", "https://app.test", deps);
  ok(!noBlob.ok && noBlob.error === F.PACKAGE_FILES_COPY.noStorage && !noGrid.ok, "#301 grid (DB): no storage or no quote / design → a message, nothing stored");
}
```

  Append `await e301cGridAsyncChecks();` to `estimateOutput301CAsyncChecks`'s body.

- [ ] **Step 3: Run it to verify it fails.**

- [ ] **Step 4: `gridProjectForQuote`.** Append to `src/lib/stores/grid-projects.ts` (`listProjects` already normalizes with
  `ensureOptions` and sorts newest activity first):

```ts
/**
 * #301 slice C (D-k, R9) — the Grid design a quote was minted from: the
 * option whose `quoteId` is this quote, else a legacy doc whose own
 * `quoteId` is (its first option). A scan — there is no stored back-link.
 * Newest activity first, so a re-minted quote finds the latest design.
 */
export async function gridProjectForQuote(quoteId: string): Promise<{ project: GridProject; optionId: string } | null> {
  if (!quoteId) return null;
  for (const p of await listProjects()) {
    const doc = ensureOptions(p);
    const opt = doc.options.find((o) => o.quoteId === quoteId);
    if (opt) return { project: doc, optionId: opt.id };
    if (doc.quoteId === quoteId) return { project: doc, optionId: doc.options[0].id };
  }
  return null;
}
```

- [ ] **Step 5: Create `src/lib/design/grid-set-print.ts`.**

```ts
/**
 * #301 slice C (R8) — the signed Grid drawing-set print's pure names: the
 * set id `<projectId>~<optionId>` (the print token's id), per-asset token
 * ids, the print URL, the wait selector and the per-step render cap.
 * Client-safe; imports nothing.
 */

const PART = /^[A-Za-z0-9_-]{1,80}$/;

export const GRID_SET_WAIT_FOR = '[data-plan-figure]:not([data-ready="1"]):not([data-error="1"])';
/** Per render step (adaptation 16): launch 20 + goto 25 + fonts 10 + waitFor 25 + pdf 25 = 105 s < 120 s. */
export const GRID_SET_STEP_MS = 25_000;

export const GRID_SET_COPY = {
  noGrid: "No Grid design is linked to this quote.",
  renderFailed: "The drawing set couldn’t be rendered — try again.",
  tooBig: "The drawing set is over 25 MB — upload a smaller set instead.",
  noSecret: "Printing isn’t set up on this server (AUTH_SECRET is missing).",
  generating: "Rendering the drawing set — this can take a minute…",
  generated: "Drawing set added from the Grid.",
} as const;

export function gridSetId(projectId: string, optionId: string): string {
  return `${projectId}~${optionId}`;
}

export function parseGridSetId(id: string): { projectId: string; optionId: string } | null {
  const parts = typeof id === "string" ? id.split("~") : [];
  if (parts.length !== 2 || !PART.test(parts[0]) || !PART.test(parts[1])) return null;
  return { projectId: parts[0], optionId: parts[1] };
}

/** The id an asset's own print token signs — the print page signs only assets it drew (adaptation 6). */
export function gridSetAssetTokenId(setId: string, kind: "sheet" | "doc", assetId: string): string {
  return `${setId}|${kind}|${assetId}`;
}

export function gridSetPrintUrl(origin: string, setId: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/print/grid-set/${encodeURIComponent(setId)}?t=${encodeURIComponent(token)}`;
}

export function gridSetFileName(projectName: string): string {
  const base = (projectName || "Grid design").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+-\s*|\s*-\s+/g, " - ").replace(/\s+/g, " ").trim().slice(0, 120) || "Grid design";
  return `${base} — drawing set.pdf`;
}
```

  The harness expects `gridSetFileName("Lakefront HS / Main") === "Lakefront HS - Main — drawing set.pdf"`. If your
  normalization differs, fix the function (not the check) until that holds.

- [ ] **Step 6: `token.ts` + `render.ts`.** In `src/lib/quote-pdf/token.ts`, extend the union (Slice A added `"cover"`):
  `export type PrintTokenKind = PdfKind | "part-thumb" | "cutsheets" | "rack" | "cover" | "grid-set";` and add "#301 slice C's
  Grid drawing set (one token for the page, one per asset it draws)" to its comment.

  In `src/lib/quote-pdf/render.ts`, add after `RENDER_WORST_CASE_MS`:

```ts
/** #301 slice C (R8c) — the longest a `waitFor` render waits for its selector
 *  to stop matching. Only the Grid drawing set passes `waitFor`, with 25 s
 *  steps, so its worst case stays inside 120 s (grid-set-print.ts). */
export const RENDER_WAIT_FOR_TIMEOUT_MS = 30_000;
```

  Change `renderPrintRouteToPdf`'s signature and dispatch:

```ts
export function renderPrintRouteToPdf(url: string, opts: { timeoutMs?: number; signal?: AbortSignal; waitFor?: string } = {}): Promise<Buffer> {
  // `next dev` compiles /print on first hit, which can take far longer than a
  // warm production render.
  const timeout = opts.timeoutMs ?? (process.env.NODE_ENV === "development" ? 90_000 : RENDER_STEP_TIMEOUT_MS);
  if (!opts.signal) return enqueueRender(() => renderOnce(url, timeout, undefined, opts.waitFor));
  return enqueueRender((signal) => renderOnce(url, timeout, signal, opts.waitFor), opts.signal);
}
```

  Change `async function renderOnce(url: string, timeout: number, signal?: AbortSignal): Promise<Buffer> {` to
  `async function renderOnce(url: string, timeout: number, signal?: AbortSignal, waitFor?: string): Promise<Buffer> {`, and
  right after the `if (fontsCapped) console.warn(…)` line insert:

```ts
    // #301 slice C (R8c): a page that paints asynchronously (the Grid drawing
    // set's plan sheets flip data-ready) prints only once nothing matches
    // `waitFor`. Still matching at the cap fails the render — never a blank plan.
    if (waitFor) {
      await page.waitForFunction((sel: string) => !document.querySelector(sel), { timeout: Math.min(timeout, RENDER_WAIT_FOR_TIMEOUT_MS), polling: 250 }, waitFor);
    }
```

  The `#222 final-B` step count regex (`[{,]\s*timeout\s*[,}]`) doesn't match `timeout: Math.min(…)`, so
  `RENDER_WORST_CASE_MS` stays the no-`waitFor` worst case and its check still passes.

- [ ] **Step 7: `src/lib/grid-sheet-serve.ts` + the proxy route.** Create the module with the route's serving body, moved
  verbatim:

```ts
import { getBlobStream } from "@/lib/blob";
import { decodeDataUrl } from "@/lib/grid-sheet-file";
import type { GridSheet } from "@/lib/stores/grid-projects";

/**
 * One plan-sheet source's bytes (D116, #209 I6): Blob streamed straight
 * through, or an in-database sheet's data-URL decoded and served the same
 * way. Shared by the signed-in proxy (/api/grid-sheets/[id]) and the
 * signed Grid set print's asset route (#301 slice C). The caller has
 * already decided the requester may see this sheet.
 */
export async function serveGridSheet(sheet: GridSheet): Promise<Response> {
  if (!sheet.blobPath) {
    const decoded = decodeDataUrl(sheet.dataUrl);
    if (!decoded || !decoded.bytes.length) return new Response("Not found", { status: 404 });
    const mime = sheet.mime || decoded.mime;
    return new Response(decoded.bytes as unknown as BodyInit, { headers: sheetHeaders(mime) });
  }
  const stream = await getBlobStream(sheet.blobPath);
  if (!stream) return new Response("File missing from storage", { status: 404 });
  return new Response(stream, { headers: sheetHeaders(sheet.mime || "application/octet-stream") });
}

export function sheetHeaders(mime: string): Record<string, string> {
  const h: Record<string, string> = {
    "content-type": mime,
    // Private to the requester's browser; sheets are immutable once
    // uploaded, so a day of caching is safe and keeps pans/zooms snappy.
    "cache-control": "private, max-age=86400",
    "x-content-type-options": "nosniff",
  };
  // Uploads refuse SVG, but generated base plans and legacy in-database
  // sheets can still be SVG. Opened top-level, a sandboxed, script-less CSP
  // keeps one from running in the app's origin; as an <img> it renders unchanged.
  if (/svg/i.test(mime)) h["content-security-policy"] = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:";
  return h;
}
```

  Replace `src/app/api/grid-sheets/[id]/route.ts`'s imports and body (keep its doc comment):

```ts
import { requireUser } from "@/lib/session";
import { getDoc } from "@/db/doc-store";
import { serveGridSheet } from "@/lib/grid-sheet-serve";
import type { GridSheet } from "@/lib/stores/grid-projects";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await ctx.params;
  const sheet = await getDoc<GridSheet>("grid_sheets", decodeURIComponent(id));
  if (!sheet) return new Response("Not found", { status: 404 });
  return serveGridSheet(sheet);
}
```

- [ ] **Step 8: Create `src/lib/design/drawing-set-data.ts`.** Move the data half of `set/page.tsx` here verbatim — every line
  from `const optionId = resolveOptionId(project, requestedOption);` through
  `const optionQuoteNo = …;`, except `base` / `optionQuery` (page-only) — with these exact changes: the sheet and symbol
  URLs come from `assets`, and the result is returned as one object.

```ts
// SERVER ONLY — reads the catalog, settings, sheets and part documents.
import { getSettings } from "@/lib/settings";
import { listSheets, type GridProject, type GridSheet } from "@/lib/stores/grid-projects";
import { quoteNumbersFor } from "@/lib/stores/estimate-numbers";
import { list as listCatalog } from "@/lib/stores/catalog";
import { listGridSymbols } from "@/lib/stores/grid-catalog";
import { resolveCategoryMap } from "@/lib/catalog-taxonomy";
import { optionSlice, resolveOptionId } from "@/lib/design/grid-options";
import { gridPartsFrom } from "@/lib/design/grid-parts";
import { loadVirtualParts } from "@/lib/stores/equipment-map";
import { loadDeviceTypeContext } from "@/lib/stores/device-types";
import { legendRows, symbolContext, type SymbolEntry } from "@/lib/design/grid-icons";
import { riserViewForOption } from "@/lib/design/grid-riser-view";
import { buildSchedule, paginateSchedule, scheduleGroups, scheduleWiresFromView } from "@/lib/design/grid-schedule";
import { SHEET_SIZES, buildSheetList, drawingArea, planSheetGroups, resolveGeneralNotes, resolveSheetSize, revisionRows } from "@/lib/design/grid-drawing-set";
import { cleanSymbolDisplay } from "@/lib/design/grid-symbol-display";
import { symbolUrlsFor } from "@/lib/design/object-symbols-server";
import { partDocumentUrl, type ObjectSymbolUrls } from "@/lib/design/object-symbols";

/**
 * The drawing set's data (#209, #300), shared since #301 slice C (R8a) by
 * the signed-in set page and the signed /print/grid-set/[id] route. Every
 * asset URL the sheets draw comes from `assets`: the team page uses the
 * signed-in proxies; the print route uses per-asset signed URLs.
 */

/** Schedule rows per column; two columns per E-60x sheet (the whole sheet,
 *  type included, scales with the size, so this holds at 24×36 too). */
export const SCHEDULE_ROWS_PER_COLUMN = 30;

export type DrawingSetAssets = { sheet: (src: Pick<GridSheet, "id">) => string; doc: (docId: string) => string };

export const TEAM_DRAWING_SET_ASSETS: DrawingSetAssets = {
  // Every sheet streams through the authenticated proxy (#209 I6) — Blob and
  // in-database alike — so a sheet shared by several plan pages is one cached
  // download, never a data-URL inlined once per page.
  sheet: (src) => `/api/grid-sheets/${encodeURIComponent(src.id)}`,
  doc: partDocumentUrl,
};

const DOC_URL = /^\/api\/part-documents\/([^/?#]+)$/;

/** Re-point #300's drawing URLs (`/api/part-documents/<id>`) through `doc`.
 *  Anything else is dropped, so that marker draws the generic symbol. */
export function rehrefSymbolUrls(urls: Record<string, ObjectSymbolUrls>, doc: (docId: string) => string): Record<string, ObjectSymbolUrls> {
  const re = (u: string | undefined) => {
    const m = u ? DOC_URL.exec(u) : null;
    return m ? doc(decodeURIComponent(m[1])) : undefined;
  };
  const out: Record<string, ObjectSymbolUrls> = {};
  for (const [k, v] of Object.entries(urls)) {
    const plan = re(v.plan);
    const riser = re(v.riser);
    if (plan || riser) out[k] = { ...(plan ? { plan } : {}), ...(riser ? { riser } : {}) };
  }
  return out;
}

export async function loadDrawingSetData(
  project: GridProject,
  opts: { requestedOption?: string | null; requestedSize?: string | null; assets: DrawingSetAssets }
) {
  const requestedOption = opts.requestedOption ?? undefined;
  const requestedSize = opts.requestedSize ?? undefined;
  const optionId = resolveOptionId(project, requestedOption);
  const options = project.options!;
  const option = options.find((o) => o.id === optionId)!;
  const slice = optionSlice(project, optionId);
  const spaces = project.spaces || [];
  const cals = project.calibrations || [];

  const [sheets, catalog, gridSymbols, settings] = await Promise.all([listSheets(project.id), listCatalog(), listGridSymbols(), getSettings()]);
  // #226: device types — the scope fix and type-grouped legend labels.
  const deviceTypes = await loadDeviceTypeContext(catalog);
  const accent = settings.accent || "#b08d4a";
  const symCtx = symbolContext(settings, deviceTypes.types);
  const parts = [
    ...gridPartsFrom(gridSymbols, catalog, resolveCategoryMap(settings.catalogCategoryMap), { catalogFallback: true, deviceTypes }),
    ...(await loadVirtualParts((project.placements || []).map((pl) => pl.partId), catalog)),
  ];
  const partById = new Map(parts.map((p) => [p.id, p]));
  const set = project.drawingSet || {};
  const size = resolveSheetSize(requestedSize, set.size);
  const k = SHEET_SIZES[size].k;
  const area = drawingArea(size);
  // Print date for the title strip.
  const now = Date.now();

  const symbolDisplay = cleanSymbolDisplay(project.symbolDisplay);
  // #300 (D609): in Object mode, the drawing URLs of the parts this option
  // places. A lookup failure prints the generic symbols instead of failing
  // the set. #301 slice C: re-pointed through `assets.doc`.
  const symbolUrls =
    symbolDisplay.mode === "object"
      ? rehrefSymbolUrls(
          await symbolUrlsFor(
            [...new Set(slice.placements.filter((pl) => !pl.curtain).map((pl) => pl.partId))].flatMap((pid) => partById.get(pid) ?? []),
            deviceTypes.types
          ).catch((e: unknown) => {
            console.error("[grid set] object symbol lookup failed:", e);
            return {} as Record<string, ObjectSymbolUrls>;
          }),
          opts.assets.doc
        )
      : {};
  // E-501 follows the design's mode too (#300).
  const view = riserViewForOption({ project, optionId, parts, symCtx, symbolMode: symbolDisplay.mode, symbolUrls });

  const schedule = buildSchedule({
    placements: slice.placements,
    spaces,
    descOf: (pid) => partById.get(pid)?.desc,
    wires: scheduleWiresFromView(view),
  });
  const schedulePages = paginateSchedule(scheduleGroups(schedule), SCHEDULE_ROWS_PER_COLUMN, 2);

  const groups = planSheetGroups({ sheetOrder: project.sheetIds || [], placements: slice.placements, routes: slice.routes, partById });
  const sourceNames = Object.fromEntries(sheets.map((s) => [s.id, s.name]));
  const sheetById = new Map(sheets.map((s) => [s.id, s]));
  const { all, included } = buildSheetList({ planGroups: groups, sourceNames, schedulePages: schedulePages.length, excluded: set.excluded });
  const revRows = revisionRows(project.revisions, set.revisionLabels);
  const notes = resolveGeneralNotes(set, settings.gridStandardNotes);
  const legend = legendRows(
    slice.placements
      .filter((pl) => !pl.curtain)
      .map((pl): SymbolEntry & { id?: string; desc?: string } => partById.get(pl.partId) || { category: pl.category || "", desc: pl.category || pl.partId, deviceType: null }),
    symCtx
  );

  // #223 — printed as the estimate number; the option still keys by id.
  const optionQuoteNo = option.quoteId ? (await quoteNumbersFor([option.quoteId])).get(option.quoteId) ?? option.quoteId : null;

  return {
    project, optionId, options, option, slice, spaces, cals, partById, symCtx, accent, set, size, k, area, now,
    symbolDisplay, symbolUrls, view, schedule, schedulePages, sheetById, all, included, revRows, notes, legend, optionQuoteNo,
    company: { name: settings.companyName, logoDark: settings.logoDark, offices: settings.offices },
    gridStandardNotes: settings.gridStandardNotes || "",
  };
}

export type DrawingSetData = Awaited<ReturnType<typeof loadDrawingSetData>>;
```

  (If the old page's lines differ from what is quoted here — later #299/#300 edits — move the **real** lines; the quoted
  block is `set/page.tsx` as of `fd867d8b`.)

- [ ] **Step 9: Create `src/components/drawing/drawing-set-sheets.tsx`.** Move the render half of `set/page.tsx` here
  verbatim: `scheduleRow`, the `tb` title-block function, `figPlacement`, `cover`, `body`, and the
  `<div className="pk-drawing-set" …>` that maps `included` to `<DrawingSheet>`. The changes are mechanical: every name
  the page used comes from `data` (destructure at the top), `settings.companyName / logoDark / offices` →
  `data.company.name / .logoDark / .offices`, and the plan sheet's source becomes `src: assets.sheet(src)`.

```tsx
import type { CSSProperties } from "react";
import type { GridPlacement } from "@/lib/stores/grid-projects";
import { findCalibration } from "@/lib/annotations";
import { placementQty } from "@/lib/design/grid-bom";
import { symbolLook } from "@/lib/design/grid-icons";
import { markerColor } from "@/lib/design/grid-symbols";
import { DRAWING_SYSTEMS } from "@/lib/design/grid-scopes";
import { assignTypeMarks } from "@/lib/design/drawing-labels";
import { isSeedPlaceholder } from "@/lib/design/grid-seed";
import type { ScheduleItem } from "@/lib/design/grid-schedule";
import { SHEET_SIZES, planContent, titleBlockData, type DrawingSheetDef } from "@/lib/design/grid-drawing-set";
import { markerBox } from "@/lib/design/grid-symbol-display";
import type { DrawingSetAssets, DrawingSetData } from "@/lib/design/drawing-set-data";
import { DrawingSheet } from "@/components/drawing/drawing-sheet";
import { RiserCanvas, RiserNotes } from "@/components/drawing/riser-canvas";
import { SymbolIcon } from "@/components/design/symbol-shape";
import PlanSheetFigure, { type FigurePlacement } from "@/app/(app)/design/grid/[id]/set/plan-sheet-figure";
import RiserSheetFigure from "@/app/(app)/design/grid/[id]/set/riser-sheet-figure";

/**
 * The drawing set's sheets (#209, spec 2026-09-25 §3) — T-001 cover, one
 * plan sheet per system per source page, E-501 riser, E-60x schedules (no
 * prices) — as one server component (#301 slice C, R8a). The team set page
 * and the signed /print/grid-set/[id] route both render it; every asset URL
 * comes from `assets`.
 */

function scheduleRow(it: ScheduleItem, key: number) {
  if (it.kind === "section")
    return (
      <tr key={key}>
        <td colSpan={3} className="pk-dw-sec">{`${it.name}${it.cont ? " (cont.)" : ""}`}</td>
      </tr>
    );
  if (it.kind === "wires")
    return (
      <tr key={key}>
        <td colSpan={3} className="pk-dw-sec">{`Wire runs${it.cont ? " (cont.)" : ""}`}</td>
      </tr>
    );
  if (it.kind === "row")
    return (
      <tr key={key}>
        <td>{it.qty}</td>
        <td className="pk-dw-mono pk-dw-ellip">{it.code}</td>
        <td className="pk-dw-ellip">{it.desc}</td>
      </tr>
    );
  return (
    <tr key={key}>
      <td className="pk-dw-ellip">{it.length}</td>
      <td className="pk-dw-mono pk-dw-ellip">{it.partId}</td>
      <td className="pk-dw-ellip">{it.run}</td>
    </tr>
  );
}

export function DrawingSetSheets({ data, assets }: { data: DrawingSetData; assets: DrawingSetAssets }) {
  const { project, option, options, optionQuoteNo, slice, spaces, cals, partById, symCtx, set, size, k, area, now, symbolDisplay, symbolUrls, view,
    schedule, schedulePages, sheetById, included, revRows, notes, legend } = data;

  const tb = (d: DrawingSheetDef, i: number) =>
    titleBlockData({
      company: data.company,
      project: { id: project.id, name: project.name, customer: project.customer, siteName: project.siteName, intake: project.intake, createdBy: project.createdBy },
      option: { name: option.name, quoteId: optionQuoteNo },
      optionCount: options.length,
      revisions: revRows,
      set,
      sheet: { number: d.number, title: d.title, scale: d.kind === "plan" ? "AS NOTED" : "NTS" },
      index: i + 1,
      total: included.length,
      now,
    });

  // ⇣ PASTE HERE: the old page's `figPlacement`, `cover` and `body` (see the move instructions below).

  return (
    <div className="pk-drawing-set" data-size={size} style={{ "--dw-screen-zoom": String(SHEET_SIZES[size].screenZoom) } as CSSProperties}>
      {included.map((d, i) => (
        <DrawingSheet key={d.key} size={size} titleBlock={tb(d, i)}>
          {body(d)}
        </DrawingSheet>
      ))}
    </div>
  );
}
```

  **The move (replace the `⇣ PASTE HERE` line).** Cut from the old `set/page.tsx`, unchanged, the block that starts at the
  comment `` // `desc` feeds the device key; `qty` is the marker's unit count (#211: a `` and ends at the closing `};` of
  `const body = (d: DrawingSheetDef) => {` — that is `figPlacement`, `const cover = (…);` and `const body = …`. Paste it in
  place of the marker line. Make exactly one edit inside `body`'s plan branch: the `PlanSheetFigure` prop
  `sheet={{ name: src.name, mime: src.mime, src: \`/api/grid-sheets/${encodeURIComponent(src.id)}\` }}` becomes
  `sheet={{ name: src.name, mime: src.mime, src: assets.sheet(src) }}` (drop the comment above it — it now lives on
  `TEAM_DRAWING_SET_ASSETS`). Everything else the pasted code reads (`slice`, `spaces`, `cals`, `partById`, `symCtx`, `k`,
  `area`, `symbolDisplay`, `symbolUrls`, `view`, `schedule`, `schedulePages`, `sheetById`, `included`, `notes`, `legend`,
  `options`, `option`, `optionQuoteNo`, `project`) is destructured from `data` above. After the move,
  `grep -n "api/grid-sheets\|api/part-documents\|PASTE HERE" src/components/drawing/drawing-set-sheets.tsx` must print
  nothing. If `titleBlockData`'s `company` parameter is typed narrower than `{ name; logoDark; offices }`, pass
  `{ name: data.company.name, logoDark: data.company.logoDark, offices: data.company.offices }` exactly as the page did.

- [ ] **Step 10: Rewrite `src/app/(app)/design/grid/[id]/set/page.tsx`.**

```tsx
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getProject } from "@/lib/stores/grid-projects";
import { SHEET_SIZES, printPageCss, toggleableSheets } from "@/lib/design/grid-drawing-set";
import { loadDrawingSetData, TEAM_DRAWING_SET_ASSETS } from "@/lib/design/drawing-set-data";
import { DrawingSetSheets } from "@/components/drawing/drawing-set-sheets";
import { PrintButton } from "@/components/letter/print-button";
import SetSettingsPanel from "./set-settings-panel";

export const metadata = { title: "Drawing set — Quartzite-6" };
export const dynamic = "force-dynamic";
// Virtual parts (#211) reach listFixtures() on this page — same budget as the editor.
export const maxDuration = 60;

/**
 * The drawing set (#209, spec 2026-09-25 §3): every sheet is one printed
 * page with the architectural title strip — T-001 cover (project, sheet
 * index, symbol legend, general notes), one plan sheet per system per source
 * page, E-501 riser (the saved riser layout), E-60x equipment schedules (no
 * prices). `?size=b|d` overrides the saved size; `?option=` resolves like
 * the riser and schedule. Printed with the shared PrintButton. #301 slice C:
 * the data and the sheets are shared with /print/grid-set/[id].
 */
export default async function DrawingSetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ option?: string; size?: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const { option: requestedOption, size: requestedSize } = await searchParams;
  const project = await getProject(decodeURIComponent(id));
  if (!project) {
    return (
      <div style={{ padding: 24, fontSize: 13.5 }}>
        <p style={{ marginBottom: 10 }}>That design no longer exists.</p>
        <Link href="/design/designs" style={{ color: "#3155a8" }}>← Back to The Grid</Link>
      </div>
    );
  }

  const data = await loadDrawingSetData(project, { requestedOption, requestedSize, assets: TEAM_DRAWING_SET_ASSETS });
  const { optionId, options, option, size, set, all, included, revRows, accent } = data;
  const base = `/design/grid/${encodeURIComponent(project.id)}`;
  const optionQuery = `?option=${encodeURIComponent(optionId)}`;

  return (
    <div className="pk-content" style={{ maxWidth: "none", padding: "22px 24px 64px" }}>
      <style>{printPageCss(size)}</style>
      <div className="pk-doc-toolbar" style={{ maxWidth: "none", justifyContent: "flex-start", flexWrap: "wrap" }}>
        <Link href={`${base}${optionQuery}`} style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--accent)", textDecoration: "none" }}>
          ← {project.name}
        </Link>
        <Link href={`${base}/riser${optionQuery}`} style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--accent)", textDecoration: "none", marginLeft: 14 }}>
          Riser editor →
        </Link>
        <span style={{ marginLeft: "auto", fontSize: 12.5, color: "#8c919c", fontFamily: "var(--font-ui)" }}>
          {`${SHEET_SIZES[size].label} · ${included.length} sheet${included.length === 1 ? "" : "s"}${options.length > 1 ? ` · ${option.name}` : ""}`}
        </span>
        {/* Disabled until every plan figure has painted (or failed). */}
        <PrintButton accent={accent} waitFor="[data-plan-figure]" />
      </div>
      <SetSettingsPanel
        projectId={project.id}
        optionId={optionId}
        size={size}
        set={set}
        defaultDrawnBy={project.createdBy}
        toggles={toggleableSheets(all)}
        revisions={revRows.map((r) => ({ rev: r.rev, letter: r.letter, note: (project.revisions || []).find((x) => x.rev === r.rev)?.note || "" }))}
        standardNotes={data.gridStandardNotes}
      />
      <DrawingSetSheets data={data} assets={TEAM_DRAWING_SET_ASSETS} />
    </div>
  );
}
```

  The toolbar is the old page's, unchanged. Then run the old pins: `npm run test:specs 2>&1 | grep -E "#209|#211|#223" | grep FAIL`
  must print nothing.

- [ ] **Step 11: Create `src/app/print/grid-set/[id]/page.tsx`.**

```tsx
import { notFound } from "next/navigation";
import { DrawingSetSheets } from "@/components/drawing/drawing-set-sheets";
import { loadDrawingSetData, type DrawingSetAssets } from "@/lib/design/drawing-set-data";
import { printPageCss } from "@/lib/design/grid-drawing-set";
import { hasOption } from "@/lib/design/grid-options";
import { gridSetAssetTokenId, parseGridSetId } from "@/lib/design/grid-set-print";
import { signPrintToken, verifyPrintToken } from "@/lib/quote-pdf/token";
import { getProject } from "@/lib/stores/grid-projects";

export const dynamic = "force-dynamic";
export const metadata = { title: "Drawing set", robots: { index: false, follow: false } };
export const maxDuration = 60;

/** The 120 s print token — fails closed; module-level so the clock read stays out of the component body (react-hooks/purity). */
function tokenOk(t: string | undefined, id: string): boolean {
  return !!t && verifyPrintToken(process.env.AUTH_SECRET || "", t, "grid-set", id, Date.now());
}

/** One asset's own token: the page signs only assets it draws for this set (adaptation 6). */
function assetUrl(setId: string, kind: "sheet" | "doc", assetId: string): string {
  const t = signPrintToken(process.env.AUTH_SECRET || "", "grid-set", gridSetAssetTokenId(setId, kind, assetId), Date.now());
  return `/print/grid-set/${encodeURIComponent(setId)}/asset/${kind}/${encodeURIComponent(assetId)}?t=${encodeURIComponent(t)}`;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * #301 slice C (R8) — the signed print route for a Grid design's drawing set
 * (headless Chrome has no session; middleware exempts /print/). id =
 * `<projectId>~<optionId>`; the token is checked before any read; the option
 * must exist exactly (no fallback to another option). 11×17. Every sheet
 * source and symbol drawing loads through a token-scoped asset route.
 */
export default async function PrintGridSetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!tokenOk(first(sp.t), id)) notFound();
  const parsed = parseGridSetId(id);
  if (!parsed) notFound();
  const project = await getProject(parsed.projectId);
  if (!project || !hasOption(project, parsed.optionId)) notFound();
  const assets: DrawingSetAssets = { sheet: (src) => assetUrl(id, "sheet", src.id), doc: (docId) => assetUrl(id, "doc", docId) };
  const data = await loadDrawingSetData(project, { requestedOption: parsed.optionId, requestedSize: "b", assets });
  return (
    <main>
      <style>{printPageCss(data.size)}</style>
      <DrawingSetSheets data={data} assets={assets} />
    </main>
  );
}
```

  `id` from `params` is already decoded by the router (`~` is unreserved and survives either way).

- [ ] **Step 12: The two asset routes.** `src/app/print/grid-set/[id]/asset/sheet/[sheetId]/route.ts`:

```ts
import { getDoc } from "@/db/doc-store";
import { gridSetAssetTokenId, parseGridSetId } from "@/lib/design/grid-set-print";
import { serveGridSheet } from "@/lib/grid-sheet-serve";
import { verifyPrintToken } from "@/lib/quote-pdf/token";
import { getProject, type GridSheet } from "@/lib/stores/grid-projects";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404 });

/** #301 slice C (R8b) — one plan-sheet source for the signed Grid set print:
 *  its own asset token first (the page signed it), then the sheet must be on
 *  that project's sheet list. No team session (headless Chrome fetches it). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; sheetId: string }> }) {
  const { id, sheetId } = await ctx.params;
  const t = new URL(req.url).searchParams.get("t") || "";
  if (!verifyPrintToken(process.env.AUTH_SECRET || "", t, "grid-set", gridSetAssetTokenId(id, "sheet", sheetId), Date.now())) return notFound();
  const parsed = parseGridSetId(id);
  if (!parsed) return notFound();
  const [project, sheet] = await Promise.all([getProject(parsed.projectId), getDoc<GridSheet>("grid_sheets", sheetId)]);
  if (!project || !sheet || sheet.projectId !== project.id || !(project.sheetIds || []).includes(sheet.id)) return notFound();
  return serveGridSheet(sheet);
}
```

  `src/app/print/grid-set/[id]/asset/doc/[docId]/route.ts`:

```ts
import { getBlobStream } from "@/lib/blob";
import { gridSetAssetTokenId } from "@/lib/design/grid-set-print";
import { contentTypeForFileName } from "@/lib/part-docs/files";
import { verifyPrintToken } from "@/lib/quote-pdf/token";
import { getDocument } from "@/lib/stores/part-documents";

export const dynamic = "force-dynamic";

/** #300 (D608) — a stored SVG drawing is served sandboxed, as on /api/part-documents/[id]. */
const SVG_CSP = "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'";
const notFound = () => new Response("Not found", { status: 404 });

/** #301 slice C (R8b) — one symbol / riser drawing for the signed Grid set
 *  print: its own asset token first, then a symbol or riser document with a
 *  stored file. Nothing else (no datasheet, no image) is ever served here. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await ctx.params;
  const t = new URL(req.url).searchParams.get("t") || "";
  if (!verifyPrintToken(process.env.AUTH_SECRET || "", t, "grid-set", gridSetAssetTokenId(id, "doc", docId), Date.now())) return notFound();
  const doc = await getDocument(docId);
  if (!doc || (doc.kind !== "symbol" && doc.kind !== "riser") || !doc.blobKey) return notFound();
  let stream: ReadableStream | null;
  try {
    stream = await getBlobStream(doc.blobKey);
  } catch {
    return new Response("Couldn't read the file — try again", { status: 502 });
  }
  if (!stream) return notFound();
  const contentType = doc.contentType || contentTypeForFileName(doc.fileName);
  return new Response(stream, {
    headers: {
      "content-type": contentType,
      "cache-control": "private, max-age=60",
      "x-content-type-options": "nosniff",
      ...(contentType.startsWith("image/svg") ? { "content-security-policy": SVG_CSP } : {}),
    },
  });
}
```

- [ ] **Step 13: `generateGridDrawingSet`.** Append to `src/lib/estimate-output/package-files-server.ts` (add the imports:
  `blobEnabled`, `putBlob` from `@/lib/blob`; `gridProjectForQuote`, `type GridProject` from `@/lib/stores/grid-projects`;
  `GRID_SET_COPY`, `GRID_SET_STEP_MS`, `GRID_SET_WAIT_FOR`, `gridSetFileName`, `gridSetId`, `gridSetPrintUrl` from
  `@/lib/design/grid-set-print`; `PdfRenderUnavailable`, `renderPrintRouteToPdf` from `@/lib/quote-pdf/render`;
  `signPrintToken` from `@/lib/quote-pdf/token`; `gridSetBlobPath` and `MAX_PACKAGE_FILES` from `./package-files`):

```ts
type GridDeps = {
  secret: string;
  blobOn: boolean;
  now: () => number;
  newId: () => string;
  find: (quoteId: string) => Promise<{ project: GridProject; optionId: string } | null>;
  render: (url: string, opts: { timeoutMs?: number; waitFor?: string }) => Promise<Buffer>;
  put: (pathname: string, bytes: Buffer, contentType: string) => Promise<{ url: string; pathname: string }>;
  remove: (pathname: string) => Promise<void>;
};

/**
 * #301 slice C (D-j, R8) — "Generate from Grid": render the linked design's
 * drawing set (cover, plans, riser, schedules at 11×17) through the signed
 * print route to ONE PDF (adaptation 5) and store it as a `drawing`, source
 * `grid`. An earlier Grid set is replaced. The token is signed right before
 * the render (120 s life). `origin` is the request's own (printOriginFor).
 */
export async function generateGridDrawingSet(quoteId: string, by: string, origin: string, deps: Partial<GridDeps> = {}): Promise<Result<{ file: PackageFile }>> {
  const d: GridDeps = {
    secret: process.env.AUTH_SECRET || "",
    blobOn: blobEnabled(),
    now: Date.now,
    newId: newPackageFileId,
    find: gridProjectForQuote,
    render: renderPrintRouteToPdf,
    put: putBlob,
    remove: deleteBlob,
    ...deps,
  };
  if (!d.secret) return { ok: false, error: GRID_SET_COPY.noSecret };
  if (!d.blobOn) return { ok: false, error: PACKAGE_FILES_COPY.noStorage };
  const q = await getQuote(String(quoteId || ""));
  if (!q || pdfKindForQuoteType(q.quoteType) !== "quote") return { ok: false, error: ONLINE_COPY.gone };
  const hit = await d.find(q.id);
  if (!hit) return { ok: false, error: GRID_SET_COPY.noGrid };
  const current = cleanPackageFiles(q.packageFiles);
  const old = current.filter((f) => f.source === "grid");
  if (current.length - old.length >= MAX_PACKAGE_FILES) return { ok: false, error: PACKAGE_FILES_COPY.full };
  const setId = gridSetId(hit.project.id, hit.optionId);
  let pdf: Buffer;
  try {
    const t = signPrintToken(d.secret, "grid-set", setId, d.now());
    pdf = await d.render(gridSetPrintUrl(origin, setId, t), { timeoutMs: GRID_SET_STEP_MS, waitFor: GRID_SET_WAIT_FOR });
  } catch (e) {
    if (e instanceof PdfRenderUnavailable) return { ok: false, error: e.message };
    console.error("[package] grid drawing set render failed", e);
    return { ok: false, error: GRID_SET_COPY.renderFailed };
  }
  if (pdf.length > MAX_PACKAGE_FILE_BYTES) return { ok: false, error: GRID_SET_COPY.tooBig };
  const stored = await d.put(gridSetBlobPath(q.id), pdf, "application/pdf");
  for (const f of old) await removePackageFileAndBlob(q.id, f.id, { remove: d.remove });
  const file: PackageFile = {
    id: d.newId(),
    kind: "drawing",
    name: gridSetFileName(hit.project.name),
    blobPath: stored.pathname,
    contentType: "application/pdf",
    size: pdf.length,
    source: "grid",
    addedAt: d.now(),
    addedBy: cleanText(by, 120),
  };
  const res = await addPackageFile(q.id, file);
  if (!res.ok) {
    try {
      await d.remove(stored.pathname);
    } catch {
      /* best effort */
    }
    return { ok: false, error: res.reason === "full" ? PACKAGE_FILES_COPY.full : ONLINE_COPY.gone };
  }
  return { ok: true, file };
}
```

- [ ] **Step 14: Action, panel field, button.** In `package-actions.ts` add `import { headers } from "next/headers";`,
  `import { printOriginFor } from "@/lib/quote-pdf/origin";`, `generateGridDrawingSet` (from `package-files-server`) and
  `GRID_SET_COPY` (from `@/lib/design/grid-set-print`), then append:

```ts
/** D-j — "Generate from Grid". Runs under the Estimator page's maxDuration (120 s); one render with 25 s steps fits. */
export async function generateGridDrawingsAction(quoteId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can("send", user.roles)) return { ok: false, error: ONLINE_COPY.needsSend };
  try {
    const h = await headers();
    const where = printOriginFor(process.env, h.get("x-forwarded-host") || h.get("host"), h.get("x-forwarded-proto"));
    if ("error" in where) return { ok: false, error: where.error };
    const r = await generateGridDrawingSet(String(quoteId || ""), user.name, where.origin);
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  } catch (e) {
    console.error("[package] generate from grid failed", e);
    return { ok: false, error: GRID_SET_COPY.renderFailed };
  }
}
```

  Confirm `src/app/(app)/estimator/page.tsx` still exports `maxDuration = 120` (the #222 pin) — the action inherits it.

  In `package-panel-server.ts`: add `grid: { label: string } | null` to `PackagePanel`, add
  `findGrid: (quoteId: string) => Promise<{ project: GridProject; optionId: string } | null>` to `PanelDeps`
  (live: `gridProjectForQuote`), and in `loadPackagePanel`:

```ts
  let grid: PackagePanel["grid"] = null;
  try {
    const hit = await d.findGrid(q.id);
    if (hit) {
      const opt = (hit.project.options || []).find((o) => o.id === hit.optionId);
      grid = { label: `${hit.project.name}${(hit.project.options || []).length > 1 && opt ? ` — ${opt.name}` : ""}` };
    }
  } catch (e) {
    console.warn("[package] grid lookup failed", e instanceof Error ? e.message : e);
  }
```

  and return `grid`. The Task 8 DB check needs no change: its fixture quote has no design, so the live lookup returns null.

  In `package-staff-panel.tsx`, import `generateGridDrawingsAction` and `GRID_SET_COPY`, add:

```tsx
  const generate = () =>
    start(async () => {
      setErr(null);
      setNote(GRID_SET_COPY.generating);
      let r: Awaited<ReturnType<typeof generateGridDrawingsAction>>;
      try {
        r = await generateGridDrawingsAction(quoteId);
      } catch {
        setNote(null);
        setErr(FAILED);
        return;
      }
      setNote(r.ok ? GRID_SET_COPY.generated : null);
      if (!r.ok) setErr(r.error);
      await reload();
    });
```

  and, inside the Upload row after the hidden file input:

```tsx
        <button
          type="button"
          onClick={generate}
          disabled={!canUpload || !panel.grid}
          title={panel.grid ? `From ${panel.grid.label}` : "Link a Grid design to this quote first."}
          style={{ ...btn, ...(canUpload && panel.grid ? {} : off) }}
        >
          Generate from Grid
        </button>
```

  (The panel's `catch {` count rises to 5.)

- [ ] **Step 15: Smoke.** In `DYNAMIC_ROUTES` add:

```ts
  // #301 slice C — the signed Grid set print and its two asset routes without a token: clean 404s before any read.
  { route: "/print/grid-set/GRD-5001~opt-base", expectNotFound: true },
  { route: "/print/grid-set/GRD-5001~opt-base/asset/sheet/gs-1", expectNotFound: true },
  { route: "/print/grid-set/GRD-5001~opt-base/asset/doc/PD-1", expectNotFound: true },
```

- [ ] **Step 16: Run the gates.** tsc 0; test:specs PASS = previous + 15 sync + 5 DB, and **every** `#209`, `#211`, `#223`, `#222`,
  `#299`, `#300` check still passes; eslint on every file this task touched (the old set page baseline counts apply to the
  moved code in its new files); `rm -rf .next && … next build` OK (the print page imports two client components from the
  app route folder — the build proves the boundary).

- [ ] **Step 17: Commit.**

```bash
git add src/lib/stores/grid-projects.ts src/lib/design/grid-set-print.ts src/lib/design/drawing-set-data.ts src/components/drawing/drawing-set-sheets.tsx \
  src/lib/grid-sheet-serve.ts "src/app/api/grid-sheets/[id]/route.ts" "src/app/(app)/design/grid/[id]/set/page.tsx" "src/app/print/grid-set/[id]/page.tsx" \
  "src/app/print/grid-set/[id]/asset/sheet/[sheetId]/route.ts" "src/app/print/grid-set/[id]/asset/doc/[docId]/route.ts" src/lib/quote-pdf/token.ts src/lib/quote-pdf/render.ts \
  src/lib/estimate-output/package-files-server.ts src/lib/estimate-output/package-panel-server.ts "src/app/(app)/estimator/package-actions.ts" \
  "src/app/(app)/estimator/package-staff-panel.tsx" scripts/smoke-routes.ts scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(grid): #301 slice C — signed Grid drawing-set print (shared sheets, per-asset tokens, waitFor) + Generate from Grid

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 10: Final gates and the browser check

**Files:** none (verification only). If anything fails, fix it in the owning task's files and land the fix as a new commit.

- [ ] **Step 1: Full gates on the branch.**

```bash
cd /Users/sm/Downloads/peak-app-299 && export PATH=$HOME/.local/node/bin:$PATH
ps aux | grep -E "tsx|next dev" | grep -v grep          # stop strays (smoke boots its own server)
lsof -nP -iTCP -sTCP:LISTEN | grep -E ":3000|:3100|:3301" || true
df -h /System/Volumes/Data | tail -1
npx tsc --noEmit && echo TSC_OK
npm run test:specs 2>&1 | tail -3
git diff --name-only 9f0bb2e3...HEAD | grep -E '^src/.*\.(ts|tsx)$' | xargs npx eslint
npx eslint scripts/smoke-routes.ts
rm -rf .next && env -u DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npx next build 2>&1 | tail -25
rm -rf .next && npm run test:smoke 2>&1 | tail -15
```

  (`9f0bb2e3` is the Slice B plan commit; the diff covers Slices B and C. Compare eslint against the per-task baselines.)
  Expected: tsc 0; test:specs 0 FAIL (record PASS and the Slice C count = PASS − Task 1's baseline); build OK with
  `/share/quote/[id]/[token]/package.zip`, `…/doc/[docId]`, `…/file/[fileId]`, `/print/grid-set/[id]` and its two asset
  routes in the route list; smoke **218/218 ALL PASSED**. Record every number for the docs.

- [ ] **Step 2: Browser check on a scratch datadir (never `.data/pglite`).** Memory notes
  `peak-exercising-post-routes-safely` and `peak-worktree-dev-server-browser-verification-traps`: the main checkout's
  `AUTH_SECRET` (from `.env.local`), `localhost` not `127.0.0.1`, `lsof` the port first, unregister the service worker on
  first compile. **Never click Upload…, Generate from Grid or Rebuild package** — the dev server loads the real Blob token
  (memory `peak-dev-server-always-loads-real-blob-token`).

```bash
SCRATCH=$(mktemp -d) && echo $SCRATCH
BLOB_READ_WRITE_TOKEN= PGLITE_PATH=$SCRATCH NEXT_TELEMETRY_DISABLED=1 npx next dev -p 3301   # in the background
```

  1. Sign in (dev login as an Admin holding `send` + `approve`; note the user's display name). Build a system quote from a
     seeded lead (Slice B Task 10 Step 2.1's recipe): Lead estimator = you; system `Stage lighting` with Client goals,
     an intro and one ★ key product whose paragraph is blank; system `Rigging` with no goals. Save.
  2. Customer preview → Client link panel (before sending): the gap chips read `No drawings`,
     `1 key product needs a paragraph` and `No client goals on 1 scope` (plus a datasheet chip if the scratch catalog
     has no datasheets for the lines). `Drawings — No drawings yet.`, `Client responses — No responses yet.` If the panel
     does **not** say `File storage isn’t configured on this server.`, the empty `BLOB_READ_WRITE_TOKEN` didn't take:
     carry on, but treat every Blob-touching step below as read-only.
  3. Approve & send, **Copy client link** (a `.1.` v2 token). Sign out. Open the link: below the totals there is **Choose
     your scopes** with both scopes checked and `Selected scopes` equal to the grand total (no Rewards credit on a scratch
     customer; if the customer has one, the note `A Rewards credit of $X applies to your order.` shows and the grand total
     is lower by X — R1). Uncheck `Rigging`: the total drops by exactly Rigging's scope price. No Downloads card and no
     Plans & risers card (nothing to offer on a scratch catalog). `/share/…/package.zip` answers
     `Nothing to download for this estimate.` (404).
  4. Submit with name only: the card turns into `Thanks — <your name> has been notified.` Network: one POST to the share
     page URL with a `next-action` header, 200 (proves the Origin check passes under `no-referrer`). Ask a question with a
     message: `Thanks — <your name> has been notified.`
  5. Sign back in. The Client link panel lists two responses, newest first (`Question · Rev 1 · …`, then
     `Selected scopes · Rev 1 · …` with `Stage lighting` and its price). The bell / to-dos show
     `Client accepted EST-#### Rev 1 — Stage lighting ($…)` and `Client question — EST-####`, due today. The quote's status
     is still **Sent**. The customer's activity feed shows the system note from `Client link`; the lead drawer's activity
     shows a system entry (no change to the lead's first-contact time).
  6. Re-send (edit a qty, Save, Approve & send). Sign out; the **old** link shows the superseded banner and **no** action
     cards; the new link shows them. Recall to draft: the current link shows `Peak is revising this estimate.` and no
     action cards.
  7. **Grid print route (read-only).** Signed in, open `/design/grid/GRD-5001/set` and confirm it renders as before (the
     same sheet count in the toolbar, Print enables once the plans paint). Read the option id from the "Riser editor →"
     link (`?option=…`). Mint a print token and open the print page within 120 s:

```bash
AUTH_SECRET="$(grep '^AUTH_SECRET=' /Users/sm/Downloads/peak-app/.env.local | cut -d= -f2- | tr -d '"')" \
  npx tsx -e 'import { signPrintToken } from "./src/lib/quote-pdf/token"; console.log(signPrintToken(process.env.AUTH_SECRET!, "grid-set", "GRD-5001~<optionId>", Date.now()))'
```

     Sign out, open `http://localhost:3301/print/grid-set/GRD-5001~<optionId>?t=<token>`: the same sheets render at 11×17.
     Network: every sheet/symbol request goes to `/print/grid-set/…/asset/…` (200) and none to `/api/`. Changing one
     character of an asset URL's `t` gives 404. Then render it headless (no Blob involved):

```bash
AUTH_SECRET=… npx tsx -e '
import { signPrintToken } from "./src/lib/quote-pdf/token";
import { renderPrintRouteToPdf } from "./src/lib/quote-pdf/render";
import { writeFileSync } from "node:fs";
const id = "GRD-5001~<optionId>";
const t = signPrintToken(process.env.AUTH_SECRET!, "grid-set", id, Date.now());
renderPrintRouteToPdf(`http://localhost:3301/print/grid-set/${encodeURIComponent(id)}?t=${encodeURIComponent(t)}`,
  { timeoutMs: 90_000, waitFor: "[data-plan-figure]:not([data-ready=\"1\"]):not([data-error=\"1\"])" })
  .then((b) => { writeFileSync(process.env.OUT!, b); console.log("bytes", b.length); });' 
```

     with `OUT=<scratchpad>/grid-set.pdf`, then count pages with pypdf (memory `reference-print-pdf-verification-harness`):
     the page count equals the toolbar's sheet count, and page 2's text includes a plan sheet number.
  8. Narrow to 375 px on the package page (signed out, a sendable state): the action cards fit, no horizontal page
     scroll, the inputs are full width. No console errors on any page. Reset the viewport to desktop.
  9. Stop the dev server (`lsof -nP -iTCP:3301 -sTCP:LISTEN`, kill that PID) and `rm -rf "$SCRATCH"`.

- [ ] **Step 3: Record** the gate numbers and one sentence of the browser result for Task 11. Commit nothing here unless a
  fix was needed.

---

### Task 11: Docs

**Files:**
- Modify: `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md`

- [ ] **Step 1: Recompute the D-number right before writing.** Slices A and B took numbers after D612; other branches may
  hold more.

```bash
git fetch origin --quiet
for r in $(git for-each-ref --format='%(refname)' refs/heads refs/remotes); do
  git show "$r:DECISIONS.md" 2>/dev/null | grep -oE '^## D[0-9]+' | sed 's/## D//'
done | sort -n | tail -1
grep -n "^## 301\." PUNCHLIST.md
```

  Let `N` = max D + 1. Read the end of `DECISIONS.md` to see what Slices A and B used. Punch **#301** exists: **edit it**.
  Grep every ref's DECISIONS.md for `D{N}` once more just before committing.

- [ ] **Step 2: Append seven DECISIONS entries** after the current last one (real numbers):

```markdown
## D{N}. The package's documents: scoped coverage, any visible state (#301 slice C, 2026-10-05)

Each key product on the package page links its datasheet (`/share/quote/<id>/<v2>/doc/<docId>`, attachment, nosniff,
120 / min / IP). The set is what the staff client package would carry for the pinned SENT revision: `quoteBom` (rack lines
expand into members; labor, credit and zero-qty lines drop out) and `resolvePackageDocs` in the quote's own context,
datasheets and spec sheets with a stored file only. Coverage is read with `loadScopedCoverage` — three filtered queries,
never the whole catalog or document tables, no legacy backfill — which gives the full index's answer for that context
(harness-checked). Datasheet links, Downloads and Plans & risers show in every visible state (it was sent); only the
client actions need `canAct`.

## D{N+1}. The package zip: in memory, capped, cached per sent revision (#301 slice C, 2026-10-05)

`/share/…/package.zip` (6 / 10 min / IP) holds `Specifications.docx` (the D94 `assemble` + `buildSpecDocx` over the
revision's BOM, through `quoteSpecParts`, the staff client package's own spec step, extracted unchanged), then every
datasheet and spec sheet, read with the rack submittal's caps (25 MB a file, 60 MB in all, 45 s), and a `LEFT OUT.txt`
naming anything skipped and why. No manuals, cut sheets or rack sheets. Nothing to include → 404 and no Downloads card. The
first download caches the zip in private Blob at `estimate-package/<quote>/rev-<rev>.zip` (`putBlobAt`, no random
suffix); later downloads stream it. Only a build with nothing left out, or left out only by the size cap, is cached. Under
`next dev` the cache is off unless `ESTIMATE_PACKAGE_CACHE=1`: a scratch datadir reuses real quote ids next to the
production Blob token. Staff **Rebuild package** deletes the quote's cached zips.

## D{N+2}. Package drawings: store-owned, frozen per send, upload overrides Grid (#301 slice C, 2026-10-05)

`Quote.packageFiles` (≤ 12; plan / riser / drawing set; PDF, PNG, JPEG or WebP ≤ 25 MB, magic-byte checked, private Blob,
uploaded straight from the browser like the documents collection) has two writers, `addPackageFile` / `removePackageFile`,
under the row lock. `update()` drops it and it is not content (the estimate PDF never goes stale). Every new revision freezes
the list in `docFields`. While the online state is ok, each write is annexed onto the latest sent revision (R13); while
revising, a change waits for the next send. A revision cut before #293 is never given `docFields`. The page and
`/share/…/file/<id>` read only the pinned revision's list (R12). An upload of a kind hides Grid files of that kind. A
removed file's blob is deleted only when no revision still lists it.

## D{N+3}. The Grid drawing set prints through a signed route (#301 slice C, 2026-10-05)

`gridProjectForQuote` scans designs for the option whose `quoteId` is the quote (else a legacy `doc.quoteId`). The set's
data loader (`design/drawing-set-data.ts`) and sheets (`components/drawing/drawing-set-sheets.tsx`) are shared by the team
page and `/print/grid-set/<project>~<option>` (print token kind `grid-set`, 11×17). The print page signs a separate token
per sheet source and symbol drawing it draws (`<set>|sheet|<id>`, `<set>|doc|<id>`), so an asset route serves only what
that page drew. The sheet route also checks the sheet is on the project. `renderPrintRouteToPdf` gained `waitFor`: it
prints once no plan figure is unsettled, and fails rather than print a blank plan. **Generate from Grid** stores ONE PDF
of kind `drawing` (one render with 25 s steps fits the action's 120 s) and replaces an earlier Grid set. To override it,
upload a Drawing set.

## D{N+4}. Client actions: choose scopes, ask a question; status never changes (#301 slice C, 2026-10-05)

The package page's **Choose your scopes** (every scope checked, a live **Selected scopes** total before any Rewards
credit, with the credit named under it — R1) and **Ask a question or request changes** call two public server actions.
Each one re-verifies the v2 token, that the pinned revision is the latest sent one, and that the quote is `sent`
(`canAct`; the store re-checks under the row lock). Limits are 5 per IP per 10 minutes and 30 per quote per day, plus a
honeypot (a hit looks fine and writes nothing) and the field caps (name 120, title 120, email 200 shape-checked, message
4,000; scopes filtered to the revision's). The server computes the total itself. Responses are store-owned
(`appendClientResponse`, ≤ 200, append-only; `update()` drops them). The forms exist only after hydration: no-JS shows
"Turn on JavaScript to respond here, or reply to Peak's email." No cookies.

## D{N+5}. A response notifies the lead estimator; nothing else moves (#301 slice C, 2026-10-05)

Best-effort after the write, each step on its own: a system note on the quote with its customer (`addNoteRecord`, by
"Client link", R15), a `system` activity on the lead when the quote has one (never `note`, which would set first contact),
and one task per assignee, due 11:59 PM Chicago that day: `Client accepted EST-1042 Rev 2 — Lighting, Rigging ($48,250.00)`
or `Client question — EST-1042`. The assignee is the Lead estimator (`owner`, else Prepared by; exact, unique name — R16)
when that user is active, else every active `approve` holder. The confirmation names the Lead estimator, or "Peak Systems
Group". Status and stage never change; Jeff moves the quote to Won after the PO.

## D{N+6}. The package's staff side lives under Client link (#301 slice C, 2026-10-05)

`PackageStaffPanel` (mounted last in `ClientLinkPanel`; actions in `estimator/package-actions.ts`, so `share-actions.ts`
stays #293's) shows staff-only gap chips from the LIVE quote (the next send): parts without a datasheet, no drawings, key
products that need a paragraph, scopes with no client goals. It also lists the drawings (Upload…, Generate from Grid,
remove behind an inline confirm) and the client responses newest first as "Rev N", and holds **Rebuild package**. Anyone
signed in can read it; writes need Send.
```

- [ ] **Step 3: PUNCHLIST.md #301.** Change the heading's status to `— Slices A–C DONE 2026-10-05 (D…–D{N+6})` (keep the
  earlier ranges), and replace the `**Slice C** (spec Phases 4 + 5): …` line with:

```markdown
**Slice C DONE (D{N}–D{N+6}).** Plan: `docs/superpowers/plans/2026-10-05-estimate-output-slice-c.md`.
- **Downloads:** each key product links its datasheet; **Download all (.zip)** gives every datasheet and spec sheet plus
  `Specifications.docx` (a `LEFT OUT.txt` names anything too big or unreadable). The zip is saved after its first download;
  **Rebuild package** (Client link panel) makes the next one fresh.
- **Plans & risers:** upload a plan, riser or drawing set (PDF / image, 25 MB) in the Client link panel, or **Generate from
  Grid** when the quote came from a Grid design. An upload of a kind replaces the Grid file of that kind. Drawings added
  after a send show on the current link at once; while the quote is back in draft they wait for the next send.
- **Client actions:** the client checks the scopes they want (live total) and submits, or asks a question. The Lead
  estimator gets a task, the customer timeline gets a note, the lead gets an activity. The quote's status never changes.
- **Staff:** the Client link panel shows gap chips (no datasheet, no drawings, key products needing a paragraph, scopes with
  no client goals) and every response.

Gates: tsc 0; test:specs <PASS> PASS / 0 FAIL (<n> for #301 slice C); test:smoke 218/218 ALL PASSED; `next build` OK;
eslint no new findings on the changed src files.
Browser: <one sentence from Task 10 Step 2's real result>.

**For Jeff (Slice C).**
1. Copy client links from **production** only. A response on a preview deploy is a production write (one database).
2. After you attach datasheets to parts on a sent estimate, press **Rebuild package** so the client's zip includes them.
3. Tasks go to the quote's **Lead estimator**. If that name doesn't match one active team member exactly, every approver
   gets the task — check Lead estimator names in Settings → Team.
4. Open questions from the spec (non-blocking): should Accept require a typed title / PO number? Should the Lead estimator
   also get an email on accept? Import the Riverview / GET / AAC / Fall Creek starter paragraphs as a follow-up?
```

- [ ] **Step 4: AGENTS.md** — in item 40 (#301), replace `Slice C (downloads, drawings, client actions) follows.` with:

```markdown
    Slice C ✅ (D{N}–D{N+6}): the package page's mount points are filled (`share/.../package-slots.tsx` from
    `estimate-output/package-extras.ts`): per-key-product datasheet links + `/share/.../doc/[docId]`
    (`package-docs-server.ts`, scoped coverage `part-docs/load.ts` `loadScopedCoverage`), the zip
    (`package-zip-server.ts`; `quoteSpecParts` in `client-package-server.ts`; Blob cache `estimate-package/<q>/rev-<n>.zip`),
    Plans & risers from store-owned `Quote.packageFiles` (`package-files.ts`, upload broker
    `/api/quotes/[id]/package-files/upload`, `/share/.../file/[fileId]`), and client actions (`responses.ts`,
    `responses-server.ts`, store-owned `Quote.clientResponses`, task + note + lead activity, no status change). The Grid set
    prints through `/print/grid-set/<project>~<option>` (`design/drawing-set-data.ts` + `components/drawing/drawing-set-sheets.tsx`,
    per-asset tokens, `renderPrintRouteToPdf` `waitFor`). Staff side: `estimator/package-staff-panel.tsx` +
    `package-actions.ts`.
```

- [ ] **Step 5: Commit the docs.**

```bash
git add PUNCHLIST.md DECISIONS.md AGENTS.md
git commit -m "$(cat <<'EOF'
docs: #301 slice C — PUNCHLIST, DECISIONS, AGENTS

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review (done while writing)

- **Spec coverage (Slice C).** §6 datasheets → Task 4 (route, links, `resolvePackageDocs` over the pinned revision's BOM,
  blob-backed datasheet / spec sheet only, attachment, nosniff, 120 / min / IP). §6 zip + D-l + R10 → Task 5 (in memory,
  rack caps, `LEFT OUT.txt`, `Specifications.docx` via the refactored `quoteSpecParts`, Blob cache at
  `estimate-package/<quoteId>/rev-<rev>.zip`, Rebuild in Task 8, 6 / 10 min / IP, no whole-catalog load). §6 package files
  + D-j + R13 → Tasks 1, 3, 6 (record, store writers, `update()` strips, docFields snapshot, annex, upload with magic
  bytes, kind select, remove, file route, override rule, Plans & risers only when present). §6 Grid + D-k + R8 + R9 →
  Task 9 (`gridProjectForQuote`, shared sheets with an asset resolver, `/print/grid-set/[id]` with `grid-set` tokens and id
  `<projectId>~<optionId>`, token-scoped asset routes with membership, `waitFor`, Generate storing a `source: "grid"`
  file), placed last. §7 + D-m + D-n + R1 + R15 + R16 → Tasks 2, 3, 7 (sanitize, caps, honeypot, per-IP / per-quote limits,
  re-verify on every submit, `addNoteRecord` with parent quote + customerId + system, `logActivity` type system, one
  `createTask` per assignee, confirmation naming the lead estimator, the live "Selected scopes" total + credit note, islands
  receiving only ids / names / prices, no status change). §6 staff chips + §7 staff list → Tasks 2, 8. §10 → Global
  Constraints + each task's "never" checks (no blob path or gap reaches a page; islands get no record). §11 Slice C rows
  (response sanitize + caps + section filter, packageFiles snapshot in docFields, `update()` strips the new fields, async
  append writes note + task + no status change, refuses superseded) → Tasks 2, 3, 7; smoke → Tasks 4, 5, 6, 9; browser →
  Task 10.
- **Placeholders.** None left except the two `<…>` values Task 10 / 11 fill from real results (gate numbers, the browser
  sentence, `D{N}`), which the previous slices' plans use the same way. The two "moved verbatim" steps (Task 9 Steps 8–9)
  name the exact source block to move and the one line that changes. The one fragile string check (`Oct 5, 2:14 PM`) names
  its fix.
- **Type consistency.** `PackageFile` / `PackageFileKind` / `PackageFileType` / `PackageFileRow` (Task 1),
  `ClientResponse` / `CleanResponse` / `ClientActionResult` / `ResponseScope` / `RosterUser` / `ResponseRow` (Task 2),
  `PackageFileWrite` / `ClientResponseWrite` (Task 3), `RevisionPackageDocs` / `PackageExtras` and its views (Task 4),
  `BuiltPackageZip` / `LeftOut` (Task 5), `PackagePanel` (Task 8, `grid` added in Task 9), `DrawingSetAssets` /
  `DrawingSetData` (Task 9) are each defined once. `appendClientResponse(id, pinnedRev, r, now, newId)`,
  `addPackageFile(id, file)`, `removePackageFile(id, fileId)`, `loadPackageExtras(hit, base)`,
  `buildPackageSlots(x, ctx)` (ctx added in Task 7, with its one caller updated), `servePackageZip(pkg, deps?)`,
  `generateGridDrawingSet(quoteId, by, origin, deps?)` have the same signature at every use.
