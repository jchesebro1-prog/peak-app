# Portal quotes, Packages & Assemblies, primary photo + Manual — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox
> (`- [ ]`) syntax. Every task is TDD: write the harness checks first, see them fail, implement, see them pass.

**Goal:** Ship the three parts of `docs/superpowers/specs/2026-10-01-portal-quotes-packages-manuals-design.md` in
order, each merged to main on its own.

**Architecture:**
- Pure helpers carry every rule (names, classification, view models, reorders, kind guessing), so the spec harness
  covers them.
- Server/lib bodies take a session or deps; thin `"use server"` wrappers call them.
- UI reuses existing components: Home's quote row, the Quotes hub list pattern, and the gallery/slot components.

**Tech Stack:** Next.js 16 App Router, TypeScript, doc-store JSON collections (no migrations), spec harness
`scripts/test-review-and-spec.ts`.

## Global Constraints

- **Spec:** the spec file above is binding. Its exact strings, formats and rules are quoted there.
- **Customer-built quote:** `source ∈ {"portal-catalog","portal-service","portal-self-serve"}`, defined only by
  `isCustomerBuiltQuote`.
- **Default name:**
  - Catalog: `"<venue label> — <Mon D, YYYY>"`, or `"<company name> — <date>"` with no venue.
  - Service: `"<first venue> — <date>"` / `"<first venue> + N more — <date>"`.
  - Date: `en-US`, `{month:"short",day:"numeric",year:"numeric"}`, `America/Chicago`.
  - Cleaning: trimmed, control characters stripped, ≤ 120 characters, blank → default.
- **Rename:** customer-built, listed for this customer, writable session, not accepted (no `portalAcceptance`, status
  not won/lost). Rate limit `portal-rename:<grantId>` 30/h. Write via `update(id,{name})`, then `scheduleQuotePdf(id)`.
- **Portal nav:** `Home · Catalog · Service · My quotes · Cart (N)`.
- **Staff queue:** `/quotes/portal`, labelled **Portal quotes**, in the Estimating nav group.
  - Statuses: Needs review / Accepted — confirm / Sent / Expired / Won / Lost / Draft. The default filter is Needs
    action.
  - The three portal bell groups link to `/quotes/portal?focus=<id>`.
- **Packages:**
  - Field `portalCategory` (≤ 60 characters), kind fixture only.
  - Category fallback `"Other packages"`.
  - Reserved department id `"packages"`. Tile and heading text: **Packages & Assemblies**. Badge **Package**, plus
    "Includes N parts".
  - Departments hold parts only.
- **Manual:** kind `"manual"`, label "Manual", PDF only, 25 MB.
  - `DOC_SLOT_KINDS = ["datasheet","specsheet","manual"]`.
  - `guessKind` manual regex, verbatim:
    `/manual|user[\s_-]*guide|owner'?s[\s_-]*guide|instruction|quick[\s_-]*start/i`, checked before the spec-sheet
    rule.
- **Prefix:** every new harness check message is prefixed with its punch number (`#288 `, `#289 `, `#290 `).
- **Harness placement:**
  - Async DB suites are `async function xxxAsyncChecks()`, chained before `.finally(() => teardownFixtures())`.
  - Pure checks are bare `{}` blocks at the end of the file.
  - Register every created fixture for teardown.
- **Never** run `next dev`, db scripts or `git stash`. Temp cleanup is only
  `find $TMPDIR -maxdepth 1 -name 'tmp.*' -type d -mmin +60 -exec rm -rf {} + 2>/dev/null; true`.
- **Gates for every task:** `npx tsc --noEmit -p .`, full `npm run test:specs` (ALL PASSED), and eslint on changed
  files (0 errors). A task that adds or changes a client component also runs `env -u DATABASE_URL npx next build`. A
  client file importing a store breaks only the build.
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Node:
  `export PATH=~/.local/node/bin:$PATH`.

---

## Part 1 (#288) — branch `feat/288-portal-quotes`

### Task 1: Names — defaults, cleaning, Generate, rename (lib + actions)

**Files:**
- Create: `src/lib/portal-quote-names.ts` (pure).
- Modify:
  - `src/lib/portal-quote-mode.ts` or a new pure module (`isCustomerBuiltQuote`);
  - `src/lib/portal-quotes.ts` (`generatePortalQuote` takes `opts.name`; uses the default; the new
    `renamePortalQuote(session, id, name, deps?)`);
  - `src/lib/portal-service-quotes.ts` (`generateServiceQuote` takes `req.name`; uses the default; `serviceQuoteName`
    is no longer the stored name);
  - `src/app/portal/catalog/actions.ts` (`generateQuote` forwards the name);
  - `src/app/portal/service/actions.ts` (forwards the name);
  - `src/app/portal/actions.ts` (new `renamePortalQuoteAction(id, name)` wrapper using `portalSession().catch(() =>
    null)`).
- Test: harness.

**Interfaces — Produces:**

```ts
// src/lib/portal-quote-names.ts (pure)
export const PORTAL_QUOTE_NAME_MAX = 120;
export function cleanPortalQuoteName(raw: unknown): string;            // trim, strip \p{Cc}, collapse inner whitespace, cap 120
export function portalQuoteDate(at: number): string;                    // "Oct 1, 2026" in America/Chicago
export function defaultCatalogQuoteName(venueLabel: string | null, companyName: string, at: number): string;
export function defaultServiceQuoteName(venueLabels: string[], companyName: string, at: number): string; // [] → company
export function isCustomerBuiltQuote(q: { source?: string | null }): boolean;
export function isPortalRenamable(q: { source?: string|null; status: string; portalAcceptance?: unknown }): boolean;
// portal-quotes.ts
export async function renamePortalQuote(session: PortalSession | null, quoteId: string, name: string): Promise<{ ok: true; name: string } | { ok: false; error: string }>;
```

- [ ] **Step 1.** Write the harness checks.
  - **Pure** (`#288 names:`):
    - every default-name case: venue / no venue / service one / service three / empty venues;
    - the date format for a fixed epoch (`Date.UTC(2026,9,1,15)` → "Oct 1, 2026");
    - cleaning: whitespace, `\u0007`, 200 characters → 120, blank → "";
    - `isCustomerBuiltQuote` for the three sources and for `"estimator"`/undefined;
    - `isPortalRenamable` (sent → true; `portalAcceptance` set → false; won/lost → false; a Peak source → false).
  - **DB suite** `rename288AsyncChecks`. Follow the existing portal generate checks: grep `generatePortalQuote` in the
    harness for its fixture pattern.
    - Generate with `name: "  Spring musical  "` stores "Spring musical".
    - Generate with a blank name stores `defaultCatalogQuoteName(...)`.
    - Rename succeeds on that quote and the PDF is rescheduled. Assert through the same seam the existing
      generate/PDF checks use; grep `scheduleQuotePdf` in the harness.
    - Rename refuses an accepted quote, a quote with a Peak source, another customer's session, a `grantId:"preview"`
      session and a blank name.
- [ ] **Step 2.** Run and see the new checks fail.
- [ ] **Step 3.** Implement.
  - **Venue label in `generatePortalQuote`:** keep the existing resolution (`venue.label || venue.locationName`); with
    no venue use `cust.name`.
  - **Service flow:** venue labels come from the selected `req.venues` in order, resolved with the existing
    `venueLabel`.
  - **Rename:**
    - Check the name with the `cleanPortalQuoteName` result before the rate limit.
    - Use `rateLimit("portal-rename:"+grantId, 30, 60*60*1000)`.
    - On success call `update(id, { name })`, then `scheduleQuotePdf(id)`.
    - Return `{ ok: true, name }`.
- [ ] **Step 4.** Run the gates. Commit `feat(portal): customer-named quotes — defaults, Generate name, rename (#288)`.

### Task 2: My quotes page, Home split, nav, Name box at Generate

**Files:**
- Create:
  - `src/app/portal/my-quotes/page.tsx`;
  - `src/app/portal/quote-row.tsx` (extracted from `src/app/portal/page.tsx` `quoteRow`, ~:334–459, plus the helpers
    it needs). Keep it a server component if the original is, and put the client bits in small client children;
  - `src/app/portal/rename-quote.tsx` (client: inline ✎ Rename → input + Save/Cancel, calling
    `renamePortalQuoteAction`, then `router.refresh()`; shows the error text).
- Modify:
  - `src/app/portal/page.tsx`: Home lists Peak-sent only, via `!isCustomerBuiltQuote`. Add the **My quotes** card
    ("N open · View all →" or empty state). The "generated" banner moves to My quotes.
  - `src/app/portal/nav.ts`: the new item; "Quote" → "Cart"; the `active` union gains `"my-quotes"`.
  - Every `portalNav` caller.
  - `src/app/portal/catalog/quote/cart-client.tsx` + `page.tsx`: the **Name this quote** input above Generate.
    - It's pre-filled from the server with `defaultCatalogQuoteName` for the current venue and recomputed client-side
      when the venue changes.
    - It must not import a store; pass the company name and venue labels down.
    - The redirect becomes `/portal/my-quotes?generated=…&q=…`.
  - `src/app/portal/service/*`: the same box and redirect.
- Test: harness pure checks for `portalNav` (labels, order, preview flags, the `my-quotes` active state) and for a pure
  `myQuotesView(quotes, cid, filter, now)` view model that you create in `src/lib/portal-my-quotes.ts`. It covers
  Open/Accepted/Closed classification and newest-first order. Also check that Home's list helper excludes
  customer-built quotes.

- [ ] **Step 1.** Write the pure checks (`#288 nav:`, `#288 my-quotes:`). See them fail.
- [ ] **Step 2.** Implement the view model and nav. Extract the row, then build the page, the Home changes and the Name
  boxes.
  - **Preview:** My quotes renders read-only (no Rename, row actions disabled) when `preview`.
  - **Filters:** links `?show=open|accepted|closed`. Default open.
- [ ] **Step 3.** Run the gates, including `next build`. Commit `feat(portal): My quotes section, Home shows Peak
  estimates, Cart nav, name at Generate (#288)`.

### Task 3: Staff Portal quotes queue + bell links

**Files:**
- Create:
  - `src/lib/portal-quote-queue.ts` (pure: `portalQueueStatus(q, now)`, `portalQueueView(quotes, opts:{status, type,
    q, now})` → rows plus status counts);
  - `src/app/(app)/quotes/portal/page.tsx` (server, `requireUser()`);
  - `src/app/(app)/quotes/portal/queue-actions.tsx` (client: Approve / Decline-with-note buttons per row).
- Modify:
  - `src/components/nav/nav-data.ts`: the Estimating group gets `{ key: "portal-quotes", label: "Portal quotes", href:
    "/quotes/portal" }`, and `activeKeyFor` maps `/quotes/portal`. Make sure `/quotes` prefix matching doesn't steal it.
  - `src/lib/portal-bell.ts` and `src/lib/nav-counts.ts`: the three portal groups' item links become
    `/quotes/portal?focus=<id>`.
- **Row actions** reuse the existing server actions only:
  - catalog Approve → `setQuoteStatus` (`src/app/(app)/quotes/actions.ts`) with won;
  - flame → `approveFlameQuote`; inspection → `approveInspectionQuote`. Check their FormData shapes and call them the
    way their builders do;
  - Decline → `declinePortalAcceptanceAction(quoteId, note)`.
- **Totals:** reuse whatever the Quotes hub uses to show a row total. Find it, don't re-derive pricing.
- **Focus:** `?focus=<id>` forces the status filter to All, adds `id="row-<id>"`, highlights the row and scrolls to it
  with a tiny client effect.
- Test: harness pure checks (`#288 queue:`) covering:
  - each status classification, including expiry by `portalFirm.validUntil` vs `now`, and accepted-unconfirmed;
  - Needs action = review ∪ accepted-confirm;
  - the type filter; text search over name, company and Est #;
  - counts; sort (Needs action first, then newest).
  - Also cover the bell item hrefs.

- [ ] **Step 1.** Write the checks. See them fail.
- [ ] **Step 2.** Implement the pure queue. Then the page (columns per spec §1.7) with filters as links, then the
  actions, nav and bell.
- [ ] **Step 3.** Run the gates, including `next build` and `npm run test:smoke`.
  - Add `/quotes/portal` and `/portal/my-quotes` to the smoke route list if routes are listed explicitly. Check how
    `scripts/smoke-routes.ts` enumerates them and how it authenticates a portal session.
  - Before smoke, check `lsof -i :3000 -t` is empty.
- [ ] **Step 4.** Commit `feat(quotes): Portal quotes work queue + bell links (#288)`.

### Task 4: Part 1 docs

- [ ] Recompute the free numbers from `git fetch -q` origin/main (DECISIONS `^## D`, PUNCHLIST `^## N\.`).
- [ ] Add DECISIONS entries (names/defaults + rename re-renders PDF; My quotes vs Home split; staff queue + bell links)
  and a PUNCHLIST entry with the punch number.
- [ ] Append an "As built" note to the spec's Part 1 if anything deviated.
- [ ] Commit `docs: #288 …`.

---

## Part 2 (#289) — branch `feat/289-portal-packages`

### Task 5: `portalCategory` on assemblies + builder field

**Files:**
- Modify:
  - `src/lib/fixture-assemblies.ts`: `FixtureRecord`, `FixtureInput`, `CleanFixture`, both `sanitizeFixtureInput`
    return branches (~:516, ~:540). The field is fixture kind only; drop it for system/hardware.
  - `src/lib/stores/fixtures.ts`: `OPTIONAL_FIXTURE_FIELDS`.
  - `src/app/(app)/design/assemblies/fixture-form.tsx`: Draft, emptyDraft, draftFromRecord, draftToInput, and the input
    next to Description in the fixture branch, with a `<datalist id>` of existing categories.
  - The page/loader that renders the form passes `portalCategories: string[]`, sorted unique from all fixtures.
- **Cleaning:** a pure `cleanPortalCategory(raw)` (trim, collapse whitespace, cap at 60, empty → undefined).
- Test: harness `#289 category:`.
  - The clean rules.
  - Sanitize keeps it on a fixture and drops it on a system.
  - DB: `updateFixture` clears it when the input omits it. That's the `OPTIONAL_FIXTURE_FIELDS` behavior; follow the
    existing fixture store checks in the harness.
- Gates (with `next build`). Commit `feat(assemblies): portal category field (#289)`.

### Task 6: Packages & Assemblies in the portal index, browse, search and UI

**Files:**
- Modify:
  - `src/lib/portal-catalog-index.ts` (fixture `category = portalCategory || "Other packages"`);
  - `src/lib/portal-departments.ts`:
    - `PACKAGES_DEPT = "packages"`, reserved in `sanitizeDepartments`;
    - the dept filters/tiles count parts only;
    - Other excludes fixtures;
    - remove the `fixture assemblies` suggestion term;
  - `src/lib/stores/portal-departments.ts` (known categories from part entries only);
  - `src/lib/portal-search.ts` (dept `packages` → fixtures only; other depts → parts only; results expose a
    `packages`/`parts` split);
  - `src/lib/portal-catalog-browse.ts` (landing packages tile first when ≥ 1 browsable fixture; `?dept=packages`;
    breadcrumb label);
  - `src/lib/portal-catalog-view.ts`:
    - the tile VM for a fixture gets `badge: "Package"` and `subline: "Includes N parts"`, where N is the required
      lines (`qty > 0`), counting the engine and lens if they're separate lines in the index;
    - define N exactly as the number of included lines the sidebar lists;
  - `src/app/portal/catalog/catalog-client.tsx` (the packages tile, the two headed result groups when no dept, the
    badge/subline on fixture tiles);
  - `src/app/(app)/catalog/departments/page.tsx` (stats from parts only);
  - `src/app/portal/catalog/part-sidebar.tsx` ("Package" labels).
- Test: harness `#289 packages:`, covering every item of spec §2.3. Follow the existing #245/#252 portal index and
  department checks (grep `departmentTiles`, `searchCatalog`, `browseCatalog` in the harness) and their fixtures.
- Gates, including `next build` and smoke. Add `/portal/catalog?dept=packages` to smoke if routes are listed. Commit
  `feat(portal): Packages & Assemblies section; departments hold parts only (#289)`.

### Task 7: Part 2 docs

The same as Task 4, for #289.

---

## Part 3 (#290) — branch `feat/290-primary-photo-manual`

### Task 8: Make primary

**Files:**
- Create: `moveImageToFront` in `src/lib/part-docs/views.ts`, or a small pure module.
- Modify: `src/app/(app)/catalog/part-documents-section.tsx`, `ImagesGallery`:
  - a ★ **Make primary** button on real images that aren't first;
  - a **Primary** tag on the first image;
  - one `persistOrder(moveImageToFront(ids, id, autoBoundary))`.
- **`moveImageToFront(ids: string[], id: string, autoBoundary: number): string[]`:**
  - If `id` isn't present, or sits at or beyond `autoBoundary` (an auto thumbnail), return `ids` unchanged.
  - Otherwise move it to index 0 and keep everything else in order.
  - `autoBoundary = -1` means no auto images.
- Test: harness `#290 primary:` (front, already first, absent, auto thumbnail refused, hidden ids kept).
- Gates (with `next build`). Commit `feat(catalog): Make primary photo (#290)`.

### Task 9: Manual document type

**Files:** every location listed in spec §3.2. The key files are in `src/lib/part-docs/`:
- `types.ts`, `files.ts`, `filename-match.ts`, `coverage.ts`, `views.ts`, `fetch-links.ts`, `not-needed.ts`,
  `package.ts`;
- `src/app/(app)/catalog/documents/` (`page.tsx`, `documents-client.tsx`, `slot-cell.tsx`, `actions.ts`,
  `upload-client.ts`, `upload/bulk-drop.tsx`);
- `src/app/(app)/catalog/part-documents-section.tsx`;
- `src/lib/portal-catalog-index.ts`, `src/lib/portal-part-view.ts`, `src/lib/portal-part-detail.ts`,
  `src/app/portal/catalog/part-sidebar.tsx`, `src/app/portal/catalog/doc/[id]/route.ts`.

Let `tsc` find every exhaustive `Record<PartDocKind|DocSlotKind,…>`. Grep for the string literals `"specsheet"` and
`specsheet:` to find the hard-coded pairs.
- **Rules:**
  - Manuals are PDF only, with the 25 MB cap.
  - `checkDocumentBytes` names the right kind: "Manuals must be PDF files.", "Spec sheets must …", "Datasheets must …".
  - Coverage is generic per slot kind (accessory coverage applies to manuals as it does to spec sheets).
  - Catalog `docs` entries with kind `"manual"` become manual candidate URLs.
  - A **Missing manual** filter (`show=missing-manual`) and a progress line.
  - Manuals are servable in the portal and labelled "Manual" in the sidebar.
  - The client package gets a "Manuals" folder.
  - The Displays API is unchanged.
  - `guessKind` checks the manual regex before spec.
- Test: harness `#290 manual:` (spec §3.3). The existing #207/#245 suites must stay green; update any check that
  enumerates `DOC_SLOT_KINDS` or the column set and list it in your report.
- Gates, including `next build` and smoke (`/catalog/documents?show=missing-manual`). Commit `feat(catalog): Manual
  document type (#290)`.

### Task 10: Part 3 docs

The same as Task 4, for #290. Also add the follow-up "Manual URL import column (photo-sourcing manifest)".
