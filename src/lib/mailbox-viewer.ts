/**
 * #349 — the server side of mailbox identity: build the `MailboxViewer` every
 * thread-ownership check takes (src/lib/stores/comms-visibility.ts). The
 * viewer's id is the identity; `nameUnique` (no OTHER user — any status,
 * archived and removed included — holds the same name, trimmed and
 * case-insensitive) is the only case a legacy name-stamped thread or
 * assignment can still be theirs. Reads the users table fresh every call (a
 * few dozen rows), so a rename or a new teammate takes effect on the next
 * request.
 */
import { activeUsers, allUsers } from "@/lib/users";
import { viewerFrom, type MailboxViewer, type RosterEntry } from "@/lib/stores/comms-visibility";

/** Every user (any status) as id + name — the roster name uniqueness is
 *  judged against (an archived namesake still makes a name ambiguous). */
export async function mailboxRoster(): Promise<RosterEntry[]> {
  return (await allUsers()).map((u) => ({ id: u.id, name: u.name }));
}

/** The viewer for a signed-in (or roster) user. A missing user (or a blank
 *  id) is a viewer who owns nothing. */
export async function mailboxViewer(u: { id: string; name: string } | null | undefined): Promise<MailboxViewer> {
  if (!u?.id) return { id: "", name: "", nameUnique: false };
  return viewerFrom(u, await mailboxRoster());
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
