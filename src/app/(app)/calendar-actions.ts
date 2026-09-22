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

/**
 * D144 — loose "is this a real street address, not a Zoom link or a room
 * name" heuristic for the auto travel-time block. A real address typically
 * carries a street number and/or a comma separating street/city/state (e.g.
 * "123 Main St, Madison, WI"); a meeting-link/room-name location usually has
 * neither. Not a validator — just a signal cheap enough to gate an
 * optional, best-effort feature.
 */
function looksLikePhysicalAddress(location: string): boolean {
  const s = (location || "").trim();
  if (!s) return false;
  const lower = s.toLowerCase();
  if (/^https?:\/\//.test(lower)) return false;
  if (/zoom\.us|meet\.google|teams\.microsoft|webex|hangout|\.com\//.test(lower)) return false;
  return /\d/.test(s) || s.includes(",");
}

/**
 * D144 — auto travel-time block ("Calendar based-out-of" punch item).
 * Best-effort only: called after the real meeting event is already saved,
 * and every failure path here (no office anywhere in the system, address
 * doesn't geocode, network hiccup) is swallowed so the meeting itself is
 * never blocked or failed by this. Fires on CREATE only — see callers.
 */
async function addTravelBlock(
  key: string,
  userId: string,
  meetingTitle: string,
  location: string,
  meetingStartMs: number
): Promise<void> {
  if (!looksLikePhysicalAddress(location)) return;
  try {
    const [{ getUser }, { getSettings }, { search, estimate, quoteOrigin }] = await Promise.all([
      import("@/lib/users"),
      import("@/lib/settings"),
      import("@/lib/geo"),
    ]);
    const settings = await getSettings();
    const offices = settings.offices || [];
    const me = await getUser(userId);
    const myOfficeId = me?.officeId;
    // Fall back to the quote-default office (Settings -> Locations) so a
    // user who never set "Based out of" (Account page) still gets a
    // reasonable travel estimate instead of none at all.
    const office =
      (myOfficeId && offices.find((o) => o.id === myOfficeId)) ||
      quoteOrigin(offices);
    if (!office) return; // no office configured anywhere — nothing to estimate from

    // The location is free text, not lat/lng, so it needs geocoding first —
    // estimate()'s target wants coordinates. search() is the same Nominatim
    // lookup the address-search UI uses; it fails soft (empty array) on a
    // network hiccup or an address it can't resolve, which is exactly the
    // "skip silently" case this feature wants.
    const hits = await search(location, { limit: 1 });
    const hit = hits[0];
    if (!hit) return;

    const est = await estimate([office], { lat: hit.lat, lng: hit.lng });
    // Sanity-cap the estimate: a bad geocode hit or a haversine outlier
    // producing an absurd duration should not plant a travel block days
    // before the meeting. Six hours comfortably covers any real same-day
    // drive Peak would ever schedule around; anything past that is almost
    // certainly a bad estimate, not a real trip — skip rather than guess.
    if (!est.minutes || est.minutes <= 0 || est.minutes > 360) return;

    const { insertEvent } = await import("@/lib/google/calendar");
    await insertEvent(key, {
      title: `Drive to ${meetingTitle} (auto)`,
      startMs: meetingStartMs - est.minutes * 60_000,
      endMs: meetingStartMs,
      description:
        "Auto-added travel time — safe to delete or edit. Estimated " +
        est.minutes +
        " min from " +
        (office.name || "your base office") +
        ".",
    });
  } catch (err) {
    console.error("[calendar] travel block skipped:", err);
  }
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
  // D144 — auto travel-time block, create only (no equivalent call in
  // updateCalendarEventAction — see that function's comment). An all-day
  // entry has no meaningful arrival time to count back from, so it's
  // skipped too.
  if (!input.allDay && input.location) {
    await addTravelBlock(grant.key, grant.userId, title, input.location, input.startAt);
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

/**
 * D144 note: this intentionally does NOT (re)create a travel block when
 * `location` changes on an edit — only addCalendarEventAction does, on
 * create. Regenerating here risks piling up a new travel block on every
 * edit with no way to tell "the address changed" from "nothing relevant
 * changed," and there's no link from a travel block back to its meeting to
 * find and replace the old one (by design — D144, it's an ordinary,
 * freely-removable event). Left as a known limitation; see task report.
 */
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
