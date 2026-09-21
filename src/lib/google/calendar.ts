import { accessTokenFor } from "@/lib/gmail/connections";
import { presetFromRrule, rruleFor } from "./recurrence";

/**
 * Thin Google Calendar v3 client (D77) — plain fetch, bearer auth, zero deps,
 * mirroring src/lib/gmail/api.ts's gapi pattern (D36). Tokens come from the
 * same gmail_connections rows; calls only work for mailboxes whose grant
 * includes CALENDAR_SCOPE (callers check hasCalendarScope first — a call
 * without it just 403s and should be caught).
 *
 * Everything targets the account's PRIMARY calendar (D76-C: personal
 * calendar; Jeff can share it from Google Calendar itself if he wants).
 */

const CAL_BASE = "https://www.googleapis.com/calendar/v3";

async function gcal<T>(
  mailboxKey: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const token = await accessTokenFor(mailboxKey);
  if (!token) throw new Error("Mailbox not connected: " + mailboxKey);
  const res = await fetch(CAL_BASE + path, {
    ...init,
    // The dashboard render awaits this — a hung Google endpoint must never
    // hang Home. Errors land in the caller's catch (F2).
    signal: AbortSignal.timeout(5000),
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(
      "Calendar API " + path + " → " + res.status + " " + (await res.text())
    );
  }
  return (await res.json()) as T;
}

/* ---- types (only the fields the app reads) ---- */

type GoogleEventTime = { dateTime?: string; date?: string };
type GoogleAttendee = { email: string; displayName?: string; responseStatus?: string };
type GoogleEvent = {
  id: string;
  iCalUID?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
  recurrence?: string[];
  attendees?: GoogleAttendee[];
};

export type CalendarEvent = {
  id: string;
  /** Google's cross-calendar id — the app's .ics invites use sv-<id>@peak-app,
   *  so the dashboard can dedup an accepted invite against the local visit. */
  iCalUID: string;
  title: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  location: string;
  htmlLink: string;
};

export type Attendee = { email: string; name: string; status: string };

/** Full event detail (S13 full-build) — used to populate the edit modal.
 *  Not returned by listUpcomingEvents (which stays lean for the merged
 *  agenda feed); fetched on demand when an event is opened. */
export type EventDetail = {
  id: string;
  title: string;
  description: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  location: string;
  htmlLink: string;
  /** "" | "daily" | "weekly" | "monthly" | "yearly" — see recurrence.ts;
   *  a recurrence Google sent that doesn't match one of our presets still
   *  round-trips (rawRecurrence is what gets sent back untouched unless the
   *  user changes the preset). */
  recurrencePreset: string;
  rawRecurrence: string[];
  attendees: Attendee[];
};

function toDetail(e: GoogleEvent): EventDetail {
  const startMs = toMs(e.start, 0);
  return {
    id: e.id,
    title: e.summary || "(no title)",
    description: e.description || "",
    startMs,
    endMs: toMs(e.end, startMs),
    allDay: !!e.start?.date,
    location: e.location || "",
    htmlLink: e.htmlLink || "",
    recurrencePreset: presetFromRrule((e.recurrence || [])[0]),
    rawRecurrence: e.recurrence || [],
    attendees: (e.attendees || []).map((a) => ({
      email: a.email,
      name: a.displayName || a.email,
      status: a.responseStatus || "needsAction",
    })),
  };
}

function toMs(t: GoogleEventTime | undefined, fallback: number): number {
  if (t?.dateTime) return Date.parse(t.dateTime);
  // All-day events parse at UTC midnight ON PURPOSE — the client renders
  // all-day items with UTC getters, so the calendar date survives any
  // server/browser timezone combination (F3).
  if (t?.date) return Date.parse(t.date + "T00:00:00Z");
  return fallback;
}

/** Upcoming events from the primary calendar, normalized and sorted.
 *  singleEvents expands recurring series into concrete instances. */
export async function listUpcomingEvents(
  mailboxKey: string,
  opts: { timeMinMs: number; timeMaxMs: number; maxResults?: number }
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin: new Date(opts.timeMinMs).toISOString(),
    timeMax: new Date(opts.timeMaxMs).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(opts.maxResults ?? 50),
  });
  const r = await gcal<{ items?: GoogleEvent[] }>(
    mailboxKey,
    "/calendars/primary/events?" + params.toString()
  );
  return (r.items || [])
    .filter((e) => e.status !== "cancelled")
    .map((e) => ({
      id: e.id,
      iCalUID: e.iCalUID || "",
      title: e.summary || "(no title)",
      startMs: toMs(e.start, 0),
      endMs: toMs(e.end, toMs(e.start, 0)),
      allDay: !!e.start?.date,
      location: e.location || "",
      htmlLink: e.htmlLink || "",
    }))
    .filter((e) => e.startMs > 0);
}

/** All-day dates are sent as bare YYYY-MM-DD (UTC-anchored, matching how the
 *  app reads them back — see toMs above); Google's `end.date` is EXCLUSIVE,
 *  so a one-day all-day event's end is the next calendar day. */
function dateOnly(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function eventTime(ms: number, allDay: boolean, addDayForEnd: boolean): GoogleEventTime {
  if (!allDay) return { dateTime: new Date(ms).toISOString() };
  const d = addDayForEnd ? ms + 86_400_000 : ms;
  return { date: dateOnly(d) };
}

export type EventWriteInput = {
  title: string;
  startMs: number;
  endMs: number;
  allDay?: boolean;
  description?: string;
  location?: string;
  /** "" | "daily" | "weekly" | "monthly" | "yearly" (recurrence.ts) */
  recurrencePreset?: string;
  attendeeEmails?: string[];
};

function writeBody(ev: EventWriteInput) {
  const allDay = !!ev.allDay;
  return {
    summary: ev.title,
    description: ev.description || undefined,
    location: ev.location || undefined,
    start: eventTime(ev.startMs, allDay, false),
    end: eventTime(ev.endMs, allDay, true),
    recurrence: rruleFor(ev.recurrencePreset || "") ?? undefined,
    attendees: ev.attendeeEmails?.length
      ? ev.attendeeEmails.map((email) => ({ email }))
      : undefined,
  };
}

/** Create an event on the primary calendar. Returns the Google event id +
 *  link (the id is stamped onto site-visit records for dedup, D77). Sends
 *  attendee invites (sendUpdates=all) only when attendees are present, so
 *  plain internal events never trigger Google's "invite" email chrome. */
export async function insertEvent(
  mailboxKey: string,
  ev: EventWriteInput
): Promise<{ id: string; htmlLink: string }> {
  const sendUpdates = ev.attendeeEmails?.length ? "all" : "none";
  const r = await gcal<GoogleEvent>(
    mailboxKey,
    "/calendars/primary/events?sendUpdates=" + sendUpdates,
    { method: "POST", body: JSON.stringify(writeBody(ev)) }
  );
  return { id: r.id, htmlLink: r.htmlLink || "" };
}

/** Full event detail for the edit modal — not part of the lean list feed. */
export async function getEvent(
  mailboxKey: string,
  eventId: string
): Promise<EventDetail> {
  const r = await gcal<GoogleEvent>(
    mailboxKey,
    "/calendars/primary/events/" + encodeURIComponent(eventId)
  );
  return toDetail(r);
}

/** Update an existing event (PATCH — only the fields the modal edits are
 *  sent, everything else on the Google event is left alone). Acting on an
 *  instance id (from singleEvents=true expansion) only touches that one
 *  occurrence of a recurring series — Google's native behavior. */
export async function updateEvent(
  mailboxKey: string,
  eventId: string,
  ev: EventWriteInput
): Promise<{ id: string; htmlLink: string }> {
  const sendUpdates = ev.attendeeEmails?.length ? "all" : "none";
  const r = await gcal<GoogleEvent>(
    mailboxKey,
    "/calendars/primary/events/" + encodeURIComponent(eventId) + "?sendUpdates=" + sendUpdates,
    { method: "PATCH", body: JSON.stringify(writeBody(ev)) }
  );
  return { id: r.id, htmlLink: r.htmlLink || "" };
}

/** Delete an event (or, for a recurring instance id, cancel just that one
 *  occurrence). 410/404 (already gone on Google's side) is swallowed — the
 *  caller's revalidate will just stop showing it either way. */
export async function deleteEvent(mailboxKey: string, eventId: string): Promise<void> {
  const token = await accessTokenFor(mailboxKey);
  if (!token) throw new Error("Mailbox not connected: " + mailboxKey);
  const res = await fetch(
    CAL_BASE + "/calendars/primary/events/" + encodeURIComponent(eventId) + "?sendUpdates=all",
    {
      method: "DELETE",
      signal: AbortSignal.timeout(5000),
      headers: { Authorization: "Bearer " + token },
    }
  );
  if (!res.ok && res.status !== 410 && res.status !== 404) {
    throw new Error("Calendar API delete → " + res.status + " " + (await res.text()));
  }
}

/* ---- app-managed scheduler events -------------------------------------
 * Idempotent all-day events the app owns end to end (service-calendar.ts
 * mirrors flame/repair/inspection jobs into Google). Distinct from the CRUD
 * above, which edits events the user authored in Google Calendar. */

type ManagedEvent = {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD, rendered as an all-day scheduler item
  description?: string;
  location?: string;
};

function nextIsoDay(date: string): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Idempotent calendar write for app-managed scheduler records. */
export async function upsertManagedEvent(mailboxKey: string, ev: ManagedEvent): Promise<void> {
  const body = {
    id: ev.id,
    summary: ev.title,
    description: ev.description || undefined,
    location: ev.location || undefined,
    start: { date: ev.date },
    end: { date: nextIsoDay(ev.date) },
  };
  try {
    await gcal<GoogleEvent>(mailboxKey, "/calendars/primary/events", {
      method: "POST",
      body: JSON.stringify(body),
    });
  } catch (err) {
    if ((err as { status?: number }).status !== 409) throw err;
    const patch = {
      summary: body.summary,
      description: body.description,
      location: body.location,
      start: body.start,
      end: body.end,
    };
    await gcal<GoogleEvent>(
      mailboxKey,
      "/calendars/primary/events/" + encodeURIComponent(ev.id),
      { method: "PATCH", body: JSON.stringify(patch) }
    );
  }
}

export async function removeManagedEvent(mailboxKey: string, eventId: string): Promise<void> {
  try {
    await gcal<void>(mailboxKey, "/calendars/primary/events/" + encodeURIComponent(eventId), {
      method: "DELETE",
    });
  } catch (err) {
    if ((err as { status?: number }).status !== 404 && (err as { status?: number }).status !== 410)
      throw err;
  }
}
