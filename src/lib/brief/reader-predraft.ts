/**
 * AI daily brief — what the Inbox reader and the Home card may show of a
 * thread's stored pre-draft (spec §4 "Reader integration"). Server-side (it
 * reads the court rule from the triage email feed); the result is a plain
 * client-safe VM.
 *
 * Shown ONLY when all hold — the draft queue's own rule for making one:
 *   - fresh: `basis` is still the newest inbound message, and it was made
 *     for me (`preDraftFreshFor` — a reassigned thread's old draft is stale);
 *   - court me: waiting on us and on my court (`onMyCourt`), assigned to me;
 *   - for the reply: a non-empty drafted body; for the tasks: at least one
 *     stored suggestion (an empty list leaves the live Suggest tasks call).
 * Anything else → the reader's live Draft reply / Suggest tasks paths.
 */
import { onMyCourt } from "@/lib/triage/feeds/email";
import { chicagoTime } from "@/lib/triage/clock";
import { isAssignedTo, ownsMailbox, type CommThread, type MailboxViewer } from "@/lib/stores/comms";
import { preDraftFreshFor } from "./fresh";
import type { ReaderPreDraftVM } from "./types";

type ThreadLike = Pick<CommThread, "court" | "status" | "noise" | "messages" | "assignedTo" | "preDraft"> & Partial<Pick<CommThread, "assignedToId">>;

export function readerPreDraft(
  t: ThreadLike,
  me: MailboxViewer,
  env?: Record<string, string | undefined>
): ReaderPreDraftVM | null {
  const pd = t.preDraft;
  if (!pd || !preDraftFreshFor(t, me.id)) return null;
  if (!isAssignedTo(t, me) || !onMyCourt(t, env)) return null; // #349 — by identity
  const body = typeof pd.body === "string" ? pd.body : "";
  const reply = body.trim() ? { body, runId: pd.runId ?? null } : null;
  // An empty stored list never replaces the live Suggest tasks call.
  const tasks = Array.isArray(pd.taskSuggestions) && pd.taskSuggestions.length > 0 && pd.taskRunId ? { suggestions: pd.taskSuggestions, runId: pd.taskRunId } : null;
  if (!reply && !tasks) return null;
  return { reply, tasks, preparedLabel: Number.isFinite(pd.at) ? chicagoTime(pd.at) : "" };
}

/**
 * #350 review — the Home brief card's "Draft reply ready" / "Tasks ready"
 * chips: exactly what the reader would offer. The reader shows a teammate's
 * thread read-only and offers no stored draft there (`readOnly ? null :
 * readerPreDraft(…)`, inbox/page.tsx), so the card first requires the thread
 * to be in my own mailbox (#349 `ownsMailbox`) — an assigned thread in a
 * teammate's box never gets a chip.
 */
export function homeCardPreDraft(
  t: ThreadLike & Parameters<typeof ownsMailbox>[0],
  me: MailboxViewer,
  env?: Record<string, string | undefined>
): ReaderPreDraftVM | null {
  if (!ownsMailbox(t, me)) return null;
  return readerPreDraft(t, me, env);
}
