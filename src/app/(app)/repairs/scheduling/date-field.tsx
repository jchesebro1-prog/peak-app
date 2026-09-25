"use client";

import { useState } from "react";
import { VenueAvailabilityCheck } from "@/components/venue-availability-check";

/**
 * The repairs scheduler's popover is a plain server-rendered `<form
 * action={scheduleRepair}>` (URL-state popover, no client mutation) — this
 * wraps just its date input in a client component so the venue-calendar
 * check has something to react to. Still a real named form field
 * (`name="scheduledDate"`), so it submits exactly the same way a bare
 * `defaultValue` input would; only the value is now lifted into state.
 */
export function ScheduleDateField({
  locationId,
  defaultValue,
}: {
  locationId: string | null;
  defaultValue: string;
}) {
  const [date, setDate] = useState(defaultValue);
  return (
    <>
      <input
        type="date"
        name="scheduledDate"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        required
        style={{
          width: "100%",
          fontFamily: "var(--font-mono)",
          fontSize: 13.5,
          border: "1px solid #e4e7ec",
          borderRadius: 10,
          padding: "11px 12px",
          outline: "none",
          background: "#fff",
        }}
      />
      <VenueAvailabilityCheck locationId={locationId} start={date} />
    </>
  );
}
