import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { getUser } from "@/lib/users";
import { can } from "@/lib/team";
import { gmailEnabled, isPersonalKey, userIdOfKey } from "@/lib/gmail/config";
import {
  exchangeCode,
  fetchAccountEmail,
  verifyCalendarConnectState,
  verifyState,
} from "@/lib/gmail/oauth";
import { saveConnection } from "@/lib/gmail/connections";

/**
 * GET /api/gmail/callback?code=&state=
 * Completes the OAuth handshake: verifies the signed state, exchanges the code
 * for tokens, learns the authorized address, and stores the connection. The
 * 90-day history import runs lazily on the next "Get mail" (checkMail → the
 * bridge), so the callback stays fast.
 *
 * D148: this route also completes the CALENDAR-ONLY connect flow (see
 * connect/route.ts's startCalendarConnect) — the state's `purpose` field
 * tells the two apart (see verifyCalendarConnectState's doc comment for why
 * that check has to be a runtime one, not just a TypeScript cast). Checked
 * FIRST so a calendar-connect callback never falls into the mailbox path
 * below, which requires GMAIL_ENABLED and a mailboxKey neither of which a
 * calendar-only connect has.
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const settings = new URL("/settings", origin);

  const calState = verifyCalendarConnectState(req.nextUrl.searchParams.get("state") || "");
  if (calState) return finishCalendarConnect(req, origin, calState);

  if (!gmailEnabled()) {
    settings.searchParams.set("gmail", "disabled");
    return NextResponse.redirect(settings);
  }

  const session = await auth();
  const uid = session?.user?.id;
  if (!uid) return NextResponse.redirect(new URL("/login", origin));
  const me = await getUser(uid);
  if (!me || me.status !== "active") return NextResponse.redirect(new URL("/login", origin));

  // Teammates without the admin Settings page land on their own Account page
  // instead of the admin-lock card (C7 — self-serve mailbox connect).
  const dest = can("manage_users", me.roles)
    ? settings
    : new URL("/account", origin);

  const sp = req.nextUrl.searchParams;
  const error = sp.get("error");
  if (error) {
    dest.searchParams.set("gmail", "denied");
    return NextResponse.redirect(dest);
  }

  const code = sp.get("code") || "";
  const state = verifyState(sp.get("state") || "");
  if (!code || !state) {
    dest.searchParams.set("gmail", "badstate");
    return NextResponse.redirect(dest);
  }
  // the connect-flow initiator must match the current session (anti-CSRF)
  if (state.userId !== me.id) {
    dest.searchParams.set("gmail", "badstate");
    return NextResponse.redirect(dest);
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
    dest.searchParams.set("gmail", "connected");
    dest.searchParams.set("mailbox", key);
  } catch (err) {
    console.error("[gmail] callback failed:", err);
    dest.searchParams.set("gmail", "error");
  }
  return NextResponse.redirect(dest);
}

/**
 * D148 — completes the calendar-only connect: exchange the code, learn which
 * Google account authorized, discover its calendars (calendarList.list), and
 * store a new calendarConnections row. Always lands back on /calendar (the
 * feature's only surface) — never /settings, since this has nothing to do
 * with the admin Settings page's mailbox management.
 */
async function finishCalendarConnect(
  req: NextRequest,
  origin: string,
  calState: { userId: string }
): Promise<NextResponse> {
  const dest = new URL("/calendar", origin);

  const session = await auth();
  const uid = session?.user?.id;
  if (!uid) return NextResponse.redirect(new URL("/login", origin));
  const me = await getUser(uid);
  if (!me || me.status !== "active") return NextResponse.redirect(new URL("/login", origin));
  // the connect-flow initiator must match the current session (anti-CSRF) —
  // same check the mailbox flow above does with its own state shape.
  if (calState.userId !== me.id) {
    dest.searchParams.set("calconnect", "badstate");
    return NextResponse.redirect(dest);
  }

  const sp = req.nextUrl.searchParams;
  const error = sp.get("error");
  if (error) {
    dest.searchParams.set("calconnect", "denied");
    return NextResponse.redirect(dest);
  }
  const code = sp.get("code") || "";
  if (!code) {
    dest.searchParams.set("calconnect", "badstate");
    return NextResponse.redirect(dest);
  }

  try {
    const tokens = await exchangeCode(code);
    const [googleEmail, { listCalendarsWithAccessToken }, { createConnection }] = await Promise.all([
      fetchAccountEmail(tokens.accessToken),
      import("@/lib/google/calendar"),
      import("@/lib/google/calendar-connections"),
    ]);
    // Discover the account's calendars with the token in hand BEFORE
    // creating the row, so this is a single insert (not insert-then-update)
    // and createConnection can apply its default-visibility rule (primary
    // calendar on, everything else off) in one place.
    const discovered = await listCalendarsWithAccessToken(tokens.accessToken);
    await createConnection({ userId: me.id, googleEmail, tokens, discovered });
    dest.searchParams.set("calconnect", "connected");
  } catch (err) {
    console.error("[calendar-connect] callback failed:", err);
    dest.searchParams.set("calconnect", "error");
  }
  return NextResponse.redirect(dest);
}
