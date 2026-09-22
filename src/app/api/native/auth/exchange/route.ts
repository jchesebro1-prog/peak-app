import { NextResponse, type NextRequest } from "next/server";
import { redeemHandoffCode } from "@/lib/native-auth";

const THIRTY_DAYS_S = 30 * 24 * 60 * 60; // Auth.js default session maxAge

/**
 * POST /api/native/auth/exchange  { code, verifier }
 * Called by the WebView after the quartzite://auth deep link. Redeems the
 * hand-off code and sets the very same Auth.js session cookie(s) here, so
 * the WebView is signed in exactly as the Safari sheet was.
 * Spec: docs/superpowers/specs/2026-09-21-native-auth-handoff-design.md
 */
export async function POST(req: NextRequest) {
  let body: { code?: unknown; verifier?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "malformed" }, { status: 400 });
  }
  const { code, verifier } = body ?? {};
  const secret = process.env.AUTH_SECRET;
  if (typeof code !== "string" || typeof verifier !== "string" || !secret) {
    return NextResponse.json({ error: "malformed" }, { status: 400 });
  }
  const result = redeemHandoffCode(code, verifier, secret);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason },
      { status: result.reason === "malformed" ? 400 : 401 }
    );
  }
  const res = NextResponse.json({ next: result.next });
  for (const c of result.cookies) {
    res.cookies.set(c.name, c.value, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: c.name.startsWith("__Secure-"),
      maxAge: THIRTY_DAYS_S,
    });
  }
  return res;
}

export function GET() {
  return NextResponse.json({ error: "method" }, { status: 405 });
}
