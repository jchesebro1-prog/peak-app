import Link from "next/link";
import { requireUser } from "@/lib/session";
import { PRODIGY_HOISTS, FAM_NOTES, fmt } from "@/lib/design/steel";

export const metadata = { title: "Motor Library — Peak Backend" };

/**
 * Motor Library — the ETC Prodigy motorized-hoist breakdown ported from the
 * Peak Steel Calculator's Motorized Hoists tab. Reference data for design.
 */

const LOADING = [
  { k: "Min load per line", v: "25 lb (P1/P2) · 30 lb (P75)" },
  { k: "Max load per line", v: "420 lb (P1/P2) · 700 lb (P75)" },
  { k: "Max lift lines / hoist", v: "8 (7 with cable management)" },
  { k: "First loft block from powerhead", v: "≥ 4 ft (1 in with optional mule block)" },
  { k: "Loft-block spacing", v: "≥ 4 ft between blocks (≥ 8 ft to 2nd block if mule block used)" },
  { k: "Max block spacing — 1½″ Sch-40 pipe batten", v: "12 ft" },
  { k: "Max block spacing — ETC WebPipe batten", v: "10 ft" },
];

const SAFETY = [
  { k: "Beam clamps required", v: "1 @ powerhead + 1 per tube section" },
  { k: "Beam-clamp spacing", v: "≤ 14 ft on center" },
  { k: "Compression-tube weight", v: "3.5 lb/ft (5.2 kg/m)" },
  { k: "Mounting brackets", v: "W- / S- / I-beam · bar joist · Unistrut" },
];

const FAM_ORDER = ["P1", "P2", "P75"] as const;

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #ececf0",
  borderRadius: 12,
  padding: "16px 18px",
  boxShadow: "0 1px 2px rgba(0,0,0,.04)",
};
const th: React.CSSProperties = {
  textAlign: "left",
  fontSize: 10.5,
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "#9aa0ab",
  padding: "6px 10px",
  borderBottom: "1px solid #eef0f3",
};
const td: React.CSSProperties = { fontSize: 13, padding: "8px 10px", borderBottom: "1px solid #f4f5f7" };

export default async function MotorLibraryPage() {
  await requireUser();
  return (
    <div className="pk-content" style={{ maxWidth: 900 }}>
      <div style={{ marginBottom: 14 }}>
        <Link href="/design" style={{ fontSize: 12.5, fontWeight: 600, color: "#8c919c", textDecoration: "none" }}>
          ← Design Studio
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>Motor Library</h1>
        <p style={{ color: "#6b7079", fontSize: 13.5, marginTop: 3 }}>
          ETC Prodigy motorized hoists — capacities, powerhead weights, per-line limits, and speeds.
        </p>
      </div>

      {FAM_ORDER.map((fam) => {
        const rows = PRODIGY_HOISTS.filter((h) => h.fam === fam);
        if (!rows.length) return null;
        return (
          <div key={fam} style={{ ...card, marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{FAM_NOTES[fam]}</div>
            <div style={{ overflowX: "auto", marginTop: 10 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
                <thead>
                  <tr>
                    <th style={th}>Model</th>
                    <th style={{ ...th, textAlign: "right" }}>Capacity</th>
                    <th style={{ ...th, textAlign: "right" }}>Powerhead wt</th>
                    <th style={{ ...th, textAlign: "right" }}>Per-line</th>
                    <th style={{ ...th, textAlign: "right" }}>Speed</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((h) => (
                    <tr key={h.id}>
                      <td style={td}>{h.name.replace(/^P\d+ · /, "")}</td>
                      <td style={{ ...td, textAlign: "right", fontFamily: "var(--font-mono)" }}>{fmt(h.cap)} lb</td>
                      <td style={{ ...td, textAlign: "right", fontFamily: "var(--font-mono)" }}>{fmt(h.pw)} lb</td>
                      <td style={{ ...td, textAlign: "right", fontFamily: "var(--font-mono)" }}>
                        {h.perMin}–{h.perMax} lb
                      </td>
                      <td style={{ ...td, textAlign: "right" }}>{h.speed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
        <div style={card}>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 8 }}>Loading &amp; placement (lift lines)</div>
          {LOADING.map((r) => (
            <div key={r.k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", borderBottom: "1px solid #f4f5f7", fontSize: 12.5 }}>
              <span style={{ color: "#6b7079" }}>{r.k}</span>
              <span style={{ fontWeight: 600, textAlign: "right" }}>{r.v}</span>
            </div>
          ))}
        </div>
        <div style={card}>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 8 }}>Compression tube &amp; safety</div>
          {SAFETY.map((r) => (
            <div key={r.k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", borderBottom: "1px solid #f4f5f7", fontSize: 12.5 }}>
              <span style={{ color: "#6b7079" }}>{r.k}</span>
              <span style={{ fontWeight: 600, textAlign: "right" }}>{r.v}</span>
            </div>
          ))}
          <div style={{ fontSize: 12.5, fontWeight: 700, margin: "12px 0 6px" }}>Standard safety features</div>
          <p style={{ fontSize: 12, color: "#5b616e", lineHeight: 1.5, margin: 0 }}>
            Dual braking (motor brake + redundant load-side mechanical brake) · rotary limit switches
            (upper, upper-overtravel, lower, lower-overtravel) · slack-line detection · load cell with
            load profiling &amp; continuous overload monitoring · hardwired E-stop per hoist · integrated
            overcurrent protection.
          </p>
        </div>
      </div>

      <p style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 16, lineHeight: 1.5 }}>
        Sources: ETC Prodigy P1 Family Datasheet (rev B); Prodigy P2 Datasheet (rev D); Prodigy P75
        Family Datasheet (rev D). Reference only — confirm against current ETC datasheets and a
        licensed PE for any life-safety installation.
      </p>
    </div>
  );
}
