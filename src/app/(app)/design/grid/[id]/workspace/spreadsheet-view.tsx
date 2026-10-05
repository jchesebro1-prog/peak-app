"use client";

import Link from "next/link";
import ScheduleTable from "../schedule/schedule-table";
import type { GridEditor } from "../use-grid-editor";

/**
 * Spreadsheet view (#299) — the center pane's second tab: the active
 * option's equipment schedule, the same tables the printable /schedule page
 * shows (one ScheduleTable, one server-built `schedule` from
 * scheduleForOption). Read-only; every edit's router.refresh() rebuilds it.
 */
export default function SpreadsheetView({ ed }: { ed: GridEditor }) {
  const { project, activeOptionId, activeOption, schedule } = ed;
  const href = `/design/grid/${encodeURIComponent(project.id)}/schedule?option=${encodeURIComponent(activeOptionId)}`;
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: "#6d7076", padding: 18 }}>
      <div
        style={{
          maxWidth: 960,
          margin: "0 auto",
          background: "#fff",
          borderRadius: 8,
          padding: "16px 22px 22px",
          color: "#1a1a1a",
          boxShadow: "0 1px 3px rgba(0,0,0,.18)",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#16181d" }}>
            Equipment schedule
            {project.options.length > 1 && <span style={{ fontWeight: 400, color: "#8c919c" }}> · {activeOption.name}</span>}
          </div>
          <span style={{ flex: 1 }} />
          <Link href={href} style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}>
            Open printable schedule →
          </Link>
        </div>
        <ScheduleTable schedule={schedule} accent="var(--accent)" />
      </div>
    </div>
  );
}
