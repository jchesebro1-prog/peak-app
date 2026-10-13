/**
 * AI daily brief (spec §6) — records that a quote's follow-up nudge was opened
 * in the composer (`/inbox?nudge=<quoteId>`). It is the nearest hook to "sent":
 * the composer opening, not the send itself. One atomic first-write-wins
 * outcome on the nudge's own run, by its owner; never throws.
 */
import { setRunOutcome } from "@/lib/stores/assist-runs";
import { NUDGE_OPENED_KEY } from "./report-keys";

export async function recordNudgeOpened(runId: string | null | undefined, userId: string, now: number = Date.now()): Promise<void> {
  if (!runId || !userId) return;
  await setRunOutcome(runId, userId, "accepted", { [NUDGE_OPENED_KEY]: true }, now).catch(() => false);
}
