"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import dynamic from "next/dynamic";
import { commentsBySection, numberComments } from "@/lib/estimate-review/comments";
import { useCommentsFocusRefresh } from "../comment-pins";
import NarrativeColumn from "../narrative-column";
import { PdfOptionsPanel } from "../preview-doc";
import { CoverPackagePanel } from "../cover-package-panel";
import { PackageStaffPanel } from "../package-staff-panel";
import { GRID_LINK_COPY } from "@/lib/design/estimate-grid-link";
import { PAYMENT_TERMS } from "../types";
import { ACCENT_INK, ACCENT_SOFT } from "../est-ui";
import { saveProductParagraphAction } from "../narrative-actions";
import { seedPackageDoc } from "@/lib/package-doc/seed";
import type { PackageDocCtx } from "@/lib/package-doc/resolve";
import type { PackageDocApi } from "@/lib/package-doc/insert";
import { TAX_RATE_PCT, type EstimatorState } from "../use-estimator-state";

/** Screen-reader-only text (an aria-label on a plain span isn't reliably announced). */
const VISUALLY_HIDDEN: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
};

/** Phase 5 — the document editor is client-only and code-split: TipTap never
 *  reaches a server render or another page's bundle. */
const PackageDocEditor = dynamic(() => import("@/components/package-doc/editor/package-doc-editor"), {
  ssr: false,
  loading: () => <div style={{ padding: 24, fontSize: 12.5, color: "#8c919c" }}>Loading the editor…</div>,
});

/** Phase 5 — the editor's left pane (Gaps / BOM / Library), code-split with it. */
const DocLeftPane = dynamic(() => import("@/components/package-doc/editor/left-pane"), { ssr: false });

const BAR_BTN: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 600, color: "#3a3f4a", background: "#f1f2f5", border: "none", borderRadius: 6, padding: "5px 10px", cursor: "pointer" };
const START_BTN: CSSProperties = { ...BAR_BTN, color: "#fff", background: "var(--accent)", padding: "7px 14px", fontSize: 12.5 };

/** #305 — Build package: what the client receives. Narrative for the picked system (left), output options (right). */
export function PackageStep({ s }: { s: EstimatorState }) {
  const {
    blocks,
    canWriteNarrativeLibrary,
    coverSummary,
    customerId,
    cutSheetCount,
    detail,
    focusNarrIfPending,
    groups,
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
    packageDoc,
    packageDocFlushRef,
    packageDocOverDraft,
    quoteId,
    sections,
    setActiveId,
    setDetail,
    setIntros,
    setPackageDoc,
    setPackageDocOver,
    setPaymentTerms,
    setSystemPresentation,
    t,
    togglePdf,
    updateSection,
  } = s;
  useCommentsFocusRefresh(s);
  const pinned = useMemo(
    () => commentsBySection(numberComments(s.reviewComments, sections), sections.map((x) => x.id)),
    [s.reviewComments, sections]
  );
  // A card's narrative snippet on Build asked for focus before this step (and its textarea) existed.
  /* Phase 5 — the package document. No document: today's narrative layout +
     Start the document. With one: the editor is the main area; the narrative
     fields (they still drive the cover PDF) sit behind "Narrative fields". */
  const hasDoc = packageDoc !== null;
  const [narrOpen, setNarrOpen] = useState(false);
  const [askRemove, setAskRemove] = useState(false);
  const showNarrative = !hasDoc || narrOpen;
  useEffect(() => {
    focusNarrIfPending();
  }, [focusNarrIfPending, showNarrative]);
  /** Set by Remove: the editor unmounts because the document is gone, so its
   *  unmount flush must not hand the removed document back. */
  const discardRef = useRef(false);
  useEffect(() => {
    if (packageDoc) discardRef.current = false;
  }, [packageDoc]);
  const startDocument = () => {
    discardRef.current = false;
    setNarrOpen(false);
    setPackageDocOver(false);
    setPackageDoc(seedPackageDoc({ sections, groups }));
  };
  const removeDocument = () => {
    discardRef.current = true;
    setAskRemove(false);
    setNarrOpen(false);
    setPackageDocOver(false);
    setPackageDoc(null);
  };
  /** The editor's insert API for the left pane (null until the editor exists). */
  const [docApi, setDocApi] = useState<PackageDocApi | null>(null);
  /** The editor's insert API for the left pane, and its flush for a programmatic Save. */
  const onEditorReady = useCallback(
    (api: PackageDocApi | null) => {
      setDocApi(api);
      packageDocFlushRef.current = api ? api.flush : null;
    },
    [packageDocFlushRef]
  );
  const docCtx = useMemo<PackageDocCtx>(() => ({ sections, t, quoteId: quoteId || "", taxRatePct: TAX_RATE_PCT }), [sections, t, quoteId]);
  const { setRow: setLibraryRow, rows: libraryRows } = kpLib;
  /** Save to product: the narrative column's action (create permission, stale
   *  check), then the cached library row follows (saved row, or the newer
   *  paragraph that made it stale). */
  const saveToProduct = useCallback(
    async (sku: string, text: string, expectUpdatedAt: number | null) => {
      const out = await saveProductParagraphAction(sku, text, expectUpdatedAt);
      if (out.ok) {
        if (out.row) setLibraryRow(sku, out.row);
      } else if (out.stale) {
        const row = Object.hasOwn(libraryRows, sku) ? libraryRows[sku] : undefined;
        if (row) setLibraryRow(sku, { ...row, paragraph: out.stale.paragraph, paragraphUpdatedAt: out.stale.updatedAt });
      }
      return out;
    },
    [libraryRows, setLibraryRow]
  );

  const docBar = hasDoc ? (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "10px 16px", background: "#fff", borderBottom: "1px solid #ececf0" }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".06em", textTransform: "uppercase", marginRight: "auto" }}>Client document</div>
      <button type="button" style={{ ...BAR_BTN, ...(narrOpen ? { background: ACCENT_SOFT, color: ACCENT_INK } : {}) }} aria-pressed={narrOpen} onClick={() => setNarrOpen((v) => !v)}>
        Narrative fields
      </button>
      {askRemove ? (
        <span role="group" aria-label="Confirm remove document" style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 6, fontSize: 12, color: "#3a3f4a", background: "#fbecea", borderRadius: 6, padding: "4px 8px" }}>
          <span>Remove the document? The estimate goes back to the narrative fields.</span>
          <button type="button" style={{ ...BAR_BTN, color: "#fff", background: "#b4543a" }} onClick={removeDocument}>
            Remove
          </button>
          <button type="button" style={BAR_BTN} onClick={() => setAskRemove(false)}>
            Cancel
          </button>
        </span>
      ) : (
        <button type="button" style={{ ...BAR_BTN, color: "#b4543a" }} onClick={() => setAskRemove(true)}>
          Remove document
        </button>
      )}
    </div>
  ) : null;

  return (
    <div className="est-body" style={{ flex: 1, display: "flex", minHeight: 0 }}>
      {showNarrative ? (
        <nav aria-label="Systems" className="est-scroll" style={{ width: 220, flexShrink: 0, overflowY: "auto", background: "#fff", borderRight: "1px solid #ececf0", padding: "16px 10px" }}>
          {pinned.whole.length > 0 && (
            <div style={{ padding: "0 10px 8px", fontSize: 11.5, fontWeight: 600, color: ACCENT_INK }}>
              <span aria-hidden="true">💬 {pinned.whole.length} on the whole estimate</span>
              <span style={VISUALLY_HIDDEN}>{`${pinned.whole.length} review comment${pinned.whole.length === 1 ? "" : "s"} on the whole estimate`}</span>
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
                <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 600, color: ACCENT_INK }}>
                  <span aria-hidden="true">💬 {pinned.bySection[x.id].length}</span>
                  <span style={VISUALLY_HIDDEN}>{` — ${pinned.bySection[x.id].length} review comment${pinned.bySection[x.id].length === 1 ? "" : "s"}`}</span>
                </span>
              )}
            </button>
          ))}
        </nav>
      ) : (
        <aside aria-label="Document tools" className="est-scroll" style={{ width: 240, flexShrink: 0, overflowY: "auto", background: "#fff", borderRight: "1px solid #ececf0", padding: "16px 14px" }}>
          {packageDoc && (
            <DocLeftPane
              api={docApi}
              doc={packageDoc}
              sections={sections}
              blocks={blocks}
              intros={intros}
              notIncluded={notIncluded}
              notIncludedDefault={notIncludedDefault}
              library={kpLib}
            />
          )}
        </aside>
      )}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {docBar}
        {showNarrative && (
          <section aria-label="System narrative" className="est-scroll" style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "18px 24px", background: "#fff", display: "flex", flexDirection: "column", gap: 10 }}>
            {!hasDoc ? (
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: "12px 14px", marginBottom: 6, borderRadius: 10, background: ACCENT_SOFT }}>
                <div style={{ flex: "1 1 260px", minWidth: 0, fontSize: 12.5, lineHeight: 1.5, color: "#3a3f4a" }}>
                  <div style={{ fontWeight: 700, color: ACCENT_INK }}>Client document</div>
                  Write the whole client document in one place — headings, lists, product photos and live prices. It starts from these narrative fields.
                </div>
                <button type="button" style={START_BTN} onClick={startDocument}>
                  Start the document
                </button>
              </div>
            ) : (
              <div style={{ fontSize: 11.5, color: "#8c919c", lineHeight: 1.45 }}>
                The client document replaces these fields on the PDF and online estimate; they still write the cover PDF.
              </div>
            )}
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
        )}
        {packageDoc !== null && (
          <div style={{ flex: 1, minHeight: 0, display: narrOpen ? "none" : "flex", flexDirection: "column" }}>
            <PackageDocEditor
              value={packageDoc}
              onChange={setPackageDoc}
              onOverChange={setPackageDocOver}
              overDraft={packageDocOverDraft}
              discardRef={discardRef}
              ctx={docCtx}
              library={kpLib}
              canWriteLibrary={canWriteNarrativeLibrary}
              onSaveToProduct={saveToProduct}
              onReady={onEditorReady}
            />
          </div>
        )}
      </div>
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
          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
            <div style={{ fontSize: 11.5, color: "#aab0bb" }}>Save the estimate to add drawings.</div>
            {/* #314 — disabled until the quote is saved: the Grid design links to a saved estimate. */}
            <button type="button" disabled title={GRID_LINK_COPY.saveFirst} style={{ ...BAR_BTN, cursor: "not-allowed", opacity: 0.55 }}>
              {GRID_LINK_COPY.design}
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
