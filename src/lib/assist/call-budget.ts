/** Background Assist calls against a deadline (AI daily brief draft queue). Pure. */
import { SLOT_SETTINGS, type ModelSlot } from "./models";
import type { CallDeadline, CallLimits } from "./run";

/** Kept free before the deadline after a call's (capped) timeout. */
export const CALL_MARGIN_MS = 5_000;

/**
 * The caps for one call that must end before `d.at`: the slot's timeout or
 * the time left (halved when a fallback provider may make a second call),
 * whichever is shorter, with no retries. Null when that leaves less than
 * `d.minCallMs` — the call should not start.
 */
export function limitsBefore(d: CallDeadline, slot: ModelSlot): CallLimits | null {
  const now = (d.clock ?? Date.now)();
  const room = Math.floor((d.at - now - CALL_MARGIN_MS) / (d.hasFallback ? 2 : 1));
  const timeoutMs = Math.min(SLOT_SETTINGS[slot].timeoutMs, room);
  return timeoutMs >= d.minCallMs ? { timeoutMs, maxRetries: 0 } : null;
}

/** min of two optional caps (the stricter wins). */
export function stricter(a: CallLimits | undefined, b: CallLimits | null | undefined): CallLimits | undefined {
  if (!a) return b ?? undefined;
  if (!b) return a;
  const pick = (x?: number, y?: number) => (x === undefined ? y : y === undefined ? x : Math.min(x, y));
  return { timeoutMs: pick(a.timeoutMs, b.timeoutMs), maxRetries: pick(a.maxRetries, b.maxRetries) };
}
