"use client";

import { withDiscipline } from "@/lib/estimate-output/fields";
import { pointsLabel } from "@/lib/rewards/points";
import { SIDE_TOGGLE } from "../estimator-styles";
import type { EstimatorState } from "../use-estimator-state";
import { RewardCreditPanel } from "../reward-credit-panel";
import { fmt, short, systemSellTotal } from "../pricing";
import { vendorAttachmentLoad } from "../types";
import { ACCENT_INK, ACCENT_SOFT } from "../est-ui";
import SectionCard from "../section-card";
import SystemLibraryModal from "../system-library-modal";
import AiScopeModal from "../ai-scope-modal";
import CurtainModal from "../curtain-modal";
import FixtureModal from "../fixture-modal";
import LaborModal from "../labor-modal";
import TrackModal from "../track-modal";
import VendorQuoteModal from "../vendor-quote-modal";
import { PortalPanel } from "../portal-panel";

/**
 * #305 — Build: the systems sidebar (margin, cost breakdown, Rewards credit),
 * the system cards and every configurator modal. A card's narrative snippet
 * opens the Build package step (onOpenNarrative), where the narrative lives.
 */
export function BuildStep({ s, onOpenNarrative }: { s: EstimatorState; onOpenNarrative: () => void }) {
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
    applyTravelTrip,
    blobUploads,
    canApplyCredit,
    cardRefs,
    closeInput,
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
    moveSystem,
    openCurtainEdit,
    openInput,
    openInputMethod,
    openLaborEdit,
    openTrackEdit,
    openVendorEdit,
    placeLibrarySystem,
    portalStatusError,
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
    setItemSpecKey,
    setLabor,
    setLibraryOpen,
    setMarginAll,
    setMob,
    setMobNameSelect,
    setNarrFocusReq,
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
    sideOpen,
    specKeys,
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
    vendorFormMargin,
    vendorPreviews,
    vendorQuotes,
    vendorSec,
    vendors,
    venueRoomName,
  } = s;

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
                // #281/#305: make this system active, open Build package, focus its narrative there.
                setActiveId(sec.id);
                onOpenNarrative();
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
  );
}
