# Tasks from Email + Tasks on the Calendar (#215) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a task from an email (links to the people, company, venue, work record and thread; notes; assignee; due date), list a thread's open tasks in the Inbox sidebar, and show every open task + My Queue assignment on `/calendar`, floating undated/overdue ones on today until they are completed or deleted.

**Architecture:** `TaskRecord` (JSONB doc, no migration) gains five optional link fields. Two new pure modules hold all the rules: `src/lib/calendar-tasks.ts` (placement planner + normalizers, type-only imports, used by the server loader and the client calendar) and `src/lib/inbox-task.ts` (link candidates, request validation, default notes, sidebar rows). Server-only halves live in `src/lib/calendar-tasks-load.ts` and `src/lib/inbox-task-write.ts` (DAL split — `"use server"` actions are `requireUser()` + delegate). Client components receive data via props and call server actions; they never import a store.

**Tech Stack:** Next.js 16 App Router (server components + server actions), TypeScript, doc-store on PGlite/Postgres, the `scripts/test-review-and-spec.ts` assertion harness (`npm run test:specs`).

**Spec:** `docs/superpowers/specs/2026-09-26-inbox-link-popup-tasks-calendar-design.md`, section "#215".

## Global Constraints

- Work only in `/Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks` (branch `feat/punch-inbox-tasks`). Every shell starts with `export PATH=$HOME/.local/node/bin:$PATH`.
- **#214 lands first.** Task 4 depends on it: `CommThread.linkedContactIds?: string[]` in `src/lib/stores/comms.ts`, and `src/app/(app)/inbox/link-popup.tsx` whose footer takes `onCreateTask?: () => void`. Task 4 Step 1 verifies both; if either is missing, stop and report.
- No DB migrations: `tasks`, `assignments`, `comms` are JSONB doc tables. New fields are optional; old docs must read unchanged.
- Client components (`"use client"`) never import a value from `@/lib/stores/*`, `@/db/*`, `@/lib/users`, `@/lib/calendar-tasks-load` or `@/lib/inbox-task-write` (`import type` is fine). Only `next build` catches a violation, so UI tasks run it.
- Every server action calls `requireUser()` (from `@/lib/session`) before touching data.
- Deterministic only — no AI (D89).
- Timestamps are epoch-ms. A picked due date is stored as noon of that date: `new Date(d + "T12:00:00").getTime()`, the same convention as `src/app/(app)/projects/actions.ts:347`.
- Calendar day keys are `YYYY-MM-DD` in the **browser's** local time — the convention of `dayKeyOf` in `src/app/(app)/calendar/calendar-client.tsx:31` for timed items.
- Harness assertions are labelled `#215 …`. New imports in the harness use `215`-suffixed aliases so they can't collide with names imported elsewhere in the file.
- Do not write DECISIONS.md or PUNCHLIST.md entries. Do not run `npm run dev` or any `db:*` script. `npm run test:specs` uses its own `mktemp -d` datadir and is safe.
- Gates at the end of every task: `npx tsc --noEmit` → 0 errors; `npm run test:specs` → 0 `FAIL`, report the PASS count; `npx eslint <changed files>` → 0 errors (warnings allowed). UI tasks (3, 4) also run `npm run build` → exit 0.
- Commit messages: `feat(tasks): … (#215)` / `feat(calendar): … (#215)` / `feat(inbox): … (#215)`, body ending with a blank line then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `git add` only the files the task names. If git reports an `index.lock`, wait a few seconds and retry.

## Spec ambiguities resolved (read before starting)

1. **"Local noon"** is computed on the server exactly like `projects/actions.ts` (`new Date(d + "T12:00:00")`). On Vercel (UTC) that is 12:00 UTC, which is the same calendar date in every US timezone, so the browser's day key lands on the picked date.
2. **Placement happens in the browser.** The server sends normalized items with raw `dueAt`; `calendar-client.tsx` calls `placeTasks` with the browser's today and the visible range (month grid is already gated on `mounted`).
3. **Undated/overdue tag text:** undated → `carried`; overdue → `overdue N d`.
4. **Today's order:** most-overdue first, then undated carried, then due today; ties by due time, title, id.
5. **"Mine"** = tasks whose `assigneeUserId === me.id` (name-only legacy tasks are not shown, per spec) and assignments whose `assignee === me.name`. Everyone = any task with `assigneeUserId` set and any assignment with `assignee` set.
6. **Assignment href** is `/queue?who=<assignee name>` (the queue page already honours `?who=`), so an Everyone-mode chip opens that person's queue.
7. **Task href priority:** thread → project → quote → engagement (`?tab=schedule`) → design → lead → customer → none.
8. **Links are re-derived on the server.** The dialog sends only the candidate *keys* the user left ticked; the writer rebuilds candidates from the stored thread, so a forged key is ignored, the thread link is always saved, and a venue is linked only when it belongs to the thread's company.
9. **Only thread-level links are candidates** (linked people incl. the primary contact, company, venue, the thread's work link). A message's own `link` is not offered. "Task…" on a message only changes the default notes (that message's author and time).
10. **Link fields are stored only when set** (no `null` keys written), so pre-#215 docs and new unlinked tasks look identical.
11. **Sidebar tasks card** always renders (with an empty-state hint) so "Task…" is discoverable.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/lib/stores/tasks.ts` | modify | link fields on `TaskRecord`, `taskLinksOf`, `TASK_CONTACT_IDS_MAX`, `tasksForThread/Customer/Contact` |
| `src/lib/calendar-tasks.ts` | create | pure: `CalendarTaskItem`, `placeTasks`, `groupPlacedByDay`, `localDayKey`, `dayKeyDiff`, `taskHref`, `initialsFor`, normalizers, `selectCalendarTasks` |
| `src/lib/calendar-tasks-load.ts` | create | server: `loadCalendarTasks(me, everyone)` |
| `src/app/(app)/calendar/task-actions.ts` | create | `"use server"`: complete / delete a task or assignment |
| `src/app/(app)/calendar/task-chip.tsx` | create | client chip: checkbox, title link, tag, initials, × with confirm |
| `src/app/(app)/calendar/page.tsx` | modify | `?tasks=all`, load tasks, pass to client |
| `src/app/(app)/calendar/calendar-client.tsx` | modify | month-cell chips, week/day task strip, Mine/Everyone toggle, keep `tasks=all` on nav links |
| `src/lib/inbox-task.ts` | create | pure: candidates, `buildThreadTaskInput`, `dueAtFromDateInput`, `defaultThreadTaskNotes`, `threadTaskRows` |
| `src/lib/inbox-task-write.ts` | create | server: `createTaskFromThread(req, me)` |
| `src/app/(app)/inbox/task-actions.ts` | create | `"use server"`: `createTaskFromThreadAction`, `completeThreadTaskAction` |
| `src/app/(app)/inbox/task-dialog.tsx` | create | client modal |
| `src/app/(app)/inbox/thread-tasks-card.tsx` | create | client sidebar card |
| `src/app/(app)/inbox/types.ts` | modify | `ReaderVM` gains `taskLinks`, `taskTeam`, `meId`, `threadTasks` |
| `src/app/(app)/inbox/page.tsx` | modify | build those four fields |
| `src/app/(app)/inbox/thread-reader.tsx` | modify | "Task…" per message header, dialog state + mount, popup `onCreateTask` |
| `src/app/(app)/inbox/link-sidebar.tsx` | modify | render `ThreadTasksCard`; pass `onCreateTask` to its popup if it renders one |
| `scripts/test-review-and-spec.ts` | modify | `#215` assertions (sync blocks appended at EOF, async functions chained) |

---

### Task 1: Task link fields + thread/customer/contact readers

**Files:**
- Modify: `src/lib/stores/tasks.ts` (type at :36-63, `normalizeTask` at :255-280, readers after `tasksForEngagement` at :304-306)
- Test: `scripts/test-review-and-spec.ts` (append at EOF; chain at the `seeded()` promise chain ~:10470)

**Interfaces:**
- Consumes: nothing new.
- Produces (all from `@/lib/stores/tasks`):
  - `TaskRecord` gains optional `contactIds?: string[]; customerId?: string | null; siteId?: string | null; leadId?: string | null; threadId?: string | null;`
  - `export const TASK_CONTACT_IDS_MAX = 25;`
  - `export function taskLinksOf(raw: Partial<TaskRecord>): Pick<TaskRecord, "contactIds" | "customerId" | "siteId" | "leadId" | "threadId">`
  - `export async function tasksForThread(threadId: string): Promise<TaskRecord[]>`
  - `export async function tasksForCustomer(customerId: string): Promise<TaskRecord[]>`
  - `export async function tasksForContact(contactId: string): Promise<TaskRecord[]>`
  - `createTask(input, me)` is unchanged in signature; it now persists the link fields because `normalizeTask` carries them.

- [ ] **Step 0: Record the harness baseline**

```bash
cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks
export PATH=$HOME/.local/node/bin:$PATH
npm run test:specs > "${TMPDIR:-/tmp}/specs-215-base.log" 2>&1; echo "exit $?"
grep -c '^PASS ' "${TMPDIR:-/tmp}/specs-215-base.log"; grep '^FAIL ' "${TMPDIR:-/tmp}/specs-215-base.log"; tail -1 "${TMPDIR:-/tmp}/specs-215-base.log"
```

Expected: `exit 0`, a PASS count (write it down as BASE), no FAIL lines, `ALL PASSED`.

- [ ] **Step 1: Write the failing tests**

Append to the very end of `scripts/test-review-and-spec.ts`:

```ts
/* ============ #215 — task links (store) ============ */
import {
  taskLinksOf as taskLinksOf215,
  tasksForThread as tasksForThread215,
  tasksForCustomer as tasksForCustomer215,
  tasksForContact as tasksForContact215,
  TASK_CONTACT_IDS_MAX as TASK_CONTACT_IDS_MAX215,
} from "@/lib/stores/tasks";

{
  const bare215 = normalizeTask({ id: "T-6101", title: "x" } as never);
  ok(
    !("threadId" in bare215) && !("contactIds" in bare215) && !("customerId" in bare215) && !("siteId" in bare215) && !("leadId" in bare215),
    "#215 a pre-existing task reads with no link keys at all"
  );
  const linked215 = normalizeTask({
    id: "T-6102", title: "x", threadId: " C-1040 ", customerId: "rose-brand", siteId: "loc-1", leadId: "L-2001",
    contactIds: ["ct-1", " ct-2 ", "ct-1", "", 7],
  } as never);
  ok(
    linked215.threadId === "C-1040" && linked215.customerId === "rose-brand" && linked215.siteId === "loc-1" && linked215.leadId === "L-2001",
    "#215 normalizeTask keeps the four single link ids, trimmed"
  );
  ok(JSON.stringify(linked215.contactIds) === '["ct-1","ct-2"]', "#215 contactIds are trimmed and deduped; blanks and non-strings dropped");
  ok(
    Object.keys(taskLinksOf215({ threadId: "  ", customerId: null, siteId: undefined, contactIds: [] } as never)).length === 0,
    "#215 blank / null link ids are omitted, not stored as empty"
  );
  const many215 = taskLinksOf215({ contactIds: Array.from({ length: 40 }, (_, i) => "ct-" + i) } as never);
  ok(TASK_CONTACT_IDS_MAX215 === 25 && many215.contactIds?.length === 25, "#215 contactIds cap at 25");
  ok(taskLinksOf215({ threadId: "x".repeat(121) } as never).threadId === undefined, "#215 an over-long link id is dropped");
  ok(
    typeof tasksForThread215 === "function" && typeof tasksForCustomer215 === "function" && typeof tasksForContact215 === "function",
    "#215 thread / customer / contact readers are exported"
  );
}

async function tasks215AsyncChecks(): Promise<void> {
  const me = { id: "harness", name: "Test Harness" };
  const t = await createTask(
    {
      title: "#215 harness task", section: "Email", threadId: "C-T215-A", customerId: "CUST-T215",
      siteId: "LOC-T215", leadId: "L-T215", contactIds: ["ct-T215-a", "ct-T215-b"],
    },
    me
  );
  registerFixture("tasks", t.id);
  const back = await getTask(t.id);
  ok(
    back?.threadId === "C-T215-A" && back.customerId === "CUST-T215" && back.siteId === "LOC-T215" &&
      back.leadId === "L-T215" && JSON.stringify(back.contactIds) === '["ct-T215-a","ct-T215-b"]',
    "#215 createTask round-trips every link field"
  );
  ok((await tasksForThread215("C-T215-A")).some((x) => x.id === t.id), "#215 tasksForThread finds the task");
  ok((await tasksForCustomer215("CUST-T215")).some((x) => x.id === t.id), "#215 tasksForCustomer finds the task");
  ok((await tasksForContact215("ct-T215-b")).some((x) => x.id === t.id), "#215 tasksForContact finds it by any linked person");
  ok(!(await tasksForContact215("ct-T215-zzz")).some((x) => x.id === t.id), "#215 tasksForContact ignores people not on the task");
  ok((await tasksForThread215("")).length === 0, "#215 an empty thread id matches nothing");
  await removeTask(t.id);
  ok(!(await tasksForThread215("C-T215-A")).some((x) => x.id === t.id), "#215 a deleted task leaves the thread's list");
}
```

Then, in the `seeded()` promise chain, insert one line immediately **before** the comment line `// Before the report and before the \`.catch\`, so a thrown suite is torn` (i.e. after the last `.then(() => …AsyncChecks())` line, whichever branch added it):

```ts
  .then(() => tasks215AsyncChecks())
```

(`normalizeTask`, `createTask`, `getTask`, `removeTask` are already imported at ~:2901; `registerFixture` at ~:9252.)

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run test:specs > "${TMPDIR:-/tmp}/specs-215.log" 2>&1; echo "exit $?"; grep -E '^FAIL |TypeError' "${TMPDIR:-/tmp}/specs-215.log" | head
```

Expected: non-zero exit; `TypeError: taskLinksOf215 is not a function` (or `#215` FAIL lines).

- [ ] **Step 3: Implement**

In `src/lib/stores/tasks.ts`, inside `export type TaskRecord = {`, after the line `doneAt: number | null;` add:

```ts
  /** #215 — email-task links. All optional and written only when set, so a
   *  pre-#215 doc and a new unlinked task read identically (no null keys).
   *  Same no-FK convention as projectId/quoteId (D85). */
  contactIds?: string[];
  customerId?: string | null;
  /** a CustomerLocation.id of customerId (the thread's venue) */
  siteId?: string | null;
  leadId?: string | null;
  /** the comms thread the task was created from */
  threadId?: string | null;
```

Directly above `export function normalizeTask(` add:

```ts
/** #215 — cap on people linked to one task (matches the thread's linkedContactIds cap). */
export const TASK_CONTACT_IDS_MAX = 25;
const TASK_LINK_ID_MAX = 120;

function taskLinkId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s && s.length <= TASK_LINK_ID_MAX ? s : null;
}

/** #215 — the sanitized link fields of a raw task: only present, valid ids
 *  come back (trimmed; contactIds deduped and capped). */
export function taskLinksOf(
  raw: Partial<TaskRecord>
): Pick<TaskRecord, "contactIds" | "customerId" | "siteId" | "leadId" | "threadId"> {
  const out: Pick<TaskRecord, "contactIds" | "customerId" | "siteId" | "leadId" | "threadId"> = {};
  if (Array.isArray(raw.contactIds)) {
    const ids = Array.from(
      new Set(raw.contactIds.map(taskLinkId).filter((x): x is string => !!x))
    ).slice(0, TASK_CONTACT_IDS_MAX);
    if (ids.length) out.contactIds = ids;
  }
  for (const k of ["customerId", "siteId", "leadId", "threadId"] as const) {
    const v = taskLinkId(raw[k]);
    if (v) out[k] = v;
  }
  return out;
}
```

In `normalizeTask`, replace the final `  return t;` (the one right after the object literal that ends with `doneAt: raw.doneAt ?? null,\n  };`) with:

```ts
  return { ...t, ...taskLinksOf(raw) };
```

After `tasksForEngagement` (ends ~:306) add:

```ts
/** #215 — tasks created from (or linked to) one email thread. */
export async function tasksForThread(threadId: string): Promise<TaskRecord[]> {
  if (!threadId) return [];
  return (await allTasks()).filter((t) => t.threadId === threadId);
}

/** #215 — tasks linked to a company. */
export async function tasksForCustomer(customerId: string): Promise<TaskRecord[]> {
  if (!customerId) return [];
  return (await allTasks()).filter((t) => t.customerId === customerId);
}

/** #215 — tasks linked to a person (any of the task's contactIds). */
export async function tasksForContact(contactId: string): Promise<TaskRecord[]> {
  if (!contactId) return [];
  return (await allTasks()).filter((t) => (t.contactIds || []).includes(contactId));
}
```

- [ ] **Step 4: Run the gates**

```bash
npx tsc --noEmit; echo "tsc exit $?"
npm run test:specs > "${TMPDIR:-/tmp}/specs-215.log" 2>&1; echo "exit $?"
grep -c '^PASS ' "${TMPDIR:-/tmp}/specs-215.log"; grep '^FAIL ' "${TMPDIR:-/tmp}/specs-215.log"; tail -1 "${TMPDIR:-/tmp}/specs-215.log"
npx eslint src/lib/stores/tasks.ts scripts/test-review-and-spec.ts
```

Expected: tsc exit 0; specs exit 0, PASS = BASE + 14, no FAIL, `ALL PASSED`; eslint 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/tasks.ts scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(tasks): link fields on tasks + thread/customer/contact readers (#215)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Pure calendar planner + normalizers

**Files:**
- Create: `src/lib/calendar-tasks.ts`
- Test: `scripts/test-review-and-spec.ts` (append at EOF)

**Interfaces:**
- Consumes: `TaskRecord` (type) from Task 1; `Assignment` (type) from `@/lib/stores/assignments`.
- Produces (from `@/lib/calendar-tasks`):
  - `type CalendarTaskItem = { kind: "task" | "assignment"; id: string; title: string; dueAt: number | null; done: boolean; assigneeName: string; assigneeUserId?: string | null; assigneeInitials: string; href: string }`
  - `type PlacedTask = { dayKey: string; item: CalendarTaskItem; carried: boolean; overdueDays: number }`
  - `type RosterEntry = { id: string; name: string; initials?: string | null }`
  - `localDayKey(ms: number): string`, `dayKeyDiff(a: string, b: string): number`
  - `placeTasks(items: readonly CalendarTaskItem[], opts: { today: string; rangeStart: string; rangeEnd: string }): PlacedTask[]`
  - `groupPlacedByDay(placed: readonly PlacedTask[]): Map<string, PlacedTask[]>`
  - `initialsFor(name: string, roster: readonly RosterEntry[]): string`
  - `taskHref(t: Partial<Pick<TaskRecord, "threadId" | "projectId" | "quoteId" | "engagementId" | "designId" | "leadId" | "customerId">>): string`
  - `calendarItemFromTask(t: TaskRecord, roster: readonly RosterEntry[]): CalendarTaskItem`
  - `calendarItemFromAssignment(a: Assignment, roster: readonly RosterEntry[]): CalendarTaskItem`
  - `selectCalendarTasks(tasks: readonly TaskRecord[], assignments: readonly Assignment[], opts: { me: { id: string; name: string }; everyone: boolean; roster: readonly RosterEntry[] }): CalendarTaskItem[]`

- [ ] **Step 1: Write the failing tests**

Append to the end of `scripts/test-review-and-spec.ts`:

```ts
/* ============ #215 — calendar task planner (pure) ============ */
import {
  placeTasks as placeTasks215,
  groupPlacedByDay as groupPlacedByDay215,
  localDayKey as localDayKey215,
  dayKeyDiff as dayKeyDiff215,
  taskHref as taskHref215,
  initialsFor as initialsFor215,
  calendarItemFromTask as calendarItemFromTask215,
  calendarItemFromAssignment as calendarItemFromAssignment215,
  selectCalendarTasks as selectCalendarTasks215,
  type CalendarTaskItem as CalendarTaskItem215,
} from "@/lib/calendar-tasks";
import type { Assignment as Assignment215 } from "@/lib/stores/assignments";

{
  // Local noon — the day key is then the same in any timezone the harness runs in.
  const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).getTime();
  const it = (id: string, dueAt: number | null, extra: Partial<CalendarTaskItem215> = {}): CalendarTaskItem215 => ({
    kind: "task", id, title: id, dueAt, done: false, assigneeName: "Jeff Chesebro", assigneeUserId: "u1",
    assigneeInitials: "JC", href: "", ...extra,
  });
  const TODAY = "2026-09-26";
  const oct = { today: TODAY, rangeStart: "2026-08-30", rangeEnd: "2026-10-10" };

  ok(localDayKey215(at(2026, 9, 26)) === "2026-09-26", "#215 localDayKey is the local calendar day");
  ok(
    localDayKey215(new Date(2026, 0, 5, 0, 0, 1).getTime()) === "2026-01-05" && localDayKey215(new Date(2026, 0, 5, 23, 59).getTime()) === "2026-01-05",
    "#215 localDayKey holds from just after midnight to just before the next"
  );
  ok(
    dayKeyDiff215("2026-09-20", "2026-09-26") === 6 && dayKeyDiff215("2026-03-01", "2026-03-15") === 14 && dayKeyDiff215("2026-10-30", "2026-11-02") === 3,
    "#215 dayKeyDiff counts whole days, across DST changes"
  );
  ok(Number.isNaN(dayKeyDiff215("2026-9-1", TODAY)), "#215 a malformed day key diffs to NaN");

  const p = placeTasks215(
    [
      it("future", at(2026, 10, 2)),
      it("undated", null),
      it("overdue", at(2026, 9, 20)),
      it("today", at(2026, 9, 26)),
      it("done", at(2026, 9, 28), { done: true }),
      it("doneOld", at(2026, 9, 1), { done: true }),
    ],
    oct
  );
  const by = (id: string) => p.find((x) => x.item.id === id);
  ok(by("future")?.dayKey === "2026-10-02" && by("future")?.carried === false && by("future")?.overdueDays === 0, "#215 a future task sits on its due day");
  ok(by("undated")?.dayKey === TODAY && by("undated")?.carried === true && by("undated")?.overdueDays === 0, "#215 an undated task floats on today, carried");
  ok(by("overdue")?.dayKey === TODAY && by("overdue")?.carried === true && by("overdue")?.overdueDays === 6, "#215 an overdue task floats on today with its days overdue");
  ok(by("today")?.dayKey === TODAY && by("today")?.carried === false && by("today")?.overdueDays === 0, "#215 a task due today sits on today and is not carried");
  ok(!by("done") && !by("doneOld"), "#215 done tasks are never placed");
  ok(p.every((x) => x.dayKey >= TODAY), "#215 nothing is ever placed on a past day");
  const todays = p.filter((x) => x.dayKey === TODAY).map((x) => x.item.id).join(",");
  ok(todays === "overdue,undated,today", `#215 today's order: overdue, undated carried, then due today (${todays})`);

  const edges = placeTasks215([it("start", at(2026, 9, 26)), it("end", at(2026, 10, 10)), it("after", at(2026, 10, 11))], { today: TODAY, rangeStart: TODAY, rangeEnd: "2026-10-10" });
  ok(edges.map((x) => x.item.id).join(",") === "start,end", "#215 range edges are inclusive; the day after is dropped");
  const nextMonth = placeTasks215([it("undated", null), it("overdue", at(2026, 9, 1)), it("nov", at(2026, 11, 3))], { today: TODAY, rangeStart: "2026-11-01", rangeEnd: "2026-12-05" });
  ok(nextMonth.map((x) => x.item.id).join(",") === "nov", "#215 with today outside the range, carried items are omitted");
  const lastMonth = placeTasks215([it("aug", at(2026, 8, 15)), it("undated", null)], { today: TODAY, rangeStart: "2026-07-26", rangeEnd: "2026-09-05" });
  ok(lastMonth.length === 0, "#215 a past range shows nothing — an overdue task is never drawn on its old due day");
  ok(placeTasks215([it("zero", 0)], oct)[0]?.carried === true, "#215 a zero dueAt reads as undated");
  const grouped = groupPlacedByDay215(p);
  ok(grouped.get(TODAY)?.length === 3 && grouped.get("2026-10-02")?.length === 1, "#215 groupPlacedByDay buckets placements by day key");

  ok(
    initialsFor215("Jeff Chesebro", [{ id: "u1", name: "Jeff Chesebro", initials: "JC" }]) === "JC" &&
      initialsFor215("sam de rivera", []) === "SD" && initialsFor215("", []) === "",
    "#215 initials: roster first, else the first letters of the first two words"
  );
  ok(taskHref215({ threadId: "C-1", projectId: "P-1" }) === "/inbox?thread=C-1", "#215 a thread-linked task links to its thread first");
  ok(
    taskHref215({ projectId: "P-3001" }) === "/projects/P-3001" && taskHref215({ quoteId: "Q-2041" }) === "/quotes?id=Q-2041" &&
      taskHref215({ engagementId: "E-1" }) === "/design/engagements/E-1?tab=schedule" && taskHref215({ designId: "D-1" }) === "/design/designs?id=D-1" &&
      taskHref215({ leadId: "L-1" }) === "/leads?lead=L-1" && taskHref215({ customerId: "rose-brand" }) === "/companies/rose-brand" && taskHref215({}) === "",
    "#215 taskHref falls through project, quote, engagement, design, lead, customer, then none"
  );

  const roster215 = [{ id: "u1", name: "Jeff Chesebro", initials: "JC" }, { id: "u2", name: "Sam Rivera", initials: "SR" }];
  const mkT = (o: Partial<TaskRecord> & { id: string }): TaskRecord => normalizeTask({ title: o.id, ...o });
  const tasks215 = [
    mkT({ id: "T-mine", assigneeUserId: "u1", assigneeName: "Jeff Chesebro", dueAt: at(2026, 10, 1) }),
    mkT({ id: "T-theirs", assigneeUserId: "u2", assigneeName: "Sam Rivera" }),
    mkT({ id: "T-nobody", assigneeUserId: null, assigneeName: "" }),
    mkT({ id: "T-done", assigneeUserId: "u1", assigneeName: "Jeff Chesebro", status: "done" }),
    mkT({ id: "T-nameonly", assigneeUserId: null, assigneeName: "Jeff Chesebro" }),
  ];
  const asg = (o: Partial<Assignment215> & { id: string }): Assignment215 => ({
    title: o.id, assignee: "", createdBy: "Sam Rivera", createdAt: 1, dueDate: 0, link: null,
    done: false, doneAt: null, doneVia: null, source: "", ...o,
  });
  const asg215 = [
    asg({ id: "as-mine", assignee: "Jeff Chesebro" }),
    asg({ id: "as-theirs", assignee: "Sam Rivera", dueDate: at(2026, 9, 20) }),
    asg({ id: "as-done", assignee: "Jeff Chesebro", done: true }),
    asg({ id: "as-blank", assignee: "" }),
  ];
  const me215 = { id: "u1", name: "Jeff Chesebro" };
  const mine215 = selectCalendarTasks215(tasks215, asg215, { me: me215, everyone: false, roster: roster215 });
  ok(
    mine215.map((x) => `${x.kind}:${x.id}`).join(",") === "task:T-mine,assignment:as-mine",
    "#215 mine: tasks by user id, assignments by name; done, unassigned and name-only tasks excluded"
  );
  const all215 = selectCalendarTasks215(tasks215, asg215, { me: me215, everyone: true, roster: roster215 });
  ok(
    all215.map((x) => `${x.kind}:${x.id}`).join(",") === "task:T-mine,task:T-theirs,assignment:as-mine,assignment:as-theirs",
    "#215 everyone: every assigned open task and assignment"
  );
  const asgItem = all215.find((x) => x.id === "as-theirs")!;
  ok(
    asgItem.dueAt === at(2026, 9, 20) && asgItem.assigneeUserId === "u2" && asgItem.assigneeInitials === "SR" && asgItem.href === "/queue?who=Sam%20Rivera",
    "#215 an assignment normalizes its due date, roster id, initials and a /queue?who= link"
  );
  ok(all215.find((x) => x.id === "as-mine")!.dueAt === null, "#215 an assignment's dueDate 0 reads as no date");
  const taskItem = all215.find((x) => x.id === "T-mine")!;
  ok(
    taskItem.kind === "task" && taskItem.assigneeInitials === "JC" && taskItem.done === false && taskItem.dueAt === at(2026, 10, 1) && taskItem.href === "",
    "#215 a task normalizes to the calendar item shape"
  );
  ok(
    calendarItemFromTask215(mkT({ id: "T-d", status: "done" }), []).done === true && calendarItemFromAssignment215(asg({ id: "as-d", done: true }), []).done === true,
    "#215 done maps through both normalizers"
  );
  const ct215 = readFileSync(join(process.cwd(), "src/lib/calendar-tasks.ts"), "utf8");
  const ctImports215 = [...ct215.matchAll(/^import\s+(type\s+)?[^;]*?from\s+"[^"]+"/gm)];
  ok(ctImports215.length > 0 && ctImports215.every((m) => !!m[1]), "#215 calendar-tasks.ts imports types only");
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run test:specs > "${TMPDIR:-/tmp}/specs-215.log" 2>&1; echo "exit $?"; grep -E "Cannot find module|ERR_MODULE_NOT_FOUND|^FAIL " "${TMPDIR:-/tmp}/specs-215.log" | head -3
```

Expected: non-zero exit, `Cannot find module '@/lib/calendar-tasks'` (or equivalent).

- [ ] **Step 3: Implement `src/lib/calendar-tasks.ts`**

```ts
/**
 * #215 — tasks on the calendar. Pure: type-only imports, so the server
 * loader (calendar-tasks-load.ts) and the client calendar both use it.
 *
 * Placement rules (spec #215):
 *  - an open task due today or later sits on its due day (inside the range);
 *  - an open task with no due date floats on today, `carried`;
 *  - an open task due before today floats on today, `carried`, with
 *    `overdueDays` = whole days between its due day and today;
 *  - done items are never placed, and nothing is ever placed on a past day;
 *  - when today is outside the visible range, carried items are omitted.
 * Day keys are the browser's local calendar day — the same convention as
 * calendar-client.tsx's dayKeyOf for a timed item.
 */
import type { TaskRecord } from "@/lib/stores/tasks";
import type { Assignment } from "@/lib/stores/assignments";

export type CalendarTaskItem = {
  kind: "task" | "assignment";
  id: string;
  title: string;
  /** epoch-ms, null = no due date */
  dueAt: number | null;
  done: boolean;
  assigneeName: string;
  assigneeUserId?: string | null;
  assigneeInitials: string;
  /** the linked record ("" = not clickable) */
  href: string;
};

export type PlacedTask = {
  dayKey: string;
  item: CalendarTaskItem;
  carried: boolean;
  overdueDays: number;
};

export type RosterEntry = { id: string; name: string; initials?: string | null };

const pad2 = (n: number) => String(n).padStart(2, "0");
const DAY_MS = 86_400_000;
const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Local-time "YYYY-MM-DD" of an epoch-ms instant. */
export function localDayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Whole days from day key `a` to day key `b` (b − a). UTC arithmetic on the
 *  keys themselves, so a DST change never adds or drops an hour. NaN for a
 *  malformed key. */
export function dayKeyDiff(a: string, b: string): number {
  const ma = KEY_RE.exec(a);
  const mb = KEY_RE.exec(b);
  if (!ma || !mb) return NaN;
  const ua = Date.UTC(Number(ma[1]), Number(ma[2]) - 1, Number(ma[3]));
  const ub = Date.UTC(Number(mb[1]), Number(mb[2]) - 1, Number(mb[3]));
  return Math.round((ub - ua) / DAY_MS);
}

/** 0 = overdue, 1 = undated carried, 2 = on its own day. */
function rank(p: PlacedTask): number {
  return p.overdueDays > 0 ? 0 : p.carried ? 1 : 2;
}

export function placeTasks(
  items: readonly CalendarTaskItem[],
  opts: { today: string; rangeStart: string; rangeEnd: string }
): PlacedTask[] {
  const { today, rangeStart, rangeEnd } = opts;
  const inRange = (k: string) => k >= rangeStart && k <= rangeEnd;
  const todayInRange = inRange(today);
  const out: PlacedTask[] = [];
  for (const item of items) {
    if (item.done) continue;
    const due = item.dueAt != null && Number.isFinite(item.dueAt) && item.dueAt > 0 ? item.dueAt : null;
    if (due == null) {
      if (todayInRange) out.push({ dayKey: today, item, carried: true, overdueDays: 0 });
      continue;
    }
    const dueKey = localDayKey(due);
    if (dueKey >= today) {
      if (inRange(dueKey)) out.push({ dayKey: dueKey, item, carried: false, overdueDays: 0 });
    } else if (todayInRange) {
      out.push({ dayKey: today, item, carried: true, overdueDays: dayKeyDiff(dueKey, today) });
    }
  }
  return out.sort(
    (a, b) =>
      a.dayKey.localeCompare(b.dayKey) ||
      rank(a) - rank(b) ||
      b.overdueDays - a.overdueDays ||
      (a.item.dueAt ?? 0) - (b.item.dueAt ?? 0) ||
      a.item.title.localeCompare(b.item.title) ||
      a.item.id.localeCompare(b.item.id)
  );
}

export function groupPlacedByDay(placed: readonly PlacedTask[]): Map<string, PlacedTask[]> {
  const map = new Map<string, PlacedTask[]>();
  for (const p of placed) {
    const list = map.get(p.dayKey);
    if (list) list.push(p);
    else map.set(p.dayKey, [p]);
  }
  return map;
}

export function initialsFor(name: string, roster: readonly RosterEntry[]): string {
  const hit = roster.find((r) => r.name === name);
  if (hit?.initials) return hit.initials;
  return (name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

/** Where a task chip links: the thread first (email tasks), then the parent
 *  record, then the company; "" when the task links nothing. */
export function taskHref(
  t: Partial<Pick<TaskRecord, "threadId" | "projectId" | "quoteId" | "engagementId" | "designId" | "leadId" | "customerId">>
): string {
  const e = encodeURIComponent;
  if (t.threadId) return `/inbox?thread=${e(t.threadId)}`;
  if (t.projectId) return `/projects/${e(t.projectId)}`;
  if (t.quoteId) return `/quotes?id=${e(t.quoteId)}`;
  if (t.engagementId) return `/design/engagements/${e(t.engagementId)}?tab=schedule`;
  if (t.designId) return `/design/designs?id=${e(t.designId)}`;
  if (t.leadId) return `/leads?lead=${e(t.leadId)}`;
  if (t.customerId) return `/companies/${e(t.customerId)}`;
  return "";
}

export function calendarItemFromTask(t: TaskRecord, roster: readonly RosterEntry[]): CalendarTaskItem {
  return {
    kind: "task",
    id: t.id,
    title: t.title,
    dueAt: t.dueAt && t.dueAt > 0 ? t.dueAt : null,
    done: t.status === "done",
    assigneeName: t.assigneeName,
    assigneeUserId: t.assigneeUserId,
    assigneeInitials: initialsFor(t.assigneeName, roster),
    href: taskHref(t),
  };
}

export function calendarItemFromAssignment(a: Assignment, roster: readonly RosterEntry[]): CalendarTaskItem {
  return {
    kind: "assignment",
    id: a.id,
    title: a.title,
    dueAt: a.dueDate > 0 ? a.dueDate : null,
    done: !!a.done,
    assigneeName: a.assignee,
    assigneeUserId: roster.find((r) => r.name === a.assignee)?.id ?? null,
    assigneeInitials: initialsFor(a.assignee, roster),
    href: a.assignee ? `/queue?who=${encodeURIComponent(a.assignee)}` : "/queue",
  };
}

/** Mine = tasks assigned to my user id + assignments assigned to my name
 *  (how each store identifies "me"). Everyone = every assigned open item. */
export function selectCalendarTasks(
  tasks: readonly TaskRecord[],
  assignments: readonly Assignment[],
  opts: { me: { id: string; name: string }; everyone: boolean; roster: readonly RosterEntry[] }
): CalendarTaskItem[] {
  const { me, everyone, roster } = opts;
  const out: CalendarTaskItem[] = [];
  for (const t of tasks) {
    if (t.status === "done" || !t.assigneeUserId) continue;
    if (!everyone && t.assigneeUserId !== me.id) continue;
    out.push(calendarItemFromTask(t, roster));
  }
  for (const a of assignments) {
    if (a.done || !a.assignee) continue;
    if (!everyone && a.assignee !== me.name) continue;
    out.push(calendarItemFromAssignment(a, roster));
  }
  return out;
}
```

- [ ] **Step 4: Run the gates**

```bash
npx tsc --noEmit; echo "tsc exit $?"
npm run test:specs > "${TMPDIR:-/tmp}/specs-215.log" 2>&1; echo "exit $?"
grep -c '^PASS ' "${TMPDIR:-/tmp}/specs-215.log"; grep '^FAIL ' "${TMPDIR:-/tmp}/specs-215.log"; tail -1 "${TMPDIR:-/tmp}/specs-215.log"
npx eslint src/lib/calendar-tasks.ts scripts/test-review-and-spec.ts
```

Expected: tsc 0; specs exit 0, PASS = BASE + 14 + 26, no FAIL, `ALL PASSED`; eslint 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar-tasks.ts scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(calendar): pure task placement planner + task/assignment normalizers (#215)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Tasks on `/calendar`

**Files:**
- Create: `src/lib/calendar-tasks-load.ts`, `src/app/(app)/calendar/task-actions.ts`, `src/app/(app)/calendar/task-chip.tsx`
- Modify: `src/app/(app)/calendar/page.tsx` (:35-97), `src/app/(app)/calendar/calendar-client.tsx` (imports :3-8, props :107-135, after `todayKey` :182-185, hrefs :289-309, time grid :356, toolbar :514-521, month cell :566-584)
- Test: `scripts/test-review-and-spec.ts` (append at EOF; chain)

**Interfaces:**
- Consumes: Task 2's `CalendarTaskItem`, `PlacedTask`, `placeTasks`, `groupPlacedByDay`, `selectCalendarTasks`; stores `allTasks`, `setTaskStatus`, `removeTask`, `getTask` (tasks), `allAssignments`, `getAssignment`, `setAssignmentDone`, `removeAssignment` (assignments); `activeUsers()` (users).
- Produces:
  - `loadCalendarTasks(me: { id: string; name: string }, everyone: boolean): Promise<CalendarTaskItem[]>` (`@/lib/calendar-tasks-load`)
  - `completeCalendarTaskAction(kind: "task" | "assignment", id: string): Promise<{ ok: true } | { ok: false; error: string }>` and `deleteCalendarTaskAction(kind, id)` (same result) in `src/app/(app)/calendar/task-actions.ts`
  - `TaskChip({ placed: PlacedTask; showAssignee: boolean })` default export of `task-chip.tsx`
  - `CalendarClient` gains props `tasks: CalendarTaskItem[]; tasksEveryone: boolean`

- [ ] **Step 1: Write the failing tests**

Append to the end of `scripts/test-review-and-spec.ts`:

```ts
/* ============ #215 — /calendar tasks (loader + wiring) ============ */
async function calendarTasks215AsyncChecks(): Promise<void> {
  const { loadCalendarTasks } = await import("../src/lib/calendar-tasks-load");
  const { createAssignment, setAssignmentDone } = await import("../src/lib/stores/assignments");
  const { setTaskStatus } = await import("../src/lib/stores/tasks");
  const roster = await activeUsers();
  ok(roster.length >= 2, "#215 calendar setup: the scratch roster has two active users");
  if (roster.length < 2) return;
  const [a, b] = roster;
  const by = { id: "harness", name: "Test Harness" };
  const tA = await createTask({ title: "#215 cal A", assigneeUserId: a.id, assigneeName: a.name, dueAt: Date.now() + 86_400_000 }, by);
  registerFixture("tasks", tA.id);
  const tB = await createTask({ title: "#215 cal B", assigneeUserId: b.id, assigneeName: b.name }, by);
  registerFixture("tasks", tB.id);
  const asA = await createAssignment({ title: "#215 asg A", assignee: a.name, createdBy: by.name });
  registerFixture("assignments", asA.id);
  const asB = await createAssignment({ title: "#215 asg B", assignee: b.name, createdBy: by.name });
  registerFixture("assignments", asB.id);
  const ids = new Set([tA.id, tB.id, asA.id, asB.id]);
  const meA = { id: a.id, name: a.name };
  const pick = async (everyone: boolean) => (await loadCalendarTasks(meA, everyone)).filter((x) => ids.has(x.id));

  const mine = await pick(false);
  ok(mine.map((x) => x.id).sort().join() === [tA.id, asA.id].sort().join(), "#215 loader: mine = my task + my assignment");
  const every = await pick(true);
  ok(every.length === 4 && every.every((x) => !!x.assigneeInitials || !x.assigneeName), "#215 loader: everyone = all four, with initials");
  await setTaskStatus(tA.id, "done");
  ok(!(await pick(false)).some((x) => x.id === tA.id), "#215 loader: a completed task leaves the calendar");
  await setAssignmentDone(asA.id, true, "app");
  ok(!(await pick(false)).some((x) => x.id === asA.id), "#215 loader: a completed assignment leaves the calendar");
}

{
  const rd215 = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  const noStoreImport215 = (src: string) =>
    !/^import\s+(?!type\b)[^;]*from\s+"@\/(lib\/stores\/|db\b|db\/|lib\/users"|lib\/calendar-tasks-load"|lib\/inbox-task-write")/m.test(src);
  const chip = rd215("src/app/(app)/calendar/task-chip.tsx");
  const cal = rd215("src/app/(app)/calendar/calendar-client.tsx");
  ok(chip.startsWith('"use client"') && noStoreImport215(chip) && noStoreImport215(cal), "#215 calendar client components import no store, db or loader");
  const acts = rd215("src/app/(app)/calendar/task-actions.ts");
  ok(acts.startsWith('"use server"') && (acts.match(/await requireUser\(\)/g) || []).length === 2, "#215 both calendar task actions require a signed-in user");
  const page = rd215("src/app/(app)/calendar/page.tsx");
  ok(
    page.includes('one(sp.tasks) === "all"') && page.includes("loadCalendarTasks(") && page.includes("tasks={calendarTasks}") && page.includes("tasksEveryone={tasksEveryone}"),
    "#215 /calendar loads tasks (mine; ?tasks=all for everyone) and passes them down"
  );
  ok((cal.match(/\$\{tasksQs\}/g) || []).length >= 7, "#215 every calendar nav link keeps the ?tasks=all choice");
  ok(cal.includes("placeTasks(") && cal.includes("<TaskChip") && cal.includes("renderTasks(k, 3)"), "#215 the calendar places tasks and renders chips in month cells and the task strip");
  ok(chip.includes("<ConfirmButton") && chip.includes("completeCalendarTaskAction(") && chip.includes("deleteCalendarTaskAction("), "#215 a chip completes via checkbox and deletes through the confirm button");
}
```

In the `seeded()` chain, insert immediately before the `// Before the report and before the \`.catch\`…` comment line (after `tasks215AsyncChecks`):

```ts
  .then(() => calendarTasks215AsyncChecks())
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run test:specs > "${TMPDIR:-/tmp}/specs-215.log" 2>&1; echo "exit $?"; grep -E "ENOENT|Cannot find module|^FAIL #215" "${TMPDIR:-/tmp}/specs-215.log" | head -3
```

Expected: non-zero exit; `ENOENT … task-chip.tsx` (the sync source-text block reads files that don't exist yet).

- [ ] **Step 3: Create the server loader `src/lib/calendar-tasks-load.ts`**

```ts
import { allTasks } from "@/lib/stores/tasks";
import { allAssignments } from "@/lib/stores/assignments";
import { activeUsers } from "@/lib/users";
import { selectCalendarTasks, type CalendarTaskItem } from "@/lib/calendar-tasks";

/**
 * #215 — the calendar's task feed: open tasks + My Queue assignments,
 * normalized. Not range-limited: undated and overdue items float onto today,
 * so the placement (client side, browser timezone) needs all of them.
 */
export async function loadCalendarTasks(
  me: { id: string; name: string },
  everyone: boolean
): Promise<CalendarTaskItem[]> {
  const [tasks, assignments, roster] = await Promise.all([allTasks(), allAssignments(), activeUsers()]);
  return selectCalendarTasks(tasks, assignments, {
    me,
    everyone,
    roster: roster.map((u) => ({ id: u.id, name: u.name, initials: u.initials })),
  });
}
```

- [ ] **Step 4: Create `src/app/(app)/calendar/task-actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { getTask, removeTask, setTaskStatus } from "@/lib/stores/tasks";
import { getAssignment, removeAssignment, setAssignmentDone } from "@/lib/stores/assignments";

/**
 * #215 — the calendar chip's checkbox and ×. A chip is either a task
 * (tasks collection) or a My Queue assignment; both close the real record,
 * so the Queue, the bell and the owning record all agree.
 */

type Result = { ok: true } | { ok: false; error: string };
type Ref = { kind: "task" | "assignment"; id: string };

function parseRef(kind: unknown, id: unknown): Ref | null {
  const k = kind === "task" || kind === "assignment" ? kind : null;
  const i = typeof id === "string" ? id.trim() : "";
  return k && i ? { kind: k, id: i } : null;
}

async function exists(ref: Ref): Promise<boolean> {
  return ref.kind === "task" ? !!(await getTask(ref.id)) : !!(await getAssignment(ref.id));
}

export async function completeCalendarTaskAction(kind: "task" | "assignment", id: string): Promise<Result> {
  await requireUser();
  const ref = parseRef(kind, id);
  if (!ref) return { ok: false, error: "Unknown task." };
  try {
    if (!(await exists(ref))) return { ok: false, error: "That item no longer exists." };
    if (ref.kind === "task") await setTaskStatus(ref.id, "done");
    else await setAssignmentDone(ref.id, true, "app");
  } catch (error) {
    console.error("completeCalendarTaskAction: update failed", error);
    return { ok: false, error: "Couldn’t complete it — please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteCalendarTaskAction(kind: "task" | "assignment", id: string): Promise<Result> {
  await requireUser();
  const ref = parseRef(kind, id);
  if (!ref) return { ok: false, error: "Unknown task." };
  try {
    if (!(await exists(ref))) return { ok: false, error: "That item no longer exists." };
    if (ref.kind === "task") await removeTask(ref.id);
    else await removeAssignment(ref.id);
  } catch (error) {
    console.error("deleteCalendarTaskAction: delete failed", error);
    return { ok: false, error: "Couldn’t delete it — please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
```

- [ ] **Step 5: Create `src/app/(app)/calendar/task-chip.tsx`**

```tsx
"use client";

/**
 * #215 — one task on the calendar: complete checkbox, title (links to the
 * record), "carried" / "overdue N d" tag, assignee initials in Everyone
 * mode, and × (two-step confirm). Clicks never reach the day cell under it
 * (which would open the create-event modal).
 */
import { useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import type { PlacedTask } from "@/lib/calendar-tasks";
import { completeCalendarTaskAction, deleteCalendarTaskAction } from "./task-actions";

export default function TaskChip({ placed, showAssignee }: { placed: PlacedTask; showAssignee: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { item, carried, overdueDays } = placed;
  const overdue = overdueDays > 0;
  const tag = overdue ? `overdue ${overdueDays} d` : carried ? "carried" : "";
  const ink = overdue ? "#b4543a" : "#5b3a8a";

  const complete = () =>
    start(async () => {
      setError(null);
      const r = await completeCalendarTaskAction(item.kind, item.id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });

  const root: CSSProperties = {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 4,
    fontSize: 10.5,
    lineHeight: 1.35,
    fontWeight: 600,
    color: ink,
    background: overdue ? "#fbefe9" : "#f3eefa",
    border: `1px solid ${overdue ? "#f1d6ca" : "#e2d8f0"}`,
    borderRadius: 5,
    padding: "1px 4px",
    marginBottom: 3,
    opacity: pending ? 0.5 : 1,
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={root}
      title={`${item.kind === "assignment" ? "Queue" : "Task"} · ${item.title}${item.assigneeName ? " · " + item.assigneeName : ""}${tag ? " · " + tag : ""}`}
    >
      <input
        type="checkbox"
        checked={false}
        disabled={pending}
        onChange={complete}
        aria-label={`Complete ${item.title}`}
        style={{ margin: 0, flexShrink: 0, cursor: "pointer" }}
      />
      {showAssignee && item.assigneeInitials && (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: "#8c919c" }}>{item.assigneeInitials}</span>
      )}
      {item.href ? (
        <Link
          href={item.href}
          style={{ flex: "1 1 60px", minWidth: 0, color: ink, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {item.title}
        </Link>
      ) : (
        <span style={{ flex: "1 1 60px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</span>
      )}
      {tag && (
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".02em", textTransform: "uppercase", color: overdue ? "#b4543a" : "#8c919c" }}>
          {tag}
        </span>
      )}
      <ConfirmButton
        className="pk-btn-outline"
        label="×"
        confirmLabel="Delete"
        pendingLabel="…"
        title="Delete this task"
        ariaLabel={`Delete ${item.title}`}
        style={{ fontSize: 10.5, padding: "0 5px", lineHeight: 1.3 }}
        onConfirm={async () => {
          const r = await deleteCalendarTaskAction(item.kind, item.id);
          if (!r.ok) throw new Error(r.error);
          router.refresh();
        }}
      />
      {error && (
        <span role="alert" style={{ flexBasis: "100%", fontSize: 10, color: "#b4543a" }}>
          {error}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Wire the page — `src/app/(app)/calendar/page.tsx`**

Add the import after `import { loadAgendaRange } from "@/lib/agenda";`:

```ts
import { loadCalendarTasks } from "@/lib/calendar-tasks-load";
```

After the `const view = (...) as | "month" | "week" | "day";` statement add:

```ts
  // #215 — tasks: mine by default, ?tasks=all shows everyone's.
  const tasksEveryone = one(sp.tasks) === "all";
```

Replace the `const [{ gmailOn, calendarOn, items }, calendarConnections] = await Promise.all([` statement's destructure and array so it reads:

```ts
  const [{ gmailOn, calendarOn, items }, calendarConnections, calendarTasks] = await Promise.all([
    loadAgendaRange(user.id, user.name, minMs, maxMs),
    // D148 — the filter rail's initial data; loadAgendaRange already fetched
    // the same connections internally to build `items`, but it doesn't
    // return the raw list (it only needs it to build agenda items), so the
    // rail fetches its own lean view via the same store module.
    (async () => {
      const { listConnectionsForUser } = await import("@/lib/google/calendar-connections");
      const rows = await listConnectionsForUser(user.id);
      return rows.map((r) => ({ id: r.id, googleEmail: r.googleEmail, calendars: r.calendars }));
    })(),
    loadCalendarTasks({ id: user.id, name: user.name }, tasksEveryone),
  ]);
```

In the `<CalendarClient … />` props, after `canConnectCalendar={googleConfigured()}` add:

```tsx
        tasks={calendarTasks}
        tasksEveryone={tasksEveryone}
```

- [ ] **Step 7: Wire the client — `src/app/(app)/calendar/calendar-client.tsx`**

(a) After `import type { CalendarConnectionView } from "../calendar-actions";` add:

```ts
import { groupPlacedByDay, placeTasks, type CalendarTaskItem, type PlacedTask } from "@/lib/calendar-tasks";
import TaskChip from "./task-chip";
```

(b) In the `CalendarClient` destructured params, after `canConnectCalendar,` add `tasks,` and `tasksEveryone,`. In the props type, after `canConnectCalendar: boolean;` add:

```ts
  /** #215 — open tasks + My Queue assignments (mine, or everyone's with ?tasks=all). */
  tasks: CalendarTaskItem[];
  tasksEveryone: boolean;
```

(c) Directly after the `const todayKey = (() => { … })();` block add:

```tsx
  // #215 — the visible day range. Tasks are placed in the browser's timezone
  // (dayKeyOf's convention); the month grid and the task strip only render
  // them once mounted, so SSR never disagrees about "today".
  const keyOfDate = (d: Date) => keyFor(d.getFullYear(), d.getMonth(), d.getDate());
  const rangeStart =
    view === "month" ? keyOfDate(weeks[0][0]) : view === "week" ? keyOfDate(weekDays[0]) : keyOfDate(dayDate);
  const rangeEnd =
    view === "month"
      ? keyOfDate(weeks[weeks.length - 1][6])
      : view === "week"
        ? keyOfDate(weekDays[6])
        : keyOfDate(dayDate);
  const tasksByDay = useMemo(
    () => groupPlacedByDay(placeTasks(tasks, { today: todayKey, rangeStart, rangeEnd })),
    [tasks, todayKey, rangeStart, rangeEnd]
  );
  const tasksQs = tasksEveryone ? "&tasks=all" : "";

  function dayViewHref(k: string): string {
    return `/calendar?view=day&date=${k}${tasksQs}`;
  }

  function renderTasks(k: string, cap: number) {
    const list: PlacedTask[] = tasksByDay.get(k) || [];
    if (!list.length) return null;
    return (
      <>
        {list.slice(0, cap).map((p) => (
          <TaskChip key={`${p.item.kind}:${p.item.id}`} placed={p} showAssignee={tasksEveryone} />
        ))}
        {list.length > cap && (
          <Link
            href={dayViewHref(k)}
            onClick={(e) => e.stopPropagation()}
            style={{ display: "block", fontSize: 10, color: "#5b3a8a", fontWeight: 600, textDecoration: "none", marginBottom: 3 }}
          >
            +{list.length - cap} more task{list.length - cap === 1 ? "" : "s"}
          </Link>
        )}
      </>
    );
  }
```

(d) Replace the four nav-href helpers (from `function switchViewHref(` through `const todayHref = \`/calendar?view=${view}\`;`) with:

```tsx
  function switchViewHref(v: "month" | "week" | "day"): string {
    const base = view === "month" ? new Date(year, month, 1) : new Date(dateY, dateM, dateD);
    if (v === "month") return `/calendar?view=month&month=${monthParam(base.getFullYear(), base.getMonth())}${tasksQs}`;
    return `/calendar?view=${v}&date=${dateParam(base.getFullYear(), base.getMonth(), base.getDate())}${tasksQs}`;
  }

  function prevHref(): string {
    if (view === "month") return `/calendar?view=month&month=${monthParam(year, month - 1)}${tasksQs}`;
    const step = view === "week" ? 7 : 1;
    const d = new Date(dateY, dateM, dateD - step);
    return `/calendar?view=${view}&date=${dateParam(d.getFullYear(), d.getMonth(), d.getDate())}${tasksQs}`;
  }

  function nextHref(): string {
    if (view === "month") return `/calendar?view=month&month=${monthParam(year, month + 1)}${tasksQs}`;
    const step = view === "week" ? 7 : 1;
    const d = new Date(dateY, dateM, dateD + step);
    return `/calendar?view=${view}&date=${dateParam(d.getFullYear(), d.getMonth(), d.getDate())}${tasksQs}`;
  }

  const todayHref = `/calendar?view=${view}${tasksQs}`;

  // #215 — the current page without the tasks choice; the toggle adds it back.
  const hereHref =
    view === "month"
      ? `/calendar?view=month&month=${monthParam(year, month)}`
      : `/calendar?view=${view}&date=${dateParam(dateY, dateM, dateD)}`;
```

(e) In `renderTimeGrid`, insert immediately before the `{/* all-day strip */}` comment:

```tsx
        {/* #215 task strip — tasks float above the all-day row */}
        <div style={{ display: "flex", borderBottom: "1px solid #eef0f3", minHeight: 26 }}>
          <div style={{ width: 52, fontSize: 9.5, color: "#c4c9d2", textAlign: "right", padding: "4px 6px 0 0" }}>tasks</div>
          {days.map((d) => {
            const k = keyFor(d.getFullYear(), d.getMonth(), d.getDate());
            return (
              <div key={k} style={{ width: colWidth, padding: "3px 4px", minWidth: 0 }}>
                {mounted ? renderTasks(k, Number.POSITIVE_INFINITY) : null}
              </div>
            );
          })}
        </div>
```

(f) In the header toolbar, directly after the closing `</button>` of the `Calendars{calendarConnections.length > 0 ? …}` button, add:

```tsx
          {/* #215 — whose tasks float on the calendar */}
          <div
            title="Whose tasks show on the calendar"
            style={{ display: "flex", border: "1px solid #e4e7ec", borderRadius: 8, overflow: "hidden" }}
          >
            <Link
              href={hereHref}
              className={!tasksEveryone ? "pk-btn-accent" : "pk-btn-outline"}
              style={{ textDecoration: "none", fontSize: 12, padding: "5px 11px", border: "none", borderRadius: 0 }}
            >
              My tasks
            </Link>
            <Link
              href={`${hereHref}&tasks=all`}
              className={tasksEveryone ? "pk-btn-accent" : "pk-btn-outline"}
              style={{ textDecoration: "none", fontSize: 12, padding: "5px 11px", border: "none", borderRadius: 0 }}
            >
              Everyone
            </Link>
          </div>
```

(g) In the month grid cell, insert `{renderTasks(k, 3)}` on its own line immediately before `{list.slice(0, 3).map(renderMonthChip)}` (i.e. right after the day-number `<div>…{day.getDate()}</div>`).

- [ ] **Step 8: Run the gates**

```bash
npx tsc --noEmit; echo "tsc exit $?"
npm run test:specs > "${TMPDIR:-/tmp}/specs-215.log" 2>&1; echo "exit $?"
grep -c '^PASS ' "${TMPDIR:-/tmp}/specs-215.log"; grep '^FAIL ' "${TMPDIR:-/tmp}/specs-215.log"; tail -1 "${TMPDIR:-/tmp}/specs-215.log"
npx eslint src/lib/calendar-tasks-load.ts "src/app/(app)/calendar/task-actions.ts" "src/app/(app)/calendar/task-chip.tsx" "src/app/(app)/calendar/page.tsx" "src/app/(app)/calendar/calendar-client.tsx" scripts/test-review-and-spec.ts
npm run build > "${TMPDIR:-/tmp}/build-215.log" 2>&1; echo "build exit $?"; tail -20 "${TMPDIR:-/tmp}/build-215.log"
```

Expected: tsc 0; specs exit 0, PASS = BASE + 14 + 26 + 11, no FAIL, `ALL PASSED`; eslint 0 errors; build exit 0 (a store import in a client file would fail here with a `postgres`/`fs` module error).

- [ ] **Step 9: Commit**

```bash
git add src/lib/calendar-tasks-load.ts "src/app/(app)/calendar/task-actions.ts" "src/app/(app)/calendar/task-chip.tsx" "src/app/(app)/calendar/page.tsx" "src/app/(app)/calendar/calendar-client.tsx" scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(calendar): tasks and queue assignments on the calendar, carried to today until done (#215)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Create task from an email + the thread's open tasks

**Files:**
- Create: `src/lib/inbox-task.ts`, `src/lib/inbox-task-write.ts`, `src/app/(app)/inbox/task-actions.ts`, `src/app/(app)/inbox/task-dialog.tsx`, `src/app/(app)/inbox/thread-tasks-card.tsx`
- Modify: `src/app/(app)/inbox/types.ts` (`ReaderVM` :155-248), `src/app/(app)/inbox/page.tsx` (imports :1-72; reader block before `reader = {` ~:808), `src/app/(app)/inbox/thread-reader.tsx` (`ExpandedMessage` :134-280, `Conversation` :282-381, `ThreadReader` state :424, sidebar :554, `<Conversation` :733, modal mount :843), `src/app/(app)/inbox/link-sidebar.tsx` (the `<aside>` body; props)
- Test: `scripts/test-review-and-spec.ts` (append at EOF; chain)

**Interfaces:**
- Consumes: Task 1's link fields, `createTask`, `setTaskStatus`, `tasksForThread`, `TaskRecord`; #214's `CommThread.linkedContactIds?: string[]` and `LinkPopup`'s `onCreateTask?: () => void`; comms `get`, `resolveCustomerId`; customers `get`; `getContact`, `displayName` (`@/lib/identity/contacts`); `activeUsers()`.
- Produces (from `@/lib/inbox-task`):
  - `type ThreadTaskLinkKind = "thread" | "contact" | "customer" | "site" | "quote" | "lead" | "project" | "survey" | "inspection"`
  - `type ThreadTaskLinkCandidate = { key: string; kind: ThreadTaskLinkKind; id: string }`
  - `type ThreadTaskRequest = { threadId: string; title: string; notes: string; assigneeUserId: string; dueDate: string; linkKeys: string[] }`
  - `type ThreadTaskRow = { id: string; title: string; assigneeName: string; assigneeInitials: string; due: string; overdue: boolean }`
  - `THREAD_TASK_TITLE_MAX = 200`, `THREAD_TASK_NOTES_MAX = 4000`
  - `threadTaskLinkCandidates(src: { threadId: string; customerId: string | null; siteId?: string | null; link?: { type: string; id: string; label?: string } | null; primaryContactId?: string | null; contactIds?: readonly string[] }): ThreadTaskLinkCandidate[]`
  - `dueAtFromDateInput(value: string): number | null | "invalid"`
  - `defaultThreadTaskNotes(subject: string, sender: string, when: string): string`
  - `buildThreadTaskInput(args: { req: ThreadTaskRequest; candidates: readonly ThreadTaskLinkCandidate[]; workLabel: string; roster: readonly { id: string; name: string }[]; me: { id: string; name: string } }): { ok: true; input: Partial<TaskRecord> & { title: string } } | { ok: false; error: string }`
  - `threadTaskRows(tasks: readonly TaskRecord[], nowMs: number, initialsOf: (name: string) => string): ThreadTaskRow[]`
  - `createTaskFromThread(req: ThreadTaskRequest, me: { id: string; name: string }): Promise<{ ok: true; task: TaskRecord } | { ok: false; error: string }>` (`@/lib/inbox-task-write`)
  - Actions (`src/app/(app)/inbox/task-actions.ts`): `createTaskFromThreadAction(req: ThreadTaskRequest)`, `completeThreadTaskAction(taskId: string)`, both `Promise<{ ok: true } | { ok: false; error: string }>`
  - `ReaderVM` gains `taskLinks: Array<{ key: string; kind: ThreadTaskLinkKind; label: string }>; taskTeam: Array<{ id: string; name: string }>; meId: string; threadTasks: ThreadTaskRow[];`

- [ ] **Step 1: Verify #214 is in place**

```bash
grep -n "linkedContactIds" src/lib/stores/comms.ts | head -3
grep -n "onCreateTask" "src/app/(app)/inbox/link-popup.tsx" | head -3
grep -n "<LinkPopup" "src/app/(app)/inbox/"*.tsx
```

Expected: `linkedContactIds?: string[]` on `CommThread`; `onCreateTask?: () => void` in the popup's props; one or two `<LinkPopup` render sites (note which files — `thread-reader.tsx` and/or `link-sidebar.tsx`). If the first two greps print nothing, **stop**: #214 has not landed.

- [ ] **Step 2: Write the failing tests**

Append to the end of `scripts/test-review-and-spec.ts`:

```ts
/* ============ #215 — tasks from email ============ */
import {
  threadTaskLinkCandidates as ttCandidates215,
  buildThreadTaskInput as buildTTInput215,
  dueAtFromDateInput as dueAt215,
  defaultThreadTaskNotes as ttNotes215,
  threadTaskRows as ttRows215,
  type ThreadTaskRequest as ThreadTaskRequest215,
} from "@/lib/inbox-task";

{
  const c = ttCandidates215({
    threadId: "C-1", customerId: "rose-brand", siteId: "loc-1",
    link: { type: "quote", id: "Q-2041", label: "Q-2041 · Main" },
    primaryContactId: "ct-1", contactIds: ["ct-2", "ct-1", " "],
  });
  ok(c.map((x) => x.key).join(",") === "thread,contact:ct-1,contact:ct-2,customer,site,work", "#215 candidates: thread, primary + linked people (deduped), company, venue, work link");
  ok(c.find((x) => x.key === "work")?.kind === "quote" && c.find((x) => x.key === "work")?.id === "Q-2041", "#215 the work candidate carries the link's type and id");
  ok(
    ttCandidates215({ threadId: "C-1", customerId: null, siteId: "loc-1", link: { type: "flame_job", id: "FT-3001" } }).map((x) => x.key).join(",") === "thread",
    "#215 no company → no venue; a link type outside the work picker is not offered"
  );

  ok(dueAt215("") === null, "#215 an empty date means no due date");
  ok(dueAt215("2026-10-05") === new Date(2026, 9, 5, 12).getTime(), "#215 a picked date saves as noon of that date");
  ok(dueAt215("2026-02-30") === "invalid" && dueAt215("10/05/2026") === "invalid" && dueAt215("2026-13-01") === "invalid", "#215 an impossible or mis-formatted date is invalid");
  ok(
    ttNotes215("Re: rigging", "Pat Lee", "Sep 24, 2026, 3:10 PM") === 'From email: "Re: rigging" — Pat Lee, Sep 24, 2026, 3:10 PM' &&
      ttNotes215("", "", "") === 'From email: "(no subject)" — unknown sender',
    "#215 default notes name the subject, sender and date"
  );

  const roster = [{ id: "u1", name: "Jeff Chesebro" }, { id: "u2", name: "Sam Rivera" }];
  const me = { id: "u1", name: "Jeff Chesebro" };
  const base: ThreadTaskRequest215 = {
    threadId: "C-1", title: "  Follow up   on bid ", notes: "n", assigneeUserId: "u2", dueDate: "2026-10-05",
    linkKeys: ["contact:ct-2", "customer", "work", "contact:ct-forged"],
  };
  const build = (req: ThreadTaskRequest215, cands = c, workLabel = "Q-2041 · Main") => buildTTInput215({ req, candidates: cands, workLabel, roster, me });
  const b1 = build(base);
  ok(
    b1.ok && b1.input.title === "Follow up on bid" && b1.input.section === "Email" && b1.input.assigneeUserId === "u2" &&
      b1.input.assigneeName === "Sam Rivera" && b1.input.dueAt === new Date(2026, 9, 5, 12).getTime(),
    "#215 build: title squashed, section Email, assignee from the roster, due at noon"
  );
  ok(
    b1.ok && b1.input.threadId === "C-1" && b1.input.customerId === "rose-brand" && b1.input.quoteId === "Q-2041" &&
      JSON.stringify(b1.input.contactIds) === '["ct-2"]' && b1.input.siteId === undefined,
    "#215 build: only ticked candidates link, the thread always does, a forged key is ignored"
  );
  const surveyC = ttCandidates215({ threadId: "C-2", customerId: null, link: { type: "survey", id: "S-11", label: "S-11 · Main hall" } });
  const b2 = build({ ...base, threadId: "C-2", linkKeys: ["work"], assigneeUserId: "" }, surveyC, "S-11 · Main hall");
  ok(b2.ok && b2.input.notes === "n\nLinked survey: S-11 · Main hall" && b2.input.assigneeUserId === "u1", "#215 build: a survey becomes a notes reference line; blank assignee = me");
  const inspC = ttCandidates215({ threadId: "C-3", customerId: null, link: { type: "inspection", id: "I-5", label: "Gym" } });
  const b2b = build({ ...base, threadId: "C-3", notes: "", linkKeys: ["work"] }, inspC, "Gym");
  ok(b2b.ok && b2b.input.notes === "Linked inspection: I-5 — Gym", "#215 build: an inspection reference line names the id when the label lacks it");
  ok(!build({ ...base, title: "   " }).ok, "#215 build: a blank title is refused");
  ok(!build({ ...base, assigneeUserId: "u9" }).ok, "#215 build: an assignee off the active team is refused");
  ok(!build({ ...base, dueDate: "2026-13-01" }).ok, "#215 build: a bad due date is refused");
  ok(!build({ ...base, title: "x".repeat(201) }).ok, "#215 build: a title over 200 characters is refused");
  const b3 = build({ ...base, dueDate: "" });
  ok(b3.ok && b3.input.dueAt === null, "#215 build: no date saves an undated task");

  const NOW215 = new Date(2026, 8, 26, 12).getTime();
  const mk = (o: Partial<TaskRecord> & { id: string }): TaskRecord => normalizeTask({ title: o.id, ...o });
  const rows = ttRows215(
    [
      mk({ id: "a" }),
      mk({ id: "b", dueAt: NOW215 - 2 * 86_400_000, assigneeName: "Sam Rivera" }),
      mk({ id: "c", dueAt: NOW215 + 86_400_000 }),
      mk({ id: "d", status: "done" }),
    ],
    NOW215,
    (n) => (n === "Sam Rivera" ? "SR" : "?")
  );
  ok(rows.map((r) => r.id).join(",") === "b,c,a", "#215 thread tasks: open only, soonest due first, undated last");
  ok(rows[0].overdue && rows[0].assigneeInitials === "SR" && !rows[1].overdue && rows[2].due === "" && rows[2].assigneeInitials === "", "#215 thread task rows carry overdue, initials and due label");
  const it215 = readFileSync(join(process.cwd(), "src/lib/inbox-task.ts"), "utf8");
  const itImports = [...it215.matchAll(/^import\s+(type\s+)?[^;]*?from\s+"[^"]+"/gm)];
  ok(itImports.every((m) => !!m[1]), "#215 inbox-task.ts imports types only (the dialog imports it)");
}

async function inboxTask215AsyncChecks(): Promise<void> {
  const { createTaskFromThread } = await import("../src/lib/inbox-task-write");
  const { all: allCustomers215 } = await import("../src/lib/stores/customers");
  const { createFixture } = await import("./test-fixtures");
  const roster = await activeUsers();
  const cust = (await allCustomers215()).find((x) => (x.locations || []).some((l) => !!l.id));
  ok(!!cust && roster.length > 0, "#215 inbox setup: a customer with a venue and an active user exist");
  if (!cust || !roster.length) return;
  const loc = cust.locations.find((l) => !!l.id)!.id as string;
  const now = Date.now();
  const thread = {
    id: "C-T215", mailbox: "personal", mailboxUser: "Test Harness", unread: false, customerId: cust.id, customer: cust.name,
    contactName: "Pat Lee", contactEmail: "pat@example.com", subject: "Re: rigging bid", channel: "email", status: "waiting_us",
    assignedTo: "", link: { type: "survey", id: "S-T215", label: "S-T215 · Main hall" }, messages: [], createdAt: now, updatedAt: now,
    resolvedContactId: "ct-T215-a", linkedContactIds: ["ct-T215-a", "ct-T215-b"], siteId: loc,
  };
  await createFixture("comms", thread as never);
  const me = { id: roster[0].id, name: roster[0].name };
  const r = await createTaskFromThread(
    { threadId: "C-T215", title: "Send revised bid", notes: "From email", assigneeUserId: "", dueDate: "2026-10-05", linkKeys: ["contact:ct-T215-b", "customer", "site", "work", "contact:ct-forged"] },
    me
  );
  ok(r.ok, "#215 writer: a task is created from a thread");
  if (!r.ok) return;
  registerFixture("tasks", r.task.id);
  const t = await getTask(r.task.id);
  ok(
    t?.threadId === "C-T215" && t.customerId === cust.id && t.siteId === loc && JSON.stringify(t.contactIds) === '["ct-T215-b"]',
    "#215 writer: thread, company, venue and the ticked person are stored"
  );
  ok(
    t?.section === "Email" && t.createdBy === me.name && t.assigneeUserId === me.id &&
      t.notes === "From email\nLinked survey: S-T215 · Main hall" && t.dueAt === new Date(2026, 9, 5, 12).getTime(),
    "#215 writer: section Email, created by and assigned to me, survey as a notes line, due at noon"
  );
  ok((await tasksForThread215("C-T215")).some((x) => x.id === r.task.id), "#215 writer: the thread's reader finds it");
  await createFixture("comms", { ...thread, id: "C-T215-stale", siteId: "loc-not-this-customer" } as never);
  const r2 = await createTaskFromThread({ threadId: "C-T215-stale", title: "x", notes: "", assigneeUserId: "", dueDate: "", linkKeys: ["site"] }, me);
  if (r2.ok) registerFixture("tasks", r2.task.id);
  ok(r2.ok && r2.task.siteId === undefined, "#215 writer: a venue that isn't the company's is never linked");
  const r3 = await createTaskFromThread({ threadId: "C-T215-missing", title: "x", notes: "", assigneeUserId: "", dueDate: "", linkKeys: [] }, me);
  ok(!r3.ok, "#215 writer: a missing thread is refused");
}

{
  const rd215 = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  const noStoreImport215 = (src: string) =>
    !/^import\s+(?!type\b)[^;]*from\s+"@\/(lib\/stores\/|db\b|db\/|lib\/users"|lib\/calendar-tasks-load"|lib\/inbox-task-write")/m.test(src);
  const dlg = rd215("src/app/(app)/inbox/task-dialog.tsx");
  const card = rd215("src/app/(app)/inbox/thread-tasks-card.tsx");
  ok(dlg.startsWith('"use client"') && card.startsWith('"use client"') && noStoreImport215(dlg) && noStoreImport215(card), "#215 inbox task UI imports no store, db or writer");
  const ta = rd215("src/app/(app)/inbox/task-actions.ts");
  ok(ta.startsWith('"use server"') && (ta.match(/await requireUser\(\)/g) || []).length === 2 && ta.includes("createTaskFromThread("), "#215 both inbox task actions require a user; create delegates to the writer");
  const reader = rd215("src/app/(app)/inbox/thread-reader.tsx");
  ok(reader.includes("Task…") && reader.includes("<TaskDialog") && reader.includes("onCreateTask"), "#215 the reader has Task… per message, mounts the dialog, and wires the popup's Create task");
  ok(rd215("src/app/(app)/inbox/link-sidebar.tsx").includes("<ThreadTasksCard"), "#215 the link sidebar lists the thread's open tasks");
  const pg = rd215("src/app/(app)/inbox/page.tsx");
  ok(pg.includes("threadTaskLinkCandidates(") && pg.includes("tasksForThread(") && pg.includes("taskTeam:"), "#215 the Inbox page builds the dialog links, team and thread tasks");
}
```

In the `seeded()` chain, insert immediately before the `// Before the report and before the \`.catch\`…` comment line:

```ts
  .then(() => inboxTask215AsyncChecks())
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npm run test:specs > "${TMPDIR:-/tmp}/specs-215.log" 2>&1; echo "exit $?"; grep -E "Cannot find module|ENOENT" "${TMPDIR:-/tmp}/specs-215.log" | head -3
```

Expected: non-zero exit; `Cannot find module '@/lib/inbox-task'`.

- [ ] **Step 4: Create `src/lib/inbox-task.ts`**

```ts
/**
 * #215 — tasks from an email thread. Pure (type-only imports): the Inbox
 * page builds the dialog's link list with it, the client dialog seeds its
 * notes with it, and the server writer (inbox-task-write.ts) re-derives the
 * links with it — the client only sends which candidate keys stay ticked,
 * so it can never link something the thread doesn't carry.
 */
import type { TaskRecord } from "@/lib/stores/tasks";

export type ThreadTaskLinkKind =
  | "thread" | "contact" | "customer" | "site" | "quote" | "lead" | "project" | "survey" | "inspection";

export type ThreadTaskLinkCandidate = { key: string; kind: ThreadTaskLinkKind; id: string };

export type ThreadTaskRequest = {
  threadId: string;
  title: string;
  notes: string;
  /** users.id; "" = me */
  assigneeUserId: string;
  /** an <input type="date"> value; "" = no due date */
  dueDate: string;
  /** candidate keys left ticked; "thread" is always added */
  linkKeys: string[];
};

export type ThreadTaskRow = {
  id: string;
  title: string;
  assigneeName: string;
  assigneeInitials: string;
  /** "Sep 30", "" when undated */
  due: string;
  overdue: boolean;
};

export const THREAD_TASK_TITLE_MAX = 200;
export const THREAD_TASK_NOTES_MAX = 4000;
/** Same value as TASK_CONTACT_IDS_MAX in stores/tasks.ts — a value import
 *  from the store would drag it into the dialog's client bundle. */
const CONTACTS_MAX = 25;

const WORK_KINDS = ["quote", "lead", "project", "survey", "inspection"] as const;
type WorkKind = (typeof WORK_KINDS)[number];
const isWorkKind = (s: string): s is WorkKind => (WORK_KINDS as readonly string[]).includes(s);

export function threadTaskLinkCandidates(src: {
  threadId: string;
  customerId: string | null;
  siteId?: string | null;
  link?: { type: string; id: string; label?: string } | null;
  primaryContactId?: string | null;
  contactIds?: readonly string[];
}): ThreadTaskLinkCandidate[] {
  const out: ThreadTaskLinkCandidate[] = [{ key: "thread", kind: "thread", id: src.threadId }];
  const seen = new Set<string>();
  for (const raw of [src.primaryContactId, ...(src.contactIds ?? [])]) {
    const id = typeof raw === "string" ? raw.trim() : "";
    if (!id || seen.has(id) || seen.size >= CONTACTS_MAX) continue;
    seen.add(id);
    out.push({ key: `contact:${id}`, kind: "contact", id });
  }
  if (src.customerId) {
    out.push({ key: "customer", kind: "customer", id: src.customerId });
    if (src.siteId) out.push({ key: "site", kind: "site", id: src.siteId });
  }
  const link = src.link;
  if (link && link.id && isWorkKind(link.type)) out.push({ key: "work", kind: link.type, id: link.id });
  return out;
}

/** "YYYY-MM-DD" → noon of that date (the projects/actions.ts convention),
 *  "" → null, anything else → "invalid". */
export function dueAtFromDateInput(value: string): number | null | "invalid" {
  const s = (value || "").trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return "invalid";
  const d = new Date(`${s}T12:00:00`);
  if (
    Number.isNaN(d.getTime()) ||
    d.getFullYear() !== Number(m[1]) ||
    d.getMonth() + 1 !== Number(m[2]) ||
    d.getDate() !== Number(m[3])
  ) {
    return "invalid";
  }
  return d.getTime();
}

export function defaultThreadTaskNotes(subject: string, sender: string, when: string): string {
  const s = (subject || "").trim() || "(no subject)";
  const who = (sender || "").trim() || "unknown sender";
  const at = (when || "").trim();
  return `From email: "${s}" — ${who}${at ? `, ${at}` : ""}`;
}

function workRefLine(kind: "survey" | "inspection", id: string, label: string): string {
  const l = (label || "").trim();
  const text = !l ? id : l.includes(id) ? l : `${id} — ${l}`;
  return `Linked ${kind}: ${text}`;
}

export function buildThreadTaskInput(args: {
  req: ThreadTaskRequest;
  candidates: readonly ThreadTaskLinkCandidate[];
  workLabel: string;
  roster: readonly { id: string; name: string }[];
  me: { id: string; name: string };
}): { ok: true; input: Partial<TaskRecord> & { title: string } } | { ok: false; error: string } {
  const { req, candidates, workLabel, roster, me } = args;
  const title = String(req?.title ?? "").replace(/\s+/g, " ").trim();
  if (!title) return { ok: false, error: "The task needs a title." };
  if (title.length > THREAD_TASK_TITLE_MAX) return { ok: false, error: `Keep the title under ${THREAD_TASK_TITLE_MAX} characters.` };
  const notes = String(req?.notes ?? "").trim();
  if (notes.length > THREAD_TASK_NOTES_MAX) return { ok: false, error: `Keep the notes under ${THREAD_TASK_NOTES_MAX} characters.` };
  const dueAt = dueAtFromDateInput(String(req?.dueDate ?? ""));
  if (dueAt === "invalid") return { ok: false, error: "Pick a valid due date." };
  const assigneeId = String(req?.assigneeUserId ?? "").trim() || me.id;
  const assignee = roster.find((u) => u.id === assigneeId);
  if (!assignee) return { ok: false, error: "Pick someone on the team." };

  const wanted = new Set((Array.isArray(req?.linkKeys) ? req.linkKeys : []).map(String));
  wanted.add("thread");
  const input: Partial<TaskRecord> & { title: string } = {
    title,
    section: "Email",
    notes,
    assigneeUserId: assignee.id,
    assigneeName: assignee.name,
    dueAt,
  };
  const contactIds: string[] = [];
  const refs: string[] = [];
  for (const c of candidates) {
    if (!wanted.has(c.key)) continue;
    switch (c.kind) {
      case "thread": input.threadId = c.id; break;
      case "contact": contactIds.push(c.id); break;
      case "customer": input.customerId = c.id; break;
      case "site": input.siteId = c.id; break;
      case "lead": input.leadId = c.id; break;
      case "quote": input.quoteId = c.id; break;
      case "project": input.projectId = c.id; break;
      case "survey":
      case "inspection": refs.push(workRefLine(c.kind, c.id, workLabel)); break;
    }
  }
  if (contactIds.length) input.contactIds = contactIds;
  if (refs.length) input.notes = [notes, ...refs].filter(Boolean).join("\n");
  return { ok: true, input };
}

/** The sidebar's list: open tasks, soonest due first, undated last. */
export function threadTaskRows(
  tasks: readonly TaskRecord[],
  nowMs: number,
  initialsOf: (name: string) => string
): ThreadTaskRow[] {
  return tasks
    .filter((t) => t.status !== "done")
    .sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || a.createdAt - b.createdAt)
    .map((t) => ({
      id: t.id,
      title: t.title,
      assigneeName: t.assigneeName,
      assigneeInitials: t.assigneeName ? initialsOf(t.assigneeName) : "",
      due: t.dueAt ? new Date(t.dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "",
      overdue: !!t.dueAt && t.dueAt < nowMs,
    }));
}
```

(Note: `(Infinity − Infinity)` is `NaN`, which is falsy, so two undated tasks fall through to `createdAt`.)

- [ ] **Step 5: Create `src/lib/inbox-task-write.ts`**

```ts
import { get as getThread, resolveCustomerId } from "@/lib/stores/comms";
import { get as getCustomer } from "@/lib/stores/customers";
import { createTask, type TaskRecord } from "@/lib/stores/tasks";
import { activeUsers } from "@/lib/users";
import { buildThreadTaskInput, threadTaskLinkCandidates, type ThreadTaskRequest } from "@/lib/inbox-task";

/**
 * #215 — the write half of "Create task" from an email. Kept out of the
 * "use server" file (every export there is POST-reachable) so the action is
 * just requireUser() + this, and the harness can drive the real write.
 * Links are re-derived from the stored thread: a key the thread doesn't
 * carry is ignored, and a venue must belong to the thread's company.
 */
export async function createTaskFromThread(
  req: ThreadTaskRequest,
  me: { id: string; name: string }
): Promise<{ ok: true; task: TaskRecord } | { ok: false; error: string }> {
  const thread = await getThread(String(req?.threadId || ""));
  if (!thread) return { ok: false, error: "That email thread no longer exists." };
  const [customerId, roster] = await Promise.all([resolveCustomerId(thread), activeUsers()]);
  const customer = customerId ? await getCustomer(customerId) : null;
  const siteId =
    thread.siteId && (customer?.locations || []).some((l) => l.id === thread.siteId) ? thread.siteId : null;
  const candidates = threadTaskLinkCandidates({
    threadId: thread.id,
    customerId,
    siteId,
    link: thread.link,
    primaryContactId: thread.resolvedContactId ?? null,
    contactIds: thread.linkedContactIds ?? [],
  });
  const built = buildThreadTaskInput({
    req,
    candidates,
    workLabel: thread.link?.label || "",
    roster: roster.map((u) => ({ id: u.id, name: u.name })),
    me,
  });
  if (!built.ok) return built;
  return { ok: true, task: await createTask(built.input, me) };
}
```

- [ ] **Step 6: Create `src/app/(app)/inbox/task-actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { setTaskStatus } from "@/lib/stores/tasks";
import { createTaskFromThread } from "@/lib/inbox-task-write";
import type { ThreadTaskRequest } from "@/lib/inbox-task";

/** #215 — "Create task" from an email, and the sidebar's complete checkbox. */

type Result = { ok: true } | { ok: false; error: string };

export async function createTaskFromThreadAction(req: ThreadTaskRequest): Promise<Result> {
  const me = await requireUser();
  try {
    const r = await createTaskFromThread(req, { id: me.id, name: me.name });
    if (!r.ok) return r;
  } catch (error) {
    console.error("createTaskFromThreadAction: task create failed", error);
    return { ok: false, error: "Couldn’t create the task — please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function completeThreadTaskAction(taskId: string): Promise<Result> {
  await requireUser();
  const id = typeof taskId === "string" ? taskId.trim() : "";
  if (!id) return { ok: false, error: "Unknown task." };
  try {
    if (!(await setTaskStatus(id, "done"))) return { ok: false, error: "That task no longer exists." };
  } catch (error) {
    console.error("completeThreadTaskAction: task update failed", error);
    return { ok: false, error: "Couldn’t complete the task — please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
```

- [ ] **Step 7: Extend `ReaderVM` — `src/app/(app)/inbox/types.ts`**

Change the first import to:

```ts
import type { LinkWorkType } from "@/lib/inbox-links";
import type { ThreadTaskLinkKind, ThreadTaskRow } from "@/lib/inbox-task";
```

Inside `export type ReaderVM = {`, as the last members (after `contactOptions: Opt[];` and after anything #214 added), add:

```ts
  /* ---- #215 tasks from email ---- */
  /** task-dialog link candidates, pre-ticked; "thread" always saves */
  taskLinks: Array<{ key: string; kind: ThreadTaskLinkKind; label: string }>;
  /** the active team, for the dialog's Assign to */
  taskTeam: Array<{ id: string; name: string }>;
  /** the signed-in user's id — the dialog's default assignee */
  meId: string;
  /** open tasks created from / linked to this thread, for the sidebar */
  threadTasks: ThreadTaskRow[];
```

- [ ] **Step 8: Build the VM fields — `src/app/(app)/inbox/page.tsx`**

Add imports next to the other store imports near the top:

```ts
import { tasksForThread } from "@/lib/stores/tasks";
import { displayName, getContact } from "@/lib/identity/contacts";
import { threadTaskLinkCandidates, threadTaskRows } from "@/lib/inbox-task";
```

(If #214 already imports `getContact`/`displayName` from `@/lib/identity/contacts`, merge into that import instead of adding a duplicate.)

In the `if (sel) {` reader block, immediately before the line `const messages: MessageVM[] = (sel.messages || []).map((m) => ({` (i.e. after `customerCard` is computed, where `resolvedCid`, `resolvedCustomer`, `linkedCustomer`, `siteId` and `siteOptions` are all in scope), insert:

```ts
    // #215 — the task dialog's link candidates (labels resolved here; the
    // writer re-derives the same candidates from the stored thread) and the
    // sidebar's open tasks on this thread.
    const taskCandidates = threadTaskLinkCandidates({
      threadId: sel.id,
      customerId: resolvedCid,
      siteId,
      link: sel.link,
      primaryContactId: sel.resolvedContactId ?? null,
      contactIds: sel.linkedContactIds ?? [],
    });
    const taskContactRows = await Promise.all(
      taskCandidates.filter((c) => c.kind === "contact").map((c) => getContact(c.id))
    );
    const taskContactName = new Map(
      taskContactRows
        .filter((r): r is NonNullable<typeof r> => !!r)
        .map((r) => [r.id, displayName(r)] as const)
    );
    const workKindLabel = sel.link ? sel.link.type.charAt(0).toUpperCase() + sel.link.type.slice(1) : "";
    const taskLinks: ReaderVM["taskLinks"] = taskCandidates.flatMap((c) => {
      switch (c.kind) {
        case "thread":
          return [{ key: c.key, kind: c.kind, label: "This email thread" }];
        case "contact": {
          const name = taskContactName.get(c.id);
          return name ? [{ key: c.key, kind: c.kind, label: name }] : [];
        }
        case "customer":
          return [{ key: c.key, kind: c.kind, label: linkedCustomer?.name || resolvedCustomer || c.id }];
        case "site":
          return [{ key: c.key, kind: c.kind, label: siteOptions.find((o) => o.value === c.id)?.label || "Venue" }];
        default:
          return [
            {
              key: c.key,
              kind: c.kind,
              label:
                `${workKindLabel} · ${sel.link?.label || c.id}` +
                (c.kind === "survey" || c.kind === "inspection" ? " (noted in the task)" : ""),
            },
          ];
      }
    });
    const threadTasks = threadTaskRows(await tasksForThread(sel.id), Date.now(), (n) => initialsOf(n));
```

In the `reader = { … }` object literal, as its last properties add:

```ts
      taskLinks,
      taskTeam: roster.map((u) => ({ id: u.id, name: u.name })),
      meId: user.id,
      threadTasks,
```

- [ ] **Step 9: Create `src/app/(app)/inbox/task-dialog.tsx`**

```tsx
"use client";

/**
 * #215 — "Create task" from an email. Opened from a message header's
 * "Task…" and from the Link popup's footer. Title (the subject), links
 * (pre-ticked from the thread; the thread itself always saves), notes
 * (who/when the email came from), assignee (default me), optional due date.
 * Everything arrives on the server-built ReaderVM; one server action saves.
 */
import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { ReaderVM } from "./types";
import { createTaskFromThreadAction } from "./task-actions";
import { defaultThreadTaskNotes, THREAD_TASK_TITLE_MAX } from "@/lib/inbox-task";
import { BTN, CHECK_ROW, PRIMARY } from "./sidebar-styles";

const inStyle: CSSProperties = {
  width: "100%",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "8px 11px",
  fontSize: 12.5,
  fontFamily: "var(--font-ui)",
  background: "#fff",
  color: "#16181d",
  outline: "none",
  boxSizing: "border-box",
};

const lbl: CSSProperties = {
  display: "block",
  fontSize: 10.5,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".04em",
  textTransform: "uppercase",
  margin: "12px 0 5px",
};

export default function TaskDialog({
  vm,
  messageId,
  onClose,
}: {
  vm: ReaderVM;
  /** the message the dialog was opened from; null = the newest */
  messageId: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const msg =
    (messageId ? vm.messages.find((m) => m.id === messageId) : null) ||
    vm.messages[vm.messages.length - 1] ||
    null;
  const [title, setTitle] = useState(vm.subject || "");
  const [notes, setNotes] = useState(() =>
    defaultThreadTaskNotes(vm.subject, msg?.author || vm.contactName, msg?.time || "")
  );
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(vm.taskLinks.map((l) => l.key)));
  const [assignee, setAssignee] = useState(
    vm.taskTeam.some((u) => u.id === vm.meId) ? vm.meId : vm.taskTeam[0]?.id || ""
  );
  const [due, setDue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const toggle = (key: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const save = () => {
    if (pending) return;
    start(async () => {
      setError(null);
      const r = await createTaskFromThreadAction({
        threadId: vm.id,
        title,
        notes,
        assigneeUserId: assignee,
        dueDate: due,
        linkKeys: Array.from(ticked),
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onClose();
      router.refresh();
    });
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(22,24,29,.4)",
        zIndex: 95,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Create task"
        onClick={(e) => e.stopPropagation()}
        className="ib-sheet"
        style={{
          width: 460,
          maxWidth: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
          background: "#fff",
          borderRadius: 14,
          boxShadow: "0 18px 50px rgba(0,0,0,.22)",
          padding: "20px 22px",
          fontFamily: "var(--font-ui)",
          color: "#16181d",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 15.5, fontWeight: 700, flex: 1 }}>Create task</div>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            style={{ border: "none", background: "transparent", color: "#c4c9d2", fontSize: 17, cursor: "pointer" }}
          >
            ✕
          </button>
        </div>

        <label style={lbl} htmlFor="task-title">Title</label>
        <input
          id="task-title"
          value={title}
          maxLength={THREAD_TASK_TITLE_MAX}
          onChange={(e) => setTitle(e.target.value)}
          style={inStyle}
          autoFocus
        />

        <div style={lbl}>Links</div>
        <div>
          {vm.taskLinks.map((l) => (
            <label key={l.key} style={{ ...CHECK_ROW, marginTop: 6 }}>
              <input
                type="checkbox"
                checked={l.kind === "thread" || ticked.has(l.key)}
                disabled={l.kind === "thread"}
                onChange={() => toggle(l.key)}
              />
              <span>
                {l.label}
                <span style={{ color: "#aab0bb", marginLeft: 6, fontSize: 11 }}>
                  {l.kind === "contact" ? "person" : l.kind === "customer" ? "company" : l.kind === "site" ? "venue" : l.kind === "thread" ? "always linked" : ""}
                </span>
              </span>
            </label>
          ))}
        </div>

        <label style={lbl} htmlFor="task-notes">Notes</label>
        <textarea
          id="task-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          style={{ ...inStyle, resize: "vertical", lineHeight: 1.45 }}
        />

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 180px" }}>
            <label style={lbl} htmlFor="task-assignee">Assign to</label>
            <select id="task-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} style={{ ...inStyle, cursor: "pointer" }}>
              {vm.taskTeam.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.id === vm.meId ? `${u.name} (me)` : u.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: "1 1 150px" }}>
            <label style={lbl} htmlFor="task-due">Due date (optional)</label>
            <input id="task-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} style={inStyle} />
          </div>
        </div>
        <div style={{ fontSize: 11, color: "#8c919c", marginTop: 6, lineHeight: 1.45 }}>
          Shows on the calendar on its due date. With no date, or once overdue, it floats on today until it’s done or deleted.
        </div>

        {error && (
          <div role="alert" style={{ marginTop: 12, fontSize: 12, color: "#b4543a" }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button type="button" onClick={onClose} style={BTN}>
            Cancel
          </button>
          <button type="button" onClick={save} disabled={pending || !title.trim()} style={{ ...PRIMARY, opacity: pending || !title.trim() ? 0.6 : 1 }}>
            {pending ? "Saving…" : "Save task"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 10: Create `src/app/(app)/inbox/thread-tasks-card.tsx`**

```tsx
"use client";

/** #215 — the link sidebar's list of open tasks on this thread, with a
 *  complete checkbox. Data comes from ReaderVM.threadTasks. */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ReaderVM } from "./types";
import { completeThreadTaskAction } from "./task-actions";
import { CARD, H, MUTED } from "./sidebar-styles";

export default function ThreadTasksCard({ tasks }: { tasks: ReaderVM["threadTasks"] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const complete = (id: string) => {
    setBusyId(id);
    start(async () => {
      setError(null);
      const r = await completeThreadTaskAction(id);
      setBusyId(null);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div style={CARD}>
      <div style={H}>Tasks</div>
      {tasks.length === 0 ? (
        <div style={{ ...MUTED, marginTop: 0 }}>No open tasks on this thread. Use “Task…” on a message to add one.</div>
      ) : (
        tasks.map((t) => (
          <label
            key={t.id}
            style={{
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
              padding: "6px 0",
              borderTop: "1px solid #f3f4f7",
              fontSize: 12,
              cursor: "pointer",
              opacity: busyId === t.id ? 0.5 : 1,
            }}
          >
            <input
              type="checkbox"
              checked={false}
              disabled={pending}
              onChange={() => complete(t.id)}
              aria-label={`Complete ${t.title}`}
              style={{ marginTop: 2 }}
            />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 600, color: "#16181d" }}>{t.title}</span>
              <span
                title={t.assigneeName || "Unassigned"}
                style={{ display: "block", fontSize: 11, color: t.overdue ? "#b4543a" : "#8c919c", marginTop: 2 }}
              >
                <span style={{ fontFamily: "var(--font-mono)" }}>{t.assigneeInitials || "—"}</span>
                {" · "}
                {t.due ? (t.overdue ? `overdue · ${t.due}` : `due ${t.due}`) : "no date"}
              </span>
            </span>
          </label>
        ))
      )}
      {error && (
        <div role="alert" style={{ fontSize: 11.5, color: "#b4543a", marginTop: 6 }}>
          {error}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 11: Wire `thread-reader.tsx`**

(a) Imports: after `import LinkSidebar from "./link-sidebar";` add:

```ts
import TaskDialog from "./task-dialog";
```

(b) `ExpandedMessage`: add to its destructured params `onTask,` and to its props type `onTask: () => void;`. In the header row, insert this button immediately after `<span style={{ fontSize: 11, color: "#aab0bb" }}>{m.time}</span>` — or, if #214 placed its "Link…" button right after the time, immediately after that "Link…" button:

```tsx
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTask();
            }}
            title="Create a task from this message"
            style={{
              border: "1px solid #e4e7ec",
              borderRadius: 6,
              padding: "2px 7px",
              color: "#68707b",
              fontSize: 10.5,
              fontWeight: 600,
              background: "#fff",
              cursor: "pointer",
              fontFamily: "var(--font-ui)",
            }}
          >
            Task…
          </button>
```

(c) `Conversation`: add `onTask,` to its destructured params and `onTask: (messageId: string) => void;` to its props type. On **both** `<ExpandedMessage` elements add the prop — in `renderOne`: `onTask={() => onTask(m.id)}`; in the `newest` branch: `onTask={() => onTask(newest.id)}`.

(d) `ThreadReader` state — directly after `const [visitOpen, setVisitOpen] = useState(false);` (this is above the `if (!vm) { return … }` early return; hooks must stay above it) add:

```ts
  // #215 — the create-task dialog; messageId = the message it was opened from
  const [taskFor, setTaskFor] = useState<{ messageId: string | null } | null>(null);
```

After the early return, next to `const closeComposer = () => {`, add:

```ts
  const openTask = (messageId: string | null) => setTaskFor({ messageId });
```

(e) The `<Conversation` element (inside the `{/* conversation */}` div) gains:

```tsx
            onTask={(messageId) => openTask(messageId)}
```

(f) Mount the dialog directly after the `{visitOpen && vm.visit && vm.resolvedCustomerId && ( <SiteVisitModal … /> )}` block:

```tsx
            {taskFor && (
              <TaskDialog vm={vm} messageId={taskFor.messageId} onClose={() => setTaskFor(null)} />
            )}
```

(g) The sidebar element — the line `const sidebar = <LinkSidebar vm={vm} variant={variant} … />;` — gains the prop `onCreateTask={openTask}` (keep every prop #214 added).

(h) Popup render site(s) in `thread-reader.tsx` (from Step 1's grep): on each `<LinkPopup` element add an `onCreateTask` prop that closes the popup and opens the dialog on the popup's message. The popup is given the message it links from as a prop (#214 spec: "the selected message is the popup's subject"); reuse **the same expression** passed to that prop, and the same call #214 uses to close the popup. For example, if #214 renders `<LinkPopup messageId={linkPopupFor} onClose={() => setLinkPopupFor(null)} … />`, add:

```tsx
                onCreateTask={() => {
                  const mid = linkPopupFor;
                  setLinkPopupFor(null);
                  openTask(mid);
                }}
```

(adapt `linkPopupFor` / `setLinkPopupFor` to #214's actual state names; the shape of the handler — capture message id, close popup, `openTask(id)` — must not change).

- [ ] **Step 12: Wire `link-sidebar.tsx`**

(a) Import after `import WorkLinkCard from "./work-link-card";` (or wherever #214 left the local imports):

```ts
import ThreadTasksCard from "./thread-tasks-card";
```

(b) Props: add to the destructure `onCreateTask,` and to the props type:

```ts
  /** #215 — opens the create-task dialog (owned by ThreadReader) on a message */
  onCreateTask?: (messageId: string | null) => void;
```

(c) Render the card inside the returned `<aside>`: as the last card, immediately before the trailing `{error && … }` block if #214 kept it, otherwise immediately before `</aside>`:

```tsx
      {/* #215 — open tasks created from this thread */}
      <ThreadTasksCard tasks={vm.threadTasks} />
```

(d) If Step 1's grep showed a `<LinkPopup` render site **in `link-sidebar.tsx`**, add an `onCreateTask` prop to that element (same rule as Step 11h: capture the message id the popup was opened on — the same expression passed to the popup's message prop — close the popup with #214's own close call, then hand the id up). For example, if #214 renders `<LinkPopup messageId={popupMessageId} onClose={() => setPopupOpen(false)} … />`, add:

```tsx
          onCreateTask={
            onCreateTask
              ? () => {
                  const mid = popupMessageId;
                  setPopupOpen(false);
                  onCreateTask(mid);
                }
              : undefined
          }
```

(adapt `popupMessageId` / `setPopupOpen` to #214's actual names; keep the handler's shape.)

If `link-sidebar.tsx` renders no `<LinkPopup` (#214 hoisted the popup into the reader), do **not** add the `onCreateTask` prop from (b) — remove it again so eslint doesn't flag an unused binding, and drop `onCreateTask={openTask}` from Step 11(g).

- [ ] **Step 13: Run the gates**

```bash
npx tsc --noEmit; echo "tsc exit $?"
npm run test:specs > "${TMPDIR:-/tmp}/specs-215.log" 2>&1; echo "exit $?"
grep -c '^PASS ' "${TMPDIR:-/tmp}/specs-215.log"; grep '^FAIL ' "${TMPDIR:-/tmp}/specs-215.log"; tail -1 "${TMPDIR:-/tmp}/specs-215.log"
npx eslint src/lib/inbox-task.ts src/lib/inbox-task-write.ts "src/app/(app)/inbox/task-actions.ts" "src/app/(app)/inbox/task-dialog.tsx" "src/app/(app)/inbox/thread-tasks-card.tsx" "src/app/(app)/inbox/types.ts" "src/app/(app)/inbox/page.tsx" "src/app/(app)/inbox/thread-reader.tsx" "src/app/(app)/inbox/link-sidebar.tsx" scripts/test-review-and-spec.ts
npm run build > "${TMPDIR:-/tmp}/build-215.log" 2>&1; echo "build exit $?"; tail -20 "${TMPDIR:-/tmp}/build-215.log"
```

Expected: tsc 0; specs exit 0, PASS = BASE + 14 + 26 + 11 + 31 (= BASE + 82), no FAIL, `ALL PASSED`; eslint 0 errors; build exit 0.

- [ ] **Step 14: Commit**

```bash
git add src/lib/inbox-task.ts src/lib/inbox-task-write.ts "src/app/(app)/inbox/task-actions.ts" "src/app/(app)/inbox/task-dialog.tsx" "src/app/(app)/inbox/thread-tasks-card.tsx" "src/app/(app)/inbox/types.ts" "src/app/(app)/inbox/page.tsx" "src/app/(app)/inbox/thread-reader.tsx" "src/app/(app)/inbox/link-sidebar.tsx" scripts/test-review-and-spec.ts
git commit -m "$(cat <<'EOF'
feat(inbox): create a task from an email; thread's open tasks in the sidebar (#215)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review (done while writing)

- **Spec coverage:** TaskRecord link fields + `createTask` + three readers → Task 1. `placeTasks` rules (future/undated/overdue/done/never past/today-out-of-range), `dayKeyOf` convention, normalizer to `{kind,id,title,dueAt,assigneeName,assigneeUserId,href}` → Task 2. Sources (tasks ≠ done with `assigneeUserId`; assignments not done with `assignee`, `dueDate` 0 = none), default mine, `?tasks=all` + toolbar toggle + initials, month-cell chips + week/day strip, checkbox complete / × delete with confirm, carried/overdue tags, refresh → Task 3. Dialog fields/prefills, `createTaskFromThreadAction` (requireUser, section Email, createdBy me, noon due, surveys/inspections as notes line, revalidate inbox + calendar via the layout), popup footer + per-message "Task…", sidebar open-tasks list with complete checkbox → Task 4. Home calendar card untouched.
- **Type consistency:** `CalendarTaskItem`/`PlacedTask` names match across Tasks 2–3; `ThreadTaskRequest`, `ThreadTaskLinkKind`, `ThreadTaskRow` match across `inbox-task.ts`, the writer, the actions, `types.ts`, the dialog and the card; `onCreateTask: (messageId: string | null) => void` on LinkSidebar vs `() => void` on #214's popup are distinct on purpose.
- **Known adaptive points:** Task 4 Steps 11(b), 11(h) and 12(c–d) name #214 landmarks; Step 1 stops the task if #214 is absent.
