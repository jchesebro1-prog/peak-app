"use client";

import type { ReactNode } from "react";
import type { PersonCheck } from "@/lib/visit-plan/check";

const lbl = { display: "block", fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".04em", textTransform: "uppercase", marginBottom: 5 } as const;
const muted = { fontSize: 11.5, color: "#9aa0ab" } as const;

/** Live conflicts, per person. Flags only — never blocks Schedule. */
export default function ConflictsPanel({ people, timed, loading, error }: { people: PersonCheck[]; timed: boolean; loading: boolean; error: string }) {
  let body: ReactNode;
  if (!timed) body = <span style={muted}>Pick a time to check conflicts.</span>;
  else if (error) body = <span style={muted}>{error}</span>;
  else if (!people.length) body = <span style={muted}>{loading ? "Checking…" : "No one to check yet."}</span>;
  else
    body = (
      <>
        {people.map((p) => (
          <div key={p.person} style={{ fontSize: 12, lineHeight: 1.5 }}>
            <span style={{ fontWeight: 600, color: "#16181d" }}>{p.person}</span>{" "}
            {p.conflicts.length === 0 && p.calendar !== "failed" && <span style={{ color: "#1f7a52" }}>No conflicts</span>}
            {p.conflicts.map((c, i) => (
              <div key={i} style={{ color: "#8a3a2a", fontWeight: 600 }}>
                ⚠ {c.text}
              </div>
            ))}
            {p.notes.map((n) => (
              <div key={n} style={muted}>
                {n}
              </div>
            ))}
          </div>
        ))}
        <div style={{ ...muted, marginTop: 4 }}>Conflicts never block scheduling.</div>
      </>
    );
  return (
    <div aria-busy={loading}>
      <span style={lbl}>Conflicts</span>
      <div aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 6, padding: "9px 11px", borderRadius: 9, background: "#fafbfc", border: "1px solid #eef0f3", opacity: loading && people.length ? 0.6 : 1 }}>
        {body}
      </div>
    </div>
  );
}
