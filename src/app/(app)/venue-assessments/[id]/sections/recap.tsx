/* Customer recap (#342 A7) — the end-of-visit read-back: per discipline in scope, what the customer said they're
   interested in and their goals, in larger type so the rep can read it aloud. Read-only. */
import { recapFor } from "@/lib/survey-flow";
import type { Draft } from "./types";

export function RecapSection({ draft }: { draft: Draft }) {
  const entries = recapFor(draft);
  if (!entries.length) {
    return <div style={{ fontSize: 14, color: "#9aa0ab" }}>Nothing to read back yet — pick a scope in Kill questions, then capture scopes of interest and client goals in each discipline.</div>;
  }
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ fontSize: 12, color: "#8c919c" }}>What we heard — read this back to the customer.</div>
      {entries.map((e) => (
        <div key={e.disc}>
          <div style={{ fontSize: 16, fontWeight: 650, marginBottom: 6 }}>{e.label}</div>
          {e.scopes.length > 0 || e.other ? (
            <div style={{ fontSize: 16, lineHeight: 1.5, color: "#16181d" }}>
              Interested in: {[...e.scopes.filter((s) => s !== "Other"), e.other ? `Other — ${e.other}` : ""].filter(Boolean).join(", ")}
            </div>
          ) : (
            <div style={{ fontSize: 14, color: "#9aa0ab" }}>No scopes of interest captured.</div>
          )}
          {e.goals.length > 0 && (
            <ul style={{ margin: "8px 0 0", paddingLeft: 20, fontSize: 16, lineHeight: 1.55 }}>
              {e.goals.map((g, i) => <li key={i}>{g}</li>)}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
