import { formatMeasure, type MeasureUnit } from "@/lib/annotations";
import type { ScheduleData } from "@/lib/design/grid-schedule";

/**
 * The equipment schedule's tables (#299, moved out of schedule/page.tsx
 * unchanged): one table per area (Qty · Part · Description), the wire runs
 * (Wire · Run · Length), then the unit/area/footage totals. Rendered by the
 * printable /schedule page and by the editor's Spreadsheet view, so the two
 * never differ. Server-safe AND client-safe: no hooks, no "use client", and
 * nothing server-only imported — the client Spreadsheet view imports it.
 */
export default function ScheduleTable({ schedule, accent }: { schedule: ScheduleData; accent: string }) {
  const { sections, wires, unitCount, wireFeet } = schedule;

  const th: React.CSSProperties = {
    textAlign: "left",
    fontSize: "9pt",
    letterSpacing: ".08em",
    textTransform: "uppercase",
    color: "#666",
    borderBottom: "1.5px solid #1a1a1a",
    padding: "3px 8px 5px 0",
    fontFamily: "var(--font-ui), sans-serif",
  };
  const td: React.CSSProperties = {
    padding: "5px 8px 5px 0",
    borderBottom: "1px solid #e2e2e6",
    fontSize: "11.5pt",
    verticalAlign: "top",
  };
  const sectionHead: React.CSSProperties = {
    fontFamily: "var(--font-ui), sans-serif",
    fontSize: "10.5pt",
    fontWeight: 700,
    letterSpacing: ".04em",
    textTransform: "uppercase",
    color: "#1a1a1a",
    borderBottom: `2px solid ${accent}`,
    display: "inline-block",
    paddingBottom: 1,
    marginBottom: 6,
  };

  if (sections.length === 0 && wires.length === 0) return <p style={{ color: "#666" }}>Nothing on the plans yet.</p>;

  return (
    <>
      {sections.map((sec) => (
        <div key={sec.key} style={{ marginBottom: 16 }}>
          <div style={sectionHead}>{sec.name}</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 54 }}>Qty</th>
                <th style={{ ...th, width: 150 }}>Part</th>
                <th style={th}>Description</th>
              </tr>
            </thead>
            <tbody>
              {sec.rows.map((r) => (
                <tr key={r.partId}>
                  <td style={td}>{r.qty}</td>
                  <td style={{ ...td, fontFamily: "var(--font-mono), monospace", fontSize: "10pt" }}>{r.code || r.partId}</td>
                  <td style={td}>{r.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {wires.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={sectionHead}>Wire runs</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 150 }}>Wire</th>
                <th style={th}>Run</th>
                <th style={{ ...th, width: 110 }}>Length</th>
              </tr>
            </thead>
            <tbody>
              {wires.map((e) => (
                <tr key={e.id}>
                  <td style={{ ...td, fontFamily: "var(--font-mono), monospace", fontSize: "10pt" }}>{e.partId}</td>
                  <td style={td}>{e.fromName} → {e.toName}</td>
                  <td style={td}>{e.lengthFt !== null ? formatMeasure(e.lengthFt, e.unit as MeasureUnit) : "unmeasured"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ borderTop: "1.5px solid #1a1a1a", marginTop: 20, paddingTop: 8, fontSize: "10.5pt", color: "#444" }}>
        <strong>{unitCount}</strong> unit{unitCount === 1 ? "" : "s"} across{" "}
        <strong>{sections.length}</strong> area{sections.length === 1 ? "" : "s"}
        {wireFeet.map((w) => (
          <span key={w.partId}>
            {" · "}
            <strong>{Math.ceil(w.ft)} {w.unit}</strong> {w.partId}
            {w.unmeasured > 0 ? ` (+${w.unmeasured} unmeasured)` : ""}
          </span>
        ))}
      </div>
    </>
  );
}
