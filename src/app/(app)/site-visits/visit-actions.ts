"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { claimVisit, getVisit, releaseVisit, scheduleVisit } from "@/lib/stores/site-visits";
import { dispatchVisitInvite, type InviteStatus } from "@/lib/visit-invite";

/** Sales site-visit queue mutations. The same intake is surfaced from Leads
 * and Inbox; Venue Assessments consumes the survey created from a visit. */
export async function claimVisitAction(id: string) {
  const me = await requireUser();
  const v = await getVisit(id);
  if (!v || v.stage === "scheduled" || v.stage === "done") return { ok: false as const };
  await claimVisit(id, me.name);
  revalidatePath("/site-visits");
  revalidatePath("/venue-assessments");
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function releaseVisitAction(id: string) {
  await requireUser();
  const v = await getVisit(id);
  if (!v || v.stage === "scheduled" || v.stage === "done") return { ok: false as const };
  await releaseVisit(id);
  revalidatePath("/site-visits");
  revalidatePath("/venue-assessments");
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function scheduleVisitAction(
  id: string,
  input: { startAt: number; endAt: number }
): Promise<{ ok: true; inviteStatus: InviteStatus } | { ok: false; error: string }> {
  const me = await requireUser();
  if (!(input.startAt > 0) || !(input.endAt > input.startAt))
    return { ok: false, error: "Bad time range" };
  const v = await getVisit(id);
  if (!v) return { ok: false, error: "Visit not found" };
  if (v.stage === "done") return { ok: false, error: "Visit already completed" };
  if (!v.assignedTo) return { ok: false, error: "Claim the visit first" };
  await scheduleVisit(id, input.startAt, input.endAt);
  const fresh = await getVisit(id);
  const inviteStatus: InviteStatus = fresh
    ? await dispatchVisitInvite(fresh, { id: me.id, name: me.name })
    : "failed";
  revalidatePath("/site-visits");
  revalidatePath("/venue-assessments");
  revalidatePath("/", "layout");
  return { ok: true, inviteStatus };
}
