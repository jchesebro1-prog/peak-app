import Link from "next/link";
import { CardHeadTitle } from "./home-shared";

/**
 * My leads (follow-up worklist) card — port of Home.dc.html's leads glance.
 * Rows are fully resolved server-side: the prototype's leadChip()/leadSub()
 * closures (and the sourceMeta/stageMeta/shortMoney lookups the JSX used to
 * call inline) are all baked into LeadRow before this renders, since this is
 * a plain server component and none of those may cross as functions.
 */

export type LeadRow = {
  id: string;
  href: string;
  org: string;
  src: { color: string; short: string };
  stage: { ink: string; soft: string; bd: string; short: string };
  sub: string;
  chip: { label: string; ink: string; soft: string; bd: string };
  value: string;
};

export type LeadGroup = {
  key: string;
  label: string;
  dot: string;
  ink: string;
  items: LeadRow[];
};

export default function HomeMyLeads({
  myFollowCount,
  leadGroups,
}: {
  myFollowCount: number;
  leadGroups: LeadGroup[];
}) {
  return (
    <div className="pk-card" style={{ overflow: "hidden", marginBottom: 22 }}>
      <div
        className="pkh-greet"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "15px 18px 13px",
          borderBottom: "1px solid #f0f1f4",
          flexWrap: "wrap",
          rowGap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <CardHeadTitle>My leads</CardHeadTitle>
          {myFollowCount > 0 && (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                fontWeight: 600,
                color: "#b4543a",
                background: "#f8ece7",
                border: "1px solid #eccfc4",
                padding: "2px 8px",
                borderRadius: 20,
              }}
            >
              {myFollowCount} to chase
            </span>
          )}
          <span style={{ fontSize: 12.5, color: "#9aa0ab" }}>assigned to you</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
          <Link
            href="/lead-intake"
            target="_blank"
            style={{ fontSize: 12.5, fontWeight: 600, color: "#8c919c", textDecoration: "none" }}
          >
            Public form ↗
          </Link>
          <Link
            href="/leads"
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: "var(--accent)",
              textDecoration: "none",
            }}
          >
            Open Leads →
          </Link>
        </div>
      </div>
      <div style={{ padding: "14px 18px 6px" }}>
        {leadGroups.map((g) => (
          <div key={g.key} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8 }}>
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: "50%",
                  background: g.dot,
                  flexShrink: 0,
                }}
              />
              <span
                style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".01em", color: g.ink }}
              >
                {g.label}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10.5,
                  fontWeight: 600,
                  color: "#fff",
                  background: g.dot,
                  padding: "1px 8px",
                  borderRadius: 20,
                }}
              >
                {g.items.length}
              </span>
            </div>
            <div style={{ border: "1px solid #ececf0", borderRadius: 11, overflow: "hidden" }}>
              {g.items.slice(0, 4).map((row) => {
                return (
                  <Link
                    key={row.id}
                    href={row.href}
                    className="pkh-hover"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "11px 14px",
                      borderBottom: "1px solid #f4f5f8",
                      textDecoration: "none",
                      color: "inherit",
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}
                      >
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: "#16181d",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {row.org}
                        </span>
                        <span
                          style={{
                            fontSize: 9.5,
                            fontWeight: 600,
                            color: row.src.color,
                            background: `color-mix(in srgb, ${row.src.color} 12%, #fff)`,
                            border: `1px solid color-mix(in srgb, ${row.src.color} 24%, #fff)`,
                            padding: "1px 7px",
                            borderRadius: 20,
                            whiteSpace: "nowrap",
                            flexShrink: 0,
                          }}
                        >
                          {row.src.short}
                        </span>
                        <span
                          style={{
                            fontSize: 9.5,
                            fontWeight: 600,
                            color: row.stage.ink,
                            background: row.stage.soft,
                            border: `1px solid ${row.stage.bd}`,
                            padding: "2px 8px",
                            borderRadius: 20,
                            whiteSpace: "nowrap",
                            flexShrink: 0,
                          }}
                        >
                          {row.stage.short}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 11.5,
                          color: "#8c919c",
                          marginTop: 2,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {row.sub}
                      </div>
                    </div>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: row.chip.ink,
                        background: row.chip.soft,
                        border: `1px solid ${row.chip.bd}`,
                        padding: "2px 8px",
                        borderRadius: 20,
                        whiteSpace: "nowrap",
                        flexShrink: 0,
                      }}
                    >
                      {row.chip.label}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        fontWeight: 600,
                        color: "#3a3f4a",
                        flexShrink: 0,
                        width: 58,
                        textAlign: "right",
                      }}
                    >
                      {row.value}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
        {leadGroups.length === 0 && (
          <div
            style={{
              padding: "20px 14px 26px",
              textAlign: "center",
              color: "#9aa0ab",
              fontSize: 13,
            }}
          >
            Nothing needs chasing — your assigned leads are all on track.
          </div>
        )}
      </div>
    </div>
  );
}
