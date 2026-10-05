"use client";

import { useRef } from "react";
import { clampPane, PANE_DEFAULTS, type PaneKey } from "@/lib/design/grid-workspace-layout";
import { IconChevronDown } from "./icons";

/**
 * One docked pane of The Grid workspace (#299): a header (title, optional
 * tabs, collapse chevron), a body that scrolls on its own, and a 6px resize
 * handle on the inner edge — right edge of the left pane, left edge of the
 * right pane, top edge of the bottom pane. Double-click the handle to reset
 * the default size. Collapsed, a pane is a 28px strip that expands on click.
 */

const PANEL_LABEL: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: "#9aa0ab",
};

const CHEVRON_BTN: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 22,
  height: 22,
  border: "none",
  background: "none",
  borderRadius: 5,
  color: "#8c919c",
  cursor: "pointer",
  padding: 0,
};

/** Which way the chevron points to collapse / expand each side. */
const ROTATE: Record<"left" | "right" | "bottom", { collapse: number; expand: number }> = {
  left: { collapse: 90, expand: -90 },
  right: { collapse: -90, expand: 90 },
  bottom: { collapse: 0, expand: 180 },
};

export function Pane({
  k,
  title,
  side,
  size,
  collapsed,
  onResize,
  onResizeEnd,
  onToggle,
  children,
  tabs,
}: {
  k: PaneKey;
  title: string;
  side: "left" | "right" | "bottom";
  size: number;
  collapsed: boolean;
  /** Live size while dragging — state only, never persisted. */
  onResize: (px: number) => void;
  /** Final size (drag released, or double-click reset) — persist here. */
  onResizeEnd: (px: number) => void;
  onToggle: () => void;
  children: React.ReactNode;
  tabs?: React.ReactNode;
}) {
  const start = useRef<{ size: number; x: number; y: number } | null>(null);
  const last = useRef<number | null>(null);
  const border = side === "left" ? { borderRight: "1px solid #dfe2e8" } : side === "right" ? { borderLeft: "1px solid #dfe2e8" } : { borderTop: "1px solid #dfe2e8" };

  // Release / cancel / lost capture all land here; persist once, if it moved.
  const endDrag = () => {
    const px = last.current;
    start.current = null;
    last.current = null;
    if (px != null) onResizeEnd(px);
  };

  if (collapsed) {
    const vertical = side !== "bottom";
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-label={`Expand ${title}`}
        title={`Expand ${title}`}
        style={{
          borderTop: side === "bottom" ? "1px solid #dfe2e8" : "none",
          borderBottom: "none",
          borderLeft: side === "right" ? "1px solid #dfe2e8" : "none",
          borderRight: side === "left" ? "1px solid #dfe2e8" : "none",
          background: "#f7f8fa",
          width: "100%",
          height: "100%",
          minHeight: 0,
          padding: vertical ? "8px 0" : "0 10px",
          display: "flex",
          flexDirection: vertical ? "column" : "row",
          alignItems: "center",
          justifyContent: "flex-start",
          gap: 8,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        <span style={{ display: "inline-flex", color: "#8c919c", transform: `rotate(${ROTATE[side].expand}deg)` }}>
          <IconChevronDown size={13} />
        </span>
        <span style={{ ...PANEL_LABEL, writingMode: vertical ? "vertical-rl" : undefined, whiteSpace: "nowrap" }}>{title}</span>
      </button>
    );
  }

  const handleStyle: React.CSSProperties =
    side === "bottom"
      ? { left: 0, right: 0, top: -3, height: 6, cursor: "row-resize" }
      : side === "left"
        ? { top: 0, bottom: 0, right: -3, width: 6, cursor: "col-resize" }
        : { top: 0, bottom: 0, left: -3, width: 6, cursor: "col-resize" };

  return (
    <section
      aria-label={title}
      style={{ ...border, position: "relative", display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, height: "100%", background: "#f7f8fa" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, height: 30, flex: "0 0 auto", padding: "0 6px 0 11px", borderBottom: "1px solid #edeff3", background: "#fff" }}>
        <span style={{ ...PANEL_LABEL, whiteSpace: "nowrap" }}>{title}</span>
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", overflow: "hidden" }}>{tabs}</div>
        <button type="button" onClick={onToggle} aria-label={`Collapse ${title}`} title={`Collapse ${title}`} style={CHEVRON_BTN}>
          <span style={{ display: "inline-flex", transform: `rotate(${ROTATE[side].collapse}deg)` }}>
            <IconChevronDown size={13} />
          </span>
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>{children}</div>
      <div
        role="separator"
        aria-orientation={side === "bottom" ? "horizontal" : "vertical"}
        aria-label={`Resize ${title}`}
        title="Drag to resize · double-click to reset"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          start.current = { size, x: e.clientX, y: e.clientY };
          last.current = null;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          e.preventDefault();
        }}
        onPointerMove={(e) => {
          const s = start.current;
          if (!s) return;
          const delta = side === "bottom" ? s.y - e.clientY : side === "left" ? e.clientX - s.x : s.x - e.clientX;
          const px = clampPane(k, s.size + delta);
          last.current = px;
          onResize(px);
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onDoubleClick={() => {
          onResize(PANE_DEFAULTS[k]);
          onResizeEnd(PANE_DEFAULTS[k]);
        }}
        style={{ position: "absolute", zIndex: 4, touchAction: "none", ...handleStyle }}
      />
    </section>
  );
}
