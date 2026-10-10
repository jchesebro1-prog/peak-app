"use client";

import AttendeePicker from "./attendee-picker";
import ConflictsPanel from "./conflicts-panel";
import NearbyStrip from "./nearby-strip";
import { useBookingCheck, type BookingCheckArgs } from "./use-booking-check";

export type BookingPanelProps = BookingCheckArgs & {
  team: string[];
  onAttendeesChange: (next: string[]) => void;
  onPickDay: (dayKey: string) => void;
};

/** Spec 2026-10-09 site-visit scheduling — the booking screen: attendee
 *  picker, Nearby days strip and live conflicts. Advisory only. */
export default function BookingPanel(p: BookingPanelProps) {
  const check = useBookingCheck({
    visitId: p.visitId,
    customerId: p.customerId,
    locationId: p.locationId,
    address: p.address,
    startAt: p.startAt,
    endAt: p.endAt,
    lead: p.lead,
    attendees: p.attendees,
  });
  const timed = p.startAt != null && p.endAt != null && p.endAt > p.startAt;
  return (
    <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
      <AttendeePicker lead={p.lead} team={p.team} value={p.attendees} onChange={p.onAttendeesChange} />
      <NearbyStrip nearby={check.result?.nearby ?? null} loading={check.loading} lead={p.lead} error={check.error} onPick={p.onPickDay} />
      <ConflictsPanel people={check.result?.people ?? []} timed={timed} loading={check.loading} error={check.error} />
    </div>
  );
}
