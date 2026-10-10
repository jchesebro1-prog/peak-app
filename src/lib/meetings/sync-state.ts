import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { krispConnections } from "@/db/schema";

/** #323 — per-rep meeting sync state, on the rep's `krisp_connections` row. */
export type SyncState = {
  syncedAt: number | null;
  backfillFrom: number | null;
  backfillCursor: string | null;
  lastError: string | null;
};

export const EMPTY_SYNC_STATE: SyncState = { syncedAt: null, backfillFrom: null, backfillCursor: null, lastError: null };

/** null when the rep has no Krisp connection. */
export async function getSyncState(userId: string): Promise<SyncState | null> {
  const db = await getDb();
  const [r] = await db.select().from(krispConnections).where(eq(krispConnections.userId, userId)).limit(1);
  return r
    ? {
        syncedAt: r.meetingsSyncedAt ?? null,
        backfillFrom: r.meetingsBackfillFrom ?? null,
        backfillCursor: r.meetingsBackfillCursor ?? null,
        lastError: r.meetingsLastError ?? null,
      }
    : null;
}

/** Writes only the keys present in `patch`; a missing connection row is a no-op. */
export async function setSyncState(userId: string, patch: Partial<SyncState>): Promise<void> {
  const set: Partial<typeof krispConnections.$inferInsert> = {};
  if ("syncedAt" in patch) set.meetingsSyncedAt = patch.syncedAt ?? null;
  if ("backfillFrom" in patch) set.meetingsBackfillFrom = patch.backfillFrom ?? null;
  if ("backfillCursor" in patch) set.meetingsBackfillCursor = patch.backfillCursor ?? null;
  if ("lastError" in patch) set.meetingsLastError = patch.lastError ?? null;
  if (!Object.keys(set).length) return;
  const db = await getDb();
  await db.update(krispConnections).set(set).where(eq(krispConnections.userId, userId));
}
