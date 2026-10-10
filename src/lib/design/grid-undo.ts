/**
 * #299 Grid workspace — the undo/redo stack (pure, DB-free, client-safe).
 *
 * Every entry pairs a `forward` command with its `inverse`; the editor
 * executes whichever the user asked for through the existing server actions.
 * The reducer only moves entries between `past` and `future`. Type-only
 * import of the store so no server code reaches the client bundle.
 */
import type { TagPatch } from "@/lib/design/conduit-riser/tags";
import type { RemovedBundle } from "@/lib/stores/grid-projects";

export type GridCommand =
  | { kind: "move"; moves: { id: string; x: number; y: number }[] }
  | { kind: "remove"; ids: string[] }
  | { kind: "restore"; bundle: RemovedBundle }
  | { kind: "category"; items: { id: string; category: string }[] }
  | { kind: "part"; items: { id: string; partId: string; qty?: number; designator?: string }[] }
  /** #320: set designators; `keepAuto` for Renumber's undo/redo (not a hand edit). */
  | { kind: "designator"; items: { id: string; designator: string }[]; keepAuto?: boolean }
  /** #321: per-field riser tag patches (absent = leave, string = set, null = remove override). */
  | { kind: "tag"; items: { id: string; patch: TagPatch }[] };

export type UndoEntry = { label: string; forward: GridCommand; inverse: GridCommand };
export type UndoState = { past: UndoEntry[]; future: UndoEntry[] };

export const UNDO_CAP = 100;

export const emptyUndo = (): UndoState => ({ past: [], future: [] });

/** Append an entry; drop the oldest beyond the cap; a new edit clears redo. */
export function pushUndo(s: UndoState, e: UndoEntry): UndoState {
  const past = [...s.past, e];
  return { past: past.length > UNDO_CAP ? past.slice(past.length - UNDO_CAP) : past, future: [] };
}

/** Pop the last past entry onto the front of future. */
export function takeUndo(s: UndoState): { entry: UndoEntry; next: UndoState } | null {
  if (s.past.length === 0) return null;
  const entry = s.past[s.past.length - 1];
  return { entry, next: { past: s.past.slice(0, -1), future: [entry, ...s.future] } };
}

/** Take the front of future back onto past. */
export function takeRedo(s: UndoState): { entry: UndoEntry; next: UndoState } | null {
  if (s.future.length === 0) return null;
  const [entry, ...future] = s.future;
  return { entry, next: { past: [...s.past, entry], future } };
}

/** After redoing a delete the server returns a fresh bundle; store it on the
 *  given side so the next undo restores the latest records. */
export function withRefreshedRestore(e: UndoEntry, bundle: RemovedBundle, side: "forward" | "inverse"): UndoEntry {
  return { ...e, [side]: { kind: "restore", bundle } };
}
