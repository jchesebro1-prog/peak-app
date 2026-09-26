import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { allSpecDocuments } from "@/lib/stores/spec-documents";
import { allSections } from "@/lib/stores/spec-sections";
import { dateYear, timeAgo } from "@/lib/format";
import type { SpecDocSource } from "@/lib/specs/spec-document";

/**
 * #205 Phase B (T5) — the saved-spec list. Replaces Phase A's redirect to the
 * library: every spec built with the spec builder, newest edit first, each a
 * link into its builder plus a one-click Word download. The library and the
 * templates stay one click away in the header.
 */

export const metadata = { title: "Specs — Quartzite-6" };

const TH: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: "#aab0bb",
  textTransform: "uppercase",
  letterSpacing: ".04em",
};
const CELL: React.CSSProperties = { fontSize: 12.5, color: "#3a3f4a", minWidth: 0 };
const MUTED: React.CSSProperties = { fontSize: 11.5, color: "#9aa0ab" };
const GRID = "90px minmax(0,1.5fr) minmax(0,1.2fr) minmax(0,1fr) minmax(0,1fr) 90px 120px";

const DAY_MS = 24 * 60 * 60 * 1000;

function sourceLabel(s: SpecDocSource): string {
  if (s.kind === "quote") return `Quote ${s.quoteId || s.id || ""}`.trim();
  if (s.kind === "grid") return `Grid: ${s.label || s.id || ""}`.trim();
  return "From scratch";
}

/** Relative inside a month ("3h ago"), a plain date after that. */
function updatedLabel(ms: number): string {
  if (!ms) return "—";
  return Date.now() - ms < 30 * DAY_MS ? timeAgo(ms) : dateYear(ms);
}

export default async function SpecsIndex() {
  const [user, docs, sections] = await Promise.all([requireUser(), allSpecDocuments(), allSections()]);
  const canCreate = can("create", user.roles);
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const rows = [...docs].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="pk-content" style={{ maxWidth: 1180, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <div>
          <div className="pk-page-title">Specs</div>
          <div className="pk-page-sub">Saved specs — one CSI section per Word file.</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Link href="/design/specs/library" className="pk-btn-outline" style={{ textDecoration: "none" }}>
            Library
          </Link>
          <Link href="/design/specs/templates" className="pk-btn-outline" style={{ textDecoration: "none" }}>
            Templates
          </Link>
          {canCreate && (
            <Link href="/design/specs/new" className="pk-btn-accent" style={{ textDecoration: "none" }}>
              + New spec
            </Link>
          )}
        </div>
      </div>

      <div className="pk-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 10, padding: "9px 18px", background: "#fafbfc", borderBottom: "1px solid #f0f1f4" }}>
          <span style={TH}>Spec</span>
          <span style={TH}>Section</span>
          <span style={TH}>Project</span>
          <span style={TH}>Customer</span>
          <span style={TH}>Source</span>
          <span style={TH}>Updated</span>
          <span style={TH} />
        </div>
        {rows.map((d) => {
          const section = sectionById.get(d.sectionId);
          const href = `/design/specs/${encodeURIComponent(d.id)}`;
          return (
            <div
              key={d.id}
              style={{ display: "grid", gridTemplateColumns: GRID, gap: 10, padding: "11px 18px", borderBottom: "1px solid #f5f6f8", alignItems: "center" }}
            >
              <Link href={href} style={{ ...CELL, fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}>
                {d.id}
              </Link>
              <Link href={href} style={{ ...CELL, textDecoration: "none" }}>
                {section ? (
                  <>
                    <span style={{ fontFamily: "var(--font-mono)" }}>{section.number}</span> · {section.title}
                  </>
                ) : (
                  <span style={{ color: "#b4543a" }}>Section removed</span>
                )}
              </Link>
              <span style={CELL}>
                {d.header.projectName || <span style={MUTED}>—</span>}
                {d.header.projectNumber && (
                  <span style={{ ...MUTED, fontFamily: "var(--font-mono)", marginLeft: 6 }}>{d.header.projectNumber}</span>
                )}
              </span>
              <span style={CELL}>{d.customer || <span style={MUTED}>—</span>}</span>
              <span style={CELL}>{sourceLabel(d.source)}</span>
              <span style={{ ...CELL, color: "#6b7079" }} title={d.updatedBy ? `by ${d.updatedBy}` : undefined}>
                {updatedLabel(d.updatedAt)}
              </span>
              <span style={{ textAlign: "right" }}>
                {section && (
                  <a
                    href={`/api/spec-documents/${encodeURIComponent(d.id)}/docx`}
                    download
                    className="pk-btn-outline"
                    style={{ textDecoration: "none", fontSize: 12 }}
                  >
                    Download Word
                  </a>
                )}
              </span>
            </div>
          );
        })}
        {rows.length === 0 && (
          <div style={{ padding: "36px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 13 }}>
            {canCreate ? "No specs yet — start one with + New spec." : "No specs yet."}
          </div>
        )}
      </div>
    </div>
  );
}
