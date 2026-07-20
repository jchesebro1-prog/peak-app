import Link from "next/link";
import { CardHeadTitle } from "./home-shared";

/**
 * Needs attention card — port of Home.dc.html's alerts widget. Rows blend
 * review requests/changes with overdue or draft pipeline items (built in
 * page.tsx from live quotes/designs); `keepScroll` becomes `scroll={false}`
 * for pipeline-derived rows so the pipeline filter scroll position sticks.
 */

export type AlertRow = {
  key: string;
  title: string;
  detail: string;
  tag: string;
  dot: string;
  tagColor: string;
  tagBg: string;
  href: string;
  keepScroll?: boolean;
};

export default function HomeNeedsAttention({ alerts }: { alerts: AlertRow[] }) {
  return (
    <div className="pk-card" style={{ overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "15px 17px 12px",
          borderBottom: "1px solid #f0f1f4",
        }}
      >
        <CardHeadTitle>Needs attention</CardHeadTitle>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 600,
            color: "#b4543a",
            background: "#f7e9e5",
            padding: "2px 8px",
            borderRadius: 20,
          }}
        >
          {alerts.length}
        </span>
      </div>
      {alerts.map((a) => (
        <Link
          key={a.key}
          href={a.href}
          scroll={a.keepScroll ? false : undefined}
          className="pkh-hover"
          style={{
            width: "100%",
            display: "flex",
            alignItems: "flex-start",
            gap: 11,
            padding: "13px 17px",
            borderBottom: "1px solid #f5f6f8",
            textDecoration: "none",
            color: "inherit",
            textAlign: "left",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: a.dot,
              marginTop: 5,
              flexShrink: 0,
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                lineHeight: 1.35,
                color: "#16181d",
              }}
            >
              {a.title}
            </div>
            <div
              style={{ fontSize: 11.5, color: "#8c919c", marginTop: 2, lineHeight: 1.4 }}
            >
              {a.detail}
            </div>
          </div>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              fontWeight: 600,
              color: a.tagColor,
              background: a.tagBg,
              padding: "3px 8px",
              borderRadius: 6,
              flexShrink: 0,
              whiteSpace: "nowrap",
            }}
          >
            {a.tag}
          </span>
        </Link>
      ))}
      {alerts.length === 0 && (
        <div
          style={{
            padding: "22px 17px",
            textAlign: "center",
            color: "#9aa0ab",
            fontSize: 12.5,
          }}
        >
          All clear — nothing needs chasing.
        </div>
      )}
    </div>
  );
}
