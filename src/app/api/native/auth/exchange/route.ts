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
  const secFetchSite = req.headers.get("sec-fetch-site");
  // Some same-origin requests (e.g. a WebView fetch with third-party cookie
  // restrictions in play) omit Origin entirely; accept those only when
  // sec-fetch-site confirms same-origin. Origin present but mismatched, or
  // Origin absent with sec-fetch-site anything else, is rejected.
  const originOk =
    origin !== null ? origin === req.nextUrl.origin : secFetchSite === "same-origin";
  if (!contentType.startsWith("application/json") || !originOk) {
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
  // Clean up any stale cookie within the SAME cookie family that isn't one of
  // the ones we just set (e.g. a leftover chunked `authjs.session-token.0`
  // once the session shrank back under the chunking threshold), mirroring
  // Auth.js's own chunk cleanup so the WebView's jar never carries two
  // competing cookies for the same base name.
  if (result.cookies.length > 0) {
    const base = baseCookieName(result.cookies[0].name);
    if (base) {
      const keep = new Set(result.cookies.map((c) => c.name));
      for (const c of req.cookies.getAll()) {
        if (baseCookieName(c.name) === base && !keep.has(c.name)) {
          res.cookies.set(c.name, "", {
            maxAge: 0,
            path: "/",
            httpOnly: true,
            sameSite: "lax",
            secure: c.name.startsWith("__Secure-"),
          });
        }
      }
    }
  }
  return res;
}

export function GET() {
  return jsonNoStore({ error: "method" }, { status: 405 });
}
