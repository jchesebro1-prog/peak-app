"use client";

import { useEffect, useMemo } from "react";
import { commentsBySection, numberComments } from "@/lib/estimate-review/comments";
import { useCommentsFocusRefresh } from "../comment-pins";
import NarrativeColumn from "../narrative-column";
import { PdfOptionsPanel } from "../preview-doc";
import { CoverPackagePanel } from "../cover-package-panel";
import { PackageStaffPanel } from "../package-staff-panel";
import { PAYMENT_TERMS } from "../types";
import { ACCENT_INK, ACCENT_SOFT } from "../est-ui";
import type { EstimatorState } from "../use-estimator-state";

/** #305 — Build package: what the client receives. Narrative for the picked system (left), output options (right). */
export function PackageStep({ s }: { s: EstimatorState }) {
  const {
    canWriteNarrativeLibrary,
    coverSummary,
    customerId,
    cutSheetCount,
    detail,
    focusNarrIfPending,
    intros,
    kpLib,
    loadedId,
    narrRef,
    narrSec,
    notIncluded,
    notIncludedDefault,
    onCoverSummary,
    onNotIncluded,
    paymentTerms,
    pdfCover,
    pdfCutSheets,
    pdfDirty,
    pdfItemizedAppendix,
    pdfNotes,
    pdfOptions,
    pdfPrices,
    pdfQty,
    pdfTerms,
    sections,
    setActiveId,
    setDetail,
    setIntros,
    setPaymentTerms,
    setSystemPresentation,
    togglePdf,
    updateSection,
  } = s;
  useCommentsFocusRefresh(s);
  const pinned = useMemo(
    () => commentsBySection(numberComments(s.reviewComments, sections), sections.map((x) => x.id)),
    [s.reviewComments, sections]
  );
  // A card's narrative snippet on Build asked for focus before this step (and its textarea) existed.
  useEffect(() => {
    focusNarrIfPending();
  }, [focusNarrIfPending]);

  return (
    <div className="est-body" style={{ flex: 1, display: "flex", minHeight: 0 }}>
      <nav aria-label="Systems" className="est-scroll" style={{ width: 220, flexShrink: 0, overflowY: "auto", background: "#fff", borderRight: "1px solid #ececf0", padding: "16px 10px" }}>
        {pinned.whole.length > 0 && (
          <div style={{ padding: "0 10px 8px", fontSize: 11.5, fontWeight: 600, color: ACCENT_INK }}>
            <span aria-label={`${pinned.whole.length} review comment${pinned.whole.length === 1 ? "" : "s"} on the whole estimate`}>💬 {pinned.whole.length} on the whole estimate</span>
          </div>
        )}
        {sections.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => setActiveId(x.id)}
            aria-current={narrSec?.id === x.id ? "true" : undefined}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "8px 10px",
              marginBottom: 2,
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
              fontFamily: "var(--font-ui)",
              fontSize: 13,
              fontWeight: narrSec?.id === x.id ? 600 : 500,
              background: narrSec?.id === x.id ? ACCENT_SOFT : "transparent",
              color: narrSec?.id === x.id ? ACCENT_INK : "#3a3f4a",
            }}
          >
            {x.name || "Untitled"}
            {(pinned.bySection[x.id]?.length ?? 0) > 0 && (
              <span
                aria-label={`${pinned.bySection[x.id].length} review comment${pinned.bySection[x.id].length === 1 ? "" : "s"}`}
                style={{ marginLeft: 6, fontSize: 11, fontWeight: 600, color: ACCENT_INK }}
              >
                💬 {pinned.bySection[x.id].length}
              </span>
            )}
          </button>
        ))}
      </nav>
      <section aria-label="System narrative" className="est-scroll" style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "18px 24px", background: "#fff", display: "flex", flexDirection: "column", gap: 10 }}>
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
            Add a system on the Build step to write its narrative.
          </div>
        )}
      </section>
      <aside className="est-scroll" style={{ width: 300, flexShrink: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 18, padding: 18, background: "#fff", borderLeft: "1px solid #ececf0" }}>
        <PdfOptionsPanel
          savedQuoteId={loadedId}
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
          togglePdf={togglePdf}
        />
        <CoverPackagePanel
          savedQuoteId={loadedId}
          canEdit
          dirty={pdfDirty}
          coverSummary={coverSummary}
          onCoverSummary={onCoverSummary}
          notIncluded={notIncluded}
          onNotIncluded={onNotIncluded}
          notIncludedDefault={notIncludedDefault}
        />
        {loadedId ? (
          <PackageStaffPanel quoteId={loadedId} section="package" />
        ) : (
          <div style={{ fontSize: 11.5, color: "#aab0bb" }}>Save the estimate to add drawings.</div>
        )}
      </aside>
    </div>
  );
}
