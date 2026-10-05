"use client";

import { useEffect, useState } from "react";
import { EquipmentMapLink } from "@/components/design/equipment-map-link";
import { systemStatus, type StatusItem, type StatusLevel } from "@/lib/design/grid-system-status";
import ScopePanel from "../scope-panel";
import type { GridEditor } from "../use-grid-editor";
import { IconChevronDown } from "./icons";
import { PANEL_LABEL } from "./property-editor";

/**
 * System Status (#299) — one list of the warnings the editor already
 * computes (`systemStatus(` in lib/design/grid-system-status), each with
 * its fix where there is one; and Targets — the Scope panel, unchanged, in
 * a collapsible section under it. The BOM keeps its own incomplete-quote
 * and tier-fallback banners (they belong to the quote flow); this list
 * echoes them.
 */

const ICON: Record<StatusLevel, { glyph: string; color: string }> = {
  warn: { glyph: "⚠", color: "#8a6d1f" },
  error: { glyph: "✕", color: "#a0442b" },
  info: { glyph: "ⓘ", color: "#8c919c" },
};

const FIX_BTN: React.CSSProperties = {
  border: "none",
  background: "none",
  padding: 0,
  fontSize: 11,
  fontWeight: 600,
  color: "var(--accent)",
  cursor: "pointer",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};

const HEADER: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 10px",
  background: "#f7f8fa",
  borderBottom: "1px solid #f0f1f4",
};

export default function SystemStatus({ ed }: { ed: GridEditor }) {
  const { err, sheet, cal, page, needsPart, hiddenUnmapped, tierFallbackLines, wires, routes, enterTool, fileRef } = ed;
  const items = systemStatus({
    err,
    hasSheet: Boolean(sheet),
    calibrated: Boolean(cal),
    page,
    needsPart,
    hiddenUnmapped,
    tierFallback: tierFallbackLines,
    unmeasuredWires: wires.unmeasured,
    hasWires: (routes || []).length > 0,
  });

  const fix = (it: StatusItem) => {
    switch (it.fix) {
      case "calibrate":
        return (
          <button type="button" style={FIX_BTN} disabled={!sheet} onClick={() => enterTool("calibrate")}>
            Calibrate
          </button>
        );
      case "upload":
        return (
          <button type="button" style={FIX_BTN} onClick={() => fileRef.current?.click()}>
            Upload
          </button>
        );
      case "map":
        return (
          <EquipmentMapLink style={{ ...FIX_BTN, textDecoration: "none" }} fallback="Ask an admin">
            Map it →
          </EquipmentMapLink>
        );
      default:
        return null;
    }
  };

  return (
    <section aria-label="System status" style={{ background: "#fff", borderBottom: "1px solid #dfe2e8" }}>
      <div style={HEADER}>
        <span style={{ ...PANEL_LABEL, flex: 1 }}>System status</span>
        <span style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", color: items.length ? "#8a6d1f" : "#8c919c" }}>{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div style={{ padding: "7px 10px", fontSize: 11.5, color: "#2e7d55" }}>Nothing needs attention.</div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {items.map((it) => (
            <li
              key={it.key}
              data-status-key={it.key}
              style={{ display: "flex", alignItems: "baseline", gap: 7, padding: "5px 10px", fontSize: 11.5, borderBottom: "1px solid #f0f1f4", lineHeight: 1.4 }}
            >
              <span aria-label={it.level} style={{ color: ICON[it.level].color, flex: "0 0 auto", width: 12, textAlign: "center" }}>
                {ICON[it.level].glyph}
              </span>
              <span style={{ flex: 1, minWidth: 0, color: it.level === "error" ? "#a0442b" : "#3d424e" }}>{it.text}</span>
              {fix(it)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* --------------------------------- targets --------------------------------- */

const TARGETS_OPEN_KEY = "pk.grid.targets.open.v1";

/** The Scope / Placed-vs-target panel (#211, D305), unchanged, in a
 *  collapsible section — open by default; the choice is per viewer. */
export function Targets({ ed }: { ed: GridEditor }) {
  const { router, project, scopeTargets, auto, placements, activeOption, activeOptionId, projectScopeRollup, setErr, setRefillScope } = ed;
  const [open, setOpen] = useState(true);
  useEffect(() => {
    // Mount: apply the stored choice (hydration-safe — the inbox-layout pattern).
    queueMicrotask(() => {
      try {
        const v = window.localStorage.getItem(TARGETS_OPEN_KEY);
        if (v === "0") setOpen(false);
      } catch {
        /* storage unavailable — stay open */
      }
    });
  }, []);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      window.localStorage.setItem(TARGETS_OPEN_KEY, next ? "1" : "0");
    } catch {
      /* per-viewer convenience only */
    }
  };
  return (
    <section aria-label="Targets" style={{ background: "#fff", borderBottom: "1px solid #dfe2e8" }}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        style={{ ...HEADER, width: "100%", border: "none", borderBottom: "1px solid #f0f1f4", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}
      >
        <span style={{ ...PANEL_LABEL, flex: 1 }}>Targets</span>
        <span aria-hidden style={{ display: "inline-flex", color: "#8c919c", transform: open ? "none" : "rotate(-90deg)" }}>
          <IconChevronDown size={12} />
        </span>
      </button>
      {open && (
        <div style={{ padding: 10 }}>
          {/* scope targets (#211, D305) */}
          <ScopePanel
            key={activeOptionId}
            projectId={project.id}
            scopeInputs={project.scopeInputs}
            byScope={projectScopeRollup?.byScope || []}
            targets={scopeTargets}
            optionId={activeOptionId}
            auto={auto}
            placements={placements}
            defaultTier={activeOption.tier}
            onChanged={() => router.refresh()}
            onError={(m) => setErr(m)}
            onRefill={setRefillScope}
          />
        </div>
      )}
    </section>
  );
}
