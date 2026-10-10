import type { FixTarget } from "@/lib/address-verify/types";
import { gmailEnabled, hasCalendarScope, personalKey } from "@/lib/gmail/config";
import { visitPeople } from "@/lib/drive-plan/stops";
import { allVisits } from "@/lib/stores/site-visits";
import { visitEventIds } from "@/lib/visit-invite-plan";
import type { Conflict } from "@/lib/visit-plan/check";

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
  /** Provider join URL extracted from the Google event, when present. */
  meetingUrl?: string;
  source: "google" | "visit" | "external" | "drive";
  /** Set only for source "external" — which connection/calendar this came
   *  from, and the color the client should render it in (the calendar's
   *  colorOverride if the user set one, else Google's own backgroundColor,
   *  else a client-side fallback). */
  external?: { connectionId: string; calendarId: string; color: string };
  /** Spec 2026-10-09 — set only for source "drive" (computed legs, never the
   *  Google copy). `flag` set = no minutes, render as a flag, not a block. */
  drive?: {
    dayKey: string;
    minutes: number | null;
    routeMin: number | null;
    bufferMin: number;
    flag: string | null;
    tight: string | null;
    fix: FixTarget | null;
    fromLabel: string;
    toLabel: string;
  };
  /** Spec 2026-10-09 — this visit/event's address isn't verified. */
  addressFlag?: { text: string; fix: FixTarget | null };
  /** Spec 2026-10-09 site-visit scheduling — conflicts on one of MY visits
   *  (set on its "v-" row and on its Google copies). Flags only. */
  conflicts?: Conflict[];
};

/** The drive sync's own Google events (private peakDrive tag) are left out
 *  of the Google feed — the app draws its drive blocks itself, so showing
 *  both would double every drive. */
export function withoutAppDriveEvents<T extends { peakDriveKey: string }>(evs: readonly T[]): T[] {
  return evs.filter((e) => !e.peakDriveKey);
}

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
  // Spec 2026-10-09 — the rep's own Google events (app drive events already
  // filtered out), the stop source for the computed drive layer below.
  const googleEvents: import("@/lib/google/calendar").CalendarEvent[] = [];
  if (gmailOn) {
    try {
      const { getConnectionInfo } = await import("@/lib/gmail/connections");
      const info = await getConnectionInfo(personalKey(userId));
      calendarOn = !!info && hasCalendarScope(info.scope);
      if (calendarOn) {
        const { listUpcomingEvents } = await import("@/lib/google/calendar");
        const evs = withoutAppDriveEvents(await listUpcomingEvents(personalKey(userId), {
          timeMinMs: minMs,
          timeMaxMs: maxMs,
          maxResults: 250,
        }));
        for (const e of evs) {
          fetchedIds.add(e.id);
          if (e.iCalUID) fetchedIcal.add(e.iCalUID);
          googleEvents.push(e);
          items.push({
            key: "g-" + e.id,
            id: e.id,
            title: e.title,
            startMs: e.startMs,
            endMs: e.endMs,
            allDay: e.allDay,
            location: e.location,
            href: e.htmlLink,
            meetingUrl: e.meetingUrl,
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
                const evs = withoutAppDriveEvents(await listEventsForExternalCalendar(conn.id, cal.id, {
                  timeMinMs: minMs,
                  timeMaxMs: maxMs,
                  maxResults: 250,
                }));
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
                    meetingUrl: e.meetingUrl,
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

  const allVisitsList = await allVisits();
  for (const v of allVisitsList) {
    // Spec 2026-10-09 site-visit scheduling — the lead's AND every attendee's agenda.
    if (!visitPeople(v).includes(me)) continue;
    // #34: unscheduled requests (null startAt) have no agenda slot yet.
    if (v.startAt == null) continue;
    const endMs = v.endAt ?? v.startAt;
    if (endMs < minMs || v.startAt > maxMs) continue;
    if (visitEventIds(v).some((id) => fetchedIds.has(id))) continue;
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
  // Spec 2026-10-09 — drive blocks + address flags, from the same stops.
  try {
    const { driveAgendaLayer } = await import("@/lib/drive-sync/agenda");
    const layer = await driveAgendaLayer({
      userId,
      minMs,
      maxMs,
      googleEvents: calendarOn ? googleEvents : null,
      // The visits read above — the drive layer must not re-read site_visits.
      deps: { visits: async () => allVisitsList },
    });
    items.push(...layer.items);
    for (const it of items) {
      const f = layer.addressFlags.get(it.key);
      if (f) it.addressFlag = f;
    }
    // Spec 2026-10-09 site-visit scheduling — conflict badges on my visits,
    // from the same plans (my own day only; no one else's calendar is read).
    try {
      const [{ agendaConflicts }, prefs] = await Promise.all([import("@/lib/visit-plan/agenda"), import("@/lib/stores/schedule-prefs")]);
      const [settings, hours] = await Promise.all([prefs.getSchedulingSettings(), prefs.workHoursFor(userId)]);
      const conflicts = agendaConflicts({
        me,
        plans: layer.plans,
        visits: allVisitsList,
        events: calendarOn ? googleEvents : null,
        hours,
        dailyDriveLimitMin: settings.dailyDriveLimitMin,
      });
      for (const it of items) {
        const c = conflicts.get(it.key);
        if (c?.length) it.conflicts = c;
      }
    } catch (err) {
      console.error("[agenda] conflict badges failed:", err);
    }
  } catch (err) {
    console.error("[agenda] drive layer failed:", err);
  }
  items.sort((a, b) => a.startMs - b.startMs);
  return { gmailOn, calendarOn, items };
}
