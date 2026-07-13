import { NextRequest, NextResponse } from "next/server";
import { grantByToken, PORTAL_COOKIE } from "@/lib/portal";

/**
 * Magic-link landing (IDEAS #47): /portal/access?t=<token> validates the
 * grant and plants the httpOnly portal cookie, then hands off to /portal.
 * Invalid or revoked tokens land on the portal's signed-out state — no
 * information about whether the token ever existed.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t") || "";
  const grant = await grantByToken(token);
  const dest = new URL(grant ? "/portal" : "/portal?denied=1", req.nextUrl.origin);
  const res = NextResponse.redirect(dest);
  if (grant) {
    res.cookies.set(PORTAL_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/portal",
      maxAge: 60 * 60 * 24 * 180, // 6 months; revoke any time from the customer record
    });
  } else {
    res.cookies.delete(PORTAL_COOKIE);
  }
  return res;
}
