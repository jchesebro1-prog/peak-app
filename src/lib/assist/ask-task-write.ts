/**
 * Ask AI — the write half of every task card (spec 2026-10-13 §4
 * "Confirming"). No existing action takes the card's own link set (company /
 * venue / lead / email thread / quote / project), so the card's links are
 * written exactly as the card shows them — each re-checked first. It follows
 * the Inbox task dialog's rules (#215): title ≤ 200, notes ≤ 4,000, a
 * date-input due date ("" = none — `createTask` then applies the #327 +7
 * default to an assigned task), an active assignee ("" = me), and a task
 * linked to an email thread is filed under the "Email" section like the
 * Inbox's. Every link is re-checked with the read tools' own rule
 * (`resolveAskRef`; a thread must be the user's own via `loadThreadFor`); a
 * venue must belong to the linked company; a link that no longer resolves is
 * dropped, never written blind. Kept out of the "use server" file so the
 * harness can drive the real write.
 */
import { createTask, type TaskRecord } from "@/lib/stores/tasks";
import { activeUsers } from "@/lib/users";
import { dueAtFromDateInput, THREAD_TASK_NOTES_MAX, THREAD_TASK_TITLE_MAX } from "@/lib/inbox-task";
import { REF_ID_MAX, type RefKind } from "./features/ask-refs";
import { TASK_LINK_KINDS, type AskTaskLinks } from "./features/ask-cards";
import { resolveAskRef, type AskUser } from "./ask-tools-server";
import { getSite } from "@/lib/identity/sites";

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
  // A venue rides only with its own company (the Inbox's rule: the thread's venue must be its company's).
  if (input.siteId && input.customerId) {
    const site = await getSite(input.siteId);
    if (!site || site.companyId !== input.customerId) delete input.siteId;
  }
  // The Inbox files an email task under "Email" (buildThreadTaskInput).
  if (input.threadId) input.section = "Email";
  return { ok: true, task: await createTask(input, me) };
}
