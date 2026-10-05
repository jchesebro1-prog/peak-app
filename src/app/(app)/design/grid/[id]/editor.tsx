"use client";

import { EquipmentMapLink } from "@/components/design/equipment-map-link";
import dynamic from "next/dynamic";
import Link from "next/link";
import { formatMeasure, MEASURE_UNITS, type MeasureUnit } from "@/lib/annotations";
import { curtainDesc, GRID_CURTAIN_TYPES, placementQty, VIRTUAL_DEAD_HINT, routeLengthFt } from "@/lib/design/grid-bom";
import { normalizeCategory, SCOPE_COLORS } from "@/lib/design/grid-scopes";
import { markerColor } from "@/lib/design/grid-symbols";
import { symbolLook } from "@/lib/design/grid-icons";
import { SymbolShape } from "@/components/design/symbol-shape";
import { polygonCentroid } from "@/lib/design/grid-geometry";
import { LaborLineRow } from "./labor-lines";
import { isSeedPlaceholder } from "@/lib/design/grid-seed";
import {
  clearCalAction,
  deleteProjectAction,
  removePlacementAction,
  removeSheetAction,
  setVenueAction,
} from "./actions";
import { ConfirmButton } from "@/components/confirm-button";
import DesignIdentity from "./design-identity";
import CurtainDrop from "./curtain-drop";
import { curtainSpecKey } from "@/lib/specs/record-keys";
import LayersPanel from "./layers-panel";
import SpacesPanel from "./spaces-panel";
import RevisionsPanel from "./revisions-panel";
import WiresPanel from "./wires-panel";
import ScopePanel from "./scope-panel";
import AssembliesPanel from "./assemblies-panel";
import OptionSwitcher from "./option-switcher";
import PlanLegend from "./plan-legend";
import SymbolLookPanel from "./symbol-look-panel";
import CustomItemsSection from "./custom-items";
import DevicePalette from "./device-palette";
import { groupOfCustomSystem, type GroupedBomLine } from "@/lib/design/grid-bom-groups";
import { cutSheetsUnreadableNote } from "@/lib/curtain-cut-sheets/estimator-curtains";
import { AccessoryPicker, AccessoryRow } from "./accessories";
import { useGridEditor, type GridEditorProps } from "./use-grid-editor";

const PdfCanvas = dynamic(() => import("@/components/design/pdf-canvas"), { ssr: false });

/**
 * The Grid editor (D108) — device painting on plan sheets, in the markup
 * screen's idiom (D95/D96): document right, tools left, all geometry
 * normalized 0..1, inline entry instead of window.prompt (unavailable here).
 *
 * Painting = the count tool grown up: arm a catalog part in the palette,
 * click the plan to drop instances; the BOM groups and prices them live.
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

export default function GridEditor(props: GridEditorProps) {
  const ed = useGridEditor(props);
  const {
    router,
    project,
    sheets,
    parts,
    fabrics,
    specKeys,
    scopeTargets,
    auto,
    venues,
    customerOptions,
    canCreate,
    quoteNumbers,
    symbolCtx,
    activeOptionId,
    linesetDesigns,
    customLines,
    deviceTypes,
    favorites,
    recent,
    selected,
    setSelected,
    tierFallbackLines,
    incompleteQuote,
    setIncompleteQuote,
    placements,
    optionCounts,
    activeOption,
    switchOption,
    armDelete,
    setArmDelete,
    setActiveSheetId,
    sheet,
    isPdf,
    page,
    setPage,
    pages,
    zoom,
    size,
    setSize,
    busy,
    setBusy,
    err,
    setErr,
    linesetBusy,
    packageBusy,
    packageUrl,
    packageGapCount,
    packageUnreadable,
    linkLineset,
    buildClientPackage,
    armedPartId,
    setArmedPartId,
    setHiddenLayers,
    hiddenSet,
    toggleLayer,
    armedCurtainType,
    curtainAt,
    setCurtainAt,
    categoryDraft,
    setCategoryDraft,
    drag,
    setDrag,
    calibrating,
    calDraft,
    pending,
    setPending,
    entry,
    setEntry,
    calUnit,
    setCalUnit,
    spaceDrawing,
    setSpaceDrawing,
    spaceDraft,
    setSpaceDraft,
    selectedSpaceId,
    setSelectedSpaceId,
    wireDrawing,
    setWireDrawing,
    wireDraft,
    setWireDraft,
    wirePartId,
    setWirePartId,
    selectedRouteId,
    setSelectedRouteId,
    wrapRef,
    fileRef,
    onLoaded,
    onSize,
    cal,
    partById,
    lookOf,
    scopeOfPlacement,
    scopeCounts,
    typeRows,
    categoryCounts,
    visiblePlacements,
    planLegendRows,
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
    armedPart,
    selectedPlacement,
    selectedPart,
    shownAt,
    upload,
    onDown,
    onMove,
    onUp,
    saveCategory,
    saveSymbolLook,
    dropCurtain,
    confirmSpace,
    confirmCalibration,
    armPart,
    partLayerHidden,
    enterTool,
    disarm,
    zoomIn,
    zoomOut,
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
    <div style={{ display: "grid", gap: 10 }}>
      {/* header */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Link href="/design/designs" style={{ ...BTN, textDecoration: "none" }}>
          ← The Grid
        </Link>
        {/* #244 — the title renames in place; the customer can be linked or changed. */}
        <DesignIdentity
          projectId={project.id}
          name={project.name}
          customer={project.customer}
          customerId={project.customerId}
          customerOptions={customerOptions}
          canEdit={canCreate}
          onError={setErr}
        />
        {venues.length > 0 && (
          <select
            value={project.siteId || ""}
            onChange={async (e) => {
              setBusy(true);
              const r = await setVenueAction(project.id, e.target.value);
              setBusy(false);
              if (!r.ok) setErr(r.error);
              else router.refresh();
            }}
            title="Venue — stamped onto the quote"
            style={{ ...BTN, fontWeight: 500, maxWidth: 190 }}
          >
            <option value="">No venue</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        )}
        {sheets.length > 0 && (
          <select
            value={sheet?.id || ""}
            onChange={(e) => {
              setActiveSheetId(e.target.value);
              setPage(1);
              setSelected(null);
              setPending(null);
              setSpaceDrawing(false);
              setSpaceDraft([]);
              setSelectedSpaceId(null);
              setWireDrawing(false);
              setWireDraft([]);
              setSelectedRouteId(null);
              setCurtainAt(null);
              setCategoryDraft(null);
            }}
            title={
              sheets.length > 1
                ? "Switch sheets — this design has more than one (e.g. the generated base plan and an uploaded plan)"
                : undefined
            }
            style={{ ...BTN, fontWeight: 500 }}
          >
            {sheets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        {sheet && (
          <ConfirmButton
            className="pk-btn-danger"
            label="Delete sheet"
            confirmLabel="Confirm"
            style={{ fontSize: 11.5, padding: "6px 10px" }}
            title="Deletes this sheet from the design — refused while it still has devices, spaces, or wires on it"
            onConfirm={async () => {
              const r = await removeSheetAction(project.id, sheet.id);
              if (!r.ok) throw new Error(r.error);
              router.refresh();
            }}
          />
        )}
        <OptionSwitcher
          projectId={project.id}
          options={project.options}
          activeId={activeOptionId}
          counts={optionCounts}
          busy={busy}
          onSwitch={switchOption}
          onChanged={() => router.refresh()}
          onError={(m) => setErr(m)}
        />
        <button
          style={BTN}
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          title={
            sheets.length > 0
              ? "Uploads a real plan as a NEW, separate sheet — the sheet(s) already here, and everything placed on them, are untouched"
              : "Upload a plan sheet (PDF or image)"
          }
        >
          {sheets.length > 0 ? "+ Additional sheet" : "+ Plan sheet"}
        </button>
        <Link href={`/design/grid/${encodeURIComponent(project.id)}/riser?option=${encodeURIComponent(activeOptionId)}`} style={{ ...BTN, textDecoration: "none" }}>
          Riser →
        </Link>
        <Link href={`/design/grid/${encodeURIComponent(project.id)}/schedule?option=${encodeURIComponent(activeOptionId)}`} style={{ ...BTN, textDecoration: "none" }}>
          Schedule →
        </Link>
        <Link href={`/design/grid/${encodeURIComponent(project.id)}/set?option=${encodeURIComponent(activeOptionId)}`} style={{ ...BTN, textDecoration: "none" }}>
          Drawing set →
        </Link>
        <select
          value={project.linesetDesignId || ""}
          disabled={linesetBusy}
          onChange={(e) => linkLineset(e.target.value)}
          aria-label="Lineset Builder design for this Grid"
          title="Link a saved Lineset Builder design; the schedule derives from its current inputs"
          style={{ ...BTN, maxWidth: 190, fontWeight: 500 }}
        >
          <option value="">No lineset linked</option>
          {linesetDesigns.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        {project.linesetDesignId && (
          <Link href={`/design/grid/${encodeURIComponent(project.id)}/lineset`} style={{ ...BTN, textDecoration: "none" }}>
            Linesets →
          </Link>
        )}
        <button style={BTN} disabled={packageBusy || busy} onClick={buildClientPackage} title="Build a ZIP with the specification, datasheets, plan sheets, and rough riser drawings">
          {packageBusy ? "Building…" : "Client package"}
        </button>
        {packageUrl && (
          <a href={packageUrl} style={{ ...BTN, textDecoration: "none", color: "#1f7a52" }}>
            Download{packageGapCount ? ` · ${packageGapCount} gaps` : ""}
          </a>
        )}
        {packageUrl && packageUnreadable.length > 0 && (
          <span
            style={{ fontSize: 12, color: "#8a6d1f", alignSelf: "center" }}
            title={packageUnreadable.map((u) => `${u.where} — ${u.desc}: ${u.reason}`).join("\n")}
          >
            {cutSheetsUnreadableNote(packageUnreadable.length)}
          </span>
        )}
        {canCreate && (
          armDelete ? (
            <>
              <button
                style={{ ...BTN, background: "#a0442b", color: "#fff", borderColor: "#a0442b" }}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const r = await deleteProjectAction(project.id);
                  setBusy(false);
                  if (!r.ok) {
                    setErr(r.error);
                    setArmDelete(false);
                    return;
                  }
                  router.push("/design/designs");
                }}
              >
                {busy ? "Deleting…" : "Really delete"}
              </button>
              <button style={BTN} disabled={busy} onClick={() => setArmDelete(false)}>
                Keep
              </button>
            </>
          ) : (
            <button
              style={{ ...BTN, color: "#a0442b" }}
              disabled={busy}
              onClick={() => setArmDelete(true)}
              title="Deletes this design and its plan sheets"
            >
              Delete
            </button>
          )
        )}
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) upload(f);
          }}
        />
        <span style={{ flex: 1 }} />
        <button style={BTN} onClick={zoomOut}>−</button>
        <span style={{ fontSize: 12, color: "#5b616e", minWidth: 42, textAlign: "center" }}>
          {Math.round(zoom * 100)}%
        </span>
        <button style={BTN} onClick={zoomIn}>+</button>
        {isPdf && pages > 1 && (
          <>
            <button style={BTN} disabled={page <= 1} onClick={() => { setPage((p) => p - 1); setSelected(null); setSelectedSpaceId(null); setSpaceDrawing(false); setSpaceDraft([]); setWireDrawing(false); setWireDraft([]); setSelectedRouteId(null); setCurtainAt(null); }}>‹</button>
            <span style={{ fontSize: 12, color: "#5b616e" }}>{page} / {pages}</span>
            <button style={BTN} disabled={page >= pages} onClick={() => { setPage((p) => p + 1); setSelected(null); setSelectedSpaceId(null); setSpaceDrawing(false); setSpaceDraft([]); setWireDrawing(false); setWireDraft([]); setSelectedRouteId(null); setCurtainAt(null); }}>›</button>
          </>
        )}
      </div>

      {err && (
        <div style={{ background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 9, padding: "8px 11px", fontSize: 12.5, color: "#a0442b" }}>
          {err}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "252px 1fr", gap: 12, alignItems: "start" }}>
        {/* sidebar */}
        <div style={{ display: "grid", gap: 12, position: "sticky", top: 12 }}>
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
                onClick={async () => {
                  setBusy(true);
                  const r = await removePlacementAction(project.id, selectedPlacement.id);
                  setBusy(false);
                  setSelected(null);
                  if (!r.ok) setErr(r.error);
                  else router.refresh();
                }}
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

        {/* document */}
        <div style={{ overflow: "auto", background: "#6d7076", padding: 18, borderRadius: 10, display: "flex", justifyContent: "center", minHeight: 420 }}>
          {!sheet ? (
            <div style={{ alignSelf: "center", color: "#e6e8ec", fontSize: 13.5, textAlign: "center", lineHeight: 1.6 }}>
              No plan sheets yet.
              <br />
              <button style={{ ...BTN, marginTop: 10 }} disabled={busy} onClick={() => fileRef.current?.click()}>
                Upload a PDF or image
              </button>
            </div>
          ) : (
            <div
              ref={wrapRef}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              // A cancelled pointer (browser gesture, lost capture) abandons
              // the drag rather than committing wherever it stopped.
              onPointerCancel={() => setDrag(null)}
              style={{
                position: "relative",
                lineHeight: 0,
                cursor: drag?.moved
                  ? "grabbing"
                  : pending || curtainAt
                    ? "default"
                    : calibrating || armedPart || armedCurtainType || spaceDrawing || wireDrawing
                      ? "crosshair"
                      : "default",
                touchAction: "none",
                background: "#fff",
                boxShadow: "0 2px 14px rgba(0,0,0,.28)",
              }}
            >
              {isPdf ? (
                <PdfCanvas dataUrl={sheet.dataUrl} page={page} zoom={zoom} onLoaded={onLoaded} onSize={onSize} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={sheet.dataUrl}
                  alt={sheet.name}
                  // Intrinsic dimensions, not clientWidth: onLoad can fire
                  // before layout (and never fires for cached images), which
                  // left size at 0×0 and broke the calibration math. The
                  // callback ref covers already-complete images; aspect only
                  // needs the ratio, so natural units are exactly right.
                  // The functional update MUST return the same object when
                  // nothing changed — an inline ref runs on every commit, and
                  // unconditionally setting fresh state here is a render loop.
                  ref={(el) => {
                    if (el && el.complete && el.naturalWidth) {
                      const w = el.naturalWidth;
                      const h = el.naturalHeight;
                      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
                    }
                  }}
                  onLoad={(e) =>
                    setSize({
                      w: e.currentTarget.naturalWidth || e.currentTarget.clientWidth,
                      h: e.currentTarget.naturalHeight || e.currentTarget.clientHeight,
                    })
                  }
                  style={{ width: `${Math.round(900 * zoom)}px`, height: "auto", display: "block" }}
                />
              )}

              <svg
                width={size.w}
                height={size.h}
                viewBox={`0 0 ${size.w} ${size.h}`}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
              >
                {/* spaces render UNDER the device markers */}
                {pageSpaces.map((s) => {
                  const pts = s.points.map((p) => `${p.x * size.w},${p.y * size.h}`).join(" ");
                  const c = polygonCentroid(s.points);
                  const on = s.id === selectedSpaceId;
                  return (
                    <g key={s.id}>
                      <polygon
                        points={pts}
                        fill={s.color}
                        opacity={on ? 0.22 : 0.13}
                        stroke={s.color}
                        strokeWidth={on ? 2.5 : 1.5}
                        strokeOpacity={0.55}
                        strokeDasharray={on ? "6 4" : undefined}
                      />
                      <g>
                        <rect
                          x={c.x * size.w - s.name.length * 3.6 - 6}
                          y={c.y * size.h - 9}
                          width={s.name.length * 7.2 + 12}
                          height={18}
                          rx={5}
                          fill="#fff"
                          stroke={s.color}
                          strokeWidth={1}
                          opacity={0.92}
                        />
                        <text
                          x={c.x * size.w}
                          y={c.y * size.h + 4}
                          fill={s.color}
                          fontSize={11}
                          fontWeight={700}
                          textAnchor="middle"
                          style={{ fontFamily: "inherit" }}
                        >
                          {s.name}
                        </text>
                      </g>
                    </g>
                  );
                })}
                {/* space being drawn: open polyline + corner dots */}
                {spaceDraft.length > 0 && (
                  <g>
                    <polyline
                      points={spaceDraft.map((p) => `${p.x * size.w},${p.y * size.h}`).join(" ")}
                      fill="none"
                      stroke="#8a6d3b"
                      strokeWidth={2}
                      strokeDasharray="5 4"
                    />
                    {spaceDraft.map((p, i) => (
                      <circle
                        key={i}
                        cx={p.x * size.w}
                        cy={p.y * size.h}
                        r={i === 0 ? 7 : 4}
                        fill={i === 0 ? "#fff" : "#8a6d3b"}
                        stroke="#8a6d3b"
                        strokeWidth={2}
                      />
                    ))}
                  </g>
                )}
                {pending?.kind === "space" && (
                  <polygon
                    points={pending.points.map((p) => `${p.x * size.w},${p.y * size.h}`).join(" ")}
                    fill="#8a6d3b"
                    opacity={0.15}
                    stroke="#8a6d3b"
                    strokeWidth={2}
                  />
                )}
                {/* wire routes (D110) - dashed polylines with a length chip.
                    Hidden scopes take their wires with them (#48). */}
                {visibleRoutes.map((r) => {
                  const part = partById.get(r.partId);
                  const c = markerColor(part?.category || "Wire");
                  const on = r.id === selectedRouteId;
                  const pts = r.points.map((q) => `${q.x * size.w},${q.y * size.h}`).join(" ");
                  const midIdx = Math.floor((r.points.length - 1) / 2);
                  const mA = r.points[midIdx];
                  const mB = r.points[Math.min(midIdx + 1, r.points.length - 1)];
                  const mx = ((mA.x + mB.x) / 2) * size.w;
                  const my = ((mA.y + mB.y) / 2) * size.h;
                  const ft = routeLengthFt(r, project.calibrations);
                  const calHere = project.calibrations.find(
                    (cc) => cc.docId === r.sheetId && cc.page === r.page
                  );
                  const label = ft !== null && calHere ? formatMeasure(ft, calHere.unit) : "unmeasured";
                  return (
                    <g key={r.id}>
                      <polyline
                        points={pts}
                        fill="none"
                        stroke={c}
                        strokeWidth={on ? 4 : 2.5}
                        strokeDasharray="8 5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      {r.points.map((q, i) => (
                        <circle key={i} cx={q.x * size.w} cy={q.y * size.h} r={3} fill={c} />
                      ))}
                      <g>
                        <rect x={mx - 30} y={my - 20} width={60} height={16} rx={4} fill="#fff" stroke={c} strokeWidth={1} opacity={0.95} />
                        <text x={mx} y={my - 8} fill={c} fontSize={10.5} fontWeight={700} textAnchor="middle" style={{ fontFamily: "inherit" }}>
                          {label}
                        </text>
                      </g>
                    </g>
                  );
                })}
                {wireDraft.length > 0 && (
                  <g>
                    <polyline
                      points={wireDraft.map((q) => `${q.x * size.w},${q.y * size.h}`).join(" ")}
                      fill="none"
                      stroke="#3155a8"
                      strokeWidth={2.5}
                      strokeDasharray="8 5"
                    />
                    {wireDraft.map((q, i) => (
                      <circle
                        key={i}
                        cx={q.x * size.w}
                        cy={q.y * size.h}
                        r={i === wireDraft.length - 1 ? 6 : 3}
                        fill={i === wireDraft.length - 1 ? "#fff" : "#3155a8"}
                        stroke="#3155a8"
                        strokeWidth={2}
                      />
                    ))}
                  </g>
                )}
                {visiblePlacements.map((pl) => {
                  const part = partById.get(pl.partId);
                  // A seeded-but-unassigned placement (#38) has no part; its
                  // own system-function category still picks a sensible badge.
                  const look = part ? lookOf(part) : symbolLook({ category: pl.category }, symbolCtx);
                  // A curtain reads as the Curtains group's resolved colour
                  // (final fix wave, so an admin's Grid Settings colour edit
                  // reaches curtains too — not the old hard-coded hash swatch)
                  // and a drape glyph, so a plan full of devices doesn't
                  // swallow it (#48/#49).
                  const c = pl.curtain ? symbolCtx.colors.Curtains : look.color;
                  const x = pl.x * size.w;
                  const y = pl.y * size.h;
                  const on = pl.id === selected;
                  // A seeded-but-unassigned placement (#38 Task 2) has no
                  // catalog part to name it, so its own category — the
                  // human system-function label grid-seed.ts stamped it
                  // with — reads far better on the plan than the raw
                  // placeholder partId.
                  const q = placementQty(pl);
                  const label =
                    (pl.curtain
                      ? pl.curtain.name
                      : part?.desc || part?.sku || (isSeedPlaceholder(pl.partId) ? pl.category : undefined) || pl.partId) +
                    (q > 1 ? ` ×${q}` : "");
                  return (
                    <g key={pl.id}>
                      {pl.curtain ? (
                        <>
                          <rect x={x - 11} y={y - 8} width={22} height={16} rx={2} fill={c} opacity={0.92} />
                          <rect x={x - 11} y={y - 8} width={22} height={16} rx={2} fill="none" stroke="#fff" strokeWidth={1.5} />
                          <path
                            d={`M ${x - 7} ${y - 6} L ${x - 7} ${y + 6} M ${x} ${y - 6} L ${x} ${y + 6} M ${x + 7} ${y - 6} L ${x + 7} ${y + 6}`}
                            stroke="#fff"
                            strokeWidth={1}
                            opacity={0.75}
                          />
                        </>
                      ) : (
                        <>
                          {(() => {
                            const w = part?.symbolWidth || 44;
                            const h = part?.symbolHeight || 30;
                            return (
                              <>
                                {/* Stock-symbol badge (spec 2026-09-25); ring + label below are unchanged. */}
                                <SymbolShape iconId={look.iconId} x={x} y={y} w={w} h={h} color={c} />
                                {part?.kind === "assembly" && (part.assemblyMembers || []).map((member) => {
                                  const child = partById.get(member.symbolId);
                                  const childLook = lookOf(child);
                                  const cx = x + (member.x - 0.5) * w;
                                  const cy = y + (member.y - 0.5) * h;
                                  return (
                                    <SymbolShape
                                      key={member.symbolId}
                                      iconId={childLook.iconId}
                                      x={cx}
                                      y={cy}
                                      w={10}
                                      h={8}
                                      color={childLook.color}
                                      opacity={1}
                                    />
                                  );
                                })}
                              </>
                            );
                          })()}
                        </>
                      )}
                      <rect x={x + 12} y={y - 8} width={Math.max(30, label.length * 6.4) + 8} height={16} rx={4} fill="#fff" stroke={c} strokeWidth={1} opacity={0.95} />
                      <text x={x + 16} y={y + 4} fill={c} fontSize={10.5} fontWeight={700} style={{ fontFamily: "inherit" }}>
                        {label}
                      </text>
                      {on && (
                        <circle cx={x} cy={y} r={15} fill="none" stroke="#16181d" strokeDasharray="4 3" strokeWidth={1.5} />
                      )}
                    </g>
                  );
                })}
                {calDraft && (
                  <line
                    x1={calDraft[0].x * size.w}
                    y1={calDraft[0].y * size.h}
                    x2={calDraft[calDraft.length - 1].x * size.w}
                    y2={calDraft[calDraft.length - 1].y * size.h}
                    stroke="#d5342a"
                    strokeWidth={2}
                    strokeLinecap="round"
                  />
                )}
              </svg>

              {/* plan legend (stock symbols) — every badge on this sheet */}
              <PlanLegend rows={planLegendRows} />

              {/* curtain drop-in (punch #49) - anchored where it was dropped,
                  same on-canvas idiom as the calibration/space entry */}
              {curtainAt && armedCurtainType && (
                <div
                  style={{
                    position: "absolute",
                    left: `${curtainAt.x * 100}%`,
                    top: `${curtainAt.y * 100}%`,
                    transform: "translate(6px, 6px)",
                    zIndex: 6,
                  }}
                >
                  <CurtainDrop
                    type={armedCurtainType}
                    fabrics={fabrics}
                    specKeys={specKeys}
                    busy={busy}
                    onConfirm={dropCurtain}
                    onCancel={() => setCurtainAt(null)}
                  />
                </div>
              )}

              {/* inline entry — window.prompt is unavailable here */}
              {pending && (() => {
                const anchor =
                  pending.kind === "calibrate" ? pending.b : pending.points[pending.points.length - 1];
                const cancel = () => {
                  setPending(null);
                  setEntry("");
                  setSpaceDraft([]);
                };
                return (
                  <div
                    style={{
                      position: "absolute",
                      left: `${anchor.x * 100}%`,
                      top: `${anchor.y * 100}%`,
                      transform: "translate(6px, 6px)",
                      background: "#fff",
                      border: "1px solid #c4c9d2",
                      borderRadius: 9,
                      padding: 10,
                      boxShadow: "0 6px 20px rgba(0,0,0,.22)",
                      width: 232,
                      lineHeight: 1.4,
                      zIndex: 5,
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <div style={{ ...PANEL_LABEL, marginBottom: 6 }}>
                      {pending.kind === "calibrate" ? "Reference length" : "Name this space"}
                    </div>
                    <div style={{ display: "flex", gap: 5 }}>
                      <input
                        value={entry}
                        onChange={(e) => setEntry(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            if (pending.kind === "calibrate") confirmCalibration();
                            else confirmSpace();
                          }
                          if (e.key === "Escape") cancel();
                        }}
                        placeholder={pending.kind === "calibrate" ? "e.g. 40" : "Stage, House, Booth…"}
                        inputMode={pending.kind === "calibrate" ? "decimal" : "text"}
                        style={INPUT}
                        autoFocus
                      />
                      {pending.kind === "calibrate" && (
                        <select value={calUnit} onChange={(e) => setCalUnit(e.target.value as MeasureUnit)} style={{ ...INPUT, width: 66 }}>
                          {MEASURE_UNITS.map((u) => (
                            <option key={u} value={u}>{u}</option>
                          ))}
                        </select>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                      <button
                        style={{ ...BTN, flex: 1 }}
                        disabled={busy}
                        onClick={pending.kind === "calibrate" ? confirmCalibration : confirmSpace}
                      >
                        {pending.kind === "calibrate" ? "Set scale" : "Create space"}
                      </button>
                      <button style={BTN} onClick={cancel}>Cancel</button>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>

      <div style={{ fontSize: 11.5, color: "#8c919c" }}>
        Arm a device and click the plan to place each unit · click a marker to select it,
        drag it to move it (arrow keys nudge) · click inside a space to select the room ·
        the BOM prices every sheet in this design, not just the visible page.
      </div>
    </div>
  );
}
