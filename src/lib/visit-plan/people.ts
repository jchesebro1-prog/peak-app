/**
 * Who's on a site visit besides its lead (spec 2026-10-09 site-visit
 * scheduling, Part 1 "Attendees"). Pure and client-safe. People are NAMES
 * (app convention). visitPeople() in src/lib/drive-plan/stops.ts stays the
 * one place that turns lead + attendees into "everyone the visit is a stop for".
 */
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
