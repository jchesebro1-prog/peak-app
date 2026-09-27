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
