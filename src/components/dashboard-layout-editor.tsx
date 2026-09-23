"use client";

import { useState, useTransition } from "react";
import {
  DASHBOARD_WIDGETS,
  type DashboardLayout,
  type DashboardOverride,
  type DashboardWidgetKey,
} from "@/lib/dashboard-layout";
import { saveSettingsAction } from "@/app/(app)/settings/actions";
import { saveDashboardOverrideAction } from "@/app/(app)/account/actions";

const LABELS: Record<DashboardWidgetKey, string> = {
  stats: "Stat tiles",
  pipeline: "Pipeline",
  calendar: "Calendar",
  queue: "My queue",
  inbox: "Inbox",
  leads: "My leads",
  designs: "My designs",
  surveys: "Venue assessments",
  teamActivity: "Team activity",
  needsAttention: "Needs attention",
  catalog: "Catalog",
};

type Props =
  | { mode: "company"; initial: DashboardLayout }
  | { mode: "personal"; company: DashboardLayout; initial: DashboardOverride | null };

export default function DashboardLayoutEditor(props: Props) {
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [layout, setLayout] = useState<DashboardLayout>(() =>
    props.mode === "company" ? props.initial : props.company
  );
  const [override, setOverride] = useState<DashboardOverride>(
    props.mode === "personal" ? props.initial || {} : {}
  );

  const save = () => {
    setSaved(false);
    startTransition(async () => {
      if (props.mode === "company") await saveSettingsAction({ dashboardDefaults: layout });
      else await saveDashboardOverrideAction(override);
      setSaved(true);
    });
  };

  const move = (key: DashboardWidgetKey, direction: -1 | 1) => {
    const current = props.mode === "company" ? layout.widgets.map((w) => w.key) : (override.order || layout.widgets.map((w) => w.key));
    const index = current.indexOf(key);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return;
    const next = [...current];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    if (props.mode === "company") {
      setLayout((prev) => ({
        ...prev,
        widgets: next.map((k, position) => ({ ...prev.widgets.find((w) => w.key === k)!, position })),
      }));
    } else {
      setOverride((prev) => ({ ...prev, order: next }));
    }
  };

  const toggle = (key: DashboardWidgetKey) => {
    if (props.mode === "company") {
      setLayout((prev) => ({
        ...prev,
        widgets: prev.widgets.map((w) => (w.key === key ? { ...w, visible: !w.visible } : w)),
      }));
    } else {
      setOverride((prev) => {
        const hidden = new Set(prev.hidden || []);
        if (hidden.has(key)) hidden.delete(key);
        else hidden.add(key);
        return { ...prev, hidden: [...hidden] };
      });
    }
  };

  const reset = () => {
    if (props.mode === "company") setLayout(props.initial);
    else setOverride({});
    setSaved(false);
  };

  const rows = props.mode === "company"
    ? layout.widgets
    : layout.widgets
        .map((w) => ({ ...w, visible: !(override.hidden || []).includes(w.key) }))
        .sort((a, b) => (override.order || []).indexOf(a.key) - (override.order || []).indexOf(b.key));

  return (
    <section className="pk-card" style={{ padding: "17px 18px", marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>
            {props.mode === "company" ? "Dashboard defaults" : "My dashboard"}
          </div>
          <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3, lineHeight: 1.45 }}>
            {props.mode === "company"
              ? "Choose the starting dashboard layout for the company. Team members may override it in their own Account Settings."
              : "Choose your personal dashboard layout. Unchanged widgets continue to follow company defaults."}
          </div>
        </div>
        {saved && <span style={{ fontSize: 11.5, color: "#1f7a52" }}>Saved</span>}
      </div>
      <div style={{ display: "grid", gap: 6, marginTop: 14 }}>
        {rows.map((row, index) => (
          <div key={row.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 9px", border: "1px solid #eef0f3", borderRadius: 8 }}>
            <button type="button" onClick={() => toggle(row.key)} aria-label={`${row.visible ? "Hide" : "Show"} ${LABELS[row.key]}`} style={{ width: 26, height: 24, border: "1px solid #e4e7ec", borderRadius: 6, background: row.visible ? "var(--accent-soft)" : "#f1f2f5", color: row.visible ? "var(--accent)" : "#aab0bb", cursor: "pointer" }}>
              {row.visible ? "✓" : "–"}
            </button>
            <span style={{ flex: 1, fontSize: 12.5, color: row.visible ? "#30343b" : "#aab0bb" }}>{LABELS[row.key]}</span>
            <button type="button" onClick={() => move(row.key, -1)} disabled={index === 0} aria-label={`Move ${LABELS[row.key]} up`} style={smallButton}>&uarr;</button>
            <button type="button" onClick={() => move(row.key, 1)} disabled={index === rows.length - 1} aria-label={`Move ${LABELS[row.key]} down`} style={smallButton}>&darr;</button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button type="button" className="pk-btn-outline" onClick={reset} disabled={pending}>Reset</button>
        <button type="button" className="pk-btn-accent" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save layout"}</button>
      </div>
    </section>
  );
}

const smallButton: React.CSSProperties = {
  width: 25,
  height: 24,
  border: "1px solid #e4e7ec",
  borderRadius: 6,
  background: "#fff",
  color: "#68707b",
  cursor: "pointer",
};

