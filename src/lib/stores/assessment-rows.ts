/* Assessments engine (#340) — row-level read/write for the assessment collections, keeping the document's own
   `rev` and the table's `rev` column equal. The offline outbox sends `doc.rev` (save.ts) and pull serves the
   column (listSince), so the two must never drift. Callers hold the record's advisory lock
   (ASSESSMENT_LOCK_NAMESPACE) around read → check → write, so every query here runs in that transaction. */
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { DOC_TABLES } from "@/db/doc-tables";

export type AssessColl = "assessments" | "findings" | "venue_profiles";

export interface DocRow { doc: Record<string, unknown>; rev: number; deleted: boolean }

/** The row, tombstones included (null when the id was never written). */
export async function readRow(coll: AssessColl, id: string): Promise<DocRow | null> {
  const db = await getDb();
  const t = DOC_TABLES[coll];
  const rows = await db.select({ doc: t.doc, rev: t.rev, deleted: t.deleted }).from(t).where(eq(t.id, id)).limit(1);
  if (!rows.length) return null;
  return { doc: { ...(rows[0].doc as Record<string, unknown>), id }, rev: rows[0].rev, deleted: rows[0].deleted };
}

/** Next revision after a stored row: one past whichever of the column or the doc field is higher. */
export function nextRev(row: DocRow | null): number {
  if (!row) return 1;
  const docRev = typeof row.doc.rev === "number" && Number.isFinite(row.doc.rev) ? row.doc.rev : 0;
  return Math.max(row.rev, docRev) + 1;
}

/** Insert (when `isNew`) or replace the row (live again), writing `doc.rev` into the rev column. Callers that must
 *  not revive a tombstone check `deleted` first. */
export async function writeRow(coll: AssessColl, id: string, doc: Record<string, unknown> & { rev: number }, isNew: boolean): Promise<void> {
  const db = await getDb();
  const t = DOC_TABLES[coll];
  const now = Date.now();
  const stored = { ...doc, id };
  if (isNew) {
    await db.insert(t).values({ id, doc: stored, rev: doc.rev, updatedAt: now, receivedAt: now, review: { state: "new" }, deleted: false });
  } else {
    await db.update(t).set({ doc: stored, rev: doc.rev, updatedAt: now, receivedAt: now, deleted: false }).where(eq(t.id, id));
  }
}
