/**
 * Estimator handoff — bundle-time replacements for the Estimator's customer-facing views (esbuild-plugins.ts
 * `appOverridePlugin` maps each original file here; this module exports the same names and props):
 *
 *   src/app/(app)/estimator/preview-doc.tsx            PdfPreviewPane (+ PdfLineDetailGroup and the types,
 *                                                       re-exported from the original unchanged)
 *   src/components/quote-pdf/quote-pdf-viewer.tsx       QuotePdfViewer
 *   src/app/(app)/estimator/steps/review-tabs.tsx       ReviewTabs
 *
 * In the app the Document tab shows the SAVED quote's headless-Chrome PDF and the Package page / BOM / Cut
 * sheets tabs frame /estimator-preview/:id; neither exists offline. Here the Document is the same
 * QuoteDocument the print route renders, drawn live from the store (ui/live-views.tsx), with a
 * **Print / Save as PDF** button (window.print(); print CSS shows only the document — a portal on <body> —
 * then the Client cut sheets when the quote asks for them, with a confidential footer on every page),
 * and the framed tabs render the same components the preview route renders. Datasheets and Drawings read
 * "Not included in the prototype" (no part documents or drawing files are sliced). Plan: PR 2 Task 5.
 */
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import QuoteDocument, { QUOTE_PRINT_CSS, type QuoteDocumentProps } from "@/app/(app)/estimator/quote-document";
import type { QuotePdfView } from "@/lib/quote-pdf/state";
import {
  frameWidth, framedTab, nextReviewTab, reviewPanelId, reviewTabId, REVIEW_DEVICE_LABEL, REVIEW_DEVICES, REVIEW_TAB_LABEL, REVIEW_TABS,
  REVIEW_UI_COPY as COPY, tabNeedsSave, type ReviewDevice, type ReviewTab,
} from "@/lib/estimate-review/review-ui";
import type { ReviewDocsResult } from "@/app/(app)/estimator/review-actions";
import type { EstimatorState } from "@/app/(app)/estimator/use-estimator-state";
import type { PdfPreviewProps } from "@/app/(app)/estimator/preview-doc";
import { PRINT_FOOTER_TEXT } from "./preview-routes";
import { LIVE_COPY, LiveBom, LiveCutSheets, LiveDocument, LivePackagePage, PrintCutSheets } from "./live-views";

// The Build package's Show-on-PDF controls are unchanged — the original module's own export.
export { PdfLineDetailGroup } from "@/app/(app)/estimator/preview-doc";
export type { PdfToggle, PdfLineDetailProps, PdfPreviewProps } from "@/app/(app)/estimator/preview-doc";

export const PRINT_COPY = {
  print: "Print / Save as PDF",
  printTitle: "Opens the browser's print dialog — choose “Save as PDF” to keep a copy.",
  saveFirst: "Save this estimate to create its PDF.",
  unsaved: "Unsaved changes — save to update the PDF.",
  empty: "The PDF appears here once the quote is saved.",
} as const;

/** The print root's id — the only thing on the page that prints. */
export const PRINT_ROOT_ID = "handoff-print-root";

// Every printed page's footer — a printed prototype PDF says what it is (the on-screen banner never prints).
export { PRINT_FOOTER_TEXT };

/**
 * Print media shows only the print root (the saved document, then any cut-sheet appendix) and its footer,
 * fixed at the bottom of every printed page; the screen never shows any of it.
 */
export const PRINT_ROOT_CSS = `
#${PRINT_ROOT_ID}, #${PRINT_ROOT_ID} .handoff-print-footer { display: none; }
@media print {
${QUOTE_PRINT_CSS}
  body > *:not(#${PRINT_ROOT_ID}) { display: none !important; }
  #${PRINT_ROOT_ID} { display: block !important; }
  #${PRINT_ROOT_ID} .handoff-print-footer { display: block !important; position: fixed; left: 0; right: 0; bottom: 0; text-align: center; font: 7.5pt/1.2 Arial, Helvetica, sans-serif; color: #8c919c; }
}
`;

/* ------------------------------------------------------------------ preview-doc.tsx → PdfPreviewPane */

const actionLink: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  fontWeight: 600,
  textAlign: "center",
  borderRadius: 8,
  padding: "9px 16px",
  textDecoration: "none",
  border: "none",
};

/** The browser's print dialog for the document the print root holds. */
export function printDocument(): void {
  window.print();
}

/** #305 — the Customer review step's saved document and its Save / Print actions (preview-doc.tsx's layout). */
export function PdfPreviewPane(p: PdfPreviewProps) {
  const actions = (
    <>
      {(p.dirty || !p.savedQuoteId) && p.canBuild && (
        <button
          type="button"
          onClick={p.onSave}
          disabled={p.saveDisabled}
          style={{ ...actionLink, color: "#fff", background: "#2b2e35", cursor: p.saveDisabled ? "not-allowed" : "pointer", opacity: p.saveDisabled ? 0.6 : 1 }}
        >
          {p.savedQuoteId ? "Save & update PDF" : "Save to create PDF"}
        </button>
      )}
      {p.savedQuoteId ? (
        <button type="button" onClick={printDocument} title={PRINT_COPY.printTitle} style={{ ...actionLink, color: "#fff", background: "var(--accent)", cursor: "pointer" }}>
          {PRINT_COPY.print}
        </button>
      ) : (
        <span style={{ ...actionLink, color: "#9aa0ab", background: "#f1f2f5", cursor: "default" }}>{PRINT_COPY.print}</span>
      )}
    </>
  );

  return (
    <div data-screen-label="Customer quote document" className="est-screen" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {p.phone && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "11px 16px",
            background: "#fbf3dd",
            borderBottom: "1px solid #f0e2bd",
            color: "#8a6d1f",
            fontSize: 12.5,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          View only on phone — open on iPad or desktop to edit.
        </div>
      )}
      <div className="est-previewbody" style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {!p.actionsInline && (
          <aside
            className="est-prevhead"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "stretch",
              justifyContent: "flex-start",
              gap: 18,
              width: 264,
              padding: "20px 18px",
              background: "#fff",
              borderRight: "1px solid #ececf0",
              flexShrink: 0,
              overflowY: "auto",
            }}
          >
            {actions}
          </aside>
        )}
        <div className="est-scroll est-docwrap" style={{ flex: 1, minHeight: 0, overflowY: "auto", background: "#e9ebef", padding: 18, display: "flex", flexDirection: "column" }}>
          {p.actionsInline && <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 12, flexShrink: 0 }}>{actions}</div>}
          <QuotePdfViewer quoteId={p.savedQuoteId} pdf={p.pdf} onPdf={p.onPdf} dirty={p.dirty} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ quote-pdf-viewer.tsx → QuotePdfViewer */

const bannerStyle = (tone: "info" | "warn"): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "9px 12px",
  borderRadius: 8,
  fontSize: 12.5,
  fontWeight: 600,
  marginBottom: 10,
  ...(tone === "warn" ? { background: "#fbf3dd", color: "#8a6d1f", border: "1px solid #f0e2bd" } : { background: "#e9eefb", color: "#3155a8", border: "1px solid #d4ddf3" }),
});

const EMPTY: CSSProperties = { flex: 1, minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 4, background: "#fff", color: "#9aa0ab", fontSize: 13 };

/**
 * The saved document in the print root (a portal on <body>), as the print route lays it out — the document,
 * then the Client cut sheets when the quote asks for them (#292) — plus the confidential footer, and the
 * print dialog's file name while it prints.
 */
function PrintRoot({ quoteId, doc }: { quoteId: string; doc: QuoteDocumentProps }) {
  useEffect(() => {
    let prev: string | null = null;
    const before = () => {
      prev = document.title;
      document.title = [doc.quoteId, doc.projectName].filter(Boolean).join(" — ") || prev;
    };
    const after = () => {
      if (prev !== null) document.title = prev;
      prev = null;
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, [doc.quoteId, doc.projectName]);
  return createPortal(
    <div id={PRINT_ROOT_ID}>
      <style>{PRINT_ROOT_CSS}</style>
      <QuoteDocument {...doc} />
      <PrintCutSheets quoteId={quoteId} />
      <div className="handoff-print-footer" data-handoff-print-footer="">
        {PRINT_FOOTER_TEXT}
      </div>
    </div>,
    document.body,
  );
}

/**
 * The saved estimate document (#222's viewer, live): its status line ("Unsaved changes — save to update the
 * PDF." while the editor holds changes the saved quote doesn't), then the customer QuoteDocument drawn from the
 * store — what the print route would render — and the print root Print → PDF prints. `pdf` / `onPdf` are kept
 * for the signature; there is no render to poll.
 */
export function QuotePdfViewer({ quoteId, dirty }: { quoteId: string | null; pdf: QuotePdfView | null; onPdf: (v: QuotePdfView) => void; dirty: boolean }) {
  const notes: Array<{ tone: "info" | "warn"; text: string }> = [];
  if (!quoteId) notes.push({ tone: "info", text: PRINT_COPY.saveFirst });
  else if (dirty) notes.push({ tone: "warn", text: PRINT_COPY.unsaved });
  return (
    <div style={{ flex: 1, minHeight: "70vh", display: "flex", flexDirection: "column" }} data-handoff-live="document">
      {notes.map((n) => (
        <div key={n.text} role="status" style={bannerStyle(n.tone)}>
          <span>{n.text}</span>
        </div>
      ))}
      {quoteId ? (
        <LiveDocument
          quoteId={quoteId}
          render={(doc) => (
            <>
              <div style={{ display: "flex", justifyContent: "center" }}>
                <QuoteDocument {...doc} />
              </div>
              <PrintRoot quoteId={quoteId} doc={doc} />
            </>
          )}
        />
      ) : (
        <div style={EMPTY}>{PRINT_COPY.empty}</div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ steps/review-tabs.tsx → ReviewTabs */

const TAB_BTN = (active: boolean): CSSProperties => ({
  fontFamily: "var(--font-ui)",
  fontSize: 12.5,
  fontWeight: 600,
  color: active ? "#16181d" : "#5b616e",
  background: active ? "#fff" : "transparent",
  border: active ? "1px solid #e4e7ec" : "1px solid transparent",
  borderRadius: 7,
  padding: "5px 11px",
  cursor: "pointer",
  whiteSpace: "nowrap",
});
const SEG_BTN = (active: boolean): CSSProperties => ({
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  fontWeight: 600,
  color: active ? "#fff" : "#5b616e",
  background: active ? "#2b2e35" : "transparent",
  border: "none",
  borderRadius: 6,
  padding: "4px 10px",
  cursor: "pointer",
});
const NOTE: CSSProperties = { margin: "40px auto", maxWidth: 420, textAlign: "center", fontSize: 13, color: "#5b616e" };

/**
 * Estimator Phase 4 (spec §11.1) — the Customer review step's client's-eye tabs, desktop only (review-tabs.tsx's
 * tab bar, keyboard and Desktop / Phone width): Document (the saved document, live, with Print → PDF), Package
 * page / BOM / Cut sheets (the saved quote, rendered in place of the /estimator-preview frame — full width or
 * 390 px for Phone), Datasheets and Drawings ("Not included in the prototype"). Unsaved edits get the banner;
 * every tab but Document needs a saved quote. `docs` is kept for the signature (the sidebar's checklist reads it).
 */
export function ReviewTabs({ s }: { s: EstimatorState; docs: ReviewDocsResult | null }) {
  const { doSave, loadedId, pdf, pdfDirty, phone, setPdf, statusChanging, tierResolving } = s;
  const [tab, setTab] = useState<ReviewTab>("document");
  const [device, setDevice] = useState<ReviewDevice>("desktop");
  const framed = framedTab(tab);
  const tabRefs = useRef<Partial<Record<ReviewTab, HTMLButtonElement | null>>>({});
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const to = nextReviewTab(tab, e.key);
    if (!to) return;
    e.preventDefault();
    setTab(to);
    tabRefs.current[to]?.focus();
  };

  let body: ReactNode;
  if (tab === "document") {
    body = (
      <PdfPreviewPane
        phone={phone}
        canBuild={!phone}
        savedQuoteId={loadedId}
        pdf={pdf}
        onPdf={setPdf}
        dirty={pdfDirty}
        onSave={doSave}
        saveDisabled={statusChanging || tierResolving}
        actionsInline={!phone}
      />
    );
  } else if (tabNeedsSave(tab) && !loadedId) {
    body = <p style={NOTE}>{COPY.saveFirst}</p>;
  } else if (framed && loadedId) {
    body = (
      <div className="est-scroll" style={{ flex: 1, minHeight: 0, overflow: "auto", background: "#eef0f3", padding: device === "phone" ? "16px 0" : 0 }}>
        <div
          title={`${REVIEW_TAB_LABEL[tab]} — what the client sees`}
          style={{
            width: frameWidth(device),
            maxWidth: "100%",
            minHeight: 480,
            boxSizing: "border-box",
            margin: "0 auto",
            border: device === "phone" ? "1px solid #d8dbe1" : "none",
            borderRadius: device === "phone" ? 14 : 0,
            background: "#fff",
            overflow: "hidden",
          }}
        >
          {tab === "package" ? <LivePackagePage quoteId={loadedId} /> : tab === "bom" ? <LiveBom quoteId={loadedId} /> : <LiveCutSheets quoteId={loadedId} style="client" />}
        </div>
      </div>
    );
  } else {
    body = (
      <div className="est-scroll" style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "18px 22px", background: "#fff" }}>
        <p style={NOTE}>{LIVE_COPY.notIncluded}</p>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "8px 14px", borderBottom: "1px solid #e4e7ec", background: "#f7f8fa" }}>
        <div role="tablist" aria-label="What the client sees" style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {REVIEW_TABS.map((t) => (
            <button
              key={t}
              ref={(el) => {
                tabRefs.current[t] = el;
              }}
              id={reviewTabId(t)}
              type="button"
              role="tab"
              aria-selected={tab === t}
              aria-controls={reviewPanelId(t)}
              tabIndex={tab === t ? 0 : -1}
              onClick={() => setTab(t)}
              onKeyDown={onTabKey}
              style={TAB_BTN(tab === t)}
            >
              {REVIEW_TAB_LABEL[t]}
            </button>
          ))}
        </div>
        {framed && (
          <div role="group" aria-label="Frame width" style={{ marginLeft: "auto", display: "flex", gap: 2, padding: 2, background: "#eceef2", borderRadius: 8 }}>
            {REVIEW_DEVICES.map((d) => (
              <button key={d} type="button" aria-pressed={device === d} onClick={() => setDevice(d)} style={SEG_BTN(device === d)}>
                {REVIEW_DEVICE_LABEL[d]}
              </button>
            ))}
          </div>
        )}
      </div>
      {pdfDirty && tab !== "document" && (
        <div role="status" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", fontSize: 12.5, color: "#7a5a12", background: "#fdf6e7", borderBottom: "1px solid #f0e2bf" }}>
          <span style={{ flex: 1 }}>{COPY.unsaved}</span>
          <button
            type="button"
            onClick={doSave}
            disabled={statusChanging || tierResolving}
            style={{ ...SEG_BTN(true), cursor: statusChanging || tierResolving ? "not-allowed" : "pointer", opacity: statusChanging || tierResolving ? 0.6 : 1 }}
          >
            {COPY.save}
          </button>
        </div>
      )}
      <div id={reviewPanelId(tab)} role="tabpanel" aria-labelledby={reviewTabId(tab)} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {body}
      </div>
    </div>
  );
}
