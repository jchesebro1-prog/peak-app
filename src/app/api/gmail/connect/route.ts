import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { getUser } from "@/lib/users";
import { can } from "@/lib/team";
import { gmailEnabled, SHARED_KEYS, isPersonalKey, userIdOfKey } from "@/lib/gmail/config";
import { authorizeUrl, signState } from "@/lib/gmail/oauth";

/**
 * GET /api/gmail/connect?mailbox=<key>
 * Kicks off the Gmail OAuth consent for a mailbox. A person may connect their
 * OWN personal box; connecting a shared box (sales/installs/info) requires the
 * manage_users permission (admin). Redirects to Google's consent screen with a
 * signed state carrying the mailbox key.
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
  return NextResponse.redirect(authorizeUrl(state, hint));
}
