import Link from "next/link";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Design Studio — Peak Backend" };

/**
 * Design Studio — the home for system-design tools (IDEAS — design tab). Hosts
 * the native Steel Calculator, the Lineset Builder, and the Motor library. The
 * existing Design estimator (Sales → Design) will move in here later.
 */

type Card = {
  href: string;
  emoji: string;
  title: string;
  desc: string;
  tag: string;
  ready: boolean;
};

const CARDS: Card[] = [
  {
    href: "/design-studio/steel",
    emoji: "📐",
    title: "Steel Calculator",
    desc: "AISC beam capacity & member sizing, batten/bridle rigging loads, lineset weights → counterweight, motorized-hoist checks, and a section-property database + steel takeoff.",
    tag: "6 tools · 848-section database",
    ready: true,
  },
  {
    href: "/design-studio/lineset",
    emoji: "🎭",
    title: "Lineset Builder",
    desc: "Auto-place a full lineset schedule on the 8-inch grid from stage width & depth — electrics, shells, CYC/rear, midstage, borders, legs, and general-purpose lines using the built-in rules.",
    tag: "8-inch grid auto-layout",
    ready: true,
  },
  {
    href: "/design-studio/motors",
    emoji: "⚙️",
    title: "Motor Library",
    desc: "The ETC Prodigy motorized-hoist breakdown — P1 / P2 / P75 families with capacities, powerhead weights, per-line limits, and speeds. A quick reference while designing.",
    tag: "ETC Prodigy P1 · P2 · P75",
    ready: true,
  },
];

export default async function DesignStudioPage() {
  await requireUser();
  return (
    <div className="pk-content" style={{ maxWidth: 1000 }}>
      <div style={{ marginBottom: 6 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" }}>Design Studio</h1>
        <p style={{ color: "#6b7079", fontSize: 14, marginTop: 4, maxWidth: 640, lineHeight: 1.5 }}>
          Tools for designing rigging & stage systems. Everything you need to
          size steel, build a lineset schedule, and check motor loads in one place.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: 16,
          marginTop: 20,
        }}
      >
        {CARDS.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            style={{
              display: "block",
              background: "#fff",
              border: "1px solid #ececf0",
              borderRadius: 12,
              padding: "18px 18px 16px",
              textDecoration: "none",
              color: "inherit",
              boxShadow: "0 1px 2px rgba(0,0,0,.04)",
            }}
          >
            <div style={{ fontSize: 26, marginBottom: 8 }}>{c.emoji}</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 5 }}>{c.title}</div>
            <div style={{ fontSize: 13, color: "#5b616e", lineHeight: 1.5, marginBottom: 12 }}>
              {c.desc}
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.02em",
                color: "var(--accent)",
                textTransform: "uppercase",
              }}
            >
              {c.tag} →
            </div>
          </Link>
        ))}
      </div>

      <div
        style={{
          marginTop: 22,
          background: "#fafbfc",
          border: "1px solid #eef0f3",
          borderRadius: 10,
          padding: "13px 16px",
          fontSize: 13,
          color: "#6b7079",
        }}
      >
        The <Link href="/design" style={{ color: "var(--accent)", fontWeight: 600 }}>Design estimator</Link>{" "}
        (budgetary drapery/equipment designs) still lives under Sales → Design for now; it
        will move into the Design Studio in a later pass.
      </div>
    </div>
  );
}
