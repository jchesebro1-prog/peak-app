"use client";

import { useState } from "react";
import Link from "next/link";
import ScheduleTable from "../schedule/schedule-table";
import DevicesTable from "./devices-table";
import type { GridEditor } from "../use-grid-editor";

/**
 * Spreadsheet view (#299) — the center pane's second tab. #320: two tabs —
 * Devices (default): one editable row per device; Schedule: the active
 * option's equipment schedule, the same tables the printable /schedule page
 * shows (one ScheduleTable, one server-built `schedule` from
 * scheduleForOption), now with a Designators column. Every edit's
 * router.refresh() rebuilds both.
 */
type Tab = "devices" | "schedule";
const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: "devices", label: "Devices" },
  { key: "schedule", label: "Schedule" },
];

export default function SpreadsheetView({ ed }: { ed: GridEditor }) {
  const { project, activeOptionId, activeOption, schedule } = ed;
  const [tab, setTab] = useState<Tab>("devices");
  const href = `/design/grid/${encodeURIComponent(project.id)}/schedule?option=${encodeURIComponent(activeOptionId)}`;
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: "#6d7076", padding: 18 }}>
      <div
        style={{
          maxWidth: tab === "devices" ? 1240 : 960,
          margin: "0 auto",
          background: "#fff",
          borderRadius: 8,
          padding: "16px 22px 22px",
          color: "#1a1a1a",
          boxShadow: "0 1px 3px rgba(0,0,0,.18)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
          <div role="tablist" aria-label="Spreadsheet" style={{ display: "inline-flex", gap: 2, background: "#f0f1f4", borderRadius: 8, padding: 2 }}>
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                style={{
                  border: "none",
                  borderRadius: 6,
                  padding: "4px 12px",
                  fontSize: 12.5,
                  fontWeight: 600,
                  fontFamily: "inherit",
                  cursor: "pointer",
                  background: tab === t.key ? "#fff" : "transparent",
                  color: tab === t.key ? "#16181d" : "#5b616e",
                  boxShadow: tab === t.key ? "0 1px 2px rgba(0,0,0,.12)" : "none",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          {project.options.length > 1 && <span style={{ fontSize: 12.5, color: "#8c919c" }}>{activeOption.name}</span>}
          <span style={{ flex: 1 }} />
          {tab === "schedule" && (
            <Link href={href} style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}>
              Open printable schedule →
            </Link>
          )}
        </div>
        {tab === "devices" ? (
          <DevicesTable ed={ed} />
        ) : schedule ? (
          <ScheduleTable schedule={schedule} accent="var(--accent)" />
        ) : (
          <div style={{ fontSize: 13, color: "#8c919c", padding: "18px 0" }}>
            The schedule couldn&apos;t be built — open the printable schedule to see the error.
          </div>
        )}
      </div>
    </div>
  );
}
