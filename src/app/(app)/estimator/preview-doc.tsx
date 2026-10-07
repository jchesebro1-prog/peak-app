"use client";

import type { CSSProperties } from "react";
import { QuotePdfViewer } from "@/components/quote-pdf/quote-pdf-viewer";
import type { QuotePdfView } from "@/lib/quote-pdf/state";
import { systemFreight, systemItemsRev, systemSellTotal } from "./pricing";
import type { PaymentTerms, SpecSection } from "./types";

/**
 * Customer preview (#222) — the SAVED quote PDF and the Show-on-PDF
 * controls. The PDF is printed by headless Chrome from the signed print route
 * (/print/quote/[id], the shared QuoteDocument) on every Save, so what the team
 * sees here is byte-for-byte what the customer gets. Changing a control marks
 * the quote dirty; the next Save re-renders.
 *
 * #304: two pieces for two steps — PdfOptionsPanel (Build package) and
 * PdfPreviewPane (Customer review). The cover block and the Client link moved
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
const sideLabel: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#9aa0ab",
  textTransform: "uppercase",
  letterSpacing: ".04em",
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

export type PdfToggle = "pdfQty" | "pdfNotes" | "pdfPrices" | "pdfCover" | "pdfTerms" | "pdfOptions" | "pdfItemizedAppendix" | "pdfCutSheets";

export type PreviewProps = {
  phone: boolean;
  canBuild: boolean;
  /** The saved quote id — null until the first Save creates it. */
  savedQuoteId: string | null;
  pdf: QuotePdfView | null;
  onPdf: (v: QuotePdfView) => void;
  /** The editor holds changes the saved PDF doesn't have yet. */
  dirty: boolean;
  onSave: () => void;
  saveDisabled: boolean;
  sections: SpecSection[];
  setSectionPresentation: (id: string, value: "itemized" | "narrative") => void;
  detail: "itemized" | "sectioned";
  setDetail: (d: "itemized" | "sectioned") => void;
  pdfQty: boolean;
  pdfNotes: boolean;
  pdfPrices: boolean;
  pdfCover: boolean;
  pdfTerms: boolean;
  pdfOptions: boolean;
  pdfItemizedAppendix: boolean;
  pdfCutSheets: boolean;
  /** #292 — sheets the saved PDF would append (countCutSheetTypes over the live sections). */
  cutSheetCount: number;
  paymentTerms: PaymentTerms;
  paymentTermsOptions: readonly PaymentTerms[];
  setPaymentTerms: (terms: PaymentTerms) => void;
  togglePdf: (flag: PdfToggle) => void;
};

/** #304 — the Build package step's output options (Show on PDF + per-system presentation). */
export type PdfOptionsProps = Omit<PreviewProps, "phone" | "canBuild" | "pdf" | "onPdf" | "onSave" | "saveDisabled" | "dirty">;

/** #304 — the Customer review step's saved PDF and its Save / Download actions. */
export type PdfPreviewProps = {
  phone: boolean;
  canBuild: boolean;
  savedQuoteId: string | null;
  pdf: QuotePdfView | null;
  onPdf: (v: QuotePdfView) => void;
  dirty: boolean;
  onSave: () => void;
  saveDisabled: boolean;
};

export function PdfOptionsPanel(p: PdfOptionsProps) {
  const isItemized = p.detail === "itemized";
  const sectionToggles = p.sections
    .filter((sec) => systemItemsRev(sec) > 0 || systemFreight(sec) > 0 || systemSellTotal(sec) > 0)
    .map((sec) => ({ id: sec.id, name: sec.name, presentation: sec.presentation || "itemized" }));

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 9 }}>
        <span style={sideLabel}>Show on PDF</span>
        <div style={{ display: "flex", background: "#f1f2f5", borderRadius: 7, padding: 2 }}>
          <button type="button" onClick={() => p.setDetail("itemized")} style={isItemized ? segOn : segOff}>
            Itemized
          </button>
          <button type="button" onClick={() => p.setDetail("sectioned")} style={!isItemized ? segOn : segOff}>
            By section
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 2, padding: 4, borderRadius: 7, background: "#e6e8ec" }}>
          <span style={{ padding: "5px 7px", fontSize: 10, fontWeight: 700, color: "#777d88", textTransform: "uppercase", letterSpacing: ".04em" }}>Line detail</span>
          <button type="button" onClick={() => p.togglePdf("pdfQty")} style={p.pdfQty ? segOn : segOff}>{(p.pdfQty ? "✓ " : "") + "Quantities"}</button>
          <button type="button" onClick={() => p.togglePdf("pdfNotes")} style={p.pdfNotes ? segOn : segOff}>{(p.pdfNotes ? "✓ " : "") + "Descriptions"}</button>
          <button type="button" onClick={() => p.togglePdf("pdfPrices")} style={p.pdfPrices ? segOn : segOff}>{(p.pdfPrices ? "✓ " : "") + "Prices"}</button>
        </div>
        <button type="button" onClick={() => p.togglePdf("pdfCover")} style={p.pdfCover ? segOn : segOff}>
          {(p.pdfCover ? "✓ " : "") + "Cover note"}
        </button>
        <button type="button" onClick={() => p.togglePdf("pdfOptions")} style={p.pdfOptions ? segOn : segOff}>
          {(p.pdfOptions ? "✓ " : "") + "Options"}
        </button>
        <button
          type="button"
          onClick={() => p.togglePdf("pdfItemizedAppendix")}
          style={p.pdfItemizedAppendix ? segOn : segOff}
          title="Print every narrative system's full line list after the signature"
        >
          {(p.pdfItemizedAppendix ? "✓ " : "") + "Itemized appendix"}
        </button>
        <button type="button" onClick={() => p.togglePdf("pdfTerms")} style={p.pdfTerms ? segOn : segOff}>
          {(p.pdfTerms ? "✓ " : "") + "Terms"}
        </button>
        <button
          type="button"
          disabled={p.cutSheetCount === 0}
          title={p.cutSheetCount === 0 ? "This quote has no curtains." : undefined}
          onClick={() => p.togglePdf("pdfCutSheets")}
          style={{ ...(p.pdfCutSheets && p.cutSheetCount > 0 ? segOn : segOff), ...(p.cutSheetCount === 0 ? { cursor: "not-allowed", opacity: 0.55 } : {}) }}
        >
          {(p.pdfCutSheets && p.cutSheetCount > 0 ? "✓ " : "") + "Cut sheets"}
        </button>
        {p.pdfCutSheets && p.cutSheetCount > 0 && (
          <div style={{ fontSize: 11.5, color: "#5b616e", lineHeight: 1.45, padding: "2px 4px" }}>
            {`+ ${p.cutSheetCount} cut sheet${p.cutSheetCount === 1 ? "" : "s"} (Client style) print after the estimate — `}
            {p.savedQuoteId ? (
              <a href={`/estimator/cut-sheets?id=${encodeURIComponent(p.savedQuoteId)}&style=client`} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                View cut sheets →
              </a>
            ) : (
              "save to view them"
            )}
          </div>
        )}
        <select
          value={p.paymentTerms}
          onChange={(event) => p.setPaymentTerms(event.target.value as PaymentTerms)}
          aria-label="Payment terms"
          style={{ border: "1px solid #dfe2e8", borderRadius: 7, background: "#fff", color: "#5b616e", padding: "6px 8px", fontSize: 11.5 }}
        >
          {p.paymentTermsOptions.map((terms) => (
            <option key={terms} value={terms}>
              {terms}
            </option>
          ))}
        </select>
      </div>
      {sectionToggles.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 6 }}>
          <span style={sideLabel}>Systems</span>
          {sectionToggles.map((s) => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontSize: 12, color: "#3a3f4a", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
              <button
                type="button"
                onClick={() => p.setSectionPresentation(s.id, s.presentation === "narrative" ? "itemized" : "narrative")}
                style={segOn}
              >
                {s.presentation === "narrative" ? "Narrative" : "Itemized"}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export function PdfPreviewPane(p: PdfPreviewProps) {
  const pdfHref = p.savedQuoteId ? `/api/quotes/${encodeURIComponent(p.savedQuoteId)}/pdf` : null;
  const hasFile = !!p.pdf?.hasFile;

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
        </aside>
        <div
          className="est-scroll est-docwrap"
          style={{ flex: 1, minHeight: 0, overflowY: "auto", background: "#e9ebef", padding: 18, display: "flex", flexDirection: "column" }}
        >
          <QuotePdfViewer quoteId={p.savedQuoteId} pdf={p.pdf} onPdf={p.onPdf} dirty={p.dirty} />
        </div>
      </div>
    </div>
  );
}
