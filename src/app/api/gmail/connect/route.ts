import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { getUser } from "@/lib/users";
import { can } from "@/lib/team";
import {
  CALENDAR_READONLY_SCOPE,
  CALENDAR_SCOPE,
  TASKS_SCOPE,
  gmailEnabled,
  googleConfigured,
  SHARED_KEYS,
  isPersonalKey,
  userIdOfKey,
} from "@/lib/gmail/config";
import { authorizeUrl, signCalendarConnectState, signState } from "@/lib/gmail/oauth";

/**
 * GET /api/gmail/connect?mailbox=<key>
 * Kicks off the Gmail OAuth consent for a mailbox. A person may connect their
 * OWN personal box; connecting a shared box (sales/installs/info) requires the
 * manage_users permission (admin). Redirects to Google's consent screen with a
 * signed state carrying the mailbox key.
 *
 * D148: this same route also starts the CALENDAR-ONLY connect flow (an
 * additional Google account, subscribed to from the Calendar tab, with no
 * Gmail/mail semantics) when called as ?purpose=calendar-connect — see
 * startCalendarConnect below. Folded into this route rather than a new one
 * so the whole feature needs no new redirect URI registered in Google Cloud
 * Console; only its distinct scope needs adding to the consent screen (see
 * DEPLOY.md).
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const settings = new URL("/settings", origin);

  if (req.nextUrl.searchParams.get("purpose") === "calendar-connect") {
    return startCalendarConnect(req, origin);
  }

  if (!gmailEnabled()) {
    settings.searchParams.set("gmail", "disabled");
    return NextResponse.redirect(settings);
  }

  const session = await auth();
  const uid = session?.user?.id;
  if (!uid) return NextResponse.redirect(new URL("/login", origin));
  const me = await getUser(uid);
  if (!me || me.status !== "active") return NextResponse.redirect(new URL("/login", origin));

  const mailboxKey = (req.nextUrl.searchParams.get("mailbox") || "").trim();
  const shared = (SHARED_KEYS as readonly string[]).includes(mailboxKey);
  const personal = isPersonalKey(mailboxKey);
  if (!shared && !personal) {
    settings.searchParams.set("gmail", "badmailbox");
    return NextResponse.redirect(settings);
  }
  // authorization: own personal box, or admin for shared / others' boxes
  const ownsPersonal = personal && userIdOfKey(mailboxKey) === me.id;
  if (!ownsPersonal && !can("manage_users", me.roles)) {
    settings.searchParams.set("gmail", "forbidden");
    return NextResponse.redirect(settings);
  }

  const state = signState({ mailboxKey, userId: me.id });
  const hint = ownsPersonal ? me.email : undefined;
  // ?calendar=1 (D77) / ?tasks=1 (D146) — Settings' "Enable calendar" /
  // "Enable Google Tasks sync" opt-ins: same consent flow, the extra scope(s)
  // appended. Both may be present at once (e.g. a second opt-in after the
  // first is already granted); include_granted_scopes keeps every scope the
  // mailbox already has (Gmail, and whichever of Calendar/Tasks was granted
  // earlier) even though only the newly-requested one is listed here.
  const extraScopes: string[] = [];
  if (req.nextUrl.searchParams.get("calendar") === "1") extraScopes.push(CALENDAR_SCOPE);
  if (req.nextUrl.searchParams.get("tasks") === "1") extraScopes.push(TASKS_SCOPE);
  return NextResponse.redirect(authorizeUrl(state, hint, extraScopes));
}

/**
 * D148 — connect an ADDITIONAL Google account purely to subscribe to its
 * calendars from the Calendar tab. Distinct gate from the mailbox flow
 * above: only needs Google OAuth creds (the same client Auth.js sign-in and
 * the Gmail bridge both use), not GMAIL_ENABLED — this feature has nothing
 * to do with mail and works even on a deployment that never turns Gmail on.
 * No login_hint, and no reuse of the signed-in user's own email: the whole
 * point is letting the user pick ANY Google account on Google's own consent
 * screen (their personal Gmail, a family calendar account, ...), not their
 * existing Peak login.
 */
async function startCalendarConnect(req: NextRequest, origin: string): Promise<NextResponse> {
  const calendarPage = new URL("/calendar", origin);
  if (!googleConfigured()) {
    calendarPage.searchParams.set("calconnect", "disabled");
    return NextResponse.redirect(calendarPage);
  }
  const session = await auth();
  const uid = session?.user?.id;
  if (!uid) return NextResponse.redirect(new URL("/login", origin));
  const me = await getUser(uid);
  if (!me || me.status !== "active") return NextResponse.redirect(new URL("/login", origin));

  const state = signCalendarConnectState({ userId: me.id });
  return NextResponse.redirect(
    authorizeUrl(state, undefined, [], [CALENDAR_READONLY_SCOPE])
  );
}
