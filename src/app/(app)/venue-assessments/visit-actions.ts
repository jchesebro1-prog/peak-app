"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireUser } from "@/lib/session";
import { activeUsers } from "@/lib/users";
import { cleanAttendees } from "@/lib/visit-plan/people";
import { claimVisit, getVisit, releaseVisit, removeVisit, scheduleVisit } from "@/lib/stores/site-visits";
import { cancelVisitInvites, dispatchVisitInvite, type InviteStatus, type RecipientResult } from "@/lib/visit-invite";

/**
 * #34 visit-queue mutations — the LEAD claim model (claimLeadAction:
 * assign-to-self behind any requireUser, NO approver gate — field techs
 * claim visits). scheduleVisitAction stamps the times then dispatches the
 * D77 invite/calendar machinery; like the inbox path, the schedule sticks
 * even when the invite fails.
 *
 * claim/release reject once a visit is "scheduled" or "done" (plan review
 * minor) — a scheduled visit must not be silently claimed/released back
 * into the pool with stale times; releasing a scheduled visit belongs to a
 * future reschedule/cancel flow, not this pool-claim pair.
 */

export async function claimVisitAction(id: string) {
  const me = await requireUser();
  const v = await getVisit(id);
  if (!v || v.stage === "scheduled" || v.stage === "done") return { ok: false as const };
  await claimVisit(id, me.name);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function releaseVisitAction(id: string) {
  await requireUser();
  const v = await getVisit(id);
  if (!v) return { ok: false as const };
  if (v.stage === "scheduled" || v.stage === "done") return { ok: false as const };
  await releaseVisit(id);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/**
 * Delete a site visit. Everyone invited (lead + attendees) gets a
 * cancellation first — their calendar copy deleted, or a METHOD:CANCEL .ics
 * with the same UID (spec 2026-10-09 site-visit scheduling); an invite
 * failure never blocks the delete. Called directly (not a form action) so
 * the client navigates/refreshes on success.
 */
export async function removeVisitAction(
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireUser();
  if (!id) return { ok: false, error: "Missing visit id." };
  const v = await getVisit(id);
  if (!v) return { ok: false, error: "That visit could not be found." };
  // Spec 2026-10-09 site-visit scheduling — everyone invited gets a
  // cancellation (calendar delete / METHOD:CANCEL). Never blocks the delete.
  await cancelVisitInvites(v, { id: me.id, name: me.name });
  await removeVisit(id);
  // Spec 2026-10-09 triggers: the removed stop's day (and the next) re-syncs for everyone on it.
  const removed = v;
  after(async () => {
    const { resyncForVisitChange } = await import("@/lib/drive-sync/sync");
    await resyncForVisitChange(removed, null).catch((err) => console.error("[drive-sync] visit delete re-sync failed:", err));
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function scheduleVisitAction(
  id: string,
  input: { startAt: number; endAt: number; attendees?: unknown }
): Promise<{ ok: true; inviteStatus: InviteStatus; invites: RecipientResult[] } | { ok: false; error: string }> {
  const me = await requireUser();
  if (!(input.startAt > 0) || !(input.endAt > input.startAt))
    return { ok: false, error: "Bad time range" };
  const v = await getVisit(id);
  if (!v) return { ok: false, error: "Visit not found" };
  if (v.stage === "done") return { ok: false, error: "Visit already completed" };
  if (!v.assignedTo) return { ok: false, error: "Claim the visit first" };
  // Spec 2026-10-09 site-visit scheduling — attendees picked while booking.
  // Omitted (undefined or null) = leave any existing attendees alone; only an
  // explicit array changes them.
  const roster = (await activeUsers()).map((u) => u.name);
  const attendees = input.attendees == null ? undefined : cleanAttendees(input.attendees, v.assignedTo, roster);
  await scheduleVisit(id, input.startAt, input.endAt, attendees);
  const fresh = await getVisit(id);
  // Spec 2026-10-09 triggers: re-sync the old and new day for everyone on it.
  // Registered before the invite dispatch, so an invite error can't drop it.
  const prevVisit = v;
  const nextVisit = fresh;
  after(async () => {
    const { resyncForVisitChange } = await import("@/lib/drive-sync/sync");
    await resyncForVisitChange(prevVisit, nextVisit).catch((err) => console.error("[drive-sync] visit re-sync failed:", err));
  });
  const report = fresh ? await dispatchVisitInvite(fresh, { id: me.id, name: me.name }) : null;
  revalidatePath("/", "layout");
  return { ok: true, inviteStatus: report?.status ?? "failed", invites: report?.recipients ?? [] };
}
