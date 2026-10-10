/** Booking-check shapes shared by the server loader, the action and the
 *  booking UI (spec 2026-10-09 site-visit scheduling). Types only. */
import type { FixTarget, GeoStatus } from "@/lib/address-verify/types";
import type { PersonCheck } from "./check";
import type { NearbyResult } from "./nearby";

export type BookingCheckInput = {
  /** set when editing an existing visit — it's left out of everyone's day */
  visitId: string | null;
  customerId: string | null;
  locationId: string | null;
  address: string;
  startAt: number | null;
  endAt: number | null;
  /** the lead's name ("" when none picked) */
  lead: string;
  attendees: string[];
};

export type BookingCheckResult = {
  address: { status: GeoStatus; fix: FixTarget | null };
  /** one row per person, lead first; [] until a time is picked */
  people: PersonCheck[];
  /** null when not asked for (conflict badges) */
  nearby: NearbyResult | null;
  checkedAt: number;
};
