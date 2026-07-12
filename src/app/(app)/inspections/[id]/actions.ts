"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import {
  get,
  update,
  remove,
  type InspectionRecord,
} from "@/lib/stores/inspections";
import { create as createQuote } from "@/lib/stores/quotes";

/**
 * Inspection capture-editor mutations (port of the Inspection.dc.html save /
 * stage / delete / renovation-quote paths). The editor is genuinely
 * interactive (rubric ratings, photo capture, log write-ups) so it runs as a
 * client component holding a local draft; these server actions persist that
 * draft. Every mutation: requireUser → store mutator → revalidate.
 *
 * The editable draft is the whole InspectionRecord minus the server-managed
 * identity/timestamps, matching the prototype's blank()-shaped save payload.
 */
export type InspectionPatch = Partial<
  Pick<
    InspectionRecord,
    | "customer"
    | "customerId"
    | "locationId"
    | "venue"
    | "venueType"
    | "address"
    | "contact"
    | "contactPhone"
    | "contactEmail"
    | "surveyDate"
    | "reportDate"
    | "inspector"
    | "condition"
    | "scope"
    | "narrative"
    | "logs"
    | "rubric"
    | "venueInfo"
    | "measurements"
    | "priorInspectionId"
    | "priorSurveyDate"
    | "stage"
    | "assignedTo"
    | "scheduledDate"
  >
>;

/** Persist the whole editor draft (Save / Save changes). */
export async function saveInspection(id: string, patch: InspectionPatch): Promise<void> {
  await requireUser();
  if (!id) return;
  const existing = await get(id);
  if (!existing) return;
  await update(id, patch as Partial<InspectionRecord>);
  revalidatePath("/", "layout");
}

/** Advance the lifecycle stage, persisting the current draft alongside
 *  (mirrors advanceStage: completing stamps a report date if missing). */
export async function advanceInspectionStage(
  id: string,
  patch: InspectionPatch,
  target: InspectionRecord["stage"]
): Promise<void> {
  await requireUser();
  if (!id) return;
  const existing = await get(id);
  if (!existing) return;
  const next: InspectionPatch = { ...patch, stage: target };
  if (target === "completed" && !(next.reportDate || existing.reportDate || "").trim()) {
    const t = new Date();
    next.reportDate =
      t.getFullYear() + "-" + ("0" + (t.getMonth() + 1)).slice(-2) + "-" + ("0" + t.getDate()).slice(-2);
  }
  await update(id, next as Partial<InspectionRecord>);
  revalidatePath("/", "layout");
}

export async function deleteInspection(id: string): Promise<void> {
  await requireUser();
  if (id) await remove(id);
  revalidatePath("/", "layout");
  redirect("/inspections");
}

/**
 * "Renovation quote" (port of createQuote on the report): spins up a system
 * quote sourced from this inspection and opens it in the Estimator. The
 * prototype also back-links renovationQuoteId onto the inspection — our
 * typed InspectionRecord has no such field, so the link is not persisted.
 */
export async function startRenovationQuote(id: string): Promise<void> {
  const user = await requireUser();
  const rec = id ? await get(id) : null;
  if (!rec) return;
  const q = await createQuote({
    name: (rec.customer || "Inspection") + " — " + (rec.venue || "Rigging") + " renovation",
    customer: rec.customer || "",
    customerId: rec.customerId || null,
    locationId: rec.locationId || null,
    owner: user.name,
    source: "inspection",
  });
  revalidatePath("/", "layout");
  redirect(`/estimator?id=${encodeURIComponent(q.id)}`);
}
