import { getBlob, setBlob } from "@/db/doc-store";
import {
  DEFAULT_TZ,
  emptyVenueCalendar,
  newWindowId,
  parseAvailabilityCsv,
  type AvailWindow,
  type VenueCalendar,
} from "@/lib/venue-availability";
import { fetchIcsWindows } from "@/lib/venue-calendar-fetch";

/**
 * Per-venue availability calendars — one keyed blob per venue
 * (`venue_calendar:<locationId>`, no migration needed), same pattern as
 * studio-designs.ts. `locationId` is what jobs/quotes already carry as
 * their own `locationId` field: `sites.legacyLocId ?? sites.id` (docLocId,
 * see src/lib/identity/sites.ts) — the id every scheduler and the Grid's
 * own scope already key off, so a calendar saved from the venue page is
 * found by every "does this venue have availability?" check without a
 * second lookup table.
 */

function blobId(locationId: string): string {
  return `venue_calendar:${locationId}`;
}

/** Never null — a venue with nothing on file just reads as an empty
 *  calendar (no windows, no feed), same "absent = defaults" contract every
 *  other blob store in this app uses. */
export async function getVenueCalendar(locationId: string): Promise<VenueCalendar> {
  return getBlob<VenueCalendar>(blobId(locationId), emptyVenueCalendar(locationId));
}

/** Whether a venue has ANY calendar data at all — cheap existence check for
 *  a list view (the company record's venue rows) that doesn't want the
 *  whole windows array per row. */
export async function hasVenueCalendar(locationId: string): Promise<boolean> {
  const cal = await getVenueCalendar(locationId);
  return !!cal.icsUrl || cal.windows.length > 0 || cal.icsWindows.length > 0;
}

async function saveVenueCalendar(cal: VenueCalendar, by: string): Promise<VenueCalendar> {
  const next: VenueCalendar = { ...cal, updatedAt: Date.now(), updatedBy: by };
  await setBlob(blobId(cal.locationId), next);
  return next;
}

export async function addWindow(
  locationId: string,
  input: { kind: "open" | "blocked"; start: number; end: number; allDay: boolean; label: string },
  by: string
): Promise<VenueCalendar> {
  const cal = await getVenueCalendar(locationId);
  const w: AvailWindow = {
    id: newWindowId(),
    kind: input.kind,
    start: input.start,
    end: input.end,
    allDay: input.allDay,
    label: (input.label || "").trim(),
    source: "manual",
  };
  return saveVenueCalendar({ ...cal, windows: [...cal.windows, w] }, by);
}

/** Only a manual or csv-sourced window can be removed here — an ics window
 *  is derived from the feed and comes back on the next refresh regardless,
 *  so "delete" for one of those means "remove the feed" (setIcsUrl(null))
 *  or fix the source calendar, not a per-window action. */
export async function removeWindow(locationId: string, windowId: string, by: string): Promise<VenueCalendar> {
  const cal = await getVenueCalendar(locationId);
  return saveVenueCalendar({ ...cal, windows: cal.windows.filter((w) => w.id !== windowId) }, by);
}

/**
 * Import CSV-sourced windows. `append` adds to whatever csv/manual windows
 * already exist; `replace-csv` drops only the previously-imported CSV rows
 * (manual ones are untouched) before adding the new ones — so re-importing
 * a corrected file doesn't require re-entering anything typed by hand.
 */
export async function importCsvWindows(
  locationId: string,
  text: string,
  mode: "append" | "replace-csv",
  by: string,
  tz: string = DEFAULT_TZ
): Promise<{ cal: VenueCalendar; errors: { line: number; message: string }[] }> {
  const { windows: parsed, errors } = parseAvailabilityCsv(text, tz);
  const cal = await getVenueCalendar(locationId);
  const kept = mode === "replace-csv" ? cal.windows.filter((w) => w.source !== "csv") : cal.windows;
  const next = await saveVenueCalendar({ ...cal, windows: [...kept, ...parsed] }, by);
  return { cal: next, errors };
}

/** Save (or clear) the feed URL, then best-effort refresh it immediately so
 *  Save reads as "synced", not just "typed". A bad URL is saved anyway
 *  (Settings-style "keep what was typed, show the error") — refreshIcs
 *  records `icsError` rather than throwing. */
export async function setIcsUrl(locationId: string, url: string | null, by: string): Promise<VenueCalendar> {
  const cal = await getVenueCalendar(locationId);
  const trimmed = url && url.trim() ? url.trim() : null;
  const next = await saveVenueCalendar(
    { ...cal, icsUrl: trimmed, icsError: trimmed ? cal.icsError : null, icsWindows: trimmed ? cal.icsWindows : [] },
    by
  );
  if (!trimmed) return next;
  return refreshIcs(locationId, by);
}

/**
 * Re-fetch+parse the feed. Never throws to the caller: on any failure the
 * PREVIOUS icsWindows are kept (a flaky feed shouldn't make a venue look
 * suddenly wide open) and `icsError` records what happened.
 */
export async function refreshIcs(locationId: string, by: string, tz?: string): Promise<VenueCalendar> {
  const cal = await getVenueCalendar(locationId);
  if (!cal.icsUrl) return cal;
  try {
    const result = await fetchIcsWindows(cal.icsUrl, tz);
    if (result.ok) {
      return saveVenueCalendar({ ...cal, icsWindows: result.windows, icsFetchedAt: Date.now(), icsError: null }, by);
    }
    return saveVenueCalendar({ ...cal, icsFetchedAt: Date.now(), icsError: result.error }, by);
  } catch (err) {
    return saveVenueCalendar(
      { ...cal, icsFetchedAt: Date.now(), icsError: err instanceof Error ? err.message : "Sync failed." },
      by
    );
  }
}

const REFRESH_STALE_MS = 6 * 3600000;

/** A calendar with a feed whose last fetch is stale (or has never
 *  happened). Used by the availability action to opportunistically
 *  refresh before answering, without ever letting a slow/broken feed block
 *  the check beyond fetchIcsWindows's own timeout. */
export function icsIsStale(cal: VenueCalendar): boolean {
  return !!cal.icsUrl && (cal.icsFetchedAt == null || Date.now() - cal.icsFetchedAt > REFRESH_STALE_MS);
}
