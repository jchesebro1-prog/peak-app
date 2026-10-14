/**
 * #340 — the one owner check every Inbox write runs before it touches a
 * thread. Seeing a thread (comms-visibility canSeeThread: own, assigned or
 * linked) never grants a write: a reply sends from the mailbox owner's Gmail,
 * and read state, status, flags, filing and links are theirs. The owner may
 * still manage their own thread in Deleted (restore, mark read), so this is
 * `visibleTo` — the mailbox — not `isOwnThread`, which also rules out Deleted.
 * Anything else answers exactly like a missing thread.
 */
import { get as getThread, visibleTo, type CommThread } from "@/lib/stores/comms";

/** The thread when it sits in `me`'s own mailbox (Deleted included), else null. */
export async function ownThread(id: unknown, me: string): Promise<CommThread | null> {
  const tid = typeof id === "string" ? id.trim() : "";
  if (!tid || tid.length > 200 || !me) return null;
  const t = await getThread(tid);
  return t && visibleTo(t, me) ? t : null;
}

/** The ids (deduped, in order) whose threads sit in `me`'s own mailbox. */
export async function ownThreadIds(ids: unknown, me: string): Promise<string[]> {
  const list = Array.isArray(ids) ? [...new Set(ids.filter((s): s is string => typeof s === "string" && !!s))] : [];
  const out: string[] = [];
  for (const id of list.slice(0, 1000)) if (await ownThread(id, me)) out.push(id);
  return out;
}
