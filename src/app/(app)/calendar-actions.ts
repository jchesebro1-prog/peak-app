"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { gmailEnabled, hasCalendarScope, personalKey } from "@/lib/gmail/config";
import { getConnectionInfo } from "@/lib/gmail/connections";
import { searchPeople, type PersonMatch } from "@/lib/people-search";
import type { EventDetail } from "@/lib/google/calendar";

/** Resolves the signed-in user's own connected+granted mailbox key, or an
 *  error string explaining why calendar writes aren't available. Every
 *  action below re-checks this server-side even though the client only
 *  shows calendar UI when calendarOn is already true (agenda.ts). */
async function requireCalendarGrant(): Promise<
  { ok: true; key: string } | { ok: false; error: string }
> {
  const me = await requireUser();
  if (!gmailEnabled()) return { ok: false, error: "Gmail isn't enabled" };
  const key = personalKey(me.id);
  const info = await getConnectionInfo(key);
  if (!info || !hasCalendarScope(info.scope))
    return { ok: false, error: "Calendar isn't enabled for your mailbox" };
  return { ok: true, key };
}

export type EventFormInput = {
  title: string;
  startAt: number;
  endAt: number;
  allDay?: boolean;
  location?: string;
  description?: string;
  /** "" | "daily" | "weekly" | "monthly" | "yearly" — recurrence.ts */
  recurrencePreset?: string;
  attendeeEmails?: string[];
};

function validate(input: EventFormInput): string | null {
  if (!input.title.trim()) return "Give the event a title";
  if (!(input.startAt > 0) || !(input.endAt >= input.startAt)) return "Bad time range";
  return null;
}

/**
 * Dashboard + full-page calendar quick-add (D77, extended S13) — writes an
 * event straight onto the signed-in user's own primary Google Calendar.
 */
export async function addCalendarEventAction(
  input: EventFormInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const title = (input.title || "").trim();
  const bad = validate({ ...input, title });
  if (bad) return { ok: false, error: bad };
  const grant = await requireCalendarGrant();
  if (!grant.ok) return grant;
  try {
    const { insertEvent } = await import("@/lib/google/calendar");
    await insertEvent(grant.key, {
      title,
      startMs: input.startAt,
      endMs: input.endAt,
      allDay: input.allDay,
      location: input.location || undefined,
      description: input.description || undefined,
      recurrencePreset: input.recurrencePreset,
      attendeeEmails: input.attendeeEmails,
    });
  } catch (err) {
    console.error("[calendar] add failed:", err);
    return { ok: false, error: "Google Calendar rejected the event" };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Fetches full detail (recurrence, attendees, description) for the edit
 *  modal — the merged agenda feed only carries the lean list fields. */
export async function getCalendarEventAction(
  eventId: string
): Promise<{ ok: true; event: EventDetail } | { ok: false; error: string }> {
  const grant = await requireCalendarGrant();
  if (!grant.ok) return grant;
  try {
    const { getEvent } = await import("@/lib/google/calendar");
    const event = await getEvent(grant.key, eventId);
    return { ok: true, event };
  } catch (err) {
    console.error("[calendar] get event failed:", err);
    return { ok: false, error: "That event couldn't be loaded — it may have been removed from Google Calendar" };
  }
}

export async function updateCalendarEventAction(
  eventId: string,
  input: EventFormInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const title = (input.title || "").trim();
  const bad = validate({ ...input, title });
  if (bad) return { ok: false, error: bad };
  const grant = await requireCalendarGrant();
  if (!grant.ok) return grant;
  try {
    const { updateEvent } = await import("@/lib/google/calendar");
    await updateEvent(grant.key, eventId, {
      title,
      startMs: input.startAt,
      endMs: input.endAt,
      allDay: input.allDay,
      location: input.location || undefined,
      description: input.description || undefined,
      recurrencePreset: input.recurrencePreset,
      attendeeEmails: input.attendeeEmails,
    });
  } catch (err) {
    console.error("[calendar] update failed:", err);
    return { ok: false, error: "Google Calendar rejected the update" };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteCalendarEventAction(
  eventId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const grant = await requireCalendarGrant();
  if (!grant.ok) return grant;
  try {
    const { deleteEvent } = await import("@/lib/google/calendar");
    await deleteEvent(grant.key, eventId);
  } catch (err) {
    console.error("[calendar] delete failed:", err);
    return { ok: false, error: "Google Calendar rejected the delete" };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Attendee-picker typeahead (team roster + customer contacts). */
export async function searchPeopleAction(query: string): Promise<PersonMatch[]> {
  await requireUser();
  return searchPeople(query);
}
