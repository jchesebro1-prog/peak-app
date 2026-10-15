import { nextMorning, slotOrdinal } from "./clock";
import type { SnapshotRow, Slot, TriageMark } from "./types";

/** Which snapshot is on screen. Pure. */
export type SlotRef = { snapshotId: string; day: string; slot: Slot };

/** Rows on the Home card; "See more" shows the rest. */
export const HOME_LIMIT = 10;

/** "Snooze till tomorrow" → hidden until the next morning snapshot. */
export function snoozeUntil(day: string): string {
  const n = nextMorning(day);
  return slotOrdinal(n.day, n.slot);
}

/** Jeff 2026-10-15 #37 — a "Not mine" stops counting once the item escalated
 *  after it was marked (a new customer message, a resubmit for approval, an
 *  SLA breach): the row's `escalatedAt` is later than the mark. Pure. */
export function dismissLapsed(m: Pick<TriageMark, "kind" | "at">, row: Pick<SnapshotRow, "escalatedAt"> | null | undefined): boolean {
  if (m.kind !== "dismiss") return false;
  const esc = row?.escalatedAt;
  return typeof esc === "number" && Number.isFinite(esc) && typeof m.at === "number" && esc > m.at;
}

export function markHides(m: Pick<TriageMark, "kind" | "snapshotId" | "until"> & Partial<Pick<TriageMark, "at">>, cur: SlotRef, row?: Pick<SnapshotRow, "escalatedAt"> | null): boolean {
  if (m.kind === "dismiss") return !dismissLapsed({ kind: m.kind, at: m.at ?? Number.POSITIVE_INFINITY }, row);
  if (m.kind === "done") return m.snapshotId === cur.snapshotId;
  return !!m.until && slotOrdinal(cur.day, cur.slot) < m.until;
}

export function visibleRows(
  rows: readonly SnapshotRow[],
  marks: readonly TriageMark[],
  closed: ReadonlySet<string>,
  cur: SlotRef
): SnapshotRow[] {
  const byKey = new Map(marks.map((m) => [m.key, m]));
  return rows.filter((r) => {
    if (closed.has(r.key)) return false;
    const m = byKey.get(r.key);
    return !(m && markHides(m, cur, r));
  });
}
