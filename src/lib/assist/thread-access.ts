/** #334 Assist — the one "may this user run Assist on this thread" read, shared by the Inbox actions and the estimate draft. */
import { canSeeThread, get as getThread, visibleTo, type CommThread } from "@/lib/stores/comms";

/** A live (not in Deleted) email thread in the user's own mailbox, else null.
 *  Every ACTION keeps this rule — drafting a reply (it sends from this
 *  mailbox), suggesting tasks, suggesting an estimate, the brief's drafts. */
export async function loadThreadFor(threadId: string, meName: string): Promise<CommThread | null> {
  const t = await getThread(String(threadId || ""));
  if (!t || t.deleted || !visibleTo(t, meName) || t.channel !== "email") return null;
  return t;
}

/** #341 — Ask AI's READ rule: a live email thread the user may see (their
 *  own, assigned to them, or linked to an entity — canSeeThread), else null.
 *  Reading only; nothing that writes or drafts takes a thread through here. */
export async function loadThreadReadable(threadId: string, meName: string): Promise<CommThread | null> {
  const t = await getThread(String(threadId || ""));
  if (!t || t.channel !== "email" || !canSeeThread(t, meName)) return null;
  return t;
}
