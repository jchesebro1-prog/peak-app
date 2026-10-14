/**
 * #341 — Morning triage and email threads (Jeff, 2026-10-14). Pure.
 *
 *  - An assignee may read a thread assigned to them and use Done / Reassign
 *    on it from Start here; replying stays the owner's. The row actions
 *    re-read the thread at action time and act only while it is still the
 *    person's own live thread or still assigned to them.
 *  - An admin viewing a teammate's Start here (`/triage?user=`) sees an email
 *    row they couldn't open themselves (canSeeThread) as "Private email" —
 *    no subject, customer, reason or link — redacted on the server so the
 *    text never reaches the browser.
 */
import { canSeeThread, isAssignedTo, isOwnThread } from "@/lib/stores/comms-visibility";
import type { CommThread } from "@/lib/stores/comms";
import { parseTriageKey } from "./keys";
import type { SnapshotRow } from "./types";

type ThreadLike = Parameters<typeof canSeeThread>[0];

/** Done / Reassign on an email row: my own live thread, or one still assigned to me. */
export function triageMayActOnThread(t: ThreadLike, me: string): boolean {
  return isOwnThread(t, me) || (!t.deleted && isAssignedTo(t, me));
}

export const PRIVATE_EMAIL_TITLE = "Private email";

/** The thread id behind an email row, else null. */
export function emailRowThreadId(r: Pick<SnapshotRow, "key" | "source">): string | null {
  if (r.source !== "email") return null;
  const p = parseTriageKey(r.key);
  return p && p.source === "email" ? p.id : null;
}

/** Rows as `viewer` may see them: an email row whose thread the viewer can't
 *  see (missing included) keeps its rank and key but loses every word about
 *  the mail. Other rows pass through untouched. */
export function redactEmailRows(
  rows: readonly SnapshotRow[],
  threads: ReadonlyMap<string, Pick<CommThread, "mailbox" | "mailboxUser"> & ThreadLike>,
  viewer: string
): SnapshotRow[] {
  return rows.map((r) => {
    const id = emailRowThreadId(r);
    if (!id) return r;
    const t = threads.get(id);
    if (t && canSeeThread(t, viewer)) return r;
    return { ...r, title: PRIVATE_EMAIL_TITLE, sub: "", href: "", reason: "", callLine: null, also: [] };
  });
}
