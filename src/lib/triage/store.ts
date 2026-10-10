import { getDoc, insertDocIfAbsent, listDocsByField, upsertDoc } from "@/db/doc-store";
import type { TriageMark, TriageSnapshot } from "./types";

/** Persistence for the two triage collections. Server-only. */

export async function getSnapshot(id: string): Promise<TriageSnapshot | null> {
  return getDoc<TriageSnapshot>("triage_snapshots", id);
}

/** An unconditional upsert — replaces whatever is stored. Nothing in the app calls it (the cron and the lazy view both insert-if-absent); kept for tests and one-off repair scripts. */
export async function saveSnapshot(s: TriageSnapshot): Promise<void> {
  await upsertDoc<TriageSnapshot>("triage_snapshots", s);
}

/** The cron and the lazy path: insert only if the slot has no snapshot (false = one already exists). Never overwrites a stored or concurrent snapshot. */
export async function insertSnapshotIfAbsent(s: TriageSnapshot): Promise<boolean> {
  return insertDocIfAbsent<TriageSnapshot>("triage_snapshots", s);
}

export function markId(userId: string, key: string): string {
  return `${userId}:${key}`;
}

export async function marksFor(userId: string): Promise<TriageMark[]> {
  return listDocsByField<TriageMark>("triage_marks", "userId", [userId]);
}

/** One mark per user per item; the latest wins — except a dismiss, which is permanent. */
export async function setMark(m: Omit<TriageMark, "id">): Promise<TriageMark> {
  const id = markId(m.userId, m.key);
  const existing = await getDoc<TriageMark>("triage_marks", id);
  if (existing?.kind === "dismiss") return existing;
  const doc: TriageMark = { ...m, id };
  await upsertDoc<TriageMark>("triage_marks", doc);
  return doc;
}
