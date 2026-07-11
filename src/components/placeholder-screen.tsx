import Link from "next/link";

/**
 * Stand-in for screens that land in later phases. Every nav destination
 * exists from Phase 1 so the shell behaves like the finished app.
 */
export default function PlaceholderScreen({
  title,
  sub,
  phase,
  details,
}: {
  title: string;
  sub: string;
  phase: string;
  details?: string;
}) {
  return (
    <div className="pk-content">
      <div className="pk-page-title">{title}</div>
      <div className="pk-page-sub">{sub}</div>
      <div
        className="pk-card"
        style={{ marginTop: 18, padding: "42px 24px", textAlign: "center" }}
      >
        <div
          style={{
            width: 46,
            height: 46,
            borderRadius: 12,
            background: "var(--accent-soft)",
            color: "var(--accent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 20,
            fontWeight: 700,
            margin: "0 auto 14px",
            fontFamily: "var(--font-mono)",
          }}
        >
          {phase.replace(/\D/g, "") || "•"}
        </div>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Coming in {phase}</div>
        <div
          style={{
            fontSize: 13,
            color: "#9aa0ab",
            marginTop: 6,
            maxWidth: 460,
            marginLeft: "auto",
            marginRight: "auto",
            lineHeight: 1.5,
          }}
        >
          {details ||
            "This screen is being ported from the prototype, faithful to the design."}{" "}
          The build order is tracked in{" "}
          <Link href="/settings" style={{ color: "var(--accent)" }}>
            Settings
          </Link>
          .
        </div>
      </div>
    </div>
  );
}
