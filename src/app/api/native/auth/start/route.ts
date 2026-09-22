import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { googleConfigured, signIn } from "@/auth";
import { safeCallbackPath } from "@/lib/auth-redirect";
import { isChallenge } from "@/lib/native-auth";

/**
 * Name of the short-lived cookie binding a handoff request to this start
 * call (finding B). Kept as a plain literal (not exported) rather than a
 * shared import: route.ts files should only export HTTP method handlers and
 * the documented segment config, so `handoff/route.ts` defines its own copy
 * of this same literal.
 */
const CHALLENGE_COOKIE = "qz_native_challenge";

/**
 * GET /api/native/auth/start?next=&challenge=
 * Opened by the Capacitor shell in an in-app Safari sheet. Kicks off the
 * normal Auth.js Google sign-in with the hand-off route as the destination,
 * so state/PKCE/session cookies all live in the sheet's cookie jar.
 *
 * The `error=native` query on the /login redirects below is a diagnostic
 * breadcrumb only — the login page does not render it.
 * Spec: docs/superpowers/specs/2026-09-21-native-auth-handoff-design.md
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const challenge = req.nextUrl.searchParams.get("challenge");
  if (!isChallenge(challenge) || !googleConfigured()) {
    return NextResponse.redirect(new URL("/login?error=native", origin));
  }
  const next = safeCallbackPath(req.nextUrl.searchParams.get("next") ?? undefined, origin);
  const handoff = new URL("/api/native/auth/handoff", origin);
  handoff.searchParams.set("next", next);
  handoff.searchParams.set("challenge", challenge);
  // Bind the eventual handoff to THIS flow: a drive-by link straight to
  // /api/native/auth/handoff?challenge=<attacker's> would otherwise mint a
  // code over the visitor's own session. Auth.js's own signIn() below sets
  // its cookies through this same cookies() store and they ride the redirect
  // to Google and back, so this one does too.
  const jar = await cookies();
  jar.set(CHALLENGE_COOKIE, challenge, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 300,
  });
  // signIn sets the Auth.js cookies via cookies() and throws Next's redirect
  // to Google; both are supported inside a Route Handler.
  await signIn("google", { redirectTo: handoff.pathname + handoff.search });
}
