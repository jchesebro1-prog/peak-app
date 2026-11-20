"use server";

import { requireUser } from "@/lib/session";
import { draftReplyForThread, type ReplyTone } from "@/lib/assist/reply-server";
import { getRun, setRunOutcome } from "@/lib/stores/assist-runs";
import type { AssistFeature, AssistOutcome } from "@/lib/assist/types";

const OUTCOMES: AssistOutcome[] = ["accepted", "edited", "discarded"];
const CLIENT_OUTCOME_FEATURES: AssistFeature[] = ["tasks", "reply"];

/** #334 Assist — Draft reply. Returns text for the composer only: nothing
 *  is sent or saved here. The work is `draftReplyForThread`
 *  (src/lib/assist/reply-server.ts), shared with the daily brief's draft queue. */
export async function draftReplyAction(
  threadId: string,
  tone: ReplyTone = "normal"
): Promise<{ ok: true; runId: string; draft: string } | { ok: false; error: string }> {
  const me = await requireUser();
  const r = await draftReplyForThread(threadId, { id: me.id, name: me.name }, { tone });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, runId: r.runId, draft: r.draft };
}

export async function recordAssistOutcomeAction(
  runId: string,
  outcome: AssistOutcome,
  detail: Record<string, unknown>
): Promise<{ ok: boolean }> {
  const me = await requireUser();
  if (!OUTCOMES.includes(outcome)) return { ok: false };
  // Only client-judged features: estimate outcomes are computed server-side.
  const run = await getRun(String(runId || ""));
  if (!run || run.userId !== me.id || !CLIENT_OUTCOME_FEATURES.includes(run.feature)) return { ok: false };
  let safe: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(JSON.stringify(detail ?? {}));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false };
    safe = parsed as Record<string, unknown>;
  } catch {
    return { ok: false };
  }
  if (JSON.stringify(safe).length > 4000) return { ok: false };
  return { ok: await setRunOutcome(String(runId || ""), me.id, outcome, safe) };
}
