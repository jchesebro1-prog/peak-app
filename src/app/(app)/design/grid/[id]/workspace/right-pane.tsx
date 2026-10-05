"use client";

import { useEffect, useState } from "react";
import { SCOPE_COLORS } from "@/lib/design/grid-scopes";
import LayersPanel from "../layers-panel";
import RevisionsPanel from "../revisions-panel";
import SpacesPanel from "../spaces-panel";
import WiresPanel from "../wires-panel";
import type { GridEditor } from "../use-grid-editor";
import BomPanel from "./bom-panel";

/**
 * The right pane (#299): one tab strip — Browser · Layers · Spaces · Wires ·
 * BOM · Revisions — over the active tab's body. The active tab is per viewer
 * (localStorage), applied after mount. Selecting something on the plan never
 * switches tabs; the selection shows in the Property Editor.
 */

const TABS = ["Browser", "Layers", "Spaces", "Wires", "BOM", "Revisions"] as const;
type RightTab = (typeof TABS)[number];
const RIGHT_TAB_KEY = "pk.grid.rightTab.v1";
const DEFAULT_TAB: RightTab = "Layers";

function isTab(v: string | null): v is RightTab {
  return v != null && (TABS as readonly string[]).includes(v);
}

export default function RightPane({ ed }: { ed: GridEditor }) {
  const [tab, setTab] = useState<RightTab>(DEFAULT_TAB);
  useEffect(() => {
    // Mount: apply the stored tab (hydration-safe — the inbox-layout pattern).
    queueMicrotask(() => {
      try {
        const v = window.localStorage.getItem(RIGHT_TAB_KEY);
        if (isTab(v)) setTab(v);
      } catch {
        /* storage unavailable — keep the default */
      }
    });
  }, []);
  const pick = (t: RightTab) => {
    setTab(t);
    try {
      window.localStorage.setItem(RIGHT_TAB_KEY, t);
    } catch {
      /* per-viewer convenience only */
    }
  };

  const {
    router,
    project,
    busy,
    setErr,
    setSelected,
    setHiddenLayers,
    hiddenSet,
    toggleLayer,
    spaceDrawing,
    setSpaceDrawing,
    selectedSpaceId,
    setSelectedSpaceId,
    wireDrawing,
    setWireDrawing,
    wirePartId,
    setWirePartId,
    selectedRouteId,
    setSelectedRouteId,
    cal,
    scopeCounts,
    typeRows,
    categoryCounts,
    pageSpaces,
    visibleRoutes,
    wireParts,
    wires,
    spaceRollups,
    enterTool,
    setSpaceDraft,
    setWireDraft,
  } = ed;

  return (
    <div style={{ minHeight: "100%" }}>
      <div
        role="tablist"
        aria-label="Browser tabs"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 3,
          display: "flex",
          // Six tabs just fit the default 280px pane; a narrower pane wraps
          // them rather than hiding any.
          flexWrap: "wrap",
          background: "#fff",
          borderBottom: "1px solid #edeff3",
        }}
      >
        {TABS.map((t) => {
          const active = t === tab;
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => pick(t)}
              style={{
                flex: "1 0 auto",
                border: "none",
                borderBottom: `2px solid ${active ? "#16181d" : "transparent"}`,
                background: "none",
                padding: "7px 3px 6px",
                fontSize: 11.5,
                // One weight for every tab, so picking one never reflows the strip.
                fontWeight: 600,
                color: active ? "#16181d" : "#8c919c",
                cursor: "pointer",
                fontFamily: "inherit",
                whiteSpace: "nowrap",
              }}
            >
              {t}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" aria-label={tab} style={{ display: "grid", gap: 12, padding: 12 }}>
        {tab === "Browser" && (
          <div style={{ fontSize: 11.5, color: "#8c919c" }}>Browser tree arrives in the next step.</div>
        )}

        {/* layers (punch #48) - visibility of what's already placed */}
        {tab === "Layers" && (
          <LayersPanel
            scopeCounts={scopeCounts}
            typeRows={typeRows}
            categoryCounts={categoryCounts}
            hidden={hiddenSet}
            scopeColor={(s) => SCOPE_COLORS[s]}
            onToggle={toggleLayer}
            onShowAll={() => setHiddenLayers([])}
          />
        )}

        {/* spaces (D109) */}
        {tab === "Spaces" && (
          <SpacesPanel
            pageSpaces={pageSpaces}
            rollups={spaceRollups}
            drawing={spaceDrawing}
            selectedSpaceId={selectedSpaceId}
            busy={busy}
            onStartDraw={() => enterTool("space")}
            onCancelDraw={() => {
              setSpaceDrawing(false);
              setSpaceDraft([]);
            }}
            onSelect={(id) => {
              setSelectedSpaceId(id);
              setSelected(null);
              setSelectedRouteId(null);
            }}
          />
        )}

        {/* wires (D110) */}
        {tab === "Wires" && (
          <WiresPanel
            wireParts={wireParts}
            /* The list matches the canvas: a run in a hidden scope is out of
               sight and out of this list too (#48). */
            pageRoutes={visibleRoutes}
            calibrations={project.calibrations}
            calibrated={Boolean(cal)}
            wiring={wireDrawing}
            wirePartId={wirePartId}
            selectedRouteId={selectedRouteId}
            unmeasured={wires.unmeasured}
            busy={busy}
            onPickPart={(id) => setWirePartId(id)}
            onStartDraw={() => enterTool("wire")}
            onCancelDraw={() => {
              setWireDrawing(false);
              setWireDraft([]);
            }}
            onSelect={(id) => {
              setSelectedRouteId(id);
              setSelected(null);
              setSelectedSpaceId(null);
            }}
          />
        )}

        {tab === "BOM" && <BomPanel ed={ed} />}

        {/* revisions (D109) */}
        {tab === "Revisions" && (
          <RevisionsPanel
            projectId={project.id}
            revisions={project.revisions}
            busy={busy}
            onChanged={() => router.refresh()}
            onError={(m) => setErr(m)}
          />
        )}
      </div>
    </div>
  );
}
