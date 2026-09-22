import { NextResponse, type NextRequest } from "next/server";
import { googleConfigured, signIn } from "@/auth";
import { safeCallbackPath } from "@/lib/auth-redirect";
import { isChallenge } from "@/lib/native-auth";

/**
 * GET /api/native/auth/start?next=&challenge=
 * Opened by the Capacitor shell in an in-app Safari sheet. Kicks off the
 * normal Auth.js Google sign-in with the hand-off route as the destination,
 * so state/PKCE/session cookies all live in the sheet's cookie jar.
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
  // signIn sets the Auth.js cookies via cookies() and throws Next's redirect
  // to Google; both are supported inside a Route Handler.
  await signIn("google", { redirectTo: handoff.pathname + handoff.search });
}
