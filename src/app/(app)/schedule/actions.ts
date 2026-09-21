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
import type { CrewAssignment, ProjectRecord } from "@/lib/stores/projects";
import { allUsers } from "@/lib/users";
import { gmailEnabled, hasCalendarScope, personalKey } from "@/lib/gmail/config";
import { getConnectionInfo } from "@/lib/gmail/connections";

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

async function calendarKeyFor(person: string): Promise<string | null> {
  if (!gmailEnabled()) return null;
  const user = (await allUsers()).find((u) => u.name === person);
  if (!user) return null;
  const key = personalKey(user.id);
  const info = await getConnectionInfo(key);
  return info && hasCalendarScope(info.scope) ? key : null;
}

function calendarEvent(project: ProjectRecord, crew: CrewAssignment) {
  return {
    title: `${project.name} — ${crew.role}`,
    startMs: crew.start,
    endMs: crew.end + DAY,
    description: `Peak crew booking for ${crew.person}. Project ${project.id}.`,
  };
}

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
  const saved = await addCrew(projectId, person, role, start, spanEnd(start, days), mobId);
  const crew = saved?.crew?.[saved.crew.length - 1];
  const key = await calendarKeyFor(person);
  if (saved && crew && key) {
    try {
      const { insertEvent } = await import("@/lib/google/calendar");
      const event = await insertEvent(key, calendarEvent(saved, crew));
      await updateCrew(projectId, crew.id, { googleEventId: event.id });
    } catch (error) {
      console.error("[schedule] calendar create failed:", error);
    }
  }
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
  const prior = (p.crew || []).find((c) => c.id === crewId)!;
  const saved = await updateCrew(projectId, crewId, {
    person,
    role,
    start,
    end: spanEnd(start, days),
  });
  const crew = saved?.crew?.find((c) => c.id === crewId);
  try {
    const oldKey = await calendarKeyFor(prior.person);
    const newKey = await calendarKeyFor(person);
    const { deleteEvent, insertEvent, updateEvent } = await import("@/lib/google/calendar");
    if (prior.googleEventId && oldKey && oldKey === newKey && crew) {
      await updateEvent(oldKey, prior.googleEventId, calendarEvent(saved!, crew));
    } else {
      if (prior.googleEventId && oldKey) await deleteEvent(oldKey, prior.googleEventId);
      if (newKey && saved && crew) {
        const event = await insertEvent(newKey, calendarEvent(saved, crew));
        await updateCrew(projectId, crewId, { googleEventId: event.id });
      }
    }
  } catch (error) {
    console.error("[schedule] calendar update failed:", error);
  }
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
  const crew = (p.crew || []).find((c) => c.id === crewId);
  if (crew?.googleEventId) {
    try {
      const key = await calendarKeyFor(crew.person);
      if (key) {
        const { deleteEvent } = await import("@/lib/google/calendar");
        await deleteEvent(key, crew.googleEventId);
      }
    } catch (error) {
      console.error("[schedule] calendar delete failed:", error);
    }
  }
  await removeCrew(projectId, crewId);
  revalidatePath("/", "layout");
  redirect("/schedule");
}
