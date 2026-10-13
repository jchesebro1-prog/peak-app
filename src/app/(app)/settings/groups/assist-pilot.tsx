"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setAssistSettingsAction } from "../actions";
import { inputStyle, type Run } from "./shared";
import type { AssistVM, UserVM } from "./types";
import type { ReportRow } from "@/lib/assist/report";

/**
 * #334 — Settings → Data & Tools → Beta → Assist pilot: who has Assist
 * (an empty list = nobody), the three feature switches, the monthly spend cap,
 * and the month's usage report. Costs are estimates (D879).
 */

const FEATURES = [
  { key: "tasks", label: "Suggest tasks" },
  { key: "reply", label: "Draft reply" },
  { key: "estimate", label: "Draft estimate" },
] as const;

const money = (n: number) => (n > 0 && n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

const th: React.CSSProperties = { textAlign: "right", padding: "4px 8px", fontWeight: 600, color: "#8c919c", fontSize: 11.5 };
const td: React.CSSProperties = { textAlign: "right", padding: "4px 8px", fontSize: 12.5, fontFamily: "var(--font-mono)" };

function ReportTable({ title, rows }: { title: string; rows: ReportRow[] }) {
  return (
    <div style={{ marginTop: 12, overflowX: "auto" }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{title}</div>
      <table style={{ borderCollapse: "collapse", minWidth: 460, width: "100%" }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>{title.replace("By ", "")}</th>
            <th style={th}>Runs</th>
            <th style={th}>OK</th>
            <th style={th}>Accepted</th>
            <th style={th}>Edited</th>
            <th style={th}>Discarded</th>
            <th style={th}>No outcome</th>
            <th style={th}>Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} style={{ ...td, textAlign: "left", color: "#9aa0ab", fontFamily: "inherit" }}>
                No runs this month.
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.key} style={{ borderTop: "1px solid #f3f4f7" }}>
              <td style={{ ...td, textAlign: "left", fontFamily: "inherit" }}>{r.key}</td>
              <td style={td}>{r.runs}</td>
              <td style={td}>{r.okRuns}</td>
              <td style={td}>{r.accepted}</td>
              <td style={td}>{r.edited}</td>
              <td style={td}>{r.discarded}</td>
              <td style={td}>{r.pending}</td>
              <td style={td}>{money(r.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AssistPilotCard({ assist, users, run }: { assist: AssistVM; users: UserVM[]; run: Run }) {
  const router = useRouter();
  const { settings, report } = assist;
  const [picked, setPicked] = useState<string[]>(settings.users);
  const [cap, setCap] = useState(String(settings.capUsd));
  const usersDirty = [...picked].sort().join(",") !== [...settings.users].sort().join(",");
  const capNum = Number(cap);
  const capDirty = cap.trim() !== "" && Number.isFinite(capNum) && capNum !== settings.capUsd;

  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #f3f4f7" }}>
      <div style={{ fontSize: 13.5, fontWeight: 600 }}>Assist pilot</div>
      <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 2 }}>{assist.status}</div>
      <div style={{ fontSize: 12.5, marginTop: 6 }}>
        This month: <b>{money(assist.spendUsd)}</b> of ${settings.capUsd.toFixed(2)} (estimated)
      </div>

      {/* Pilot users */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginTop: 12 }}>
        <div style={{ fontSize: 12, color: "#9aa0ab", maxWidth: 460 }}>
          Nobody has Assist until they&apos;re ticked here.
        </div>
        <button
          className="pk-btn-accent"
          disabled={!usersDirty}
          style={!usersDirty ? { opacity: 0.5, cursor: "not-allowed", whiteSpace: "nowrap" } : { whiteSpace: "nowrap" }}
          onClick={() => run(() => setAssistSettingsAction({ users: picked }))}
        >
          Save
        </button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 8 }}>
        {users
          .filter((u) => u.status === "active")
          .map((u) => (
            <label key={u.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={picked.includes(u.id)}
                onChange={(e) =>
                  setPicked((prev) => (e.target.checked ? [...prev, u.id] : prev.filter((id) => id !== u.id)))
                }
              />
              {u.name}
            </label>
          ))}
      </div>

      {/* Feature switches */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", marginTop: 12 }}>
        {FEATURES.map((f) => (
          <label key={f.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={settings.features[f.key]}
              onChange={(e) => run(() => setAssistSettingsAction({ features: { [f.key]: e.target.checked } }))}
            />
            {f.label}
          </label>
        ))}
      </div>

      {/* Monthly cap */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
        <label style={{ fontSize: 12.5 }} htmlFor="assist-cap">
          Monthly cap ($)
        </label>
        <input
          id="assist-cap"
          type="number"
          min={0}
          max={10000}
          step={1}
          value={cap}
          onChange={(e) => setCap(e.target.value)}
          style={{ ...inputStyle, width: 110, fontFamily: "var(--font-mono)", fontSize: 13 }}
        />
        <button
          className="pk-btn-accent"
          disabled={!capDirty}
          style={!capDirty ? { opacity: 0.5, cursor: "not-allowed", whiteSpace: "nowrap" } : { whiteSpace: "nowrap" }}
          onClick={() => run(() => setAssistSettingsAction({ capUsd: capNum }))}
        >
          Save
        </button>
      </div>

      {/* Report */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>Usage report</div>
        <select
          aria-label="Report month"
          value={assist.month}
          onChange={(e) => router.push(`/settings?section=data&assistMonth=${encodeURIComponent(e.target.value)}`)}
          style={{ ...inputStyle, width: "auto", fontSize: 12.5 }}
        >
          {assist.months.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <span style={{ fontSize: 12, color: "#9aa0ab" }}>
          {report.runs} runs · {money(report.totalUsd)}
        </span>
      </div>
      <ReportTable title="By feature" rows={report.byFeature} />
      <ReportTable title="By person" rows={report.byUser} />
      <ReportTable title="By model" rows={report.byModel} />
      <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 8 }}>
        Costs are estimates from token counts × list prices; check the Claude Console for the bill.
      </div>
    </div>
  );
}
