/**
 * #341 — who may see an email thread. Jeff, 2026-10-14: "you can only see
 * information that was either linked to entities or your own information."
 *
 * #349 — "ultimately that should all be linked to the email address so you
 * can't view a different mailbox that isn't tied to your email" (Jeff,
 * 2026-10-14). Mailbox ownership follows the signed-in user's IDENTITY (the
 * users.id, 1:1 with their unique email), never their display name — names
 * can repeat. `me` is a `MailboxViewer` ({ id, name, nameUnique }), built on
 * the server by `mailboxViewer()` (src/lib/mailbox-viewer.ts) or, from an
 * already-loaded roster, by `viewerFrom()`. A thread is in my mailbox
 * (`ownsMailbox`) when:
 *   - its `mailboxOwnerId` (stamped by every writer since #349) is my id, or
 *   - unstamped, its `gmailAccountKey` (the Gmail bridge's stamp) is my
 *     personal key (`personal:<my id>`), or
 *   - unstamped and key-less (a legacy local-only thread: an in-app draft, a
 *     logged call), its `mailboxUser` name is mine AND no other active user
 *     holds that name (`nameUnique`). A shared name owns nothing — fail
 *     closed. Such threads are stamped lazily on the owner's next write
 *     (`stampMailboxOwner` in comms.ts) and by `npm run comms:stamp-owners`.
 * "Assigned to me" is the same shape: `assignedToId` when stamped, else the
 * `assignedTo` name only while it is unique.
 *
 * A thread is visible to `me` when it is not in Deleted and:
 *   - it is in my own mailbox (`ownsMailbox`, alias `visibleTo`), or
 *   - it is assigned to me (`isAssignedTo` — the bell's and Morning triage's
 *     explicit hand-off), or
 *   - it is LINKED to an entity DELIBERATELY (Jeff's ruling, 2026-10-14):
 *     its owner, or Inbox organization acting for them, filed or linked it to
 *     a company, quote, lead, project or venue (`hasDeliberateLink`). The
 *     link fields are a customerId, a siteId, a work link (`link` with a type
 *     and an id) or chosen people (`linkedContactIds`, the reader sidebar's
 *     link panel).
 * The AUTOMATIC sender match never shares: the import / a resweep stamps
 * `customerId` (and `resolvedContactId`) when the sender is a known contact,
 * and that stays private — adding a contact must never expose anyone's mail.
 * A deliberate link is `linkedBy` ("user" | "filing"), a filed #335 filing,
 * or, for threads written before `linkedBy` existed, a field only a person or
 * filing ever writes: a work `link`, a `siteId`, `linkedContactIds`, or a
 * logged call / meeting (channel other than email) with a customer.
 * Another person's DRAFT is never visible — unsent mail is not yet a record.
 *
 * Writes and actions stay with the owner (`isOwnThread`): a reply sends from
 * the owner's Gmail account, and filing / status / read state are theirs.
 * `canOpenThread` is the Inbox reader's rule — the owner also opens their own
 * thread from Deleted; everyone else reads a non-own thread read-only.
 *
 * `canSeeThreadCond` / `ownMailboxCond` / `assignedToCond` are the same
 * rules as doc-store `DocCond`s, for SQL candidate reads (⌘K, Inbox search,
 * Organize) — keep them in step.
 *
 * Pure, client-safe: type imports plus the env-free key helpers.
 */
import type { DocCond } from "@/db/doc-store";
import { personalKey, userIdOfKey } from "@/lib/gmail/config";
import type { CommThread } from "./comms";

type MailboxFields = Pick<CommThread, "mailbox" | "mailboxUser"> & Partial<Pick<CommThread, "mailboxOwnerId" | "gmailAccountKey">>;
type LinkFields = Partial<Pick<CommThread, "customerId" | "siteId" | "link" | "linkedContactIds" | "linkedBy" | "filing" | "channel">>;
type AssignFields = Partial<Pick<CommThread, "assignedTo" | "assignedToId">>;
type VisibilityFields = MailboxFields & LinkFields & AssignFields & Partial<Pick<CommThread, "deleted" | "status">>;

/** #349 — who is looking: the signed-in user's id (the identity every
 *  ownership check keys on), their display name, and whether that name is
 *  held by them alone among active users (the only case a legacy
 *  name-stamped thread or assignment can be theirs). */
export type MailboxViewer = { id: string; name: string; nameUnique: boolean };

/** A roster entry for `viewerFrom` / `resolveMailboxOwnerId` — the ACTIVE users. */
export type RosterEntry = { id: string; name: string };

const filled = (v: unknown): v is string => typeof v === "string" && v !== "";
const fold = (v: unknown): string => (typeof v === "string" ? v.trim().toLowerCase() : "");

/** The viewer for `u`, given the ACTIVE roster: `nameUnique` when no OTHER
 *  active user's name folds (trimmed, case-insensitive) to `u`'s. */
export function viewerFrom(u: { id: string; name: string }, roster: readonly RosterEntry[]): MailboxViewer {
  const id = typeof u?.id === "string" ? u.id : "";
  const name = typeof u?.name === "string" ? u.name : "";
  const f = fold(name);
  return { id, name, nameUnique: !!id && f !== "" && !roster.some((r) => r.id !== id && fold(r.name) === f) };
}

/** #349 — the users.id that owns a personal-mailbox thread, from an
 *  already-loaded ACTIVE roster: the stamp, else the Gmail account key, else
 *  the legacy name when exactly one active user holds it (exact spelling).
 *  null = a shared-box thread or nobody (an ambiguous or unknown name). The
 *  same answer `ownsMailbox` gives each roster member. */
export function resolveMailboxOwnerId(t: MailboxFields, roster: readonly RosterEntry[]): string | null {
  if (t.mailbox !== "personal") return null;
  if (filled(t.mailboxOwnerId)) return t.mailboxOwnerId;
  if (filled(t.gmailAccountKey)) return userIdOfKey(t.gmailAccountKey);
  if (!filled(t.mailboxUser)) return null;
  const f = fold(t.mailboxUser);
  const holders = roster.filter((r) => fold(r.name) === f);
  return holders.length === 1 && holders[0].name === t.mailboxUser ? holders[0].id : null;
}

/** How `ownsMailbox` decided: by the stamp, the Gmail key, or the legacy
 *  unique name (null = not mine). The lazy stamp writes only for the last two. */
export function mailboxOwnership(t: MailboxFields, me: MailboxViewer): "stamp" | "key" | "name" | null {
  if (!me || !filled(me.id) || t.mailbox !== "personal") return null;
  if (filled(t.mailboxOwnerId)) return t.mailboxOwnerId === me.id ? "stamp" : null;
  if (filled(t.gmailAccountKey)) return t.gmailAccountKey === personalKey(me.id) ? "key" : null;
  return me.nameUnique && filled(me.name) && t.mailboxUser === me.name ? "name" : null;
}

/** In `me`'s own personal mailbox (any folder) — by identity (#349). Legacy
 *  shared-box threads are nobody's own. */
export function ownsMailbox(t: MailboxFields, me: MailboxViewer): boolean {
  return mailboxOwnership(t, me) !== null;
}

/** #341's name for the mailbox check — now `ownsMailbox` (identity, #349). */
export const visibleTo = ownsMailbox;

const hasWorkLink = (t: LinkFields): boolean => !!t.link && filled(t.link.type) && filled(t.link.id);
const hasPeople = (t: LinkFields): boolean => Array.isArray(t.linkedContactIds) && t.linkedContactIds.length > 0;

/** A person (or #335 filing for them) linked this thread on purpose. The
 *  last four are the legacy proofs: fields no automatic path ever writes
 *  (the work link, the venue, chosen people, a logged call / meeting). */
export function hasDeliberateLink(t: LinkFields): boolean {
  return (
    t.linkedBy === "user" ||
    t.linkedBy === "filing" ||
    (t.filing?.state === "filed" && !t.filing.noise) ||
    hasWorkLink(t) ||
    filled(t.siteId) ||
    hasPeople(t) ||
    (filled(t.channel) && t.channel !== "email" && filled(t.customerId))
  );
}

/** Linked to an entity (customer, venue, work record, or chosen people) —
 *  and deliberately so; an automatic customer match alone is not linked. */
export function isThreadLinked(t: LinkFields): boolean {
  return hasDeliberateLink(t) && (filled(t.customerId) || filled(t.siteId) || hasWorkLink(t) || hasPeople(t));
}

/** Assigned to `me` (#349): `assignedToId` when stamped; else the legacy
 *  `assignedTo` name (trimmed, case-insensitive) only while `me`'s name is
 *  unique among active users. "" never matches. */
export function isAssignedTo(t: AssignFields, me: MailboxViewer): boolean {
  if (!me || !filled(me.id)) return false;
  if (filled(t.assignedToId)) return t.assignedToId === me.id;
  const m = fold(me.name);
  return me.nameUnique && m !== "" && fold(t.assignedTo) === m;
}

/** My own live thread — what every write / action / Assist draft requires. */
export function isOwnThread(t: VisibilityFields, me: MailboxViewer): boolean {
  return ownsMailbox(t, me) && !t.deleted;
}

/** Visible to every staff user: linked, live, not a draft. */
export function isSharedThread(t: VisibilityFields): boolean {
  return !t.deleted && t.status !== "draft" && isThreadLinked(t);
}

/** The rule: may `me` see this thread's content at all (listings, ⌘K, Ask)? */
export function canSeeThread(t: VisibilityFields, me: MailboxViewer): boolean {
  if (t.deleted) return false;
  if (ownsMailbox(t, me)) return true;
  if (t.status === "draft") return false;
  return isAssignedTo(t, me) || isThreadLinked(t);
}

/** The Inbox reader: canSeeThread, plus my own thread in Deleted. */
export function canOpenThread(t: VisibilityFields, me: MailboxViewer): boolean {
  return ownsMailbox(t, me) || canSeeThread(t, me);
}

/** The Inbox reader's banner on a thread outside my mailbox: "In Jeff
 *  Chesebro’s mailbox — read only", or "Shared mailbox — read only" for a
 *  legacy shared-box thread. */
export function readOnlyBanner(t: MailboxFields): string {
  if (t.mailbox === "personal" && t.mailboxUser) return `In ${t.mailboxUser}’s mailbox — read only`;
  return "Shared mailbox — read only";
}

const NEVER: DocCond = { any: [] };

/** `ownsMailbox` as a DocCond — the same three branches (the stamp; else the
 *  Gmail key; else the legacy name, only while `me`'s name is unique). */
export function ownMailboxCond(me: MailboxViewer): DocCond {
  if (!me || !filled(me.id)) return NEVER;
  const unstamped: DocCond = { path: ["mailboxOwnerId"], empty: "text" };
  const branches: DocCond[] = [
    { path: ["mailboxOwnerId"], is: me.id },
    { all: [unstamped, { path: ["gmailAccountKey"], is: personalKey(me.id) }] },
  ];
  if (me.nameUnique && filled(me.name))
    branches.push({ all: [unstamped, { path: ["gmailAccountKey"], empty: "text" }, { path: ["mailboxUser"], is: me.name }] });
  return { all: [{ path: ["mailbox"], is: "personal" }, { any: branches }] };
}

/** `isAssignedTo` as a DocCond. */
export function assignedToCond(me: MailboxViewer): DocCond {
  if (!me || !filled(me.id)) return NEVER;
  const branches: DocCond[] = [{ path: ["assignedToId"], is: me.id }];
  const m = fold(me.name);
  if (me.nameUnique && m) branches.push({ all: [{ path: ["assignedToId"], empty: "text" }, { path: ["assignedTo"], isFolded: m }] });
  return { any: branches };
}

/** `canSeeThread` as a DocCond (searchDocs' `where`) — the same branches. */
export function canSeeThreadCond(me: MailboxViewer): DocCond {
  const notDeleted: DocCond = { path: ["deleted"], isNot: "true" };
  const workLink: DocCond = { all: [{ path: ["link", "type"], filled: "text" }, { path: ["link", "id"], filled: "text" }] };
  const deliberate: DocCond = {
    any: [
      { path: ["linkedBy"], is: "user" },
      { path: ["linkedBy"], is: "filing" },
      { all: [{ path: ["filing", "state"], is: "filed" }, { path: ["filing", "noise"], isNot: "true" }] },
      workLink,
      { path: ["siteId"], filled: "text" },
      { path: ["linkedContactIds"], filled: "array" },
      { all: [{ path: ["channel"], filled: "text" }, { path: ["channel"], isNot: "email" }, { path: ["customerId"], filled: "text" }] },
    ],
  };
  const linked: DocCond = {
    all: [
      deliberate,
      { any: [{ path: ["customerId"], filled: "text" }, { path: ["siteId"], filled: "text" }, workLink, { path: ["linkedContactIds"], filled: "array" }] },
    ],
  };
  const shared: DocCond = {
    all: [{ path: ["status"], isNot: "draft" }, { any: [assignedToCond(me), linked] }],
  };
  return { all: [notDeleted, { any: [ownMailboxCond(me), shared] }] };
}
