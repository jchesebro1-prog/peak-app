# Auto Task Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open tasks and Queue assignments are planned automatically as time blocks inside each person's free work time, by blended urgency, with only started and hand-placed blocks ever stored, and the plan shows on `/calendar` (Week/Day blocks, drag-to-pin, At risk panel), on a Home "Today" card and in morning triage.

**Architecture:** A pure, deterministic engine `src/lib/task-plan/` (`planPerson(input) → { blocks, atRisk, newPins, staleKeys, futurePins }`) runs on every view. A server loader (`task-plan/load.ts`) builds its input per person: spec 2's work hours, spec 2's busy blocks (visits + accepted timed Google events), spec 1's drive legs in `cache` mode, and that person's pins. Pins are the only state: one per-user blob `task_pins:<userId>` (the `schedule-prefs.ts` blob idiom), one top-level key per pin. Pages compute the plan, render it, and persist new `started` pins with `after()`; the morning triage cron computes it through the existing `TRIAGE_HOOKS.atRisk` seam, so no new cron rider is added.

**Tech Stack:** Next.js 16 App Router (server components, server actions, `after()` from `next/server`), TypeScript, doc-store collections (`tasks`, `assignments`) + blobs (`getBlob`/`setBlob`), Drizzle (`sql` for the blob key delete), spec harness `scripts/test-review-and-spec.ts`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-09-auto-task-calendar-design.md` (read it fully, including the Motion research section, before Task 1).
- **Execution requires spec 2 (site-visit scheduling) merged to `origin/main`.** Task 1's first step merges `origin/main` and confirms these spec-2 exports exist (follow any rename and note it in your report): `WorkHours`, `DEFAULT_WORK_HOURS`, `fmtClock` (`src/lib/visit-plan/settings.ts`); `workHoursFor` (`src/lib/stores/schedule-prefs.ts`); `chicagoWallMs`, `chicagoMinuteOfDay`, `weekdayOf`, `workWindow`, `fmtDayLabel` (`src/lib/visit-plan/hours.ts`); `busyBlocks`, `toBusyVisit` (`src/lib/visit-plan/busy.ts`); `CalendarRead` (`src/lib/visit-plan/check.ts`); `readCalendarForBooking` (`src/lib/visit-plan/load.ts`); `CalendarEvent.selfResponse` (`src/lib/google/calendar.ts`). **Never re-implement work hours or busy rules.**
- Spec 1 names used (already on main): `chicagoDayKey`, `chicagoDayStart`, `addDays`, `isDayKey`, `DRIVE_TZ` (`drive-plan/day.ts`); `planDriveDays`, `DriveDayPlan` (`drive-plan/load.ts`); `DriveLeg` (`drive-plan/plan.ts`).
- Decisions to honor verbatim: tiers **High 3 · Normal 2 · Low 1** (blank = Normal); sizes **S 30 min · M 1 h · L 4 h** (blank = 1 h); fill at most **80 %** of each day's free minutes; **15-minute grid**; chunks **≥ 30 min**; horizon until placed, **capped at 8 weeks** (56 days); **+7 days** default due date on new items; backfill over the next **4 weeks** of each person's work days, dry run by default, `--apply` writes, idempotent; task blocks are **app-only — never written to Google Calendar**; no AI (D89).
- Blended urgency (fixed by this plan): an item not overdue has weight **tier factor × 1 / (days left + 1)**, days left = whole Chicago calendar days from today to the due day (0 = due today). Items compare by exact integer cross-products (`tierA × (daysLeftB + 1)` vs `tierB × (daysLeftA + 1)`), never floats. **Overdue outranks everything, most overdue first** (then tier). Ties: **earlier due → older `createdAt` → item key**.
- Copy, verbatim: `At risk — due Tue` (weekday within 6 days, else `due Nov 3`); `Planned without your Google calendar — may overlap meetings` (another person: `Planned without Dana's Google calendar — may overlap meetings`); `Plan finishes Tue Oct 14`; `Doesn't fit in the next 8 weeks`; buttons `Push due date`, `Hand off`, `Unpin something`, `Unpin`, `Done`, `In progress`; `This block has started — it stays put.`
- Days are **Chicago calendar days**; timestamps are epoch-ms. Due dates written by this feature are stamped **5:00 pm Chicago** on the due day (so the date reads the same in Google Tasks, which takes the UTC date); the planner's deadline is the **end** of the due's Chicago day.
- Doc-store, no migration. Pins live in blob `task_pins:<userId>` (one key per pin, `<itemKey>@<startMs>` → `{ endMs, kind }`); `priority`/`size` live on the task/assignment record and are written only when valid.
- `requireUser()` / `requirePerm()` is the **first await** in every server action; every action input is untrusted. Write logic lives in plain modules (`task-plan/write.ts`, `task-plan/backfill.ts`) so the harness can call it; `"use server"` files only check the session and delegate.
- Client components never import a module that reaches `@/db` (stores, `@/lib/users`, `task-plan/load.ts`, `task-plan/write.ts`, `task-plan/backfill.ts`). Client-safe: `task-plan/{types,fields,due,people,urgency,free,plan,pins,labels,items,calendar-view,today}.ts` (type-only store imports), server-action files.
- Next.js 16: before touching a page/action, read the relevant guide in `node_modules/next/dist/docs/` (if missing in the worktree, read `/Users/sm/Downloads/peak-app/node_modules/next/dist/docs/` read-only). `after()` is allowed in server components and server functions (`01-app/03-api-reference/04-functions/after.md`).
- Design tokens: `pk-*` classes and `var(--accent)`; never hardcode accent-coloured UI.
- Worktree setup: `npm ci` in the worktree (never symlink `node_modules`). Never open `.data/pglite`; never run a `tsx`/db script or a dev server against it; `ps aux | grep tsx` before any db work. `npm run test:specs` makes its own temp datadir — run `df -h` first (temp `tmp.*` datadirs can fill the disk).
- Per-task gates (all must pass; report real numbers): `npx tsc --noEmit` · `env -u DATABASE_URL npm run test:specs` · `npx eslint --ignore-pattern scripts/test-review-and-spec.ts <changed files>`. UI tasks (9, 10, 11, 12) add `npm run build`. Task 13 adds `npm run test:smoke` (stop any dev server first).
- Tests live in a NEW module `scripts/test-auto-calendar.ts`, exporting `async function autoCal<Name>Checks(ok: Ok): Promise<void>`. The harness imports them on ONE new line right after the line that starts `import { triageFoundationChecks`, and chains each `.then(() => autoCal…Checks(ok))` immediately before the `.finally(() => teardownFixtures())` line, in task order. Doc fixtures use `fixtureId("autocal", …)` + `registerFixture`; pin blobs use `TESTautocal:` user ids and are hard-deleted in each check's own `finally` (`like(blobs.id, "task_pins:TESTautocal:%")`).
- When a step says "add to the imports" and that module is already imported in the file, merge the new names into the existing import line (no duplicate imports).
- Don't assign D/punch numbers until Task 13, which recomputes them from `git show origin/main:DECISIONS.md` / `origin/main:PUNCHLIST.md` (expected punch **#327**, recompute anyway).

---

## File structure

**Create**

| File | Responsibility |
|---|---|
| `src/lib/task-plan/types.ts` | Pure: tiers, sizes, constants, item keys, `PlanItem`/`PlanPin`/`PlanInput`/`PlanBlock`/`PlanResult`. |
| `src/lib/task-plan/fields.ts` | Pure: `readTierSize(formData)`, `tierSizeOf(input)`. |
| `src/lib/task-plan/due.ts` | Pure: `dueStampForDay`, `defaultDueAt`, `autoDueAt`, `deadlineOf`, `effectiveDue`, `planDueBackfill`. |
| `src/lib/task-plan/people.ts` | Pure: `isPlannedTask`, `personForTask`, `personForAssignment`. |
| `src/lib/task-plan/backfill.ts` | Server: `runDueBackfill` (dry run / apply). |
| `scripts/backfill-task-due.ts` | CLI for the one-time backfill. |
| `src/lib/task-plan/urgency.ts` | Pure: `daysLeft`, `urgencyWeight`, `compareUrgency`, `sortByUrgency`. |
| `src/lib/task-plan/free.ts` | Pure: quarter rounding, interval merge/subtract, `freeDays`, `chunkFor`. |
| `src/lib/task-plan/labels.ts` | Pure: `atRiskLabel`, `calendarNote`, `fmtBlockTime`, `finishText`. |
| `src/lib/task-plan/plan.ts` | Pure: `planPerson`, `placeEntry`, `blockOf`. |
| `src/lib/task-plan/pins.ts` | Pure: pin blob encoding, `unfinishedRemainders`, `newPinsFrom`, `stalePinKeys`, `cleanPinMove`. |
| `src/lib/stores/task-pins.ts` | Server: `getPins`, `addPins`, `removePinKeys`, `clearItemPins`, `clearPlanPinsFor`, `userIdForName`. |
| `src/lib/task-plan/items.ts` | Pure: `planItemsByPerson`. |
| `src/lib/task-plan/load.ts` | Server: `loadTaskPlans`, `savePlanPins`, `withTimeout`. |
| `src/lib/task-plan/triage.ts` | Server: `taskPlanAtRisk` (the triage hook). |
| `src/lib/task-plan/write.ts` | Server: `pinBlock`, `unpinBlock`, `pushDueDate`, `handOff`, `setTierSize`, `markInProgress`. |
| `src/app/(app)/calendar/plan-actions.ts` | Server actions over `write.ts`. |
| `src/lib/task-plan/calendar-view.ts` | Pure: `calendarPlanView`, `monthChips`, `stripTasks`, `layoutIntervals`, `dragStartMs`. |
| `src/lib/task-plan/today.ts` | Pure: `todayRows`. |
| `src/components/task-plan/tier-size-chips.tsx` | Client: High/Normal/Low + S/M/L chips. |
| `src/app/(app)/calendar/task-block-layer.tsx` | Client: task blocks in a Week/Day column (+ drag in Task 10). |
| `src/app/(app)/calendar/task-block-popover.tsx` | Client: block popover (Done, In progress, Unpin, chips). |
| `src/app/(app)/calendar/at-risk-panel.tsx` | Client: At risk panel with the three fixes. |
| `src/app/(app)/home-today.tsx` | Server: Home "Today" card. |
| `scripts/test-auto-calendar.ts` | All new spec checks. |

**Modify**

`src/lib/stores/tasks.ts` · `src/lib/stores/assignments.ts` · `src/lib/stores/schedule-prefs.ts` (header comment) · `src/lib/triage/hooks.ts` · `src/app/(app)/calendar/{page.tsx,calendar-client.tsx}` · `src/lib/dashboard/{registry.ts,data.ts}` · `src/app/(app)/_dashboard/widgets/home-cards.tsx` · `src/components/tasks-card.tsx` · `src/app/(app)/{projects,estimator,design/designs}/actions.ts` · `src/lib/inbox-task.ts` · `src/app/(app)/inbox/task-dialog.tsx` · `src/lib/krisp/write-back.ts` · `src/app/(app)/recordings/{actions.ts,[id]/detail-client.tsx}` · `src/app/(app)/queue/{actions.ts,view.tsx}` · `package.json` · `scripts/test-review-and-spec.ts` · `scripts/test-drive-time.ts` (one pin) · `DECISIONS.md` · `PUNCHLIST.md` · `AGENTS.md`.

---

### Task 1: Merge spec 2, tier/size fields on tasks + assignments, test module

**Files:**
- Create: `src/lib/task-plan/types.ts`, `src/lib/task-plan/fields.ts`, `scripts/test-auto-calendar.ts`
- Modify: `src/lib/stores/tasks.ts`, `src/lib/stores/assignments.ts`, `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: spec-2 `WorkHours` (type only); `triageKey`, `tierOf` (triage, for tests).
- Produces:
  - `types.ts`: `TASK_TIERS`, `type TaskTier = "high" | "normal" | "low"`, `TASK_SIZES`, `type TaskSize = "s" | "m" | "l"`, `TIER_FACTOR`, `SIZE_MIN`, `TIER_LABEL`, `SIZE_LABEL`, `SIZE_HINT`, `DEFAULT_TIER`, `DEFAULT_SIZE`, `PLAN_HORIZON_DAYS = 56`, `FILL_RATIO = 0.8`, `GRID_MIN = 15`, `MIN_CHUNK_MIN = 30`, `QUARTER_MS`; `cleanTier(v): TaskTier | null`; `cleanSize(v): TaskSize | null`; `tierOrDefault(v): TaskTier`; `sizeMinutes(v): number`; `type PlanItemKind = "task" | "assignment"`; `type PlanRef = { kind; id }`; `planItemKey(kind, id): string` (`task:<id>` / `asg:<id>`); `parsePlanItemKey(key): PlanRef | null`; `parsePlanRef(kind: unknown, id: unknown): PlanRef | null`; `type PinKind = "started" | "hand"`; `type PlanPin = { itemKey; startMs; endMs; kind: PinKind }`; `type BusyInterval = { startMs; endMs }`; `type PlanItem`; `type PlanInput`; `type PlanBlock`; `type AtRiskItem`; `type PlanResult` (shapes below).
  - `fields.ts`: `readTierSize(fd: { has(n): boolean; get(n): unknown }): { priority?: TaskTier; size?: TaskSize }`; `tierSizeOf(input: unknown): { priority?: TaskTier; size?: TaskSize }`.
  - `TaskRecord.priority?: TaskTier`, `TaskRecord.size?: TaskSize` (normalized on read, only when valid); `updateTask` patch accepts `priority`, `size`.
  - `Assignment.priority?: TaskTier`, `Assignment.size?: TaskSize`; `createAssignment` input accepts `priority?: unknown; size?: unknown`; `updateAssignment` patch accepts `priority`, `size`.
  - Test helpers in `scripts/test-auto-calendar.ts`: `Ok`, `MON`/`TUE`/`WED`/`FRI`/`SAT` day keys, `at(day, h, m?)`, `MIN`, `item(id, over?)`, `fnBody`, `firstAwait`.

- [ ] **Step 1: Merge spec 2 and confirm its exports**

```bash
cd /Users/sm/Downloads/peak-app-autocal
git fetch origin && git merge origin/main
npm ci
grep -n "export type WorkHours\|export const DEFAULT_WORK_HOURS\|export function fmtClock" src/lib/visit-plan/settings.ts
grep -n "export async function workHoursFor" src/lib/stores/schedule-prefs.ts
grep -n "export function chicagoWallMs\|export function chicagoMinuteOfDay\|export function weekdayOf\|export function workWindow\|export function fmtDayLabel" src/lib/visit-plan/hours.ts
grep -n "export function busyBlocks\|export function toBusyVisit" src/lib/visit-plan/busy.ts
grep -n "export type CalendarRead" src/lib/visit-plan/check.ts
grep -n "export async function readCalendarForBooking" src/lib/visit-plan/load.ts
grep -n "selfResponse" src/lib/google/calendar.ts
```

Expected: every grep prints at least one line. If spec 2 is not merged yet (the greps are empty), STOP and report — this plan cannot run without it.

- [ ] **Step 2: Write the failing tests**

Create `scripts/test-auto-calendar.ts`:

```ts
/* Auto task calendar — spec checks
   (docs/superpowers/specs/2026-10-09-auto-task-calendar-design.md).
   Chained from test-review-and-spec.ts. */
import { readFileSync } from "node:fs";
import { createTask, getTask, normalizeTask, updateTask, type TaskRecord } from "@/lib/stores/tasks";
import { createAssignment, getAssignment, updateAssignment } from "@/lib/stores/assignments";
import { triageKey } from "@/lib/triage/keys";
import { tierOf } from "@/lib/triage/feeds/tasks";
import { chicagoWallMs } from "@/lib/visit-plan/hours";
import { readTierSize } from "@/lib/task-plan/fields";
import {
  cleanSize,
  cleanTier,
  parsePlanItemKey,
  planItemKey,
  SIZE_MIN,
  sizeMinutes,
  tierOrDefault,
  type PlanItem,
} from "@/lib/task-plan/types";
import { fixtureId, registerFixture } from "./test-fixtures";

export type Ok = (cond: boolean, msg: string) => void;

/* ---- helpers ---- */
// 2036-10-13 is a Monday; October 2036 is CDT (UTC−5) throughout.
const MON = "2036-10-13";
const TUE = "2036-10-14";
const WED = "2036-10-15";
const FRI = "2036-10-17";
const SAT = "2036-10-18";
const MIN = 60_000;
/** Epoch-ms of h:m Chicago wall time on `day`. */
const at = (day: string, h: number, m = 0) => chicagoWallMs(day, h * 60 + m);
/** A plan item: a Normal, 1 h task for u1, due Friday 5 pm, created at 1. */
function item(id: string, over: Partial<PlanItem> = {}): PlanItem {
  return {
    key: planItemKey("task", id),
    kind: "task",
    id,
    userId: "u1",
    title: id,
    href: "",
    tier: "normal",
    size: "m",
    sizeMin: 60,
    dueMs: at(FRI, 17),
    dueVirtual: false,
    earliestMs: null,
    createdAt: 1,
    inProgress: false,
    ...over,
  };
}
/** One exported function's source, up to the next top-level export. */
function fnBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  if (start < 0) return "";
  const next = src.indexOf("\nexport ", start + 1);
  return next < 0 ? src.slice(start) : src.slice(start, next);
}
/** True when `call` is the function body's first `await`. */
function firstAwait(body: string, call: string): boolean {
  const i = body.indexOf("await ");
  return i >= 0 && body.startsWith("await " + call, i);
}

/* ---- Task 1: fields ---- */
export async function autoCalFieldsChecks(ok: Ok): Promise<void> {
  ok(cleanTier("high") === "high" && cleanTier("HIGH") === null && cleanTier("") === null && cleanSize("l") === "l" && cleanSize(4) === null,
    "auto-cal fields: tier and size accept only high|normal|low and s|m|l");
  ok(SIZE_MIN.s === 30 && SIZE_MIN.m === 60 && SIZE_MIN.l === 240 && sizeMinutes(undefined) === 60 && tierOrDefault(undefined) === "normal",
    "auto-cal fields: S 30 min · M 1 h · L 4 h; blank = Normal, 1 h");
  ok(planItemKey("task", "T-1") === triageKey.task("T-1") && planItemKey("assignment", "as-1") === triageKey.assignment("as-1"),
    "auto-cal fields: plan item keys are triage's keys (task:<id> / asg:<id>)");
  ok(JSON.stringify(parsePlanItemKey("asg:as-9")) === JSON.stringify({ kind: "assignment", id: "as-9" }) && parsePlanItemKey("lead:x") === null,
    "auto-cal fields: item keys parse back");
  const n = normalizeTask({ id: "T-x", title: "x", priority: "high", size: "l" });
  const junk = normalizeTask({ id: "T-y", title: "y", priority: "urgent", size: "xl" } as unknown as Partial<TaskRecord> & { id: string });
  const bare = normalizeTask({ id: "T-z", title: "z" });
  ok(n.priority === "high" && n.size === "l" && !("priority" in junk) && !("size" in junk) && !("priority" in bare) && !("size" in bare),
    "auto-cal fields: normalizeTask carries a valid tier/size and drops junk; an old doc reads exactly as before");
  ok(tierOf(n) === "high" && tierOf(bare) === null, "auto-cal fields: morning triage reads the tier off a normalized task");
  const fd = new FormData();
  fd.set("priority", "low");
  fd.set("size", "bogus");
  ok(JSON.stringify(readTierSize(fd)) === JSON.stringify({ priority: "low", size: "m" }) && JSON.stringify(readTierSize(new FormData())) === "{}",
    "auto-cal fields: a form's chips read as tier/size (a bad size reads as M); a form without the chips changes nothing");

  const me = { id: "TESTautocal:u1", name: "Auto Cal" };
  const T = fixtureId("autocal", "fields-task");
  await createTask({ id: T, title: "fields", priority: "low", size: "s" }, me);
  registerFixture("tasks", T);
  const t1 = await getTask(T);
  ok(t1?.priority === "low" && t1?.size === "s", "auto-cal fields: createTask stores tier and size");
  await updateTask(T, { priority: "high", size: "l" });
  const t2 = await getTask(T);
  ok(t2?.priority === "high" && t2?.size === "l", "auto-cal fields: updateTask changes them");
  const a = await createAssignment({ title: "fields asg", assignee: "Auto Cal", createdBy: "Auto Cal", priority: "high", size: "nope" });
  registerFixture("assignments", a.id);
  const a2 = await getAssignment(a.id);
  ok(a2?.priority === "high" && !("size" in (a2 ?? {})), "auto-cal fields: createAssignment keeps a valid tier and drops a bad size");
  await updateAssignment(a.id, { size: "l" });
  ok((await getAssignment(a.id))?.size === "l", "auto-cal fields: updateAssignment sets a size");
}
```

Wire the harness (`scripts/test-review-and-spec.ts`): add a new line right after the line that starts `import { triageFoundationChecks`:

```ts
import { autoCalFieldsChecks } from "./test-auto-calendar";
```

and, immediately before the line `.finally(() => teardownFixtures())`, add:

```ts
  .then(() => autoCalFieldsChecks(ok))
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx tsc --noEmit`
Expected: FAIL — `Cannot find module '@/lib/task-plan/fields'` / `'@/lib/task-plan/types'`, `priority` not on `TaskRecord`.

- [ ] **Step 4: Implement `src/lib/task-plan/types.ts`**

```ts
/**
 * Auto task calendar (spec docs/superpowers/specs/2026-10-09-auto-task-calendar-design.md)
 * — shared shapes and constants. Pure and CLIENT-SAFE (type-only imports).
 */
import type { WorkHours } from "@/lib/visit-plan/settings";

export const TASK_TIERS = ["high", "normal", "low"] as const;
export type TaskTier = (typeof TASK_TIERS)[number];
export const TASK_SIZES = ["s", "m", "l"] as const;
export type TaskSize = (typeof TASK_SIZES)[number];

/** Blended urgency's tier factor (spec Part 2 "Ordering"). */
export const TIER_FACTOR: Record<TaskTier, number> = { high: 3, normal: 2, low: 1 };
export const SIZE_MIN: Record<TaskSize, number> = { s: 30, m: 60, l: 240 };
export const TIER_LABEL: Record<TaskTier, string> = { high: "High", normal: "Normal", low: "Low" };
export const SIZE_LABEL: Record<TaskSize, string> = { s: "S", m: "M", l: "L" };
export const SIZE_HINT: Record<TaskSize, string> = { s: "30 min", m: "1 h", l: "4 h" };
export const DEFAULT_TIER: TaskTier = "normal";
export const DEFAULT_SIZE: TaskSize = "m";

/** Horizon: until everything is placed, capped at 8 weeks. */
export const PLAN_HORIZON_DAYS = 56;
/** At most 80 % of each day's free minutes is filled. */
export const FILL_RATIO = 0.8;
export const GRID_MIN = 15;
export const MIN_CHUNK_MIN = 30;
export const QUARTER_MS = GRID_MIN * 60_000;

export function cleanTier(v: unknown): TaskTier | null {
  return v === "high" || v === "normal" || v === "low" ? v : null;
}
export function cleanSize(v: unknown): TaskSize | null {
  return v === "s" || v === "m" || v === "l" ? v : null;
}
export function tierOrDefault(v: unknown): TaskTier {
  return cleanTier(v) ?? DEFAULT_TIER;
}
export function sizeMinutes(v: unknown): number {
  return SIZE_MIN[cleanSize(v) ?? DEFAULT_SIZE];
}

export type PlanItemKind = "task" | "assignment";
export type PlanRef = { kind: PlanItemKind; id: string };

/** Same strings as triageKey.task / triageKey.assignment, so the triage hook can use them as-is. */
export function planItemKey(kind: PlanItemKind, id: string): string {
  return kind === "task" ? `task:${id}` : `asg:${id}`;
}
export function parsePlanItemKey(key: string): PlanRef | null {
  const m = /^(task|asg):(.+)$/.exec(key || "");
  return m ? { kind: m[1] === "task" ? "task" : "assignment", id: m[2] } : null;
}
const REF_ID_MAX = 160;
/** An untrusted { kind, id } from an action. */
export function parsePlanRef(kind: unknown, id: unknown): PlanRef | null {
  const k = kind === "task" || kind === "assignment" ? kind : null;
  const i = typeof id === "string" ? id.trim() : "";
  return k && i && i.length <= REF_ID_MAX ? { kind: k, id: i } : null;
}

export type PinKind = "started" | "hand";
/** The only thing the scheduler stores (spec Part 2 "Pins"). */
export type PlanPin = { itemKey: string; startMs: number; endMs: number; kind: PinKind };
export type BusyInterval = { startMs: number; endMs: number };

export type PlanItem = {
  key: string;
  kind: PlanItemKind;
  id: string;
  userId: string;
  title: string;
  href: string;
  tier: TaskTier;
  size: TaskSize;
  sizeMin: number;
  /** effective due (an undated item plans as due 7 days after it was created) */
  dueMs: number;
  dueVirtual: boolean;
  /** a template's startAt: the earliest the item may be placed */
  earliestMs: number | null;
  createdAt: number;
  inProgress: boolean;
};

export type PlanInput = {
  userId: string;
  nowMs: number;
  hours: WorkHours;
  /** visits, drive blocks, accepted timed Google events */
  busy: BusyInterval[];
  /** this person's pins (any item; pins of items not in `items` are stale) */
  pins: PlanPin[];
  items: PlanItem[];
  horizonDays?: number;
  fillRatio?: number;
};

export type PlanBlock = {
  /** `${itemKey}@${startMs}` — the same string as the pin blob key */
  key: string;
  itemKey: string;
  kind: PlanItemKind;
  id: string;
  userId: string;
  title: string;
  href: string;
  tier: TaskTier;
  size: TaskSize;
  startMs: number;
  endMs: number;
  pinned: PinKind | null;
  atRisk: boolean;
  dueMs: number;
  inProgress: boolean;
};

export type AtRiskItem = {
  itemKey: string;
  kind: PlanItemKind;
  id: string;
  userId: string;
  title: string;
  href: string;
  dueMs: number;
  /** when the plan finishes it; null = doesn't fit in the horizon */
  finishMs: number | null;
  label: string;
};

export type PlanResult = {
  userId: string;
  nowMs: number;
  blocks: PlanBlock[];
  atRisk: AtRiskItem[];
  /** pins this compute must persist (blocks that began, in-progress, remainders) */
  newPins: PlanPin[];
  /** pin blob keys whose item is no longer this person's open work */
  staleKeys: string[];
  /** pins that haven't begun (what Unpin can offer) */
  futurePins: PlanPin[];
  finishMs: Record<string, number | null>;
};
```

- [ ] **Step 5: Implement `src/lib/task-plan/fields.ts`**

```ts
/** Task-form tier/size chips (spec Part 1 "New fields"). Pure, client-safe. */
import { cleanSize, cleanTier, DEFAULT_SIZE, DEFAULT_TIER, type TaskSize, type TaskTier } from "./types";

type FormLike = { has(name: string): boolean; get(name: string): unknown };

/** A form's High/Normal/Low and S/M/L chips. A form without the chips
 *  changes nothing; a chip value that isn't valid reads as the default. */
export function readTierSize(fd: FormLike): { priority?: TaskTier; size?: TaskSize } {
  const out: { priority?: TaskTier; size?: TaskSize } = {};
  if (fd.has("priority")) out.priority = cleanTier(fd.get("priority")) ?? DEFAULT_TIER;
  if (fd.has("size")) out.size = cleanSize(fd.get("size")) ?? DEFAULT_SIZE;
  return out;
}

/** Only the valid tier/size of an untrusted object (records, JSON action input). */
export function tierSizeOf(input: unknown): { priority?: TaskTier; size?: TaskSize } {
  const o = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const out: { priority?: TaskTier; size?: TaskSize } = {};
  const p = cleanTier(o.priority);
  const s = cleanSize(o.size);
  if (p) out.priority = p;
  if (s) out.size = s;
  return out;
}
```

- [ ] **Step 6: Carry the fields in `src/lib/stores/tasks.ts`**

Add to the imports:

```ts
import { tierSizeOf } from "@/lib/task-plan/fields";
import type { TaskSize, TaskTier } from "@/lib/task-plan/types";
```

In `type TaskRecord`, after the `threadId?: string | null;` line, add:

```ts
  /** Spec 2026-10-09 auto task calendar — tier and size; written only when
   *  set, so a pre-spec doc reads identically. Blank = Normal, 1 h. */
  priority?: TaskTier;
  size?: TaskSize;
```

In `normalizeTask`, replace the last line `return { ...t, ...taskLinksOf(raw) };` with:

```ts
  return { ...t, ...taskLinksOf(raw), ...tierSizeOf(raw) };
```

In `updateTask`, change the patch type to:

```ts
  patch: Partial<Pick<TaskRecord, "title" | "section" | "assigneeUserId" | "assigneeName" | "dueAt" | "notes" | "priority" | "size">>,
```

- [ ] **Step 7: Carry the fields in `src/lib/stores/assignments.ts`**

Add to the imports:

```ts
import { tierSizeOf } from "@/lib/task-plan/fields";
import type { TaskSize, TaskTier } from "@/lib/task-plan/types";
```

In `type Assignment`, after `source: string;` add:

```ts
  /** Spec 2026-10-09 auto task calendar — written only when set. */
  priority?: TaskTier;
  size?: TaskSize;
```

In `createAssignment`, add `priority?: unknown; size?: unknown;` to the input type, and add `...tierSizeOf(input),` as the last property of `rec` (after `source: …`).

In `updateAssignment`, change the patch type to `Partial<Pick<Assignment, "title" | "assignee" | "dueDate" | "link" | "priority" | "size">>`.

- [ ] **Step 8: Run the gates**

Run: `npx tsc --noEmit` → PASS. Run: `df -h . && env -u DATABASE_URL npm run test:specs` → `ALL PASSED`, including the new `auto-cal fields:` lines. Run: `npx eslint --ignore-pattern scripts/test-review-and-spec.ts src/lib/task-plan/types.ts src/lib/task-plan/fields.ts src/lib/stores/tasks.ts src/lib/stores/assignments.ts scripts/test-auto-calendar.ts` → no errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/task-plan/types.ts src/lib/task-plan/fields.ts src/lib/stores/tasks.ts src/lib/stores/assignments.ts scripts/test-auto-calendar.ts scripts/test-review-and-spec.ts
git commit -m "feat(task-plan): tier and size on tasks and assignments; plan types

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Due dates — +7 default in the create functions, one-time backfill

**Files:**
- Create: `src/lib/task-plan/due.ts`, `src/lib/task-plan/people.ts`, `src/lib/task-plan/backfill.ts`, `scripts/backfill-task-due.ts`
- Modify: `src/lib/stores/tasks.ts`, `src/lib/stores/assignments.ts`, `package.json`, `scripts/test-auto-calendar.ts`, `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `chicagoWallMs`, `weekdayOf` (spec 2 hours.ts); `DEFAULT_WORK_HOURS`, `WorkHours` (spec 2 settings.ts); `workHoursFor` (spec 2); `chicagoDayKey`, `chicagoDayStart`, `addDays` (spec 1); `sameName` (`quote-approval-rules.ts`); `patchTask`, `allTasks`, `allAssignments`, `patchDoc`; `resolveExplicitDbTarget`, `requireHostedConfirmation` (`scripts/db-target.ts`).
- Produces:
  - `due.ts`: `AUTO_DUE_DAYS = 7`; `DUE_STAMP_MIN = 1020`; `dueStampForDay(dayKey): number` (5:00 pm Chicago); `defaultDueAt(nowMs): number`; `autoDueAt(dueAt: number | null | undefined, assigned: boolean, nowMs): number | null`; `deadlineOf(dueMs): number` (end of the due's Chicago day); `effectiveDue(dueAt: number | null | undefined, createdAt: number): { dueMs: number; virtual: boolean }`; `BACKFILL_WEEKS = 4`; `type BackfillItem = { kind: PlanItemKind; id; person; personName; createdAt }`; `type BackfillUpdate = BackfillItem & { dayKey; dueAt }`; `type BackfillPlan = { updates: BackfillUpdate[]; perPerson: Array<{ person; name; count; firstDay; lastDay }> }`; `workDaysAfter(fromDayKey, calendarDays, hours): string[]`; `planDueBackfill({ items, hoursByPerson, nowMs, weeks? }): BackfillPlan`.
  - `people.ts`: `type RosterPerson = { id: string; name: string }`; `isPlannedTask(t): boolean` (Open or In progress); `personForTask(t, roster): RosterPerson | null`; `personForAssignment(a, roster): RosterPerson | null`.
  - `backfill.ts`: `type BackfillDeps`; `runDueBackfill({ apply, deps? }): Promise<{ apply: boolean; planned: number; updated: number; plan: BackfillPlan }>`.
  - `npm run tasks:backfill-due` (dry run) / `-- --apply`.

- [ ] **Step 1: Write the failing tests**

Add to the imports of `scripts/test-auto-calendar.ts`:

```ts
import { chicagoDayKey, chicagoDayStart } from "@/lib/drive-plan/day";
import { weekdayOf } from "@/lib/visit-plan/hours";
import { DEFAULT_WORK_HOURS } from "@/lib/visit-plan/settings";
import { createAutoTask, autoTaskId } from "@/lib/stores/tasks";
import type { Assignment } from "@/lib/stores/assignments";
import {
  autoDueAt,
  deadlineOf,
  defaultDueAt,
  dueStampForDay,
  effectiveDue,
  planDueBackfill,
  type BackfillItem,
} from "@/lib/task-plan/due";
import { runDueBackfill } from "@/lib/task-plan/backfill";
```

Append:

```ts
/* ---- Task 2: due dates ---- */
export async function autoCalDueChecks(ok: Ok): Promise<void> {
  const now = at(MON, 10);
  ok(chicagoDayKey(defaultDueAt(now)) === "2036-10-20" && defaultDueAt(now) === at("2036-10-20", 17), "auto-cal due: +7 days, stamped 5:00 pm Chicago");
  ok(new Date(defaultDueAt(now)).toISOString().slice(0, 10) === "2036-10-20", "auto-cal due: the stamp's UTC date is the same day, so Google Tasks shows the right date");
  ok(deadlineOf(at(FRI, 7)) === chicagoDayStart(SAT), "auto-cal due: a due date holds until the end of its Chicago day");
  ok(autoDueAt(null, true, now) === defaultDueAt(now) && autoDueAt(null, false, now) === null && autoDueAt(at(FRI, 12), true, now) === at(FRI, 12) && autoDueAt(0, true, now) === defaultDueAt(now),
    "auto-cal due: only an assigned item with no date gets the +7 default");
  const v = effectiveDue(null, at(MON, 9));
  ok(v.virtual && v.dueMs === defaultDueAt(at(MON, 9)) && !effectiveDue(at(FRI, 12), 1).virtual, "auto-cal due: an undated item plans as if due 7 days after it was created");

  // Backfill plan (pure)
  const items: BackfillItem[] = [
    { kind: "task", id: "T-3", person: "u1", personName: "Dana", createdAt: 300 },
    { kind: "task", id: "T-1", person: "u1", personName: "Dana", createdAt: 100 },
    { kind: "assignment", id: "as-2", person: "u1", personName: "Dana", createdAt: 200 },
    { kind: "task", id: "T-9", person: "u2", personName: "Sam", createdAt: 50 },
  ];
  const hours = new Map([["u1", DEFAULT_WORK_HOURS], ["u2", { days: [2, 4], startMin: 480, endMin: 1020 }]]);
  const plan = planDueBackfill({ items, hoursByPerson: hours, nowMs: at(FRI, 10) });
  const dana = plan.updates.filter((u) => u.person === "u1");
  ok(dana.map((u) => u.id).join() === "T-1,as-2,T-3", "auto-cal backfill: oldest first");
  ok(dana.map((u) => u.dayKey).join() === "2036-10-20,2036-10-28,2036-11-06" && dana.every((u) => weekdayOf(u.dayKey) >= 1 && weekdayOf(u.dayKey) <= 5),
    "auto-cal backfill: spread evenly over the next 4 weeks of work days (never today, never a weekend)");
  const sam = plan.updates.find((u) => u.person === "u2");
  ok(sam?.dayKey === "2036-10-21" && sam.dueAt === dueStampForDay("2036-10-21"), "auto-cal backfill: each person's own work days (Sam works Tue/Thu)");
  ok(JSON.stringify(plan.perPerson.map((p) => [p.name, p.count])) === JSON.stringify([["Dana", 3], ["Sam", 1]]), "auto-cal backfill: counts per person");

  // Backfill runner (in-memory deps): dry run writes nothing, apply writes, a second run is a no-op
  const tasksMem: TaskRecord[] = [
    normalizeTask({ id: "T-1", title: "a", assigneeUserId: "u1", assigneeName: "Dana", createdAt: 1 }),
    normalizeTask({ id: "T-dated", title: "b", assigneeUserId: "u1", assigneeName: "Dana", dueAt: at(FRI, 17), createdAt: 2 }),
    normalizeTask({ id: "T-done", title: "c", assigneeUserId: "u1", assigneeName: "Dana", status: "done", createdAt: 3 }),
    normalizeTask({ id: "T-none", title: "d", createdAt: 4 }),
  ];
  const asgMem: Assignment[] = [{ id: "as-1", title: "e", assignee: "dana", createdBy: "x", createdAt: 5, dueDate: 0, link: null, done: false, doneAt: null, doneVia: null, source: "" }];
  const deps = {
    now: () => at(FRI, 10),
    roster: async () => [{ id: "u1", name: "Dana" }],
    tasks: async () => tasksMem,
    assignments: async () => asgMem,
    workHours: async () => DEFAULT_WORK_HOURS,
    setTaskDue: async (id: string, dueAt: number) => {
      const t = tasksMem.find((x) => x.id === id)!;
      if (t.dueAt && t.dueAt > 0) return false;
      t.dueAt = dueAt;
      return true;
    },
    setAssignmentDue: async (id: string, dueAt: number) => {
      const a = asgMem.find((x) => x.id === id)!;
      if (a.dueDate > 0) return false;
      a.dueDate = dueAt;
      return true;
    },
  };
  const dry = await runDueBackfill({ apply: false, deps });
  ok(dry.planned === 2 && dry.updated === 0 && !tasksMem[0].dueAt && asgMem[0].dueDate === 0, "auto-cal backfill: the dry run counts and writes nothing");
  const applied = await runDueBackfill({ apply: true, deps });
  ok(applied.updated === 2 && (tasksMem[0].dueAt ?? 0) > 0 && asgMem[0].dueDate > 0, "auto-cal backfill: --apply writes the due dates (a name-only assignee resolves case-insensitively)");
  ok((await runDueBackfill({ apply: true, deps })).planned === 0, "auto-cal backfill: a second run finds nothing to change");

  // +7 in the create functions (DB)
  const me = { id: "TESTautocal:u1", name: "Auto Cal" };
  const before = Date.now();
  const T1 = fixtureId("autocal", "due-assigned");
  const T2 = fixtureId("autocal", "due-unassigned");
  const T3 = fixtureId("autocal", "due-explicit");
  await createTask({ id: T1, title: "due assigned", assigneeUserId: me.id, assigneeName: me.name }, me);
  await createTask({ id: T2, title: "due unassigned" }, me);
  await createTask({ id: T3, title: "due explicit", assigneeUserId: me.id, assigneeName: me.name, dueAt: at(FRI, 12) }, me);
  for (const id of [T1, T2, T3]) registerFixture("tasks", id);
  const expect = (ms: number | null | undefined) => ms === defaultDueAt(before) || ms === defaultDueAt(Date.now());
  ok(expect((await getTask(T1))?.dueAt) && (await getTask(T2))?.dueAt === null && (await getTask(T3))?.dueAt === at(FRI, 12),
    "auto-cal due: createTask gives an assigned, undated task a due date 7 days out; unassigned and dated tasks are left alone");
  const cov = fixtureId("autocal", "due-auto-coverage");
  registerFixture("tasks", autoTaskId(cov));
  const auto = await createAutoTask({ title: "due auto", coverageKey: cov, assigneeUserId: me.id, assigneeName: me.name });
  ok(expect(auto?.dueAt), "auto-cal due: createAutoTask (checklists, templates) gets the same default");
  const a = await createAssignment({ title: "due asg", assignee: me.name, createdBy: me.name });
  registerFixture("assignments", a.id);
  const b = await createAssignment({ title: "due asg dated", assignee: me.name, createdBy: me.name, dueDate: at(FRI, 12) });
  registerFixture("assignments", b.id);
  ok(expect(a.dueDate) && b.dueDate === at(FRI, 12), "auto-cal due: createAssignment gives an undated assignment a due date 7 days out");
}
```

Chain it: merge `autoCalDueChecks` into the `./test-auto-calendar` import line, and add `.then(() => autoCalDueChecks(ok))` right after `.then(() => autoCalFieldsChecks(ok))`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsc --noEmit`
Expected: FAIL — `Cannot find module '@/lib/task-plan/due'` / `'@/lib/task-plan/backfill'`.

- [ ] **Step 3: Implement `src/lib/task-plan/due.ts`**

```ts
/**
 * Due dates (spec Part 1 "Due dates"). Pure and client-safe.
 *  - New tasks/assignments created without a due date get one +7 days.
 *  - Stored stamps are 5:00 pm Chicago on the due day: Google Tasks takes the
 *    UTC date of the stamp, and 5 pm Chicago is the same UTC date year-round,
 *    so the date reads the same everywhere.
 *  - The planner holds a due date until the END of its Chicago day.
 */
import { addDays, chicagoDayKey, chicagoDayStart } from "@/lib/drive-plan/day";
import { chicagoWallMs, weekdayOf } from "@/lib/visit-plan/hours";
import { DEFAULT_WORK_HOURS, type WorkHours } from "@/lib/visit-plan/settings";
import { planItemKey, type PlanItemKind } from "./types";

export const AUTO_DUE_DAYS = 7;
export const DUE_STAMP_MIN = 17 * 60;

export function dueStampForDay(dayKey: string): number {
  return chicagoWallMs(dayKey, DUE_STAMP_MIN);
}

export function defaultDueAt(nowMs: number): number {
  return dueStampForDay(addDays(chicagoDayKey(nowMs), AUTO_DUE_DAYS));
}

/** The +7 rule as the create functions apply it: only an assigned item with no date. */
export function autoDueAt(dueAt: number | null | undefined, assigned: boolean, nowMs: number): number | null {
  if (typeof dueAt === "number" && Number.isFinite(dueAt) && dueAt > 0) return dueAt;
  return assigned ? defaultDueAt(nowMs) : null;
}

export function deadlineOf(dueMs: number): number {
  return chicagoDayStart(addDays(chicagoDayKey(dueMs), 1));
}

/** An undated item (assigned after creation, or pre-backfill) plans as due 7 days after it was created. */
export function effectiveDue(dueAt: number | null | undefined, createdAt: number): { dueMs: number; virtual: boolean } {
  if (typeof dueAt === "number" && Number.isFinite(dueAt) && dueAt > 0) return { dueMs: dueAt, virtual: false };
  return { dueMs: defaultDueAt(createdAt || 0), virtual: true };
}

/* ---- the one-time backfill (pure half) ---- */

export const BACKFILL_WEEKS = 4;

export type BackfillItem = { kind: PlanItemKind; id: string; person: string; personName: string; createdAt: number };
export type BackfillUpdate = BackfillItem & { dayKey: string; dueAt: number };
export type BackfillPlan = {
  updates: BackfillUpdate[];
  perPerson: Array<{ person: string; name: string; count: number; firstDay: string; lastDay: string }>;
};

/** Work days in (fromDayKey, fromDayKey + calendarDays]. */
export function workDaysAfter(fromDayKey: string, calendarDays: number, hours: WorkHours): string[] {
  const out: string[] = [];
  for (let i = 1; i <= calendarDays; i++) {
    const k = addDays(fromDayKey, i);
    if (hours.days.includes(weekdayOf(k))) out.push(k);
  }
  return out;
}

/** Each person's undated items, oldest first, spread evenly over the next 4 weeks of their work days. */
export function planDueBackfill(args: {
  items: readonly BackfillItem[];
  hoursByPerson: ReadonlyMap<string, WorkHours>;
  nowMs: number;
  weeks?: number;
}): BackfillPlan {
  const today = chicagoDayKey(args.nowMs);
  const span = (args.weeks ?? BACKFILL_WEEKS) * 7;
  const byPerson = new Map<string, BackfillItem[]>();
  for (const it of args.items) {
    const list = byPerson.get(it.person);
    if (list) list.push(it);
    else byPerson.set(it.person, [it]);
  }
  const updates: BackfillUpdate[] = [];
  const perPerson: BackfillPlan["perPerson"] = [];
  for (const person of [...byPerson.keys()].sort()) {
    const list = byPerson
      .get(person)!
      .sort((a, b) => a.createdAt - b.createdAt || (planItemKey(a.kind, a.id) < planItemKey(b.kind, b.id) ? -1 : 1));
    let days = workDaysAfter(today, span, args.hoursByPerson.get(person) ?? DEFAULT_WORK_HOURS);
    if (!days.length) days = Array.from({ length: span }, (_, i) => addDays(today, i + 1));
    const mine = list.map((it, i) => {
      const dayKey = days[Math.floor((i * days.length) / list.length)];
      return { ...it, dayKey, dueAt: dueStampForDay(dayKey) };
    });
    updates.push(...mine);
    perPerson.push({ person, name: list[0].personName, count: list.length, firstDay: mine[0].dayKey, lastDay: mine[mine.length - 1].dayKey });
  }
  perPerson.sort((a, b) => a.name.localeCompare(b.name));
  return { updates, perPerson };
}
```

- [ ] **Step 4: Implement `src/lib/task-plan/people.ts`**

```ts
/** Who an item is planned for (spec Part 1 "What is scheduled"). Pure, client-safe. */
import { sameName } from "@/lib/quote-approval-rules";
import type { Assignment } from "@/lib/stores/assignments";
import type { TaskRecord } from "@/lib/stores/tasks";

export type RosterPerson = { id: string; name: string };

/** Open or In progress. A Blocked task waits — it can't be worked. */
export function isPlannedTask(t: Pick<TaskRecord, "status">): boolean {
  return t.status === "open" || t.status === "in_progress";
}

/** The assignee's user id when it's on the roster, else the assignee name (legacy name-only tasks). */
export function personForTask(t: Pick<TaskRecord, "assigneeUserId" | "assigneeName">, roster: readonly RosterPerson[]): RosterPerson | null {
  if (t.assigneeUserId) {
    const hit = roster.find((u) => u.id === t.assigneeUserId);
    if (hit) return hit;
  }
  return t.assigneeName ? (roster.find((u) => sameName(u.name, t.assigneeName)) ?? null) : null;
}

/** Assignments carry a team-member NAME (app convention). */
export function personForAssignment(a: Pick<Assignment, "assignee">, roster: readonly RosterPerson[]): RosterPerson | null {
  return a.assignee ? (roster.find((u) => sameName(u.name, a.assignee)) ?? null) : null;
}
```

- [ ] **Step 5: Implement `src/lib/task-plan/backfill.ts`**

```ts
/**
 * One-time due-date backfill (spec Part 1 "Due dates"): existing open,
 * assigned, undated tasks and Queue assignments get due dates spread over the
 * next 4 weeks of each person's work days, oldest first. Dry run by default;
 * `apply` writes. Idempotent: a write lands only while the item is still
 * undated, and a second run finds nothing. CLI: scripts/backfill-task-due.ts.
 */
import { patchDoc } from "@/db/doc-store";
import { allAssignments, type Assignment } from "@/lib/stores/assignments";
import { workHoursFor } from "@/lib/stores/schedule-prefs";
import { allTasks, patchTask, type TaskRecord } from "@/lib/stores/tasks";
import { activeUsers } from "@/lib/users";
import type { WorkHours } from "@/lib/visit-plan/settings";
import { planDueBackfill, type BackfillItem, type BackfillPlan } from "./due";
import { isPlannedTask, personForAssignment, personForTask, type RosterPerson } from "./people";

export type BackfillDeps = {
  now(): number;
  roster(): Promise<RosterPerson[]>;
  tasks(): Promise<TaskRecord[]>;
  assignments(): Promise<Assignment[]>;
  workHours(userId: string): Promise<WorkHours>;
  /** true when it wrote (the item was still undated) */
  setTaskDue(id: string, dueAt: number): Promise<boolean>;
  setAssignmentDue(id: string, dueAt: number): Promise<boolean>;
};

function defaultDeps(): BackfillDeps {
  return {
    now: Date.now,
    roster: async () => (await activeUsers()).map((u) => ({ id: u.id, name: u.name })),
    tasks: allTasks,
    assignments: allAssignments,
    workHours: workHoursFor,
    setTaskDue: async (id, dueAt) => {
      const r = { wrote: false };
      await patchTask(id, (t) => {
        if (!(typeof t.dueAt === "number" && t.dueAt > 0)) {
          t.dueAt = dueAt;
          r.wrote = true;
        }
        return t;
      });
      return r.wrote;
    },
    setAssignmentDue: async (id, dueAt) => {
      const r = { wrote: false };
      await patchDoc<Assignment>("assignments", id, (d) => {
        if (!(Number(d.dueDate) > 0)) {
          d.dueDate = dueAt;
          r.wrote = true;
        }
      });
      return r.wrote;
    },
  };
}

export async function runDueBackfill(opts: {
  apply: boolean;
  deps?: Partial<BackfillDeps>;
}): Promise<{ apply: boolean; planned: number; updated: number; plan: BackfillPlan }> {
  const d: BackfillDeps = { ...defaultDeps(), ...opts.deps };
  const [roster, tasks, assignments] = await Promise.all([d.roster(), d.tasks(), d.assignments()]);
  const items: BackfillItem[] = [];
  for (const t of tasks) {
    if (!isPlannedTask(t) || (t.dueAt ?? 0) > 0) continue;
    const p = personForTask(t, roster);
    if (p) items.push({ kind: "task", id: t.id, person: p.id, personName: p.name, createdAt: t.createdAt || 0 });
  }
  for (const a of assignments) {
    if (a.done || Number(a.dueDate) > 0) continue;
    const p = personForAssignment(a, roster);
    if (p) items.push({ kind: "assignment", id: a.id, person: p.id, personName: p.name, createdAt: a.createdAt || 0 });
  }
  const people = [...new Set(items.map((i) => i.person))];
  const hours = new Map(await Promise.all(people.map(async (id) => [id, await d.workHours(id)] as const)));
  const plan = planDueBackfill({ items, hoursByPerson: hours, nowMs: d.now() });
  let updated = 0;
  if (opts.apply) {
    for (const u of plan.updates) {
      const wrote = u.kind === "task" ? await d.setTaskDue(u.id, u.dueAt) : await d.setAssignmentDue(u.id, u.dueAt);
      if (wrote) updated++;
    }
  }
  return { apply: opts.apply, planned: plan.updates.length, updated, plan };
}
```

- [ ] **Step 6: The CLI `scripts/backfill-task-due.ts` and npm script**

```ts
/**
 * One-time due-date backfill — spec 2026-10-09 auto task calendar, Part 1.
 *
 *   DATABASE_URL=... npm run tasks:backfill-due                  → dry run: counts per person
 *   DATABASE_URL=... npm run tasks:backfill-due -- --apply --yes → write (hosted needs --yes)
 *   PGLITE_PATH=<scratch dir> npm run tasks:backfill-due          → a local copy
 *
 * Idempotent: a second run finds nothing. The target must be named explicitly
 * (never .data/pglite while `next dev` holds it — single-process). Hosted:
 * back up first (npm run db:export).
 */
import { requireHostedConfirmation, resolveExplicitDbTarget } from "./db-target";
import { runDueBackfill } from "../src/lib/task-plan/backfill";

const args = process.argv.slice(2);

async function main(): Promise<void> {
  const apply = args.includes("--apply");
  const target = resolveExplicitDbTarget(apply ? "tasks:backfill-due --apply" : "tasks:backfill-due (dry run)");
  if (!target) {
    console.error("\nRefusing to run without an explicit database target.\nSet DATABASE_URL (hosted) or PGLITE_PATH (a local PGlite directory) for this command.\n");
    process.exit(1);
  }
  if (apply) requireHostedConfirmation(target.hosted, args);
  const r = await runDueBackfill({ apply });
  for (const p of r.plan.perPerson) console.log(`  ${p.name}: ${p.count} item(s), due ${p.firstDay} → ${p.lastDay}`);
  console.log(
    apply
      ? `\nApplied: ${r.updated} of ${r.planned} due date(s) written.`
      : `\nDry run: ${r.planned} item(s) would get a due date. Re-run with --apply to write.`
  );
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
```

In `package.json` `"scripts"`, after the `"geo:recheck-venues"` line, add:

```json
    "tasks:backfill-due": "tsx scripts/backfill-task-due.ts",
```

- [ ] **Step 7: The +7 rule in the create functions**

In `src/lib/stores/tasks.ts`, add `import { autoDueAt } from "@/lib/task-plan/due";` and add above `createTask`:

```ts
/** Spec 2026-10-09 auto task calendar — a new ASSIGNED task with no due date
 *  is due in 7 days (an unassigned checklist row isn't planned, and an
 *  overdue unassigned row would reach every bell). */
function withAutoDue<T extends Partial<TaskRecord>>(input: T, at: number): T {
  const assigned = !!(input.assigneeUserId || (input.assigneeName || "").trim());
  return { ...input, dueAt: autoDueAt(input.dueAt, assigned, at) };
}
```

In `createTask`, replace both `normalizeTask({ ...input, id…` calls' `...input` with `...withAutoDue(input, at)`:

```ts
  if (input.id) {
    const t = normalizeTask({ ...withAutoDue(input, at), id: input.id, createdBy: me.name, createdAt: at, updatedAt: at });
    await upsertDoc<TaskRecord>("tasks", t);
    return t;
  }
  return insertWithPrefixedId<TaskRecord>("tasks", "T", 6000, (id) =>
    normalizeTask({ ...withAutoDue(input, at), id, createdBy: me.name, createdAt: at, updatedAt: at })
  );
```

In `createAutoTask`, replace `normalizeTask({ ...input, id, …` with `normalizeTask({ ...withAutoDue(input, at), id, createdBy: input.createdBy || "System", createdAt: at, updatedAt: at })`.

In `src/lib/stores/assignments.ts`, add `import { autoDueAt } from "@/lib/task-plan/due";` and in `createAssignment` replace the `createdAt`/`dueDate` lines of `rec` with:

```ts
    createdAt: at,
    dueDate: autoDueAt(Number(input.dueDate) || 0, !!input.assignee.trim(), at) ?? 0,
```

with `const at = Date.now();` as the first line of the function.

- [ ] **Step 8: Run the tests; fix the one pre-existing pin the +7 rule changes**

Run: `npx tsc --noEmit` → PASS. Run: `df -h . && env -u DATABASE_URL npm run test:specs`.

Expected: the new `auto-cal due:` / `auto-cal backfill:` lines PASS; ONE pre-existing check fails: `#145 T3 omitting schedule produces no dates, …` (its template line targets user `u1`, so the task is assigned and now gets the +7 date). In `scripts/test-review-and-spec.ts`, in that assertion replace `projTasks145t3[0]?.dueAt === null &&` with `typeof projTasks145t3[0]?.dueAt === "number" &&` and append to its message ` (a due date is the spec-3 +7 default for an assigned task)`. If any OTHER pre-existing check fails only because an assigned task/assignment created without a due date now has one, update that one assertion the same way and list it in your report. Re-run until `ALL PASSED`.

Run: `npx eslint --ignore-pattern scripts/test-review-and-spec.ts src/lib/task-plan/due.ts src/lib/task-plan/people.ts src/lib/task-plan/backfill.ts src/lib/stores/tasks.ts src/lib/stores/assignments.ts scripts/backfill-task-due.ts scripts/test-auto-calendar.ts` → no errors.

Do NOT run `npm run tasks:backfill-due` (it opens a database); production is Jeff's run (Task 13 docs).

- [ ] **Step 9: Commit**

```bash
git add src/lib/task-plan/due.ts src/lib/task-plan/people.ts src/lib/task-plan/backfill.ts scripts/backfill-task-due.ts package.json src/lib/stores/tasks.ts src/lib/stores/assignments.ts scripts/test-auto-calendar.ts scripts/test-review-and-spec.ts
git commit -m "feat(task-plan): +7 day default due date and the one-time due backfill

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Blended urgency ordering

**Files:**
- Create: `src/lib/task-plan/urgency.ts`
- Modify: `scripts/test-auto-calendar.ts`, `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `chicagoDayKey` (spec 1); `dayKeyDiff` (`src/lib/calendar-tasks.ts`, pure); `TIER_FACTOR`, `TaskTier` (Task 1).
- Produces: `daysLeft(dueMs, nowMs): number` (0 = due today, negative = overdue); `urgencyWeight(tier, daysLeft): number` (display/test aid: `TIER_FACTOR[tier] / (max(0, d) + 1)`); `type UrgencyKey = { key: string; tier: TaskTier; dueMs: number; createdAt: number }`; `compareUrgency(a, b, nowMs): number` (negative = `a` first); `sortByUrgency<T extends UrgencyKey>(items: readonly T[], nowMs): T[]`.

- [ ] **Step 1: Write the failing tests**

Add to the imports of `scripts/test-auto-calendar.ts`:

```ts
import { daysLeft, sortByUrgency, urgencyWeight, type UrgencyKey } from "@/lib/task-plan/urgency";
import type { TaskTier } from "@/lib/task-plan/types";
```

(merge `TaskTier` into the existing `@/lib/task-plan/types` import.) Append:

```ts
/* ---- Task 3: urgency ---- */
export async function autoCalUrgencyChecks(ok: Ok): Promise<void> {
  const now = at(MON, 9);
  const uk = (key: string, tier: TaskTier, day: string, createdAt = 1): UrgencyKey => ({ key, tier, dueMs: at(day, 17), createdAt });
  const order = (...ks: UrgencyKey[]) => sortByUrgency(ks, now).map((k) => k.key).join(",");
  ok(daysLeft(at(TUE, 17), now) === 1 && daysLeft(at(MON, 23), now) === 0 && daysLeft(at("2036-10-11", 9), now) === -2, "auto-cal urgency: days left by Chicago calendar day");
  ok(order(uk("high-month", "high", "2036-11-12"), uk("low-tomorrow", "low", TUE)) === "low-tomorrow,high-month",
    "auto-cal urgency: a Low task due tomorrow outranks a High task due in a month (required property)");
  ok(order(uk("high-week", "high", "2036-10-20"), uk("low-tomorrow", "low", TUE)) === "low-tomorrow,high-week", "auto-cal urgency: …and a High task due next week");
  ok(order(uk("low", "low", FRI), uk("high", "high", FRI), uk("normal", "normal", FRI)) === "high,normal,low", "auto-cal urgency: same due day → the tier decides");
  ok(order(uk("high-3d", "high", "2036-10-16"), uk("normal-1d", "normal", TUE)) === "normal-1d,high-3d",
    "auto-cal urgency: closeness rises steeply — Normal due tomorrow beats High due in 3 days");
  ok(order(uk("high-today", "high", MON), uk("low-overdue", "low", "2036-10-12")) === "low-overdue,high-today", "auto-cal urgency: overdue outranks everything");
  ok(order(uk("od1", "high", "2036-10-12"), uk("od5", "low", "2036-10-08")) === "od5,od1", "auto-cal urgency: most overdue first");
  ok(order(uk("high-2d", "high", WED), uk("normal-1d", "normal", TUE)) === "normal-1d,high-2d", "auto-cal urgency: equal weight (3/3 = 2/2) → earlier due first");
  ok(order(uk("b", "normal", FRI, 200), uk("a", "normal", FRI, 100)) === "a,b" && order(uk("z", "normal", FRI, 5), uk("y", "normal", FRI, 5)) === "y,z",
    "auto-cal urgency: then older createdAt, then id");
  const list = [uk("1", "low", TUE), uk("2", "high", "2036-11-12"), uk("3", "normal", FRI), uk("4", "high", "2036-10-10"), uk("5", "normal", FRI, 0)];
  ok(order(...list) === order(...[...list].reverse()), "auto-cal urgency: the order never depends on input order");
  ok(urgencyWeight("normal", 0) / urgencyWeight("normal", 3) === 4 && urgencyWeight("low", 1) > urgencyWeight("high", 30) && urgencyWeight("low", 1) > urgencyWeight("high", 7),
    "auto-cal urgency: the curve is tier × 1/(days left + 1)");
}
```

Chain: merge `autoCalUrgencyChecks` into the import and add `.then(() => autoCalUrgencyChecks(ok))` after `.then(() => autoCalDueChecks(ok))`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsc --noEmit`
Expected: FAIL — `Cannot find module '@/lib/task-plan/urgency'`.

- [ ] **Step 3: Implement `src/lib/task-plan/urgency.ts`**

```ts
/**
 * Blended urgency (spec Part 2 "Ordering"). Pure and client-safe.
 *
 * weight = tier factor (High 3 · Normal 2 · Low 1) × 1 / (days left + 1),
 * days left in whole Chicago calendar days (0 = due today). The curve is
 * hyperbolic: from a week out to due today it rises 8×, so a Low task due
 * tomorrow (1/2) beats a High task due next week (3/8) or next month (3/31).
 * Overdue outranks everything, most overdue first; ties: earlier due → older
 * createdAt → item key. Weights are compared as integer cross-products, never
 * as floats, so the order is exact and deterministic.
 */
import { dayKeyDiff } from "@/lib/calendar-tasks";
import { chicagoDayKey } from "@/lib/drive-plan/day";
import { TIER_FACTOR, type TaskTier } from "./types";

export function daysLeft(dueMs: number, nowMs: number): number {
  return dayKeyDiff(chicagoDayKey(nowMs), chicagoDayKey(dueMs));
}

export function urgencyWeight(tier: TaskTier, d: number): number {
  return TIER_FACTOR[tier] / (Math.max(0, d) + 1);
}

export type UrgencyKey = { key: string; tier: TaskTier; dueMs: number; createdAt: number };

export function compareUrgency(a: UrgencyKey, b: UrgencyKey, nowMs: number): number {
  const da = daysLeft(a.dueMs, nowMs);
  const db = daysLeft(b.dueMs, nowMs);
  const ao = da < 0;
  const bo = db < 0;
  if (ao !== bo) return ao ? -1 : 1;
  if (ao) {
    if (da !== db) return da - db; // more overdue first
    const t = TIER_FACTOR[b.tier] - TIER_FACTOR[a.tier];
    if (t) return t;
  } else {
    // a first when tier(a)/(da+1) > tier(b)/(db+1)
    const lhs = TIER_FACTOR[a.tier] * (db + 1);
    const rhs = TIER_FACTOR[b.tier] * (da + 1);
    if (lhs !== rhs) return rhs - lhs;
  }
  if (a.dueMs !== b.dueMs) return a.dueMs - b.dueMs;
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

export function sortByUrgency<T extends UrgencyKey>(items: readonly T[], nowMs: number): T[] {
  return [...items].sort((a, b) => compareUrgency(a, b, nowMs));
}
```

- [ ] **Step 4: Run the gates**

`npx tsc --noEmit` → PASS · `env -u DATABASE_URL npm run test:specs` → `ALL PASSED` · `npx eslint --ignore-pattern scripts/test-review-and-spec.ts src/lib/task-plan/urgency.ts scripts/test-auto-calendar.ts` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/task-plan/urgency.ts scripts/test-auto-calendar.ts scripts/test-review-and-spec.ts
git commit -m "feat(task-plan): blended urgency — tier x 1/(days left + 1), overdue first

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Free time + placement engine (`planPerson`)

**Files:**
- Create: `src/lib/task-plan/free.ts`, `src/lib/task-plan/labels.ts`, `src/lib/task-plan/plan.ts`
- Modify: `scripts/test-auto-calendar.ts`, `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `workWindow`, `chicagoMinuteOfDay`, `fmtDayLabel` (spec 2 hours.ts); `fmtClock` (spec 2 settings.ts); `CalendarRead` (spec 2 check.ts, type); `chicagoDayKey`, `addDays`, `DRIVE_TZ` (spec 1); `deadlineOf` (Task 2); `sortByUrgency`, `daysLeft` (Task 3); types (Task 1).
- Produces:
  - `free.ts`: `floorQuarter(ms)`, `ceilQuarter(ms)`; `mergeIntervals(list): BusyInterval[]`; `subtractIntervals(window, merged): BusyInterval[]`; `type FreeDay = { dayKey: string; free: BusyInterval[]; capMin: number }`; `freeDays({ startMs, days, hours, busy, fillRatio? }): FreeDay[]`; `chunkFor(remainingMin, availMin): number`.
  - `labels.ts`: `dueDayLabel(dueMs, nowMs)`; `atRiskLabel(dueMs, nowMs)` (`At risk — due Tue`); `GOOGLE_NOTE_ME`; `calendarNote(status: CalendarRead, name, isMe): string | null`; `fmtBlockTime(startMs, endMs)` (`"8:00–9:00"`); `NOT_PLACED_TEXT`; `finishText(finishMs: number | null)` (`Plan finishes Tue Oct 14`).
  - `plan.ts`: `type QueueEntry = { item: PlanItem; minutes: number; earliestMs: number }`; `blockOf(item, slot, pinned): PlanBlock`; `placeEntry(entry, days): { slots; remaining }`; `planPerson(input: PlanInput): PlanResult` (Task 5 adds pin lifecycle; here `newPins`/`staleKeys` are `[]`).

- [ ] **Step 1: Write the failing tests**

Add to the imports of `scripts/test-auto-calendar.ts`:

```ts
import { chunkFor } from "@/lib/task-plan/free";
import { planPerson } from "@/lib/task-plan/plan";
import { QUARTER_MS, type PlanInput, type PlanResult } from "@/lib/task-plan/types";
```

(merge into the existing `@/lib/task-plan/types` import.) Append:

```ts
/* ---- Task 4: placement ---- */
const blocksOf = (r: PlanResult, key: string) => r.blocks.filter((b) => b.itemKey === key);
const baseInput = (over: Partial<PlanInput> = {}): PlanInput => ({ userId: "u1", nowMs: at(MON, 7), hours: DEFAULT_WORK_HOURS, busy: [], pins: [], items: [], ...over });

export async function autoCalPlacementChecks(ok: Ok): Promise<void> {
  const one = planPerson(baseInput({ items: [item("A")] }));
  ok(one.blocks.length === 1 && one.blocks[0].startMs === at(MON, 8) && one.blocks[0].endMs === at(MON, 9) && !one.blocks[0].pinned,
    "auto-cal plan: a 1 h task lands in the first free hour of work");

  const ten = planPerson(baseInput({ items: Array.from({ length: 10 }, (_, i) => item("T" + i, { createdAt: i })) }));
  const monMin = ten.blocks.filter((b) => chicagoDayKey(b.startMs) === MON).reduce((s, b) => s + (b.endMs - b.startMs) / MIN, 0);
  ok(monMin === 420 && ten.blocks.some((b) => chicagoDayKey(b.startMs) === TUE), "auto-cal plan: at most 80 % of a day's free time is filled (540 free → 420 planned, the rest Tuesday)");

  const grid = planPerson(baseInput({ nowMs: at(MON, 8, 7), busy: [{ startMs: at(MON, 9, 10), endMs: at(MON, 9, 50) }], items: [item("A", { size: "l", sizeMin: 240 }), item("B", { createdAt: 2 })] }));
  ok(grid.blocks.every((b) => b.startMs % QUARTER_MS === 0 && b.endMs % QUARTER_MS === 0), "auto-cal plan: every block sits on the 15-minute grid");
  ok(!grid.blocks.some((b) => b.startMs < at(MON, 10) && b.endMs > at(MON, 9)), "auto-cal plan: a busy 9:10–9:50 keeps 9:00–10:00 clear on the grid");

  const chunk = planPerson(baseInput({ busy: [{ startMs: at(MON, 8, 45), endMs: at(MON, 9) }, { startMs: at(MON, 10), endMs: at(MON, 10, 15) }], items: [item("L", { size: "l", sizeMin: 240 })] }));
  const lb = blocksOf(chunk, "task:L");
  ok(lb.length > 1 && lb.every((b) => b.endMs - b.startMs >= 30 * MIN) && lb.reduce((s, b) => s + (b.endMs - b.startMs), 0) === 240 * MIN,
    "auto-cal plan: a long task splits into chunks of at least 30 minutes");
  const tiny = planPerson(baseInput({ busy: [{ startMs: at(MON, 8), endMs: at(MON, 8, 30) }, { startMs: at(MON, 8, 45), endMs: at(MON, 17) }], items: [item("S", { size: "s", sizeMin: 30 })] }));
  ok(tiny.blocks[0].startMs === at(TUE, 8), "auto-cal plan: a 15-minute gap is never used");

  const tpl = planPerson(baseInput({ items: [item("A", { earliestMs: at(WED, 0) })] }));
  ok(tpl.blocks[0].startMs === at(WED, 8), "auto-cal plan: a template's startAt is the earliest it is placed");
  const sat = planPerson(baseInput({ nowMs: at(SAT, 10), items: [item("A", { dueMs: at("2036-10-24", 17) })] }));
  ok(sat.blocks[0].startMs === at("2036-10-20", 8), "auto-cal plan: nothing is placed outside work hours (Saturday → Monday 8:00)");

  const busy = [{ startMs: at(MON, 9), endMs: at(MON, 11) }, { startMs: at(MON, 13), endMs: at(MON, 13, 30) }];
  const around = planPerson(baseInput({ busy, items: ["A", "B", "C", "D"].map((k, i) => item(k, { createdAt: i })) }));
  ok(around.blocks.every((b) => busy.every((x) => b.endMs <= x.startMs || b.startMs >= x.endMs)), "auto-cal plan: blocks never overlap visits, drives or meetings");

  const risk = planPerson(baseInput({ items: [
    item("big1", { size: "l", sizeMin: 240, tier: "high", dueMs: at(MON, 17) }),
    item("big2", { size: "l", sizeMin: 240, tier: "high", dueMs: at(MON, 17), createdAt: 2 }),
    item("late", { dueMs: at(MON, 17), createdAt: 3 }),
  ] }));
  const late = risk.atRisk.find((a) => a.itemKey === "task:late");
  ok(!!late && chicagoDayKey(late.finishMs!) === TUE && late.label === "At risk — due Mon" && blocksOf(risk, "task:late").every((b) => b.atRisk),
    "auto-cal plan: work that can't finish by its due date is still placed, late, and flagged At risk");
  ok(!risk.atRisk.some((a) => a.itemKey === "task:big1"), "auto-cal plan: work that fits isn't flagged");
  const over = planPerson(baseInput({ horizonDays: 1, items: [item("A", { size: "l", sizeMin: 240 }), item("B", { size: "l", sizeMin: 240, createdAt: 2 })] }));
  ok(over.atRisk.some((a) => a.itemKey === "task:B" && a.finishMs === null), "auto-cal plan: work that doesn't fit in the horizon is flagged with no finish date");

  const pr = planPerson(baseInput({ items: [item("high-month", { tier: "high", dueMs: at("2036-11-12", 17) }), item("low-tomorrow", { tier: "low", dueMs: at(TUE, 17) })] }));
  ok(pr.blocks[0].itemKey === "task:low-tomorrow", "auto-cal plan: the most urgent item gets the earliest time");

  const pinned = planPerson(baseInput({ pins: [{ itemKey: "task:A", startMs: at(MON, 10), endMs: at(MON, 11), kind: "hand" }], items: [item("A"), item("B", { tier: "high", dueMs: at(MON, 17) })] }));
  ok(blocksOf(pinned, "task:A").length === 1 && blocksOf(pinned, "task:A")[0].pinned === "hand" && blocksOf(pinned, "task:A")[0].startMs === at(MON, 10),
    "auto-cal plan: a pinned block stays where it is and covers the task");
  ok(!pinned.blocks.some((b) => b.itemKey !== "task:A" && b.startMs < at(MON, 11) && b.endMs > at(MON, 10)), "auto-cal plan: pinned time is taken out of free time first");

  const inp = baseInput({ busy, items: ["A", "B", "C", "D", "E"].map((k, i) => item(k, { createdAt: 5 - i, tier: i % 2 ? "high" : "low" })) });
  ok(JSON.stringify(planPerson(inp)) === JSON.stringify(planPerson({ ...inp, items: [...inp.items].reverse(), busy: [...inp.busy].reverse() })), "auto-cal plan: same input → same plan");
  ok(chunkFor(60, 45) === 30 && chunkFor(240, 225) === 210 && chunkFor(30, 15) === 0 && chunkFor(15, 15) === 15 && chunkFor(45, 30) === 0 && chunkFor(60, 90) === 60,
    "auto-cal plan: chunk sizes keep every piece ≥ 30 minutes");
}
```

Chain: merge `autoCalPlacementChecks` and add `.then(() => autoCalPlacementChecks(ok))` after `.then(() => autoCalUrgencyChecks(ok))`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsc --noEmit`
Expected: FAIL — `Cannot find module '@/lib/task-plan/free'` / `'@/lib/task-plan/plan'`.

- [ ] **Step 3: Implement `src/lib/task-plan/free.ts`**

```ts
/**
 * Free time (spec Part 2 "Free time"): work hours (spec 2) minus visits,
 * drive blocks, accepted timed Google events and pins, on a 15-minute grid,
 * with at most 80 % of each day's free minutes fillable. Pure, client-safe.
 * Epoch quarter-hours are Chicago quarter-hours (whole-hour UTC offset).
 */
import { addDays, chicagoDayKey } from "@/lib/drive-plan/day";
import { workWindow } from "@/lib/visit-plan/hours";
import type { WorkHours } from "@/lib/visit-plan/settings";
import { FILL_RATIO, GRID_MIN, MIN_CHUNK_MIN, QUARTER_MS, type BusyInterval } from "./types";

export const floorQuarter = (ms: number): number => Math.floor(ms / QUARTER_MS) * QUARTER_MS;
export const ceilQuarter = (ms: number): number => Math.ceil(ms / QUARTER_MS) * QUARTER_MS;

export function mergeIntervals(list: readonly BusyInterval[]): BusyInterval[] {
  const sorted = list
    .filter((i) => Number.isFinite(i.startMs) && Number.isFinite(i.endMs) && i.endMs > i.startMs)
    .map((i) => ({ startMs: i.startMs, endMs: i.endMs }))
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const out: BusyInterval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.startMs <= last.endMs) last.endMs = Math.max(last.endMs, i.endMs);
    else out.push(i);
  }
  return out;
}

/** `win` minus already-merged busy intervals. */
export function subtractIntervals(win: BusyInterval, merged: readonly BusyInterval[]): BusyInterval[] {
  const out: BusyInterval[] = [];
  let cur = win.startMs;
  for (const b of merged) {
    if (b.endMs <= cur) continue;
    if (b.startMs >= win.endMs) break;
    if (b.startMs > cur) out.push({ startMs: cur, endMs: b.startMs });
    cur = Math.max(cur, b.endMs);
    if (cur >= win.endMs) break;
  }
  if (cur < win.endMs) out.push({ startMs: cur, endMs: win.endMs });
  return out;
}

export type FreeDay = { dayKey: string; free: BusyInterval[]; capMin: number };

/** One entry per Chicago day from `startMs`. Today's free time counts from
 *  `startMs`; gaps snap inward to the grid; cap = 80 % of the day's free
 *  minutes, floored to 15. */
export function freeDays(args: { startMs: number; days: number; hours: WorkHours; busy: readonly BusyInterval[]; fillRatio?: number }): FreeDay[] {
  const merged = mergeIntervals(args.busy);
  const ratio = args.fillRatio ?? FILL_RATIO;
  const out: FreeDay[] = [];
  let k = chicagoDayKey(args.startMs);
  for (let i = 0; i < args.days; i++, k = addDays(k, 1)) {
    const win = workWindow(k, args.hours);
    const from = win ? Math.max(win.startMs, args.startMs) : 0;
    if (!win || from >= win.endMs) {
      out.push({ dayKey: k, free: [], capMin: 0 });
      continue;
    }
    const free = subtractIntervals({ startMs: from, endMs: win.endMs }, merged)
      .map((g) => ({ startMs: ceilQuarter(g.startMs), endMs: floorQuarter(g.endMs) }))
      .filter((g) => g.endMs > g.startMs);
    const freeMin = free.reduce((s, g) => s + (g.endMs - g.startMs) / 60_000, 0);
    out.push({ dayKey: k, free, capMin: Math.floor((freeMin * ratio) / GRID_MIN) * GRID_MIN });
  }
  return out;
}

/** The biggest piece of `remainingMin` that fits `availMin` with every piece
 *  ≥ 30 min (a remainder under 30 is placed whole); 0 = doesn't fit here. */
export function chunkFor(remainingMin: number, availMin: number): number {
  if (availMin >= remainingMin) return remainingMin;
  const minChunk = Math.min(MIN_CHUNK_MIN, remainingMin);
  let c = Math.floor(availMin / GRID_MIN) * GRID_MIN;
  if (remainingMin - c < MIN_CHUNK_MIN) c = remainingMin - MIN_CHUNK_MIN;
  return c >= minChunk ? c : 0;
}
```

- [ ] **Step 4: Implement `src/lib/task-plan/labels.ts`**

```ts
/** Copy for the task plan (spec Part 3). Pure, client-safe. */
import { chicagoDayKey, DRIVE_TZ } from "@/lib/drive-plan/day";
import type { CalendarRead } from "@/lib/visit-plan/check";
import { chicagoMinuteOfDay, fmtDayLabel } from "@/lib/visit-plan/hours";
import { fmtClock } from "@/lib/visit-plan/settings";
import { daysLeft } from "./urgency";

const WEEKDAY = new Intl.DateTimeFormat("en-US", { timeZone: DRIVE_TZ, weekday: "short" });
const MONTH_DAY = new Intl.DateTimeFormat("en-US", { timeZone: DRIVE_TZ, month: "short", day: "numeric" });

/** "Tue" within 6 days either way, else "Nov 3". */
export function dueDayLabel(dueMs: number, nowMs: number): string {
  const d = daysLeft(dueMs, nowMs);
  return d >= -6 && d <= 6 ? WEEKDAY.format(dueMs) : MONTH_DAY.format(dueMs);
}

export function atRiskLabel(dueMs: number, nowMs: number): string {
  return `At risk — due ${dueDayLabel(dueMs, nowMs)}`;
}

export const GOOGLE_NOTE_ME = "Planned without your Google calendar — may overlap meetings";

/** null when the calendar was read; otherwise the spec's failure note. */
export function calendarNote(status: CalendarRead, name: string, isMe: boolean): string | null {
  if (status === "ok") return null;
  return isMe ? GOOGLE_NOTE_ME : `Planned without ${name}'s Google calendar — may overlap meetings`;
}

/** "8:00–9:00" (Chicago, the spec-2 clock style). */
export function fmtBlockTime(startMs: number, endMs: number): string {
  return `${fmtClock(chicagoMinuteOfDay(startMs))}–${fmtClock(chicagoMinuteOfDay(endMs))}`;
}

export const NOT_PLACED_TEXT = "Doesn't fit in the next 8 weeks";

export function finishText(finishMs: number | null): string {
  return finishMs == null ? NOT_PLACED_TEXT : `Plan finishes ${fmtDayLabel(chicagoDayKey(finishMs - 1))}`;
}
```

- [ ] **Step 5: Implement `src/lib/task-plan/plan.ts`**

```ts
/**
 * planPerson — one person's task plan (spec Part 2). Pure, deterministic,
 * no IO, client-safe: same input → same plan. Highest urgency first, each
 * into the earliest free time at or after max(its earliest start, the
 * current quarter-hour); 15-minute grid; chunks ≥ 30 min; at most 80 % of a
 * day's free time. Work that can't finish by its due date is still placed —
 * late — and flagged At risk.
 *
 * The plan starts at the CURRENT quarter-hour (now rounded down), not the
 * next one: that is what lets "a block that has already begun" exist at
 * compute time and be pinned as started (Task 5).
 */
import { deadlineOf } from "./due";
import { ceilQuarter, chunkFor, floorQuarter, freeDays, type FreeDay } from "./free";
import { atRiskLabel } from "./labels";
import { sortByUrgency } from "./urgency";
import {
  FILL_RATIO,
  GRID_MIN,
  PLAN_HORIZON_DAYS,
  type AtRiskItem,
  type BusyInterval,
  type PinKind,
  type PlanBlock,
  type PlanInput,
  type PlanItem,
  type PlanResult,
} from "./types";

const MIN_MS = 60_000;

export type QueueEntry = { item: PlanItem; minutes: number; earliestMs: number };

const toGrid = (min: number): number => Math.ceil(Math.max(0, min) / GRID_MIN) * GRID_MIN;

export function blockOf(item: PlanItem, s: BusyInterval, pinned: PinKind | null): PlanBlock {
  return {
    key: `${item.key}@${s.startMs}`,
    itemKey: item.key,
    kind: item.kind,
    id: item.id,
    userId: item.userId,
    title: item.title,
    href: item.href,
    tier: item.tier,
    size: item.size,
    startMs: s.startMs,
    endMs: s.endMs,
    pinned,
    atRisk: false,
    dueMs: item.dueMs,
    inProgress: item.inProgress,
  };
}

/** Earliest free time at/after the entry's start; consumes `days`. */
export function placeEntry(e: QueueEntry, days: FreeDay[]): { slots: BusyInterval[]; remaining: number } {
  let remaining = e.minutes;
  const slots: BusyInterval[] = [];
  const from = ceilQuarter(e.earliestMs);
  for (const d of days) {
    if (remaining <= 0) break;
    for (let gi = 0; gi < d.free.length && remaining > 0 && d.capMin > 0; gi++) {
      const g = d.free[gi];
      if (g.endMs <= from) continue;
      const s = Math.max(g.startMs, from);
      const c = chunkFor(remaining, Math.min((g.endMs - s) / MIN_MS, d.capMin));
      if (c <= 0) continue;
      const end = s + c * MIN_MS;
      slots.push({ startMs: s, endMs: end });
      const parts: BusyInterval[] = [];
      if (s > g.startMs) parts.push({ startMs: g.startMs, endMs: s });
      if (end < g.endMs) parts.push({ startMs: end, endMs: g.endMs });
      d.free.splice(gi, 1, ...parts);
      gi += parts.length - 1;
      d.capMin -= c;
      remaining -= c;
    }
  }
  return { slots, remaining };
}

export function planPerson(input: PlanInput): PlanResult {
  const now = input.nowMs;
  const start = floorQuarter(now);
  const ordered = sortByUrgency(input.items, now);
  const byKey = new Map(ordered.map((i) => [i.key, i] as const));
  const pins = input.pins
    .filter((p) => byKey.has(p.itemKey) && p.endMs > p.startMs)
    .sort((a, b) => a.startMs - b.startMs || (a.itemKey < b.itemKey ? -1 : a.itemKey > b.itemKey ? 1 : 0));
  const days = freeDays({
    startMs: start,
    days: input.horizonDays ?? PLAN_HORIZON_DAYS,
    hours: input.hours,
    busy: [...input.busy, ...pins],
    fillRatio: input.fillRatio ?? FILL_RATIO,
  });

  const blocks: PlanBlock[] = pins.map((p) => blockOf(byKey.get(p.itemKey)!, p, p.kind));
  const pinnedMin = new Map<string, number>();
  for (const p of pins) pinnedMin.set(p.itemKey, (pinnedMin.get(p.itemKey) ?? 0) + (p.endMs - p.startMs) / MIN_MS);

  // QUEUE
  const queue: QueueEntry[] = [];
  for (const item of ordered) {
    const minutes = toGrid(item.sizeMin - (pinnedMin.get(item.key) ?? 0));
    if (minutes > 0) queue.push({ item, minutes, earliestMs: Math.max(start, item.earliestMs ?? start) });
  }
  // END QUEUE

  const unplaced = new Set<string>();
  for (const e of queue) {
    const { slots, remaining } = placeEntry(e, days);
    for (const s of slots) blocks.push(blockOf(e.item, s, null));
    if (remaining > 0) unplaced.add(e.item.key);
  }
  blocks.sort((a, b) => a.startMs - b.startMs || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const finishMs: Record<string, number | null> = {};
  for (const item of ordered) finishMs[item.key] = null;
  for (const b of blocks) finishMs[b.itemKey] = Math.max(finishMs[b.itemKey] ?? 0, b.endMs);
  const atRisk: AtRiskItem[] = [];
  for (const item of ordered) {
    if (unplaced.has(item.key)) finishMs[item.key] = null;
    const f = finishMs[item.key];
    if (!unplaced.has(item.key) && f != null && f <= deadlineOf(item.dueMs)) continue;
    atRisk.push({ itemKey: item.key, kind: item.kind, id: item.id, userId: item.userId, title: item.title, href: item.href, dueMs: item.dueMs, finishMs: f, label: atRiskLabel(item.dueMs, now) });
  }
  const risky = new Set(atRisk.map((a) => a.itemKey));
  for (const b of blocks) b.atRisk = risky.has(b.itemKey);

  return {
    userId: input.userId,
    nowMs: now,
    blocks,
    atRisk,
    newPins: [],
    staleKeys: [],
    futurePins: pins.filter((p) => p.startMs > now),
    finishMs,
  };
}
```

- [ ] **Step 6: Run the gates**

`npx tsc --noEmit` → PASS · `env -u DATABASE_URL npm run test:specs` → `ALL PASSED` (all `auto-cal plan:` lines) · `npx eslint --ignore-pattern scripts/test-review-and-spec.ts src/lib/task-plan/free.ts src/lib/task-plan/labels.ts src/lib/task-plan/plan.ts scripts/test-auto-calendar.ts` → clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/task-plan/free.ts src/lib/task-plan/labels.ts src/lib/task-plan/plan.ts scripts/test-auto-calendar.ts scripts/test-review-and-spec.ts
git commit -m "feat(task-plan): planPerson — free time, 80% cap, 15-min grid, 30-min chunks, At risk

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Pin lifecycle in the engine — started, in progress, unfinished, stale

**Files:**
- Create: `src/lib/task-plan/pins.ts`
- Modify: `src/lib/task-plan/plan.ts`, `scripts/test-auto-calendar.ts`, `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `planPerson`, `blockOf` (Task 4); `floorQuarter` (Task 4); `workWindow` (spec 2); `chicagoDayKey`, `addDays` (spec 1); types (Task 1).
- Produces (`pins.ts`): `PIN_MAX_MIN = 480`; `PIN_MAX_PER_PERSON = 500`; `pinBlobKey(p: { itemKey: string; startMs: number }): string`; `pinBlobValue(p): { endMs: number; kind: PinKind }`; `pinsFromBlob(raw: Record<string, unknown>): PlanPin[]`; `unfinishedRemainders({ items, pins, nowMs, hours }): Array<{ item: PlanItem; minutes: number; earliestMs: number }>`; `newPinsFrom({ blocks, items, pins, nowMs, remainderKeys }): PlanPin[]`; `stalePinKeys(pins, openKeys): string[]`; `type PinMove = { kind: PlanItemKind; id: string; fromStartMs: number | null; startMs: number; minutes: number }`; `cleanPinMove(input: unknown, nowMs): { ok: true; value: PinMove } | { ok: false; error: string }`. `planPerson` now fills `newPins` and `staleKeys` and marks newly pinned blocks `pinned: "started"`.

- [ ] **Step 1: Write the failing tests**

Add to the imports of `scripts/test-auto-calendar.ts`:

```ts
import { cleanPinMove, pinBlobKey, pinBlobValue, pinsFromBlob, type PinMove } from "@/lib/task-plan/pins";
import type { PlanPin } from "@/lib/task-plan/types";
```

(merge `PlanPin` into the `@/lib/task-plan/types` import.) Append:

```ts
/* ---- Task 5: pin lifecycle ---- */
export async function autoCalPinRuleChecks(ok: Ok): Promise<void> {
  const p: PlanPin = { itemKey: "task:T-1", startMs: at(MON, 10), endMs: at(MON, 11), kind: "hand" };
  ok(pinBlobKey(p) === `task:T-1@${at(MON, 10)}` && JSON.stringify(pinsFromBlob({ [pinBlobKey(p)]: pinBlobValue(p) })) === JSON.stringify([p]),
    "auto-cal pins: a pin is one blob key (<item>@<start>) → { endMs, kind }");
  ok(pinsFromBlob({
    "task:T-1@x": { endMs: 5, kind: "hand" },
    "lead:1@5": { endMs: 9, kind: "hand" },
    [`task:T-2@${at(MON, 10)}`]: { endMs: at(MON, 9), kind: "hand" },
    [`asg:a@${at(MON, 10)}`]: { endMs: at(MON, 11), kind: "moved" },
    [`task:T-3@${at(MON, 10)}`]: null,
  }).length === 0, "auto-cal pins: junk keys and values are ignored");

  const begun = planPerson(baseInput({ nowMs: at(MON, 10, 7), items: [item("A")] }));
  ok(begun.blocks[0].startMs === at(MON, 10) && begun.blocks[0].pinned === "started" && begun.newPins.length === 1 && begun.newPins[0].kind === "started" && begun.newPins[0].endMs === at(MON, 11),
    "auto-cal pins: a block that has begun when the plan is computed is pinned as started");
  const notYet = planPerson(baseInput({ items: [item("A")] }));
  ok(notYet.newPins.length === 0 && !notYet.blocks[0].pinned, "auto-cal pins: a block that hasn't begun stays movable");

  const pins: PlanPin[] = [
    { itemKey: "task:A", startMs: at(MON, 13), endMs: at(MON, 14), kind: "hand" },
    { itemKey: "task:B", startMs: at(MON, 8), endMs: at(MON, 9), kind: "started" },
  ];
  const before = planPerson(baseInput({ nowMs: at(MON, 8, 30), pins, items: [item("A"), item("B")] }));
  const after = planPerson(baseInput({ nowMs: at(MON, 8, 30), pins, items: [item("A"), item("B"), item("URGENT", { tier: "high", dueMs: at(MON, 17), size: "l", sizeMin: 240 })] }));
  const pinnedAt = (r: PlanResult) => r.blocks.filter((b) => b.pinned).map((b) => b.key).join();
  ok(pinnedAt(before) === pinnedAt(after) && blocksOf(after, "task:A")[0].startMs === at(MON, 13), "auto-cal pins: started and hand-pinned blocks never move when new work arrives");

  const ip = planPerson(baseInput({ items: [item("A"), item("IP", { inProgress: true })] }));
  const ipb = blocksOf(ip, "task:IP")[0];
  ok(ipb.pinned === "started" && ip.newPins.some((x) => x.itemKey === "task:IP" && x.startMs === ipb.startMs), "auto-cal pins: a task marked In progress has its current block pinned");

  const NEXT_MON = "2036-10-20";
  const fri: PlanPin[] = [{ itemKey: "task:L", startMs: at(FRI, 8), endMs: at(FRI, 10), kind: "started" }];
  const mon = planPerson(baseInput({ nowMs: at(NEXT_MON, 7, 30), pins: fri, items: [item("OD", { tier: "high", dueMs: at(FRI, 17) }), item("L", { size: "l", sizeMin: 240 })] }));
  const rem = blocksOf(mon, "task:L").filter((b) => b.startMs > at(FRI, 23));
  ok(rem.length === 1 && rem[0].startMs === at(NEXT_MON, 8) && rem[0].endMs === at(NEXT_MON, 10) && rem[0].pinned === "started" && mon.newPins.some((x) => x.startMs === at(NEXT_MON, 8)),
    "auto-cal pins: an unfinished started task's remaining time (4 h − 2 h) is pinned first thing the next work day (over the weekend)");
  const whole: PlanPin[] = [...fri, { itemKey: "task:L", startMs: at(FRI, 10), endMs: at(FRI, 14), kind: "started" }];
  const again = planPerson(baseInput({ nowMs: at(NEXT_MON, 7, 30), pins: whole, items: [item("L", { size: "l", sizeMin: 240 })] }));
  ok(blocksOf(again, "task:L").filter((b) => b.startMs > at(FRI, 23)).reduce((s, b) => s + b.endMs - b.startMs, 0) === 30 * MIN,
    "auto-cal pins: still open after its whole size → 30 more minutes pinned the next morning");
  const sameDay = planPerson(baseInput({ nowMs: at(NEXT_MON, 9), pins: [...fri, { itemKey: "task:L", startMs: at(NEXT_MON, 8), endMs: at(NEXT_MON, 10), kind: "started" }], items: [item("L", { size: "l", sizeMin: 240 })] }));
  ok(sameDay.newPins.length === 0, "auto-cal pins: the remainder is pinned once, not again the same day");

  const stale = planPerson(baseInput({ pins: [{ itemKey: "task:GONE", startMs: at(MON, 8), endMs: at(MON, 12), kind: "hand" }], items: [item("A")] }));
  ok(stale.staleKeys.join() === `task:GONE@${at(MON, 8)}` && stale.blocks[0].startMs === at(MON, 8) && !stale.blocks.some((b) => b.itemKey === "task:GONE"),
    "auto-cal pins: a done, deleted or handed-off item's pins are dropped and its time is free again");
  ok(before.futurePins.map((x) => x.itemKey).join() === "task:A", "auto-cal pins: the pins that haven't begun are what Unpin offers");

  const moved = cleanPinMove({ kind: "task", id: "T-1", startMs: at(MON, 10, 7), minutes: 60 }, at(MON, 9));
  ok(moved.ok && (moved as { ok: true; value: PinMove }).value.startMs === at(MON, 10), "auto-cal pins: a drop snaps to the 15-minute grid");
  ok(!cleanPinMove({ kind: "task", id: "T-1", startMs: at(MON, 8), minutes: 60 }, at(MON, 9)).ok &&
     !cleanPinMove({ kind: "task", id: "T-1", startMs: at(MON, 10), minutes: 20 }, at(MON, 9)).ok &&
     !cleanPinMove({ kind: "lead", id: "x", startMs: at(MON, 10), minutes: 60 }, at(MON, 9)).ok &&
     !cleanPinMove({ kind: "task", id: "T-1", startMs: at(MON, 10), minutes: 600 }, at(MON, 9)).ok,
    "auto-cal pins: a drop in the past, off the grid, over 8 h or on an unknown kind is refused");
}
```

Chain: merge `autoCalPinRuleChecks`; add `.then(() => autoCalPinRuleChecks(ok))` after `.then(() => autoCalPlacementChecks(ok))`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsc --noEmit`
Expected: FAIL — `Cannot find module '@/lib/task-plan/pins'`.

- [ ] **Step 3: Implement `src/lib/task-plan/pins.ts`**

```ts
/**
 * Pins (spec Part 2 "Pins — only unstarted work moves"). Pure, client-safe.
 * Storage shape (src/lib/stores/task-pins.ts): blob `task_pins:<userId>`,
 * one top-level key per pin `<itemKey>@<startMs>` → { endMs, kind }.
 */
import { addDays, chicagoDayKey } from "@/lib/drive-plan/day";
import { workWindow } from "@/lib/visit-plan/hours";
import type { WorkHours } from "@/lib/visit-plan/settings";
import { floorQuarter } from "./free";
import {
  GRID_MIN,
  MIN_CHUNK_MIN,
  PLAN_HORIZON_DAYS,
  QUARTER_MS,
  parsePlanItemKey,
  parsePlanRef,
  type PinKind,
  type PlanBlock,
  type PlanItem,
  type PlanItemKind,
  type PlanPin,
} from "./types";

export const PIN_MAX_MIN = 8 * 60;
export const PIN_MAX_PER_PERSON = 500;
const DAY_MS = 86_400_000;

export function pinBlobKey(p: { itemKey: string; startMs: number }): string {
  return `${p.itemKey}@${p.startMs}`;
}
export function pinBlobValue(p: PlanPin): { endMs: number; kind: PinKind } {
  return { endMs: p.endMs, kind: p.kind };
}

export function pinsFromBlob(raw: Record<string, unknown>): PlanPin[] {
  const out: PlanPin[] = [];
  for (const [k, v] of Object.entries(raw || {})) {
    const at = k.lastIndexOf("@");
    if (at <= 0) continue;
    const itemKey = k.slice(0, at);
    const startMs = Number(k.slice(at + 1));
    if (!parsePlanItemKey(itemKey) || !Number.isInteger(startMs)) continue;
    const o = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
    const endMs = o && typeof o.endMs === "number" ? o.endMs : NaN;
    const kind = o?.kind === "started" || o?.kind === "hand" ? o.kind : null;
    if (!kind || !Number.isFinite(endMs) || endMs <= startMs || endMs - startMs > DAY_MS) continue;
    out.push({ itemKey, startMs, endMs, kind });
  }
  return out.sort((a, b) => a.startMs - b.startMs || (a.itemKey < b.itemKey ? -1 : a.itemKey > b.itemKey ? 1 : 0));
}

/** Spec "Unfinished": an open item whose pins all ended on a day before
 *  today gets its remaining time (size − pinned so far, at least 30 min)
 *  pinned first thing on the next work day. */
export function unfinishedRemainders(args: {
  items: readonly PlanItem[];
  pins: readonly PlanPin[];
  nowMs: number;
  hours: WorkHours;
}): Array<{ item: PlanItem; minutes: number; earliestMs: number }> {
  const today = chicagoDayKey(args.nowMs);
  const out: Array<{ item: PlanItem; minutes: number; earliestMs: number }> = [];
  for (const item of args.items) {
    const ps = args.pins.filter((p) => p.itemKey === item.key);
    if (!ps.length || ps.some((p) => p.endMs > args.nowMs)) continue;
    const lastDay = chicagoDayKey(Math.max(...ps.map((p) => p.endMs)) - 1);
    if (lastDay >= today) continue;
    const pinned = ps.reduce((s, p) => s + (p.endMs - p.startMs) / 60_000, 0);
    const minutes = Math.max(MIN_CHUNK_MIN, Math.ceil(Math.max(0, item.sizeMin - pinned) / GRID_MIN) * GRID_MIN);
    let k = addDays(lastDay, 1);
    if (k < today) k = today;
    let win = workWindow(k, args.hours);
    for (let i = 0; i < 14 && !win; i++) {
      k = addDays(k, 1);
      win = workWindow(k, args.hours);
    }
    if (win) out.push({ item, minutes, earliestMs: win.startMs });
  }
  return out.sort((a, b) => a.earliestMs - b.earliestMs || (a.item.key < b.item.key ? -1 : 1));
}

/** Pins this compute must persist: blocks that have begun, placed
 *  remainders, and the current block of each In-progress item with no live pin. */
export function newPinsFrom(args: {
  blocks: readonly PlanBlock[];
  items: readonly PlanItem[];
  pins: readonly PlanPin[];
  nowMs: number;
  remainderKeys: ReadonlySet<string>;
}): PlanPin[] {
  const persisted = new Set(args.pins.map(pinBlobKey));
  const out = new Map<string, PlanPin>();
  const add = (b: PlanBlock) => {
    const p: PlanPin = { itemKey: b.itemKey, startMs: b.startMs, endMs: b.endMs, kind: "started" };
    out.set(pinBlobKey(p), p);
  };
  const unpinned = args.blocks.filter((b) => !persisted.has(b.key));
  for (const b of unpinned) if (b.startMs <= args.nowMs || args.remainderKeys.has(b.itemKey)) add(b);
  const live = new Set(args.pins.filter((p) => p.endMs > args.nowMs).map((p) => p.itemKey));
  for (const item of args.items) {
    if (!item.inProgress || live.has(item.key)) continue;
    const first = unpinned.filter((b) => b.itemKey === item.key).sort((a, b) => a.startMs - b.startMs)[0];
    if (first) add(first);
  }
  return [...out.values()].sort((a, b) => a.startMs - b.startMs || (a.itemKey < b.itemKey ? -1 : 1));
}

/** Blob keys of pins whose item is no longer this person's open work. */
export function stalePinKeys(pins: readonly PlanPin[], openKeys: ReadonlySet<string>): string[] {
  return pins.filter((p) => !openKeys.has(p.itemKey)).map(pinBlobKey);
}

export type PinMove = { kind: PlanItemKind; id: string; fromStartMs: number | null; startMs: number; minutes: number };

/** A drag drop from the client (untrusted). */
export function cleanPinMove(input: unknown, nowMs: number): { ok: true; value: PinMove } | { ok: false; error: string } {
  const o = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const ref = parsePlanRef(o.kind, o.id);
  if (!ref) return { ok: false, error: "Unknown task." };
  const raw = Number(o.startMs);
  if (!Number.isFinite(raw)) return { ok: false, error: "Pick a time." };
  const startMs = Math.round(raw / QUARTER_MS) * QUARTER_MS;
  const minutes = Number(o.minutes);
  if (!Number.isInteger(minutes) || minutes < GRID_MIN || minutes > PIN_MAX_MIN || minutes % GRID_MIN !== 0)
    return { ok: false, error: "A block is 15 minutes to 8 hours." };
  if (startMs < floorQuarter(nowMs)) return { ok: false, error: "Pick a time from now on." };
  if (startMs > nowMs + PLAN_HORIZON_DAYS * DAY_MS) return { ok: false, error: "Pick a time in the next 8 weeks." };
  const fromRaw = o.fromStartMs;
  const fromStartMs = fromRaw == null || fromRaw === "" ? null : Number(fromRaw);
  if (fromStartMs != null && !Number.isFinite(fromStartMs)) return { ok: false, error: "Unknown block." };
  return { ok: true, value: { ...ref, fromStartMs, startMs, minutes } };
}
```

- [ ] **Step 4: Wire the lifecycle into `src/lib/task-plan/plan.ts`**

Add to the imports:

```ts
import { newPinsFrom, stalePinKeys, unfinishedRemainders } from "./pins";
```

Replace everything from the line `  // QUEUE` through the line `  // END QUEUE` with:

```ts
  // Unfinished started work goes first and is pinned where it lands (spec "Unfinished").
  const remainders = unfinishedRemainders({ items: ordered, pins, nowMs: now, hours: input.hours });
  const remainderKeys = new Set(remainders.map((r) => r.item.key));
  const queue: QueueEntry[] = remainders.map((r) => ({ item: r.item, minutes: r.minutes, earliestMs: Math.max(start, r.earliestMs) }));
  for (const item of ordered) {
    if (remainderKeys.has(item.key)) continue;
    const minutes = toGrid(item.sizeMin - (pinnedMin.get(item.key) ?? 0));
    if (minutes > 0) queue.push({ item, minutes, earliestMs: Math.max(start, item.earliestMs ?? start) });
  }
```

Immediately before the final `return {`, add:

```ts
  const newPins = newPinsFrom({ blocks, items: ordered, pins, nowMs: now, remainderKeys });
  const fresh = new Set(newPins.map((p) => `${p.itemKey}@${p.startMs}`));
  for (const b of blocks) if (!b.pinned && fresh.has(b.key)) b.pinned = "started";
```

and in the returned object replace `newPins: [],` with `newPins,` and `staleKeys: [],` with `staleKeys: stalePinKeys(input.pins, new Set(byKey.keys())),`.

- [ ] **Step 5: Run the gates**

`npx tsc --noEmit` → PASS · `env -u DATABASE_URL npm run test:specs` → `ALL PASSED` (Task 4's `auto-cal plan:` lines still pass — their `now` is 7:00, before work) · `npx eslint --ignore-pattern scripts/test-review-and-spec.ts src/lib/task-plan/pins.ts src/lib/task-plan/plan.ts scripts/test-auto-calendar.ts` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/task-plan/pins.ts src/lib/task-plan/plan.ts scripts/test-auto-calendar.ts scripts/test-review-and-spec.ts
git commit -m "feat(task-plan): pin lifecycle — started, in progress, unfinished remainder, stale

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Pin store + clearing on done, delete and hand-off

**Files:**
- Create: `src/lib/stores/task-pins.ts`
- Modify: `src/lib/stores/tasks.ts`, `src/lib/stores/assignments.ts`, `src/lib/stores/schedule-prefs.ts` (header comment only), `scripts/test-auto-calendar.ts`, `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `getBlob`, `setBlob` (`@/db/doc-store`); `blobs` (`@/db/doc-tables`); `getDb`; `pinBlobKey`, `pinBlobValue`, `pinsFromBlob` (Task 5); `planItemKey` (Task 1); `activeUsers`, `sameName`.
- Produces (`task-pins.ts`): `pinsBlobId(userId): string`; `getPins(userId): Promise<PlanPin[]>`; `addPins(userId, pins): Promise<void>`; `removePinKeys(userId, keys): Promise<void>`; `clearItemPins(userId | null | undefined, itemKey): Promise<number>`; `clearPlanPinsFor(kind, id, userId | null | undefined): Promise<void>` (never throws); `userIdForName(name): Promise<string | null>`. Store behaviour: `setTaskStatus(…, "done")`, `removeTask`, and an assignee change in `updateTask` clear that task's pins from the (old) assignee; `setAssignmentDone(…, true)`, `removeAssignment`, and an assignee change in `updateAssignment` do the same for assignments.

- [ ] **Step 1: Write the failing tests**

Add to the imports of `scripts/test-auto-calendar.ts`:

```ts
import { like } from "drizzle-orm";
import { getDb } from "@/db";
import { blobs } from "@/db/schema";
import { activeUsers } from "@/lib/users";
import { removeTask, setTaskStatus } from "@/lib/stores/tasks";
import { setAssignmentDone } from "@/lib/stores/assignments";
import { addPins, clearItemPins, getPins, removePinKeys } from "@/lib/stores/task-pins";
import { floorQuarter } from "@/lib/task-plan/free";
import type { PinKind } from "@/lib/task-plan/types";
```

(merge into existing import lines.) Append:

```ts
/* ---- Task 6: pin store ---- */
export async function autoCalPinStoreChecks(ok: Ok): Promise<void> {
  const db = await getDb();
  const U = "TESTautocal:pins-u1";
  const U2 = "TESTautocal:pins-u2";
  const t0 = floorQuarter(Date.now() + 86_400_000);
  const pin = (itemKey: string, h: number, kind: PinKind = "hand"): PlanPin => ({ itemKey, startMs: t0 + h * 3_600_000, endMs: t0 + (h + 1) * 3_600_000, kind });
  try {
    await Promise.all([addPins(U, [pin("task:A", 0)]), addPins(U, [pin("task:B", 2)])]);
    ok((await getPins(U)).length === 2, "auto-cal pin store: two pins added at once are both kept (one blob key each)");
    await removePinKeys(U, [pinBlobKey(pin("task:A", 0))]);
    ok((await getPins(U)).map((p) => p.itemKey).join() === "task:B", "auto-cal pin store: removing one pin leaves the rest");
    ok((await clearItemPins(U, "task:B")) === 1 && (await getPins(U)).length === 0, "auto-cal pin store: clearing an item removes its pins");

    const me = { id: U, name: "Auto Cal" };
    const T = fixtureId("autocal", "pins-done");
    const T2 = fixtureId("autocal", "pins-keep");
    const T3 = fixtureId("autocal", "pins-handoff");
    const T4 = fixtureId("autocal", "pins-delete");
    for (const id of [T, T2, T3, T4]) {
      await createTask({ id, title: id, assigneeUserId: U, assigneeName: "Auto Cal" }, me);
      registerFixture("tasks", id);
    }
    await addPins(U, [pin(planItemKey("task", T), 0), pin(planItemKey("task", T2), 1), pin(planItemKey("task", T3), 2), pin(planItemKey("task", T4), 3)]);
    const has = async (uid: string, id: string) => (await getPins(uid)).some((x) => x.itemKey === planItemKey("task", id));
    await setTaskStatus(T, "done");
    ok(!(await has(U, T)) && (await has(U, T2)), "auto-cal pin store: Done clears that task's pins, nobody else's");
    await updateTask(T3, { assigneeUserId: U2, assigneeName: "Other" });
    ok(!(await has(U, T3)), "auto-cal pin store: handing a task off clears its pins from the old calendar");
    await removeTask(T4);
    ok(!(await has(U, T4)), "auto-cal pin store: deleting a task clears its pins");
    await setTaskStatus(T2, "in_progress");
    ok(await has(U, T2), "auto-cal pin store: In progress keeps its pins");

    const roster = await activeUsers();
    if (roster.length) {
      const who = roster[0];
      const a = await createAssignment({ title: "pins asg", assignee: who.name, createdBy: "Auto Cal" });
      registerFixture("assignments", a.id);
      const k = planItemKey("assignment", a.id);
      await addPins(who.id, [pin(k, 4)]);
      await setAssignmentDone(a.id, true, "app");
      ok(!(await getPins(who.id)).some((x) => x.itemKey === k), "auto-cal pin store: a completed assignment's pins are cleared (also when Google Tasks completes it)");
      await removePinKeys(who.id, [pinBlobKey(pin(k, 4))]);
    }
  } finally {
    await db.delete(blobs).where(like(blobs.id, "task_pins:TESTautocal:%"));
  }
}
```

Chain: merge `autoCalPinStoreChecks`; add `.then(() => autoCalPinStoreChecks(ok))` after `.then(() => autoCalPinRuleChecks(ok))`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsc --noEmit`
Expected: FAIL — `Cannot find module '@/lib/stores/task-pins'`.

- [ ] **Step 3: Implement `src/lib/stores/task-pins.ts`**

```ts
/**
 * Task-plan pins (spec 2026-10-09 auto task calendar, Part 2 "Pins") — the
 * only thing the scheduler stores. The schedule-prefs.ts blob idiom: one blob
 * per person, `task_pins:<userId>`, ONE TOP-LEVEL KEY PER PIN
 * (`<itemKey>@<startMs>` → { endMs, kind }), so setBlob's atomic merge never
 * loses a concurrent add and a remove is one `data - key` statement. Pins sit
 * on the person's calendar, not on the record, so a hand-off leaves them
 * behind (and they are cleared). No table, no migration; blobs survive the
 * go-live demo wipe.
 */
import { eq, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { getBlob, setBlob } from "@/db/doc-store";
import { blobs } from "@/db/doc-tables";
import { sameName } from "@/lib/quote-approval-rules";
import { pinBlobKey, pinBlobValue, pinsFromBlob } from "@/lib/task-plan/pins";
import { planItemKey, type PlanItemKind, type PlanPin } from "@/lib/task-plan/types";
import { activeUsers } from "@/lib/users";

export const pinsBlobId = (userId: string) => `task_pins:${userId}`;

export async function getPins(userId: string): Promise<PlanPin[]> {
  if (!userId) return [];
  return pinsFromBlob(await getBlob<Record<string, unknown>>(pinsBlobId(userId), {}));
}

export async function addPins(userId: string, pins: readonly PlanPin[]): Promise<void> {
  if (!userId || !pins.length) return;
  const patch: Record<string, unknown> = {};
  for (const p of pins) patch[pinBlobKey(p)] = pinBlobValue(p);
  await setBlob(pinsBlobId(userId), patch);
}

export async function removePinKeys(userId: string, keys: readonly string[]): Promise<void> {
  const list = [...new Set(keys.filter((k) => typeof k === "string" && k))];
  if (!userId || !list.length) return;
  let expr: SQL = sql`${blobs.data}`;
  for (const k of list) expr = sql`(${expr}) - ${k}::text`;
  const db = await getDb();
  await db.update(blobs).set({ data: expr, updatedAt: Date.now() }).where(eq(blobs.id, pinsBlobId(userId)));
}

export async function clearItemPins(userId: string | null | undefined, itemKey: string): Promise<number> {
  if (!userId) return 0;
  const keys = (await getPins(userId)).filter((p) => p.itemKey === itemKey).map(pinBlobKey);
  await removePinKeys(userId, keys);
  return keys.length;
}

/** Done / deleted / handed off (spec "Done or deleted → its future pins are
 *  cleared"). Never throws: the record change has already landed, and a
 *  missed clear is swept as stale by the next plan compute. */
export async function clearPlanPinsFor(kind: PlanItemKind, id: string, userId: string | null | undefined): Promise<void> {
  try {
    await clearItemPins(userId, planItemKey(kind, id));
  } catch (err) {
    console.error("[task-plan] pin clear failed:", kind, id, err);
  }
}

/** Assignments carry a name; pins are keyed by user id. */
export async function userIdForName(name: string): Promise<string | null> {
  if (!name) return null;
  return (await activeUsers()).find((u) => sameName(u.name, name))?.id ?? null;
}
```

- [ ] **Step 4: Clear pins in `src/lib/stores/tasks.ts`**

Add `import { clearPlanPinsFor } from "@/lib/stores/task-pins";` and replace `setTaskStatus`, `updateTask` and `removeTask` with:

```ts
export async function setTaskStatus(id: string, status: TaskStatus): Promise<TaskRecord | null> {
  if (!(STATUSES as readonly string[]).includes(status)) return null;
  const t = await patchDoc<TaskRecord>("tasks", id, (t) => {
    t.status = status;
    t.doneAt = status === "done" ? now() : null;
    t.updatedAt = now();
    return t;
  });
  if (t && status === "done") await clearPlanPinsFor("task", t.id, t.assigneeUserId);
  return t;
}

export async function updateTask(
  id: string,
  patch: Partial<Pick<TaskRecord, "title" | "section" | "assigneeUserId" | "assigneeName" | "dueAt" | "notes" | "priority" | "size">>,
): Promise<TaskRecord | null> {
  const prev = { assignee: null as string | null };
  const t = await patchDoc<TaskRecord>("tasks", id, (t) => {
    prev.assignee = t.assigneeUserId ?? null;
    Object.assign(t, patch);
    t.updatedAt = now();
    return t;
  });
  if (t && "assigneeUserId" in patch && prev.assignee && prev.assignee !== (t.assigneeUserId ?? null)) {
    await clearPlanPinsFor("task", id, prev.assignee);
  }
  return t;
}

export async function removeTask(id: string): Promise<void> {
  const t = await getDoc<TaskRecord>("tasks", id);
  await softDeleteDoc("tasks", id);
  if (t) await clearPlanPinsFor("task", id, t.assigneeUserId);
}
```

- [ ] **Step 5: Clear pins in `src/lib/stores/assignments.ts`**

Add `import { clearPlanPinsFor, userIdForName } from "@/lib/stores/task-pins";` and replace `setAssignmentDone`, `updateAssignment` and `removeAssignment` with:

```ts
export async function setAssignmentDone(
  id: string,
  done: boolean,
  via: "app" | "reminders" | "google-tasks" = "app"
): Promise<void> {
  const rec = await patchDoc<Assignment>("assignments", id, (d) => {
    d.done = done;
    d.doneAt = done ? Date.now() : null;
    d.doneVia = done ? via : null;
  });
  if (rec && done) await clearPlanPinsFor("assignment", id, await userIdForName(rec.assignee));
}

export async function updateAssignment(
  id: string,
  patch: Partial<Pick<Assignment, "title" | "assignee" | "dueDate" | "link" | "priority" | "size">>
): Promise<void> {
  const prev = { assignee: "" };
  const rec = await patchDoc<Assignment>("assignments", id, (d) => {
    prev.assignee = d.assignee || "";
    Object.assign(d, patch);
  });
  if (rec && "assignee" in patch && prev.assignee && prev.assignee !== rec.assignee) {
    await clearPlanPinsFor("assignment", id, await userIdForName(prev.assignee));
  }
}

export async function removeAssignment(id: string): Promise<void> {
  const rec = await getDoc<Assignment>("assignments", id);
  await softDeleteDoc("assignments", id);
  if (rec) await clearPlanPinsFor("assignment", id, await userIdForName(rec.assignee));
}
```

(`patchDoc` returns `Promise<T | null>` — the patched doc, or `null` when the id doesn't exist — whatever the mutator returns.)

- [ ] **Step 6: Document the blob in `src/lib/stores/schedule-prefs.ts`**

In the header comment's blob list, add the line:

```
 *   task_pins:<userId>           { "<itemKey>@<startMs>": { endMs, kind } }  spec 3 (src/lib/stores/task-pins.ts)
```

- [ ] **Step 7: Run the gates**

`npx tsc --noEmit` → PASS · `env -u DATABASE_URL npm run test:specs` → `ALL PASSED` · `npx eslint --ignore-pattern scripts/test-review-and-spec.ts src/lib/stores/task-pins.ts src/lib/stores/tasks.ts src/lib/stores/assignments.ts src/lib/stores/schedule-prefs.ts scripts/test-auto-calendar.ts` → clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib/stores/task-pins.ts src/lib/stores/tasks.ts src/lib/stores/assignments.ts src/lib/stores/schedule-prefs.ts scripts/test-auto-calendar.ts scripts/test-review-and-spec.ts
git commit -m "feat(task-plan): per-person pin blob; done, delete and hand-off clear pins

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Server loader + the morning-triage at-risk hook

**Files:**
- Create: `src/lib/task-plan/items.ts`, `src/lib/task-plan/load.ts`, `src/lib/task-plan/triage.ts`
- Modify: `src/lib/triage/hooks.ts`, `scripts/test-drive-time.ts` (one pin), `scripts/test-auto-calendar.ts`, `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `planPerson` (Tasks 4–5); `effectiveDue` (Task 2); `isPlannedTask`, `personForTask`, `personForAssignment` (Task 2); `getPins`, `addPins`, `removePinKeys` (Task 6); `calendarNote` (Task 4); `taskHref` (`calendar-tasks.ts`); spec 2 `busyBlocks`, `toBusyVisit`, `workHoursFor`, `readCalendarForBooking`, `CalendarRead`; spec 1 `planDriveDays`, `DriveDayPlan`; `TriageUser`, `TriageHooks`.
- Produces:
  - `items.ts`: `planItemsByPerson(tasks, assignments, roster): Map<string, PlanItem[]>`.
  - `load.ts`: `PLAN_CALENDAR_TIMEOUT_MS = 6000`; `type PersonPlan = { userId; name; calendar: CalendarRead; note: string | null; result: PlanResult }`; `type TaskPlanDeps = { now; roster; tasks; assignments; visits; workHours; pins; readEvents; drive; calendarTimeoutMs }`; `withTimeout<T>(p, ms, fallback): Promise<T>`; `loadTaskPlans({ userIds: readonly string[] | "everyone"; meId?: string; deps? }): Promise<PersonPlan[]>` (viewer first, then by name); `type PinStore = { add(userId, pins): Promise<void>; remove(userId, keys): Promise<void> }`; `savePlanPins(plans, store?): Promise<void>` (never throws).
  - `triage.ts`: `taskPlanAtRisk(me: TriageUser, now: number, opts?: { deps?: Partial<TaskPlanDeps>; store?: PinStore }): Promise<ReadonlySet<string>>`.
  - `TRIAGE_HOOKS.atRisk === taskPlanAtRisk`.

- [ ] **Step 1: Write the failing tests**

Add to the imports of `scripts/test-auto-calendar.ts`:

```ts
import type { CalendarEvent } from "@/lib/google/calendar";
import type { DriveLeg } from "@/lib/drive-plan/plan";
import type { SiteVisit } from "@/lib/stores/site-visits";
import { TRIAGE_HOOKS } from "@/lib/triage/hooks";
import { planItemsByPerson } from "@/lib/task-plan/items";
import { loadTaskPlans, savePlanPins, type TaskPlanDeps } from "@/lib/task-plan/load";
import { taskPlanAtRisk } from "@/lib/task-plan/triage";
```

Append:

```ts
/* ---- Task 7: loader + triage hook ---- */
export async function autoCalLoaderChecks(ok: Ok): Promise<void> {
  const roster = [{ id: "u1", name: "Dana" }, { id: "u2", name: "Sam" }, { id: "u3", name: "Lee" }];
  const tk = (id: string, over: Partial<TaskRecord> = {}) => normalizeTask({ id, title: id, assigneeUserId: "u1", assigneeName: "Dana", dueAt: at(FRI, 17), createdAt: 1, ...over });
  const asg = (id: string, over: Partial<Assignment> = {}): Assignment => ({ id, title: id, assignee: "Dana", createdBy: "x", createdAt: 1, dueDate: at(FRI, 17), link: null, done: false, doneAt: null, doneVia: null, source: "", ...over });
  const tasks = [
    tk("T-open"), tk("T-ip", { status: "in_progress" }), tk("T-blocked", { status: "blocked" }), tk("T-done", { status: "done" }),
    tk("T-none", { assigneeUserId: null, assigneeName: "" }), tk("T-legacy", { assigneeUserId: null, assigneeName: "sam" }),
    tk("T-auto-p1-x", { coverageKey: "P-1:installation:x", startAt: at(WED, 0) }), tk("T-undated", { dueAt: null, createdAt: at(MON, 9) }),
  ];
  const asgs = [asg("as-1"), asg("as-done", { done: true }), asg("as-lee", { assignee: "LEE" }), asg("as-noone", { assignee: "" })];
  const by = planItemsByPerson(tasks, asgs, roster);
  const keys = (u: string) => (by.get(u) ?? []).map((i) => i.key).sort().join();
  ok(keys("u1") === ["asg:as-1", "task:T-auto-p1-x", "task:T-ip", "task:T-open", "task:T-undated"].sort().join(),
    "auto-cal items: every open task and Queue assignment with an assignee — checklist/template tasks too; blocked, done and unassigned wait");
  ok(keys("u2") === "task:T-legacy" && keys("u3") === "asg:as-lee", "auto-cal items: a name-only assignee resolves through the roster (case-insensitive)");
  const u1 = by.get("u1")!;
  ok(u1.find((i) => i.id === "T-auto-p1-x")?.earliestMs === at(WED, 0) && u1.find((i) => i.id === "T-ip")?.inProgress === true && u1.find((i) => i.id === "T-undated")?.dueVirtual === true,
    "auto-cal items: a template start, In progress and a virtual due date carry into the plan");

  const visit = { id: "SV-1", assignedTo: "Dana", attendees: [], invites: [], venue: "Lone Pine", customer: "LP", stage: "scheduled", startAt: at(MON, 10), endAt: at(MON, 11), googleEventId: null, address: "", customerId: null, locationId: null } as unknown as SiteVisit;
  const gev = (id: string, s: number, e: number, over: Partial<CalendarEvent> = {}): CalendarEvent => ({ id, iCalUID: id + "@google.com", title: id, startMs: s, endMs: e, allDay: false, location: "", htmlLink: "", meetingUrl: "", selfDeclined: false, selfResponse: "", peakDriveKey: "", peakDriveDay: "", ...over });
  const events = [gev("accepted", at(MON, 13), at(MON, 14), { selfResponse: "accepted" }), gev("tentative", at(MON, 14), at(MON, 15), { selfResponse: "tentative" }), gev("allday", at(MON, 0), at(TUE, 0), { allDay: true })];
  const leg = { startMs: at(MON, 9, 30), endMs: at(MON, 10), flag: null } as unknown as DriveLeg;
  const deps = (over: Partial<TaskPlanDeps> = {}): Partial<TaskPlanDeps> => ({
    now: () => at(MON, 8),
    roster: async () => roster,
    tasks: async () => [],
    assignments: async () => [],
    visits: async () => [visit],
    workHours: async () => DEFAULT_WORK_HOURS,
    pins: async () => [],
    readEvents: async () => ({ status: "ok", events }),
    drive: async () => [{ dayKey: MON, stops: [], legs: [leg], totalMin: 30 }],
    calendarTimeoutMs: 200,
    ...over,
  });
  const many = Array.from({ length: 8 }, (_, i) => tk("M" + i, { createdAt: i }));
  const [plan] = await loadTaskPlans({ userIds: ["u1"], meId: "u1", deps: deps({ tasks: async () => many }) });
  const mon = plan.result.blocks.filter((b) => chicagoDayKey(b.startMs) === MON);
  const hits = (s: number, e: number) => mon.some((b) => b.startMs < e && b.endMs > s);
  ok(plan.calendar === "ok" && plan.note === null, "auto-cal loader: a readable calendar plans with no note");
  ok(!hits(at(MON, 10), at(MON, 11)) && !hits(at(MON, 9, 30), at(MON, 10)) && !hits(at(MON, 13), at(MON, 14)),
    "auto-cal loader: free time excludes the visit, its drive block and accepted timed events");
  ok(hits(at(MON, 14), at(MON, 15)), "auto-cal loader: a tentative event isn't busy and an all-day event is ignored");
  const [failed] = await loadTaskPlans({ userIds: ["u1"], meId: "u1", deps: deps({ tasks: async () => many, readEvents: async () => ({ status: "failed", events: [] }) }) });
  ok(failed.calendar === "failed" && failed.note === "Planned without your Google calendar — may overlap meetings" && failed.result.blocks.length > 0,
    "auto-cal loader: an unreadable Google calendar still plans, with the note");
  const [slow] = await loadTaskPlans({ userIds: ["u1"], meId: "u1", deps: deps({ tasks: async () => many, readEvents: () => new Promise(() => {}) }) });
  ok(slow.calendar === "failed" && slow.result.blocks.length > 0, "auto-cal loader: a calendar read that hangs times out and plans without it");
  const everyone = await loadTaskPlans({
    userIds: "everyone",
    meId: "u2",
    deps: deps({ tasks: async () => tasks, assignments: async () => asgs, readEvents: async (uid) => (uid === "u3" ? { status: "no-calendar", events: [] } : { status: "ok", events: [] }) }),
  });
  ok(everyone.map((p) => p.userId).join() === "u2,u1,u3", "auto-cal loader: Everyone plans each person with work — viewer first, then by name");
  ok(everyone.find((p) => p.userId === "u3")?.note === "Planned without Lee's Google calendar — may overlap meetings", "auto-cal loader: another person's note names them");

  const added: string[] = [];
  const removed: string[] = [];
  await savePlanPins(
    [{ userId: "u9", name: "X", calendar: "ok", note: null, result: { ...plan.result, newPins: [{ itemKey: "task:A", startMs: 1, endMs: 2, kind: "started" }], staleKeys: ["task:B@5"] } }],
    { add: async (u, ps) => { added.push(`${u}:${ps.length}`); }, remove: async (u, ks) => { removed.push(`${u}:${ks.join()}`); } }
  );
  ok(added.join() === "u9:1" && removed.join() === "u9:task:B@5", "auto-cal loader: computing a plan persists its new started pins and drops stale ones");

  const noStore = { add: async () => {}, remove: async () => {} };
  const risky = Array.from({ length: 3 }, (_, i) => tk("R" + i, { size: "l", dueAt: at(MON, 17), createdAt: i }));
  const me = { id: "u1", name: "Dana", canApprove: false };
  const set = await taskPlanAtRisk(me, at(MON, 8), { deps: deps({ tasks: async () => risky }), store: noStore });
  ok(set.has("task:R2") && !set.has("task:R0"), "auto-cal triage: the planner's At risk keys feed morning triage");
  const boom = await taskPlanAtRisk(me, at(MON, 8), { deps: deps({ tasks: async () => { throw new Error("x"); } }), store: noStore });
  ok(boom.size === 0, "auto-cal triage: a planner failure never hides the tasks feed");
  ok(TRIAGE_HOOKS.atRisk === taskPlanAtRisk, "auto-cal triage: the app's triage hooks run the planner's at-risk provider");
  const planSrc = ["items.ts", "load.ts", "plan.ts", "pins.ts", "triage.ts"].map((f) => readFileSync(`src/lib/task-plan/${f}`, "utf8")).join("\n").replace(/import type[^;]+;/g, "");
  ok(!/from "@\/lib\/google\/calendar"/.test(planSrc), "auto-cal google: the planner never writes to (or even value-imports) Google Calendar — task blocks are app-only");
}
```

Chain: merge `autoCalLoaderChecks`; add `.then(() => autoCalLoaderChecks(ok))` after `.then(() => autoCalPinStoreChecks(ok))`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsc --noEmit`
Expected: FAIL — `Cannot find module '@/lib/task-plan/items'` (and `load`, `triage`).

- [ ] **Step 3: Implement `src/lib/task-plan/items.ts`**

```ts
/** What is scheduled (spec Part 1): every open task and Queue assignment with
 *  an assignee, checklist and template tasks included. Pure, client-safe. */
import { taskHref } from "@/lib/calendar-tasks";
import type { Assignment } from "@/lib/stores/assignments";
import type { TaskRecord } from "@/lib/stores/tasks";
import { effectiveDue } from "./due";
import { isPlannedTask, personForAssignment, personForTask, type RosterPerson } from "./people";
import { cleanSize, cleanTier, DEFAULT_SIZE, DEFAULT_TIER, planItemKey, SIZE_MIN, type PlanItem } from "./types";

export function planItemsByPerson(
  tasks: readonly TaskRecord[],
  assignments: readonly Assignment[],
  roster: readonly RosterPerson[]
): Map<string, PlanItem[]> {
  const out = new Map<string, PlanItem[]>();
  const push = (uid: string, it: PlanItem) => {
    const list = out.get(uid);
    if (list) list.push(it);
    else out.set(uid, [it]);
  };
  for (const t of tasks) {
    if (!isPlannedTask(t)) continue;
    const p = personForTask(t, roster);
    if (!p) continue;
    const due = effectiveDue(t.dueAt, t.createdAt);
    const size = cleanSize(t.size) ?? DEFAULT_SIZE;
    push(p.id, {
      key: planItemKey("task", t.id),
      kind: "task",
      id: t.id,
      userId: p.id,
      title: t.title,
      href: taskHref(t),
      tier: cleanTier(t.priority) ?? DEFAULT_TIER,
      size,
      sizeMin: SIZE_MIN[size],
      dueMs: due.dueMs,
      dueVirtual: due.virtual,
      earliestMs: typeof t.startAt === "number" && t.startAt > 0 ? t.startAt : null,
      createdAt: t.createdAt || 0,
      inProgress: t.status === "in_progress",
    });
  }
  for (const a of assignments) {
    if (a.done) continue;
    const p = personForAssignment(a, roster);
    if (!p) continue;
    const due = effectiveDue(a.dueDate, a.createdAt);
    const size = cleanSize(a.size) ?? DEFAULT_SIZE;
    push(p.id, {
      key: planItemKey("assignment", a.id),
      kind: "assignment",
      id: a.id,
      userId: p.id,
      title: a.title,
      href: `/queue?who=${encodeURIComponent(a.assignee)}`,
      tier: cleanTier(a.priority) ?? DEFAULT_TIER,
      size,
      sizeMin: SIZE_MIN[size],
      dueMs: due.dueMs,
      dueVirtual: due.virtual,
      earliestMs: null,
      createdAt: a.createdAt || 0,
      inProgress: false,
    });
  }
  return out;
}
```

- [ ] **Step 4: Implement `src/lib/task-plan/load.ts`**

```ts
/**
 * Task-plan loader (spec Part 2 "Free time"): builds planPerson input per
 * person and runs it. Read-only — new pins come back in each result and are
 * written by savePlanPins (pages: after the response; cron: inline). Google
 * is read ONCE per person over the 8-week horizon (spec 2's
 * readCalendarForBooking, bounded by a timeout); drive blocks come from spec
 * 1's planner in "cache" mode — no geocoding or OSRM on a view.
 */
import { addDays, chicagoDayKey } from "@/lib/drive-plan/day";
import { planDriveDays, type DriveDayPlan } from "@/lib/drive-plan/load";
import type { CalendarEvent } from "@/lib/google/calendar";
import { allAssignments, type Assignment } from "@/lib/stores/assignments";
import { workHoursFor } from "@/lib/stores/schedule-prefs";
import { allVisits, type SiteVisit } from "@/lib/stores/site-visits";
import { addPins, getPins, removePinKeys } from "@/lib/stores/task-pins";
import { allTasks, type TaskRecord } from "@/lib/stores/tasks";
import { activeUsers } from "@/lib/users";
import { busyBlocks, toBusyVisit } from "@/lib/visit-plan/busy";
import type { CalendarRead } from "@/lib/visit-plan/check";
import { readCalendarForBooking } from "@/lib/visit-plan/load";
import type { WorkHours } from "@/lib/visit-plan/settings";
import { floorQuarter } from "./free";
import { planItemsByPerson } from "./items";
import { calendarNote } from "./labels";
import type { RosterPerson } from "./people";
import { planPerson } from "./plan";
import { PLAN_HORIZON_DAYS, type BusyInterval, type PlanPin, type PlanResult } from "./types";

export const PLAN_CALENDAR_TIMEOUT_MS = 6_000;
const DAY_MS = 86_400_000;

export type PersonPlan = { userId: string; name: string; calendar: CalendarRead; note: string | null; result: PlanResult };

export type TaskPlanDeps = {
  now(): number;
  roster(): Promise<RosterPerson[]>;
  tasks(): Promise<TaskRecord[]>;
  assignments(): Promise<Assignment[]>;
  visits(): Promise<SiteVisit[]>;
  workHours(userId: string): Promise<WorkHours>;
  pins(userId: string): Promise<PlanPin[]>;
  readEvents(userId: string, range: { timeMinMs: number; timeMaxMs: number }): Promise<{ status: CalendarRead; events: CalendarEvent[] }>;
  drive(args: { userId: string; dayKeys: string[]; events: CalendarEvent[] | null; visits: () => Promise<SiteVisit[]> }): Promise<DriveDayPlan[]>;
  calendarTimeoutMs: number;
};

function defaultDeps(): TaskPlanDeps {
  return {
    now: Date.now,
    roster: async () => (await activeUsers()).map((u) => ({ id: u.id, name: u.name })),
    tasks: allTasks,
    assignments: allAssignments,
    visits: allVisits,
    workHours: workHoursFor,
    pins: getPins,
    readEvents: readCalendarForBooking,
    drive: ({ userId, dayKeys, events, visits }) => planDriveDays({ userId, dayKeys, events, mode: "cache", deps: { visits } }),
    calendarTimeoutMs: PLAN_CALENDAR_TIMEOUT_MS,
  };
}

export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}

export async function loadTaskPlans(args: {
  userIds: readonly string[] | "everyone";
  meId?: string;
  deps?: Partial<TaskPlanDeps>;
}): Promise<PersonPlan[]> {
  const d: TaskPlanDeps = { ...defaultDeps(), ...args.deps };
  const now = d.now();
  const [roster, tasks, assignments] = await Promise.all([d.roster(), d.tasks(), d.assignments()]);
  const byPerson = planItemsByPerson(tasks, assignments, roster);
  const ids = args.userIds === "everyone" ? roster.filter((u) => byPerson.has(u.id)).map((u) => u.id) : [...new Set(args.userIds)];
  let visitsOnce: Promise<SiteVisit[]> | null = null;
  const visits = () => (visitsOnce ??= d.visits());
  const start = floorQuarter(now);
  const range = { timeMinMs: start, timeMaxMs: start + PLAN_HORIZON_DAYS * DAY_MS };
  const dayKeys: string[] = [];
  for (let k = chicagoDayKey(start), i = 0; i < PLAN_HORIZON_DAYS; i++, k = addDays(k, 1)) dayKeys.push(k);

  const plans = await Promise.all(
    ids.map(async (userId): Promise<PersonPlan | null> => {
      const person = roster.find((u) => u.id === userId);
      if (!person) return null;
      const [hours, pins, cal, allV] = await Promise.all([
        d.workHours(userId),
        d.pins(userId),
        withTimeout(d.readEvents(userId, range), d.calendarTimeoutMs, { status: "failed" as CalendarRead, events: [] as CalendarEvent[] }),
        visits(),
      ]);
      const events = cal.status === "ok" ? cal.events : null;
      const busy: BusyInterval[] = busyBlocks({ person: person.name, visits: allV.map(toBusyVisit), events }).map((b) => ({ startMs: b.startMs, endMs: b.endMs }));
      try {
        for (const p of await d.drive({ userId, dayKeys, events, visits })) {
          for (const l of p.legs) if (!l.flag && l.startMs != null && l.endMs != null) busy.push({ startMs: l.startMs, endMs: l.endMs });
        }
      } catch (err) {
        console.error("[task-plan] drive layer failed:", err);
      }
      const result = planPerson({ userId, nowMs: now, hours, busy, pins, items: byPerson.get(userId) ?? [] });
      return { userId, name: person.name, calendar: cal.status, note: calendarNote(cal.status, person.name, userId === args.meId), result };
    })
  );
  return plans
    .filter((p): p is PersonPlan => !!p)
    .sort((a, b) => (a.userId === args.meId ? -1 : b.userId === args.meId ? 1 : a.name.localeCompare(b.name)));
}

export type PinStore = { add(userId: string, pins: readonly PlanPin[]): Promise<void>; remove(userId: string, keys: readonly string[]): Promise<void> };
const defaultStore: PinStore = { add: addPins, remove: removePinKeys };

/** Persist what a compute decided: new started pins, and stale keys dropped. Never throws. */
export async function savePlanPins(plans: readonly PersonPlan[], store: PinStore = defaultStore): Promise<void> {
  for (const p of plans) {
    try {
      if (p.result.newPins.length) await store.add(p.userId, p.result.newPins);
      if (p.result.staleKeys.length) await store.remove(p.userId, p.result.staleKeys);
    } catch (err) {
      console.error("[task-plan] pin save failed:", p.userId, err);
    }
  }
}
```

(If spec 2's `toBusyVisit` parameter type rejects `SiteVisit` under tsc, map the fields it needs explicitly in the `allV.map(...)` call — do not change spec 2's types.)

- [ ] **Step 5: Implement `src/lib/task-plan/triage.ts`**

```ts
/**
 * Morning triage's at-risk provider (TRIAGE_HOOKS.atRisk, spec
 * 2026-10-09-morning-triage "spec 3 seam"). The triage cron builds every
 * user's morning list through this, so it is also where the plan is
 * computed "on the morning cron" — and its started/remainder pins saved —
 * without a new rider on the daily trigger. Never throws: the tasks feed
 * runs under allSettled and a throw would hide every task.
 */
import type { TriageUser } from "@/lib/triage/types";
import { loadTaskPlans, savePlanPins, type PinStore, type TaskPlanDeps } from "./load";

export async function taskPlanAtRisk(
  me: TriageUser,
  now: number,
  opts: { deps?: Partial<TaskPlanDeps>; store?: PinStore } = {}
): Promise<ReadonlySet<string>> {
  try {
    const [plan] = await loadTaskPlans({ userIds: [me.id], meId: me.id, deps: { ...opts.deps, now: () => now } });
    if (!plan) return new Set<string>();
    await savePlanPins([plan], opts.store);
    return new Set(plan.result.atRisk.map((a) => a.itemKey));
  } catch (err) {
    console.error("[task-plan] triage at-risk failed:", me.name, err);
    return new Set<string>();
  }
}
```

- [ ] **Step 6: Wire the hook in `src/lib/triage/hooks.ts`**

Add `import { taskPlanAtRisk } from "@/lib/task-plan/triage";` and add `atRisk: taskPlanAtRisk` as the LAST field of the `TRIAGE_HOOKS` object literal (keep every field spec 2 or #325 put there), e.g.:

```ts
export const TRIAGE_HOOKS: TriageHooks = { ...NO_HOOKS, visitFlags: unverifiedVisitFlags, atRisk: taskPlanAtRisk };
```

Then `grep -n "TRIAGE_HOOKS: TriageHooks" scripts/*.ts`. For each pin that matches that line exactly up to its closing brace (e.g. `scripts/test-drive-time.ts` has `/TRIAGE_HOOKS: TriageHooks = \{ \.\.\.NO_HOOKS, visitFlags: unverifiedVisitFlags \}/`), relax it to allow the new trailing field — insert `(, atRisk: taskPlanAtRisk)?` right before its `\}` — keeping its intent and message.

- [ ] **Step 7: Run the gates**

`npx tsc --noEmit` → PASS · `env -u DATABASE_URL npm run test:specs` → `ALL PASSED` (incl. the drive-time triage pin and every `triage…Checks`) · `npx eslint --ignore-pattern scripts/test-review-and-spec.ts src/lib/task-plan/items.ts src/lib/task-plan/load.ts src/lib/task-plan/triage.ts src/lib/triage/hooks.ts scripts/test-auto-calendar.ts scripts/test-drive-time.ts` → clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib/task-plan/items.ts src/lib/task-plan/load.ts src/lib/task-plan/triage.ts src/lib/triage/hooks.ts scripts/test-drive-time.ts scripts/test-auto-calendar.ts scripts/test-review-and-spec.ts
git commit -m "feat(task-plan): plan loader (work hours, busy, drive, pins) + triage at-risk hook

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Plan write actions — pin, unpin, push due date, hand off, tier/size, in progress

**Files:**
- Create: `src/lib/task-plan/write.ts`, `src/app/(app)/calendar/plan-actions.ts`
- Modify: `scripts/test-auto-calendar.ts`, `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `cleanPinMove`, `pinBlobKey`, `PIN_MAX_PER_PERSON` (Task 5); `getPins`, `addPins`, `removePinKeys`, `userIdForName` (Task 6); `dueStampForDay` (Task 2); `tierSizeOf` (Task 1); `parsePlanRef`, `planItemKey` (Task 1); `getTask`, `updateTask`, `setTaskStatus`, `getAssignment`, `updateAssignment`; `activeUsers`; `isDayKey`, `chicagoDayKey`, `addDays`.
- Produces:
  - `write.ts`: `type WriteResult = { ok: true } | { ok: false; error: string }`; `STARTED_ERROR = "This block has started — it stays put."`; `pinBlock(input: unknown, nowMs?): Promise<WriteResult>`; `unpinBlock(input: unknown, nowMs?)`; `pushDueDate(input: unknown, nowMs?)`; `handOff(input: unknown)`; `setTierSize(input: unknown)`; `markInProgress(input: unknown)`.
  - `plan-actions.ts` (`"use server"`): `pinBlockAction`, `unpinBlockAction`, `pushDueDateAction`, `handOffAction`, `setTierSizeAction`, `markInProgressAction` — each `(input: unknown) => Promise<WriteResult>`, `requireUser()` first, `revalidatePath("/", "layout")` on success.

- [ ] **Step 1: Write the failing tests**

Add to the imports of `scripts/test-auto-calendar.ts`:

```ts
import { handOff, markInProgress, pinBlock, pushDueDate, setTierSize, unpinBlock } from "@/lib/task-plan/write";
```

Append:

```ts
/* ---- Task 8: write actions ---- */
export async function autoCalWriteChecks(ok: Ok): Promise<void> {
  const db = await getDb();
  const U = "TESTautocal:w-u1";
  const me = { id: U, name: "Auto Cal" };
  const T = fixtureId("autocal", "w-task");
  const K = planItemKey("task", T);
  const now = Date.now();
  const later = floorQuarter(now) + 26 * 3_600_000;
  try {
    await createTask({ id: T, title: "write", assigneeUserId: U, assigneeName: "Auto Cal" }, me);
    registerFixture("tasks", T);
    ok((await pinBlock({ kind: "task", id: T, fromStartMs: null, startMs: later, minutes: 60 }, now)).ok, "auto-cal write: dropping a block pins it by hand");
    const pins = await getPins(U);
    ok(pins.length === 1 && pins[0].kind === "hand" && pins[0].startMs === later && pins[0].endMs === later + 3_600_000, "auto-cal write: the hand pin is stored at the dropped time");
    ok((await pinBlock({ kind: "task", id: T, fromStartMs: later, startMs: later + 7_200_000, minutes: 60 }, now)).ok && (await getPins(U)).map((p) => p.startMs).join() === String(later + 7_200_000),
      "auto-cal write: dragging a pinned block moves its pin");
    ok((await unpinBlock({ kind: "task", id: T, startMs: later + 7_200_000 }, now)).ok && (await getPins(U)).length === 0, "auto-cal write: Unpin returns it to the scheduler");
    await addPins(U, [{ itemKey: K, startMs: floorQuarter(now) - 900_000, endMs: floorQuarter(now) + 2_700_000, kind: "started" }]);
    const stuck = await unpinBlock({ kind: "task", id: T, startMs: floorQuarter(now) - 900_000 }, now);
    ok(!stuck.ok && stuck.error === "This block has started — it stays put.", "auto-cal write: a started block can't be unpinned or moved");
    const day = chicagoDayKey(now + 10 * 86_400_000);
    ok((await pushDueDate({ kind: "task", id: T, dayKey: day }, now)).ok && (await getTask(T))?.dueAt === dueStampForDay(day), "auto-cal write: Push due date sets the plan's finish day");
    ok(!(await pushDueDate({ kind: "task", id: T, dayKey: "2026-02-31" }, now)).ok, "auto-cal write: a bad day is refused");
    ok((await setTierSize({ kind: "task", id: T, priority: "high", size: "s" })).ok && (await getTask(T))?.priority === "high" && (await getTask(T))?.size === "s",
      "auto-cal write: the block's chips set tier and size");
    ok(!(await setTierSize({ kind: "task", id: T })).ok, "auto-cal write: nothing to change is refused");
    ok((await markInProgress({ kind: "task", id: T })).ok && (await getTask(T))?.status === "in_progress", "auto-cal write: In progress from the block");
    ok(!(await handOff({ kind: "task", id: T, userId: "nobody-autocal" })).ok, "auto-cal write: hand off only to someone on the team");
    const roster = await activeUsers();
    if (roster.length) {
      ok((await handOff({ kind: "task", id: T, userId: roster[0].id })).ok && (await getTask(T))?.assigneeUserId === roster[0].id && !(await getPins(U)).some((p) => p.itemKey === K),
        "auto-cal write: Hand off reassigns and clears the old calendar's pins");
    }
    ok(!(await pinBlock({ kind: "task", id: "T-missing-autocal", fromStartMs: null, startMs: later, minutes: 60 }, now)).ok, "auto-cal write: a missing item is refused");
  } finally {
    await db.delete(blobs).where(like(blobs.id, "task_pins:TESTautocal:%"));
  }
  const src = readFileSync("src/app/(app)/calendar/plan-actions.ts", "utf8");
  for (const name of ["pinBlockAction", "unpinBlockAction", "pushDueDateAction", "handOffAction", "setTierSizeAction", "markInProgressAction"]) {
    ok(firstAwait(fnBody(src, name), "requireUser()"), `auto-cal write: ${name} checks the session first`);
  }
}
```

Chain: merge `autoCalWriteChecks`; add `.then(() => autoCalWriteChecks(ok))` after `.then(() => autoCalLoaderChecks(ok))`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsc --noEmit`
Expected: FAIL — `Cannot find module '@/lib/task-plan/write'`.

- [ ] **Step 3: Implement `src/lib/task-plan/write.ts`**

```ts
/**
 * The plan's writes (spec Part 3 "Calendar", "At risk"). Kept out of the
 * "use server" file — every export there is POST-reachable — so the actions
 * are requireUser() + delegate and the harness can drive the real writes.
 * Every input is untrusted.
 */
import { addDays, chicagoDayKey, isDayKey } from "@/lib/drive-plan/day";
import { getAssignment, updateAssignment } from "@/lib/stores/assignments";
import { addPins, getPins, removePinKeys, userIdForName } from "@/lib/stores/task-pins";
import { getTask, setTaskStatus, updateTask } from "@/lib/stores/tasks";
import { activeUsers } from "@/lib/users";
import { dueStampForDay } from "./due";
import { tierSizeOf } from "./fields";
import { cleanPinMove, pinBlobKey, PIN_MAX_PER_PERSON } from "./pins";
import { parsePlanRef, planItemKey, type PlanRef } from "./types";

export type WriteResult = { ok: true } | { ok: false; error: string };
export const STARTED_ERROR = "This block has started — it stays put.";
const GONE: WriteResult = { ok: false, error: "That item no longer exists." };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

type Target = { ref: PlanRef; key: string; ownerId: string | null; open: boolean };

async function target(ref: PlanRef): Promise<Target | null> {
  const key = planItemKey(ref.kind, ref.id);
  if (ref.kind === "task") {
    const t = await getTask(ref.id);
    if (!t) return null;
    return { ref, key, ownerId: t.assigneeUserId ?? (await userIdForName(t.assigneeName)), open: t.status === "open" || t.status === "in_progress" };
  }
  const a = await getAssignment(ref.id);
  if (!a) return null;
  return { ref, key, ownerId: await userIdForName(a.assignee), open: !a.done };
}

export async function pinBlock(input: unknown, nowMs: number = Date.now()): Promise<WriteResult> {
  const c = cleanPinMove(input, nowMs);
  if (!c.ok) return c;
  const t = await target(c.value);
  if (!t) return GONE;
  if (!t.open) return { ok: false, error: "That item is already done." };
  if (!t.ownerId) return { ok: false, error: "Assign it to someone first." };
  const pins = await getPins(t.ownerId);
  if (c.value.fromStartMs != null) {
    const from = pins.find((p) => p.itemKey === t.key && p.startMs === c.value.fromStartMs);
    if (from && from.startMs <= nowMs) return { ok: false, error: STARTED_ERROR };
    if (from) await removePinKeys(t.ownerId, [pinBlobKey(from)]);
  } else if (pins.length >= PIN_MAX_PER_PERSON) {
    return { ok: false, error: "Too many pinned blocks — unpin some first." };
  }
  await addPins(t.ownerId, [{ itemKey: t.key, startMs: c.value.startMs, endMs: c.value.startMs + c.value.minutes * 60_000, kind: "hand" }]);
  return { ok: true };
}

export async function unpinBlock(input: unknown, nowMs: number = Date.now()): Promise<WriteResult> {
  const o = obj(input);
  const ref = parsePlanRef(o.kind, o.id);
  const startMs = Number(o.startMs);
  if (!ref || !Number.isFinite(startMs)) return { ok: false, error: "Unknown block." };
  const t = await target(ref);
  if (!t) return GONE;
  if (!t.ownerId) return { ok: true };
  const pin = (await getPins(t.ownerId)).find((p) => p.itemKey === t.key && p.startMs === startMs);
  if (!pin) return { ok: true };
  if (pin.startMs <= nowMs) return { ok: false, error: STARTED_ERROR };
  await removePinKeys(t.ownerId, [pinBlobKey(pin)]);
  return { ok: true };
}

export async function pushDueDate(input: unknown, nowMs: number = Date.now()): Promise<WriteResult> {
  const o = obj(input);
  const ref = parsePlanRef(o.kind, o.id);
  if (!ref) return { ok: false, error: "Unknown task." };
  const today = chicagoDayKey(nowMs);
  if (!isDayKey(o.dayKey) || o.dayKey < today || o.dayKey > addDays(today, 400)) return { ok: false, error: "Pick a day from today on." };
  const dueAt = dueStampForDay(o.dayKey);
  if (ref.kind === "task") return (await updateTask(ref.id, { dueAt })) ? { ok: true } : GONE;
  if (!(await getAssignment(ref.id))) return GONE;
  await updateAssignment(ref.id, { dueDate: dueAt });
  return { ok: true };
}

export async function handOff(input: unknown): Promise<WriteResult> {
  const o = obj(input);
  const ref = parsePlanRef(o.kind, o.id);
  if (!ref) return { ok: false, error: "Unknown task." };
  const who = (await activeUsers()).find((u) => u.id === o.userId);
  if (!who) return { ok: false, error: "Pick someone on the team." };
  if (ref.kind === "task") return (await updateTask(ref.id, { assigneeUserId: who.id, assigneeName: who.name })) ? { ok: true } : GONE;
  if (!(await getAssignment(ref.id))) return GONE;
  await updateAssignment(ref.id, { assignee: who.name });
  return { ok: true };
}

export async function setTierSize(input: unknown): Promise<WriteResult> {
  const o = obj(input);
  const ref = parsePlanRef(o.kind, o.id);
  if (!ref) return { ok: false, error: "Unknown task." };
  const patch = tierSizeOf(o);
  if (!patch.priority && !patch.size) return { ok: false, error: "Nothing to change." };
  if (ref.kind === "task") return (await updateTask(ref.id, patch)) ? { ok: true } : GONE;
  if (!(await getAssignment(ref.id))) return GONE;
  await updateAssignment(ref.id, patch);
  return { ok: true };
}

export async function markInProgress(input: unknown): Promise<WriteResult> {
  const o = obj(input);
  const ref = parsePlanRef(o.kind, o.id);
  if (!ref) return { ok: false, error: "Unknown task." };
  if (ref.kind !== "task") return { ok: false, error: "Queue items don't have an In progress state." };
  return (await setTaskStatus(ref.id, "in_progress")) ? { ok: true } : GONE;
}
```

- [ ] **Step 4: Implement `src/app/(app)/calendar/plan-actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { handOff, markInProgress, pinBlock, pushDueDate, setTierSize, unpinBlock, type WriteResult } from "@/lib/task-plan/write";

/**
 * Spec 2026-10-09 auto task calendar — the block, popover and At risk panel
 * actions. Each is requireUser() then the write in src/lib/task-plan/write.ts.
 */
async function done(r: WriteResult): Promise<WriteResult> {
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function pinBlockAction(input: unknown): Promise<WriteResult> {
  await requireUser();
  return done(await pinBlock(input));
}

export async function unpinBlockAction(input: unknown): Promise<WriteResult> {
  await requireUser();
  return done(await unpinBlock(input));
}

export async function pushDueDateAction(input: unknown): Promise<WriteResult> {
  await requireUser();
  return done(await pushDueDate(input));
}

export async function handOffAction(input: unknown): Promise<WriteResult> {
  await requireUser();
  return done(await handOff(input));
}

export async function setTierSizeAction(input: unknown): Promise<WriteResult> {
  await requireUser();
  return done(await setTierSize(input));
}

export async function markInProgressAction(input: unknown): Promise<WriteResult> {
  await requireUser();
  return done(await markInProgress(input));
}
```

- [ ] **Step 5: Run the gates**

`npx tsc --noEmit` → PASS · `env -u DATABASE_URL npm run test:specs` → `ALL PASSED` · `npx eslint --ignore-pattern scripts/test-review-and-spec.ts src/lib/task-plan/write.ts "src/app/(app)/calendar/plan-actions.ts" scripts/test-auto-calendar.ts` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/task-plan/write.ts "src/app/(app)/calendar/plan-actions.ts" scripts/test-auto-calendar.ts scripts/test-review-and-spec.ts
git commit -m "feat(task-plan): pin/unpin, push due date, hand off, tier/size and in-progress actions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: /calendar — task blocks in Week/Day, block popover, Month chips from the plan, Google note

**Files:**
- Create: `src/lib/task-plan/calendar-view.ts`, `src/components/task-plan/tier-size-chips.tsx`, `src/app/(app)/calendar/task-block-layer.tsx`, `src/app/(app)/calendar/task-block-popover.tsx`
- Modify: `src/app/(app)/calendar/page.tsx`, `src/app/(app)/calendar/calendar-client.tsx`, `scripts/test-auto-calendar.ts`, `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `loadTaskPlans`, `savePlanPins`, `PersonPlan` (Task 7); `atRiskLabel`… via `PlanResult` (Tasks 4–5); `finishText` (Task 4); `completeCalendarTaskAction` (`calendar/task-actions.ts`); `markInProgressAction`, `setTierSizeAction`, `unpinBlockAction` (Task 8); `localDayKey`, `dayKeyDiff`, `placeTasks`, `CalendarTaskItem`, `PlacedTask` (`calendar-tasks.ts`); `deriveInitials` (`team.ts`); `activeUsers`.
- Produces:
  - `calendar-view.ts`: `type PlanForView = { userId; name; note: string | null; result: PlanResult }`; `type CalendarPlanBlock = { key; itemKey; kind; id; title; href; startMs; endMs; pinned: PinKind | null; canUnpin: boolean; draggable: boolean; atRiskLabel: string | null; userId; ownerName; initials; tier: TaskTier; size: TaskSize; inProgress: boolean }`; `type CalendarAtRisk = { itemKey; kind; id; title; href; userId; ownerName; label; finishDayKey: string | null; finishText: string }`; `type CalendarFuturePin = { userId; itemKey; kind; id; title; startMs; endMs; pinKind: PinKind }`; `type CalendarPlanView = { blocks; atRisk; futurePins; notes: string[]; plannedKeys: string[] }`; `EMPTY_PLAN_VIEW`; `calendarPlanView(plans, { minMs, maxMs, initials(userId, name) }): CalendarPlanView`; `monthChips(tasks, view, { today, rangeStart, rangeEnd }): PlacedTask[]`; `stripTasks(tasks, view): CalendarTaskItem[]`; `layoutIntervals<T extends { startMs; endMs }>(items): Array<{ it: T; col: number; cols: number }>`; `dragStartMs({ startMs, dyPx, dxPx, hourPx, colPx, dayCount }): number` (used in Task 10).
  - `TierSizeChips` (default export): `({ tier, size, onTier, onSize, disabled? }) => JSX`.
  - `TaskBlockLayer` (default export): `({ blocks, hourStart, hourPx, dayCount, showOwner, onOpen })`.
  - `TaskBlockPopover` (default export): `({ block, onClose })`.
  - `CalendarClient` new props `plan: CalendarPlanView`, `roster: { id: string; name: string }[]`.

- [ ] **Step 1: Write the failing tests**

Add to the imports of `scripts/test-auto-calendar.ts`:

```ts
import { localDayKey, type CalendarTaskItem } from "@/lib/calendar-tasks";
import { calendarPlanView, layoutIntervals, monthChips, stripTasks } from "@/lib/task-plan/calendar-view";
```

Append:

```ts
/* ---- Task 9: calendar view ---- */
export async function autoCalCalendarViewChecks(ok: Ok): Promise<void> {
  const r = planPerson(baseInput({
    nowMs: at(MON, 10, 7),
    pins: [{ itemKey: "task:P", startMs: at(TUE, 9), endMs: at(TUE, 10), kind: "hand" }],
    items: [
      item("A"),
      item("P"),
      item("R1", { size: "l", sizeMin: 240, dueMs: at(MON, 17), createdAt: 8 }),
      item("R2", { size: "l", sizeMin: 240, dueMs: at(MON, 17), createdAt: 9 }),
      item("Z", { dueMs: at("2036-11-30", 17), createdAt: 10 }),
    ],
  }));
  const view = calendarPlanView([{ userId: "u1", name: "Dana", note: null, result: r }], { minMs: at(MON, 0), maxMs: at(TUE, 23), initials: () => "DA" });
  ok(view.blocks.every((b) => b.endMs >= at(MON, 0) && b.startMs <= at(TUE, 23)) && view.plannedKeys.includes("task:Z"),
    "auto-cal view: blocks are cut to the visible window; planned keys cover the whole plan");
  const p = view.blocks.find((b) => b.itemKey === "task:P")!;
  ok(p.pinned === "hand" && p.canUnpin && p.draggable, "auto-cal view: a pin that hasn't begun can be unpinned and dragged");
  const begun = view.blocks.find((b) => b.pinned === "started");
  ok(!!begun && !begun.canUnpin && !begun.draggable, "auto-cal view: a block that has begun can't be unpinned or dragged");
  ok(view.blocks.filter((b) => b.itemKey === "task:R2").every((b) => b.atRiskLabel === "At risk — due Mon") && view.atRisk[0]?.itemKey === "task:R2",
    "auto-cal view: an at-risk block carries the badge text");
  ok(view.atRisk[0]?.finishDayKey === TUE && view.atRisk[0]?.finishText === "Plan finishes Tue Oct 14",
    "auto-cal view: the at-risk list gives the plan's finish day (Push due date's target)");
  const tasks: CalendarTaskItem[] = [
    { kind: "task", id: "A", title: "A", dueAt: at(FRI, 17), done: false, assigneeName: "Dana", assigneeInitials: "DA", href: "" },
    { kind: "task", id: "BLK", title: "blocked", dueAt: at(MON, 12), done: false, assigneeName: "Dana", assigneeInitials: "DA", href: "" },
  ];
  const range = { today: localDayKey(at(MON, 10)), rangeStart: localDayKey(at(MON, 0)), rangeEnd: localDayKey(at(TUE, 23)) };
  const chips = monthChips(tasks, view, range);
  const aDays = [...new Set(view.blocks.filter((b) => b.itemKey === "task:A").map((b) => localDayKey(b.startMs)))].sort().join();
  ok(chips.filter((c) => c.item.id === "A").map((c) => c.dayKey).sort().join() === aDays, "auto-cal view: month chips sit on each day the task is planned");
  ok(stripTasks(tasks, view).map((t) => t.id).join() === "BLK" && chips.some((c) => c.item.id === "BLK"), "auto-cal view: an unplanned item (blocked) keeps its old chip");
  const lay = layoutIntervals([{ key: "a", startMs: 0, endMs: 10 }, { key: "b", startMs: 5, endMs: 15 }, { key: "c", startMs: 20, endMs: 30 }]);
  ok(lay.map((x) => `${x.it.key}${x.col}/${x.cols}`).join() === "a0/2,b1/2,c0/1", "auto-cal view: overlapping blocks (Everyone) sit side by side");

  const page = readFileSync("src/app/(app)/calendar/page.tsx", "utf8");
  const client = readFileSync("src/app/(app)/calendar/calendar-client.tsx", "utf8");
  ok(/loadTaskPlans\(/.test(page) && /after\(\(\) => savePlanPins\(/.test(page), "auto-cal view: /calendar computes plans on view and saves pins after the response");
  ok(client.includes("<TaskBlockLayer") && client.includes("monthChips(") && client.includes("plan.notes") && client.includes("<TaskBlockPopover"),
    "auto-cal view: Week/Day draw task blocks, Month chips come from the plan, the Google note and block popover show");
  const noDb = (f: string) => !/^import\s+(?!type\b)[^;]*from\s+"@\/(lib\/stores\/|db\b|db\/|lib\/users"|lib\/task-plan\/load"|lib\/task-plan\/write")/m.test(readFileSync(f, "utf8"));
  ok(["src/app/(app)/calendar/task-block-layer.tsx", "src/app/(app)/calendar/task-block-popover.tsx", "src/components/task-plan/tier-size-chips.tsx", "src/lib/task-plan/calendar-view.ts"].every(noDb),
    "auto-cal view: client files never import a module that reaches the database");
}
```

Chain: merge `autoCalCalendarViewChecks`; add `.then(() => autoCalCalendarViewChecks(ok))` after `.then(() => autoCalWriteChecks(ok))`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsc --noEmit`
Expected: FAIL — `Cannot find module '@/lib/task-plan/calendar-view'`.

- [ ] **Step 3: Implement `src/lib/task-plan/calendar-view.ts`**

```ts
/**
 * The task plan as /calendar draws it (spec Part 3 "Calendar", "At risk").
 * Pure and CLIENT-SAFE (type-only store imports). Day keys for drawing are
 * the browser's local day (calendar-client's convention for timed items);
 * the plan itself is computed in Chicago days.
 */
import { dayKeyDiff, localDayKey, placeTasks, type CalendarTaskItem, type PlacedTask } from "@/lib/calendar-tasks";
import { chicagoDayKey } from "@/lib/drive-plan/day";
import { finishText } from "./labels";
import { parsePlanItemKey, planItemKey, type PinKind, type PlanItemKind, type PlanResult, type TaskSize, type TaskTier } from "./types";

export type PlanForView = { userId: string; name: string; note: string | null; result: PlanResult };

export type CalendarPlanBlock = {
  key: string;
  itemKey: string;
  kind: PlanItemKind;
  id: string;
  title: string;
  href: string;
  startMs: number;
  endMs: number;
  pinned: PinKind | null;
  canUnpin: boolean;
  draggable: boolean;
  atRiskLabel: string | null;
  userId: string;
  ownerName: string;
  initials: string;
  tier: TaskTier;
  size: TaskSize;
  inProgress: boolean;
};

export type CalendarAtRisk = {
  itemKey: string;
  kind: PlanItemKind;
  id: string;
  title: string;
  href: string;
  userId: string;
  ownerName: string;
  label: string;
  finishDayKey: string | null;
  finishText: string;
};

export type CalendarFuturePin = { userId: string; itemKey: string; kind: PlanItemKind; id: string; title: string; startMs: number; endMs: number; pinKind: PinKind };

export type CalendarPlanView = { blocks: CalendarPlanBlock[]; atRisk: CalendarAtRisk[]; futurePins: CalendarFuturePin[]; notes: string[]; plannedKeys: string[] };

export const EMPTY_PLAN_VIEW: CalendarPlanView = { blocks: [], atRisk: [], futurePins: [], notes: [], plannedKeys: [] };

export function calendarPlanView(
  plans: readonly PlanForView[],
  opts: { minMs: number; maxMs: number; initials: (userId: string, name: string) => string }
): CalendarPlanView {
  const view: CalendarPlanView = { blocks: [], atRisk: [], futurePins: [], notes: [], plannedKeys: [] };
  const planned = new Set<string>();
  for (const p of plans) {
    const now = p.result.nowMs;
    if (p.note) view.notes.push(p.note);
    const riskLabel = new Map(p.result.atRisk.map((a) => [a.itemKey, a.label] as const));
    const titleOf = new Map(p.result.blocks.map((b) => [b.itemKey, b.title] as const));
    const initials = opts.initials(p.userId, p.name);
    for (const b of p.result.blocks) {
      planned.add(b.itemKey);
      if (b.endMs < opts.minMs || b.startMs > opts.maxMs) continue;
      const canUnpin = !!b.pinned && b.startMs > now;
      view.blocks.push({
        key: b.key, itemKey: b.itemKey, kind: b.kind, id: b.id, title: b.title, href: b.href,
        startMs: b.startMs, endMs: b.endMs, pinned: b.pinned, canUnpin, draggable: !b.pinned || canUnpin,
        atRiskLabel: b.atRisk ? (riskLabel.get(b.itemKey) ?? null) : null,
        userId: p.userId, ownerName: p.name, initials, tier: b.tier, size: b.size, inProgress: b.inProgress,
      });
    }
    for (const a of p.result.atRisk) {
      view.atRisk.push({
        itemKey: a.itemKey, kind: a.kind, id: a.id, title: a.title, href: a.href, userId: p.userId, ownerName: p.name, label: a.label,
        finishDayKey: a.finishMs == null ? null : chicagoDayKey(a.finishMs - 1), finishText: finishText(a.finishMs),
      });
    }
    for (const f of p.result.futurePins) {
      const ref = parsePlanItemKey(f.itemKey);
      if (ref) view.futurePins.push({ userId: p.userId, itemKey: f.itemKey, kind: ref.kind, id: ref.id, title: titleOf.get(f.itemKey) ?? ref.id, startMs: f.startMs, endMs: f.endMs, pinKind: f.kind });
    }
  }
  view.blocks.sort((a, b) => a.startMs - b.startMs || (a.key < b.key ? -1 : 1));
  view.futurePins.sort((a, b) => a.startMs - b.startMs || (a.itemKey < b.itemKey ? -1 : 1));
  view.plannedKeys = [...planned].sort();
  return view;
}

/** Month view: one chip per (item, day it is planned on); items with no
 *  plan (blocked, or not placed) keep the #215 due-day/carried chip. */
export function monthChips(
  tasks: readonly CalendarTaskItem[],
  view: Pick<CalendarPlanView, "blocks" | "plannedKeys">,
  opts: { today: string; rangeStart: string; rangeEnd: string }
): PlacedTask[] {
  const planned = new Set(view.plannedKeys);
  const byKey = new Map(tasks.map((t) => [planItemKey(t.kind, t.id), t] as const));
  const out: PlacedTask[] = [];
  const seen = new Set<string>();
  for (const b of view.blocks) {
    const item = byKey.get(b.itemKey);
    if (!item) continue;
    const day = localDayKey(b.startMs);
    if (day < opts.rangeStart || day > opts.rangeEnd || seen.has(b.itemKey + "|" + day)) continue;
    seen.add(b.itemKey + "|" + day);
    const dueKey = item.dueAt ? localDayKey(item.dueAt) : null;
    out.push({ dayKey: day, item, carried: false, overdueDays: dueKey && dueKey < day ? dayKeyDiff(dueKey, day) : 0 });
  }
  const rest = placeTasks(tasks.filter((t) => !planned.has(planItemKey(t.kind, t.id))), opts);
  return [...out, ...rest].sort(
    (a, b) => a.dayKey.localeCompare(b.dayKey) || b.overdueDays - a.overdueDays || a.item.title.localeCompare(b.item.title) || a.item.id.localeCompare(b.item.id)
  );
}

/** Week/Day task strip: only items the plan didn't place. */
export function stripTasks(tasks: readonly CalendarTaskItem[], view: Pick<CalendarPlanView, "plannedKeys">): CalendarTaskItem[] {
  const planned = new Set(view.plannedKeys);
  return tasks.filter((t) => !planned.has(planItemKey(t.kind, t.id)));
}

/** Greedy side-by-side columns for overlapping blocks (Everyone view). */
export function layoutIntervals<T extends { startMs: number; endMs: number }>(items: readonly T[]): Array<{ it: T; col: number; cols: number }> {
  const sorted = [...items].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const out: Array<{ it: T; col: number; cols: number }> = [];
  let i = 0;
  while (i < sorted.length) {
    let end = sorted[i].endMs;
    let j = i + 1;
    while (j < sorted.length && sorted[j].startMs < end) {
      end = Math.max(end, sorted[j].endMs);
      j++;
    }
    const active: Array<{ endMs: number; col: number }> = [];
    const cluster: Array<{ it: T; col: number }> = [];
    let cols = 0;
    for (const it of sorted.slice(i, j)) {
      for (let a = active.length - 1; a >= 0; a--) if (active[a].endMs <= it.startMs) active.splice(a, 1);
      const used = new Set(active.map((a) => a.col));
      let col = 0;
      while (used.has(col)) col++;
      active.push({ endMs: it.endMs, col });
      cluster.push({ it, col });
      cols = Math.max(cols, col + 1);
    }
    for (const c of cluster) out.push({ it: c.it, col: c.col, cols });
    i = j;
  }
  return out;
}

/** Where a dragged block lands: 15-minute steps vertically, whole days
 *  sideways (Week view only), in the browser's local time like the grid. */
export function dragStartMs(args: { startMs: number; dyPx: number; dxPx: number; hourPx: number; colPx: number; dayCount: number }): number {
  const minutes = args.hourPx > 0 ? Math.round(((args.dyPx / args.hourPx) * 60) / 15) * 15 : 0;
  const days = args.dayCount > 1 && args.colPx > 0 ? Math.round(args.dxPx / args.colPx) : 0;
  const d = new Date(args.startMs);
  d.setDate(d.getDate() + days);
  return d.getTime() + minutes * 60_000;
}
```

- [ ] **Step 4: Implement `src/components/task-plan/tier-size-chips.tsx`**

```tsx
"use client";

/**
 * Spec 2026-10-09 auto task calendar — the two optional chip rows every task
 * form gets: High / Normal / Low and S / M / L (blank = Normal, M).
 */
import type { CSSProperties } from "react";
import { SIZE_HINT, SIZE_LABEL, TASK_SIZES, TASK_TIERS, TIER_LABEL, type TaskSize, type TaskTier } from "@/lib/task-plan/types";

const chip = (on: boolean): CSSProperties => ({
  fontFamily: "var(--font-ui)",
  fontSize: 11,
  fontWeight: 600,
  padding: "3px 8px",
  border: "none",
  borderLeft: "1px solid #e4e7ec",
  background: on ? "var(--accent)" : "#fff",
  color: on ? "#fff" : "#5b616e",
  cursor: "pointer",
});
const group: CSSProperties = { display: "inline-flex", border: "1px solid #e4e7ec", borderRadius: 7, overflow: "hidden" };

export default function TierSizeChips({
  tier,
  size,
  onTier,
  onSize,
  disabled = false,
}: {
  tier: TaskTier;
  size: TaskSize;
  onTier: (t: TaskTier) => void;
  onSize: (s: TaskSize) => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: "inline-flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <div role="group" aria-label="Priority" style={group}>
        {TASK_TIERS.map((t, i) => (
          <button key={t} type="button" aria-pressed={tier === t} disabled={disabled} onClick={() => onTier(t)} style={{ ...chip(tier === t), borderLeft: i ? chip(false).borderLeft : "none" }}>
            {TIER_LABEL[t]}
          </button>
        ))}
      </div>
      <div role="group" aria-label="Size" style={group}>
        {TASK_SIZES.map((s, i) => (
          <button key={s} type="button" aria-pressed={size === s} disabled={disabled} title={SIZE_HINT[s]} onClick={() => onSize(s)} style={{ ...chip(size === s), borderLeft: i ? chip(false).borderLeft : "none" }}>
            {SIZE_LABEL[s]}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Implement `src/app/(app)/calendar/task-block-layer.tsx`**

```tsx
"use client";

/**
 * Spec 2026-10-09 auto task calendar — the task blocks of one Week/Day
 * column, drawn lighter than visits, drive blocks and Google events and
 * UNDER them (calendar-client renders this before the agenda layer). 📌 =
 * pinned; the at-risk badge reads "At risk — due Tue". Positions use the
 * browser's local hours, like the agenda blocks beside them.
 */
import type { CSSProperties } from "react";
import { layoutIntervals, type CalendarPlanBlock } from "@/lib/task-plan/calendar-view";

const RISK: CSSProperties = { display: "block", marginTop: 1, fontSize: 9.5, fontWeight: 700, color: "#b4543a" };

function minuteOf(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

export default function TaskBlockLayer({
  blocks,
  hourStart,
  hourPx,
  dayCount,
  showOwner,
  onOpen,
}: {
  blocks: CalendarPlanBlock[];
  hourStart: number;
  hourPx: number;
  dayCount: number;
  showOwner: boolean;
  onOpen: (b: CalendarPlanBlock) => void;
}) {
  void dayCount; // used by drag (Task 10)
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {layoutIntervals(blocks).map(({ it: b, col, cols }) => {
        const startMin = minuteOf(b.startMs);
        const endMin = Math.max(startMin + 15, minuteOf(b.endMs) || 24 * 60);
        const top = ((startMin - hourStart * 60) / 60) * hourPx;
        const height = Math.max(16, ((endMin - startMin) / 60) * hourPx);
        const label = `${b.pinned ? "📌 " : ""}${showOwner && b.initials ? b.initials + " · " : ""}${b.title}`;
        return (
          <button
            key={b.key}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(b);
            }}
            title={label + (b.atRiskLabel ? " · " + b.atRiskLabel : "")}
            style={{
              position: "absolute",
              top,
              height,
              left: `calc(${(col / cols) * 100}% + 2px)`,
              width: `calc(${100 / cols}% - 4px)`,
              textAlign: "left",
              background: "color-mix(in srgb, var(--accent) 9%, #fff)",
              border: `1px dashed ${b.atRiskLabel ? "#e0b2a3" : "color-mix(in srgb, var(--accent) 40%, #fff)"}`,
              color: "#3a3f4a",
              borderRadius: 5,
              padding: "2px 5px",
              fontFamily: "var(--font-ui)",
              fontSize: 10.5,
              fontWeight: 600,
              overflow: "hidden",
              pointerEvents: "auto",
              cursor: "pointer",
            }}
          >
            {label}
            {b.atRiskLabel && <span style={RISK}>{b.atRiskLabel}</span>}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 6: Implement `src/app/(app)/calendar/task-block-popover.tsx`**

```tsx
"use client";

/**
 * Spec 2026-10-09 auto task calendar — clicking a task block opens the task:
 * Done, In progress, Unpin, and the tier/size chips. Done and In progress
 * close the real record (same actions as the #215 chip), so the Queue, bell
 * and owning record agree.
 */
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import TierSizeChips from "@/components/task-plan/tier-size-chips";
import type { CalendarPlanBlock } from "@/lib/task-plan/calendar-view";
import type { TaskSize, TaskTier } from "@/lib/task-plan/types";
import { completeCalendarTaskAction } from "./task-actions";
import { markInProgressAction, setTierSizeAction, unpinBlockAction } from "./plan-actions";

type Result = { ok: true } | { ok: false; error: string };
const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export default function TaskBlockPopover({ block, onClose }: { block: CalendarPlanBlock; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tier, setTier] = useState<TaskTier>(block.tier);
  const [size, setSize] = useState<TaskSize>(block.size);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = (fn: () => Promise<Result>, close: boolean) =>
    start(async () => {
      setError(null);
      let r: Result;
      try {
        r = await fn();
      } catch {
        r = { ok: false, error: "Couldn't save — try again." };
      }
      if (!r.ok) {
        setError(r.error);
        return;
      }
      if (close) onClose();
      router.refresh();
    });

  const ref = { kind: block.kind, id: block.id };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(22,24,29,.18)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label={block.title} className="pk-card" onClick={(e) => e.stopPropagation()} style={{ width: "min(420px, 100%)", padding: "16px 18px", background: "#fff" }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>
          {block.pinned ? "📌 " : ""}
          {block.href ? <Link href={block.href}>{block.title}</Link> : block.title}
        </div>
        <div style={{ fontSize: 12, color: "#8c919c", marginTop: 4 }}>
          {clock(block.startMs)}–{clock(block.endMs)} · {block.ownerName}
          {block.kind === "assignment" ? " · Queue" : ""}
          {block.inProgress ? " · In progress" : ""}
        </div>
        {block.atRiskLabel && <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: "#b4543a" }}>{block.atRiskLabel}</div>}
        <div style={{ marginTop: 12 }}>
          <TierSizeChips
            tier={tier}
            size={size}
            disabled={pending}
            onTier={(t) => {
              setTier(t);
              run(() => setTierSizeAction({ ...ref, priority: t }), false);
            }}
            onSize={(s) => {
              setSize(s);
              run(() => setTierSizeAction({ ...ref, size: s }), false);
            }}
          />
        </div>
        {error && <div role="alert" style={{ marginTop: 8, fontSize: 12, color: "#a03b2e" }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
          <button type="button" className="pk-btn-accent" disabled={pending} onClick={() => run(() => completeCalendarTaskAction(block.kind, block.id), true)}>
            Done
          </button>
          {block.kind === "task" && !block.inProgress && (
            <button type="button" className="pk-btn-outline" disabled={pending} onClick={() => run(() => markInProgressAction(ref), true)}>
              In progress
            </button>
          )}
          {block.canUnpin && (
            <button type="button" className="pk-btn-outline" disabled={pending} onClick={() => run(() => unpinBlockAction({ ...ref, startMs: block.startMs }), true)}>
              Unpin
            </button>
          )}
          <button type="button" className="pk-btn-outline" onClick={onClose} style={{ marginLeft: "auto" }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Compute the plan in `src/app/(app)/calendar/page.tsx`**

Add to the imports:

```ts
import { activeUsers } from "@/lib/users";
import { deriveInitials } from "@/lib/team";
import { loadTaskPlans, savePlanPins, type PersonPlan } from "@/lib/task-plan/load";
import { calendarPlanView } from "@/lib/task-plan/calendar-view";
```

Add two entries to the end of the page's main `Promise.all([...])` and its destructuring (`..., plans, roster] = await Promise.all([ ..., `):

```ts
    // Spec 2026-10-09 auto task calendar — computed on every view; mine, or
    // everyone's with ?tasks=all. Its new started pins are saved after the response.
    loadTaskPlans({ userIds: tasksEveryone ? "everyone" : [user.id], meId: user.id }).catch((err) => {
      console.error("[task-plan] calendar plan failed:", err);
      return [] as PersonPlan[];
    }),
    activeUsers(),
```

After the `Promise.all`, add:

```ts
  after(() => savePlanPins(plans));
  const plan = calendarPlanView(plans, {
    minMs,
    maxMs,
    initials: (id, name) => roster.find((u) => u.id === id)?.initials || deriveInitials(name),
  });
```

and pass two new props to `<CalendarClient …>`: `plan={plan}` and `roster={roster.map((u) => ({ id: u.id, name: u.name }))}`.

- [ ] **Step 8: Draw it in `src/app/(app)/calendar/calendar-client.tsx`**

1. After the line `import TaskChip from "./task-chip";` add:

```ts
import TaskBlockLayer from "./task-block-layer";
import TaskBlockPopover from "./task-block-popover";
import { monthChips, stripTasks, type CalendarPlanBlock, type CalendarPlanView } from "@/lib/task-plan/calendar-view";
```

and add `localDayKey` to the existing `@/lib/calendar-tasks` import.

2. In the component's props destructuring add `plan,` and `roster,` after `stayOvers,`; in its props type add, after `stayOvers: Record<string, boolean>;`:

```ts
  /** Spec 2026-10-09 auto task calendar — the plan for the visible window. */
  plan: CalendarPlanView;
  /** Active team (hand-off targets). */
  roster: { id: string; name: string }[];
```

(`roster` is used by the At risk panel in Task 10; until then reference it once as `void roster;` right after the destructuring so lint stays clean.)

3. Replace the whole `const tasksByDay = useMemo(…);` statement with:

```ts
  const tasksByDay = useMemo(
    () =>
      groupPlacedByDay(
        view === "month"
          ? monthChips(tasks, plan, { today: todayKey, rangeStart, rangeEnd })
          : placeTasks(stripTasks(tasks, plan), { today: todayKey, rangeStart, rangeEnd })
      ),
    [view, tasks, plan, todayKey, rangeStart, rangeEnd]
  );
  const blocksByDay = useMemo(() => {
    const m = new Map<string, CalendarPlanBlock[]>();
    for (const b of plan.blocks) {
      const k = localDayKey(b.startMs);
      const list = m.get(k);
      if (list) list.push(b);
      else m.set(k, [b]);
    }
    return m;
  }, [plan]);
  const [openBlock, setOpenBlock] = useState<CalendarPlanBlock | null>(null);
```

4. In `renderTimeGrid`, inside each day column, immediately BEFORE the only `<div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>` (the agenda layer), add:

```tsx
                  <TaskBlockLayer
                    blocks={blocksByDay.get(k) ?? []}
                    hourStart={HOUR_START}
                    hourPx={HOUR_PX}
                    dayCount={days.length}
                    showOwner={tasksEveryone}
                    onOpen={setOpenBlock}
                  />
```

5. Right after `{modalTarget && <EventModal target={modalTarget} onClose={() => setModalTarget(null)} />}` add:

```tsx
      {plan.notes.map((n) => (
        <div key={n} role="status" className="pk-card" style={{ padding: "8px 12px", marginBottom: 12, fontSize: 12.5, color: "#8a5a1a", background: "#fdf3e7", border: "1px solid #f0d3a8" }}>
          {n}
        </div>
      ))}
      {openBlock && <TaskBlockPopover block={openBlock} onClose={() => setOpenBlock(null)} />}
```

- [ ] **Step 9: Run the gates**

`npx tsc --noEmit` → PASS · `env -u DATABASE_URL npm run test:specs` → `ALL PASSED` · `npx eslint --ignore-pattern scripts/test-review-and-spec.ts src/lib/task-plan/calendar-view.ts src/components/task-plan/tier-size-chips.tsx "src/app/(app)/calendar/task-block-layer.tsx" "src/app/(app)/calendar/task-block-popover.tsx" "src/app/(app)/calendar/page.tsx" "src/app/(app)/calendar/calendar-client.tsx" scripts/test-auto-calendar.ts` → clean · `npm run build` → succeeds.

- [ ] **Step 10: Commit**

```bash
git add src/lib/task-plan/calendar-view.ts src/components/task-plan/tier-size-chips.tsx "src/app/(app)/calendar/task-block-layer.tsx" "src/app/(app)/calendar/task-block-popover.tsx" "src/app/(app)/calendar/page.tsx" "src/app/(app)/calendar/calendar-client.tsx" scripts/test-auto-calendar.ts scripts/test-review-and-spec.ts
git commit -m "feat(calendar): planned task blocks in Week/Day, block popover, month chips from the plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Drag-to-pin + the At risk panel

**Files:**
- Create: `src/app/(app)/calendar/at-risk-panel.tsx`
- Modify: `src/app/(app)/calendar/task-block-layer.tsx` (full replacement), `src/app/(app)/calendar/calendar-client.tsx`, `scripts/test-auto-calendar.ts`, `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `dragStartMs`, `layoutIntervals`, `CalendarPlanBlock`, `CalendarAtRisk`, `CalendarFuturePin` (Task 9); `pinBlockAction`, `pushDueDateAction`, `handOffAction`, `unpinBlockAction` (Task 8).
- Produces: `TaskBlockLayer` (same props as Task 9) now drags: a drop calls `pinBlockAction({ kind, id, fromStartMs: b.pinned ? b.startMs : null, startMs, minutes })`; a press without movement opens the popover. `AtRiskPanel` (default export): `({ items: CalendarAtRisk[]; futurePins: CalendarFuturePin[]; roster: { id; name }[]; showOwner: boolean })`.

- [ ] **Step 1: Write the failing tests**

Add `dragStartMs` to the `@/lib/task-plan/calendar-view` import of `scripts/test-auto-calendar.ts` and append:

```ts
/* ---- Task 10: drag + At risk panel ---- */
export async function autoCalDragPanelChecks(ok: Ok): Promise<void> {
  const s = new Date(2036, 9, 14, 10, 0).getTime();
  ok(dragStartMs({ startMs: s, dyPx: 72, dxPx: 0, hourPx: 48, colPx: 100, dayCount: 7 }) === new Date(2036, 9, 14, 11, 30).getTime(), "auto-cal drag: dragging down 1.5 hours moves the block 1.5 hours");
  ok(dragStartMs({ startMs: s, dyPx: 13, dxPx: 0, hourPx: 48, colPx: 100, dayCount: 7 }) === new Date(2036, 9, 14, 10, 15).getTime(), "auto-cal drag: drops snap to 15 minutes");
  ok(dragStartMs({ startMs: s, dyPx: 0, dxPx: 160, hourPx: 48, colPx: 100, dayCount: 7 }) === new Date(2036, 9, 16, 10, 0).getTime() &&
     dragStartMs({ startMs: s, dyPx: 0, dxPx: 160, hourPx: 48, colPx: 100, dayCount: 1 }) === s,
    "auto-cal drag: sideways moves whole days in Week view, never in Day view");
  const layer = readFileSync("src/app/(app)/calendar/task-block-layer.tsx", "utf8");
  ok(/onPointerDown/.test(layer) && /pinBlockAction\(/.test(layer) && /fromStartMs: b\.pinned \? b\.startMs : null/.test(layer), "auto-cal drag: dropping a block pins it (moving a pin replaces it)");
  const panel = readFileSync("src/app/(app)/calendar/at-risk-panel.tsx", "utf8");
  ok(["Push due date", "Hand off", "Unpin something"].every((t) => panel.includes(t)) && /pushDueDateAction\(/.test(panel) && /handOffAction\(/.test(panel) && /unpinBlockAction\(/.test(panel),
    "auto-cal at risk: the panel's three one-click fixes");
  ok(readFileSync("src/app/(app)/calendar/calendar-client.tsx", "utf8").includes("<AtRiskPanel"), "auto-cal at risk: the panel shows on /calendar");
}
```

Chain: merge `autoCalDragPanelChecks`; add `.then(() => autoCalDragPanelChecks(ok))` after `.then(() => autoCalCalendarViewChecks(ok))`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `df -h . && env -u DATABASE_URL npm run test:specs`
Expected: FAIL — `ENOENT … at-risk-panel.tsx` (the drag pure checks pass).

- [ ] **Step 3: Replace `src/app/(app)/calendar/task-block-layer.tsx`**

```tsx
"use client";

/**
 * Spec 2026-10-09 auto task calendar — the task blocks of one Week/Day
 * column, drawn lighter than visits, drive blocks and Google events and
 * UNDER them (calendar-client renders this before the agenda layer). 📌 =
 * pinned; the at-risk badge reads "At risk — due Tue". Dragging a block pins
 * it by hand at the drop (15-minute steps; whole days sideways in Week view);
 * a press without movement opens the block. Started blocks don't drag.
 */
import { useRef, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { dragStartMs, layoutIntervals, type CalendarPlanBlock } from "@/lib/task-plan/calendar-view";
import { pinBlockAction } from "./plan-actions";

const RISK: CSSProperties = { display: "block", marginTop: 1, fontSize: 9.5, fontWeight: 700, color: "#b4543a" };
type Drag = { key: string; x0: number; y0: number; dx: number; dy: number; colPx: number };

function minuteOf(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

export default function TaskBlockLayer({
  blocks,
  hourStart,
  hourPx,
  dayCount,
  showOwner,
  onOpen,
}: {
  blocks: CalendarPlanBlock[];
  hourStart: number;
  hourPx: number;
  dayCount: number;
  showOwner: boolean;
  onOpen: (b: CalendarPlanBlock) => void;
}) {
  const router = useRouter();
  const layerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function drop(b: CalendarPlanBlock, d: Drag) {
    const startMs = dragStartMs({ startMs: b.startMs, dyPx: d.dy, dxPx: d.dx, hourPx, colPx: d.colPx, dayCount });
    if (startMs === b.startMs) return;
    start(async () => {
      setError(null);
      const r = await pinBlockAction({ kind: b.kind, id: b.id, fromStartMs: b.pinned ? b.startMs : null, startMs, minutes: Math.round((b.endMs - b.startMs) / 60_000) });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div ref={layerRef} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {error && (
        <div role="alert" style={{ position: "absolute", top: 2, left: 2, right: 2, zIndex: 3, pointerEvents: "auto", fontSize: 10.5, color: "#a03b2e", background: "#fbefe9", border: "1px solid #f1d6ca", borderRadius: 5, padding: "2px 5px" }}>
          {error}
        </div>
      )}
      {layoutIntervals(blocks).map(({ it: b, col, cols }) => {
        const startMin = minuteOf(b.startMs);
        const endMin = Math.max(startMin + 15, minuteOf(b.endMs) || 24 * 60);
        const top = ((startMin - hourStart * 60) / 60) * hourPx;
        const height = Math.max(16, ((endMin - startMin) / 60) * hourPx);
        const label = `${b.pinned ? "📌 " : ""}${showOwner && b.initials ? b.initials + " · " : ""}${b.title}`;
        const mine = drag?.key === b.key ? drag : null;
        return (
          <button
            key={b.key}
            type="button"
            disabled={pending}
            onClick={(e) => {
              e.stopPropagation();
              if (e.detail === 0) onOpen(b); // keyboard activation; pointer presses open on pointer-up
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (!b.draggable) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              setDrag({ key: b.key, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, colPx: layerRef.current?.getBoundingClientRect().width ?? 0 });
            }}
            onPointerMove={(e) => {
              if (mine) setDrag({ ...mine, dx: e.clientX - mine.x0, dy: e.clientY - mine.y0 });
            }}
            onPointerUp={(e) => {
              e.stopPropagation();
              const d = mine;
              setDrag(null);
              if (!d || (Math.abs(d.dx) < 4 && Math.abs(d.dy) < 4)) {
                onOpen(b);
                return;
              }
              drop(b, d);
            }}
            onPointerCancel={() => setDrag(null)}
            title={label + (b.atRiskLabel ? " · " + b.atRiskLabel : "") + (b.draggable ? " · drag to pin" : "")}
            style={{
              position: "absolute",
              top,
              height,
              left: `calc(${(col / cols) * 100}% + 2px)`,
              width: `calc(${100 / cols}% - 4px)`,
              transform: mine ? `translate(${mine.dx}px, ${mine.dy}px)` : undefined,
              zIndex: mine ? 2 : undefined,
              textAlign: "left",
              background: "color-mix(in srgb, var(--accent) 9%, #fff)",
              border: `1px dashed ${b.atRiskLabel ? "#e0b2a3" : "color-mix(in srgb, var(--accent) 40%, #fff)"}`,
              color: "#3a3f4a",
              borderRadius: 5,
              padding: "2px 5px",
              fontFamily: "var(--font-ui)",
              fontSize: 10.5,
              fontWeight: 600,
              overflow: "hidden",
              pointerEvents: "auto",
              touchAction: b.draggable ? "none" : undefined,
              cursor: b.draggable ? (mine ? "grabbing" : "grab") : "pointer",
            }}
          >
            {label}
            {b.atRiskLabel && <span style={RISK}>{b.atRiskLabel}</span>}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Implement `src/app/(app)/calendar/at-risk-panel.tsx`**

```tsx
"use client";

/**
 * Spec 2026-10-09 auto task calendar — the at-risk list with one-click
 * fixes: Push due date (to the plan's finish day), Hand off (reassign), and
 * Unpin something (frees pinned time for the scheduler).
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CalendarAtRisk, CalendarFuturePin } from "@/lib/task-plan/calendar-view";
import { handOffAction, pushDueDateAction, unpinBlockAction } from "./plan-actions";

type Result = { ok: true } | { ok: false; error: string };
const when = (ms: number) => new Date(ms).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
const BTN = { fontSize: 11.5, padding: "4px 9px" } as const;

export default function AtRiskPanel({
  items,
  futurePins,
  roster,
  showOwner,
}: {
  items: CalendarAtRisk[];
  futurePins: CalendarFuturePin[];
  roster: { id: string; name: string }[];
  showOwner: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [openUnpin, setOpenUnpin] = useState<string | null>(null);
  const [handTo, setHandTo] = useState<Record<string, string>>({});
  if (!items.length) return null;

  const run = (fn: () => Promise<Result>) =>
    start(async () => {
      setError(null);
      let r: Result;
      try {
        r = await fn();
      } catch {
        r = { ok: false, error: "Couldn't save — try again." };
      }
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });

  return (
    <section className="pk-card" aria-label="At risk" style={{ padding: "12px 14px", marginBottom: 14, borderLeft: "3px solid #b4543a" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#8a3a2a", marginBottom: 6 }}>At risk ({items.length})</div>
      {error && <div role="alert" style={{ fontSize: 12, color: "#a03b2e", marginBottom: 6 }}>{error}</div>}
      {items.map((a) => {
        const others = roster.filter((u) => u.id !== a.userId);
        const pins = futurePins.filter((p) => p.userId === a.userId);
        const target = handTo[a.itemKey] ?? others[0]?.id ?? "";
        const day = a.finishDayKey;
        return (
          <div key={a.itemKey} style={{ borderTop: "1px solid #f3f4f7", padding: "8px 0", display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <div style={{ flex: "1 1 220px", minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                {a.href ? <Link href={a.href}>{a.title}</Link> : a.title}
                {showOwner && <span style={{ color: "#8c919c", fontWeight: 500 }}> · {a.ownerName}</span>}
              </div>
              <div style={{ fontSize: 11, color: "#b4543a" }}>
                {a.label} · {a.finishText}
              </div>
            </div>
            {day && (
              <button type="button" className="pk-btn-outline" style={BTN} disabled={pending} onClick={() => run(() => pushDueDateAction({ kind: a.kind, id: a.id, dayKey: day }))}>
                Push due date
              </button>
            )}
            {others.length > 0 && (
              <span style={{ display: "inline-flex", gap: 4 }}>
                <select aria-label="Hand off to" value={target} onChange={(e) => setHandTo((m) => ({ ...m, [a.itemKey]: e.target.value }))} style={{ fontSize: 11.5, border: "1px solid #e4e7ec", borderRadius: 7, padding: "3px 6px" }}>
                  {others.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
                <button type="button" className="pk-btn-outline" style={BTN} disabled={pending || !target} onClick={() => run(() => handOffAction({ kind: a.kind, id: a.id, userId: target }))}>
                  Hand off
                </button>
              </span>
            )}
            {pins.length > 0 && (
              <button type="button" className="pk-btn-outline" style={BTN} aria-expanded={openUnpin === a.itemKey} onClick={() => setOpenUnpin(openUnpin === a.itemKey ? null : a.itemKey)}>
                Unpin something
              </button>
            )}
            {openUnpin === a.itemKey && (
              <ul style={{ flex: "1 0 100%", listStyle: "none", margin: 0, padding: "4px 0 0 0" }}>
                {pins.map((p) => (
                  <li key={p.itemKey + "@" + p.startMs} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11.5, padding: "2px 0" }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      📌 {p.title} · {when(p.startMs)}
                    </span>
                    <button type="button" className="pk-btn-outline" style={BTN} disabled={pending} onClick={() => run(() => unpinBlockAction({ kind: p.kind, id: p.id, startMs: p.startMs }))}>
                      Unpin
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}
```

- [ ] **Step 5: Show the panel in `src/app/(app)/calendar/calendar-client.tsx`**

Add `import AtRiskPanel from "./at-risk-panel";` next to the Task 9 imports, delete the temporary `void roster;` line, and directly after the `{plan.notes.map(…)}` block add:

```tsx
      <AtRiskPanel items={plan.atRisk} futurePins={plan.futurePins} roster={roster} showOwner={tasksEveryone} />
```

- [ ] **Step 6: Run the gates**

`npx tsc --noEmit` → PASS · `env -u DATABASE_URL npm run test:specs` → `ALL PASSED` · `npx eslint --ignore-pattern scripts/test-review-and-spec.ts "src/app/(app)/calendar/task-block-layer.tsx" "src/app/(app)/calendar/at-risk-panel.tsx" "src/app/(app)/calendar/calendar-client.tsx" scripts/test-auto-calendar.ts` → clean · `npm run build` → succeeds.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/calendar/task-block-layer.tsx" "src/app/(app)/calendar/at-risk-panel.tsx" "src/app/(app)/calendar/calendar-client.tsx" scripts/test-auto-calendar.ts scripts/test-review-and-spec.ts
git commit -m "feat(calendar): drag a task block to pin it; At risk panel with push, hand off, unpin

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Home "Today" card

**Files:**
- Create: `src/lib/task-plan/today.ts`, `src/app/(app)/home-today.tsx`
- Modify: `src/lib/dashboard/registry.ts`, `src/lib/dashboard/data.ts`, `src/app/(app)/_dashboard/widgets/home-cards.tsx`, `scripts/test-auto-calendar.ts`, `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `loadTaskPlans`, `savePlanPins` (Task 7); `fmtBlockTime` (Task 4); `chicagoDayKey`; `CardHeadTitle` (`home-shared.tsx`); `after` (`next/server`).
- Produces: `today.ts`: `type TodayRow = { key; time; title; href; pinned: boolean; atRisk: boolean }`; `todayRows(result: PlanResult, nowMs): TodayRow[]`. Widget id `"today-plan"` (title `Today`, size `half`, surface home, in the Home preset right after `my-queue`). `DashboardData.taskPlan(): Promise<PersonPlan | null>`.

- [ ] **Step 1: Write the failing tests**

Add to the imports of `scripts/test-auto-calendar.ts`:

```ts
import { presetFor, widgetDef } from "@/lib/dashboard/registry";
import { todayRows } from "@/lib/task-plan/today";
```

Append:

```ts
/* ---- Task 11: Home Today card ---- */
export async function autoCalHomeChecks(ok: Ok): Promise<void> {
  ok(widgetDef("today-plan")?.title === "Today" && !!widgetDef("today-plan")?.surfaces.includes("home") && presetFor("home", ["Admin"]).includes("today-plan"),
    "auto-cal home: a Today card on Home");
  const r = planPerson(baseInput({ items: [item("A"), item("B", { createdAt: 2 })] }));
  const rows = todayRows(r, at(MON, 7));
  ok(rows.length === 2 && rows[0].time === "8:00–9:00" && rows[1].time === "9:00–10:00" && rows.every((x) => !x.pinned && !x.atRisk), "auto-cal home: today's blocks in order with their times");
  ok(todayRows(r, at(TUE, 7)).length === 0, "auto-cal home: only today's blocks");
  const cards = readFileSync("src/app/(app)/_dashboard/widgets/home-cards.tsx", "utf8");
  ok(cards.includes('"today-plan"') && /savePlanPins\(/.test(cards) && readFileSync("src/app/(app)/home-today.tsx", "utf8").includes("/calendar?view=day"),
    "auto-cal home: the card links to the day view and saves the plan's pins");
}
```

Chain: merge `autoCalHomeChecks`; add `.then(() => autoCalHomeChecks(ok))` after `.then(() => autoCalDragPanelChecks(ok))`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsc --noEmit`
Expected: FAIL — `Cannot find module '@/lib/task-plan/today'`.

- [ ] **Step 3: Implement `src/lib/task-plan/today.ts`**

```ts
/** Home "Today" card rows (spec Part 3 "At risk" → Home card). Pure, client-safe. */
import { chicagoDayKey } from "@/lib/drive-plan/day";
import { fmtBlockTime } from "./labels";
import type { PlanResult } from "./types";

export type TodayRow = { key: string; time: string; title: string; href: string; pinned: boolean; atRisk: boolean };

export function todayRows(r: PlanResult, nowMs: number): TodayRow[] {
  const today = chicagoDayKey(nowMs);
  return r.blocks
    .filter((b) => chicagoDayKey(b.startMs) === today)
    .sort((a, b) => a.startMs - b.startMs || (a.key < b.key ? -1 : 1))
    .map((b) => ({ key: b.key, time: fmtBlockTime(b.startMs, b.endMs), title: b.title, href: b.href, pinned: !!b.pinned, atRisk: b.atRisk }));
}
```

- [ ] **Step 4: Implement `src/app/(app)/home-today.tsx`**

```tsx
import Link from "next/link";
import { CardHeadTitle } from "./home-shared";
import type { TodayRow } from "@/lib/task-plan/today";

/**
 * Home "Today" card (spec 2026-10-09 auto task calendar, Part 3): today's
 * planned task blocks in order and the at-risk count, linking to the day
 * view. Server component; rows are resolved by the widget renderer.
 */
export default function HomeToday({ rows, atRiskCount, note }: { rows: TodayRow[]; atRiskCount: number; note: string | null }) {
  return (
    <div className="pk-card" style={{ overflow: "hidden", marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "15px 17px 12px", borderBottom: "1px solid #f0f1f4" }}>
        <CardHeadTitle>Today</CardHeadTitle>
        <Link href="/calendar?view=day" style={{ fontSize: 12, color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>
          Open day view →
        </Link>
      </div>
      {atRiskCount > 0 && (
        <Link href="/calendar?view=day" style={{ display: "block", padding: "8px 17px", fontSize: 12.5, fontWeight: 700, color: "#b4543a", background: "#fbefe9", textDecoration: "none" }}>
          {atRiskCount} at risk
        </Link>
      )}
      {note && (
        <div role="status" style={{ padding: "6px 17px", fontSize: 11.5, color: "#8a5a1a", background: "#fdf3e7" }}>
          {note}
        </div>
      )}
      {rows.length === 0 ? (
        <div style={{ padding: "16px 17px", fontSize: 12.5, color: "#9aa0ab" }}>Nothing planned for today.</div>
      ) : (
        rows.map((r) => (
          <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 17px", borderTop: "1px solid #f6f7f9" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#5b616e", minWidth: 86 }}>{r.time}</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {r.pinned ? "📌 " : ""}
              {r.href ? <Link href={r.href}>{r.title}</Link> : r.title}
            </span>
            {r.atRisk && <span style={{ fontSize: 10.5, fontWeight: 700, color: "#b4543a" }}>At risk</span>}
          </div>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 5: Register the widget**

In `src/lib/dashboard/registry.ts`, in `WIDGETS` right after the `my-queue` entry, add:

```ts
  { id: "today-plan", title: "Today", desc: "Today's planned task blocks and anything at risk.", size: "half", timeframe: "none", surfaces: HOME },
```

and in `PRESETS.home` insert `"today-plan"` right after `"my-queue"`.

In `src/lib/dashboard/data.ts`, add `import { loadTaskPlans } from "@/lib/task-plan/load";` and, after the `agenda:` line, add:

```ts
    taskPlan: once(async () => {
      const plans = await loadTaskPlans({ userIds: [user.id], meId: user.id }).catch((err) => {
        console.error("[task-plan] home plan failed:", err);
        return [];
      });
      return plans[0] ?? null;
    }),
```

In `src/app/(app)/_dashboard/widgets/home-cards.tsx`, add the imports:

```ts
import { after } from "next/server";
import { savePlanPins } from "@/lib/task-plan/load";
import { todayRows } from "@/lib/task-plan/today";
import HomeToday from "../../home-today";
```

and, right after the `"my-queue"` renderer, add:

```tsx
  /* ---- Today (spec 2026-10-09 auto task calendar) — computing the plan
     saves its new started pins after the response, like /calendar ---- */
  "today-plan": async (ctx) => {
    const plan = await ctx.data.taskPlan();
    if (plan) after(() => savePlanPins([plan]));
    return <HomeToday rows={plan ? todayRows(plan.result, ctx.now) : []} atRiskCount={plan?.result.atRisk.length ?? 0} note={plan?.note ?? null} />;
  },
```

- [ ] **Step 6: Run the gates**

`npx tsc --noEmit` → PASS (the `RENDERERS` record now requires `today-plan`, satisfied) · `env -u DATABASE_URL npm run test:specs` → `ALL PASSED` · `npx eslint --ignore-pattern scripts/test-review-and-spec.ts src/lib/task-plan/today.ts "src/app/(app)/home-today.tsx" src/lib/dashboard/registry.ts src/lib/dashboard/data.ts "src/app/(app)/_dashboard/widgets/home-cards.tsx" scripts/test-auto-calendar.ts` → clean · `npm run build` → succeeds. Also run `npx tsx scripts/test-review-regressions.ts` ONLY if the harness runner documents it as DB-free; otherwise leave the `#43 preset ids` regression to `test:smoke`/CI (it compares against `presetFor`, which now includes the new id on both sides).

- [ ] **Step 7: Commit**

```bash
git add src/lib/task-plan/today.ts "src/app/(app)/home-today.tsx" src/lib/dashboard/registry.ts src/lib/dashboard/data.ts "src/app/(app)/_dashboard/widgets/home-cards.tsx" scripts/test-auto-calendar.ts scripts/test-review-and-spec.ts
git commit -m "feat(home): Today card — today's planned blocks and the at-risk count

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Tier/size chips on every task form

**Files:**
- Modify: `src/components/tasks-card.tsx`, `src/app/(app)/projects/actions.ts`, `src/app/(app)/estimator/actions.ts`, `src/app/(app)/design/designs/actions.ts`, `src/lib/inbox-task.ts`, `src/app/(app)/inbox/task-dialog.tsx`, `src/lib/krisp/write-back.ts`, `src/app/(app)/recordings/actions.ts`, `src/app/(app)/recordings/[id]/detail-client.tsx`, `src/app/(app)/queue/actions.ts`, `src/app/(app)/queue/view.tsx`, `scripts/test-auto-calendar.ts`, `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `TierSizeChips` (Task 9); `readTierSize`, `tierSizeOf` (Task 1); `TaskTier`, `TaskSize`.
- Produces: `ThreadTaskRequest.priority?: string; size?: string` (`buildThreadTaskInput` sets valid ones); `acceptActionItem(rec, key, assigneeUserId, dueAt, byName, tierSize?: { priority?: unknown; size?: unknown })`; `acceptActionItemAction(id, key, assigneeUserId, dueAt, tierSize?: { priority?: string; size?: string })`; `createAssignmentAction` input gains `priority?: string; size?: string`. Project/quote/design add + edit actions read the chips.

- [ ] **Step 1: Write the failing tests**

Add to the imports of `scripts/test-auto-calendar.ts`:

```ts
import { buildThreadTaskInput } from "@/lib/inbox-task";
```

Append:

```ts
/* ---- Task 12: task forms ---- */
export async function autoCalFormChecks(ok: Ok): Promise<void> {
  const args = (priority: string, size: string) => ({
    req: { threadId: "C-1", title: "Call back", notes: "", assigneeUserId: "u1", dueDate: "", linkKeys: [], priority, size },
    candidates: [{ key: "thread", kind: "thread" as const, id: "C-1" }],
    workLabel: "",
    roster: [{ id: "u1", name: "Dana" }],
    me: { id: "u1", name: "Dana" },
  });
  const built = buildThreadTaskInput(args("high", "l"));
  ok(built.ok && built.input.priority === "high" && built.input.size === "l", "auto-cal forms: the email-task dialog's chips reach the task");
  const junk = buildThreadTaskInput(args("urgent", ""));
  ok(junk.ok && !("priority" in junk.input) && !("size" in junk.input), "auto-cal forms: junk chip values are ignored");
  const rd = (f: string) => readFileSync(f, "utf8");
  for (const f of ["src/components/tasks-card.tsx", "src/app/(app)/inbox/task-dialog.tsx", "src/app/(app)/recordings/[id]/detail-client.tsx", "src/app/(app)/queue/view.tsx", "src/app/(app)/calendar/task-block-popover.tsx"]) {
    ok(rd(f).includes("<TierSizeChips"), `auto-cal forms: ${f} offers High/Normal/Low and S/M/L`);
  }
  for (const f of ["src/app/(app)/projects/actions.ts", "src/app/(app)/estimator/actions.ts", "src/app/(app)/design/designs/actions.ts"]) {
    ok((rd(f).match(/readTierSize\(formData\)/g) ?? []).length >= 2, `auto-cal forms: ${f} reads the chips on add and on edit`);
  }
  ok(/priority: input\?\.priority/.test(rd("src/app/(app)/queue/actions.ts")) && /priority: tierSize\?\.priority/.test(rd("src/lib/krisp/write-back.ts")),
    "auto-cal forms: Queue and meeting to-dos pass the chips to createAssignment");
  ok(rd("src/app/(app)/inbox/task-dialog.tsx").includes("due in a week"), "auto-cal forms: the email-task help text says a blank date means due in a week");
}
```

Chain: merge `autoCalFormChecks`; add `.then(() => autoCalFormChecks(ok))` after `.then(() => autoCalHomeChecks(ok))`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsc --noEmit`
Expected: FAIL — `priority` does not exist on type `ThreadTaskRequest`.

- [ ] **Step 3: The email-task builder (`src/lib/inbox-task.ts`)**

Add `import { tierSizeOf } from "@/lib/task-plan/fields";`. In `type ThreadTaskRequest`, after `linkKeys: string[];`, add:

```ts
  /** Spec 2026-10-09 auto task calendar — the High/Normal/Low and S/M/L chips. */
  priority?: string;
  size?: string;
```

In `buildThreadTaskInput`, in the `const input: … = { … }` literal, after `dueAt,` add `...tierSizeOf(req),`.

- [ ] **Step 4: The email-task dialog (`src/app/(app)/inbox/task-dialog.tsx`)**

Add the imports:

```ts
import TierSizeChips from "@/components/task-plan/tier-size-chips";
import type { TaskSize, TaskTier } from "@/lib/task-plan/types";
```

Next to the other `useState` hooks add:

```ts
  const [tier, setTier] = useState<TaskTier>("normal");
  const [size, setSize] = useState<TaskSize>("m");
```

In `save()`'s `createTaskFromThreadAction({ … })` call, after `linkKeys: Array.from(ticked),` add `priority: tier, size,`. Directly after the due-date field's wrapping `</div>` (the one containing `id="task-due"`) and before the help text, add:

```tsx
        <div style={{ marginTop: 10 }}>
          <TierSizeChips tier={tier} size={size} onTier={setTier} onSize={setSize} disabled={pending} />
        </div>
```

Replace the help text `Shows on the calendar on its due date. With no date, or once overdue, it floats on today until it’s done or deleted.` with:

```
No date? It’s due in a week. The calendar plans time for it before its due date.
```

(the check looks for `due in a week` — keep that phrase lowercase as written: change the sentence to `No date? It’s due in a week — the calendar plans time for it before then.` if you prefer, but it must contain `due in a week`.)

- [ ] **Step 5: The shared tasks card (`src/components/tasks-card.tsx`)**

Add the imports:

```ts
import TierSizeChips from "@/components/task-plan/tier-size-chips";
import type { TaskSize, TaskTier } from "@/lib/task-plan/types";
```

In `TasksCard`, after `const [addError, setAddError] = useState<string | null>(null);` add:

```ts
  const [newTier, setNewTier] = useState<TaskTier>("normal");
  const [newSize, setNewSize] = useState<TaskSize>("m");
  async function saveChip(taskId: string, field: "priority" | "size", value: string) {
    const fd = new FormData();
    fd.set("taskId", taskId);
    fd.set("id", parentId);
    fd.set(field, value);
    await updateAction(fd);
    router.refresh();
  }
```

In each task row, right after the closing `</form>` of the `updateAction` form (the assignee + date form), add:

```tsx
                <TierSizeChips
                  tier={t.priority ?? "normal"}
                  size={t.size ?? "m"}
                  onTier={(v) => saveChip(t.id, "priority", v)}
                  onSize={(v) => saveChip(t.id, "size", v)}
                />
```

In the add form, right after `<input type="date" name="dueAt" style={dateInputStyle} />`, add:

```tsx
        <TierSizeChips tier={newTier} size={newSize} onTier={setNewTier} onSize={setNewSize} />
        <input type="hidden" name="priority" value={newTier} />
        <input type="hidden" name="size" value={newSize} />
```

and in the add form's `onSubmit`, after `form.reset();` add `setNewTier("normal"); setNewSize("m");`.

- [ ] **Step 6: The three parents' actions**

In each of `src/app/(app)/projects/actions.ts` (`addTaskAction`, `updateTaskAction`), `src/app/(app)/estimator/actions.ts` (`addQuoteTaskAction`, `updateQuoteTaskAction`) and `src/app/(app)/design/designs/actions.ts` (`addDesignTaskAction`, `updateDesignTaskAction`):

- add `import { readTierSize } from "@/lib/task-plan/fields";`
- in the add action's `createTask({ … }, me)` input object, add `...readTierSize(formData),` as its last property;
- in the update action, right before the `updateTask(…)`/`updateTaskStore(taskId, patch)` call, add `Object.assign(patch, readTierSize(formData));`.

- [ ] **Step 7: Meeting to-dos (Recordings)**

In `src/lib/krisp/write-back.ts`, give `acceptActionItem` a sixth parameter `tierSize?: { priority?: unknown; size?: unknown }` and add to its `createAssignment({ … })` call:

```ts
    priority: tierSize?.priority,
    size: tierSize?.size,
```

In `src/app/(app)/recordings/actions.ts`, give `acceptActionItemAction` a fifth parameter `tierSize?: { priority?: string; size?: string }` and pass it: `acceptActionItem(rec, key, assigneeUserId, dueAt, user.name, tierSize)`.

In `src/app/(app)/recordings/[id]/detail-client.tsx`, add the `TierSizeChips` + `TaskTier`/`TaskSize` imports; in the action-item row component, next to `const [due, setDue] = …`, add:

```ts
  const [tier, setTier] = useState<TaskTier>("normal");
  const [size, setSize] = useState<TaskSize>("m");
```

In the `pending ? (<> … </>)` branch, right after the `<input type="date" … />`, add `<TierSizeChips tier={tier} size={size} onTier={setTier} onSize={setSize} disabled={busy} />`, and change the Accept call to `acceptActionItemAction(rec.id, item.key, assignee || null, due ? dateInputToMs(due) : null, { priority: tier, size })`.

- [ ] **Step 8: The Queue assignment form**

In `src/app/(app)/queue/actions.ts`, add `priority?: string; size?: string;` to `createAssignmentAction`'s input type and to its `createAssignment({ … })` call add:

```ts
      priority: input?.priority,
      size: input?.size,
```

In `src/app/(app)/queue/view.tsx`, add the `TierSizeChips` + types imports, the two `useState` hooks (`tier` "normal", `size` "m"), pass `priority: tier, size,` in `createAssignmentAction({ … })`, reset both after a successful add (`setTier("normal"); setSize("m");`), and render `<TierSizeChips tier={tier} size={size} onTier={setTier} onSize={setSize} />` right after the date `<input>` in the "Assign something" row.

- [ ] **Step 9: Run the gates**

`npx tsc --noEmit` → PASS · `env -u DATABASE_URL npm run test:specs` → `ALL PASSED` (incl. the pre-existing `#215 build:` checks) · `npx eslint --ignore-pattern scripts/test-review-and-spec.ts src/components/tasks-card.tsx "src/app/(app)/projects/actions.ts" "src/app/(app)/estimator/actions.ts" "src/app/(app)/design/designs/actions.ts" src/lib/inbox-task.ts "src/app/(app)/inbox/task-dialog.tsx" src/lib/krisp/write-back.ts "src/app/(app)/recordings/actions.ts" "src/app/(app)/recordings/[id]/detail-client.tsx" "src/app/(app)/queue/actions.ts" "src/app/(app)/queue/view.tsx" scripts/test-auto-calendar.ts` → clean · `npm run build` → succeeds.

- [ ] **Step 10: Commit**

```bash
git add src/components/tasks-card.tsx "src/app/(app)/projects/actions.ts" "src/app/(app)/estimator/actions.ts" "src/app/(app)/design/designs/actions.ts" src/lib/inbox-task.ts "src/app/(app)/inbox/task-dialog.tsx" src/lib/krisp/write-back.ts "src/app/(app)/recordings/actions.ts" "src/app/(app)/recordings/[id]/detail-client.tsx" "src/app/(app)/queue/actions.ts" "src/app/(app)/queue/view.tsx" scripts/test-auto-calendar.ts scripts/test-review-and-spec.ts
git commit -m "feat(tasks): High/Normal/Low and S/M/L chips on every task form

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Final gates + docs (DECISIONS, PUNCHLIST, AGENTS)

**Files:**
- Modify: `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md`

**Interfaces:**
- Consumes: everything above.
- Produces: decision entries, punch item (expected **#327**), an AGENTS.md phase entry.

- [ ] **Step 1: Recompute numbers from origin/main**

```bash
git fetch origin
git show origin/main:DECISIONS.md | grep -oE '^#+ *D[0-9]+' | grep -oE '[0-9]+' | sort -n | tail -1
git show origin/main:PUNCHLIST.md | grep -oE '#[0-9]{3}' | grep -oE '[0-9]+' | sort -n | tail -1
```

Next D = highest + 1 (call it `Dn`); punch = highest + 1 (expected 327). If origin/main moved since the branch base, `git merge origin/main` first and re-run every gate.

- [ ] **Step 2: DECISIONS.md — one entry each, in this order (`Dn` … `Dn+8`)**

Use the file's existing entry format. Content:

1. **Blended urgency curve.** weight = tier factor (High 3 · Normal 2 · Low 1) × 1/(days left + 1), Chicago calendar days; compared as integer cross-products. Overdue first, most overdue first, then tier; ties earlier due → older createdAt → item key. A Low due tomorrow (1/2) beats a High next week (3/8) and next month (3/31). Pinned by `auto-cal urgency:` checks.
2. **Pins live in a per-person blob**, `task_pins:<userId>` (the schedule-prefs idiom), one key per pin `<itemKey>@<startMs>` → `{ endMs, kind }` — not a `planPins` field on the record as the spec's table sketches. Pins belong to a calendar, so a hand-off leaves them behind and they are cleared; concurrent adds can't lose each other; no record write (and no `updatedAt` bump or Google Tasks sync) on every page view.
3. **The plan starts at the current quarter-hour (now rounded down).** Rounding up (the spec's wording) would make "a block that has already begun" unreachable at compute time; rounding down makes the block on screen right now the one that locks as `started`.
4. **+7 only for assigned items; stamped 5:00 pm Chicago.** An unassigned checklist row isn't planned and, once overdue, would reach every bell (`taskBellItems` shows anyone's overdue task). 5 pm keeps the UTC date (what Google Tasks shows) equal to the Chicago day. The planner's deadline is the end of the due's Chicago day. Undated assigned items plan as due createdAt + 7 (virtual, not stored).
5. **Blocked tasks are not planned** ("open" = Open or In progress) — they can't be worked; they keep their #215 calendar chip.
6. **Unfinished remainder:** size − pinned minutes so far, at least 30 min, pinned at the first work day on/after the day after its last pin; a task still open after its whole size gets another 30 minutes each morning.
7. **In progress pins the item's current (first) block**, at the next plan compute (any view or the morning cron) — the same known limit the spec states for started blocks.
8. **Everyone view reads each person's Google calendar** (8-week window, 6 s timeout each, in parallel); a person whose calendar is unreadable or not connected is planned without it, with `Planned without <name>'s Google calendar — may overlap meetings`. "No calendar connected" shows the same note as "can't be read".
9. **The morning cron computes plans through `TRIAGE_HOOKS.atRisk`** (no new rider on the full 60 s daily trigger); the Home "Today" card joins the Home preset after My Queue (spec'd card; customized layouts add it from the gallery).

- [ ] **Step 3: PUNCHLIST.md — punch #327 (recomputed)**

Add a shipped entry in the file's format: "Auto task calendar (spec 3)" — tasks/assignments planned into free work time (80 %, 15-min grid, ≥ 30-min chunks, 8-week horizon), blended urgency, pins only (`started`/`hand`, blob `task_pins:<userId>`), `/calendar` Week/Day blocks with drag-to-pin + Unpin + popover, Month chips from the plan, At risk badge + panel (Push due date / Hand off / Unpin something), Home "Today" card, triage at-risk hook, tier/size chips on every task form, +7 default due date, Decisions `Dn`–`Dn+8`. **Jeff-gated:** (1) back up prod (`DATABASE_URL=… npm run db:export`), run `DATABASE_URL=… npm run tasks:backfill-due` (dry run, review the per-person counts), then `-- --apply --yes`; (2) set company/personal work hours if Mon–Fri 8–5 isn't right (spec 2 settings); (3) try a drag and an At risk fix on production.

- [ ] **Step 4: AGENTS.md — phase entry**

Append to "Phase status" (next number after the last entry): `✅ **Auto task calendar** (#327, Dn–Dn+8) — a pure planner (src/lib/task-plan/, planPerson) places every open assigned task and Queue assignment into each person's free work time (spec-2 work hours minus visits, spec-1 drive blocks, accepted timed Google events and pins; 80 %, 15-min grid, ≥ 30-min chunks, 8 weeks) by blended urgency (tier × 1/(days left + 1), overdue first); only started/hand pins are stored (blob task_pins:<userId>, src/lib/stores/task-pins.ts), computed on every view (savePlanPins in after()) and by morning triage's atRisk hook. /calendar Week/Day draws blocks (drag pins, Unpin, popover), Month chips come from the plan, At risk panel + Home "Today" card; tier/size chips on every task form; +7 default due date; one-time npm run tasks:backfill-due. Task blocks are app-only. Remaining is Jeff-gated: the production backfill and work-hours review.`

- [ ] **Step 5: Final gates (report real numbers)**

```bash
npx tsc --noEmit
df -h . && env -u DATABASE_URL npm run test:specs
npx eslint --ignore-pattern scripts/test-review-and-spec.ts $(git diff --name-only origin/main...HEAD -- '*.ts' '*.tsx' | tr '\n' ' ')
npm run build
ps aux | grep -E "next dev|tsx" | grep -v grep   # must be empty before smoke
npm run test:smoke
```

Expected: tsc clean; `ALL PASSED` with the count of `auto-cal` lines reported; eslint 0 errors; build succeeds; smoke passes (report its route count).

- [ ] **Step 6: Commit**

```bash
git add DECISIONS.md PUNCHLIST.md AGENTS.md
git commit -m "docs: auto task calendar (#327) — decisions, punch item, phase status

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review (done while writing)

**Spec coverage.** Part 1 "What is scheduled" → Task 7 `planItemsByPerson` (checklist/template tasks included, blocked excluded — D-entry 5). New fields → Task 1 (`priority`/`size` on records) + Task 6 (pins in a blob — D-entry 2). Form chips → Task 12 (tasks card rows + add, email-task dialog, meeting to-do accept, Queue form) + Task 9 popover (the "task drawer" for a block). Due dates → Task 2 (+7 in `createTask`/`createAutoTask`/`createAssignment`; backfill dry run/apply/idempotent; template `startAt` = earliest start, tested in Task 4). Visibility Mine/Everyone → Task 9 (`?tasks=all` → `"everyone"`). Part 2 engine pure/deterministic → Tasks 4–5 (determinism check); computed on view (Tasks 9, 11) and morning cron (Task 7 hook). Free time → Task 7 loader + Task 4 `freeDays` (80 %, horizon 56 days). Ordering → Task 3. Placement (grid, chunks, at risk late) → Task 4. Pins (started on compute, in progress, hand, never move, unfinished remainder, done/deleted clear) → Tasks 5, 6, 8. Part 3 calendar blocks/drag/unpin/month chips → Tasks 9–10. At risk badge/panel/Home card → Tasks 9, 10, 11. Google app-only → Task 7 check (no value import of the calendar module in the planner). Failures (unreadable calendar note, no work hours → company default via spec 2's `workHoursFor`) → Task 7. Testing list → each task's checks. Triage seam (`TRIAGE_HOOKS.atRisk`, `normalizeTask` carries `priority`) → Tasks 1 and 7.

**Placeholder scan.** No TBD/TODO; every code step has code. Two conditional instructions are concrete rules, not placeholders: spec-2 renames ("follow the rename") and pre-existing assertions changed by the +7 rule (the one known case is given exactly).

**Type consistency.** `planItemKey`/`PlanPin`/`PlanBlock.key` (`<itemKey>@<startMs>`) = `pinBlobKey`; `PersonPlan` (Task 7) satisfies `PlanForView` (Task 9) structurally; `WriteResult` (Task 8) matches the `Result` type the client components expect; `TaskPlanDeps`/`PinStore` names match between `load.ts`, `triage.ts` and tests; `CalendarPlanBlock.draggable`/`canUnpin` are set in Task 9 and used in Task 10.
