/**
 * Jeff 2026-10-15 #26 (#351 review) — sharing an email through a task is the
 * thread OWNER's act. Server-only.
 *
 * `ownerShareFor` builds the stamp an owner-driven create writes (after the
 * caller's own-thread check): only for a task assigned to someone other than
 * the owner. `reshareTaskThread` runs after an assignee change (calendar
 * hand-off, the project task editor): the store has already dropped the old
 * stamp (`updateTask`); if the caller owns the task's thread and handed it to
 * someone else, the stamp is re-written for the new assignee; otherwise the
 * task shares nothing. A stamp that is still valid (`to` = the assignee) is
 * left alone, so calling it twice is harmless.
 */
import { get as getThread, visibleTo } from "@/lib/stores/comms";
import { getTask, setTaskThreadShare, type TaskThreadShare } from "@/lib/stores/tasks";
import { mailboxViewer } from "@/lib/mailbox-viewer";

/** The stamp for a task `owner` creates on their own thread, assigned to `assigneeUserId`; null when it is their own task. Pure. */
export function ownerShareFor(threadId: string | null | undefined, owner: { id: string }, assigneeUserId: string | null | undefined, at: number): TaskThreadShare | null {
  if (!threadId || !owner?.id || !assigneeUserId || assigneeUserId === owner.id) return null;
  return { threadId, by: owner.id, to: assigneeUserId, at };
}

export async function reshareTaskThread(taskId: string, actor: { id: string; name: string }): Promise<void> {
  try {
    const t = await getTask(taskId);
    if (!t?.threadId) return;
    if (t.threadShare && t.threadShare.to === t.assigneeUserId) return; // still valid
    const thread = await getThread(t.threadId);
    const owns = !!thread && !thread.deleted && visibleTo(thread, await mailboxViewer(actor));
    const share = owns ? ownerShareFor(thread!.id, actor, t.assigneeUserId, Date.now()) : null;
    if (share || t.threadShare) await setTaskThreadShare(taskId, share);
  } catch (e) {
    console.error("[task-thread-share] re-share failed", taskId, e instanceof Error ? e.message : e);
  }
}
