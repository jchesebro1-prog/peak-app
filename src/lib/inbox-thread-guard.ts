/**
 * #341 — the one owner check every Inbox write runs before it touches a
 * thread. Seeing a thread (comms-visibility canSeeThread: own, assigned or
 * linked) never grants a write: a reply sends from the mailbox owner's Gmail,
 * and read state, status, flags, filing and links are theirs. The owner may
 * still manage their own thread in Deleted (restore, mark read), so this is
 * `visibleTo` — the mailbox — not `isOwnThread`, which also rules out Deleted.
 * Anything else answers exactly like a missing thread.
 *
 * #349 — by identity: `me` is the signed-in user ({ id, name }); the viewer
 * (id + whether the name is unique) is built here. A thread owned through its
 * Gmail key or a unique legacy name is stamped with `mailboxOwnerId` on the
 * way through (stampMailboxOwner — a key-level compare-and-set), so these
 * write paths are the lazy backfill.
 */
import { get as getThread, stampMailboxOwner, visibleTo, type CommThread, type MailboxViewer } from "@/lib/stores/comms";
import { mailboxViewer } from "@/lib/mailbox-viewer";

type Me = { id: string; name: string } | MailboxViewer;

async function viewerOf(me: Me): Promise<MailboxViewer> {
  return "nameUnique" in me ? me : mailboxViewer(me);
}

async function ownWith(id: unknown, viewer: MailboxViewer): Promise<CommThread | null> {
  const tid = typeof id === "string" ? id.trim() : "";
  if (!tid || tid.length > 200 || !viewer.id) return null;
  const t = await getThread(tid);
  if (!t || !visibleTo(t, viewer)) return null;
  await stampMailboxOwner(t, viewer);
  return t;
}

/** The thread when it sits in `me`'s own mailbox (Deleted included), else null. */
export async function ownThread(id: unknown, me: Me): Promise<CommThread | null> {
  if (!me?.id) return null;
  return ownWith(id, await viewerOf(me));
}

/** The ids (deduped, in order) whose threads sit in `me`'s own mailbox. */
export async function ownThreadIds(ids: unknown, me: Me): Promise<string[]> {
  const list = Array.isArray(ids) ? [...new Set(ids.filter((s): s is string => typeof s === "string" && !!s))] : [];
  if (!me?.id || !list.length) return [];
  const viewer = await viewerOf(me);
  const out: string[] = [];
  for (const id of list.slice(0, 1000)) if (await ownWith(id, viewer)) out.push(id);
  return out;
}
