"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import {
  getProject,
  addCrew,
  updateCrew,
  removeCrew,
} from "@/lib/stores/projects";

/**
 * Schedule (crew board) mutations — the ProjectStore calls the prototype's
 * Scheduling screen makes (project.js addCrew / updateCrew / removeCrew).
 * FormData-shaped so the booking popover works without client JS; invalid
 * input is a silent no-op. Dates arrive as YYYY-MM-DD (local) + a day span.
 *
 * NOTE: the prototype's drag-to-reschedule and localStorage-only "time off"
 * lanes are NOT ported — there is no backing store for time off, and drags
 * are replaced by the same popover forms used for booking/editing. See the
 * page's report notes.
 */

const DAY = 86400000;

/** Parse a YYYY-MM-DD value to a local start-of-day epoch, or null. */
function fromIso(s: string): number | null {
  const m = /(\d+)-(\d+)-(\d+)/.exec(s || "");
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
}

function spanEnd(start: number, days: number): number {
  return start + (Math.max(1, days) - 1) * DAY;
}

/** Book a crew member onto a project for a date span (optionally a mobilization). */
export async function bookCrew(formData: FormData): Promise<void> {
  await requireUser();
  const projectId = String(formData.get("projectId") || "");
  const person = String(formData.get("person") || "");
  const role = String(formData.get("role") || "").trim() || "Installer";
  const start = fromIso(String(formData.get("start") || ""));
  const days = parseInt(String(formData.get("days") || "1"), 10) || 1;
  const mobId = String(formData.get("mobId") || "") || null;
  if (!projectId || !person || start == null || days < 1) return;
  const p = await getProject(projectId);
  if (!p) return;
  await addCrew(projectId, person, role, start, spanEnd(start, days), mobId);
  revalidatePath("/", "layout");
  redirect("/schedule");
}

/** Reassign / reschedule an existing booking. */
export async function updateBooking(formData: FormData): Promise<void> {
  await requireUser();
  const projectId = String(formData.get("projectId") || "");
  const crewId = String(formData.get("crewId") || "");
  const person = String(formData.get("person") || "");
  const role = String(formData.get("role") || "").trim() || "Installer";
  const start = fromIso(String(formData.get("start") || ""));
  const days = parseInt(String(formData.get("days") || "1"), 10) || 1;
  if (!projectId || !crewId || !person || start == null || days < 1) return;
  const p = await getProject(projectId);
  if (!p || !(p.crew || []).some((c) => c.id === crewId)) return;
  await updateCrew(projectId, crewId, {
    person,
    role,
    start,
    end: spanEnd(start, days),
  });
  revalidatePath("/", "layout");
  redirect("/schedule");
}

/** Remove a booking from a project. */
export async function removeBooking(formData: FormData): Promise<void> {
  await requireUser();
  const projectId = String(formData.get("projectId") || "");
  const crewId = String(formData.get("crewId") || "");
  if (!projectId || !crewId) return;
  const p = await getProject(projectId);
  if (!p) return;
  await removeCrew(projectId, crewId);
  revalidatePath("/", "layout");
  redirect("/schedule");
}
