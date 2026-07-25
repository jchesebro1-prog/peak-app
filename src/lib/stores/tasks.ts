import {
  listDocs, getDoc, upsertDoc, patchDoc, softDeleteDoc, nextPrefixedId, insertDocIfAbsent,
} from "@/db/doc-store";
import type { ProjectTask, ProjectStage, ProjectRecord } from "@/lib/stores/projects";

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
  id: string;                    // "T-####" (office-created), "tk-…" (field-created / migrated), or "T-auto-<slug>" (system-created via autoTaskId)
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
    emit only template items whose key is not already present. `stage` must be
    record-scoped (e.g. "<projectId>:<stage>", not just "<stage>") — createAutoTask's
    dedup and autoTaskId are collection-global, so an unscoped stage string means
    only the first record to ever enter that stage gets the checklist; every
    later record silently gets none. */
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

/** Deterministic id for a system-created task: same coverageKey → same id,
    so concurrent auto-creation collapses onto one atomic insert. */
export function autoTaskId(coverageKey: string): string {
  return "T-auto-" + coverageKey.toLowerCase().replace(/[^a-z0-9]+/g, "-");
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
  await upsertDoc<TaskRecord>("tasks", t);
  return t;
}

/** Idempotent system-created task (templates, item 16): coverageKey is the
    dedup guard — both trigger paths are re-runnable by design (PUNCHLIST §16).
    The id is deterministic (autoTaskId), so concurrent callers for the same
    coverageKey race on the same row and insertDocIfAbsent lets exactly one
    win — the allTasks() scan below is only a cheap fast-path skip, not the
    correctness guard (coverageKey lives in jsonb, so no DB constraint can
    enforce it directly). */
export async function createAutoTask(
  input: Partial<TaskRecord> & { title: string; coverageKey: string },
): Promise<TaskRecord | null> {
  const existing = (await allTasks()).find((t) => t.coverageKey === input.coverageKey);
  if (existing) return null;
  const at = now();
  const id = autoTaskId(input.coverageKey);
  const t = normalizeTask({ ...input, id, createdBy: input.createdBy || "System", createdAt: at, updatedAt: at });
  const inserted = await insertDocIfAbsent<TaskRecord>("tasks", t);
  return inserted ? t : null;
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
      if (!hit) await upsertDoc("tasks", taskFromLegacy(p.id, pt, now()));
    }
    await patchDoc<ProjectRecord>("projects", p.id, (doc) => {
      doc.tasks = [];
      doc.updatedAt = now();
      return doc;
    });
  }
}
