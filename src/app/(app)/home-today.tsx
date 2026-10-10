import Link from "next/link";
import { CardHeadTitle } from "./home-shared";
import type { TodayRow } from "@/lib/task-plan/today";

/**
 * Home "Today" card (spec 2026-10-09 auto task calendar, Part 3): today's
 * planned task blocks in order and the at-risk count, linking to the day
 * view. Server component; rows are resolved by the widget renderer. `failed`
 * = the plan couldn't be loaded — a small note, never a crash.
 */
export default function HomeToday({ rows, atRiskCount, note, failed = false }: { rows: TodayRow[]; atRiskCount: number; note: string | null; failed?: boolean }) {
  return (
    <div className="pk-card" style={{ overflow: "hidden", marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "15px 17px 12px", borderBottom: "1px solid #f0f1f4" }}>
        <CardHeadTitle>Today</CardHeadTitle>
        <Link href="/calendar?view=day" style={{ fontSize: 12, color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>
          Open day view →
        </Link>
      </div>
      {atRiskCount > 0 && (
        <Link href="/calendar?view=day" style={{ display: "block", padding: "8px 17px", fontSize: 12.5, fontWeight: 700, color: "#b4543a", background: "#fbefe9", textDecoration: "none" }}>
          {atRiskCount} at risk
        </Link>
      )}
      {note && (
        <div role="status" style={{ padding: "6px 17px", fontSize: 11.5, color: "#8a5a1a", background: "#fdf3e7" }}>
          {note}
        </div>
      )}
      {failed ? (
        <div role="status" style={{ padding: "16px 17px", fontSize: 12.5, color: "#8a5a1a" }}>
          Couldn’t load today’s plan right now — <Link href="/calendar?view=day" style={{ color: "var(--accent)" }}>open the calendar</Link>.
        </div>
      ) : rows.length === 0 ? (
        <div style={{ padding: "16px 17px", fontSize: 12.5, color: "#9aa0ab" }}>Nothing planned for today.</div>
      ) : (
        rows.map((r) => (
          <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 17px", borderTop: "1px solid #f6f7f9" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#5b616e", minWidth: 86 }}>{r.time}</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {r.pinned ? "📌 " : ""}
              {r.href ? <Link href={r.href}>{r.title}</Link> : r.title}
            </span>
            {r.atRisk && <span style={{ fontSize: 10.5, fontWeight: 700, color: "#b4543a" }}>At risk</span>}
          </div>
        ))
      )}
    </div>
  );
}
