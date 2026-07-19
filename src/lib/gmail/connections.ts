import { and, eq, isNull, lt, or } from "drizzle-orm";
import { getDb } from "@/db";
import { gmailConnections, type GmailConnectionRow } from "@/db/schema";
import { decryptToken, encryptToken } from "./crypto";
import { refreshAccessToken, type OAuthTokens } from "./oauth";

/**
 * Store for connected Gmail mailboxes (the gmail_connections table). All token
 * material is encrypted at rest; callers only ever receive a *fresh* access
 * token via accessTokenFor(), which transparently refreshes when expired.
 */

/** Public view of a connection (no secrets) — for Settings UI. */
export type ConnectionInfo = {
  mailboxKey: string;
  address: string;
  userId: string | null;
  connectedBy: string;
  initialImportDone: boolean;
  lastSyncAt: number | null;
  connectedAt: number;
  /** Space-separated granted scopes as returned by Google at connect time —
   *  lets callers detect connections that predate a scope addition (D74). */
  scope: string;
};

function toInfo(r: GmailConnectionRow): ConnectionInfo {
  return {
    mailboxKey: r.mailboxKey,
    address: r.address,
    userId: r.userId,
    connectedBy: r.connectedBy,
    initialImportDone: r.initialImportDone,
    lastSyncAt: r.lastSyncAt ?? null,
    connectedAt: r.createdAt,
    scope: r.scope ?? "",
  };
}

export async function listConnections(): Promise<ConnectionInfo[]> {
  const db = await getDb();
  const rows = await db.select().from(gmailConnections);
  return rows.map(toInfo);
}

export async function getConnectionInfo(
  mailboxKey: string
): Promise<ConnectionInfo | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(gmailConnections)
    .where(eq(gmailConnections.mailboxKey, mailboxKey))
    .limit(1);
  return rows[0] ? toInfo(rows[0]) : null;
}

async function getRow(mailboxKey: string): Promise<GmailConnectionRow | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(gmailConnections)
    .where(eq(gmailConnections.mailboxKey, mailboxKey))
    .limit(1);
  return rows[0] ?? null;
}

/** Upsert a freshly-authorized connection (called from the OAuth callback). */
export async function saveConnection(input: {
  mailboxKey: string;
  address: string;
  userId: string | null;
  connectedBy: string;
  tokens: OAuthTokens;
}): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  const existing = await getRow(input.mailboxKey);
  // Google only returns a refresh token on the first consent; if a re-connect
  // omits it, keep the stored one.
  const refresh = input.tokens.refreshToken
    ? encryptToken(input.tokens.refreshToken)
    : existing?.refreshToken;
  if (!refresh) {
    throw new Error(
      "No refresh token returned — revoke the app's access in the Google account and reconnect."
    );
  }
  const values = {
    mailboxKey: input.mailboxKey,
    address: input.address,
    userId: input.userId,
    connectedBy: input.connectedBy,
    refreshToken: refresh,
    accessToken: encryptToken(input.tokens.accessToken),
    expiresAt: input.tokens.expiresAt,
    scope: input.tokens.scope ?? null,
    historyId: existing?.historyId ?? null,
    initialImportDone: existing?.initialImportDone ?? false,
    lastSyncAt: existing?.lastSyncAt ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await db
    .insert(gmailConnections)
    .values(values)
    .onConflictDoUpdate({ target: gmailConnections.mailboxKey, set: values });
}

export async function removeConnection(mailboxKey: string): Promise<void> {
  const db = await getDb();
  await db.delete(gmailConnections).where(eq(gmailConnections.mailboxKey, mailboxKey));
}

/**
 * A valid access token for the mailbox, refreshing (and persisting the new
 * one) when the cached token is within 60s of expiry. Returns null if the
 * mailbox isn't connected.
 */
export async function accessTokenFor(mailboxKey: string): Promise<string | null> {
  const row = await getRow(mailboxKey);
  if (!row) return null;
  const fresh = row.accessToken && (row.expiresAt ?? 0) - Date.now() > 60_000;
  if (fresh && row.accessToken) return decryptToken(row.accessToken);

  const tokens = await refreshAccessToken(decryptToken(row.refreshToken));
  const db = await getDb();
  await db
    .update(gmailConnections)
    .set({
      accessToken: encryptToken(tokens.accessToken),
      expiresAt: tokens.expiresAt,
      updatedAt: Date.now(),
    })
    .where(eq(gmailConnections.mailboxKey, mailboxKey));
  return tokens.accessToken;
}

/** Persist Gmail sync progress (cursor + import flag). */
export async function updateSyncState(
  mailboxKey: string,
  patch: { historyId?: string | null; initialImportDone?: boolean; lastSyncAt?: number }
): Promise<void> {
  const db = await getDb();
  await db
    .update(gmailConnections)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(gmailConnections.mailboxKey, mailboxKey));
}

/** All connected mailbox keys (for the inbound poll to iterate). */
export async function connectedMailboxKeys(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select({ k: gmailConnections.mailboxKey }).from(gmailConnections);
  return rows.map((r) => r.k);
}

/**
 * Atomically claim a sync slot for one mailbox (PUNCHLIST #1 / D73).
 * START-stamps last_sync_at via a conditional UPDATE — the claim only
 * succeeds if the previous stamp is older than minAgeMs, so concurrent
 * callers (auto ticks from any number of tabs/users, plus the manual button)
 * can never both start a sync for the same mailbox inside the window, and a
 * failing sync still advances the stamp (no hammering a dead connection every
 * tick). Every sync path claims immediately before syncing: the auto path
 * with its 2-min staleness window, the manual path with a short 10s guard so
 * a user's click always syncs unless that mailbox literally just started.
 */
export async function claimSyncSlot(
  mailboxKey: string,
  minAgeMs: number
): Promise<boolean> {
  const db = await getDb();
  const now = Date.now();
  const rows = await db
    .update(gmailConnections)
    .set({ lastSyncAt: now, updatedAt: now })
    .where(
      and(
        eq(gmailConnections.mailboxKey, mailboxKey),
        or(
          isNull(gmailConnections.lastSyncAt),
          lt(gmailConnections.lastSyncAt, now - minAgeMs)
        )
      )
    )
    .returning({ k: gmailConnections.mailboxKey });
  return rows.length > 0;
}
