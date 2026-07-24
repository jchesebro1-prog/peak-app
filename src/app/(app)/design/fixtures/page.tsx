import Link from "next/link";
import { requireUser } from "@/lib/session";
import data from "@/lib/design/fixture-crossref.json";

export const metadata = { title: "Fixture Cross-Reference — Quartzite" };

/**
 * Fixture Cross-Reference (punch #26) — the 7 ETC-anchored competitive matrices
 * (Ellipsoidal, Console, PAR, Cyc, Fresnel, Spot/Wash Mover) surfaced as an
 * in-app sales reference, mirroring the Motor Library pattern. Data compiled
 * from the Peak Knowledge cross-reference workbooks; INTERNAL sales tool.
 */

type Sheet = { header: string[]; rows: string[][] };
type Cat = { key: string; name: string; spec: Sheet; equivalents: Sheet; specCount: number; equivCount: number };
const CATS = (data.categories as Cat[]) || [];

const card: React.CSSProperties = { background: "#fff", border: "1px solid #ececf0", borderRadius: 12, padding: "16px 18px", boxShadow: "0 1px 2px rgba(0,0,0,.04)", marginBottom: 18 };
const th: React.CSSProperties = { textAlign: "left", fontSize: 10, fontWeight: 700, color: "#9aa0ab", letterSpacing: ".04em", textTransform: "uppercase", padding: "6px 8px", borderBottom: "1px solid #ececf0", verticalAlign: "bottom", position: "sticky", top: 0, background: "#fff" };
const td: React.CSSProperties = { fontSize: 11.5, color: "#3a3f47", padding: "6px 8px", borderBottom: "1px solid #f3f4f7", verticalAlign: "top", lineHeight: 1.4 };

function isDivider(row: string[]): boolean {
  return !!row[0] && !row[1] && !row[2];
}

function Matrix({ sheet }: { sheet: Sheet }) {
  if (!sheet.header.length) return null;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 640 }}>
        <thead>
          <tr>{sheet.header.map((h, i) => <th key={i} style={th}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {sheet.rows.map((r, ri) =>
            isDivider(r) ? (
              <tr key={ri}>
                <td colSpan={sheet.header.length} style={{ ...td, fontWeight: 700, color: "#5b616e", background: "#fafbfc", fontSize: 11 }}>{r[0]}</td>
              </tr>
            ) : (
              <tr key={ri}>{sheet.header.map((_, ci) => <td key={ci} style={td}>{r[ci] || ""}</td>)}</tr>
            )
          )}
        </tbody>
      </table>
    </div>
  );
}

export default async function FixtureCrossRefPage() {
  await requireUser();
  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "8px 4px 40px" }}>
      <Link href="/design" style={{ fontSize: 12.5, color: "#8c919c" }}>← Design</Link>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: "6px 0 4px" }}>Fixture Cross-Reference</h1>
      <p style={{ fontSize: 13, color: "#6b7079", margin: "0 0 4px", maxWidth: 720, lineHeight: 1.5 }}>
        ETC-anchored competitive matrices for lighting fixtures — the equivalent competitor product,
        how close it is, and the one-line talking point. Internal sales reference; not customer-facing.
      </p>
      <p style={{ fontSize: 11.5, color: "#9aa0ab", margin: "0 0 16px" }}>Compiled {data.compiled}. Verify pricing before bidding.</p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 22 }}>
        {CATS.map((c) => (
          <a key={c.key} href={`#${c.key}`} style={{ fontSize: 12, fontWeight: 600, color: "var(--accent)", background: "color-mix(in srgb, var(--accent) 8%, #fff)", border: "1px solid color-mix(in srgb, var(--accent) 22%, #fff)", borderRadius: 999, padding: "5px 12px", textDecoration: "none" }}>
            {c.name}
          </a>
        ))}
      </div>

      {CATS.map((c) => (
        <section key={c.key} id={c.key} style={{ scrollMarginTop: 16 }}>
          <div style={card}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{c.name}</h2>
              <span style={{ fontSize: 11, color: "#9aa0ab" }}>{c.equivCount} cross-references · {c.specCount} fixtures</span>
            </div>
            <Matrix sheet={c.equivalents} />
            {c.spec.header.length > 0 && (
              <details style={{ marginTop: 14 }}>
                <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#5b616e" }}>Spec matrix ({c.specCount} fixtures)</summary>
                <div style={{ marginTop: 10 }}><Matrix sheet={c.spec} /></div>
              </details>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
