"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import {
  get,
  schedule as scheduleJob,
  unschedule as unscheduleJob,
  complete as completeJob,
  reopen as reopenJob,
  DEFAULT_WARRANTY_MONTHS,
  type RepairCompletion,
} from "@/lib/stores/repair-jobs";

/**
 * Repair job mutations — the RepairStore calls the prototype makes from the
 * Repair Scheduling and Repair Results screens (repairjobs.js schedule /
 * unschedule / complete / reopen). FormData-shaped so the forms work without
 * client JS; invalid input is a silent no-op (the UI only renders legal
 * actions, mirroring the prototype's gates).
 */

/** Book (or reschedule) an approved repair — sets date + technician. */
export async function scheduleRepair(formData: FormData): Promise<void> {
  await requireUser();
  const id = String(formData.get("id") || "");
  const scheduledDate = String(formData.get("scheduledDate") || "");
  const assignedTo = String(formData.get("assignedTo") || "");
  if (!id || !scheduledDate) return;
  const job = await get(id);
  if (!job) return;
  await scheduleJob(id, { scheduledDate, assignedTo });
  revalidatePath("/", "layout");
}

/** Send a scheduled repair back to the approved (to-schedule) column. */
export async function unscheduleRepair(formData: FormData): Promise<void> {
  await requireUser();
  const id = String(formData.get("id") || "");
  if (!id) return;
  const job = await get(id);
  if (!job) return;
  await unscheduleJob(id);
  revalidatePath("/", "layout");
}

/**
 * Log the work performed → completes the repair, stamping completedAt (the
 * warranty clock starts here) and the completion record. Redirects back to
 * the results screen so the freshly-logged report is shown.
 */
export async function completeRepair(formData: FormData): Promise<void> {
  await requireUser();
  const id = String(formData.get("id") || "");
  const completedDate = String(formData.get("completedDate") || "");
  if (!id || !completedDate) return;
  const job = await get(id);
  if (!job) return;

  const performedBy = String(formData.get("performedBy") || job.assignedTo || "");
  const workPerformed = String(formData.get("workPerformed") || "").trim();
  const followUp = String(formData.get("followUp") || "").trim();
  const partsUsed = String(formData.get("partsUsed") || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const warrantyRaw = String(formData.get("warrantyMonths") || "");
  const warrantyMonths = warrantyRaw ? Math.max(0, parseInt(warrantyRaw, 10) || 0) : null;

  const completion: RepairCompletion = {
    performedBy,
    workPerformed,
    partsUsed,
    followUp,
    photos: [],
  };
  await completeJob(id, {
    completedDate,
    warrantyMonths: warrantyMonths ?? DEFAULT_WARRANTY_MONTHS,
    completion,
    assignedTo: performedBy,
  });
  revalidatePath("/", "layout");
  redirect("/repairs/results?job=" + encodeURIComponent(id) + "&saved=1");
}

/** Re-open a completed repair for edits (clears completion + warranty clock). */
export async function reopenRepair(formData: FormData): Promise<void> {
  await requireUser();
  const id = String(formData.get("id") || "");
  if (!id) return;
  const job = await get(id);
  if (!job) return;
  await reopenJob(id);
  revalidatePath("/", "layout");
}
