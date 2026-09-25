"use client";

import { useSyncExternalStore } from "react";
import type { LegendRow } from "@/lib/design/grid-icons";
import { SymbolIcon } from "@/components/design/symbol-shape";

/**
 * Plan legend (stock symbols, spec 2026-09-25 §2/§6) — a small collapsible
 * key over the plan's bottom-left corner listing each colour/icon drawn on
 * this sheet. Open/closed persists per browser (localStorage, read through
 * useSyncExternalStore so SSR and hydration agree); the rows always print,
 * even when collapsed on screen.
 */

const KEY = "grid.planLegend.open";
const EVT = "grid-plan-legend";

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVT, cb);
  };
}

function readOpen(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

function writeOpen(open: boolean) {
  try {
    window.localStorage.setItem(KEY, open ? "1" : "0");
  } catch {
    /* private mode — the toggle still works for this page view via the event */
  }
  window.dispatchEvent(new Event(EVT));
}

export default function PlanLegend({ rows }: { rows: LegendRow[] }) {
  const open = useSyncExternalStore(subscribe, readOpen, () => true);
  if (!rows.length) return null;
  return (
    <div
      className="grid-plan-legend"
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute", left: 8, bottom: 8, zIndex: 4, maxWidth: 260, lineHeight: 1.35,
        background: "rgba(255,255,255,.94)", border: "1px solid #dfe2e8", borderRadius: 8, padding: "6px 9px",
        boxShadow: "0 2px 8px rgba(0,0,0,.12)", fontSize: 11,
      }}
    >
      <style>{`@media print { .grid-plan-legend-rows { display: grid !important; } .grid-plan-legend-toggle { display: none !important; } }`}</style>
      <button
        type="button"
        className="grid-plan-legend-toggle"
        onClick={() => writeOpen(!open)}
        aria-expanded={open}
        style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#8c919c" }}
      >
        Legend {open ? "▾" : "▸"}
      </button>
      <div className="grid-plan-legend-rows" style={{ display: open ? "grid" : "none", gap: 3, marginTop: 4 }}>
        {rows.map((r) => (
          <span key={r.key} style={{ display: "flex", alignItems: "center", gap: 6, color: "#3d424e" }}>
            <SymbolIcon iconId={r.iconId} color={r.color} size={14} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
