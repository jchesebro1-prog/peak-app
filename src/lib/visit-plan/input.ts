/** Untrusted booking-check input → BookingCheckInput (spec 2026-10-09
 *  site-visit scheduling). Pure. */
import { cleanAttendees } from "./people";
import type { BookingCheckInput } from "./types";

const MAX_SPAN_MS = 24 * 3_600_000;

/** A visit's time range: starts after the epoch, ends after it starts, and
 *  spans at most 24 h. The one rule for booking checks, scheduling and edits. */
export function validVisitSpan(startAt: unknown, endAt: unknown): boolean {
  return typeof startAt === "number" && typeof endAt === "number" && startAt > 0 && endAt > startAt && endAt - startAt <= MAX_SPAN_MS;
}

/** The longest `input` query param GET /api/visits/check accepts. */
export const MAX_BOOKING_PARAM_CHARS = 4000;

/** GET /api/visits/check's `input` param (JSON) → cleaned input; null when
 *  missing, oversized, not JSON or not an object. */
export function parseBookingCheckParam(raw: string | null, roster: readonly string[]): BookingCheckInput | null {
  if (!raw || raw.length > MAX_BOOKING_PARAM_CHARS) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return cleanBookingInput(parsed, roster);
}

export function cleanBookingInput(raw: unknown, roster: readonly string[]): BookingCheckInput {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const s = num(r.startAt);
  const e = num(r.endAt);
  const timed = validVisitSpan(s, e);
  const lead = text(r.lead, 120);
  return {
    visitId: text(r.visitId, 40) || null,
    customerId: text(r.customerId, 200) || null,
    locationId: text(r.locationId, 200) || null,
    address: text(r.address, 300),
    startAt: timed ? s : null,
    endAt: timed ? e : null,
    lead: roster.includes(lead) ? lead : "",
    attendees: cleanAttendees(r.attendees, lead, roster),
  };
}
