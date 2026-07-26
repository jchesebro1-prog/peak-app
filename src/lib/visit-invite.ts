import { buildIcs } from "@/lib/ics";
import { gmailEnabled, hasCalendarScope, personalKey } from "@/lib/gmail/config";
import { getConnectionInfo } from "@/lib/gmail/connections";
import { invitesOn } from "@/lib/stores/notif-prefs";
import { stampGoogleEvent, stampInvite, type SiteVisit } from "@/lib/stores/site-visits";
import { allUsers } from "@/lib/users";

/**
 * D77 invite/calendar dispatch for a SCHEDULED site visit — extracted
 * verbatim from createSiteVisitAction (#34) so the inbox creator and the
 * lead-thread scheduler (scheduleVisitAction) share one path. The recipient
 * is the ASSIGNEE (never the customer — D76 decisions B/E), honoring their
 * Account invite toggle. Behavior-preserving: same statuses, same stamps,
 * same "visit exists even when the invite fails" guarantee (never throws).
 */

export type InviteStatus =
  | "calendar" // D77 — event written straight to the assignee's Google Calendar
  | "sent"
  | "invites-off"
  | "gmail-off"
  | "no-mailbox"
  | "no-email"
  | "failed";

export async function dispatchVisitInvite(
  rec: SiteVisit,
  me: { id: string; name: string }
): Promise<InviteStatus> {
  if (rec.startAt == null || rec.endAt == null) return "failed";
  const assignee = (await allUsers()).find((u) => u.name === rec.assignedTo) || null;
  const toAddr = assignee?.email || "";
  if (!gmailEnabled()) return "gmail-off";
  if (!toAddr) return "no-email";
  if (!(await invitesOn(rec.assignedTo))) return "invites-off";

  // Event title = venue + reason (the punch-list formatter).
  const title = `${rec.venue || rec.customer} — ${rec.reason}`;
  const body = [
    `Site visit: ${rec.reason}`,
    `Customer: ${rec.customer}`,
    rec.venue ? `Venue: ${rec.venue}` : "",
    rec.address ? `Address: ${rec.address}` : "",
    rec.contactName
      ? `Contact: ${rec.contactName}` +
        (rec.contactPhone ? ` · ${rec.contactPhone}` : "") +
        (rec.contactEmail ? ` · ${rec.contactEmail}` : "")
      : "",
    rec.notes ? `Notes: ${rec.notes}` : "",
    `Scheduled by ${me.name} in Peak (${rec.id}).`,
  ]
    .filter(Boolean)
    .join("\n");
  const location = rec.address || [rec.venue, rec.customer].filter(Boolean).join(", ");

  // D77 — when the assignee's own mailbox has the Calendar grant, write the
  // event straight onto their primary calendar: it just appears, no email
  // step. Falls back to the .ics email otherwise (or if the write fails).
  if (assignee) {
    const akey = personalKey(assignee.id);
    const info = await getConnectionInfo(akey);
    if (info && hasCalendarScope(info.scope)) {
      try {
        const { insertEvent } = await import("@/lib/google/calendar");
        const ev = await insertEvent(akey, {
          title,
          startMs: rec.startAt,
          endMs: rec.endAt,
          description: body,
          location,
        });
        await stampGoogleEvent(rec.id, ev.id);
        return "calendar";
      } catch (err) {
        console.error("[site-visit] calendar write failed:", err);
      }
    }
  }

  const ics = buildIcs({
    uid: "sv-" + rec.id + "@peak-app",
    title,
    description: body,
    location,
    start: rec.startAt,
    end: rec.endAt,
    stampAt: Date.now(),
  });
  try {
    const { sendSiteVisitInvite } = await import("@/lib/gmail/bridge");
    const sent = await sendSiteVisitInvite({
      siteVisitId: rec.id,
      schedulerUserId: me.id,
      toAddr,
      subject: title,
      body,
      icsText: ics,
    });
    if (sent) {
      await stampInvite(rec.id, {
        sentAt: Date.now(),
        to: toAddr,
        fromMailbox: sent.fromMailbox,
        gmailId: sent.gmailId,
        gmailThreadId: sent.gmailThreadId,
      });
      return "sent";
    }
    return "no-mailbox";
  } catch (err) {
    console.error("[site-visit] invite send failed:", err);
    return "failed";
  }
}
