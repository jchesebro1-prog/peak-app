import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { safeCallbackPath } from "@/lib/auth-redirect";
import { isChallenge, mintHandoffCode, pickSessionCookies } from "@/lib/native-auth";

export const dynamic = "force-dynamic";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * GET /api/native/auth/handoff?next=&challenge=
 * Runs in the Safari sheet after Google. With a live session it wraps the
 * Auth.js session cookie into a 60 s, challenge-bound code and serves a
 * minimal page that opens quartzite://auth?code=… (auto + button).
 * Never logs the code or the cookie. Spec: 2026-09-21-native-auth-handoff.
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const challenge = req.nextUrl.searchParams.get("challenge");
  if (!isChallenge(challenge)) {
    return NextResponse.redirect(new URL("/login?error=native", origin));
  }
  const session = await auth();
  if (!session?.user?.active) {
    const login = new URL("/login", origin);
    login.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(login);
  }
  const cookies = pickSessionCookies(req.cookies.getAll().map(({ name, value }) => ({ name, value })));
  const secret = process.env.AUTH_SECRET;
  if (cookies.length === 0 || !secret) {
    return NextResponse.redirect(new URL("/login?error=native", origin));
  }
  const next = safeCallbackPath(req.nextUrl.searchParams.get("next") ?? undefined, origin);
  const code = mintHandoffCode({ cookies, challenge, next }, secret);
  const target = "quartzite://auth?code=" + encodeURIComponent(code);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Return to Quartzite</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       font-family:-apple-system,system-ui,sans-serif;background:#0f1115;color:#e8eaee}
  main{text-align:center;padding:32px}
  a{display:inline-block;margin-top:18px;padding:14px 22px;border-radius:10px;
    background:#fff;color:#111;text-decoration:none;font-weight:600}
  p{color:#9aa0ab;font-size:14px}
</style></head>
<body><main>
  <div style="font-size:18px;font-weight:600">Signed in</div>
  <p>Returning you to the Quartzite app.</p>
  <a href="${escapeHtml(target)}">Return to Quartzite</a>
  <script>location.replace(${JSON.stringify(target)});</script>
</main></body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}
