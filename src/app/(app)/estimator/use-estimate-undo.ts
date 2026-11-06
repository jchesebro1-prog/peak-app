"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SpecSection } from "./types";
import { emptyUndoHistory, mapSnapshots, recordEdit, takeRedo, takeUndo, type UndoHistory, type UndoSnap } from "@/lib/estimate-live-save/undo";

export type EstimateUndoApi = {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  undo: () => void;
  redo: () => void;
  /** The next change to sections is a user edit. Optional label wins over the diff's own. */
  flagEdit: (label?: string) => void;
  /** `pendingChange`: state changes landing with this call are part of what cleared the history, so they aren't a step. */
  clearHistory: (opts?: { pendingChange?: boolean }) => void;
  /** Apply an automatic change to stored snapshots. */
  mapHistory: (fn: (sections: SpecSection[]) => SpecSection[]) => void;
};

const isTextTarget = (t: EventTarget | null): boolean => {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
};
const dialogOpen = () => !!document.querySelector('[role="dialog"],[aria-modal="true"]');

/**
 * Records a step when a flagged change lands. Unflagged changes (bonus lines, discounts, auto freight, $25 stamp) only
 * move the "current" snapshot, so they are never a step of their own. Groups and vendor quotes have no automatic writer
 * except a save response, passed as `serverVendorQuotes`.
 */
export function useEstimateUndo(opts: {
  snap: UndoSnap;
  serverVendorQuotes: { current: UndoSnap["vendorQuotes"] | null };
  /** Write a snapshot back to state. */
  apply: (s: UndoSnap) => void;
  /** ⌘Z / ⇧⌘Z on the keyboard. Default on. Undo and redo stay callable either way (buttons). */
  shortcuts?: boolean;
}): EstimateUndoApi {
  const { snap, serverVendorQuotes, apply } = opts;
  const shortcutsOn = opts.shortcuts !== false;
  const shortcutsRef = useRef(shortcutsOn);
  useEffect(() => {
    shortcutsRef.current = shortcutsOn;
  }, [shortcutsOn]);
  const [history, setHistory] = useState<UndoHistory>(emptyUndoHistory);
  const historyRef = useRef(history);
  const write = useCallback((h: UndoHistory) => {
    historyRef.current = h;
    setHistory(h);
  }, []);
  const currentRef = useRef(snap);
  const flagRef = useRef<{ label?: string } | null>(null);
  const applyingRef = useRef(false);
  /** A clear is waiting for its change to land. The state hook's setSections runs its flag inside a lazy updater, i.e. in the
   *  render AFTER clearHistory, so a flag arriving while this is set belongs to the change the clear swallows. */
  const clearingRef = useRef(false);

  useEffect(() => {
    const prev = currentRef.current;
    if (prev.sections === snap.sections && prev.groups === snap.groups && prev.vendorQuotes === snap.vendorQuotes) return;
    currentRef.current = snap;
    if (applyingRef.current) {
      applyingRef.current = false;
      clearingRef.current = false;
      flagRef.current = null;
      return;
    }
    const flag = flagRef.current;
    flagRef.current = null;
    const edited = !!flag || prev.groups !== snap.groups || (prev.vendorQuotes !== snap.vendorQuotes && snap.vendorQuotes !== serverVendorQuotes.current);
    if (edited) write(recordEdit(historyRef.current, prev, snap, Date.now(), flag?.label));
  }, [snap, serverVendorQuotes, write]);

  /** Restore a snapshot. When it is the very objects already shown, no change will land to reset the flag, so none is set. */
  const restoreWith = useCallback(
    (res: { next: UndoHistory; restore: UndoSnap } | null) => {
      if (!res) return;
      const cur = currentRef.current;
      const r = res.restore;
      applyingRef.current = !(r.sections === cur.sections && r.groups === cur.groups && r.vendorQuotes === cur.vendorQuotes);
      write(res.next);
      apply(res.restore);
    },
    [apply, write]
  );
  const undo = useCallback(() => restoreWith(takeUndo(historyRef.current, currentRef.current)), [restoreWith]);
  const redo = useCallback(() => restoreWith(takeRedo(historyRef.current, currentRef.current)), [restoreWith]);

  // ⌘Z / ⇧⌘Z outside text fields: a text field keeps the browser's own undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!shortcutsRef.current) return;
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      if (isTextTarget(e.target) || dialogOpen()) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const flagEdit = useCallback((label?: string) => {
    if (clearingRef.current) return;
    applyingRef.current = false;
    flagRef.current = { label: label ?? flagRef.current?.label };
  }, []);
  const clearHistory = useCallback(
    (opts?: { pendingChange?: boolean }) => {
      flagRef.current = null;
      applyingRef.current = !!opts?.pendingChange;
      clearingRef.current = !!opts?.pendingChange;
      write(emptyUndoHistory());
    },
    [write]
  );
  const mapHistory = useCallback((fn: (sections: SpecSection[]) => SpecSection[]) => write(mapSnapshots(historyRef.current, fn)), [write]);

  return useMemo(
    () => ({
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
      undoLabel: history.past[history.past.length - 1]?.label ?? null,
      redoLabel: history.future[0]?.label ?? null,
      undo,
      redo,
      flagEdit,
      clearHistory,
      mapHistory,
    }),
    [history, undo, redo, flagEdit, clearHistory, mapHistory]
  );
}
