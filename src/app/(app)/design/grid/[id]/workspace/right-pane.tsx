"use client";

import { useEffect, useRef, useState } from "react";
import { SCOPE_COLORS } from "@/lib/design/grid-scopes";
import LayersPanel from "../layers-panel";
import RevisionsPanel from "../revisions-panel";
import SpacesPanel from "../spaces-panel";
import WiresPanel from "../wires-panel";
import type { GridEditor } from "../use-grid-editor";
import BomPanel from "./bom-panel";
import BrowserTree from "./browser-tree";

/**
 * The right pane (#299): one tab strip — Browser · Layers · Spaces · Wires ·
 * BOM · Revisions — over the active tab's body. The active tab is per viewer
 * (localStorage), applied after mount. Selecting something on the plan never
 * switches tabs; the selection shows in the Property Editor. Every tab body
 * stays mounted (inactive ones are `hidden`), so a half-typed revision note or
 * custom item survives a trip to another tab.
 */

const TABS = ["Browser", "Layers", "Spaces", "Wires", "BOM", "Revisions"] as const;
type RightTab = (typeof TABS)[number];
const RIGHT_TAB_KEY = "pk.grid.rightTab.v1";
const DEFAULT_TAB: RightTab = "Browser";
const tabId = (t: RightTab) => `grid-right-tab-${t.toLowerCase()}`;
const panelId = (t: RightTab) => `grid-right-panel-${t.toLowerCase()}`;

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
  // Roving tabindex: only the active tab is in the Tab order; ←/→ move
  // between tabs (wrapping) and pick the one they land on.
  const tabRefs = useRef<Partial<Record<RightTab, HTMLButtonElement | null>>>({});
  const onTabKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const i = TABS.indexOf(tab);
    const n = TABS.length;
    const next =
      e.key === "Home" ? TABS[0] : e.key === "End" ? TABS[n - 1] : TABS[(i + (e.key === "ArrowRight" ? 1 : n - 1)) % n];
    pick(next);
    tabRefs.current[next]?.focus();
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
        aria-label="Right pane tabs"
        onKeyDown={onTabKey}
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
              id={tabId(t)}
              ref={(el) => {
                tabRefs.current[t] = el;
              }}
              aria-selected={active}
              aria-controls={panelId(t)}
              tabIndex={active ? 0 : -1}
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
      <Panel t="Browser" tab={tab}>
        <BrowserTree ed={ed} />
      </Panel>

      {/* layers (punch #48) - visibility of what's already placed */}
      <Panel t="Layers" tab={tab}>
        <LayersPanel
          scopeCounts={scopeCounts}
          typeRows={typeRows}
          categoryCounts={categoryCounts}
          hidden={hiddenSet}
          scopeColor={(s) => SCOPE_COLORS[s]}
          onToggle={toggleLayer}
          onShowAll={() => setHiddenLayers([])}
        />
      </Panel>

      {/* spaces (D109) */}
      <Panel t="Spaces" tab={tab}>
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
      </Panel>

      {/* wires (D110) */}
      <Panel t="Wires" tab={tab}>
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
      </Panel>

      <Panel t="BOM" tab={tab}>
        <BomPanel ed={ed} />
      </Panel>

      {/* revisions (D109) */}
      <Panel t="Revisions" tab={tab}>
        <RevisionsPanel
          projectId={project.id}
          revisions={project.revisions}
          busy={busy}
          onChanged={() => router.refresh()}
          onError={(m) => setErr(m)}
        />
      </Panel>
    </div>
  );
}

/** One tab body. Inactive bodies stay mounted but `hidden`, so their drafts
 *  survive a tab switch. */
function Panel({ t, tab, children }: { t: RightTab; tab: RightTab; children: React.ReactNode }) {
  return (
    <div
      role="tabpanel"
      id={panelId(t)}
      aria-labelledby={tabId(t)}
      hidden={t !== tab}
      style={{ display: t === tab ? "grid" : "none", gap: 12, padding: 12 }}
    >
      {children}
    </div>
  );
}
