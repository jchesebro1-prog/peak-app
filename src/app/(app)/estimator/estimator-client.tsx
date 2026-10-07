"use client";

import { CSS, CHEVRON_CLIP, CTX_LABEL, DARK_SELECT, META_HEAD, META_HINT, META_SECTION, META_SUB, META_TOGGLE, SIDE_TOGGLE, STATUS_DOT } from "./estimator-styles";
import { useEstimatorState, INSTALL_TIMEFRAMES } from "./use-estimator-state";
import { withDiscipline } from "@/lib/estimate-output/fields";
import type { QuoteStatus } from "@/lib/stores/quotes";
import { QuoteNextStep } from "@/components/quote-review/quote-next-step";
import { addQuoteTaskAction, removeQuoteTaskAction, applyQuoteTemplateAction, setQuoteTaskStatusAction, updateQuoteTaskAction } from "./actions";
import { RewardCreditPanel } from "./reward-credit-panel";
import { PurchasePerksBanner } from "@/components/rewards/purchase-perks-banner";
import { pointsLabel } from "@/lib/rewards/points";
import { TasksCard } from "@/components/tasks-card";
import { ApplyTemplateControl } from "@/components/apply-template-control";
import { ChangeTypeControl } from "@/components/quote-flow-controls";
import { wonEditMessage } from "@/app/(app)/quotes/new/handoff";
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
import { DeleteQuoteButton } from "../quotes/delete-quote-button";
import { PortalPanel } from "./portal-panel";
import { tierRepriceMessage } from "./tier-reprice";

/**
 * Estimator workspace — client port of Estimator.dc.html (build + preview
 * modes). All state lives here; pricing math in ./pricing; persistence via
 * server actions on the quotes store.
 */

export default function EstimatorClient(props: EstimatorProps) {
  const s = useEstimatorState(props);
  const {
    actionError,
    actionNotice,
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
    assumptionLibrary,
    assumptions,
    blobUploads,
    canApplyCredit,
    canWriteNarrativeLibrary,
    cardRefs,
    category,
    categorySaved,
    changePeople,
    changePipeline,
    changeStage,
    changeStatus,
    checkedAssumptions,
    closeInput,
    closeQd,
    closeTitle,
    cols,
    commitVendorQuote,
    contactOptions,
    copySystem,
    coverSummary,
    creditInfo,
    currentContact,
    curtainDraft,
    curtainEdit,
    curtainFor,
    curtainSec,
    curtainSewingPct,
    curtainTrack,
    customDraft,
    customError,
    customerId,
    customerOptions,
    cutSheetCount,
    dec,
    deleteSystem,
    detail,
    doSave,
    exportPartsList,
    fabrics,
    fixtureAssemblies,
    fixtureDraft,
    fixtureFor,
    fixtureSec,
    freightDefault,
    gateRefused,
    importMaterials,
    inc,
    initial,
    insertAiScope,
    installTimeframe,
    intros,
    isBuild,
    isExpanded,
    isInternal,
    isOpenFor,
    isPreview,
    justSaved,
    kpLib,
    laborDraft,
    laborEdit,
    laborFor,
    laborSec,
    libraryOpen,
    loadVendorLines,
    loadedId,
    locationId,
    moveItem,
    moveNotice,
    moveSystem,
    narrOpen,
    narrRef,
    narrSec,
    next,
    notIncluded,
    notIncludedDefault,
    onAssumptions,
    onCoverSummary,
    onInstallTimeframe,
    onNotIncluded,
    onQuoteNote,
    openAiDraft,
    openCurtainEdit,
    openInput,
    openInputMethod,
    openLaborEdit,
    openTitle,
    openTrackEdit,
    openVendorEdit,
    ownerValue,
    partsBusy,
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
    peopleBusy,
    peopleOptions,
    persistMeta,
    phone,
    pickContact,
    pickCustomer,
    pickVenue,
    pipelines,
    placeLibrarySystem,
    portalStatusError,
    preparedValue,
    projectName,
    qdChipLabel,
    qdChipRef,
    qdOpen,
    qdPanelRef,
    quoteId,
    quoteNote,
    quoteTasks,
    rate,
    removeCredit,
    removeItem,
    removeMob,
    removeVendorLine,
    renameSystem,
    resetAutoHrs,
    resetSystemSell,
    revNum,
    roundSystemPrice,
    runAiDraft,
    samePerson,
    saveNow,
    savingCustom,
    scrollRef,
    searchQuotes,
    sections,
    selectSystem,
    setActionError,
    setActionNotice,
    setActiveId,
    setAiOpen,
    setAutoHrs,
    setCategory,
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
    setMode,
    setMoveNotice,
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
    setQdOpen,
    setQty,
    setSystemMargin,
    setSystemPresentation,
    setSystemRoom,
    setSystemSell,
    setTierReprice,
    setTitleDraft,
    setTrackDraft,
    setTripLocal,
    setVendorDisplay,
    setVendorField,
    setVendorLine,
    setWonMetaGuard,
    showContactPick,
    showNarr,
    showStageBar,
    showVenuePick,
    sideOpen,
    specKeys,
    stageBarCurIdx,
    stageBarLostLabel,
    stageBarPipeline,
    statusChanging,
    t,
    templateSets,
    tierMargin,
    tierReprice,
    tierResolving,
    titleDraft,
    titleEditing,
    toggleAssumption,
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
    undoTierReprice,
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
    venueOptions,
    venueRoomName,
    viewerCanApprove,
    viewerName,
    wonMetaGuard,
  } = s;
  return (
    <div
      className="est-root"
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        fontFamily: "var(--font-ui)",
        color: "#16181d",
        background: "#f7f8fa",
        overflow: "hidden",
      }}
    >
      <style>{CSS}</style>

      {/* ===================== BUILD MODE ===================== */}
      {isBuild && (
        <div
          data-screen-label="Estimator workspace"
          className="est-screen"
          style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
        >
          {/* contextual project toolbar */}
          <div
            className="est-topbar"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 18,
              padding: "11px 22px",
              background: "#1d2026",
              borderTop: "1px solid #2b2e35",
              color: "#fff",
              flexShrink: 0,
              position: "sticky",
              top: 0,
              zIndex: 20,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
              <div style={{ minWidth: 0 }}>
                {titleEditing ? (
                  <input
                    autoFocus
                    aria-label="Quote name"
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onBlur={() => closeTitle(true)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        closeTitle(true);
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        closeTitle(false);
                      }
                    }}
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      lineHeight: 1.2,
                      fontFamily: "var(--font-ui)",
                      color: "#fff",
                      background: "#2b2e35",
                      border: "1px solid #4a4e56",
                      borderRadius: 6,
                      padding: "2px 6px",
                      width: 340,
                      maxWidth: "100%",
                      outline: "none",
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={openTitle}
                    title="Rename this quote"
                    style={{
                      display: "block",
                      maxWidth: "100%",
                      fontSize: 14,
                      fontWeight: 600,
                      lineHeight: 1.2,
                      fontFamily: "var(--font-ui)",
                      color: "#fff",
                      background: "none",
                      border: "1px dashed transparent",
                      borderRadius: 6,
                      padding: "2px 6px",
                      margin: "-3px -7px",
                      cursor: "text",
                      textAlign: "left",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    className="est-title"
                  >
                    {projectName}
                  </button>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 11, color: "#9aa0ab", fontFamily: "var(--font-mono)", flexShrink: 0, whiteSpace: "nowrap" }}>
                    {quoteId} · Rev {revNum}
                  </span>
                  {loadedId && <ChangeTypeControl quoteId={loadedId} status={status} tone="dark" />}
                  {/* #281: Quote details moved from the right column into a dropdown. */}
                  <button
                    ref={qdChipRef}
                    type="button"
                    className="est-qd-chip"
                    onClick={() => (qdOpen ? closeQd() : setQdOpen(true))}
                    aria-expanded={qdOpen}
                    aria-controls="est-quote-details"
                    title="Prepared for, venue, contact, category, quote note, assumptions, install timeframe"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      minWidth: 0,
                      maxWidth: 420,
                      fontFamily: "var(--font-ui)",
                      fontSize: 11,
                      fontWeight: 600,
                      color: qdOpen ? "#fff" : "#cfd3da",
                      background: qdOpen ? "#2b2e35" : "transparent",
                      border: "1px solid " + (qdOpen ? "#4a4e56" : "#3a3e46"),
                      borderRadius: 6,
                      padding: "2px 8px",
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {qdChipLabel}
                    </span>
                    <span aria-hidden="true" style={{ flexShrink: 0, fontSize: 9 }}>
                      {qdOpen ? "▴" : "▾"}
                    </span>
                  </button>
                </div>
              </div>
            </div>
            <div
              className="est-topright"
              style={{ display: "flex", alignItems: "center", gap: 22, flexShrink: 0 }}
            >
              <div style={{ textAlign: "right" }}>
                <div
                  style={{
                    fontSize: 10,
                    color: "#9aa0ab",
                    textTransform: "uppercase",
                    letterSpacing: ".05em",
                  }}
                >
                  Blended margin
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 15,
                    fontWeight: 600,
                    color: "#5fd29a",
                  }}
                >
                  {(t.margin * 100).toFixed(1)}%
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div
                  style={{
                    fontSize: 10,
                    color: "#9aa0ab",
                    textTransform: "uppercase",
                    letterSpacing: ".05em",
                  }}
                >
                  Quoted total
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 600 }}>
                  {fmt(t.grand)}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: STATUS_DOT[status] || "#c98a2b",
                    flexShrink: 0,
                  }}
                />
                <select
                  value={status}
                  onChange={(e) => changeStatus(e.target.value as QuoteStatus)}
                  style={{ ...DARK_SELECT, borderRadius: 8, padding: "9px 10px" }}
                >
                  <option value="draft">Draft</option>
                  <option value="sent">Sent</option>
                  <option value="won">Won</option>
                  <option value="lost">Lost</option>
                </select>
              </div>
              {loadedId && <DeleteQuoteButton id={loadedId} won={status === "won"} redirectTo="/estimator" />}
              {aiSource && (
                <button
                  type="button"
                  onClick={openAiDraft}
                  title={"Assemble the scope of work from " + aiSource.label}
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: 13,
                    fontWeight: 600,
                    borderRadius: 8,
                    padding: "9px 15px",
                    cursor: "pointer",
                    border: "1px solid var(--accent)",
                    background: ACCENT_SOFT,
                    color: ACCENT_INK,
                  }}
                >
                  Draft from survey/inspection
                </button>
              )}
              <button
                type="button"
                onClick={exportPartsList}
                disabled={partsBusy}
                title="Model numbers, descriptions and cost for every part — assemblies broken into their parts. For purchasing."
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 13,
                  fontWeight: 600,
                  border: "none",
                  borderRadius: 8,
                  padding: "9px 15px",
                  cursor: partsBusy ? "not-allowed" : "pointer",
                  opacity: partsBusy ? 0.6 : 1,
                  background: "#2b2e35",
                  color: "#cfd3da",
                }}
              >
                Parts list (CSV)
              </button>
              <button
                type="button"
                onClick={doSave}
                disabled={statusChanging || tierResolving}
                title={
                  statusChanging
                    ? "A status change is still saving — try again in a moment."
                    : tierResolving
                      ? "Looking up the customer’s pricing tier — Save in a moment."
                      : undefined
                }
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 13,
                  fontWeight: 600,
                  border: "none",
                  borderRadius: 8,
                  padding: "9px 15px",
                  cursor: statusChanging || tierResolving ? "not-allowed" : "pointer",
                  opacity: statusChanging || tierResolving ? 0.6 : 1,
                  ...(justSaved
                    ? { background: "#22361f", color: "#5fd29a" }
                    : { background: "#2b2e35", color: "#cfd3da" }),
                }}
              >
                {justSaved ? "Saved ✓" : "Save"}
              </button>
              {/* #284 — the one next-step control: pill · Submit / Approve / Send → · ⋯ */}
              {loadedId && next && (
                <QuoteNextStep
                  quoteId={loadedId}
                  view={next}
                  variant="toolbar"
                  savedOnly={pdfDirty}
                  disabled={statusChanging || tierResolving}
                  beforeAction={pdfDirty ? saveNow : undefined}
                  onSync={(r) => {
                    applySync(r);
                    if (r.ok) {
                      setActionError(null);
                      setGateRefused(false);
                    }
                  }}
                  onError={(m) => {
                    setActionError(m);
                    setGateRefused(false);
                  }}
                />
              )}
              {loadedId && (
                <button
                  type="button"
                  onClick={async () => {
                    const href = `/estimator/cut-sheets?id=${encodeURIComponent(loadedId)}`;
                    if (!pdfDirty) {
                      window.open(href, "_blank", "noopener");
                      return;
                    }
                    // Opened inside the click so it isn't popup-blocked; navigated after the save lands.
                    const w = window.open("", "_blank");
                    const saved = await saveNow();
                    if (!w) return;
                    if (saved === false) w.close();
                    else w.location.href = href;
                  }}
                  style={{ fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 600, color: "#cfd3da", background: "#2b2e35", padding: "9px 14px", borderRadius: 8, border: "none", cursor: "pointer" }}
                >
                  Cut sheets
                </button>
              )}
              <button
                type="button"
                onClick={() => setMode("preview")}
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#16181d",
                  background: "#fff",
                  padding: "9px 16px",
                  borderRadius: 8,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Customer preview →
              </button>
            </div>
            {qdOpen && (
              <div
                ref={qdPanelRef}
                id="est-quote-details"
                className="est-qd est-scroll"
                role="region"
                aria-label="Quote details"
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  zIndex: 30,
                  maxHeight: "min(70vh, 640px)",
                  overflowY: "auto",
                  background: "#23262d",
                  borderTop: "1px solid #2b2e35",
                  borderBottom: "1px solid #2b2e35",
                  boxShadow: "0 12px 28px rgba(0,0,0,.28)",
                  color: "#fff",
                }}
              >
                <div style={META_HEAD}>
                  <span style={{ ...CTX_LABEL, fontWeight: 600 }}>Quote details</span>
                  <button type="button" className="est-qd-done" onClick={closeQd} style={META_TOGGLE}>
                    Done
                  </button>
                </div>
                <div className="est-qd-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                  <div className="est-qd-col">
                  <section style={META_SECTION}>
                    <span style={CTX_LABEL}>Prepared for</span>
                    <select
                      value={customerId || ""}
                      onChange={(e) => pickCustomer(e.target.value)}
                      title="Linked customer — flows to the project when this quote is won"
                      style={{ ...DARK_SELECT, width: "100%", minWidth: 0 }}
                    >
                      {customerOptions.map((o) => (
                        <option key={o.value || "__none"} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    {showVenuePick && (
                      <>
                        <span style={META_SUB}>at</span>
                        <select
                          value={locationId || ""}
                          onChange={(e) => pickVenue(e.target.value)}
                          title="Which of the customer's venues"
                          style={{ ...DARK_SELECT, width: "100%", minWidth: 0 }}
                        >
                          {venueOptions.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                    {showContactPick && (
                      <>
                        <span style={META_SUB}>attn</span>
                        <select
                          value={currentContact ? currentContact.name : ""}
                          onChange={(e) => pickContact(e.target.value)}
                          title="Contact this quote is prepared for"
                          style={{ ...DARK_SELECT, width: "100%", minWidth: 0 }}
                        >
                          {contactOptions.map((o) => (
                            <option key={o.value || "__none"} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                    {wonMetaGuard && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          flexWrap: "wrap",
                          gap: 7,
                          marginTop: 2,
                          padding: "7px 9px",
                          fontSize: 11.5,
                          lineHeight: 1.35,
                          color: "#e3c26e",
                          background: "#3a331d",
                          border: "1px solid #55471f",
                          borderRadius: 7,
                        }}
                      >
                        <span style={{ flex: 1, minWidth: 140 }}>
                          {wonEditMessage(wonMetaGuard.field)}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const run = wonMetaGuard.run;
                            setWonMetaGuard(null);
                            run();
                          }}
                          style={{
                            fontFamily: "var(--font-ui)",
                            fontSize: 11,
                            fontWeight: 600,
                            color: "#16181d",
                            background: "#e3c26e",
                            border: "none",
                            borderRadius: 6,
                            padding: "4px 9px",
                            cursor: "pointer",
                          }}
                        >
                          Change
                        </button>
                        <button
                          type="button"
                          onClick={() => setWonMetaGuard(null)}
                          style={{
                            fontFamily: "var(--font-ui)",
                            fontSize: 11,
                            fontWeight: 600,
                            color: "#e3c26e",
                            background: "transparent",
                            border: "1px solid #55471f",
                            borderRadius: 6,
                            padding: "4px 9px",
                            cursor: "pointer",
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                    <span style={META_SUB}>category</span>
                    <input
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      onBlur={() => {
                        const v = category.trim();
                        if (v !== category) setCategory(v);
                        if (v === categorySaved.current) return;
                        // eslint-disable-next-line react-hooks/immutability -- a ref owned by useEstimatorState; the ref lives there, this handler still writes it
                        categorySaved.current = v;
                        persistMeta({ category: v });
                      }}
                      placeholder="Category"
                      title="Quote category — shown on the Quotes hub"
                      style={{ ...DARK_SELECT, width: "100%", minWidth: 0, cursor: "text" }}
                    />
                  </section>
                  <section style={META_SECTION}>
                    <span style={CTX_LABEL}>Lead estimator</span>
                    <select
                      value={ownerValue}
                      onChange={(e) => changePeople({ owner: e.target.value })}
                      disabled={!loadedId || peopleBusy}
                      aria-label="Lead estimator"
                      title={
                        viewerCanApprove
                          ? "Owns the quote — their review limit applies and it lists under them on the Quotes hub"
                          : "Only an approver can hand a quote to someone else"
                      }
                      style={{ ...DARK_SELECT, width: "100%", minWidth: 0, opacity: loadedId ? 1 : 0.6 }}
                    >
                      {peopleOptions(ownerValue).map((o) => {
                        const locked = !viewerCanApprove && !samePerson(o.value, viewerName) && o.value !== ownerValue;
                        return (
                          <option
                            key={o.value || "__none"}
                            value={o.value}
                            disabled={locked || !o.value}
                            title={locked ? "Only an approver can hand a quote to someone else" : undefined}
                          >
                            {o.label}
                          </option>
                        );
                      })}
                    </select>
                    <span style={{ ...CTX_LABEL, marginTop: 4 }}>Prepared by</span>
                    <select
                      value={preparedValue}
                      onChange={(e) => changePeople({ preparedBy: e.target.value })}
                      disabled={!loadedId || peopleBusy}
                      aria-label="Prepared by"
                      title="Prints under Prepared by on the customer document"
                      style={{ ...DARK_SELECT, width: "100%", minWidth: 0, opacity: loadedId ? 1 : 0.6 }}
                    >
                      {peopleOptions(preparedValue).map((o) => (
                        <option key={o.value || "__none"} value={o.value} disabled={!o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <span style={META_HINT}>
                      {loadedId ? "Saved as you pick" : "Save the quote to change these"}
                    </span>
                  </section>
                  <section style={{ ...META_SECTION, borderBottom: "none" }}>
                    <span style={CTX_LABEL}>Suggested install timeframe</span>
                    <select
                      value={installTimeframe}
                      onChange={(e) => onInstallTimeframe(e.target.value)}
                      aria-label="Suggested install timeframe"
                      style={{ ...DARK_SELECT, width: "100%", minWidth: 0 }}
                    >
                      {INSTALL_TIMEFRAMES.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                    <span style={META_HINT}>Carries to the project goal when this quote is won</span>
                  </section>
                  </div>
                  <div className="est-qd-col">
                  <section style={{ ...META_SECTION, borderBottom: "none" }}>
                    <span style={CTX_LABEL}>Quote note</span>
                    <input
                      className="est-notefield"
                      value={quoteNote}
                      onChange={(e) => onQuoteNote(e.target.value)}
                      placeholder="Cover language printed on the quote header — e.g. Thank you for the opportunity…"
                      style={{
                        width: "100%",
                        minWidth: 0,
                        fontFamily: "var(--font-ui)",
                        fontSize: 12.5,
                        color: "#fff",
                        background: "#2b2e35",
                        border: "1px solid #3a3e46",
                        borderRadius: 7,
                        padding: "8px 11px",
                      }}
                    />
                    <span style={META_HINT}>Shows on the PDF header</span>
                  </section>
                  </div>
                  <div className="est-qd-col">
                  <section style={{ ...META_SECTION, borderBottom: "none" }}>
                    <span style={CTX_LABEL}>Assumptions</span>
                    {assumptionLibrary.length > 0 && (
                      <div style={{ display: "grid", gap: 5 }}>
                        {assumptionLibrary.map((line) => (
                          <label key={line} style={{ display: "flex", alignItems: "flex-start", gap: 7, fontSize: 11.5, color: "#d7dae0", lineHeight: 1.35, cursor: "pointer" }}>
                            <input type="checkbox" checked={checkedAssumptions.has(line)} onChange={() => toggleAssumption(line)} style={{ marginTop: 2 }} />
                            <span>{line}</span>
                          </label>
                        ))}
                      </div>
                    )}
                    <textarea
                      className="est-notefield"
                      value={assumptions}
                      onChange={(e) => onAssumptions(e.target.value)}
                      placeholder="Add quote-specific assumptions, exclusions, and exceptions…"
                      rows={3}
                      style={{ width: "100%", minWidth: 0, resize: "vertical", fontFamily: "var(--font-ui)", fontSize: 12.5, color: "#fff", background: "#2b2e35", border: "1px solid #3a3e46", borderRadius: 7, padding: "8px 11px" }}
                    />
                    <span style={META_HINT}>Company defaults + editable exceptions</span>
                  </section>
                  </div>
                </div>
              </div>
            )}
          </div>

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

          {/* #284 — the next step's note (a send-back note, the limit chip, an
              approval line), always visible; the actions live in the toolbar. */}
          {loadedId && next?.strip && (
            <div style={{ padding: "7px 22px", fontSize: 12.5, color: "#5b616e", background: "#f8f9fb", borderBottom: "1px solid #e4e7ec", flexShrink: 0 }}>
              {next.strip}
            </div>
          )}

          {/* action rejection banner (punch #60: send/won gated server-side) */}
          {actionError && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "9px 22px",
                background: "#fdecea",
                borderBottom: "1px solid #f3c8c2",
                color: "#9a2f22",
                fontSize: 12.5,
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              <span>{actionError}</span>
              {/* #284: the gate refused Sent/Won — offer the way through right here. */}
              {gateRefused && loadedId && next?.primary && next.primary.action !== "approve" && (
                <QuoteNextStep
                  quoteId={loadedId}
                  view={{ ...next, secondary: [], pill: { ...next.pill, label: "" } }}
                  variant="panel"
                  disabled={statusChanging || tierResolving}
                  beforeAction={pdfDirty ? saveNow : undefined}
                  onSync={(r) => {
                    applySync(r);
                    if (r.ok) {
                      setActionError(null);
                      setGateRefused(false);
                    }
                  }}
                  onError={(m) => {
                    setActionError(m);
                    setGateRefused(false);
                  }}
                />
              )}
              <button
                type="button"
                onClick={() => {
                  setActionError(null);
                  setGateRefused(false);
                }}
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "#9a2f22",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: "2px 4px",
                  flexShrink: 0,
                }}
              >
                Dismiss
              </button>
            </div>
          )}

          {/* informational save notice (#180 review 3) — a stale tab's
              status got refreshed, but nothing this save asked for failed */}
          {!actionError && actionNotice && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "9px 22px",
                background: "#eef3fb",
                borderBottom: "1px solid #cddaf0",
                color: "#2b4a7a",
                fontSize: 12.5,
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              <span>{actionNotice}</span>
              <button
                type="button"
                onClick={() => setActionNotice(null)}
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "#2b4a7a",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: "2px 4px",
                  flexShrink: 0,
                }}
              >
                Dismiss
              </button>
            </div>
          )}

          {/* #282 perks+points — the customer's standing purchase perks
              (informational; only the answer for the customer picked now). */}
          {customerId && creditInfo?.customerId === customerId && <PurchasePerksBanner text={creditInfo.purchasePerks} />}

          {/* "Move system" result banner — success links to the target
              estimate without auto-navigating (this estimate may have
              other unsaved edits); failure surfaces the server's reason. */}
          {moveNotice && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "9px 22px",
                background: moveNotice.ok ? "#ecf6f0" : "#fdecea",
                borderBottom: moveNotice.ok ? "1px solid #cce9da" : "1px solid #f3c8c2",
                color: moveNotice.ok ? "#1f7a52" : "#9a2f22",
                fontSize: 12.5,
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              <span>
                {moveNotice.ok && moveNotice.verb === "Loaded" ? (
                  <>{moveNotice.detail}</>
                ) : moveNotice.ok && moveNotice.verb === "Copied" ? (
                  moveNotice.targetId ? (
                    <>
                      Copied to {moveNotice.targetNumber} · {moveNotice.targetName} — {moveNotice.detail} —{" "}
                      <a
                        href={`/estimator?id=${moveNotice.targetId}`}
                        style={{ color: "inherit", textDecoration: "underline" }}
                      >
                        Open {moveNotice.targetName} →
                      </a>
                    </>
                  ) : (
                    <>Copied within this estimate — {moveNotice.detail}</>
                  )
                ) : moveNotice.ok ? (
                  <>
                    Moved to {moveNotice.targetName} ({moveNotice.targetNumber}) —{" "}
                    <a
                      href={`/estimator?id=${moveNotice.targetId}`}
                      style={{ color: "inherit", textDecoration: "underline" }}
                    >
                      Open {moveNotice.targetName} →
                    </a>
                  </>
                ) : (
                  moveNotice.error
                )}
              </span>
              <button
                type="button"
                onClick={() => setMoveNotice(null)}
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "inherit",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: "2px 4px",
                  flexShrink: 0,
                }}
              >
                Dismiss
              </button>
            </div>
          )}

          {/* #254 tier re-price banner — internal only, never on the
              customer document; clears on the next edit or Undo. */}
          {tierReprice && (
            <div
              role="status"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "9px 22px",
                background: "#eef3fb",
                borderBottom: "1px solid #cddaf0",
                color: "#2b4a7a",
                fontSize: 12.5,
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              <span>
                {tierRepriceMessage(tierReprice.repriced, tierReprice.handPriced, tierReprice.label, tierReprice.margin, tierReprice.unsaved)}
                {" · "}
                <button
                  type="button"
                  onClick={undoTierReprice}
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: "inherit",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                    textDecoration: "underline",
                  }}
                >
                  Undo
                </button>
              </span>
              <button
                type="button"
                onClick={() => setTierReprice(null)}
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "inherit",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: "2px 4px",
                  flexShrink: 0,
                }}
              >
                Dismiss
              </button>
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

      {/* ===================== PREVIEW MODE (the saved customer PDF, #222) ===================== */}
      {isPreview && (
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
            onBack={() => setMode("build")}
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
