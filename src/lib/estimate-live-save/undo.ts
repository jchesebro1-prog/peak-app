/**
 * Estimator Undo / Redo — the stack (pure, DB-free, client-safe), following src/lib/design/grid-undo.ts.
 * An entry stores the state BEFORE an edit. Sections are immutable, so snapshots share structure.
 */
import type { SpecItem, SpecSection, VendorQuote } from "@/app/(app)/estimator/types";
import type { SystemGroup } from "@/lib/estimate-groups/groups";

export type UndoSnap = { sections: SpecSection[]; groups: SystemGroup[]; vendorQuotes: VendorQuote[] };
export type UndoEntry = { snap: UndoSnap; label: string; at: number; target: string | null };
export type UndoHistory = { past: UndoEntry[]; future: UndoEntry[] };

export const UNDO_CAP = 100;
export const COALESCE_MS = 1_000;

export const emptyUndoHistory = (): UndoHistory => ({ past: [], future: [] });

/** Automatic lines re-derive after every edit, so they never count as one. */
const editableLines = (s: SpecSection): SpecItem[] => s.items.filter((it) => !(it as { bonus?: unknown }).bonus);
const lineKey = (it: SpecItem): string => {
  const rest: Record<string, unknown> = { ...it };
  delete rest.lineOrder;
  return JSON.stringify(rest);
};
const sectionFields = (s: SpecSection): string => {
  const rest: Record<string, unknown> = { ...s };
  delete rest.items;
  return JSON.stringify(rest);
};
const sectionKey = (s: SpecSection): string => sectionFields(s) + "|" + editableLines(s).map(lineKey).join("|");

export type EditDiff = { label: string; target: string | null };

/** Line-level change within one system (added, deleted, edited, reordered). null = the lines are unchanged. */
function singleSectionLineChange(prev: SpecSection, next: SpecSection): EditDiff | null {
  const prevLines = editableLines(prev);
  const nextLines = editableLines(next);
  if (nextLines.some((l) => !prevLines.some((p) => p.id === l.id))) return { label: "line added", target: null };
  if (prevLines.some((p) => !nextLines.some((l) => l.id === p.id))) return { label: "line deleted", target: null };
  const edited = nextLines.filter((l) => lineKey(l) !== lineKey(prevLines.find((p) => p.id === l.id) as SpecItem));
  if (edited.length === 1) return { label: "line edited", target: `line:${next.id}:${edited[0].id}` };
  if (edited.length > 1) return { label: "lines edited", target: null };
  if (prevLines.map((p) => p.id).join() !== nextLines.map((l) => l.id).join()) return { label: "lines reordered", target: null };
  return null;
}

/** What changed, in the words the tooltip shows. null = nothing the user would call an edit. */
export function diffEdit(before: UndoSnap, after: UndoSnap): EditDiff | null {
  if (before.groups !== after.groups && JSON.stringify(before.groups) !== JSON.stringify(after.groups)) return { label: "group changed", target: null };
  const beforeIds = before.sections.map((s) => s.id);
  const afterIds = after.sections.map((s) => s.id);
  if (afterIds.some((id) => !beforeIds.includes(id))) return { label: "system added", target: null };
  if (beforeIds.some((id) => !afterIds.includes(id))) return { label: "system deleted", target: null };
  if (beforeIds.join("\u0000") !== afterIds.join("\u0000")) return { label: "systems reordered", target: null };

  const changed = after.sections.filter((s, i) => s !== before.sections[i] && sectionKey(s) !== sectionKey(before.sections[i]));
  if (changed.length > 1) {
    const count = (ss: SpecSection[]) => ss.reduce((n, s) => n + editableLines(s).length, 0);
    return { label: count(before.sections) === count(after.sections) ? "lines moved" : "lines edited", target: null };
  }
  if (changed.length === 1) {
    const next = changed[0];
    const prev = before.sections.find((s) => s.id === next.id) as SpecSection;
    const fieldsChanged = sectionFields(next) !== sectionFields(prev);
    const lines = singleSectionLineChange(prev, next);
    // A line change and a system-field change in one edit: no target, so it never coalesces with a later edit.
    if (lines) return fieldsChanged ? { label: "system edited", target: null } : lines;
    return { label: "system edited", target: `sys:${next.id}` };
  }
  if (before.vendorQuotes !== after.vendorQuotes && JSON.stringify(before.vendorQuotes) !== JSON.stringify(after.vendorQuotes)) {
    return { label: "vendor quote changed", target: null };
  }
  return null;
}

/** Add a step, merging quick repeats on one target; a new edit clears redo. No real change leaves the history as it was. */
export function recordEdit(h: UndoHistory, before: UndoSnap, after: UndoSnap, now: number, labelOverride?: string): UndoHistory {
  const diff = diffEdit(before, after);
  if (!diff) return h;
  const last = h.past[h.past.length - 1];
  if (!labelOverride && last && diff.target && last.target === diff.target && now - last.at < COALESCE_MS) {
    return { past: [...h.past.slice(0, -1), { ...last, at: now }], future: [] };
  }
  const past = [...h.past, { snap: before, label: labelOverride ?? diff.label, at: now, target: diff.target }];
  return { past: past.length > UNDO_CAP ? past.slice(past.length - UNDO_CAP) : past, future: [] };
}

export function takeUndo(h: UndoHistory, current: UndoSnap): { restore: UndoSnap; next: UndoHistory } | null {
  const entry = h.past[h.past.length - 1];
  if (!entry) return null;
  return { restore: entry.snap, next: { past: h.past.slice(0, -1), future: [{ ...entry, snap: current }, ...h.future] } };
}

export function takeRedo(h: UndoHistory, current: UndoSnap): { restore: UndoSnap; next: UndoHistory } | null {
  const [entry, ...future] = h.future;
  if (!entry) return null;
  return { restore: entry.snap, next: { past: [...h.past, { ...entry, snap: current }], future } };
}

/** Apply an automatic change to every stored snapshot, so Undo never reverts something the user never touched. */
export function mapSnapshots(h: UndoHistory, fn: (sections: SpecSection[]) => SpecSection[]): UndoHistory {
  const map = (e: UndoEntry): UndoEntry => ({ ...e, snap: { ...e.snap, sections: fn(e.snap.sections) } });
  return { past: h.past.map(map), future: h.future.map(map) };
}
