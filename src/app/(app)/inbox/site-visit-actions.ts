"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { buildIcs } from "@/lib/ics";
import { gmailEnabled } from "@/lib/gmail/config";
import { invitesOn } from "@/lib/stores/notif-prefs";
import { createVisit } from "@/lib/stores/site-visits";
import { stampInvite } from "@/lib/stores/site-visits";
import { update as updateThread } from "@/lib/stores/comms";
import { allUsers } from "@/lib/users";

/**
 * Schedule a site visit from an inbox thread (D76 / PUNCHLIST #2 phase 1).
 * Creates the visit record, then emails the assignee an .ics invite from the
 * scheduler's connected mailbox (decisions B/E — the customer is never
 * emailed; recipient is the assignee only, honoring their Account toggle).
 * The visit is always created even when the invite can't be sent — the
 * returned inviteStatus says what happened.
 */

export type CreateSiteVisitInput = {
  /** thread to adopt the customer onto first (D76-G), when not yet linked */
  adoptThreadId?: string | null;
  customerId: string;
  customer: string;
  locationId: string | null;
  venue: string;
  address: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  reason: string;
  startAt: number;
  endAt: number;
  notes: string;
  assignedTo: string; // team-member name
};

export type InviteStatus =
  | "sent"
  | "invites-off"
  | "gmail-off"
  | "no-mailbox"
  | "no-email"
  | "failed";

export async function createSiteVisitAction(
  input: CreateSiteVisitInput
): Promise<
  | { ok: true; id: string; inviteStatus: InviteStatus }
  | { ok: false; error: string }
> {
  const me = await requireUser();
  if (!input.customerId) return { ok: false, error: "No customer linked" };
  if (!input.reason) return { ok: false, error: "Pick a reason" };
  if (!(input.startAt > 0) || !(input.endAt > input.startAt))
    return { ok: false, error: "Bad time range" };

  // D76-G: scheduling from an unlinked thread adopts the resolved customer
  // onto the thread first, same as the record pickers do.
  if (input.adoptThreadId) {
    await updateThread(input.adoptThreadId, {
      customerId: input.customerId,
      customer: input.customer,
    });
  }

  const assignee =
    (await allUsers()).find((u) => u.name === input.assignedTo) || null;
  const rec = await createVisit({
    customerId: input.customerId,
    customer: input.customer,
    locationId: input.locationId,
    venue: input.venue,
    address: input.address,
    contactName: input.contactName,
    contactEmail: input.contactEmail,
    contactPhone: input.contactPhone,
    reason: input.reason,
    startAt: input.startAt,
    endAt: input.endAt,
    notes: input.notes,
    assignedTo: input.assignedTo,
    createdBy: me.name,
  });

  let inviteStatus: InviteStatus;
  const toAddr = assignee?.email || "";
  if (!gmailEnabled()) inviteStatus = "gmail-off";
  else if (!toAddr) inviteStatus = "no-email";
  else if (!(await invitesOn(input.assignedTo))) inviteStatus = "invites-off";
  else {
    // Event title = venue + reason (the punch-list formatter).
    const title = `${input.venue || input.customer} — ${input.reason}`;
    const body = [
      `Site visit: ${input.reason}`,
      `Customer: ${input.customer}`,
      input.venue ? `Venue: ${input.venue}` : "",
      input.address ? `Address: ${input.address}` : "",
      input.contactName
        ? `Contact: ${input.contactName}` +
          (input.contactPhone ? ` · ${input.contactPhone}` : "") +
          (input.contactEmail ? ` · ${input.contactEmail}` : "")
        : "",
      input.notes ? `Notes: ${input.notes}` : "",
      `Scheduled by ${me.name} in Peak (${rec.id}).`,
    ]
      .filter(Boolean)
      .join("\n");
    const ics = buildIcs({
      uid: "sv-" + rec.id + "@peak-app",
      title,
      description: body,
      location: input.address || [input.venue, input.customer].filter(Boolean).join(", "),
      start: input.startAt,
      end: input.endAt,
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
        inviteStatus = "sent";
      } else inviteStatus = "no-mailbox";
    } catch (err) {
      console.error("[site-visit] invite send failed:", err);
      inviteStatus = "failed";
    }
  }

  revalidatePath("/", "layout");
  return { ok: true, id: rec.id, inviteStatus };
}
