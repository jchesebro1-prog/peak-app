"use client";

import { MAX_ATTENDEES } from "@/lib/visit-plan/people";

const lbl = { display: "block", fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".04em", textTransform: "uppercase", marginBottom: 5 } as const;

/** Other Peak people on the visit. The lead is never offered. */
export default function AttendeePicker({ lead, team, value, onChange }: { lead: string; team: string[]; value: string[]; onChange: (next: string[]) => void }) {
  const chosen = value.filter((n) => n !== lead);
  const options = team.filter((n) => n !== lead && !chosen.includes(n));
  return (
    <div>
      <span style={lbl}>Also going</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        {chosen.map((n) => (
          <span key={n} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, color: "#3a3f4a", background: "#f1f2f5", border: "1px solid #e4e7ec", borderRadius: 20, padding: "2px 4px 2px 9px" }}>
            {n}
            <button type="button" aria-label={`Remove ${n}`} onClick={() => onChange(chosen.filter((x) => x !== n))} style={{ border: "none", background: "transparent", color: "#8c919c", cursor: "pointer", fontSize: 12, lineHeight: 1 }}>
              ×
            </button>
          </span>
        ))}
        {options.length > 0 && chosen.length < MAX_ATTENDEES && (
          <select
            aria-label="Add a person"
            value=""
            onChange={(e) => e.target.value && onChange([...chosen, e.target.value])}
            className="pk-input"
            style={{ width: "auto", fontSize: 11.5, padding: "3px 6px" }}
          >
            <option value="">+ Add person</option>
            {options.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        )}
        {!chosen.length && !options.length && <span style={{ fontSize: 11.5, color: "#9aa0ab" }}>No one else on the team.</span>}
      </div>
    </div>
  );
}
