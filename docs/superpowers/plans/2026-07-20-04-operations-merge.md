# Operations Merge Implementation Plan (D100)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the **Installs** and **Service** nav groups into one **Operations** group (header **5 → 4**: Home · Design · Sales · Operations), and make `/schedule` and `/field-work` aggregate all four work types (projects, flame tests, inspections, repairs) instead of projects only.

**Architecture:** A dependency-free pure module (`src/lib/operations-work.ts`) holds the normalization logic — a strict local-midnight date parser, the per-type color/label/href metadata, and pure functions that turn each store's records into a common `WorkItem[]`. A server assembler (`src/lib/operations-work-server.ts`) fetches the four PGlite-backed stores and calls the pure functions. The two existing server pages (`/schedule`, `/field-work`) call the assembler and render: Schedule adds single-day service bars onto the crew board's assignee lanes (plus an unassigned lane); Field Work becomes today's work for the signed-in person across all four types. No data model changes, no migrations, no change to how any job type works or how it is scheduled — scheduling stays on each type's own screen.

**Tech Stack:** Next.js 16 App Router (server components; `searchParams` is a `Promise`), TypeScript (strict, typechecked in `next build`). Test harness: `tsx scripts/test-review-and-spec.ts` — a flat `ok(cond, msg)` script over **pure** modules only.

**Spec:** `docs/superpowers/specs/2026-07-20-operations-merge-design.md` (approved by Jeff).

## Global Constraints

- **Decision number: D100.** Implementation commits end with `(D100)`; the DECISIONS.md record commit is prefixed `D100:`.
- **Store import paths (verified — the spec's names are wrong):** flame tests = `@/lib/stores/flame-jobs` (type `FlameJob`, `getAll()`), inspections = `@/lib/stores/inspections` (type `InspectionRecord`, `getAll()`), repairs = `@/lib/stores/repair-jobs` (type `RepairJobRecord`, `getAll()`), projects = `@/lib/stores/projects` (type `ProjectRecord`, `getAllProjects()`). There is **no** `flame.ts` or `repairs.ts` barrel.
- **Date normalization is the risk. Port the strict `msOf` verbatim** (regex `YYYY-MM-DD` → `new Date(+y, +m-1, +d)` = local midnight; `''` or non-match → `null`). NEVER call `inspections.parseISO`/`inspections.msOf` — its non-ISO fallback (`new Date(s)`) is UTC-prone and shifts dates a day west of UTC. `''` means unset → **excluded**, never defaulted to epoch 0.
- **`assignedTo` is a team-member NAME, not an id.** "Mine" = `record.assignedTo === me.name`. Projects have no `assignedTo`; assignment is `crew[].person` (also a name). Unassigned = `assignedTo === ""`.
- **`CrewAssignment.end` is INCLUSIVE.** A synthesized single-day service booking is `startMs === endMs`, never `end = start + DAY` (that renders a 2-day bar).
- **Inspections have FOUR stages:** `requested | scheduled | onsite | completed`. The `onsite` stage sits between scheduled and completed — a live/dated filter must include it. Use the predicate **`stage !== "completed"`** for all three service stores (projects use `stage !== "complete"` — different spelling). For dated views additionally require `msOf(scheduledDate) != null`.
- **Repairs = one row keyed by `assignedTo`** (matches flame/inspections, which have no `crew`, and matches the existing repairs UI). Repairs also carry `crew: string[]`, but this plan does NOT fan out per crew member. (Documented as a D100 decision; revisit if Jeff wants per-crew rows.)
- **The `"use client"` / PGlite boundary (load-bearing).** All four stores import `@/db/doc-store` → PGlite/Drizzle (server-only). The pure module must import the store record types with **`import type`** only (erased at build) and must not import any store value or `@/db`. Precedent: `queue-types.ts` (pure) ↔ `queue.ts` (server). A value import of a store into a `"use client"` module breaks the production build (D90/D98 class of bug).
- **Do not touch the per-type schedulers** (`/flame-tests/scheduling`, `/repairs/scheduling`, `/inspections/scheduling`) — scheduling stays there; this plan adds read views only. No change to Reports, no retiring of per-type schedulers (out of scope).
- **Test harness:** `npm run test:specs` (flat `ok(cond,msg)`, exit 0 = all pass). Baseline before this plan: **105 assertions** (post-D99 on main). Re-count after each task. TDD required: failing test first, watch it FAIL, then implement.
- **PGlite is single-process.** NEVER run `npm run build` (or any db script) while a dev server runs. Kill every dev server first.
- **Never rename an existing nav key.** The six Operations child keys (`projects`, `schedule`, `fieldwork`, `flametests`, `inspections`, `repairs`) are preserved verbatim — badge counts are keyed on them.

---

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `src/components/nav/nav-data.ts` | Merge `installs` + `service` groups → one `operations` group. | 1 |
| `src/lib/operations-work.ts` | **New, dependency-free.** `WorkType`, `WORK_TYPE_META` (color/label per type), strict `msOf`, `WorkItem` type, and pure normalizers: `serviceToWorkItems`, `projectBookingsMine`, and the `isToday`/day helpers. Import store types with `import type` only. | 2 |
| `src/lib/operations-work-server.ts` | **New, server-only.** `loadServiceWork()` — fetch flame/inspections/repairs `getAll()`, map via the pure normalizers → `WorkItem[]`. | 3 |
| `src/app/(app)/schedule/page.tsx` | Add single-day service bars onto the crew board's assignee lanes + an unassigned lane, color-coded by type, linking to each record. | 4 |
| `src/app/(app)/field-work/page.tsx` | Become today's work for the signed-in person across all four types. | 5 |
| `src/app/(app)/flame-tests/today/page.tsx` | Replace with a `redirect("/field-work")` stub. | 5 |
| `DECISIONS.md` | The D100 record. | 6 |
| `scripts/test-review-and-spec.ts` | Nav assertions (NAV.length 5→4, order string) + a full pure-module test block. | 1, 2 |

**Task order:** 1 (nav) → 2 (pure module + tests) → 3 (server assembler) → 4 (Schedule) → 5 (Field Work + redirect) → 6 (record + whole-branch verify). Tasks 4 and 5 both depend on 2 and 3.

---

### Task 1: Merge Installs + Service → Operations (header 5 → 4)

**Files:**
- Modify: `src/components/nav/nav-data.ts` (replace the `installs` group, lines ~48–57, and the `service` group, lines ~58–67, with one `operations` group)
- Test: `scripts/test-review-and-spec.ts` (line ~189 `NAV.length`; lines ~254–257 the order string; append a new Operations block)

**Interfaces:**
- Consumes: `NAV`, `parentGroupOf` (existing pure exports).
- Produces: one `operations` group with 6 children in order `projects, schedule, fieldwork, flametests, inspections, repairs`; `NAV.length === 4`.

- [ ] **Step 1: Write the failing test.** In `scripts/test-review-and-spec.ts`:

Change the `NAV.length` assertion (currently `ok(NAV.length === 5, "the header is down to 5 top-level items (General dissolved, D99)");`) to:

```ts
ok(NAV.length === 4, "the header is down to 4 top-level items (Operations merge, D100)");
```

Change the order assertion (currently the block asserting `NAV.map((e) => e.key).join(",") === "home,design,sales,installs,service"`) to:

```ts
ok(
  NAV.map((e) => e.key).join(",") === "home,design,sales,operations",
  "the four top-level items are Home, Design, Sales, Operations in order",
);
```

Append a new block after the existing D99 nav assertions:

```ts
// ---- Operations merge (D100): Installs + Service → Operations ----
const d100Ops = NAV.find((e) => e.kind === "group" && e.key === "operations");
ok(
  !!(d100Ops && d100Ops.kind === "group" && d100Ops.children.length === 6),
  "Operations has six children",
);
ok(
  !!(
    d100Ops &&
    d100Ops.kind === "group" &&
    d100Ops.children.map((c) => c.key).join(",") ===
      "projects,schedule,fieldwork,flametests,inspections,repairs"
  ),
  "Operations children are projects, schedule, fieldwork, flametests, inspections, repairs in order",
);
ok(!NAV.some((e) => e.kind === "group" && e.key === "installs"), "the Installs group is gone");
ok(!NAV.some((e) => e.kind === "group" && e.key === "service"), "the Service group is gone");
ok(
  parentGroupOf("projects") === "operations" &&
    parentGroupOf("schedule") === "operations" &&
    parentGroupOf("fieldwork") === "operations" &&
    parentGroupOf("flametests") === "operations" &&
    parentGroupOf("inspections") === "operations" &&
    parentGroupOf("repairs") === "operations",
  "all six work children report Operations as their parent group",
);
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npm run test:specs`
Expected: FAIL — the `NAV.length === 4`, the order string, and the new Operations assertions FAIL (groups are still `installs`/`service`). Exit non-zero.

- [ ] **Step 3: Merge the groups in `nav-data.ts`.** Replace the two group objects (the `installs` group and the `service` group) with one `operations` group. The result reads:

```ts
  {
    kind: "group",
    key: "operations",
    label: "Operations",
    children: [
      { key: "projects", label: "Projects", href: "/projects" },
      { key: "schedule", label: "Schedule", href: "/schedule" },
      { key: "fieldwork", label: "Field Work", href: "/field-work" },
      { key: "flametests", label: "Flame Tests", href: "/flame-tests" },
      { key: "inspections", label: "Rigging Inspections", href: "/inspections" },
      { key: "repairs", label: "Repairs", href: "/repairs" },
    ],
  },
```

Leave `activeKeyFor` and `parentGroupOf` unchanged — the six paths already map to their child keys, and `parentGroupOf` now derives `"operations"` automatically.

- [ ] **Step 4: Run the test to verify it passes.**

Run: `npm run test:specs`
Expected: PASS — all new assertions PASS; the global key-uniqueness assertion still PASSES (keys unchanged, just re-parented). `ALL PASSED`, exit 0. Count rose by 5 (105 → 110).

- [ ] **Step 5: Commit.**

```bash
git add src/components/nav/nav-data.ts scripts/test-review-and-spec.ts
git commit -m "Nav: merge Installs and Service into Operations; header is now four items (D100)"
```

---

### Task 2: The pure aggregation module + tests

**Files:**
- Create: `src/lib/operations-work.ts`
- Test: `scripts/test-review-and-spec.ts` (append an Operations-work block; add an import)

**Interfaces:**
- Produces (consumed by Task 3, 4, 5, and the test):
  - `type WorkType = "project" | "flame" | "inspection" | "repair"`.
  - `WORK_TYPE_META: Record<WorkType, { label: string; color: string; soft: string }>`.
  - `msOf(iso: string | null | undefined): number | null` — strict local-midnight parser.
  - `type WorkItem = { id; type: WorkType; title; subtitle; assignee; startMs: number; endMs: number; href; stage }`.
  - `serviceToWorkItems(recs, type, hrefFor): WorkItem[]` — normalizes any of the three service stores (structural typing), filtering to `stage !== "completed"` AND a parseable `scheduledDate`.
  - `startOfDay(ms: number): number` and `isSameOrBeforeDay(itemMs, dayMs): boolean` helpers for the day-view.

- [ ] **Step 1: Write the failing test.** In `scripts/test-review-and-spec.ts`, add near the other `@/lib` imports:

```ts
import {
  msOf as opMsOf,
  serviceToWorkItems,
  WORK_TYPE_META,
  startOfDay as opStartOfDay,
} from "@/lib/operations-work";
```

Append this block after the Task 1 Operations nav block:

```ts
// ---- Operations merge (D100): pure work normalization ----
// msOf: strict local midnight; '' and malformed -> null (never epoch 0, never UTC-shifted)
ok(opMsOf("") === null, "msOf('') is null (unset is excluded, not epoch 0)");
ok(opMsOf(undefined) === null, "msOf(undefined) is null");
ok(opMsOf("not-a-date") === null, "msOf of a non-ISO string is null (no UTC fallback)");
ok(
  opMsOf("2026-07-20") === new Date(2026, 6, 20).getTime(),
  "msOf parses YYYY-MM-DD as LOCAL midnight (agrees with the job's own screen)",
);
// A date that naive `new Date('2026-01-01')` would render as Dec 31 west of UTC:
ok(
  opMsOf("2026-01-01") === new Date(2026, 0, 1).getTime(),
  "msOf('2026-01-01') is local Jan 1, not UTC (no day shift)",
);

const svc = [
  { id: "A", customer: "Alpha HS", venue: "Auditorium", assignedTo: "Nic", scheduledDate: "2026-07-20", stage: "scheduled" },
  { id: "B", customer: "Beta MS", venue: "Gym", assignedTo: "", scheduledDate: "2026-07-21", stage: "onsite" },
  { id: "C", customer: "Gamma HS", venue: "Theater", assignedTo: "Nic", scheduledDate: "", stage: "scheduled" }, // unset date -> excluded
  { id: "D", customer: "Delta HS", venue: "PAC", assignedTo: "Jena", scheduledDate: "2026-07-22", stage: "completed" }, // done -> excluded
];
const svcItems = serviceToWorkItems(svc, "inspection", (id) => "/inspections/" + id);
ok(svcItems.length === 2, "serviceToWorkItems drops the unset-date and the completed job");
ok(svcItems.every((w) => w.startMs === w.endMs), "a service item is a single day (start === end, inclusive)");
ok(
  svcItems.some((w) => w.id === "B" && w.assignee === "" && w.startMs != null),
  "an unassigned in-progress (onsite) job is KEPT with assignee '' (unassigned lane)",
);
ok(
  svcItems.find((w) => w.id === "A")?.href === "/inspections/A",
  "serviceToWorkItems uses the provided hrefFor for the deep link",
);
ok(
  svcItems.find((w) => w.id === "A")?.type === "inspection" &&
    WORK_TYPE_META.inspection.color.length > 0,
  "each item carries its work type and the type has a color",
);
ok(
  opStartOfDay(new Date(2026, 6, 20, 15, 30).getTime()) === new Date(2026, 6, 20).getTime(),
  "startOfDay truncates to local midnight",
);
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npm run test:specs`
Expected: FAIL — `tsx` cannot resolve `@/lib/operations-work` (module does not exist yet). This is the RED state.

- [ ] **Step 3: Create the module.** Write `src/lib/operations-work.ts`:

```ts
/**
 * Operations work normalization (D100) — dependency-free.
 *
 * Imported by the server assembler (operations-work-server.ts) and by the spec
 * test. It imports store record types with `import type` ONLY (erased at build)
 * and imports NO store value and nothing from @/db, so it stays out of the
 * client/PGlite blast radius (same contract as queue-types.ts).
 *
 * The strict `msOf` below is ported verbatim from flame-jobs/repair-jobs. Do
 * NOT use inspections' parseISO/msOf — its non-ISO fallback (`new Date(s)`) is
 * UTC-prone and shifts dates a day west of UTC.
 */
import type { FlameJob } from "@/lib/stores/flame-jobs";
import type { InspectionRecord } from "@/lib/stores/inspections";
import type { RepairJobRecord } from "@/lib/stores/repair-jobs";

export type WorkType = "project" | "flame" | "inspection" | "repair";

export const WORK_TYPE_META: Record<WorkType, { label: string; color: string; soft: string }> = {
  project: { label: "Project", color: "#5b4b8a", soft: "#efecf6" },
  flame: { label: "Flame test", color: "#b4543a", soft: "#f7ece8" },
  inspection: { label: "Inspection", color: "#3155a8", soft: "#e9eefb" },
  repair: { label: "Repair", color: "#1f6a8a", soft: "#e6f0f4" },
};

/** 'YYYY-MM-DD' -> epoch ms at LOCAL midnight; '' / null / malformed -> null. */
export function msOf(iso: string | null | undefined): number | null {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
}

/** Truncate an epoch-ms to local midnight. */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** A single scheduled unit of work, normalized across all four sources. */
export type WorkItem = {
  id: string;
  type: WorkType;
  title: string; // customer / project name
  subtitle: string; // venue (service) or customer (project)
  assignee: string; // team-member NAME, or "" for unassigned
  startMs: number; // scheduled day at local midnight
  endMs: number; // inclusive end; single-day service item: === startMs
  href: string;
  stage: string;
};

/** The minimal shape shared by FlameJob, InspectionRecord, RepairJobRecord. */
type ServiceLike = {
  id: string;
  customer: string;
  venue: string;
  assignedTo: string;
  scheduledDate: string;
  stage: string;
};

/**
 * Normalize a service store's records into single-day WorkItems.
 * Keeps only live (`stage !== "completed"`) jobs with a parseable scheduledDate;
 * an unset date ('') is excluded (never epoch 0). Unassigned jobs (assignedTo '')
 * are KEPT — they belong in the unassigned lane. One item per record, keyed by
 * `assignedTo` (repairs' `crew` is intentionally NOT fanned out — see D100).
 */
export function serviceToWorkItems<T extends ServiceLike>(
  recs: readonly T[],
  type: WorkType,
  hrefFor: (id: string) => string,
): WorkItem[] {
  const out: WorkItem[] = [];
  for (const r of recs) {
    if (r.stage === "completed") continue;
    const startMs = msOf(r.scheduledDate);
    if (startMs == null) continue;
    out.push({
      id: r.id,
      type,
      title: r.customer,
      subtitle: r.venue,
      assignee: r.assignedTo,
      startMs,
      endMs: startMs, // single day, inclusive
      href: hrefFor(r.id),
      stage: r.stage,
    });
  }
  return out;
}

// Type-only re-exports so callers can name the source records without importing
// the store values. (FlameJob/InspectionRecord/RepairJobRecord all satisfy
// ServiceLike structurally, so serviceToWorkItems accepts each directly.)
export type { FlameJob, InspectionRecord, RepairJobRecord };
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `npm run test:specs`
Expected: PASS — all new assertions PASS. Count rose (110 → ~122). `ALL PASSED`, exit 0.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/operations-work.ts scripts/test-review-and-spec.ts
git commit -m "Operations: dependency-free work-item normalization with strict local-midnight dates (D100)"
```

---

### Task 3: The server assembler

**Files:**
- Create: `src/lib/operations-work-server.ts`

**Interfaces:**
- Consumes: `serviceToWorkItems`, `WorkItem` from `./operations-work`; `getAll` from each service store.
- Produces: `loadServiceWork(): Promise<WorkItem[]>` — all live, dated flame + inspection + repair jobs as `WorkItem[]`, with correct deep-link hrefs. (Projects are handled in the pages, which already fetch them.)

This module is server-only (it reads the PGlite-backed stores). It has no pure logic worth a unit test beyond what Task 2 covers; it is verified by the Task 4/5 builds and drive.

- [ ] **Step 1: Create the module.** Write `src/lib/operations-work-server.ts`:

```ts
/**
 * Operations work assembler (D100) — SERVER ONLY.
 *
 * Reads the three service stores (PGlite-backed) and normalizes them into
 * WorkItem[] via the pure helpers in ./operations-work. Never import this from
 * a "use client" module. Projects are fetched by the pages themselves
 * (getAllProjects) and merged there.
 */
import { getAll as getAllFlame } from "@/lib/stores/flame-jobs";
import { getAll as getAllInspections } from "@/lib/stores/inspections";
import { getAll as getAllRepairs } from "@/lib/stores/repair-jobs";
import { serviceToWorkItems, type WorkItem } from "./operations-work";

/** All live, dated flame + inspection + repair jobs as normalized WorkItems. */
export async function loadServiceWork(): Promise<WorkItem[]> {
  const [flame, inspections, repairs] = await Promise.all([
    getAllFlame(),
    getAllInspections(),
    getAllRepairs(),
  ]);
  return [
    ...serviceToWorkItems(flame, "flame", (id) => "/flame-tests/results?job=" + encodeURIComponent(id)),
    ...serviceToWorkItems(inspections, "inspection", (id) => "/inspections/" + encodeURIComponent(id)),
    ...serviceToWorkItems(repairs, "repair", (id) => "/repairs/results?job=" + encodeURIComponent(id)),
  ];
}
```

- [ ] **Step 2: Verify it typechecks against the stores.** Kill any dev server, then run `npm run build`. Expected: green — this confirms `getAll` exists on all three stores with compatible signatures and the `ServiceLike` structural match holds. (If `getAll` is named differently on a store, the build fails here; check the store's exports and fix the import.) Then `npm run test:specs` (should still be ~122, unchanged — no new assertions).

- [ ] **Step 3: Commit.**

```bash
git add src/lib/operations-work-server.ts
git commit -m "Operations: server assembler that loads service work across the three stores (D100)"
```

---

### Task 4: Schedule shows all four work types

**Files:**
- Modify: `src/app/(app)/schedule/page.tsx`

**Interfaces:**
- Consumes: `loadServiceWork` from `@/lib/operations-work-server`; `WORK_TYPE_META` from `@/lib/operations-work`.
- Produces: the crew board (`?view=crew`, the default) shows, in addition to project crew bookings, one single-day bar per live+dated service job on its assignee's lane (or an "Unassigned" lane), color-coded by work type, linking to the job's own record.

This is an integration into a large (~1785-line) hand-built server component. **The implementer must read `src/app/(app)/schedule/page.tsx` in full before editing.** Verified anchors from the codebase map:
- The page is `async function SchedulePage`; it fetches `const [projects, users] = await Promise.all([getAllProjects(), activeUsers()])` (~line 114–115).
- It builds a `Booking[]` array by flattening `project.crew` (~lines 132–150). `Booking = { projectId, projectName, customer, stage, completed, crewId, mobId, person, role, start, end, color }` (~lines 74–87).
- The crew board renders one row per roster person; the roster is `activeUsers()` plus any booked `person` not on the roster (~lines 171–182). Bars are absolute-positioned `<Link>`s per booking on the person's row (~lines 963–1037), positioned by `idxOf(ts)` day math (~line 239) with `dayW` width.

- [ ] **Step 1: Load and normalize the service work.** After the existing `getAllProjects()`/`activeUsers()` fetch, also load service work and its assignee names. Add the import at the top:

```ts
import { loadServiceWork } from "@/lib/operations-work-server";
import { WORK_TYPE_META } from "@/lib/operations-work";
```

and add to the fetch (keeping the existing `Promise.all`):

```ts
const serviceWork = await loadServiceWork();
```

- [ ] **Step 2: Synthesize service bars as `Booking`-shaped entries.** Map each `WorkItem` into the page's existing bar model so the existing row renderer paints it. A service job becomes a single-day booking on `assignee` (or a sentinel `"Unassigned"` lane when `assignee === ""`). Use the work-type color from `WORK_TYPE_META`. Build a parallel list and concatenate it with the project `bookings` used to render bars. Because service bars link to a record (not the booking editor), carry the `href` and a `type` on the entry and branch the bar's `href` on it. Concretely, extend the `Booking` type with two optional fields and append service entries:

```ts
// added fields on the Booking type:
//   recordHref?: string;   // when set, the bar links to the record, not the edit popover
//   workType?: WorkType;   // color/label source for non-project bars

const UNASSIGNED_LANE = "Unassigned";

const serviceBookings: Booking[] = serviceWork.map((w) => ({
  projectId: w.id,
  projectName: w.title,
  customer: w.subtitle,
  stage: "scheduled" as ProjectStage, // display only; not used for service color
  completed: false,
  crewId: w.id,
  mobId: null,
  person: w.assignee || UNASSIGNED_LANE,
  role: WORK_TYPE_META[w.type].label,
  start: w.startMs,
  end: w.endMs, // inclusive single day
  color: WORK_TYPE_META[w.type].color,
  recordHref: w.href,
  workType: w.type,
}));
```

Append `serviceBookings` to whatever array feeds the crew-board rows (the flattened project `bookings`). Ensure the roster includes any `person` used by a service booking that is not already a row **and** includes the `UNASSIGNED_LANE` row when any unassigned service job exists (mirror the existing "booked person not on roster" logic ~lines 171–182 so unassigned + off-roster assignees each get a lane).

- [ ] **Step 3: Make service bars link to their record.** In the bar `<Link>` renderer (~lines 963–1037), when the booking has `recordHref`, use it as the `href` instead of the edit-popover `boardParams({ edit: ... })` target. Leave project bars exactly as they are. This is the only change to the bar renderer.

- [ ] **Step 4: Build and drive to verify.** Kill any dev server. `npm run build` (expect green). Then start the app and at `/schedule` (crew board view):
  - Service jobs appear as single-day bars on their assignee's lane, in the work-type color, and clicking one navigates to the job's record (e.g. `/flame-tests/results?job=…`).
  - An **Unassigned** lane exists and holds service jobs with no `assignedTo`.
  - Project bars are unchanged (still open the booking editor).
  - A service job scheduled for a given ISO date lands on that exact day (not shifted).
  Also run `npm run test:specs` (should be unchanged, ~122 — this task adds no assertions).

- [ ] **Step 5: Commit.**

```bash
git add "src/app/(app)/schedule/page.tsx"
git commit -m "Schedule: overlay flame, inspection and repair jobs on the crew board (D100)"
```

---

### Task 5: Field Work is today's work across all four types

**Files:**
- Modify: `src/app/(app)/field-work/page.tsx`
- Modify: `src/app/(app)/flame-tests/today/page.tsx` (→ redirect stub)

**Interfaces:**
- Consumes: `loadServiceWork`, `WORK_TYPE_META`, `startOfDay` from the operations-work modules; `requireUser()` for `me.name`.
- Produces: `/field-work` lists today's work for the signed-in person across projects + flame + inspection + repair, each row deep-linking to its capture screen; `/flame-tests/today` redirects to `/field-work`.

**The implementer must read `src/app/(app)/field-work/page.tsx` and `src/app/(app)/flame-tests/today/page.tsx` in full before editing.** Verified anchors: field-work is `async function FieldWorkPage`, fetches `getAllProjects()` + `activeUsers()`, filters `p.kind === "project" && p.stage !== "complete"` for everyone (no today/mine filter), and renders cards with `href = "/field-work?id=" + p.id` (~lines 58–97). `me` comes from `requireUser()` (`me.name`). `/flame-tests/today` is the day-view template (today/overdue + upcoming), currently NOT mine-filtered.

- [ ] **Step 1: Add "today + mine" for service types.** Add imports:

```ts
import { loadServiceWork } from "@/lib/operations-work-server";
import { WORK_TYPE_META, startOfDay, type WorkItem } from "@/lib/operations-work";
```

Load service work alongside projects, then filter to **mine** (`w.assignee === me.name`) and **due now** (`startOfDay(w.startMs) <= startOfDay(today)` — i.e. today or earlier-and-still-live; overdue service jobs still need doing). Compute `today = Date.now()`:

```ts
const serviceWork = await loadServiceWork();
const today = startOfDay(Date.now());
const myService = serviceWork.filter(
  (w) => w.assignee === me.name && startOfDay(w.startMs) <= today,
);
```

- [ ] **Step 2: Keep the project section, but scope it to "mine today."** Change the existing project filter so Field Work shows the signed-in person's active projects rather than everyone's: a project is mine-today when the signed-in person is on the crew of a booking whose inclusive span covers today. Add a helper inline:

```ts
function myProjectToday(p: ProjectRecord, meName: string, todayMs: number): boolean {
  if (p.stage === "complete") return false;
  return p.crew.some(
    (c) => c.person === meName && startOfDay(c.start) <= todayMs && startOfDay(c.end) >= todayMs,
  );
}
```

Replace the current `all.filter((p) => p.kind === "project" && p.stage !== "complete")` with `all.filter((p) => myProjectToday(p, me.name, today))`. (Keep the existing card rendering for projects.)

- [ ] **Step 3: Render the service rows.** Render `myService` as additional rows using the same card layout the project section uses, each showing the work-type label (`WORK_TYPE_META[w.type].label`), `w.title` (customer) as the title, `w.subtitle` (venue) as the subtitle, and the row `href = w.href` (its capture screen). Order all rows (projects + service) by their day. Keep it visually consistent with the existing project cards (reuse the same card classes/structure; do not invent a new layout).

- [ ] **Step 4: Redirect `/flame-tests/today`.** Replace the entire contents of `src/app/(app)/flame-tests/today/page.tsx` with:

```ts
import { redirect } from "next/navigation";

/** Today's flame tests folded into the unified Field Work day-view (D100) — old links live on. */
export default function FlameTodayRedirect() {
  redirect("/field-work");
}
```

Also repoint the one inbound link (the "Log results" button at `src/app/(app)/flame-tests/page.tsx` ~line 389, `href="/flame-tests/today"`) to `href="/field-work"`.

- [ ] **Step 5: Build and drive to verify.** Kill any dev server. `npm run build` (expect green). Start the app, sign in, and at `/field-work`:
  - The day-view shows a MIXED list: the signed-in person's projects active today PLUS their flame/inspection/repair jobs due today-or-overdue, each row linking to the right capture screen (`/flame-tests/results?job=…`, `/inspections/…`, `/repairs/results?job=…`, `/field-work?id=…`).
  - Navigating to `/flame-tests/today` lands on `/field-work` (redirect).
  - The "Log results" button on `/flame-tests` goes to `/field-work`.
  Run `npm run test:specs` (unchanged, ~122).

- [ ] **Step 6: Commit.**

```bash
git add "src/app/(app)/field-work/page.tsx" "src/app/(app)/flame-tests/today/page.tsx" "src/app/(app)/flame-tests/page.tsx"
git commit -m "Field Work: today's work for the signed-in person across all four types; /flame-tests/today redirects (D100)"
```

---

### Task 6: Record the decision (D100) + whole-branch verification

**Files:**
- Modify: `DECISIONS.md`

- [ ] **Step 1: Add the D100 decision record.** Append after the D99 entry, matching the `## D<N> — <title> (date)` shape:

```markdown
## D100 — Operations: merging Installs and Service (2026-07-20)

The **Installs** and **Service** nav groups merged into one **Operations** group
(Projects, Schedule, Field Work, Flame Tests, Rigging Inspections, Repairs); the
header dropped from five top-level items to four (Home, Design, Sales,
Operations). Child keys were preserved, so badge counts and active-pill
highlighting followed automatically.

The nav merge was only honest with an aggregation behind it: `/schedule` and
`/field-work` had read **only** from the projects store, so a scheduled flame
test would never have appeared on the schedule. Both now aggregate all four work
types, **read-only** — scheduling still happens on each type's own screen.

- **Unified Schedule.** The crew board overlays single-day bars for live flame,
  inspection, and repair jobs on their assignee's lane (or an Unassigned lane),
  colour-coded by work type, each linking to its own record. Projects keep their
  crew bookings and the booking editor unchanged.
- **Unified Field Work.** Now the signed-in person's work due today (or overdue)
  across all four types, each row deep-linking to its capture screen.
  `/flame-tests/today` redirects here.

The risk was date normalization, isolated in a dependency-free
`src/lib/operations-work.ts`: a strict `msOf` parses `'YYYY-MM-DD'` as **local**
midnight, and `''`/malformed dates return `null` and are **excluded** (never
epoch 0, never a UTC day-shift). We deliberately did NOT use inspections'
`parseISO`, whose non-ISO fallback is UTC-prone. Inspections' fourth stage
(`onsite`) is included via a `stage !== "completed"` predicate, so in-progress
inspections still appear.

**Decision to revisit:** a repair carries both `assignedTo` and `crew: string[]`.
It renders as **one** row keyed by `assignedTo` (matching flame/inspections and
the existing repairs UI). If Jeff wants a repair on every crew member's lane,
fan out over `crew` — a one-line change in the assembler.

No data model changes, no migrations. Service and install revenue stay separate
in Reports — this merges how work is *found*, not how it is *accounted*.
```

- [ ] **Step 2: Commit the record.**

```bash
git add DECISIONS.md
git commit -m "D100: record the Operations merge decisions"
```

- [ ] **Step 3: Whole-branch verification.** Kill any dev server. Run `npm run test:specs` (expect ALL PASSED, ~122) and `npm run build` (green). Then drive the app against the spec's Testing section:
  - Each of the four sources appears on the correct day on `/schedule`, including a service job whose ISO date would shift under naive UTC parsing.
  - Service jobs with `scheduledDate: ''` do NOT appear (not parked on epoch 0).
  - Unassigned jobs appear in the Unassigned lane.
  - Per-type schedulers (`/flame-tests/scheduling`, `/repairs/scheduling`, `/inspections/scheduling`) still work untouched.
  - Field Work shows a mixed day across all four types; `/flame-tests/today` redirects.
  - Operations nav lights for all six children.
  Report the final assertion count, build result, and drive observations. Ready for the whole-branch (opus) review and merge.

---

## Self-Review

**1. Spec coverage.** Unified Schedule (4 sources, colour-coded, assignee, record links, unassigned lane) → Tasks 2+3+4. Unified Field Work (today, signed-in person, 4 types, deep links) + `/flame-tests/today` redirect → Task 5. The "integration detail that will bite" (`''` excluded, local-date parsing, unassigned lane) → Task 2 pure module + its tests. Nav merge (5→4) → Task 1. Per-type schedulers untouched, Reports unchanged, no data changes → honored across all tasks (Global Constraints + out-of-scope). Testing checklist → Task 6 Step 3 drives each item; the pure/date parts are unit-tested in Task 2.

**2. Placeholder scan.** Exact code for the pure module, the assembler, the nav, the redirect, and the DECISIONS entry. Tasks 4 and 5 integrate into large existing files, so they give exact new code + exact anchors + exact behavior and instruct the implementer to read the full file for the splice (the settings-client precedent from D99). No "TBD"/"handle edge cases".

**3. Type consistency.** `WorkType`, `WorkItem`, `WORK_TYPE_META`, `msOf`, `serviceToWorkItems`, `startOfDay` defined in Task 2 are used with identical signatures in Tasks 3–5. `loadServiceWork(): Promise<WorkItem[]>` (Task 3) is consumed unchanged in Tasks 4–5. The `Booking` extension fields (`recordHref?`, `workType?`) named in Task 4 Step 2 are used in Task 4 Step 3. Store `getAll` names verified in the map (flame/inspections/repairs all export `getAll`; projects export `getAllProjects`).

**Cross-task note:** `NAV.length` flips 5→4 in Task 1 only; no assertion goes transiently red. Tasks 2–5 add no nav assertions. The service-store `getAll` signatures are confirmed at build time in Task 3 Step 2 before the pages depend on them.
