# General Dissolution Implementation Plan (D99)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dissolve the 8-item **General** nav group by redistributing its children, taking the top-level header from **6 → 5** (Home · Design · Sales · Installs · Service).

**Architecture:** Pure navigation + one new Settings section layout. No routes move, no data changes, no migrations. Companies/People/Field Survey move into the **Sales** group; Reports becomes a **5th Home tab**; Catalog/Templates/Estimating Rules/Import-Export are reached from a new **Settings → Admin** area (their routes are unchanged). `activeKeyFor()` is repointed so every moved path lights the right pill. Risk logic stays inside the already-pure `nav-data.ts` and a new dependency-free `settings-sections.ts`, so the spec test can cover it; the client wiring (Settings, Reports page) is verified by driving the app.

**Tech Stack:** Next.js 16 App Router (server components; `searchParams` is a `Promise`), TypeScript (strict, typechecked inside `next build`), Tailwind v4. Test harness: `tsx scripts/test-review-and-spec.ts` (a flat `ok(cond, msg)` script over **pure** modules only — no framework).

**Spec:** `docs/superpowers/specs/2026-07-20-general-dissolution-design.md` (approved by Jeff). This spec **amends** the home-tabbed-hub spec: Reports is the 5th Home tab.

## Global Constraints

- **Decision number: D99.** Implementation commits end with `(D99)`; the DECISIONS.md record commit is prefixed `D99:`. (Highest existing is D98.)
- **This is a MOVE, not an add.** `companies`, `people`, `field` already exist as child keys inside the `general` group. Relocate the child objects — never leave a duplicate in `general` (duplicate keys double-render the nav and confuse `parentGroupOf`, which returns the first matching group).
- **Never rename an existing nav key.** `companies`/`people`/`field`/`reports`/`catalog`/`templates`/`rules`/`import` keys are preserved verbatim (AGENTS.md nav rule; badge/bell wiring is keyed on them). The `/customers → companies` legacy alias depends on the `companies` key.
- **Dependency-free modules only for anything a `"use client"` file or the test imports.** `nav-data.ts` and the new `settings-sections.ts` must not import a store, a `"use client"` module, or anything reaching PGlite/Drizzle (D90 client-reference-proxy class of bug).
- **PGlite is single-process.** NEVER run `npm run build` (or any db script) while a dev server is running — it corrupts `.data/pglite` (DECISIONS.md D85, D90). Kill every dev server first.
- **Test baseline is 89 assertions** (`npm run test:specs` → `tsx scripts/test-review-and-spec.ts`). The resume note's "102" is stale (D98's final review deleted the `homeTabFor` tests). Re-count after edits; every assertion must PASS and `process.exit` must be 0.
- **The spec test only exercises pure functions.** Nav chrome and client wiring are verified by `npm run build` (green) + driving the running app, not by `test:specs`.
- An assertion that passes *before* its implementation is broken by definition — write each failing test, run it, watch it FAIL, then implement.

---

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `src/components/nav/nav-data.ts` | The single source of nav truth: `NAV` array + `activeKeyFor` + `parentGroupOf` (all pure). Edited in tasks 1, 2, 5. | 1, 2, 5 |
| `src/app/(app)/home-tabs-keys.ts` | Dependency-free `HOME_TABS` value list. Gains the Reports tab. | 2 |
| `src/app/(app)/reports/page.tsx` | Reports server page. Gains the shared Home tab bar (`<HomeTabs active="reports">`). | 2 |
| `src/app/(app)/settings/settings-sections.ts` | **New** dependency-free module: `SETTINGS_SECTIONS`, `ADMIN_SCREENS`, `resolveSettingsSection()`. | 3 |
| `src/app/(app)/settings/settings-client.tsx` | The 2,107-line Settings client. Gains section nav + wraps its 10 cards into general/team/admin + a new Admin card. Section internals untouched. | 4 |
| `DECISIONS.md` | The D99 decision record. | 6 |
| `scripts/test-review-and-spec.ts` | Spec test. New "General dissolution (D99)" assertions; two existing assertions flip. | 1, 2, 3, 5 |

**Task order is dependency-driven:** 1 (Sales move) → 2 (Reports tab) → 3 (Settings pure module) → 4 (Settings wiring, so the four Admin screens have a home) → 5 (remove the now-empty-of-visible-items General group) → 6 (record + whole-branch verify). Task 5 must come after task 4 so Catalog/Templates/Estimating Rules/Import are reachable from Settings before they leave the General nav group.

---

### Task 1: Move Companies / People / Field Survey from General → Sales

**Files:**
- Modify: `src/components/nav/nav-data.ts` (`sales` group ~lines 35–44; `general` group children ~lines 70–72)
- Test: `scripts/test-review-and-spec.ts` (nav import line 153; append a new block after the home-hub nav block, ~line 192)

**Interfaces:**
- Consumes: `NAV`, `parentGroupOf` from `nav-data.ts` (existing exports).
- Produces: `sales` group now has 6 children (`leads, quotes, reviews, companies, people, field`); `general` group has 5 children left (`catalog, reports, templates, rules, import`). `NAV.length` stays **6**. Keys unchanged.

- [ ] **Step 1: Write the failing test.** In `scripts/test-review-and-spec.ts`, first add `parentGroupOf` to the existing nav import (line 153) so it reads:

```ts
import { activeKeyFor, NAV, parentGroupOf } from "@/components/nav/nav-data";
```

Then append this block immediately after the home-hub nav block (after the current line 192, the `activeKeyFor("/reports")` assertion):

```ts
// ---- General dissolution (D99): Companies/People/Field Survey → Sales ----
const d99Sales = NAV.find((e) => e.kind === "group" && e.key === "sales");
ok(
  !!(d99Sales && d99Sales.kind === "group" && d99Sales.children.length === 6),
  "Sales has six children after the move",
);
ok(
  !!(
    d99Sales &&
    d99Sales.kind === "group" &&
    ["leads", "quotes", "reviews", "companies", "people", "field"].every((k) =>
      d99Sales.children.some((c) => c.key === k),
    )
  ),
  "Sales contains leads, quotes, reviews, companies, people, field",
);
const d99Gen1 = NAV.find((e) => e.kind === "group" && e.key === "general");
ok(
  !!(
    d99Gen1 &&
    d99Gen1.kind === "group" &&
    !["companies", "people", "field"].some((k) =>
      d99Gen1.children.some((c) => c.key === k),
    )
  ),
  "General no longer contains companies, people, or field",
);
ok(
  parentGroupOf("companies") === "sales" &&
    parentGroupOf("people") === "sales" &&
    parentGroupOf("field") === "sales",
  "companies, people, field now report Sales as their parent group",
);
const d99Keys = NAV.flatMap((e) =>
  e.kind === "group" ? [e.key, ...e.children.map((c) => c.key)] : [e.key],
);
ok(
  d99Keys.length === new Set(d99Keys).size,
  "all nav keys (groups + children) are globally unique — no duplicate left behind",
);
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npm run test:specs`
Expected: FAIL — "Sales has six children after the move" and "companies, people, field now report Sales as their parent group" print `FAIL` (Sales still has 3 children; `parentGroupOf` returns `"general"`). Exit code non-zero.

- [ ] **Step 3: Make the move in `nav-data.ts`.** Cut the three child objects out of the `general` group's `children` (currently lines 70–72):

```ts
      { key: "companies", label: "Companies", href: "/companies" },
      { key: "people", label: "People", href: "/people" },
      { key: "field", label: "Field Survey", href: "/field-survey" },
```

and append them to the `sales` group's `children`, after `reviews`, so the `sales` group reads:

```ts
  {
    kind: "group",
    key: "sales",
    label: "Sales",
    children: [
      { key: "leads", label: "Leads", href: "/leads" },
      { key: "quotes", label: "Quotes", href: "/quotes" },
      { key: "reviews", label: "Reviews", href: "/reviews" },
      { key: "companies", label: "Companies", href: "/companies" },
      { key: "people", label: "People", href: "/people" },
      { key: "field", label: "Field Survey", href: "/field-survey" },
    ],
  },
```

The `general` group's `children` now begins with `catalog`:

```ts
  {
    kind: "group",
    key: "general",
    label: "General",
    children: [
      { key: "catalog", label: "Catalog", href: "/catalog" },
      { key: "reports", label: "Reports", href: "/reports" },
      { key: "templates", label: "Templates", href: "/templates" },
      { key: "rules", label: "Estimating Rules", href: "/estimating-rules" },
      { key: "import", label: "Import / Export", href: "/import" },
    ],
  },
```

Do **not** touch `activeKeyFor` — the route map entries `"/companies": "companies"`, `"/people": "people"`, `"/field-survey": "field"` are correct as-is; `parentGroupOf` now derives Sales automatically.

- [ ] **Step 4: Run the test to verify it passes.**

Run: `npm run test:specs`
Expected: PASS — all five new assertions PASS; the existing `NAV.length === 6` (line 184) still PASSES (General still exists). Final line `ALL PASSED`, exit 0. Confirm total assertion count rose by 5 (89 → 94).

- [ ] **Step 5: Commit.**

```bash
git add src/components/nav/nav-data.ts scripts/test-review-and-spec.ts
git commit -m "Nav: Companies, People, Field Survey move from General to Sales (D99)"
```

---

### Task 2: Reports becomes the 5th Home tab

**Files:**
- Modify: `src/app/(app)/home-tabs-keys.ts` (add 5th entry after line 18)
- Modify: `src/components/nav/nav-data.ts` (`activeKeyFor` map line 106; remove `reports` child from `general`, line 74)
- Modify: `src/app/(app)/reports/page.tsx` (wrap body in `<HomeTabs>`, ~lines 129–185; add import)
- Test: `scripts/test-review-and-spec.ts` (line 180 `HOME_TABS.length`; line 192 `activeKeyFor("/reports")`; add reports-tab assertions)

**Interfaces:**
- Consumes: `HOME_TABS`, `HomeTabKey` from `home-tabs-keys.ts`; the `HomeTabs` component from `src/app/(app)/home-tabs.tsx` (props `{ active: HomeTabKey; children?; className?; maxWidth?; style? }`, and it owns its own `.pk-content` wrapper).
- Produces: `HOME_TABS.length === 5`; `activeKeyFor("/reports") === "home"`; `general` group down to 4 children (`catalog, templates, rules, import`). `NAV.length` unchanged at 6.

**Decision — the Sales/Installs pill stays.** `/reports/page.tsx` renders its own inline Sales|Installs toggle in the page header (a *within-Reports* view selector driven by `?view=`). That dimension is orthogonal to the five route-level Home tabs, so it is **kept**. After this task, `/reports` shows the Home tab bar on top (Dashboard · My Queue · Calendar · Inbox · Reports) and the Sales|Installs pill below it, exactly as the spec intends ("keeps its route and gains the shared tab bar"). Do not delete or fold the Sales|Installs pill.

- [ ] **Step 1: Write the failing test.** In `scripts/test-review-and-spec.ts`:

Change line 180 from:

```ts
ok(HOME_TABS.length === 4, "four tabs ship in this plan (Reports joins with the General dissolution)");
```

to:

```ts
ok(HOME_TABS.length === 5, "five Home tabs after Reports joins (D99)");
```

Change line 192 from:

```ts
ok(activeKeyFor("/reports") === "reports", "reports still lights its own key until General is dissolved");
```

to:

```ts
ok(activeKeyFor("/reports") === "home", "Reports lights Home now that it is a Home tab (D99)");
```

Append after the block added in Task 1:

```ts
// ---- General dissolution (D99): Reports is a Home tab ----
ok(
  HOME_TABS.some((t) => t.key === "reports" && t.href === "/reports"),
  "Reports is present in HOME_TABS with its own route",
);
const d99Gen2 = NAV.find((e) => e.kind === "group" && e.key === "general");
ok(
  !!(
    d99Gen2 &&
    d99Gen2.kind === "group" &&
    !d99Gen2.children.some((c) => c.key === "reports")
  ),
  "General no longer contains Reports",
);
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npm run test:specs`
Expected: FAIL — the flipped `HOME_TABS.length === 5` and `activeKeyFor("/reports") === "home"` FAIL (still 4 tabs, still `"reports"`), plus the two new assertions FAIL. Exit non-zero.

- [ ] **Step 3: Add the Reports tab and repoint the key.** In `src/app/(app)/home-tabs-keys.ts`, add a 5th entry after the `inbox` entry (and update the header comment that says Reports joins on dissolution):

```ts
export const HOME_TABS = [
  { key: "dashboard", label: "Dashboard", href: "/" },
  { key: "queue", label: "My Queue", href: "/queue" },
  { key: "calendar", label: "Calendar", href: "/calendar" },
  { key: "inbox", label: "Inbox", href: "/inbox" },
  { key: "reports", label: "Reports", href: "/reports" },
] as const;
```

In `src/components/nav/nav-data.ts`:
- Change the `activeKeyFor` map entry (line 106) from `"/reports": "reports",` to `"/reports": "home",`.
- Remove the `reports` child from the `general` group (line 74: `{ key: "reports", label: "Reports", href: "/reports" },`). The `general` group now has 4 children: `catalog, templates, rules, import`.

- [ ] **Step 4: Run the test to verify it passes (pure-function layer).**

Run: `npm run test:specs`
Expected: PASS — all D99 assertions PASS; `NAV.length === 6` still PASSES. Count rose by 2 (94 → 96). `ALL PASSED`, exit 0.

- [ ] **Step 5: Wire the tab bar into the Reports page.** In `src/app/(app)/reports/page.tsx`, add the import near the other imports:

```ts
import HomeTabs from "../home-tabs";
```

Then replace the outer wrapper. The page body currently opens (line ~130) with:

```tsx
    <div className="pk-content" style={{ maxWidth: 1180 }}>
```

and closes with its matching `</div>` at the end of the return (line ~185). Replace that opening tag with:

```tsx
    <HomeTabs active="reports" maxWidth={1180}>
```

and the matching closing `</div>` with `</HomeTabs>`. This nests the existing header (title + Sales|Installs pill + `RangeChips`) and the `SalesView`/`InstallsView` body inside the shared tab-bar wrapper — no nested `.pk-content` because `HomeTabs` owns that wrapper. Change nothing else inside (the Sales|Installs pill and `modeHref` URL state stay).

- [ ] **Step 6: Build and drive to verify the chrome.** Kill any dev server first (PGlite). Then:

```bash
npm run build
```

Expected: build green, no type error (`active="reports"` typechecks because Task 2 Step 3 extended `HomeTabKey`). Then start the app and confirm at `/reports`: the Home tab bar shows five tabs with **Reports** active; the Sales|Installs pill still renders and switches `?view=`; the left nav highlights **Home** (not a General group). Confirm `/`, `/queue`, `/calendar`, `/inbox` each now show the 5-tab bar too.

- [ ] **Step 7: Commit.**

```bash
git add src/app/\(app\)/home-tabs-keys.ts src/components/nav/nav-data.ts "src/app/(app)/reports/page.tsx" scripts/test-review-and-spec.ts
git commit -m "Nav: Reports becomes the fifth Home tab (D99)"
```

---

### Task 3: Settings sections + Admin — the dependency-free module

**Files:**
- Create: `src/app/(app)/settings/settings-sections.ts`
- Test: `scripts/test-review-and-spec.ts` (append a new block; add an import at the top of the file's nav area)

**Interfaces:**
- Produces (consumed by Task 4 and the test):
  - `SETTINGS_SECTIONS: readonly { key: SettingsSection; label: string }[]` — order `general`, `team`, `admin`.
  - `type SettingsSection = "general" | "team" | "admin"`.
  - `ADMIN_SCREENS: readonly { label: string; href: string; desc: string }[]` — the four moved screens, in nav order.
  - `resolveSettingsSection(param: string | string[] | undefined): SettingsSection` — validates the `?section=` param, defaults `"general"`.

- [ ] **Step 1: Write the failing test.** In `scripts/test-review-and-spec.ts`, add this import alongside the other `@/app/(app)` imports (near the `HOME_TABS` import):

```ts
import {
  resolveSettingsSection,
  ADMIN_SCREENS,
  SETTINGS_SECTIONS,
} from "@/app/(app)/settings/settings-sections";
```

Append this block after the Task 2 block:

```ts
// ---- General dissolution (D99): Settings sections + Admin ----
ok(resolveSettingsSection(undefined) === "general", "no ?section= defaults to general");
ok(resolveSettingsSection("nope") === "general", "an unknown ?section= falls back to general");
ok(resolveSettingsSection("team") === "team", "?section=team is honored");
ok(resolveSettingsSection("admin") === "admin", "?section=admin is honored");
ok(resolveSettingsSection(["admin", "team"]) === "admin", "an array ?section= takes the first value");
ok(
  SETTINGS_SECTIONS.map((s) => s.key).join(",") === "general,team,admin",
  "Settings exposes general, team, admin sections in order",
);
ok(ADMIN_SCREENS.length === 4, "Admin lists exactly four screens");
ok(
  ADMIN_SCREENS.map((s) => s.href).join(",") ===
    "/catalog,/templates,/estimating-rules,/import",
  "Admin links Catalog, Templates, Estimating Rules, Import — by their own routes",
);
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npm run test:specs`
Expected: FAIL to **compile/run** — `tsx` errors that `@/app/(app)/settings/settings-sections` has no exports / cannot be found. (This is the RED state; the module does not exist yet.)

- [ ] **Step 3: Create the module.** Write `src/app/(app)/settings/settings-sections.ts`:

```ts
/**
 * Settings section nav + Admin area (D99).
 *
 * Dependency-free VALUE module — imported by the "use client" SettingsClient
 * and by the spec test. Must not import a store, a "use client" module, or
 * anything that reaches PGlite/Drizzle (same contract as home-tabs-keys.ts;
 * see D90's client-reference-proxy bug).
 */

export const SETTINGS_SECTIONS = [
  { key: "general", label: "General" },
  { key: "team", label: "Team & Roles" },
  { key: "admin", label: "Admin" },
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["key"];

/**
 * The four data-administration screens the dissolved General group hands to
 * Settings. Each keeps its own route; the Admin area only links to them.
 */
export const ADMIN_SCREENS = [
  { label: "Catalog", href: "/catalog", desc: "Price books, parts, and manufacturers." },
  { label: "Templates", href: "/templates", desc: "Document and message wording." },
  { label: "Estimating Rules", href: "/estimating-rules", desc: "Rates and formulas the estimator uses." },
  { label: "Import / Export", href: "/import", desc: "Move records in and out of Peak." },
] as const;

/** Validate the `?section=` param into a known section key (defaults general). */
export function resolveSettingsSection(
  param: string | string[] | undefined,
): SettingsSection {
  const v = Array.isArray(param) ? param[0] : param;
  return SETTINGS_SECTIONS.some((s) => s.key === v)
    ? (v as SettingsSection)
    : "general";
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `npm run test:specs`
Expected: PASS — all eight new assertions PASS. Count rose by 8 (96 → 104). `ALL PASSED`, exit 0.

- [ ] **Step 5: Commit.**

```bash
git add "src/app/(app)/settings/settings-sections.ts" scripts/test-review-and-spec.ts
git commit -m "Settings: dependency-free section + Admin-screen definitions (D99)"
```

---

### Task 4: Wire the Settings section nav + Admin card into `settings-client.tsx`

**Files:**
- Modify: `src/app/(app)/settings/settings-client.tsx` (add imports; read `?section=`; render section nav; wrap the 10 section cards; add the Admin card)

**Interfaces:**
- Consumes: `SETTINGS_SECTIONS`, `ADMIN_SCREENS`, `resolveSettingsSection` from `./settings-sections`; `SegmentedToggle` from `@/components/ui`; existing `useSearchParams()` (already imported and called at line 141).
- Produces: `/settings` shows a three-way section toggle (General · Team & Roles · Admin) via `?section=`; the existing 10 cards render only under General/Team; a new Admin card lists the four screens as links. No section internals change.

This task is verified by **build + driving the app** (client wiring; the pure-function contract is already tested in Task 3). Do not add `test:specs` assertions here.

- [ ] **Step 1: Add imports.** Near the top of `settings-client.tsx`, add:

```ts
import { SegmentedToggle } from "@/components/ui";
import {
  SETTINGS_SECTIONS,
  ADMIN_SCREENS,
  resolveSettingsSection,
} from "./settings-sections";
```

(`Link` from `next/link` is already imported in this file — reuse it for the Admin rows.)

- [ ] **Step 2: Read the active section.** In the component body, near the existing `const searchParams = useSearchParams()` / `?gmail=` read (line ~141–142), add:

```ts
const section = resolveSettingsSection(searchParams.get("section") ?? undefined);
```

- [ ] **Step 3: Render the section nav.** Immediately inside the return's outer `<div>` (line 434), after the error banner and gmail banner blocks (i.e. before the first `<section className="pk-card">` at line ~470), insert the toggle:

```tsx
<div style={{ marginBottom: 20 }}>
  <SegmentedToggle
    options={SETTINGS_SECTIONS.map((s) => ({ key: s.key, label: s.label }))}
    active={section}
    hrefFor={(k) => (k === "general" ? "/settings" : `/settings?section=${k}`)}
  />
</div>
```

- [ ] **Step 4: Wrap the existing cards by section.** Do **not** edit any card's internals — only gate their rendering:

- Wrap the run of eight cards from **Branding** (`{/* ---- Branding ---- */}`, line ~469) through the end of **Beta** (the `pk-card` opened at line ~1046, closes ~line 1159) in a General guard:

```tsx
{section === "general" && (
  <>
    {/* ---- Branding ---- */}
    ...unchanged Branding … Beta cards...
  </>
)}
```

- Wrap the **Team + Roles** grid — the `<div className="st-grid" …>` opened at line ~1161 through its closing `</div>` (~line 1357, just before the location modal comment) — in a Team guard:

```tsx
{section === "team" && (
  <div className="st-grid" ...>
    ...unchanged Team members + Roles cards...
  </div>
)}
```

- **Leave the two trailing modals unwrapped.** The Add/edit location modal (comment ~line 1359) and Add/edit user modal (comment ~line 1719) are portal-style overlays gated by their own open state. The location modal is triggered from the Locations card (General section) and the user modal from Team; wrapping either in a section guard would break it. Keep both rendered unconditionally at the end of the return.

- [ ] **Step 5: Add the Admin card.** After the Team grid guard (and before the trailing modals), add:

```tsx
{section === "admin" && (
  <section className="pk-card" style={{ padding: "17px 18px", marginBottom: 20 }}>
    <div style={{ fontSize: 14.5, fontWeight: 600 }}>Admin</div>
    <div style={{ fontSize: 12.5, color: "#8c919c", marginTop: 4, marginBottom: 14 }}>
      Data administration. Each screen keeps its own page.
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {ADMIN_SCREENS.map((s) => (
        <Link
          key={s.href}
          href={s.href}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            padding: "12px 14px",
            border: "1px solid #eef0f3",
            borderRadius: 10,
            textDecoration: "none",
            color: "inherit",
          }}
        >
          <span>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{s.label}</span>
            <span style={{ display: "block", fontSize: 12, color: "#8c919c", marginTop: 2 }}>
              {s.desc}
            </span>
          </span>
          <span aria-hidden style={{ color: "#b7bcc6", fontSize: 16 }}>→</span>
        </Link>
      ))}
    </div>
  </section>
)}
```

The whole `SettingsClient` only renders for admins (`page.tsx` gate), so no extra permission logic is needed.

- [ ] **Step 6: Build and drive to verify.** Kill any dev server first. Then `npm run build` (expect green). Start the app and at `/settings`:
  - The three-way toggle appears; **General** is default and shows Branding … Beta.
  - `/settings?section=team` shows only Team members + Roles; opening "add user" still works.
  - `/settings?section=admin` shows the Admin card with four links; each link navigates to the working `/catalog`, `/templates`, `/estimating-rules`, `/import` screen.
  - Locations "add/edit" modal still opens from the General section.

- [ ] **Step 7: Commit.**

```bash
git add "src/app/(app)/settings/settings-client.tsx"
git commit -m "Settings: sectioned nav (General/Team/Admin) with an Admin screen list (D99)"
```

---

### Task 5: Dissolve the General group — header 6 → 5

**Files:**
- Modify: `src/components/nav/nav-data.ts` (remove the whole `general` group; repoint 4 `activeKeyFor` entries)
- Test: `scripts/test-review-and-spec.ts` (flip `NAV.length`; add dissolution assertions)

**Interfaces:**
- Consumes: `NAV`, `activeKeyFor` (existing).
- Produces: `NAV.length === 5` (Home, Design, Sales, Installs, Service); no `general` group; `activeKeyFor` returns `"settings"` for `/catalog`, `/templates`, `/estimating-rules`, `/import`.

At this point the `general` group holds only `catalog, templates, rules, import` (companies/people/field left in Task 1, reports in Task 2). Those four are now reachable from Settings → Admin (Task 4), so the group can be removed.

- [ ] **Step 1: Write the failing test.** In `scripts/test-review-and-spec.ts`, change line 184 from:

```ts
ok(NAV.length === 6, "the header is down to 6 top-level items");
```

to:

```ts
ok(NAV.length === 5, "the header is down to 5 top-level items (General dissolved, D99)");
```

Append after the Task 3 block:

```ts
// ---- General dissolution (D99): the group is gone ----
ok(!NAV.some((e) => e.kind === "group" && e.key === "general"), "the General group is gone");
ok(
  NAV.map((e) => e.key).join(",") === "home,design,sales,installs,service",
  "the five top-level items are Home, Design, Sales, Installs, Service in order",
);
ok(
  activeKeyFor("/catalog") === "settings" &&
    activeKeyFor("/templates") === "settings" &&
    activeKeyFor("/estimating-rules") === "settings" &&
    activeKeyFor("/import") === "settings",
  "catalog, templates, estimating-rules, import all light Settings",
);
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npm run test:specs`
Expected: FAIL — `NAV.length === 5`, "the General group is gone", the five-item order, and the Settings-mapping assertions FAIL (General still present; the four paths still map to their own keys). Exit non-zero.

- [ ] **Step 3: Remove the group and repoint the keys.** In `src/components/nav/nav-data.ts`:
- Delete the entire `general` group entry from `NAV` (the `{ kind: "group", key: "general", … }` block, now holding catalog/templates/rules/import). `NAV` now ends with the `service` group.
- In the `activeKeyFor` map, change these four entries to point at `"settings"`:

```ts
    "/catalog": "settings",
    "/templates": "settings",
    "/estimating-rules": "settings",
    "/import": "settings",
```

Leave every other map entry unchanged (including `"/reports": "home"` from Task 2 and `"/settings": "settings"`).

- [ ] **Step 4: Run the test to verify it passes.**

Run: `npm run test:specs`
Expected: PASS — all dissolution assertions PASS; the Task 1/2/3 assertions still PASS. Count rose by 3 (104 → 107). `ALL PASSED`, exit 0.

- [ ] **Step 5: Build and drive to verify the chrome.** Kill any dev server first. `npm run build` (expect green). Start the app and confirm:
  - The top nav shows **5** items: Home, Design, Sales, Installs, Service. No "General".
  - The **Sales** dropdown lists six: Leads, Quotes, Reviews, Companies, People, Field Survey (Field Survey keeps its badge).
  - On `/catalog`, `/templates`, `/estimating-rules`, `/import`, no top-level group lights; the Settings entry lights in the mobile drawer.
  - Every screen still loads (routes unchanged).

- [ ] **Step 6: Commit.**

```bash
git add src/components/nav/nav-data.ts scripts/test-review-and-spec.ts
git commit -m "Nav: dissolve the General group; header is now five items (D99)"
```

---

### Task 6: Record the decision (D99) + whole-branch verification

**Files:**
- Modify: `DECISIONS.md` (add the D99 entry)

**Interfaces:** none — documentation + final gate.

- [ ] **Step 1: Add the D99 decision record.** In `DECISIONS.md`, following the D97/D98 shape (an `## D<N> — <title> (date)` H2 with prose + bold lead-in bullets), add at the end:

```markdown
## D99 — Dissolving the General group (2026-07-20)

The catch-all **General** nav group is gone; the header drops from six
top-level items to five (Home, Design, Sales, Installs, Service). Its eight
children were redistributed by ownership, not hidden:

- **Companies, People, Field Survey → Sales.** Sales owns the customer
  relationship, and Field Survey feeds quoting today. The nav keys
  (`companies`, `people`, `field`) are preserved — this was a MOVE inside
  `nav-data.ts`, not a rename, so badge counts and the `/customers → companies`
  legacy alias keep working. Sales' dropdown grows from three to six; accepted
  over widening the header (revisit if the dropdown gets hard to scan).
- **Reports → a fifth Home tab.** Reports is two business dashboards driven by
  `?view=sales|installs`, not configuration, so it belongs beside the other
  Home views rather than behind the gear. `HOME_TABS` gains a `reports` entry
  and `activeKeyFor("/reports")` now returns `home`. Reports keeps its own
  Sales|Installs pill — an orthogonal within-Reports selector — below the shared
  tab bar. This **amends** D98's four-tab Home hub to five.
- **Catalog, Templates, Estimating Rules, Import/Export → Settings → Admin.**
  These are data administration. Settings gained a three-way section nav
  (General · Team & Roles · Admin) via a new `?section=` param (not `?tab=`,
  which `/import` already uses). The four screens keep their own routes; the
  Admin area only links to them, so no working screen was rewritten.
  `activeKeyFor` maps their paths to `settings`.

Risk stayed in pure modules: the move and the key repointing live in the
already-pure `nav-data.ts`, and Settings' section logic in a new
dependency-free `settings-sections.ts`, both covered by `test:specs`. The
Settings and Reports client wiring was verified by driving the app. No routes
moved, no data changed, no migrations.
```

- [ ] **Step 2: Commit the record.**

```bash
git add DECISIONS.md
git commit -m "D99: record the General dissolution decisions"
```

- [ ] **Step 3: Whole-branch verification.** Kill any dev server. Run the full gate:

```bash
npm run test:specs   # expect ALL PASSED, exit 0, ~107 assertions
npm run build        # expect green, no type errors
```

Then drive the running app end-to-end against the spec's Testing section:
- `activeKeyFor` lights the right pill for all eight moved paths (Companies/People/Field Survey → Sales; Reports → Home; Catalog/Templates/Estimating Rules/Import → Settings).
- Settings → Admin lists and links all four screens; each still renders.
- Reports renders with the Home tab bar and its `?view=` state intact.
- Sales dropdown lists all six children.
- Header is five items.

Report the final assertion count, build result, and the drive observations. This branch is then ready for the subagent-driven-development whole-branch (opus) review and merge to `main`.

---

## Self-Review

**1. Spec coverage.** Every spec section maps to a task:
- "Where the eight items go" table → Task 1 (Companies/People/Field Survey → Sales), Task 2 (Reports → Home tab), Task 4 (Catalog/Templates/Estimating Rules/Import → Admin).
- "Settings gains an Admin area" → Tasks 3 (definitions) + 4 (wiring).
- "§3 amends the Home tabbed-hub spec" (Reports 5th tab) → Task 2.
- "Redirects — none required" → honored; no route moves in any task.
- "`activeKeyFor()` needs updating" → Task 1 (companies/people/field already correct via parentGroupOf), Task 2 (`/reports → home`), Task 5 (`/catalog`,`/templates`,`/estimating-rules`,`/import → settings`).
- "Risk — discoverability: Admin must list screens plainly" → Task 4 renders a plain link list, not sub-tabs.
- "Testing" checklist → Task 6 Step 3 drives each item; pure parts covered in Tasks 1–3, 5.
- "Out of scope" (Venues, Sales+Installs merge) → not touched.

**2. Placeholder scan.** No TBD/TODO/"handle edge cases"/"similar to Task N". Every code step shows the exact code. ✔

**3. Type consistency.** `SettingsSection` union defined in Task 3 is used in Task 4's `SegmentedToggle` `active={section}` and `hrefFor`. `HomeTabKey` (auto-extended in Task 2) types `active="reports"`. `HOME_TABS` entry shape `{ key, label, href }` matches the existing four. `ADMIN_SCREENS` `{ label, href, desc }` used identically in the module (Task 3) and the card (Task 4). Nav child key strings are never renamed. ✔

**Cross-plan note:** `NAV.length` is asserted `6` before Task 5 and flips to `5` in Task 5. Tasks 1–2 preserve `6` (General still exists), so no assertion is transiently red across task boundaries. ✔
