/* "Older notes" (#344 R1) — answers from before a field was renamed or removed, shown read-only at the foot of their
   section. Derived on read by src/lib/survey-migrate.ts; nothing here is editable or saved. */
import type { LegacyNote } from "@/lib/survey-migrate";

export function OlderNotes({ notes }: { notes: LegacyNote[] }) {
  if (!notes.length) return null;
  return (
    <details style={{ marginTop: 14, border: "1px solid #ececf0", borderRadius: 9, padding: "8px 12px", background: "#fbfbfc" }}>
      <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "#8c919c" }}>Older notes ({notes.length})</summary>
      <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
        {notes.map((n, i) => (
          <div key={i} style={{ fontSize: 12.5, color: "#5b616e" }}>
            <span style={{ fontWeight: 600 }}>{n.label}:</span> {n.text}
          </div>
        ))}
      </div>
    </details>
  );
}
