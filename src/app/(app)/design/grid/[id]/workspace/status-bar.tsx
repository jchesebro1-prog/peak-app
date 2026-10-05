"use client";

import { formatMeasure } from "@/lib/annotations";
import { placementQty } from "@/lib/design/grid-bom";
import type { GridEditor } from "../use-grid-editor";

/**
 * The workspace footer (#299): last action · devices on this sheet / in the
 * design · the page's scale · the last error at the right end. The app nav
 * already shows sync state, so it isn't repeated here.
 */
/** The old editor footer's help text (dropped in the #299 rebuild). */
const DEVICES_HELP =
  "Arm a device and click the plan to place each unit · click a marker to select it, drag it to move it (arrow keys nudge) · click inside a space to select the room · the BOM prices every sheet in this design, not just the visible page.";

export default function StatusBar({ ed }: { ed: GridEditor }) {
  const { lastAction, sheetPlacements, placements, selectedPlacements, sheet, cal, page, err, setErr } = ed;
  const onSheet = sheetPlacements.reduce((n, pl) => n + placementQty(pl), 0);
  const inDesign = placements.reduce((n, pl) => n + placementQty(pl), 0);
  const scale = !sheet ? "no sheet" : cal ? `calibrated · ref ${formatMeasure(cal.refLength, cal.unit)}` : `not calibrated (page ${page})`;
  const sep = <span aria-hidden style={{ color: "#c3c7cf" }}>·</span>;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: 24,
        padding: "0 10px",
        borderTop: "1px solid #dfe2e8",
        background: "#f7f8fa",
        fontSize: 11.5,
        color: "#8c919c",
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>Last action: {lastAction ?? "—"}</span>
      {sep}
      <span title={DEVICES_HELP}>
        Devices: {onSheet} / {inDesign}
      </span>
      {sep}
      <span>Scale: {scale}</span>
      {selectedPlacements.length > 1 && (
        <>
          {sep}
          <span>Selected: {selectedPlacements.length}</span>
        </>
      )}
      <span style={{ flex: 1 }} />
      {err && (
        <span role="alert" style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0, color: "#a0442b", fontWeight: 600 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }} title={err}>
            {err}
          </span>
          <button
            type="button"
            onClick={() => setErr(null)}
            aria-label="Dismiss the error"
            title="Dismiss"
            style={{ border: "none", background: "none", color: "#a0442b", cursor: "pointer", fontSize: 13, padding: 0, lineHeight: 1 }}
          >
            ×
          </button>
        </span>
      )}
    </div>
  );
}
