"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireUser } from "@/lib/session";
import { gmailEnabled, hasCalendarScope, personalKey } from "@/lib/gmail/config";
import { getConnectionInfo } from "@/lib/gmail/connections";
import { searchPeople, type PersonMatch } from "@/lib/people-search";
import type { EventDetail } from "@/lib/google/calendar";
import { addDays, chicagoDayKey, isStayOverDay } from "@/lib/drive-plan/day";

/** Resolves the signed-in user's own connected+granted mailbox key, or an
 *  error string explaining why calendar writes aren't available. Every
 *  action below re-checks this server-side even though the client only
 *  shows calendar UI when calendarOn is already true (agenda.ts). */
async function requireCalendarGrant(): Promise<
  { ok: true; key: string; userId: string } | { ok: false; error: string }
> {
  const me = await requireUser();
  if (!gmailEnabled()) return { ok: false, error: "Gmail isn't enabled" };
  const key = personalKey(me.id);
  const info = await getConnectionInfo(key);
  if (!info || !hasCalendarScope(info.scope))
    return { ok: false, error: "Calendar isn't enabled for your mailbox" };
  return { ok: true, key, userId: me.id };
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
  // Spec 2026-10-09 retires D144's guessed travel block: a new timed event
  // with a location is just another stop — re-sync that day's drive chain
  // (and the next, for a stay-over) after the response.
  if (!input.allDay) {
    const userId = grant.userId;
    const day = chicagoDayKey(input.startAt);
    after(async () => {
      const { syncDriveDays, markStaleIfTriggerFailed, triggerDeadline } = await import("@/lib/drive-sync/sync");
      await syncDriveDays(userId, [day, addDays(day, 1)], undefined, { deadlineMs: triggerDeadline() })
        .then((r) => markStaleIfTriggerFailed(userId, r))
        .catch((err) => markStaleIfTriggerFailed(userId, null, err));
    });
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

/** Edits an event on the user's own calendar, then re-syncs their drive chain (spec 2026-10-09). */
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
  const syncUser = grant.userId;
  after(async () => {
    const { syncDriveForUser, markStaleIfTriggerFailed, triggerDeadline } = await import("@/lib/drive-sync/sync");
    await syncDriveForUser(syncUser, undefined, { deadlineMs: triggerDeadline() })
      .then((r) => markStaleIfTriggerFailed(syncUser, r))
      .catch((err) => markStaleIfTriggerFailed(syncUser, null, err));
  });
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
  const syncUser = grant.userId;
  after(async () => {
    const { syncDriveForUser, markStaleIfTriggerFailed, triggerDeadline } = await import("@/lib/drive-sync/sync");
    await syncDriveForUser(syncUser, undefined, { deadlineMs: triggerDeadline() })
      .then((r) => markStaleIfTriggerFailed(syncUser, r))
      .catch((err) => markStaleIfTriggerFailed(syncUser, null, err));
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Spec 2026-10-09 "Staying over" — per rep, per date, from the calendar
 *  day: no drive-back that day, and the next day starts from its last stop. */
export async function setStayOverAction(
  dayKey: string,
  on: boolean
): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireUser();
  // Yesterday … today + 14 only: nothing outside the sync window is stored.
  if (!isStayOverDay(dayKey, Date.now())) return { ok: false, error: "Bad date" };
  const { setStayOver } = await import("@/lib/stores/schedule-prefs");
  await setStayOver(me.id, dayKey, on === true);
  const userId = me.id;
  after(async () => {
    const { syncDriveDays, markStaleIfTriggerFailed, triggerDeadline } = await import("@/lib/drive-sync/sync");
    await syncDriveDays(userId, [dayKey, addDays(dayKey, 1)], undefined, { deadlineMs: triggerDeadline() })
      .then((r) => markStaleIfTriggerFailed(userId, r))
      .catch((err) => markStaleIfTriggerFailed(userId, null, err));
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Attendee-picker typeahead (team roster + customer contacts). */
export async function searchPeopleAction(query: string): Promise<PersonMatch[]> {
  await requireUser();
  return searchPeople(query);
}

/* ------------------------------------------------------------------ *
 * D148 — manage additional Google accounts connected purely to
 * subscribe to their calendars (Calendar tab's filter rail). These are
 * NOT gmail_connections rows: no mailbox, no scope check against
 * gmailEnabled() — see lib/gmail/config.ts's CALENDAR_READONLY_SCOPE
 * comment for why this feature is independent of the Gmail bridge.
 * Every action re-derives the signed-in user and checks connection
 * ownership server-side (getOwnedConnection) rather than trusting a
 * connectionId handed back from the client — the same defense-in-depth
 * requireCalendarGrant applies to the mailbox-calendar actions above.
 * ------------------------------------------------------------------ */

export type CalendarConnectionView = {
  id: string;
  googleEmail: string;
  calendars: Array<{
    id: string;
    summary: string;
    backgroundColor?: string;
    visible: boolean;
    colorOverride?: string;
  }>;
};

/** The signed-in user's connected calendar-only accounts, for the filter
 *  rail. googleConfigured() (not gmailEnabled()) gates whether "Connect an
 *  account" can even be offered — see connect/route.ts's startCalendarConnect. */
export async function listCalendarConnectionsAction(): Promise<CalendarConnectionView[]> {
  const me = await requireUser();
  const { listConnectionsForUser } = await import("@/lib/google/calendar-connections");
  const rows = await listConnectionsForUser(me.id);
  return rows.map((r) => ({ id: r.id, googleEmail: r.googleEmail, calendars: r.calendars }));
}

export async function disconnectCalendarAccountAction(
  connectionId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireUser();
  const { getOwnedConnection, removeConnection } = await import("@/lib/google/calendar-connections");
  const owned = await getOwnedConnection(connectionId, me.id);
  if (!owned) return { ok: false, error: "That account isn't connected to you" };
  await removeConnection(connectionId, me.id);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setExternalCalendarVisibilityAction(
  connectionId: string,
  calendarId: string,
  visible: boolean
): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireUser();
  const { setCalendarVisibility } = await import("@/lib/google/calendar-connections");
  const updated = await setCalendarVisibility(connectionId, me.id, calendarId, visible);
  if (!updated) return { ok: false, error: "That calendar isn't connected to you" };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setExternalCalendarColorAction(
  connectionId: string,
  calendarId: string,
  color: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireUser();
  const { setCalendarColor } = await import("@/lib/google/calendar-connections");
  const updated = await setCalendarColor(connectionId, me.id, calendarId, color);
  if (!updated) return { ok: false, error: "That calendar isn't connected to you" };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Re-runs calendarList.list for one connection and merges the result (new
 *  calendars appear hidden by default, removed ones drop off) — "Refresh
 *  calendars" in the filter rail, for when someone adds/removes a calendar
 *  on the Google side after connecting. */
export async function refreshCalendarConnectionAction(
  connectionId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireUser();
  const [{ getOwnedConnection, refreshCalendarList }, { listCalendarsForConnection }] =
    await Promise.all([
      import("@/lib/google/calendar-connections"),
      import("@/lib/google/calendar"),
    ]);
  const owned = await getOwnedConnection(connectionId, me.id);
  if (!owned) return { ok: false, error: "That account isn't connected to you" };
  try {
    const discovered = await listCalendarsForConnection(connectionId);
    await refreshCalendarList(connectionId, me.id, discovered);
  } catch (err) {
    console.error("[calendar-connect] refresh failed:", err);
    return { ok: false, error: "Couldn't refresh that account's calendar list" };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
