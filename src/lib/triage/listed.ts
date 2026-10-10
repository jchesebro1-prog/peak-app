import { slotAt, snapshotId } from "./clock";
import { parseTriageKey } from "./keys";
import { getSnapshot } from "./store";
import type { SnapshotRow, TriageSnapshot } from "./types";

/**
 * The row actions' guard: a key is acted on only if it is a row of the
 * signed-in user's own snapshot for today (morning or midday). Marks and
 * writes through a forged or stale key are refused. Returns the stored row
 * (the dismiss needs its folded keys) or null.
 */
export async function listedRow(
  userId: string,
  key: string,
  now: number,
  read: (id: string) => Promise<TriageSnapshot | null> = getSnapshot
): Promise<SnapshotRow | null> {
  const { day } = slotAt(now);
  for (const slot of ["midday", "morning"] as const) {
    const snap = await read(snapshotId(userId, day, slot));
    const row = Array.isArray(snap?.rows) ? snap.rows.find((r) => r.key === key) : undefined;
    if (row) return row;
  }
  return null;
}

/** The call to-do keys folded into a surviving call row (empty for any other row, or an older row shape). */
export function foldedCallKeys(row: Pick<SnapshotRow, "source" | "alsoKeys">): string[] {
  if (row.source !== "call" || !Array.isArray(row.alsoKeys)) return [];
  return row.alsoKeys.filter((k) => parseTriageKey(k)?.source === "call");
}

/**
 * "Not mine" on a row: dismiss the call to-do on its recording (a failure
 * stops here, nothing marked), mark the row dismissed, then do the same for
 * every call to-do folded into it — those are best-effort (an item already
 * accepted or gone is logged and still marked, so it can't resurface).
 */
export async function dismissListedRow(
  row: Pick<SnapshotRow, "key" | "source" | "alsoKeys">,
  deps: { dismissItem: (meetingId: string, itemKey: string) => Promise<void>; mark: (key: string) => Promise<void> }
): Promise<void> {
  const dismissCall = async (key: string) => {
    const p = parseTriageKey(key);
    if (p?.source === "call" && p.part) await deps.dismissItem(p.id, p.part);
  };
  await dismissCall(row.key);
  await deps.mark(row.key);
  for (const k of foldedCallKeys(row)) {
    try {
      await dismissCall(k);
    } catch (err) {
      console.error("[triage] folded call to-do couldn't be dismissed on its recording", k, err);
    }
    await deps.mark(k);
  }
}
