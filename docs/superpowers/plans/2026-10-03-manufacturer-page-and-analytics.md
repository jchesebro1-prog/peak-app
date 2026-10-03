# Manufacturer Page + Quoted Cost & Forecast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-manufacturer page (`/catalog/manufacturers/<key>`) with spelling merges, vendor, company (people + locations), reps, notes and catalog summary — plus quoted cost / won / lost / open / forecast analytics per manufacturer, on the list page and rolled up on the vendor page.

**Architecture:** Extend the Part 1 `manufacturers` record with `aliasKeys/mergedInto/companyId/people/notes` (no migration). One pure alias resolver makes every manufacturer-keyed lookup alias-aware. One pure analytics module turns quotes + catalog into per-manufacturer metrics; a server loader feeds the manufacturer page, the list and the vendor page.

**Tech Stack:** Next.js 16 App Router, TypeScript, doc-store, identity core (companies/contacts/sites), `scripts/test-review-and-spec.ts` harness.

**Spec:** `docs/superpowers/specs/2026-10-03-manufacturer-page-and-analytics-design.md`

## Global Constraints

- Route `/catalog/manufacturers/<key>`, `<key>` = `mfrKey(name)` (a–z0–9). An alias key redirects (Next `redirect`) to its canonical key. Unknown key with no catalog parts and no record → `notFound()`.
- View = `requireUser()`; every write = `requirePerm("create")`.
- Record fields added (defaults on read): `aliasKeys: string[] = []`, `mergedInto: string | null = null`, `companyId: string | null = null`, `people: {contactId, role}[] = []`, `notes: string = ""` (≤ 4000 chars). No migration.
- Merge is non-destructive: catalog `mfr` text never changes. Target keeps its own image/company/notes, adopts the source's image or company only when it has none, unions people (dedupe by contactId). Refuse merging into itself or into one of its own aliases. Unmerge removes the alias and clears its `mergedInto`.
- Alias-aware everywhere a manufacturer key is used: list rows, `manufacturerImageLookup`, portal `mfrImageDocs`.
- Vendor claims: reuse `claimManufacturerAction(vendorId, mfr)` / `releaseManufacturerAction(vendorId, mfr)` in `src/app/(app)/vendors/actions.ts` (one vendor per manufacturer spelling — claiming moves it).
- Analytics (spec "Part 3"): system quotes with `spec.sections`; skip labor (`labor`, `sec.kind === "labor"`, `laborOverhead`, `laborTravel`), `option`, rewards credit (`isRewardCreditItem`), `allowance`, `por`; components expand (`qty = c.qty × line.qty`, `cost = c.cost`, `sell = c.price × qty`); else line (`cost = qty × cost`, `sell = lineExtSellOf(it)`). Manufacturer = catalog part `mfr` by sku, else line `manufacturer`; canonical key. Window = trailing 365 days. Quoted = created in window, status sent|won|lost. Won = `wonAt` in window. Lost = `decidedAt` in window & status lost. Win rate = won/(won+lost) by cost (null if 0). Open = status sent (any age). In draft = status draft. Forecast = Open × (own win rate ?? shop win rate ?? 0). Monthly won = 12 months, America/Chicago. Top parts = 10 by quoted cost.
- Money shows cost first, sell beneath. Copy: sentence case, em dashes, no exclamation marks.

## Before you start (worktree)

`git worktree add .claude/worktrees/mfr-page -b feat/mfr-page main` from the main checkout, `npm ci`, copy `.env.local` + `next-env.d.ts`, `export PATH="$HOME/.local/node/bin:$PATH"`, record baseline PASS count. Never open `.data/pglite`, never `git stash`, never lint the harness. `df` before suites (≥ 3 GB). Harness conventions as in the Part 1 plan (`ok()`, blocks appended at the end with aliased imports, async blocks in the `.then` chain before `.finally(() => teardownFixtures())`, fixtures via `fixtureId`/`registerFixture`/`upsertPart`). Check messages prefixed `"mfr page: "` (Part 2) and `"mfr analytics: "` (Part 3).

## File structure

| File | Responsibility |
|---|---|
| `src/lib/manufacturer-aliases.ts` (create, pure) | `canonicalKeyMap`, `groupKeys`, `planMerge` |
| `src/lib/stores/manufacturers.ts` (modify) | new fields; `ensureManufacturer`, `mergeManufacturer`, `unmergeManufacturer`, `setManufacturerCompany`, `addManufacturerPerson`, `removeManufacturerPerson`, `setManufacturerNotes`; alias-aware `manufacturerImageLookup` |
| `src/lib/manufacturer-rows.ts` (modify) | alias-aware grouping |
| `src/lib/portal-catalog-index.ts` (modify) | alias keys in `mfrImageDocs` |
| `src/app/(app)/catalog/manufacturers/[key]/{page.tsx,actions.ts,manufacturer-client.tsx}` (create) | the page |
| `src/app/(app)/catalog/manufacturers/{page.tsx,manufacturers-client.tsx}` (modify) | row links, analytics columns + sort |
| `src/lib/manufacturer-analytics.ts` (create, pure) | lines, attribution, metrics, rollup |
| `src/lib/manufacturer-analytics-load.ts` (create, server) | loader |
| `src/app/(app)/vendors/[id]/overview-tab.tsx` (+ page) (modify) | vendor rollup card |
| `scripts/smoke-routes.ts`, docs (modify) | smoke, DECISIONS/PUNCHLIST/AGENTS |

---

### Task 1: Alias resolver + record fields + alias-aware lookups

**Files:** Create `src/lib/manufacturer-aliases.ts`; modify `src/lib/stores/manufacturers.ts`, `src/lib/manufacturer-rows.ts`, `src/lib/portal-catalog-index.ts`; test: harness (pure + DB).

**Interfaces — Produces:**
- `manufacturer-aliases.ts`: `type AliasRecord = { key: string; aliasKeys?: string[]; mergedInto?: string | null }`; `canonicalKeyMap(records: readonly AliasRecord[]): (key: string) => string`; `groupKeys(records, canonical: string): string[]` (canonical first, then its aliases sorted); `planMerge(records, sourceKey, targetKey): { ok: true; target: string; moved: string[] } | { ok: false; error: string }`.
- store: `Manufacturer` gains `aliasKeys, mergedInto, companyId, people, notes`; `ensureManufacturer(name: string, by: string): Promise<Manufacturer>`; `mergeManufacturer(sourceKey, targetKey, by): Promise<{ ok: true } | { ok: false; error: string }>`; `unmergeManufacturer(aliasKey, by)`; `setManufacturerCompany(key, companyId | null, by)`; `addManufacturerPerson(key, contactId, role, by)`; `removeManufacturerPerson(key, contactId, by)`; `setManufacturerNotes(key, notes, by)`. `manufacturerImageLookup(rows)` resolves alias keys.
- `manufacturerRows(parts, hasOwnPhoto, records)` groups by canonical key (records may carry `aliasKeys`/`mergedInto`).

- [ ] **Step 1: Failing pure tests** — append:

```ts
/* ======================================================================
   Manufacturer page — alias resolver (pure).
   ====================================================================== */
import { canonicalKeyMap as mpCanon, groupKeys as mpGroup, planMerge as mpPlan } from "@/lib/manufacturer-aliases";
import { manufacturerRows as mpRows } from "@/lib/manufacturer-rows";
{
  const recs = [
    { key: "allenandheath", aliasKeys: ["allenheath"], mergedInto: null },
    { key: "allenheath", aliasKeys: [], mergedInto: "allenandheath" },
    { key: "etc", aliasKeys: [], mergedInto: null },
  ];
  const c = mpCanon(recs);
  ok(c("allenheath") === "allenandheath" && c("allenandheath") === "allenandheath" && c("etc") === "etc" && c("nobody") === "nobody", "mfr page: aliases resolve to their canonical key; unknown keys map to themselves");
  ok(mpGroup(recs, "allenandheath").join() === "allenandheath,allenheath", "mfr page: a group lists the canonical key then its aliases");
  const p1 = mpPlan(recs, "etc", "allenheath");
  ok(p1.ok && p1.target === "allenandheath" && p1.moved.join() === "etc", "mfr page: merging into an alias merges into its canonical key");
  ok(!mpPlan(recs, "allenheath", "allenandheath").ok && !mpPlan(recs, "etc", "etc").ok, "mfr page: merging into yourself (or your own canonical) is refused");
  const p2 = mpPlan(recs, "allenandheath", "etc");
  ok(p2.ok && p2.target === "etc" && p2.moved.join() === "allenandheath,allenheath", "mfr page: merging a key that has aliases moves them too");
  const rows = mpRows(
    [{ sku: "1", mfr: "Allen & Heath", category: "Audio" }, { sku: "2", mfr: "Allen and Heath", category: "Audio" }, { sku: "3", mfr: "Allen and Heath", category: "Audio" }],
    () => false,
    [{ key: "allenandheath", imageDocumentId: "PD-1", aliasKeys: ["allenheath"], mergedInto: null }, { key: "allenheath", imageDocumentId: null, aliasKeys: [], mergedInto: "allenandheath" }]
  );
  ok(rows.length === 1 && rows[0].key === "allenandheath" && rows[0].parts === 3 && rows[0].spellings.join() === "Allen & Heath" && rows[0].imageDocumentId === "PD-1", "mfr page: merged spellings list as one manufacturer row");
}
```

- [ ] **Step 2: Implement `src/lib/manufacturer-aliases.ts`**

```ts
/**
 * Manufacturer spelling merges (Manufacturer section Part 2). Pure. A record
 * merged away carries `mergedInto`; its canonical record lists it in
 * `aliasKeys`. Unknown keys are their own canonical key. Catalog `mfr` text
 * never changes — merging only changes how keys group.
 */
export type AliasRecord = { key: string; aliasKeys?: string[]; mergedInto?: string | null };

export function canonicalKeyMap(records: readonly AliasRecord[]): (key: string) => string {
  const to = new Map<string, string>();
  for (const r of records) {
    if (r.mergedInto) to.set(r.key, r.mergedInto);
    for (const a of r.aliasKeys ?? []) if (a !== r.key) to.set(a, r.key);
  }
  return (key) => {
    let k = key;
    for (let i = 0; i < 8 && to.has(k) && to.get(k) !== k; i++) k = to.get(k)!;
    return k;
  };
}

export function groupKeys(records: readonly AliasRecord[], canonical: string): string[] {
  const canon = canonicalKeyMap(records);
  const keys = new Set<string>([canonical]);
  for (const r of records) {
    if (canon(r.key) === canonical) keys.add(r.key);
    for (const a of r.aliasKeys ?? []) if (canon(a) === canonical) keys.add(a);
  }
  return [canonical, ...[...keys].filter((k) => k !== canonical).sort()];
}

export function planMerge(
  records: readonly AliasRecord[],
  sourceKey: string,
  targetKey: string
): { ok: true; target: string; moved: string[] } | { ok: false; error: string } {
  const canon = canonicalKeyMap(records);
  const s = canon(sourceKey);
  const t = canon(targetKey);
  if (!s || !t) return { ok: false, error: "Pick a manufacturer." };
  if (s === t) return { ok: false, error: "Those are already the same manufacturer." };
  return { ok: true, target: t, moved: groupKeys(records, s) };
}
```

- [ ] **Step 3: Store.** In `src/lib/stores/manufacturers.ts`:
  - Add the five fields to `Manufacturer`; `clean()` reads them with defaults (`aliasKeys`: string array; `mergedInto`/`companyId`: non-empty string or null; `people`: array of `{contactId: string, role: string}` with non-empty contactId, role ≤ 120 chars; `notes`: string ≤ 4000). `setManufacturerImage`'s create path writes the defaults.
  - `ensureManufacturer(name, by)`: by key; create (id rule unchanged) with defaults when missing; return it.
  - `mergeManufacturer(sourceKey, targetKey, by)`: load all; `planMerge`; on ok: ensure the target record and every moved key's record (use the most common catalog spelling? — use the key's existing record name, else the key itself as name; the page passes display names via `ensureManufacturer` first); target `aliasKeys = uniq([...target.aliasKeys, ...moved])` minus target key; each moved record: `mergedInto = target`, `aliasKeys = []`; target adopts source canonical's image (when target has none), `companyId` (when none), unions `people`. Save all touched records.
  - `unmergeManufacturer(aliasKey, by)`: find the record listing it in `aliasKeys`; remove it; set the alias record's `mergedInto = null`.
  - `setManufacturerCompany`, `addManufacturerPerson` (dedupe by contactId — re-adding updates the role), `removeManufacturerPerson`, `setManufacturerNotes` — each on the **canonical** record (resolve with `canonicalKeyMap`), creating it via `ensureManufacturer` if needed (name = key when unknown; the page passes the display name).
  - `manufacturerImageLookup(rows)`: build from records with an image and no `mergedInto`, mapping the record key **and** its `aliasKeys` to its `imageDocumentId`.
- [ ] **Step 4: Rows.** `manufacturerRows`: the `records` param type becomes `readonly { key: string; imageDocumentId: string | null; aliasKeys?: string[]; mergedInto?: string | null }[]`; group by `canonicalKeyMap(records)(mfrKey(name))`; the row's `imageDocumentId` comes from the canonical record; `name` = the canonical record's... keep "most common spelling across the whole group" (as today), `spellings` = every other spelling in the group.
- [ ] **Step 5: Portal index.** In `buildIndex`, the `mfrImageDocs` loop skips records with `mergedInto` and sets the doc for `m.key` and each of `m.aliasKeys`.
- [ ] **Step 6: DB tests** — append + chain `.then(() => mfrPageStoreAsyncChecks())`: create two image-less records via `ensureManufacturer("Test MP & Co", …)` / `ensureManufacturer("Test MP and Co", …)` (register fixtures), set an image doc on the second, `mergeManufacturer("testmpco", "testmpandco", …)`: target `aliasKeys` includes `testmpco`, source `mergedInto` = target; `manufacturerImageLookup(await listManufacturers())("Test MP & Co")` returns the target's image; `addManufacturerPerson("testmpco", "ct-x", "Regional rep", …)` lands on the **target**; adding the same contact again updates the role (one entry); `setManufacturerNotes` caps at 4000; `unmergeManufacturer("testmpco")` clears both sides; merging into itself returns `ok: false`. Portal: after merge, `(await portalIndex({fresh:true})).mfrImageDocs.get("testmpco")` equals the target's image doc (set a `blobKey` + `image/webp` on the doc; `invalidatePortalIndex()` first).
- [ ] **Step 7: Gates + commit** — tsc, specs, eslint on touched files; `git commit -m "feat(catalog): manufacturer spelling merges + record fields (Part 2)"`.

---

### Task 2: The manufacturer page

**Files:** Create `src/app/(app)/catalog/manufacturers/[key]/{page.tsx,actions.ts,manufacturer-client.tsx}`; modify `src/app/(app)/catalog/manufacturers/manufacturers-client.tsx` (row name → link `/catalog/manufacturers/<key>`), `scripts/smoke-routes.ts`; test: harness (pure VM + source checks).

**Interfaces:**
- `actions.ts` (`"use server"`, each `requirePerm("create")`, each `revalidatePath("/catalog/manufacturers")` + the page path, and `invalidatePortalIndex()` after merges): `mergeManufacturerAction(sourceKey, targetKey)`, `unmergeManufacturerAction(aliasKey)`, `setManufacturerCompanyAction(key, name, companyId | null)`, `createManufacturerCompanyAction(key, name)` (calls `createVendorCompany(name)` from `src/lib/stores/vendors.ts`, then `setManufacturerCompany`), `addManufacturerPersonAction(key, name, contactId, role)`, `removeManufacturerPersonAction(key, contactId)`, `setManufacturerNotesAction(key, name, notes)`, `searchContactsAction(q): Promise<Array<{ id; name; company }>>` (`requireUser`; ≥ 2 chars; `allContacts()` + `getCompanies` for names; case-insensitive contains on "first last"; max 20). Return `{ ok: true } | { ok: false; error }`.
- A pure view-model builder in `src/lib/manufacturer-page-vm.ts`: `manufacturerPageVM(input)` → everything the page renders except analytics (name, keys/spellings with catalog hrefs, image doc id, vendors, company, locations, company people, reps, notes, catalog summary). Test it.

- [ ] **Step 1: VM + tests.** `manufacturerPageVM({ key, records, parts, ownPhoto(sku), vendorOwnerByKey: Map<key, vendorId>, vendors: Map<id, {name, lastList?: {receivedAt, effectiveAt} | null, terms: string}>, company: {id, name} | null, sites: {name, address, city, state}[], companyPeople: {id, name, title, email, phone}[], reps: {contactId, name, company, role}[], priceBookAt: number | null })` returns `{ key, name, spellings: {name, href}[], aliasKeys: string[], imageDocumentId, vendors: {id, name, href, lastList, terms}[], company, sites, companyPeople, reps, notes, catalog: { parts, withoutPhoto, topCategories: {name, count}[], priceBookAt } }` (top 5 categories, Labor excluded; spellings from every key in `groupKeys`; hrefs `/catalog?mfr=<encodeURIComponent(spelling)>`; vendors deduped across keys). Pure tests: grouping across aliases, top categories, vendor dedupe, href encoding.
- [ ] **Step 2: page.tsx** — `requireUser()`; `params` is a Promise in this Next version (check `node_modules/next/dist/docs` for dynamic route params); `key = mfrKey(decodeURIComponent(params.key))`; load `listCatalog()`, `listManufacturers()`, `allVendorProfiles()`, `vendorCompanies()`, `loadPartDocsState(parts)` (own-photo rule = the portal's: non-hidden and `state.index.docsById.get(id)?.blobKey`), `getSettings()` for `priceBooks`; canonical = `canonicalKeyMap(records)(key)` → `redirect` if different; `notFound()` if no parts in the group and no record; company via `getCompany(record.companyId)`, `sitesForCompany`, `contactsForCompany` + `emailsForContacts`/`phonesForContacts`; reps via `getContact` per person + company names. Build the VM; render server sections + `<ManufacturerClient vm={…} canEdit companies={…} vendors={…} />` (company options: `allCompanies()` → `{id, name}`; vendor options: `vendorCompanies()`). Analytics section is added in Task 4 — leave a clearly marked slot.
- [ ] **Step 3: manufacturer-client.tsx** (`"use client"`; imports only client-safe modules: the VM type, `CustomerCombobox`, Part 1's `putFile`/`preflight`/`newDocumentId` + `setManufacturerImageAction`/`removeManufacturerImageAction`, the new actions, and `claimManufacturerAction`/`releaseManufacturerAction` from the vendors actions). Sections per spec: Header (image + upload/replace/remove, spellings links, merged keys with Unmerge, Merge into… with a manufacturer `<select>` of other rows passed from the page), Supplied by (vendors, Set vendor picker → `claimManufacturerAction(vendorId, vm.name)`, Release → `releaseManufacturerAction(vendorId, spelling)` for each claimed spelling), Company (picker + Link, Create company, Unlink; sites list; people list with links to `/companies/<id>`), Reps & contacts (search box → `searchContactsAction`, pick, role input, Add; Remove), Notes (textarea + Save), Catalog summary. Every await in try/catch with a plain error; `router.refresh()` after writes; buttons disabled while busy; edit controls only when `canEdit`. Styling: follow `src/app/(app)/vendors/[id]` (cards, inline styles, `pk-*` classes).
- [ ] **Step 4: List links + smoke.** List page row name → `<Link href={"/catalog/manufacturers/" + row.key}>`. Smoke: add a route for a seeded manufacturer key — pick one from the seed catalog (`src/db/seeds/catalog.ts`, e.g. `rosebrand`) — `"/catalog/manufacturers/rosebrand"`.
- [ ] **Step 5: Gates + commit** — tsc, specs, eslint, `npm run build` (df; delete .next), smoke not required per task but the route must compile; `git commit -m "feat(catalog): the manufacturer page — vendors, company, reps, notes, merges (Part 2)"`.

---

### Task 3: Analytics — pure

**Files:** Create `src/lib/manufacturer-analytics.ts`; test: harness (pure).

**Interfaces — Produces:**
```ts
export type AnalyticsQuote = Pick<Quote, "id" | "status" | "createdAt" | "updatedAt" | "history" | "spec">;
export type AnalyticsPart = { sku: string; mfr?: string; desc?: string };
export type MoneyPair = { cost: number; sell: number };
export type ManufacturerMetrics = {
  key: string;
  quoted: MoneyPair; won: MoneyPair; lost: MoneyPair; open: MoneyPair; draft: MoneyPair;
  winRate: number | null;            // by cost
  forecast: MoneyPair;               // open × (winRate ?? shopWinRate ?? 0)
  usedShopRate: boolean;
  monthlyWon: Array<{ month: string; cost: number; sell: number }>; // "YYYY-MM", 12 entries, oldest first
  topParts: Array<{ sku: string; desc: string; qty: number; cost: number }>;
  quotes: number;
};
export type AnalyticsResult = { byKey: Map<string, ManufacturerMetrics>; shopWinRate: number | null; windowStart: number; now: number };
export function attributedLines(q: AnalyticsQuote, partsBySku: ReadonlyMap<string, AnalyticsPart>, canonical: (key: string) => string): Array<{ key: string; sku: string; desc: string; qty: number; cost: number; sell: number }>;
export function manufacturerAnalytics(quotes: readonly AnalyticsQuote[], partsBySku: ReadonlyMap<string, AnalyticsPart>, canonical: (key: string) => string, now: number): AnalyticsResult;
export function rollupMetrics(list: readonly ManufacturerMetrics[], shopWinRate: number | null): Omit<ManufacturerMetrics, "key" | "topParts"> & { keys: string[] };
export const ANALYTICS_WINDOW_MS = 365 * 24 * 3600 * 1000;
```
Uses `mfrKey`, `lineExtSellOf` (`src/app/(app)/estimator/pricing.ts` — pure), `isRewardCreditItem` (`src/lib/rewards/credit-line.ts`), and copies of `wonAt`/`decidedAt` semantics (import them from `src/lib/dashboard/metrics.ts` if that module is server-safe and pure; otherwise reimplement the 2-line functions here and say so).

- [ ] **Step 1: Failing tests** — append a pure block (`"mfr analytics: "`) building quotes in memory:
  - parts: `S1` mfr "ETC", `S2` mfr "Allen & Heath", `C1` component part mfr "ETC";
  - canonical: `(k) => (k === "allenheath" ? "allenandheath" : k)`;
  - `now = Date.UTC(2026, 9, 1)`; day = 86400000;
  - Q1 won (created now-100d, history won at now-50d): items `{sku:"S1", qty:2, cost:100, price:150}`, `{sku:"L", qty:5, cost:50, price:80, labor:true}`, `{sku:"S1", qty:1, cost:100, price:150, option:true}`, `{sku:"", qty:1, cost:500, price:600, allowance:true}`, a fixture line `{sku:"fa-1", qty:2, cost:0, price:0, components:[{sku:"C1", label:"", role:"other", qty:3, unit:"ea", cost:10, price:20}]}`, a line with no catalog part but `manufacturer:"Allen and Heath"` `{sku:"X9", qty:1, cost:40, price:60, manufacturer:"Allen and Heath"}`;
  - Q2 lost (created now-80d, history lost at now-40d): `{sku:"S1", qty:1, cost:100, price:150}`;
  - Q3 sent (created now-10d): `{sku:"S1", qty:4, cost:100, price:150}`, `{sku:"S2", qty:1, cost:200, price:300}`;
  - Q4 draft: `{sku:"S1", qty:1, cost:100, price:150}`;
  - Q5 won 400 days ago (outside window): `{sku:"S1", qty:10, cost:100, price:150}`.
  Assert: ETC quoted cost = 2·100 + 2·3·10 (Q1) + 100 (Q2) + 400 (Q3) = 760; ETC won cost = 260; lost = 100; winRate = 260/360; open cost = 400; draft cost = 100; forecast cost = 400 × 260/360; Q5 counted nowhere; Allen & Heath (canonical `allenandheath`) gets X9 (won 40) and S2 (open 200) under one key; its winRate = 1 (won 40, lost 0) — forecast = 200; labor/option/allowance excluded; monthlyWon has 12 entries and the won month holds 260 for ETC; topParts first is S1; `rollupMetrics([etc, ah])` sums costs and recomputes winRate from the summed won/lost; a manufacturer with won=lost=0 uses `shopWinRate` (`usedShopRate: true`).
- [ ] **Step 2: Implement** the module to satisfy them (monthly buckets: month key from `new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit" })`, the 12 months ending with `now`'s month).
- [ ] **Step 3: Gates + commit** — `git commit -m "feat(catalog): manufacturer quoted-cost and forecast analytics (pure)"`.

---

### Task 4: Analytics on the page, the list and the vendor page

**Files:** Create `src/lib/manufacturer-analytics-load.ts` (server); modify the manufacturer page (Quoted section), the list page + client (columns + sort), `src/app/(app)/vendors/[id]/page.tsx` + `overview-tab.tsx` (rollup card); test: harness DB check of the loader.

**Interfaces:** `loadManufacturerAnalytics(now = Date.now()): Promise<AnalyticsResult & { canonical: (k: string) => string }>` — `getAll()` quotes (src/lib/stores/quotes.ts), `listCatalog()`, `listManufacturers()` → `canonicalKeyMap`. Callers pass results to client components as plain objects (Maps don't serialize — convert to arrays/records).

- [ ] **Step 1:** Manufacturer page → **Quoted** section (server-rendered): tiles Quoted / Won / Lost / Win rate / Open / In draft / **Forecast** (cost large, sell small beneath; win rate as %; forecast footnote "Open × win rate (this manufacturer's, or the shop's when it has no decided quotes yet), trailing 12 months"), a 12-bar won-by-month chart (plain CSS bars, month labels), top parts table (sku links to `/catalog?q=<sku>`). Empty state: "No quotes for this manufacturer in the last 12 months."
- [ ] **Step 2:** List page: compute analytics once; pass `quoted12` and `open` cost per row key (0 when absent); client adds the two columns (money, right-aligned) and a sort `<select>`: Parts (default) · Quoted · Open.
- [ ] **Step 3:** Vendor page: for the vendor's claimed spellings (`profile.manufacturers`) → canonical keys → `rollupMetrics` over those manufacturers' metrics; card "Quoted through this vendor (12 months)" with the rollup tiles (Quoted, Won, Win rate, Open, Forecast) and one row per manufacturer (name → `/catalog/manufacturers/<key>`, quoted, won, open). Hidden when the vendor claims no manufacturers.
- [ ] **Step 4:** DB test: two quotes (`upsert` via the quotes store or a direct doc insert the harness already uses for quotes — find the existing pattern by grepping the harness for quote fixtures) with lines on a fixture part `mfr: "MfaBrand"` → `loadManufacturerAnalytics()` returns its metrics with the expected quoted cost.
- [ ] **Step 5: Gates + commit** — tsc, specs, eslint, `npm run build`; `git commit -m "feat(catalog): quoted cost and forecast on manufacturer, list and vendor pages (Part 3)"`.

---

### Task 5: Docs + full gates

- [ ] Recompute numbers from `origin/main`. DECISIONS (one each): route + lazy records + permissions; non-destructive alias merging and the alias-aware lookups; company link (people/locations from the company, editing stays on the company page) + reps from any company; vendor claim reuse (one vendor per spelling); the analytics definitions (which quotes/lines, cost-as-quoted, windows, forecast = open × win rate with shop fallback, no stage probabilities); where analytics show. PUNCHLIST `## <N>.` entry (Reported Jeff 2026-10-02/03, shipped, real gates, For Jeff — merge spellings, link each manufacturer's company and reps, read the forecast as an estimate; Rollback — new record fields are ignored by old code; aliases simply stop grouping). AGENTS next item.
- [ ] Full gates with real numbers: tsc, eslint (touched source files), test:specs, test:smoke (no dev server; re-run once on a resource-starved "fetch failed" burst after checking df), `npm run build`. Commit `docs: manufacturer page + analytics (#N)`.
