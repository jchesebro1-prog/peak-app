/**
 * AI daily brief — what the Inbox reader and the Home card may show of a
 * thread's stored pre-draft (spec §4 "Reader integration"). Server-side (it
 * reads the court rule from the triage email feed); the result is a plain
 * client-safe VM.
 *
 * Shown ONLY when all hold — the draft queue's own rule for making one:
 *   - fresh: `basis` is still the newest inbound message (`preDraftFresh`);
 *   - court me: waiting on us and on my court (`onMyCourt`), assigned to me;
 *   - for the reply: a non-empty drafted body; for the tasks: at least one
 *     stored suggestion (an empty list leaves the live Suggest tasks call).
 * Anything else → the reader's live Draft reply / Suggest tasks paths.
 */
import { onMyCourt } from "@/lib/triage/feeds/email";
import { sameName } from "@/lib/quote-approval-rules";
import { chicagoTime } from "@/lib/triage/clock";
import type { CommThread } from "@/lib/stores/comms";
import { preDraftFresh } from "./fresh";
import type { ReaderPreDraftVM } from "./types";

type ThreadLike = Pick<CommThread, "court" | "status" | "noise" | "messages" | "assignedTo" | "preDraft">;

export function readerPreDraft(
  t: ThreadLike,
  me: { name: string },
  env?: Record<string, string | undefined>
): ReaderPreDraftVM | null {
  const pd = t.preDraft;
  if (!pd || !preDraftFresh(t)) return null;
  if (!sameName(t.assignedTo, me.name) || !onMyCourt(t, env)) return null;
  const body = typeof pd.body === "string" ? pd.body : "";
  const reply = body.trim() ? { body, runId: pd.runId ?? null } : null;
  // An empty stored list never replaces the live Suggest tasks call.
  const tasks = Array.isArray(pd.taskSuggestions) && pd.taskSuggestions.length > 0 && pd.taskRunId ? { suggestions: pd.taskSuggestions, runId: pd.taskRunId } : null;
  if (!reply && !tasks) return null;
  return { reply, tasks, preparedLabel: Number.isFinite(pd.at) ? chicagoTime(pd.at) : "" };
}
