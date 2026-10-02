/**
 * #296 — pure undo/redo over immutable rack layouts. Every edit in layout.ts
 * returns a fresh layout, so history is just stacks of them.
 */
import type { RackLayout } from "./types";

export type RackHistory = { past: RackLayout[]; present: RackLayout; future: RackLayout[] };
export const HISTORY_CAP = 100;

export function historyOf(present: RackLayout): RackHistory {
  return { past: [], present, future: [] };
}

/** Make `next` the present; the old present goes on the undo stack (capped), redo clears. Equal layouts are a no-op. */
export function commit(h: RackHistory, next: RackLayout): RackHistory {
  if (JSON.stringify(next) === JSON.stringify(h.present)) return h;
  return { past: [...h.past, h.present].slice(-HISTORY_CAP), present: next, future: [] };
}

export function undo(h: RackHistory): RackHistory {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo(h: RackHistory): RackHistory {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present].slice(-HISTORY_CAP), present: h.future[0], future: h.future.slice(1) };
}
