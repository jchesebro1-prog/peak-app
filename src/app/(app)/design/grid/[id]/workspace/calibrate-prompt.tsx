"use client";

import type { GridEditor } from "../use-grid-editor";

/**
 * #314 — one line over the plan when the page on screen has no scale yet (an
 * uploaded plan view, or any uploaded sheet): calibration stays manual, so
 * this just points at the existing Calibrate tool. Hidden while calibrating,
 * on the Spreadsheet view, and once the page is calibrated.
 */
export default function CalibratePrompt({ ed }: { ed: GridEditor }) {
  const { sheet, cal, calibrating, enterTool, view, busy } = ed;
  if (!sheet || cal || calibrating || view !== "plan") return null;
  return (
    <div
      data-testid="calibrate-prompt"
      style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 10px", background: "#fdf4e7", borderBottom: "1px solid #f0dcbb", fontSize: 11.5, color: "#7a5a1c" }}
    >
      <span>This page has no scale yet — distances, wire runs and snap need one.</span>
      <button
        type="button"
        disabled={busy}
        onClick={() => enterTool("calibrate")}
        style={{ border: "1px solid #e6cf9f", background: "#fff", borderRadius: 6, padding: "1px 8px", fontFamily: "inherit", fontSize: 11.5, fontWeight: 600, color: "#7a5a1c", cursor: "pointer" }}
      >
        Calibrate scale
      </button>
    </div>
  );
}
