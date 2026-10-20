# Estimator Handoff Prototype (Handoff PR 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `peak-estimator-handoff/`, a confidential, offline, double-click-to-open package for the founder. It runs the **real** Quartzite Estimator in the browser on Peak's production data, with a written spec. The same build also ships as a private claude.ai Artifact (published only on Jeff's go-ahead).

**Architecture:**
- **Bundling.** esbuild bundles the app's own client components unchanged. A plugin swaps every `"use server"` module for a generated stub that routes calls into an in-browser **action registry**. Small shims replace `next/navigation`, `next/link`, `next/dynamic` and `@vercel/blob/client`.
- **Data and persistence.** A **slicer** turns a `db:export` file into `data/*.js` global scripts, using an allow-list. A browser **store** layers IndexedDB edits over that read-only seed. **Ports** fake the parts of Quartzite the founder must supply.
- **Screens.**
  - The Estimator's four steps, Assemblies/racks and Estimating Rules reuse the real components.
  - The Estimates list and the Catalog are slim rebuilds.
  - The customer-facing views (`QuoteDocument`, `PackageView`, cut sheets) render live in the browser, and Print → PDF replaces the headless-Chrome renderer.

**Tech Stack:**
- esbuild 0.25.12 (transitive; added as a pinned devDependency in Task 2)
- `@tailwindcss/postcss` 4.3.2 + postcss
- React 19.2.4, TipTap 3
- IndexedDB
- puppeteer-core 25.11.0 + local Chrome for verification (`chromeLaunch()` in `src/lib/quote-pdf/render.ts`)
- tsx scripts, and the `scripts/test-review-and-spec.ts` harness (`ok(cond, msg)`)

**Spec:** `docs/superpowers/specs/2026-10-20-estimator-handoff-package-design.md` (§2 package, §4 prototype and ports, §5 slice, §6 verification, §7 delivery incl. the Artifact). This builds on PR 1 (`src/lib/estimating-core/`, `npm run core:check`, `npm run core:golden`).

**Proven by the spike** (`/Users/sm/Downloads/peak-app-handoff2/.data-spike/`, gitignored, with `REPORT.md`, `build.ts`, `shims/`, `main.tsx` and `run.ts`):
- The real `EstimatorClient` bundles in about 0.12 s with zero build errors and runs from `file://` in headless Chrome.
- All four steps render, a quantity edit re-prices live, and the BOM quote on the letterhead renders.
- 22 `"use server"` files, 111 exports, 87 of them imported by the client tree.
- **Default stubs must refuse, not succeed:** `{ ok: false, error }`. A generic `{ ok: true }` crashes `ReviewComments` and `VendorsCard`.

Builders: read `.data-spike/REPORT.md` before Tasks 2–5. Its code is the starting point.

## Global Constraints

- **Don't change app behaviour.** Edit `src/` only where a task says so (Task 1: `scripts/export.ts`). The prototype reuses app components by importing them, and replaces modules at bundle time. It never forks a copy into `handoff/` unless the task says "slim rebuild".
- **Peak as-is:** baked letterhead, Chicago time, Peak copy. Configurable branding is out of scope.
- **Layout:**
  - Handoff source lives in `handoff/estimator/`.
  - The build output is `output/peak-estimator-handoff/`, git-ignored, and zips to `output/peak-estimator-handoff.zip`.
  - Package layout is spec §2: `index.html`, `app/`, `data/`, `images/`, `spec/`, `CONFIDENTIAL.txt`.
- **`file://` and Artifact:**
  - No `fetch()` of local files: data loads as `<script src="data/…js">` setting `window.PEAK_*` globals.
  - The only allowed network request is Google Fonts, which is optional because fonts fall back to the family names.
  - The page must work the same opened from `file://` and from an Artifact URL.
- **Artifact limits:** every emitted file is ≤ **15,000,000 bytes**, under the 16 MB limit. The catalog splits into `data/catalog-1.js`, `data/catalog-2.js`, … The total is ≤ 150 MB (spec §5).
- **Persistence:** IndexedDB overlays the read-only seed, and **Reset to production snapshot** clears the overlay. If IndexedDB is unavailable, the app runs in memory and shows "Changes won't be saved in this window".
- **Default stub = refusal:** `{ ok: false, error: "Not available in the prototype" }` plus one `console.warn` per action name. Only registered actions do real work.
- **Data only through the slicer's allow-list.** The slicer refuses to write output that contains anything token- or secret-shaped. `gmailConnections`, `notifPrefs`, comms, assist and portal data are never read.
- **Confidential.** Every page view shows "Confidential — Peak Systems Group". `CONFIDENTIAL.txt` sits at the zip root.
- **Never publish the Artifact**, and never upload, email or share the zip. Plan 2 ends with files on disk. Publishing is a separate step on Jeff's explicit go-ahead.
- **Dev DB is single-process.** Use a copy plus `PGLITE_PATH` (AGENTS.md). Never `git stash`. Never `git add` under `.superpowers/`, `.data-*` or `output/`.
- **Gate per task:** the task's own tests, plus `npx tsc --noEmit -p tsconfig.json` (exit 0) and eslint on changed files. `scripts/test-review-and-spec.ts` crashes eslint on main too, so it's exempt. The last task also runs test:specs, test:smoke (chunked if memory-bound) and `npx next build`.

## File structure

```
handoff/estimator/
  build.ts                 # npm run handoff:build — esbuild + CSS + html + data copy + zip
  esbuild-plugins.ts       # use-server swap, next/* + blob shims, app overrides, .jpg loader
  slice.ts                 # npm run handoff:slice — export → data/*.js (allow-list)
  slice-rules.ts           # pure allow-lists + secret scan (unit-tested)
  fetch-photos.ts          # npm run handoff:photos — Jeff-run; private Blob → images/
  verify.ts                # npm run handoff:verify — parity + headless file:// checks
  shims/                   # next-navigation.ts, next-link.tsx, next-dynamic.tsx, vercel-blob-client.ts, server-only.ts
  runtime/
    actions-registry.ts    # callAction / registerActions / NOT_IN_PROTOTYPE
    seed.ts                # typed access to window.PEAK_* globals
    store.ts               # IndexedDB overlay store (+ memory fallback)
    ports.ts               # customers, users, numbering, email, onWon, clock
    router.ts              # refresh() bus used by the next/navigation shim
    actions/*.ts           # browser implementations, one file per app action module
    props/estimator.ts     # EstimatorProps builder (mirrors src/app/(app)/estimator/page.tsx)
    props/assemblies.ts, props/rules.ts
  ui/
    shell.tsx              # nav, role switcher, Reset, confidential banner, route switch
    estimates-list.tsx     # slim rebuild of the Quotes hub (system estimates only)
    catalog.tsx            # slim rebuild of Catalog browse + part editor
    review-overrides.tsx   # live replacements for the server-page iframes
  main.tsx                 # entry: open store, register actions, mount shell
  index.html               # template
  spec/                    # README.md, data-model.md, pricing.md, ports.md (founder docs)
docs/estimating-core/handoff-fixtures/export-v2.json   # synthetic export incl. customer tables + secret bait
```

---

### Task 1: Export the customer tables; slice an export into `data/*.js`

**Files:**
- Modify: `scripts/export.ts` (add `companies`, `contacts`, `contactEmails`, `contactPhones`, `sites`; `meta.format` 2)
- Create: `handoff/estimator/slice-rules.ts`, `handoff/estimator/slice.ts`, `docs/estimating-core/handoff-fixtures/export-v2.json`
- Create: `scripts/test-handoff-slice.ts`, wired into `scripts/test-review-and-spec.ts` like `goldenChecks`
- Modify: `package.json` (`"handoff:slice": "tsx handoff/estimator/slice.ts"`), `.gitignore` (`/output/`)

**Interfaces:**
- Produces the data contract every later task reads. Each file is a plain script:
  - `data/meta.js` → `window.PEAK_META = { exportedAt, source, sliceVersion: 1, counts: {...} }`
  - `data/rules.js` → `window.PEAK_RULES = { settings: <appSettings.data of id "main">, blobs: { [blobId]: data } }`
  - `data/catalog-<n>.js` → `(window.PEAK_CATALOG = window.PEAK_CATALOG || []).push(...[ ...CatalogPart ])`, chunked so each file is ≤ 15,000,000 bytes
  - `data/fixtures.js` → `window.PEAK_FIXTURES = [ ...FixtureRecord ]`
  - `data/estimates.js` → `window.PEAK_ESTIMATES = [ ...quote docs ]`
  - `data/customers.js` → `window.PEAK_CUSTOMERS = { companies, sites, contacts, contactEmails, contactPhones, geoCache }`
  - `data/team.js` → `window.PEAK_TEAM = [ { id, name, roles, status, title, initials, color } ]`
  - `data/photo-manifest.json` (not loaded by the page; input for Task 11) → `[{ sku, docId, blobKey, sourceUrl }]`
- Exports from `slice-rules.ts`:
  - `pickFields(doc, allow): object`
  - `scanForSecrets(json: string): string[]` (returns the matched rule names; empty means clean)
  - `selectEstimates(rows): QuoteDoc[]`
  - `catalogChunks(parts, maxBytes): string[]` (returns the file bodies)
  - `CATALOG_FIELDS`, `BLOB_IDS`, `SETTINGS_FIELDS`, `QUOTE_FIELDS`, `COMPANY_COLS`, `SITE_COLS`, `CONTACT_COLS`

**Allow-lists** (from the exploration; use these names verbatim):
- `CATALOG_FIELDS`:
  - `id sku desc category unit cost list mfr manufacturerPartNumber manufacturerModelNumber formerSkus pricedAt priceDate costPerSqft curtainAreaRate renamedTo`
  - `rackMount ruHeight rackWidth depthIn weightLb powerWatts maxPowerWatts powerCapacityWatts mountFace airflow rackNotes`
  - `narrativeText narrativeUpdatedAt narrativeUpdatedBy flameRating oz ozBasis note discipline role trade updatedAt`
- `BLOB_IDS`: `pricing_rules fixture_rates travel_rates catalog_rates track_series system_categories curtain_mount_hardware estimate_output_defaults narrative_intros rack_defaults fixtures_convert`
- `SETTINGS_FIELDS` (from `appSettings` row `id:"main"`, `.data`): `companyName logoDark offices reviewLimits peakHeader catalogCategoryMap priceListEffective fixtureAssemblies quotePipelines consultingAssumptions accent`
- `QUOTE_FIELDS`: every field the Estimator page reads:
  - `id estNo estSuffix status quoteType source pipelineId stage name category`
  - `customer customerId locationId contactName quoteNote assumptions installTimeframe paymentTerms coverSummary notIncluded`
  - `owner preparedBy revisions history updatedAt createdAt pricingTier tierMargin spec`
  - `pdfOptions packageSelection review clientResponses bonusRecord estimatorBonusSplit groups`
  - **Excluded:** `shareLink shareOpens packageFiles estimateEmails bid vendorQuotes assistDraft portal* leadId`
- `selectEstimates` keeps a row only when all of these hold:
  - not `deleted`
  - `(doc.quoteType ?? "system") === "system"`
  - `doc.source !== "daylite"`
  - `Array.isArray(doc.spec?.sections)` with at least one item
- Customers: only the companies, sites and contacts the selected estimates reference (`customerId`, `locationId`, plus the contacts at those companies), and `geoCache` rows whose key involves those sites.
- Team: `users` rows with `status === "active"`, limited to the fields listed above (no emails).

- [ ] **Step 1: Write failing tests** in `scripts/test-handoff-slice.ts` (`export async function handoffSliceChecks(ok: Ok)`), run against `docs/estimating-core/handoff-fixtures/export-v2.json`. Build that fixture from the golden fixture's six quotes plus:
  - one Daylite quote (`source: "daylite"`)
  - three companies (two referenced, one not)
  - their sites and contacts
  - a `gmailConnections` row with `refreshToken: "1//0abcdEFGHijkl-SECRET"`
  - a `blobs` row `assist_secrets` holding `"sk-ant-api03-SECRET"`
  - a catalog part whose `note` contains `"ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"`

  Assert:
  - `selectEstimates` → `Q-G001,Q-G002,Q-G003`
  - only referenced companies (and their sites and contacts) are kept
  - nothing from `gmailConnections`, the `assist_secrets` blob or any non-allow-listed blob appears in any emitted file
  - **scrub:** allow-listed free-text fields (`note`, `desc`, `narrativeText`, quote `quoteNote`/`assumptions`) holding a secret-shaped value have that value replaced with `""`; the slice report lists `{ file, id, field, rule }`
  - **backstop:** `scanForSecrets` on the final file bodies returns `[]` for the fixture slice, and returns the rule names for a raw string containing `sk-ant-api03-SECRET`. A slice whose final scan is non-empty exits 1 without writing.
  - `catalogChunks` splits a 3-part list into two files when `maxBytes` is set small, and every chunk is `≤ maxBytes`
  - every emitted `.js` file matches `/^\(window\.PEAK_|^window\.PEAK_/`
  - `--extra-estimates <export.json>` (dev only) appends that export's selected estimates. Used with the golden fixture so dev slices carry an alternate and bonus lines; never used for production.

  Secret rules (regexes): `sk-ant-`, `sk-[A-Za-z0-9]{20,}`, `ghp_[A-Za-z0-9]{30,}`, `1//0[A-Za-z0-9_-]{10,}` (Google refresh token), `ya29\.`, `xox[baprs]-`, `-----BEGIN [A-Z ]*PRIVATE KEY-----`, `vercel_blob_rw_`, `AKIA[0-9A-Z]{16}`.
- [ ] **Step 2: Run** `npx tsx -e 'import("./scripts/test-handoff-slice").then(m=>m.handoffSliceChecks((c,m)=>{if(!c){console.log("FAIL",m);process.exitCode=1}else console.log("PASS",m)}))'`. Expect FAIL: the module is not found.
- [ ] **Step 3: Implement `slice-rules.ts` and `slice.ts`** (CLI: `npm run handoff:slice -- --in <export.json> --out output/peak-estimator-handoff/data`). It reads only `collections.{quotes,catalog_parts,subassemblies,part_documents,part_document_links,manufacturers}`, `blobs`, `appSettings`, `users`, the five customer tables and `geoCache`. It runs `scanForSecrets` on every output body before writing, and exits 1 with the rule names if anything matches.
- [ ] **Step 4: Extend `scripts/export.ts`.** Import `companies, contacts, contactEmails, contactPhones, sites` from `../src/db/schema`, add them as top-level keys next to `geoCache`, set `meta.format: 2`, and log their counts.
- [ ] **Step 5: Make a dev export with the new tables** (copy the DB, no dev server running):
  ```bash
  ps aux | grep -E "next dev|next-server|tsx " | grep -v grep   # nothing on ~/Downloads/peak-app
  mkdir -p .data-handoff && rm -rf .data-handoff/pglite-copy && cp -R ../peak-app/.data/pglite .data-handoff/pglite-copy
  PGLITE_PATH=.data-handoff/pglite-copy OUT=.data-handoff/dev-export.json npm run db:export
  npm run handoff:slice -- --in .data-handoff/dev-export.json --out output/peak-estimator-handoff/data
  ```
  Expected: `Backup written … format 2 …` with the customer-table counts, then a slice summary (counts per file, no secret hits). Record the counts.
- [ ] **Step 6: Wire `handoffSliceChecks` into test:specs** (import next to `goldenChecks`, chain after `coreShimChecks`). Run `npm run test:specs`: 0 FAIL. Commit: `feat(handoff): db:export includes the customer tables; handoff:slice cuts an allow-listed data set`.

---

### Task 2: Build pipeline: the real Estimator from `file://`

**Files:**
- Create: `handoff/estimator/{build.ts,esbuild-plugins.ts,index.html,main.tsx}`, `handoff/estimator/shims/*`, `handoff/estimator/runtime/{actions-registry.ts,seed.ts,router.ts}`
- Create: `handoff/estimator/verify.ts` (smoke mode only in this task)
- Modify: `package.json` (`"handoff:build": "tsx handoff/estimator/build.ts"`, `"handoff:verify": "tsx handoff/estimator/verify.ts"`, devDependency `"esbuild": "0.25.12"`)

**Interfaces:**
- `runtime/actions-registry.ts`:
  ```ts
  export type ActionImpl = (...args: never[]) => unknown;
  export const NOT_IN_PROTOTYPE = { ok: false as const, error: "Not available in the prototype" };
  /** fileKey = repo-relative path of the "use server" file, e.g. "src/app/(app)/estimator/actions.ts". */
  export function registerActions(fileKey: string, impls: Record<string, ActionImpl>): void;
  export async function callAction(fileKey: string, name: string, args: unknown[]): Promise<unknown>;
  export function calledUnregistered(): string[]; // "fileKey#name", for verify.ts
  ```
  An unregistered call returns `NOT_IN_PROTOTYPE` and warns once per `fileKey#name`.
- The generated stub for each export `X` of a `"use server"` file:
  `export async function X(...a) { return callAction("<fileKey>", "X", a); }`
- `runtime/router.ts`: `export function onRefresh(fn: () => void): () => void; export function refresh(): void;`. The `next/navigation` shim's `useRouter().refresh()` calls `refresh()`, and `push(href)` navigates within the shell (Task 7). Until then it falls back to `location.assign`.
- `runtime/seed.ts`: typed getters `seedCatalog()`, `seedRules()`, `seedEstimates()`, `seedCustomers()`, `seedTeam()`, `seedFixtures()`, `seedMeta()`. Each reads its `window.PEAK_*` global, or returns an empty value if the global is absent.
- `build.ts` writes `output/peak-estimator-handoff/{index.html, app/app.js, app/app.css, app/assets/*}`, copies `data/` (if a slice exists) and `images/` (if present), and writes `CONFIDENTIAL.txt`.
- `verify.ts --smoke` opens `index.html` from `file://`, waits for `[data-handoff-ready]`, and fails on any `pageerror`, any request that is not `file:` or Google Fonts, or any unregistered call outside a known-allowed list (empty in later tasks).

- [ ] **Step 1: Start from the spike.** Move `.data-spike/build.ts` and `shims/` logic into the files above:
  - stub generation goes through the registry
  - the default is `NOT_IN_PROTOTYPE`
  - the `.jpg/.png/.webp` file loader returns `{ src }`
  - `next/dynamic` uses `React.lazy` + `Suspense`
  - the navigation shim patches `history.pushState/replaceState` and listens to `popstate`
  - the CSS compiles via `postcss([tailwind()])` from `src/app/globals.css`
  - `index.html` has the Google Fonts `<link>` for Public Sans + IBM Plex Mono, `--font-public-sans` / `--font-plex-mono` set on `<body>`, `--accent: #b08d4a; --accent-contrast: #16181b` on `<html>`, the data `<script>` tags in dependency order (rules, team, customers, fixtures, catalog-*, estimates, meta), then `app/app.js`
- [ ] **Step 2:** Until Task 3 lands, `main.tsx` mounts `EstimatorClient` with props built from the slice. Use the spike's `main.tsx` props, swapping its hand-written values for `seed.ts` reads (first estimate in `PEAK_ESTIMATES`). Add `data-handoff-ready` to the root after the first render.
- [ ] **Step 3: Write `verify.ts --smoke`** with puppeteer-core (`chromeLaunch()` from `src/lib/quote-pdf/render.ts`, pattern at `scripts/test-photo-wrap.ts` ~474–488). Pass the init script as a string, not a function, because tsx injects `__name`.
- [ ] **Step 4: Run** `npm run handoff:build && npm run handoff:verify -- --smoke`. Expected:
  - the build lists `app.js` (~1.6 MB), `app.css` (~70 KB) and the data files
  - the smoke check reports PASS, 0 page errors, 0 foreign requests
  - screenshot `output/verify/smoke-build.png`
- [ ] **Step 5:** `npx tsc --noEmit -p tsconfig.json` (handoff/ is included by `**/*.ts`), plus eslint on `handoff/`. Commit: `feat(handoff): esbuild pipeline runs the real Estimator from file:// (server actions → in-browser registry)`.

---

### Task 3: Browser store, ports and the Estimator props builder

**Files:**
- Create: `handoff/estimator/runtime/{store.ts,ports.ts}`, `handoff/estimator/runtime/props/estimator.ts`
- Create: `scripts/test-handoff-runtime.ts` (pure parts: overlay merge, numbering, ports), wired into test:specs

**Interfaces:**
- `store.ts`:
  ```ts
  export type Coll = "quotes" | "catalog" | "fixtures" | "blobs" | "settings" | "reviewComments" | "activity" | "intros" | "meta";
  export interface HandoffStore {
    persistent: boolean;                                  // false = in-memory fallback
    get<T>(c: Coll, id: string): Promise<T | undefined>;  // overlay ?? seed; tombstone → undefined
    all<T>(c: Coll): Promise<T[]>;                        // seed ∪ overlay − tombstones, overlay wins
    put<T extends { id: string }>(c: Coll, doc: T): Promise<void>;
    remove(c: Coll, id: string): Promise<void>;           // writes a tombstone
    reset(): Promise<void>;                               // deletes the IndexedDB database
  }
  export function openStore(seed: { [K in Coll]?: Array<{ id: string }> }): Promise<HandoffStore>;
  export function overlayMerge<T extends { id: string }>(seed: T[], overlay: Map<string, T | null>): T[]; // pure, tested
  ```
  The database name is `peak-estimator-handoff`, with one object store per `Coll` plus `tombstones`. The seed is never copied into IndexedDB.
- `ports.ts` (the founder's integration points; each export carries a JSDoc contract that Task 12 copies into `spec/ports.md`):
  ```ts
  export const customers: { all(): CustomerLite[]; resolve(id: string): …; tierFor(customerId, contactName?): string; travelFor(locationId: string): TravelLite };
  export const users: { current(): TeamUser; setCurrent(id: string): void; can(perm: "create"|"approve"|"send"|"manage_users"): boolean; approvers(): TeamUser[]; all(): TeamUser[] };
  export const numbering: { nextEstNo(): Promise<number> };       // starts after max(estNo) in the seed
  export const email: { send(msg: { to: string[]; subject: string; body: string; quoteId: string }): Promise<{ id: string; at: number }> }; // writes "activity", never sends
  export const onWon: { run(quoteId: string): Promise<{ note: string }> };   // "Would create install project …"
  export const clock: { now(): number; timeZone: "America/Chicago" };
  ```
  `ROLE_PERMS` is imported from `src/lib/team.ts`. Travel follows `geo.ts` `travelForId` order: site `travelMiles`/`travelMin`, then `geoCache`, then haversine from the `quoteDefault` office using `travel_rates`. Port the order; reuse pure helpers where importable.
- `props/estimator.ts`: `export async function buildEstimatorProps(store, quoteId: string | null, search: URLSearchParams): Promise<EstimatorProps>`. Mirror `src/app/(app)/estimator/page.tsx` lines ~124–619 prop by prop, reusing its pure helpers. Fixed values:
  - `blobUploads: false`, `vendorPdfEnabled: false`, `aiSource: null`, `assistDraft: null`, `suggestion: null`
  - `quoteTasks: []`, `templateSets: []`, `specKeys: []`, `portalStatusError: null`
  - `canApplyCredit: false`
  - `next` from `quoteNextStepFor` with the ports' current user

- [ ] **Step 1: Failing tests** in `scripts/test-handoff-runtime.ts`: `overlayMerge` (overlay wins, tombstones hide, seed order kept, new ids appended), `numbering` (after max `estNo`), and `ports.users.can` per role (Admin/Manager/Estimator/Reviewer from `ROLE_PERMS`).
- [ ] **Step 2: Run them.** Expect FAIL.
- [ ] **Step 3: Implement** `store.ts`, `ports.ts` and `props/estimator.ts`, then switch `main.tsx` to `buildEstimatorProps`.
- [ ] **Step 4: Browser check** (extend `verify.ts` with `--estimator <quoteId>`): open the slice's first estimate, assert the header total equals the golden `totals.grand` for that quote (`npm run core:golden -- --in .data-handoff/dev-export.json --out .data-handoff/golden` first), and get 0 page errors.
- [ ] **Step 5:** Run tests, tsc and eslint. Commit: `feat(handoff): IndexedDB overlay store, ports and an EstimatorProps builder`.

---

### Task 4: Estimator actions that do real work (Build + save)

**Files:**
- Create: `handoff/estimator/runtime/actions/estimator-actions.ts` (for `src/app/(app)/estimator/actions.ts`)
- Create: `handoff/estimator/runtime/actions/quotes-actions.ts` (for `src/app/(app)/quotes/actions.ts`)
- Register both in `main.tsx`

**Interfaces:**
- **Real implementations**, over `store` + `ports`, matching the app action's argument and result shapes. Read each original in `src/app/(app)/estimator/actions.ts` and mirror its validation and result.
  - `saveQuoteAction`: port lines ~418–820. Keep:
    - the id/estNo assignment (`numbering`)
    - revisions on status change
    - the sanitize helpers the original calls (groups, package doc, selection, bonus re-derivation via `src/lib/estimate-bonus`)
    - `updatedAt`
  - Drop: reward-credit settle (credit is off), PDF scheduling (no PDFs), task creation, the lead link.
  - `searchCatalog`: rank the local catalog with `src/lib/estimating-core/catalog-rank.ts` the way the original does.
  - `resolveTierAction`, `travelForSelectionAction`: via `ports.customers`.
  - `updateQuoteMetaAction`, `setQuotePeopleAction` (permission check through `ports.users.can`), `resolveCatalogSkusAction`, `saveEstimatorCustomPartAction` (writes the `catalog` overlay).
  - `setStatusAction`: on `won`, call `ports.onWon.run` and record an activity entry.
  - `setQuoteStageAction`, `setQuotePipelineAction`, `saveBonusSplitAction`, `saveBonusAlternatesAction`, `moveSystemToEstimateAction`, `copySystemToEstimateAction`, `searchQuotesAction`.
  - From quotes/actions: `setQuoteStatus`, `deleteQuoteAction` (tombstone).
- **Refused** (registered explicitly, returning `NOT_IN_PROTOTYPE`): `draftQuoteScopeAction`, the task actions (`add/remove/updateQuoteTaskAction`, `setQuoteTaskStatusAction`, `applyQuoteTemplateAction`) and `declinePortalAcceptanceAction`.

- [ ] **Step 1: Write the failing browser test** in `verify.ts --estimator-edit`:
  - open the estimate
  - set the first line's qty to +1
  - click Save and wait for the saved state
  - reload, and assert the qty and the header total survived
  - "+ Add part from catalog": search "ColorSource" (or the first catalog SKU in the slice), add it, Save, reload, assert the line is present
  - "New estimate" via `?new=1` (Task 7 adds the button): pick a customer, add a system, Save, assert an `EST-<n>` number appears with n > max seed `estNo`
- [ ] **Step 2: Run it.** Expect FAIL (the save refusal banner).
- [ ] **Step 3: Implement and register.** Re-run until PASS. Also run `--smoke`: there must be no unregistered calls on the Build step except those in the "refused" list.
- [ ] **Step 4:** Run tsc and eslint. Commit: `feat(handoff): Build step saves, searches the catalog and prices tiers/travel in the browser`.

---

### Task 5: Customer-facing views live in the browser (Build package, Customer review, Print → PDF)

**Files:**
- Create: `handoff/estimator/ui/review-overrides.tsx`, `handoff/estimator/runtime/actions/review-actions.ts`, `narrative-actions.ts`, `library-actions.ts`, `client-package-actions.ts`, `package-actions.ts`, `output-actions.ts`, `pdf-actions.ts`
- Modify: `handoff/estimator/esbuild-plugins.ts` (component overrides by resolved path)

**Interfaces:**
- **Component overrides.** The plugin maps these resolved files to handoff modules exporting the same names:
  - `src/app/(app)/estimator/preview-doc.tsx` and `src/components/quote-pdf/quote-pdf-viewer.tsx` → render `QuoteDocument` live (props from `src/lib/quote-pdf/quote-document-data.ts`, via a browser port of `document-loader.ts` over the store), plus a **Print / Save as PDF** button (`window.print()` with print CSS that shows only the document).
  - The Customer review tabs component that iframes `/estimator-preview/:id` (`src/lib/estimate-review/review-ui.ts:85` / `review-tabs`) → render the tabs live:
    - Document: `QuoteDocument`
    - Package page: `PackageView` from `package-model.ts`, via a browser port of `package-live-loader.ts`
    - BOM: `liveBomDocumentProps`
    - Cut sheets: `CutSheetPages`, via a browser port of `src/lib/curtain-cut-sheets/load.ts`
    - Datasheets, Drawings: "Not included in the prototype"
  - `window.open('/estimator/cut-sheets?id=…')` → open the cut-sheet view in the shell (Task 7 route) or an in-page overlay.
  - The text `"/api/part-documents/<id>"` → `images/<file>` via `window.PEAK_PHOTOS` (Task 11). Until then, the placeholder chain from `src/lib/part-image-fallback.ts` (`public/placeholders/*.webp`, copied to `app/assets/`).
- **Actions:**
  - review: `listReviewCommentsAction` (returns `{ ok: true, comments: [] }` shapes), `addReviewCommentAction`, `resolveReviewCommentAction`, `deleteReviewCommentAction` → `reviewComments` coll; `reviewDocsAction` → `{ ok: false, error }`.
  - narrative: `keyProductLibraryAction`, `saveProductParagraphAction` (catalog overlay `narrativeText`), `upsertSystemIntroAction`, `deleteSystemIntroAction` (`intros` coll seeded from blob `narrative_intros`).
  - library: `searchSystemLibraryAction`, `getSystemLibraryEntryAction`, `loadLibrarySystemAction` over sent/won estimates in the store. Reuse the pure parts of `src/lib/narrative/system-library.ts`. Port the store reads in `src/lib/narrative/system-library-index.ts` and `src/lib/narrative/load-system.ts` to `store.all("quotes")` / `store.all("catalog")`.
  - `clientPackageDocsAction`: `{ ok: true, docs: [] }`, or real coverage if cheap.
  - `packagePanelAction`: a shape-valid empty panel (no files).
  - `surveyGoalsAction`, `siteVisitGoalsAction`: `{ ok: true, goals: [] }`.
  - `quotePdfStatusAction`: `{ ok: true, state: "none" }`-shaped. Read the original for the exact shape.
- Every implementation's success shape **must match the original's type exactly**. Use the real function's return type via `Awaited<ReturnType<typeof import("…").X>>` in a type-only import, so tsc enforces it.

- [ ] **Step 1: Failing browser test** `verify.ts --review`:
  - Build package → BOM quote shows the letterhead and the golden grand total.
  - Customer review → the Document, Package page and BOM tabs each render non-empty content with no iframe to `/estimator-preview`.
  - Add a review comment and reload: it persists.
  - Print button: `page.emulateMediaType("print")` plus a screenshot, and the nav is hidden.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** → PASS, 0 page errors.
- [ ] **Step 4:** Run tsc and eslint. Commit: `feat(handoff): customer review, package page, BOM and cut sheets render live; Print → PDF`.

---

### Task 6: Send & track simulated, approval next-step, remaining refusals

**Files:**
- Create: `handoff/estimator/runtime/actions/{send-actions.ts,next-step-actions.ts,misc-refusals.ts}`

**Interfaces:**
- `send-actions` (for `src/app/(app)/estimator/send-actions.ts`):
  - `estimateEmailDefaultsAction` returns the recipient/subject/body defaults built the way the original does (contact from `ports.customers`).
  - `sendEstimateEmailAction` → `ports.email.send`, then marks the quote sent (status + revision, as the original's ordered action does, minus Gmail/PDF/thread), records activity, and returns the original's success shape.
  - `sendTrackAction` returns activity entries for the quote.
  - Refused: `openEstimateInInboxAction`, `markEstimateEmailReadAction`, `replyToEstimateEmailAction`.
- `next-step-actions` (for `src/app/(app)/quotes/review-actions.ts`): `nsSubmitAction`, `nsApproveAction`, `nsAttestAction`, `nsSendAction`, `nsSendBackAction`, `nsWithdrawAction`. Port the state machine through the app's pure rules (`src/lib/quote-approval-rules.ts`, `src/lib/approval-snapshot.ts`, `quote-next-step`) with `ports.users` as the actor.
- `misc-refusals`: explicit `NOT_IN_PROTOTYPE` for bids, bid-send, share, vendor, vendor-pdf, assist, grid-design, parties, rewards, inbox link-popup and vendors search. Shape exceptions where a mount-time caller needs one:
  - `listPartiesAction` → `{ ok: true, parties: [] }`
  - `bidPanelAction`, `vendorsPanelAction`, `shareLinkStatusAction`, `rewardCreditInfoAction`, `purchasePerksBannerAction`: the original's "empty / not applicable" success shape if one exists, otherwise refusal

  Verify each against the component, and record each choice in a comment.
- After this task, `verify.ts --smoke --all-steps` must report **zero unregistered calls**.

- [ ] **Step 1: Failing browser test** `verify.ts --send`:
  - As Estimator: Submit for approval.
  - Switch to Manager (role switcher via `localStorage["handoff.user"]` until Task 7): Approve.
  - Send to customer: the composer is pre-filled; Send.
  - Status becomes Sent, the Activity card shows "Sent (simulated)", and a reload keeps it.
  - Mark Won: the activity shows "Would create install project".
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** → PASS. Also `--smoke --all-steps` with 0 unregistered calls.
- [ ] **Step 4:** Run tsc and eslint. Commit: `feat(handoff): simulated send & track, approval next-step, explicit refusals for out-of-scope panels`.

---

### Task 7: App shell + Estimates list

**Files:**
- Create: `handoff/estimator/ui/shell.tsx`, `handoff/estimator/ui/estimates-list.tsx`
- Modify: `main.tsx`, `shims/next-navigation.ts` / `next-link.tsx` (in-shell routing)

**Interfaces:**
- Routes are hash-based so `file://` and the Artifact behave the same:
  - `#/estimates`
  - `#/estimate/<id>` (keeps `?step=` in `location.search` as the Estimator expects)
  - `#/estimate/new`
  - `#/catalog`
  - `#/assemblies`
  - `#/rules`

  `router.push(href)` maps app paths onto these routes: `/estimator?id=X` → `#/estimate/X`, `/quotes` → `#/estimates`, `/catalog` → `#/catalog`, `/design/assemblies` → `#/assemblies`, `/estimating-rules` → `#/rules`. Unknown paths show a "Not part of the prototype" notice.
- Shell:
  - top nav (Estimates · Catalog · Assemblies · Estimating Rules)
  - a role/user switcher (`ports.users.setCurrent`, persisted in `localStorage`)
  - **Reset to production snapshot** (confirm dialog, then `store.reset()` and reload)
  - the permanent banner "Confidential — Peak Systems Group · prototype — nothing is sent or saved to Peak"
  - the "Changes won't be saved in this window" notice when `!store.persistent`
- Estimates list (slim rebuild in the Quotes hub's visual style, with `pk-*` classes): system estimates only. Columns: estimate # (`displayQuoteNumber`), name, customer, status, owner, updated, grand total (`totals()` from estimating-core). Search box, status filter, newest first, "New estimate" button.

- [ ] **Step 1: Failing browser test** `verify.ts --shell`: the list shows N rows (N = slice estimate count) and the first row's total equals its golden grand. Opening a row lands on Build, and the browser back button returns to the list. Switching role to Reviewer hides "New estimate" (`can("create")` false). Reset restores an edited quantity to the seed value.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** → PASS.
- [ ] **Step 4:** Run tsc and eslint. Commit: `feat(handoff): shell with hash routes, role switcher, reset, and the Estimates list`.

---

### Task 8: Catalog browse + part editor (slim rebuild)

**Files:**
- Create: `handoff/estimator/ui/catalog.tsx`, `handoff/estimator/runtime/actions/catalog-actions.ts` (only if a reused island needs one)

**Interfaces:**
- **Browse:**
  - search over the full catalog with the same ranking as the Estimator picker (`catalog-rank.ts`)
  - category and manufacturer facets
  - paged table showing SKU / model, description, manufacturer, category, unit, cost, list, primary photo thumbnail
- **Part editor drawer:** edits `desc`, `category`, `unit`, `cost`, `list`, `mfr`, `manufacturerPartNumber`, `manufacturerModelNumber`, the rack fields and `narrativeText`. Save writes the catalog overlay. New part: SKU uniqueness against `store.all("catalog")`.
- **Performance:** first paint of `#/catalog` ≤ 2 s on the full slice. Build the search index lazily, and never render more than 100 rows.

- [ ] **Step 1: Failing browser test** `verify.ts --catalog`:
  - search a known SKU from the slice → it's the first result
  - edit its list price and save
  - open an estimate, add that part, and confirm the new list price drives the line (cost/list per `catalogAddPrice` semantics)
  - Reset restores it
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** → PASS, with the timing logged.
- [ ] **Step 4:** Run tsc and eslint. Commit: `feat(handoff): catalog browse + part editor over the full production catalog`.

---

### Task 9: Assemblies and racks (reuse the real builder)

**Files:**
- Create: `handoff/estimator/runtime/props/assemblies.ts`, `handoff/estimator/runtime/actions/assemblies-actions.ts`
- Modify: the shell route `#/assemblies` (and `#/assemblies/rack/<id>`)

**Interfaces:**
- Mount the real client component(s) that `src/app/(app)/design/assemblies/page.tsx` renders (FixtureBuilder), with props mirrored from that page, and the rack sheet (`RackSheets`) with a browser port of `src/lib/rack/load.ts`.
- Actions (`src/app/(app)/design/assemblies/actions.ts`): `saveFixture`, `deleteFixture`, `saveRackDefaults` and `searchAssemblyParts` do real work over the `fixtures` / `blobs` / `catalog` colls. `setOwnDatasheet` is refused.

- [ ] **Step 1: Failing browser test** `verify.ts --assemblies`:
  - the list shows the slice's fixtures
  - create a fixture with two catalog parts and save
  - open an estimate, "+ Add assembly", pick it: the line prices at the fixture's sell
  - open a rack and confirm the elevation SVG renders
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** → PASS.
- [ ] **Step 4:** Run tsc and eslint. Commit: `feat(handoff): assemblies and racks run the real builder in the browser`.

---

### Task 10: Estimating Rules (reuse the real editors)

**Files:**
- Create: `handoff/estimator/runtime/props/rules.ts`, `handoff/estimator/runtime/actions/rules-actions.ts`
- Modify: the shell route `#/rules`

**Interfaces:**
- Mount the client components `src/app/(app)/estimating-rules/page.tsx` renders (`controls.tsx` and the sub-clients: track-series, curtain-mounts, system-categories). Conduit sizes are a Grid concern: refuse it or hide it.
- `controls.tsx:14` value-imports `src/lib/stores/venue-classes`. It's pure, but under `stores/`. Confirm that it bundles; if it pulls server code, override it with a browser module exporting the same values.
- Register real implementations for the ~14 actions across `src/app/(app)/estimating-rules/**/actions.ts`, writing the `blobs` coll. Pricing helpers read rules from `store` (the props builder and estimator actions must read blobs through the store, not `seedRules()` directly, so edits take effect). Refuse `searchEquipmentPartsAction` (Grid).

- [ ] **Step 1: Failing browser test** `verify.ts --rules`:
  - change the Good tier margin, save, open a new estimate on the Good tier, add a catalog part: the unit sell reflects the new margin
  - change a track series stick length and confirm the track modal shows it
  - Reset restores both
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** → PASS.
- [ ] **Step 4:** Run tsc and eslint. Commit: `feat(handoff): estimating rules editable in the browser and wired into pricing`.

---

### Task 11: Product photos (Jeff-run fetch from private Blob)

**Files:**
- Create: `handoff/estimator/fetch-photos.ts`
- Modify: `slice.ts` (emit `data/photos.js` → `window.PEAK_PHOTOS = { [sku]: "images/<file>" }` when `images/manifest.json` exists)
- Modify: `package.json` (`"handoff:photos": "tsx handoff/estimator/fetch-photos.ts"`)

**Interfaces:**
- `npm run handoff:photos -- --in <export.json> --out output/peak-estimator-handoff/images [--dry-run]`.
- **Which photo:**
  - Primary photo per SKU on a sliced estimate or fixture, chosen with the app's own rules (`visibleImagesForParts` / `compareImages` in `src/lib/part-docs/types.ts`) over the export's `part_document_links` + `part_documents`.
  - Fallback: the manufacturer image (`manufacturers.imageDocumentId`).
- **Download:** via `@vercel/blob` `get(blobKey, { access: "private" })`, which needs `BLOB_READ_WRITE_TOKEN` in Jeff's shell.
  - Skip link-only docs (`blobKey: null`), but record them.
  - Write `<docId>.webp`.
  - Concurrency 6, retry 2.
  - Write `images/manifest.json` as `{ sku: file }`.
- `--dry-run` prints the selection with no token needed. Unit-test the selection on the export-v2 fixture (add two image docs and links to it).

- [ ] **Step 1: Failing test** (`scripts/test-handoff-slice.ts`): selection picks the higher-ranked image, skips hidden links, and falls back to the manufacturer image.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** → PASS. `--dry-run` on the dev export prints counts.
- [ ] **Step 4:** Run tsc and eslint. Commit: `feat(handoff): handoff:photos fetches primary product photos from private Blob (Jeff-run)`.

---

### Task 12: Founder docs, parity, full verification, zip

**Files:**
- Create: `handoff/estimator/spec/{README.md,data-model.md,pricing.md,ports.md}`
- Modify: `build.ts` (also emit a **readable**, unminified `app/estimating-core.js` bundle of `src/lib/estimating-core/index.ts` as an ESM/IIFE global `PeakEstimatingCore`; copy `spec/`, the golden files and screenshots; write the zip)
- Modify: `verify.ts` (`--parity`, `--full`)

**Interfaces:**
- **`--parity`:**
  - Load `app/estimating-core.js` in Node (vm or `require` of an IIFE built for node).
  - For every estimate in `data/estimates.js`, compute `goldenFor` with it and compare byte-for-byte against `npm run core:golden` output for the same export (`spec/golden/*.json`, written by build).
  - Must be identical.
- **`--full`:**
  - Smoke all routes.
  - Open 20 estimates: all if fewer, else a seeded deterministic sample that must include at least one with an alternate, a rack line, a curtain + track pair and bonus lines (choose by inspecting `spec.sections`). Each header total must equal its golden grand.
  - Run the edit, persist and Reset cycle.
  - 0 page errors, 0 non-`file:`/fonts requests, 0 unregistered calls.
  - Every file in the package ≤ 15,000,000 bytes, total ≤ 150 MB.
- **Founder docs:**
  - **`spec/README.md`:** what it is; how to open (double-click `index.html`, Chrome/Edge/Safari); what's real (the engine, the data) and what's faked (the ports, send, PDFs via Print); the "Not included" list from spec §1; the confidentiality note.
  - **`spec/data-model.md`:**
    - quote / system (`SpecSection`) / line (`SpecItem`) / group / alternate / revision fields
    - status and approval lifecycle
    - estimate numbering
    - service quotes share Quartzite's `quotes` table, but the prototype shows `quoteType: "system"` only
    - generated from `src/lib/estimating-core/types.ts` doc comments plus hand prose
  - **`spec/pricing.md`:** every formula in words (line ext sell, system sell, freight, $25 rounding/typed sell, tiers/margins, labor/mobilization, bonuses 5%/2%, alternates, options, curtains/fabric, track sticks, fixtures, racks). Each points to the function in `app/estimating-core.js`.
  - **`spec/ports.md`:** the ports' JSDoc contracts.
- **Screenshots:** `verify --full` saves 1440×900 shots of each step plus Catalog, Assemblies and Rules into `spec/screenshots/`.
- **Zip:** `output/peak-estimator-handoff.zip`, with `CONFIDENTIAL.txt` at the root.

- [ ] **Step 1:** `--parity` and `--full` fail before the docs and `estimating-core.js` exist. **Step 2:** Implement until both PASS on the dev slice.
- [ ] **Step 3: Full repo gate:**
  - `npx tsc --noEmit -p tsconfig.json`
  - `npm run test:specs` (0 FAIL; report PASS count)
  - `npm run core:check`
  - `npm run test:smoke` (chunked if `next dev` is memory-killed, as in PR 1)
  - `npx next build`
  - eslint on every changed file (except the harness)
- [ ] **Step 4:** Commit: `feat(handoff): founder spec docs, parity + full browser verification, zip`.

---

### Task 13: Bookkeeping + the production run checklist

**Files:** `DECISIONS.md`, `PUNCHLIST.md` (append to #359 or add the next number for PR 2), `AGENTS.md` (append to phase 66), `handoff/estimator/spec/README.md` (production steps)

- [ ] **Step 1:** Recompute the next free D-number, punch number and phase against `origin/main` (`git fetch` first). Add decisions:
  - the bundling approach (real components + `"use server"` swap + refusal default)
  - the IndexedDB overlay store
  - hash routes
  - the slicer allow-list and secret scan
  - `db:export` format 2 (customer tables)
  - photos from private Blob, run by Jeff
  - the Artifact layout (≤ 15 MB files, publish only on Jeff's go-ahead)
- [ ] **Step 2: Document Jeff's production run** in the PUNCHLIST item and README:
  ```bash
  # 1. production export (format 2 — includes customers)
  DATABASE_URL=<prod> OUT=~/peak-prod-export.json npm run db:export
  # 2. photos (needs the production Blob token in the shell)
  BLOB_READ_WRITE_TOKEN=<prod token> npm run handoff:photos -- --in ~/peak-prod-export.json --out output/peak-estimator-handoff/images
  # 3. slice + build + verify
  npm run handoff:slice -- --in ~/peak-prod-export.json --out output/peak-estimator-handoff/data
  npm run handoff:build && npm run handoff:verify -- --parity --full
  ```
  Then Claude reviews the verify report and screenshots. The zip goes to Jeff, and the Artifact is published only on his go-ahead.
- [ ] **Step 3:** Commit: `docs(handoff): PR 2 decisions, punch item, phase entry, production run checklist`.

---

## Notes for the executor

- **Model tiers:**
  - Tasks 2, 4, 5, 6 and 10 need the most capable model. They read large app files (`actions.ts` ~1,700 lines, `page.tsx` ~620) and mirror shapes exactly.
  - Tasks 1, 3, 7, 8, 9 and 11 use the standard model.
  - Tasks 12 and 13 use the standard model.
- **Reviewer emphasis:** confirm that every registered action's success shape matches the original's TypeScript return type (`Awaited<ReturnType<…>>`), and that no `src/` file except `scripts/export.ts` changed.
- **The dev slice is thin** (the local DB holds about one live system estimate). Tasks 3–7 should also load the golden fixture quotes. `slice.ts --extra-estimates docs/estimating-core/golden-fixtures/export.json` appends them, in dev only, so `verify` has 4+ estimates including an alternate and bonus lines. The production run in Task 13 doesn't use the flag.
