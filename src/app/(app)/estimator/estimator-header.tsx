"use client";

import { CTX_LABEL, DARK_SELECT, META_HEAD, META_HINT, META_SECTION, META_SUB, META_TOGGLE, STATUS_DOT, STATUS_LABEL } from "./estimator-styles";
import { INSTALL_TIMEFRAMES, type EstimatorState } from "./use-estimator-state";
import type { NextStepAction } from "@/lib/quote-next-step";
import { QuoteNextStep } from "@/components/quote-review/quote-next-step";
import { wonEditMessage } from "@/app/(app)/quotes/new/handoff";
import { fmt } from "./pricing";
import type { EstimateStep } from "@/lib/estimate-steps/steps";
import { HeaderMoreMenu } from "./header-more-menu";

/**
 * #305 (spec 2026-10-07 §4) — the Estimator's one header, shown on every
 * step: inline rename, number · Rev, the Quote details panel, blended margin,
 * quoted total, status (read-only — set on Send & track), Save, the next-step control and the ⋯ menu. Wraps
 * onto a second row instead of overflowing on a narrow window.
 */
export function EstimatorHeader({ s, onActed, onStep }: { s: EstimatorState; onActed: (action: NextStepAction) => void; onStep: (to: EstimateStep) => void }) {
  const {
    applySync,
    assumptionLibrary,
    assumptions,
    category,
    changePeople,
    checkedAssumptions,
    closeQd,
    closeTitle,
    commitCategory,
    contactOptions,
    currentContact,
    customerId,
    customerOptions,
    doSave,
    installTimeframe,
    justSaved,
    loadedId,
    locationId,
    next,
    onAssumptions,
    onInstallTimeframe,
    onQuoteNote,
    openTitle,
    ownerValue,
    pdfDirty,
    peopleBusy,
    peopleOptions,
    pickContact,
    pickCustomer,
    pickVenue,
    preparedValue,
    projectName,
    qdChipLabel,
    qdChipRef,
    qdOpen,
    qdPanelRef,
    quoteId,
    quoteNote,
    revNum,
    samePerson,
    saveNow,
    setActionError,
    setCategory,
    setGateRefused,
    setQdOpen,
    setTitleDraft,
    setWonMetaGuard,
    showContactPick,
    showVenuePick,
    status,
    statusChanging,
    t,
    tierResolving,
    titleDraft,
    titleEditing,
    toggleAssumption,
    venueOptions,
    viewerCanApprove,
    viewerName,
    wonMetaGuard,
  } = s;
  return (
      <div
        className="est-topbar"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 18,
          flexWrap: "wrap",
          rowGap: 10,
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
          style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}
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
            {/* #305: read-only here — the status select lives on Send & track. */}
            <span data-testid="est-status" style={{ fontSize: 12.5, fontWeight: 600, color: "#cfd3da" }}>
              {STATUS_LABEL[status] || status}
            </span>
          </div>
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
              onSync={(r, action) => {
                applySync(r);
                if (r.ok) {
                  setActionError(null);
                  setGateRefused(false);
                  onActed(action);
                }
              }}
              onError={(m) => {
                setActionError(m);
                setGateRefused(false);
              }}
            />
          )}
          <HeaderMoreMenu s={s} onStep={onStep} />
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
                  onBlur={commitCategory}
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
  );
}
