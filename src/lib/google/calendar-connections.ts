import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  calendarConnections,
  type CalendarConnectionRow,
  type CalendarSubscription,
} from "@/db/schema";
import { decryptToken, encryptToken } from "@/lib/gmail/crypto";
import { refreshAccessToken, type OAuthTokens } from "@/lib/gmail/oauth";

/**
 * Store for D148's calendar-only connections (calendar_connections table) —
 * additional Google accounts a user connects purely to subscribe to their
 * calendars from the Calendar tab. Deliberately parallel to, not built on
 * top of, lib/gmail/connections.ts: that module's rows are keyed by
 * mailboxKey and carry Gmail-import state that has no meaning here. Token
 * encryption (lib/gmail/crypto.ts) and refresh (lib/gmail/oauth.ts) are
 * reused verbatim — those are generic OAuth mechanics, not Gmail-specific.
 */

/** Public view of a connection (no secrets) — for the Calendar tab's
 *  management UI. */
export type CalendarConnectionInfo = {
  id: string;
  userId: string;
  googleEmail: string;
  calendars: CalendarSubscription[];
  connectedAt: number;
};

function toInfo(r: CalendarConnectionRow): CalendarConnectionInfo {
  return {
    id: r.id,
    userId: r.userId,
    googleEmail: r.googleEmail,
    calendars: r.calendars,
    connectedAt: r.createdAt,
  };
}

function newConnectionId(): string {
  return "cc-" + crypto.randomBytes(9).toString("base64url");
}

/** Every calendar connection the given user owns (never another user's —
 *  these are personal, not shared, per D148). */
export async function listConnectionsForUser(userId: string): Promise<CalendarConnectionInfo[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(calendarConnections)
    .where(eq(calendarConnections.userId, userId));
  return rows.map(toInfo);
}

async function getRow(id: string): Promise<CalendarConnectionRow | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(calendarConnections)
    .where(eq(calendarConnections.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/** Loads a connection but only when it belongs to the given user — every
 *  mutating action re-checks ownership server-side rather than trusting the
 *  connection id alone (S13-style defense-in-depth, same as
 *  requireCalendarGrant in calendar-actions.ts). */
export async function getOwnedConnection(
  id: string,
  userId: string
): Promise<CalendarConnectionInfo | null> {
  const row = await getRow(id);
  if (!row || row.userId !== userId) return null;
  return toInfo(row);
}

/**
 * Create a new connection right after the OAuth callback exchanges its code,
 * with the account's calendar list already discovered. Default visibility
 * (D148): the account's PRIMARY calendar starts visible, everything else
 * starts hidden — "add noise gradually" rather than flooding the Calendar
 * tab with every calendar a fresh Google account happens to have (shared
 * team calendars, holiday calendars it auto-subscribes to, etc).
 */
export async function createConnection(input: {
  userId: string;
  googleEmail: string;
  tokens: OAuthTokens;
  discovered: Array<{ id: string; summary: string; primary?: boolean; backgroundColor?: string }>;
}): Promise<CalendarConnectionInfo> {
  if (!input.tokens.refreshToken) {
    throw new Error(
      "No refresh token returned — revoke the app's access in the Google account and reconnect."
    );
  }
  const db = await getDb();
  const now = Date.now();
  const calendars: CalendarSubscription[] = input.discovered.map((c) => ({
    id: c.id,
    summary: c.summary,
    backgroundColor: c.backgroundColor,
    visible: !!c.primary,
  }));
  const row = {
    id: newConnectionId(),
    userId: input.userId,
    googleEmail: input.googleEmail,
    refreshToken: encryptToken(input.tokens.refreshToken),
    accessToken: encryptToken(input.tokens.accessToken),
    expiresAt: input.tokens.expiresAt,
    scope: input.tokens.scope ?? null,
    calendars,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(calendarConnections).values(row);
  return toInfo(row as CalendarConnectionRow);
}

export async function removeConnection(id: string, userId: string): Promise<void> {
  const db = await getDb();
  await db
    .delete(calendarConnections)
    .where(and(eq(calendarConnections.id, id), eq(calendarConnections.userId, userId)));
}

/** Replace one calendar's visible/colorOverride prefs (the whole row is
 *  small — a handful of calendars — so a whole-array rewrite is simplest
 *  and correct; no concurrent-writer story to worry about since only the
 *  owning user ever mutates their own connection). */
async function patchCalendar(
  id: string,
  userId: string,
  calendarId: string,
  patch: Partial<Pick<CalendarSubscription, "visible" | "colorOverride">>
): Promise<CalendarConnectionInfo | null> {
  const row = await getRow(id);
  if (!row || row.userId !== userId) return null;
  const calendars = row.calendars.map((c) => (c.id === calendarId ? { ...c, ...patch } : c));
  const db = await getDb();
  await db
    .update(calendarConnections)
    .set({ calendars, updatedAt: Date.now() })
    .where(eq(calendarConnections.id, id));
  return toInfo({ ...row, calendars });
}

export async function setCalendarVisibility(
  id: string,
  userId: string,
  calendarId: string,
  visible: boolean
): Promise<CalendarConnectionInfo | null> {
  return patchCalendar(id, userId, calendarId, { visible });
}

export async function setCalendarColor(
  id: string,
  userId: string,
  calendarId: string,
  color: string | null
): Promise<CalendarConnectionInfo | null> {
  return patchCalendar(id, userId, calendarId, { colorOverride: color ?? undefined });
}

/**
 * Re-run calendarList.list against Google and merge into the stored prefs:
 * calendars Google still reports keep their visible/colorOverride, new ones
 * are added hidden (same default-off rule as createConnection), and ones
 * Google no longer reports are dropped. Exposed for a "Refresh calendars"
 * action in the management UI — the initial connect already runs this once.
 */
export async function refreshCalendarList(
  id: string,
  userId: string,
  discovered: Array<{ id: string; summary: string; primary?: boolean; backgroundColor?: string }>
): Promise<CalendarConnectionInfo | null> {
  const row = await getRow(id);
  if (!row || row.userId !== userId) return null;
  const prior = new Map(row.calendars.map((c) => [c.id, c]));
  const calendars: CalendarSubscription[] = discovered.map((c) => {
    const existing = prior.get(c.id);
    return {
      id: c.id,
      summary: c.summary,
      backgroundColor: c.backgroundColor,
      visible: existing ? existing.visible : !!c.primary,
      colorOverride: existing?.colorOverride,
    };
  });
  const db = await getDb();
  await db
    .update(calendarConnections)
    .set({ calendars, updatedAt: Date.now() })
    .where(eq(calendarConnections.id, id));
  return toInfo({ ...row, calendars });
}

/** A valid access token for the connection, refreshing (and persisting the
 *  new one) when the cached token is within 60s of expiry — same pattern as
 *  lib/gmail/connections.ts's accessTokenFor. Returns null if the
 *  connection doesn't exist (removed mid-request, or a stale id). No
 *  ownership check here: callers that need it (server actions) check via
 *  getOwnedConnection first, while read-only agenda assembly (agenda.ts)
 *  already scoped its connection list to the user before calling this. */
export async function accessTokenForConnection(id: string): Promise<string | null> {
  const row = await getRow(id);
  if (!row) return null;
  const fresh = row.accessToken && (row.expiresAt ?? 0) - Date.now() > 60_000;
  if (fresh && row.accessToken) return decryptToken(row.accessToken);

  const tokens = await refreshAccessToken(decryptToken(row.refreshToken));
  const db = await getDb();
  await db
    .update(calendarConnections)
    .set({
      accessToken: encryptToken(tokens.accessToken),
      expiresAt: tokens.expiresAt,
      updatedAt: Date.now(),
    })
    .where(eq(calendarConnections.id, id));
  return tokens.accessToken;
}
