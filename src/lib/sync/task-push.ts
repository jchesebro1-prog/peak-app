/**
 * #356 review (Important 3) — which `tasks` documents an offline push may
 * write. `/api/sync/push` takes whole documents by id, so without a rule any
 * field user could replace any task (office tasks run T-6000 upward). Pure.
 *
 *  - insert (no stored row): only a new Field Work id (`tk-…`) on a project
 *    that exists — what Field Work's add-task captures offline;
 *  - update: a `tk-` field task on an existing project, kept on that project;
 *    or a task the caller is the assignee or creator of.
 * Everything else is refused (status "error" — parked in the outbox, never
 * retried). The #351 server-owned fields are stripped separately
 * (server-owned.ts), whatever this says.
 */
import { FIELD_TASK_ID_RE } from "@/lib/task-ids";

export type TaskPushDoc = { projectId?: unknown; assigneeUserId?: unknown; createdBy?: unknown };
export const TASK_PUSH_REFUSED = "That task can’t be changed from this device — ask the office.";

export function taskPushAllowed(
  id: string,
  stored: TaskPushDoc | null,
  incoming: TaskPushDoc,
  user: { id: string; name: string },
  projectExists: (projectId: string) => boolean,
): boolean {
  const pid = (v: unknown) => (typeof v === "string" ? v : "");
  if (!stored) return FIELD_TASK_ID_RE.test(id) && !!pid(incoming.projectId) && projectExists(pid(incoming.projectId));
  if (FIELD_TASK_ID_RE.test(id) && pid(stored.projectId) && projectExists(pid(stored.projectId)) && pid(incoming.projectId) === pid(stored.projectId)) return true;
  if (user.id && stored.assigneeUserId === user.id) return true;
  return !!user.name && typeof stored.createdBy === "string" && stored.createdBy.trim().toLowerCase() === user.name.trim().toLowerCase();
}
