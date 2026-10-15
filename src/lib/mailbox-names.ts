/**
 * #349 review — a display name changing hands never moves mail.
 *
 * Legacy threads (and assignments) that carry only an owner NAME resolve to
 * whoever holds that name alone (comms-visibility.ts). So before a name
 * changes, its name-only rows are pinned down with the same key-level
 * compare-and-set as the lazy stamp (doc-store casDocKeyWhere — written only
 * where the key is still absent, so nothing stamped is ever overwritten):
 *
 *  - `handOverNameOnly(user, roster)` — BEFORE a rename: the old name's
 *    unstamped, key-less personal threads get `mailboxOwnerId = user.id` when
 *    the old name was theirs alone, else the tombstone (MAILBOX_OWNER_NOBODY —
 *    owned by nobody for good). Legacy name-only assignments get
 *    `assignedToId` the same way.
 *  - `retireNameForNewcomer(name)` — BEFORE a name becomes held (a new user,
 *    or a rename TO it): any unstamped, key-less personal thread / name-only
 *    assignment carrying that name belongs to no current user (names are
 *    unique, D1070), so it is tombstoned — a newcomer inherits nothing.
 *
 * Server-only (doc-store). The callers are Settings → Team's add / rename and
 * the Import hub's team rows.
 */
import { casDocKeyWhere, type DocCond } from "@/db/doc-store";
import { MAILBOX_OWNER_NOBODY, viewerFrom, type RosterEntry } from "@/lib/stores/comms-visibility";

const fold = (v: string) => v.trim().toLowerCase();

/** Unstamped, key-less personal threads whose `mailboxUser` matches `name`. */
function nameOnlyThreads(nameCond: DocCond): DocCond {
  return {
    all: [
      { path: ["mailbox"], is: "personal" },
      { path: ["mailboxOwnerId"], empty: "text" },
      { path: ["gmailAccountKey"], empty: "text" },
      nameCond,
    ],
  };
}

/** Name-only assignments to `name` (folded — the isAssignedTo rule). */
function nameOnlyAssignments(folded: string): DocCond {
  return { all: [{ path: ["assignedToId"], empty: "text" }, { path: ["assignedTo"], isFolded: folded }] };
}

export type HandOver = { owner: string; threads: number; assignments: number };

/** BEFORE renaming `user` (its CURRENT name): pin the old name's name-only
 *  threads and assignments to this user when the name was theirs alone, else
 *  to nobody. `roster` is every user (any status). */
export async function handOverNameOnly(user: { id: string; name: string }, roster: readonly RosterEntry[]): Promise<HandOver> {
  const old = typeof user?.name === "string" ? user.name : "";
  if (!user?.id || !fold(old)) return { owner: MAILBOX_OWNER_NOBODY, threads: 0, assignments: 0 };
  const owner = viewerFrom(user, roster).nameUnique ? user.id : MAILBOX_OWNER_NOBODY;
  // threads resolve by the EXACT name (resolveMailboxOwnerId); assignments by the folded name (isAssignedTo)
  const threads = await casDocKeyWhere("comms", nameOnlyThreads({ path: ["mailboxUser"], is: old }), "mailboxOwnerId", owner);
  const assignments = await casDocKeyWhere("comms", nameOnlyAssignments(fold(old)), "assignedToId", owner);
  return { owner, threads: threads.length, assignments: assignments.length };
}

/** BEFORE `name` becomes held (a new user, or a rename to it): tombstone the
 *  name-only threads and assignments that already carry it (any spelling —
 *  they belong to no current user). */
export async function retireNameForNewcomer(name: string): Promise<{ threads: number; assignments: number }> {
  const f = fold(typeof name === "string" ? name : "");
  if (!f) return { threads: 0, assignments: 0 };
  const threads = await casDocKeyWhere("comms", nameOnlyThreads({ path: ["mailboxUser"], isFolded: f }), "mailboxOwnerId", MAILBOX_OWNER_NOBODY);
  const assignments = await casDocKeyWhere("comms", nameOnlyAssignments(f), "assignedToId", MAILBOX_OWNER_NOBODY);
  return { threads: threads.length, assignments: assignments.length };
}
