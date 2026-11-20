/** Plain site-visit field helpers: attendee names and the time-range rule. Pure and client-safe. */
export const MAX_ATTENDEES = 8;

/** Write-side cleaning: trimmed, deduped, roster-only, never the lead, capped. */
export function cleanAttendees(raw: unknown, lead: string, roster: readonly string[]): string[] {
  if (!Array.isArray(raw)) return [];
  const leadName = (lead || "").trim();
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const name = v.trim();
    if (!name || name === leadName || out.includes(name) || !roster.includes(name)) continue;
    out.push(name);
    if (out.length >= MAX_ATTENDEES) break;
  }
  return out;
}

/** Read-side normalizing for stored docs (pre-spec-2 visits have no field). */
export function readAttendees(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const s = v.trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

const MAX_SPAN_MS = 24 * 3_600_000;

/** A visit's time range: starts after the epoch, ends after it starts, and
 *  spans at most 24 h. */
export function validVisitSpan(startAt: unknown, endAt: unknown): boolean {
  return typeof startAt === "number" && typeof endAt === "number" && startAt > 0 && endAt > startAt && endAt - startAt <= MAX_SPAN_MS;
}
