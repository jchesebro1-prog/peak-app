/** #334 Assist — the one "may this user run Assist on this thread" read, shared by the Inbox actions and the estimate draft. */
import { canSeeThread, get as getThread, visibleTo, type CommThread, type MailboxViewer } from "@/lib/stores/comms";
import { mailboxViewer } from "@/lib/mailbox-viewer";

type Me = { id: string; name: string } | MailboxViewer;

/** #349 — the viewer (identity) for `me`, built once when not given. */
async function viewerOf(me: Me): Promise<MailboxViewer> {
  return "nameUnique" in me ? me : mailboxViewer(me);
}

/** A live (not in Deleted) email thread in the user's own mailbox, else null.
 *  Every ACTION keeps this rule — drafting a reply (it sends from this
 *  mailbox), suggesting tasks, suggesting an estimate, the brief's drafts.
 *  #349 — by identity. Read-only: it is also reached from the brief's
 *  background draft queue, so the lazy owner stamp is left to the Inbox and
 *  Organize write guards (ownThread, apply.ts myThread). */
export async function loadThreadFor(threadId: string, me: Me): Promise<CommThread | null> {
  if (!me?.id) return null;
  const viewer = await viewerOf(me);
  const t = await getThread(String(threadId || ""));
  if (!t || t.deleted || !visibleTo(t, viewer) || t.channel !== "email") return null;
  return t;
}

/** #341 — Ask AI's READ rule: a live email thread the user may see (their
 *  own, assigned to them, or linked to an entity — canSeeThread), else null.
 *  Reading only; nothing that writes or drafts takes a thread through here
 *  (and nothing is stamped). */
export async function loadThreadReadable(threadId: string, me: Me): Promise<CommThread | null> {
  if (!me?.id) return null;
  const viewer = await viewerOf(me);
  const t = await getThread(String(threadId || ""));
  if (!t || t.channel !== "email" || !canSeeThread(t, viewer)) return null;
  return t;
}
