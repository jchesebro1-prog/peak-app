import Link from "next/link";
import { requireUser } from "@/lib/session";
import * as Templates from "@/lib/stores/spec-templates";
import * as Curtains from "@/lib/stores/spec-curtain-templates";
import { RestoreStarterTemplatesButton } from "./editor";

/**
 * Task 10 — the Templates index: the authoring formulas (one per catalog
 * category "key") and the four curtain templates (one per Grid curtain
 * type). Owner decision: starter templates auto-seed when empty on ANY
 * environment, so a hosted database or one after a go-live reset never
 * shows an empty screen — `ensureStarterTemplates()` runs on every read of
 * this page, same as the library index calls `Templates.ensureStarterTemplates()`.
 */

export const metadata = { title: "Spec templates — Quartzite-6" };

const TH: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: "#aab0bb",
  textTransform: "uppercase",
  letterSpacing: ".04em",
};
const CELL: React.CSSProperties = { fontSize: 12.5, color: "#3a3f4a" };

function fmtDate(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default async function SpecTemplatesPage() {
  await requireUser();
  // Owner decision: never let this screen — or the "Insert template" row it
  // feeds — come up empty on a hosted or freshly reset database.
  await Templates.ensureStarterTemplates();

  const [templates, curtainTemplates] = await Promise.all([
    Templates.allTemplates(),
    Curtains.allCurtainTemplates(),
  ]);

  return (
    <div className="pk-content" style={{ maxWidth: 1080, margin: "0 auto" }}>
      <div style={{ marginBottom: 10 }}>
        <Link href="/design/specs/library" style={{ fontSize: 12, color: "#8c919c", textDecoration: "none" }}>
          ← Spec library
        </Link>
      </div>
      <div style={{ marginBottom: 18 }}>
        <div className="pk-page-title">Spec templates</div>
        <div className="pk-page-sub">
          Authoring formulas the part editor scaffolds from, and the four Grid curtain templates every curtain
          resolves through.
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <RestoreStarterTemplatesButton />
        <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 6, lineHeight: 1.4 }}>
          This never overwrites a formula someone has already edited — it only adds back what is missing, which is
          the path after a go-live reset wipes the demo collections.
        </div>
      </div>

      <div className="pk-card" style={{ padding: 0, overflow: "hidden", marginBottom: 22 }}>
        <div style={{ padding: "12px 18px", borderBottom: "1px solid #f0f1f4", fontSize: 14.5, fontWeight: 600 }}>
          Formulas
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr) 90px 90px 160px 150px",
            gap: 10,
            padding: "9px 18px",
            background: "#fafbfc",
            borderBottom: "1px solid #f0f1f4",
          }}
        >
          <span style={TH}>Key</span>
          <span style={TH}>Title</span>
          <span style={{ ...TH, textAlign: "right" }}>Headings</span>
          <span style={TH}>Example</span>
          <span style={TH}>Last saved</span>
          <span style={TH}>By</span>
        </div>
        {templates.map((t) => (
          <Link
            key={t.id}
            href={`/design/specs/templates/${encodeURIComponent(t.id)}`}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr) 90px 90px 160px 150px",
              gap: 10,
              padding: "11px 18px",
              borderBottom: "1px solid #f5f6f8",
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <span style={{ ...CELL, fontFamily: "var(--font-mono)" }}>{t.key}</span>
            <span style={{ ...CELL, fontWeight: 600 }}>{t.title}</span>
            <span style={{ ...CELL, textAlign: "right", fontFamily: "var(--font-mono)" }}>{t.headings.length}</span>
            <span style={CELL}>{t.example.trim() ? "Yes" : "—"}</span>
            <span style={CELL}>{fmtDate(t.updatedAt)}</span>
            <span style={CELL}>{t.updatedBy || "—"}</span>
          </Link>
        ))}
        {templates.length === 0 && (
          <div style={{ padding: "36px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 13 }}>
            No formulas yet.
          </div>
        )}
      </div>

      <div className="pk-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 18px", borderBottom: "1px solid #f0f1f4", fontSize: 14.5, fontWeight: 600 }}>
          Curtain templates
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr) 160px 150px",
            gap: 10,
            padding: "9px 18px",
            background: "#fafbfc",
            borderBottom: "1px solid #f0f1f4",
          }}
        >
          <span style={TH}>Type</span>
          <span style={TH}>Title</span>
          <span style={TH}>Last saved</span>
          <span style={TH}>By</span>
        </div>
        {curtainTemplates.map((t) => (
          <Link
            key={t.id}
            href={`/design/specs/templates/curtain-${encodeURIComponent(t.id)}`}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr) 160px 150px",
              gap: 10,
              padding: "11px 18px",
              borderBottom: "1px solid #f5f6f8",
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <span style={{ ...CELL, fontFamily: "var(--font-mono)" }}>{t.id}</span>
            <span style={{ ...CELL, fontWeight: 600 }}>{t.title}</span>
            <span style={CELL}>{fmtDate(t.updatedAt)}</span>
            <span style={CELL}>{t.updatedBy || "—"}</span>
          </Link>
        ))}
        {curtainTemplates.length === 0 && (
          <div style={{ padding: "36px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 13 }}>
            No curtain templates yet.
          </div>
        )}
      </div>
    </div>
  );
}
