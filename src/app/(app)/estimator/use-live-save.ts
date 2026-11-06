"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { canAutoSave, DEBOUNCE_MS, INITIAL_LIVE_STATE, liveStatusOf, reduceLive, retryDelayMs, type LiveConflict, type LiveEvent, type LiveGate, type LiveSaveState, type LiveStatus } from "@/lib/estimate-live-save/scheduler";
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
  markEdit: () => void;
  flush: () => Promise<void>;
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
export function useLiveSave(opts: { gate: LiveGate; perform: (mode: SaveMode) => Promise<SaveOutcome> }): LiveSaveApi {
  const [state, setState] = useState<LiveSaveState>(INITIAL_LIVE_STATE);
  const stateRef = useRef(state);
  const apply = useCallback((e: LiveEvent) => {
    stateRef.current = reduceLive(stateRef.current, e);
    setState(stateRef.current);
  }, []);
  const gateRef = useRef(opts.gate);
  const performRef = useRef(opts.perform);
  useEffect(() => {
    gateRef.current = opts.gate;
    performRef.current = opts.perform;
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
    apply({ type: "start" });
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
  const status = liveStatusOf(state);
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
        if (canAutoSave(stateRef.current, gateRef.current)) {
          const seq = stateRef.current.editSeq;
          await enqueue(async () => {
            const out = await performRef.current("auto").catch((): SaveOutcome => ({ kind: "failed" }));
            if (out.kind === "saved") {
              didLiveSaveRef.current = true;
              stateRef.current = reduceLive(stateRef.current, { type: "saved", seq });
            }
          });
        } else {
          await chainRef.current;
        }
        if (didLiveSaveRef.current) await revalidateAfterLiveSaveAction().catch(() => undefined);
      };
      void leave();
    },
    [enqueue]
  );

  const markEdit = useCallback(() => apply({ type: "edit" }), [apply]);
  // Past `statusChanging` on purpose: a status change sets it, then flushes, and its edits must land before the move.
  // Checked at its turn, so it also waits out a save in flight.
  const flush = useCallback(async () => {
    await enqueue(async () => {
      if (canAutoSave(stateRef.current, { ...gateRef.current, statusChanging: false })) await attemptAuto();
    });
  }, [attemptAuto, enqueue]);
  const saveManual = useCallback(
    () =>
      enqueue(async (): Promise<number | false> => {
        const seq = stateRef.current.editSeq;
        let out: SaveOutcome;
        try {
          out = await performRef.current("manual");
        } catch {
          return false;
        }
        if (out.kind === "saved") {
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
      apply({ type: "start" });
      const seq = stateRef.current.inFlightSeq as number;
      const out = await performRef.current("force").catch((): SaveOutcome => ({ kind: "failed" }));
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
    () => ({ status, refusal: state.refusal, conflict: state.conflict, edited: state.editSeq > 0, markEdit, flush, saveManual, enqueue, keepMine, reload, retryNow }),
    [status, state.refusal, state.conflict, state.editSeq, markEdit, flush, saveManual, enqueue, keepMine, reload, retryNow]
  );
}
