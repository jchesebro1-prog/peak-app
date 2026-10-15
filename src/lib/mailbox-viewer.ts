/**
 * #349 — the server side of mailbox identity: build the `MailboxViewer` every
 * thread-ownership check takes (src/lib/stores/comms-visibility.ts). The
 * viewer's id is the identity; `nameUnique` (no OTHER user — any status,
 * archived and removed included — holds the same name, trimmed and
 * case-insensitive) is the only case a legacy name-stamped thread or
 * assignment can still be theirs. Reads the users table fresh every call (a
 * few dozen rows), so a rename or a new teammate takes effect on the next
 * request.
 *
 * Jeff 2026-10-15 #26 — the viewer also carries the threads an owner shared
 * with them through a live task (`taskThreadIds`, from the server-written
 * `threadShare` stamp — #351 review): ONE SQL read of the tasks collection
 * per viewer build (`taskShareCond`), so every canSeeThread /
 * canSeeThreadCond after it is a set lookup — never a task read per thread.
 * A failed read is no task shares (fail closed).
 */
import { listDocsWhere } from "@/db/doc-store";
import { activeUsers, allUsers } from "@/lib/users";
import { taskShareCond, taskSharesThread, viewerFrom, type MailboxViewer, type RosterEntry } from "@/lib/stores/comms-visibility";

/** The most task-linked threads one viewer carries (newest-id order is not
 *  promised; a person with more open email tasks than this is not real). */
export const TASK_SHARE_CAP = 2000;

/** Jeff 2026-10-15 #26 — the threads owners shared with `v` through live
 *  tasks (the stamp, re-checked in JS by `taskSharesThread`). */
export async function taskThreadIdsFor(v: MailboxViewer): Promise<Set<string>> {
  const out = new Set<string>();
  if (!v?.id) return out;
  try {
    const rows = await listDocsWhere<{ id: string; assigneeUserId?: string | null; threadShare?: { threadId?: unknown; to?: unknown } | null }>("tasks", taskShareCond(v), { limit: TASK_SHARE_CAP });
    for (const r of rows) {
      const tid = taskSharesThread(r, v);
      if (tid) out.add(tid);
    }
  } catch (e) {
    console.error("[mailbox-viewer] task share read failed", e);
  }
  return out;
}

/** Every user (any status) as id + name — the roster name uniqueness is
 *  judged against (an archived namesake still makes a name ambiguous). */
export async function mailboxRoster(): Promise<RosterEntry[]> {
  return (await allUsers()).map((u) => ({ id: u.id, name: u.name }));
}

/** The viewer for a signed-in (or roster) user. A missing user (or a blank
 *  id) is a viewer who owns nothing. */
export async function mailboxViewer(u: { id: string; name: string } | null | undefined): Promise<MailboxViewer> {
  if (!u?.id) return { id: "", name: "", nameUnique: false };
  const v = viewerFrom(u, await mailboxRoster());
  return { ...v, taskThreadIds: await taskThreadIdsFor(v) };
}

/** The one ACTIVE teammate whose name is `name` (trimmed, case-insensitive)
 *  as an assignee / owner { id, name }, else null (blank, unknown, or held by
 *  two active people — never a guess). Pickers send names; this turns the
 *  pick into an identity. */
export async function actorByName(name: string | null | undefined): Promise<{ id: string; name: string } | null> {
  const f = (name || "").trim().toLowerCase();
  if (!f) return null;
  const hits = (await activeUsers()).filter((u) => u.name.trim().toLowerCase() === f);
  return hits.length === 1 ? { id: hits[0].id, name: hits[0].name } : null;
}
