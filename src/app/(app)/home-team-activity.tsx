import Link from "next/link";
import { timeAgo as quoteTimeAgo } from "@/lib/stores/quotes";
import { CardHeadTitle } from "./home-shared";

/**
 * Team activity glance card — port of Home.dc.html's team activity widget.
 * `initials`/`color` are resolved in page.tsx (the prototype's initialsOf()/
 * colorOf() closures over the roster map) since functions must not cross
 * into this server component as props.
 */

export type TeamActivityRow = {
  ts: number;
  who: string;
  kind: string;
  verb: string;
  name: string;
  initials: string;
  color: string;
};

export default function HomeTeamActivity({
  teamActivity,
}: {
  teamActivity: TeamActivityRow[];
}) {
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
        <CardHeadTitle>Team activity</CardHeadTitle>
        <Link
          href="/quotes"
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--accent)",
            textDecoration: "none",
          }}
        >
          View all →
        </Link>
      </div>
      {teamActivity.map((t, i) => (
        <div
          key={`${t.kind}-${i}`}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 11,
            padding: "11px 17px",
            borderBottom: "1px solid #f5f6f8",
          }}
        >
          <span
            title={t.who}
            style={{
              width: 30,
              height: 30,
              borderRadius: "50%",
              background: t.color,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {t.initials}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, lineHeight: 1.35 }}>
              <b style={{ fontWeight: 600, color: "#16181d" }}>{t.who}</b>{" "}
              <span style={{ color: "#5b616e" }}>
                {t.verb} {t.name}
              </span>
            </div>
            <div style={{ fontSize: 11, color: "#aab0bb", marginTop: 2 }}>
              {t.kind} · {quoteTimeAgo(t.ts)}
            </div>
          </div>
        </div>
      ))}
      {teamActivity.length === 0 && (
        <div
          style={{
            padding: "22px 17px",
            textAlign: "center",
            color: "#9aa0ab",
            fontSize: 12.5,
          }}
        >
          No recent team activity.
        </div>
      )}
    </div>
  );
}
