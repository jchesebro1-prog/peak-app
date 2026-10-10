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

type VisitEventWrite = { title: string; startMs: number; endMs: number; description?: string; location?: string; status?: "confirmed" };
export type VisitCalendarApi = {
  insertEvent(key: string, ev: VisitEventWrite): Promise<{ id: string }>;
  updateEvent(key: string, id: string, ev: VisitEventWrite): Promise<{ id: string; status?: string }>;
  deleteEvent(key: string, id: string): Promise<void>;
};

/**
 * The visit's Google copy. A visit that already has one (a reschedule)
 * updates it in place — inserting a second copy would leave the old one
 * behind as a ghost stop that the drive sync then routes to. The update
 * sends status "confirmed" (a rep-deleted copy comes back); if it fails or
 * answers with any other status (deleted in Google, or on another calendar), the old copy is removed
 * (best effort) before a fresh insert. Throws only if the insert fails.
 */
export async function writeVisitCalendarEvent(
  key: string,
  existingId: string | null | undefined,
  ev: VisitEventWrite,
  cal: VisitCalendarApi
): Promise<{ id: string }> {
  if (existingId) {
    try {
      // status "confirmed": a copy the rep deleted in Google is only
      // cancelled there, and a PATCH without it would "update" an invisible
      // event. Anything but a confirmed answer falls through to a fresh insert.
      const r = await cal.updateEvent(key, existingId, { ...ev, status: "confirmed" });
      if (r.status === "confirmed") return { id: r.id || existingId };
      throw new Error("event status after update: " + (r.status ?? "none"));
    } catch (err) {
      console.error("[site-visit] calendar update failed — replacing the event:", err);
      try {
        await cal.deleteEvent(key, existingId);
      } catch (e) {
        console.error("[site-visit] old calendar event not removed:", e);
      }
    }
  }
  const r = await cal.insertEvent(key, ev);
  return { id: r.id };
}

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
        const { insertEvent, updateEvent, deleteEvent } = await import("@/lib/google/calendar");
        const ev = await writeVisitCalendarEvent(akey, rec.googleEventId, {
          title,
          startMs: rec.startAt,
          endMs: rec.endAt,
          description: body,
          location,
        }, { insertEvent, updateEvent, deleteEvent });
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
