"use client";

import { useState } from "react";
import { VenueAvailabilityCheck } from "@/components/venue-availability-check";

/**
 * Crew-board booking popover's "Start" field — same wrapping trick as the
 * repairs scheduler's date-field.tsx: the popover is a plain server-
 * rendered `<form action={bookCrew|updateBooking}>`, so this lifts just
 * the date input into a controlled one (still `name="start"`, still
 * submits normally) so the venue-calendar check has a value to react to.
 */
export function BookingDateField({
  locationId,
  defaultValue,
}: {
  locationId: string | null;
  defaultValue: string;
}) {
  const [start, setStart] = useState(defaultValue);
  return (
    <>
      <input
        type="date"
        name="start"
        value={start}
        onChange={(e) => setStart(e.target.value)}
        required
        style={{
          width: "100%",
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          border: "1px solid #e4e7ec",
          borderRadius: 10,
          padding: "11px 12px",
          outline: "none",
          background: "#fff",
        }}
      />
      <VenueAvailabilityCheck locationId={locationId} start={start} compact />
    </>
  );
}
