"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { claimVisit, getVisit, releaseVisit, scheduleVisit } from "@/lib/stores/site-visits";
import { dispatchVisitInvite, type InviteStatus } from "@/lib/visit-invite";

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
  revalidatePath("/", "layout");
  return { ok: true, inviteStatus };
}
