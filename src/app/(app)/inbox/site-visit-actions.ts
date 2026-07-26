"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { createVisit } from "@/lib/stores/site-visits";
import { update as updateThread } from "@/lib/stores/comms";
import { dispatchVisitInvite } from "@/lib/visit-invite";

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
  /** Optional consulting-engagement link (D90). */
  engagementId?: string | null;
};

export type { InviteStatus } from "@/lib/visit-invite";
import type { InviteStatus } from "@/lib/visit-invite";

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
    engagementId: input.engagementId || null,
    stage: "scheduled",
    leadId: null,
    surveyId: null,
    preferredTiming: "",
  });

  const inviteStatus: InviteStatus = await dispatchVisitInvite(rec, {
    id: me.id,
    name: me.name,
  });

  revalidatePath("/", "layout");
  return { ok: true, id: rec.id, inviteStatus };
}
