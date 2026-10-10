"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireUser } from "@/lib/session";
import { getVisit, updateVisitBooking } from "@/lib/stores/site-visits";
import { activeUsers } from "@/lib/users";
import { dispatchVisitInvite, type RecipientResult } from "@/lib/visit-invite";
import { validVisitSpan } from "@/lib/visit-plan/input";
import { cleanAttendees } from "@/lib/visit-plan/people";

/**
 * Spec 2026-10-09 site-visit scheduling — editing a scheduled visit.
 * Conflicts never block a save. The booking screen's live check (GET
 * /api/visits/check) and the company record's conflict badges (GET
 * /api/visits/conflicts) are route handlers, not server actions: Next runs a
 * page's server actions one at a time, so either would queue Save behind it.
 */

export async function updateVisitAction(
  id: string,
  raw: unknown
): Promise<{ ok: true; invites: RecipientResult[] } | { ok: false; error: string }> {
  const me = await requireUser();
  if (typeof id !== "string" || !id || id.length > 40) return { ok: false, error: "Missing visit id." };
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const startAt = typeof r.startAt === "number" ? r.startAt : NaN;
  const endAt = typeof r.endAt === "number" ? r.endAt : NaN;
  if (!validVisitSpan(startAt, endAt)) return { ok: false, error: "Bad time range" };
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
