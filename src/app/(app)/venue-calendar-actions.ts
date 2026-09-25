"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { getSiteByDocLocId } from "@/lib/identity/sites";
import {
  addWindow,
  getVenueCalendar,
  hasVenueCalendar,
  importCsvWindows,
  refreshIcs,
  refreshIfStale,
  removeWindow,
  setIcsUrl,
} from "@/lib/stores/venue-calendars";
import {
  checkAvailability,
  windowsBetween,
  DEFAULT_TZ,
  type AvailabilityCheck,
  type AvailWindow,
  type VenueCalendar,
} from "@/lib/venue-availability";

/**
 * Server actions behind the venue calendar feature: the Venue page's editor
 * (feed URL, CSV import, manual windows) and the "does the venue's calendar
 * show this time open?" check every scheduler's date picker calls. Every
 * action re-derives its own office timezone from Settings (same
 * try/validate/fallback the dashboard greeting uses,
 * src/app/(app)/page.tsx) rather than trusting a client-supplied one, since
 * an .ics all-day event or a CSV date cell has to resolve against the
 * business's own calendar day, not the visitor's browser zone.
 */

async function officeTimeZone(): Promise<string> {
  const settings = await getSettings();
  const office = settings.offices.find((o) => o.quoteDefault) || settings.offices[0];
  let tz = office?.timezone || DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format();
  } catch {
    tz = DEFAULT_TZ;
  }
  return tz;
}

function revalidateVenue(locationId: string): void {
  revalidatePath("/venues");
  // best-effort — the calendar is keyed by locationId, not the route's
  // sites.id, so this only actually matches when they're the same (a
  // non-migrated venue); getSiteByDocLocId callers refresh their own page
  // via router.refresh() regardless.
  revalidatePath(`/venues/${encodeURIComponent(locationId)}`);
}

export type VenueAvailabilityResult = {
  hasCalendar: boolean;
  check: AvailabilityCheck;
  windows: AvailWindow[];
  venueName?: string;
  /** `/venues/<sites.id>#calendar` for the resolved venue, or null when
   *  `locationId` doesn't match any site (so the "Add one" hint has
   *  nothing sensible to link to and the caller should omit it). */
  venueHref: string | null;
};

/** Sunday-start week (the app's own convention — see gantt-lib.ts's
 *  `noonOfWeekStart`) containing `ms`, as [start, end) day boundaries. */
function weekRange(ms: number): { start: number; end: number } {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  const start = d.getTime();
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end: end.getTime() };
}

/** The scheduling-popover check: does this venue's calendar show
 *  [startMs, endMs) as open? Refreshes a stale ics feed best-effort first,
 *  but never waits more than ~2.5s for it (refreshIfStale) — the popover
 *  answers from whatever's on file rather than making every date-field
 *  edit wait out a slow or broken feed's own (longer) fetch timeout. */
export async function getVenueAvailabilityAction(
  locationId: string | null,
  startMs: number,
  endMs: number
): Promise<VenueAvailabilityResult> {
  const user = await requireUser();
  if (!locationId || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return { hasCalendar: false, check: { status: "none", conflicts: [] }, windows: [], venueHref: null };
  }
  const cal = await refreshIfStale(locationId, user.name);
  const { start, end } = weekRange(startMs);
  const site = await getSiteByDocLocId(locationId);
  return {
    hasCalendar: !!cal.icsUrl || cal.windows.length > 0 || cal.icsWindows.length > 0,
    check: checkAvailability(cal, startMs, endMs),
    windows: windowsBetween(cal, start, end),
    venueName: site?.name || undefined,
    venueHref: site ? `/venues/${encodeURIComponent(site.id)}` : null,
  };
}

export async function getVenueCalendarAction(locationId: string): Promise<VenueCalendar> {
  await requireUser();
  return getVenueCalendar(locationId);
}

function validSpan(startAt: unknown, endAt: unknown): { start: number; end: number } | null {
  const start = Number(startAt);
  const end = Number(endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  // A single window longer than 5 years is almost certainly a typo
  // (year/month swapped, or a missing end-date bump) — refuse rather than
  // silently storing a decade-long "blocked" that swallows every future
  // booking check.
  if (end - start > 5 * 366 * 86400000) return null;
  return { start, end };
}

/** Every mutating action below returns the full, fresh `VenueCalendar` (not
 *  just an ok flag) so the venue page's client card can update in place
 *  from the action's own response instead of a second round trip — it
 *  still calls `router.refresh()` too, so the server-rendered parts of the
 *  page (and any other tab open on it) pick up the change as well. */

export async function addWindowAction(
  locationId: string,
  input: { kind: "open" | "blocked"; start: number; end: number; allDay: boolean; label: string }
): Promise<{ ok: true; cal: VenueCalendar } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!locationId) return { ok: false, error: "Missing venue." };
  const span = validSpan(input.start, input.end);
  if (!span) return { ok: false, error: "End must be after start (and within five years)." };
  if (input.kind !== "open" && input.kind !== "blocked") return { ok: false, error: "Pick open or blocked." };
  const cal = await addWindow(locationId, { ...input, start: span.start, end: span.end }, user.name);
  revalidateVenue(locationId);
  return { ok: true, cal };
}

export async function removeWindowAction(
  locationId: string,
  windowId: string
): Promise<{ ok: true; cal: VenueCalendar } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!locationId || !windowId) return { ok: false, error: "Missing window." };
  const cal = await removeWindow(locationId, windowId, user.name);
  revalidateVenue(locationId);
  return { ok: true, cal };
}

export async function importCsvAction(
  locationId: string,
  text: string,
  mode: "append" | "replace-csv"
): Promise<{ ok: true; cal: VenueCalendar; imported: number; errors: { line: number; message: string }[] } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!locationId) return { ok: false, error: "Missing venue." };
  if (!text || !text.trim()) return { ok: false, error: "Nothing to import." };
  const tz = await officeTimeZone();
  const { cal, errors } = await importCsvWindows(locationId, text, mode, user.name, tz);
  revalidateVenue(locationId);
  const imported = cal.windows.filter((w) => w.source === "csv").length;
  return { ok: true, cal, imported, errors };
}

export async function setIcsUrlAction(
  locationId: string,
  url: string | null
): Promise<{ ok: true; cal: VenueCalendar } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!locationId) return { ok: false, error: "Missing venue." };
  const cal = await setIcsUrl(locationId, url, user.name);
  revalidateVenue(locationId);
  return { ok: true, cal };
}

export async function refreshIcsAction(
  locationId: string
): Promise<{ ok: true; cal: VenueCalendar } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!locationId) return { ok: false, error: "Missing venue." };
  const cal = await refreshIcs(locationId, user.name);
  revalidateVenue(locationId);
  return { ok: true, cal };
}

/** Server-side pass-through so a client editor can offer the existence
 *  check without importing the store module directly (kept consistent with
 *  the rest of this file's "every mutation/read goes through an action"
 *  shape, and gives the company-record venue row one cheap call instead of
 *  a full getVenueCalendarAction fetch of the whole windows array). */
export async function hasVenueCalendarAction(locationId: string): Promise<boolean> {
  await requireUser();
  if (!locationId) return false;
  return hasVenueCalendar(locationId);
}
