"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import {
  get,
  update,
  setStage,
  assign,
  remove,
  type SurveyRecord,
  type SurveyStage,
} from "@/lib/stores/surveys";
import { create as createQuote } from "@/lib/stores/quotes";

/**
 * Survey capture-editor mutations (port of the Survey.dc.html save / stage /
 * assign / delete / create-quote paths). The editor is genuinely interactive
 * (measurement entry, condition tags, photo capture), so it runs as a client
 * component holding a local draft; these server actions persist that draft.
 * Every mutation: requireUser → store mutator → revalidatePath.
 *
 * The editable draft is the whole SurveyRecord minus the server-managed
 * identity/timestamps, matching the prototype's blank()-shaped save payload.
 */
export type SurveyPatch = Partial<
  Pick<
    SurveyRecord,
    | "customer"
    | "customerId"
    | "locationId"
    | "venue"
    | "venueType"
    | "address"
    | "contact"
    | "contactPhone"
    | "contactEmail"
    | "visitType"
    | "reason"
    | "travelTime"
    | "distance"
    | "hasBOM"
    | "hasDrawings"
    | "hasPhotos"
    | "quoteNeededBy"
    | "budgetary"
    | "projectCompletion"
    | "installTimeframe"
    | "loadingDock"
    | "elevatorSize"
    | "floorType"
    | "accessDoorSize"
    | "liftNeeded"
    | "liftSupplier"
    | "scopeOfWork"
    | "quoteLook"
    | "notes"
    | "stage"
    | "assignedTo"
    | "scheduledDate"
    | "measurements"
    | "conditions"
    | "photos"
    // Site Intake extension (IDEAS #45)
    | "auditoriumSize"
    | "yearBuilt"
    | "systemsState"
    | "disciplines"
    | "disciplinesActive"
    | "inventory"
    | "intakeReady"
    // Venue Assessments (D132) — class model + the sheets' own fields
    | "venueClass"
    | "venueSubtype"
    | "visitPurpose"
    | "loadingDoorSize"
    | "liftHeight"
    | "pathToFloor"
    | "workingHours"
    | "blackoutDates"
    | "floorProtection"
    | "badgingRequired"
    | "firstImpressions"
    | "budget"
    | "fiscalYearSpendBy"
    | "whoDecides"
    | "targetInstallWindow"
    | "lifeSafety"
    | "linesetsEnabled"
    | "linesets"
    | "assessmentEnabled"
    | "assessment"
    | "signoff"
    | "leadId"
    | "visitId"
  >
>;

/** Persist the whole editor draft (Save survey / Save changes). */
export async function saveSurvey(id: string, patch: SurveyPatch): Promise<void> {
  await requireUser();
  if (!id) return;
  const existing = await get(id);
  if (!existing) return;
  await update(id, patch as Partial<SurveyRecord>);
  revalidatePath("/", "layout");
}

/**
 * Advance the lifecycle stage, persisting the current draft alongside.
 * Moving to `scheduled` routes through the store's assign() so the surveyor /
 * date land the same way the office scheduler sets them; other stages persist
 * the draft then setStage().
 */
export async function advanceSurveyStage(
  id: string,
  patch: SurveyPatch,
  target: SurveyStage
): Promise<void> {
  await requireUser();
  if (!id) return;
  const existing = await get(id);
  if (!existing) return;
  await update(id, patch as Partial<SurveyRecord>);
  if (target === "scheduled") {
    await assign(id, patch.assignedTo ?? existing.assignedTo, patch.scheduledDate ?? existing.scheduledDate);
  } else {
    await setStage(id, target);
  }
  revalidatePath("/", "layout");
}

export async function deleteSurvey(id: string): Promise<void> {
  await requireUser();
  if (id) await remove(id);
  revalidatePath("/", "layout");
  redirect("/venue-assessments");
}

/**
 * "Create quote" (port of createQuoteFromSurvey): marks the survey completed,
 * spins up a quote sourced from it, and opens the Estimator. The prototype
 * also stamps a CloudStore review flag — not part of our typed stores, so it
 * is not persisted here.
 */
export async function createQuoteFromSurvey(id: string, patch: SurveyPatch): Promise<void> {
  const user = await requireUser();
  const rec = id ? await get(id) : null;
  if (!rec) return;
  await update(id, { ...(patch as Partial<SurveyRecord>), stage: "completed" });
  const q = await createQuote({
    name: (patch.customer || rec.customer || "Venue assessment") + " — " + (patch.venue || rec.venue || rec.venueType || "Site"),
    customer: patch.customer || rec.customer || "",
    customerId: patch.customerId ?? rec.customerId ?? null,
    locationId: patch.locationId ?? rec.locationId ?? null,
    owner: user.name,
    source: "survey",
  });
  revalidatePath("/", "layout");
  redirect(`/estimator?id=${encodeURIComponent(q.id)}`);
}
