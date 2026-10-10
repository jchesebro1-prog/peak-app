"use client";

import { clockToMin, DAY_SHORT, minToClock, type WorkHours } from "@/lib/visit-plan/settings";

const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon first

/** Work days (toggle chips) + start/end times. Controlled. */
export default function WorkHoursEditor({ value, onChange, disabled = false }: { value: WorkHours; onChange: (next: WorkHours) => void; disabled?: boolean }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
      <div role="group" aria-label="Work days" style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {ORDER.map((d) => {
          const on = value.days.includes(d);
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => onChange({ ...value, days: on ? value.days.filter((x) => x !== d) : [...value.days, d].sort((a, b) => a - b) })}
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                padding: "4px 8px",
                borderRadius: 6,
                cursor: disabled ? "default" : "pointer",
                border: `1px solid ${on ? "var(--accent)" : "#e4e7ec"}`,
                background: on ? "color-mix(in srgb, var(--accent) 12%, #fff)" : "#fff",
                color: on ? "color-mix(in srgb, var(--accent) 70%, #000)" : "#5b616e",
              }}
            >
              {DAY_SHORT[d]}
            </button>
          );
        })}
      </div>
      <input
        type="time"
        aria-label="Start"
        className="pk-input"
        style={{ width: 110, fontSize: 12.5 }}
        disabled={disabled}
        value={minToClock(value.startMin)}
        onChange={(e) => {
          const m = clockToMin(e.target.value);
          if (m != null) onChange({ ...value, startMin: m });
        }}
      />
      <span style={{ fontSize: 12, color: "#9aa0ab" }}>to</span>
      <input
        type="time"
        aria-label="End"
        className="pk-input"
        style={{ width: 110, fontSize: 12.5 }}
        disabled={disabled}
        value={minToClock(value.endMin)}
        onChange={(e) => {
          const m = clockToMin(e.target.value);
          if (m != null) onChange({ ...value, endMin: m });
        }}
      />
    </div>
  );
}
