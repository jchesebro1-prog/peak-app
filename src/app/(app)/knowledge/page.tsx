import Link from "next/link";
import { requireUser } from "@/lib/session";
import fixtures from "@/lib/design/fixture-crossref.json";

export const metadata = { title: "Knowledge — Quartzite-6" };

/**
 * Knowledge & Information (#136) — the first slice of #27/#56: what reference
 * material lives in the app today, where each dataset comes from and how it
 * is maintained, and what is queued to move here. Company settings (doctrine,
 * estimating rules, tiers) stay where they are until #56 — plain text below,
 * no links to unbuilt pages.
 */

const TOOLS = [
  {
    href: "/knowledge/steel",
    name: "Steel Calculator",
    what: "AISC ASD beam capacity and member sizing, rigging loads, and the 848-section property database with a takeoff.",
    source:
      "A native port of the Peak Structural Steel Calculator. The section table is src/lib/design/steel-shapes.json; the formulas (AISC F2/G, hoist and batten statics, counterweight math) are src/lib/design/steel.ts.",
    upkeep:
      "Peak owns the numbers. A change to a section, a grade or a hoist rating ships as a code update after engineering review — nothing in this tool is edited in the app, so a figure you see is a figure someone signed off on.",
  },
  {
    href: "/knowledge/fixtures",
    name: "Fixture Cross-Reference",
    what: "ETC-anchored competitive matrices for lighting fixtures — the equivalent competitor product, how close it is, and the one-line talking point.",
    source: `Ported from the Peak Knowledge cross-reference workbooks (compiled ${fixtures.compiled}) into src/lib/design/fixture-crossref.json.`,
    upkeep:
      "Refreshed by re-importing the workbooks; verify pricing before bidding. Internal sales reference only — never customer-facing.",
  },
];

const COMING = [
  { name: "Design doctrine", desc: "Venue-class soft-goods and lighting guidance — what Peak recommends per venue class, and why." },
  { name: "Estimating rules", desc: "The rates and formulas the estimator applies, explained beside the numbers." },
  { name: "Customer tiers", desc: "How pricing tiers are assigned and what each one changes on a quote." },
];

const card: React.CSSProperties = { padding: "18px 20px" };
const label: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 600, letterSpacing: ".05em", textTransform: "uppercase", color: "#aab0bb", marginBottom: 4,
};

export default async function KnowledgePage() {
  await requireUser();
  return (
    <div className="pk-content" style={{ maxWidth: 1080, padding: "26px 30px 64px" }}>
      <h1 style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em", marginBottom: 4 }}>
        Knowledge &amp; Information
      </h1>
      <p style={{ color: "#8c919c", fontSize: 13, marginBottom: 22, maxWidth: 720 }}>
        Reference material the team works from. Each tool says where its data comes from and who
        keeps it current, so a number here is never a mystery.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 18 }}>
        {TOOLS.map((t) => (
          <section key={t.href} className="pk-card" style={card}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
              <strong style={{ fontSize: 15 }}>{t.name}</strong>
              <Link href={t.href} style={{ color: "var(--accent)", fontSize: 12.5, textDecoration: "none", whiteSpace: "nowrap" }}>
                Open →
              </Link>
            </div>
            <p style={{ fontSize: 13, color: "#3a3f47", lineHeight: 1.5, margin: "0 0 12px" }}>{t.what}</p>
            <div style={label}>Where the data comes from</div>
            <p style={{ fontSize: 12.5, color: "#5b616e", lineHeight: 1.5, margin: "0 0 10px" }}>{t.source}</p>
            <div style={label}>How it is maintained</div>
            <p style={{ fontSize: 12.5, color: "#5b616e", lineHeight: 1.5, margin: 0 }}>{t.upkeep}</p>
          </section>
        ))}
      </div>

      <section className="pk-card" style={{ ...card, marginTop: 18 }}>
        <strong style={{ fontSize: 14 }}>Coming here</strong>
        <p style={{ fontSize: 12.5, color: "#8c919c", margin: "4px 0 10px" }}>
          Company knowledge that still lives in Settings and Estimating Rules today (#56). Listed so
          nobody goes looking for it here yet.
        </p>
        {COMING.map((c) => (
          <div key={c.name} style={{ padding: "9px 0", borderTop: "1px solid #eef0f3", fontSize: 13 }}>
            <div style={{ fontWeight: 600 }}>{c.name}</div>
            <div style={{ fontSize: 12.5, color: "#5b616e", marginTop: 2 }}>{c.desc}</div>
          </div>
        ))}
      </section>
    </div>
  );
}
