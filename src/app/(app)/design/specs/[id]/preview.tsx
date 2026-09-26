import type { CSSProperties } from "react";
import type { AssembledArticle, AssembledSection } from "@/lib/specs/assemble-section";
import type { OutlineLine } from "@/lib/specs/outline";

/**
 * #205 Phase B (T5) — read-only preview of the assembled section, numbered as
 * it prints. Renders the same AssembledSection the Word writer does
 * (src/lib/specs/spec-docx.ts), so the two cannot disagree about content or
 * order; Word's own list numbering takes over in the downloaded file.
 * Presentational only — no hooks, rendered by the client Builder.
 */

/** Brief: padding-left = depth × 22px. */
const INDENT = 22;
const PAPER: CSSProperties = {
  fontFamily: '"Times New Roman", Times, serif',
  fontSize: 13.5,
  lineHeight: 1.45,
  color: "#16181b",
  background: "#fff",
  border: "1px solid #eceef2",
  borderRadius: 9,
  padding: "22px 26px",
};
const PART: CSSProperties = { fontWeight: 700, marginTop: 18, marginBottom: 6 };
const ARTICLE: CSSProperties = { fontWeight: 700, marginTop: 10, marginBottom: 2 };
const CELL: CSSProperties = { border: "1px solid #c9cdd4", padding: "4px 8px", textAlign: "left", verticalAlign: "top" };

function Lines({ lines }: { lines: OutlineLine[] }) {
  return (
    <>
      {lines.map((l, i) => (
        <div key={i} style={{ paddingLeft: l.depth * INDENT, display: "flex", gap: 8 }}>
          <span style={{ minWidth: 22, flexShrink: 0 }}>{l.label}</span>
          <span style={{ whiteSpace: "pre-wrap" }}>{l.text}</span>
        </div>
      ))}
    </>
  );
}

function Articles({ articles }: { articles: AssembledArticle[] }) {
  return (
    <>
      {articles.map((a) => (
        <div key={a.num}>
          <div style={ARTICLE}>
            {a.num} {a.title}
          </div>
          <Lines lines={a.lines} />
        </div>
      ))}
    </>
  );
}

export default function Preview({ assembled }: { assembled: AssembledSection }) {
  const p2 = assembled.part2;
  return (
    <div style={PAPER}>
      <div style={{ fontWeight: 700, textAlign: "center", marginBottom: 12 }}>
        SECTION {assembled.number} – {assembled.title.toUpperCase()}
      </div>

      <div style={PART}>PART 1 – GENERAL</div>
      <Articles articles={assembled.part1} />

      <div style={PART}>PART 2 – PRODUCTS</div>
      {p2.articles.length === 0 && (
        <div style={{ color: "#9aa0ab", fontStyle: "italic" }}>No products yet.</div>
      )}
      {p2.articles.map((a) => (
        <div key={a.num}>
          <div style={ARTICLE}>
            {a.num} {a.title}
          </div>
          <Lines lines={a.general} />
          {a.products.map((pr) => (
            <div key={pr.sku}>
              <div style={{ display: "flex", gap: 8 }}>
                <span style={{ minWidth: 22, flexShrink: 0 }}>{pr.label}</span>
                <span>{pr.heading}</span>
              </div>
              <Lines lines={pr.lines} />
            </div>
          ))}
        </div>
      ))}
      {p2.style === "table" && p2.rows.length > 0 && (
        <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 10, fontSize: 12.5 }}>
          <thead>
            <tr>
              {p2.showQty && <th style={CELL}>Qty</th>}
              <th style={CELL}>Mfr</th>
              <th style={CELL}>Model</th>
              <th style={CELL}>Description</th>
            </tr>
          </thead>
          <tbody>
            {p2.rows.map((r) => (
              <tr key={r.sku}>
                {p2.showQty && <td style={CELL}>{r.qty ?? ""}</td>}
                <td style={CELL}>{r.mfr}</td>
                <td style={CELL}>{r.model}</td>
                <td style={CELL}>{r.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={PART}>PART 3 – EXECUTION</div>
      <Articles articles={assembled.part3} />

      <div style={{ fontWeight: 700, textAlign: "center", marginTop: 22 }}>END OF SECTION {assembled.number}</div>
    </div>
  );
}
