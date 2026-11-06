"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { canAutoSave, DEBOUNCE_MS, flushLanded, INITIAL_LIVE_STATE, liveStatusOf, reduceLive, reportedLiveStatus, retryDelayMs, type LiveConflict, type LiveEvent, type LiveGate, type LiveSaveState, type LiveStatus } from "@/lib/estimate-live-save/scheduler";
import { revalidateAfterLiveSaveAction } from "./actions";

export type SaveMode = "auto" | "manual" | "force";
export type SaveOutcome =
  | { kind: "saved"; version: number }
  | { kind: "conflict"; by: string | null; at: number | null }
  | { kind: "refused"; message: string }
  | { kind: "notLive" }
  | { kind: "failed" }
  /** Nothing was attempted (a tier lookup in flight), or the page is reloading. */
  | { kind: "blocked" };

export type LiveSaveApi = {
  status: LiveStatus;
  refusal: string | null;
  conflict: LiveConflict | null;
  /** A user edit has happened in this page session. */
  edited: boolean;
  /** A conflict is open, right now. Read inside the queue: `conflict` is only as new as the last commit. */
  conflictNow: () => boolean;
  markEdit: () => void;
  /** Saves what's unsaved now, and says whether every edit is stored. A status move stops on false. */
  flush: () => Promise<boolean>;
  saveManual: () => Promise<number | false>;
  enqueue: <T>(run: () => Promise<T>) => Promise<T>;
  keepMine: () => void;
  reload: () => void;
  retryNow: () => void;
};

/**
 * One queue for every write from this window (live saves, manual Saves, the header autosave), the debounce and the
 * retries. `perform` is read through a ref when its turn comes, so a queued save sends the newest committed state.
 */
export function useLiveSave(opts: {
  gate: LiveGate;
  perform: (mode: SaveMode) => Promise<SaveOutcome>;
  /** On the way out: pick up edits nothing has marked yet (no commit follows an unmount). True if there were any. */
  beforeLeave?: () => boolean;
}): LiveSaveApi {
  const [state, setState] = useState<LiveSaveState>(INITIAL_LIVE_STATE);
  const stateRef = useRef(state);
  const apply = useCallback((e: LiveEvent) => {
    stateRef.current = reduceLive(stateRef.current, e);
    setState(stateRef.current);
  }, []);
  const gateRef = useRef(opts.gate);
  const performRef = useRef(opts.perform);
  const beforeLeaveRef = useRef(opts.beforeLeave);
  /** The newest edit `performRef`'s closure holds. markEdit moves stateRef before React commits, so a save starting in
   *  that gap must not claim an edit it can't send. Set together with performRef, from the same render. */
  const committedEditSeqRef = useRef(state.editSeq);
  useEffect(() => {
    gateRef.current = opts.gate;
    performRef.current = opts.perform;
    beforeLeaveRef.current = opts.beforeLeave;
    committedEditSeqRef.current = state.editSeq;
  });
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = useCallback(<T,>(run: () => Promise<T>): Promise<T> => {
    const next = chainRef.current.then(run, run);
    chainRef.current = next.catch(() => undefined);
    return next;
  }, []);
  const autoQueuedRef = useRef(false);
  const didLiveSaveRef = useRef(false);
  const unloadOkRef = useRef(false);

  const settle = useCallback((out: SaveOutcome, seq: number) => {
    if (out.kind === "saved") apply({ type: "saved", seq });
    else if (out.kind === "conflict") apply({ type: "conflict", by: out.by, at: out.at });
    else if (out.kind === "refused") apply({ type: "refused", message: out.message });
    else if (out.kind === "failed") apply({ type: "failed" });
    // notLive: the estimate left live save; the gate closes on the next render. Settle what was in flight.
    else apply({ type: "saved", seq: stateRef.current.savedSeq });
  }, [apply]);

  /** One live save. Runs inside the queue; the caller has checked the gate. */
  const attemptAuto = useCallback(async () => {
    apply({ type: "start", seq: committedEditSeqRef.current });
    const seq = stateRef.current.inFlightSeq as number;
    let out: SaveOutcome;
    try {
      out = await performRef.current("auto");
    } catch {
      out = { kind: "failed" };
    }
    if (out.kind === "saved") didLiveSaveRef.current = true;
    settle(out, seq);
  }, [apply, settle]);

  const runAuto = useCallback((): Promise<unknown> => {
    if (autoQueuedRef.current) return chainRef.current;
    autoQueuedRef.current = true;
    return enqueue(async () => {
      autoQueuedRef.current = false;
      if (canAutoSave(stateRef.current, gateRef.current)) await attemptAuto();
    });
  }, [attemptAuto, enqueue]);

  // The debounce, and the next save when an edit landed during the last one.
  const status = reportedLiveStatus(state, opts.gate);
  const ready = canAutoSave(state, opts.gate);
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => void runAuto(), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [ready, state.editSeq, runAuto]);

  // Automatic retries, and straight away when the connection comes back.
  useEffect(() => {
    if (status !== "failed" || !opts.gate.enabled) return;
    const delay = retryDelayMs(state.failures, opts.gate.hasId);
    if (delay === null) return;
    const again = () => {
      apply({ type: "retry" });
      void runAuto();
    };
    const t = setTimeout(again, delay);
    window.addEventListener("online", again);
    return () => {
      clearTimeout(t);
      window.removeEventListener("online", again);
    };
  }, [status, state.failures, opts.gate.enabled, opts.gate.hasId, apply, runAuto]);

  // Closing or reloading with work unsaved warns. In-app navigation doesn't fire this, so unmount saves instead.
  const needsSave = opts.gate.enabled && status !== "saved";
  useEffect(() => {
    if (!needsSave) return;
    const warn = (e: BeforeUnloadEvent) => {
      if (unloadOkRef.current) return;
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [needsSave]);
  useEffect(
    () => () => {
      const leave = async () => {
        if (beforeLeaveRef.current?.()) stateRef.current = reduceLive(stateRef.current, { type: "edit", holdFailed: !gateRef.current.hasId });
        // Decided at its turn: an edit made during a save in flight is unsaved only once that save lands. Past
        // `statusChanging` too: the move's own release can't commit now, and the server refuses a save it overtakes.
        await enqueue(async () => {
          if (liveStatusOf(stateRef.current) === "failed" && gateRef.current.hasId) stateRef.current = reduceLive(stateRef.current, { type: "retry" });
          if (!canAutoSave(stateRef.current, { ...gateRef.current, statusChanging: false })) return;
          const seq = stateRef.current.editSeq;
          const out = await performRef.current("auto").catch((): SaveOutcome => ({ kind: "failed" }));
          if (out.kind === "saved") {
            didLiveSaveRef.current = true;
            stateRef.current = reduceLive(stateRef.current, { type: "saved", seq });
          }
        });
        if (didLiveSaveRef.current) await revalidateAfterLiveSaveAction().catch(() => undefined);
      };
      void leave();
    },
    [enqueue]
  );

  const conflictNow = useCallback(() => stateRef.current.conflict !== null, []);
  // A failed create holds through new edits: if its response was lost, another try mints a second quote. Only a click retries it.
  const markEdit = useCallback(() => apply({ type: "edit", holdFailed: !gateRef.current.hasId }), [apply]);
  // Past `statusChanging` on purpose: a status change sets it, then flushes, and its edits must land before the move.
  // Checked at its turn, so it also waits out a save in flight. A failed save doesn't wait out its backoff.
  const flush = useCallback(
    () =>
      enqueue(async (): Promise<boolean> => {
        if (liveStatusOf(stateRef.current) === "failed" && gateRef.current.hasId) apply({ type: "retry" });
        if (canAutoSave(stateRef.current, { ...gateRef.current, statusChanging: false })) await attemptAuto();
        return flushLanded(stateRef.current);
      }),
    [apply, attemptAuto, enqueue]
  );
  const saveManual = useCallback(
    () =>
      enqueue(async (): Promise<number | false> => {
        const seq = committedEditSeqRef.current;
        let out: SaveOutcome;
        try {
          out = await performRef.current("manual");
        } catch {
          return false;
        }
        if (out.kind === "saved") {
          // A live-save estimate's Save skips the layout refresh too.
          if (gateRef.current.enabled) didLiveSaveRef.current = true;
          apply({ type: "saved", seq });
          return out.version;
        }
        if (out.kind === "conflict") apply({ type: "conflict", by: out.by, at: out.at });
        return false;
      }),
    [apply, enqueue]
  );
  const keepMine = useCallback(() => {
    apply({ type: "keepMine" });
    void enqueue(async () => {
      apply({ type: "start", seq: committedEditSeqRef.current });
      const seq = stateRef.current.inFlightSeq as number;
      const out = await performRef.current("force").catch((): SaveOutcome => ({ kind: "failed" }));
      if (out.kind === "saved" && gateRef.current.enabled) didLiveSaveRef.current = true;
      settle(out, seq);
    });
  }, [apply, enqueue, settle]);
  const reload = useCallback(() => {
    unloadOkRef.current = true;
    window.location.reload();
  }, []);
  const retryNow = useCallback(() => {
    apply({ type: "retry" });
    void runAuto();
  }, [apply, runAuto]);

  return useMemo(
    () => ({ status, refusal: state.refusal, conflict: state.conflict, edited: state.editSeq > 0, conflictNow, markEdit, flush, saveManual, enqueue, keepMine, reload, retryNow }),
    [status, state.refusal, state.conflict, state.editSeq, conflictNow, markEdit, flush, saveManual, enqueue, keepMine, reload, retryNow]
  );
}
