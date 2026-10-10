/**
 * Conduit riser (#321) — the editor's layout edits, pure. A drag is one of
 * five layout ops; the editor previews it by applying it to a copy of the
 * document (the store's own `patchConduitRiser`, so the preview and the
 * saved result round the same way) and re-running the layout. Undo / redo
 * covers only these ops: each entry carries its inverse — the value the
 * edit replaced. The stack is tied to a fingerprint of the layout it
 * expects; data that arrives changed from anywhere else empties it.
 */

import type { DetailLayout } from "./layout";
import type { ViewDetail } from "./derive";
import { crMakeId, patchConduitRiser, type ConduitRiserDoc } from "./model";

export type LayoutOp =
  | { op: "moveTag"; placementId: string; x: number; y: number; detailId: string }
  | { op: "unpinTag"; placementId: string }
  | { op: "updateStub"; id: string; x: number; y: number }
  | { op: "moveLevel"; detailId: string; levelId: string; y: number | null }
  | { op: "updateRun"; id: string; laneX: number | null };

export type HistoryEntry = { forward: LayoutOp; inverse: LayoutOp };
export type LayoutHistory = { expect: string; undo: HistoryEntry[]; redo: HistoryEntry[] };

export const HISTORY_CAP = 100;
/** Drags snap to this many inches so lines and tags line up. */
export const SNAP_IN = 0.05;

export const snapIn = (v: number) => Math.round(v / SNAP_IN) * SNAP_IN;

/** Apply layout ops in order with the store's rules; an op it refuses changes nothing. */
export function applyLayoutOps(doc: ConduitRiserDoc, ops: readonly LayoutOp[], placementIds: ReadonlySet<string>): ConduitRiserDoc {
  let next = doc;
  for (const op of ops) next = patchConduitRiser(next, op, crMakeId, placementIds).doc;
  return next;
}

/** Every position the layout reads from the document, as one comparable
 *  string. Only placed things count — adding a stub or a run (auto-placed)
 *  doesn't disturb the undo stack; moving or removing a placed one does. */
export function layoutFingerprint(doc: ConduitRiserDoc): string {
  const tags = Object.keys(doc.tags)
    .sort()
    .map((k) => [k, doc.tags[k].x, doc.tags[k].y, doc.tags[k].detailId]);
  const stubs = doc.stubs.filter((s) => s.x !== undefined).map((s) => [s.id, s.x, s.y]);
  const levels = Object.keys(doc.levelY)
    .sort()
    .map((d) => [d, Object.keys(doc.levelY[d]).sort().map((l) => [l, doc.levelY[d][l]])]);
  const lanes = doc.runs.filter((r) => r.laneX !== undefined).map((r) => [r.id, r.laneX]);
  return JSON.stringify([tags, stubs, levels, lanes]);
}

/**
 * The op that puts back what `op` replaces, read from the document before
 * it runs. A tag that was auto-placed un-pins; a stub that was auto-placed
 * goes back to where the layout had drawn it (a stub can't be un-pinned).
 * null when there's nothing to restore.
 */
export function inverseLayoutOp(doc: ConduitRiserDoc, layout: DetailLayout | null, op: LayoutOp): LayoutOp | null {
  switch (op.op) {
    case "moveTag": {
      const cur = Object.prototype.hasOwnProperty.call(doc.tags, op.placementId) ? doc.tags[op.placementId] : null;
      return cur ? { op: "moveTag", placementId: op.placementId, x: cur.x, y: cur.y, detailId: cur.detailId } : { op: "unpinTag", placementId: op.placementId };
    }
    case "unpinTag": {
      const cur = Object.prototype.hasOwnProperty.call(doc.tags, op.placementId) ? doc.tags[op.placementId] : null;
      return cur ? { op: "moveTag", placementId: op.placementId, x: cur.x, y: cur.y, detailId: cur.detailId } : null;
    }
    case "updateStub": {
      const stub = doc.stubs.find((s) => s.id === op.id);
      if (!stub) return null;
      if (stub.x !== undefined && stub.y !== undefined) return { op: "updateStub", id: op.id, x: stub.x, y: stub.y };
      const laid = layout?.items.find((it) => it.kind === "stub" && it.id === op.id);
      return laid ? { op: "updateStub", id: op.id, x: laid.rect.x, y: laid.rect.y } : null;
    }
    case "moveLevel": {
      const row = Object.prototype.hasOwnProperty.call(doc.levelY, op.detailId) ? doc.levelY[op.detailId] : {};
      const prev = Object.prototype.hasOwnProperty.call(row, op.levelId) ? row[op.levelId] : null;
      return { op: "moveLevel", detailId: op.detailId, levelId: op.levelId, y: prev };
    }
    case "updateRun": {
      const run = doc.runs.find((r) => r.id === op.id);
      return run ? { op: "updateRun", id: op.id, laneX: run.laneX ?? null } : null;
    }
  }
}

/** The view with the document's stubs and runs swapped in — what a preview lays out. */
export function viewWithDoc(view: ViewDetail, doc: ConduitRiserDoc): ViewDetail {
  const stubById = new Map(doc.stubs.map((s) => [s.id, s]));
  const runById = new Map(doc.runs.map((r) => [r.id, r]));
  return {
    ...view,
    stubs: view.stubs.map((s) => stubById.get(s.id) ?? s),
    runs: view.runs.map((r) => {
      const run = runById.get(r.run.id);
      return run ? { ...r, run } : r;
    }),
  };
}

/** The stack as it stands against `doc` — empty when the layout moved under it. */
export function historyFor(h: LayoutHistory | null, doc: ConduitRiserDoc): { undo: HistoryEntry[]; redo: HistoryEntry[] } {
  return h && h.expect === layoutFingerprint(doc) ? { undo: h.undo, redo: h.redo } : { undo: [], redo: [] };
}

/** A new edit: pushed on the undo stack (capped), redo cleared. */
export function recordEdit(h: LayoutHistory | null, doc: ConduitRiserDoc, entry: HistoryEntry, placementIds: ReadonlySet<string>): LayoutHistory {
  const base = historyFor(h, doc);
  return {
    expect: layoutFingerprint(applyLayoutOps(doc, [entry.forward], placementIds)),
    undo: [...base.undo, entry].slice(-HISTORY_CAP),
    redo: [],
  };
}

/** Undo: the op to send and the stack once it lands. null = nothing to undo. */
export function stepUndo(h: LayoutHistory | null, doc: ConduitRiserDoc, placementIds: ReadonlySet<string>): { op: LayoutOp; next: LayoutHistory } | null {
  const base = historyFor(h, doc);
  const entry = base.undo.at(-1);
  if (!entry) return null;
  return {
    op: entry.inverse,
    next: { expect: layoutFingerprint(applyLayoutOps(doc, [entry.inverse], placementIds)), undo: base.undo.slice(0, -1), redo: [...base.redo, entry] },
  };
}

/** Redo: the op to send and the stack once it lands. null = nothing to redo. */
export function stepRedo(h: LayoutHistory | null, doc: ConduitRiserDoc, placementIds: ReadonlySet<string>): { op: LayoutOp; next: LayoutHistory } | null {
  const base = historyFor(h, doc);
  const entry = base.redo.at(-1);
  if (!entry) return null;
  return {
    op: entry.forward,
    next: { expect: layoutFingerprint(applyLayoutOps(doc, [entry.forward], placementIds)), undo: [...base.undo, entry], redo: base.redo.slice(0, -1) },
  };
}
