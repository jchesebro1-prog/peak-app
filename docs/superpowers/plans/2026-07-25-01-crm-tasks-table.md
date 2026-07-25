# CRM Plan 01 — Tasks Table + Bell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the embedded `ProjectTask[]` to a real cross-record `tasks` doc-collection with user-id assignees, due dates, 4-state status, and notes; surface overdue + assigned-to-me tasks in the bell; auto-generate the item-16 sold/completed follow-up tasks; ship quick fix #32 (address-picker fallback) and the #28 stale-comment cleanup.

**Architecture:** New `tasks` doc-collection (the app's doc-store idiom — `docTable("tasks")` + a store module like `assignments.ts`), registered in both offline-sync allowlists so mobile Field Work keeps working offline. Legacy embedded tasks migrate lazily and idempotently on read (preserving their `tk-` ids). Template expansion copies the `blankRubric` + coverage-key de-dup pattern from `inspections.ts`; the production template ships empty until Jeff's checklist homework lands. Item-16 auto-tasks hang off the two clean hook points found in the PUNCHLIST audit (project materialized from a won quote; stage → `complete`), guarded by coverage keys because both triggers are re-runnable by design.

**Tech Stack:** Next.js 16 (App Router, server actions), Drizzle + PGlite/Postgres jsonb doc-store, hand-rolled `tsx` test harness.

## Global Constraints

- **Base branch:** `quartzite-6-rebrand` must be merged into `main` before this plan executes; branch `crm-01-tasks` off `main` after that merge. Nav files cited below (`src/components/nav/nav-data.ts`, `src/components/nav/Nav.tsx`) exist only post-rebrand.
- **Doc-store idiom:** domain records are whole-JSON docs; no DB-level foreign keys ever (D85 convention); all timestamps are epoch-ms `number`s; pretty ids via `nextPrefixedId(collection, prefix, base)`.
- **Sync mirror rule:** `SYNCABLE_COLLECTIONS` (`src/db/doc-tables.ts`) and `FIELD_COLLECTIONS` (`src/lib/sync/engine.ts`) MUST list the same collections — the push endpoint rejects anything not in the first; the outbox only captures the second.
- **Client-bundle rule:** `"use client"` files may only `import type` from any module that reaches `src/db/doc-store.ts` — a value import pulls PGlite into the browser bundle and fails `npm run build` (not tsc). Server actions are exempt (they compile to reference stubs).
- **Never run `npm run build` while a dev server is running** (PGlite is single-process; D106).
- **Tests:** append `ok(cond, "msg")` assertions to `scripts/test-review-and-spec.ts` (the single-file harness; no framework). Only pure functions — nothing that touches the DB. Run: `npm run test:specs`. Typecheck: `npx tsc --noEmit`.
- **Assignee convention (new, per item-17 decision C):** store `assigneeUserId` (from `users.id`, e.g. `"u1"`) plus denormalized `assigneeName`. Everywhere else in the app, `me`-matching is by display name (`requireUser().name`); the bell matches tasks by `assigneeName`.
- **All writes go through permission-checked server actions** (`requireUser()` from `@/lib/session`), except the offline sync path for field collections.

---

### Task 1: Tasks store module + collection registration

**Files:**
- Modify: `src/db/doc-tables.ts` (add `tasks` table, `DOC_TABLES` entry, `SYNCABLE_COLLECTIONS` entry)
- Modify: `src/lib/sync/engine.ts:32` (add `"tasks"` to `FIELD_COLLECTIONS`)
- Create: `src/lib/stores/tasks.ts`
- Test: `scripts/test-review-and-spec.ts` (append a `TASKS (#17)` section)

**Interfaces:**
- Consumes: `listDocs/getDoc/upsertDoc/patchDoc/softDeleteDoc/nextPrefixedId` from `@/db/doc-store`; `type ProjectTask`, `type ProjectStage` (type-only) from `@/lib/stores/projects`.
- Produces (later tasks rely on these exact names):
  - `type TaskStatus = "open" | "in_progress" | "done" | "blocked"`
  - `type TaskRecord` (fields below), `STATUSES`, `STATUS_META`
  - Pure: `isOverdue(t, nowMs)`, `taskFromLegacy(projectId, pt, at)`, `expandTemplate(items, stage, existingKeys)`, `taskBellItems(all, me, nowMs)`
  - Store: `allTasks()`, `tasksForProject(projectId)`, `createTask(input, me)`, `createAutoTask(input)`, `setTaskStatus(id, status)`, `updateTask(id, patch)`, `removeTask(id)`
  - `TASK_TEMPLATE: Record<ProjectStage, TaskTemplateItem[]>`

- [ ] **Step 1: Write the failing tests**

Append to `scripts/test-review-and-spec.ts` (bottom, before the final tally):

```ts
/* ============ TASKS (#17) — store pure logic ============ */
import {
  isOverdue, taskFromLegacy, expandTemplate, taskBellItems,
  STATUSES, type TaskRecord, type TaskTemplateItem,
} from "@/lib/stores/tasks";

{
  const NOW = 1_800_000_000_000;
  const DAY = 86400000;
  ok(STATUSES.length === 4 && STATUSES.includes("blocked"), "tasks: 4-state status includes blocked");

  ok(isOverdue({ dueAt: NOW - DAY, status: "open" }, NOW) === true, "tasks: past-due open task is overdue");
  ok(isOverdue({ dueAt: NOW - DAY, status: "done" }, NOW) === false, "tasks: done task is never overdue");
  ok(isOverdue({ dueAt: null, status: "open" }, NOW) === false, "tasks: no due date, never overdue");
  ok(isOverdue({ dueAt: NOW + DAY, status: "blocked" }, NOW) === false, "tasks: future due date not overdue");

  const legacy = taskFromLegacy("P-3001", { id: "tk-abc", title: "Hang truss", section: "Install", assignee: "Sam Rivera", done: true, doneAt: NOW - DAY }, NOW);
  ok(legacy.id === "tk-abc", "tasks: migration preserves legacy tk- id");
  ok(legacy.projectId === "P-3001" && legacy.quoteId === null, "tasks: migration sets project parent pointer");
  ok(legacy.status === "done" && legacy.doneAt === NOW - DAY, "tasks: legacy done maps to status done with doneAt kept");
  ok(legacy.assigneeName === "Sam Rivera" && legacy.assigneeUserId === null, "tasks: legacy name kept, no user id");
  const legacyOpen = taskFromLegacy("P-3001", { id: "tk-def", title: "Pull cable", section: "Install", assignee: "", done: false }, NOW);
  ok(legacyOpen.status === "open" && legacyOpen.doneAt === null, "tasks: legacy undone maps to open");

  const tmpl: TaskTemplateItem[] = [
    { key: "walkthrough", title: "Walk the room with the customer" },
    { key: "punch", title: "Write the punch list", section: "Closeout" },
  ];
  const fresh = expandTemplate(tmpl, "signoff", new Set());
  ok(fresh.length === 2 && fresh[0].coverageKey === "signoff:walkthrough", "tasks: template expands with stage-scoped coverage keys");
  ok(fresh[1].section === "Closeout" && fresh[0].section === "Install", "tasks: template section defaults to Install");
  const rerun = expandTemplate(tmpl, "signoff", new Set(["signoff:walkthrough"]));
  ok(rerun.length === 1 && rerun[0].coverageKey === "signoff:punch", "tasks: coverage-key de-dup skips existing on re-entry");

  const mk = (o: Partial<TaskRecord>): TaskRecord => ({
    id: "T-6000", title: "t", section: "Install", projectId: null, quoteId: null,
    coverageKey: null, assigneeUserId: null, assigneeName: "", dueAt: null,
    status: "open", notes: "", createdBy: "x", createdAt: NOW, updatedAt: NOW, doneAt: null, ...o,
  });
  const bell = taskBellItems([
    mk({ id: "a", assigneeName: "Jeff Chesebro" }),                       // mine, open
    mk({ id: "b", assigneeName: "Someone Else", dueAt: NOW - DAY }),      // overdue, not mine
    mk({ id: "c", assigneeName: "Someone Else" }),                        // not mine, not overdue
    mk({ id: "d", assigneeName: "Jeff Chesebro", status: "done" }),       // mine but done
  ], "Jeff Chesebro", NOW);
  ok(bell.map(t => t.id).join(",") === "a,b", "tasks: bell = open assigned-to-me + overdue, done excluded");
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:specs`
Expected: the run errors (module `@/lib/stores/tasks` does not exist yet).

- [ ] **Step 3: Register the collection**

In `src/db/doc-tables.ts`, after the `gridSheets` line add:

```ts
export const tasks = docTable("tasks"); // cross-record task rows, promoted from embedded ProjectTask[] (#17)
```

Add `tasks,` to the `DOC_TABLES` object (after `grid_sheets: gridSheets,`), and add `"tasks",` to `SYNCABLE_COLLECTIONS` (Field Work writes tasks offline; tasks carry no approval subdoc or pricing, so the endpoint guardrail comment still holds).

In `src/lib/sync/engine.ts`, add `"tasks",` to `FIELD_COLLECTIONS` (keep the two lists mirrored — see the comment above that array).

- [ ] **Step 4: Write the store**

Create `src/lib/stores/tasks.ts`:

```ts
import {
  listDocs, getDoc, upsertDoc, patchDoc, softDeleteDoc, nextPrefixedId,
} from "@/db/doc-store";
import type { ProjectTask, ProjectStage } from "@/lib/stores/projects";

/* ============================================================
   Tasks (#17) — the app's first cross-record task collection,
   promoted from the embedded ProjectTask[] (decision A, 7/19).
   Parent pointers are nullable (projectId / quoteId); assignee
   is user-id + denormalized display name (decision C); status
   is the 4-state enum (decision D). Item-16 sold/completed
   follow-ups are auto-created rows guarded by coverageKey.
   ============================================================ */

const now = () => Date.now();

export const STATUSES = ["open", "in_progress", "done", "blocked"] as const;
export type TaskStatus = (typeof STATUSES)[number];

export const STATUS_META: Record<TaskStatus, { label: string; short: string }> = {
  open:        { label: "Open",        short: "Open" },
  in_progress: { label: "In progress", short: "Doing" },
  done:        { label: "Done",        short: "Done" },
  blocked:     { label: "Blocked",     short: "Blocked" },
};

export type TaskRecord = {
  id: string;                    // "T-####" (office-created) or "tk-…" (field-created / migrated)
  title: string;
  section: string;               // Field Work grouping; "Install" default, "" for non-project tasks
  projectId: string | null;      // parent pointers — nullable, no FK (D85 convention)
  quoteId: string | null;
  coverageKey: string | null;    // stable template/auto key; null for manual tasks
  assigneeUserId: string | null; // users.id ("u1"); null = unassigned or legacy
  assigneeName: string;          // denormalized display name; "" = unassigned
  dueAt: number | null;          // epoch-ms
  status: TaskStatus;
  notes: string;
  createdBy: string;             // display name
  createdAt: number;
  updatedAt: number;
  doneAt: number | null;
};

export type TaskTemplateItem = { key: string; title: string; section?: string };

/** Per-stage standard checklists (#17 "template + manual"). CONTENT IS JEFF'S
    HOMEWORK — ship empty; expansion is a no-op until items are filled in. */
export const TASK_TEMPLATE: Record<ProjectStage, TaskTemplateItem[]> = {
  procurement: [], delivery: [], scheduled: [], install: [],
  training: [], signoff: [], complete: [],
};

/* ---------- pure helpers (covered by test:specs) ---------- */

export function isOverdue(t: Pick<TaskRecord, "dueAt" | "status">, nowMs: number): boolean {
  return !!t.dueAt && t.status !== "done" && t.dueAt < nowMs;
}

/** Map one embedded ProjectTask to a TaskRecord, preserving its id. */
export function taskFromLegacy(projectId: string, pt: ProjectTask, at: number): TaskRecord {
  return {
    id: pt.id, title: pt.title, section: pt.section || "Install",
    projectId, quoteId: null, coverageKey: null,
    assigneeUserId: null, assigneeName: pt.assignee || "",
    dueAt: null, status: pt.done ? "done" : "open", notes: "",
    createdBy: pt.assignee || "", createdAt: at, updatedAt: at,
    doneAt: pt.done ? (pt.doneAt ?? at) : null,
  };
}

/** blankRubric-style expansion with coverage-key de-dup (inspections.ts idiom):
    emit only template items whose stage-scoped key is not already present. */
export function expandTemplate(
  items: TaskTemplateItem[], stage: string, existingKeys: ReadonlySet<string>,
): { coverageKey: string; title: string; section: string }[] {
  const out: { coverageKey: string; title: string; section: string }[] = [];
  for (const it of items) {
    const coverageKey = stage + ":" + it.key;
    if (existingKeys.has(coverageKey)) continue;
    out.push({ coverageKey, title: it.title, section: it.section || "Install" });
  }
  return out;
}

/** Bell rail (#17): open tasks assigned to me, plus anything overdue. */
export function taskBellItems(all: TaskRecord[], me: string, nowMs: number): TaskRecord[] {
  return all.filter(
    (t) => t.status !== "done" && (t.assigneeName === me || isOverdue(t, nowMs)),
  );
}

/* ---------- normalize + CRUD ---------- */

function normalizeTask(raw: Partial<TaskRecord> & { id: string }): TaskRecord {
  const at = raw.createdAt ?? now();
  return {
    id: raw.id, title: raw.title || "New task", section: raw.section ?? "Install",
    projectId: raw.projectId ?? null, quoteId: raw.quoteId ?? null,
    coverageKey: raw.coverageKey ?? null,
    assigneeUserId: raw.assigneeUserId ?? null, assigneeName: raw.assigneeName ?? "",
    dueAt: raw.dueAt ?? null,
    status: (STATUSES as readonly string[]).includes(raw.status as string) ? (raw.status as TaskStatus) : "open",
    notes: raw.notes ?? "", createdBy: raw.createdBy ?? "",
    createdAt: at, updatedAt: raw.updatedAt ?? at, doneAt: raw.doneAt ?? null,
  };
}

export async function allTasks(): Promise<TaskRecord[]> {
  const rows = await listDocs<TaskRecord>("tasks");
  return rows.map(normalizeTask).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function tasksForProject(projectId: string): Promise<TaskRecord[]> {
  return (await allTasks()).filter((t) => t.projectId === projectId);
}

export async function getTask(id: string): Promise<TaskRecord | null> {
  const doc = await getDoc<TaskRecord>("tasks", id);
  return doc ? normalizeTask(doc) : null;
}

export async function createTask(
  input: Partial<TaskRecord> & { title: string },
  me: { id: string; name: string },
): Promise<TaskRecord> {
  const at = now();
  const id = input.id || (await nextPrefixedId("tasks", "T", 6000));
  const t = normalizeTask({ ...input, id, createdBy: me.name, createdAt: at, updatedAt: at });
  await upsertDoc("tasks", id, t);
  return t;
}

/** Idempotent system-created task (templates, item 16): coverageKey is the
    dedup guard — both trigger paths are re-runnable by design (PUNCHLIST §16). */
export async function createAutoTask(
  input: Partial<TaskRecord> & { title: string; coverageKey: string },
): Promise<TaskRecord | null> {
  const existing = (await allTasks()).find((t) => t.coverageKey === input.coverageKey);
  if (existing) return null;
  const at = now();
  const id = await nextPrefixedId("tasks", "T", 6000);
  const t = normalizeTask({ ...input, id, createdBy: input.createdBy || "System", createdAt: at, updatedAt: at });
  await upsertDoc("tasks", id, t);
  return t;
}

export async function setTaskStatus(id: string, status: TaskStatus): Promise<TaskRecord | null> {
  if (!(STATUSES as readonly string[]).includes(status)) return null;
  return patchDoc<TaskRecord>("tasks", id, (t) => {
    t.status = status;
    t.doneAt = status === "done" ? now() : null;
    t.updatedAt = now();
    return t;
  });
}

export async function updateTask(
  id: string,
  patch: Partial<Pick<TaskRecord, "title" | "section" | "assigneeUserId" | "assigneeName" | "dueAt" | "notes">>,
): Promise<TaskRecord | null> {
  return patchDoc<TaskRecord>("tasks", id, (t) => {
    Object.assign(t, patch);
    t.updatedAt = now();
    return t;
  });
}

export async function removeTask(id: string): Promise<void> {
  await softDeleteDoc("tasks", id);
}
```

Note: the `ProjectTask`/`ProjectStage` import is **type-only** — no runtime cycle when `projects.ts` later imports task functions (Task 4).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:specs`
Expected: all new `tasks:` lines PASS; suite ends `ALL PASSED`.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Generate the migration for the new table**

Run: `npm run db:generate`
Expected: a new `drizzle/0009_*.sql` containing `CREATE TABLE "tasks"`. (Dev PGlite applies it on next boot; hosted applies during `npm run build` via `scripts/migrate.mjs`.)

- [ ] **Step 7: Commit**

```bash
git add src/db/doc-tables.ts src/lib/sync/engine.ts src/lib/stores/tasks.ts scripts/test-review-and-spec.ts drizzle
git commit -m "feat: tasks doc-collection — 4-state cross-record task store with template expansion (#17)"
```

---

### Task 2: Lazy migration + Field Work moves to the tasks store

**Files:**
- Modify: `src/lib/stores/tasks.ts` (add `ensureProjectTasksMigrated`)
- Modify: `src/app/(app)/field-work/actions.ts` (rewrite both actions)
- Modify: `src/app/(app)/field-work/page.tsx` (migrate-on-read; fetch tasks from the store)
- Modify: `src/app/(app)/field-work/controls.tsx` (task props become `TaskRecord`s; outbox writes `collection: "tasks"`)
- Modify: `src/lib/stores/projects.ts` (delete `addTask`/`toggleTask`; keep `ProjectTask` type + the `tasks` field for legacy docs)
- Test: `scripts/test-review-and-spec.ts` (already covers `taskFromLegacy`; no new pure logic)

**Interfaces:**
- Consumes: `taskFromLegacy`, `createTask`, `setTaskStatus`, `tasksForProject` from Task 1; `saveThroughOutbox` (`src/lib/sync/save.ts`) + `stampDoc` exactly as `controls.tsx` uses them today for `"projects"`.
- Produces: `ensureProjectTasksMigrated(projects: ProjectRecord[]): Promise<void>` — idempotent; later tasks (3, 4) and plan 04 call the store knowing embedded tasks are already migrated on any page that renders them.

- [ ] **Step 1: Add the lazy migration**

Append to `src/lib/stores/tasks.ts`:

```ts
import type { ProjectRecord } from "@/lib/stores/projects";

/** One-way, idempotent: copy any project's embedded tasks[] into the tasks
    collection (preserving tk- ids), then blank the embedded array. Runs on
    read from the pages that render tasks, so dev seeds, prod data, and field
    mirrors all migrate without a manual step. */
export async function ensureProjectTasksMigrated(projects: ProjectRecord[]): Promise<void> {
  for (const p of projects) {
    const legacy = Array.isArray(p.tasks) ? p.tasks : [];
    if (!legacy.length) continue;
    for (const pt of legacy) {
      const hit = await getDoc<TaskRecord>("tasks", pt.id);
      if (!hit) await upsertDoc("tasks", pt.id, taskFromLegacy(p.id, pt, now()));
    }
    await patchDoc<ProjectRecord>("projects", p.id, (doc) => {
      doc.tasks = [];
      doc.updatedAt = now();
      return doc;
    });
  }
}
```

(`ProjectRecord` is another type-only import; keep it in the `import type` line.)

- [ ] **Step 2: Rewrite the Field Work server actions**

Replace the two task actions in `src/app/(app)/field-work/actions.ts` (keep the existing imports/`requireUser`/`revalidatePath` shape of the file):

```ts
export async function toggleFieldTask(formData: FormData) {
  await requireUser();
  const taskId = String(formData.get("taskId") || "");
  const done = String(formData.get("done") || "") === "1";
  if (!taskId) return;
  await setTaskStatus(taskId, done ? "done" : "open");
  revalidatePath("/", "layout");
}

export async function addFieldTask(formData: FormData) {
  const me = await requireUser();
  const projectId = String(formData.get("id") || "");
  const title = String(formData.get("title") || "").trim();
  const clientId = String(formData.get("taskId") || "");
  if (!projectId || !title) return;
  await createTask(
    { id: clientId || undefined, title, section: "Install", projectId,
      assigneeUserId: me.id, assigneeName: me.name },
    me,
  );
  revalidatePath("/", "layout");
}
```

`clientId` lets the offline path mint the id client-side (`"tk-" + …`, same generator the component already uses) so the outbox doc and the server row agree on identity.

- [ ] **Step 3: Move the Field Work UI onto TaskRecords**

In `src/app/(app)/field-work/page.tsx`: after the existing project load, call `await ensureProjectTasksMigrated(projects)` once, then fetch `const taskRows = await allTasks()` and pass each job's tasks (`taskRows.filter(t => t.projectId === job.id)`) into `FieldWorkDetail` in place of `p.tasks`. Task-count chips on job cards compute from the same rows (`done = status === "done"`).

In `src/app/(app)/field-work/controls.tsx`:
- The task list prop becomes `tasks: TaskRecord[]` (**`import type { TaskRecord } from "@/lib/stores/tasks"`** — type-only, client-bundle rule). Grouping by `section` and the done checkbox read `t.status === "done"`.
- `onToggleTask` / `onAddTask` now build a `TaskRecord` and persist it through the outbox as its own doc, mirroring the existing call shape exactly but with the new collection:

```ts
const next: TaskRecord = { ...t, status: done ? "done" : "open", doneAt: done ? Date.now() : null, updatedAt: Date.now() };
saveThroughOutbox({ collection: "tasks", id: next.id, doc: stampDoc(next), action: () => toggleFieldTask(fd) });
```

For adds, mint the id client-side with the component's existing uid helper (`"tk-" + …`), include it in the FormData as `taskId`, and outbox the full new `TaskRecord` the same way. The whole-project-doc write for task edits goes away.

- [ ] **Step 4: Delete the dead embedded-task writers**

In `src/lib/stores/projects.ts`: delete `addTask` (line ~700) and `toggleTask` (line ~720). Keep `export type ProjectTask` and the `tasks: ProjectTask[]` field + its `normalizeProject` backfill — legacy docs and un-flushed field mirrors still carry it; the migration reads it.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` — expect errors at every remaining `addTask`/`toggleTask` import site; fix each by switching to the tasks store (the only expected sites are `field-work/actions.ts` — already rewritten — and `projects/actions.ts`, which Task 3 rewrites; if Task 3 hasn't run yet, delete the two dead wrappers there now, they have zero callers).
Run: `npm run test:specs`
Expected: `ALL PASSED`.

- [ ] **Step 6: Commit**

```bash
git add -A src
git commit -m "feat: Field Work + lazy migration onto the tasks collection; embedded ProjectTask writers removed (#17)"
```

---

### Task 3: Project-detail tasks card + rewritten office actions + stage-change expansion

**Files:**
- Modify: `src/app/(app)/projects/actions.ts` (replace dead `addTaskAction`/`toggleTaskAction` with real ones)
- Create: `src/app/(app)/projects/tasks-card.tsx` (client component)
- Modify: `src/app/(app)/projects/view.tsx` (swap the read-only "N / M tasks" block for the card)
- Modify: `src/app/(app)/projects/data.ts` (`loadProjectsData` also migrates + returns task rows and `activeUsers()`)
- Modify: `src/lib/stores/projects.ts` (`setProjectStage` expands the stage template)

**Interfaces:**
- Consumes: everything from Task 1; `activeUsers()` from `@/lib/users`; `requireUser` from `@/lib/session`.
- Produces: server actions `addTaskAction(formData)`, `setTaskStatusAction(formData)`, `updateTaskAction(formData)` in `src/app/(app)/projects/actions.ts`; component `TasksCard({ projectId, tasks, people })` where `people: { id: string; name: string }[]`.

- [ ] **Step 1: Rewrite the office server actions**

In `src/app/(app)/projects/actions.ts`, replace the two dead actions with (match the file's existing `requireUser` + `revalidatePath("/", "layout")` idiom):

```ts
export async function addTaskAction(formData: FormData) {
  const me = await requireUser();
  const projectId = String(formData.get("id") || "");
  const title = String(formData.get("title") || "").trim();
  const section = String(formData.get("section") || "Install");
  const assigneeUserId = String(formData.get("assigneeUserId") || "") || null;
  const due = String(formData.get("dueAt") || "");
  if (!projectId || !title) return;
  const assigneeName = assigneeUserId
    ? (await activeUsers()).find((u) => u.id === assigneeUserId)?.name || ""
    : "";
  await createTask(
    { title, section, projectId, assigneeUserId, assigneeName,
      dueAt: due ? new Date(due + "T12:00:00").getTime() : null },
    me,
  );
  revalidatePath("/", "layout");
}

export async function setTaskStatusAction(formData: FormData) {
  await requireUser();
  const taskId = String(formData.get("taskId") || "");
  const status = String(formData.get("status") || "");
  if (!taskId || !(STATUSES as readonly string[]).includes(status)) return;
  await setTaskStatus(taskId, status as TaskStatus);
  revalidatePath("/", "layout");
}

export async function updateTaskAction(formData: FormData) {
  await requireUser();
  const taskId = String(formData.get("taskId") || "");
  if (!taskId) return;
  const patch: Record<string, unknown> = {};
  if (formData.has("assigneeUserId")) {
    const uid = String(formData.get("assigneeUserId") || "") || null;
    patch.assigneeUserId = uid;
    patch.assigneeName = uid ? (await activeUsers()).find((u) => u.id === uid)?.name || "" : "";
  }
  if (formData.has("dueAt")) {
    const d = String(formData.get("dueAt") || "");
    patch.dueAt = d ? new Date(d + "T12:00:00").getTime() : null;
  }
  if (formData.has("notes")) patch.notes = String(formData.get("notes") || "");
  await updateTask(taskId, patch);
  revalidatePath("/", "layout");
}
```

- [ ] **Step 2: Build the tasks card**

Create `src/app/(app)/projects/tasks-card.tsx` — `"use client"`; type-only store imports. Renders the section-grouped list: per row a status `<select>` (posting `setTaskStatusAction` via a small `<form>` with hidden `taskId`, matching the stage-tracker form idiom in `view.tsx`), assignee `<select>` over `people` + due-date `<input type="date">` (posting `updateTaskAction`), and a footer add-row `<form action={addTaskAction}>` with title / section / assignee / due inputs and hidden `id={projectId}`. Overdue rows (`dueAt < Date.now() && status !== "done"`) get the app's existing risk tint class used by the project list (`.pm-risk` — copy the class the "at-risk" chip uses in `view.tsx`). Keep styling to the classes already in the file's neighborhood (`card`, `.pm-grid` children).

- [ ] **Step 3: Wire data + swap the view block**

In `src/app/(app)/projects/data.ts` (`loadProjectsData`): after projects load, `await ensureProjectTasksMigrated(projects)`, then return `taskRows: await allTasks()` and `people: (await activeUsers()).map(u => ({ id: u.id, name: u.name }))` alongside the existing payload.

In `src/app/(app)/projects/view.tsx` (`ProjectDetail`, lines ~1005–1076): replace the read-only tasks progress block with `<TasksCard projectId={p.id} tasks={taskRows.filter(t => t.projectId === p.id)} people={people} />`, keeping the "N / M done" summary line above it (computed from the same rows).

- [ ] **Step 4: Expand the stage template on stage change**

In `src/lib/stores/projects.ts`, at the end of `setProjectStage(id, stage, by)` (after `recordStageChange`), add:

```ts
// #17 template expansion: entering a stage adds its standard checklist once
// (coverage-key de-dup; TASK_TEMPLATE ships empty until the checklist
// homework lands, so this is a safe no-op today).
const { TASK_TEMPLATE, expandTemplate, tasksForProject, createAutoTask } = await import("@/lib/stores/tasks");
const existing = new Set((await tasksForProject(id)).map((t) => t.coverageKey).filter(Boolean) as string[]);
for (const item of expandTemplate(TASK_TEMPLATE[stage] || [], stage, existing)) {
  await createAutoTask({ ...item, projectId: id, title: item.title });
}
```

(The dynamic import keeps module init acyclic; `projects.ts` ↔ `tasks.ts` would otherwise be a static cycle.)

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` — clean.
Run: `npm run test:specs` — `ALL PASSED`.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(app\)/projects src/lib/stores/projects.ts
git commit -m "feat: project-detail tasks card, office task actions, stage-template expansion (#17)"
```

---

### Task 4: Bell integration + item-16 auto-tasks

**Files:**
- Modify: `src/lib/nav-counts.ts` (tasks group)
- Modify: `src/lib/stores/notif-prefs.ts` (new category)
- Modify: `src/lib/stores/projects.ts` (item-16 hooks)
- Test: `scripts/test-review-and-spec.ts` (`taskBellItems` already covered; add the category-key parity check)

**Interfaces:**
- Consumes: `allTasks`, `taskBellItems`, `isOverdue` from Task 1; the `push(key, label, items)` helper inside `navData` (`src/lib/nav-counts.ts:115`); `shortDate` from `@/lib/format`; `getQuote` (already reachable from `projects.ts` — it imports the quotes store for `syncProjectsFromQuotes`).
- Produces: bell group keyed `"tasks"`; notif-prefs category `"tasks"`; auto-tasks with coverage keys `item16:sold:<projectId>` / `item16:completed:<projectId>`.

- [ ] **Step 1: Write the failing parity test**

Append to the tasks test section:

```ts
import { CATEGORIES } from "@/lib/stores/notif-prefs";
ok(CATEGORIES.some((c) => c.key === "tasks"), "tasks: bell category registered in notif-prefs");
```

Run: `npm run test:specs` — the new line FAILs.

- [ ] **Step 2: Register the category**

In `src/lib/stores/notif-prefs.ts`, append to `CATEGORIES`:

```ts
{ key: "tasks", label: "Tasks assigned to you or overdue", desc: "Open tasks assigned to you, plus any task past its due date." },
```

- [ ] **Step 3: Add the bell group**

In `src/lib/nav-counts.ts` (`navData`): add `allTasks()` to the parallel fetch; then, beside the existing `push(...)` blocks:

```ts
const nowMs = Date.now();
const taskItems = taskBellItems(taskRows, me, nowMs);
push("tasks", "Tasks needing attention", taskItems.map((t) => ({
  id: t.id,
  title: t.title,
  sub: t.dueAt
    ? (isOverdue(t, nowMs) ? "Overdue" : "Due " + shortDate(t.dueAt))
    : (t.assigneeName || "Unassigned"),
  href: t.projectId ? `/projects/${t.projectId}` : "/field-work",
  letter: "T",
  color: "#b45309",
})));
```

Match the surrounding `BellItem` construction style exactly (letter/color per the file's existing groups). No `counts` key: tasks have no nav child of their own; the bell is the surface (spec §3).

- [ ] **Step 4: Item-16 hooks**

In `src/lib/stores/projects.ts`:

(a) At the end of `createProjectFromQuote` (and, if `syncProjectsFromQuotes` also materializes project records directly, at that creation site too — the coverage key makes double-hooking harmless), after the new project `p` exists:

```ts
// Item 16 (task-first): a sold install spawns the PM kickoff follow-up.
// Unassigned until the project-roles model exists (D87: assign-by-role later).
const { createAutoTask } = await import("@/lib/stores/tasks");
await createAutoTask({
  coverageKey: `item16:sold:${p.id}`,
  title: `Sold — kickoff call for ${p.name}`,
  projectId: p.id, quoteId: p.quoteId, section: "Follow-up",
});
```

(b) In `setProjectStage`, when `stage === "complete"` (place beside the Task 3 expansion block):

```ts
// Item 16: completion spawns the salesperson's how-did-it-go follow-up.
// "Lead Sales" ≈ the originating quote's owner until roles exist (D87).
if (stage === "complete") {
  let owner = "";
  if (p.quoteId) owner = (await getQuote(p.quoteId))?.owner || "";
  await createAutoTask({
    coverageKey: `item16:completed:${id}`,
    title: `Completed — follow up with customer on ${p.name}`,
    projectId: id, quoteId: p.quoteId, section: "Follow-up",
    assigneeName: owner,
  });
}
```

(Reuse the same dynamic `import("@/lib/stores/tasks")` already added in Task 3; hoist it to one call at the top of `setProjectStage` if both blocks live there.)

- [ ] **Step 5: Verify**

Run: `npm run test:specs` — `ALL PASSED` (parity line now passes).
Run: `npx tsc --noEmit` — clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/nav-counts.ts src/lib/stores/notif-prefs.ts src/lib/stores/projects.ts scripts/test-review-and-spec.ts
git commit -m "feat: tasks bell group + item-16 sold/completed auto-tasks on the task rail (#17, item 16)"
```

---

### Task 5: Quick fix #32 (address fallback) + #28 comment cleanup

**Files:**
- Modify: `src/app/(app)/companies/lib.ts` (add `addressFromHit`)
- Modify: `src/app/(app)/companies/edit-modal.tsx:209-212` (`pickAddress` uses it)
- Modify: `src/lib/design/lineset.ts:5,51` (stale `80'×30'` comments → `50'×30'`)
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Produces: `addressFromHit(h: Pick<AddressHitVM, "street" | "title">): string` in `src/app/(app)/companies/lib.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
/* ============ #32 — venue address picker fallback ============ */
import { addressFromHit } from "@/app/(app)/companies/lib";
ok(addressFromHit({ street: "123 Main St", title: "Overture Center" }) === "123 Main St", "#32: street wins when present");
ok(addressFromHit({ street: "", title: "Overture Center" }) === "Overture Center", "#32: POI without street falls back to display title");
```

Run: `npm run test:specs` — FAIL (no export `addressFromHit`).

- [ ] **Step 2: Implement**

In `src/app/(app)/companies/lib.ts` (import `type AddressHitVM` from `./types`):

```ts
/** #32: address line for a picked search hit. POI hits can lack a house
    number AND a road (normalizeHit already falls back house→road); when
    street is empty, use the hit's display title — same fallback the office
    picker in settings-client.tsx applies (`r.street || r.title`). */
export function addressFromHit(h: Pick<AddressHitVM, "street" | "title">): string {
  return h.street || h.title;
}
```

In `src/app/(app)/companies/edit-modal.tsx`, `pickAddress` (line 209): change `address: h.street` → `address: addressFromHit(h)` (import from `./lib`).

In `src/lib/design/lineset.ts`: line 51's doc comment `/** v13 defaults: 80'×30', … */` → `50'×30'`, and note the historical source in the header (line ~5): `lineset_schedule_80x30_v13.xlsx` stays named as provenance but append `(defaults since updated to 50'×30' — #28)`. Code values are already 50/30 and test-asserted; no code change.

- [ ] **Step 3: Run tests to verify they pass**

Run: `npm run test:specs` — `ALL PASSED`.
Run: `npx tsc --noEmit` — clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/companies scripts/test-review-and-spec.ts src/lib/design/lineset.ts
git commit -m "fix: venue address picker falls back to display title for street-less POI hits (#32); #28 stale comments"
```

---

### Task 6: Full verification + live drive

**Files:** none new — fixes only if checks fail.

- [ ] **Step 1: Static gates**

Run: `npx tsc --noEmit` → clean. `npm run lint` → clean. `npm run test:specs` → `ALL PASSED`.

- [ ] **Step 2: Production build** (make sure no dev server is running first — D106)

Run: `npm run build`
Expected: green, including the new `drizzle/0009_*` migration path and no PGlite-in-client-bundle errors (the type-only import rule).

- [ ] **Step 3: Drive it in the app** (dev server)

- Projects → open a project that had embedded tasks → tasks appear (migrated), card lets you add a task with assignee + due date, cycle status through all four states.
- Set a task's due date to yesterday → bell shows "Tasks needing attention" with the Overdue sub-line; Account → notification prefs shows the new "Tasks assigned to you or overdue" toggle, and turning it off hides the group.
- Field Work (narrow viewport) → task list renders from the store, toggle + add still work.
- Mark a project stage `complete` → the item-16 follow-up task appears, assigned to the originating quote's owner; re-entering the stage does not duplicate it.
- Companies → edit a venue location → address search for a named POI (e.g. a venue name) → picking a hit without a house number fills the title, not an empty field.
- Stop the dev server when done.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A && git commit -m "fix: post-verification fixes for tasks table wave (#17)"
```

---

## Self-Review (done at authoring time)

- **Spec coverage (§3 Tasks + riders):** real table ✓ (Task 1); template + manual with coverage-key de-dup ✓ (Tasks 1, 3 — content is Jeff's homework, expansion ships as safe no-op); full shape (user-id assignee denormalized, due date, 4-state, notes) ✓ (Task 1); bell overdue + assigned-to-me ✓ (Task 4); item 16 on the task rail ✓ (Task 4); `ProjectTask[]` migration ✓ (Task 2); Field Work moves over ✓ (Task 2); two dead actions rewritten ✓ (Task 3); #32 ✓, #28 ✓ (Task 5).
- **Deliberately out of scope:** an office-wide "all my tasks" screen (PUNCHLIST wish) — the bell + project card cover #17's asks; a standalone screen can ride plan 05's nav work if Jeff wants it. Quote-attached tasks get parent pointers now but no quote UI yet (nothing in §3 asks for one).
- **Type consistency:** `TaskRecord`/`TaskStatus`/`STATUSES`/`taskFromLegacy`/`expandTemplate`/`taskBellItems`/`createAutoTask` names match across Tasks 1–5; `people: {id,name}[]` consistent between data.ts and TasksCard.
- **Placeholder scan:** none — every step carries code or an exact command. Two intentionally-empty data structures (`TASK_TEMPLATE` stages) are decisions, not placeholders: content is named homework.
