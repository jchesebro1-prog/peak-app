import { gmailEnabled, hasCalendarScope, personalKey } from "@/lib/gmail/config";
import { allVisits } from "@/lib/stores/site-visits";

/**
 * Shared agenda assembly (D77/D81): the signed-in user's Google Calendar
 * merged with Peak site visits assigned to them, over an arbitrary window.
 * Used by the Home dashboard card (next 14 days) and the full-page /calendar
 * month view (S13). Dedup is fetch-aware — a visit pushed to Google whose
 * event didn't come back THIS load still shows from local data, and an
 * accepted .ics invite is matched by its sv-<id>@peak-app iCalUID.
 *
 * D148 adds a THIRD source, "external": events read from the individual
 * calendars of additional Google accounts the user has connected purely to
 * subscribe to (Calendar tab "Connect an account"), distinct from the
 * "google" source above (which is always the ONE Google account tied to the
 * user's own Gmail mailbox, D77). No dedup is attempted between "external"
 * and "google"/"visit" — an externally-subscribed calendar is, by design,
 * not the account anything else here is written to or mirrored from, so
 * there is no id/iCalUID relationship to de-duplicate against.
 */

export type AgendaItem = {
  key: string;
  /** raw Google event id (source "google"/"external") or site-visit id
   *  (source "visit") — the id half of `key`, broken out so the client
   *  doesn't have to string-parse it to open the edit modal (S13
   *  full-build). For "external" this is the event id on the ORIGIN
   *  calendar, not globally unique on its own — pair with connectionId +
   *  calendarId when an external item needs to be re-fetched. */
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  location: string;
  /** external Google link or internal path ("" = not clickable) */
  href: string;
  source: "google" | "visit" | "external";
  /** Set only for source "external" — which connection/calendar this came
   *  from, and the color the client should render it in (the calendar's
   *  colorOverride if the user set one, else Google's own backgroundColor,
   *  else a client-side fallback). */
  external?: { connectionId: string; calendarId: string; color: string };
};

/** Home dashboard window: the next 14 days (small back-buffer for
 *  in-progress events). */
export async function loadHomeAgenda(userId: string, me: string) {
  const now = Date.now();
  return loadAgendaRange(userId, me, now - 3600_000, now + 14 * 86_400_000);
}

export async function loadAgendaRange(
  userId: string,
  me: string,
  minMs: number,
  maxMs: number
): Promise<{ gmailOn: boolean; calendarOn: boolean; items: AgendaItem[] }> {
  const gmailOn = gmailEnabled();
  let calendarOn = false;
  const items: AgendaItem[] = [];
  const fetchedIds = new Set<string>();
  const fetchedIcal = new Set<string>();
  if (gmailOn) {
    try {
      const { getConnectionInfo } = await import("@/lib/gmail/connections");
      const info = await getConnectionInfo(personalKey(userId));
      calendarOn = !!info && hasCalendarScope(info.scope);
      if (calendarOn) {
        const { listUpcomingEvents } = await import("@/lib/google/calendar");
        const evs = await listUpcomingEvents(personalKey(userId), {
          timeMinMs: minMs,
          timeMaxMs: maxMs,
          maxResults: 250,
        });
        for (const e of evs) {
          fetchedIds.add(e.id);
          if (e.iCalUID) fetchedIcal.add(e.iCalUID);
          items.push({
            key: "g-" + e.id,
            id: e.id,
            title: e.title,
            startMs: e.startMs,
            endMs: e.endMs,
            allDay: e.allDay,
            location: e.location,
            href: e.htmlLink,
            source: "google",
          });
        }
      }
    } catch (err) {
      console.error("[agenda] calendar load failed:", err);
    }
  }

  // D148 — every VISIBLE sub-calendar across all of this user's connected
  // additional Google accounts. Independent of gmailOn/GMAIL_ENABLED (see
  // config.ts's CALENDAR_READONLY_SCOPE comment) — a deployment with Gmail
  // off entirely can still have calendar connections. Each connection, and
  // each calendar within it, is fetched in its own try/catch so one revoked
  // grant or one calendar Google briefly 500s on never blanks the rest of
  // the agenda (same defensive posture as the "google" source above).
  try {
    const { listConnectionsForUser } = await import("@/lib/google/calendar-connections");
    const connections = await listConnectionsForUser(userId);
    if (connections.length) {
      const { listEventsForExternalCalendar } = await import("@/lib/google/calendar");
      await Promise.all(
        connections.flatMap((conn) =>
          conn.calendars
            .filter((c) => c.visible)
            .map(async (cal) => {
              try {
                const evs = await listEventsForExternalCalendar(conn.id, cal.id, {
                  timeMinMs: minMs,
                  timeMaxMs: maxMs,
                  maxResults: 250,
                });
                const color = cal.colorOverride || cal.backgroundColor || "#6b7280";
                for (const e of evs) {
                  items.push({
                    key: "x-" + conn.id + "-" + cal.id + "-" + e.id,
                    id: e.id,
                    title: e.title,
                    startMs: e.startMs,
                    endMs: e.endMs,
                    allDay: e.allDay,
                    location: e.location,
                    href: e.htmlLink,
                    source: "external",
                    external: { connectionId: conn.id, calendarId: cal.id, color },
                  });
                }
              } catch (err) {
                console.error(
                  "[agenda] external calendar load failed:",
                  conn.googleEmail,
                  cal.id,
                  err
                );
              }
            })
        )
      );
    }
  } catch (err) {
    console.error("[agenda] external calendar connections load failed:", err);
  }

  for (const v of await allVisits()) {
    if (v.assignedTo !== me) continue;
    // #34: unscheduled requests (null startAt) have no agenda slot yet.
    if (v.startAt == null) continue;
    const endMs = v.endAt ?? v.startAt;
    if (endMs < minMs || v.startAt > maxMs) continue;
    if (v.googleEventId && fetchedIds.has(v.googleEventId)) continue;
    if (fetchedIcal.has("sv-" + v.id + "@peak-app")) continue;
    items.push({
      key: "v-" + v.id,
      id: v.id,
      title: (v.venue || v.customer) + " — " + v.reason,
      startMs: v.startAt,
      endMs,
      allDay: false,
      location: v.address,
      href: v.customerId ? "/companies/" + encodeURIComponent(v.customerId) : "",
      source: "visit",
    });
  }
  items.sort((a, b) => a.startMs - b.startMs);
  return { gmailOn, calendarOn, items };
}
