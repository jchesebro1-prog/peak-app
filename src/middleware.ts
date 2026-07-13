import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

/**
 * Route protection: everything requires a session except the login page,
 * auth endpoints, and static assets. Data access is additionally enforced
 * server-side (see src/lib/session.ts) — middleware is the UX gate, not the
 * only gate. /portal has its OWN cookie auth (magic-link grants, IDEAS #47)
 * enforced inside every portal page/action via portalSession() — it is
 * exempted here so customers never see the team login.
 */
export default NextAuth(authConfig).auth;

export const config = {
  matcher: [
    "/((?!api/auth|api/leads/intake|login|lead-intake|portal|_next/static|_next/image|favicon\\.ico|manifest\\.webmanifest|icons|images).*)",
  ],
};
