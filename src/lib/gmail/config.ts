/**
 * Gmail bridge — configuration & env gate (Phase 7).
 *
 * The entire Gmail integration is INERT until Jeff supplies credentials. It
 * turns on only when BOTH are true:
 *   - Google OAuth is configured (AUTH_GOOGLE_ID + AUTH_GOOGLE_SECRET — the
 *     SAME Google Cloud project used for sign-in, reused here per the resume
 *     plan), and
 *   - GMAIL_ENABLED === "true" (an explicit opt-in, so enabling Google SSO
 *     alone never starts touching mailboxes).
 *
 * When the gate is off, comms.ts keeps its simulated deliverMessage()/
 * checkMail() behaviour exactly as before — nothing calls Google.
 *
 * No new npm dependency: every Google call is a plain fetch() against the
 * documented REST endpoints (OAuth2 + Gmail API v1). Keeps the dependency
 * surface (and this locked-down machine's node_modules) unchanged.
 */

/** OAuth scopes requested when connecting a mailbox. Least-privilege:
 *  - gmail.send   → send mail (lands a copy in the account's Gmail "Sent", C4)
 *  - gmail.readonly → read threads/messages for the 90-day import + polling
 *  - gmail.modify → two-way archive (Jeff, 2026-07-19): Peak archive/unarchive
 *    pushes INBOX label changes back to Gmail. Mailboxes connected before this
 *    scope was added keep working read-only; Settings flags them to reconnect.
 *  - userinfo.email → learn which address just authorized (the mailbox addr) */
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/userinfo.email",
];

/** The scope two-way archive needs — connections whose stored grant lacks it
 *  (pre-2026-07-19 connects) stay one-way until reconnected. */
export const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";

/** Google Calendar events scope (D77 — dashboard calendar + direct site-visit
 *  writes). NOT in GMAIL_SCOPES: calendar access is opt-in per mailbox via
 *  Settings → Mailboxes → "Enable calendar" (D76-H: Jeff's own mailbox by
 *  default, anyone else's by choice), which re-runs consent WITH this scope.
 *  Remember: the Google Cloud consent screen must also list any scope
 *  requested here — see DEPLOY.md. */
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

/** Does a stored grant (space-separated scope string) include Calendar? */
export function hasCalendarScope(scope: string | null | undefined): boolean {
  return (scope || "").split(/\s+/).includes(CALENDAR_SCOPE);
}

/** Google Tasks scope (D146 — Google Tasks two-way sync for the Home Queue,
 *  the cloud sibling of the Apple Reminders agent, D93). Same pattern as
 *  CALENDAR_SCOPE: NOT in GMAIL_SCOPES, opt-in per personal mailbox via
 *  Settings → Mailboxes → "Enable Google Tasks sync", which re-runs consent
 *  WITH this scope appended (include_granted_scopes keeps the existing
 *  Gmail — and Calendar, if granted — scopes). Remember: the Google Cloud
 *  consent screen must also list this scope — see DEPLOY.md. */
export const TASKS_SCOPE = "https://www.googleapis.com/auth/tasks";

/** Does a stored grant (space-separated scope string) include Google Tasks? */
export function hasTasksScope(scope: string | null | undefined): boolean {
  return (scope || "").split(/\s+/).includes(TASKS_SCOPE);
}

/** Google Drive scope for the Recordings audio archive (Krisp recordings
 *  spec §5.1). `drive.file` = only files this app created — the nightly
 *  archive job can create `Peak Recordings/<Customer>/` folders and upload
 *  into them, and can never see the rest of the account's Drive. Same
 *  pattern as CALENDAR_SCOPE / TASKS_SCOPE: NOT in GMAIL_SCOPES, opt-in per
 *  mailbox via "Enable Drive archive" (Account page + Settings), which
 *  re-runs consent WITH this scope appended. Remember: the Google Cloud
 *  consent screen must also list this scope — see DEPLOY.md. */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/** Does a stored grant (space-separated scope string) include Drive (drive.file)? */
export function hasDriveScope(scope: string | null | undefined): boolean {
  return (scope || "").split(/\s+/).includes(DRIVE_SCOPE);
}

/**
 * Read-only Calendar scope for D148's "connect an additional Google account
 * to subscribe to its calendars" feature (Calendar tab only). Distinct from
 * CALENDAR_SCOPE above on purpose: that one is calendar.events (read/write)
 * granted on a mailbox's OWN Gmail connection so the app can WRITE site-visit
 * events and travel-time blocks to the signed-in user's primary calendar.
 * This feature only ever reads someone else's calendar to display it — it
 * never writes an event into an externally-connected account — so the
 * narrower calendar.readonly scope is requested instead, and the connection
 * this scope belongs to (calendarConnections) is independent of any mailbox:
 * it doesn't require GMAIL_ENABLED, only that Google OAuth creds exist
 * (googleConfigured() below), since it has nothing to do with mail.
 * Remember: the Google Cloud consent screen must also list this scope — see
 * DEPLOY.md.
 */
export const CALENDAR_READONLY_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
/** Needed by the calendar-only callback to identify the Google account that
 * authorized the read-only calendar grant. */
export const USERINFO_EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";

/** History-import depth on first connect (MASTER-QUESTIONS C3 — last 90 days). */
export const IMPORT_WINDOW_DAYS = 90;

/** Max NEW messages fetched per sync run during the one-time history import
 *  (#97). Gmail's per-user quota is 6,000 units/min and messages.get is 5
 *  units, so a run stays well inside it and inside the serverless duration
 *  cap; the next sync continues where this one stopped (dedup makes the
 *  restart cheap). */
export const IMPORT_BATCH_PER_RUN = 80;

/** Gmail's per-minute quota (403 rateLimitExceeded / 429) — retry on the
 *  next sync rather than failing the run. Also matches Gmail's other
 *  per-user throttle (403 userRateLimitExceeded / dailyLimitExceeded, and
 *  the human-readable "User-rate limit exceeded" phrase some error bodies
 *  carry instead of a `reason` field) — same "retry later" handling.
 *  Module-private in spirit (only bridge.ts's import loop uses it) but
 *  exported from this DB-free module so the pure test harness can exercise
 *  it without importing bridge.ts. */
export function isRateLimit(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return /\b(429|rateLimitExceeded|RATE_LIMIT_EXCEEDED|Quota exceeded|userRateLimitExceeded|dailyLimitExceeded|User-rate limit exceeded)\b/i.test(
    m
  );
}

/** #97 — a single sync run keeps pulling import chunks while it has time and
 *  quota headroom: 40 s stays inside the 60 s route cap, and 8 chunks × 80
 *  messages × 5 units = 3,200 units, about half the per-minute quota. */
export const IMPORT_RUN_BUDGET_MS = 40_000;
export const IMPORT_MAX_CHUNKS_PER_RUN = 8;

/** How stale a mailbox may get before a background sync actually runs (D73/
 *  D74). Shared by every automatic trigger — the inbox client tick, the
 *  server boot timer, and the /api/gmail/sync cron route — all of which funnel
 *  into the same atomic per-mailbox claims, so overlapping triggers are cheap. */
export const AUTO_SYNC_MIN_AGE_MS = 2 * 60_000;

/** Google OAuth / API endpoints. */
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
export const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

/** The four connectable mailboxes map to a stable connection key. Personal
 *  boxes are per-user (`personal:<userId>`); shared boxes use their id. */
export type MailboxKey = string; // "personal:u1" | "sales" | "installs" | "info"

export function personalKey(userId: string): MailboxKey {
  return "personal:" + userId;
}

export function isPersonalKey(key: MailboxKey): boolean {
  return key.startsWith("personal:");
}

export function userIdOfKey(key: MailboxKey): string | null {
  return isPersonalKey(key) ? key.slice("personal:".length) : null;
}

/** Shared mailboxes were retired (see comms.ts SHARED_BOXES). Kept as an empty
 *  list so the connect route and Settings keep compiling — and so no shared
 *  box can be authorized any more. */
export const SHARED_KEYS: readonly string[] = [];

/** Google sign-in credentials present (shared with Auth.js). */
export function googleConfigured(): boolean {
  return !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
}

/** The master env gate — true only when Gmail is fully wired AND opted-in. */
export function gmailEnabled(): boolean {
  return googleConfigured() && process.env.GMAIL_ENABLED === "true";
}

/** OAuth client id/secret (reused from the Auth.js Google provider). */
export function googleClientId(): string {
  return process.env.AUTH_GOOGLE_ID || "";
}
export function googleClientSecret(): string {
  return process.env.AUTH_GOOGLE_SECRET || "";
}

/**
 * Absolute redirect URI for the Gmail connect callback. Derived from AUTH_URL
 * (Vercel/host sets it) or NEXTAUTH_URL, else localhost for dev. Must be added
 * verbatim to the Google Cloud OAuth client's Authorized redirect URIs
 * (DEPLOY.md §5).
 */
export function callbackUrl(): string {
  const base =
    process.env.GMAIL_REDIRECT_BASE ||
    process.env.AUTH_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000";
  return base.replace(/\/+$/, "") + "/api/gmail/callback";
}

/**
 * #95: a stale GMAIL_REDIRECT_BASE (set before a domain rename, or just a
 * http/https mismatch) sends Google's auth code to an origin that has no
 * session cookie, and the connect silently never saves. Compares the full
 * origin (scheme + host), not just the host — a host-only compare misses a
 * http:// vs https:// drift, which gives no warning here but a Google
 * `redirect_uri_mismatch` at connect time. Surface it in Settings instead of
 * letting it hide.
 */
export function redirectHostMismatch(
  env: { GMAIL_REDIRECT_BASE?: string; AUTH_URL?: string; NEXTAUTH_URL?: string } = process.env as {
    GMAIL_REDIRECT_BASE?: string;
    AUTH_URL?: string;
    NEXTAUTH_URL?: string;
  }
): string | null {
  const override = env.GMAIL_REDIRECT_BASE;
  const authBase = env.AUTH_URL || env.NEXTAUTH_URL;
  if (!override || !authBase) return null;
  try {
    const a = new URL(override).origin;
    const b = new URL(authBase).origin;
    if (a === b) return null;
    return (
      "GMAIL_REDIRECT_BASE points at " + a + " but the app runs at " + b +
      " — Google will send the sign-in back to the wrong origin and the mailbox won't connect. " +
      "Remove GMAIL_REDIRECT_BASE (or set it to the app's URL) and redeploy."
    );
  } catch {
    return null;
  }
}

/* ---- #96 — sender domains ---------------------------------------------- */

/** Webmail/ISP domains that can never identify a customer. */
export const PUBLIC_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "outlook.com", "hotmail.com",
  "live.com", "msn.com", "icloud.com", "me.com", "mac.com", "aol.com", "comcast.net",
  "att.net", "sbcglobal.net", "verizon.net", "charter.net", "protonmail.com", "proton.me",
  "mail.com", "zoho.com", "gmx.com", "yandex.com",
]);

export function domainOf(email: string): string {
  const s = (email || "").trim().toLowerCase();
  const i = s.lastIndexOf("@");
  return i < 0 ? "" : s.slice(i + 1);
}

export function isPublicDomain(domain: string): boolean {
  return PUBLIC_EMAIL_DOMAINS.has((domain || "").toLowerCase());
}
