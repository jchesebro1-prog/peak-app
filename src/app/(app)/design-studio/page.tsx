import Link from "next/link";
import { requireUser } from "@/lib/session";
import { listDesigns } from "@/lib/stores/studio-designs";

export const metadata = { title: "Design Studio — Peak Backend" };

const KIND_META: Record<string, { label: string; base: string }> = {
  lineset: { label: "Lineset Builder", base: "/design-studio/lineset?design=" },
  // legacy weights saves open in the merged Builder (D78)
  weights: { label: "Lineset Weights (legacy)", base: "/design-studio/lineset?design=" },
};

function fmtWhen(at: number): string {
  try {
    return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

/**
 * Design Studio — the home for system-design tools (IDEAS — design tab). Hosts
 * the native Steel Calculator, the Lineset Builder, and the Motor library. The
 * existing Design estimator (Sales → Design) will move in here later.
 */

type Card = {
  href: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
  tag: string;
  ready: boolean;
};

/** Shared wrapper so the five tile icons render as one family. */
function CardIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      {children}
    </svg>
  );
}

const CARDS: Card[] = [
  {
    href: "/design-studio/steel",
    icon: (
      <CardIcon>
        <path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0Z" />
        <path d="m14.5 12.5 2-2M11.5 9.5l2-2M8.5 6.5l2-2M17.5 15.5l2-2" />
      </CardIcon>
    ),
    title: "Steel Calculator",
    desc: "AISC beam capacity & member sizing, batten/bridle rigging loads, lineset weights → counterweight, motorized-hoist checks, and a section-property database + steel takeoff.",
    tag: "6 tools · 848-section database",
    ready: true,
  },
  {
    href: "/design-studio/lineset",
    icon: (
      <CardIcon>
        <path d="M5 6h14M3 12h18M6 18h12" />
        <path d="M5 4.5v3M19 4.5v3M3 10.5v3M21 10.5v3M6 16.5v3M18 16.5v3" />
      </CardIcon>
    ),
    title: "Lineset Builder",
    desc: "Auto-place a full lineset schedule on the 8-inch grid from stage width & depth, then enter each line's goods — weight, hoist checks, counterweight bricks, and beam loads calculate live on the same screen.",
    tag: "Auto-layout + weights in one",
    ready: true,
  },
  {
    href: "/design-studio/motors",
    icon: (
      <CardIcon>
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </CardIcon>
    ),
    title: "Motor Library",
    desc: "The ETC Prodigy motorized-hoist breakdown — P1 / P2 / P75 families with capacities, powerhead weights, per-line limits, and speeds. A quick reference while designing.",
    tag: "ETC Prodigy P1 · P2 · P75",
    ready: true,
  },
  {
    href: "/design",
    icon: (
      <CardIcon>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </CardIcon>
    ),
    title: "Design Estimator",
    desc: "Budgetary drapery & equipment designs — build a sandbox estimate that lands as a draft quote. Separate from the priced Quotes pipeline until you add it.",
    tag: "Budgetary designs → draft quote",
    ready: true,
  },
];

export default async function DesignStudioPage() {
  const [, designs] = await Promise.all([requireUser(), listDesigns()]);
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
            <div style={{ marginBottom: 8 }}>{c.icon}</div>
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

      {designs.length > 0 && (
        <div style={{ marginTop: 26 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>Saved designs</h2>
          <div style={{ background: "#fff", border: "1px solid #ececf0", borderRadius: 12, boxShadow: "0 1px 2px rgba(0,0,0,.04)", overflow: "hidden" }}>
            {designs.map((d) => {
              const m = KIND_META[d.kind] || { label: d.kind, base: "/design-studio" };
              return (
                <Link
                  key={d.id}
                  href={m.base + encodeURIComponent(d.id)}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "11px 16px", borderBottom: "1px solid #f4f5f7", textDecoration: "none", color: "inherit" }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{d.name}</div>
                    <div style={{ fontSize: 12, color: "#8c919c" }}>{m.label}{d.customer ? ` · ${d.customer}` : ""}</div>
                  </div>
                  <div style={{ fontSize: 12, color: "#9aa0ab", whiteSpace: "nowrap" }}>{d.updatedBy} · {fmtWhen(d.updatedAt)} →</div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
