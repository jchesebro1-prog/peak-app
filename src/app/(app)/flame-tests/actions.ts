"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import {
  get,
  schedule,
  unschedule,
  complete,
  reopen,
  setRenewalOutreach,
  type FlameJobResults,
  type FlameJobVenueResult,
} from "@/lib/stores/flame-jobs";

/**
 * Flame-test job mutations — the FlameJobStore calls the prototype makes from
 * the scheduler popover (schedule/unschedule) and the results form (complete /
 * reopen). FormData-shaped so the forms work without client JS; invalid input
 * is a silent no-op (the UI only renders legal actions, mirroring the
 * prototype's gates).
 */

/** Assign a date + tech → scheduled (scheduler popover "Schedule" / "Save"). */
export async function scheduleFlameTest(formData: FormData): Promise<void> {
  await requireUser();
  const id = String(formData.get("id") || "");
  const scheduledDate = String(formData.get("scheduledDate") || "");
  const assignedTo = String(formData.get("assignedTo") || "");
  if (!id || !scheduledDate) return; // popover disables Save without a date
  const job = await get(id);
  if (!job) return;
  await schedule(id, { scheduledDate, assignedTo });
  revalidatePath("/", "layout");
}

/** Return a scheduled job to the "to schedule" queue (popover "Unschedule"). */
export async function unscheduleFlameTest(formData: FormData): Promise<void> {
  await requireUser();
  const id = String(formData.get("id") || "");
  if (!id) return;
  const job = await get(id);
  if (!job || job.stage !== "scheduled") return;
  await unschedule(id);
  revalidatePath("/", "layout");
}

const OVERALLS = ["pass", "partial", "fail"] as const;

/**
 * Log results → completed; stamps completedAt + dueAt (+1yr). The client
 * editor posts the per-venue tallies as a JSON `results` blob plus the
 * performed date + technician (port of Flame Test Results.dc.html save()).
 * On success we mirror the prototype's auto-open of the results report.
 */
export async function completeFlameTest(formData: FormData): Promise<void> {
  await requireUser();
  const id = String(formData.get("id") || "");
  const completedDate = String(formData.get("completedDate") || "");
  if (!id) return;
  const job = await get(id);
  if (!job) return;

  let venues: FlameJobVenueResult[] = [];
  try {
    const raw = JSON.parse(String(formData.get("venues") || "[]"));
    if (Array.isArray(raw)) {
      venues = raw.map((v): FlameJobVenueResult => {
        const tested = Math.max(0, Number(v.tested) || 0);
        const passed = Math.max(0, Number(v.passed) || 0);
        const retreated = Math.max(0, Number(v.retreated) || 0);
        return {
          id: v.id ?? null,
          label: String(v.label || "Venue"),
          tested,
          passed,
          failed: Math.max(0, tested - passed - retreated),
          retreated,
          treatment: retreated ? "Re-treated on site" : "Passed field test",
          notes: "",
        };
      });
    }
  } catch {
    venues = [];
  }

  const totalTested = venues.reduce((a, v) => a + v.tested, 0);
  if (totalTested <= 0 || !completedDate) return; // Save gate: need a date + something tested

  const overallRaw = String(formData.get("overall") || "");
  const suggested =
    venues.some((v) => v.failed > 0)
      ? "fail"
      : venues.some((v) => v.retreated > 0)
        ? "partial"
        : "pass";
  const overall = (OVERALLS as readonly string[]).includes(overallRaw)
    ? overallRaw
    : suggested;

  const performedBy = String(formData.get("performedBy") || "");
  const results: FlameJobResults = {
    overall,
    cert: String(formData.get("cert") || "").trim(),
    performedBy,
    method: "Field flame test per NFPA 705",
    venues,
    notes: String(formData.get("notes") || "").trim(),
  };

  await complete(id, { completedDate, results, assignedTo: performedBy });
  revalidatePath("/", "layout");
  redirect("/flame-tests/results?job=" + encodeURIComponent(id) + "&saved=1");
}

/** Re-open a completed job for editing (clears completion). */
export async function reopenFlameTest(formData: FormData): Promise<void> {
  await requireUser();
  const id = String(formData.get("id") || "");
  if (!id) return;
  const job = await get(id);
  if (!job || job.stage !== "completed") return;
  await reopen(id);
  revalidatePath("/", "layout");
}

/** Stamp / undo this cycle's renewal outreach (IDEAS #37 worklist). */
export async function markFlameRenewalOutreach(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") || "");
  const undo = String(formData.get("undo") || "") === "1";
  if (!id) return;
  const job = await get(id);
  if (!job || job.stage !== "completed") return;
  await setRenewalOutreach(id, undo ? null : user.name);
  revalidatePath("/", "layout");
}
