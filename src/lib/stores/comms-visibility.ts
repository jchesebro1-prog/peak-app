/**
 * #340 — who may see an email thread. Jeff, 2026-10-14: "you can only see
 * information that was either linked to entities or your own information."
 *
 * A thread is visible to `me` (a user's NAME — mailboxUser and assignedTo
 * hold names) when it is not in Deleted and:
 *   - it is in my own mailbox (`visibleTo`), or
 *   - it is assigned to me (`assignedTo`, the bell's and Morning triage's
 *     explicit hand-off; compared like quote-approval-rules' sameName), or
 *   - it is LINKED to an entity: a stored customerId, a siteId, a work link
 *     (`link` with a type and an id), or deliberately linked people
 *     (`linkedContactIds`, the Link popup).
 * `resolvedContactId` alone does NOT count: it is the automatic sender match
 * stamped at import, not a decision anyone made to share the mail.
 * Another person's DRAFT is never visible — unsent mail is not yet a record.
 *
 * Writes and actions stay with the owner (`isOwnThread`): a reply sends from
 * the owner's Gmail account, and filing / status / read state are theirs.
 * `canOpenThread` is the Inbox reader's rule — the owner also opens their own
 * thread from Deleted; everyone else reads a non-own thread read-only.
 *
 * `canSeeThreadCond` is the same rule as a doc-store `DocCond`, for SQL
 * candidate reads (⌘K) — keep the two in step.
 *
 * Pure, client-safe: type imports only.
 */
import type { DocCond } from "@/db/doc-store";
import type { CommThread } from "./comms";

type MailboxFields = Pick<CommThread, "mailbox" | "mailboxUser">;
type VisibilityFields = MailboxFields &
  Partial<Pick<CommThread, "deleted" | "status" | "assignedTo" | "customerId" | "siteId" | "link" | "linkedContactIds">>;

/** In `me`'s own personal mailbox (any folder). Legacy shared-box threads are
 *  nobody's own. */
export function visibleTo(t: MailboxFields, me: string): boolean {
  return t.mailbox === "personal" && t.mailboxUser === me;
}

const filled = (v: unknown): boolean => typeof v === "string" && v !== "";
const fold = (v: unknown): string => (typeof v === "string" ? v.trim().toLowerCase() : "");

/** Linked to an entity (customer, venue, work record, or chosen people). */
export function isThreadLinked(t: Partial<Pick<CommThread, "customerId" | "siteId" | "link" | "linkedContactIds">>): boolean {
  return (
    filled(t.customerId) ||
    filled(t.siteId) ||
    (!!t.link && filled(t.link.type) && filled(t.link.id)) ||
    (Array.isArray(t.linkedContactIds) && t.linkedContactIds.length > 0)
  );
}

/** Assigned to `me` (trimmed, case-insensitive; "" never matches). */
export function isAssignedTo(t: Partial<Pick<CommThread, "assignedTo">>, me: string): boolean {
  const m = fold(me);
  return m !== "" && fold(t.assignedTo) === m;
}

/** My own live thread — what every write / action / Assist draft requires. */
export function isOwnThread(t: VisibilityFields, me: string): boolean {
  return !!me && visibleTo(t, me) && !t.deleted;
}

/** Visible to every staff user: linked, live, not a draft. */
export function isSharedThread(t: VisibilityFields): boolean {
  return !t.deleted && t.status !== "draft" && isThreadLinked(t);
}

/** The rule: may `me` see this thread's content at all (listings, ⌘K, Ask)? */
export function canSeeThread(t: VisibilityFields, me: string): boolean {
  if (t.deleted) return false;
  if (me && visibleTo(t, me)) return true;
  if (t.status === "draft") return false;
  return isAssignedTo(t, me) || isThreadLinked(t);
}

/** The Inbox reader: canSeeThread, plus my own thread in Deleted. */
export function canOpenThread(t: VisibilityFields, me: string): boolean {
  return (!!me && visibleTo(t, me)) || canSeeThread(t, me);
}

/** The Inbox reader's banner on a thread outside my mailbox: "In Jeff
 *  Chesebro’s mailbox — read only", or "Shared mailbox — read only" for a
 *  legacy shared-box thread. */
export function readOnlyBanner(t: MailboxFields): string {
  if (t.mailbox === "personal" && t.mailboxUser) return `In ${t.mailboxUser}’s mailbox — read only`;
  return "Shared mailbox — read only";
}

/** `canSeeThread` as a DocCond (searchDocs' `where`) — the same branches. */
export function canSeeThreadCond(me: string): DocCond {
  const notDeleted: DocCond = { path: ["deleted"], isNot: "true" };
  const own: DocCond[] = me ? [{ all: [{ path: ["mailbox"], is: "personal" }, { path: ["mailboxUser"], is: me }] }] : [];
  const shared: DocCond = {
    all: [
      { path: ["status"], isNot: "draft" },
      {
        any: [
          { path: ["assignedTo"], isFolded: fold(me) },
          { path: ["customerId"], filled: "text" },
          { path: ["siteId"], filled: "text" },
          { all: [{ path: ["link", "type"], filled: "text" }, { path: ["link", "id"], filled: "text" }] },
          { path: ["linkedContactIds"], filled: "array" },
        ],
      },
    ],
  };
  return { all: [notDeleted, { any: [...own, shared] }] };
}
