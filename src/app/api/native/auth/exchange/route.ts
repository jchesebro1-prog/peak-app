import { NextResponse, type NextRequest } from "next/server";
import { redeemHandoffCode, SESSION_COOKIE_BASES } from "@/lib/native-auth";

const THIRTY_DAYS_S = 30 * 24 * 60 * 60; // Auth.js default session maxAge

function jsonNoStore(body: unknown, init?: { status?: number }) {
  const res = NextResponse.json(body, init);
  res.headers.set("cache-control", "no-store");
  return res;
}

/** The SESSION_COOKIE_BASES entry `name` belongs to (base cookie or a `.N` chunk), or null. */
function baseCookieName(name: string): string | null {
  for (const base of SESSION_COOKIE_BASES) {
    if (name === base || name.startsWith(base + ".")) return base;
  }
  return null;
}

/**
 * POST /api/native/auth/exchange  { code, verifier }
 * Called by the WebView after the quartzite://auth deep link. Redeems the
 * hand-off code and sets the very same Auth.js session cookie(s) here, so
 * the WebView is signed in exactly as the Safari sheet was.
 * Spec: docs/superpowers/specs/2026-09-21-native-auth-handoff-design.md
 */
export async function POST(req: NextRequest) {
  // Same-origin, JSON-only: req.json() ignores Content-Type, so without this
  // check a cross-site `enctype="text/plain"` form could reach this route and
  // set an attacker's session cookie in a victim's browser (login CSRF). The
  // WebView's own fetch() always sends both a JSON Content-Type and a
  // same-origin Origin header, so the real flow is unaffected.
  const contentType = req.headers.get("content-type") ?? "";
  const origin = req.headers.get("origin");
  if (!contentType.startsWith("application/json") || origin !== req.nextUrl.origin) {
    return jsonNoStore({ error: "malformed" }, { status: 400 });
  }
  let body: { code?: unknown; verifier?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonNoStore({ error: "malformed" }, { status: 400 });
  }
  const { code, verifier } = body ?? {};
  const secret = process.env.AUTH_SECRET;
  if (typeof code !== "string" || typeof verifier !== "string" || !secret) {
    return jsonNoStore({ error: "malformed" }, { status: 400 });
  }
  const result = redeemHandoffCode(code, verifier, secret);
  if (!result.ok) {
    return jsonNoStore({ error: result.reason }, { status: result.reason === "malformed" ? 400 : 401 });
  }
  const res = jsonNoStore({ next: result.next });
  for (const c of result.cookies) {
    res.cookies.set(c.name, c.value, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: c.name.startsWith("__Secure-"),
      maxAge: THIRTY_DAYS_S,
    });
  }
  // Clean up any stale cookie of the OTHER known shape (e.g. an http
  // `authjs.session-token` left over once the deployment moved to https and
  // started minting `__Secure-authjs.session-token`), mirroring Auth.js's own
  // chunk cleanup so the WebView's jar never carries two competing sessions.
  if (result.cookies.length > 0) {
    const base = baseCookieName(result.cookies[0].name);
    if (base) {
      const keep = new Set(result.cookies.map((c) => c.name));
      for (const c of req.cookies.getAll()) {
        if (baseCookieName(c.name) === base && !keep.has(c.name)) {
          res.cookies.set(c.name, "", { maxAge: 0, path: "/" });
        }
      }
    }
  }
  return res;
}

export function GET() {
  return jsonNoStore({ error: "method" }, { status: 405 });
}
