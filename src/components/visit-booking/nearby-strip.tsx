"use client";

import type { ReactNode } from "react";
import { calendarNote } from "@/lib/visit-plan/check";
import { NEARBY_TEXT, nearbyLine, type NearbyResult } from "@/lib/visit-plan/nearby";

const lbl = { display: "block", fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".04em", textTransform: "uppercase", marginBottom: 5 } as const;
const muted = { fontSize: 11.5, color: "#9aa0ab" } as const;

/** Days the lead is already nearby. One click fills the date; the rep still picks the time. */
export default function NearbyStrip({ nearby, loading, lead, onPick, error = "" }: { nearby: NearbyResult | null; loading: boolean; lead: string; error?: string; onPick: (dayKey: string) => void }) {
  let body: ReactNode;
  // The lead's calendar caveats ride along with the days (never silent).
  const notes: string[] = [];
  if (nearby && nearby.status !== "unverified") {
    if (nearby.note) notes.push(nearby.note);
    else if (nearby.leadCalendar === "no-calendar") notes.push(calendarNote(lead || "The lead", "no-calendar") ?? "");
  }
  if (!nearby) body = <span style={muted}>{error ? NEARBY_TEXT.unavailable : loading ? "Looking for nearby days…" : ""}</span>;
  else if (nearby.status === "unverified") body = <span style={muted}>{NEARBY_TEXT.unverified}</span>;
  else if (nearby.status === "unavailable") body = <span style={muted}>{NEARBY_TEXT.unavailable}</span>;
  else if (!nearby.days.length) body = <span style={muted}>{`No days in the next ${nearby.lookaheadDays} with a stop nearby.`}</span>;
  else
    body = nearby.days.map((d) => (
      <button
        key={d.dayKey}
        type="button"
        onClick={() => onPick(d.dayKey)}
        title="Use this date — you still pick the time"
        style={{ textAlign: "left", display: "flex", flexDirection: "column", gap: 2, padding: "7px 10px", borderRadius: 8, border: "1px solid #e4e7ec", background: "#fff", cursor: "pointer" }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: "#16181d" }}>{nearbyLine(d)}</span>
        {d.others.length > 0 && (
          <span style={muted}>
            {d.others
              // An unknown status is a failed calendar read: the spec's own words.
              .map((o) => (o.status === "unknown" ? calendarNote(o.person, "failed") : `${o.person} ${o.status}${o.note ? ` (${o.note})` : ""}`))
              .join(" · ")}
          </span>
        )}
      </button>
    ));
  return (
    <div aria-busy={loading}>
      <span style={lbl}>Nearby days</span>
      <div aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 6, opacity: loading && nearby ? 0.6 : 1 }}>
        {body}
        {notes.filter(Boolean).map((n) => (
          <span key={n} style={muted}>
            {n}
          </span>
        ))}
      </div>
    </div>
  );
}
