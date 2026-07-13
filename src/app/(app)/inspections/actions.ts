"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import {
  assign,
  create,
  get,
  setRenewalOutreach,
  unschedule,
} from "@/lib/stores/inspections";

/**
 * Inspection inbox mutations. `createInspection` mirrors the prototype's
 * "New inspection" button (Inspections.dc.html → Inspection.dc.html?new=1):
 * we spin up a fresh `requested` record owned by the acting user and open its
 * capture editor. FormData-shaped so the button works without client JS.
 */
export async function createInspection(): Promise<void> {
  const user = await requireUser();
  const rec = await create({
    owner: user.name,
    requestedBy: user.name,
    stage: "requested",
  });
  revalidatePath("/", "layout");
  redirect(`/inspections/${encodeURIComponent(rec.id)}`);
}

/** Scheduler mutations (inspection twins of the flame-test scheduler's). */
export async function scheduleInspection(formData: FormData): Promise<void> {
  await requireUser();
  const id = String(formData.get("id") || "");
  if (!id) return;
  await assign(
    id,
    String(formData.get("assignedTo") || ""),
    String(formData.get("scheduledDate") || "")
  );
  revalidatePath("/", "layout");
}

export async function unscheduleInspection(formData: FormData): Promise<void> {
  await requireUser();
  const id = String(formData.get("id") || "");
  if (!id) return;
  await unschedule(id);
  revalidatePath("/", "layout");
}

/** Stamp / undo this cycle's renewal outreach (IDEAS #37 worklist). */
export async function markInspectionRenewalOutreach(
  formData: FormData
): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") || "");
  const undo = String(formData.get("undo") || "") === "1";
  if (!id) return;
  const rec = await get(id);
  if (!rec || rec.stage !== "completed") return;
  await setRenewalOutreach(id, undo ? null : user.name);
  revalidatePath("/", "layout");
}
