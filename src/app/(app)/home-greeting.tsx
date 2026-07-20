import Link from "next/link";

/**
 * Home dashboard greeting + quick actions header — port of Home.dc.html's
 * top-of-page block (name, standfirst summary, Open Reviews / New estimate).
 */

const ACCENT_SOFT = "var(--accent-soft)";

export default function HomeGreeting({
  greeting,
  firstName,
  standfirst,
  openReviewCount,
}: {
  greeting: string;
  firstName: string;
  standfirst: string;
  openReviewCount: number;
}) {
  return (
    <div
      className="pkh-greet"
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
        rowGap: 14,
        marginBottom: 20,
      }}
    >
      <div>
        <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>
          {greeting}, {firstName}
        </div>
        <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 4 }}>{standfirst}</div>
      </div>
      <div className="pkh-actions" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Link
          href="/reviews"
          className="pkh-outbtn"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            fontWeight: 600,
            color: "#3a3f4a",
            background: "#fff",
            border: "1px solid #e4e7ec",
            padding: "11px 16px",
            borderRadius: 9,
            textDecoration: "none",
          }}
        >
          Open Reviews
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: 18,
              height: 18,
              padding: "0 5px",
              borderRadius: 9,
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              fontWeight: 700,
              color: "#fff",
              background: openReviewCount > 0 ? "var(--accent)" : "#c4c9d2",
            }}
          >
            {openReviewCount}
          </span>
        </Link>
        <Link
          href="/design/quick"
          className="pkh-accbtn"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            fontWeight: 600,
            color: "#fff",
            background: "var(--accent)",
            padding: "12px 17px",
            borderRadius: 9,
            textDecoration: "none",
            boxShadow: `0 1px 3px ${ACCENT_SOFT}`,
          }}
        >
          <span style={{ fontSize: 15, lineHeight: 1 }}>+</span>
          New estimate
        </Link>
      </div>
    </div>
  );
}
