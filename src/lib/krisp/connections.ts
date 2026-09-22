import { and, eq, isNull, lt, or } from "drizzle-orm";
import { getDb } from "@/db";
import { krispConnections, type KrispConnectionRow } from "@/db/schema";
import { decryptToken, encryptToken } from "@/lib/gmail/crypto";
import { KrispBusyError } from "./errors";
import type { KrispMe } from "./client";

export { KrispBusyError };

/**
 * Store for per-rep Krisp API keys — the `krisp_connections` table
 * (Recordings spec §1.2). Mirrors `lib/gmail/connections.ts`: the key is
 * encrypted at rest with the same AES-GCM helper and only `getKrispConnection`
 * hands the plaintext back, to server code that is about to call Krisp.
 *
 * The import lock: Krisp allows one import start per user in flight
 * (`400 "Action is still in process"`), so `withKrispImportLock` claims
 * `import_claimed_at` with a conditional UPDATE … RETURNING — the same
 * atomic-claim idiom as the per-mailbox sync slot (D74, claimSyncSlot). A
 * stale claim (older than KRISP_IMPORT_LOCK_TTL_MS — a crashed relay) is
 * taken over; a live one makes the caller requeue via KrispBusyError.
 */
export const KRISP_IMPORT_LOCK_TTL_MS = 5 * 60_000;

/** Public view (no secret) — for the Account page card. */
export type KrispConnectionInfo = {
  userId: string;
  krispUserId: number | null;
  krispEmail: string | null;
  krispName: string | null;
  connectedAt: number;
  lastUsedAt: number | null;
  lastError: string | null;
  importClaimedAt: number | null;
};

export type KrispConnection = KrispConnectionInfo & { apiKey: string };

function toInfo(r: KrispConnectionRow): KrispConnectionInfo {
  return {
    userId: r.userId,
    krispUserId: r.krispUserId ?? null,
    krispEmail: r.krispEmail ?? null,
    krispName: r.krispName ?? null,
    connectedAt: r.connectedAt,
    lastUsedAt: r.lastUsedAt ?? null,
    lastError: r.lastError ?? null,
    importClaimedAt: r.importClaimedAt ?? null,
  };
}

async function getRow(userId: string): Promise<KrispConnectionRow | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(krispConnections)
    .where(eq(krispConnections.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

/** Connection without the secret — safe to hand to UI. */
export async function getKrispConnectionInfo(userId: string): Promise<KrispConnectionInfo | null> {
  const row = await getRow(userId);
  return row ? toInfo(row) : null;
}

/** Connection WITH the decrypted key — server-only, for callers about to hit Krisp. */
export async function getKrispConnection(userId: string): Promise<KrispConnection | null> {
  const row = await getRow(userId);
  if (!row) return null;
  return { ...toInfo(row), apiKey: decryptToken(row.apiKey) };
}

/** All connected Peak users (for the reconcile/cron passes). No secrets. */
export async function listKrispConnections(): Promise<KrispConnectionInfo[]> {
  const db = await getDb();
  const rows = await db.select().from(krispConnections);
  return rows.map(toInfo);
}

/**
 * Upsert after a successful connect (the caller has already validated the
 * key with `GET /me` — and, per spec §1.2, rejected a Read-only key). A
 * reconnect replaces the key and identity but keeps `connected_at`.
 */
export async function saveKrispConnection(
  userId: string,
  apiKey: string,
  me: Pick<KrispMe, "id" | "email" | "name">
): Promise<KrispConnectionInfo> {
  const db = await getDb();
  const now = Date.now();
  const existing = await getRow(userId);
  const values = {
    userId,
    apiKey: encryptToken(apiKey),
    krispUserId: me.id ?? null,
    krispEmail: me.email || null,
    krispName: me.name || null,
    connectedAt: existing?.connectedAt ?? now,
    lastUsedAt: existing?.lastUsedAt ?? null,
    lastError: null,
    importClaimedAt: null,
  };
  await db
    .insert(krispConnections)
    .values(values)
    .onConflictDoUpdate({ target: krispConnections.userId, set: values });
  return toInfo({ ...values } as KrispConnectionRow);
}

/** Disconnect = delete the row (spec §1.2). */
export async function deleteKrispConnection(userId: string): Promise<void> {
  const db = await getDb();
  await db.delete(krispConnections).where(eq(krispConnections.userId, userId));
}

/** Stamp the last Krisp error on the row (null clears it); also bumps last_used_at. */
export async function recordKrispError(userId: string, message: string | null): Promise<void> {
  const db = await getDb();
  await db
    .update(krispConnections)
    .set({ lastError: message ? message.slice(0, 500) : null, lastUsedAt: Date.now() })
    .where(eq(krispConnections.userId, userId));
}

/** A successful Krisp call — bump last_used_at and clear any stale error. */
export async function markKrispUsed(userId: string): Promise<void> {
  await recordKrispError(userId, null);
}

/**
 * Run `fn` holding this user's import lock. The claim is a single conditional
 * UPDATE, so two concurrent relays for the same rep can never both start an
 * import; the loser gets KrispBusyError and requeues (spec §1.2 / §2.4). The
 * lock is released in `finally`, but only if it is still OUR claim — a relay
 * that overran the TTL and lost the slot must not clear the successor's.
 */
export async function withKrispImportLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const db = await getDb();
  const now = Date.now();
  const claimed = await db
    .update(krispConnections)
    .set({ importClaimedAt: now })
    .where(
      and(
        eq(krispConnections.userId, userId),
        or(
          isNull(krispConnections.importClaimedAt),
          lt(krispConnections.importClaimedAt, now - KRISP_IMPORT_LOCK_TTL_MS)
        )
      )
    )
    .returning({ userId: krispConnections.userId });
  if (!claimed.length) {
    const exists = await getRow(userId);
    if (!exists) throw new Error("Krisp is not connected for this user.");
    throw new KrispBusyError("A Krisp import for this account is already in progress.");
  }
  try {
    return await fn();
  } finally {
    await db
      .update(krispConnections)
      .set({ importClaimedAt: null })
      .where(and(eq(krispConnections.userId, userId), eq(krispConnections.importClaimedAt, now)));
  }
}
