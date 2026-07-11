import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

/**
 * Route protection: everything requires a session except the login page,
 * auth endpoints, and static assets. Data access is additionally enforced
 * server-side (see src/lib/session.ts) — middleware is the UX gate, not the
 * only gate.
 */
export default NextAuth(authConfig).auth;

export const config = {
  matcher: [
    "/((?!api/auth|login|_next/static|_next/image|favicon\\.ico|manifest\\.webmanifest|icons|images).*)",
  ],
};
