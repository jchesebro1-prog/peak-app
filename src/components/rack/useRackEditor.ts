"use client";
/**
 * #296 — undo/redo for a rack layout being edited. A thin React shell over the
 * pure history module: every edit is a layout.ts function returning a RackEdit;
 * a refused edit leaves the layout alone and surfaces its reason in `error`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { commit, historyOf, redo as redoHistory, undo as undoHistory, type RackHistory } from "@/lib/rack/history";
import type { RackEdit, RackLayout } from "@/lib/rack/types";

export type RackEditorOpts = { onChange: (l: RackLayout) => void; newId: () => string };

export type RackEditor = {
  layout: RackLayout;
  canUndo: boolean;
  canRedo: boolean;
  error: string | null;
  /** Commits on ok and returns true; on a refusal sets `error` (cleared by the next success) and returns false. */
  apply: (edit: (l: RackLayout) => RackEdit) => boolean;
  undo: () => void;
  redo: () => void;
  /** Replace the whole history (a different record was loaded). Does not call onChange. */
  reset: (l: RackLayout) => void;
};

export function useRackEditor(initial: RackLayout, opts: RackEditorOpts): RackEditor {
  const [state, setState] = useState<{ h: RackHistory; error: string | null }>(() => ({ h: historyOf(initial), error: null }));
  // The history as of the last edit, read synchronously by apply() so it can return a result.
  const hRef = useRef<RackHistory>(state.h);
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const set = useCallback((h: RackHistory, error: string | null, notify: boolean) => {
    const changed = h !== hRef.current;
    hRef.current = h;
    setState({ h, error });
    if (changed && notify) optsRef.current.onChange(h.present);
  }, []);

  const apply = useCallback(
    (edit: (l: RackLayout) => RackEdit): boolean => {
      const r = edit(hRef.current.present);
      if (!r.ok) {
        setState((s) => ({ ...s, error: r.reason }));
        return false;
      }
      set(commit(hRef.current, r.layout), null, true);
      return true;
    },
    [set]
  );

  const undo = useCallback(() => set(undoHistory(hRef.current), null, true), [set]);
  const redo = useCallback(() => set(redoHistory(hRef.current), null, true), [set]);
  const reset = useCallback((l: RackLayout) => set(historyOf(l), null, false), [set]);

  return {
    layout: state.h.present,
    canUndo: state.h.past.length > 0,
    canRedo: state.h.future.length > 0,
    error: state.error,
    apply,
    undo,
    redo,
    reset,
  };
}
