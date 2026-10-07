"use client";

import { useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import type { NextStepAction } from "@/lib/quote-next-step";
import { parseStep, stepAfterAction, stepSearch, type EstimateStep } from "@/lib/estimate-steps/steps";
import { estimateReadiness } from "@/lib/estimate-steps/readiness";
import { CSS, CHEVRON_CLIP, DARK_SELECT, SIDE_TOGGLE } from "./estimator-styles";
import { useEstimatorState } from "./use-estimator-state";
import { withDiscipline } from "@/lib/estimate-output/fields";
import { QuoteNextStep } from "@/components/quote-review/quote-next-step";
import { addQuoteTaskAction, removeQuoteTaskAction, applyQuoteTemplateAction, setQuoteTaskStatusAction, updateQuoteTaskAction } from "./actions";
import { RewardCreditPanel } from "./reward-credit-panel";
import { pointsLabel } from "@/lib/rewards/points";
import { TasksCard } from "@/components/tasks-card";
import { ApplyTemplateControl } from "@/components/apply-template-control";
import { fmt, short, systemSellTotal } from "./pricing";
import type { EstimatorProps } from "./types";
import { PAYMENT_TERMS, vendorAttachmentLoad } from "./types";
import { ACCENT_INK, ACCENT_SOFT } from "./est-ui";
import SectionCard from "./section-card";
import NarrativeColumn from "./narrative-column";
import SystemLibraryModal from "./system-library-modal";
import AiScopeModal from "./ai-scope-modal";
import CurtainModal from "./curtain-modal";
import FixtureModal from "./fixture-modal";
import LaborModal from "./labor-modal";
import TrackModal from "./track-modal";
import VendorQuoteModal from "./vendor-quote-modal";
import PreviewDoc from "./preview-doc";
import { PortalPanel } from "./portal-panel";
import { EstimatorHeader } from "./estimator-header";
import { EstimatorBanners } from "./estimator-banners";
import { StepTabs } from "./step-tabs";

/**
 * #304 (spec 2026-10-07 §4) — the Estimator shell: one header, four step
 * tabs (`?step=`), the banners, and the active step. All quote state lives in
 * useEstimatorState, so switching steps never drops unsaved edits.
 */
export default function EstimatorClient(props: EstimatorProps) {
  const s = useEstimatorState(props);
  const params = useSearchParams();
  const step: EstimateStep = s.phone ? "review" : parseStep(params.get("step"));
  const goStep = (next: EstimateStep) => {
    if (next === step) return;
    window.history.pushState(null, "", window.location.pathname + stepSearch(window.location.search, next));
  };
  const onActed = (action: NextStepAction) => {
    const to = stepAfterAction(action);
    if (to) goStep(to);
  };
  // The first save gives a new estimate its id — put it in the URL so a reload or a copied step link reopens it.
  useEffect(() => {
    if (!s.loadedId || params.get("id") === s.loadedId) return;
    window.history.replaceState(null, "", window.location.pathname + stepSearch(window.location.search, step, s.loadedId));
  }, [s.loadedId, params, step]);
  const badges = useMemo(
    () =>
      estimateReadiness({
        saved: !!s.loadedId,
        sections: s.sections,
        review: s.next ? { label: s.next.pill.label, tone: s.next.pill.tone } : null,
        status: s.status,
        revNum: s.revNum,
      }),
    [s.loadedId, s.sections, s.next, s.status, s.revNum]
  );
  const {
    activeId,
    addAiLine,
    addCurtain,
    addCustomPart,
    addFixture,
    addLabor,
    addMob,
    addPart,
    addSystem,
    addTrack,
    addVendorLine,
    aiAdded,
    aiBusy,
    aiErr,
    aiLines,
    aiOpen,
    aiScope,
    aiScopeInserted,
    aiSource,
    aiTargetSection,
    appliedCredit,
    applyAutoMiles,
    applyCredit,
    applySync,
    applyTravelTrip,
    blobUploads,
    canApplyCredit,
    canWriteNarrativeLibrary,
    cardRefs,
    changePipeline,
    changeStage,
    closeInput,
    cols,
    commitVendorQuote,
    copySystem,
    coverSummary,
    creditInfo,
    curtainDraft,
    curtainEdit,
    curtainFor,
    curtainSec,
    curtainSewingPct,
    curtainTrack,
    customDraft,
    customError,
    customerId,
    cutSheetCount,
    dec,
    deleteSystem,
    detail,
    doSave,
    fabrics,
    fixtureAssemblies,
    fixtureDraft,
    fixtureFor,
    fixtureSec,
    freightDefault,
    importMaterials,
    inc,
    initial,
    insertAiScope,
    intros,
    isExpanded,
    isInternal,
    isOpenFor,
    kpLib,
    laborDraft,
    laborEdit,
    laborFor,
    laborSec,
    libraryOpen,
    loadVendorLines,
    loadedId,
    moveItem,
    moveSystem,
    narrOpen,
    narrRef,
    narrSec,
    next,
    notIncluded,
    notIncludedDefault,
    onCoverSummary,
    onNotIncluded,
    openCurtainEdit,
    openInput,
    openInputMethod,
    openLaborEdit,
    openTrackEdit,
    openVendorEdit,
    paymentTerms,
    pdf,
    pdfCover,
    pdfCutSheets,
    pdfDirty,
    pdfItemizedAppendix,
    pdfNotes,
    pdfOptions,
    pdfPrices,
    pdfQty,
    pdfTerms,
    people,
    phone,
    pipelines,
    placeLibrarySystem,
    portalStatusError,
    quoteTasks,
    rate,
    removeCredit,
    removeItem,
    removeMob,
    removeVendorLine,
    renameSystem,
    resetAutoHrs,
    resetSystemSell,
    roundSystemPrice,
    runAiDraft,
    savingCustom,
    scrollRef,
    searchQuotes,
    sections,
    selectSystem,
    setActionError,
    setActiveId,
    setAiOpen,
    setAutoHrs,
    setCurtainField,
    setCurtainTrack,
    setCustomField,
    setDetail,
    setFixture,
    setFixtureAssembly,
    setFixtureComponentQty,
    setFreightPct,
    setGateRefused,
    setIntros,
    setItemExtSell,
    setItemPrice,
    setItemSpecKey,
    setLabor,
    setLibraryOpen,
    setMarginAll,
    setMob,
    setMobNameSelect,
    setNarrFocusReq,
    setPaymentTerms,
    setPdf,
    setPdfCover,
    setPdfCutSheets,
    setPdfItemizedAppendix,
    setPdfNotes,
    setPdfOptions,
    setPdfPrices,
    setPdfQty,
    setPdfTerms,
    setQty,
    setSystemMargin,
    setSystemPresentation,
    setSystemRoom,
    setSystemSell,
    setTrackDraft,
    setTripLocal,
    setVendorDisplay,
    setVendorField,
    setVendorLine,
    showNarr,
    showStageBar,
    sideOpen,
    specKeys,
    stageBarCurIdx,
    stageBarLostLabel,
    stageBarPipeline,
    status,
    statusChanging,
    t,
    templateSets,
    tierMargin,
    tierResolving,
    toggleCurtainTrack,
    toggleExpand,
    toggleKeyProductLine,
    toggleMobFlag,
    toggleSide,
    trackDraft,
    trackEdit,
    trackFor,
    trackParts,
    trackSec,
    trackSeries,
    travelEstNow,
    updateSection,
    useMobNameList,
    vendorDraft,
    vendorEditingRec,
    vendorFor,
    vendorFormMargin,
    vendorPreviews,
    vendorQuotes,
    vendorSec,
    vendors,
    venueRoomName,
  } = s;

  return (
    <div className="est-root" style={{ height: "100%", display: "flex", flexDirection: "column", fontFamily: "var(--font-ui)", color: "#16181d", background: "#f7f8fa", overflow: "hidden" }}>
      <style>{CSS}</style>
      {!s.phone && (
        <>
          <EstimatorHeader s={s} onActed={onActed} />
          <StepTabs step={step} badges={badges} onStep={goStep} />
          <EstimatorBanners s={s} />
        </>
      )}

      {/* Task 7 renders the four steps here; until then keep today's build body + preview,
          switched on `step === "review"` instead of the old build/preview mode. */}
      {step !== "review" && (
        <div
          data-screen-label="Estimator workspace"
          className="est-screen"
          style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
        >
          {/* Daylite stage bar (Task 6) — system quotes only, none for an
              unsaved estimate. Read-only + a "Lost" marker on a lost quote;
              the pipeline switch (Estimate/Design ⇄ BID SPEC) only while
              draft, since a sent/won stage carries contractual meaning. */}
          {showStageBar && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                flexWrap: "wrap",
                rowGap: 8,
                padding: "9px 22px",
                background: "#22252b",
                borderBottom: "1px solid #2b2e35",
                flexShrink: 0,
              }}
            >
              <div style={{ display: "flex", alignItems: "center" }}>
                {stageBarPipeline.stages.map((s, i) => {
                  const isCurrent = i === stageBarCurIdx;
                  const isPast = stageBarCurIdx >= 0 && i < stageBarCurIdx;
                  const readOnly = status === "lost";
                  return (
                    <button
                      key={s.id}
                      type="button"
                      disabled={readOnly}
                      onClick={() => changeStage(s.id)}
                      title={readOnly ? "Lost — the stage the quote died at" : "Set stage: " + s.label}
                      style={{
                        fontFamily: "var(--font-ui)",
                        fontSize: 11,
                        fontWeight: isCurrent ? 700 : 600,
                        color: isCurrent ? "#16181d" : isPast ? "#cfd3da" : "#7d828d",
                        background: isCurrent ? "var(--accent)" : "#2b2e35",
                        border: "1px solid " + (isCurrent ? "var(--accent)" : "#3a3e46"),
                        padding: "6px 16px 6px 20px",
                        marginLeft: i === 0 ? 0 : -10,
                        clipPath: CHEVRON_CLIP,
                        cursor: readOnly ? "default" : "pointer",
                        whiteSpace: "nowrap",
                        position: "relative",
                        zIndex: i + 1,
                        opacity: readOnly ? 0.6 : 1,
                      }}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
              {status === "lost" && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#e0a08f",
                    background: "#3a2b26",
                    border: "1px solid #5a3c33",
                    borderRadius: 20,
                    padding: "4px 11px",
                    whiteSpace: "nowrap",
                  }}
                >
                  ✕ Lost{stageBarLostLabel ? " at " + stageBarLostLabel : ""}
                </span>
              )}
              {status === "draft" && (
                <select
                  value={stageBarPipeline.id}
                  onChange={(e) => changePipeline(e.target.value)}
                  aria-label="Quote pipeline"
                  style={{ ...DARK_SELECT, borderRadius: 7, padding: "6px 9px" }}
                >
                  {pipelines.quote.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* body */}
          <div className="est-body" style={{ flex: 1, display: "flex", minHeight: 0 }}>
            {/* left sidebar — collapsible to a 36px tab, remembered per browser (#168, D224) */}
            {sideOpen ? (
              <div
                className="est-side"
                style={{
                  width: 262,
                  background: "#fff",
                  borderRight: "1px solid #ececf0",
                  display: "flex",
                  flexDirection: "column",
                  flexShrink: 0,
                }}
              >
                <div style={{ padding: "16px 14px 8px" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 10,
                      padding: "0 6px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: "#9aa0ab",
                        letterSpacing: ".06em",
                        textTransform: "uppercase",
                      }}
                    >
                      Systems
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button
                        type="button"
                        onClick={addSystem}
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: "var(--accent)",
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          padding: 0,
                        }}
                      >
                        + Add
                      </button>
                      <button
                        type="button"
                        className="est-side-toggle"
                        onClick={toggleSide}
                        aria-expanded={true}
                        title="Hide systems"
                        style={SIDE_TOGGLE}
                      >
                        ‹ Hide
                      </button>
                    </div>
                  </div>
                  {sections.map((sec) => {
                    const sub = systemSellTotal(sec);
                    const active = activeId === sec.id;
                    const label = sec.name
                      .split(" — ")[0]
                      .split(" & ")[0]
                      .replace("Motorized Hoists", "Hoists");
                    return (
                      <button
                        type="button"
                        key={sec.id}
                        onClick={() => selectSystem(sec.id)}
                        style={{
                          width: "100%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                          padding: active ? "10px 12px 10px 9px" : "10px 12px",
                          borderRadius: 9,
                          marginBottom: 3,
                          border: "none",
                          cursor: "pointer",
                          textAlign: "left",
                          background: active ? ACCENT_SOFT : "transparent",
                          borderLeft: active ? "3px solid var(--accent)" : undefined,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: active ? 600 : 500,
                            color: active ? ACCENT_INK : "#3a3f4a",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {label || "Untitled"}
                        </span>
                        <span
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: 11.5,
                            color: active ? ACCENT_INK : "#9aa0ab",
                            flexShrink: 0,
                          }}
                        >
                          {short(sub)}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div
                  style={{ margin: "6px 14px", padding: 13, background: "#f7f8fa", borderRadius: 10 }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 9,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: "#9aa0ab",
                        letterSpacing: ".05em",
                        textTransform: "uppercase",
                      }}
                    >
                      Margin · all systems
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: ACCENT_INK,
                      }}
                    >
                      {Math.round(t.margin * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={55}
                    value={Math.round(t.margin * 100)}
                    onChange={(e) => setMarginAll(e.target.value)}
                    style={{ width: "100%", accentColor: "var(--accent)", cursor: "pointer" }}
                  />
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 10,
                      color: "#9aa0ab",
                      marginTop: 3,
                    }}
                  >
                    <span>0%</span>
                    <span>Reprice every line</span>
                    <span>55%</span>
                  </div>
                </div>

                <div
                  style={{ margin: "6px 14px", padding: 13, background: "#f7f8fa", borderRadius: 10 }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#9aa0ab",
                      letterSpacing: ".05em",
                      textTransform: "uppercase",
                      marginBottom: 10,
                    }}
                  >
                    Cost breakdown
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 12.5,
                      marginBottom: 7,
                    }}
                  >
                    <span style={{ color: "#5b616e" }}>Materials</span>
                    <span style={{ fontFamily: "var(--font-mono)" }}>{fmt(t.mat)}</span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 12.5,
                      marginBottom: 7,
                    }}
                  >
                    <span style={{ color: "#5b616e" }}>Labor</span>
                    <span style={{ fontFamily: "var(--font-mono)" }}>{fmt(t.lab)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                    <span style={{ color: "#5b616e" }}>Freight</span>
                    <span style={{ fontFamily: "var(--font-mono)" }}>{fmt(t.fr)}</span>
                  </div>
                  {(t.credit || 0) > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginTop: 7, color: "#1f8a5b", fontWeight: 600 }}>
                      <span>Rewards credit · {pointsLabel(t.credit || 0)}</span>
                      <span style={{ fontFamily: "var(--font-mono)" }}>−{fmt(t.credit || 0)}</span>
                    </div>
                  )}
                </div>

                <RewardCreditPanel
                  info={creditInfo}
                  applied={appliedCredit}
                  preCreditTotal={t.grand + (t.credit || 0)}
                  editable={canApplyCredit && (status === "draft" || status === "sent")}
                  hasSystems={sections.length > 0}
                  onApply={applyCredit}
                  onRemove={removeCredit}
                />

                {/* Tasks (PUNCHLIST #17 remainder) — needs a saved quote to
                    attach to; a brand-new unsaved draft has nowhere for
                    quoteId to point yet. */}
                <div style={{ margin: "6px 14px 14px" }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#9aa0ab",
                      letterSpacing: ".05em",
                      textTransform: "uppercase",
                      marginBottom: 8,
                    }}
                  >
                    Tasks
                  </div>
                  {loadedId ? (
                    <>
                      <ApplyTemplateControl
                        parentField="quoteId"
                        parentId={loadedId}
                        templateSets={templateSets}
                        action={applyQuoteTemplateAction}
                      />
                      <TasksCard
                        parentField="quoteId"
                        parentId={loadedId}
                        tasks={quoteTasks}
                        people={people}
                        addAction={addQuoteTaskAction}
                        setStatusAction={setQuoteTaskStatusAction}
                        updateAction={updateQuoteTaskAction}
                        removeAction={removeQuoteTaskAction}
                        defaultSection="Review"
                      />
                    </>
                  ) : (
                    <div style={{ fontSize: 11.5, color: "#aab0bb" }}>Save the quote to add tasks.</div>
                  )}
                </div>
              </div>
            ) : (
              <div
                className="est-side est-side-collapsed"
                style={{ width: 36, flexShrink: 0, minHeight: 0, display: "flex", flexDirection: "column", background: "#fff", borderRight: "1px solid #ececf0" }}
              >
                <button
                  type="button"
                  className="est-side-tab"
                  onClick={toggleSide}
                  aria-expanded={false}
                  title="Show systems"
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "flex-start",
                    gap: 10,
                    padding: "12px 0",
                    background: "transparent",
                    border: "none",
                    color: "#9aa0ab",
                    cursor: "pointer",
                    fontFamily: "var(--font-ui)",
                  }}
                >
                  <span aria-hidden="true" style={{ fontSize: 15, lineHeight: 1 }}>›</span>
                  <span
                    className="est-side-vlabel"
                    style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", writingMode: "vertical-rl", whiteSpace: "nowrap" }}
                  >
                    Systems
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#6b7079" }}>{sections.length}</span>
                </button>
              </div>
            )}

            {/* main cards */}
            <div
              ref={scrollRef}
              className="est-scroll est-main"
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "20px 26px 60px",
                minWidth: 0,
                position: "relative",
              }}
            >
              {initial.portal && <PortalPanel data={initial.portal} statusError={portalStatusError} />}
              {sections.map((sec, i) => (
                <SectionCard
                  key={sec.id}
                  sec={sec}
                  index={i}
                  active={activeId === sec.id}
                  expanded={isExpanded(sec.id)}
                  isInternal={isInternal}
                  cols={cols}
                  catalogOpen={isOpenFor("catalog", sec.id)}
                  customOpen={isOpenFor("custom", sec.id)}
                  openMethod={openInput && openInput.secId === sec.id ? openInput.kind : null}
                  customDraft={customDraft}
                  vendorQuotes={vendorQuotes}
                  vendorPreviews={vendorPreviews}
                  savedQuoteId={loadedId}
                  registerRef={(id, el) => {
                    cardRefs.current[id] = el;
                  }}
                  onToggleExpand={() => toggleExpand(sec.id)}
                  onRename={(name) => renameSystem(sec.id, name)}
                  onEditNarrative={() => {
                    // #281: make this system active, open the column, focus the textarea.
                    setActiveId(sec.id);
                    if (!narrOpen) showNarr(true);
                    setNarrFocusReq((n) => n + 1);
                  }}
                  onActivate={() => setActiveId(sec.id)}
                  onSetRoom={(value) => setSystemRoom(sec.id, value)}
                  defaultRoom={venueRoomName}
                  onSetPresentation={(value) => setSystemPresentation(sec.id, value)}
                  onSetDiscipline={(value) => updateSection(sec.id, (s) => withDiscipline(s, value))}
                  onDelete={() => deleteSystem(sec.id)}
                  onSetMargin={(v) => setSystemMargin(sec.id, v)}
                  onSetSell={(v) => setSystemSell(sec.id, v)}
                  onResetSell={() => resetSystemSell(sec.id)}
                  onRoundPrice={() => roundSystemPrice(sec.id)}
                  onSetFreight={(v) => setFreightPct(sec.id, v)}
                  freightUnknown={freightDefault.unknown}
                  onInc={inc}
                  onDec={dec}
                  onSetQty={setQty}
                  onSetPrice={setItemPrice}
                  onSetExtSell={setItemExtSell}
                  specKeys={specKeys}
                  onSetSpecKey={setItemSpecKey}
                  onMoveItem={(itemId, direction) => moveItem(sec.id, itemId, direction)}
                  onRemoveItem={removeItem}
                  onToggleKeyProduct={(itemId) => toggleKeyProductLine(sec.id, itemId)}
                  onToggleCatalog={() => openInputMethod("catalog", sec.id)}
                  onToggleCurtain={() => openInputMethod("curtain", sec.id)}
                  onToggleFixture={() => openInputMethod("fixture", sec.id)}
                  onToggleLabor={() => openInputMethod("labor", sec.id)}
                  onToggleTrack={() => openInputMethod("track", sec.id)}
                  onToggleCustom={() => openInputMethod("custom", sec.id)}
                  onToggleVendor={() => openInputMethod("vendor", sec.id)}
                  onAddPart={(cat, qty) => addPart(sec.id, cat, qty)}
                  onImportMaterials={(items) => importMaterials(sec.id, items)}
                  onSetVendorDisplay={setVendorDisplay}
                  onEditVendor={(vqId) => openVendorEdit(sec.id, vqId)}
                  onEditLabor={(group) => openLaborEdit(sec.id, group)}
                  onEditTrack={(lineId) => openTrackEdit(sec.id, lineId)}
                  onEditCurtain={(lineId) => openCurtainEdit(sec.id, lineId)}
                  onSetCustomDraft={setCustomField}
                  onAddCustomPart={() => addCustomPart(sec.id)}
                  customError={customError}
                  savingCustom={savingCustom}
                  onMoveToNew={() => moveSystem(sec.id, { kind: "new" })}
                  onMoveToExisting={(targetQuoteId) =>
                    moveSystem(sec.id, { kind: "existing", quoteId: targetQuoteId })
                  }
                  onCopyToNew={() => copySystem(sec.id, { kind: "new" })}
                  onCopyToExisting={(targetQuoteId) =>
                    copySystem(sec.id, { kind: "existing", quoteId: targetQuoteId })
                  }
                  onCopyHere={() => copySystem(sec.id, { kind: "same" })}
                  onSearchQuotes={searchQuotes}
                />
              ))}

              <button
                type="button"
                className="est-addsys"
                onClick={addSystem}
                style={{
                  width: "100%",
                  padding: 14,
                  background: "#fff",
                  border: "1px dashed #d6d9e0",
                  borderRadius: 12,
                  color: "#8c919c",
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: "var(--font-ui)",
                  cursor: "pointer",
                }}
              >
                + Add system
              </button>
              <button
                type="button"
                className="est-addsys est-addlib"
                onClick={() => setLibraryOpen(true)}
                title="Load a system from a sent or won estimate — re-priced for this one"
                style={{
                  width: "100%",
                  marginTop: 8,
                  padding: 10,
                  background: "#fff",
                  border: "1px dashed #d6d9e0",
                  borderRadius: 12,
                  color: "#8c919c",
                  fontSize: 12.5,
                  fontWeight: 600,
                  fontFamily: "var(--font-ui)",
                  cursor: "pointer",
                }}
              >
                + From library…
              </button>
              {libraryOpen && (
                <SystemLibraryModal mode="load" tierMargin={tierMargin} onLoaded={placeLibrarySystem} onClose={() => setLibraryOpen(false)} />
              )}
            </div>

            {/* system narrative — the right column Quote details vacated (#281);
                a light writing surface that follows the active system;
                collapsible to a 36px tab, remembered per browser */}
            {narrOpen ? (
              <aside
                className="est-narr"
                aria-label="System narrative"
                style={{
                  width: 360,
                  flexShrink: 0,
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  padding: "16px 18px 18px",
                  background: "#fff",
                  borderLeft: "1px solid #ececf0",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: "#9aa0ab",
                        letterSpacing: ".06em",
                        textTransform: "uppercase",
                      }}
                    >
                      Narrative
                    </div>
                    {narrSec && (
                      <div
                        style={{
                          marginTop: 3,
                          fontSize: 13.5,
                          fontWeight: 600,
                          color: "#16181d",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {narrSec.name || "Untitled system"}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="est-narr-toggle"
                    onClick={() => showNarr(false)}
                    aria-expanded={true}
                    title="Hide narrative"
                    style={SIDE_TOGGLE}
                  >
                    Hide ›
                  </button>
                </div>
                {narrSec ? (
                  <NarrativeColumn
                    key={narrSec.id}
                    sec={narrSec}
                    narrRef={narrRef}
                    onChange={(fn) => updateSection(narrSec.id, fn)}
                    library={kpLib}
                    canWriteLibrary={canWriteNarrativeLibrary}
                    intros={intros}
                    onIntros={setIntros}
                    quoteId={loadedId}
                    customerId={customerId}
                  />
                ) : (
                  <div style={{ fontSize: 12, color: "#8c919c", lineHeight: 1.45 }}>
                    Add a system to write its narrative.
                  </div>
                )}
              </aside>
            ) : (
              <aside
                className="est-narr est-narr-collapsed"
                aria-label="System narrative (collapsed)"
                style={{ width: 36, flexShrink: 0, minHeight: 0, display: "flex", flexDirection: "column", background: "#fff", borderLeft: "1px solid #ececf0" }}
              >
                <button
                  type="button"
                  className="est-narr-tab"
                  onClick={() => showNarr(true)}
                  aria-expanded={false}
                  title="Show narrative"
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "flex-start",
                    gap: 10,
                    padding: "12px 0",
                    background: "transparent",
                    border: "none",
                    color: "#9aa0ab",
                    cursor: "pointer",
                    fontFamily: "var(--font-ui)",
                  }}
                >
                  <span aria-hidden="true" style={{ fontSize: 15, lineHeight: 1 }}>‹</span>
                  <span
                    className="est-narr-vlabel"
                    style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", writingMode: "vertical-rl", whiteSpace: "nowrap" }}
                  >
                    Narrative
                  </span>
                </button>
              </aside>
            )}
          </div>

          {/* configurator modals */}
          {curtainFor && (
            <CurtainModal
              secName={curtainSec ? curtainSec.name : ""}
              editing={!!curtainEdit}
              linkedTrack={curtainEdit?.linkedTrack ?? null}
              draft={curtainDraft}
              fabrics={fabrics}
              sewingPct={curtainSewingPct}
              margin={tierMargin ?? undefined}
              onSet={setCurtainField}
              onAdd={() => addCurtain(curtainFor)}
              onClose={closeInput}
              track={curtainTrack}
              trackSeries={trackSeries}
              trackParts={trackParts}
              onToggleTrack={toggleCurtainTrack}
              onSetTrack={(field, val) => setCurtainTrack((t) => (t ? { ...t, [field]: val } : t))}
            />
          )}
          {trackFor && (
            <TrackModal
              secName={trackSec ? trackSec.name : ""}
              draft={trackDraft}
              series={trackSeries}
              parts={trackParts}
              margin={tierMargin}
              editing={!!trackEdit}
              readOnly={trackEdit?.readOnly ?? null}
              onSet={(field, val) => setTrackDraft((d) => ({ ...d, [field]: val }))}
              onAdd={() => addTrack(trackFor)}
              onClose={closeInput}
            />
          )}
          {fixtureFor && (
            <FixtureModal
              secName={fixtureSec ? fixtureSec.name : ""}
              draft={fixtureDraft}
              assemblies={fixtureAssemblies}
              onSet={setFixture}
              onAssembly={setFixtureAssembly}
              onComponentQty={setFixtureComponentQty}
              onAdd={() => addFixture(fixtureFor)}
              onClose={closeInput}
            />
          )}
          {laborFor && (
            <LaborModal
              secName={laborSec ? laborSec.name : ""}
              draft={laborDraft}
              rate={rate}
              travel={travelEstNow()}
              onSet={setLabor}
              onSetAutoHrs={setAutoHrs}
              onResetAutoHrs={resetAutoHrs}
              onAddMob={addMob}
              onRemoveMob={removeMob}
              onSetMob={setMob}
              onSetMobNameSelect={setMobNameSelect}
              onUseMobNameList={useMobNameList}
              onSetTripLocal={setTripLocal}
              onApplyTravelTrip={applyTravelTrip}
              onToggleMobFlag={toggleMobFlag}
              onApplyAutoMiles={applyAutoMiles}
              onAdd={() => addLabor(laborFor)}
              editing={laborEdit}
              onClose={closeInput}
            />
          )}
          {vendorFor && (
            <VendorQuoteModal
              /* Keyed by the record id (#144) so switching straight from one
                 vendor quote to another — an add into an edit, or edit into
                 edit, which no longer unmounts the modal because the kind is
                 unchanged — remounts the form. That is what retires the #143
                 `alive` guard on an upload still in flight, which would
                 otherwise drop the abandoned file onto the quote now open. */
              key={vendorDraft.id}
              secName={vendorSec ? vendorSec.name : ""}
              draft={vendorDraft}
              vendors={vendors}
              margin={vendorFormMargin}
              blobUploads={blobUploads}
              /* Lets the form reach the download proxy for a file that is
                 already stored (#144 re-review): on an edit the object-URL that
                 minted the in-memory preview died with the page that made it,
                 so a Blob-only attachment would otherwise show a filename the
                 user cannot open before replacing it. */
              savedQuoteId={loadedId}
              /* The record being EDITED is left out of the budget (#144): its
                 stored data-URL is about to be replaced by whatever this draft
                 ends up holding, so counting both would ration the estimate
                 against its own file twice. */
              attachedChars={vendorAttachmentLoad(
                vendorQuotes.filter((v) => v.id !== vendorDraft.id)
              )}
              onSet={setVendorField}
              onSetLine={setVendorLine}
              onAddLine={addVendorLine}
              onRemoveLine={removeVendorLine}
              onLoadLines={loadVendorLines}
              editing={!!vendorEditingRec}
              onAdd={() => commitVendorQuote(vendorFor)}
              onClose={closeInput}
            />
          )}
          {aiSource && aiOpen && (
            <AiScopeModal
              sourceLabel={
                (aiSource.kind === "survey" ? "field survey" : "inspection") +
                " · " +
                aiSource.label
              }
              targetSection={aiTargetSection()?.name || ""}
              busy={aiBusy}
              error={aiErr}
              scope={aiScope}
              lines={aiLines}
              scopeInserted={aiScopeInserted}
              addedLines={aiAdded}
              onInsertScope={insertAiScope}
              onAddLine={addAiLine}
              onRetry={runAiDraft}
              onClose={() => setAiOpen(false)}
            />
          )}
        </div>
      )}

      {/* the saved customer PDF (#222) — the Customer review step for now */}
      {step === "review" && (
        <>
          {/* #284 — an approver on a phone can decide right from the preview.
              The build-mode error banner isn't rendered here, so the control
              shows its own inline error line. */}
          {phone && loadedId && next?.approverMode && (
            <div style={{ padding: "10px 14px", borderBottom: "1px solid #e4e7ec", background: "#fff" }}>
              <QuoteNextStep
                quoteId={loadedId}
                view={next}
                variant="panel"
                approverOnly
                onSync={(r) => {
                  applySync(r);
                  if (r.ok) {
                    setActionError(null);
                    setGateRefused(false);
                  }
                }}
              />
            </div>
          )}
          <PreviewDoc
            phone={phone}
            canBuild={!phone}
            onBack={() => goStep("build")}
            savedQuoteId={loadedId}
            pdf={pdf}
            onPdf={setPdf}
            dirty={pdfDirty}
            onSave={doSave}
            saveDisabled={statusChanging || tierResolving}
            sections={sections}
            setSectionPresentation={(id, value) => setSystemPresentation(id, value)}
            detail={detail}
            setDetail={setDetail}
            pdfQty={pdfQty}
            pdfNotes={pdfNotes}
            pdfPrices={pdfPrices}
            pdfCover={pdfCover}
            pdfTerms={pdfTerms}
            pdfOptions={pdfOptions}
            pdfItemizedAppendix={pdfItemizedAppendix}
            pdfCutSheets={pdfCutSheets}
            cutSheetCount={cutSheetCount}
            paymentTerms={paymentTerms}
            paymentTermsOptions={PAYMENT_TERMS}
            setPaymentTerms={setPaymentTerms}
            togglePdf={(flag) => {
              if (flag === "pdfQty") setPdfQty((v) => !v);
              else if (flag === "pdfNotes") setPdfNotes((v) => !v);
              else if (flag === "pdfPrices") setPdfPrices((v) => !v);
              else if (flag === "pdfCover") setPdfCover((v) => !v);
              else if (flag === "pdfOptions") setPdfOptions((v) => !v);
              else if (flag === "pdfItemizedAppendix") setPdfItemizedAppendix((v) => !v);
              else if (flag === "pdfCutSheets") setPdfCutSheets((v) => !v);
              else setPdfTerms((v) => !v);
            }}
            coverSummary={coverSummary}
            setCoverSummary={onCoverSummary}
            notIncluded={notIncluded}
            setNotIncluded={onNotIncluded}
            notIncludedDefault={notIncludedDefault}
          />
        </>
      )}
    </div>
  );
}
