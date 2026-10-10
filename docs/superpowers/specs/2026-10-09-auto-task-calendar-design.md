# Auto task calendar — design

Date: 2026-10-09 · Status: approved in brainstorm, awaiting spec review ·
Punch #: assigned at merge (recompute from origin/main).

Spec 3 of 4 from Jeff's "App ideas" list. **Depends on specs 1 and 2**
(drive blocks, site visits as fixed blocks, work hours).

A Motion-style auto scheduler with Motion's upkeep removed: two inputs at
most, priority that rises by itself as due dates near, and started or
hand-placed work that never moves.

## Background — how Motion works, and why it became upkeep

Researched 2026-10-09 from Motion's help center and reviews:

- Every task needs a duration plus a deadline or priority, or it won't
  schedule (default 30 min, "adjust to real effort"). Ordering: ASAP →
  sooner deadline → higher priority; calendar events beat task blocks;
  chunking splits long tasks; start dates hold tasks back.
- It re-plans on every meeting or conflict; tasks "can shift multiple
  times". Past-due tasks move to the next slot; unfit tasks show "Could not
  fit" until the user edits duration/deadline/priority. A hand-moved block
  locks.
- Complaints: too many per-task inputs, a plan that keeps reshuffling, "if
  you get too busy to open the app you're at square zero", and fixing unfit
  tasks by re-weighting by hand.

Sources: usemotion.com/help (Concept: Auto-scheduling; What Auto-Scheduling
considers; How Auto-Scheduling works behind the scenes; Resolve Issues box);
Upbase, Capterra and Trustpilot reviews.

### What this design keeps vs drops

| Motion | Here |
|---|---|
| Duration required | Optional S/M/L, default 1 h |
| Priority + deadline + ASAP + hard deadline | Due date + 3 tiers; blended urgency; no ASAP |
| Re-plan on every change | Kept (live computation) — but started / hand-placed blocks are pinned |
| Fill all free time | 80 % of free time |
| "Could not fit" → user re-weights | Placed late + **At risk** with one-click fixes |

## Goals

- Tasks and Queue assignments are placed as time blocks into each person's
  free time automatically.
- Inputs: a due date and an optional tier and size — nothing required.
- Only unstarted work moves. Nobody re-weights by hand.
- Plans flex around site visits and drive blocks, never over them.

## Non-goals

- Writing task blocks to Google Calendar (app only).
- ASAP / hard-deadline overrides; scheduling outside work hours.
- Learning task lengths from history.
- Morning triage (spec 4).

## Current state (origin/main ac5e6751)

- `TaskRecord` (`src/lib/stores/tasks.ts`, doc collection): `status
  open|in_progress|done|blocked`, `assigneeUserId/Name`, `dueAt`, `startAt`
  (Gantt start), parent + email links; no priority/duration. Create paths:
  `createTask`, `createAutoTask`, email (`inbox-task-write.ts`), templates,
  Krisp (#323 branch).
- Assignments (`src/lib/stores/assignments.ts`, doc collection): `assignee`
  (a name), `dueDate`, `done`, synced two-way with Google Tasks (D146);
  `createAssignment`.
- `/calendar` has Month / Week / Day views (`?view=`); tasks are day chips
  placed by `placeTasks()` (`src/lib/calendar-tasks.ts`); Mine/Everyone.

## Part 1 — Inputs and data

### What is scheduled

Every open task and Queue assignment **with an assignee**, including
auto-generated checklist / template tasks.

### New fields (tasks + assignments; no migration)

| Field | Values | Blank means |
|---|---|---|
| `priority` | `high` · `normal` · `low` | normal |
| `size` | `s` 30 min · `m` 1 h · `l` 4 h | 1 h |
| `planPins` | `{ startMs, endMs, kind: "started" \| "hand" }[]` | none |

Task forms (task drawer, project task rows, email-task and meeting-to-do
dialogs, Queue assignment form) gain two optional chip rows: High / Normal /
Low and S / M / L.

### Due dates

- **New** tasks/assignments created without a due date get one **+7 days**
  (end of that Chicago day) — applied once in `createTask`,
  `createAutoTask` and `createAssignment` so every path inherits it. An
  assignment's date syncs to Google Tasks as today.
- **Existing** open, assigned, undated items: a one-time backfill spreads due
  dates evenly across the next **4 weeks** of each person's work days,
  oldest first. Dry run by default (counts per person); `--apply` writes;
  idempotent (a second run finds nothing to change).
- A template's `startAt` is the earliest day the task may be placed.

### Visibility

Own plan by default; Everyone toggle, as `/calendar` today.

## Part 2 — Scheduler

### Engine

Pure module `src/lib/task-plan/`: `planPerson(input) → { blocks, flags }`,
no IO, deterministic (same input → same plan). Computed whenever a plan is
viewed, and on the morning cron.

### Free time

The person's work hours (spec 2; company default Mon–Fri 8–5) minus site
visits + drive blocks (specs 1–2), accepted timed Google events (all-day
ignored), and pins. At most **80 %** of each day's free minutes is filled.
Horizon: until everything is placed, capped at 8 weeks.

### Ordering — blended urgency

- weight = tier factor (High 3 · Normal 2 · Low 1) × closeness of due date,
  where closeness rises steeply over the last few days.
- Required property: a Low task due tomorrow outranks a High task due in a
  month. The exact curve is fixed in the plan, with checks for this and
  similar cases.
- **Overdue** outranks everything, most overdue first.
- Ties: earlier due → older `createdAt` → id.

### Placement

- Highest weight first, into the earliest free time at or after max(task's
  earliest start, now rounded up to the next quarter hour).
- 15-minute grid. Splitting allowed in chunks **≥ 30 min**.
- Can't finish by its due date → still placed at the first time available,
  flagged **At risk**.

### Pins — only unstarted work moves

- **Started:** when a plan is computed and one of its blocks has already
  begun, that block is persisted as a `started` pin. Marking a task In
  progress pins its current block too.
- **Hand:** dragging a block persists a `hand` pin.
- Pinned blocks never move and are removed from free time first.
- **Unfinished:** a started task not done by the end of its day has its
  remaining time (size − pinned minutes so far) pinned at the start of the
  next work day.
- Done or deleted → its future pins are cleared.
- Known limit: a block counts as started only once a plan is computed after
  its start (any page view, or the morning cron). A block on a day nobody
  opened the app isn't pinned and may move.

## Part 3 — Screens, At risk, failures

### Calendar

`/calendar` Week and Day views draw task blocks (lighter than visits, drive
blocks and Google events; 📌 when pinned). Clicking a block opens the task
(Done, In progress, Unpin, tier/size chips). Dragging pins it at the new
time; Unpin returns it to the scheduler. Month view keeps day chips, now
fed by each day's planned tasks. Mine / Everyone unchanged.

### At risk

- **Badge on the block** — "At risk — due Tue".
- **Panel on `/calendar`** — the at-risk list with one-click fixes: **Push
  due date** (to the plan's finish date), **Hand off** (reassign), **Unpin
  something** to free time.
- **Home card "Today"** — today's blocks in order + at-risk count, linking
  to `/calendar?view=day`.

### Google

Task blocks are app-only; nothing written to Google Calendar. The +7 due
date reaches Google Tasks via the existing assignment sync.

### Failures

- A person's Google Calendar can't be read → their plan shows "Planned
  without your Google calendar — may overlap meetings"; it is still shown.
- No work hours set → company default.

## Testing (`test:specs`)

- Weight ordering incl. Low-due-tomorrow beats High-due-next-month; overdue
  first; deterministic ties.
- 80 % cap; 15-min grid; chunks ≥ 30 min; template `startAt` respected; At
  risk placed after due.
- Started / hand / in-progress pins never move; unfinished remainder pinned
  next morning; done/deleted clears future pins.
- Free time excludes visits, drives, accepted timed events; all-day ignored.
- +7 rule in `createTask`, `createAutoTask`, `createAssignment`.
- Backfill spread: dry run vs apply; second run no-op.
