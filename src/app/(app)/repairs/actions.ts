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
  remove as removeJob,
  setRepairValue,
  DEFAULT_WARRANTY_MONTHS,
  type RepairCompletion,
} from "@/lib/stores/repair-jobs";
import { removeServiceCalendar, syncServiceCalendar } from "@/lib/service-calendar";

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
  await syncServiceCalendar({
    kind: "repair",
    id,
    assignedTo,
    previousAssignedTo: job.assignedTo,
    date: scheduledDate,
    title: `${job.venue || job.customer} — Repair`,
    location: job.venue || job.customer,
    description: `Repair ${job.id} · ${job.customer}`,
  });
  revalidatePath("/", "layout");
}

/** Send a scheduled repair back to the approved (to-schedule) column. */
export async function unscheduleRepair(formData: FormData): Promise<void> {
  await requireUser();
  const id = String(formData.get("id") || "");
  if (!id) return;
  const job = await get(id);
  if (!job) return;
  await removeServiceCalendar({ kind: "repair", id, assignedTo: job.assignedTo });
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

/** Set a repair job's dollar value by hand — the "fill it in later" path for
 *  a Daylite-imported repair that landed as UKN (#188, mirrors
 *  setProjectValueAction in projects/actions.ts). Accepts currency-ish input
 *  ("$4,200", "4200"); empty or unparseable input is refused. Saving always
 *  clears valueUnknown. */
export async function setRepairValueAction(formData: FormData): Promise<void> {
  await requireUser();
  const id = String(formData.get("id") || "");
  if (!id) return;
  const cleaned = String(formData.get("value") || "").replace(/[^0-9.-]/g, "");
  const value = cleaned === "" ? NaN : Number(cleaned);
  if (!Number.isFinite(value) || value < 0) {
    redirect("/repairs/results?job=" + encodeURIComponent(id) + "&err=" + encodeURIComponent("Enter a valid job value."));
  }
  const job = await get(id);
  if (!job) return;
  // redirect() throws to signal Next's router, so the store call — the only
  // thing that can genuinely fail — stays alone in the try; a redirect
  // triggered inside it must never be swallowed by this catch.
  let saved: Awaited<ReturnType<typeof setRepairValue>> = null;
  try {
    saved = await setRepairValue(id, value);
  } catch (error) {
    console.error("setRepairValueAction failed", error);
    redirect(
      "/repairs/results?job=" +
        encodeURIComponent(id) +
        "&err=" +
        encodeURIComponent("Couldn’t save the job value — please try again.")
    );
  }
  if (!saved) {
    redirect(
      "/repairs/results?job=" +
        encodeURIComponent(id) +
        "&err=" +
        encodeURIComponent("That repair could not be updated — please refresh and try again.")
    );
  }
  revalidatePath("/", "layout");
}

/**
 * Delete a repair job (soft delete — doc-store keeps a tombstone). Called
 * directly from the results screen's Delete control, not a form action, so
 * it never calls redirect() itself — the client navigates on success. A
 * still-scheduled job's calendar hold (if any) is cleared best-effort first.
 */
export async function deleteRepairJobAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireUser();
  if (!id) return { ok: false, error: "Missing job id." };
  const job = await get(id);
  if (!job) return { ok: false, error: "That repair could not be found." };
  if (job.stage === "scheduled") {
    await removeServiceCalendar({ kind: "repair", id, assignedTo: job.assignedTo });
  }
  await removeJob(id);
  revalidatePath("/", "layout");
  return { ok: true };
}
