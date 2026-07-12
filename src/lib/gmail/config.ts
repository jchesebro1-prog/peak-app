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
 *  - userinfo.email → learn which address just authorized (the mailbox addr) */
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

/** History-import depth on first connect (MASTER-QUESTIONS C3 ✦ last 90 days). */
export const IMPORT_WINDOW_DAYS = 90;

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

export const SHARED_KEYS = ["sales", "installs", "info"] as const;

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
