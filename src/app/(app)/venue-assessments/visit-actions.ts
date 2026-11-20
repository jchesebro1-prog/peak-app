"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { activeUsers, allUsers } from "@/lib/users";
import { canChangeVisit, VISIT_EDIT_REFUSAL } from "@/lib/visit-edit-rights";
import { cleanAttendees, validVisitSpan } from "@/lib/visit-fields";
import { claimVisit, getVisit, releaseVisit, removeVisit, scheduleVisit } from "@/lib/stores/site-visits";

/**
 * #34 visit-queue mutations — the LEAD claim model (claimLeadAction:
 * assign-to-self behind any requireUser, NO approver gate — field techs
 * claim visits). scheduleVisitAction stamps the times (no invites, no
 * calendar events — site-visit scheduling was removed).
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
 * Delete a site visit. Called directly (not a form action) so the client
 * navigates/refreshes on success.
 */
export async function removeVisitAction(
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireUser();
  if (!id) return { ok: false, error: "Missing visit id." };
  const v = await getVisit(id);
  if (!v) return { ok: false, error: "That visit could not be found." };
  // Jeff 2026-10-15 #35 — deleting a scheduled visit cancels everyone's calendar copy: lead or approver only.
  if (!canChangeVisit(v, me, await allUsers())) return { ok: false, error: VISIT_EDIT_REFUSAL };
  await removeVisit(id);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function scheduleVisitAction(
  id: string,
  input: { startAt: number; endAt: number; attendees?: unknown }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireUser();
  // At most 24 h — the same rule as editing a scheduled visit.
  if (!validVisitSpan(input.startAt, input.endAt)) return { ok: false, error: "Bad time range" };
  const v = await getVisit(id);
  if (!v) return { ok: false, error: "Visit not found" };
  if (v.stage === "done") return { ok: false, error: "Visit already completed" };
  if (!v.assignedTo) return { ok: false, error: "Claim the visit first" };
  // Jeff 2026-10-15 #35 — re-timing an already-scheduled visit: lead or approver only.
  if (!canChangeVisit(v, me, await allUsers())) return { ok: false, error: VISIT_EDIT_REFUSAL };
  // Spec 2026-10-09 site-visit scheduling — attendees picked while booking.
  // Omitted (undefined or null) = leave any existing attendees alone; only an
  // explicit array changes them.
  const roster = (await activeUsers()).map((u) => u.name);
  const attendees = input.attendees == null ? undefined : cleanAttendees(input.attendees, v.assignedTo, roster);
  await scheduleVisit(id, input.startAt, input.endAt, attendees);
  revalidatePath("/", "layout");
  return { ok: true };
}
