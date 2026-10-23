"use client";

import type { CSSProperties } from "react";
import { QuotePdfViewer } from "@/components/quote-pdf/quote-pdf-viewer";
import type { QuotePdfView } from "@/lib/quote-pdf/state";
import type { PaymentTerms } from "./types";

/**
 * Customer preview (#222) — the SAVED quote PDF and the Show-on-PDF
 * controls. The PDF is printed by headless Chrome from the signed print route
 * (/print/quote/[id], the shared QuoteDocument) on every Save, so what the team
 * sees here is byte-for-byte what the customer gets. Changing a control marks
 * the quote dirty; the next Save re-renders.
 *
 * #305: two pieces for two steps — the Show-on-PDF controls (Build package;
 * #333: PdfLineDetailGroup on its Client package tab) and PdfPreviewPane
 * (Customer review). The cover block and the Client link moved
 * to their own steps.
 */

const segOn: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  fontWeight: 600,
  padding: "5px 13px",
  borderRadius: 5,
  background: "#fff",
  color: "#16181d",
  border: "none",
  cursor: "pointer",
  boxShadow: "0 1px 2px rgba(0,0,0,.1)",
};
const segOff: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  fontWeight: 500,
  padding: "5px 13px",
  borderRadius: 5,
  background: "transparent",
  color: "#9aa0ab",
  border: "none",
  cursor: "pointer",
};
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

export type PdfToggle =
  | "pdfQty"
  | "pdfNotes"
  | "pdfPrices"
  | "pdfCover"
  | "pdfTerms"
  | "pdfOptions"
  | "pdfItemizedAppendix"
  | "pdfCutSheets"
  // #364 — Build package → BOM quote → Show on BOM (the BOM view only).
  | "bomLinePrices"
  | "bomMaterials"
  | "bomLabor"
  | "bomFreight";

/** #333 — the Client package tab's "Estimate PDF — line detail" group (the old
 *  Show-on-PDF block minus the per-system presentation list, the Itemized
 *  appendix and Cut sheets — those are the tab's Systems and Documents rows). */
export type PdfLineDetailProps = {
  detail: "itemized" | "sectioned";
  setDetail: (d: "itemized" | "sectioned") => void;
  pdfQty: boolean;
  pdfNotes: boolean;
  pdfPrices: boolean;
  pdfCover: boolean;
  pdfTerms: boolean;
  pdfOptions: boolean;
  paymentTerms: PaymentTerms;
  paymentTermsOptions: readonly PaymentTerms[];
  setPaymentTerms: (terms: PaymentTerms) => void;
  togglePdf: (flag: PdfToggle) => void;
};

/** #305 — the Customer review step's saved PDF and its Save / Download actions. */
export type PdfPreviewProps = {
  phone: boolean;
  canBuild: boolean;
  savedQuoteId: string | null;
  pdf: QuotePdfView | null;
  onPdf: (v: QuotePdfView) => void;
  dirty: boolean;
  onSave: () => void;
  saveDisabled: boolean;
  /** #305 — render the action buttons in a compact row above the viewer
   * instead of a left aside (Review keeps one right aside on desktop). */
  actionsInline?: boolean;
};

/** The Payment terms select — shared by the Client package tab's line-detail group and a box sale's BOM quote tab. */
export function PaymentTermsSelect(p: { value: PaymentTerms; options: readonly PaymentTerms[]; onChange: (terms: PaymentTerms) => void }) {
  return (
    <select
      value={p.value}
      onChange={(event) => p.onChange(event.target.value as PaymentTerms)}
      aria-label="Payment terms"
      style={{ border: "1px solid #dfe2e8", borderRadius: 7, background: "#fff", color: "#5b616e", padding: "6px 8px", fontSize: 11.5 }}
    >
      {p.options.map((terms) => (
        <option key={terms} value={terms}>
          {terms}
        </option>
      ))}
    </select>
  );
}

export function PdfLineDetailGroup(p: PdfLineDetailProps) {
  const isItemized = p.detail === "itemized";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 9 }}>
      <div style={{ display: "flex", background: "#f1f2f5", borderRadius: 7, padding: 2 }}>
        <button type="button" onClick={() => p.setDetail("itemized")} style={isItemized ? segOn : segOff} aria-pressed={isItemized}>
          Itemized
        </button>
        <button type="button" onClick={() => p.setDetail("sectioned")} style={!isItemized ? segOn : segOff} aria-pressed={!isItemized}>
          By section
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 2, padding: 4, borderRadius: 7, background: "#e6e8ec" }}>
        <span style={{ padding: "5px 7px", fontSize: 10, fontWeight: 700, color: "#777d88", textTransform: "uppercase", letterSpacing: ".04em" }}>Line detail</span>
        <button type="button" onClick={() => p.togglePdf("pdfQty")} style={p.pdfQty ? segOn : segOff} aria-pressed={p.pdfQty}>{(p.pdfQty ? "✓ " : "") + "Quantities"}</button>
        <button type="button" onClick={() => p.togglePdf("pdfNotes")} style={p.pdfNotes ? segOn : segOff} aria-pressed={p.pdfNotes}>{(p.pdfNotes ? "✓ " : "") + "Descriptions"}</button>
        <button type="button" onClick={() => p.togglePdf("pdfPrices")} style={p.pdfPrices ? segOn : segOff} aria-pressed={p.pdfPrices}>{(p.pdfPrices ? "✓ " : "") + "Prices"}</button>
      </div>
      {/* #333: "estimate PDF" so it isn't confused with the Cover PDF document. */}
      <button type="button" onClick={() => p.togglePdf("pdfCover")} style={p.pdfCover ? segOn : segOff} aria-pressed={p.pdfCover} title="The cover note at the top of the estimate PDF (staff-written)">
        {(p.pdfCover ? "✓ " : "") + "Cover note (estimate PDF)"}
      </button>
      <button type="button" onClick={() => p.togglePdf("pdfOptions")} style={p.pdfOptions ? segOn : segOff} aria-pressed={p.pdfOptions}>
        {(p.pdfOptions ? "✓ " : "") + "Options"}
      </button>
      <button type="button" onClick={() => p.togglePdf("pdfTerms")} style={p.pdfTerms ? segOn : segOff} aria-pressed={p.pdfTerms}>
        {(p.pdfTerms ? "✓ " : "") + "Terms"}
      </button>
      <PaymentTermsSelect value={p.paymentTerms} options={p.paymentTermsOptions} onChange={p.setPaymentTerms} />
    </div>
  );
}

export function PdfPreviewPane(p: PdfPreviewProps) {
  const pdfHref = p.savedQuoteId ? `/api/quotes/${encodeURIComponent(p.savedQuoteId)}/pdf` : null;
  const hasFile = !!p.pdf?.hasFile;

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
          {pdfHref && hasFile ? (
            <>
              <a href={pdfHref + "?download=1"} style={{ ...actionLink, color: "#fff", background: "var(--accent)" }}>
                Download PDF
              </a>
              <a href={pdfHref} target="_blank" rel="noopener noreferrer" style={{ ...actionLink, color: "#16181d", background: "#f1f2f5" }}>
                Open PDF ↗
              </a>
            </>
          ) : (
            <span style={{ ...actionLink, color: "#9aa0ab", background: "#f1f2f5", cursor: "default" }}>Download PDF</span>
          )}
    </>
  );

  return (
    <div
      data-screen-label="Customer quote document"
      className="est-screen"
      style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
    >
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
        <div
          className="est-scroll est-docwrap"
          style={{ flex: 1, minHeight: 0, overflowY: "auto", background: "#e9ebef", padding: 18, display: "flex", flexDirection: "column" }}
        >
          {p.actionsInline && (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 12, flexShrink: 0 }}>
              {actions}
            </div>
          )}
          <QuotePdfViewer quoteId={p.savedQuoteId} pdf={p.pdf} onPdf={p.onPdf} dirty={p.dirty} />
        </div>
      </div>
    </div>
  );
}
