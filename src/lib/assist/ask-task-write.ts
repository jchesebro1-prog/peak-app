/**
 * Ask AI — the write half of a task card with no email thread (spec
 * 2026-10-13 §4 "Confirming"). A card that names a thread goes through the
 * Inbox's own `createTaskFromThreadAction` (#215); every other card comes
 * here, because no existing action takes a company / venue / lead / quote /
 * project link set without a thread. It follows the same rules: title ≤ 200,
 * notes ≤ 4,000, a date-input due date ("" = none — `createTask` then applies
 * the #327 +7 default to an assigned task), an active assignee ("" = me).
 * Every link is re-checked with the read tools' own rule (`resolveAskRef`);
 * a link that no longer resolves is dropped, never written blind. Kept out of
 * the "use server" file so the harness can drive the real write.
 */
import { createTask, type TaskRecord } from "@/lib/stores/tasks";
import { activeUsers } from "@/lib/users";
import { dueAtFromDateInput, THREAD_TASK_NOTES_MAX, THREAD_TASK_TITLE_MAX } from "@/lib/inbox-task";
import { REF_ID_MAX, type RefKind } from "./features/ask-refs";
import { TASK_LINK_KINDS, type AskTaskLinks } from "./features/ask-cards";
import { resolveAskRef, type AskUser } from "./ask-tools-server";

export type AskTaskRequest = {
  title: string;
  notes: string;
  /** users.id; "" = me */
  assigneeUserId: string;
  /** an <input type="date"> value; "" = no due date */
  dueDate: string;
  links: AskTaskLinks;
};

export async function createAskTask(
  req: AskTaskRequest,
  me: AskUser
): Promise<{ ok: true; task: TaskRecord } | { ok: false; error: string }> {
  const title = String(req?.title ?? "").replace(/\s+/g, " ").trim();
  if (!title) return { ok: false, error: "The task needs a title." };
  if (title.length > THREAD_TASK_TITLE_MAX) return { ok: false, error: `Keep the title under ${THREAD_TASK_TITLE_MAX} characters.` };
  const notes = String(req?.notes ?? "").trim();
  if (notes.length > THREAD_TASK_NOTES_MAX) return { ok: false, error: `Keep the notes under ${THREAD_TASK_NOTES_MAX} characters.` };
  const dueAt = dueAtFromDateInput(String(req?.dueDate ?? ""));
  if (dueAt === "invalid") return { ok: false, error: "Pick a valid due date." };
  const assigneeId = String(req?.assigneeUserId ?? "").trim() || me.id;
  const assignee = (await activeUsers()).find((u) => u.id === assigneeId);
  if (!assignee) return { ok: false, error: "Pick someone on the team." };

  const input: Partial<TaskRecord> & { title: string } = {
    title,
    section: "",
    notes,
    assigneeUserId: assignee.id,
    assigneeName: assignee.name,
    dueAt,
  };
  const links = (req?.links && typeof req.links === "object" ? req.links : {}) as Record<string, unknown>;
  for (const [field, kind] of Object.entries(TASK_LINK_KINDS) as [keyof AskTaskLinks, RefKind][]) {
    const raw = links[field];
    const id = typeof raw === "string" ? raw.trim() : "";
    if (!id || id.length > REF_ID_MAX) continue;
    if (await resolveAskRef(kind, id, me)) (input as Record<string, unknown>)[field] = id;
  }
  return { ok: true, task: await createTask(input, me) };
}
