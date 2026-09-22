# Dashboard Widget System — Reports + Home as build-your-own widgets (PUNCHLIST #43, wave A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One curated widget registry powers Home and Reports. Every existing Home card and every Reports panel becomes a registry widget; each user picks, orders and removes widgets per surface from a gallery; a global `?range=` timeframe drives history widgets and never the forward-looking ones; the spec's first backward widgets ($ quoted, avg margin, projected profit, open-projects list, backlog list, equipment-sold breakdown with drill) ship. Nothing that renders on `/` or `/reports` today disappears.

**Architecture:** Pure metadata registry (`src/lib/dashboard/registry.ts`: ids, size class, timeframe contract, `Perm` gate, per-surface presets, layout operations) + pure metrics module (moved out of `reports/page.tsx`, extended) + per-user layout blob (`blobs` row via `getBlob`/`setBlob`) + a server `WidgetHost` that resolves the layout, builds a memoised `DashboardData` loader, renders each widget's renderer inside a size-classed grid cell, and in `?customize=1` mode shows gallery/up/down/remove controls (small client islands calling one `saveLayoutAction`). Renderers live in `src/app/(app)/_dashboard/widgets/*` and wrap the existing `home-*.tsx` cards and the Reports chart primitives verbatim. Spec: `docs/superpowers/specs/2026-07-25-dashboard-widget-system-design.md`. Supersedes #7. Deferred to a follow-on plan (needs #15 + #39 mapping data): #15 install timeframe, pipeline/capacity widget (`capacity_bands`, trade split, stage weights, sits-awhile), scheduled-load widget, Installer preset.

**Tech Stack:** Next.js 16 App Router (async server components, `"use server"` actions, `searchParams` is a Promise), TypeScript 5, Drizzle on PGlite/Neon (no schema change in this plan), doc-store `getBlob`/`setBlob`, `tsx` harnesses (`test:specs` pure, `test:review:regressions` scratch DB, `test:smoke` real server).

## Global Constraints

- Node at `~/.local/node/bin`: `export PATH=$HOME/.local/node/bin:$PATH` first.
- **PGlite is single-process.** `test:specs` is pure and safe anytime. `test:review:regressions` and `test:smoke` each open their own throwaway DB — run them one at a time, never alongside `next dev` or any other `tsx` script; `ps aux | grep -E 'tsx|next dev'` must be empty first. Never run `npm run build` while a dev server holds `.data/pglite`. No `db:*` script is needed by this plan (no migration).
- **Client-bundle boundary:** `"use client"` files may only `import type` from anything reaching the doc-store. `src/lib/dashboard/registry.ts` and `src/lib/team.ts` are the only value imports allowed in the client islands (`frame-controls.tsx`, `gallery.tsx`). A leak fails `next build`/smoke, not tsc.
- **Never export a `const` array from a `"use client"` file for server consumption** (D90). The registry is a plain module.
- **Timestamps are epoch-ms.** `now` is read once per request in the host and passed down; pure functions take `now` as a parameter.
- **No emoji** in UI copy (#3). **Never hardcode the accent** — chart fills and active chips use `var(--accent)`; contrast text uses `var(--accent-contrast, #16181b)`.
- **Mobile widths (#33):** everything renders inside `HomeTabs`' `.pk-content` wrapper; headings use the fluid `--pk-h1/--pk-h2/--pk-h3` scale via `.pk-h1` etc. (no fixed `fontSize: 23`); the widget grid collapses 4 → 2 → 1 columns at 860px / 640px; every grid cell is `min-width: 0` so cards with `white-space: nowrap` rows never widen the page.
- **Charts follow the `dataviz` skill** (`/private/tmp/claude-501/bundled-skills/2.1.275/60aa036ba113b735b291670aad8e4b6c/dataviz/SKILL.md`): one hue light→dark for magnitude (accent over neutral `#dfe2e8`), categorical hues in fixed order never cycled, thin marks with 2px surface gaps, a legend whenever there are ≥ 2 series, values/labels in ink tokens never in the series colour, no dual axes, status colours never reused as a series. This plan moves existing charts verbatim and adds no new categorical palette; if a later task adds one, validate it with the skill's `scripts/validate_palette.js` before shipping.
- **`git add` only the files each task names.** Commit after every task with the `Co-Authored-By` trailer.
- **Spec-harness conventions:** `ok(cond, msg)` in `scripts/test-review-and-spec.ts`; pure checks go in the synchronous section (insert each block immediately above `async function asyncChecks()`); wrap each block in `{ }` because `NOW`, `DAY`, `sum` and similar names already exist at top level. An assertion that passes before the implementation exists is broken — confirm the RED run. Regression checks use `assert` inside `main()` of `scripts/test-review-regressions.ts`.
- **Verbatim moves.** Tasks 5–7 relocate JSX and data shaping; the only permitted shape change is resolving closures into VM rows (the D98 rule). If you find yourself redesigning a card, stop.

---

## Decisions taken (spec silent or conflicts with current code)

1. **Scope split.** This plan = spec build tasks 0, 2, 3, 4 and the "wrap existing Home cards" half of 6. #15, the pipeline/capacity widget, scheduled load and the Installer preset are a separate plan — they need #15's install window and #39's trade mapping, neither of which the backward widgets touch.
2. **Persistence = `blobs` row per user**, id `dashboard_layouts:<userId>`, keys `home` / `reports` holding `string[] | null` (`null` = "use the preset"). Reuses `getBlob`/`setBlob` (settings-style store, per-key atomic merge), so no table and no migration — D140 showed migrations are the expensive part. Keyed by `user.id` (`u1`), not the display name `notif_prefs` uses; the notifPrefs *pattern* (one row per user, sparse JSON) is kept.
3. **Role gates use existing `Perm`s.** Margin/profit widgets carry `perm: "approve"` (Admin/Manager/Reviewer). Consequence: Estimators no longer see "Avg. margin" / "Margin at completion" on Reports — spec-mandated. `users.roles` has no Installer, so there is one preset per surface filtered through the gate; `presetFor(surface, roles)` is the seam a later role preset plugs into.
4. **Edit mode is URL state `?customize=1`** (same house style as `?pipe`, `?view`). Reorder = Up/Down buttons, Remove per widget, Add from a gallery list, "Reset to default". No drag-and-drop dependency.
5. **Timeframe = `?range=qtr|6m|12m`** on both surfaces (the Reports param that exists today), default `6m`. Range chips render only when the layout contains a `history` widget (Home's preset has none, so Home looks like today). `?view=` and `?ir=` are dropped: forward widgets are fixed at the next 12 months per spec. `/reports?view=installs` still renders — the param is ignored.
6. **Fixed size classes** per widget in the registry (`tile` = 1/4, `half` = 2/4, `full` = 4/4) on an auto-flow grid. Home's former `minmax(0,1fr) 348px` two-column layout becomes: pipeline `full`; catalog, calendar, venue assessments, team activity, needs attention `half`.
7. **All metric tiles render through `KpiTile`.** The four Home stat tiles lose their bespoke markup (mono-font value) — the only visual change to existing content. `home-stats.tsx` is deleted in Task 9.
8. **Greeting and the `?sheet=` stage sheet stay page chrome on Home**, not widgets (identity + a modal).
9. **"Project profit" = projected**: Σ `value × margin` over the open book (the figure Reports already calls "Projected margin"), labelled "Projected profit". Actuals are not priced anywhere in the app.
10. **Open projects vs backlog**: open = `scheduled|install|training|signoff` (crews on site); backlog = `procurement|delivery` (sold, not yet on site). The Reports "Book by stage" list beside the map duplicates "Backlog value by stage" and is not migrated.
11. **Equipment sold** = won quotes (by `wonAt`) in range × `spec.sections[].items[]`, skipping `labor` sections/items and `option` lines; category via catalog sku → `category`; unknown skus → "Uncategorized"; drill via `?drill=<category>`.
12. **Charts move verbatim**, no new palette; the dataviz rules above constrain any later addition.
13. **Personal `my-*` widgets are Home-only**; business widgets are offered on both surfaces. Widget-local URL state (`?pipe`, `?sheet`, `?drill`) passes through `ctx.sp`; the untouched `pipeHref` links in `home-pipeline.tsx` drop `?range`/`?customize` (accepted, cosmetic).
14. **Renderers live in the private folder `src/app/(app)/_dashboard/`** (the `_letters` precedent). The registry is metadata-only so the client gallery and the spec harness can import it. `RENDERERS` is `Partial<Record<WidgetId, …>>` through Tasks 4–8 (the host shows "not available yet" for a missing renderer) and flips to `Record<…>` in Task 9 so tsc enforces completeness thereafter.
15. **A failing widget never takes the page down**: the host try/catches each renderer, logs, and renders "Couldn't load this widget."

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `src/lib/dashboard/registry.ts` | Pure: `WIDGETS`, `WidgetId`, sizes, timeframe, gates, `PRESETS`, `presetFor`, `normalizeLayout`, `addWidget`/`removeWidget`/`moveWidget`, `RANGES`/`resolveRange`, `layoutNeedsRange`, `dashHref` |
| `src/lib/dashboard/layout-store.ts` | Per-user layout blob: `layoutFor`, `saveLayout`, `resetLayout` |
| `src/lib/dashboard/metrics.ts` | Pure business metrics moved from Reports + new ones |
| `src/lib/dashboard/home-metrics.ts` | Pure Home-card shaping moved from `page.tsx` (`myQuoteStats`, `homeAlerts`, `shortMoney`, `resolvePipe`, `sheetHrefFor`) |
| `src/lib/dashboard/once.ts` | `once()` memoiser |
| `src/lib/dashboard/data.ts` | `makeDashboardData(user)` — memoised store loaders (server) |
| `src/lib/dashboard/context.ts` | `WidgetCtx`, `WidgetRenderer` types |
| `src/app/(app)/dashboard-actions.ts` | `saveLayoutAction`, `resetLayoutAction` |
| `src/app/(app)/_dashboard/host.tsx` | `WidgetHost` server component |
| `src/app/(app)/_dashboard/frame-controls.tsx` | client: Up / Down / Remove |
| `src/app/(app)/_dashboard/gallery.tsx` | client: Add list + Reset |
| `src/app/(app)/_dashboard/range-chips.tsx` | server: `?range=` chips |
| `src/app/(app)/_dashboard/renderers.tsx` | `RENDERERS` map |
| `src/app/(app)/_dashboard/charts.tsx` | `ChartCard`, `StackedBars`, `StageBars`, `Donut`, `MonoBadge`, `initialsOf`, `moneyK`, `pctDelta`, `ptDelta`, `monthLabel`, `monYear` (moved verbatim from `reports/page.tsx`) |
| `src/app/(app)/_dashboard/widgets/tile.tsx` | `tile()` helper over `KpiTile` |
| `src/app/(app)/_dashboard/widgets/home-cards.tsx` | Home card renderers |
| `src/app/(app)/_dashboard/widgets/sales.tsx` | Reports Sales renderers |
| `src/app/(app)/_dashboard/widgets/installs.tsx` | Reports Installs renderers |
| `src/app/(app)/_dashboard/widgets/backward.tsx` | New spec widgets (avg margin, projected profit, open projects, backlog, equipment sold) |

**Modified:** `src/app/globals.css`, `src/app/(app)/page.tsx`, `src/app/(app)/reports/page.tsx`, `scripts/test-review-and-spec.ts`, `scripts/test-review-regressions.ts`, `DECISIONS.md`, `PUNCHLIST.md`, `MASTER-HOWTO.md`.
**Deleted (Task 9):** `src/app/(app)/home-stats.tsx`.
**Untouched:** every other `home-*.tsx`, `reports/controls.tsx`, `nav-data.ts`, `home-tabs*.ts(x)`, `queue/**`.

---

### Task 1: Widget registry (pure)

**Files:**
- Create: `src/lib/dashboard/registry.ts`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces (all pure):**
```ts
export type Surface = "home" | "reports";
export type SizeClass = "tile" | "half" | "full";
export type Timeframe = "history" | "forward" | "none";
export type WidgetDef = { id: string; title: string; desc: string; size: SizeClass; timeframe: Timeframe; perm?: Perm; surfaces: readonly Surface[] };
export const WIDGETS: readonly WidgetDef[];   export type WidgetId;
export function widgetDef(id: string): WidgetDef | null;
export function canSee(w: WidgetDef, roles: string[]): boolean;
export function galleryFor(surface: Surface, roles: string[]): WidgetDef[];
export const PRESETS: Record<Surface, readonly WidgetId[]>;
export function presetFor(surface: Surface, roles: string[]): WidgetId[];
export function normalizeLayout(ids: readonly string[] | null | undefined, surface: Surface, roles: string[]): WidgetId[];
export function addWidget(ids: readonly string[], id: string): string[];
export function removeWidget(ids: readonly string[], id: string): string[];
export function moveWidget(ids: readonly string[], id: string, dir: -1 | 1): string[];
export const RANGES = ["qtr", "6m", "12m"] as const;  export type RangeKey;
export function resolveRange(v: string | undefined): RangeKey;
export function layoutNeedsRange(ids: readonly string[]): boolean;
export function dashHref(base: string, q: Record<string, string | undefined>): string;
```

- [ ] **Step 1: Failing spec tests** — insert above `async function asyncChecks()`:

```ts
/* ---- #43 §1 — widget registry (pure) ---- */
import {
  WIDGETS, PRESETS, presetFor, normalizeLayout, addWidget, removeWidget, moveWidget,
  galleryFor, resolveRange, layoutNeedsRange, widgetDef, dashHref,
} from "@/lib/dashboard/registry";
{
  const ids = WIDGETS.map((w) => w.id);
  ok(new Set(ids).size === ids.length, "#43 registry ids are unique");
  ok(WIDGETS.every((w) => ["tile", "half", "full"].includes(w.size)), "#43 every widget has a size class");
  ok(PRESETS.home.every((id) => !!widgetDef(id)) && PRESETS.reports.every((id) => !!widgetDef(id)), "#43 presets only name registered widgets");
  ok(PRESETS.home[0] === "my-open-pipeline" && PRESETS.home.includes("my-queue"), "#43 home preset starts with today's stat row and carries the queue card");
  const admin = ["Admin"], est = ["Estimator"];
  ok(presetFor("reports", admin).includes("book-margin"), "#43 admins see margin widgets");
  ok(!presetFor("reports", est).includes("book-margin"), "#43 estimators do not see margin widgets (approve gate)");
  ok(!galleryFor("reports", est).some((w) => w.perm === "approve"), "#43 gallery hides gated widgets");
  ok(!galleryFor("reports", admin).some((w) => w.id === "my-queue"), "#43 personal cards are home-only");
  ok(normalizeLayout(null, "home", est).join() === presetFor("home", est).join(), "#43 null layout resolves to the preset");
  ok(normalizeLayout([], "home", est).length === 0, "#43 an emptied layout stays empty");
  ok(normalizeLayout(["nope", "my-queue", "my-queue", "book-margin"], "home", est).join() === "my-queue", "#43 normalize drops unknown, duplicate and gated ids");
  ok(normalizeLayout(["my-queue"], "reports", admin).length === 0, "#43 normalize drops widgets not offered on the surface");
  ok(addWidget(["a"], "b").join() === "a,b" && addWidget(["a"], "a").join() === "a", "#43 addWidget appends once");
  ok(removeWidget(["a", "b"], "a").join() === "b", "#43 removeWidget");
  ok(moveWidget(["a", "b", "c"], "c", -1).join() === "a,c,b", "#43 moveWidget up");
  ok(moveWidget(["a", "b", "c"], "a", -1).join() === "a,b,c", "#43 moveWidget clamps at the top");
  ok(moveWidget(["a", "b", "c"], "a", 1).join() === "b,a,c", "#43 moveWidget down");
  ok(resolveRange("12m") === "12m" && resolveRange("bogus") === "6m" && resolveRange(undefined) === "6m", "#43 resolveRange defaults to 6m");
  ok(!layoutNeedsRange(["my-queue"]) && layoutNeedsRange(["my-queue", "total-quoted"]), "#43 range chips only when a history widget is on the layout");
  ok(dashHref("/", { range: "12m", customize: undefined }) === "/?range=12m" && dashHref("/reports", {}) === "/reports", "#43 dashHref drops empty params");
}
```

- [ ] **Step 2: Run** `npx tsx scripts/test-review-and-spec.ts 2>&1 | head -3` → `Cannot find module '@/lib/dashboard/registry'`.

- [ ] **Step 3: Write `src/lib/dashboard/registry.ts`**

```ts
/**
 * #43 — the dashboard widget registry. Metadata ONLY: ids, titles, size
 * class, role gate, timeframe contract, per-surface presets and the pure
 * layout operations. No renderers and no stores: this module is imported by
 * the client gallery and by the spec harness, so it must stay dependency-
 * free (team.ts is the one import and is itself pure).
 *
 * Contract every widget declares:
 *  - size:      tile (1/4 width) | half (2/4) | full (4/4), auto-flow grid
 *  - timeframe: history = honours ?range; forward = always the next 12
 *               months, exempt from ?range; none = live snapshot
 *  - perm:      permission needed to see it (undefined = everyone)
 *  - surfaces:  where the gallery offers it
 */
import { can, type Perm } from "@/lib/team";

export type Surface = "home" | "reports";
export type SizeClass = "tile" | "half" | "full";
export type Timeframe = "history" | "forward" | "none";

export type WidgetDef = {
  id: string;
  title: string;
  desc: string;
  size: SizeClass;
  timeframe: Timeframe;
  perm?: Perm;
  surfaces: readonly Surface[];
};

const HOME: readonly Surface[] = ["home"];
const BOTH: readonly Surface[] = ["home", "reports"];

export const WIDGETS = [
  /* ---- Home cards (personal, home-only) ---- */
  { id: "my-open-pipeline", title: "Open pipeline", desc: "Value of your draft and sent quotes.", size: "tile", timeframe: "none", surfaces: HOME },
  { id: "my-win-rate", title: "Win rate", desc: "Your won vs lost quotes, all time.", size: "tile", timeframe: "none", surfaces: HOME },
  { id: "my-out-for-signature", title: "Out for signature", desc: "Your quotes currently sent.", size: "tile", timeframe: "none", surfaces: HOME },
  { id: "my-avg-quote", title: "Avg quote", desc: "Average value of your quotes.", size: "tile", timeframe: "none", surfaces: HOME },
  { id: "my-queue", title: "My Queue", desc: "Open and overdue items from your queue.", size: "full", timeframe: "none", surfaces: HOME },
  { id: "inbox", title: "Inbox", desc: "Threads waiting on a reply, per mailbox.", size: "full", timeframe: "none", surfaces: HOME },
  { id: "my-leads", title: "My leads", desc: "Follow-up worklist for leads you own.", size: "full", timeframe: "none", surfaces: HOME },
  { id: "my-designs", title: "My designs", desc: "Your budgetary designs in the sandbox.", size: "full", timeframe: "none", surfaces: HOME },
  { id: "my-pipeline", title: "My pipeline", desc: "Your quotes by status with the stage sheet.", size: "full", timeframe: "none", surfaces: HOME },
  { id: "catalog", title: "Catalog", desc: "Price books and part counts.", size: "half", timeframe: "none", surfaces: HOME },
  { id: "calendar", title: "Calendar", desc: "Your next 14 days.", size: "half", timeframe: "none", surfaces: HOME },
  { id: "venue-assessments", title: "Venue assessments", desc: "Recent assessments and pending syncs.", size: "half", timeframe: "none", surfaces: HOME },
  { id: "team-activity", title: "Team activity", desc: "What everyone else touched recently.", size: "half", timeframe: "none", surfaces: HOME },
  { id: "needs-attention", title: "Needs attention", desc: "Reviews waiting on you and stale sent quotes.", size: "half", timeframe: "none", surfaces: HOME },
  /* ---- Reports: Sales ---- */
  { id: "total-quoted", title: "Total quoted", desc: "Value of quotes created in the period.", size: "tile", timeframe: "history", surfaces: BOTH },
  { id: "won-value", title: "Won value", desc: "Value of quotes won in the period.", size: "tile", timeframe: "history", surfaces: BOTH },
  { id: "win-rate", title: "Win rate", desc: "Company win rate for quotes decided in the period.", size: "tile", timeframe: "history", surfaces: BOTH },
  { id: "avg-quote", title: "Avg. quote", desc: "Average value of quotes created in the period.", size: "tile", timeframe: "history", surfaces: BOTH },
  { id: "quoted-vs-won", title: "Quoted vs. won", desc: "Quoted and won value per bucket.", size: "full", timeframe: "history", surfaces: BOTH },
  { id: "pipeline-by-stage", title: "Open pipeline by stage", desc: "Draft, sent and in-review value right now.", size: "half", timeframe: "none", surfaces: BOTH },
  { id: "win-donut", title: "Win rate (decided)", desc: "Won vs lost quotes decided in the period.", size: "half", timeframe: "history", surfaces: BOTH },
  { id: "top-customers", title: "Top customers", desc: "Customers by won value in the period.", size: "half", timeframe: "history", surfaces: BOTH },
  { id: "pipeline-by-estimator", title: "Pipeline by estimator", desc: "Open, won and win rate per team member, all time.", size: "full", timeframe: "none", surfaces: BOTH },
  /* ---- Reports: Installs (forward = next 12 months) ---- */
  { id: "backlog-value", title: "Backlog value", desc: "Open project value landing in the next 12 months.", size: "tile", timeframe: "forward", surfaces: BOTH },
  { id: "to-be-billed", title: "To be billed", desc: "Value billed at landing in the next 12 months.", size: "tile", timeframe: "forward", surfaces: BOTH },
  { id: "expected-collected", title: "Expected collected", desc: "Net-30 collections in the next 12 months.", size: "tile", timeframe: "forward", surfaces: BOTH },
  { id: "book-margin", title: "Margin at completion", desc: "Blended margin across the open book.", size: "tile", timeframe: "forward", perm: "approve", surfaces: BOTH },
  { id: "billing-forecast", title: "Billing forecast", desc: "Installs and consulting milestones, billed vs collected.", size: "full", timeframe: "forward", surfaces: BOTH },
  { id: "backlog-by-stage", title: "Backlog value by stage", desc: "Open book grouped by project stage.", size: "half", timeframe: "forward", surfaces: BOTH },
  { id: "margin-donut", title: "Margin at completion (detail)", desc: "Projected margin vs estimated cost.", size: "half", timeframe: "forward", perm: "approve", surfaces: BOTH },
  { id: "upcoming-completions", title: "Upcoming completions", desc: "Next six projects to land.", size: "half", timeframe: "forward", surfaces: BOTH },
  { id: "completion-timeline", title: "Completion timeline", desc: "Where each open project lands.", size: "full", timeframe: "forward", surfaces: BOTH },
  { id: "project-locations", title: "Project locations", desc: "Open projects on the map, sized by value.", size: "full", timeframe: "forward", surfaces: BOTH },
  /* ---- Spec task 4: backward widgets ---- */
  { id: "avg-margin", title: "Avg. margin", desc: "Value-weighted quote margin for quotes created in the period.", size: "tile", timeframe: "history", perm: "approve", surfaces: BOTH },
  { id: "projected-profit", title: "Projected profit", desc: "Value times margin across the open book.", size: "tile", timeframe: "forward", perm: "approve", surfaces: BOTH },
  { id: "open-projects", title: "Open projects", desc: "Projects with crews scheduled or on site.", size: "half", timeframe: "none", surfaces: BOTH },
  { id: "backlog", title: "Backlog", desc: "Sold projects still in procurement or delivery.", size: "half", timeframe: "none", surfaces: BOTH },
  { id: "equipment-sold", title: "Equipment sold", desc: "Won line items by catalog category, with item drill-down.", size: "half", timeframe: "history", surfaces: BOTH },
] as const satisfies readonly WidgetDef[];

export type WidgetId = (typeof WIDGETS)[number]["id"];

const BY_ID: Record<string, WidgetDef> = Object.fromEntries(WIDGETS.map((w) => [w.id, w]));

export function widgetDef(id: string): WidgetDef | null {
  return BY_ID[id] ?? null;
}

export function canSee(w: WidgetDef, roles: string[]): boolean {
  return !w.perm || can(w.perm, roles);
}

export function galleryFor(surface: Surface, roles: string[]): WidgetDef[] {
  return WIDGETS.filter((w) => w.surfaces.includes(surface) && canSee(w, roles));
}

/** Starting layouts. Home = today's Dashboard order; Reports = today's
 *  Sales view then today's Installs view. The new backward widgets are
 *  gallery picks, not defaults, so nobody's screen changes on upgrade. */
export const PRESETS: Record<Surface, readonly WidgetId[]> = {
  home: [
    "my-open-pipeline", "my-win-rate", "my-out-for-signature", "my-avg-quote",
    "my-queue", "inbox", "my-leads", "my-designs", "my-pipeline",
    "catalog", "calendar", "venue-assessments", "team-activity", "needs-attention",
  ],
  reports: [
    "total-quoted", "won-value", "win-rate", "avg-quote",
    "quoted-vs-won", "pipeline-by-stage", "win-donut", "top-customers", "pipeline-by-estimator",
    "backlog-value", "to-be-billed", "expected-collected", "book-margin",
    "billing-forecast", "backlog-by-stage", "margin-donut", "upcoming-completions",
    "completion-timeline", "project-locations",
  ],
};

export function presetFor(surface: Surface, roles: string[]): WidgetId[] {
  return PRESETS[surface].filter((id) => canSee(BY_ID[id], roles));
}

/** null/undefined = "never customized" → preset. Otherwise keep only ids
 *  that exist, are offered on this surface, pass the gate, and appear once. */
export function normalizeLayout(
  ids: readonly string[] | null | undefined,
  surface: Surface,
  roles: string[]
): WidgetId[] {
  if (ids == null) return presetFor(surface, roles);
  const seen = new Set<string>();
  const out: WidgetId[] = [];
  for (const id of ids) {
    const w = BY_ID[id];
    if (!w || seen.has(id) || !w.surfaces.includes(surface) || !canSee(w, roles)) continue;
    seen.add(id);
    out.push(id as WidgetId);
  }
  return out;
}

export function addWidget(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? [...ids] : [...ids, id];
}

export function removeWidget(ids: readonly string[], id: string): string[] {
  return ids.filter((x) => x !== id);
}

export function moveWidget(ids: readonly string[], id: string, dir: -1 | 1): string[] {
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return [...ids];
  const next = [...ids];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export const RANGES = ["qtr", "6m", "12m"] as const;
export type RangeKey = (typeof RANGES)[number];
export const RANGE_LABEL: Record<RangeKey, string> = { qtr: "Quarter", "6m": "6 months", "12m": "12 months" };

export function resolveRange(v: string | undefined): RangeKey {
  return (RANGES as readonly string[]).includes(v || "") ? (v as RangeKey) : "6m";
}

export function layoutNeedsRange(ids: readonly string[]): boolean {
  return ids.some((id) => BY_ID[id]?.timeframe === "history");
}

/** Build a surface href keeping only the params that are set. */
export function dashHref(base: string, q: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}
```

- [ ] **Step 4: Verify** `npx tsx scripts/test-review-and-spec.ts | grep -E '#43|ALL PASSED'` → 20 PASS + `ALL PASSED`; `npx tsc --noEmit -p . | tail -3` → empty.

- [ ] **Step 5: Commit**
```bash
git add src/lib/dashboard/registry.ts scripts/test-review-and-spec.ts
git commit -m "feat(dashboard): pure widget registry — ids, size classes, gates, presets, layout ops (#43 §1)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Per-user layout store + server actions

**Files:**
- Create: `src/lib/dashboard/layout-store.ts`, `src/app/(app)/dashboard-actions.ts`
- Test: `scripts/test-review-regressions.ts`

**Interfaces:**
```ts
// layout-store.ts
export async function layoutFor(userId: string, surface: Surface, roles: string[]): Promise<{ ids: WidgetId[]; customized: boolean }>;
export async function saveLayout(userId: string, surface: Surface, ids: string[], roles: string[]): Promise<WidgetId[]>;
export async function resetLayout(userId: string, surface: Surface): Promise<void>;
// dashboard-actions.ts ("use server", requireUser)
export async function saveLayoutAction(surface: Surface, ids: string[]): Promise<{ ok: boolean }>;
export async function resetLayoutAction(surface: Surface): Promise<{ ok: boolean }>;
```

- [ ] **Step 1: Failing regression test** — append inside `main()`:

```ts
  // #43 — per-user layouts persist in the blobs table, one key per surface
  const { layoutFor, saveLayout, resetLayout } = await import("@/lib/dashboard/layout-store");
  const { presetFor } = await import("@/lib/dashboard/registry");
  const fresh = await layoutFor("u-t43", "home", ["Admin"]);
  assert.equal(fresh.customized, false, "#43 no row → preset");
  assert.deepEqual(fresh.ids, presetFor("home", ["Admin"]), "#43 preset ids when nothing stored");
  await saveLayout("u-t43", "home", ["my-queue", "bogus", "my-queue"], ["Admin"]);
  const saved = await layoutFor("u-t43", "home", ["Admin"]);
  assert.deepEqual(saved.ids, ["my-queue"], "#43 save normalizes before writing");
  assert.equal(saved.customized, true, "#43 a stored row marks the layout customized");
  await saveLayout("u-t43", "reports", ["total-quoted"], ["Admin"]);
  assert.deepEqual((await layoutFor("u-t43", "home", ["Admin"])).ids, ["my-queue"], "#43 saving reports leaves home untouched (per-key merge)");
  await resetLayout("u-t43", "home");
  assert.equal((await layoutFor("u-t43", "home", ["Admin"])).customized, false, "#43 reset returns to the preset");
```

- [ ] **Step 2: Run** (nothing else holding a DB) `npm run test:review:regressions 2>&1 | tail -3` → `Cannot find module '@/lib/dashboard/layout-store'`.

- [ ] **Step 3: `src/lib/dashboard/layout-store.ts`**

```ts
/**
 * #43 — per-user dashboard layouts. One blobs row per user
 * (`dashboard_layouts:<userId>`), one key per surface. `null` for a surface
 * means "never customized" → the role preset. Same shape as the notifPrefs
 * row (per-user, sparse JSON) but keyed by user id and stored through the
 * settings-style getBlob/setBlob so no table or migration is needed.
 */
import { getBlob, setBlob } from "@/db/doc-store";
import { normalizeLayout, type Surface, type WidgetId } from "./registry";

type Stored = { home: string[] | null; reports: string[] | null };
const EMPTY: Stored = { home: null, reports: null };
const blobId = (userId: string) => `dashboard_layouts:${userId}`;

async function storedLayout(userId: string, surface: Surface): Promise<string[] | null> {
  const row = await getBlob<Stored>(blobId(userId), EMPTY);
  const v = row[surface];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;
}

export async function layoutFor(
  userId: string,
  surface: Surface,
  roles: string[]
): Promise<{ ids: WidgetId[]; customized: boolean }> {
  const stored = await storedLayout(userId, surface);
  return { ids: normalizeLayout(stored, surface, roles), customized: stored !== null };
}

/** Normalizes before writing so a stale client list can't persist junk. */
export async function saveLayout(
  userId: string,
  surface: Surface,
  ids: string[],
  roles: string[]
): Promise<WidgetId[]> {
  const next = normalizeLayout(ids, surface, roles);
  await setBlob(blobId(userId), { [surface]: next });
  return next;
}

export async function resetLayout(userId: string, surface: Surface): Promise<void> {
  await setBlob(blobId(userId), { [surface]: null });
}
```

- [ ] **Step 4: `src/app/(app)/dashboard-actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { resetLayout, saveLayout } from "@/lib/dashboard/layout-store";
import type { Surface } from "@/lib/dashboard/registry";

/** #43 — layout mutations for the Home and Reports widget hosts. The
 *  client sends the whole id list; the store normalizes (unknown, gated,
 *  duplicate ids dropped) so nothing the client says is trusted. */

const SURFACES: readonly Surface[] = ["home", "reports"];
const pathOf = (s: Surface) => (s === "home" ? "/" : "/reports");

export async function saveLayoutAction(surface: Surface, ids: string[]): Promise<{ ok: boolean }> {
  const me = await requireUser();
  if (!SURFACES.includes(surface) || !Array.isArray(ids)) return { ok: false };
  await saveLayout(me.id, surface, ids.map(String), me.roles);
  revalidatePath(pathOf(surface));
  return { ok: true };
}

export async function resetLayoutAction(surface: Surface): Promise<{ ok: boolean }> {
  const me = await requireUser();
  if (!SURFACES.includes(surface)) return { ok: false };
  await resetLayout(me.id, surface);
  revalidatePath(pathOf(surface));
  return { ok: true };
}
```

- [ ] **Step 5: Verify** `npm run test:review:regressions 2>&1 | tail -3` → passes; `npx tsc --noEmit -p . | tail -3` → empty.

- [ ] **Step 6: Commit**
```bash
git add src/lib/dashboard/layout-store.ts "src/app/(app)/dashboard-actions.ts" scripts/test-review-regressions.ts
git commit -m "feat(dashboard): per-user layout blob + save/reset actions (#43 §2)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Pure metrics module

**Files:**
- Create: `src/lib/dashboard/metrics.ts`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
```ts
export const DAY: number;
export type Bucket = { start: number; end: number; label: string };
export function lastMonths(k: number, now: number): Bucket[];
export function salesBuckets(range: RangeKey, now: number): Bucket[];
export function periodBounds(range: RangeKey, now: number): { start: number; end: number; priorStart: number };
export function wonAt(q: Quote): number;   export function decidedAt(q: Quote): number;
export type SalesMetrics = { quotedValue: number; avg: number; wonValue: number; won: number; lost: number; winRate: number; avgMargin: number };
export function salesMetrics(quotes: Quote[], a: number, b: number): SalesMetrics;
export function projectedProfit(projects: ProjectRecord[]): { value: number; profit: number; margin: number };
export const ACTIVE_STAGES: readonly ProjectStage[];  export const BACKLOG_STAGES: readonly ProjectStage[];
export function openProjects(projects: ProjectRecord[]): ProjectRecord[];
export function backlogProjects(projects: ProjectRecord[]): ProjectRecord[];
export type SoldItem = { sku: string; desc: string; qty: number; value: number };
export type SoldCategory = { category: string; value: number; qty: number; items: SoldItem[] };
export function equipmentSold(quotes: Quote[], partCategory: (sku: string) => string | undefined, a: number, b: number): SoldCategory[];
export type ForecastBucket = { start: number; billed: number; collected: number };
export function installsForecast(projects: ProjectRecord[], engagements: ConsultingEngagement[], now: number, horizonMonths: number): {
  book: ProjectRecord[]; totalValue: number; blended: number; cost: number; buckets: ForecastBucket[]; bucketMs: number;
  toBill: number; collected: number; byStage: Array<{ stage: string; count: number; value: number }>; upcoming: ProjectRecord[]; timeline: ProjectRecord[]; windowMs: number;
};
```

- [ ] **Step 1: Failing spec tests** — above `asyncChecks()` (add `import type { Quote } from "@/lib/stores/quotes"; import type { ProjectRecord } from "@/lib/stores/projects";` only if not already imported):

```ts
/* ---- #43 §3 — dashboard metrics (pure) ---- */
import {
  salesBuckets, periodBounds, salesMetrics, wonAt, projectedProfit, openProjects, backlogProjects,
  equipmentSold, installsForecast,
} from "@/lib/dashboard/metrics";
{
  const T = Date.UTC(2026, 8, 15, 12);
  const D = 86_400_000;
  ok(salesBuckets("qtr", T).length === 3 && salesBuckets("6m", T).length === 6 && salesBuckets("12m", T).length === 4, "#43 buckets: qtr=3 months, 6m=6 months, 12m=4 quarters");
  const pb = periodBounds("6m", T);
  ok(pb.start < T && pb.priorStart < pb.start && pb.start - pb.priorStart === T - pb.start, "#43 prior period is the same length as the current one");
  const q = (o: Record<string, unknown>) => ({ id: "Q", name: "", customer: "", customerId: null, locationId: null, value: 0, margin: 0, status: "draft", source: "estimator", owner: "A", review: { state: "none" }, createdAt: T - D, updatedAt: T - D, history: [], ...o }) as unknown as Quote;
  const won = q({ id: "W", value: 1000, margin: 0.4, status: "won", history: [{ at: T - 2 * D, from: "sent", to: "won" }] });
  ok(wonAt(won) === T - 2 * D, "#43 wonAt reads the last won transition");
  const m = salesMetrics([won, q({ id: "L", value: 500, margin: 0.2, status: "lost", history: [{ at: T - D, from: "sent", to: "lost" }] }), q({ id: "O", value: 200, createdAt: T - 400 * D })], T - 30 * D, T + 1);
  ok(m.quotedValue === 1500 && m.won === 1 && m.lost === 1 && m.winRate === 50, "#43 salesMetrics counts created/won/lost in range");
  ok(Math.abs(m.avgMargin - (1000 * 0.4 + 500 * 0.2) / 1500) < 1e-9, "#43 avgMargin is value-weighted over quotes created in range");
  const p = (o: Record<string, unknown>) => ({ id: "P", kind: "project", quoteId: null, projectType: null, name: "", customer: "", customerId: null, locationId: null, owner: "A", value: 0, margin: 0, createdAt: T, updatedAt: T, startedAt: T, targetDate: null, installStart: null, installEnd: null, stage: "procurement", stageHistory: [], procurement: [], mobilizations: [], deliveries: [], crew: [], tasks: [], notes: [], timeLogs: [], signoff: null, trainingAt: null, ...o }) as unknown as ProjectRecord;
  const ps = [p({ id: "A", value: 1000, margin: 0.3, stage: "install", targetDate: T + 20 * D }), p({ id: "B", value: 500, margin: 0.5, stage: "procurement", targetDate: T + 60 * D }), p({ id: "C", value: 999, margin: 0.9, stage: "complete" })];
  const pp = projectedProfit(ps);
  ok(pp.value === 1500 && pp.profit === 550, "#43 projected profit sums value*margin over the open book only");
  ok(openProjects(ps).map((x) => x.id).join() === "A" && backlogProjects(ps).map((x) => x.id).join() === "B", "#43 open = on-site stages, backlog = procurement/delivery");
  const sold = q({ id: "S", status: "won", history: [{ at: T - D, from: "sent", to: "won" }], spec: { sections: [{ kind: "materials", items: [{ sku: "FX-1", desc: "Fixture", qty: 2, price: 100 }, { sku: "LAB", desc: "Labor", qty: 1, price: 999, labor: true }, { sku: "OPT", desc: "Option", qty: 1, price: 50, option: true }] }, { kind: "labor", items: [{ sku: "X", qty: 1, price: 1 }] }] } });
  const es = equipmentSold([sold], (sku) => (sku === "FX-1" ? "Lighting Fixtures" : undefined), T - 30 * D, T + 1);
  ok(es.length === 1 && es[0].category === "Lighting Fixtures" && es[0].value === 200 && es[0].items[0].qty === 2, "#43 equipmentSold skips labor/option lines and joins category by sku");
  const f = installsForecast(ps, [], T, 12);
  ok(f.book.length === 2 && f.totalValue === 1500 && f.buckets.length === 6, "#43 installsForecast: open book within horizon, six buckets");
  ok(f.toBill === 1500 && f.byStage.length === 2, "#43 toBill sums targets inside the horizon; byStage groups the book");
}
```

- [ ] **Step 2: Run** → import error for `@/lib/dashboard/metrics`.

- [ ] **Step 3: Write `src/lib/dashboard/metrics.ts`** — the bucketing, `wonAt`/`decidedAt`, sales metrics and the Installs book/forecast maths are moved from `reports/page.tsx` (`lastMonths` 73–86, `salesBuckets` 88–100, `wonAt`/`decidedAt` 505–512, `metrics` closure 521–536, `InstallsView` 883–967) with `now` made a parameter:

```ts
/**
 * #43 — business metrics for dashboard widgets. Pure over arrays so the
 * spec harness can drive them; `now` is always a parameter. The bucketing
 * and forecast maths were lifted verbatim from reports/page.tsx.
 */
import type { Quote } from "@/lib/stores/quotes";
import type { ProjectRecord, ProjectStage } from "@/lib/stores/projects";
import type { ConsultingEngagement } from "@/lib/stores/engagements";
import type { RangeKey } from "./registry";

export const DAY = 86_400_000;

export type Bucket = { start: number; end: number; label: string };

export function lastMonths(k: number, now: number): Bucket[] {
  const d = new Date(now);
  const arr: Bucket[] = [];
  for (let i = k - 1; i >= 0; i--) {
    const start = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const end = new Date(d.getFullYear(), d.getMonth() - i + 1, 1);
    arr.push({ start: start.getTime(), end: end.getTime(), label: start.toLocaleDateString("en-US", { month: "short" }) });
  }
  return arr;
}

export function salesBuckets(range: RangeKey, now: number): Bucket[] {
  if (range === "qtr") return lastMonths(3, now);
  if (range === "12m") {
    const m = lastMonths(12, now);
    const q: Bucket[] = [];
    for (let i = 0; i < 4; i++) {
      const chunk = m.slice(i * 3, i * 3 + 3);
      q.push({ start: chunk[0].start, end: chunk[2].end, label: `Q${i + 1}` });
    }
    return q;
  }
  return lastMonths(6, now);
}

export function periodBounds(range: RangeKey, now: number): { start: number; end: number; priorStart: number } {
  const start = salesBuckets(range, now)[0].start;
  return { start, end: now + 1, priorStart: start - (now - start) };
}

export function wonAt(q: Quote): number {
  const h = (q.history || []).filter((e) => e.to === "won");
  return h.length ? h[h.length - 1].at : q.updatedAt || 0;
}
export function decidedAt(q: Quote): number {
  const h = (q.history || []).filter((e) => e.to === "won" || e.to === "lost");
  return h.length ? h[h.length - 1].at : q.updatedAt || 0;
}

const sumValue = (arr: Array<{ value: number }>) => arr.reduce((s, x) => s + (x.value || 0), 0);

export type SalesMetrics = {
  quotedValue: number; avg: number; wonValue: number; won: number; lost: number; winRate: number;
  /** value-weighted quote.margin over quotes created in [a, b) */
  avgMargin: number;
};

export function salesMetrics(quotes: Quote[], a: number, b: number): SalesMetrics {
  const created = quotes.filter((q) => (q.createdAt || 0) >= a && (q.createdAt || 0) < b);
  const quotedValue = sumValue(created);
  const wonList = quotes.filter((q) => q.status === "won" && wonAt(q) >= a && wonAt(q) < b);
  const lostList = quotes.filter((q) => q.status === "lost" && decidedAt(q) >= a && decidedAt(q) < b);
  const decided = wonList.length + lostList.length;
  const marginDollars = created.reduce((s, q) => s + (q.value || 0) * (q.margin || 0), 0);
  return {
    quotedValue,
    avg: created.length ? quotedValue / created.length : 0,
    wonValue: sumValue(wonList),
    won: wonList.length,
    lost: lostList.length,
    winRate: decided ? (wonList.length / decided) * 100 : 0,
    avgMargin: quotedValue ? marginDollars / quotedValue : 0,
  };
}

/* ---- projects ---- */

export const ACTIVE_STAGES: readonly ProjectStage[] = ["scheduled", "install", "training", "signoff"];
export const BACKLOG_STAGES: readonly ProjectStage[] = ["procurement", "delivery"];

const byTarget = (a: ProjectRecord, b: ProjectRecord) =>
  (a.targetDate ?? Number.MAX_SAFE_INTEGER) - (b.targetDate ?? Number.MAX_SAFE_INTEGER);

export function openProjects(projects: ProjectRecord[]): ProjectRecord[] {
  return projects.filter((p) => ACTIVE_STAGES.includes(p.stage)).sort(byTarget);
}
export function backlogProjects(projects: ProjectRecord[]): ProjectRecord[] {
  return projects.filter((p) => BACKLOG_STAGES.includes(p.stage)).sort(byTarget);
}

/** "Project profit" v1 (decision 9): projected, value × margin over the open book. */
export function projectedProfit(projects: ProjectRecord[]): { value: number; profit: number; margin: number } {
  const book = projects.filter((p) => p.stage !== "complete");
  const value = sumValue(book);
  const profit = book.reduce((s, p) => s + (p.value || 0) * (p.margin || 0), 0);
  return { value, profit, margin: value ? profit / value : 0 };
}

/* ---- equipment sold ---- */

type SpecLike = {
  sections?: Array<{
    kind?: string;
    items?: Array<{ sku?: string; desc?: string; qty?: number; price?: number; labor?: boolean; option?: boolean }>;
  }>;
};

export type SoldItem = { sku: string; desc: string; qty: number; value: number };
export type SoldCategory = { category: string; value: number; qty: number; items: SoldItem[] };

export function equipmentSold(
  quotes: Quote[],
  partCategory: (sku: string) => string | undefined,
  a: number,
  b: number
): SoldCategory[] {
  const cats = new Map<string, { value: number; qty: number; items: Map<string, SoldItem> }>();
  for (const q of quotes) {
    if (q.status !== "won") continue;
    const at = wonAt(q);
    if (at < a || at >= b) continue;
    for (const s of ((q.spec as SpecLike | undefined)?.sections) || []) {
      if (s.kind === "labor") continue;
      for (const it of s.items || []) {
        if (it.labor || it.option) continue;
        const sku = it.sku || "";
        const category = (sku && partCategory(sku)) || "Uncategorized";
        const qty = it.qty || 0;
        const value = qty * (it.price || 0);
        const c = cats.get(category) || { value: 0, qty: 0, items: new Map() };
        c.value += value;
        c.qty += qty;
        const key = sku || it.desc || "?";
        const row = c.items.get(key) || { sku, desc: it.desc || sku, qty: 0, value: 0 };
        row.qty += qty;
        row.value += value;
        c.items.set(key, row);
        cats.set(category, c);
      }
    }
  }
  return [...cats.entries()]
    .map(([category, c]) => ({ category, value: c.value, qty: c.qty, items: [...c.items.values()].sort((x, y) => y.value - x.value) }))
    .sort((x, y) => y.value - x.value);
}

/* ---- installs book + billing forecast (forward, always 12 months) ---- */

export type ForecastBucket = { start: number; billed: number; collected: number };

export function installsForecast(
  projects: ProjectRecord[],
  engagements: ConsultingEngagement[],
  now: number,
  horizonMonths: number
) {
  const H = horizonMonths;
  const windowMs = H * 30 * DAY;
  const horizonEnd = now + windowMs;
  const book = projects.filter((p) => p.stage !== "complete" && (p.targetDate == null || p.targetDate <= horizonEnd));
  const totalValue = sumValue(book);
  const blended = totalValue ? book.reduce((a, p) => a + (p.value || 0) * (p.margin || 0), 0) / totalValue : 0;
  const cost = Math.round(totalValue * (1 - blended));

  // Full value billed at landing (targetDate), collected net-30 after.
  // Consulting milestone fees (D90) land the same way — forecast-only.
  const msPoints = engagements
    .flatMap((e) => e.milestones)
    .filter((m) => !m.completedAt && (m.amount || 0) > 0 && m.targetDate > 0 && m.targetDate <= horizonEnd);
  const bC = 6;
  const bucketMs = windowMs / bC;
  const buckets: ForecastBucket[] = [];
  for (let i = 0; i < bC; i++) {
    const lo = now + i * bucketMs;
    const hi = now + (i + 1) * bucketMs;
    let billed = 0;
    let collected = 0;
    book.forEach((p) => {
      const land = p.targetDate || 0;
      if (land >= lo && land < hi) billed += p.value || 0;
      const coll = land + 30 * DAY;
      if (coll >= lo && coll < hi) collected += p.value || 0;
    });
    msPoints.forEach((m) => {
      if (m.targetDate >= lo && m.targetDate < hi) billed += m.amount || 0;
      const coll = m.targetDate + 30 * DAY;
      if (coll >= lo && coll < hi) collected += m.amount || 0;
    });
    buckets.push({ start: lo, billed, collected });
  }
  const toBill =
    sumValue(book.filter((p) => (p.targetDate || 0) >= now && (p.targetDate || 0) <= horizonEnd)) +
    msPoints.filter((m) => m.targetDate >= now).reduce((a, m) => a + (m.amount || 0), 0);
  const collected =
    sumValue(book.filter((p) => (p.targetDate || 0) + 30 * DAY >= now && (p.targetDate || 0) + 30 * DAY <= horizonEnd)) +
    msPoints.filter((m) => m.targetDate + 30 * DAY >= now && m.targetDate + 30 * DAY <= horizonEnd).reduce((a, m) => a + (m.amount || 0), 0);

  const stageMap = new Map<string, { value: number; count: number }>();
  book.forEach((p) => {
    const e = stageMap.get(p.stage) || { value: 0, count: 0 };
    e.value += p.value || 0;
    e.count += 1;
    stageMap.set(p.stage, e);
  });
  const byStage = [...stageMap.entries()].map(([stage, e]) => ({ stage, count: e.count, value: e.value }));

  const timeline = [...book].sort((a, b) => (a.targetDate || 0) - (b.targetDate || 0));
  return { book, totalValue, blended, cost, buckets, bucketMs, toBill, collected, byStage, upcoming: timeline.slice(0, 6), timeline, windowMs };
}
```

- [ ] **Step 4: Verify** specs → 10 new PASS + ALL PASSED; tsc clean. (`ConsultingEngagement.milestones[]` fields `amount`, `targetDate`, `completedAt` — confirm against `src/lib/stores/engagements.ts` exactly as `reports/page.tsx:900-902` uses them.)

- [ ] **Step 5: Commit**
```bash
git add src/lib/dashboard/metrics.ts scripts/test-review-and-spec.ts
git commit -m "feat(dashboard): pure metrics — sales buckets, forecast, projected profit, equipment sold (#43 §3, §4)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Widget host, data loader, grid CSS, customize controls

**Files:**
- Create: `src/lib/dashboard/once.ts`, `src/lib/dashboard/context.ts`, `src/lib/dashboard/data.ts`, `src/app/(app)/_dashboard/host.tsx`, `src/app/(app)/_dashboard/frame-controls.tsx`, `src/app/(app)/_dashboard/gallery.tsx`, `src/app/(app)/_dashboard/range-chips.tsx`, `src/app/(app)/_dashboard/renderers.tsx`, `src/app/(app)/_dashboard/widgets/tile.tsx`
- Modify: `src/app/globals.css`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
```ts
// once.ts
export function once<T>(fn: () => Promise<T>): () => Promise<T>;
// context.ts
export type WidgetCtx = { user: SessionUser; surface: Surface; range: RangeKey; now: number; sp: Record<string, string | undefined>; data: DashboardData };
export type WidgetRenderer = (ctx: WidgetCtx) => Promise<ReactNode>;
// data.ts
export function makeDashboardData(user: SessionUser): DashboardData;   // memoised loaders, see below
// host.tsx
export default async function WidgetHost(props: { user: SessionUser; surface: Surface; sp: Record<string, string | string[] | undefined>; data?: DashboardData }): Promise<JSX.Element>;
// renderers.tsx
export const RENDERERS: Partial<Record<WidgetId, WidgetRenderer>>;   // becomes Record<> in Task 9
// widgets/tile.tsx
export function tile(label: string, value: string, sub: string, tone?: "green" | "amber" | "red" | "blue" | "accent"): ReactNode;
```

- [ ] **Step 1: Failing spec test** for `once` (above `asyncChecks()`; this is sync-safe because the promise is created synchronously):

```ts
/* ---- #43 §4 — once() memoises a loader per request ---- */
import { once } from "@/lib/dashboard/once";
{
  let calls = 0;
  const load = once(async () => { calls++; return 42; });
  void load(); void load();
  ok(calls === 1, "#43 once() invokes the loader a single time no matter how many widgets ask");
}
```

- [ ] **Step 2: Run** → import error. Then write `src/lib/dashboard/once.ts`:

```ts
/** #43 — call `fn` at most once; every caller shares the same promise. */
export function once<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => (p ??= fn());
}
```

- [ ] **Step 3: `src/lib/dashboard/data.ts`** (server-only — imports stores):

```ts
/**
 * #43 — one memoised loader bundle per request. Widgets read through this
 * so a store is fetched at most once regardless of how many widgets share
 * it, and never at all if no widget on the layout needs it.
 */
import type { SessionUser } from "@/lib/session";
import { activeUsers } from "@/lib/users";
import { getAll as getQuotes } from "@/lib/stores/quotes";
import { getAllProjects } from "@/lib/stores/projects";
import { all as getCustomers } from "@/lib/stores/customers";
import { allEngagements } from "@/lib/stores/engagements";
import { getAllDesigns } from "@/lib/stores/designs";
import { getAll as getSurveys } from "@/lib/stores/surveys";
import { open as openLeads, followUps } from "@/lib/stores/leads";
import { threadsIn, unreadCount, folderCounts, mailboxes as commMailboxes } from "@/lib/stores/comms";
import { list as catalogList } from "@/lib/stores/catalog";
import { loadQueue } from "@/lib/queue";
import { loadHomeAgenda } from "@/lib/agenda";
import { once } from "./once";

export function makeDashboardData(user: SessionUser) {
  const me = user.name;
  const boxes = commMailboxes(me, { userColor: user.color });
  return {
    boxes,
    quotes: once(getQuotes),
    projects: once(getAllProjects),
    customers: once(getCustomers),
    engagements: once(allEngagements),
    designs: once(getAllDesigns),
    surveys: once(getSurveys),
    openLeads: once(openLeads),
    myFollowUps: once(() => followUps({ owner: me })),
    needsThreads: once(() => threadsIn("needs", null, me)),
    inboxUnread: once(() => unreadCount(me)),
    roster: once(activeUsers),
    catalogParts: once(catalogList),
    queueItems: once(() => loadQueue(me)),
    agenda: once(() => loadHomeAgenda(user.id, me)),
    boxCounts: once(() => Promise.all(boxes.map((b) => folderCounts(b.id, me)))),
  };
}

export type DashboardData = ReturnType<typeof makeDashboardData>;
```

- [ ] **Step 4: `src/lib/dashboard/context.ts`**

```ts
import type { ReactNode } from "react";
import type { SessionUser } from "@/lib/session";
import type { DashboardData } from "./data";
import type { RangeKey, Surface } from "./registry";

/** #43 — what every widget renderer receives. `sp` is the flattened query
 *  string so widget-local URL state (?pipe, ?sheet, ?drill) passes through. */
export type WidgetCtx = {
  user: SessionUser;
  surface: Surface;
  range: RangeKey;
  now: number;
  sp: Record<string, string | undefined>;
  data: DashboardData;
};

export type WidgetRenderer = (ctx: WidgetCtx) => Promise<ReactNode>;
```

- [ ] **Step 5: `src/app/(app)/_dashboard/renderers.tsx`** (Task 5–8 spread more maps into it):

```tsx
import type { WidgetId } from "@/lib/dashboard/registry";
import type { WidgetRenderer } from "@/lib/dashboard/context";

/** #43 — id → renderer. Partial until every widget file lands (Task 9 makes
 *  it a full Record so tsc enforces completeness from then on). */
export const RENDERERS: Partial<Record<WidgetId, WidgetRenderer>> = {};
```

- [ ] **Step 6: `src/app/(app)/_dashboard/widgets/tile.tsx`**

```tsx
import type { ReactNode } from "react";
import { KpiTile } from "@/components/ui";

/** #43 — every metric-tile widget renders through KpiTile (decision 7). */
export function tile(
  label: string,
  value: string,
  sub: string,
  tone?: "green" | "amber" | "red" | "blue" | "accent"
): ReactNode {
  return <KpiTile label={label} value={value} sub={sub} tone={tone} />;
}
```

- [ ] **Step 7: `src/app/(app)/_dashboard/range-chips.tsx`** (server; visual copied from `reports/page.tsx` `RangeChips` 192–241):

```tsx
import Link from "next/link";
import { RANGES, RANGE_LABEL, dashHref, type RangeKey } from "@/lib/dashboard/registry";

export default function RangeChips({ base, range, keep }: { base: string; range: RangeKey; keep: Record<string, string | undefined> }) {
  return (
    <div style={{ display: "flex", gap: 6, background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, padding: 4 }}>
      {RANGES.map((k) => {
        const on = range === k;
        return (
          <Link
            key={k}
            href={dashHref(base, { ...keep, range: k })}
            style={{
              fontSize: 12, fontWeight: 600, padding: "6px 13px", borderRadius: 7, textDecoration: "none",
              background: on ? "var(--accent)" : "transparent",
              color: on ? "var(--accent-contrast, #16181b)" : "#8c919c",
            }}
          >
            {RANGE_LABEL[k]}
          </Link>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 8: `src/app/(app)/_dashboard/frame-controls.tsx`** (client island):

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { moveWidget, removeWidget, type Surface } from "@/lib/dashboard/registry";
import { saveLayoutAction } from "../dashboard-actions";

const BTN: React.CSSProperties = {
  border: "1px solid #dfe2e8", background: "#fff", borderRadius: 7, padding: "3px 9px",
  fontSize: 11.5, fontWeight: 600, color: "#3d424e", cursor: "pointer", fontFamily: "inherit",
};

/** #43 — per-widget controls shown only in ?customize=1. Sends the whole
 *  next list; the server normalizes. */
export default function FrameControls({
  surface, ids, id, title, index,
}: { surface: Surface; ids: string[]; id: string; title: string; index: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const save = (next: string[]) =>
    start(async () => {
      await saveLayoutAction(surface, next);
      router.refresh();
    });
  return (
    <div className="pk-dash-controls">
      <span style={{ flex: 1, fontWeight: 600, color: "#3d424e" }}>{title}</span>
      <button type="button" style={BTN} disabled={pending || index === 0} onClick={() => save(moveWidget(ids, id, -1))}>Up</button>
      <button type="button" style={BTN} disabled={pending || index === ids.length - 1} onClick={() => save(moveWidget(ids, id, 1))}>Down</button>
      <button type="button" style={{ ...BTN, color: "#b4543a" }} disabled={pending} onClick={() => save(removeWidget(ids, id))}>Remove</button>
    </div>
  );
}
```

- [ ] **Step 9: `src/app/(app)/_dashboard/gallery.tsx`** (client island):

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { addWidget, type Surface } from "@/lib/dashboard/registry";
import { resetLayoutAction, saveLayoutAction } from "../dashboard-actions";

const BTN: React.CSSProperties = {
  border: "1px solid #dfe2e8", background: "#fff", borderRadius: 8, padding: "6px 11px",
  fontSize: 12, fontWeight: 600, color: "#3d424e", cursor: "pointer", fontFamily: "inherit",
};

/** #43 — the "Add widget" gallery + Reset, rendered above the grid in
 *  ?customize=1. `available` is already role-gated and minus what's placed. */
export default function Gallery({
  surface, ids, customized, available,
}: { surface: Surface; ids: string[]; customized: boolean; available: Array<{ id: string; title: string; desc: string }> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<unknown>) => start(async () => { await fn(); router.refresh(); });
  return (
    <div className="pk-card" style={{ padding: "14px 16px", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
        <div>
          <div className="pk-h3">Add widgets</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>Use Up, Down and Remove on each widget to arrange the page.</div>
        </div>
        {customized && (
          <button type="button" style={BTN} disabled={pending} onClick={() => run(() => resetLayoutAction(surface))}>Reset to default</button>
        )}
      </div>
      {available.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Every widget you can see is already on this page.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
          {available.map((w) => (
            <div key={w.id} style={{ border: "1px solid #ececf0", borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{w.title}</div>
              <div style={{ fontSize: 11.5, color: "var(--muted)", flex: 1 }}>{w.desc}</div>
              <button type="button" style={{ ...BTN, alignSelf: "flex-start" }} disabled={pending} onClick={() => run(() => saveLayoutAction(surface, addWidget(ids, w.id)))}>Add</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 10: `src/app/(app)/_dashboard/host.tsx`**

```tsx
import Link from "next/link";
import type { ReactNode } from "react";
import type { SessionUser } from "@/lib/session";
import { layoutFor } from "@/lib/dashboard/layout-store";
import { makeDashboardData, type DashboardData } from "@/lib/dashboard/data";
import type { WidgetCtx } from "@/lib/dashboard/context";
import { dashHref, galleryFor, layoutNeedsRange, resolveRange, widgetDef, type Surface } from "@/lib/dashboard/registry";
import { RENDERERS } from "./renderers";
import FrameControls from "./frame-controls";
import Gallery from "./gallery";
import RangeChips from "./range-chips";

/**
 * #43 — the widget host. Resolves the user's layout for a surface, renders
 * each widget through its registry renderer inside a size-classed grid
 * cell, and in ?customize=1 shows the gallery and per-widget controls.
 * A renderer that throws is logged and replaced by a small error card — one
 * bad widget never takes the page down (decision 15).
 */
export default async function WidgetHost({
  user, surface, sp, data,
}: {
  user: SessionUser;
  surface: Surface;
  sp: Record<string, string | string[] | undefined>;
  data?: DashboardData;
}) {
  const flat: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(sp)) flat[k] = Array.isArray(v) ? v[0] : v;
  const customize = flat.customize === "1";
  const range = resolveRange(flat.range);
  const base = surface === "home" ? "/" : "/reports";
  const keep = { range: flat.range, customize: flat.customize };

  const { ids, customized } = await layoutFor(user.id, surface, user.roles);
  const ctx: WidgetCtx = { user, surface, range, now: Date.now(), sp: flat, data: data ?? makeDashboardData(user) };

  const rendered = await Promise.all(
    ids.map(async (id) => {
      const render = RENDERERS[id];
      let body: ReactNode;
      try {
        body = render ? await render(ctx) : <Note text="This widget is not available yet." />;
      } catch (err) {
        console.error("[dashboard] widget failed:", id, err);
        body = <Note text="Couldn't load this widget." />;
      }
      return { id, body };
    })
  );
  const available = galleryFor(surface, user.roles).filter((w) => !ids.includes(w.id));

  return (
    <>
      <div className="pk-dash-bar">
        <div>{layoutNeedsRange(ids) && <RangeChips base={base} range={range} keep={keep} />}</div>
        <Link
          href={dashHref(base, { ...keep, customize: customize ? undefined : "1" })}
          className={customize ? "pk-btn-accent" : "pk-dash-customize"}
        >
          {customize ? "Done" : "Customize"}
        </Link>
      </div>
      {customize && (
        <Gallery
          surface={surface}
          ids={ids}
          customized={customized}
          available={available.map((w) => ({ id: w.id, title: w.title, desc: w.desc }))}
        />
      )}
      <div className="pk-dash">
        {rendered.map(({ id, body }, i) => {
          const def = widgetDef(id)!;
          return (
            <section key={id} className={`pk-dash-${def.size}`} data-widget={id}>
              {customize && <FrameControls surface={surface} ids={ids} id={id} title={def.title} index={i} />}
              {body}
            </section>
          );
        })}
        {ids.length === 0 && (
          <div className="pk-dash-full">
            <Note text={customize ? "Add a widget from the list above." : "Nothing here yet. Choose Customize to add widgets."} />
          </div>
        )}
      </div>
    </>
  );
}

function Note({ text }: { text: string }) {
  return (
    <div className="pk-card" style={{ padding: "18px 16px", fontSize: 12.5, color: "var(--muted)", textAlign: "center" }}>
      {text}
    </div>
  );
}
```

- [ ] **Step 11: `src/app/globals.css`** — append after the `.pk-card` block:

```css
/* ============ Dashboard widget grid (#43) ============ */
.pk-dash {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 18px;
  align-items: start;
}
.pk-dash-tile { grid-column: span 1; min-width: 0; }
.pk-dash-half { grid-column: span 2; min-width: 0; }
.pk-dash-full { grid-column: span 4; min-width: 0; }
.pk-dash-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}
.pk-dash-customize {
  font-size: 12.5px;
  font-weight: 600;
  color: #3d424e;
  background: #fff;
  border: 1px solid #dfe2e8;
  border-radius: 8px;
  padding: 7px 12px;
  text-decoration: none;
}
.pk-dash-customize:hover { border-color: #c4c9d2; }
.pk-dash-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--muted);
}
@media (max-width: 860px) {
  .pk-dash { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pk-dash-full { grid-column: span 2; }
}
@media (max-width: 640px) {
  .pk-dash { grid-template-columns: minmax(0, 1fr); gap: 14px; }
  .pk-dash-half, .pk-dash-full { grid-column: span 1; }
}
```
(Confirm `.pk-btn-accent` is usable on an `<a>` — it is a class on a button today; if it sets `border: none` only, it applies fine to a link. Otherwise use `.pk-dash-customize` for both states.)

- [ ] **Step 12: Verify** specs → 1 new PASS + ALL PASSED; `npx tsc --noEmit -p . | tail -3` → empty; `npx eslint "src/app/(app)/_dashboard" src/lib/dashboard` → 0 errors. Nothing renders the host yet; Task 5 wires Home.

- [ ] **Step 13: Commit**
```bash
git add src/lib/dashboard/once.ts src/lib/dashboard/context.ts src/lib/dashboard/data.ts "src/app/(app)/_dashboard/host.tsx" "src/app/(app)/_dashboard/frame-controls.tsx" "src/app/(app)/_dashboard/gallery.tsx" "src/app/(app)/_dashboard/range-chips.tsx" "src/app/(app)/_dashboard/renderers.tsx" "src/app/(app)/_dashboard/widgets/tile.tsx" src/app/globals.css scripts/test-review-and-spec.ts
git commit -m "feat(dashboard): widget host — memoised data, size-class grid, customize mode with gallery/up/down/remove (#43 §2)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Home cards become widgets; `/` renders the host

**Files:**
- Create: `src/lib/dashboard/home-metrics.ts`, `src/app/(app)/_dashboard/widgets/home-cards.tsx`
- Modify: `src/app/(app)/_dashboard/renderers.tsx`, `src/app/(app)/page.tsx`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces (`home-metrics.ts`, pure):**
```ts
export function shortMoney(n: number | null | undefined): string;                 // moved from page.tsx:72-83
export function resolvePipe(v: string | undefined): "all" | QuoteStatus;
export function sheetHrefFor(pipe: "all" | QuoteStatus): (id: string) => string;   // page.tsx:235-238
export function myQuoteStats(quotesAll: Quote[], me: string): { myQuotes: Quote[]; openQuotes: Quote[]; openValue: number; won: Quote[]; lost: Quote[]; winRate: number; sentCount: number; avg: number; pipeCounts: Record<"all" | QuoteStatus, number> };
export function homeAlerts(quotesAll: Quote[], designsAll: DesignRecord[], me: string, now: number, sheetHref: (id: string) => string): { alerts: AlertRow[]; urgentCount: number; openReviewCount: number };   // page.tsx:248-343 with `now` injected
```

- [ ] **Step 1: Failing spec tests**

```ts
/* ---- #43 §5 — Home card metrics (pure) ---- */
import { myQuoteStats, homeAlerts, resolvePipe } from "@/lib/dashboard/home-metrics";
{
  const T = Date.UTC(2026, 8, 15, 12);
  const D = 86_400_000;
  const mk = (o: Record<string, unknown>) => ({ id: "Q", name: "N", customer: "", customerId: null, locationId: null, value: 0, margin: 0, status: "draft", source: "estimator", owner: "Me", review: { state: "none" }, createdAt: T - D, updatedAt: T - D, history: [], ...o }) as unknown as Quote;
  const all = [
    mk({ id: "1", status: "sent", value: 100, updatedAt: T - 8 * D }),
    mk({ id: "2", status: "won", value: 300 }),
    mk({ id: "3", status: "lost", value: 50 }),
    mk({ id: "4", owner: "Other", status: "draft", value: 999 }),
  ];
  const s = myQuoteStats(all, "Me");
  ok(s.openQuotes.length === 1 && s.openValue === 100 && s.winRate === 50 && s.sentCount === 1, "#43 myQuoteStats scopes to owner and computes win rate");
  ok(s.pipeCounts.all === 3 && s.pipeCounts.won === 1 && s.pipeCounts.draft === 0, "#43 pipeCounts feed the pipeline filter chips");
  const a = homeAlerts(all, [], "Me", T, (id) => `/?sheet=${id}`);
  ok(a.alerts.length === 1 && a.alerts[0].tag === "8d" && a.urgentCount === 1, "#43 a sent quote 8 days old is an urgent follow-up alert");
  ok(a.alerts[0].href === "/?sheet=1" && a.openReviewCount === 0, "#43 alert hrefs come from the injected sheetHref");
  ok(resolvePipe("won") === "won" && resolvePipe("x") === "all" && resolvePipe(undefined) === "all", "#43 resolvePipe");
}
```

- [ ] **Step 2: Run** → import error. Write `src/lib/dashboard/home-metrics.ts` by moving the blocks named above out of `page.tsx` verbatim, with these signatures. `homeAlerts` is `page.tsx:248-343` with `daysSince` computed against the `now` parameter (`Math.floor((now - (ts || now)) / DAY)`), `pipelineAlerts`/`reviewAlerts` built exactly as today, returning `{ alerts: reviewAlerts.concat(pipelineAlerts).slice(0, 5), urgentCount: pipelineRaw.filter((a) => a.urgent).length, openReviewCount }`. Import `AlertRow` as a type from `@/app/(app)/home-needs-attention`, `firstName` from `@/lib/team`, `money` from `@/lib/format`.

- [ ] **Step 3: `src/app/(app)/_dashboard/widgets/home-cards.tsx`** — one renderer per Home card. Presentation components are untouched; each renderer reproduces exactly the VM shaping `page.tsx` does today for that card (line refs are pre-move):

```tsx
/**
 * #43 — the Home cards as registry widgets. Presentation stays in the
 * sibling home-*.tsx files (untouched); this module owns the per-widget
 * data shaping that used to live inline in page.tsx. Everything reads
 * through ctx.data so a store loads once per request however many widgets
 * share it.
 */
import { money } from "@/lib/format";
import { deriveInitials, fallbackColor } from "@/lib/team";
import { timeAgo as designTimeAgo } from "@/lib/stores/designs";
import { stageMeta as surveyStageMeta, timeAgo as surveyTimeAgo } from "@/lib/stores/surveys";
import {
  followUpInfo, sla as leadSla, sourceMeta, stageMeta as leadStageMeta, dueLabel, dateLabel,
  timeAgo as leadTimeAgo, type LeadRecord,
} from "@/lib/stores/leads";
import { boxMeta, waitingSince, waitLabel as commWaitLabel } from "@/lib/stores/comms";
import { priceBooks } from "@/lib/catalog-books";
import { queueCardCounts, queueDueLabel } from "@/lib/queue";
import type { WidgetCtx, WidgetRenderer } from "@/lib/dashboard/context";
import { homeAlerts, myQuoteStats, resolvePipe, sheetHrefFor, shortMoney } from "@/lib/dashboard/home-metrics";
import { tile } from "./tile";
import HomeQueue, { type QueueRow } from "../../home-queue";
import HomeInbox from "../../home-inbox";
import HomeMyLeads, { type LeadGroup, type LeadRow } from "../../home-my-leads";
import HomeMyDesigns, { type DesignCard } from "../../home-my-designs";
import HomePipeline, { type PipelineRow } from "../../home-pipeline";
import HomeCatalog from "../../home-catalog";
import HomeCalendar from "../../home-calendar";
import HomeVenueAssessments, { type SurveyCard } from "../../home-venue-assessments";
import HomeTeamActivity, { type TeamActivityRow } from "../../home-team-activity";
import HomeNeedsAttention from "../../home-needs-attention";

const stats = async (ctx: WidgetCtx) => myQuoteStats(await ctx.data.quotes(), ctx.user.name);

export const HOME_RENDERERS = {
  /* ---- stat tiles (page.tsx 213-218) ---- */
  "my-open-pipeline": async (ctx) => {
    const s = await stats(ctx);
    return tile("Open pipeline", shortMoney(s.openValue), `${s.openQuotes.length} active quotes`);
  },
  "my-win-rate": async (ctx) => {
    const s = await stats(ctx);
    return tile("Win rate", `${s.winRate}%`, `${s.won.length} won · ${s.lost.length} lost`);
  },
  "my-out-for-signature": async (ctx) => {
    const s = await stats(ctx);
    return tile("Out for signature", String(s.sentCount), "quotes sent");
  },
  "my-avg-quote": async (ctx) => {
    const s = await stats(ctx);
    return tile("Avg quote", shortMoney(s.avg), `${s.myQuotes.length} total`);
  },

  /* ---- my queue (page.tsx 186-197) — `now` is the host's single read ---- */
  "my-queue": async (ctx) => {
    const items = await ctx.data.queueItems();
    const { open, overdue } = queueCardCounts(items, ctx.now);
    const rows: QueueRow[] = items.slice(0, 5).map((it) => ({
      key: it.key, title: it.title, context: it.context, dueLabel: queueDueLabel(it.due, ctx.now).text, href: it.href,
    }));
    return <HomeQueue open={open} overdue={overdue} rows={rows} />;
  },

  /* ---- inbox (page.tsx 476-501) ---- */
  inbox: async (ctx) => {
    const [needsThreads, inboxUnread, boxCountsArr] = await Promise.all([
      ctx.data.needsThreads(), ctx.data.inboxUnread(), ctx.data.boxCounts(),
    ]);
    const inboxItems = needsThreads.slice(0, 4).map((t) => {
      const bm = boxMeta(t.mailbox || "info", t.mailboxUser || undefined, { userColor: ctx.user.color });
      return {
        id: t.id, href: `/inbox?thread=${encodeURIComponent(t.id)}`,
        customer: t.customer || t.contactName || "Customer", subject: t.subject || "(no subject)",
        wait: commWaitLabel(waitingSince(t)), unread: !!t.unread, channel: t.channel,
        boxTag: bm?.label || "", boxColor: bm?.color || "#8c919c",
      };
    });
    const inboxBoxes = ctx.data.boxes.map((b, i) => ({
      id: b.id, label: b.kind === "personal" ? "My inbox" : b.label, color: b.color,
      href: `/inbox?box=${b.id}`, waiting: boxCountsArr[i]?.waiting || 0,
    }));
    return <HomeInbox inboxNeedsCount={needsThreads.length} inboxUnread={inboxUnread} inboxItems={inboxItems} inboxBoxes={inboxBoxes} />;
  },

  /* ---- my leads (page.tsx 363-425) — leadChip/leadSub resolved into rows ---- */
  "my-leads": async (ctx) => {
    const me = ctx.user.name;
    const [allOpenLeads, myFollowUps] = await Promise.all([ctx.data.openLeads(), ctx.data.myFollowUps()]);
    const myLeads = allOpenLeads.filter((l) => l.owner === me);
    const fuIds = new Set(myFollowUps.map((l) => l.id));
    const overdue = myFollowUps.filter((l) => followUpInfo(l).urgency >= 2);
    const cold = myFollowUps.filter((l) => followUpInfo(l).urgency === 1);
    const awaiting = myLeads.filter((l) => l.stage === "new" && !fuIds.has(l.id)).sort((a, b) => leadSla(a).ms - leadSla(b).ms);
    const inProgress = myLeads.filter((l) => l.stage !== "new" && !fuIds.has(l.id)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const leadChip = (l: LeadRecord): LeadRow["chip"] => {
      const info = followUpInfo(l);
      const s = leadSla(l);
      if (info.need) {
        if (info.reason === "sla") return { label: dueLabel(s.ms), ink: "#b4543a", soft: "#f8ece7", bd: "#eccfc4" };
        if (info.reason === "nextaction") return { label: "Follow-up due", ink: "#b4543a", soft: "#f8ece7", bd: "#eccfc4" };
        return { label: "Going cold", ink: "#8a6d1f", soft: "#fbf3dd", bd: "#f0e2bd" };
      }
      if (s.state === "pending") return { label: dueLabel(s.ms), ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3" };
      if (l.nextActionAt) return { label: dateLabel(l.nextActionAt), ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da" };
      return { label: "On track", ink: "#5b7a6a", soft: "#eef3f0", bd: "#d8e6de" };
    };
    const leadSub = (l: LeadRecord): string => {
      if (l.nextActionAt && l.stage !== "new") return `${l.nextActionNote || "Follow-up"} · ${dateLabel(l.nextActionAt)}`;
      if (l.stage === "new" && !l.firstContactAt) return `${sourceMeta(l.source).verb} · ${leadTimeAgo(l.createdAt)}`;
      return `${l.interest || "Open lead"} · last touch ${leadTimeAgo(l.lastActivityAt)}`;
    };
    const toLeadRow = (l: LeadRecord): LeadRow => {
      const src = sourceMeta(l.source);
      const stg = leadStageMeta(l.stage);
      return {
        id: l.id, href: `/leads?lead=${encodeURIComponent(l.id)}`, org: l.org || "Lead",
        src: { color: src.color, short: src.short }, stage: { ink: stg.ink, soft: stg.soft, bd: stg.bd, short: stg.short },
        sub: leadSub(l), chip: leadChip(l), value: shortMoney(l.value),
      };
    };
    const leadGroups: LeadGroup[] = [
      { key: "overdue", label: "Overdue — reach out now", dot: "#c85a3c", ink: "#b4543a", items: overdue.map(toLeadRow) },
      { key: "cold", label: "Going cold", dot: "#c8a53c", ink: "#8a6d1f", items: cold.map(toLeadRow) },
      { key: "awaiting", label: "Awaiting first response", dot: "#3d6fd0", ink: "#3155a8", items: awaiting.map(toLeadRow) },
      { key: "progress", label: "In progress", dot: "#7b5fb0", ink: "#5b4b8a", items: inProgress.map(toLeadRow) },
    ].filter((g) => g.items.length > 0);
    return <HomeMyLeads myFollowCount={myFollowUps.length} leadGroups={leadGroups} />;
  },

  /* ---- my designs (page.tsx 427-441) ---- */
  "my-designs": async (ctx) => {
    const designsAll = await ctx.data.designs();
    const cards: DesignCard[] = designsAll.filter((d) => d.owner === ctx.user.name).map((d) => ({
      id: d.id, venue: d.venue || "—", name: d.name,
      tier: (d.tier || "better").replace(/^./, (c) => c.toUpperCase()), budget: shortMoney(d.budget || 0),
      meta: `${d.id} · ${d.width || "?"}' × ${d.depth || "?"}' × ${d.grid || "?"}'`,
      systemsLabel: `${(d.systems || []).length} systems`, edited: designTimeAgo(d.updatedAt),
      openHref: `/design/quick?design=${encodeURIComponent(d.id)}`,
    }));
    return <HomeMyDesigns cards={cards} />;
  },

  /* ---- my pipeline (page.tsx 220-244) — ?pipe stays URL state ---- */
  "my-pipeline": async (ctx) => {
    const s = await stats(ctx);
    const pipe = resolvePipe(ctx.sp.pipe);
    const sheetHref = sheetHrefFor(pipe);
    const filterDefs: Array<["all" | "draft" | "sent" | "won" | "lost", string]> = [
      ["all", "All"], ["draft", "Draft"], ["sent", "Sent"], ["won", "Won"], ["lost", "Lost"],
    ];
    const filteredQuotes: PipelineRow[] = s.myQuotes.filter((q) => pipe === "all" || q.status === pipe).map((q) => ({ ...q, href: sheetHref(q.id) }));
    return <HomePipeline pipe={pipe} filterDefs={filterDefs} pipeCounts={s.pipeCounts} filteredQuotes={filteredQuotes} />;
  },

  /* ---- catalog (page.tsx 177, 567) ---- */
  catalog: async (ctx) => {
    const parts = await ctx.data.catalogParts();
    return <HomeCatalog books={priceBooks(parts)} partCount={parts.length} />;
  },

  /* ---- calendar (D77) ---- */
  calendar: async (ctx) => {
    const { gmailOn, calendarOn, items } = await ctx.data.agenda();
    return <HomeCalendar items={items} calendarOn={calendarOn} gmailOn={gmailOn} />;
  },

  /* ---- venue assessments (page.tsx 459-474) ---- */
  "venue-assessments": async (ctx) => {
    const surveysAll = await ctx.data.surveys();
    const surveyCards: SurveyCard[] = surveysAll.slice(0, 3).map((s) => ({
      id: s.id, mono: (s.customer || "FS").replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "FS",
      customer: s.customer || "Untitled survey", sub: `${s.id} · ${s.venueType || "—"} · ${surveyTimeAgo(s.updatedAt)}`,
      href: `/venue-assessments?id=${encodeURIComponent(s.id)}`, stage: surveyStageMeta(s.stage || "requested"),
    }));
    const surveyPendingCount = surveysAll.filter((s) => s.syncState === "pending" || s.syncState === "syncing").length;
    return <HomeVenueAssessments surveyCards={surveyCards} surveyPendingCount={surveyPendingCount} />;
  },

  /* ---- team activity (page.tsx 179-181, 443-457) ---- */
  "team-activity": async (ctx) => {
    const me = ctx.user.name;
    const [quotesAll, designsAll, roster] = await Promise.all([ctx.data.quotes(), ctx.data.designs(), ctx.data.roster()]);
    const ident = new Map(roster.map((u) => [u.name, { initials: u.initials, color: u.color }]));
    const rows: TeamActivityRow[] = [
      ...quotesAll.filter((q) => q.owner !== me).map((q) => ({ ts: q.updatedAt, who: q.owner, kind: "Quote", verb: "updated", name: q.name })),
      ...designsAll.filter((d) => d.owner !== me).map((d) => ({ ts: d.updatedAt, who: d.owner, kind: "Design", verb: "designed", name: d.name })),
    ]
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
      .slice(0, 5)
      .map((t) => ({ ...t, initials: ident.get(t.who)?.initials || deriveInitials(t.who), color: ident.get(t.who)?.color || fallbackColor(t.who) }));
    return <HomeTeamActivity teamActivity={rows} />;
  },

  /* ---- needs attention (page.tsx 246-335) ---- */
  "needs-attention": async (ctx) => {
    const [quotesAll, designsAll] = await Promise.all([ctx.data.quotes(), ctx.data.designs()]);
    const { alerts } = homeAlerts(quotesAll, designsAll, ctx.user.name, ctx.now, sheetHrefFor(resolvePipe(ctx.sp.pipe)));
    return <HomeNeedsAttention alerts={alerts} />;
  },
} satisfies Record<string, WidgetRenderer>;
```
Check the `TeamActivityRow` field list against `home-team-activity.tsx:12` and `LeadRow["chip"]` against `home-my-leads.tsx:12-22`; both are exactly what `page.tsx` builds today. `money` is unused here if `homeAlerts` owns it — drop the import if eslint flags it.

- [ ] **Step 4: Register** — in `renderers.tsx`:
```tsx
import { HOME_RENDERERS } from "./widgets/home-cards";
export const RENDERERS: Partial<Record<WidgetId, WidgetRenderer>> = { ...HOME_RENDERERS };
```

- [ ] **Step 5: Rewrite `src/app/(app)/page.tsx`** as greeting + host + stage sheet. Keep the `HOME_CSS` block (delete only the `.pkh-stats` and `.pkh-main` rules and their two `@media` lines — nothing uses them after this task; `.pkh-content`, `.pkh-greet`, `.pkh-inbox*`, `.pkh-sheet*`, hover rules stay):

```tsx
import { requireUser } from "@/lib/session";
import { getUser } from "@/lib/users";
import { getSettings } from "@/lib/settings";
import { firstName } from "@/lib/team";
import { money } from "@/lib/format";
import { makeDashboardData } from "@/lib/dashboard/data";
import { homeAlerts, myQuoteStats, resolvePipe, sheetHrefFor } from "@/lib/dashboard/home-metrics";
import HomeTabs from "./home-tabs";
import HomeGreeting from "./home-greeting";
import HomeStageSheet, { type SheetQuote } from "./home-stage-sheet";
import WidgetHost from "./_dashboard/host";

/**
 * Home dashboard. Since #43 the cards are registry widgets rendered by
 * WidgetHost from the user's saved layout; this file keeps only the page
 * chrome — greeting (identity) and the ?sheet= stage sheet (a modal) — and
 * shares one DashboardData bundle with the host so nothing loads twice.
 * Pipeline filter + stage sheet state still live in the URL (?pipe, ?sheet).
 */

const HOME_CSS = `…(existing block minus .pkh-stats / .pkh-main)…`;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const me = user.name;
  const data = makeDashboardData(user);
  const now = Date.now();
  const [userRecord, appSettings, quotesAll, designsAll] = await Promise.all([
    getUser(user.id), getSettings(), data.quotes(), data.designs(),
  ]);

  const pipe = resolvePipe(first(sp.pipe));
  const sheetHref = sheetHrefFor(pipe);
  const s = myQuoteStats(quotesAll, me);
  const { urgentCount, openReviewCount } = homeAlerts(quotesAll, designsAll, me, now, sheetHref);

  /* ---- greeting (unchanged) ---- */
  const office = appSettings.offices.find((o) => o.quoteDefault) || appSettings.offices[0];
  let timezone = office?.timezone || "America/Chicago";
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(); } catch { timezone = "America/Chicago"; }
  const localParts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hour12: false }).formatToParts(new Date(now));
  const hour = Number(localParts.find((part) => part.type === "hour")?.value || 0);
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const lastLogin = userRecord?.previousLoginAt
    ? new Intl.DateTimeFormat("en-US", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(userRecord.previousLoginAt)
    : "First login";
  const standfirst = `${s.openQuotes.length} open quotes worth ${money(s.openValue)} · ${urgentCount} need attention`;

  /* ---- stage sheet (unchanged) ---- */
  const sheetId = first(sp.sheet);
  const sheetQ = sheetId ? s.myQuotes.find((q) => q.id === sheetId) : undefined;
  const sheetQuote: SheetQuote | null = sheetQ
    ? {
        id: sheetQ.id, name: sheetQ.name, meta: `${sheetQ.id} · ${sheetQ.customer || "—"}`, value: money(sheetQ.value),
        marginLabel: sheetQ.margin ? `${Math.round(sheetQ.margin * 100)}% margin` : "", status: sheetQ.status,
      }
    : null;
  const closeHref = pipe === "all" ? "/" : `/?pipe=${pipe}`;

  return (
    <HomeTabs active="dashboard" className="pkh-content">
      <style dangerouslySetInnerHTML={{ __html: HOME_CSS }} />
      <HomeGreeting greeting={greeting} firstName={firstName(me)} standfirst={standfirst} openReviewCount={openReviewCount} lastLogin={lastLogin} timezone={timezone} />
      <WidgetHost user={user} surface="home" sp={sp} data={data} />
      {sheetQuote && <HomeStageSheet quote={sheetQuote} closeHref={closeHref} />}
    </HomeTabs>
  );
}
```
`HomeStats` is no longer imported; the file is deleted in Task 9. The host reads `Date.now()` itself for widgets — pass `now` is not needed since alerts in the greeting and in the widget are both computed within one request (sub-second); leave as written.

- [ ] **Step 6: Verify** specs → 5 new PASS + ALL PASSED; tsc clean; then, with nothing else holding a DB, `npm run test:smoke 2>&1 | grep -E '^/ |"/"|ALL PASSED|FAIL'` → `/` 200. Then `preview_start` the dev server and check `/`: greeting, four tiles, queue, inbox, leads, designs, pipeline (`/?pipe=won` still filters, `/?sheet=<id>` still opens the sheet), catalog, calendar, assessments, team activity, needs attention — the same content as before, now in the 4-column grid; `/?customize=1` shows the gallery (empty: "Every widget you can see is already on this page.") and Up/Down/Remove on every card; Remove one, reload, it stays gone; "Reset to default" restores. Resize to 375px: one column, no horizontal scroll.

- [ ] **Step 7: Commit**
```bash
git add src/lib/dashboard/home-metrics.ts "src/app/(app)/_dashboard/widgets/home-cards.tsx" "src/app/(app)/_dashboard/renderers.tsx" "src/app/(app)/page.tsx" scripts/test-review-and-spec.ts
git commit -m "feat(dashboard): Home cards become registry widgets; / renders the user's layout (#43 §6)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Reports Sales panels become widgets

**Files:**
- Create: `src/app/(app)/_dashboard/charts.tsx`, `src/app/(app)/_dashboard/widgets/sales.tsx`
- Modify: `src/app/(app)/_dashboard/renderers.tsx`, `src/app/(app)/reports/page.tsx` (imports the moved chart primitives; still renders the old two views until Task 7)

**Interfaces (`charts.tsx`, server components + helpers, moved verbatim from `reports/page.tsx` 40–67 and 245–492):** `ChartCard`, `StackedBars`, `StageBars`, `Donut`, `MonoBadge`, `initialsOf`, `moneyK`, `pctDelta`, `ptDelta`, `monthLabel`, `monYear`, plus `export const ACCENT = "var(--accent)"` and a shared `Legend({ items: Array<{ color: string; label: string }> })` extracted from the two identical inline legends (lines 657–667 / 1006–1016).

- [ ] **Step 1: Create `charts.tsx`** by cutting those functions out of `reports/page.tsx` and pasting unchanged (add `export`). Update `reports/page.tsx` to import them from `../_dashboard/charts`. `npx tsc --noEmit -p .` must be clean before continuing — this step is a pure move.

- [ ] **Step 2: `src/app/(app)/_dashboard/widgets/sales.tsx`** — the `SalesView` body (514–841) split per panel, with the period coming from `ctx.range`/`ctx.now`:

```tsx
import Link from "next/link";
import { money } from "@/lib/format";
import type { Quote } from "@/lib/stores/quotes";
import type { WidgetCtx, WidgetRenderer } from "@/lib/dashboard/context";
import { periodBounds, salesBuckets, salesMetrics, wonAt } from "@/lib/dashboard/metrics";
import { ACCENT, ChartCard, Donut, Legend, MonoBadge, StackedBars, StageBars, initialsOf, moneyK, pctDelta, ptDelta } from "../charts";
import { tile } from "./tile";

/** #43 — Reports › Sales as widgets. Period = ?range (history contract). */

async function period(ctx: WidgetCtx) {
  const quotes = await ctx.data.quotes();
  const { start, end, priorStart } = periodBounds(ctx.range, ctx.now);
  return { quotes, cur: salesMetrics(quotes, start, end), prior: salesMetrics(quotes, priorStart, start), start };
}

export const SALES_RENDERERS = {
  "total-quoted": async (ctx) => {
    const { cur, prior } = await period(ctx);
    return tile("Total quoted", money(cur.quotedValue), `${pctDelta(cur.quotedValue, prior.quotedValue)} vs. prior`);
  },
  "won-value": async (ctx) => {
    const { cur, prior } = await period(ctx);
    return tile("Won value", money(cur.wonValue), `${pctDelta(cur.wonValue, prior.wonValue)} vs. prior`, "green");
  },
  "win-rate": async (ctx) => {
    const { cur, prior } = await period(ctx);
    return tile("Win rate", `${Math.round(cur.winRate)}%`, `${ptDelta(cur.winRate, prior.winRate)} vs. prior`);
  },
  "avg-quote": async (ctx) => {
    const { cur, prior } = await period(ctx);
    return tile("Avg. quote", money(cur.avg), `${pctDelta(cur.avg, prior.avg)} vs. prior`);
  },

  "quoted-vs-won": async (ctx) => {
    const quotes = await ctx.data.quotes();
    const buckets = salesBuckets(ctx.range, ctx.now);
    const barData = buckets.map((bk) => ({
      label: bk.label,
      quoted: quotes.filter((q) => (q.createdAt || 0) >= bk.start && (q.createdAt || 0) < bk.end).reduce((s, q) => s + (q.value || 0), 0),
      won: quotes.filter((q) => q.status === "won" && wonAt(q) >= bk.start && wonAt(q) < bk.end).reduce((s, q) => s + (q.value || 0), 0),
    }));
    const maxQuoted = Math.max(1, ...barData.map((b) => b.quoted));
    const bars = barData.map((b) => ({
      label: b.label, top: b.won ? moneyK(b.won) : "",
      basePct: Math.round((b.quoted / maxQuoted) * 100), frontPct: Math.round((b.won / maxQuoted) * 100),
    }));
    return (
      <ChartCard title="Quoted vs. won by month" right={<Legend items={[{ color: "#dfe2e8", label: "Quoted" }, { color: ACCENT, label: "Won" }]} />}>
        <StackedBars bars={bars} frontColor={ACCENT} />
      </ChartCard>
    );
  },

  "pipeline-by-stage": async (ctx) => {
    const quotes = await ctx.data.quotes();
    const inReview = (q: Quote) => q.review?.state === "in_review";
    const sum = (arr: Quote[]) => arr.reduce((s, q) => s + (q.value || 0), 0);
    const draftQ = quotes.filter((q) => q.status === "draft" && !inReview(q));
    const sentQ = quotes.filter((q) => q.status === "sent" && !inReview(q));
    const reviewQ = quotes.filter((q) => inReview(q) && (q.status === "draft" || q.status === "sent"));
    const rows = [
      { label: "Draft", count: draftQ.length, value: sum(draftQ), color: "#c9a23a" },
      { label: "Sent", count: sentQ.length, value: sum(sentQ), color: "#3155a8" },
      { label: "In review", count: reviewQ.length, value: sum(reviewQ), color: ACCENT },
    ].filter((r) => r.count > 0);
    return (
      <div className="pk-card" style={{ padding: "18px 20px" }}>
        <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 16 }}>Open pipeline by stage</div>
        <StageBars rows={rows} />
      </div>
    );
  },

  "win-donut": async (ctx) => {
    const { cur } = await period(ctx);
    const decided = cur.won + cur.lost;
    const wonDeg = decided ? Math.round((cur.won / decided) * 360) : 0;
    return (
      <div className="pk-card" style={{ padding: "18px 20px" }}>
        <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 4 }}>Win rate</div>
        <div style={{ fontSize: 12, color: "#8c919c", marginBottom: 16 }}>Decided quotes this period</div>
        <Donut
          gradient={`conic-gradient(${ACCENT} 0deg ${wonDeg}deg, #d98a7a ${wonDeg}deg 360deg)`}
          center={`${Math.round(cur.winRate)}%`}
          centerSub="win rate"
          legend={[{ color: ACCENT, label: "Won", value: String(cur.won) }, { color: "#d98a7a", label: "Lost", value: String(cur.lost) }]}
        />
      </div>
    );
  },

  "top-customers": async (ctx) => {
    const { quotes, start } = await period(ctx);
    const byCust = new Map<string, { value: number; n: number }>();
    quotes.filter((q) => q.status === "won" && wonAt(q) >= start).forEach((q) => {
      const key = q.customer || "—";
      const e = byCust.get(key) || { value: 0, n: 0 };
      e.value += q.value || 0;
      e.n += 1;
      byCust.set(key, e);
    });
    const top = [...byCust.entries()].map(([name, e]) => ({ name, ...e })).sort((a, b) => b.value - a.value).slice(0, 4);
    return (
      <div className="pk-card" style={{ overflow: "hidden" }}>
        <div style={{ padding: "15px 18px 12px", borderBottom: "1px solid #f0f1f4", fontSize: 14.5, fontWeight: 600 }}>Top customers by won value</div>
        {top.map((c) => (
          <div key={c.name} style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 18px", borderBottom: "1px solid #f5f6f8" }}>
            <MonoBadge>{initialsOf(c.name)}</MonoBadge>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
              <div style={{ fontSize: 10.5, color: "#aab0bb", marginTop: 1 }}>{c.n} {c.n === 1 ? "project" : "projects"}</div>
            </div>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 600 }}>{money(c.value)}</span>
          </div>
        ))}
        {top.length === 0 && <div style={{ padding: "22px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>No won quotes in this period.</div>}
      </div>
    );
  },

  "pipeline-by-estimator": async (ctx) => {
    const quotes = await ctx.data.quotes();
    /* body = reports/page.tsx 592–615 (owners) + 753–838 (table), moved verbatim */
    …
  },
} satisfies Record<string, WidgetRenderer>;
```
For `pipeline-by-estimator`, paste lines 592–615 and 753–838 unchanged inside the renderer (the table JSX references only `owners`, `money`, `MonoBadge`, `initialsOf`). `Link` is imported for parity with the original file; drop it if unused.

- [ ] **Step 3: Register** — `RENDERERS = { ...HOME_RENDERERS, ...SALES_RENDERERS }`.

- [ ] **Step 4: Verify** tsc clean; `npm run test:smoke 2>&1 | grep -E '/reports|ALL PASSED'` → `/reports` 200 (still the old page). Temporarily confirm a sales widget renders by adding `total-quoted` to your own Home via `/?customize=1` → Add → tile shows a value and the range chips appear on Home; Remove it again.

- [ ] **Step 5: Commit**
```bash
git add "src/app/(app)/_dashboard/charts.tsx" "src/app/(app)/_dashboard/widgets/sales.tsx" "src/app/(app)/_dashboard/renderers.tsx" "src/app/(app)/reports/page.tsx"
git commit -m "feat(dashboard): Reports Sales panels as widgets; chart primitives shared (#43 §6)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Reports Installs panels become widgets; `/reports` renders the host

**Files:**
- Create: `src/app/(app)/_dashboard/widgets/installs.tsx`
- Modify: `src/app/(app)/_dashboard/renderers.tsx`, `src/app/(app)/reports/page.tsx` (becomes ~30 lines)

**Interfaces:** `INSTALLS_RENDERERS` covering `backlog-value`, `to-be-billed`, `expected-collected`, `book-margin`, `billing-forecast`, `backlog-by-stage`, `margin-donut`, `upcoming-completions`, `completion-timeline`, `project-locations`. All `forward`: horizon is always 12 months (`installsForecast(projects, engagements, ctx.now, 12)`).

- [ ] **Step 1: `installs.tsx`** — move `STG`/`stg` (847–858) and `coordsOf` (860–870) in verbatim; one memoised forecast per request:

```tsx
import { money } from "@/lib/format";
import type { ProjectRecord, ProjectStage } from "@/lib/stores/projects";
import type { MapPin } from "@/components/map/LeafletMap";
import type { WidgetCtx, WidgetRenderer } from "@/lib/dashboard/context";
import { installsForecast } from "@/lib/dashboard/metrics";
import { ReportsMap } from "../../reports/controls";
import { ACCENT, ChartCard, Donut, Legend, MonoBadge, StackedBars, StageBars, initialsOf, moneyK, monthLabel, monYear } from "../charts";
import { tile } from "./tile";

/** #43 — Reports › Installs as widgets. Forward-looking: always the next
 *  12 months, exempt from ?range (spec). */

const HORIZON = 12;

type StageMeta = { label: string; color: string; order: number };
const STG: Record<string, StageMeta> = { /* verbatim 848–855 */ };
function stg(k: ProjectStage | string): StageMeta { return STG[k] || { label: k, color: "#8c919c", order: 9 }; }
function coordsOf(/* verbatim 860–870 */) { … }

async function forecast(ctx: WidgetCtx) {
  const [projects, engagements] = await Promise.all([ctx.data.projects(), ctx.data.engagements()]);
  return installsForecast(projects, engagements, ctx.now, HORIZON);
}
const stageRows = (f: Awaited<ReturnType<typeof forecast>>) =>
  f.byStage.map((s) => ({ label: stg(s.stage).label, count: s.count, value: s.value, color: stg(s.stage).color, order: stg(s.stage).order })).sort((a, b) => a.order - b.order);

export const INSTALLS_RENDERERS = {
  "backlog-value": async (ctx) => { const f = await forecast(ctx); return tile("Backlog value", money(f.totalValue), `${f.book.length} open`); },
  "to-be-billed": async (ctx) => { const f = await forecast(ctx); return tile("To be billed", money(f.toBill), `next ${HORIZON} mo`); },
  "expected-collected": async (ctx) => { const f = await forecast(ctx); return tile("Expected collected", money(f.collected), "net-30 basis", "green"); },
  "book-margin": async (ctx) => { const f = await forecast(ctx); return tile("Avg. margin", `${Math.round(f.blended * 100)}%`, "at completion"); },

  "billing-forecast": async (ctx) => {
    const f = await forecast(ctx);
    const billMax = Math.max(1, ...f.buckets.map((b) => Math.max(b.billed, b.collected)));
    const bars = f.buckets.map((b) => ({
      label: monthLabel(b.start), top: b.billed ? moneyK(b.billed) : "",
      basePct: Math.round((b.billed / billMax) * 100), frontPct: Math.round((b.collected / billMax) * 100),
    }));
    return (
      <ChartCard title="Billing forecast — installs + consulting milestones" right={<Legend items={[{ color: "#dfe2e8", label: "To be billed" }, { color: ACCENT, label: "Expected collected" }]} />}>
        <StackedBars bars={bars} frontColor={ACCENT} />
      </ChartCard>
    );
  },

  "backlog-by-stage": async (ctx) => {
    const f = await forecast(ctx);
    return (
      <div className="pk-card" style={{ padding: "18px 20px" }}>
        <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 16 }}>Backlog value by stage</div>
        <StageBars rows={stageRows(f)} />
      </div>
    );
  },

  "margin-donut": async (ctx) => {
    const f = await forecast(ctx);
    const mDeg = Math.round(f.blended * 360);
    return (
      <div className="pk-card" style={{ padding: "18px 20px" }}>
        <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 4 }}>Margin at completion</div>
        <div style={{ fontSize: 12, color: "#8c919c", marginBottom: 16 }}>Blended across the open book</div>
        <Donut gradient={`conic-gradient(${ACCENT} 0deg ${mDeg}deg, #e9ebef ${mDeg}deg 360deg)`} center={`${Math.round(f.blended * 100)}%`} centerSub="margin"
          legend={[{ color: ACCENT, label: "Projected margin", value: money(f.totalValue - f.cost) }, { color: "#c9ccd3", label: "Est. cost", value: money(f.cost) }]} />
      </div>
    );
  },

  "upcoming-completions": async (ctx) => { const f = await forecast(ctx); /* JSX = 1043–1111 over f.upcoming, verbatim */ … },
  "completion-timeline": async (ctx) => {
    const f = await forecast(ctx);
    const bC = 6;
    const axis = Array.from({ length: bC + 1 }, (_, i) => ({ label: monthLabel(ctx.now + i * f.bucketMs), leftPct: (i / bC) * 100 }));
    /* JSX = 1116–1216 over f.timeline with `now = ctx.now`, `windowMs = f.windowMs`, verbatim */
    …
  },
  "project-locations": async (ctx) => {
    const [f, customers] = await Promise.all([forecast(ctx), ctx.data.customers()]);
    const custIndex = new Map(customers.map((c) => [c.id, c.locations || []]));
    const mapMax = Math.max(1, ...f.book.map((p) => p.value || 0));
    const pins: MapPin[] = f.book.map((p): MapPin | null => { /* 975–987 verbatim */ }).filter((x): x is MapPin => x !== null);
    return (
      <div className="pk-card" style={{ padding: "18px 20px" }}>
        <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 3 }}>Project locations</div>
        <div style={{ fontSize: 12, color: "#8c919c", marginBottom: 16 }}>{pins.length} located {pins.length === 1 ? "project" : "projects"} · pin size reflects contract value</div>
        <ReportsMap pins={pins} />
      </div>
    );
  },
} satisfies Record<string, WidgetRenderer>;
```

- [ ] **Step 2: Register** — `RENDERERS = { ...HOME_RENDERERS, ...SALES_RENDERERS, ...INSTALLS_RENDERERS }`.

- [ ] **Step 3: Rewrite `src/app/(app)/reports/page.tsx`**

```tsx
import { requireUser } from "@/lib/session";
import HomeTabs from "../home-tabs";
import WidgetHost from "../_dashboard/host";

export const metadata = { title: "Reports — Quartzite-6" };

/**
 * Reports (#43) — a widget surface. The former Sales and Installs views are
 * registry widgets (see _dashboard/widgets/sales.tsx, installs.tsx); the
 * user's saved layout decides which render and in what order. History
 * widgets follow ?range; installs widgets always look 12 months ahead.
 * ?view= and ?ir= are no longer read (D143).
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  return (
    <HomeTabs active="reports" maxWidth={1180}>
      <div style={{ marginBottom: 18 }}>
        <div className="pk-h1">Reports</div>
        <div className="pk-page-sub">Pipeline health, quoting performance, backlog and billing forecast — pick the widgets you want.</div>
      </div>
      <WidgetHost user={user} surface="reports" sp={sp} />
    </HomeTabs>
  );
}
```
Delete `SalesView`, `InstallsView`, `RangeChips`, `GRID_MAIN` and every helper that moved. `reports/controls.tsx` stays.

- [ ] **Step 4: Verify** tsc clean; `npx eslint "src/app/(app)/reports" "src/app/(app)/_dashboard"` → 0 errors; smoke → `/reports` 200; drive `/reports` as Admin: KPI row, quoted-vs-won, pipeline by stage, win donut, top customers, pipeline by estimator, then the installs tiles, billing forecast, backlog by stage, margin donut, upcoming completions, timeline, map — same figures as the pre-#43 page for `?range=6m` (compare against `git stash`-free means: open the previous build's `/reports` in a second browser tab before starting the dev server if you want a side-by-side; otherwise sanity-check totals against `/quotes` and `/projects`). `/reports?view=installs` renders the same page. Log in as an Estimator (dev picker): no "Avg. margin" tile and no margin donut, and the gallery does not offer them.

- [ ] **Step 5: Commit**
```bash
git add "src/app/(app)/_dashboard/widgets/installs.tsx" "src/app/(app)/_dashboard/renderers.tsx" "src/app/(app)/reports/page.tsx"
git commit -m "feat(dashboard): Reports Installs panels as widgets; /reports renders the user's layout (#43 §6)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: The spec's backward widgets — avg margin, projected profit, open projects, backlog, equipment sold

**Files:**
- Create: `src/app/(app)/_dashboard/widgets/backward.tsx`
- Modify: `src/app/(app)/_dashboard/renderers.tsx`

**Interfaces:** `BACKWARD_RENDERERS` for `avg-margin`, `projected-profit`, `open-projects`, `backlog`, `equipment-sold`. Equipment-sold drill = `?drill=<category>` (kept alongside `?range`/`?customize` via `dashHref`).

- [ ] **Step 1: Write `backward.tsx`**

```tsx
import Link from "next/link";
import { money } from "@/lib/format";
import { fmtDate, type ProjectRecord } from "@/lib/stores/projects";
import type { WidgetCtx, WidgetRenderer } from "@/lib/dashboard/context";
import { dashHref } from "@/lib/dashboard/registry";
import { backlogProjects, equipmentSold, openProjects, periodBounds, projectedProfit, salesMetrics } from "@/lib/dashboard/metrics";
import { ChartCard, MonoBadge, initialsOf } from "../charts";
import { tile } from "./tile";

/** #43 spec task 4 — the first backward widgets. */

const base = (ctx: WidgetCtx) => (ctx.surface === "home" ? "/" : "/reports");
const keep = (ctx: WidgetCtx) => ({ range: ctx.sp.range, customize: ctx.sp.customize });

function ProjectList({ title, sub, rows, empty }: { title: string; sub: string; rows: ProjectRecord[]; empty: string }) {
  return (
    <div className="pk-card" style={{ overflow: "hidden" }}>
      <div style={{ padding: "15px 18px 12px", borderBottom: "1px solid #f0f1f4" }}>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 12, color: "#8c919c", marginTop: 2 }}>{sub}</div>
      </div>
      {rows.slice(0, 8).map((p) => (
        <Link key={p.id} href={`/projects?id=${encodeURIComponent(p.id)}`} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 18px", borderBottom: "1px solid #f5f6f8", textDecoration: "none", color: "inherit" }}>
          <MonoBadge>{initialsOf(p.customer)}</MonoBadge>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
            <div style={{ fontSize: 10.5, color: "#aab0bb", marginTop: 2 }}>{p.customer} · {p.targetDate ? `target ${fmtDate(p.targetDate)}` : "no target"}</div>
          </div>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 600 }}>{money(p.value)}</span>
        </Link>
      ))}
      {rows.length === 0 && <div style={{ padding: "22px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>{empty}</div>}
    </div>
  );
}

export const BACKWARD_RENDERERS = {
  "avg-margin": async (ctx) => {
    const quotes = await ctx.data.quotes();
    const { start, end, priorStart } = periodBounds(ctx.range, ctx.now);
    const cur = salesMetrics(quotes, start, end);
    const prior = salesMetrics(quotes, priorStart, start);
    const pt = Math.round((cur.avgMargin - prior.avgMargin) * 100);
    return tile("Avg. margin", `${Math.round(cur.avgMargin * 100)}%`, `${pt >= 0 ? "+" : ""}${pt}pt vs. prior · quotes created`);
  },

  "projected-profit": async (ctx) => {
    const pp = projectedProfit(await ctx.data.projects());
    return tile("Projected profit", money(pp.profit), `${Math.round(pp.margin * 100)}% of ${money(pp.value)} open book`, "green");
  },

  "open-projects": async (ctx) => (
    <ProjectList title="Open projects" sub="Crews scheduled or on site" rows={openProjects(await ctx.data.projects())} empty="Nothing on site right now." />
  ),

  backlog: async (ctx) => (
    <ProjectList title="Backlog" sub="Sold — in procurement or delivery" rows={backlogProjects(await ctx.data.projects())} empty="No sold work waiting on materials." />
  ),

  "equipment-sold": async (ctx) => {
    const [quotes, parts] = await Promise.all([ctx.data.quotes(), ctx.data.catalogParts()]);
    const cat = new Map(parts.map((p) => [p.sku, p.category]));
    const { start, end } = periodBounds(ctx.range, ctx.now);
    const rows = equipmentSold(quotes, (sku) => cat.get(sku), start, end);
    const drill = ctx.sp.drill ? rows.find((r) => r.category === ctx.sp.drill) : null;
    const max = Math.max(1, ...(drill ? drill.items.map((i) => i.value) : rows.map((r) => r.value)));
    const bar = (v: number) => (
      <div style={{ height: 6, background: "#f1f2f5", borderRadius: 6, overflow: "hidden", marginTop: 5 }}>
        <div style={{ height: "100%", width: `${Math.round((v / max) * 100)}%`, background: "var(--accent)", borderRadius: 6 }} />
      </div>
    );
    const line = (key: string, label: string, sub: string, value: number, href?: string) => {
      const inner = (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5 }}>
            <span style={{ fontWeight: 600, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, flexShrink: 0 }}>{money(value)}</span>
          </div>
          <div style={{ fontSize: 10.5, color: "#aab0bb" }}>{sub}</div>
          {bar(value)}
        </>
      );
      const style: React.CSSProperties = { display: "block", padding: "9px 0", borderBottom: "1px solid #f5f6f8", textDecoration: "none", color: "inherit" };
      return href ? <Link key={key} href={href} style={style}>{inner}</Link> : <div key={key} style={style}>{inner}</div>;
    };
    return (
      <ChartCard
        title={drill ? `Equipment sold — ${drill.category}` : "Equipment sold"}
        right={drill
          ? <Link href={dashHref(base(ctx), keep(ctx))} style={{ fontSize: 12, color: "var(--accent-ink)", textDecoration: "none" }}>All categories</Link>
          : <span style={{ fontSize: 11.5, color: "#8c919c" }}>won quotes, by catalog category</span>}
      >
        {drill
          ? drill.items.slice(0, 12).map((i) => line(i.sku || i.desc, i.desc, `${i.sku || "custom"} · ${i.qty} sold`, i.value))
          : rows.slice(0, 8).map((r) => line(r.category, r.category, `${r.items.length} items · ${r.qty} units`, r.value, dashHref(base(ctx), { ...keep(ctx), drill: r.category })))}
        {rows.length === 0 && <div style={{ fontSize: 12.5, color: "#9aa0ab", padding: "8px 0" }}>No won line items in this period.</div>}
      </ChartCard>
    );
  },
} satisfies Record<string, WidgetRenderer>;
```
(`fmtDate` is exported from `src/lib/stores/projects.ts:974`; confirm the `/projects?id=` deep-link param name against `src/app/(app)/projects/page.tsx` and match it.)

- [ ] **Step 2: Register** — `RENDERERS = { ...HOME_RENDERERS, ...SALES_RENDERERS, ...INSTALLS_RENDERERS, ...BACKWARD_RENDERERS }`.

- [ ] **Step 3: Verify** tsc + eslint clean; drive `/reports?customize=1` as Admin: Add "Avg. margin", "Projected profit", "Open projects", "Backlog", "Equipment sold" — each renders; click a category in Equipment sold → `?drill=` shows items with the range preserved; "All categories" returns. Change range → avg margin and equipment sold change, projected profit and the lists do not.

- [ ] **Step 4: Commit**
```bash
git add "src/app/(app)/_dashboard/widgets/backward.tsx" "src/app/(app)/_dashboard/renderers.tsx"
git commit -m "feat(dashboard): avg margin, projected profit, open projects, backlog, equipment-sold drill widgets (#43 §4)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Lock the renderer map, delete dead code, docs, full gate

**Files:**
- Modify: `src/app/(app)/_dashboard/renderers.tsx` (`Partial<Record<…>>` → `Record<WidgetId, WidgetRenderer>`), `src/app/(app)/_dashboard/host.tsx` (drop the "not available yet" branch: `RENDERERS[id]` is now always defined)
- Delete: `src/app/(app)/home-stats.tsx`
- Modify: `DECISIONS.md` (append D143), `PUNCHLIST.md` (#43 → WAVE A DONE, list the deferred items; #7 → SUPERSEDED by #43), `MASTER-HOWTO.md` (one paragraph: Customize / Reset / range chips / where layouts live)

- [ ] **Step 1: Flip the type.** `export const RENDERERS: Record<WidgetId, WidgetRenderer> = { …four spreads… };` — tsc now fails if any registry id lacks a renderer. Simplify the host: `const body = await RENDERERS[id](ctx);` inside the try.

- [ ] **Step 2: Delete `home-stats.tsx`**: `git rm "src/app/(app)/home-stats.tsx"`; `grep -rn "home-stats\|HomeStats" src` → no hits.

- [ ] **Step 3: Full gate**, one at a time, nothing else holding a DB: `npx tsc --noEmit -p .` → empty; `npx eslint src scripts` → 0 errors; `npm run test:specs | tail -2` → ALL PASSED; `npm run test:review:regressions 2>&1 | tail -3` → passes; `npm run test:smoke 2>&1 | tail -3` → ALL PASSED; `pgrep -fl "next dev|next-server" || echo none` then `npm run build` → green (this is where a client-bundle leak would surface).

- [ ] **Step 4: Write D143** — registry over query builder; blob persistence keyed by user id; `approve` gate and the Estimator consequence; `?customize=1` + up/down (no DnD); `?range=` shared, `?view=`/`?ir=` dropped, forward = 12 months; fixed size classes and the Home column change; KpiTile unification; greeting/sheet as chrome; projected profit definition; open vs backlog stage split; equipment-sold rules; deferred wave (#15, pipeline/capacity, scheduled load, Installer preset). Update PUNCHLIST #43 and #7, MASTER-HOWTO.

- [ ] **Step 5: Commit**
```bash
git add "src/app/(app)/_dashboard/renderers.tsx" "src/app/(app)/_dashboard/host.tsx" DECISIONS.md PUNCHLIST.md MASTER-HOWTO.md
git commit -m "docs: D143 dashboard widget system wave A; #43 wave A shipped, #7 superseded; renderer map locked

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
(`git rm` already staged the deletion.)

---

## Self-review

**Spec coverage.** Registry of curated widgets, not a query builder → Task 1. One system for Home and Reports, Home cards as first widgets, Home = the user's layout → Tasks 4, 5, 7. Role-gated widgets + presets + per-user persistence via the notifPrefs pattern → Tasks 1, 2 (blob instead of a new table — decision 2). Pick + reorder from a gallery, fixed size classes, auto-flow grid, no drag-resize → Task 4. Global timeframe with forward-looking exemption → Tasks 1 (`timeframe`, `resolveRange`, `layoutNeedsRange`), 4 (chips), 6/7/8 (history vs forward renderers). Spec build task 4 widgets ($ quoted = `total-quoted`, avg margin, project profit, open-projects list, backlog list, equipment-sold with category→item drill) → Tasks 6, 8. Acceptance lines covered: an Estimator's default Reports offers no margin widgets (Task 7 verify); the timeframe changes history widgets and never the forecast (Task 8 verify). Not covered, deliberately: #15, pipeline/capacity, scheduled load, Installer preset, "Jeff composes his five widgets and sees monthly loading vs capacity" — the follow-on plan.

**Type consistency.** `WidgetId`/`Surface`/`RangeKey` produced in Task 1, consumed everywhere. `WidgetCtx`/`WidgetRenderer` produced in Task 4, every renderer file uses `satisfies Record<string, WidgetRenderer>`. `DashboardData` produced in Task 4, threaded via `WidgetHost`'s optional `data` prop from `page.tsx` (Task 5). `installsForecast`'s return shape (Task 3) is what `installs.tsx` destructures (Task 7). `saveLayoutAction(surface, ids)` signature is identical in Task 2, `frame-controls.tsx` and `gallery.tsx`.

**Regression guard.** Every Home card component and its props are untouched; each renderer reproduces the exact VM shaping page.tsx did, with line references. Reports chart primitives move verbatim; the two views are re-expressed panel-for-panel (only "Book by stage" is dropped as a duplicate). Presets equal today's order on both surfaces. Smoke covers `/` and `/reports`; Task 5 and 7 verification steps compare the rendered content to today's.

**Known risks.** (1) `Promise.all` over renderers means a slow widget delays the whole page — same as today's single `Promise.all`; acceptable. (2) `setBlob` merges per top-level key, so concurrent saves on the same surface are last-write-wins — fine for one user clicking buttons. (3) The `pipeHref` links in `home-pipeline.tsx` drop `?range`/`?customize`; cosmetic, noted in decision 13.
