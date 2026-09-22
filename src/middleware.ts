import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

/**
 * Route protection: everything requires a session except the login page,
 * auth endpoints, and static assets. Data access is additionally enforced
 * server-side (see src/lib/session.ts) — middleware is the UX gate, not the
 * only gate. /portal has its OWN cookie auth (magic-link grants, IDEAS #47)
 * enforced inside every portal page/action via portalSession() — it is
 * exempted here so customers never see the team login. /api/gmail/sync is the
 * cron endpoint (D74) — no session exists on a cron call, so it is exempted
 * here and guards itself with a CRON_SECRET bearer check instead.
 * /api/native/auth/* (start, exchange) run before a session exists in the
 * WebView — see docs/superpowers/specs/2026-09-21-native-auth-handoff-design.md.
 * /api/recordings/upload is the Vercel Blob client-upload broker (Recordings
 * spec §2.3): Vercel's own infra POSTs the `upload-completed` callback there
 * with no session, so it is exempted and authenticates per-event itself —
 * `auth()` for the device's token request, the Blob signature for the
 * callback (see the route).
 */
export default NextAuth(authConfig).auth;

export const config = {
  matcher: [
    "/((?!api/auth|api/native/auth|api/leads/intake|api/gmail/sync|api/recordings/upload|login|lead-intake|portal|_next/static|_next/image|favicon\\.ico|manifest\\.webmanifest|icons|images).*)",
  ],
};
