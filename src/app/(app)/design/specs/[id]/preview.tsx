import type { CSSProperties } from "react";
import type { AssembledArticle, AssembledSection } from "@/lib/specs/assemble-section";
import type { OutlineLine } from "@/lib/specs/outline";
import { jobValueSegments } from "@/lib/specs/record-fill-ins";

/**
 * #205 Phase B (T5) — read-only preview of the assembled section, numbered as
 * it prints. Renders the same AssembledSection the Word writer does
 * (src/lib/specs/spec-docx.ts), so the two cannot disagree about content or
 * order; Word's own list numbering takes over in the downloaded file.
 * Presentational only — no hooks, rendered by the client Builder.
 *
 * Spec records (Task 9): in a record entry, a `[bracket]` job value still
 * showing (no answer yet, so it prints as written) is highlighted amber —
 * an answered one has already become its value. A record entry changed for
 * this project carries a small badge, and one whose library text moved on
 * since carries a second — screen only, never in the Word file.
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
/** An unanswered job value, as it will print (brackets included). */
const BRACKET: CSSProperties = { background: "#fbeec4", color: "#6d5412", borderRadius: 3, padding: "0 2px" };
const BADGE: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 10.5,
  fontWeight: 600,
  lineHeight: "15px",
  padding: "0 7px",
  borderRadius: 999,
  whiteSpace: "nowrap",
  alignSelf: "center",
};
const CELL: CSSProperties = { border: "1px solid #c9cdd4", padding: "4px 8px", textAlign: "left", verticalAlign: "top" };

/** `highlight` marks `[bracket]` job values — record entries only, so a
 *  legacy part's or Part 1/3's own brackets are left alone. */
function Lines({ lines, highlight }: { lines: OutlineLine[]; highlight?: boolean }) {
  return (
    <>
      {lines.map((l, i) => (
        <div key={i} style={{ paddingLeft: l.depth * INDENT, display: "flex", gap: 8 }}>
          <span style={{ minWidth: 22, flexShrink: 0 }}>{l.label}</span>
          <span style={{ whiteSpace: "pre-wrap" }}>
            {highlight
              ? jobValueSegments(l.text).map((seg, j) =>
                  seg.bracket ? (
                    <mark key={j} style={BRACKET} title="Job value — answer it in the Checklist, or it prints as written">
                      {seg.text}
                    </mark>
                  ) : (
                    <span key={j}>{seg.text}</span>
                  )
                )
              : l.text}
          </span>
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
      {p2.articles.length === 0 && !(p2.style === "table" && p2.trailing) && (
        <div style={{ color: "#9aa0ab", fontStyle: "italic" }}>No products yet.</div>
      )}
      {p2.articles.map((a) => (
        <div key={a.num}>
          <div style={ARTICLE}>
            {a.num} {a.title}
          </div>
          <Lines lines={a.general} />
          {a.products.map((pr) => (
            <div key={pr.specId || pr.sku}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span style={{ minWidth: 22, flexShrink: 0 }}>{pr.label}</span>
                <span>{pr.heading}</span>
                {pr.overridden && <span style={{ ...BADGE, color: "#3b5b8c", background: "#e8eef8" }}>Changed for this project</span>}
                {pr.overrideStale && <span style={{ ...BADGE, color: "#8a6d1f", background: "#fbf3dd" }}>Library updated since</span>}
              </div>
              <Lines lines={pr.lines} highlight={!!pr.specId} />
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
      {/* ITEMS NOT SPECIFIED follows the schedule, never precedes it. */}
      {p2.style === "table" && p2.trailing && (
        <div>
          <div style={ARTICLE}>
            {p2.trailing.num} {p2.trailing.title}
          </div>
          <Lines lines={p2.trailing.general} />
        </div>
      )}

      <div style={PART}>PART 3 – EXECUTION</div>
      <Articles articles={assembled.part3} />

      <div style={{ fontWeight: 700, textAlign: "center", marginTop: 22 }}>END OF SECTION {assembled.number}</div>
    </div>
  );
}
