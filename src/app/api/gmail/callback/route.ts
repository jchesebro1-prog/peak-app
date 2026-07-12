import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { getUser } from "@/lib/users";
import { gmailEnabled, isPersonalKey, userIdOfKey } from "@/lib/gmail/config";
import { exchangeCode, fetchAccountEmail, verifyState } from "@/lib/gmail/oauth";
import { saveConnection } from "@/lib/gmail/connections";

/**
 * GET /api/gmail/callback?code=&state=
 * Completes the OAuth handshake: verifies the signed state, exchanges the code
 * for tokens, learns the authorized address, and stores the connection. The
 * 90-day history import runs lazily on the next "Get mail" (checkMail → the
 * bridge), so the callback stays fast.
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const settings = new URL("/settings", origin);

  if (!gmailEnabled()) {
    settings.searchParams.set("gmail", "disabled");
    return NextResponse.redirect(settings);
  }

  const session = await auth();
  const uid = session?.user?.id;
  if (!uid) return NextResponse.redirect(new URL("/login", origin));
  const me = await getUser(uid);
  if (!me || !me.active) return NextResponse.redirect(new URL("/login", origin));

  const sp = req.nextUrl.searchParams;
  const error = sp.get("error");
  if (error) {
    settings.searchParams.set("gmail", "denied");
    return NextResponse.redirect(settings);
  }

  const code = sp.get("code") || "";
  const state = verifyState(sp.get("state") || "");
  if (!code || !state) {
    settings.searchParams.set("gmail", "badstate");
    return NextResponse.redirect(settings);
  }
  // the connect-flow initiator must match the current session (anti-CSRF)
  if (state.userId !== me.id) {
    settings.searchParams.set("gmail", "badstate");
    return NextResponse.redirect(settings);
  }

  try {
    const tokens = await exchangeCode(code);
    const address = await fetchAccountEmail(tokens.accessToken);
    const key = state.mailboxKey;
    await saveConnection({
      mailboxKey: key,
      address,
      userId: isPersonalKey(key) ? userIdOfKey(key) : null,
      connectedBy: me.name,
      tokens,
    });
    settings.searchParams.set("gmail", "connected");
    settings.searchParams.set("mailbox", key);
  } catch (err) {
    console.error("[gmail] callback failed:", err);
    settings.searchParams.set("gmail", "error");
  }
  return NextResponse.redirect(settings);
}
