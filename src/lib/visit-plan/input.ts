/** Untrusted booking-check input → BookingCheckInput (spec 2026-10-09
 *  site-visit scheduling). Pure. */
import { cleanAttendees } from "./people";
import type { BookingCheckInput } from "./types";

const MAX_SPAN_MS = 24 * 3_600_000;

export function cleanBookingInput(raw: unknown, roster: readonly string[]): BookingCheckInput {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const s = num(r.startAt);
  const e = num(r.endAt);
  const timed = s != null && e != null && s > 0 && e > s && e - s <= MAX_SPAN_MS;
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
