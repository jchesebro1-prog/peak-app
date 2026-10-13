/** #334 Assist — the one "may this user run Assist on this thread" read, shared by the Inbox actions and the estimate draft. */
import { get as getThread, visibleTo, type CommThread } from "@/lib/stores/comms";

/** A live (not in Deleted) email thread in the user's own mailbox, else null. */
export async function loadThreadFor(threadId: string, meName: string): Promise<CommThread | null> {
  const t = await getThread(String(threadId || ""));
  if (!t || t.deleted || !visibleTo(t, meName) || t.channel !== "email") return null;
  return t;
}
