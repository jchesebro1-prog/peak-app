"use client";

import { Fragment, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { withDiscipline } from "@/lib/estimate-output/fields";
import { GROUPS_MAX } from "@/lib/estimate-groups/groups";
import { canResolve, commentsBySection, numberComments, type NumberedComment } from "@/lib/estimate-review/comments";
import { pointsLabel } from "@/lib/rewards/points";
import { SIDE_TOGGLE } from "../estimator-styles";
import type { EstimatorState } from "../use-estimator-state";
import { RewardCreditPanel } from "../reward-credit-panel";
import { linesForSku, ProjectDiscountsCard } from "../project-discounts-card";
import { fmt, short, systemSellTotal } from "../pricing";
import { vendorAttachmentLoad } from "../types";
import { ACCENT_INK, ACCENT_SOFT } from "../est-ui";
import SectionCard from "../section-card";
import MoveLinesBar from "../move-lines-bar";
import { isMovableLine, lineRefKey, parseLineRefKey, type LineRef } from "@/lib/estimate-line-move/move";
import { CommentPin, useCommentsFocusRefresh, useResolveComment } from "../comment-pins";
import SystemLibraryModal from "../system-library-modal";
import AiScopeModal from "../ai-scope-modal";
import CurtainModal from "../curtain-modal";
import FixtureModal from "../fixture-modal";
import AddSystemModal from "../add-system-modal";
import LaborModal from "../labor-modal";
import TrackModal from "../track-modal";
import VendorQuoteModal from "../vendor-quote-modal";
import { ReadPdfButton, VendorPdfPanel } from "../vendor-pdf-panel";
import { vendorPdfLineHints } from "@/lib/vendor-pdf/fill";
import { isPdfAttachment } from "@/lib/vendor-quotes/rules";
import { PortalPanel } from "../portal-panel";
import { AssistDraftBanner } from "../assist-draft-banner";
import { RepriceBanner } from "../reprice-banner";
import { SuggestedBomPanel } from "../suggested-bom-panel";
import { bonusNotFigured, bonusRulesApply } from "@/lib/estimate-bonus/rules";
import type { SuggestionParts } from "@/lib/assist/features/suggestion-panel";
import { boxSaleLaborBanner } from "@/lib/estimate-box-sale/rules";
import { REVISE_FIRST, repriceLocked } from "@/lib/estimate-reprice/lock";

/**
 * #305 — Build: the systems sidebar (markup, cost breakdown, Rewards credit),
 * the system cards and every configurator modal. A card's narrative snippet
 * opens the Build package step (onOpenNarrative), where the narrative lives.
 */
const NO_COMMENTS: NumberedComment[] = [];
const NO_PARTS: SuggestionParts = {};

export function BuildStep({ s, onOpenNarrative, presentationHref, onOpenPresentation }: {
  s: EstimatorState;
  onOpenNarrative: () => void;
  /** #333 (Q4): the card's read-only presentation chip opens Build package → Client package → Systems. */
  presentationHref: string;
  onOpenPresentation: () => void;
}) {
  /** Phase 2a: the rail group whose name is being edited (a new group opens in rename). */
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const {
    activeId,
    addGroupForSystem,
    blocks,
    groups,
    isBuilt,
    markBuilt,
    setGroupAlternateAction,
    setSystemGroup,
    addAiLine,
    addCurtain,
    addCustomPart,
    addFixture,
    addLabor,
    addMob,
    addPart,
    addSystemFromCategory,
    addSystemOpen,
    setAddSystemOpen,
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
    applyTravelTrip,
    blobUploads,
    canApplyCredit,
    cardRefs,
    closeInput,
    confirmDiscardInput,
    cols,
    commitVendorQuote,
    copySystem,
    creditInfo,
    curtainDraft,
    curtainEdit,
    curtainFor,
    curtainSec,
    curtainSewingPct,
    curtainTrack,
    customDraft,
    customEdit,
    customError,
    dec,
    deleteSystem,
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
    isExpanded,
    isInternal,
    isOpenFor,
    laborDraft,
    laborEdit,
    laborFor,
    laborSec,
    libraryOpen,
    loadVendorLines,
    loadedId,
    moveItem,
    moveLinesHere,
    moveLinesToEstimate,
    movingLines,
    moveNotice,
    moveSystem,
    openCurtainEdit,
    openCustomEdit,
    openInput,
    openInputMethod,
    openLaborEdit,
    openTrackEdit,
    openVendorEdit,
    placeLibrarySystem,
    portalStatusError,
    assistDraft,
    repricedOnRevise,
    projectDiscounts,
    rate,
    removeCredit,
    removeProjectDiscount,
    setProjectDiscount,
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
    setActiveId,
    setAiOpen,
    setAutoHrs,
    setCurtainField,
    setCurtainTrack,
    setCustomField,
    setFixture,
    setFixtureAssembly,
    setFixtureComponentQty,
    setFreightPct,
    setItemExtSell,
    setItemPrice,
    setLabor,
    setLibraryOpen,
    setMarkupAll,
    setMob,
    setMobNameSelect,
    setNarrFocusReq,
    setQty,
    setSystemMarkup,
    setSystemRoom,
    setSystemSell,
    setTrackDraft,
    setTripLocal,
    setVendorDisplay,
    setVendorField,
    setVendorLine,
    sideOpen,
    status,
    t,
    tierMargin,
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
    vendorFormMarkup,
    vendorHandoff,
    vendorPdf,
    vendorPdfEnabled,
    readVendorPdf,
    retargetVendor,
    setVendorCompany,
    vendorPreviews,
    vendorQuotes,
    vendorSec,
    vendors,
    venueRoomName,
  } = s;
  // Estimator bonuses: "Bonus not figured — check line costs" only where the rules apply.
  const bonusOn = bonusRulesApply({ source: initial.bonusSource, quoteType: initial.bonusQuoteType, status }, sections);
  // #368: a sent / won / lost estimate keeps its prices until revised. Load system and Copy within are refused by the
  // server too; the track / curtain / labor configurators are a UI lock only (lock.ts says what is server-enforced).
  const uiRepriceLock = repriceLocked(status) ? REVISE_FIRST : undefined;
  /* Phase 4 — open review comments pinned to the systems (the shared list is loaded by the hook). */
  const pinned = useMemo(
    () => commentsBySection(numberComments(s.reviewComments, sections), sections.map((x) => x.id)),
    [s.reviewComments, sections]
  );
  const mayResolveComments = canResolve(s.viewerRoles, {});
  const resolveComment = useResolveComment(s);
  useCommentsFocusRefresh(s);
  /* #348 slice 5: Read the PDF — only for a user the server gate passed, and only on a PDF attachment. */
  const readPdf = vendorPdfEnabled && !!vendorDraft.attachment && isPdfAttachment(vendorDraft.attachment);

  /* #357: ticked lines and a row's ⇄ feed the Move bar. Build unmounts on a step
     change (estimator-client renders one step at a time), which clears both; a line
     that no longer exists (deleted, moved away) simply drops out of liveSelected.
     Item ids are unique per SYSTEM only (Copy/Move system keeps them), so a tick is
     keyed "<sectionId>:<id>" (lineRefKey) — never the bare id. */
  const [selectedLines, setSelectedLines] = useState<Set<string>>(() => new Set());
  const [rowMove, setRowMove] = useState<LineRef | null>(null);
  // Another quote loaded into this same screen: its line ids are not ours. (null → id is a first save — keep the ticks.)
  const [selQuote, setSelQuote] = useState(loadedId);
  if (selQuote !== loadedId) {
    setSelQuote(loadedId);
    if (selQuote) {
      setSelectedLines(new Set());
      setRowMove(null);
    }
  }
  // A built (collapsed) system shows no rows, so its lines can't be ticked — and a tick made before it was marked built no longer counts.
  const movableKeys = useMemo(
    () => new Set(sections.filter((x) => x.built !== true).flatMap((x) => x.items.filter(isMovableLine).map((it) => lineRefKey({ sectionId: x.id, id: it.id })))),
    [sections]
  );
  const liveSelected = useMemo(() => [...selectedLines].filter((k) => movableKeys.has(k)), [selectedLines, movableKeys]);
  /** Each system's own ticked line ids — so ticking A:105 never ticks C:105. */
  const selectedBySection = useMemo(() => {
    const m = new Map<string, Set<number>>();
    for (const k of liveSelected) {
      const r = parseLineRefKey(k);
      if (!r) continue;
      const set = m.get(r.sectionId) || new Set<number>();
      set.add(r.id);
      m.set(r.sectionId, set);
    }
    return m;
  }, [liveSelected]);
  const toggleLine = (ref: LineRef) =>
    setSelectedLines((cur) => {
      const k = lineRefKey(ref);
      const n = new Set(cur);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  // A successful move takes its lines away (out of the estimate, or a ⇄ line already
  // moved): drop the ids that left and end row mode, so the bar closes cleanly.
  // (Adjusted during render, like selQuote above.)
  if (rowMove != null && !movableKeys.has(lineRefKey(rowMove))) setRowMove(null);
  if (liveSelected.length !== selectedLines.size) setSelectedLines(new Set(liveSelected));
  const rowLive = rowMove != null && movableKeys.has(lineRefKey(rowMove));
  const barLines: LineRef[] = useMemo(
    () => (rowLive && rowMove ? [rowMove] : liveSelected.map(parseLineRefKey).filter((r): r is LineRef => !!r)),
    [rowLive, rowMove, liveSelected]
  );

  return (
    <div
      data-screen-label="Estimator workspace"
      className="est-screen"
      style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
    >
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
            <SystemsRail s={s} editingGroupId={editingGroupId} setEditingGroupId={setEditingGroupId} />

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
                  Markup · all systems
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: ACCENT_INK,
                  }}
                >
                  {Math.round(t.markup * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={125}
                value={Math.round(t.markup * 100)}
                onChange={(e) => setMarkupAll(e.target.value)}
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
              {(t.alt ?? 0) > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginTop: 7, color: "#8c919c" }}>
                  <span>Alternates (not in total)</span>
                  <span style={{ fontFamily: "var(--font-mono)" }}>{fmt(t.alt ?? 0)}</span>
                </div>
              )}
              {(t.credit || 0) > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginTop: 7, color: "#1f8a5b", fontWeight: 600 }}>
                  <span>Rewards credit · {pointsLabel(t.credit || 0)}</span>
                  <span style={{ fontFamily: "var(--font-mono)" }}>−{fmt(t.credit || 0)}</span>
                </div>
              )}
            </div>

            {/* #366: project discounts — internal (staff view only); hidden when nothing on the estimate could carry one. */}
            {isInternal && (
              <ProjectDiscountsCard sections={sections} discounts={projectDiscounts} onSet={setProjectDiscount} onRemove={removeProjectDiscount} />
            )}

            <RewardCreditPanel
              info={creditInfo}
              applied={appliedCredit}
              preCreditTotal={t.grand + (t.credit || 0)}
              editable={canApplyCredit && (status === "draft" || status === "sent")}
              hasSystems={sections.length > 0}
              onApply={applyCredit}
              onRemove={removeCredit}
            />
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
          <AssistDraftBanner view={assistDraft} />
          {/* #368: a Revise re-priced lines to today's catalog — shown while the estimate is that revise's draft. */}
          <RepriceBanner view={repricedOnRevise} quoteId={loadedId} show={status === "draft"} />
          {/* Box goods sale (spec 2026-10-21): turning it on with labor is allowed — Save stays refused until it's gone. */}
          {s.boxSaleLabor.length > 0 && (
            <div
              role="alert"
              data-testid="box-sale-labor"
              style={{ margin: "0 0 12px", padding: "10px 14px", fontSize: 12.5, lineHeight: 1.45, color: "#9b3a2a", background: "#fdf0ee", border: "1px solid #f3cfc7", borderRadius: 10 }}
            >
              {boxSaleLaborBanner(s.boxSaleLabor)}
            </div>
          )}
          {initial.portal && <PortalPanel data={initial.portal} statusError={portalStatusError} />}
          {pinned.whole.length > 0 && (
            <div style={{ margin: "0 0 12px" }}>
              <CommentPin
                label={`💬 ${pinned.whole.length} on the whole estimate`}
                system="the whole estimate"
                comments={pinned.whole}
                mayResolve={mayResolveComments}
                onResolve={resolveComment}
              />
            </div>
          )}
          {/* Phase 2a: cards stack in `blocks` order (= the stored order) with a divider per group. */}
          {blocks.map((b, bi) => {
            const first = blocks.slice(0, bi).reduce((n, x) => n + x.sections.length, 0);
            const groupId = b.group?.id ?? null;
            return (
              <div key={b.group ? b.group.id : "ungrouped"}>
                {b.group && (
                  <div
                    className="est-group-divider"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      margin: bi === 0 ? "2px 4px 12px" : "22px 4px 12px",
                      paddingBottom: 7,
                      borderBottom: "1px solid #e4e7ec",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11.5,
                        fontWeight: 700,
                        color: "#5b616e",
                        letterSpacing: ".06em",
                        textTransform: "uppercase",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        minWidth: 0,
                      }}
                    >
                      {b.group.name}
                      {b.group.alternate && <span style={ALT_SUFFIX}>{ALT_HEADING_SUFFIX}</span>}
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                      <AlternateToggle
                        alternate={b.group.alternate}
                        groupName={b.group.name}
                        onChange={(alternate) => {
                          if (groupId) setGroupAlternateAction(groupId, alternate);
                        }}
                      />
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 600, color: "#3a3f4a", flexShrink: 0 }}>
                        {fmt(blockSell(b.sections))}
                      </span>
                    </span>
                  </div>
                )}
                {b.sections.map((sec, j) => (
                  <SectionCard
                    key={sec.id}
                    sec={sec}
                    index={first + j}
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
                    comments={pinned.bySection[sec.id] || NO_COMMENTS}
                    canResolveComments={mayResolveComments}
                    onResolveComment={resolveComment}
                    onEditNarrative={() => {
                      // #281/#305: make this system active, open Build package, focus its narrative there.
                      setActiveId(sec.id);
                      onOpenNarrative();
                      setNarrFocusReq((n) => n + 1);
                    }}
                    onActivate={() => setActiveId(sec.id)}
                    onSetRoom={(value) => setSystemRoom(sec.id, value)}
                    defaultRoom={venueRoomName}
                    presentationHref={presentationHref}
                    onOpenPresentation={onOpenPresentation}
                    onSetDiscipline={(value) => updateSection(sec.id, (s) => withDiscipline(s, value))}
                    onDelete={() => deleteSystem(sec.id)}
                    onSetMarkup={(v) => setSystemMarkup(sec.id, v)}
                    onSetSell={(v) => setSystemSell(sec.id, v)}
                    onResetSell={() => resetSystemSell(sec.id)}
                    onRoundPrice={() => roundSystemPrice(sec.id)}
                    onSetFreight={(v) => setFreightPct(sec.id, v)}
                    freightUnknown={freightDefault.unknown}
                    bonusNotFigured={bonusOn && bonusNotFigured(sec)}
                    onInc={inc}
                    onDec={dec}
                    onSetQty={setQty}
                    onSetPrice={setItemPrice}
                    onSetExtSell={setItemExtSell}
                    onMoveItem={(itemId, direction) => moveItem(sec.id, itemId, direction)}
                    selectedLines={isInternal ? selectedBySection.get(sec.id) : undefined}
                    onToggleLineSelected={isInternal ? (itemId) => toggleLine({ sectionId: sec.id, id: itemId }) : undefined}
                    onMoveLine={isInternal ? (itemId) => setRowMove({ sectionId: sec.id, id: itemId }) : undefined}
                    // While an estimate move runs, no tick or ⇄ may remount the waiting bar — kept in place, disabled.
                    lineSelectDisabled={movingLines}
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
                    onEditCustom={(lineId) => openCustomEdit(sec.id, lineId)}
                    uiRepriceLock={uiRepriceLock}
                    customEditing={!!customEdit}
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
                    groups={groups}
                    groupId={sec.groupId ?? null}
                    onSetGroup={(groupId) => setSystemGroup(sec.id, groupId)}
                    onNewGroup={() => {
                      const id = addGroupForSystem(sec.id);
                      if (!id) return;
                      // Focus the new group's name in the rail (open the rail if it's hidden).
                      setEditingGroupId(id);
                      if (!sideOpen) toggleSide();
                    }}
                    built={isBuilt(sec.id)}
                    onMarkBuilt={() => markBuilt(sec.id)}
                    boxSale={s.boxSale}
                    {...(isInternal
                      ? {
                          projectDiscounts,
                          onSetProjectDiscount: setProjectDiscount,
                          onRemoveProjectDiscount: removeProjectDiscount,
                          projectDiscountLines: (sku: string) => linesForSku(sections, sku),
                        }
                      : {})}
                  />
                ))}
              </div>
            );
          })}

          <button
            type="button"
            className="est-addsys"
            onClick={() => setAddSystemOpen(true)}
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
            disabled={!!uiRepriceLock}
            title={uiRepriceLock || "Load a system from a sent or won estimate — re-priced for this one"}
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
              cursor: uiRepriceLock ? "not-allowed" : "pointer",
              opacity: uiRepriceLock ? 0.55 : 1,
            }}
          >
            + From library…
          </button>
          {isInternal && barLines.length > 0 && (
            <MoveLinesBar
              key={rowLive && rowMove ? "row-" + lineRefKey(rowMove) : "ticks"}
              sections={sections}
              groups={groups}
              lines={barLines}
              single={rowLive}
              openMenu={rowLive}
              moving={movingLines}
              onClear={() => {
                if (rowLive) setRowMove(null);
                else {
                  setSelectedLines(new Set());
                  setRowMove(null);
                }
              }}
              onMoveHere={(t) => moveLinesHere(barLines, t)}
              onMoveToEstimate={(d) => moveLinesToEstimate(barLines, d)}
              searchQuotes={searchQuotes}
              moveError={moveNotice && !moveNotice.ok ? moveNotice.error : undefined}
            />
          )}
          {addSystemOpen && (
            <AddSystemModal
              categories={initial.systemCategories}
              onBlank={() => {
                setAddSystemOpen(false);
                addSystem();
              }}
              onAdd={addSystemFromCategory}
              onClose={() => setAddSystemOpen(false)}
            />
          )}
          {libraryOpen && (
            <SystemLibraryModal mode="load" tierMargin={tierMargin} quoteId={loadedId} onLoaded={placeLibrarySystem} onClose={() => setLibraryOpen(false)} />
          )}
        </div>

        {/* Estimate suggestion (spec 2026-10-13 §2): the Suggested BOM column, beside the system cards. */}
        {s.suggestion && (
          <SuggestedBomPanel
            view={s.suggestion}
            parts={s.suggestionParts ?? NO_PARTS}
            added={s.suggestionAdded}
            sections={sections}
            open={s.suggestOpen}
            onToggle={s.toggleSuggestOpen}
            targetFor={s.suggestionTargetFor}
            onAddSystem={s.addSuggestedSystem}
            onAddLine={s.addSuggestedLine}
          />
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
          confirmClose={confirmDiscardInput}
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
          confirmClose={confirmDiscardInput}
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
          confirmClose={confirmDiscardInput}
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
          confirmClose={confirmDiscardInput}
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
          markup={vendorFormMarkup}
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
          confirmClose={confirmDiscardInput}
          /* #348 slice 4: the vendor company picker (typed name as the fallback) and the email hand-off. */
          onPickVendor={(c) => setVendorCompany(c)}
          onTypedVendor={(name) => setVendorField("vendor", name)}
          onUnlinkVendor={() => setVendorCompany(null)}
          handoff={vendorHandoff}
          systems={sections.map((sec) => ({ id: sec.id, name: sec.name }))}
          systemId={vendorFor}
          onPickSystem={retargetVendor}
          /* #348 slice 5: Read the PDF (pilot users with a Claude key; PDFs only) — the file-row button, the
             results panel, the per-line hints, and Add waiting while it reads. */
          fileActions={readPdf ? <ReadPdfButton busy={vendorPdf.busy} onRead={() => void readVendorPdf(false)} /> : undefined}
          readPanel={readPdf ? <VendorPdfPanel draft={vendorDraft} state={vendorPdf} onTryHarder={() => void readVendorPdf(true)} /> : undefined}
          lineHints={readPdf ? vendorPdfLineHints(vendorDraft) : undefined}
          reading={readPdf && !!vendorPdf.busy}
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
  );
}

/** Phase 2a: a group's subtotal — the sum of its systems' sell. */
function blockSell(secs: EstimatorState["sections"]): number {
  return secs.reduce((n, sec) => n + systemSellTotal(sec), 0);
}

/** Where a rail drag is hovering: a system row (insert before it), a group heading (append), or the Ungrouped zone. */
type RailDrop = { kind: "row"; id: string } | { kind: "group"; id: string } | { kind: "ungrouped" } | null;

const RAIL_BTN: CSSProperties = {
  width: 18,
  height: 18,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "none",
  background: "transparent",
  borderRadius: 4,
  color: "#aab0bb",
  fontSize: 11,
  lineHeight: 1,
  cursor: "pointer",
  padding: 0,
  flexShrink: 0,
};

const RAIL_HEAD: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  color: "#5b616e",
  letterSpacing: ".05em",
  textTransform: "uppercase",
};

/** Phase 2b: an Alternate group's heading suffix (rail and card divider). */
const ALT_HEADING_SUFFIX = "Alternate · not in total";
const ALT_SUFFIX: CSSProperties = {
  marginLeft: 8,
  fontWeight: 600,
  letterSpacing: 0,
  textTransform: "none",
  color: ACCENT_INK,
};

/**
 * Phase 2b — a group's In total | Alternate switch: two small segmented
 * buttons, the active one accented. An Alternate group is priced on its own
 * and never counts toward the estimate total.
 */
function AlternateToggle({ alternate, groupName, onChange }: { alternate: boolean; groupName: string; onChange: (alternate: boolean) => void }) {
  const seg = (on: boolean, first: boolean): CSSProperties => ({
    fontFamily: "var(--font-ui)",
    fontSize: 10.5,
    fontWeight: 600,
    lineHeight: 1.2,
    padding: "2px 7px",
    cursor: on ? "default" : "pointer",
    border: "1px solid " + (on ? "var(--accent)" : "#e4e7ec"),
    background: on ? ACCENT_SOFT : "#fff",
    color: on ? ACCENT_INK : "#6b7079",
    borderRadius: first ? "5px 0 0 5px" : "0 5px 5px 0",
    marginLeft: first ? 0 : -1,
    position: "relative",
    zIndex: on ? 1 : 0,
  });
  return (
    <span role="group" aria-label={`${groupName}: in total or alternate`} style={{ display: "inline-flex", flexShrink: 0 }}>
      <button type="button" aria-pressed={!alternate} onClick={() => alternate && onChange(false)} style={seg(!alternate, true)}>
        In total
      </button>
      <button type="button" aria-pressed={alternate} onClick={() => !alternate && onChange(true)} style={seg(alternate, false)}>
        Alternate
      </button>
    </span>
  );
}

/**
 * Phase 2a — the Build rail: systems under group headings, HTML5 drag (the
 * board's house pattern: draggable rows, dataTransfer "text/plain", onDragOver
 * preventDefault, onDrop reads the id) plus ↑/↓ buttons as the keyboard path.
 * Drop on a row → insert before it and join its group; on a heading → append to
 * that group; on Ungrouped → ungroup. Every move goes through the hook's pure rules.
 */
function SystemsRail({
  s,
  editingGroupId,
  setEditingGroupId,
}: {
  s: EstimatorState;
  editingGroupId: string | null;
  setEditingGroupId: (id: string | null) => void;
}) {
  const {
    activeId,
    addGroupAction,
    setAddSystemOpen,
    blocks,
    groups,
    isBuilt,
    moveGroupByAction,
    moveSystemByAction,
    moveSystemToAction,
    removeGroupAction,
    renameGroupAction,
    sections,
    selectSystem,
    setGroupAlternateAction,
    toggleSide,
  } = s;
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<RailDrop>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  /** Escape cancels a rename; the blur that follows must not commit it. */
  const renameCancelled = useRef(false);

  const sameDrop = (a: RailDrop, b: RailDrop) =>
    a === b || (!!a && !!b && a.kind === b.kind && (a.kind === "ungrouped" || (b.kind !== "ungrouped" && a.id === b.id)));
  const over = (target: Exclude<RailDrop, null>) => (e: DragEvent<HTMLElement>) => {
    if (!dragId) return; // only rail drags (files, text) are not ours
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    if (!sameDrop(drop, target)) setDrop(target);
  };
  const leave = (target: Exclude<RailDrop, null>) => (e: DragEvent<HTMLElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    if (sameDrop(drop, target)) setDrop(null);
  };
  const dropOn = (target: { groupId: string | null; beforeId: string | null }) => (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const id = dragId || e.dataTransfer.getData("text/plain");
    setDragId(null);
    setDrop(null);
    if (id && sections.some((x) => x.id === id)) moveSystemToAction(id, target);
  };
  const endDrag = () => {
    setDragId(null);
    setDrop(null);
  };

  const startRename = (id: string) => {
    renameCancelled.current = false;
    setConfirmDeleteId(null);
    setEditingGroupId(id);
  };
  const commitRename = (id: string, value: string) => {
    if (renameCancelled.current) {
      renameCancelled.current = false;
      return;
    }
    renameGroupAction(id, value);
    setEditingGroupId(null);
  };

  const lastGroupId = groups.length ? groups[groups.length - 1].id : null;
  const firstId = sections[0]?.id;
  const lastId = sections[sections.length - 1]?.id;

  const groupHeading = (g: (typeof groups)[number], gi: number, secs: EstimatorState["sections"]) => {
    const hot = drop?.kind === "group" && drop.id === g.id;
    const editing = editingGroupId === g.id;
    return (
      <div key={"h-" + g.id} style={{ marginTop: 10, marginBottom: 3 }}>
        <div
          className="est-rail-group"
          onDragOver={over({ kind: "group", id: g.id })}
          onDragLeave={leave({ kind: "group", id: g.id })}
          onDrop={dropOn({ groupId: g.id, beforeId: null })}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "5px 6px 5px 8px",
            borderRadius: 7,
            background: "#f7f8fa",
            outline: hot ? "2px solid var(--accent)" : "none",
            outlineOffset: -2,
          }}
        >
          {editing ? (
            <input
              autoFocus
              defaultValue={g.name}
              maxLength={80}
              aria-label="Group name"
              onFocus={(e) => {
                renameCancelled.current = false;
                e.currentTarget.select();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitRename(g.id, e.currentTarget.value);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  renameCancelled.current = true;
                  setEditingGroupId(null);
                }
              }}
              onBlur={(e) => commitRename(g.id, e.currentTarget.value)}
              style={{
                flex: 1,
                minWidth: 0,
                fontFamily: "var(--font-ui)",
                fontSize: 12,
                fontWeight: 600,
                color: "#16181d",
                border: "1px solid #c4c9d2",
                borderRadius: 5,
                padding: "2px 5px",
                background: "#fff",
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => startRename(g.id)}
              title="Rename group"
              style={{
                ...RAIL_HEAD,
                flex: 1,
                minWidth: 0,
                textAlign: "left",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                border: "none",
                background: "transparent",
                cursor: "text",
                padding: 0,
                fontFamily: "var(--font-ui)",
              }}
            >
              {g.name}
            </button>
          )}
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#6b7079", flexShrink: 0 }}>{short(blockSell(secs))}</span>
          <button
            type="button"
            className="est-action-btn"
            aria-label={`Move group ${g.name} up`}
            title="Move group up"
            disabled={gi === 0}
            onClick={() => moveGroupByAction(g.id, -1)}
            style={{ ...RAIL_BTN, opacity: gi === 0 ? 0.35 : 1, cursor: gi === 0 ? "default" : "pointer" }}
          >
            ↑
          </button>
          <button
            type="button"
            className="est-action-btn"
            aria-label={`Move group ${g.name} down`}
            title="Move group down"
            disabled={gi === groups.length - 1}
            onClick={() => moveGroupByAction(g.id, 1)}
            style={{ ...RAIL_BTN, opacity: gi === groups.length - 1 ? 0.35 : 1, cursor: gi === groups.length - 1 ? "default" : "pointer" }}
          >
            ↓
          </button>
          <button
            type="button"
            className="est-action-btn est-x"
            aria-label={`Delete group ${g.name}`}
            title="Delete group"
            onClick={() => setConfirmDeleteId(confirmDeleteId === g.id ? null : g.id)}
            style={RAIL_BTN}
          >
            ×
          </button>
        </div>
        {/* Phase 2b: In total / Alternate on its own line (the rail is 262px). */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 6px 0 8px" }}>
          {g.alternate && <span style={{ ...ALT_SUFFIX, marginLeft: 0, fontSize: 10.5 }}>{ALT_HEADING_SUFFIX}</span>}
          <span style={{ marginLeft: "auto" }}>
            <AlternateToggle alternate={g.alternate} groupName={g.name} onChange={(alternate) => setGroupAlternateAction(g.id, alternate)} />
          </span>
        </div>
        {/* Inline confirm — no browser dialog. */}
        {confirmDeleteId === g.id && (
          <div style={{ margin: "4px 2px 2px", padding: "7px 9px", background: "#fdf3f1", border: "1px solid #f1d6d0", borderRadius: 7, fontSize: 11.5, color: "#5b616e" }}>
            Delete group? Systems stay, ungrouped.
            <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
              <button
                type="button"
                onClick={() => {
                  setConfirmDeleteId(null);
                  if (editingGroupId === g.id) setEditingGroupId(null);
                  removeGroupAction(g.id);
                }}
                style={{ fontSize: 11.5, fontWeight: 600, color: "#c0392b", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                style={{ fontSize: 11.5, fontWeight: 600, color: "#5b616e", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const systemRow = (sec: EstimatorState["sections"][number]) => {
    const sub = systemSellTotal(sec);
    const active = activeId === sec.id;
    const built = isBuilt(sec.id);
    const hot = drop?.kind === "row" && drop.id === sec.id && dragId !== sec.id;
    const label = sec.name
      .split(" — ")[0]
      .split(" & ")[0]
      .replace("Motorized Hoists", "Hoists");
    const name = label || "Untitled";
    // ↑ at the very top / ↓ at the very bottom has nowhere to go (moveSystemBy would return the same order).
    const atTop = sec.id === firstId && !sec.groupId;
    const atBottom = sec.id === lastId && (groups.length === 0 || sec.groupId === lastGroupId);
    return (
      <div
        key={sec.id}
        className="est-rail-row"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", sec.id);
          e.dataTransfer.effectAllowed = "move";
          setDragId(sec.id);
        }}
        onDragEnd={endDrag}
        onDragOver={over({ kind: "row", id: sec.id })}
        onDragLeave={leave({ kind: "row", id: sec.id })}
        onDrop={dropOn({ groupId: sec.groupId ?? null, beforeId: sec.id })}
        onClick={() => selectSystem(sec.id)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: active ? "8px 6px 8px 3px" : "8px 6px",
          borderRadius: 9,
          marginBottom: 3,
          cursor: "pointer",
          background: active ? ACCENT_SOFT : "transparent",
          borderLeft: active ? "3px solid var(--accent)" : undefined,
          boxShadow: hot ? "0 -2px 0 0 var(--accent)" : undefined,
          opacity: dragId === sec.id ? 0.5 : 1,
        }}
      >
        <span aria-hidden="true" title="Drag to reorder" style={{ color: "#c4c9d2", fontSize: 11, letterSpacing: "-2px", cursor: "grab", flexShrink: 0, userSelect: "none" }}>
          ⋮⋮
        </span>
        <button
          type="button"
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            border: "none",
            background: "transparent",
            padding: 0,
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
            {built && (
              <span title="Built" style={{ color: "#1f8a5b", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                ✓
              </span>
            )}
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
              {name}
            </span>
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
        <button
          type="button"
          className="est-action-btn"
          aria-label={`Move ${name} up`}
          disabled={atTop}
          onClick={(e) => {
            e.stopPropagation();
            moveSystemByAction(sec.id, -1);
          }}
          style={{ ...RAIL_BTN, opacity: atTop ? 0.35 : 1, cursor: atTop ? "default" : "pointer" }}
        >
          ↑
        </button>
        <button
          type="button"
          className="est-action-btn"
          aria-label={`Move ${name} down`}
          disabled={atBottom}
          onClick={(e) => {
            e.stopPropagation();
            moveSystemByAction(sec.id, 1);
          }}
          style={{ ...RAIL_BTN, opacity: atBottom ? 0.35 : 1, cursor: atBottom ? "default" : "pointer" }}
        >
          ↓
        </button>
      </div>
    );
  };

  const ungrouped = blocks.find((b) => b.group === null)?.sections ?? [];
  const ungroupedHot = drop?.kind === "ungrouped";

  return (
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
            onClick={() => setAddSystemOpen(true)}
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
      {/* The Ungrouped zone shows only once there are groups — and stays a drop target even when empty. */}
      {groups.length > 0 && (
        <div
          className="est-rail-ungrouped"
          onDragOver={over({ kind: "ungrouped" })}
          onDragLeave={leave({ kind: "ungrouped" })}
          onDrop={dropOn({ groupId: null, beforeId: null })}
          style={{
            ...RAIL_HEAD,
            color: "#9aa0ab",
            padding: ungrouped.length ? "5px 8px" : "9px 8px",
            marginBottom: 3,
            borderRadius: 7,
            border: ungrouped.length ? "1px solid transparent" : "1px dashed #e4e7ec",
            outline: ungroupedHot ? "2px solid var(--accent)" : "none",
            outlineOffset: -2,
          }}
        >
          Ungrouped
        </div>
      )}
      {blocks.map((b) =>
        b.group === null ? (
          <Fragment key="ungrouped">{b.sections.map(systemRow)}</Fragment>
        ) : (
          <div key={b.group.id}>
            {groupHeading(b.group, groups.findIndex((g) => g.id === b.group?.id), b.sections)}
            {b.sections.map(systemRow)}
          </div>
        ),
      )}
      <button
        type="button"
        onClick={() => {
          const id = addGroupAction();
          if (id) startRename(id);
        }}
        disabled={groups.length >= GROUPS_MAX}
        title={groups.length >= GROUPS_MAX ? "At most 20 groups" : "Add a group heading"}
        style={{
          marginTop: 8,
          marginLeft: 6,
          fontSize: 11,
          fontWeight: 600,
          color: groups.length >= GROUPS_MAX ? "#c4c9d2" : "var(--accent)",
          background: "transparent",
          border: "none",
          cursor: groups.length >= GROUPS_MAX ? "default" : "pointer",
          padding: 0,
        }}
      >
        + Add group
      </button>
    </div>
  );
}
