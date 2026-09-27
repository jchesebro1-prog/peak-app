"use client";

import type { CSSProperties } from "react";
import QuoteDocument, { type QuoteDocumentProps } from "./quote-document";
import { systemFreight, systemItemsRev } from "./pricing";
import type { PaymentTerms } from "./types";

/**
 * Customer preview — the quote document with the Show-on-PDF toggles.
 *
 * D69 redesign (Jeff, Jul 12): richer than the prototype's flat port —
 * branded accent styling, a document title block, the REAL project/venue
 * (the prototype hardcoded "Stage Systems Package"), an at-a-glance
 * investment band, an Optional additions section (option-flagged items
 * were previously invisible to the customer), itemized terms, and an
 * acceptance/signature block that mentions the customer portal.
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

export type PreviewProps = QuoteDocumentProps & {
  phone: boolean;
  canBuild: boolean;
  onBack: () => void;
  setSectionPresentation: (id: string, value: "itemized" | "narrative") => void;
  setDetail: (d: "itemized" | "sectioned") => void;
  paymentTermsOptions: readonly PaymentTerms[];
  setPaymentTerms: (terms: PaymentTerms) => void;
  togglePdf: (flag: "pdfQty" | "pdfNotes" | "pdfPrices" | "pdfCover" | "pdfTerms" | "pdfOptions") => void;
};

const PRINT_CSS = `
@media print {
  @page { size: letter; margin: 0.6in; }
  body * { visibility: hidden; }
  .est-doc, .est-doc * { visibility: visible; }
  .est-screen, .est-previewbody, .est-docwrap { height: auto !important; min-height: 0 !important; overflow: visible !important; }
  .est-prevhead { display: none !important; }
  .est-screen .est-doc { position: absolute; left: 0; top: 0; width: 100% !important; height: auto !important; box-shadow: none !important; margin: 0 !important; padding: 0 !important; border-radius: 0 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .est-doc .est-secband { break-inside: avoid; break-after: avoid; page-break-after: avoid; }
  .est-doc .est-line, .est-doc .est-optbox, .est-doc .est-totals, .est-doc .est-terms, .est-doc .est-accept, .est-doc .est-sig { break-inside: avoid; page-break-inside: avoid; }
}
`;

export default function PreviewDoc(p: PreviewProps) {
  const isItemized = p.detail === "itemized";
  // Per-system Itemized/Narrative lives in this sidebar: the document itself is
  // shared with the signed print route (#222) and carries no controls.
  const sectionToggles = p.sections
    .filter((sec) => systemItemsRev(sec) > 0 || systemFreight(sec) > 0)
    .map((sec) => ({ id: sec.id, name: sec.name, presentation: sec.presentation || "itemized" }));

  return (
    <div
      data-screen-label="Customer quote document"
      className="est-screen"
      style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
    >
      <style>{PRINT_CSS}</style>
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
          <span
            style={{
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: "#f3e6bf",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            i
          </span>
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
        }}
      >
        {p.canBuild && (
          <button
            type="button"
            onClick={p.onBack}
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 13,
              fontWeight: 600,
              color: "#16181d",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: 0,
            }}
          >
            ← Back to estimate
          </button>
        )}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "stretch",
            gap: 9,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#9aa0ab",
              textTransform: "uppercase",
              letterSpacing: ".04em",
            }}
          >
            Show on PDF
          </span>
          <div style={{ display: "flex", background: "#f1f2f5", borderRadius: 7, padding: 2 }}>
            <button type="button" onClick={() => p.setDetail("itemized")} style={isItemized ? segOn : segOff}>
              Itemized
            </button>
            <button
              type="button"
              onClick={() => p.setDetail("sectioned")}
              style={!isItemized ? segOn : segOff}
            >
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
          <button type="button" onClick={() => p.togglePdf("pdfTerms")} style={p.pdfTerms ? segOn : segOff}>
            {(p.pdfTerms ? "✓ " : "") + "Terms"}
          </button>
          <select value={p.paymentTerms} onChange={(event) => p.setPaymentTerms(event.target.value as PaymentTerms)} aria-label="Payment terms" style={{ border: "1px solid #dfe2e8", borderRadius: 7, background: "#fff", color: "#5b616e", padding: "6px 8px", fontSize: 11.5 }}>
            {p.paymentTermsOptions.map((terms) => <option key={terms} value={terms}>{terms}</option>)}
          </select>
        </div>
        {sectionToggles.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#9aa0ab", textTransform: "uppercase", letterSpacing: ".04em" }}>
              Systems
            </span>
            {sectionToggles.map((s) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: 12, color: "#3a3f4a", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.name}
                </span>
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
        <button
          type="button"
          onClick={() => window.print()}
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 13,
            fontWeight: 600,
            color: "#fff",
            background: "var(--accent)",
            padding: "9px 16px",
            borderRadius: 8,
            border: "none",
            cursor: "pointer",
          }}
        >
          Download PDF
        </button>
      </aside>

      <div
        className="est-scroll est-docwrap"
        style={{
          flex: 1,
          overflowY: "auto",
          background: "#e9ebef",
          padding: 30,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <QuoteDocument {...p} />
      </div>
      </div>
    </div>
  );
}
