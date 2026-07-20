# Home as a Tabbed Hub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold My Queue, Calendar, and Inbox under Home as tabs, add a My Queue card to the Dashboard, and decompose the 1,800-line `page.tsx` into per-card components. Header drops from 9 top-level items to 6.

**Architecture:** No route changes, no data changes, no redirects. A shared `HomeTabs` bar renders at the top of four existing routes; `nav-data.ts` drops three top-level links and maps all four paths to `home`. Tab keys live in a dependency-free module so both server routes and client views can import the *value*.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind v4, Drizzle/PGlite doc-store.

**Spec:** `docs/superpowers/specs/2026-07-20-home-tabbed-hub-design.md`

## Global Constraints

- **Next.js 16.** Read the relevant guide in `node_modules/next/dist/docs/` before writing route code. `searchParams`/`params` are Promises.
- **`requireUser()` / `requirePerm(perm)`** from `src/lib/session.ts` in every server component or action that touches data.
- **Client-bundle boundary:** `"use client"` files may only `import type` from anything reaching the doc-store. A *value* import pulls PGlite into the browser bundle and **fails the production build** — not typecheck. Bitten three times now (D90 `TABS`, D94, and a near-miss in D97).
- **Never export a `const` array from a `"use client"` file for server consumption** — the server receives a client-reference proxy and `.includes` is not a function. See `src/app/(app)/design/engagements/tabs.ts` and its header comment; `HomeTabs` follows that pattern exactly.
- **Never use `window.prompt` / `window.confirm`** — they throw silently in this app's browser context.
- **Timestamps are epoch-ms.** Never hardcode accent-colored UI — accent is user-configurable via `var(--accent)`.
- **Nav child keys are also badge-count keys** in `src/lib/nav-counts.ts` (`inbox`, `leads`, `reviews`, `projects`, `flametests`, `inspections`, `repairs`, `field`). Bell-group keys additionally double as stored per-user `NotifPrefs` keys. **Renaming either breaks live data.** `inbox` carries a count and this plan removes it as a top-level nav link — Task 5 addresses where that badge goes.
- **PGlite is single-process.** Never run a build or DB script while a dev server holds `.data/pglite`. This corrupted the dev DB twice.
- **No test framework.** `npm run test:specs` runs `scripts/test-review-and-spec.ts` under `tsx` with a hand-rolled `ok(cond, msg)` helper typed `(c: boolean, m: string)`. Do not add a framework or dependency. **An assertion that passes before the implementation exists is broken by definition** — verify each new assertion fails in the RED phase.
- **Prefer targeted edits over bulk `sed`.** Plan 1 hit three substring-collision bugs from bulk sed in this repo's overlapping module names.
- **Commit after every task.**

---

## Decisions this plan makes (beyond the spec)

1. **Four tabs now, not five.** The spec lists Reports as a fifth tab, but Reports only leaves the General nav group in the next plan (General dissolution). Shipping it here would put Reports in a dropdown *and* as a tab simultaneously. `HomeTabs` reads its tab list from `home-tabs-keys.ts`; the next plan appends one entry.
2. **`SegmentedToggle` is not reused.** `src/components/ui.tsx:373` exports a generic `SegmentedToggle<T>` with the right contract, but it renders a compact pill-in-track control sized for in-card filters. A page-level tab bar wants the underlined treatment used by the engagement detail tabs (`design/engagements/view.tsx:353-370`). `HomeTabs` is a new component following that visual, not a reuse of `SegmentedToggle`. Stated so a reviewer does not read it as a missed reuse.
3. **The pre-existing `/calendar` gap is fixed here.** `activeKeyFor()` has no `/calendar` entry today, so that tab never lights. This plan needs all four paths to resolve, so the fix lands in Task 5 rather than being deferred.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `src/app/(app)/home-tabs-keys.ts` | Dependency-free tab key/label/href table. Imported by both server routes and `HomeTabs`. |
| `src/app/(app)/home-tabs.tsx` | The shared tab bar. One responsibility: render four links, mark the active one. |
| `src/app/(app)/home-queue.tsx` | The new Dashboard My Queue card. |
| `src/app/(app)/home-shared.tsx` | `CardHeadTitle`, currently defined inline in `page.tsx:191` and used by seven cards. |
| `src/app/(app)/home-greeting.tsx`, `home-stats.tsx`, `home-inbox.tsx`, `home-my-leads.tsx`, `home-pipeline.tsx`, `home-catalog.tsx`, `home-field-surveys.tsx`, `home-team-activity.tsx`, `home-needs-attention.tsx` | One extracted Dashboard card each. |

**Modified:** `src/app/(app)/page.tsx`, `queue/page.tsx`, `calendar/page.tsx`, `inbox/page.tsx`, `src/components/nav/nav-data.ts`, `scripts/test-review-and-spec.ts`.

**Extraction rules** (the established house style — four siblings already follow it: `home-actions.ts`, `home-calendar.tsx`, `home-my-designs.tsx`, `home-stage-sheet.tsx`):
- Flat file beside `page.tsx`, named `home-<thing>.tsx`, imported as `./home-thing`.
- **Default export**, named `Home<Thing>`, props typed **inline** in the signature. No separate `Props` interface — none of the four existing siblings has one.
- Shared VM shapes are a named `export type` in the same file, imported as `import HomeX, { type XCard } from "./home-x";`.
- `page.tsx` maps store records into **flat, pre-formatted, serializable VMs** (strings, not Dates) before passing.
- **`"use client"` only when there is interactivity.** Every card extracted here is pure Links + markup, so they are **plain server components**. This is new for this file but consistent with its own doc comment at `page.tsx:46-51`.
- **`HOME_CSS` stays in `page.tsx`.** The extracted children depend on its class names (`.pkh-inbox`, `.pkh-stats`, `.pkh-rowscroll`, …); the `<style>` tag must remain in the parent that wraps them.

---

### Task 1: Tab keys and the HomeTabs component

**Files:**
- Create: `src/app/(app)/home-tabs-keys.ts`, `src/app/(app)/home-tabs.tsx`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `HOME_TABS`, `type HomeTabKey`, `homeTabFor(pathname: string): HomeTabKey | null`, and `HomeTabs` (default export, props `{ active: HomeTabKey }`).

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-review-and-spec.ts`:

```ts
/* --- home tabbed hub (D98) --- */
import { HOME_TABS, homeTabFor } from "@/app/(app)/home-tabs-keys";

ok(HOME_TABS.length === 4, "four tabs ship in this plan (Reports joins with the General dissolution)");
ok(HOME_TABS[0].key === "dashboard", "Dashboard is first and is the landing tab");
ok(homeTabFor("/") === "dashboard", "root resolves to Dashboard");
ok(homeTabFor("/queue") === "queue", "queue resolves");
ok(homeTabFor("/queue?who=Jack") === "queue", "queue resolves with a query string");
ok(homeTabFor("/calendar") === "calendar", "calendar resolves");
ok(homeTabFor("/calendar?month=2026-07") === "calendar", "calendar resolves with ?month=");
ok(homeTabFor("/inbox") === "inbox", "inbox resolves");
ok(homeTabFor("/inbox?thread=abc") === "inbox", "inbox resolves on a deep link");
ok(homeTabFor("/inbox?box=sales&folder=sent") === "inbox", "inbox resolves with mailbox params");
ok(homeTabFor("/reports") === null, "reports is not a tab yet — it joins in the next plan");
ok(homeTabFor("/leads") === null, "unrelated paths are not tabs");
ok(homeTabFor("/queue/extra") === null, "only exact tab paths resolve, not nested ones");
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd ~/Downloads/peak-app && npm run test:specs
```
Expected: FAIL — `Cannot find module '@/app/(app)/home-tabs-keys'`. Confirm this is the failure reason before continuing.

- [ ] **Step 3: Write the keys module**

Create `src/app/(app)/home-tabs-keys.ts`:

```ts
/**
 * Home hub tab keys (D98).
 *
 * Deliberately dependency-free, and deliberately NOT in a "use client" file:
 * both the server routes and the HomeTabs component import HOME_TABS as a
 * VALUE. Exporting it from a client module hands the server a
 * client-reference proxy and `.map`/`.find` stop being functions — the same
 * bug class as D90's TABS.
 *
 * Reports joins this list when the General group is dissolved; until then it
 * still lives in that nav group and must not render a tab.
 */

export const HOME_TABS = [
  { key: "dashboard", label: "Dashboard", href: "/" },
  { key: "queue", label: "My Queue", href: "/queue" },
  { key: "calendar", label: "Calendar", href: "/calendar" },
  { key: "inbox", label: "Inbox", href: "/inbox" },
] as const;

export type HomeTabKey = (typeof HOME_TABS)[number]["key"];

/** Resolve a pathname (query string tolerated) to its tab, or null. */
export function homeTabFor(pathname: string): HomeTabKey | null {
  const path = pathname.split("?")[0];
  const hit = HOME_TABS.find((t) => t.href === path);
  return hit ? hit.key : null;
}
```

- [ ] **Step 4: Write the tab bar**

Create `src/app/(app)/home-tabs.tsx`. A **server component** — it renders links and reads no state:

```tsx
import Link from "next/link";
import { HOME_TABS, type HomeTabKey } from "./home-tabs-keys";

/**
 * The Home hub tab bar (D98). Renders at the top of every hub route.
 * Visual follows the engagement detail tabs (design/engagements/view.tsx),
 * not the compact SegmentedToggle used for in-card filters.
 */
export default function HomeTabs({ active }: { active: HomeTabKey }) {
  return (
    <div
      style={{
        display: "flex", gap: 6, flexWrap: "wrap",
        borderBottom: "1px solid #eef0f3",
        paddingBottom: 10, marginBottom: 18,
      }}
    >
      {HOME_TABS.map((t) => {
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            style={{
              textDecoration: "none", fontSize: 12.5, fontWeight: 600,
              padding: "7px 12px", borderRadius: 8,
              color: on ? "color-mix(in srgb, var(--accent) 70%, #000)" : "#8c919c",
              background: on ? "color-mix(in srgb, var(--accent) 10%, #fff)" : "transparent",
              border: on
                ? "1px solid color-mix(in srgb, var(--accent) 30%, #fff)"
                : "1px solid transparent",
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5: Run the test**

```bash
cd ~/Downloads/peak-app && npm run test:specs && npx tsc --noEmit
```
Expected: all PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/home-tabs-keys.ts" "src/app/(app)/home-tabs.tsx" scripts/test-review-and-spec.ts
git commit -m "Home hub: tab keys module + shared tab bar (D98)"
```

---

### Task 2: Render the tab bar on the four routes

**Files:**
- Modify: `src/app/(app)/page.tsx`, `src/app/(app)/queue/page.tsx`, `src/app/(app)/calendar/page.tsx`, `src/app/(app)/inbox/page.tsx`

**Interfaces:**
- Consumes: `HomeTabs` (default export, `{ active: HomeTabKey }`) and `HomeTabKey` from Task 1.
- Produces: nothing.

**Routes do not move and screens do not merge.** Each keeps its own file and data loading and gains a bar. No redirects are needed anywhere in this plan.

- [ ] **Step 1: Add the bar to each route**

In each of the four server components, import and render `HomeTabs` as the first child inside the existing page wrapper, passing its own literal key:

```tsx
import HomeTabs from "../home-tabs";   // "./home-tabs" from page.tsx
...
<HomeTabs active="queue" />
```

Keys per file: `page.tsx` → `"dashboard"`, `queue/page.tsx` → `"queue"`, `calendar/page.tsx` → `"calendar"`, `inbox/page.tsx` → `"inbox"`.

Place it **inside** each page's existing `pk-content` wrapper, above the page's own heading, so it inherits the page's max-width and padding. On `page.tsx` specifically, it goes after the `<style>` tag (line 549) and before the greeting block.

- [ ] **Step 2: Confirm no route lost its query-string behavior**

These pages read query params that must keep working untouched. Verify by reading each page, not by assuming:

| Route | Params it reads |
|---|---|
| `/` | `?pipe=all\|draft\|sent\|won\|lost`, `?sheet=<quoteId>` |
| `/queue` | `?who=` (validated against the roster) |
| `/calendar` | `?month=YYYY-MM` |
| `/inbox` | `?view=needs\|calls`, `?box=`, `?folder=`, `?thread=`, `?draft=`, `?compose=1`, `?new=<customerId>` |

- [ ] **Step 3: Typecheck**

```bash
cd ~/Downloads/peak-app && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)"
git commit -m "Home hub: render the tab bar on Dashboard, Queue, Calendar, Inbox (D98)"
```

---

### Task 3: Extract `CardHeadTitle` and the first three cards

**Files:**
- Create: `src/app/(app)/home-shared.tsx`, `home-greeting.tsx`, `home-stats.tsx`, `home-catalog.tsx`
- Modify: `src/app/(app)/page.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `CardHeadTitle` — named export from `home-shared.tsx`, props `{ children: React.ReactNode }`
  - `HomeGreeting` — default export, props `{ greeting: string; firstName: string; standfirst: string; openReviewCount: number }`
  - `HomeStats` — default export, props `{ stats: Array<{ label: string; value: string; sub: string }> }`
  - `HomeCatalog` — default export, props `{ books: Array<{ name: string; count: number }>; partCount: number }`

**Read the source before extracting.** `page.tsx` line numbers below were mapped before this plan ran and will shift as you extract. Locate each block by its content, not its line number.

| Block | Approx. lines | Data it uses |
|---|---|---|
| `CardHeadTitle` | 191–193 | none — used by 7 cards |
| Greeting + quick actions (`.pkh-greet`) | 551–629 | `greeting`, `firstName(me)`, `standfirst`, `openReviewCount` |
| Stat tiles (`.pkh-stats`) | 631–669 | `stats[]` |
| Catalog card | 1381–1458 | `books` (from `priceBooks(catalogParts)`), `catalogParts.length` |

- [ ] **Step 1: Extract `CardHeadTitle` first**

It is used by seven cards, so it must exist before any card moves. Create `src/app/(app)/home-shared.tsx` with the component copied verbatim from `page.tsx`, delete the inline definition, and update `page.tsx` to import it.

- [ ] **Step 2: Extract the three cards**

For each: create the `home-*.tsx` file, move the JSX verbatim, type the props inline per the house style, replace the inline block in `page.tsx` with the component call, and pass the already-computed values as props. **Do not move the data-prep computations** — they stay in `page.tsx`, which remains responsible for loading and shaping.

None of these three needs `"use client"` — they are Links and markup only.

- [ ] **Step 3: Verify nothing changed visually**

```bash
cd ~/Downloads/peak-app && npx tsc --noEmit
```
The JSX must be moved **verbatim**. If you find yourself rewriting markup, stop — this task is decomposition, not redesign.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)"
git commit -m "Home hub: extract CardHeadTitle, greeting, stats, catalog (D98)"
```

---

### Task 4: Extract the remaining five cards

**Files:**
- Create: `home-inbox.tsx`, `home-my-leads.tsx`, `home-pipeline.tsx`, `home-field-surveys.tsx`, `home-team-activity.tsx`, `home-needs-attention.tsx`
- Modify: `src/app/(app)/page.tsx`

**Interfaces:**
- Consumes: `CardHeadTitle` from `home-shared.tsx` (Task 3).
- Produces: six default exports named `HomeInbox`, `HomeMyLeads`, `HomePipeline`, `HomeFieldSurveys`, `HomeTeamActivity`, `HomeNeedsAttention`. Each takes its VM as inline-typed props.

| Block | Approx. lines | Notes |
|---|---|---|
| Inbox card | 671–973 | Move the module-local `ChanIcon` **function** (lines 159–189) with it. Note it collides by name with a *type* `ChanIcon` exported from `inbox/types.ts` — rename the moved function `ChannelGlyph` to remove the ambiguity. |
| My leads | 975–1190 | Uses `leadChip()` / `leadSub()` closures — resolve them into the VM rows before passing rather than passing functions. |
| My pipeline | 1198–1379 | Uses `pipe`, `filterDefs`, `pipeCounts`, `pipeHref`, `filteredQuotes`, `sheetHref`, `STATUS_META`, `QUOTE_STATUS_TONE`, `StatusPill`. Move `STATUS_META` (62–70) with it — the pipeline card is its only consumer. |
| Field surveys | 1466–1610 | — |
| Team activity | 1612–1690 | Needs `initialsOf`/`colorOf` closures — **pass pre-resolved `{initials, color}` on each row** instead of the functions. |
| Needs attention | 1692–1792 | Move the `AlertRow` type (296–306) with it. Rows use `a.keepScroll` → `scroll={false}`. |

- [ ] **Step 1: Extract each card, one at a time, typechecking between**

Functions cannot cross into a server component as props in a useful way here — where the current code passes a closure, resolve its result into the VM first. That is the only shape change permitted in this task.

- [ ] **Step 2: Confirm `page.tsx` is now data-loading plus layout**

```bash
cd ~/Downloads/peak-app && wc -l "src/app/(app)/page.tsx"
```
Report the resulting line count. The spec's intent is that `page.tsx` ends as loading + layout; if it is still very large, say so in your report rather than extracting further — additional decomposition is out of scope.

- [ ] **Step 3: Typecheck**

```bash
cd ~/Downloads/peak-app && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)"
git commit -m "Home hub: extract the remaining dashboard cards (D98)"
```

---

### Task 5: Nav data

**Files:**
- Modify: `src/components/nav/nav-data.ts`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a 6-item `NAV`; `activeKeyFor` returning `home` for all four hub paths.

**The `inbox` badge count.** `src/lib/nav-counts.ts:104` sets `counts.inbox`, and `Nav.tsx` renders badges from `counts[child.key]` for group children and top-level links. Removing `inbox` as a top-level link removes the only surface that badge had. **Do not delete the count** — `navData()` still computes it and the bell still uses `comms`. Leave `nav-counts.ts` untouched; the badge simply stops rendering until a later plan gives Home a count. Note this explicitly in your report so it is a recorded consequence, not a silent loss.

- [ ] **Step 1: Write the failing test**

```ts
/* --- home hub nav (D98) --- */
ok(NAV.length === 6, "the header is down to 6 top-level items");
ok(!NAV.some((e) => e.kind === "link" && e.key === "queue"), "My Queue is no longer top-level");
ok(!NAV.some((e) => e.kind === "link" && e.key === "calendar"), "Calendar is no longer top-level");
ok(!NAV.some((e) => e.kind === "link" && e.key === "inbox"), "Inbox is no longer top-level");
ok(activeKeyFor("/") === "home", "root lights Home");
ok(activeKeyFor("/queue") === "home", "queue lights Home");
ok(activeKeyFor("/calendar") === "home", "calendar lights Home — this path had NO map entry before");
ok(activeKeyFor("/inbox") === "home", "inbox lights Home");
ok(activeKeyFor("/reports") === "reports", "reports still lights its own key until General is dissolved");
```

`NAV` and `activeKeyFor` are already imported by the D97 block earlier in the file — do not import them twice.

- [ ] **Step 2: Run it and confirm each new assertion fails**

```bash
cd ~/Downloads/peak-app && npm run test:specs
```
Expected: the six new assertions FAIL. **`activeKeyFor("/calendar")` returns `""` today** — that is the pre-existing gap this task closes, and seeing it fail here confirms the test is real.

- [ ] **Step 3: Edit `nav-data.ts`**

Delete the `queue`, `calendar`, and `inbox` top-level link entries. In the `activeKeyFor` map, replace their entries with:

```ts
    "/queue": "home",
    "/calendar": "home",
    "/inbox": "home",
```

`"/"` already short-circuits to `home` at the top of the function. Leave `"/reports"` alone — it moves in the next plan.

- [ ] **Step 4: Run the test**

```bash
cd ~/Downloads/peak-app && npm run test:specs && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/components/nav/nav-data.ts scripts/test-review-and-spec.ts
git commit -m "Home hub: fold Queue, Calendar and Inbox into the Home pill (D98)"
```

---

### Task 6: The Dashboard My Queue card

**Files:**
- Create: `src/app/(app)/home-queue.tsx`
- Modify: `src/app/(app)/page.tsx`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `loadQueue(me: string): Promise<QueueItem[]>` and `queueNow(): number` from `@/lib/queue`; `QueueItem` from `@/lib/queue-types` (`{ key, source, title, context, due, href, writable }`, `due` epoch-ms, `0` = undated).
- Produces: `HomeQueue` — default export, props `{ open: number; overdue: number; rows: Array<{ key: string; title: string; context: string; dueLabel: string; href: string }> }`; and `queueCardCounts(items, now)` exported from `src/lib/queue.ts`.

**The queue is the reason this spec exists.** Per the spec: My Queue goes from one click to two, so this card carries the job of surfacing urgency. If it does not, the queue gets quieter than it was.

**`loadQueue` already returns only open items** — completed assignments, done project tasks, and completed milestones are filtered out inside it, and renewals are fetched with `{ dueOnly: true }`. So `open` is simply `items.length`.

**The counts expression already exists** at `queue/view.tsx:87`. Extract it to a pure function rather than writing a third copy:

- [ ] **Step 1: Write the failing test**

```ts
/* --- home queue card (D98) --- */
import { queueCardCounts } from "@/lib/queue";

const NOW = 1_800_000_000_000;
const qi = (due: number) => ({ key: "k" + due, source: "assignment", title: "t", context: "c", due, href: "/queue", writable: true }) as any;

ok(queueCardCounts([], NOW).open === 0, "empty queue reports zero open");
ok(queueCardCounts([], NOW).overdue === 0, "empty queue reports zero overdue");
ok(queueCardCounts([qi(NOW - 1000), qi(NOW + 1000)], NOW).open === 2, "open counts every item loadQueue returned");
ok(queueCardCounts([qi(NOW - 1000), qi(NOW + 1000)], NOW).overdue === 1, "overdue counts only items due before now");
ok(queueCardCounts([qi(0)], NOW).overdue === 0, "undated items (due === 0) are never overdue");
ok(queueCardCounts([qi(0)], NOW).open === 1, "undated items still count as open");
ok(queueCardCounts([qi(NOW)], NOW).overdue === 0, "an item due exactly now is not yet overdue");
```

The `due === 0` cases are the ones that matter: `0` means undated, and a naive `due < now` marks every undated item overdue.

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd ~/Downloads/peak-app && npm run test:specs
```
Expected: FAIL — `queueCardCounts` is not exported.

- [ ] **Step 3: Add the pure function to `src/lib/queue.ts`**

```ts
/** Open/overdue tallies for the Home queue card. `due === 0` means undated. */
export function queueCardCounts(
  items: QueueItem[],
  now: number
): { open: number; overdue: number } {
  let overdue = 0;
  for (const i of items) if (i.due && i.due < now) overdue++;
  return { open: items.length, overdue };
}
```

Then refactor `queue/view.tsx:87` to use it, so the expression exists once.

- [ ] **Step 4: Write the card**

Create `src/app/(app)/home-queue.tsx` as a **server component** (Links and markup only), using `CardHeadTitle` from `./home-shared` and the same `pk-card` shell as the sibling cards. Show the open count, the overdue count when non-zero, the next few items, and a link to `/queue`. Render an explicit empty state when `open === 0`.

- [ ] **Step 5: Wire it into `page.tsx`**

Load with the existing `Promise.all` block, compute the VM server-side (including `dueLabel` — all date formatting happens server-side per the house style), and place the card so urgency is visible without scrolling.

- [ ] **Step 6: Test and typecheck**

```bash
cd ~/Downloads/peak-app && npm run test:specs && npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)" src/lib/queue.ts scripts/test-review-and-spec.ts
git commit -m "Home hub: My Queue card on the Dashboard (D98)"
```

---

### Task 7: Verify end to end

**Files:** none except `DECISIONS.md`.

- [ ] **Step 1: Confirm no dev server is running, then build**

```bash
cd ~/Downloads/peak-app && pgrep -fl "next dev|next-server" || echo "none running"
npm run build
```
A dev server holding `.data/pglite` must be stopped **first** — never run the build alongside one. If one is running that you did not start, stop and report rather than killing it.

Expected: green. A client-bundle leak fails **here**, not at typecheck.

- [ ] **Step 2: Test script**

```bash
cd ~/Downloads/peak-app && npm run test:specs
```
Expected: every assertion passes, including the pre-existing bid-spec, annotation, and D97 sections.

- [ ] **Step 3: Drive the app**

Start a dev server, then verify:

| Path | Expect |
|---|---|
| `/` | Dashboard tab active; My Queue card present with real counts |
| `/queue` | My Queue tab active; `?who=` still filters |
| `/queue?who=<roster name>` | tab still active, filter applied |
| `/calendar` | Calendar tab active — **this never lit before** |
| `/calendar?month=2026-08` | tab active, August shown |
| `/inbox` | Inbox tab active |
| `/inbox?thread=<id>` | tab active, thread open |
| `/inbox?box=sales&folder=sent` | tab active, correct mailbox |
| `/inbox?compose=1` | tab active, composer open |
| `/reports?view=installs` | renders as before, **no** Home tab bar |

On all four hub paths the **Home** pill must be lit, and the header must show **6** top-level items.

- [ ] **Step 4: Confirm the queue card against the real queue**

Open `/` and `/queue` together. The card's open and overdue counts must match the Queue tab's own header. A mismatch means the card and the view disagree about `now` — `queueNow()` must be called once on the server and passed down.

- [ ] **Step 5: Stop the dev server you started, record the decision, commit**

Append a `## D98 — Home as a tabbed hub` entry to `DECISIONS.md` covering: four tabs now and why Reports waits, the `/calendar` `activeKeyFor` gap closed here, the `inbox` badge losing its render surface, and the `page.tsx` decomposition.

```bash
git add DECISIONS.md
git commit -m "D98: record the Home tabbed hub decisions"
```

---

## Self-review

**Spec coverage.** Structure/tab table → Tasks 1–2. Dashboard tab + My Queue card → Task 6. `page.tsx` decomposition ("required, not optional") → Tasks 3–4. `nav-data.ts` drops three entries, `activeKeyFor` maps all to `home` → Task 5. "No redirect map is needed at all" → honored; no task creates one. Testing section → Tasks 1, 5, 6, 7.

**Deliberate deviations from the spec, stated for the reviewer:** four tabs instead of five (Reports moves with the General dissolution); `SegmentedToggle` not reused (wrong visual weight for a page-level bar); the pre-existing `/calendar` gap fixed here rather than deferred.

**Type consistency.** `HomeTabKey` is produced in Task 1 and consumed in Tasks 2 and 5. `queueCardCounts(items, now)` is defined in Task 6 Step 3 and used with that exact signature in its test and in `queue/view.tsx`. `CardHeadTitle` is produced in Task 3 and consumed in Tasks 4 and 6.

**Known risk this plan does not eliminate.** The spec's own stated behavioural cost: My Queue goes from one click to two. Task 6 is the mitigation; Task 7 Step 4 is the check. If the card under-surfaces urgency in real use, that is a product finding for after a week of use, not a defect in this plan.
