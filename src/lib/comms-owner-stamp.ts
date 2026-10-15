/**
 * #349 — the one-time `mailboxOwnerId` backfill (`npm run comms:stamp-owners`,
 * scripts/comms-stamp-owners.ts). Every personal-mailbox thread written since
 * #349 carries its owner's users.id; older ones resolve lazily (by their Gmail
 * key, else a legacy name only one user holds — comms-visibility.ts
 * ownsMailbox) and are stamped on the owner's next write. This stamps the rest
 * in one pass so ownership never depends on a display name again.
 *
 * The plan is pure (`planOwnerStamps`): the same rule `ownsMailbox` uses
 * (`resolveMailboxOwnerId` over EVERY user, archived included), so a thread is
 * stamped exactly when one user already owns it — never by a guess. A name two
 * users share, or one no user holds, is listed as unresolved. With --apply a
 * shared name is tombstoned (MAILBOX_OWNER_NOBODY — owned by nobody for good,
 * never resolved by a later rename); an unknown or blank name is left alone
 * (a new hire's name is retired at hire time). `applyOwnerStamps`
 * writes one key-level compare-and-set per thread (lands only while the key is
 * still absent), so a re-run — or a thread stamped meanwhile — is a no-op.
 */
import { casDocKey, listDocs } from "@/db/doc-store";
import { MAILBOX_OWNER_NOBODY, resolveMailboxOwnerId, type RosterEntry } from "@/lib/stores/comms-visibility";
import type { CommThread } from "@/lib/stores/comms";

export type OwnerStamp = { id: string; ownerId: string; how: "key" | "name" };
export type OwnerUnresolved = { id: string; mailboxUser: string; reason: "no-name" | "shared-name" | "unknown-name" };
export type OwnerStampPlan = {
  /** personal-mailbox threads with no stamp yet */
  candidates: number;
  /** already tombstoned (owned by nobody for good) — left alone */
  tombstoned: number;
  stamps: OwnerStamp[];
  unresolved: OwnerUnresolved[];
};

type ThreadFields = Pick<CommThread, "id" | "mailbox" | "mailboxUser"> & Partial<Pick<CommThread, "mailboxOwnerId" | "gmailAccountKey">>;

const filled = (v: unknown): v is string => typeof v === "string" && v !== "";
const fold = (v: unknown): string => (typeof v === "string" ? v.trim().toLowerCase() : "");

/** Pure: which unstamped personal threads get which owner, and which can't be
 *  resolved (with why). `roster` is every user, any status. */
export function planOwnerStamps(threads: readonly ThreadFields[], roster: readonly RosterEntry[]): OwnerStampPlan {
  const plan: OwnerStampPlan = { candidates: 0, tombstoned: 0, stamps: [], unresolved: [] };
  for (const t of threads) {
    if (t.mailbox === "personal" && t.mailboxOwnerId === MAILBOX_OWNER_NOBODY) plan.tombstoned++;
    if (t.mailbox !== "personal" || filled(t.mailboxOwnerId)) continue;
    plan.candidates++;
    const ownerId = resolveMailboxOwnerId(t, roster);
    if (ownerId) {
      plan.stamps.push({ id: t.id, ownerId, how: filled(t.gmailAccountKey) ? "key" : "name" });
      continue;
    }
    const name = typeof t.mailboxUser === "string" ? t.mailboxUser : "";
    const holders = roster.filter((r) => fold(r.name) === fold(name)).length;
    plan.unresolved.push({ id: t.id, mailboxUser: name, reason: !name.trim() ? "no-name" : holders > 1 ? "shared-name" : "unknown-name" });
  }
  return plan;
}

/** Load every live thread and plan the stamps. */
export async function loadOwnerStampPlan(roster: readonly RosterEntry[]): Promise<OwnerStampPlan> {
  return planOwnerStamps(await listDocs<CommThread>("comms"), roster);
}

/** The shared-name rows `--apply` tombstones (#349 review): owned by nobody
 *  for good, so a later rename or a new hire with that name never inherits
 *  them. Unknown / blank names are only listed (a new user's name is retired
 *  at hire time — mailbox-names.ts). */
export function tombstoneStamps(plan: Pick<OwnerStampPlan, "unresolved">): Array<{ id: string; ownerId: string }> {
  return plan.unresolved.filter((u) => u.reason === "shared-name").map((u) => ({ id: u.id, ownerId: MAILBOX_OWNER_NOBODY }));
}

/** Write the planned stamps (or tombstones) — one compare-and-set each (only
 *  while `mailboxOwnerId` is still absent). `stamped` landed; `raced` were
 *  stamped meanwhile (or deleted) and left alone. */
export async function applyOwnerStamps(
  stamps: ReadonlyArray<Pick<OwnerStamp, "id" | "ownerId">>,
  cas: (id: string, ownerId: string) => Promise<boolean> = (id, ownerId) => casDocKey("comms", id, "mailboxOwnerId", undefined, ownerId)
): Promise<{ stamped: number; raced: number }> {
  let stamped = 0;
  let raced = 0;
  for (const s of stamps) {
    if (await cas(s.id, s.ownerId)) stamped++;
    else raced++;
  }
  return { stamped, raced };
}
