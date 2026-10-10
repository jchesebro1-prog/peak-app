import { accessTokenFor } from "@/lib/gmail/connections";
import { accessTokenForConnection } from "./calendar-connections";
import { presetFromRrule, rruleFor } from "./recurrence";
import { findMeetingLink } from "./meeting-link";
import { DRIVE_DAY_PROP, DRIVE_KEY_PROP, DRIVE_PROP } from "./drive-props";

/**
 * Thin Google Calendar v3 client (D77) — plain fetch, bearer auth, zero deps,
 * mirroring src/lib/gmail/api.ts's gapi pattern (D36). Tokens come from the
 * same gmail_connections rows; calls only work for mailboxes whose grant
 * includes CALENDAR_SCOPE (callers check hasCalendarScope first — a call
 * without it just 403s and should be caught).
 *
 * Everything targets the account's PRIMARY calendar (D76-C: personal
 * calendar; Jeff can share it from Google Calendar itself if he wants).
 *
 * D148 adds a SECOND token source (calendarConnections rows, for the
 * Calendar tab's "subscribe to another account's calendars" feature) that
 * reads arbitrary calendar ids on arbitrary connected accounts. Rather than
 * widening every exported function's signature to accept either token
 * source — which would touch every existing caller across schedule/
 * actions.ts, service-calendar.ts, visit-invite.ts and calendar-actions.ts
 * for no behavior change — the low-level fetch/error-handling is factored
 * into callGoogleCalendarApi(token, ...), and each higher-level path (gcal
 * for a mailbox, gcalExternal for a calendarConnections row) resolves its
 * own token before calling it. Existing exports keep their exact signatures.
 */

const CAL_BASE = "https://www.googleapis.com/calendar/v3";

async function callGoogleCalendarApi<T>(
  token: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
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

async function gcal<T>(
  mailboxKey: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const token = await accessTokenFor(mailboxKey);
  if (!token) throw new Error("Mailbox not connected: " + mailboxKey);
  return callGoogleCalendarApi<T>(token, path, init);
}

/** D148 — same shape as gcal() above, but resolves its token from a
 *  calendarConnections row (lib/google/calendar-connections.ts) instead of
 *  a gmail_connections mailbox. */
async function gcalExternal<T>(
  connectionId: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const token = await accessTokenForConnection(connectionId);
  if (!token) throw new Error("Calendar connection not found or unauthorized: " + connectionId);
  return callGoogleCalendarApi<T>(token, path, init);
}

/* ---- types (only the fields the app reads) ---- */

type GoogleEventTime = { dateTime?: string; date?: string };
type GoogleAttendee = { email: string; displayName?: string; responseStatus?: string; self?: boolean };
export type GoogleEvent = {
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
  extendedProperties?: { private?: Record<string, string> };
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
  meetingUrl: string;
  /** The signed-in account declined it (spec: declined events aren't stops). */
  selfDeclined: boolean;
  /** Set only on the app's own drive events (private peakDrive = "1"). */
  peakDriveKey: string;
  peakDriveDay: string;
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
  meetingUrl: string;
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
    meetingUrl: findMeetingLink(e.location, e.description),
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

/** Shared items→CalendarEvent[] mapping — used by both listUpcomingEvents
 *  (a mailbox's own primary calendar) and listEventsForCalendar (D148, an
 *  arbitrary calendar on a calendarConnections account); exported for the
 *  spec harness. */
export function toCalendarEvents(items: GoogleEvent[] | undefined): CalendarEvent[] {
  return (items || [])
    .filter((e) => e.status !== "cancelled")
    .map((e) => {
      const priv = e.extendedProperties?.private || {};
      const ours = priv[DRIVE_PROP] === "1";
      return {
        id: e.id,
        iCalUID: e.iCalUID || "",
        title: e.summary || "(no title)",
        startMs: toMs(e.start, 0),
        endMs: toMs(e.end, toMs(e.start, 0)),
        allDay: !!e.start?.date,
        location: e.location || "",
        htmlLink: e.htmlLink || "",
        meetingUrl: findMeetingLink(e.location, e.description),
        selfDeclined: (e.attendees || []).some((a) => a.self && a.responseStatus === "declined"),
        peakDriveKey: ours ? priv[DRIVE_KEY_PROP] || "" : "",
        peakDriveDay: ours ? priv[DRIVE_DAY_PROP] || "" : "",
      };
    })
    .filter((e) => e.startMs > 0);
}

function eventsListParams(opts: { timeMinMs: number; timeMaxMs: number; maxResults?: number }): URLSearchParams {
  return new URLSearchParams({
    timeMin: new Date(opts.timeMinMs).toISOString(),
    timeMax: new Date(opts.timeMaxMs).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(opts.maxResults ?? 50),
  });
}

/** Upcoming events from the primary calendar, normalized and sorted.
 *  singleEvents expands recurring series into concrete instances. */
export async function listUpcomingEvents(
  mailboxKey: string,
  opts: { timeMinMs: number; timeMaxMs: number; maxResults?: number }
): Promise<CalendarEvent[]> {
  const r = await gcal<{ items?: GoogleEvent[] }>(
    mailboxKey,
    "/calendars/primary/events?" + eventsListParams(opts).toString()
  );
  return toCalendarEvents(r.items);
}

export type SyncCalendarEvent = CalendarEvent & { description: string };

export type SyncRead = { events: SyncCalendarEvent[]; coveredThroughMs: number };
export type EventPage = { items?: GoogleEvent[]; nextPageToken?: string };

/** The page loop behind listEventsForSync, with the fetcher injected. When
 *  the page cap ends the read before Google ran out, `coveredThroughMs` is
 *  the start of the last event read (events come back ordered by start), so
 *  the caller syncs only days that end at or before it; a complete read
 *  covers the whole requested window. */
export async function readSyncPages(
  fetchPage: (pageToken?: string) => Promise<EventPage>,
  opts: { timeMinMs: number; timeMaxMs: number; maxPages: number }
): Promise<SyncRead> {
  const events: SyncCalendarEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < opts.maxPages; page++) {
    const r = await fetchPage(pageToken);
    const desc = new Map((r.items || []).map((e) => [e.id, e.description || ""]));
    for (const ev of toCalendarEvents(r.items)) events.push({ ...ev, description: desc.get(ev.id) || "" });
    if (!r.nextPageToken) return { events, coveredThroughMs: opts.timeMaxMs };
    pageToken = r.nextPageToken;
  }
  const lastStart = events.reduce((m, e) => Math.max(m, e.startMs), opts.timeMinMs);
  return { events, coveredThroughMs: Math.min(lastStart, opts.timeMaxMs) };
}

/** Every event in a window, with descriptions — the drive sync's read
 *  (tagged-event diff, stops, D144 cleanup). Pages up to 4 x 250; when that
 *  isn't the whole window, `coveredThroughMs` says how far it got. */
export async function listEventsForSync(
  mailboxKey: string,
  opts: { timeMinMs: number; timeMaxMs: number }
): Promise<SyncRead> {
  return readSyncPages(
    (pageToken) => {
      const params = eventsListParams({ ...opts, maxResults: 250 });
      if (pageToken) params.set("pageToken", pageToken);
      return gcal<EventPage>(mailboxKey, "/calendars/primary/events?" + params.toString());
    },
    { ...opts, maxPages: 4 }
  );
}

/* ---- D148: an additional connected account's own calendars ------------ */

export type ExternalCalendarListEntry = {
  id: string;
  summary: string;
  primary?: boolean;
  backgroundColor?: string;
};

async function fetchCalendarList(token: string): Promise<ExternalCalendarListEntry[]> {
  const r = await callGoogleCalendarApi<{ items?: ExternalCalendarListEntry[] }>(
    token,
    "/users/me/calendarList"
  );
  return r.items || [];
}

/** The connected account's individual calendars (calendarList.list) — used
 *  on demand from "Refresh calendars" in the management UI. Read-only: this
 *  feature never writes to calendarList. */
export async function listCalendarsForConnection(
  connectionId: string
): Promise<ExternalCalendarListEntry[]> {
  const token = await accessTokenForConnection(connectionId);
  if (!token) throw new Error("Calendar connection not found or unauthorized: " + connectionId);
  return fetchCalendarList(token);
}

/** Same call, but with an access token already in hand — used right after
 *  the OAuth callback exchanges its code, before any calendarConnections row
 *  exists yet to resolve a token from. */
export async function listCalendarsWithAccessToken(
  token: string
): Promise<ExternalCalendarListEntry[]> {
  return fetchCalendarList(token);
}

/** Events from ONE calendar (by id, not necessarily "primary") on a
 *  connected account — the read side of D148's subscribe feature. Never
 *  writes; there is no insert/update/delete counterpart for external
 *  connections (calendar.readonly scope wouldn't allow it anyway). */
export async function listEventsForExternalCalendar(
  connectionId: string,
  calendarId: string,
  opts: { timeMinMs: number; timeMaxMs: number; maxResults?: number }
): Promise<CalendarEvent[]> {
  const r = await gcalExternal<{ items?: GoogleEvent[] }>(
    connectionId,
    "/calendars/" + encodeURIComponent(calendarId) + "/events?" + eventsListParams(opts).toString()
  );
  return toCalendarEvents(r.items);
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
  /** Private extended properties (the drive sync's peakDrive tag). */
  privateProps?: Record<string, string>;
  /** No reminders at all (the drive sync's blocks); omitted = calendar default. */
  noReminders?: boolean;
  /** Mark the event busy (transparency opaque); omitted = not sent. */
  busy?: boolean;
};

export function eventWriteBody(ev: EventWriteInput) {
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
    extendedProperties: ev.privateProps ? { private: ev.privateProps } : undefined,
    reminders: ev.noReminders ? { useDefault: false, overrides: [] } : undefined,
    transparency: ev.busy ? "opaque" : undefined,
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
    { method: "POST", body: JSON.stringify(eventWriteBody(ev)) }
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
    { method: "PATCH", body: JSON.stringify(eventWriteBody(ev)) }
  );
  return { id: r.id, htmlLink: r.htmlLink || "" };
}

/** Delete an event (or, for a recurring instance id, cancel just that one
 *  occurrence). 410/404 (already gone on Google's side) is swallowed — the
 *  caller's revalidate will just stop showing it either way. */
export function deleteEventPath(eventId: string, sendUpdates: "all" | "none" = "all"): string {
  return "/calendars/primary/events/" + encodeURIComponent(eventId) + "?sendUpdates=" + sendUpdates;
}

/** sendUpdates defaults to "all" (unchanged for the calendar modal etc.);
 *  the drive sync passes "none". */
export async function deleteEvent(mailboxKey: string, eventId: string, opts?: { sendUpdates?: "all" | "none" }): Promise<void> {
  const token = await accessTokenFor(mailboxKey);
  if (!token) throw new Error("Mailbox not connected: " + mailboxKey);
  const res = await fetch(
    CAL_BASE + deleteEventPath(eventId, opts?.sendUpdates ?? "all"),
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

/* ---- #219: wall-clock event writes (Daylite calendar import) ------------
 * insertEvent above takes epoch-ms and sends UTC ISO strings. An imported
 * Daylite event is a local wall-clock time in a named zone and must reach
 * Google exactly as written, so this sibling sends a pre-built body. */

/** A local dateTime with no offset plus its IANA zone, or an all-day date
 *  (Google's end.date is exclusive). */
export type ZonedEventTime = { dateTime: string; timeZone: string } | { date: string };

export type ZonedEventBody = {
  /** Optional caller-chosen id (base32hex, 5–1024 chars). A repeat insert
   *  with the same id fails with 409 instead of creating a duplicate. */
  id?: string;
  summary: string;
  description?: string;
  start: ZonedEventTime;
  end: ZonedEventTime;
};

/** Insert a pre-built event on the mailbox's PRIMARY calendar, never sending
 *  invite emails. Same token path and 5 s timeout as every call here. */
export async function insertZonedEvent(
  mailboxKey: string,
  body: ZonedEventBody
): Promise<{ id: string; htmlLink: string }> {
  const r = await gcal<GoogleEvent>(mailboxKey, "/calendars/primary/events?sendUpdates=none", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return { id: r.id, htmlLink: r.htmlLink || "" };
}
