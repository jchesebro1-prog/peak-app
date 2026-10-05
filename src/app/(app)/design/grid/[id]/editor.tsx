"use client";

import { EquipmentMapLink } from "@/components/design/equipment-map-link";
import Link from "next/link";
import { formatMeasure } from "@/lib/annotations";
import { curtainDesc, GRID_CURTAIN_TYPES, VIRTUAL_DEAD_HINT } from "@/lib/design/grid-bom";
import { normalizeCategory, SCOPE_COLORS } from "@/lib/design/grid-scopes";
import { symbolLook } from "@/lib/design/grid-icons";
import { LaborLineRow } from "./labor-lines";
import { isSeedPlaceholder } from "@/lib/design/grid-seed";
import { clearCalAction } from "./actions";
import { curtainSpecKey } from "@/lib/specs/record-keys";
import LayersPanel from "./layers-panel";
import SpacesPanel from "./spaces-panel";
import RevisionsPanel from "./revisions-panel";
import WiresPanel from "./wires-panel";
import ScopePanel from "./scope-panel";
import AssembliesPanel from "./assemblies-panel";
import SymbolLookPanel from "./symbol-look-panel";
import CustomItemsSection from "./custom-items";
import DevicePalette from "./device-palette";
import { groupOfCustomSystem, type GroupedBomLine } from "@/lib/design/grid-bom-groups";
import { AccessoryPicker, AccessoryRow } from "./accessories";
import { useGridEditor, type GridEditor as GridEditorState, type GridEditorProps } from "./use-grid-editor";
import PlanCanvas from "./plan-canvas";
import GridWorkspace from "./workspace/grid-workspace";
import Toolbar from "./workspace/toolbar";
import SheetTabs, { SpreadsheetPlaceholder, ViewTabs } from "./workspace/sheet-tabs";
import StatusBar from "./workspace/status-bar";

/**
 * The Grid editor (D108) — device painting on plan sheets, in the markup
 * screen's idiom (D95/D96): all geometry normalized 0..1, inline entry
 * instead of window.prompt (unavailable here).
 *
 * Painting = the count tool grown up: arm a catalog part in the palette,
 * click the plan to drop instances; the BOM groups and prices them live.
 *
 * #299: a docked, full-window workspace — toolbar, sheet tabs over the
 * plan, a status bar, and the old sidebar cards in the left pane
 * (LegacyLeftColumn, until the Property Editor / Library / right tabs
 * replace them in later slices).
 */

const BTN: React.CSSProperties = {
  borderWidth: 1, borderStyle: "solid", borderColor: "#dfe2e8",
  background: "#fff",
  borderRadius: 7,
  padding: "5px 10px",
  fontSize: 12,
  fontWeight: 600,
  color: "#3d424e",
  cursor: "pointer",
  fontFamily: "inherit",
};

const INPUT: React.CSSProperties = {
  borderWidth: 1, borderStyle: "solid", borderColor: "#dfe2e8",
  borderRadius: 7,
  padding: "5px 8px",
  fontSize: 12,
  fontFamily: "inherit",
  background: "#fff",
  color: "#16181d",
  width: "100%",
};

const PANEL: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #edeff3",
  borderRadius: 10,
  padding: 12,
};

const PANEL_LABEL: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: "#9aa0ab",
  marginBottom: 7,
};

/** #230: the "+ Add accessory" link on a BOM heading. */
const ADD_LINK: React.CSSProperties = {
  border: "none",
  background: "none",
  padding: 0,
  fontSize: 10.5,
  color: "var(--accent)",
  cursor: "pointer",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};

function moneyFmt(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

/** Today's left-column cards, unchanged, in the workspace's left pane
 *  (#299 slice 1). Later slices move each card to its new home. */
function LegacyLeftColumn({ ed }: { ed: GridEditorState }) {
  const {
    router,
    project,
    parts,
    fabrics,
    scopeTargets,
    auto,
    symbolCtx,
    activeOptionId,
    customLines,
    deviceTypes,
    favorites,
    recent,
    setSelected,
    tierFallbackLines,
    incompleteQuote,
    setIncompleteQuote,
    placements,
    activeOption,
    sheet,
    page,
    busy,
    setErr,
    armedPartId,
    setArmedPartId,
    setHiddenLayers,
    hiddenSet,
    toggleLayer,
    armedCurtainType,
    categoryDraft,
    setCategoryDraft,
    calibrating,
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
    partById,
    lookOf,
    scopeOfPlacement,
    scopeCounts,
    typeRows,
    categoryCounts,
    pageSpaces,
    visibleRoutes,
    wireParts,
    wires,
    fabricNames,
    curtainPrices,
    runQuote,
    customItems,
    bomEmpty,
    grandValue,
    bomGroupList,
    setAddingTo,
    pickerOpenFor,
    spaceRollups,
    projectScopeRollup,
    selectedPlacement,
    selectedPart,
    shownAt,
    saveCategory,
    saveSymbolLook,
    armPart,
    partLayerHidden,
    enterTool,
    disarm,
    setRefillScope,
    removePlacement,
    setSpaceDraft,
    setWireDraft,
    quoteNumbers,
  } = ed;
  // The one "+ Custom item" (at the BOM's foot); saved items print under their heading.
  const customSection = (
    <CustomItemsSection
      key={`${activeOptionId}:add`}
      projectId={project.id}
      optionId={activeOptionId}
      items={[]}
      lines={customLines}
      onChanged={() => router.refresh()}
    />
  );
  /** One BOM row under a heading. Device / wire / curtain rows are the
   *  pre-#230 rows unchanged; custom items render through their heading's
   *  CustomItemsSection; a labor line (#232) is its editable row. The switch
   *  is exhaustive — a new BomSource fails tsc here until it has a row. */
  const renderBomLine = (l: GroupedBomLine) => {
    switch (l.source) {
    case "custom":
      return null;
    case "labor":
      return l.labor ? (
        <LaborLineRow
          key={`l-${l.labor.system}-${l.labor.amount}-${l.labor.overridden ? "o" : "c"}`}
          projectId={project.id}
          optionId={activeOptionId}
          line={l.labor}
          onChanged={() => router.refresh()}
          onError={(m) => setErr(m)}
        />
      ) : null;
    case "accessory":
      return l.accessoryId ? (
        <AccessoryRow
          key={`a-${l.accessoryId}-${l.qty}`}
          projectId={project.id}
          optionId={activeOptionId}
          accessoryId={l.accessoryId}
          line={l}
          onChanged={() => router.refresh()}
          onError={(m) => setErr(m)}
        />
      ) : null;
    case "curtain":
      // Curtains (punch #49): one line each, never grouped - two drapes of
      // one fabric are different goods once their dimensions differ.
      return (
        <div key={`c-${l.partId}`} style={{ display: "flex", gap: 6, fontSize: 12, alignItems: "baseline" }}>
          <strong style={{ color: "#16181d", whiteSpace: "nowrap" }}>1×</strong>
          <span
            style={{ color: "#3d424e", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
            title={l.desc}
          >
            {l.curtainName}
          </span>
          <span style={{ color: "#16181d", fontWeight: 600 }}>{moneyFmt(l.ext)}</span>
        </div>
      );
    case "wire":
      return (
        <div key={`w-${l.partId}`} style={{ display: "flex", gap: 6, fontSize: 12, alignItems: "baseline" }}>
          <strong style={{ color: "#16181d", whiteSpace: "nowrap" }}>{l.qty} {l.unit}</strong>
          <span
            style={{ color: "#3d424e", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
            title={`${l.partId} — ${l.desc}`}
          >
            {l.partId}
          </span>
          {partById.get(l.partId)?.hasDatasheet && (
            <a
              href={`/api/part-datasheet/${encodeURIComponent(l.partId)}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--accent)", fontSize: 10.5, whiteSpace: "nowrap", textDecoration: "none" }}
            >
              datasheet
            </a>
          )}
          {l.connectionType && (
            <span style={{ color: "#9aa0ab", fontSize: 10.5, whiteSpace: "nowrap" }}>
              {l.connectionType}
            </span>
          )}
          <span style={{ color: "#16181d", fontWeight: 600 }}>{moneyFmt(l.ext)}</span>
        </div>
      );
    case "device":
      return (
        <div key={`d-${l.partId}`} style={{ display: "flex", gap: 6, fontSize: 12, alignItems: "baseline" }}>
          <strong style={{ color: "#16181d", whiteSpace: "nowrap" }}>{l.qty}×</strong>
          <span
            style={{ color: "#3d424e", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
            title={`${l.partId} — ${l.desc}`}
          >
            {partById.get(l.partId)?.virtual ? l.desc : l.partId}
          </span>
          {partById.get(l.partId)?.virtualDead ? (
            // #211 D313: nothing real behind it — the quote refuses it by name.
            <span
              title={`${l.desc} — ${VIRTUAL_DEAD_HINT}`}
              style={{ fontSize: 9.5, fontWeight: 700, color: "#a0442b", background: "#fbe9e4", borderRadius: 999, padding: "1px 6px", whiteSpace: "nowrap" }}
            >
              Needs a part
            </span>
          ) : (
            partById.get(l.partId)?.allowance && (
              <span style={{ fontSize: 9.5, fontWeight: 700, color: "#8a6d1f", background: "#fbf3dd", borderRadius: 999, padding: "1px 6px", whiteSpace: "nowrap" }}>
                Allowance
              </span>
            )
          )}
          {partById.get(l.partId)?.hasDatasheet && (
            <a
              href={`/api/part-datasheet/${encodeURIComponent(l.partId)}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--accent)", fontSize: 10.5, whiteSpace: "nowrap", textDecoration: "none" }}
            >
              datasheet
            </a>
          )}
          <span style={{ color: "#16181d", fontWeight: 600 }}>{moneyFmt(l.ext)}</span>
        </div>
      );
    default: {
      const unhandled: never = l.source;
      return unhandled;
    }
    }
  };

  return (
    <div style={{ display: "grid", gap: 12, padding: 12 }}>
      {/* device palette (#226: tabs, device-type chips, manufacturer filter, stars) */}
      <DevicePalette
        parts={parts}
        types={deviceTypes}
        favorites={favorites}
        recent={recent}
        armedPartId={armedPartId}
        onArm={armPart}
        onDisarm={() => setArmedPartId(null)}
        isHidden={partLayerHidden}
        lookOf={lookOf}
      />

      <AssembliesPanel parts={parts} onChanged={() => router.refresh()} />

      {/* scale */}
      <div style={PANEL}>
        <div style={PANEL_LABEL}>Scale</div>
        {!sheet ? (
          <div style={{ fontSize: 11.5, color: "#8c919c" }}>Upload a plan sheet first.</div>
        ) : cal ? (
          <>
            <div style={{ fontSize: 12, color: "#2e7d55", fontWeight: 600 }}>Calibrated</div>
            <div style={{ fontSize: 11.5, color: "#8c919c", marginTop: 2 }}>
              Reference {formatMeasure(cal.refLength, cal.unit)} · {cal.by}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button
                style={{ ...BTN, padding: "4px 8px", fontSize: 11 }}
                onClick={() => enterTool("calibrate")}
              >
                Recalibrate
              </button>
              <button
                style={{ ...BTN, padding: "4px 8px", fontSize: 11, color: "#a0442b" }}
                onClick={async () => {
                  await clearCalAction(project.id, sheet.id, page);
                  router.refresh();
                }}
              >
                Clear
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 11.5, color: "#8c919c", marginBottom: 8 }}>
              Not set for page {page}. Draw over a known dimension, then type its real length —
              wire lengths and layouts stay correct at any zoom.
            </div>
            <button
              style={{ ...BTN, width: "100%", background: calibrating ? "#16181d" : "#fff", color: calibrating ? "#fff" : "#3d424e", borderColor: calibrating ? "#16181d" : "#dfe2e8" }}
              onClick={() => enterTool("calibrate")}
            >
              {calibrating ? "Draw the reference…" : "Calibrate this page"}
            </button>
          </>
        )}
      </div>

      {/* curtains (punch #49) - a drop-in, not a catalog pick */}
      <div style={PANEL}>
        <div style={PANEL_LABEL}>Curtains</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
          {GRID_CURTAIN_TYPES.map((t) => {
            const on = t === armedCurtainType;
            return (
              <button
                key={t}
                style={{
                  ...BTN,
                  padding: "5px 6px",
                  background: on ? "#16181d" : "#fff",
                  color: on ? "#fff" : "#3d424e",
                  borderColor: on ? "#16181d" : "#dfe2e8",
                }}
                disabled={busy}
                onClick={() => (on ? disarm() : enterTool("curtain", { curtainType: t }))}
              >
                {t}s
              </button>
            );
          })}
        </div>
        <div style={{ marginTop: 7, fontSize: 11, color: armedCurtainType ? "#2e7d55" : "#8c919c", fontWeight: armedCurtainType ? 600 : 400, lineHeight: 1.45 }}>
          {armedCurtainType
            ? `Dropping a ${armedCurtainType.toLowerCase()}: click the plan, then give it a name and size.`
            : "Pick a type, click the plan, then specify name, size, fullness and fabric. Priced like the estimator."}
        </div>
        {fabrics.length === 0 && (
          <div style={{ marginTop: 6, fontSize: 10.5, color: "#a0442b" }}>
            No fabric rows in the catalog yet, and a curtain needs one to price.
          </div>
        )}
      </div>

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

      {/* layers (punch #48) - visibility of what's already placed */}
      <LayersPanel
        scopeCounts={scopeCounts}
        typeRows={typeRows}
        categoryCounts={categoryCounts}
        hidden={hiddenSet}
        scopeColor={(s) => SCOPE_COLORS[s]}
        onToggle={toggleLayer}
        onShowAll={() => setHiddenLayers([])}
      />

      {/* spaces (D109) */}
      <SpacesPanel
        projectId={project.id}
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
        }}
        onChanged={() => router.refresh()}
        onError={(m) => setErr(m)}
      />

      {/* wires (D110) */}
      <WiresPanel
        projectId={project.id}
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
        onChanged={() => router.refresh()}
        onError={(m) => setErr(m)}
      />

      {/* selected placement */}
      {selectedPlacement && (
        <div style={{ ...PANEL, background: "#fdf4e7", border: "1px solid #f0dcbb" }}>
          <div style={PANEL_LABEL}>
            {selectedPlacement.curtain ? "Selected curtain" : "Selected device"}
          </div>
          <div style={{ fontSize: 12, color: "#16181d", fontWeight: 600 }}>
            {selectedPlacement.curtain
              ? selectedPlacement.curtain.name
              : isSeedPlaceholder(selectedPlacement.partId)
                ? selectedPlacement.category || "Unassigned device"
                : partById.get(selectedPlacement.partId)?.virtual
                  ? partById.get(selectedPlacement.partId)!.desc
                  : selectedPlacement.partId}
          </div>
          <div style={{ fontSize: 11.5, color: "#5b616e", marginTop: 2 }}>
            {selectedPlacement.curtain
              ? curtainDesc(
                  selectedPlacement.curtain,
                  fabricNames.get(selectedPlacement.curtain.fabricSku)
                )
              : isSeedPlaceholder(selectedPlacement.partId)
                ? "Generated from your measurements — delete and drop a real catalog part here"
                : partById.get(selectedPlacement.partId)?.desc || "No longer in the catalog"}
          </div>
          {selectedPlacement.curtain && (
            <div style={{ fontSize: 11.5, color: "#16181d", fontWeight: 600, marginTop: 3 }}>
              {moneyFmt(curtainPrices.get(selectedPlacement.id) || 0)}
            </div>
          )}
          {selectedPlacement.curtain && (() => {
            const c = selectedPlacement.curtain;
            const key = c.specKey || curtainSpecKey(c.type, c.name);
            return (
              <div style={{ fontSize: 11, color: "#8c919c", marginTop: 2 }}>
                Spec: {key ? (c.specKey ? key : `Auto: ${key}`) : "— none —"}
              </div>
            );
          })()}
          <div style={{ fontSize: 11, color: "#8c919c", marginTop: 2 }}>
            {scopeOfPlacement(selectedPlacement)} · by {selectedPlacement.by}
          </div>
          {!selectedPlacement.curtain && (partById.get(selectedPlacement.partId)?.ports || []).length > 0 && (
            <div style={{ marginTop: 7, paddingTop: 6, borderTop: "1px solid #f0dcbb", fontSize: 10.5, color: "#5b616e" }}>
              <div style={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "#9a7a48", marginBottom: 3 }}>Ports</div>
              {(partById.get(selectedPlacement.partId)?.ports || []).map((port) => (
                /* Leads with connectionType, like the catalog ports editor
                   (#162): this is the screen where a designer judges a
                   wire, and a DaVinci-sourced port can read
                   `name: "DMX Male"` while being correctly typed
                   "line power (unspecified)" — the enricher maps by
                   protocol and falls back to the connector label only for
                   the name. The type governs wireability; the name is the
                   part that misleads. */
                <div key={`${port.name}-${port.connectionType}`} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontFamily: "var(--font-mono)", color: "#8c6d3d" }}>{port.connectionType}</span>
                  <span style={{ color: "#8a8f9a", textAlign: "right" }}>{port.direction}{port.name ? ` · ${port.name}` : ""}</span>
                </div>
              ))}
            </div>
          )}

          {/* Symbol (#131 → stock symbols) — the per-ENTRY icon/colour
              override: every placed instance of this catalog entry
              redraws, on the plan and the riser. The category defaults
              live in Grid Settings. Keyed so a saved colour resets the
              panel's local draft. */}
          {selectedPart && (
            <SymbolLookPanel
              key={`${selectedPart.id}|${lookOf(selectedPart).color}`}
              desc={selectedPart.desc}
              look={lookOf(selectedPart)}
              base={symbolLook(
                { category: selectedPart.category, group: selectedPart.group, trade: selectedPart.trade, gridScope: selectedPart.gridScope },
                symbolCtx
              )}
              hasIcon={!!(selectedPart.icon || selectedPart.shape)}
              hasColor={!!selectedPart.color}
              busy={busy}
              onSave={(patch) => saveSymbolLook(selectedPart.id, patch)}
            />
          )}

          {/* User-defined category (punch #48/#41) - open-ended by
              design: assign now, consume later. Orthogonal to the scope
              above and to whatever space the marker happens to sit in. */}
          {categoryDraft === null ? (
            <button
              style={{ ...BTN, marginTop: 7, width: "100%", padding: "4px 8px", fontSize: 11, fontWeight: 500 }}
              onClick={() => setCategoryDraft(normalizeCategory(selectedPlacement.category) || "")}
            >
              {normalizeCategory(selectedPlacement.category)
                ? `Category: ${normalizeCategory(selectedPlacement.category)}`
                : "+ Add a category"}
            </button>
          ) : (
            <div style={{ display: "flex", gap: 5, marginTop: 7 }}>
              <input
                value={categoryDraft}
                onChange={(e) => setCategoryDraft(e.target.value)}
                list="grid-category-suggestions"
                placeholder="Followspots, House left…"
                onKeyDown={(e) => {
                  if (e.key === "Escape") setCategoryDraft(null);
                  if (e.key === "Enter") saveCategory(selectedPlacement.id, categoryDraft);
                }}
                style={{ ...INPUT, fontSize: 11.5, padding: "4px 7px" }}
                autoFocus
              />
              <datalist id="grid-category-suggestions">
                {categoryCounts.map((c) => (
                  <option key={c.key} value={c.key} />
                ))}
              </datalist>
              <button
                style={{ ...BTN, padding: "4px 9px", fontSize: 11 }}
                disabled={busy}
                onClick={() => saveCategory(selectedPlacement.id, categoryDraft)}
              >
                Save
              </button>
            </div>
          )}
          {/* Position readout + nudge hint (punch #47). Percent of the
              page box is the honest unit here, it's what's stored, and
              it stays meaningful on an uncalibrated sheet. */}
          {(() => {
            const at = shownAt(selectedPlacement);
            return (
              <div style={{ fontSize: 11, color: "#5b616e", marginTop: 6, fontFamily: "var(--font-mono)" }}>
                x {(at.x * 100).toFixed(1)}% · y {(at.y * 100).toFixed(1)}%
              </div>
            );
          })()}
          <div style={{ fontSize: 10.5, color: "#8c919c", marginTop: 4, lineHeight: 1.45 }}>
            Drag the marker to move it · arrow keys nudge (hold Shift for
            bigger steps) · attached wires follow.
          </div>
          <button
            style={{ ...BTN, marginTop: 8, width: "100%", color: "#a0442b" }}
            disabled={busy}
            onClick={() => removePlacement(selectedPlacement.id)}
          >
            {selectedPlacement.curtain ? "Remove curtain" : "Remove device"}
          </button>
        </div>
      )}

      {/* BOM */}
      <div style={PANEL}>
        <div style={PANEL_LABEL}>Bill of materials</div>
        {bomEmpty && (
          <div style={{ fontSize: 11.5, color: "#8c919c", marginBottom: 4 }}>
            Paint devices onto the plan to build the BOM.
          </div>
        )}
        <div style={{ display: "grid", gap: 4 }}>
          {/* #230: one heading per category, in Jeff's order. Every
              heading shows, even empty, so an accessory can be added
              to a category nothing is placed in yet. */}
          {bomGroupList.map((g) => {
            const groupCustom = customItems.filter((it) => groupOfCustomSystem(it.system) === g.key);
            return (
              <div key={g.key} style={{ display: "grid", gap: 4, borderTop: "1px dashed #e3e5ea", paddingTop: 5 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                  <span style={{ flex: 1, fontSize: 9.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#9aa0ab" }}>
                    {g.label}
                  </span>
                  {pickerOpenFor !== g.key && (
                    <button type="button" style={ADD_LINK} onClick={() => setAddingTo({ optionId: activeOptionId, group: g.key })}>
                      + Add accessory
                    </button>
                  )}
                  {g.value > 0 && <span style={{ fontSize: 11, color: "#5b616e", fontWeight: 600 }}>{moneyFmt(g.value)}</span>}
                </div>
                {pickerOpenFor === g.key && (
                  <AccessoryPicker
                    projectId={project.id}
                    optionId={activeOptionId}
                    group={g.key}
                    parts={parts}
                    onDone={(added, note) => {
                      setAddingTo(null);
                      // #230 final wave B: an over-cap bump was clamped — tell them.
                      if (note) setErr(note);
                      if (added) router.refresh();
                    }}
                  />
                )}
                {g.lines.filter((l) => l.source !== "labor").map((l) => renderBomLine(l))}
                {groupCustom.length > 0 && (
                  <CustomItemsSection
                    key={`${activeOptionId}:${g.key}`}
                    projectId={project.id}
                    optionId={activeOptionId}
                    items={groupCustom}
                    lines={customLines}
                    showAdd={false}
                    onChanged={() => router.refresh()}
                  />
                )}
                {/* #232: the heading's labor prints last — after its custom items. */}
                {g.lines.filter((l) => l.source === "labor").map((l) => renderBomLine(l))}
              </div>
            );
          })}
          {customSection}
          {wires.unmeasured > 0 && (
            <div style={{ fontSize: 10.5, color: "#a0442b" }}>
              {wires.unmeasured} unmeasured wire run{wires.unmeasured === 1 ? "" : "s"} excluded.
            </div>
          )}
          {!bomEmpty && (
            <div style={{ borderTop: "1px solid #edeff3", marginTop: 3, paddingTop: 5, display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
              <span style={{ color: "#8c919c" }}>Total</span>
              <strong>{moneyFmt(grandValue)}</strong>
            </div>
          )}
        </div>
        <button
          style={{
            ...BTN,
            marginTop: 10,
            width: "100%",
            background: "#16181d",
            color: "#fff",
            borderColor: "#16181d",
          }}
          disabled={busy || bomEmpty}
          onClick={() => runQuote(false)}
        >
          {activeOption.quoteId ? `Update draft quote ${quoteNumbers[activeOption.quoteId] ?? activeOption.quoteId}` : "Create draft quote"}
        </button>
        {incompleteQuote && (
          <div style={{ marginTop: 8, background: "#fbf0ea", border: "1px solid #f0d6cd", borderRadius: 8, padding: "8px 10px", fontSize: 11.5, color: "#a0442b", lineHeight: 1.45 }}>
            <div>{incompleteQuote}</div>
            <div style={{ display: "flex", gap: 8, marginTop: 7, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" style={{ ...BTN, fontSize: 11.5, padding: "4px 9px" }} disabled={busy} onClick={() => runQuote(true)}>
                Quote anyway
              </button>
              <button type="button" style={{ ...BTN, fontSize: 11.5, padding: "4px 9px" }} onClick={() => setIncompleteQuote(null)}>
                Cancel
              </button>
              <EquipmentMapLink style={{ fontWeight: 600, color: "#a0442b" }} fallback="Ask an admin to map them in the Equipment map.">
                Open the Equipment map →
              </EquipmentMapLink>
            </div>
          </div>
        )}
        {/* Punch #76 — non-blocking: the quote was still created/updated
            above, this only says part of it priced at plain list instead
            of the tier rate because the part had no usable cost. Same
            spirit as the Lineset Builder's fabric-unresolved banner
            (#64): specific, names the lines, doesn't refuse the quote. */}
        {tierFallbackLines.length > 0 && (
          <div
            style={{
              marginTop: 8,
              background: "#fdf3e3",
              border: "1px solid #f0d9a8",
              borderRadius: 9,
              padding: "8px 11px",
              fontSize: 11.5,
              color: "#8a5a12",
              lineHeight: 1.5,
            }}
          >
            <strong>{tierFallbackLines.length} line{tierFallbackLines.length === 1 ? "" : "s"} priced at list, not tier</strong> — no
            usable cost for {tierFallbackLines.length === 1 ? "this part" : "these parts"}, so{" "}
            {tierFallbackLines.length === 1 ? "it" : "they"} missed the {project.customer ? `${project.customer}'s ` : ""}
            tier discount everything else on this quote got:
            <br />
            {tierFallbackLines.slice(0, 4).join("; ")}
            {tierFallbackLines.length > 4 ? ` +${tierFallbackLines.length - 4} more` : ""}
          </div>
        )}
        {activeOption.quoteId && (
          <Link
            href="/quotes"
            style={{ display: "block", marginTop: 6, fontSize: 11.5, color: "var(--accent)", textAlign: "center" }}
          >
            View in Quotes →
          </Link>
        )}
        {activeOption.quoteId && (
          <Link
            href={`/design/specs/new?grid=${encodeURIComponent(project.id)}&quote=${encodeURIComponent(activeOption.quoteId)}`}
            style={{ display: "block", marginTop: 3, fontSize: 11.5, color: "var(--accent)", textAlign: "center" }}
          >
            Spec from this design →
          </Link>
        )}
      </div>

      {/* revisions (D109) */}
      <RevisionsPanel
        projectId={project.id}
        revisions={project.revisions}
        busy={busy}
        onChanged={() => router.refresh()}
        onError={(m) => setErr(m)}
      />
    </div>
  );
}

export default function GridEditor(props: GridEditorProps) {
  const ed = useGridEditor(props);
  return (
    <GridWorkspace
      ed={ed}
      toolbar={<Toolbar ed={ed} />}
      left={<LegacyLeftColumn ed={ed} />}
      right={null}
      bottom={null}
      center={
        <>
          <SheetTabs ed={ed} />
          {ed.view === "plan" ? <PlanCanvas ed={ed} onDropPart={ed.placeAt} /> : <SpreadsheetPlaceholder />}
          <ViewTabs ed={ed} />
        </>
      }
      status={<StatusBar ed={ed} />}
    />
  );
}
