import { accessTokenFor } from "@/lib/gmail/connections";

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
type GoogleEvent = {
  id: string;
  iCalUID?: string;
  status?: string;
  summary?: string;
  location?: string;
  htmlLink?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
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

/** Create an event on the primary calendar. Returns the Google event id +
 *  link (the id is stamped onto site-visit records for dedup, D77). */
export async function insertEvent(
  mailboxKey: string,
  ev: {
    title: string;
    startMs: number;
    endMs: number;
    description?: string;
    location?: string;
  }
): Promise<{ id: string; htmlLink: string }> {
  const body = {
    summary: ev.title,
    description: ev.description || undefined,
    location: ev.location || undefined,
    start: { dateTime: new Date(ev.startMs).toISOString() },
    end: { dateTime: new Date(ev.endMs).toISOString() },
  };
  const r = await gcal<GoogleEvent>(mailboxKey, "/calendars/primary/events", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return { id: r.id, htmlLink: r.htmlLink || "" };
}
