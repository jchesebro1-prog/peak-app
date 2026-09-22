# Round 2 Standalone Items Implementation Plan (PUNCHLIST #136, #135, #121, #131)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the four approved standalone items: a KNOWLEDGE nav tab that absorbs Steel Calculator + Fixture Cross-Ref (#136), a "+ New consulting project" path that creates a manual engagement the quote sweep never overwrites (#135), one shared `SearchFilterBar` + `Typeahead` adopted on the catalog pickers, the Grid palette and the People/Companies/Venues rows (#121), and a per-entry / per-category symbol shape for every device on a Grid plan, riser and legend (#131).

**Architecture:** Four independent items, ordered smallest first: #136 is file moves + a route map entry + redirect stubs + a landing page; #135 adds `origin`/nullable `quoteId` to `ConsultingEngagement`, a pure fee→milestone seed + sweep-index rule in `lib/consulting-stages.ts`, `createManualEngagement`/`attachQuoteToEngagement` in the store, two server actions and a hub modal; #121 adds two shared components under `src/components/search/` backed by a pure ranking helper in `src/lib/search/`, then swaps them into five screens; #131 adds a pure `lib/design/grid-symbols.ts` (shape vocabulary, category defaults, `shapeFor`, `symbolGeometry`, and `markerColor` moved out of the editor), one `<SymbolShape>` SVG component, a `shape` field on `GridSymbol`/`PartLite`, a Settings → Admin card writing `settings.gridCategoryShapes`, and adoption in the plan, palette, context panel, assemblies form and riser. Spec: `docs/superpowers/specs/2026-09-21-round-2-standalone-design.md`.

**Tech Stack:** Next.js 16 App Router, TypeScript, Drizzle on Postgres/PGlite, doc-store JSON documents, server actions, tsx test harnesses

## Global Constraints

- Node at `~/.local/node/bin`: `export PATH=$HOME/.local/node/bin:$PATH` first.
- **No schema change** in any task — every new field lives inside an existing JSON document (`consulting_engagements`, `grid_catalog`) or `app_settings`. No `db:generate`, no migration.
- **PGlite is single-process.** Implementers run only `npx tsc --noEmit -p .`, `npx tsx scripts/test-review-and-spec.ts`, `npm run test:review:regressions` (one at a time — `ps aux | grep -E 'tsx|next dev'` must be empty first) and `npx eslint <files>`. Implementers must NOT run `npm run test:smoke`, `next dev` or `next build` — the controller runs those (and the browser passes) after each item lands.
- `requireUser()` on every server action; `requirePerm("create")` on the manual-engagement create; `requirePerm("manage_users")` on the Settings save (the existing Settings gate).
- Timestamps epoch-ms. Ids keep prototype formats (`CE-####`, `c<ms>` customers, `GASM-#` grid assemblies). Keep prototype field names.
- No hardcoded accent colour — `var(--accent)` / `var(--accent-soft)` / `color-mix(...)` only. No emoji in UI copy (#3).
- Every new pure helper lives in a DB-free module (`src/lib/consulting-stages.ts`, `src/lib/search/typeahead-rank.ts`, `src/lib/design/grid-symbols.ts`) so `scripts/test-review-and-spec.ts` can import it; nothing under `src/lib/search` or `src/lib/design/grid-symbols.ts` may import a store or `@/db`.
- Commit after every task with the trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`; `git add` only the files the task names.
- Spec harness: `ok(cond, msg)` in `scripts/test-review-and-spec.ts` (synchronous section; each block sits next to its own `import`, the file's idiom — imports are hoisted). Regression harness: `assert` inside `main()` of `scripts/test-review-regressions.ts` (scratch PGlite via `PGLITE_PATH`). New GET routes go into `ROUTES` in `scripts/smoke-routes.ts`.

**Verification findings that correct the spec (read before starting):**
- `ensureEngagementForQuote()` is NOT dead code — `scripts/test-review-regressions.ts:5,73` uses it. Leave it untouched.
- `GridSymbol` (`src/lib/stores/grid-catalog.ts:17-33`) has `width`/`height`; the `symbolWidth`/`symbolHeight` the spec names are on `PartLite` (`src/lib/design/grid-bom.ts:57-58`), mapped in `design/grid/[id]/page.tsx:112-113`. `<SymbolShape>` therefore takes `w`/`h` rather than one `size`.
- There is no grid-catalog entry editor anywhere in the app (grep `grid_catalog|GridSymbol` → only the editor page, its actions, `assemblies-panel.tsx`, `grid-seed.ts`); entries are born from the pricing-catalog seed or the Assemblies "+ Build" form. That form is the "entry editor" that gets the Symbol select.
- There is no Grid legend today (grep `legend` under `design/grid` → nothing). The legend is added to the riser page (the printable derived drawing); the palette rows are the plan's own legend.
- Settings sections are pinned by the spec harness to exactly `general,team,admin` (`scripts/test-review-and-spec.ts:585`), so the "Settings → Grid" card lives in Settings → Admin next to the Customer-fields card.
- `activeKeyFor` (`nav-data.ts:102-142`) is segment-1 matching: every `/design/*` route lights `designoverview`; `/knowledge/*` follows the same idiom (`knowledgeoverview`).
- `scripts/smoke-routes.ts` follows redirects (`redirect: "follow"`, line 337), so the existing `/design/steel` and `/design/fixtures` entries prove the redirect hop resolves; the `designRedirect` unit checks assert the target.

---

## File Structure

**#136 Knowledge**
- `src/components/nav/nav-data.ts` — KNOWLEDGE group after DESIGN; `steel`/`fixtures` children move; `/knowledge` in `activeKeyFor`.
- `src/lib/design-routes.ts` — `KNOWLEDGE_MOVES` map so `/design/steel|fixtures` and `/design-studio/steel` land on `/knowledge/*` in one hop.
- `src/app/(app)/knowledge/page.tsx` — landing page (tools, provenance, "Coming here").
- `src/app/(app)/knowledge/steel/page.tsx`, `src/app/(app)/knowledge/steel/steel-calc.tsx` — moved from `design/steel/` (back link → Knowledge; component untouched).
- `src/app/(app)/knowledge/fixtures/page.tsx` — moved from `design/fixtures/` (back link → Knowledge).
- `src/app/(app)/design/steel/page.tsx`, `src/app/(app)/design/fixtures/page.tsx` — become redirect stubs.
- `scripts/test-review-and-spec.ts` — D97 nav/route checks updated + KNOWLEDGE checks + unique-key check.
- `scripts/smoke-routes.ts` — `/knowledge`, `/knowledge/steel`, `/knowledge/fixtures`.

**#135 Manual consulting project**
- `src/lib/consulting-stages.ts` — `ManualFee`, `manualMilestoneSeeds`, `sweepIndexesEngagement` (pure).
- `src/lib/stores/engagements.ts` — `origin`, nullable `quoteId`, `createManualEngagement`, `attachQuoteToEngagement`, sweep index guard.
- `src/app/(app)/design/engagements/data.ts` — null-safe `wanted`; `customers` (CustomerLite) for the modal.
- `src/app/(app)/design/engagements/actions.ts` — `createManualEngagementAction`, `attachProposalAction`.
- `src/app/(app)/design/engagements/new-engagement-modal.tsx` — the "+ New consulting project" modal.
- `src/app/(app)/design/engagements/view.tsx` — header button + modal mount, Manual pill, null-safe quote lookups, "Attach proposal" in the Links card.
- `scripts/test-review-and-spec.ts`, `scripts/test-review-regressions.ts` — pure + DB checks.

**#121 Search bars**
- `src/lib/search/typeahead-rank.ts` — `typeaheadMatches`, `catalogFilter`, `catalogRank`, `catalogMatches` (pure).
- `src/components/search/search-filter-bar.tsx` — `SearchFilterBar`.
- `src/components/search/typeahead.tsx` — `Typeahead<T>`.
- `src/app/globals.css` — `.pk-searchbar*` classes.
- `src/app/(app)/design/subassemblies/subassemblies-client.tsx` — `PartPicker` on `Typeahead`.
- `src/app/(app)/design/assemblies/page.tsx`, `assembly-builder.tsx`, `actions.ts` — component picker on `Typeahead` over a client-side catalog slice; search action removed.
- `src/app/(app)/design/grid/[id]/editor.tsx` — palette search row on `SearchFilterBar`.
- `src/app/(app)/people/controls.tsx`, `src/app/(app)/companies/controls.tsx`, `src/app/(app)/venues/page.tsx` — filter rows on `SearchFilterBar`.
- `scripts/test-review-and-spec.ts` — ranking checks.

**#131 Grid symbols**
- `src/lib/design/grid-symbols.ts` — `GRID_SHAPES`, `GridShape`, labels, `DEFAULT_GRID_CATEGORY_SHAPES`, `isGridShape`, `resolveCategoryShapes`, `shapeFor`, `symbolGeometry`, `markerColor` (pure).
- `src/components/design/symbol-shape.tsx` — `SymbolShape` (SVG `<g>`) + `SymbolIcon` (inline `<svg>`).
- `src/lib/stores/grid-catalog.ts` — `GridSymbol.shape`, `createGridAssembly({ shape })`, `setGridSymbolShape`.
- `src/lib/design/grid-bom.ts` — `PartLite.shape`.
- `src/lib/design/grid-riser.ts` — `RiserGroup.category`/`shape`.
- `src/lib/settings.ts` — `AppSettingsData.gridCategoryShapes`.
- `src/app/(app)/design/grid/[id]/actions.ts` — `setSymbolShapeAction`; `createGridAssemblyAction` takes `shape`.
- `src/app/(app)/design/grid/[id]/page.tsx`, `editor.tsx`, `assemblies-panel.tsx`, `riser/page.tsx` — adoption.
- `src/app/(app)/settings/grid-symbols-card.tsx`, `settings/actions.ts`, `settings/page.tsx`, `settings/settings-client.tsx` — the category-defaults card.
- `scripts/test-review-and-spec.ts`, `scripts/smoke-routes.ts`.

**Docs**
- `DECISIONS.md` (D154, D155), `PUNCHLIST.md` (#121, #131, #135, #136 → DONE).

---

## #136 — Knowledge & Information tab

### Task 1: KNOWLEDGE nav group + route map

**Files:**
- Modify: `src/components/nav/nav-data.ts:78-98` (DESIGN group), `:102-142` (`activeKeyFor`)
- Modify: `src/lib/design-routes.ts:28-61`
- Test: `scripts/test-review-and-spec.ts` (sections "design module route map (D97)" lines 430-457 and "design module nav (D97)" lines 459-488)

**Interfaces:**
- Consumes: `NavEntry`/`NAV`/`activeKeyFor`/`parentGroupOf` (`src/components/nav/nav-data.ts`), `designRedirect(pathname, query)` (`src/lib/design-routes.ts`).
- Produces: `NAV` gains `{ kind: "group", key: "knowledge", label: "KNOWLEDGE", children: [knowledgeoverview, steel, fixtures] }` after DESIGN; `activeKeyFor("/knowledge…") === "knowledgeoverview"`; `designRedirect("/design/steel", {}) === "/knowledge/steel"`, `designRedirect("/design/fixtures", {}) === "/knowledge/fixtures"`, `designRedirect("/design-studio/steel", {}) === "/knowledge/steel"`.

- [ ] **Step 1: Update the D97 checks and add the KNOWLEDGE checks** in `scripts/test-review-and-spec.ts`.

Replace lines 444-445:
```ts
ok(designRedirect("/design-studio/steel", {}) === "/knowledge/steel",
  "calculators keep their leaf name — and follow the #136 move to Knowledge in ONE hop");
```
Replace lines 466-467:
```ts
ok(activeKeyFor("/design/lineset") === "designoverview",
  "/design/lineset resolves to the designoverview key (segment-1 matching)");
```
Replace lines 478-484 (the `DESIGN_CHILDREN` comment + const):
```ts
/* "grid" left when The Grid became a layout mode of Designs rather than a
 * tool of its own (D-grid-merge): the "designs" child is now labelled "The
 * Grid" and the standalone index it pointed at is gone. "steel" and
 * "fixtures" moved to the KNOWLEDGE group (#136). */
const DESIGN_CHILDREN = [
  "designoverview", "engagements", "designs",
  "lineset", "assemblies", "motors", "subassemblies",
];
```
Append immediately after line 488 (the `Design's children are exactly` check):
```ts
/* --- Knowledge & Information tab (#136) --- */
ok(designRedirect("/design/steel", {}) === "/knowledge/steel",
  "#136: /design/steel redirects to /knowledge/steel");
ok(designRedirect("/design/fixtures", {}) === "/knowledge/fixtures",
  "#136: /design/fixtures redirects to /knowledge/fixtures");
ok(designRedirect("/design/lineset", {}) === null,
  "#136: the other Design tools are NOT redirected");
const knowledgeGroup = NAV.find((e) => e.kind === "group" && e.key === "knowledge");
const KNOWLEDGE_CHILDREN = ["knowledgeoverview", "steel", "fixtures"];
ok(
  !!knowledgeGroup && knowledgeGroup.kind === "group" &&
    JSON.stringify(knowledgeGroup.children.map((c) => c.key)) === JSON.stringify(KNOWLEDGE_CHILDREN),
  `#136: KNOWLEDGE's children are exactly [${KNOWLEDGE_CHILDREN.join(", ")}]`);
ok(NAV.findIndex((e) => e.key === "knowledge") === NAV.findIndex((e) => e.key === "design") + 1,
  "#136: KNOWLEDGE sits immediately after DESIGN");
ok(knowledgeGroup?.kind === "group" && knowledgeGroup.children.map((c) => c.href).join(",") === "/knowledge,/knowledge/steel,/knowledge/fixtures",
  "#136: KNOWLEDGE hrefs are the new routes");
ok(activeKeyFor("/knowledge") === "knowledgeoverview" && activeKeyFor("/knowledge/steel") === "knowledgeoverview" && activeKeyFor("/knowledge/fixtures") === "knowledgeoverview",
  "#136: every /knowledge route lights the KNOWLEDGE pill (segment-1 matching)");
ok(parentGroupOf("knowledgeoverview") === "knowledge" && parentGroupOf("steel") === "knowledge",
  "#136: knowledge children resolve to the knowledge group");
const NAV_KEYS = NAV.flatMap((e) => (e.kind === "group" ? [e.key, ...e.children.map((c) => c.key)] : [e.key]));
ok(new Set(NAV_KEYS).size === NAV_KEYS.length,
  `#136: no two nav entries share a key (${NAV_KEYS.length} keys)`);
```

- [ ] **Step 2: Run, expect failure** — `npx tsx scripts/test-review-and-spec.ts 2>&1 | grep -E '#136|calculators keep|children are exactly' ` → FAIL lines for the redirects, the DESIGN children list and the missing group.

- [ ] **Step 3: `src/lib/design-routes.ts`** — add the map above `designRedirect` and use it in two places. Insert after line 22 (`}` closing `qs`):

```ts
/**
 * #136: Steel Calculator and Fixture Cross-Ref moved from DESIGN to the
 * KNOWLEDGE tab. Keyed on the /design/* path they had after D97 so BOTH the
 * D97 stubs (/design-studio/steel → /design/steel) and the /design/* stubs
 * land on /knowledge/* in one hop instead of a redirect chain.
 */
const KNOWLEDGE_MOVES: Record<string, string> = {
  "/design/steel": "/knowledge/steel",
  "/design/fixtures": "/knowledge/fixtures",
};
```
Inside `designRedirect`, insert before `if (pathname === "/design-studio") return "/design";` (line 44):
```ts
  if (KNOWLEDGE_MOVES[pathname]) return KNOWLEDGE_MOVES[pathname];
```
and replace the `/design-studio/` leaf branch (lines 53-56) with:
```ts
  if (pathname.startsWith("/design-studio/")) {
    const leaf = pathname.slice("/design-studio/".length);
    const next = "/design/" + leaf;
    return (KNOWLEDGE_MOVES[next] || next) + qs(pathname, query);
  }
```

- [ ] **Step 4: `src/components/nav/nav-data.ts`** — remove lines 91 and 95 (`steel`, `fixtures`) from the DESIGN group's children and insert the new group after the DESIGN group's closing `},` (line 98):

```ts
  /* #136: Knowledge & Information — reference tools and, later (#56), the
   * company doctrine/rules/tiers. Steel Calculator and Fixture Cross-Ref
   * moved here from DESIGN; their old /design/* routes redirect. */
  {
    kind: "group",
    key: "knowledge",
    label: "KNOWLEDGE",
    children: [
      { key: "knowledgeoverview", label: "Overview", href: "/knowledge" },
      { key: "steel", label: "Steel Calculator", href: "/knowledge/steel" },
      { key: "fixtures", label: "Fixture Cross-Ref", href: "/knowledge/fixtures" },
    ],
  },
```
In `activeKeyFor`'s `map` add, after `"/design": "designoverview",` (line 118):
```ts
    "/knowledge": "knowledgeoverview", // #136 — every /knowledge/* route lights the KNOWLEDGE pill
```

- [ ] **Step 5: Run tests, expect pass** — `npx tsx scripts/test-review-and-spec.ts 2>&1 | grep -E '#136|calculators keep|children are exactly|designoverview|ALL PASSED'` → all PASS + `ALL PASSED`; `npx tsc --noEmit -p . | tail -3` → empty; `npx eslint src/components/nav/nav-data.ts src/lib/design-routes.ts` → clean.

- [ ] **Step 6: Commit**
```bash
git add src/components/nav/nav-data.ts src/lib/design-routes.ts scripts/test-review-and-spec.ts
git commit -m "feat(nav): KNOWLEDGE group after DESIGN; steel + fixtures routes map to /knowledge (#136)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Move the two pages, add the landing page and the redirect stubs

**Files:**
- Move: `src/app/(app)/design/steel/steel-calc.tsx` → `src/app/(app)/knowledge/steel/steel-calc.tsx` (unchanged)
- Move: `src/app/(app)/design/steel/page.tsx` → `src/app/(app)/knowledge/steel/page.tsx` (back link only)
- Move: `src/app/(app)/design/fixtures/page.tsx` → `src/app/(app)/knowledge/fixtures/page.tsx` (back link only)
- Create: `src/app/(app)/knowledge/page.tsx`
- Create (overwrite the moved-away paths): `src/app/(app)/design/steel/page.tsx`, `src/app/(app)/design/fixtures/page.tsx` — redirect stubs
- Modify: `scripts/smoke-routes.ts:86-94`
- Test: `scripts/smoke-routes.ts` (controller runs it)

**Interfaces:**
- Consumes: `designRedirect` from Task 1; `requireUser` (`src/lib/session.ts`); `data.compiled` from `src/lib/design/fixture-crossref.json` (the fixtures page already imports it, line 3).
- Produces: routes `/knowledge`, `/knowledge/steel`, `/knowledge/fixtures` (200); `/design/steel`, `/design/fixtures` (redirect).

- [ ] **Step 1: Add the routes to the smoke list.** In `scripts/smoke-routes.ts` replace lines 89 and 93 (`"/design/fixtures",` and `"/design/steel",`) with:
```ts
  "/design/fixtures", // #136 redirect stub → /knowledge/fixtures (the harness follows it)
```
```ts
  "/design/steel", // #136 redirect stub → /knowledge/steel
```
and after the `"/design/steel",` line add:
```ts
  /* #136 Knowledge & Information tab — landing page + the two moved tools. */
  "/knowledge",
  "/knowledge/steel",
  "/knowledge/fixtures",
```
(The controller's `npm run test:smoke` is the "expect failure / expect pass" for this task; there is no local run.)

- [ ] **Step 2: Move the files** (from the repo root):
```bash
mkdir -p "src/app/(app)/knowledge/steel" "src/app/(app)/knowledge/fixtures"
git mv "src/app/(app)/design/steel/steel-calc.tsx" "src/app/(app)/knowledge/steel/steel-calc.tsx"
git mv "src/app/(app)/design/steel/page.tsx" "src/app/(app)/knowledge/steel/page.tsx"
git mv "src/app/(app)/design/fixtures/page.tsx" "src/app/(app)/knowledge/fixtures/page.tsx"
```

- [ ] **Step 3: Repoint the back links on the moved pages.** In `src/app/(app)/knowledge/steel/page.tsx` replace lines 12-14 with:
```tsx
        <Link href="/knowledge" style={{ fontSize: 12.5, fontWeight: 600, color: "#8c919c", textDecoration: "none" }}>
          ← Knowledge
        </Link>
```
In `src/app/(app)/knowledge/fixtures/page.tsx` replace line 54 with:
```tsx
      <Link href="/knowledge" style={{ fontSize: 12.5, color: "#8c919c" }}>← Knowledge</Link>
```
Nothing else in either file changes (`./steel-calc` still resolves; the JSON import is absolute).

- [ ] **Step 4: Redirect stubs at the old paths.** Create `src/app/(app)/design/steel/page.tsx`:
```tsx
import { redirect } from "next/navigation";
import { designRedirect } from "@/lib/design-routes";

/** Moved to /knowledge/steel (#136). Kept for bookmarks and old deep links. */
export default async function LegacyDesignSteelPage() {
  redirect(designRedirect("/design/steel", {})!);
}
```
Create `src/app/(app)/design/fixtures/page.tsx`:
```tsx
import { redirect } from "next/navigation";
import { designRedirect } from "@/lib/design-routes";

/** Moved to /knowledge/fixtures (#136). Kept for bookmarks and old deep links. */
export default async function LegacyDesignFixturesPage() {
  redirect(designRedirect("/design/fixtures", {})!);
}
```

- [ ] **Step 5: The landing page.** Create `src/app/(app)/knowledge/page.tsx`:
```tsx
import Link from "next/link";
import { requireUser } from "@/lib/session";
import fixtures from "@/lib/design/fixture-crossref.json";

export const metadata = { title: "Knowledge — Quartzite-6" };

/**
 * Knowledge & Information (#136) — the first slice of #27/#56: what reference
 * material lives in the app today, where each dataset comes from and how it
 * is maintained, and what is queued to move here. Company settings (doctrine,
 * estimating rules, tiers) stay where they are until #56 — plain text below,
 * no links to unbuilt pages.
 */

const TOOLS = [
  {
    href: "/knowledge/steel",
    name: "Steel Calculator",
    what: "AISC ASD beam capacity and member sizing, rigging loads, and the 848-section property database with a takeoff.",
    source:
      "A native port of the Peak Structural Steel Calculator. The section table is src/lib/design/steel-shapes.json; the formulas (AISC F2/G, hoist and batten statics, counterweight math) are src/lib/design/steel.ts.",
    upkeep:
      "Peak owns the numbers. A change to a section, a grade or a hoist rating ships as a code update after engineering review — nothing in this tool is edited in the app, so a figure you see is a figure someone signed off on.",
  },
  {
    href: "/knowledge/fixtures",
    name: "Fixture Cross-Reference",
    what: "ETC-anchored competitive matrices for lighting fixtures — the equivalent competitor product, how close it is, and the one-line talking point.",
    source: `Ported from the Peak Knowledge cross-reference workbooks (compiled ${fixtures.compiled}) into src/lib/design/fixture-crossref.json.`,
    upkeep:
      "Refreshed by re-importing the workbooks; verify pricing before bidding. Internal sales reference only — never customer-facing.",
  },
];

const COMING = [
  { name: "Design doctrine", desc: "Venue-class soft-goods and lighting guidance — what Peak recommends per venue class, and why." },
  { name: "Estimating rules", desc: "The rates and formulas the estimator applies, explained beside the numbers." },
  { name: "Customer tiers", desc: "How pricing tiers are assigned and what each one changes on a quote." },
];

const card: React.CSSProperties = { padding: "18px 20px" };
const label: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 600, letterSpacing: ".05em", textTransform: "uppercase", color: "#aab0bb", marginBottom: 4,
};

export default async function KnowledgePage() {
  await requireUser();
  return (
    <div className="pk-content" style={{ maxWidth: 1080, padding: "26px 30px 64px" }}>
      <h1 style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em", marginBottom: 4 }}>
        Knowledge &amp; Information
      </h1>
      <p style={{ color: "#8c919c", fontSize: 13, marginBottom: 22, maxWidth: 720 }}>
        Reference material the team works from. Each tool says where its data comes from and who
        keeps it current, so a number here is never a mystery.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 18 }}>
        {TOOLS.map((t) => (
          <section key={t.href} className="pk-card" style={card}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
              <strong style={{ fontSize: 15 }}>{t.name}</strong>
              <Link href={t.href} style={{ color: "var(--accent)", fontSize: 12.5, textDecoration: "none", whiteSpace: "nowrap" }}>
                Open →
              </Link>
            </div>
            <p style={{ fontSize: 13, color: "#3a3f47", lineHeight: 1.5, margin: "0 0 12px" }}>{t.what}</p>
            <div style={label}>Where the data comes from</div>
            <p style={{ fontSize: 12.5, color: "#5b616e", lineHeight: 1.5, margin: "0 0 10px" }}>{t.source}</p>
            <div style={label}>How it is maintained</div>
            <p style={{ fontSize: 12.5, color: "#5b616e", lineHeight: 1.5, margin: 0 }}>{t.upkeep}</p>
          </section>
        ))}
      </div>

      <section className="pk-card" style={{ ...card, marginTop: 18 }}>
        <strong style={{ fontSize: 14 }}>Coming here</strong>
        <p style={{ fontSize: 12.5, color: "#8c919c", margin: "4px 0 10px" }}>
          Company knowledge that still lives in Settings and Estimating Rules today (#56). Listed so
          nobody goes looking for it here yet.
        </p>
        {COMING.map((c) => (
          <div key={c.name} style={{ padding: "9px 0", borderTop: "1px solid #eef0f3", fontSize: 13 }}>
            <div style={{ fontWeight: 600 }}>{c.name}</div>
            <div style={{ fontSize: 12.5, color: "#5b616e", marginTop: 2 }}>{c.desc}</div>
          </div>
        ))}
      </section>
    </div>
  );
}
```

- [ ] **Step 6: Verify** — `npx tsc --noEmit -p . | tail -3` → empty; `npx eslint "src/app/(app)/knowledge" "src/app/(app)/design/steel" "src/app/(app)/design/fixtures"` → clean; `npx tsx scripts/test-review-and-spec.ts 2>&1 | grep -E '#136|ALL PASSED'` → PASS + `ALL PASSED`; `git status --short` shows the two renames (`R`) plus the new files. The controller then runs `npm run test:smoke` (expects `/knowledge*` 200 and the two `/design/*` stubs resolving) and eyeballs `/knowledge` in the browser.

- [ ] **Step 7: Commit**
```bash
git add "src/app/(app)/knowledge" "src/app/(app)/design/steel" "src/app/(app)/design/fixtures" scripts/smoke-routes.ts
git commit -m "feat(knowledge): landing page; Steel Calculator + Fixture Cross-Ref move under /knowledge with redirect stubs (#136)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## #135 — Consulting: add a project + fee manually

### Task 3: Manual engagement in the store — pure seeds, sweep rule, create + attach

**Files:**
- Modify: `src/lib/consulting-stages.ts` (append after `milestoneSeeds`, line 189)
- Modify: `src/lib/stores/engagements.ts:9-15` (import), `:218-248` (type), `:420-465` (`fromQuote`), `:527-573` (sweep), append after the sweep
- Modify: `src/app/(app)/design/engagements/data.ts:1-11` (imports), `:35-44` (type), `:46-70` (loader)
- Modify: `src/app/(app)/design/engagements/view.tsx:186`, `:222`, `:319`, `:358-360`, `:418-423` (null-safe `quoteId` — compile fixes only; the UI lands in Task 4)
- Test: `scripts/test-review-and-spec.ts` (section "#135 manual consulting projects"), `scripts/test-review-regressions.ts`

**Interfaces:**
- Produces (`src/lib/consulting-stages.ts`, pure):
```ts
export type ManualFee =
  | { mode: "fixed"; amount: number }
  | { mode: "milestones"; milestones: Array<{ name: string; targetDate: number; amount: number }> };
export function manualMilestoneSeeds(fee: ManualFee | null | undefined): Array<{ name: string; targetDate: number; amount: number }>;
export function sweepIndexesEngagement<T extends { origin?: string | null; quoteId?: string | null }>(e: T): e is T & { quoteId: string };
```
- Produces (`src/lib/stores/engagements.ts`):
```ts
// ConsultingEngagement gains: quoteId: string | null; origin?: "quote" | "manual";
export type ManualEngagementInput = {
  customerId: string; customer: string; name: string;
  architect?: { company: string; contact: string } | null;
  siteId?: string | null; contactName?: string; fee?: ManualFee | null;
  /** phase names — the ACTION resolves mergedConsultingPhases(settings); the store stays settings-free (the D91 idiom) */
  phases: string[];
};
export async function createManualEngagement(input: ManualEngagementInput, me: { name: string }): Promise<ConsultingEngagement>;
export async function attachQuoteToEngagement(engId: string, quoteId: string): Promise<void>;
```
- Produces (`data.ts`): `CustomerLite`, `ConsultingData.customers: CustomerLite[]`.

- [ ] **Step 1: Failing spec tests** — in `scripts/test-review-and-spec.ts`, insert immediately before the line `async function asyncChecks(): Promise<void> {` (currently line 3192):

```ts
/* --- #135 manual consulting projects (D155) --- */
import { manualMilestoneSeeds, sweepIndexesEngagement } from "@/lib/consulting-stages";

ok(JSON.stringify(manualMilestoneSeeds({ mode: "fixed", amount: 12000 })) === JSON.stringify([{ name: "Fee", targetDate: 0, amount: 12000 }]),
  "#135: a fixed fee becomes ONE unscheduled 'Fee' milestone carrying the amount");
ok(manualMilestoneSeeds({ mode: "fixed", amount: 0 }).length === 0 && manualMilestoneSeeds(null).length === 0 && manualMilestoneSeeds(undefined).length === 0,
  "#135: no fee (or a zero fixed fee) seeds no milestones");
const t135 = manualMilestoneSeeds({
  mode: "milestones",
  milestones: [
    { name: " Schematic design ", targetDate: 1700000000000, amount: 5000 },
    { name: "", targetDate: -5, amount: 2500 },
    { name: "", targetDate: 0, amount: 0 },
  ],
});
ok(t135.length === 2, `#135: rows with neither a name nor an amount are dropped (${t135.length})`);
ok(t135[0].name === "Schematic design" && t135[0].targetDate === 1700000000000 && t135[0].amount === 5000,
  "#135: milestone names are trimmed, dates and amounts kept");
ok(t135[1].name === "Milestone" && t135[1].targetDate === 0 && t135[1].amount === 2500,
  "#135: a blank name defaults to 'Milestone'; a negative date is unscheduled (0)");
ok(!sweepIndexesEngagement({ origin: "manual", quoteId: null }),
  "#135 (D155): the sweep skips a manual project that has no proposal");
ok(sweepIndexesEngagement({ origin: "manual", quoteId: "Q-1" }),
  "#135 (D155): once a proposal is attached the sweep tracks the row by that quote");
ok(sweepIndexesEngagement({ quoteId: "Q-2" }) && sweepIndexesEngagement({ origin: "quote", quoteId: "Q-3" }),
  "#135: quote-born rows (origin absent on pre-#135 docs, or 'quote') are indexed by their quote");
ok(!sweepIndexesEngagement({ quoteId: "" }) && !sweepIndexesEngagement({ quoteId: null }),
  "#135: a row with no quote id is never indexed");
```

- [ ] **Step 2: Run, expect failure** — `npx tsx scripts/test-review-and-spec.ts 2>&1 | head -5` → import error (`manualMilestoneSeeds` is not exported).

- [ ] **Step 3: `src/lib/consulting-stages.ts`** — append after `milestoneSeeds` (after line 189, before the `/* ---------- assumptions library (#35) ---------- */` block):

```ts
/* ---------- manual projects (#135, D155) ---------- */

/** A manually entered fee — one fixed amount, or a milestone schedule.
 *  Dates are epoch-ms; 0 = not scheduled yet (the Reports billing forecast
 *  only counts targetDate > 0, exactly like quote-born milestones). */
export type ManualFee =
  | { mode: "fixed"; amount: number }
  | {
      mode: "milestones";
      milestones: Array<{ name: string; targetDate: number; amount: number }>;
    };

/**
 * What a manual engagement's milestones seed from — the pure half of
 * createManualEngagement, mirroring milestoneSeeds above. A fixed fee becomes
 * ONE unscheduled "Fee" milestone carrying the amount; a schedule keeps its
 * rows (trimmed names, "Milestone" when blank, missing/negative dates → 0,
 * negative amounts → 0) and drops rows that have neither a name nor an
 * amount. Nothing here reads settings or the store.
 */
export function manualMilestoneSeeds(
  fee: ManualFee | null | undefined
): Array<{ name: string; targetDate: number; amount: number }> {
  if (!fee) return [];
  if (fee.mode === "fixed") {
    const amount = Number(fee.amount) || 0;
    return amount > 0 ? [{ name: "Fee", targetDate: 0, amount }] : [];
  }
  return (fee.milestones || [])
    .map((m) => ({
      name: String(m.name || "").trim(),
      targetDate: Number(m.targetDate) > 0 ? Number(m.targetDate) : 0,
      amount: Number(m.amount) > 0 ? Number(m.amount) : 0,
    }))
    .filter((m) => m.name || m.amount > 0)
    .map((m) => ({ ...m, name: m.name || "Milestone" }));
}

/**
 * Which engagement rows the quotes→engagements sweep indexes (D155). A
 * manual project has no proposal until one is attached, so there is nothing
 * for the sweep to reconcile — it must never create, advance, close or
 * reopen such a row. Once a quote is attached the row is keyed by that quote
 * and follows engagementSyncAction like any other; those rules only ever
 * move proposal_sent and closed rows, so an awarded manual project is never
 * demoted, and indexing it means the sweep can never mint a duplicate for
 * the attached quote either.
 */
export function sweepIndexesEngagement<
  T extends { origin?: string | null; quoteId?: string | null },
>(e: T): e is T & { quoteId: string } {
  if (e.origin === "manual" && !e.quoteId) return false;
  return typeof e.quoteId === "string" && e.quoteId.length > 0;
}
```

- [ ] **Step 4: `src/lib/stores/engagements.ts`**

(a) Import — replace lines 9-15 with:
```ts
import {
  engagementSyncAction,
  manualMilestoneSeeds,
  milestoneSeeds,
  normalizeEngagementStatus,
  sweepIndexesEngagement,
  type ConsultingScope,
  type EngagementStage,
  type ManualFee,
} from "@/lib/consulting-stages";
```

(b) Type — replace lines 228-229 (`/** Source consulting quote — the paid commitment. */` + `quoteId: string;`) with:
```ts
  /** Source consulting quote — the paid commitment. Null on a manually
   *  added project (#135) until a proposal is attached. */
  quoteId: string | null;
  /** How the row was born (#135, D155): by the quote sweep (absent on every
   *  pre-#135 doc — read absent as "quote") or by hand from the hub. */
  origin?: "quote" | "manual";
```

(c) `fromQuote` — after `quoteId: q.id,` (line 451) add:
```ts
    origin: "quote",
```

(d) Sweep — replace lines 531-532 (`const byQuote = …` + the `for` line) with:
```ts
  const byQuote = new Map<string, ConsultingEngagement>();
  for (const e of engagements) {
    // #135 (D155): a manual project has no proposal to reconcile until one is
    // attached; rows are indexed by quote only when they carry one.
    if (!sweepIndexesEngagement(e)) continue;
    byQuote.set(e.quoteId, e);
  }
```

(e) Append after `syncEngagementsFromQuotes` (after line 573, before `/** Attach a document to the engagement …`):
```ts
/* ---------- manual projects (#135, D155) ---------- */

export type ManualEngagementInput = {
  customerId: string;
  /** Denormalized display name — the quotes/projects convention. */
  customer: string;
  name: string;
  architect?: { company: string; contact: string } | null;
  siteId?: string | null;
  contactName?: string;
  fee?: ManualFee | null;
  /** Phase names. The ACTION resolves mergedConsultingPhases(settings) —
   *  the store stays settings-free (the D91 idiom) so it is testable alone. */
  phases: string[];
};

/**
 * A consulting project that never had (or skipped) a fee proposal. Born
 * `awarded` with `origin: "manual"` and no quote; milestones come from the
 * fee (a fixed fee = one unscheduled "Fee" milestone), phases from the menu
 * exactly as a won quote seeds them (all pending). The sweep ignores the
 * row until attachQuoteToEngagement links a proposal.
 */
export async function createManualEngagement(
  input: ManualEngagementInput,
  me: { name: string }
): Promise<ConsultingEngagement> {
  const now = Date.now();
  const phases = (input.phases.length ? input.phases : DEFAULT_CONSULTING_PHASES).map(makePhase);
  const milestones: EngagementMilestone[] = manualMilestoneSeeds(input.fee).map((m) => ({
    id: uid("ms-"),
    name: m.name,
    targetDate: m.targetDate,
    completedAt: null,
    amount: m.amount,
  }));
  const architectCompany = (input.architect?.company || "").trim();
  const architectContact = (input.architect?.contact || "").trim();
  const body: Omit<ConsultingEngagement, "id"> = {
    name: input.name.trim() || "Consulting project",
    customer: input.customer,
    companyId: input.customerId,
    siteIds: input.siteId ? [input.siteId] : [],
    contactName: (input.contactName || "").trim(),
    people: [],
    quoteId: null,
    origin: "manual",
    designIds: [],
    installQuoteId: null,
    architect:
      architectCompany || architectContact
        ? { company: architectCompany, contact: architectContact }
        : null,
    status: "awarded",
    phases,
    milestones,
    decisions: [
      {
        id: uid("dc-"),
        at: now,
        by: me.name,
        decision: "Project added manually",
        context: "Created from the Consulting hub without a fee proposal (#135).",
      },
    ],
    meetings: [],
    submittals: [],
    documents: [],
    createdAt: now,
    updatedAt: now,
  };
  return insertWithPrefixedId<ConsultingEngagement>(
    "consulting_engagements",
    "CE",
    1000,
    (id) => ({ ...body, id })
  );
}

/** Link an existing consulting quote to a manual project. Milestones are
 *  NOT touched — the fee was entered by hand and stays as entered; from here
 *  the quote's status changes follow the normal sweep rules. Validation
 *  (quote exists, is consulting, is unclaimed) is the action's job. */
export async function attachQuoteToEngagement(
  engId: string,
  quoteId: string
): Promise<void> {
  await patchEngagement(engId, (d) => {
    d.quoteId = quoteId;
  });
}
```

- [ ] **Step 5: `src/app/(app)/design/engagements/data.ts`** — three edits.

Add after line 7 (`import { getAll as getAllQuotes } …`):
```ts
import { all as allCustomers } from "@/lib/stores/customers";
```
Add after `VisitLite` (after line 33) and extend `ConsultingData`:
```ts
/** Serializable customer slice for the "+ New consulting project" modal (#135). */
export type CustomerLite = {
  id: string;
  name: string;
  locations: Array<{ id: string; label: string }>;
  contactNames: string[];
};
```
Inside `ConsultingData` (after `visits: VisitLite[];`, line 43):
```ts
  /** Every customer + its venues, for the manual-project modal (#135). */
  customers: CustomerLite[];
```
Replace lines 51-58 (the `Promise.all` destructure) with:
```ts
  const [engagements, quotes, designs, users, settings, visits, customerDocs] = await Promise.all([
    allEngagements(),
    getAllQuotes(),
    getAllDesigns(),
    activeUsers(),
    getSettings(),
    allVisits(),
    allCustomers(),
  ]);
```
Replace line 62 (`wanted.add(e.quoteId);`) with:
```ts
    if (e.quoteId) wanted.add(e.quoteId); // #135: manual projects have none until a proposal is attached
```
In the returned object (lines 99-106) add after `visits: visitLites,`:
```ts
    customers: customerDocs.map((c) => ({
      id: c.id,
      name: c.name,
      locations: (c.locations || [])
        .map((l) => ({ id: l.id || "", label: l.label || "Venue" }))
        .filter((l) => l.id),
      contactNames: (c.contacts || []).map((ct) => ct.name),
    })),
```

- [ ] **Step 6: `view.tsx` null-safety (compile only).** Line 186 becomes:
```ts
    (a, e) => a + feeTotals(e, (e.quoteId ? data.quotesById[e.quoteId]?.value : 0) || 0).total,
```
Line 222 becomes:
```ts
            const q = e.quoteId ? data.quotesById[e.quoteId] : undefined;
```
Line 319 becomes:
```ts
  const q = eng.quoteId ? data.quotesById[eng.quoteId] : undefined;
```
Lines 358-360 (the "Proposal / agreement" link) become:
```tsx
        {eng.quoteId && (
          <Link href={`/design/engagements/letter?id=${encodeURIComponent(eng.quoteId)}&kind=proposal`} style={{ color: "var(--accent)" }}>
            Proposal / agreement
          </Link>
        )}
```
Lines 418-423 (the "Source quote" line) become:
```tsx
            {eng.quoteId && (
              <div>
                Source quote:{" "}
                <Link href={`/design/engagements/quote?id=${encodeURIComponent(eng.quoteId)}`} style={{ color: "var(--accent)" }}>
                  {eng.quoteId}
                </Link>
              </div>
            )}
```

- [ ] **Step 7: Regression test** — in `scripts/test-review-regressions.ts` extend the line-5 import to:
```ts
import {
  allEngagements,
  attachQuoteToEngagement,
  createManualEngagement,
  ensureEngagementForQuote,
  getEngagement,
  syncEngagementsFromQuotes,
} from "@/lib/stores/engagements";
```
and insert inside `main()` immediately before the final `console.log("review regression checks passed");`:
```ts
  // #135 (D155) — a manual consulting project: created by hand, listed by
  // the hub, ignored by the sweep, and later linked to a proposal without
  // its milestones changing.
  await syncEngagementsFromQuotes(); // settle any quote-born rows first
  const manual = await createManualEngagement(
    {
      customerId: "t135-co",
      customer: "T135 School District",
      name: "T135 Auditorium study",
      architect: { company: "T135 Architects", contact: "Pat" },
      siteId: "t135-site",
      contactName: "Sam",
      fee: { mode: "fixed", amount: 8000 },
      phases: ["Assessment", "Schematic Design"],
    },
    { name: "Tester" }
  );
  assert.equal(manual.origin, "manual", "#135 manual row is stamped origin=manual");
  assert.equal(manual.quoteId, null, "#135 manual row has no quote");
  assert.equal(manual.status, "awarded", "#135 manual row is born awarded");
  assert.deepEqual(manual.milestones.map((m) => [m.name, m.amount, m.targetDate]), [["Fee", 8000, 0]], "#135 fixed fee → one unscheduled Fee milestone");
  assert.deepEqual(manual.phases.map((p) => p.name), ["Assessment", "Schematic Design"], "#135 phases come from the menu the action resolved");
  assert.deepEqual(manual.siteIds, ["t135-site"], "#135 venue link kept");
  const t135Before = (await allEngagements()).length;
  await syncEngagementsFromQuotes();
  const t135After = await allEngagements();
  assert.equal(t135After.length, t135Before, "#135 the sweep neither duplicates nor drops the manual row");
  assert.ok(t135After.some((e) => e.id === manual.id), "#135 the manual row is in the hub list");
  const t135Still = await getEngagement(manual.id);
  assert.equal(t135Still?.status, "awarded", "#135 the sweep leaves the manual row's stage alone");
  assert.equal(t135Still?.milestones.length, 1, "#135 the sweep leaves the manual row's milestones alone");
  // Attach a (draft, so the sweep has nothing to do) consulting proposal.
  await upsertDoc("quotes", { ...quote, id: "Q-t135-attach", status: "draft" } as Quote & Record<string, unknown>);
  await attachQuoteToEngagement(manual.id, "Q-t135-attach");
  const t135Attached = await getEngagement(manual.id);
  assert.equal(t135Attached?.quoteId, "Q-t135-attach", "#135 attach sets quoteId");
  assert.equal(t135Attached?.origin, "manual", "#135 attach keeps origin=manual (provenance)");
  assert.equal(t135Attached?.milestones.length, 1, "#135 attach never rewrites milestones");
  await syncEngagementsFromQuotes();
  const t135Twice = await allEngagements();
  assert.equal(t135Twice.filter((e) => e.quoteId === "Q-t135-attach").length, 1, "#135 the sweep never mints a second engagement for an attached proposal");
  assert.equal((await getEngagement(manual.id))?.status, "awarded", "#135 an awarded manual row is never demoted by the sweep");
```
(`quote`, `upsertDoc` and `Quote` are already in scope in `main()` — lines 6-7 and 39-72.)

- [ ] **Step 8: Run tests, expect pass** — `npx tsx scripts/test-review-and-spec.ts 2>&1 | grep -E '#135|ALL PASSED'` → 9 PASS + `ALL PASSED`; `npm run test:review:regressions 2>&1 | tail -4` → `review regression checks passed` (no assertion output); `npx tsc --noEmit -p . | tail -3` → empty; `npx eslint src/lib/consulting-stages.ts src/lib/stores/engagements.ts "src/app/(app)/design/engagements/data.ts" "src/app/(app)/design/engagements/view.tsx"` → clean.

- [ ] **Step 9: Commit**
```bash
git add src/lib/consulting-stages.ts src/lib/stores/engagements.ts "src/app/(app)/design/engagements/data.ts" "src/app/(app)/design/engagements/view.tsx" scripts/test-review-and-spec.ts scripts/test-review-regressions.ts
git commit -m "feat(consulting): manual engagements — origin/quoteId model, fee→milestone seeds, sweep index rule, create + attach (#135)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: "+ New consulting project" modal + "Attach proposal"

**Files:**
- Modify: `src/app/(app)/design/engagements/actions.ts:1-35` (imports), append after `setDesignIdsAction` (line 137)
- Create: `src/app/(app)/design/engagements/new-engagement-modal.tsx`
- Modify: `src/app/(app)/design/engagements/view.tsx:19-46` (imports), `:183-252` (`ConsultingList`), `:399-405` + the Links card (`OverviewTab`)
- Test: covered by Task 3's regression checks (the actions are thin, session-gated wrappers); the controller's smoke on `/design/engagements` and a browser pass creating one.

**Interfaces:**
- Consumes: `createManualEngagement`, `attachQuoteToEngagement`, `getEngagementByQuote`, `mergedConsultingPhases`, `getEngagement` (`src/lib/stores/engagements.ts`); `ManualFee` (`src/lib/consulting-stages.ts`); `get as getCustomer`, `locationsForId`, `upsert as upsertCustomer` (`src/lib/stores/customers.ts:368,661,642`); `get as getQuote` (already imported); `CUSTOMER_TYPES` (`src/app/(app)/companies/lib.ts:26`); `CustomerCombobox` (`src/components/customer-combobox.tsx`); `EntityQuickAdd`, `INPUT`, `LABEL`, `QuickAddValues` (`src/components/entity-quick-add.tsx`); `CustomerLite` (Task 3).
- Produces (`actions.ts`, `"use server"`):
```ts
createManualEngagementAction(input: { customerId: string; newCustomer?: { name: string; type: string } | null; name: string; architect?: { company: string; contact: string } | null; siteId?: string; contactName?: string; fee?: ManualFee | null }): Promise<{ ok: true; id: string } | { ok: false; error: string }>   // requirePerm("create")
attachProposalAction(engId: string, quoteId: string): Promise<{ ok: true } | { ok: false; error: string }>   // requireUser()
```
- Produces: `NewEngagementModal({ customers, onClose })` (default-less named export).

- [ ] **Step 1: Server actions.** In `src/app/(app)/design/engagements/actions.ts` change line 4 to `import { requirePerm, requireUser } from "@/lib/session";`, add to the `@/lib/stores/engagements` import (lines 5-30) the names `attachQuoteToEngagement, createManualEngagement, getEngagementByQuote, mergedConsultingPhases`, change line 31 to:
```ts
import { ENGAGEMENT_STAGE_KEYS, type ManualFee } from "@/lib/consulting-stages";
```
and add after line 35:
```ts
import { get as getCustomer, locationsForId, upsert as upsertCustomer } from "@/lib/stores/customers";
import { CUSTOMER_TYPES } from "@/app/(app)/companies/lib";
```
Append after `setDesignIdsAction` (after line 137, before `/* ---------- phases ---------- */`):
```ts
/* ---------- manual projects (#135, D155) ---------- */

/** Server-side shape check for a hand-entered fee — the modal only ever
 *  posts one of the two modes, but actions are public endpoints. */
function cleanFee(raw: ManualFee | null | undefined): ManualFee | null {
  if (!raw || typeof raw !== "object") return null;
  if (raw.mode === "fixed") {
    return { mode: "fixed", amount: Math.max(0, Math.round(Number(raw.amount) || 0)) };
  }
  if (raw.mode === "milestones") {
    const milestones = (Array.isArray(raw.milestones) ? raw.milestones : [])
      .slice(0, 20)
      .map((m) => ({
        name: String(m?.name || "").trim().slice(0, 120),
        targetDate: Math.max(0, Math.round(Number(m?.targetDate) || 0)),
        amount: Math.max(0, Math.round(Number(m?.amount) || 0)),
      }));
    return { mode: "milestones", milestones };
  }
  return null;
}

/** "+ New consulting project" (#135): a project that skipped the fee
 *  proposal. Picks an existing customer or quick-adds one, checks the venue
 *  belongs to that customer, resolves the phase menu from Settings, and
 *  creates the engagement `awarded` with `origin: "manual"`. */
export async function createManualEngagementAction(input: {
  customerId: string;
  newCustomer?: { name: string; type: string } | null;
  name: string;
  architect?: { company: string; contact: string } | null;
  siteId?: string;
  contactName?: string;
  fee?: ManualFee | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const me = await requirePerm("create");
  const name = String(input?.name || "").trim().slice(0, 160);
  if (!name) return { ok: false, error: "Name the project." };

  let customerId = String(input?.customerId || "").trim();
  let customerName = "";
  const fresh = input?.newCustomer;
  if (fresh && String(fresh.name || "").trim()) {
    const type = (CUSTOMER_TYPES as readonly string[]).includes(fresh.type) ? fresh.type : "";
    customerId = "c" + Date.now(); // the saveCustomerAction id convention
    customerName = String(fresh.name).trim().slice(0, 160);
    await upsertCustomer({ id: customerId, name: customerName, type });
  } else {
    const c = await getCustomer(customerId);
    if (!c) return { ok: false, error: "Pick a customer or add a new one." };
    customerName = c.name;
  }

  let siteId: string | null = String(input?.siteId || "").trim() || null;
  if (siteId) {
    const locs = (await locationsForId(customerId)) || [];
    if (!locs.some((l) => l.id === siteId)) siteId = null; // never link a venue that isn't the customer's
  }

  const settings = await getSettings();
  const eng = await createManualEngagement(
    {
      customerId,
      customer: customerName,
      name,
      architect: {
        company: String(input?.architect?.company || "").trim().slice(0, 120),
        contact: String(input?.architect?.contact || "").trim().slice(0, 120),
      },
      siteId,
      contactName: String(input?.contactName || "").trim().slice(0, 120),
      fee: cleanFee(input?.fee),
      phases: mergedConsultingPhases(settings.consultingPhases),
    },
    me
  );
  revalidatePath("/", "layout");
  return { ok: true, id: eng.id };
}

/** "Attach proposal" on a manual project (#135): links an existing consulting
 *  quote by id. Milestones are untouched; the quote must exist, be a
 *  consulting quote, and not already belong to another engagement. */
export async function attachProposalAction(
  engId: string,
  quoteId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireUser();
  const clean = String(quoteId || "").trim();
  if (!clean) return { ok: false, error: "Enter the consulting quote id (Q-…)." };
  const eng = await getEngagement(engId);
  if (!eng) return { ok: false, error: "Engagement not found." };
  if (eng.quoteId) return { ok: false, error: `This engagement already has proposal ${eng.quoteId}.` };
  const q = await getQuote(clean);
  if (!q) return { ok: false, error: `No quote ${clean} exists.` };
  if (q.quoteType !== "consulting") {
    return { ok: false, error: "That is not a consulting quote — attach the fee proposal, not an install quote." };
  }
  const owner = await getEngagementByQuote(clean);
  if (owner && owner.id !== engId) return { ok: false, error: `${clean} already belongs to ${owner.id}.` };
  await attachQuoteToEngagement(engId, clean);
  return done();
}
```

- [ ] **Step 2: The modal.** Create `src/app/(app)/design/engagements/new-engagement-modal.tsx`:
```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CustomerCombobox } from "@/components/customer-combobox";
import EntityQuickAdd, { INPUT, LABEL, type QuickAddValues } from "@/components/entity-quick-add";
import { CUSTOMER_TYPES } from "@/app/(app)/companies/lib";
import type { ManualFee } from "@/lib/consulting-stages";
import type { CustomerLite } from "./data";
import { createManualEngagementAction } from "./actions";

/**
 * "+ New consulting project" (#135) — the hub's way to open an engagement
 * that never had a fee proposal. Customer pick (or quick-add), name,
 * architect, venue, optional fee (fixed or milestone rows). Same scrim +
 * card idiom as the Settings location modal; no window.confirm/prompt.
 */

type FeeMode = "none" | "fixed" | "milestones";
type MilestoneRow = { name: string; date: string; amount: string };

const SMALL_BTN: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  fontWeight: 600,
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "6px 11px",
  background: "#fff",
  color: "#3a3f4a",
  cursor: "pointer",
};

const SEG: React.CSSProperties = { ...SMALL_BTN, borderRadius: 7 };
const SEG_ON: React.CSSProperties = { ...SEG, background: "#16181d", color: "#fff", borderColor: "#16181d" };

const blankRow = (): MilestoneRow => ({ name: "", date: "", amount: "" });

export function NewEngagementModal({
  customers,
  onClose,
}: {
  customers: CustomerLite[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const [newCustomer, setNewCustomer] = useState<QuickAddValues["customer"]>({ name: "", type: CUSTOMER_TYPES[0] });
  const [name, setName] = useState("");
  const [architectCompany, setArchitectCompany] = useState("");
  const [architectContact, setArchitectContact] = useState("");
  const [siteId, setSiteId] = useState("");
  const [contactName, setContactName] = useState("");
  const [feeMode, setFeeMode] = useState<FeeMode>("none");
  const [fixedAmount, setFixedAmount] = useState("");
  const [rows, setRows] = useState<MilestoneRow[]>([blankRow()]);

  const customer = customers.find((c) => c.id === customerId) || null;
  const hasCustomer = newCustomerOpen ? !!newCustomer.name.trim() : !!customerId;
  const canSubmit = !pending && !!name.trim() && hasCustomer;

  const fee = (): ManualFee | null => {
    if (feeMode === "fixed") return { mode: "fixed", amount: Number(fixedAmount) || 0 };
    if (feeMode === "milestones") {
      return {
        mode: "milestones",
        milestones: rows.map((r) => ({
          name: r.name.trim(),
          targetDate: r.date ? new Date(r.date + "T12:00:00").getTime() : 0,
          amount: Number(r.amount) || 0,
        })),
      };
    }
    return null;
  };

  const submit = () =>
    start(async () => {
      setError(null);
      const r = await createManualEngagementAction({
        customerId: newCustomerOpen ? "" : customerId,
        newCustomer: newCustomerOpen ? newCustomer : null,
        name,
        architect: { company: architectCompany, contact: architectContact },
        siteId: newCustomerOpen ? "" : siteId,
        contactName,
        fee: fee(),
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onClose();
      router.push(`/design/engagements/${encodeURIComponent(r.id)}`);
      router.refresh();
    });

  const patchRow = (i: number, p: Partial<MilestoneRow>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...p } : r)));

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(16,22,30,.46)", display: "flex", alignItems: "center", justifyContent: "center", padding: 28, zIndex: 60 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="New consulting project"
        style={{ width: 560, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto", background: "#fff", borderRadius: 15, boxShadow: "0 24px 70px rgba(0,0,0,.32)" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "17px 22px", borderBottom: "1px solid #f0f1f4" }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>New consulting project</span>
          <button type="button" onClick={onClose} aria-label="Close" style={{ ...SMALL_BTN, padding: "4px 9px" }}>×</button>
        </div>

        <div style={{ padding: "4px 22px 18px" }}>
          <label style={LABEL}>Customer</label>
          {newCustomerOpen ? (
            <>
              <EntityQuickAdd kind="customer" value={newCustomer} onChange={setNewCustomer} />
              <button
                type="button"
                onClick={() => setNewCustomerOpen(false)}
                style={{ background: "none", border: "none", padding: 0, marginTop: 6, color: "#8c919c", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
              >
                Pick an existing customer instead
              </button>
            </>
          ) : (
            <>
              <CustomerCombobox
                options={customers.map((c) => ({
                  id: c.id,
                  name: c.name,
                  detail: c.locations.length ? c.locations.map((l) => l.label).slice(0, 3).join(" · ") : "No venues on file",
                  searchText: [...c.locations.map((l) => l.label), ...c.contactNames].join(" "),
                }))}
                value={customerId}
                onChange={(id) => { setCustomerId(id); setSiteId(""); }}
                placeholder="Search customers…"
                inputStyle={INPUT}
              />
              <button
                type="button"
                onClick={() => setNewCustomerOpen(true)}
                style={{ background: "none", border: "none", padding: 0, marginTop: 6, color: "var(--accent)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
              >
                + Add a new customer
              </button>
            </>
          )}

          <label style={LABEL}>Project name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={customer ? `${customer.name} — Consulting` : "e.g. Auditorium renovation study"} style={INPUT} />

          {!newCustomerOpen && customer && customer.locations.length > 0 && (
            <>
              <label style={LABEL}>Venue</label>
              <select value={siteId} onChange={(e) => setSiteId(e.target.value)} style={INPUT}>
                <option value="">— none —</option>
                {customer.locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.label}</option>
                ))}
              </select>
            </>
          )}

          <label style={LABEL}>Architect</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <input value={architectCompany} onChange={(e) => setArchitectCompany(e.target.value)} placeholder="Architecture firm" style={INPUT} />
            <input value={architectContact} onChange={(e) => setArchitectContact(e.target.value)} placeholder="Contact (name / email)" style={INPUT} />
          </div>

          <label style={LABEL}>Customer contact</label>
          <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Name (optional)" style={INPUT} list="ne-contacts" />
          {customer && customer.contactNames.length > 0 && (
            <datalist id="ne-contacts">
              {customer.contactNames.map((n) => <option key={n} value={n} />)}
            </datalist>
          )}

          <label style={LABEL}>Fee</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {([["none", "No fee yet"], ["fixed", "Fixed fee"], ["milestones", "Milestones"]] as Array<[FeeMode, string]>).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setFeeMode(k)} style={feeMode === k ? SEG_ON : SEG}>{l}</button>
            ))}
          </div>
          {feeMode === "fixed" && (
            <input
              value={fixedAmount}
              onChange={(e) => setFixedAmount(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="$ amount"
              inputMode="numeric"
              style={{ ...INPUT, marginTop: 8, maxWidth: 200 }}
            />
          )}
          {feeMode === "milestones" && (
            <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
              {rows.map((r, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 150px 110px 30px", gap: 6, alignItems: "center" }}>
                  <input value={r.name} onChange={(e) => patchRow(i, { name: e.target.value })} placeholder="Milestone name" style={INPUT} />
                  <input type="date" value={r.date} onChange={(e) => patchRow(i, { date: e.target.value })} style={INPUT} />
                  <input value={r.amount} onChange={(e) => patchRow(i, { amount: e.target.value.replace(/[^\d]/g, "") })} placeholder="$" inputMode="numeric" style={INPUT} />
                  <button type="button" aria-label="Remove milestone" onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))} style={{ ...SMALL_BTN, padding: "6px 0", textAlign: "center" }}>×</button>
                </div>
              ))}
              <button type="button" onClick={() => setRows((rs) => [...rs, blankRow()])} style={{ ...SMALL_BTN, justifySelf: "start" }}>
                + Add milestone
              </button>
            </div>
          )}
          <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 8 }}>
            A fee proposal can be attached later from the engagement page; the project opens at Awarded.
          </div>

          {error && (
            <div style={{ marginTop: 12, background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 9, padding: "9px 12px", fontSize: 12.5, color: "#b4543a" }}>
              {error}
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "14px 22px", borderTop: "1px solid #f0f1f4" }}>
          <button type="button" onClick={onClose} style={SMALL_BTN}>Cancel</button>
          <button
            type="button"
            className="pk-btn-accent"
            disabled={!canSubmit}
            onClick={submit}
            style={{ opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? "pointer" : "default" }}
          >
            {pending ? "Creating…" : "Create project"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Hub wiring in `view.tsx`.**

(a) Imports — add `attachProposalAction,` to the `./actions` import list (lines 19-44, alphabetical, after `addSubmittalAction,`) and add after line 47 (`import { money } …`):
```ts
import { NewEngagementModal } from "./new-engagement-modal";
```

(b) `ConsultingList` — add state as the first line of the function body (after line 183):
```ts
  const [creating, setCreating] = useState(false);
```
Replace the `<PageHeader … />` (lines 195-198) with:
```tsx
      <PageHeader
        title="Consulting"
        sub="Consulting — Peak as the paid specifier. Sending the proposal opens the record at Proposal sent; any stage before Closed counts as active."
        actions={
          <button type="button" className="pk-btn-accent" onClick={() => setCreating(true)}>
            + New consulting project
          </button>
        }
      />
      {creating && <NewEngagementModal customers={data.customers} onClose={() => setCreating(false)} />}
```
Replace the empty-state `sub` (lines 212-215) with:
```tsx
              <>
                Start with a <Link href="/design/engagements/quote" style={{ color: "var(--accent)" }}>consulting quote</Link> — sending
                the proposal opens the engagement here at Proposal sent; winning advances it to Awarded. A project that
                skipped the proposal goes in through + New consulting project above.
              </>
```
In the card header row (lines 229-232) add the provenance pill after the `StatusPill`:
```tsx
                    {e.origin === "manual" && <Pill color="#8a6d1f">Manual</Pill>}
```

(c) `OverviewTab` — add state after line 402 (`const [linkErr, …]`):
```ts
  const [proposal, setProposal] = useState("");
  const [proposalErr, setProposalErr] = useState<string | null>(null);
```
Replace the `{eng.quoteId && (<div>Source quote: …</div>)}` block written in Task 3 with:
```tsx
            {eng.quoteId ? (
              <div>
                Source quote:{" "}
                <Link href={`/design/engagements/quote?id=${encodeURIComponent(eng.quoteId)}`} style={{ color: "var(--accent)" }}>
                  {eng.quoteId}
                </Link>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span>Proposal:</span>
                <input
                  value={proposal}
                  onChange={(e) => setProposal(e.target.value)}
                  placeholder="Q-…"
                  aria-label="Consulting quote id"
                  style={{ ...INPUT, width: 110, padding: "4px 8px", fontSize: 12 }}
                />
                <button
                  style={SMALL_BTN}
                  onClick={async () => {
                    setProposalErr(null);
                    const r = await attachProposalAction(eng.id, proposal.trim());
                    if (!r.ok) {
                      setProposalErr(r.error);
                      return;
                    }
                    router.refresh();
                  }}
                >
                  Attach proposal
                </button>
                <span style={{ fontSize: 11, color: "#9aa0ab" }}>
                  Added manually — link the consulting quote once one exists; milestones stay as entered.
                </span>
              </div>
            )}
            {proposalErr && <div style={{ fontSize: 11.5, color: "#a0442b" }}>{proposalErr}</div>}
```

- [ ] **Step 4: Verify** — `npx tsc --noEmit -p . | tail -3` → empty; `npx eslint "src/app/(app)/design/engagements"` → clean; `npm run test:review:regressions 2>&1 | tail -3` → passes; `npx tsx scripts/test-review-and-spec.ts | grep -E 'FAIL|ALL PASSED'` → `ALL PASSED`. The controller runs `npm run test:smoke` (`/design/engagements`, `/design/engagements/CE-1001`) and the browser pass: open `/design/engagements` → "+ New consulting project" → pick a customer, name it, choose "Fixed fee" 8000 → Create → lands on the new CE page showing "Manual" and one "Fee" milestone; on its Overview, "Attach proposal" with a bogus id shows the error, with a real consulting quote id links it.

- [ ] **Step 5: Commit**
```bash
git add "src/app/(app)/design/engagements/actions.ts" "src/app/(app)/design/engagements/new-engagement-modal.tsx" "src/app/(app)/design/engagements/view.tsx"
git commit -m "feat(consulting): + New consulting project modal and Attach proposal on manual engagements (#135)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## #121 — Search bars: filters on the search row, results inline

### Task 5: `SearchFilterBar`, `Typeahead<T>` and the pure ranking helper

**Files:**
- Create: `src/lib/search/typeahead-rank.ts`
- Create: `src/components/search/search-filter-bar.tsx`
- Create: `src/components/search/typeahead.tsx`
- Modify: `src/app/globals.css` (append after `.pk-field-label`, line 606)
- Test: `scripts/test-review-and-spec.ts` (section "#121 typeahead ranking")

**Interfaces:**
- Produces (`src/lib/search/typeahead-rank.ts`, pure, no imports):
```ts
export function typeaheadMatches<T>(q: string, items: readonly T[], filter: (q: string, item: T) => boolean, rank?: (q: string, item: T) => number, max?: number): T[];
export type CatalogLike = { sku: string; desc: string; mfr?: string | null; category?: string | null };
export function catalogFilter(q: string, p: CatalogLike): boolean;   // every whitespace token found in sku/desc/mfr/category; empty q → true
export function catalogRank(q: string, p: CatalogLike): number;      // 0 = SKU starts with q, 1 = description contains q, 2 = matched elsewhere
export function catalogMatches<T extends CatalogLike>(q: string, parts: readonly T[], max?: number): T[];
```
- Produces (`search-filter-bar.tsx`, no `"use client"` — stateless, so a client filter bar drives it with `value`/`onChange` and a server GET form with `name`/`defaultValue`):
```ts
export function SearchFilterBar(props: { value?: string; onChange?: (v: string) => void; name?: string; defaultValue?: string; placeholder?: string; ariaLabel?: string; submit?: boolean; children?: ReactNode; style?: CSSProperties }): JSX.Element;
```
- Produces (`typeahead.tsx`, `"use client"`):
```ts
export type TypeaheadProps<T> = {
  items: T[]; keyOf: (item: T) => string;
  filter: (q: string, item: T) => boolean; rank?: (q: string, item: T) => number;
  render: (item: T, active: boolean) => ReactNode; onPick: (item: T) => void;
  labelOf?: (item: T) => string;        // text left in the box after a pick; omit → the box clears (add-another pickers)
  selectedKey?: string | null;          // controlled selection; when it changes the box re-syncs to labelOf(item) or clears
  stayOpen?: boolean;                   // multi-pick lists keep the results open after a pick
  max?: number;                         // default 8
  placeholder?: string; ariaLabel?: string; inputStyle?: CSSProperties; emptyText?: string;
};
export function Typeahead<T>(props: TypeaheadProps<T>): JSX.Element;
```
- CSS classes: `.pk-searchbar`, `.pk-searchbar-box`, `.pk-searchbar-glass`, `.pk-searchbar-select`, `.pk-searchbar-group`.

- [ ] **Step 1: Failing spec tests** — insert immediately before `async function asyncChecks(): Promise<void> {`:
```ts
/* --- #121 typeahead ranking: SKU prefix first, then description contains, then anywhere --- */
import { catalogFilter, catalogMatches, catalogRank, typeaheadMatches } from "@/lib/search/typeahead-rank";

const t121 = [
  { sku: "S4LED-S3", desc: "Source Four LED Series 3", mfr: "ETC", category: "Fixtures" },
  { sku: "LENS-26", desc: "26° lens tube for S4LED", mfr: "ETC", category: "Fixtures" },
  { sku: "CLAMP-1", desc: "Pipe clamp", mfr: "The Light Source", category: "Hardware" },
  { sku: "ZZ-1", desc: "Speaker bracket", mfr: "S4LED Mounts Co", category: "Speakers" },
];
ok(catalogMatches("s4led", t121).map((p) => p.sku).join(",") === "S4LED-S3,LENS-26,ZZ-1",
  "#121: SKU prefix first, then description contains, then a match anywhere (case-insensitive)");
ok(catalogMatches("etc lens", t121).map((p) => p.sku).join(",") === "LENS-26",
  "#121: every whitespace token must match somewhere in sku/desc/mfr/category");
ok(catalogMatches("", t121).length === 4 && catalogMatches("", t121, 2).length === 2,
  "#121: an empty query lists items in their given order, capped at max");
ok(catalogMatches("nomatch", t121).length === 0, "#121: no hits → empty list");
ok(catalogRank("S4LED", t121[0]) === 0 && catalogRank("S4LED", t121[1]) === 1 && catalogRank("S4LED", t121[3]) === 2,
  "#121: catalogRank tiers are 0/1/2");
ok(catalogFilter("", t121[2]) && !catalogFilter("etc", t121[2]) && catalogFilter("light source", t121[2]),
  "#121: catalogFilter — empty passes everything, tokens are AND-ed across fields");
ok(typeaheadMatches("b", ["b1", "a", "b2"], (q, s) => s.startsWith(q), undefined, 8).join(",") === "b1,b2",
  "#121: typeaheadMatches without a rank keeps input order");
ok(typeaheadMatches("x", ["x3", "x1", "x2"], () => true, (_q, s) => Number(s.slice(1)), 2).join(",") === "x1,x2",
  "#121: a rank sorts ascending (stable) and max slices after ranking");
```

- [ ] **Step 2: Run, expect failure** — `npx tsx scripts/test-review-and-spec.ts 2>&1 | head -5` → cannot find module `@/lib/search/typeahead-rank`.

- [ ] **Step 3: `src/lib/search/typeahead-rank.ts`**
```ts
/**
 * #121 — pure filter/rank helpers behind the shared Typeahead. No imports:
 * the spec harness runs this DB-free, and the Typeahead is a client
 * component that must not drag anything heavier into the browser bundle.
 */

/** Filter, optionally rank (ascending, stable), then cap. `q` is trimmed. */
export function typeaheadMatches<T>(
  q: string,
  items: readonly T[],
  filter: (q: string, item: T) => boolean,
  rank?: (q: string, item: T) => number,
  max = 8
): T[] {
  const query = q.trim();
  const hits = items.filter((item) => filter(query, item));
  if (!rank) return hits.slice(0, max);
  return hits
    .map((item, i) => ({ item, i, r: rank(query, item) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, max)
    .map((x) => x.item);
}

/** The slice of a catalog part the catalog pickers search over. */
export type CatalogLike = {
  sku: string;
  desc: string;
  mfr?: string | null;
  category?: string | null;
};

function haystack(p: CatalogLike): string {
  return `${p.sku} ${p.desc} ${p.mfr || ""} ${p.category || ""}`.toLowerCase();
}

/** Every whitespace-separated token must appear somewhere in
 *  sku/desc/mfr/category (the Subassemblies picker's rule, kept). Empty → all. */
export function catalogFilter(q: string, p: CatalogLike): boolean {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const hay = haystack(p);
  return tokens.every((t) => hay.includes(t));
}

/** 0 = the SKU starts with the query, 1 = the description contains it,
 *  2 = it matched somewhere else (manufacturer / category / tokens). */
export function catalogRank(q: string, p: CatalogLike): number {
  const s = q.trim().toLowerCase();
  if (!s) return 2;
  if (p.sku.toLowerCase().startsWith(s)) return 0;
  if (p.desc.toLowerCase().includes(s)) return 1;
  return 2;
}

export function catalogMatches<T extends CatalogLike>(
  q: string,
  parts: readonly T[],
  max = 8
): T[] {
  return typeaheadMatches(q, parts, catalogFilter, catalogRank, max);
}
```

- [ ] **Step 4: CSS** — append to `src/app/globals.css` after `.pk-field-label { … }` (line 606):
```css

/* ============ Search bars (#121) ============ */
/* One row: the box grows, filters ride beside it at the same 36px height,
   everything wraps under 560px. Used by SearchFilterBar (components/search). */
.pk-searchbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.pk-searchbar-box {
  flex: 1 1 220px;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 9px;
  height: 36px;
  box-sizing: border-box;
  padding: 0 12px;
  background: #fff;
  border: 1px solid #e4e7ec;
  border-radius: 9px;
}
.pk-searchbar-box:focus-within {
  border-color: var(--accent);
}
.pk-searchbar-box input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  font-family: var(--font-ui);
  font-size: 13.5px;
  color: #16181d;
  outline: none;
}
.pk-searchbar-glass {
  width: 14px;
  height: 14px;
  border: 1.7px solid #aab0bb;
  border-radius: 50%;
  flex-shrink: 0;
  position: relative;
}
button.pk-searchbar-glass {
  background: transparent;
  padding: 0;
  cursor: pointer;
}
.pk-searchbar-glass::after {
  content: "";
  position: absolute;
  right: -3px;
  bottom: -3px;
  width: 6px;
  height: 1.7px;
  background: #aab0bb;
  transform: rotate(45deg);
}
.pk-searchbar-select {
  height: 36px;
  box-sizing: border-box;
  font-family: var(--font-ui);
  font-size: 12.5px;
  font-weight: 600;
  color: #3a3f4a;
  background: #fff;
  border: 1px solid #e4e7ec;
  border-radius: 9px;
  padding: 0 10px;
  cursor: pointer;
}
.pk-searchbar-group {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}
@media (max-width: 560px) {
  .pk-searchbar > * {
    flex-basis: 100%;
  }
}
```

- [ ] **Step 5: `src/components/search/search-filter-bar.tsx`**
```tsx
import type { CSSProperties, ReactNode } from "react";

/**
 * #121 — the one search row. The box grows, the filters passed as children
 * (selects with className="pk-searchbar-select", or a .pk-searchbar-group of
 * toggle buttons) sit beside it at the same 36px height, and the row wraps
 * under 560px (globals.css `.pk-searchbar*`).
 *
 * Deliberately NOT "use client" and stateless: a client filter bar drives it
 * with value/onChange; a server-rendered GET <form> (Venues) uses
 * name/defaultValue and `submit` so the magnifier is the form's submit
 * button — a form holding two text inputs and no submit button never
 * submits on Enter.
 */
export function SearchFilterBar({
  value,
  onChange,
  name,
  defaultValue,
  placeholder = "Search…",
  ariaLabel = "Search",
  submit = false,
  children,
  style,
}: {
  value?: string;
  onChange?: (v: string) => void;
  /** Uncontrolled mode for a GET <form>: the input's name + initial value. */
  name?: string;
  defaultValue?: string;
  placeholder?: string;
  ariaLabel?: string;
  /** Render the magnifier as a submit button (GET forms). */
  submit?: boolean;
  children?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div className="pk-searchbar" style={style}>
      <div className="pk-searchbar-box">
        {submit ? (
          <button type="submit" aria-label={ariaLabel} className="pk-searchbar-glass" />
        ) : (
          <span className="pk-searchbar-glass" aria-hidden />
        )}
        {onChange ? (
          <input
            type="text"
            name={name}
            aria-label={ariaLabel}
            placeholder={placeholder}
            autoComplete="off"
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <input
            type="text"
            name={name}
            aria-label={ariaLabel}
            placeholder={placeholder}
            autoComplete="off"
            defaultValue={defaultValue}
          />
        )}
      </div>
      {children}
    </div>
  );
}
```

- [ ] **Step 6: `src/components/search/typeahead.tsx`** (modelled on `src/components/customer-combobox.tsx` — same listbox, keyboard and outside-click behaviour, generic over `T`):
```tsx
"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { typeaheadMatches } from "@/lib/search/typeahead-rank";

/**
 * #121 — input + results rendered directly under it while typing: no
 * separate dropdown to open. Max 8 rows, ArrowUp/ArrowDown/Enter/Escape,
 * role=combobox/listbox/option. Generic over the item type; pass MODULE-LEVEL
 * filter/rank functions (stable identity) so the memo below is not recomputed
 * on every render of the parent.
 */
export type TypeaheadProps<T> = {
  items: T[];
  keyOf: (item: T) => string;
  filter: (q: string, item: T) => boolean;
  rank?: (q: string, item: T) => number;
  render: (item: T, active: boolean) => ReactNode;
  onPick: (item: T) => void;
  /** Text left in the box after a pick. Omit → the box clears (add-another pickers). */
  labelOf?: (item: T) => string;
  /** Controlled selection: when it changes the box re-syncs to labelOf(item), or clears. */
  selectedKey?: string | null;
  /** Multi-pick lists keep the results open after a pick. */
  stayOpen?: boolean;
  max?: number;
  placeholder?: string;
  ariaLabel?: string;
  inputStyle?: CSSProperties;
  emptyText?: string;
};

export function Typeahead<T>({
  items,
  keyOf,
  filter,
  rank,
  render,
  onPick,
  labelOf,
  selectedKey,
  stayOpen = false,
  max = 8,
  placeholder = "Search…",
  ariaLabel,
  inputStyle,
  emptyText = "Nothing matches.",
}: TypeaheadProps<T>) {
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const key = selectedKey ?? "";
  const selected = key ? items.find((i) => keyOf(i) === key) ?? null : null;
  const textFor = (item: T | null) => (item && labelOf ? labelOf(item) : "");
  const [query, setQuery] = useState(textFor(selected));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  // Re-sync the box when the controlled selection changes (derived-state
  // reset during render — the repo's no-setState-in-effect idiom).
  const [prevKey, setPrevKey] = useState(key);
  if (key !== prevKey) {
    setPrevKey(key);
    setQuery(textFor(selected));
  }

  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const matches = useMemo(
    () => typeaheadMatches(query, items, filter, rank, max),
    [query, items, filter, rank, max]
  );

  const pick = (item: T) => {
    onPick(item);
    setQuery(labelOf ? labelOf(item) : "");
    if (!stayOpen) setOpen(false);
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <input
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        autoComplete="off"
        value={query}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, Math.max(0, matches.length - 1)));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(0, i - 1));
          } else if (e.key === "Enter" && open && matches[active]) {
            e.preventDefault();
            pick(matches[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        style={inputStyle}
      />
      {open && (
        <div
          id={listId}
          role="listbox"
          style={{
            position: "absolute",
            zIndex: 80,
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            maxHeight: 8 * 38,
            overflowY: "auto",
            background: "#fff",
            border: "1px solid #dfe2e8",
            borderRadius: 10,
            boxShadow: "0 14px 36px rgba(20,24,32,.14)",
            padding: 4,
          }}
        >
          {matches.map((item, i) => (
            <button
              key={keyOf(item)}
              type="button"
              role="option"
              aria-selected={keyOf(item) === key}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(item)}
              style={{
                width: "100%",
                border: 0,
                borderRadius: 7,
                padding: "7px 9px",
                textAlign: "left",
                fontFamily: "var(--font-ui)",
                cursor: "pointer",
                color: "#16181d",
                background: i === active ? "var(--accent-soft)" : "transparent",
              }}
            >
              {render(item, i === active)}
            </button>
          ))}
          {matches.length === 0 && (
            <div style={{ padding: "9px 10px", fontSize: 12, color: "#8c919c" }}>{emptyText}</div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Run tests, expect pass** — `npx tsx scripts/test-review-and-spec.ts 2>&1 | grep -E '#121|ALL PASSED'` → 8 PASS + `ALL PASSED`; `npx tsc --noEmit -p . | tail -3` → empty; `npx eslint src/lib/search src/components/search` → clean.

- [ ] **Step 8: Commit**
```bash
git add src/lib/search/typeahead-rank.ts src/components/search/search-filter-bar.tsx src/components/search/typeahead.tsx src/app/globals.css scripts/test-review-and-spec.ts
git commit -m "feat(search): shared SearchFilterBar + Typeahead with pure catalog ranking (#121)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Adopt `Typeahead` on the Subassemblies part picker and the Assembly Builder

**Files:**
- Modify: `src/app/(app)/design/subassemblies/subassemblies-client.tsx:1-36` (imports + `PartPicker`), `:88` (the "Add compatible item" call)
- Modify: `src/app/(app)/design/assemblies/page.tsx` (whole file), `src/app/(app)/design/assemblies/actions.ts` (drop `searchAssemblyCatalogAction`), `src/app/(app)/design/assemblies/assembly-builder.tsx` (whole file)
- Test: `npx tsc`; controller smoke `/design/subassemblies`, `/design/assemblies`; browser pass on Subassemblies (the spec's named pass).

**Interfaces:**
- Consumes: `Typeahead` (Task 5), `catalogFilter`/`catalogRank` (Task 5), `CatalogPart` (`src/lib/stores/catalog.ts:21`), `list as listCatalog` (`src/lib/stores/catalog.ts:79`), `saveFixtureAssembliesAction` (kept).
- Produces: `assembly-builder.tsx` exports `type Hit = { sku: string; desc: string; category: string; mfr: string; list: number }` and `AssemblyBuilder({ initial, parts })`.

- [ ] **Step 1: Subassemblies `PartPicker`.** In `subassemblies-client.tsx` add after line 7:
```ts
import { Typeahead } from "@/components/search/typeahead";
import { catalogFilter, catalogRank } from "@/lib/search/typeahead-rank";
```
Replace lines 17-36 (the whole `PartPicker` function) with:
```tsx
const partKey = (p: CatalogPart) => p.sku;
const partLabel = (p: CatalogPart) => `${p.desc} · ${p.sku}`;

/** One results row — SKU · description · manufacturer · list price (#121). */
function PartRow({ part }: { part: CatalogPart }) {
  return (
    <span style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12.5 }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#5b616e", flexShrink: 0 }}>{part.sku}</span>
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{part.desc}</span>
      <span style={{ fontSize: 11.5, color: "#8c919c", flexShrink: 0 }}>{part.mfr || "—"} · {money(part.list)}</span>
    </span>
  );
}

/** Catalog part picker (#121): results list inline under the box while you
 *  type — no <select> to open. `clearOnPick` is the add-another mode used by
 *  the compatible-options lists. */
function PartPicker({ label, parts, value, onChange, clearOnPick = false }: { label: string; parts: CatalogPart[]; value: string; onChange: (sku: string) => void; clearOnPick?: boolean }) {
  const selected = parts.find((p) => p.sku === value) || null;
  return (
    <div>
      <label style={LABEL}>{label}</label>
      <Typeahead
        items={parts}
        keyOf={partKey}
        filter={catalogFilter}
        rank={catalogRank}
        render={(p) => <PartRow part={p} />}
        onPick={(p) => onChange(p.sku)}
        labelOf={clearOnPick ? undefined : partLabel}
        selectedKey={clearOnPick ? null : value}
        placeholder="Search name, manufacturer, or part #"
        ariaLabel={label}
        inputStyle={FIELD}
      />
      {selected && <div style={{ color: "#6b7079", fontSize: 11.5, marginTop: 5 }}>{selected.mfr || "Unspecified manufacturer"} · cost {money(selected.cost)}</div>}
    </div>
  );
}
```
On line 88 change `<PartPicker label="Add compatible item" parts={parts} value="" onChange={…} />` to pass `clearOnPick`:
```tsx
              <PartPicker label="Add compatible item" parts={parts} value="" clearOnPick onChange={(sku) => { if (!sku) return; const part = parts.find((p) => p.sku === sku); if (!part) return; setOptions((all) => ({ ...all, [key]: [...all[key], { sku, qty: 1 }] })); }} />
```
(`useMemo` is now unused in this file — remove it from the React import on line 3: `import { useState } from "react";`.)

- [ ] **Step 2: Assembly Builder — page + actions.** Replace `src/app/(app)/design/assemblies/page.tsx` with:
```tsx
import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { list as listCatalog } from "@/lib/stores/catalog";
import AssemblyBuilder, { type Hit } from "./assembly-builder";

export const metadata = { title: "Assembly Builder — Quartzite-6" };

export default async function AssemblyBuilderPage() {
  await requireUser();
  const [settings, catalog] = await Promise.all([getSettings(), listCatalog()]);
  // #121: the component picker filters in the browser (Typeahead) — ship
  // only the slice it renders (never cost), the Subassemblies page's idiom.
  const parts: Hit[] = catalog.map((p) => ({
    sku: p.sku,
    desc: p.desc,
    category: p.category,
    mfr: p.mfr || "",
    list: p.list,
  }));
  return <AssemblyBuilder initial={settings.fixtureAssemblies || []} parts={parts} />;
}
```
In `src/app/(app)/design/assemblies/actions.ts` delete `searchAssemblyCatalogAction` (lines 18-27) and the now-unused import on line 6 (`import { list as catalogList } …`). The file keeps only `saveFixtureAssembliesAction`.

- [ ] **Step 3: Assembly Builder — component.** Replace `src/app/(app)/design/assemblies/assembly-builder.tsx` with:
```tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  ASSEMBLY_ROLES,
  type AssemblyRole,
  type FixtureAssembly,
  type FixtureAssemblyComponent,
} from "@/lib/fixture-assemblies";
import { Typeahead } from "@/components/search/typeahead";
import { catalogFilter, catalogRank } from "@/lib/search/typeahead-rank";
import { saveFixtureAssembliesAction } from "./actions";

/** The catalog slice the picker searches and shows (#121) — no cost. */
export type Hit = { sku: string; desc: string; category: string; mfr: string; list: number };

const input: React.CSSProperties = { width: "100%", border: "1px solid #dfe2e8", borderRadius: 8, padding: "9px 10px", font: "inherit" };
const hitKey = (h: Hit) => h.sku;

/** Section = one role, picked via its own typeahead. Light engine/lens are
 *  exclusive (one pick replaces the last); everything else stacks, and the
 *  results stay open after a pick so a tech can build a whole fixture's
 *  cabling/hardware without re-searching between picks. */
const ROLE_SECTIONS: { role: AssemblyRole; label: string; multi: boolean }[] = [
  { role: "fixture", label: "Light engine", multi: false },
  { role: "lens", label: "Lens", multi: false },
  { role: "power", label: "Power cable", multi: true },
  { role: "data", label: "Data cable", multi: true },
  { role: "accessory", label: "Accessories", multi: true },
  { role: "mount", label: "Clamps", multi: true },
  { role: "cable", label: "Safety cable", multi: true },
];

export default function AssemblyBuilder({ initial, parts }: { initial: FixtureAssembly[]; parts: Hit[] }) {
  const [assemblies, setAssemblies] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const patch = (id: string, change: Partial<FixtureAssembly>) => {
    setSaved(false);
    setAssemblies((all) => all.map((assembly) => assembly.id === id ? { ...assembly, ...change } : assembly));
  };
  const toggleSection = (assembly: FixtureAssembly, role: AssemblyRole, hit: Hit, multi: boolean) => {
    const already = assembly.components.some((c) => c.role === role && c.sku === hit.sku);
    const kept = multi
      ? assembly.components.filter((c) => !(c.role === role && c.sku === hit.sku))
      : assembly.components.filter((c) => c.role !== role);
    const next: FixtureAssemblyComponent[] = already
      ? kept
      : kept.concat({ sku: hit.sku, label: hit.desc, role, defaultQty: 1 });
    patch(assembly.id, { components: next });
  };
  const save = () => startTransition(async () => {
    const result = await saveFixtureAssembliesAction(assemblies);
    setAssemblies(result.fixtureAssemblies);
    setSaved(true);
  });

  return (
    <div className="pk-content" style={{ maxWidth: 980 }}>
      <Link href="/design" style={{ fontSize: 12.5, color: "#8c919c" }}>← Design</Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 16, margin: "8px 0 20px", flexWrap: "wrap" }}>
        <div><h1 style={{ margin: 0, fontSize: 24 }}>Assembly Builder</h1><p style={{ margin: "5px 0 0", color: "#707681", fontSize: 13 }}>Build orderable fixtures from catalog parts. A default quantity of 0 keeps an item available without adding it automatically.</p></div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="pk-btn" onClick={() => setAssemblies((all) => all.concat({ id: `fa-${Date.now().toString(36)}`, name: "New fixture assembly", components: [] }))}>+ New assembly</button>
          <button className="pk-btn pk-btn-primary" disabled={pending} onClick={save}>{pending ? "Saving…" : saved ? "Saved" : "Save assemblies"}</button>
        </div>
      </div>
      {!assemblies.length && <div className="pk-card" style={{ padding: 28, color: "#777d88" }}>No sample assemblies are installed. Create the first assembly from your catalog.</div>}
      {assemblies.map((assembly) => (
        <section key={assembly.id} className="pk-card" style={{ padding: 18, marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input aria-label="Assembly name" value={assembly.name} onChange={(event) => patch(assembly.id, { name: event.target.value })} style={{ ...input, fontWeight: 650, fontSize: 15 }} />
            <button className="pk-btn" onClick={() => setAssemblies((all) => all.filter((item) => item.id !== assembly.id))}>Delete</button>
          </div>
          <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
            {assembly.components.map((component, index) => (
              <div key={`${component.sku}-${index}`} style={{ display: "grid", gridTemplateColumns: "minmax(160px,1.2fr) minmax(140px,1fr) 120px 90px 40px", gap: 8, alignItems: "center" }}>
                <div><div style={{ fontSize: 12.5, fontWeight: 650 }}>{component.sku}</div><div style={{ fontSize: 11, color: "#999fa9" }}>Catalog component</div></div>
                <input aria-label="Builder label" title="Name used in the estimator and BOM" value={component.label} onChange={(event) => patch(assembly.id, { components: assembly.components.map((item, i) => i === index ? { ...item, label: event.target.value } : item) })} style={input} />
                <select value={component.role} onChange={(event) => patch(assembly.id, { components: assembly.components.map((item, i) => i === index ? { ...item, role: event.target.value as AssemblyRole } : item) })} style={input}>{ASSEMBLY_ROLES.map((role) => <option key={role}>{role}</option>)}</select>
                <input aria-label="Default quantity" type="number" min="0" step="1" value={component.defaultQty} onChange={(event) => patch(assembly.id, { components: assembly.components.map((item, i) => i === index ? { ...item, defaultQty: Math.max(0, Number(event.target.value) || 0) } : item) })} style={input} />
                <button aria-label="Remove component" className="pk-btn" onClick={() => patch(assembly.id, { components: assembly.components.filter((_, i) => i !== index) })}>×</button>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            {ROLE_SECTIONS.map((section) => {
              const selected = assembly.components.filter((c) => c.role === section.role);
              return (
                <div key={section.role} style={{ border: "1px solid #e4e7ec", borderRadius: 9, padding: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 650, marginBottom: 6 }}>
                    {section.label}
                    <span style={{ fontWeight: 400, color: "#8c919c" }}>{section.multi ? " · pick any" : " · pick one"}</span>
                  </div>
                  {!!selected.length && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
                      {selected.map((c) => (
                        <span key={c.sku} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#f2f4f7", borderRadius: 999, padding: "3px 8px 3px 10px", fontSize: 11.5 }}>
                          {c.label}
                          <button
                            type="button"
                            aria-label={`Remove ${c.label}`}
                            onClick={() => patch(assembly.id, { components: assembly.components.filter((x) => x !== c) })}
                            style={{ border: 0, background: "none", cursor: "pointer", color: "#8c919c", fontSize: 13, lineHeight: 1 }}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {/* #121: results list inline under the box while typing; a
                      pick toggles membership (the checkmark shows what is in). */}
                  <Typeahead
                    items={parts}
                    keyOf={hitKey}
                    filter={catalogFilter}
                    rank={catalogRank}
                    stayOpen={section.multi}
                    placeholder={`Search ${section.label.toLowerCase()}…`}
                    ariaLabel={`Search ${section.label.toLowerCase()}`}
                    inputStyle={{ ...input, padding: "7px 9px", fontSize: 12.5 }}
                    onPick={(hit) => toggleSection(assembly, section.role, hit, section.multi)}
                    render={(hit) => {
                      const checked = selected.some((c) => c.sku === hit.sku);
                      return (
                        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                          <span style={{ width: 14, flexShrink: 0, color: checked ? "var(--accent)" : "#c4c9d2" }}>{checked ? "✓" : "○"}</span>
                          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><b>{hit.sku}</b> · {hit.desc}</span>
                          <span style={{ fontSize: 11.5, color: "#8c919c", flexShrink: 0 }}>{hit.mfr ? `${hit.mfr} · ` : ""}${hit.list.toFixed(2)}</span>
                        </span>
                      );
                    }}
                  />
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Verify** — `npx tsc --noEmit -p . | tail -3` → empty; `npx eslint "src/app/(app)/design/subassemblies" "src/app/(app)/design/assemblies"` → clean; `grep -rn searchAssemblyCatalogAction src` → nothing. Controller: smoke `/design/assemblies` + `/design/subassemblies`; browser pass on Subassemblies — type "led" in Light engine and see rows appear under the box, pick one, see the manufacturer/cost line; "Add compatible item" clears after each pick.

- [ ] **Step 5: Commit**
```bash
git add "src/app/(app)/design/subassemblies/subassemblies-client.tsx" "src/app/(app)/design/assemblies/page.tsx" "src/app/(app)/design/assemblies/actions.ts" "src/app/(app)/design/assemblies/assembly-builder.tsx"
git commit -m "feat(design): Subassemblies + Assembly Builder pickers list catalog results inline via Typeahead (#121)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: `SearchFilterBar` on the Grid palette, People, Companies and Venues

**Files:**
- Modify: `src/app/(app)/design/grid/[id]/editor.tsx:64-71` (imports), `:1196-1210` (palette search + scope buttons)
- Modify: `src/app/(app)/people/controls.tsx:56-119`
- Modify: `src/app/(app)/companies/controls.tsx:108-215`
- Modify: `src/app/(app)/venues/page.tsx:123-205`
- Test: `npx tsc`; controller smoke `/people`, `/companies`, `/venues`, `/design/grid/GRD-5001`.

**Interfaces:**
- Consumes: `SearchFilterBar` (Task 5); everything else in each file is unchanged (state, `pushWith`, debounce, `filteredParts`).

- [ ] **Step 1: Grid palette.** In `editor.tsx` add after line 71 (`import AssembliesPanel …`):
```ts
import { SearchFilterBar } from "@/components/search/search-filter-bar";
```
Replace lines 1198-1210 (the `<input …/>` and the scope-buttons `<div>`) with:
```tsx
            {/* #121: search + scope filter on ONE row (SearchFilterBar; the
                buttons wrap under the box inside this 252px column). */}
            <SearchFilterBar value={search} onChange={setSearch} placeholder="Search names or Manufacturer #" ariaLabel="Search devices">
              <div className="pk-searchbar-group">
                {["", ...GRID_LAYERS].map((s) => {
                  const count = s ? parts.filter((p) => scopeOfPart(p) === s).length : parts.length;
                  const on = scopeFilter === s;
                  return <button key={s || "all"} type="button" onClick={() => setScopeFilter(s)} style={{ ...BTN, padding: "4px 7px", fontSize: 10.5, background: on ? "#16181d" : "#fff", color: on ? "#fff" : "#5b616e", borderColor: on ? "#16181d" : "#dfe2e8" }}>{s || "All"} <span style={{ opacity: .65 }}>{count}</span></button>;
                })}
              </div>
            </SearchFilterBar>
```
(`INPUT` is still used elsewhere in the file — leave the constant.)

- [ ] **Step 2: People.** In `people/controls.tsx` add after line 4:
```ts
import { SearchFilterBar } from "@/components/search/search-filter-bar";
```
Delete the `select` style const (lines 56-65) and replace the whole `return (…)` (lines 67-119) with:
```tsx
  return (
    <div style={{ marginBottom: 14 }}>
      {/* #121: the filter selects ride on the search row. */}
      <SearchFilterBar value={text} onChange={onSearch} placeholder="Search people…" ariaLabel="Search people">
        <select
          className="pk-searchbar-select"
          value={status}
          onChange={(e) => pushWith({ status: e.target.value })}
          aria-label="Status filter"
        >
          {statusOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          className="pk-searchbar-select"
          value={company}
          onChange={(e) => pushWith({ company: e.target.value })}
          aria-label="Company filter"
        >
          <option value="all">All companies</option>
          {companyOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </SearchFilterBar>
    </div>
  );
```

- [ ] **Step 3: Companies.** In `companies/controls.tsx` add after line 5:
```ts
import { SearchFilterBar } from "@/components/search/search-filter-bar";
```
Replace the whole `return (…)` of `FilterBar` (lines 108-215) with:
```tsx
  return (
    <div style={{ marginBottom: 14 }}>
      {/* #121: search + the owner select + New (7d) on ONE row. */}
      <SearchFilterBar value={text} onChange={onSearch} placeholder="Search companies…" ariaLabel="Search companies">
        <select
          className="pk-searchbar-select"
          value={ownerSelectValue}
          onChange={(e) => pushWith({ scope: e.target.value === meName ? "mine" : e.target.value })}
          aria-label="Owner filter"
        >
          {ownerOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => pushWith({ added: added === "7d" ? "" : "7d" })}
          title="Companies added in the last 7 days"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 36,
            boxSizing: "border-box",
            fontSize: 11.5,
            fontWeight: added === "7d" ? 600 : 500,
            padding: "0 11px",
            borderRadius: 20,
            border: `1px solid ${added === "7d" ? "var(--accent)" : "#e4e7ec"}`,
            cursor: "pointer",
            background: added === "7d" ? ACCENT_SOFT : "#fff",
            color: added === "7d" ? ACCENT_INK : "#5b616e",
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}
        >
          New (7d)
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600 }}>{addedCount}</span>
        </button>
      </SearchFilterBar>

      {/* scope toggle + type chips */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 11, flexWrap: "wrap" }}>
        <div style={{ display: "flex", background: "#eceef1", borderRadius: 9, padding: 3, flexShrink: 0 }}>
          <button onClick={() => pushWith({ scope: "mine" })} style={scope === "mine" ? segActive : segIdle}>
            My work
          </button>
          <button onClick={() => pushWith({ scope: "all" })} style={scope === "all" || !scope ? segActive : segIdle}>
            Everyone
          </button>
        </div>
        {types.map((t) => {
          const active = type === t || (t === "all" && (!type || type === "all"));
          return (
            <button
              key={t}
              onClick={() => pushWith({ type: t })}
              style={{
                fontSize: 11.5,
                fontWeight: active ? 600 : 500,
                padding: "5px 11px",
                borderRadius: 20,
                border: `1px solid ${active ? "var(--accent)" : "#e4e7ec"}`,
                cursor: "pointer",
                background: active ? ACCENT_SOFT : "#fff",
                color: active ? ACCENT_INK : "#5b616e",
              }}
            >
              {t === "all" ? "All" : t}
            </button>
          );
        })}
      </div>
    </div>
  );
```

- [ ] **Step 4: Venues** (server component, GET form). In `venues/page.tsx` add next to the other imports at the top:
```ts
import { SearchFilterBar } from "@/components/search/search-filter-bar";
```
Replace lines 125-201 (the `<form …>…</form>`) with:
```tsx
          <form action="/venues" method="GET">
            {/* #121: search + the company filter on ONE row. `submit` keeps
                the magnifier as the form's submit button — with two text
                inputs and no button, Enter would not submit. */}
            <SearchFilterBar name="q" defaultValue={q} placeholder="Search venues…" ariaLabel="Search venues" submit>
              {companyOptions.length > 1 && (
                <>
                  {/* Company filter (D142) — a typeahead bound to a native
                   *  <datalist> rather than one option/chip per company, which
                   *  doesn't scale past a few dozen. Submits through the same
                   *  ?company= param as before; see the resolution above for how
                   *  a typed name (vs. an id from an old link) is handled. */}
                  <input
                    type="text"
                    name="company"
                    defaultValue={activeCompanyName}
                    list="ve-companies"
                    placeholder="Filter by company…"
                    aria-label="Filter by company"
                    className="pk-searchbar-select"
                    style={{ fontWeight: 500, cursor: "text", flex: "0 1 240px", minWidth: 160 }}
                  />
                  <datalist id="ve-companies">
                    {companyOptions.map((c) => (
                      <option key={c.id} value={c.name} />
                    ))}
                  </datalist>
                  {company && (
                    <Link href={linkWith({ company: "" })} style={{ fontSize: 12, fontWeight: 600, color: "#5b616e", whiteSpace: "nowrap", flexShrink: 0 }}>
                      Clear
                    </Link>
                  )}
                </>
              )}
            </SearchFilterBar>
          </form>
```

- [ ] **Step 5: Verify** — `npx tsc --noEmit -p . | tail -3` → empty; `npx eslint "src/app/(app)/design/grid/[id]/editor.tsx" "src/app/(app)/people/controls.tsx" "src/app/(app)/companies/controls.tsx" "src/app/(app)/venues/page.tsx"` → clean. Controller: smoke (`/people`, `/companies`, `/venues`, `/design/grid/GRD-5001`) and a browser look at each row (selects at the input's height; Venues Enter still submits; Grid scope buttons still filter the palette).

- [ ] **Step 6: Commit**
```bash
git add "src/app/(app)/design/grid/[id]/editor.tsx" "src/app/(app)/people/controls.tsx" "src/app/(app)/companies/controls.tsx" "src/app/(app)/venues/page.tsx"
git commit -m "feat(search): Grid palette, People, Companies and Venues filter rows on SearchFilterBar (#121)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## #131 — The Grid: a symbol per placed item type

### Task 8: Shape model — pure helpers, `SymbolShape`, store + type fields, actions

**Files:**
- Create: `src/lib/design/grid-symbols.ts`
- Create: `src/components/design/symbol-shape.tsx`
- Modify: `src/lib/stores/grid-catalog.ts:1-3` (imports), `:17-33` (`GridSymbol`), `:97-122` (`createGridAssembly`), append `setGridSymbolShape`
- Modify: `src/lib/design/grid-bom.ts:9-14` (type imports), `:53-61` (`PartLite` symbol metadata)
- Modify: `src/lib/design/grid-riser.ts:17` (`RiserGroup`), `:81` (group push)
- Modify: `src/lib/settings.ts:88-89` (after `fixtureAssemblies`)
- Modify: `src/app/(app)/design/grid/[id]/actions.ts:41-42` (imports), `:75-88` (`createGridAssemblyAction`), append `setSymbolShapeAction` after `setPlacementCategoryAction` (line 350)
- Test: `scripts/test-review-and-spec.ts` (section "#131 grid symbols")

**Interfaces:**
- Produces (`src/lib/design/grid-symbols.ts`, pure, no imports):
```ts
export const GRID_SHAPES = ["rect", "circle", "triangle", "diamond", "hexagon", "speaker", "light", "camera"] as const;
export type GridShape = (typeof GRID_SHAPES)[number];
export const GRID_SHAPE_LABEL: Record<GridShape, string>;
export const DEFAULT_GRID_CATEGORY_SHAPES: Record<string, GridShape>;   // Speakers→speaker, Lighting→light, Cameras→camera, Rigging→diamond, Control→hexagon
export function isGridShape(v: unknown): v is GridShape;
export function resolveCategoryShapes(stored?: Record<string, string> | null): Record<string, GridShape>;  // stored object (even {}) is the whole truth; absent → the seed; unknown shape values dropped
export function shapeFor(part: { category?: string | null; shape?: string | null } | null | undefined, settings: { gridCategoryShapes?: Record<string, string> | null } | null | undefined): GridShape;  // part.shape ?? default[category] ?? "rect"; category match trimmed + case-insensitive
export type SymbolOutline = { kind: "rect"; w: number; h: number; rx: number } | { kind: "circle"; r: number } | { kind: "polygon"; points: string };
export type SymbolGeometry = { outline: SymbolOutline; glyph: string | null };  // centered on (0,0); glyph = path `d` drawn inside for speaker/light/camera
export function symbolGeometry(shape: GridShape, w: number, h: number): SymbolGeometry;
export function markerColor(category: string): string;   // moved verbatim from editor.tsx:123-129 (the editor imports it in Task 9)
```
- Produces (`src/components/design/symbol-shape.tsx`, no directive — pure render, used in server (riser) and client (editor) trees):
```ts
export function SymbolShape(props: { shape: GridShape; x: number; y: number; w: number; h: number; color: string; selected?: boolean; opacity?: number }): JSX.Element;  // an SVG <g> for use INSIDE an <svg>
export function SymbolIcon(props: { shape: GridShape; color: string; size?: number; title?: string }): JSX.Element;  // a self-contained inline <svg> for palette rows, legends, selects
```
- Produces (`grid-catalog.ts`): `GridSymbol.shape?: GridShape | null`; `createGridAssembly` input gains `shape?: GridShape | null`; `setGridSymbolShape(id: string, shape: GridShape | null): Promise<GridSymbol | null>`.
- Produces (`grid-bom.ts`): `PartLite.shape?: GridShape | null`. (`grid-riser.ts`): `RiserGroup` gains `category: string; shape: string | null`. (`settings.ts`): `AppSettingsData.gridCategoryShapes?: Record<string, GridShape>`.
- Produces (grid `actions.ts`): `setSymbolShapeAction(projectId: string, symbolId: string, shape: string): Promise<Result>` (`""` clears the override); `createGridAssemblyAction` input gains `shape?: string`.

- [ ] **Step 1: Failing spec tests** — insert immediately before `async function asyncChecks(): Promise<void> {`:
```ts
/* --- #131 grid symbols (D154): shapeFor precedence + symbolGeometry snapshot --- */
import {
  DEFAULT_GRID_CATEGORY_SHAPES, GRID_SHAPES, isGridShape, markerColor, resolveCategoryShapes, shapeFor, symbolGeometry,
} from "@/lib/design/grid-symbols";

ok(GRID_SHAPES.length === 8 && GRID_SHAPES.join(",") === "rect,circle,triangle,diamond,hexagon,speaker,light,camera",
  "#131: the eight curated shapes, rect first");
ok(isGridShape("speaker") && !isGridShape("blob") && !isGridShape(null), "#131: isGridShape");
ok(shapeFor({ category: "Speakers" }, {}) === "speaker" && shapeFor({ category: "Lighting" }, {}) === "light" &&
   shapeFor({ category: "Cameras" }, {}) === "camera" && shapeFor({ category: "Rigging" }, {}) === "diamond" &&
   shapeFor({ category: "Control" }, {}) === "hexagon",
  "#131: the seeded category defaults");
ok(shapeFor({ category: "  speakers " }, {}) === "speaker", "#131: category match is trimmed + case-insensitive");
ok(shapeFor({ category: "Speakers", shape: "hexagon" }, {}) === "hexagon", "#131: the entry's own shape wins over its category default");
ok(shapeFor({ category: "Speakers" }, { gridCategoryShapes: { Speakers: "circle" } }) === "circle", "#131: a stored category map wins over the seed");
ok(shapeFor({ category: "Speakers" }, { gridCategoryShapes: {} }) === "rect", "#131: a stored map is the whole truth (full replacement) — unmapped → rect");
ok(shapeFor({ category: "Anything else" }, {}) === "rect" && shapeFor(null, {}) === "rect" && shapeFor(undefined, null) === "rect",
  "#131: unknown category / no part / no settings → rect");
ok(shapeFor({ category: "Speakers", shape: "blob" }, {}) === "speaker", "#131: an unknown stored shape falls through to the category default");
ok(JSON.stringify(resolveCategoryShapes(undefined)) === JSON.stringify(DEFAULT_GRID_CATEGORY_SHAPES) && resolveCategoryShapes(null) !== DEFAULT_GRID_CATEGORY_SHAPES,
  "#131: resolveCategoryShapes — absent → a fresh copy of the seed");
ok(resolveCategoryShapes({ Speakers: "nope", Lighting: "light" }).Speakers === undefined && resolveCategoryShapes({ Speakers: "nope", Lighting: "light" }).Lighting === "light",
  "#131: resolveCategoryShapes drops unknown shape values");
const g131 = (s: (typeof GRID_SHAPES)[number]) => symbolGeometry(s, 44, 30);
ok(g131("rect").outline.kind === "rect" && g131("rect").glyph === null, "#131: rect = rounded rect, no glyph");
ok(g131("circle").outline.kind === "circle" && (g131("circle").outline as { r: number }).r === 15, "#131: circle radius = half the short side");
ok(g131("triangle").outline.kind === "polygon" && (g131("triangle").outline as { points: string }).points.split(" ").length === 3, "#131: triangle = 3 points");
ok(g131("diamond").outline.kind === "polygon" && (g131("diamond").outline as { points: string }).points.split(" ").length === 4, "#131: diamond = 4 points");
ok(g131("hexagon").outline.kind === "polygon" && (g131("hexagon").outline as { points: string }).points.split(" ").length === 6, "#131: hexagon = 6 points");
for (const s of ["speaker", "light", "camera"] as const) {
  ok(g131(s).outline.kind === "rect" && /^M /.test(g131(s).glyph || ""), `#131: ${s} = rect + path glyph`);
}
ok(g131("speaker").glyph === symbolGeometry("speaker", 44, 30).glyph && g131("speaker").glyph !== g131("camera").glyph && g131("light").glyph !== g131("camera").glyph,
  "#131: glyph paths are deterministic and distinct per shape");
ok(symbolGeometry("speaker", 12, 9).glyph !== g131("speaker").glyph, "#131: glyphs scale with the symbol box");
ok(markerColor("Speakers") === markerColor("Speakers") && /^#[0-9a-f]{6}$/.test(markerColor("Speakers")), "#131: markerColor is a stable hex per category");
```

- [ ] **Step 2: Run, expect failure** — `npx tsx scripts/test-review-and-spec.ts 2>&1 | head -5` → cannot find module `@/lib/design/grid-symbols`.

- [ ] **Step 3: `src/lib/design/grid-symbols.ts`**
```ts
/* ------------------------------------------------------------------ *
 * The Grid — device symbols (#131, D154). Pure and dependency-free like
 * its siblings (grid-bom, grid-scopes): the editor, the riser page, the
 * Settings card and the spec harness all import it, and nothing here may
 * touch the doc-store.
 *
 * Resolution: an entry's own `shape` wins, then the admin's per-category
 * default (settings.gridCategoryShapes — a FULL-REPLACEMENT map, the
 * wireTypes idiom: absent = the seed below, present = exactly what is
 * stored), then "rect". Category names match trimmed and case-insensitive
 * because CatalogPart.category is free text.
 * ------------------------------------------------------------------ */

export const GRID_SHAPES = [
  "rect",
  "circle",
  "triangle",
  "diamond",
  "hexagon",
  "speaker",
  "light",
  "camera",
] as const;
export type GridShape = (typeof GRID_SHAPES)[number];

export const GRID_SHAPE_LABEL: Record<GridShape, string> = {
  rect: "Rectangle",
  circle: "Circle",
  triangle: "Triangle",
  diamond: "Diamond",
  hexagon: "Hexagon",
  speaker: "Speaker",
  light: "Light",
  camera: "Camera",
};

/** The seed (spec #131): what a fresh install draws per category. Everything
 *  else is a rectangle. Edited in Settings → Admin → Grid symbols. */
export const DEFAULT_GRID_CATEGORY_SHAPES: Record<string, GridShape> = {
  Speakers: "speaker",
  Lighting: "light",
  Cameras: "camera",
  Rigging: "diamond",
  Control: "hexagon",
};

export function isGridShape(v: unknown): v is GridShape {
  return typeof v === "string" && (GRID_SHAPES as readonly string[]).includes(v);
}

/** Stored map (even an empty one) is the whole truth; absent → a fresh copy
 *  of the seed. Unknown shape values are dropped rather than drawn wrong. */
export function resolveCategoryShapes(
  stored?: Record<string, string> | null
): Record<string, GridShape> {
  if (!stored || typeof stored !== "object") return { ...DEFAULT_GRID_CATEGORY_SHAPES };
  const out: Record<string, GridShape> = {};
  for (const [category, shape] of Object.entries(stored)) {
    if (isGridShape(shape)) out[category] = shape;
  }
  return out;
}

const norm = (s: string | null | undefined) => (s || "").trim().toLowerCase();

/** `part.shape ?? default[category] ?? "rect"`. */
export function shapeFor(
  part: { category?: string | null; shape?: string | null } | null | undefined,
  settings: { gridCategoryShapes?: Record<string, string> | null } | null | undefined
): GridShape {
  if (part && isGridShape(part.shape)) return part.shape;
  const wanted = norm(part?.category);
  if (wanted) {
    const map = resolveCategoryShapes(settings?.gridCategoryShapes);
    for (const [category, shape] of Object.entries(map)) {
      if (norm(category) === wanted) return shape;
    }
  }
  return "rect";
}

/* ---------------------------- geometry ---------------------------- */

export type SymbolOutline =
  | { kind: "rect"; w: number; h: number; rx: number }
  | { kind: "circle"; r: number }
  | { kind: "polygon"; points: string };

/** Everything centered on (0,0); the renderer translates to the marker. */
export type SymbolGeometry = { outline: SymbolOutline; glyph: string | null };

const r2 = (v: number) => Math.round(v * 100) / 100;

function rectOutline(w: number, h: number): SymbolOutline {
  return { kind: "rect", w: r2(w), h: r2(h), rx: r2(Math.min(4, Math.min(w, h) / 4)) };
}

/** Glyphs are authored on a 30-unit box and scaled to the short side, so a
 *  12px palette icon and a 48px plan marker draw the same picture. */
function glyphFor(shape: GridShape, w: number, h: number): string | null {
  const s = Math.min(w, h) / 30;
  const p = (x: number, y: number) => `${r2(x * s)} ${r2(y * s)}`;
  switch (shape) {
    case "speaker": // cone + one sound arc
      return `M ${p(-8, -4)} L ${p(-3, -4)} L ${p(4, -9)} L ${p(4, 9)} L ${p(-3, 4)} L ${p(-8, 4)} Z M ${p(7, -4)} Q ${p(11, 0)} ${p(7, 4)}`;
    case "light": { // bulb + base
      const rr = r2(6 * s);
      return `M ${p(-6, -3)} a ${rr} ${rr} 0 1 1 ${p(12, 0)} a ${rr} ${rr} 0 1 1 ${p(-12, 0)} M ${p(-3, 6)} L ${p(3, 6)} M ${p(-2, 9)} L ${p(2, 9)}`;
    }
    case "camera": // body + lens wedge
      return `M ${p(-9, -5)} L ${p(3, -5)} L ${p(3, 5)} L ${p(-9, 5)} Z M ${p(3, -1)} L ${p(9, -4)} L ${p(9, 4)} L ${p(3, 1)} Z`;
    default:
      return null;
  }
}

export function symbolGeometry(shape: GridShape, w: number, h: number): SymbolGeometry {
  const hw = w / 2;
  const hh = h / 2;
  const pts = (list: Array<[number, number]>) => list.map(([x, y]) => `${r2(x)},${r2(y)}`).join(" ");
  switch (shape) {
    case "circle":
      return { outline: { kind: "circle", r: r2(Math.min(w, h) / 2) }, glyph: null };
    case "triangle":
      return { outline: { kind: "polygon", points: pts([[0, -hh], [hw, hh], [-hw, hh]]) }, glyph: null };
    case "diamond":
      return { outline: { kind: "polygon", points: pts([[0, -hh], [hw, 0], [0, hh], [-hw, 0]]) }, glyph: null };
    case "hexagon":
      return {
        outline: { kind: "polygon", points: pts([[-hw / 2, -hh], [hw / 2, -hh], [hw, 0], [hw / 2, hh], [-hw / 2, hh], [-hw, 0]]) },
        glyph: null,
      };
    case "speaker":
    case "light":
    case "camera":
      return { outline: rectOutline(w, h), glyph: glyphFor(shape, w, h) };
    default:
      return { outline: rectOutline(w, h), glyph: null };
  }
}

/* ---------------------------- colour ------------------------------ */

/** Stable marker color per category — device markers read as families on a
 *  plan. Moved here from the editor (#131) so the riser and the Settings
 *  card colour a category exactly the way the plan does. */
const MARK_COLORS = ["#3155a8", "#2e9e6b", "#d5342a", "#6b4fa1", "#e08b1f", "#0e7f8c", "#b0367c"];
export function markerColor(category: string): string {
  let h = 0;
  for (let i = 0; i < category.length; i++) h = (h * 31 + category.charCodeAt(i)) | 0;
  return MARK_COLORS[Math.abs(h) % MARK_COLORS.length];
}
```

- [ ] **Step 4: `src/components/design/symbol-shape.tsx`**
```tsx
import { symbolGeometry, type GridShape } from "@/lib/design/grid-symbols";

/**
 * The one symbol renderer (#131, D154): the plan, the riser, the legend and
 * the palette rows all draw through here, so the palette shows exactly what
 * the plan will draw. No "use client" — it is a pure render used from both
 * the server-rendered riser page and the client editor.
 */

function Outline({ o }: { o: ReturnType<typeof symbolGeometry>["outline"] }) {
  if (o.kind === "circle") return <circle r={o.r} />;
  if (o.kind === "polygon") return <polygon points={o.points} />;
  return <rect x={-o.w / 2} y={-o.h / 2} width={o.w} height={o.h} rx={o.rx} />;
}

/** An SVG <g> centered on (x, y) — render INSIDE an <svg>. Fill + white
 *  stroke exactly like the rect it replaces; `selected` draws the same dashed
 *  ring the plan uses (the plan keeps drawing its own ring after the label,
 *  so it passes nothing here). */
export function SymbolShape({
  shape,
  x,
  y,
  w,
  h,
  color,
  selected = false,
  opacity = 0.92,
}: {
  shape: GridShape;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  selected?: boolean;
  opacity?: number;
}) {
  const g = symbolGeometry(shape, w, h);
  return (
    <g transform={`translate(${x} ${y})`}>
      <g fill={color} opacity={opacity}>
        <Outline o={g.outline} />
      </g>
      <g fill="none" stroke="#fff" strokeWidth={1.5} strokeLinejoin="round">
        <Outline o={g.outline} />
      </g>
      {g.glyph && (
        <path d={g.glyph} fill="none" stroke="#fff" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" opacity={0.95} />
      )}
      {selected && (
        <circle r={Math.max(w, h) / 2 + 5} fill="none" stroke="#16181d" strokeDasharray="4 3" strokeWidth={1.5} />
      )}
    </g>
  );
}

/** A self-contained inline <svg> for palette rows, legends and selects. */
export function SymbolIcon({
  shape,
  color,
  size = 12,
  title,
}: {
  shape: GridShape;
  color: string;
  size?: number;
  title?: string;
}) {
  const w = size;
  const h = Math.round(size * 0.78 * 100) / 100;
  const pad = 1.5;
  return (
    <svg
      width={w + pad * 2}
      height={h + pad * 2}
      viewBox={`${-(w / 2 + pad)} ${-(h / 2 + pad)} ${w + pad * 2} ${h + pad * 2}`}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      style={{ flex: "0 0 auto", display: "inline-block", verticalAlign: "middle" }}
    >
      {title && <title>{title}</title>}
      <SymbolShape shape={shape} x={0} y={0} w={w} h={h} color={color} />
    </svg>
  );
}
```

- [ ] **Step 5: Type fields.**

`src/lib/stores/grid-catalog.ts` — add after line 3: `import type { GridShape } from "@/lib/design/grid-symbols";`. In `GridSymbol` after `pricingPartId?: string | null;` (line 27):
```ts
  /** Per-entry symbol override (#131, D154). Absent/null = the category
   *  default from settings.gridCategoryShapes (see lib/design/grid-symbols). */
  shape?: GridShape | null;
```
In `createGridAssembly` add `shape?: GridShape | null;` to the input type (after `members: GridAssemblyMember[];`) and `shape: input.shape ?? null,` to the built doc (after `members: input.members,`). Append at the end of the file:
```ts
/** Set or clear (null) one entry's symbol override (#131). Returns null when
 *  the entry doesn't exist in the Grid library. */
export async function setGridSymbolShape(
  id: string,
  shape: GridShape | null
): Promise<GridSymbol | null> {
  return patchDoc<GridSymbol>("grid_catalog", id, (d) => {
    d.shape = shape;
    d.updatedAt = Date.now();
  });
}
```
and extend the line-2 import: `import { listDocs, patchDoc, upsertDoc, insertWithPrefixedId } from "@/db/doc-store";`.

`src/lib/design/grid-bom.ts` — add after line 14: `import type { GridShape } from "./grid-symbols";` and in `PartLite` after `symbolHeight?: number;` (line 58):
```ts
  /** Per-entry symbol override (#131) — resolved through shapeFor() with the
   *  category defaults; absent = use the category default. */
  shape?: GridShape | null;
```

`src/lib/design/grid-riser.ts` — line 17 becomes:
```ts
export type RiserGroup = { partId: string; desc: string; qty: number; category: string; shape: string | null };
```
and line 81 becomes:
```ts
    else node.groups.push({ partId: pl.partId, desc: part?.desc || pl.partId, qty: 1, category: part?.category || "", shape: part?.shape ?? null });
```

`src/lib/settings.ts` — after `fixtureAssemblies` (line 89) add:
```ts
  /** Grid symbol per catalog category (#131, D154) — FULL REPLACEMENT on
   *  save (the wireTypes idiom): resolveCategoryShapes in
   *  lib/design/grid-symbols returns the seed when absent and exactly the
   *  stored map when present. Edited in Settings → Admin → Grid symbols. */
  gridCategoryShapes?: Record<string, import("@/lib/design/grid-symbols").GridShape>;
```

- [ ] **Step 6: Grid actions.** In `src/app/(app)/design/grid/[id]/actions.ts` replace lines 41-42 with:
```ts
import { createGridAssembly, getGridSymbol, listGridSymbols, setGridSymbolShape } from "@/lib/stores/grid-catalog";
import { isGridShape } from "@/lib/design/grid-symbols";
```
Replace `createGridAssemblyAction` (lines 75-88) with:
```ts
export async function createGridAssemblyAction(input: {
  name: string;
  manufacturer: string;
  modelNumber: string;
  scope: string;
  members: Array<{ symbolId: string; qty: number; x: number; y: number }>;
  /** #131 — optional symbol override for the new entry ("" = category default). */
  shape?: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!input.name.trim()) return { ok: false, error: "Name the assembly." };
  if (!input.members.length) return { ok: false, error: "Choose at least one child symbol." };
  const assembly = await createGridAssembly({
    name: input.name,
    manufacturer: input.manufacturer,
    modelNumber: input.modelNumber,
    scope: input.scope,
    members: input.members,
    shape: isGridShape(input.shape) ? input.shape : null,
    by: user.name,
  });
  revalidatePath("/design/grid");
  return { ok: true, id: assembly.id };
}
```
Append after `setPlacementCategoryAction` (after line 350):
```ts
/**
 * #131 (D154): set or clear the symbol override on ONE grid-catalog entry.
 * Per-entry, not per-placement — placements resolve their part live, so every
 * placed instance of the entry (on every design) redraws with the new shape.
 */
export async function setSymbolShapeAction(
  projectId: string,
  symbolId: string,
  shape: string
): Promise<Result> {
  await requireUser();
  if (shape !== "" && !isGridShape(shape)) return { ok: false, error: "Unknown symbol." };
  const s = await setGridSymbolShape(symbolId, shape === "" ? null : shape);
  if (!s) return { ok: false, error: "That part is not in the Grid library." };
  revalidatePath(editorPath(projectId));
  return { ok: true };
}
```

- [ ] **Step 7: Run tests, expect pass** — `npx tsx scripts/test-review-and-spec.ts 2>&1 | grep -E '#131|ALL PASSED'` → 22 PASS + `ALL PASSED`; `npx tsc --noEmit -p . | tail -3` → empty; `npx eslint src/lib/design/grid-symbols.ts src/components/design/symbol-shape.tsx src/lib/stores/grid-catalog.ts src/lib/design/grid-bom.ts src/lib/design/grid-riser.ts src/lib/settings.ts "src/app/(app)/design/grid/[id]/actions.ts"` → clean.

- [ ] **Step 8: Commit**
```bash
git add src/lib/design/grid-symbols.ts src/components/design/symbol-shape.tsx src/lib/stores/grid-catalog.ts src/lib/design/grid-bom.ts src/lib/design/grid-riser.ts src/lib/settings.ts "src/app/(app)/design/grid/[id]/actions.ts" scripts/test-review-and-spec.ts
git commit -m "feat(grid): symbol shape model — shapeFor + symbolGeometry, SymbolShape renderer, per-entry shape on grid_catalog, category defaults type (#131)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Draw the symbols — plan, palette, context panel, assemblies form, riser + legend

**Files:**
- Modify: `src/app/(app)/design/grid/[id]/page.tsx:1-21` (imports), `:97-118` (`parts` map), `:158-173` (`<GridEditor …>` props)
- Modify: `src/app/(app)/design/grid/[id]/editor.tsx:33-72` (imports), `:123-129` (delete `MARK_COLORS`/`markerColor`), `:230-264` (props), after `:373` (`partById`), `:587-588` (`selectedPlacement`), palette rows (the `<span … borderRadius: "50%" …/>` dot at `:1264-1269`), context panel (after the Ports block, `:1528-1537`), plan (`:2066-2084`), plus a `saveSymbolShape` helper next to `saveCategory` (`:925-933`)
- Modify: `src/app/(app)/design/grid/[id]/assemblies-panel.tsx` (state, form, submit)
- Modify: `src/app/(app)/design/grid/[id]/riser/page.tsx:1-8` (imports), `:38-46` (loader), `:105-115` (group lines), `:143-149` (legend under the sketch)
- Test: `npx tsc`; controller smoke `/design/grid/GRD-5001` + `/design/grid/GRD-5001/riser`; browser pass.

**Interfaces:**
- Consumes: Task 8's `shapeFor`, `markerColor`, `GRID_SHAPES`, `GRID_SHAPE_LABEL`, `resolveCategoryShapes`, `GridShape`, `SymbolShape`, `SymbolIcon`, `setSymbolShapeAction`, `createGridAssemblyAction({ shape })`, `listGridSymbols`, `RiserGroup.category/shape`.
- Produces: `GridEditor` prop `categoryShapes: Record<string, GridShape>`; `PartLite.shape` populated from the grid symbol.

- [ ] **Step 1: `page.tsx`.** Add to the imports:
```ts
import { resolveCategoryShapes } from "@/lib/design/grid-symbols";
```
In the `parts` map (lines 97-118) add after `pricingPartId: s.pricingPartId,`:
```ts
      shape: s.shape ?? null, // #131 per-entry override; category defaults ride separately
```
In the `<GridEditor …>` props add after `venues={venues}`:
```tsx
      categoryShapes={resolveCategoryShapes(settings.gridCategoryShapes)}
```

- [ ] **Step 2: `editor.tsx` — imports, prop, helpers.** Add after the `grid-scopes` import (line 41):
```ts
import { GRID_SHAPES, GRID_SHAPE_LABEL, markerColor, shapeFor, type GridShape } from "@/lib/design/grid-symbols";
import { SymbolIcon, SymbolShape } from "@/components/design/symbol-shape";
```
Add `setSymbolShapeAction,` to the `./actions` import list (lines 50-64, after `setPlacementCategoryAction,`). Delete lines 123-129 (`/** Stable marker color … */`, `MARK_COLORS`, `function markerColor`). In the props type (lines 242-264) add after `canCreate: boolean;`:
```ts
  /** Category → symbol defaults (#131), resolved server-side from settings. */
  categoryShapes: Record<string, GridShape>;
```
and add `categoryShapes,` to the destructured parameter list (after `canCreate,`, line 241). After `const partById = …` (line 373) add:
```ts
  /** shapeFor() takes a settings-shaped object; built once per prop change. */
  const shapeSettings = useMemo(() => ({ gridCategoryShapes: categoryShapes }), [categoryShapes]);
```
After `const selectedPlacement = …` (lines 587-588) add:
```ts
  /** The catalog entry behind the selected device (curtains and seed
   *  placeholders have none) — what the Symbol select edits (#131). */
  const selectedPart =
    selectedPlacement && !selectedPlacement.curtain ? partById.get(selectedPlacement.partId) ?? null : null;
```
After `saveCategory` (line 933) add:
```ts
  /** Persist a catalog ENTRY's symbol override (#131). "" clears it. */
  async function saveSymbolShape(symbolId: string, shape: string) {
    setBusy(true);
    const r = await setSymbolShapeAction(project.id, symbolId, shape);
    setBusy(false);
    if (!r.ok) setErr(r.error);
    else router.refresh();
  }
```

- [ ] **Step 3: `editor.tsx` — palette rows.** Replace the 9px dot `<span …/>` (lines 1264-1269) with:
```tsx
                        <SymbolIcon shape={shapeFor(p, shapeSettings)} color={markerColor(p.category)} size={12} />
```

- [ ] **Step 4: `editor.tsx` — context panel.** Insert after the Ports block (after line 1537, before the `{/* User-defined category … */}` comment):
```tsx
              {/* Symbol (#131, D154) — the per-ENTRY override: every placed
                  instance of this catalog entry redraws, on the plan and the
                  riser. The category default itself lives in Settings. */}
              {selectedPart && (
                <div style={{ marginTop: 7, paddingTop: 6, borderTop: "1px solid #f0dcbb" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#5b616e" }}>
                    <SymbolIcon shape={shapeFor(selectedPart, shapeSettings)} color={markerColor(selectedPart.category)} size={12} />
                    <span style={{ flexShrink: 0 }}>Symbol</span>
                    <select
                      value={selectedPart.shape || ""}
                      disabled={busy}
                      onChange={(e) => saveSymbolShape(selectedPart.id, e.target.value)}
                      aria-label="Symbol"
                      style={{ ...INPUT, fontSize: 11.5, padding: "3px 6px" }}
                    >
                      <option value="">
                        Category default ({GRID_SHAPE_LABEL[shapeFor({ category: selectedPart.category }, shapeSettings)]})
                      </option>
                      {GRID_SHAPES.map((s) => (
                        <option key={s} value={s}>{GRID_SHAPE_LABEL[s]}</option>
                      ))}
                    </select>
                  </label>
                  <div style={{ fontSize: 10.5, color: "#8c919c", marginTop: 3 }}>
                    Applies to every placed {selectedPart.desc}.
                  </div>
                </div>
              )}
```

- [ ] **Step 5: `editor.tsx` — the plan.** Replace the non-curtain branch (lines 2066-2084, from `) : (` through the closing `)}` of the IIFE fragment) with:
```tsx
                      ) : (
                        <>
                          {(() => {
                            const w = part?.symbolWidth || 44;
                            const h = part?.symbolHeight || 30;
                            return (
                              <>
                                {/* #131: the shape replaces the bare rect; ring + label below are unchanged. */}
                                <SymbolShape shape={shapeFor(part, shapeSettings)} x={x} y={y} w={w} h={h} color={c} />
                                {part?.kind === "assembly" && (part.assemblyMembers || []).map((member) => {
                                  const child = partById.get(member.symbolId);
                                  const cx = x + (member.x - 0.5) * w;
                                  const cy = y + (member.y - 0.5) * h;
                                  return (
                                    <SymbolShape
                                      key={member.symbolId}
                                      shape={shapeFor(child, shapeSettings)}
                                      x={cx}
                                      y={cy}
                                      w={10}
                                      h={8}
                                      color={markerColor(child?.category || "Child")}
                                      opacity={1}
                                    />
                                  );
                                })}
                              </>
                            );
                          })()}
                        </>
                      )}
```
The label `<rect>`/`<text>` and the `{on && <circle … />}` selection ring that follow stay exactly as they are.

- [ ] **Step 6: `assemblies-panel.tsx`** — the "grid-catalog entry editor". Add imports after line 5:
```ts
import { GRID_SHAPES, GRID_SHAPE_LABEL } from "@/lib/design/grid-symbols";
```
Add state after `const [scope, setScope] = useState("Lighting");`:
```ts
  const [shape, setShape] = useState("");
```
In `submit`, pass the shape and reset it: the action call becomes `createGridAssemblyAction({ name, manufacturer, modelNumber, scope, members, shape })` and the reset line becomes `setName(""); setManufacturer(""); setModelNumber(""); setShape(""); setPicked([]); setOpen(false); onChanged();`. In the form, after the scope `<select>` add:
```tsx
          {/* #131: the entry's symbol — "" leaves it to the category default (Settings). */}
          <select value={shape} onChange={(e) => setShape(e.target.value)} aria-label="Symbol" style={FIELD}>
            <option value="">Symbol: category default</option>
            {GRID_SHAPES.map((s) => <option key={s} value={s}>Symbol: {GRID_SHAPE_LABEL[s]}</option>)}
          </select>
```

- [ ] **Step 7: Riser page.** In `riser/page.tsx` add imports:
```ts
import { listGridSymbols } from "@/lib/stores/grid-catalog";
import { markerColor, shapeFor } from "@/lib/design/grid-symbols";
import { SymbolIcon, SymbolShape } from "@/components/design/symbol-shape";
import type { PartLite } from "@/lib/design/grid-bom";
```
Replace lines 38-46 (the loader + `riserGraph` call) with:
```ts
  const [catalog, gridSymbols, settings] = await Promise.all([listCatalog(), listGridSymbols(), getSettings()]);
  const accent = settings.accent || "#b08d4a";
  // #131: placements point at Grid-library entries (which carry the symbol
  // override); pricing rows fill in anything not in the library so every
  // placement still resolves a description.
  const seen = new Set<string>();
  const parts: PartLite[] = [];
  for (const s of gridSymbols) {
    seen.add(s.id);
    parts.push({ id: s.id, sku: s.modelNumber || s.id, desc: s.name, category: s.category || "Other", unit: "ea", list: 0, cost: 0, shape: s.shape ?? null });
  }
  for (const p of catalog) {
    if (seen.has(p.id)) continue;
    parts.push({ id: p.id, sku: p.sku, desc: p.desc, category: p.category, unit: p.unit, list: p.list, cost: p.cost });
  }
  const graph = riserGraph(
    project.placements || [],
    project.routes || [],
    project.spaces || [],
    parts,
    project.calibrations || []
  );
  // Legend: one row per category actually drawn, in first-seen order.
  const legend: Array<{ category: string; shape: ReturnType<typeof shapeFor>; color: string }> = [];
  for (const n of graph.nodes) {
    for (const g of n.groups) {
      const category = g.category || "Uncategorized";
      if (legend.some((l) => l.category === category)) continue;
      legend.push({ category, shape: shapeFor({ category: g.category, shape: g.shape }, settings), color: markerColor(g.category) });
    }
  }
```
Replace the group lines (lines 110-114, the `n.groups.map((g, gi) => (<text …>))`) with:
```tsx
                    n.groups.map((g, gi) => {
                      const ly = PAD + HEAD_H + 8 + gi * LINE_H;
                      return (
                        <g key={g.partId}>
                          <SymbolShape shape={shapeFor({ category: g.category, shape: g.shape }, settings)} x={x + 19} y={ly} w={14} h={11} color={markerColor(g.category)} />
                          <text x={x + 30} y={ly + 4} fontSize={11.5} fill="#3d424e" style={{ fontFamily: "inherit" }}>
                            {g.qty}× {g.partId}
                          </text>
                        </g>
                      );
                    })
```
After the `</svg>` (line 143) and before the `{graph.edges.length === 0 && (…)}` note, add the legend (it prints — no `pk-no-print`):
```tsx
          {legend.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 12, fontSize: 11.5, color: "#5b616e" }}>
              <span style={{ fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", fontSize: 10, color: "#9aa0ab", alignSelf: "center" }}>Legend</span>
              {legend.map((l) => (
                <span key={l.category} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <SymbolIcon shape={l.shape} color={l.color} size={14} />
                  {l.category}
                </span>
              ))}
            </div>
          )}
```

- [ ] **Step 8: Verify** — `npx tsc --noEmit -p . | tail -3` → empty; `npx eslint "src/app/(app)/design/grid/[id]"` → clean (no unused `INPUT`/`useMemo`/`markerColor` warnings — `INPUT` is still used by the context panel and calibration entry). `grep -n "MARK_COLORS" "src/app/(app)/design/grid/[id]/editor.tsx"` → nothing. Controller: smoke `/design/grid/GRD-5001` + `/riser`; browser pass — the palette rows show glyphs, the seeded "Speaker" device draws the speaker glyph, selecting a device and picking "Hexagon" redraws every instance, the Assemblies "+ Build" form has the Symbol select, the riser shows a glyph per group line and a legend.

- [ ] **Step 9: Commit**
```bash
git add "src/app/(app)/design/grid/[id]/page.tsx" "src/app/(app)/design/grid/[id]/editor.tsx" "src/app/(app)/design/grid/[id]/assemblies-panel.tsx" "src/app/(app)/design/grid/[id]/riser/page.tsx"
git commit -m "feat(grid): draw category/entry symbols on the plan, palette, riser + legend; Symbol select on placed devices and new assemblies (#131)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Settings → Admin → Grid symbols (category defaults)

**Files:**
- Create: `src/app/(app)/settings/grid-symbols-card.tsx`
- Modify: `src/app/(app)/settings/actions.ts` (append after `saveConsultingAssumptionsAction`, line 277; import)
- Modify: `src/app/(app)/settings/page.tsx:1-9` (import), `:171` (prop)
- Modify: `src/app/(app)/settings/settings-client.tsx:36` (import), `:152-186` (props), `:1837-1840` (admin section)
- Modify: `scripts/smoke-routes.ts` (add `/settings?section=admin`)
- Test: `npx tsc`; controller smoke + browser pass "change a category default and see every placed speaker change".

**Interfaces:**
- Consumes: `GRID_SHAPES`, `GRID_SHAPE_LABEL`, `DEFAULT_GRID_CATEGORY_SHAPES`, `isGridShape`, `markerColor`, `resolveCategoryShapes`, `GridShape` (Task 8); `SymbolIcon` (Task 8); `setSettings`/`requirePerm("manage_users")` (the existing Settings action idiom, `settings/actions.ts:254-263`).
- Produces: `saveGridCategoryShapesAction(map: Record<string, string>): Promise<{ ok: true }>`; `GridSymbolsCard({ shapes })`; `SettingsClient` prop `gridCategoryShapes: Record<string, GridShape>`.

- [ ] **Step 1: Action.** In `settings/actions.ts` add the import:
```ts
import { isGridShape, type GridShape } from "@/lib/design/grid-symbols";
```
Append after `saveConsultingAssumptionsAction` (line 277):
```ts
/** Grid symbol per category (#131, D154) — FULL REPLACEMENT (the wireTypes
 *  idiom): the card posts every row; a category left off draws as a
 *  rectangle. Unknown shapes and blank categories are dropped; capped. */
export async function saveGridCategoryShapesAction(map: Record<string, string>) {
  await requirePerm("manage_users");
  const clean: Record<string, GridShape> = {};
  for (const [k, v] of Object.entries(map || {})) {
    const category = String(k ?? "").trim().slice(0, 60);
    if (!category || !isGridShape(v)) continue;
    clean[category] = v;
    if (Object.keys(clean).length >= 60) break;
  }
  await setSettings({ gridCategoryShapes: clean });
  revalidatePath("/", "layout");
  return { ok: true as const };
}
```

- [ ] **Step 2: The card.** Create `src/app/(app)/settings/grid-symbols-card.tsx`:
```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_GRID_CATEGORY_SHAPES,
  GRID_SHAPES,
  GRID_SHAPE_LABEL,
  markerColor,
  type GridShape,
} from "@/lib/design/grid-symbols";
import { SymbolIcon } from "@/components/design/symbol-shape";
import { saveGridCategoryShapesAction } from "./actions";

/**
 * Admin "Grid symbols" card (#131, D154) — the CustomerFieldsCard idiom:
 * seeded from the server-resolved map, whole-map save, sorted ONCE on mount.
 * One row per catalog category → shape; anything not listed draws as a
 * rectangle; a symbol set on a single Grid entry wins over its category.
 */

type Row = { category: string; shape: GridShape };

const inS: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12.5,
  color: "#16181d",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "7px 10px",
  background: "#fff",
  outline: "none",
  width: "100%",
};

const rowsOf = (map: Record<string, GridShape>): Row[] =>
  Object.entries(map)
    .map(([category, shape]) => ({ category, shape }))
    .sort((a, b) => a.category.localeCompare(b.category));

export function GridSymbolsCard({ shapes }: { shapes: Record<string, GridShape> }) {
  const router = useRouter();
  const [saved, setSaved] = useState<Row[]>(() => rowsOf(shapes));
  const [rows, setRows] = useState<Row[]>(() => rowsOf(shapes));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const dirty = JSON.stringify(rows) !== JSON.stringify(saved);

  const patch = (i: number, p: Partial<Row>) => {
    setJustSaved(false);
    setError(null);
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  };
  const addRow = () => {
    setJustSaved(false);
    setRows((rs) => [...rs, { category: "", shape: "rect" }]);
  };
  const removeRow = (i: number) => {
    setJustSaved(false);
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  };
  const restoreDefaults = () => {
    setJustSaved(false);
    setRows(rowsOf(DEFAULT_GRID_CATEGORY_SHAPES));
  };

  const onSave = () => {
    setError(null);
    startTransition(async () => {
      try {
        const map: Record<string, string> = {};
        for (const r of rows) {
          const c = r.category.trim();
          if (c) map[c] = r.shape;
        }
        await saveGridCategoryShapesAction(map);
        setSaved(rows);
        setJustSaved(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed — please try again.");
      }
    });
  };

  return (
    <div className="pk-card" style={{ overflow: "hidden", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", rowGap: 10, padding: "14px 18px", borderBottom: "1px solid #ececf0" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ fontSize: 14.5, fontWeight: 600 }}>Grid symbols</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".06em", color: "#8a6d1f", background: "#fbf3dd", border: "1px solid #f0e2bd", padding: "3px 9px", borderRadius: 6 }}>
              ADMIN
            </span>
          </div>
          <div style={{ fontSize: 12, color: "#8c919c", marginTop: 4, lineHeight: 1.45 }}>
            The symbol The Grid draws for each catalog category, on the plan and the riser. Categories not
            listed draw as a rectangle; a symbol set on a single Grid entry wins over its category.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <button type="button" onClick={restoreDefaults} style={{ fontSize: 12, fontWeight: 600, color: "#5b616e", background: "transparent", border: "none", cursor: "pointer" }}>
            Restore defaults
          </button>
          <button
            type="button"
            disabled={!dirty || pending}
            onClick={onSave}
            style={{ fontSize: 13, fontWeight: 600, border: "none", borderRadius: 9, padding: "9px 16px", cursor: dirty && !pending ? "pointer" : "not-allowed", color: dirty && !pending ? "#fff" : "#aab0bb", background: dirty && !pending ? "var(--accent)" : "#eef0f3", whiteSpace: "nowrap" }}
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ margin: "12px 18px 0", fontSize: 12, color: "#b4543a", background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 8, padding: "9px 12px" }}>
          {error}
        </div>
      )}
      {justSaved && !dirty && (
        <div style={{ margin: "12px 18px 0", fontSize: 11.5, color: "#1f7a52", fontWeight: 600 }}>✓ Saved</div>
      )}

      <div style={{ padding: "12px 18px 16px" }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "28px minmax(0, 1fr) 150px 30px", gap: 9, alignItems: "center", marginBottom: 8 }}>
            <SymbolIcon shape={r.shape} color={markerColor(r.category.trim())} size={16} />
            <input
              value={r.category}
              onChange={(e) => patch(i, { category: e.target.value })}
              placeholder="Catalog category (e.g. Speakers)"
              aria-label="Catalog category"
              style={{ ...inS, fontWeight: 600 }}
            />
            <select
              value={r.shape}
              onChange={(e) => patch(i, { shape: e.target.value as GridShape })}
              aria-label="Symbol"
              style={{ ...inS, cursor: "pointer" }}
            >
              {GRID_SHAPES.map((s) => (
                <option key={s} value={s}>{GRID_SHAPE_LABEL[s]}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => removeRow(i)}
              title="Remove (the category draws as a rectangle)"
              aria-label="Remove category"
              style={{ width: 30, height: 30, border: "1px solid #e4e7ec", background: "#fff", borderRadius: 8, color: "#c4c9d2", fontSize: 15, cursor: "pointer" }}
            >
              ×
            </button>
          </div>
        ))}
        {rows.length === 0 && (
          <div style={{ padding: "18px 0 8px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
            No category symbols — everything draws as a rectangle.
          </div>
        )}
        <button
          type="button"
          onClick={addRow}
          disabled={rows.length >= 60}
          style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
        >
          + Add category
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire the page and the client.** In `settings/page.tsx` add the import `import { resolveCategoryShapes } from "@/lib/design/grid-symbols";` and after line 171 (`customerFieldDefs={…}`) add:
```tsx
          gridCategoryShapes={resolveCategoryShapes(settings.gridCategoryShapes)}
```
In `settings-client.tsx` add after line 36:
```ts
import { GridSymbolsCard } from "./grid-symbols-card";
import type { GridShape } from "@/lib/design/grid-symbols";
```
Add `gridCategoryShapes,` to the destructured props (after `customerFieldDefs,`, line 162) and `gridCategoryShapes: Record<string, GridShape>;` to the props type (after `customerFieldDefs: CustomFieldDef[];`, line 183). In the admin section, after `<CustomerFieldsCard … />` (lines 1837-1840) add:
```tsx
          <GridSymbolsCard key={JSON.stringify(gridCategoryShapes)} shapes={gridCategoryShapes} />
```
In `scripts/smoke-routes.ts` add after `"/settings",` (line 71):
```ts
  "/settings?section=admin", // #131 Grid symbols card lives here
```

- [ ] **Step 4: Verify** — `npx tsc --noEmit -p . | tail -3` → empty; `npx eslint "src/app/(app)/settings"` → clean; `npx tsx scripts/test-review-and-spec.ts | grep -E 'FAIL|ALL PASSED'` → `ALL PASSED` (the sections check `general,team,admin` still holds — no section was added). Controller: smoke, then the spec's browser pass — Settings → Admin → Grid symbols: change Speakers → Circle → Save; open `/design/grid/GRD-5001` and every placed speaker is a circle; set one speaker entry's Symbol to Hexagon in the context panel and only that entry's instances change.

- [ ] **Step 5: Commit**
```bash
git add "src/app/(app)/settings/grid-symbols-card.tsx" "src/app/(app)/settings/actions.ts" "src/app/(app)/settings/page.tsx" "src/app/(app)/settings/settings-client.tsx" scripts/smoke-routes.ts
git commit -m "feat(settings): Grid symbols card — per-category symbol defaults under Settings → Admin (#131)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Docs

### Task 11: Decisions D154 + D155, punch-list close-out

**Files:**
- Modify: `DECISIONS.md` (append after D153, the last entry)
- Modify: `PUNCHLIST.md` (headings at lines 5951, 6101, 6159, 6174 + a **Shipped:** paragraph each)

**Before committing:** `git fetch origin && git show origin/main:DECISIONS.md | grep -n '^## D15[4-9]'` must print nothing — D-numbers collided today. If D154 or D155 is taken on `main`, renumber to the next free pair and update every `D154`/`D155` mention this plan introduced (`grep -rn 'D154\|D155' src scripts docs/superpowers/plans/2026-09-21-round-2-standalone.md`).

- [ ] **Step 1: Full gate**, one at a time: `npx tsc --noEmit -p .` (empty), `npx eslint src scripts` (0 errors), `npx tsx scripts/test-review-and-spec.ts | tail -1` (`ALL PASSED`), `npm run test:review:regressions | tail -2`. The controller has run `npm run test:smoke` after Tasks 2, 4, 7, 9 and 10.

- [ ] **Step 2: Append to `DECISIONS.md`:**

```markdown
## D154. The Grid draws a symbol per placed item type — eight curated shapes, per-entry override, per-category defaults in Settings (#131, 2026-09-21)

Every placed device was the same rounded rect coloured by a category hash; curtains were the one
special glyph. Jeff asked for selectable symbols so people can tell objects apart on a plan.

- **Vocabulary is curated, not uploaded:** `rect | circle | triangle | diamond | hexagon | speaker |
  light | camera` (`GRID_SHAPES` in `src/lib/design/grid-symbols.ts`). The last three are a rounded
  rect with a small white path glyph inside; everything else is an outline. Symbol images/uploads
  stay out of scope.
- **Resolution is `part.shape ?? default[category] ?? "rect"`** (`shapeFor`, pure). The per-entry
  override is `GridSymbol.shape` on the `grid_catalog` document — placements resolve their part
  live, so changing an entry redraws every instance on every design. Category defaults live in
  `settings.gridCategoryShapes`.
- **The category map is FULL REPLACEMENT** (the `wireTypes` idiom, not a per-key merge over the
  seed): absent = the seed `Speakers→speaker, Lighting→light, Cameras→camera, Rigging→diamond,
  Control→hexagon`; present = exactly what Settings holds, and a category left off draws as a
  rectangle. Category names match trimmed and case-insensitive because `CatalogPart.category` is
  free text (~40 imported values).
- **One renderer:** `<SymbolShape>` (`src/components/design/symbol-shape.tsx`) draws the plan
  marker, the riser's group glyphs, the riser legend and the palette rows, so the palette shows
  what the plan will draw. It takes `w`/`h` (the symbol's existing `symbolWidth`/`symbolHeight`),
  not a single `size`, so the 44×30 footprint is unchanged. Curtains keep their drape glyph; the
  selection ring and label placement are untouched. `markerColor` moved from the editor into the
  pure module so the riser and Settings colour a category exactly like the plan.
- **Where it is edited:** the placed item's context panel ("Symbol" select — per-entry, labelled
  "applies to every placed X") and the Assemblies "+ Build" form (the only grid-catalog entry
  editor that exists — entries are otherwise seeded from the pricing catalog). The category
  defaults card lives under **Settings → Admin** (the spec harness pins the sections to
  General/Team/Admin; a fourth "Grid" section is out of scope).
- **The legend** lives on the riser page (the printable derived drawing); no legend existed
  before this change.

Spec: `docs/superpowers/specs/2026-09-21-round-2-standalone-design.md` §#131.

## D155. Manual consulting engagements are never overwritten by the quote sweep (#135, 2026-09-21)

Engagements were only ever minted by `syncEngagementsFromQuotes()` from sent/won consulting
quotes; a project that skipped the fee proposal had no way in. "+ New consulting project" on the
hub now creates one by hand, and the sweep's contract was extended rather than bypassed:

- **Model:** `ConsultingEngagement.origin?: "quote" | "manual"` (absent on pre-#135 docs = quote)
  and `quoteId: string | null` (null on a manual project until a proposal is attached). A manual
  project is born `awarded`, with milestones from the fee — a fixed fee is ONE unscheduled "Fee"
  milestone carrying the amount, a schedule keeps its rows — and every phase from the Settings
  phase menu pending, exactly as a won quote seeds them. The creation is logged as a decision
  ("Project added manually", by the creator) so provenance is visible on the record.
- **Sweep rule (`sweepIndexesEngagement`, pure):** the sweep indexes rows by quote and skips any
  row with no quote — so a manual project is invisible to it: never created, advanced, closed or
  reopened. "Attach proposal" sets `quoteId` (validated: exists, is a consulting quote, is not
  another engagement's); from then on the row is keyed by that quote and follows
  `engagementSyncAction` like any other. Those rules only move `proposal_sent` and `closed` rows,
  so an awarded manual project is never demoted, and because the row is now indexed the sweep can
  never mint a duplicate engagement for the attached quote. Attaching never rewrites milestones.
- **Creation is `requirePerm("create")`** (the rentals-create gate); a customer is picked or
  quick-added (`EntityQuickAdd`, minted with the `c<ms>` id convention), the venue must belong to
  that customer or is dropped, and the phase menu is resolved in the action so the store stays
  settings-free (the D91 idiom).
- **Not changed:** `ensureEngagementForQuote` (the regression harness uses it), the on-win fan-out,
  the Reports billing forecast (`targetDate > 0` still gates it), consulting fee proposals (#35).

Spec: `docs/superpowers/specs/2026-09-21-round-2-standalone-design.md` §#135.
```

- [ ] **Step 3: `PUNCHLIST.md`** — change the four headings and add a **Shipped:** paragraph after each item's existing **Ask:** paragraph:

`## 121. Search bars: filter dropdown and results on the same line as the search box — OPEN` → `## 121. Search bars: filter dropdown and results on the same line as the search box — DONE 2026-09-21`
```markdown
**Shipped:** two shared components in `src/components/search/` — `SearchFilterBar` (one flex row:
the search box grows, `<select>` filters ride beside it at 36px, wraps under 560px; controlled or,
inside a GET form, uncontrolled with the magnifier as the submit button) and `Typeahead<T>` (results
inline under the box while typing, max 8 rows, arrow/enter/escape, listbox roles) over a pure
`src/lib/search/typeahead-rank.ts` (SKU prefix first, then description contains, then anywhere;
tokens AND-ed). Adopted on the Subassemblies `PartPicker` and the Assembly Builder's role pickers
(the server-side search action is gone — the catalog slice ships to the client like Subassemblies
already did), the Grid device palette (scope buttons on the search row), and the People, Companies
and Venues filter rows. Leads/quotes tables and the Catalog facet rail are untouched (spec).
```

`## 131. The Grid: selectable symbol per placed item type — OPEN` → `## 131. The Grid: selectable symbol per placed item type — DONE 2026-09-21 (D154)`
```markdown
**Shipped:** D154 — eight curated shapes (`src/lib/design/grid-symbols.ts`), `shapeFor(part,
settings)` = entry override → category default → rect, one `<SymbolShape>` renderer used by the
plan, the palette rows, the riser's group lines and a new riser legend. Per-entry "Symbol" select
on the placed device's context panel and on the Assemblies "+ Build" form; category defaults
(seeded Speakers/Lighting/Cameras/Rigging/Control) in Settings → Admin → Grid symbols
(`settings.gridCategoryShapes`, full replacement). No schema change; curtains, the selection ring
and labels are untouched.
```

`## 135. Consulting: add a project + fee manually from the hub — OPEN` → `## 135. Consulting: add a project + fee manually from the hub — DONE 2026-09-21 (D155)`
```markdown
**Shipped:** D155 — "+ New consulting project" on `/design/engagements` opens a modal (customer
pick or quick-add, name, architect, venue, optional fixed fee or milestone rows) → 
`createManualEngagementAction` (`requirePerm("create")`) → an `awarded` engagement with
`origin: "manual"`, `quoteId: null`, milestones from the fee and the Settings phase menu pending.
`syncEngagementsFromQuotes` indexes rows by quote and skips rows without one, so the manual row is
never touched; "Attach proposal" on the engagement's Links card links an existing consulting quote
without rewriting milestones, after which the normal sweep rules apply. Hub cards show a "Manual"
pill. `ensureEngagementForQuote` was not dead (the regression harness uses it) and is unchanged.
```

`## 136. Knowledge & Information tab: move Steel Calculator + Fixture Cross-Ref — OPEN (first slice of #27/#56)` → `## 136. Knowledge & Information tab: move Steel Calculator + Fixture Cross-Ref — DONE 2026-09-21 (first slice of #27/#56; #56 stays open)`
```markdown
**Shipped:** a KNOWLEDGE nav group after DESIGN (Overview `/knowledge`, Steel Calculator
`/knowledge/steel`, Fixture Cross-Ref `/knowledge/fixtures`); the two pages moved with their
components untouched (back links now read "← Knowledge"); `/design/steel`, `/design/fixtures` and
the D97 `/design-studio/steel` stub all redirect to the new routes in one hop through
`designRedirect`'s `KNOWLEDGE_MOVES`. The landing page lists the two tools, where each dataset
comes from and how it is maintained, and a plain-text "Coming here" list (design doctrine,
estimating rules, customer tiers) with no links to unbuilt pages. Spec-harness checks pin the group's
children, the redirects and that no two nav entries share a key.
```

- [ ] **Step 4: Commit**
```bash
git add DECISIONS.md PUNCHLIST.md
git commit -m "docs: D154 Grid symbols, D155 manual consulting engagements; close #121 #131 #135 #136

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review

**1. Spec coverage — each spec section mapped to a task**

| Spec section | Requirement | Task |
|---|---|---|
| #121 Design | `SearchFilterBar` (one flex row, input grows, `<select>` children, 36px, wraps < 560px; props `value/onChange/placeholder/children`) | Task 5 (component + `.pk-searchbar*` CSS; `name/defaultValue/submit` added for the GET-form Venues page) |
| #121 Design | `Typeahead<T>` — inline results, absolute, max 8, keyboard, `aria-*` listbox, `items/filter/render/onPick` | Task 5 (`rank`, `keyOf`, `labelOf`, `selectedKey`, `stayOpen` added for the pickers) |
| #121 Adopt | Subassemblies `PartPicker` + Assembly Builder component picker (SKU · description · manufacturer · list price) | Task 6 |
| #121 Adopt | Grid palette search keeps its scope toggles on the row; People, Companies, Venues rows | Task 7 |
| #121 Tests | `test:specs` ranking helper (SKU prefix first, then description contains); smoke on touched pages; browser pass on Subassemblies | Task 5 (8 checks), Tasks 6-7 (controller smoke + browser) |
| #131 Design | `GridSymbol.shape` (8 values), `settings.gridCategoryShapes` seeded, `shapeFor` pure | Task 8 |
| #131 Design | One `<SymbolShape>` for plan, riser, legend, palette rows; curtains keep drape; ring + label unchanged | Task 8 (component), Task 9 (adoption; riser legend) |
| #131 Editing | "Symbol" select in the entry editor + placed item's context panel; category default in Settings | Task 9 (Assemblies form + context panel), Task 10 (Settings → Admin card) |
| #131 Tests | `shapeFor` precedence; `SymbolShape` known element/`d` per shape; smoke editor + riser; browser pass on a category default | Task 8 (22 checks via `symbolGeometry`, the exact data the component renders), Tasks 9-10 (controller) |
| #135 Design | `origin`, nullable `quoteId`; `createManualEngagement(input, me)` → awarded, manual, milestones from fee (fixed = one "Fee"), phases as for a won quote; sweep ignores manual rows | Task 3 |
| #135 Hub | "+ New consulting project" modal (customer pick / `EntityQuickAdd`, name, architect, venue, fee) → `createManualEngagementAction` (`requirePerm("create")`) → routes to the new engagement | Task 4 |
| #135 Engagement page | "Attach proposal" links a consulting quote without changing milestones; sweep rules apply afterwards | Task 3 (store + rule), Task 4 (UI + action validation) |
| #135 Tests | `test:specs` fee→milestones + sweep skip; regressions: create → in hub, sweep leaves intact, attach sets `quoteId`; smoke; browser | Task 3 (9 spec + regression block), Task 4 (controller) |
| #136 Design | KNOWLEDGE group after DESIGN with the three children; pages move, components untouched; old URLs redirect; `activeKeyFor` | Tasks 1-2 |
| #136 Landing | tools today, provenance + maintenance, "Coming here" plain text | Task 2 |
| #136 Tests | smoke 200s + redirects; nav unique-key check | Task 1 (unique keys + redirect targets), Task 2 (smoke list) |
| Out of scope | ⌘K, symbol uploads, #35 proposals, #56 migration | none touched |
| Decisions | D154 (#131), D155 (#135); #121/#136 take no non-obvious default beyond what the tasks note | Task 11 |

**2. Placeholder scan** — searched the plan for `TBD`, `TODO`, `similar to`, `add validation`, `handle edge cases`, `…rest`, `etc.` in code blocks: none. Every code step is the complete function/component/CSS block; every "replace lines N-M" cites the line numbers read from the working tree at plan time (verify with `sed -n` before editing — earlier tasks in the same file shift later anchors, which is why each anchor is also named by its content).

**3. Type/name consistency across tasks**
- `ManualFee`, `manualMilestoneSeeds`, `sweepIndexesEngagement` — defined in Task 3 (`consulting-stages.ts`), consumed by Task 3 (store), Task 4 (actions, modal) with the same signatures.
- `createManualEngagement(input: ManualEngagementInput, me: { name: string })`, `attachQuoteToEngagement(engId, quoteId)`, `getEngagementByQuote`, `mergedConsultingPhases` — Task 3 store, Task 4 action imports; the regression test calls `createManualEngagement` with every `ManualEngagementInput` field.
- `CustomerLite`/`ConsultingData.customers` — Task 3 `data.ts`, consumed by the Task 4 modal (`customers[].locations[].id/label`, `contactNames`).
- `typeaheadMatches`, `catalogFilter`, `catalogRank`, `catalogMatches`, `CatalogLike` — Task 5, consumed in Task 6 (`catalogFilter`/`catalogRank` as module-level stable functions).
- `SearchFilterBar` props (`value/onChange/name/defaultValue/placeholder/ariaLabel/submit/children/style`) — Task 5, used exactly so in Task 7 (Venues uses `name/defaultValue/submit`).
- `Typeahead` props (`items/keyOf/filter/rank/render/onPick/labelOf/selectedKey/stayOpen/max/placeholder/ariaLabel/inputStyle/emptyText`) — Task 5, used in Task 6 with `render={(p) => …}` (the second `active` arg is optional to ignore).
- `Hit` (`{ sku, desc, category, mfr, list }`) — exported by `assembly-builder.tsx`, built in `assemblies/page.tsx` (Task 6).
- `GRID_SHAPES`, `GridShape`, `GRID_SHAPE_LABEL`, `DEFAULT_GRID_CATEGORY_SHAPES`, `isGridShape`, `resolveCategoryShapes`, `shapeFor`, `symbolGeometry`, `markerColor`, `SymbolShape({ shape, x, y, w, h, color, selected?, opacity? })`, `SymbolIcon({ shape, color, size?, title? })` — Task 8; consumed by Tasks 9 and 10 with those names.
- `setGridSymbolShape(id, shape | null)`, `setSymbolShapeAction(projectId, symbolId, shape)`, `createGridAssemblyAction({ …, shape? })`, `PartLite.shape`, `RiserGroup.category/shape`, `AppSettingsData.gridCategoryShapes` — Task 8; consumed by Task 9 (`editor.tsx`, `assemblies-panel.tsx`, `riser/page.tsx`, `page.tsx`) and Task 10 (`saveGridCategoryShapesAction`, `resolveCategoryShapes`).
- `designRedirect` `KNOWLEDGE_MOVES` — Task 1; the Task 2 stubs call `designRedirect("/design/steel", {})` / `("/design/fixtures", {})`, whose targets Task 1's checks pin.
- Decision numbers D154/D155 appear in code comments (`grid-symbols.ts`, `engagements.ts`, `consulting-stages.ts`, `actions.ts`, `settings.ts`) and in Task 11; renumber all together if `main` has taken them.
