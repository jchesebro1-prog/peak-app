import { gmailEnabled, hasCalendarScope, personalKey } from "@/lib/gmail/config";
import { allVisits } from "@/lib/stores/site-visits";

/**
 * Shared agenda assembly (D77/D81): the signed-in user's Google Calendar
 * merged with Peak site visits assigned to them, over an arbitrary window.
 * Used by the Home dashboard card (next 14 days) and the full-page /calendar
 * month view (S13). Dedup is fetch-aware — a visit pushed to Google whose
 * event didn't come back THIS load still shows from local data, and an
 * accepted .ics invite is matched by its sv-<id>@peak-app iCalUID.
 */

export type AgendaItem = {
  key: string;
  title: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  location: string;
  /** external Google link or internal path ("" = not clickable) */
  href: string;
  source: "google" | "visit";
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
  for (const v of await allVisits()) {
    if (v.assignedTo !== me) continue;
    if (v.endAt < minMs || v.startAt > maxMs) continue;
    if (v.googleEventId && fetchedIds.has(v.googleEventId)) continue;
    if (fetchedIcal.has("sv-" + v.id + "@peak-app")) continue;
    items.push({
      key: "v-" + v.id,
      title: (v.venue || v.customer) + " — " + v.reason,
      startMs: v.startAt,
      endMs: v.endAt,
      allDay: false,
      location: v.address,
      href: "/customers/" + encodeURIComponent(v.customerId),
      source: "visit",
    });
  }
  items.sort((a, b) => a.startMs - b.startMs);
  return { gmailOn, calendarOn, items };
}
