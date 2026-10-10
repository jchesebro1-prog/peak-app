"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireUser } from "@/lib/session";
import { getVisit, updateVisitBooking } from "@/lib/stores/site-visits";
import { activeUsers } from "@/lib/users";
import { dispatchVisitInvite, type RecipientResult } from "@/lib/visit-invite";
import { cleanBookingInput } from "@/lib/visit-plan/input";
import { cleanAttendees } from "@/lib/visit-plan/people";
import type { BookingCheckResult } from "@/lib/visit-plan/types";

/**
 * Spec 2026-10-09 site-visit scheduling — the booking screen's live check
 * (nearby days + conflicts) and editing a scheduled visit. Conflicts never
 * block a save. The check always views as the signed-in user, so other
 * people's Google event titles stay hidden. (The company record's conflict
 * badges are a GET route, /api/visits/conflicts, so they never queue behind
 * these actions.)
 */

const CHECK_FAILED = "Couldn't check conflicts — you can still schedule.";

export async function bookingCheckAction(raw: unknown): Promise<BookingCheckResult | { error: string }> {
  const me = await requireUser();
  const roster = (await activeUsers()).map((u) => u.name);
  const input = cleanBookingInput(raw, roster);
  try {
    const { loadBookingCheck } = await import("@/lib/visit-plan/load");
    return await loadBookingCheck(input, { viewerId: me.id });
  } catch (err) {
    console.error("[visit-booking] check failed:", err);
    return { error: CHECK_FAILED };
  }
}

export async function updateVisitAction(
  id: string,
  raw: unknown
): Promise<{ ok: true; invites: RecipientResult[] } | { ok: false; error: string }> {
  const me = await requireUser();
  if (typeof id !== "string" || !id || id.length > 40) return { ok: false, error: "Missing visit id." };
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const startAt = typeof r.startAt === "number" ? r.startAt : NaN;
  const endAt = typeof r.endAt === "number" ? r.endAt : NaN;
  if (!(startAt > 0) || !(endAt > startAt) || endAt - startAt > 24 * 3_600_000) return { ok: false, error: "Bad time range" };
  const roster = (await activeUsers()).map((u) => u.name);
  const lead = typeof r.assignedTo === "string" ? r.assignedTo.trim() : "";
  if (!roster.includes(lead)) return { ok: false, error: "Pick who leads the visit." };
  const v = await getVisit(id);
  if (!v) return { ok: false, error: "Visit not found" };
  // Only a scheduled visit is edited here; open/requested/claimed visits go
  // through the claim → schedule path, so this can't bypass the claim model.
  if (v.stage !== "scheduled") return { ok: false, error: "Only a scheduled visit can be edited" };
  const fresh = await updateVisitBooking(id, { startAt, endAt, assignedTo: lead, attendees: cleanAttendees(r.attendees, lead, roster) });
  if (!fresh) return { ok: false, error: "Visit not found" };
  // Spec 2026-10-09 triggers: re-sync the old and new day for everyone on
  // either version. Registered before the invites, so an invite error can't drop it.
  const prevVisit = v;
  const nextVisit = fresh;
  after(async () => {
    const { resyncForVisitChange } = await import("@/lib/drive-sync/sync");
    await resyncForVisitChange(prevVisit, nextVisit).catch((err) => console.error("[drive-sync] visit re-sync failed:", err));
  });
  const report = await dispatchVisitInvite(fresh, { id: me.id, name: me.name });
  revalidatePath("/", "layout");
  return { ok: true, invites: report.recipients };
}
