# Venues Directory Implementation Plan (D101)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a **Venues** directory (`/venues`) and venue detail page (`/venues/[id]`) that read the existing D85 identity core — completing the `sites` table's UI so a user can answer "what have we done at this venue?" — and add **Venues** to the Sales nav beside Companies/People (Field Survey moves next to it).

**Architecture:** A read-only feature. All venue↔document matching risk is isolated in a dependency-free pure module (`src/lib/venue-match.ts`) that resolves a site to its **doc-loc id** (`legacyLocId ?? id`) — the value documents actually store — and provides the per-store match predicates, deep-link builders, and open-stage predicates. A server aggregator (`src/lib/venue-history-server.ts`) fetches the eight PGlite-backed stores and builds a unified reverse-chronological history via the pure helpers. Two new server pages render the directory and detail, mirroring the existing `/companies` and `/people` screens. No new tables, no migrations, no writes.

**Tech Stack:** Next.js 16 App Router (server components; `params`/`searchParams` are Promises). TypeScript strict (typechecked in `next build`). Test harness: `tsx scripts/test-review-and-spec.ts` (flat `ok(cond, msg)` over pure modules only — there is no vitest/jest).

**Spec:** `docs/superpowers/specs/2026-07-20-venues-directory-design.md` (approved by Jeff).

## Global Constraints

- **Decision number: D101.** Implementation commits end with `(D101)`; the DECISIONS.md record commit is prefixed `D101:`.
- **THE MATCHING GOTCHA (the whole point of the pure module).** A `sites` row has `id` (`st-<companyId>-<n>`) AND `legacyLocId` (the old `loc1`-style id). Documents store `locationId = docLocId(site) = legacyLocId ?? id`. **A venue lookup that matches on `sites.id` alone silently returns empty history for every migrated venue.** All matching MUST use `docLocId(site)`, exactly as `locationById` (`customers.ts:615`) and `docLocId` (`sites.ts:91`) already do. The `/venues/[id]` URL param is the stable `sites.id`; resolve to `docLocId` internally for matching — never put `loc1` in the URL.
- **A venue is identified by `(companyId, docLocId)`.** `companyId` = the company slug (= the `customerId` docs store). `docLocId` = `site.legacyLocId ?? site.id`. Every doc store carries `customerId` + `locationId`; match `doc.customerId === companyId && doc.locationId === docLocId`. **Engagements are the exception:** `ConsultingEngagement` uses `companyId` + `siteIds: string[]` (which holds legacy loc ids, populated from `q.locationId`); match `eng.companyId === companyId && eng.siteIds.includes(docLocId)`.
- **Leads carry no venue** (only `customerId`, free-text city/state). They CANNOT be venue-scoped and are excluded from venue history.
- **Identity + stores are server-only** (all reach `getDb()` → PGlite/Postgres). The pure module imports store record TYPES with `import type` only, never a store value or `@/db`. The pure `venue-match.ts` is the unit-tested crux; the server aggregator and pages are verified by build + drive.
- **Read-only.** No new tables, no migrations, no writes, no venue create/edit (out of scope — sites are maintained through the company record).
- **Test harness:** `npm run test:specs`. Baseline before this plan: **121 assertions** (post-D100 on main). Re-count after each task. TDD required for the pure/nav tasks.
- **PGlite is single-process.** NEVER `npm run build` (or db scripts) with a dev server running.
- **Never rename an existing nav key.** Reuse existing helpers where they exist: `docLocId` (`sites.ts:91`), `getSite` (`sites.ts:48`), `getCompany`/`allCompanies` (`companies.ts`), `contactsForCompany`/`displayName` (`contacts.ts`), and the `/companies` view helpers in `src/app/(app)/companies/lib.ts` (`cityState`, `custLocation`, `venueKindLabel`, `mono`, money formatters — pure, client-safe).

---

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `src/components/nav/nav-data.ts` | Add `venues` child to Sales (beside People, before Field Survey); `activeKeyFor` `/venues`. | 1 |
| `src/lib/venue-match.ts` | **New, dependency-free.** `venueDocLocId`, `docMatchesVenue`, `engagementMatchesVenue`, `quoteDeepLink`, `isOpenStage`, `sortHistoryDesc`, and the `VenueHistoryKind`/`VenueHistoryRow` types. The tested crux. | 2 |
| `src/lib/identity/sites.ts` | Add `getAllSites()` (all non-deleted sites) — mirrors `allCompanies()`. | 3 |
| `src/lib/venue-history-server.ts` | **New, server-only.** `loadVenueHistory(site)` and `loadVenueDirectory()`. | 3 |
| `src/app/(app)/venues/page.tsx` | **New.** Directory list: venue, company, city, last activity; search + company filter. | 4 |
| `src/app/(app)/venues/[id]/page.tsx` | **New.** Detail: header, open work, history timeline, contacts. | 5 |
| `DECISIONS.md` | The D101 record. | 6 |
| `scripts/test-review-and-spec.ts` | Sales nav assertions (6→7 incl. `venues`) + the pure venue-match block (incl. the migrated-venue regression guard). | 1, 2 |

**Task order:** 1 (nav) → 2 (pure module + tests) → 3 (`getAllSites` + server aggregator) → 4 (directory page) → 5 (detail page) → 6 (record + whole-branch verify). 4 and 5 depend on 2 and 3.

---

### Task 1: Add Venues to the Sales nav group

**Files:**
- Modify: `src/components/nav/nav-data.ts` (Sales group ~lines 39–46; `activeKeyFor` map ~line 83)
- Test: `scripts/test-review-and-spec.ts` (the D99 Sales block ~lines 206–220)

**Interfaces:** Consumes `NAV`, `activeKeyFor`, `parentGroupOf`. Produces: Sales with 7 children in order `leads, quotes, reviews, companies, people, venues, field`; `activeKeyFor("/venues") === "venues"`.

- [ ] **Step 1: Write the failing test.** In `scripts/test-review-and-spec.ts`, update the D99 Sales assertions:

The count assertion (currently `ok(!!(d99Sales && d99Sales.kind === "group" && d99Sales.children.length === 6), "Sales has six children after the move");`) becomes:

```ts
ok(
  !!(d99Sales && d99Sales.kind === "group" && d99Sales.children.length === 7),
  "Sales has seven children after Venues joins (D101)",
);
```

Replace the membership assertion with an order-locked one (mirroring the D100 Operations pattern):

```ts
ok(
  !!(
    d99Sales &&
    d99Sales.kind === "group" &&
    d99Sales.children.map((c) => c.key).join(",") ===
      "leads,quotes,reviews,companies,people,venues,field"
  ),
  "Sales children are leads, quotes, reviews, companies, people, venues, field in order",
);
```

Append after that block:

```ts
// ---- Venues directory (D101): the venues child + route ----
ok(activeKeyFor("/venues") === "venues", "/venues lights the venues key");
ok(activeKeyFor("/venues/st-lakefront-1") === "venues", "/venues/[id] resolves to venues (segment-1)");
ok(parentGroupOf("venues") === "sales", "venues reports Sales as its parent group");
```

- [ ] **Step 2: Run the test to verify it fails.** `npm run test:specs` → FAIL (Sales has 6 children; `activeKeyFor("/venues")` returns `""`).

- [ ] **Step 3: Add the child + route.** In `nav-data.ts`, insert the Venues child into the `sales` group between `people` and `field`:

```ts
      { key: "people", label: "People", href: "/people" },
      { key: "venues", label: "Venues", href: "/venues" },
      { key: "field", label: "Field Survey", href: "/field-survey" },
```

Add to the `activeKeyFor` map (beside the `/people` entry):

```ts
    "/venues": "venues",
```

- [ ] **Step 4: Run the test to verify it passes.** `npm run test:specs` → PASS. `NAV.length === 4` still passes (header unchanged). Count rose by 3 (121 → 124).

- [ ] **Step 5: Commit.**

```bash
git add src/components/nav/nav-data.ts scripts/test-review-and-spec.ts
git commit -m "Nav: add Venues to the Sales group beside People (D101)"
```

---

### Task 2: The pure venue-match module + tests (the crux)

**Files:**
- Create: `src/lib/venue-match.ts`
- Test: `scripts/test-review-and-spec.ts` (append a block; add an import)

**Interfaces (consumed by Tasks 3–5 and the test):**
- `type VenueHistoryKind = "quote" | "project" | "engagement" | "flame" | "inspection" | "repair" | "survey" | "visit"`.
- `type VenueHistoryRow = { id; kind: VenueHistoryKind; title; subtitle; ts: number; status; open: boolean; href }`.
- `venueDocLocId(site: { legacyLocId: string | null; id: string }): string` — `legacyLocId ?? id`.
- `docMatchesVenue(doc: { customerId?: string|null; locationId?: string|null }, companyId: string, docLocId: string): boolean`.
- `engagementMatchesVenue(e: { companyId?: string|null; siteIds?: readonly string[] }, companyId: string, docLocId: string): boolean`.
- `quoteDeepLink(quoteType: string, id: string): string`.
- `isOpenStage(kind, stage: string): boolean` for the non-visit kinds.
- `sortHistoryDesc(rows: VenueHistoryRow[]): VenueHistoryRow[]`.

- [ ] **Step 1: Write the failing test.** Add the import near the other `@/lib` imports:

```ts
import {
  venueDocLocId,
  docMatchesVenue,
  engagementMatchesVenue,
  quoteDeepLink,
  isOpenStage,
} from "@/lib/venue-match";
```

Append this block (the migrated-venue regression guard is the heart of it):

```ts
// ---- Venues directory (D101): the matching gotcha ----
const migVenue = { id: "st-lakefront-1", legacyLocId: "loc1" };
const freshVenue = { id: "st-new-2", legacyLocId: null };
ok(venueDocLocId(migVenue) === "loc1", "a migrated venue resolves to its legacyLocId (loc1), not sites.id");
ok(venueDocLocId(freshVenue) === "st-new-2", "a fresh venue with no legacy id resolves to sites.id");

const doc = { customerId: "lakefront", locationId: "loc1" };
ok(
  docMatchesVenue(doc, "lakefront", venueDocLocId(migVenue)) === true,
  "a doc stored with locationId 'loc1' MATCHES the migrated venue — history is not empty",
);
// The anti-regression: matching on sites.id alone silently MISSES the migrated doc.
ok(
  docMatchesVenue(doc, "lakefront", migVenue.id) === false,
  "matching on sites.id alone misses the migrated venue's doc (the bug this feature must avoid)",
);
ok(docMatchesVenue({ customerId: "other", locationId: "loc1" }, "lakefront", "loc1") === false, "a doc for a different company does not match");
ok(docMatchesVenue({ customerId: "lakefront", locationId: null }, "lakefront", "loc1") === false, "a doc with no locationId does not match a specific venue");

ok(
  engagementMatchesVenue({ companyId: "lakefront", siteIds: ["loc1", "loc9"] }, "lakefront", "loc1") === true,
  "an engagement whose siteIds hold the legacy loc id matches",
);
ok(
  engagementMatchesVenue({ companyId: "lakefront", siteIds: ["st-lakefront-1"] }, "lakefront", "loc1") === false,
  "an engagement matched against sites.id would miss (siteIds hold legacy ids)",
);

ok(quoteDeepLink("flame_test", "Q-1") === "/flame-tests/quote?id=Q-1", "flame quote deep-links to the flame quote builder");
ok(quoteDeepLink("consulting", "Q-2") === "/design/engagements/quote?id=Q-2", "consulting quote deep-links to the engagements quote builder");
ok(quoteDeepLink("system", "Q-3") === "/estimator?id=Q-3", "a system quote deep-links to the estimator");

ok(isOpenStage("project", "install") === true && isOpenStage("project", "complete") === false, "project open = any stage but complete");
ok(isOpenStage("inspection", "onsite") === true, "inspection onsite counts as open work (the 4th stage)");
ok(isOpenStage("quote", "won") === false && isOpenStage("quote", "sent") === true, "quote open = draft or sent");
```

- [ ] **Step 2: Run the test to verify it fails.** `npm run test:specs` → FAIL (`tsx` cannot resolve `@/lib/venue-match`). RED.

- [ ] **Step 3: Create the module.** Write `src/lib/venue-match.ts`:

```ts
/**
 * Venue ↔ document matching (D101) — dependency-free.
 *
 * The crux of the Venues feature. A `sites` row has `id` ('st-<co>-<n>') AND
 * `legacyLocId` (the old 'loc1'-style id). Documents store `locationId =
 * legacyLocId ?? id` (see docLocId in identity/sites.ts and the
 * CustomerLocation.id composition in stores/customers.ts). Matching a venue on
 * `sites.id` alone silently returns empty history for every migrated venue —
 * this module makes that mistake impossible by resolving through the same
 * doc-loc id the stores use, and the spec test pins it with a regression guard.
 *
 * Imports store record TYPES with `import type` only (erased at build); imports
 * no store value and nothing from @/db, so it stays client-safe and testable.
 */

export type VenueHistoryKind =
  | "quote"
  | "project"
  | "engagement"
  | "flame"
  | "inspection"
  | "repair"
  | "survey"
  | "visit";

export type VenueHistoryRow = {
  id: string;
  kind: VenueHistoryKind;
  title: string;
  subtitle: string;
  ts: number; // epoch-ms, for reverse-chronological sort
  status: string; // display stage/status
  open: boolean; // not closed — pulled to "Open work"
  href: string; // deep link to the record
};

/** The id documents store as `locationId` — legacy alias when present. */
export function venueDocLocId(site: { legacyLocId: string | null; id: string }): string {
  return site.legacyLocId ?? site.id;
}

/** Most stores: a record belongs to a venue iff its company + docLocId match. */
export function docMatchesVenue(
  doc: { customerId?: string | null; locationId?: string | null },
  companyId: string,
  docLocId: string,
): boolean {
  return (doc.customerId ?? null) === companyId && (doc.locationId ?? null) === docLocId;
}

/** Engagements match by companyId + siteIds (siteIds hold legacy loc ids). */
export function engagementMatchesVenue(
  e: { companyId?: string | null; siteIds?: readonly string[] },
  companyId: string,
  docLocId: string,
): boolean {
  return (e.companyId ?? null) === companyId && !!e.siteIds?.includes(docLocId);
}

/** A quote edits in its type-specific builder (system quotes in the Estimator). */
export function quoteDeepLink(quoteType: string, id: string): string {
  const q = encodeURIComponent(id);
  switch (quoteType) {
    case "flame_test":
      return `/flame-tests/quote?id=${q}`;
    case "repair":
      return `/repairs/quote?id=${q}`;
    case "inspection":
      return `/inspections/quote?id=${q}`;
    case "consulting":
      return `/design/engagements/quote?id=${q}`;
    default:
      return `/estimator?id=${q}`;
  }
}

/** Open (not-closed) stage/status values per kind. Visits are time-based, handled by the caller. */
const OPEN_STAGES: Record<Exclude<VenueHistoryKind, "visit">, readonly string[]> = {
  quote: ["draft", "sent"],
  project: ["procurement", "delivery", "scheduled", "install", "training", "signoff"], // all but "complete"
  engagement: ["active", "bid_supported"],
  flame: ["approved", "scheduled"],
  inspection: ["requested", "scheduled", "onsite"],
  repair: ["approved", "scheduled"],
  survey: ["requested", "scheduled", "onsite"],
};

export function isOpenStage(kind: Exclude<VenueHistoryKind, "visit">, stage: string): boolean {
  return OPEN_STAGES[kind].includes(stage);
}

export function sortHistoryDesc(rows: VenueHistoryRow[]): VenueHistoryRow[] {
  return [...rows].sort((a, b) => b.ts - a.ts);
}
```

- [ ] **Step 4: Run the test to verify it passes.** `npm run test:specs` → PASS. Count rose (124 → ~140; report the exact number). `ALL PASSED`, exit 0.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/venue-match.ts scripts/test-review-and-spec.ts
git commit -m "Venues: dependency-free venue↔document matching with the legacyLocId regression guard (D101)"
```

---

### Task 3: `getAllSites()` + the server aggregator

**Files:**
- Modify: `src/lib/identity/sites.ts` (add `getAllSites()`)
- Create: `src/lib/venue-history-server.ts`

**Interfaces (consumed by Tasks 4–5):**
- `getAllSites(): Promise<SiteRow[]>` — all non-deleted sites.
- `type VenueDirRow = { site: SiteRow; companyName: string; city: string; lastActivity: number | null }`.
- `loadVenueDirectory(): Promise<VenueDirRow[]>`.
- `loadVenueHistory(site: SiteRow): Promise<VenueHistoryRow[]>`.

Server-only (reads the PGlite-backed stores). Verified by build + drive; no `test:specs` (the pure predicates it uses are already tested in Task 2).

- [ ] **Step 1: Add `getAllSites()`.** In `src/lib/identity/sites.ts`, mirroring the existing `sitesForCompany` query (which selects `from(sites)` where `deleted = false`), add:

```ts
/** All non-deleted sites across every company (for the Venues directory). */
export async function getAllSites(): Promise<SiteRow[]> {
  const db = await getDb();
  return db.select().from(sites).where(eq(sites.deleted, false));
}
```

(Match the file's existing imports — `getDb`, `sites`, `eq` are already used by `sitesForCompany`; reuse them. Confirm `eq` is imported; if not, add it from `drizzle-orm`.)

- [ ] **Step 2: Create the aggregator.** Write `src/lib/venue-history-server.ts`:

```ts
/**
 * Venue history aggregator (D101) — SERVER ONLY.
 *
 * Reads the eight PGlite-backed stores that carry venue references and builds a
 * unified reverse-chronological history for a venue, matching via the pure
 * helpers in ./venue-match (which resolve through docLocId, so migrated venues
 * are not silently empty). Leads carry no venue and are excluded.
 */
import type { SiteRow } from "@/db/schema";
import { getAllSites } from "@/lib/identity/sites";
import { getCompany } from "@/lib/identity/companies";
import { getAll as getAllQuotes } from "@/lib/stores/quotes";
import { getAllProjects } from "@/lib/stores/projects";
import { allEngagements } from "@/lib/stores/engagements";
import { getAll as getAllFlame } from "@/lib/stores/flame-jobs";
import { getAll as getAllInspections } from "@/lib/stores/inspections";
import { getAll as getAllRepairs } from "@/lib/stores/repair-jobs";
import { getAll as getAllSurveys } from "@/lib/stores/surveys";
import { allVisits } from "@/lib/stores/site-visits";
import {
  venueDocLocId,
  docMatchesVenue,
  engagementMatchesVenue,
  quoteDeepLink,
  isOpenStage,
  sortHistoryDesc,
  type VenueHistoryRow,
} from "./venue-match";

export type VenueDirRow = {
  site: SiteRow;
  companyName: string;
  city: string;
  lastActivity: number | null;
};

/**
 * Every venue with its owning company, city, and last-activity timestamp.
 * Loads each store once and buckets activity by `${customerId}|${locationId}`,
 * so the directory is a single pass over the data.
 */
export async function loadVenueDirectory(): Promise<VenueDirRow[]> {
  const [sites, quotes, projects, flame, inspections, repairs, surveys, visits] =
    await Promise.all([
      getAllSites(),
      getAllQuotes(),
      getAllProjects(),
      getAllFlame(),
      getAllInspections(),
      getAllRepairs(),
      getAllSurveys(),
      allVisits(),
    ]);

  // Bucket the latest activity ts per `${customerId}|${locationId}`.
  const latest = new Map<string, number>();
  const bump = (customerId: string | null | undefined, locationId: string | null | undefined, ts: number) => {
    if (!customerId || !locationId || !ts) return;
    const k = customerId + "|" + locationId;
    const cur = latest.get(k) ?? 0;
    if (ts > cur) latest.set(k, ts);
  };
  for (const q of quotes) bump(q.customerId, q.locationId, q.updatedAt);
  for (const p of projects) bump(p.customerId, p.locationId, p.updatedAt);
  for (const j of flame) bump(j.customerId, j.locationId, j.updatedAt);
  for (const r of inspections) bump(r.customerId, r.locationId, r.updatedAt);
  for (const r of repairs) bump(r.customerId, r.locationId, r.updatedAt);
  for (const s of surveys) bump(s.customerId, s.locationId, s.updatedAt);
  for (const v of visits) bump(v.customerId, v.locationId, v.startAt);

  const companyName = new Map<string, string>();
  const rows: VenueDirRow[] = [];
  for (const site of sites) {
    let name = companyName.get(site.companyId);
    if (name === undefined) {
      const co = await getCompany(site.companyId);
      name = co?.name ?? site.companyId;
      companyName.set(site.companyId, name);
    }
    const key = site.companyId + "|" + venueDocLocId(site);
    rows.push({
      site,
      companyName: name,
      city: site.city ?? "",
      lastActivity: latest.get(key) ?? null,
    });
  }
  return rows;
}

/** The full reverse-chronological history for one venue, across all stores. */
export async function loadVenueHistory(site: SiteRow): Promise<VenueHistoryRow[]> {
  const companyId = site.companyId;
  const locId = venueDocLocId(site);

  const [quotes, projects, engagements, flame, inspections, repairs, surveys, visits] =
    await Promise.all([
      getAllQuotes(),
      getAllProjects(),
      allEngagements(),
      getAllFlame(),
      getAllInspections(),
      getAllRepairs(),
      getAllSurveys(),
      allVisits(),
    ]);

  const rows: VenueHistoryRow[] = [];

  for (const q of quotes.filter((r) => docMatchesVenue(r, companyId, locId))) {
    rows.push({
      id: q.id, kind: "quote", title: q.name || q.id, subtitle: "Quote",
      ts: q.updatedAt, status: q.status, open: isOpenStage("quote", q.status),
      href: quoteDeepLink(q.quoteType ?? "", q.id), // quoteType is optional; "" → Estimator
    });
  }
  for (const p of projects.filter((r) => docMatchesVenue(r, companyId, locId))) {
    rows.push({
      id: p.id, kind: "project", title: p.name || p.id, subtitle: "Project",
      ts: p.updatedAt, status: p.stage, open: isOpenStage("project", p.stage),
      href: "/projects?id=" + encodeURIComponent(p.id),
    });
  }
  for (const e of engagements.filter((r) => engagementMatchesVenue(r, companyId, locId))) {
    rows.push({
      id: e.id, kind: "engagement", title: e.name || e.id, subtitle: "Engagement",
      ts: e.updatedAt, status: e.status, open: isOpenStage("engagement", e.status),
      href: "/design/engagements/" + encodeURIComponent(e.id),
    });
  }
  for (const j of flame.filter((r) => docMatchesVenue(r, companyId, locId))) {
    rows.push({
      id: j.id, kind: "flame", title: j.venue || j.customer || j.id, subtitle: "Flame test",
      ts: j.updatedAt, status: j.stage, open: isOpenStage("flame", j.stage),
      href: "/flame-tests/results?job=" + encodeURIComponent(j.id),
    });
  }
  for (const r of inspections.filter((x) => docMatchesVenue(x, companyId, locId))) {
    rows.push({
      id: r.id, kind: "inspection", title: r.venue || r.customer || r.id, subtitle: "Rigging inspection",
      ts: r.updatedAt, status: r.stage, open: isOpenStage("inspection", r.stage),
      href: "/inspections/" + encodeURIComponent(r.id),
    });
  }
  for (const j of repairs.filter((r) => docMatchesVenue(r, companyId, locId))) {
    rows.push({
      id: j.id, kind: "repair", title: j.title || j.venue || j.id, subtitle: "Repair",
      ts: j.updatedAt, status: j.stage, open: isOpenStage("repair", j.stage),
      href: "/repairs/results?job=" + encodeURIComponent(j.id),
    });
  }
  for (const s of surveys.filter((r) => docMatchesVenue(r, companyId, locId))) {
    rows.push({
      id: s.id, kind: "survey", title: s.venue || s.venueType || s.id, subtitle: "Field survey",
      ts: s.updatedAt, status: s.stage, open: isOpenStage("survey", s.stage),
      href: "/field-survey?id=" + encodeURIComponent(s.id),
    });
  }
  const now = Date.now();
  for (const v of visits.filter((r) => docMatchesVenue(r, companyId, locId))) {
    rows.push({
      id: v.id, kind: "visit", title: v.reason || v.venue || v.id, subtitle: "Site visit",
      ts: v.startAt, status: v.startAt >= now ? "upcoming" : "past", open: v.startAt >= now,
      href: v.engagementId ? "/design/engagements/" + encodeURIComponent(v.engagementId) : "/calendar",
    });
  }

  return sortHistoryDesc(rows);
}
```

> **Implementer note:** verify each store's field names against the actual record types before trusting this code — the codebase map confirmed `customerId`/`locationId`/`updatedAt` on quotes, projects, flame-jobs, inspections, repairs, surveys; `companyId`/`siteIds`/`updatedAt` on engagements; `customerId`/`locationId`/`startAt`/`reason`/`engagementId` on site-visits; `quoteType`/`status`/`name` on quotes. If a field differs (e.g. a quote `status` value not in the open list), adjust and note it. The `SiteRow` type is exported from `@/db/schema`.

- [ ] **Step 3: Build to typecheck.** Kill any dev server. `npm run build` (green) — this typechecks the aggregator against every store's real exports and field names. If a store's `getAll`/field name differs, the build fails here; fix the import/field and note it. `npm run test:specs` stays unchanged (~140).

- [ ] **Step 4: Commit.**

```bash
git add src/lib/identity/sites.ts src/lib/venue-history-server.ts
git commit -m "Venues: getAllSites + server aggregator for the directory and per-venue history (D101)"
```

---

### Task 4: The `/venues` directory page

**Files:**
- Create: `src/app/(app)/venues/page.tsx`

**Interfaces:** Consumes `loadVenueDirectory` from `@/lib/venue-history-server`; the pure view helpers in `src/app/(app)/companies/lib.ts` (`cityState`, `mono`, etc.) and `requireUser()`. Produces the `/venues` directory list.

**Mirror `src/app/(app)/companies/page.tsx`** (a server component that fetches, filters by `searchParams`, and renders `.pk-card` rows). Read it in full first for the exact list/card/search/filter idiom.

- [ ] **Step 1: Create the page.** `src/app/(app)/venues/page.tsx` — a server component:
  - `export const metadata = { title: "Venues — Peak Backend" }`.
  - `export default async function VenuesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> })`.
  - `await requireUser()`; `const sp = await searchParams`; read `?q=` (search) and `?company=` (filter) with the `one()` helper pattern used across the app.
  - `const rows = await loadVenueDirectory();`
  - Filter: by `?q=` against `site.name` + `companyName` (case-insensitive `includes`), and by `?company=` against `site.companyId`.
  - Sort rows by `lastActivity` desc (nulls last), or by venue name — match the companies list's default sort; state which you chose.
  - Render a header (`PageHeader`/H1 "Venues"), a search box + company `<select>` filter (URL-driven, using the `SegmentedToggle`/plain `<form>`/`<Link>` idiom the companies page uses — reuse whatever it does), and a `.pk-card` table/list with columns **Venue · Company · City · Last activity**, each row a `<Link href={"/venues/" + encodeURIComponent(site.id)}>`. Use `cityState`/`mono`/date formatting from `companies/lib.ts` where they fit. Show an empty state when no venues match.
  - The company filter options come from the distinct `companyName`/`companyId` pairs in `rows` (or from `allCompanies()` if the page prefers).

- [ ] **Step 2: Build + drive.** Kill any dev server. `npm run build` (green — `/venues` appears in the route table). Start the app and at `/venues`: the list shows venues with company + city + last-activity; search narrows by venue/company name; the company filter narrows to one company; each row links to `/venues/<sites.id>`. `npm run test:specs` unchanged.

- [ ] **Step 3: Commit.**

```bash
git add "src/app/(app)/venues/page.tsx"
git commit -m "Venues: directory list with search and company filter (D101)"
```

---

### Task 5: The `/venues/[id]` detail page

**Files:**
- Create: `src/app/(app)/venues/[id]/page.tsx`

**Interfaces:** Consumes `getSite` (`@/lib/identity/sites`), `getCompany`, `contactsForCompany`/`displayName` (`@/lib/identity/contacts`), `loadVenueHistory`, and the `companies/lib.ts` helpers. Produces the venue detail screen.

**Mirror `src/app/(app)/companies/[id]/page.tsx` and `src/app/(app)/people/[id]/page.tsx`** (the `getX(id) → notFound() → getCompany(fk)` shape). Read both in full first.

- [ ] **Step 1: Create the page.** `src/app/(app)/venues/[id]/page.tsx` — a server component:
  - `export async function generateMetadata`? optional; a static `metadata` title is fine.
  - `export default async function VenuePage({ params }: { params: Promise<{ id: string }> })`.
  - `await requireUser()`; `const { id } = await params;` `const site = await getSite(id); if (!site) notFound();`
  - `const [company, contacts, history] = await Promise.all([getCompany(site.companyId), contactsForCompany(site.companyId), loadVenueHistory(site)]);`
  - **Header:** venue `site.name`, owning company as a `<Link href={"/companies/" + site.companyId}>{company?.name}</Link>`, full address (`site.address`, `cityState(site)`), travel info if set (`site.travelMiles`/`site.travelMin`), and a "Primary" flag when `site.isPrimary`. Reuse `companies/lib.ts` helpers (`cityState`, `venueKindLabel`, `mono`).
  - **Open work:** `history.filter((r) => r.open)` rendered first, as a `.pk-card` of rows (title, kind label via `subtitle`, status pill, each a `<Link href={r.href}>`).
  - **History:** the full `history` (already newest-first from `sortHistoryDesc`) as a reverse-chronological timeline `.pk-card`, each row: date (`ts`), kind (`subtitle`), title, status, linking to `r.href`. Show an empty state ("No work recorded at this venue yet.") when `history.length === 0`.
  - **Contacts:** `contacts` (people at the owning company) as a `.pk-card` list, each `<Link href={"/people/" + c.id}>{displayName(c)}</Link>` with title/status.
  - Match the `.pk-card`/typography idiom of the companies detail page; do not invent a new visual system.

- [ ] **Step 2: Build + drive.** Kill any dev server. `npm run build` (green — `/venues/[id]` in the route table). Start the app, open a venue from the directory, and verify: header (name, linked company, address, primary flag), Open work at top, a reverse-chronological History with per-record links that navigate correctly, and Contacts from the owning company. **Explicitly verify the gotcha:** open a MIGRATED venue (one whose docs use a `loc1`-style id) and confirm its history is populated, not empty. `npm run test:specs` unchanged.

- [ ] **Step 3: Commit.**

```bash
git add "src/app/(app)/venues/[id]/page.tsx"
git commit -m "Venues: venue detail with header, open work, history timeline and contacts (D101)"
```

---

### Task 6: Record the decision (D101) + whole-branch verification

**Files:**
- Modify: `DECISIONS.md`

- [ ] **Step 1: Add the D101 record.** Append after D100, matching the `## D<N> — <title> (date)` shape:

```markdown
## D101 — Venues directory (2026-07-20)

The D85 identity core had screens for `companies` and `contacts` but not
`sites` — yet venues are how this business thinks (work attaches to the venue,
not the district). `/venues` (directory) and `/venues/[id]` (detail) close that
gap: a venue detail aggregates one reverse-chronological history of everything
attached to it — quotes, projects, engagements, flame tests, inspections,
repairs, surveys, and site visits — with open work pulled to the top and the
owning company's contacts alongside. Venues joins the Sales nav beside
Companies and People; Field Survey now sits next to it (seven Sales children —
a watch item; if the dropdown gets hard to scan, the fix is a Directory group).

**The matching gotcha, and how it's contained.** Documents store `locationId`
as the venue's *doc-loc id* = `sites.legacyLocId ?? sites.id` — a legacy `loc1`
for every migrated venue, never the synthetic `st-…` primary key. A lookup that
matched on `sites.id` alone would silently show empty history for every migrated
venue. All matching is isolated in the dependency-free `src/lib/venue-match.ts`,
which resolves through `venueDocLocId` exactly as the stores' own `docLocId`/
`locationById` do; a regression assertion pins that a migrated venue
(`legacyLocId: "loc1"`) matches a doc with `locationId: "loc1"` and that matching
on `sites.id` alone would miss it. Engagements match on `companyId` + `siteIds`
(which also hold legacy loc ids). Leads carry no venue and are excluded.

Read-only: no new tables, no migrations, no writes; venue create/edit stays on
the company record (out of scope). The `[id]` URL is the stable `sites.id`,
resolved to the doc-loc id internally so `loc1` never appears in a URL.
```

- [ ] **Step 2: Commit the record.**

```bash
git add DECISIONS.md
git commit -m "D101: record the Venues directory decisions"
```

- [ ] **Step 3: Whole-branch verification.** Kill any dev server. Run `npm run test:specs` (ALL PASSED, ~140) and `npm run build` (green). Drive the app against the spec's Testing section:
  - A venue with work across several stores shows every item, newest first.
  - **A migrated venue (docs use `legacyLocId`/`loc1`) shows its history** — the explicit regression for the matching gotcha.
  - A venue with no work shows an empty state, not an error.
  - Company link and per-record links navigate correctly.
  - Directory search and company filter work.
  - The Sales dropdown shows all seven children including Venues.
  Report the final assertion count, build result, and drive observations. Ready for the whole-branch (opus) review and merge.

---

## Self-Review

**1. Spec coverage.** `/venues` directory (venue, company, city, last activity; search; company filter) → Task 4. `/venues/[id]` (header, history timeline, open work, contacts) → Task 5. The matching gotcha (resolve through `docLocId`, not `sites.id`) → Task 2 pure module + its regression assertion, used by Task 3's aggregator. Nav (Venues in Sales beside Companies/People; Field Survey next to it) → Task 1. Read-only / out-of-scope (no create/edit, no leads at venue level) → honored (leads excluded; no writes). Testing checklist → Task 6 Step 3 + Task 2's unit tests.

**2. Placeholder scan.** Exact code for the pure module, `getAllSites`, the server aggregator, the nav, and DECISIONS. Tasks 4 and 5 create new pages by mirroring the `/companies` and `/people` templates (named explicitly, to be read in full) — they give the exact data-loading, the exact section contents, and the exact deep-link shapes, with presentation deferred to the established `.pk-card` idiom (the same approach that worked for the D99 settings and D100 page tasks). No "TBD".

**3. Type consistency.** `VenueHistoryRow`/`VenueHistoryKind`, `venueDocLocId`, `docMatchesVenue`, `engagementMatchesVenue`, `quoteDeepLink`, `isOpenStage`, `sortHistoryDesc` (Task 2) are used with identical signatures in Task 3. `VenueDirRow`, `loadVenueDirectory`, `loadVenueHistory`, `getAllSites` (Task 3) are consumed unchanged in Tasks 4–5. `SiteRow` from `@/db/schema`. Store `getAll` names verified (`getAll` on quotes/flame/inspections/repairs/surveys; `getAllProjects`; `allEngagements`; `allVisits`).

**Cross-task note:** `NAV.length` is unchanged (Venues is a child, not a top-level item) — no top-level assertion moves. The Sales child-count/order assertions flip 6→7 in Task 1 only. Tasks 3–5 add no `test:specs` assertions (server + UI, verified by build + drive), so no assertion goes transiently red.
