/**
 * Inbox organization (#335, D901) — is a thread's stored court still about its
 * newest email message? Pure. The pipeline stamps `court.basis` = the newest
 * email message id it computed against; a court with no basis is judged by
 * time. A stale court (new mail landed and organizing didn't run — it failed,
 * or `INBOX_ORG_DISABLED` is on) must not hide that mail: readers fall back to
 * the thread's status alone.
 */
import type { Court } from "./types";

type Msg = { id: string; at?: number; channel?: string | null };

/** The newest email message (the pipeline's ordering: by time, then array
 *  order), or null. */
function newestEmail(messages: readonly Msg[] | undefined): Msg | null {
  let best: Msg | null = null;
  for (const m of messages || []) {
    if (m.channel && m.channel !== "email") continue;
    if (!best || (m.at || 0) >= (best.at || 0)) best = m;
  }
  return best;
}

/** The court was computed against the thread's newest email message. A
 *  thread with no email messages keeps its court. */
export function courtIsCurrent(t: { court?: Pick<Court, "basis" | "at"> | null; messages?: readonly Msg[] }): boolean {
  const c = t.court;
  if (!c) return false;
  const latest = newestEmail(t.messages);
  if (!latest) return true;
  if (c.basis) return c.basis === latest.id;
  return (latest.at || 0) <= (c.at || 0);
}
