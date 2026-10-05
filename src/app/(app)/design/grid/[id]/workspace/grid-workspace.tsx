"use client";

import { useCallback, useEffect, useState } from "react";
import {
  defaultCollapsed,
  PANE_COLLAPSED_KEY,
  PANE_DEFAULTS,
  PANE_SIZE_KEY,
  parseCollapsed,
  parsePaneSize,
  type PaneKey,
} from "@/lib/design/grid-workspace-layout";
import type { GridEditor } from "../use-grid-editor";
import { Pane } from "./pane";

/**
 * The Grid's docked workspace (#299): toolbar on top, left / center / right
 * panes, the bottom pane, and the status bar — a CSS grid that fills the
 * app's main area under the nav, so the page itself never scrolls; every
 * pane scrolls on its own. Pane sizes and collapsed state are per viewer
 * (localStorage), applied after mount so the first render matches the
 * server. A pane passed as null is not rendered at all (no strip).
 */

const STRIP = 28;
const PANE_TITLES: Record<PaneKey, string> = { left: "Properties", right: "Browser", bottom: "Library" };

function save(key: string, v: string) {
  try {
    window.localStorage.setItem(key, v);
  } catch {
    /* per-viewer convenience only — the layout still applies for this view */
  }
}

export default function GridWorkspace({
  ed,
  left,
  right,
  bottom,
  center,
  toolbar,
  status,
}: {
  ed: GridEditor;
  left: React.ReactNode;
  right: React.ReactNode;
  bottom: React.ReactNode;
  center: React.ReactNode;
  toolbar: React.ReactNode;
  status: React.ReactNode;
}) {
  const [sizes, setSizes] = useState<Record<PaneKey, number>>({ ...PANE_DEFAULTS });
  const [collapsed, setCollapsed] = useState<Record<PaneKey, boolean>>({ left: false, right: false, bottom: false });
  useEffect(() => {
    // Mount: apply stored values (hydration-safe — the inbox-layout pattern;
    // queueMicrotask keeps the setState out of the effect body itself).
    queueMicrotask(() => {
      const vw = window.innerWidth;
      const read = (key: string) => {
        try {
          return window.localStorage.getItem(key);
        } catch {
          return null;
        }
      };
      setSizes({
        left: parsePaneSize("left", read(PANE_SIZE_KEY("left"))),
        right: parsePaneSize("right", read(PANE_SIZE_KEY("right"))),
        bottom: parsePaneSize("bottom", read(PANE_SIZE_KEY("bottom"))),
      });
      setCollapsed({
        left: parseCollapsed(read(PANE_COLLAPSED_KEY("left")), defaultCollapsed("left", vw)),
        right: parseCollapsed(read(PANE_COLLAPSED_KEY("right")), defaultCollapsed("right", vw)),
        bottom: parseCollapsed(read(PANE_COLLAPSED_KEY("bottom")), defaultCollapsed("bottom", vw)),
      });
    });
  }, []);

  const resize = useCallback((k: PaneKey, px: number) => {
    setSizes((prev) => (prev[k] === px ? prev : { ...prev, [k]: px }));
  }, []);
  // Persist only when a drag ends (or the size resets) — not on every move.
  const persistSize = useCallback((k: PaneKey, px: number) => {
    save(PANE_SIZE_KEY(k), String(px));
  }, []);
  const toggle = (k: PaneKey) => {
    const next = !collapsed[k];
    setCollapsed((prev) => ({ ...prev, [k]: next }));
    save(PANE_COLLAPSED_KEY(k), next ? "1" : "0");
  };

  const has = { left: left != null, right: right != null, bottom: bottom != null };
  const track = (k: PaneKey) => (collapsed[k] ? STRIP : sizes[k]);
  const columns = [has.left ? `${track("left")}px` : null, "minmax(0,1fr)", has.right ? `${track("right")}px` : null]
    .filter(Boolean)
    .join(" ");

  const pane = (k: PaneKey, side: "left" | "right" | "bottom", body: React.ReactNode) => (
    <Pane
      k={k}
      title={PANE_TITLES[k]}
      side={side}
      size={sizes[k]}
      collapsed={collapsed[k]}
      onResize={(px) => resize(k, px)}
      onResizeEnd={(px) => persistSize(k, px)}
      onToggle={() => toggle(k)}
    >
      {body}
    </Pane>
  );

  return (
    // The wrapper takes the main area's full height (.pk-main is the shell's
    // flex:1 item, so 100% resolves); the grid inside is pinned to it, so no
    // pane's content can ever stretch the page into scrolling.
    <div style={{ position: "relative", height: "100%", minHeight: 480, overflow: "hidden", background: "#fff" }}>
      <div
        data-grid-tool={ed.tool}
        style={{
          position: "absolute",
          inset: 0,
          minHeight: 0,
          display: "grid",
          gridTemplateRows: "auto minmax(0,1fr) auto auto",
          gridTemplateColumns: "minmax(0,1fr)",
          overflow: "hidden",
        }}
      >
        <div style={{ gridRow: 1, minWidth: 0, position: "relative", zIndex: 20 }}>{toolbar}</div>
        <div style={{ gridRow: 2, minHeight: 0, minWidth: 0, display: "grid", gridTemplateColumns: columns, gridTemplateRows: "minmax(0,1fr)" }}>
          {has.left && pane("left", "left", left)}
          <div style={{ minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", background: "#6d7076" }}>{center}</div>
          {has.right && pane("right", "right", right)}
        </div>
        <div style={{ gridRow: 3, minWidth: 0, height: has.bottom ? track("bottom") : 0 }}>{has.bottom && pane("bottom", "bottom", bottom)}</div>
        <div style={{ gridRow: 4, minWidth: 0 }}>{status}</div>
      </div>
    </div>
  );
}
