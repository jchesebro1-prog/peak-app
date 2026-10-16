/**
 * #356 review (Important 3) — which `tasks` documents an offline push may
 * write. `/api/sync/push` takes whole documents by id, so without a rule any
 * field user could replace any task (office tasks run T-6000 upward). Pure.
 *
 *  - insert (no stored row): only a new Field Work id (`tk-…`) on a project
 *    that exists — what Field Work's add-task captures offline;
 *  - update: a `tk-` field task on an existing project, kept on that project;
 *    or a task the caller is the assignee or creator of;
 *  - re-review: a TICK — any live (not deleted) task on a live project whose
 *    push changes nothing but `status` / `doneAt` / `updatedAt` (the same
 *    change `toggleFieldTask` makes online). Only those three fields are taken
 *    from the push; everything else is written from the stored copy.
 * Everything else is refused (status "error" — parked in the outbox, never
 * retried). The #351 server-owned fields are stripped separately
 * (server-owned.ts), whatever this says.
 */
import { FIELD_TASK_ID_RE } from "@/lib/task-ids";

export type TaskPushDoc = { projectId?: unknown; assigneeUserId?: unknown; createdBy?: unknown } & Record<string, unknown>;
export const TASK_PUSH_REFUSED = "That task can’t be changed from this device — ask the office.";

/** The fields a tick may change. */
export const TICK_FIELDS: ReadonlySet<string> = new Set(["status", "doneAt", "updatedAt"]);
/** Device bookkeeping a push carries that never counts as a change (and the #351 server-owned fields, stripped anyway). */
const IGNORED: ReadonlySet<string> = new Set(["id", "rev", "syncState", "syncedAt", "threadShare", "threadId"]);
const TASK_STATUSES: ReadonlySet<string> = new Set(["open", "in_progress", "done", "blocked"]);

const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null) || JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** True when `incoming` differs from `stored` only in status / doneAt / updatedAt (with a known status). Pure. */
export function isTickOnly(stored: Record<string, unknown>, incoming: Record<string, unknown>): boolean {
  if (!TASK_STATUSES.has(String(incoming.status ?? ""))) return false;
  for (const k of Object.keys(incoming)) {
    if (IGNORED.has(k) || TICK_FIELDS.has(k)) continue;
    if (!same(incoming[k], stored[k])) return false;
  }
  return true;
}

export type TaskPushDecision = { ok: false } | { ok: true; doc: Record<string, unknown> | null };

/** `doc` null = write the push as sent; a doc = write that instead (a tick: the stored copy + the tick fields). */
export function taskPushDecision(
  id: string,
  stored: TaskPushDoc | null,
  incoming: TaskPushDoc,
  user: { id: string; name: string },
  projectExists: (projectId: string) => boolean,
  opts: { storedDeleted?: boolean } = {},
): TaskPushDecision {
  const pid = (v: unknown) => (typeof v === "string" ? v : "");
  if (!stored) return { ok: FIELD_TASK_ID_RE.test(id) && !!pid(incoming.projectId) && projectExists(pid(incoming.projectId)), doc: null } as TaskPushDecision;
  if (FIELD_TASK_ID_RE.test(id) && pid(stored.projectId) && projectExists(pid(stored.projectId)) && pid(incoming.projectId) === pid(stored.projectId)) return { ok: true, doc: null };
  if (user.id && stored.assigneeUserId === user.id) return { ok: true, doc: null };
  if (!!user.name && typeof stored.createdBy === "string" && stored.createdBy.trim().toLowerCase() === user.name.trim().toLowerCase()) return { ok: true, doc: null };
  if (!opts.storedDeleted && pid(stored.projectId) && projectExists(pid(stored.projectId)) && pid(incoming.projectId) === pid(stored.projectId) && isTickOnly(stored, incoming)) {
    const doc: Record<string, unknown> = { ...stored };
    for (const k of TICK_FIELDS) if (k in incoming) doc[k] = incoming[k];
    return { ok: true, doc };
  }
  return { ok: false };
}

export function taskPushAllowed(
  id: string,
  stored: TaskPushDoc | null,
  incoming: TaskPushDoc,
  user: { id: string; name: string },
  projectExists: (projectId: string) => boolean,
): boolean {
  return taskPushDecision(id, stored, incoming, user, projectExists).ok;
}
