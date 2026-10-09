"use client";

import { useGridEditor, type GridEditorProps } from "./use-grid-editor";
import PlanCanvas from "./plan-canvas";
import GridWorkspace from "./workspace/grid-workspace";
import Toolbar from "./workspace/toolbar";
import SheetTabs, { ViewTabs } from "./workspace/sheet-tabs";
import SpreadsheetView from "./workspace/spreadsheet-view";
import StatusBar from "./workspace/status-bar";
import ProductLibrary from "./workspace/product-library";
import PropertyEditor from "./workspace/property-editor";
import SystemStatus, { Targets } from "./workspace/system-status";
import RightPane from "./workspace/right-pane";
import CalibratePrompt from "./workspace/calibrate-prompt";

/**
 * The Grid editor (D108) — device painting on plan sheets, in the markup
 * screen's idiom (D95/D96): all geometry normalized 0..1, inline entry
 * instead of window.prompt (unavailable here).
 *
 * Painting = the count tool grown up: arm a catalog part in the palette,
 * click the plan to drop instances; the BOM groups and prices them live.
 *
 * #299: a docked, full-window workspace — toolbar, sheet tabs over the
 * plan, a status bar; the left pane holds the Property Editor, System
 * Status and Targets; the right pane's tabs hold Browser, Layers, Spaces,
 * Wires, the BOM and Revisions.
 */

export default function GridEditor(props: GridEditorProps) {
  const ed = useGridEditor(props);
  return (
    <GridWorkspace
      ed={ed}
      toolbar={<Toolbar ed={ed} />}
      left={
        <>
          <PropertyEditor ed={ed} />
          <SystemStatus ed={ed} />
          <Targets ed={ed} />
        </>
      }
      right={<RightPane ed={ed} />}
      bottom={<ProductLibrary ed={ed} />}
      center={
        <>
          <SheetTabs ed={ed} />
          <CalibratePrompt ed={ed} />
          {/* The plan stays mounted while the Spreadsheet view shows, so the
              PDF render, zoom and scroll survive the round trip. */}
          <div style={{ display: ed.view === "plan" ? "flex" : "none", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0 }}>
            <PlanCanvas ed={ed} onDropPart={ed.placeAt} />
          </div>
          {ed.view === "sheet" && <SpreadsheetView ed={ed} />}
          <ViewTabs ed={ed} />
        </>
      }
      status={<StatusBar ed={ed} />}
    />
  );
}
