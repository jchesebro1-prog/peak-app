import Link from "next/link";
import { CardHeadTitle } from "./home-shared";

/**
 * My Queue dashboard card (D98) — the queue was the only one of the three
 * screens folded under Home with no dashboard presence, which the spec
 * calls out as backwards: My Queue moves from one click to two, so this
 * card carries the job of surfacing anything urgent. Rows and labels are
 * fully resolved server-side in page.tsx (dueLabel is plain text, `open`/
 * `overdue` come from `queueCardCounts`) — this stays a server component,
 * matching its siblings.
 */

export type QueueRow = {
  key: string;
  title: string;
  context: string;
  dueLabel: string;
  href: string;
};

export default function HomeQueue({
  open,
  overdue,
  rows,
}: {
  open: number;
  overdue: number;
  rows: QueueRow[];
}) {
  return (
    <div className="pk-card" style={{ overflow: "hidden", marginBottom: 22 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "15px 17px 12px",
          borderBottom: "1px solid #f0f1f4",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
          <CardHeadTitle>My Queue</CardHeadTitle>
          {overdue > 0 && (
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
              {overdue} overdue
            </span>
          )}
          <span style={{ fontSize: 12.5, color: "#9aa0ab" }}>
            {open > 0 ? `${open} open` : "Nothing open"}
          </span>
        </div>
        <Link
          href="/queue"
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: "var(--accent)",
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          Open queue →
        </Link>
      </div>
      {rows.map((r) => (
        <Link
          key={r.key}
          href={r.href}
          className="pkh-hover"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 11,
            padding: "12px 17px",
            borderBottom: "1px solid #f5f6f8",
            textDecoration: "none",
            color: "inherit",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: "#16181d",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {r.title}
            </div>
            {r.context && (
              <div
                style={{
                  fontSize: 11,
                  color: "#9aa0ab",
                  marginTop: 2,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {r.context}
              </div>
            )}
          </div>
          {r.dueLabel && (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                fontWeight: 600,
                color: "#5b616e",
                flexShrink: 0,
                whiteSpace: "nowrap",
              }}
            >
              {r.dueLabel}
            </span>
          )}
        </Link>
      ))}
      {rows.length === 0 && (
        <div
          style={{
            padding: "22px 17px",
            textAlign: "center",
            color: "#9aa0ab",
            fontSize: 12.5,
          }}
        >
          You’re clear — nothing in your queue.
        </div>
      )}
    </div>
  );
}
