/**
 * Estimator live save — when to save (pure). The hook owns the timers and the queue; this owns the decisions.
 * `editSeq` counts user edits and `savedSeq` is the highest one stored, so an edit made during a save stays unsaved.
 */
export const DEBOUNCE_MS = 1_500;
const RETRY_MS = [5_000, 15_000, 30_000, 60_000];

export type LiveConflict = { by: string | null; at: number | null };
export type LiveSaveState = {
  editSeq: number;
  savedSeq: number;
  inFlightSeq: number | null;
  failures: number;
  /** A failed save holds off the debounce until its retry. */
  waitingRetry: boolean;
  refusal: string | null;
  conflict: LiveConflict | null;
};
export const INITIAL_LIVE_STATE: LiveSaveState = { editSeq: 0, savedSeq: 0, inFlightSeq: null, failures: 0, waitingRetry: false, refusal: null, conflict: null };

export type LiveEvent =
  /** `holdFailed`: a failed create stays failed through this edit. If its response was lost, another try mints a second quote. */
  | { type: "edit"; holdFailed?: boolean }
  /** `seq`: the newest edit this save can hold. Without it, the newest edit there is. */
  | { type: "start"; seq?: number }
  | { type: "saved"; seq: number }
  | { type: "failed" }
  | { type: "retry" }
  | { type: "refused"; message: string }
  | { type: "conflict"; by: string | null; at: number | null }
  | { type: "keepMine" };

export function reduceLive(s: LiveSaveState, e: LiveEvent): LiveSaveState {
  switch (e.type) {
    case "edit":
      return { ...s, editSeq: s.editSeq + 1, refusal: null, waitingRetry: e.holdFailed ? s.waitingRetry : false };
    case "start":
      return { ...s, inFlightSeq: e.seq ?? s.editSeq };
    case "saved":
      return { ...s, inFlightSeq: null, savedSeq: Math.max(s.savedSeq, e.seq), failures: 0, waitingRetry: false, refusal: null };
    case "failed":
      return { ...s, inFlightSeq: null, failures: s.failures + 1, waitingRetry: true };
    case "retry":
      return { ...s, waitingRetry: false };
    case "refused":
      return { ...s, inFlightSeq: null, refusal: e.message, waitingRetry: false };
    case "conflict":
      return { ...s, inFlightSeq: null, conflict: { by: e.by, at: e.at }, waitingRetry: false };
    case "keepMine":
      return { ...s, conflict: null, waitingRetry: false, refusal: null };
  }
}

export type LiveStatus = "saved" | "dirty" | "saving" | "failed" | "refused" | "conflict";
export function liveStatusOf(s: LiveSaveState): LiveStatus {
  if (s.conflict) return "conflict";
  if (s.inFlightSeq !== null) return "saving";
  if (s.refusal) return "refused";
  if (s.waitingRetry) return "failed";
  return s.editSeq > s.savedSeq ? "dirty" : "saved";
}

export type LiveGate = { enabled: boolean; hasId: boolean; hasLines: boolean; tierResolving: boolean; statusChanging: boolean };
export function canAutoSave(s: LiveSaveState, g: LiveGate): boolean {
  if (!g.enabled || g.tierResolving || g.statusChanging) return false;
  if (!g.hasId && !g.hasLines) return false;
  return liveStatusOf(s) === "dirty";
}

/** What the page reports. A new estimate with no lines has nothing to create, so an edit there isn't unsaved work. */
export function reportedLiveStatus(s: LiveSaveState, g: LiveGate): LiveStatus {
  const raw = liveStatusOf(s);
  return raw === "dirty" && !g.hasId && !g.hasLines ? "saved" : raw;
}

/** After a flush: every edit is stored and nothing stopped it. A status move only goes ahead on this. */
export function flushLanded(s: LiveSaveState): boolean {
  return !s.conflict && !s.refusal && s.savedSeq >= s.editSeq;
}

/** How long before an automatic retry; null = never by itself (a create could mint a second quote). */
export function retryDelayMs(failures: number, hasId = true): number | null {
  if (!hasId) return null;
  return RETRY_MS[Math.min(Math.max(failures, 1), RETRY_MS.length) - 1];
}
