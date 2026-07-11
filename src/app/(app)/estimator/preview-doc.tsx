"use client";

import type { CSSProperties } from "react";
import letterhead from "./peak-letterhead.jpg";
import { fmt, systemFreight, systemItemsRev, type QuoteTotals } from "./pricing";
import type { SpecSection } from "./types";

/**
 * Customer preview — the quote document (letterhead, prepared-for block,
 * section bars, itemized lines, totals) with the Show-on-PDF toggles.
 * Pixel port of Estimator.dc.html preview mode.
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

export type PreviewProps = {
  phone: boolean;
  canBuild: boolean;
  onBack: () => void;
  quoteId: string;
  revNum: number;
  revDateMs: number;
  custName: string;
  hasAttn: boolean;
  attnLine: string;
  quoteNote: string;
  sections: SpecSection[];
  t: QuoteTotals;
  taxRatePct: number;
  detail: "itemized" | "sectioned";
  setDetail: (d: "itemized" | "sectioned") => void;
  pdfQty: boolean;
  pdfNotes: boolean;
  pdfCover: boolean;
  pdfTerms: boolean;
  togglePdf: (flag: "pdfQty" | "pdfNotes" | "pdfCover" | "pdfTerms") => void;
};

export default function PreviewDoc(p: PreviewProps) {
  const isItemized = p.detail === "itemized";
  const lineCols = p.pdfQty ? "1fr 70px 104px" : "1fr 104px";
  const showCover = !!(p.pdfCover && p.quoteNote && p.quoteNote.trim());
  const revDateLabel = new Date(p.revDateMs).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const previewSections = p.sections
    .filter((sec) => systemItemsRev(sec) > 0 || systemFreight(sec) > 0)
    .map((sec, i) => {
      const visible = sec.items.filter((x) => !x.option);
      const secFr = systemFreight(sec);
      const sub = systemItemsRev(sec) + secFr;
      return {
        heading: i + 1 + " · " + sec.name,
        subtotalLabel: fmt(sub),
        hasFreight: secFr > 0,
        freightLabel: fmt(secFr),
        lines:
          sec.kind === "labor"
            ? [
                {
                  key: "labor",
                  desc: "Installation, commissioning & project management",
                  comment: "",
                  showComment: false,
                  qty: "" as string | number,
                  unit: "",
                  ext: fmt(visible.reduce((a, it) => a + it.qty * it.price, 0)),
                },
              ]
            : visible.map((it) => ({
                key: String(it.id),
                desc: it.desc,
                comment: (it.comment || "").trim(),
                showComment: !!(p.pdfNotes && it.comment && it.comment.trim()),
                qty: it.qty as string | number,
                unit: it.unit,
                ext: fmt(it.qty * it.price),
              })),
      };
    });

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
      <div
        className="est-prevhead"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 18,
          padding: "11px 22px",
          background: "#fff",
          borderBottom: "1px solid #ececf0",
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
            alignItems: "center",
            gap: 9,
            flexWrap: "wrap",
            justifyContent: "center",
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
          <button type="button" onClick={() => p.togglePdf("pdfQty")} style={p.pdfQty ? segOn : segOff}>
            {(p.pdfQty ? "✓ " : "") + "Quantities"}
          </button>
          <button type="button" onClick={() => p.togglePdf("pdfNotes")} style={p.pdfNotes ? segOn : segOff}>
            {(p.pdfNotes ? "✓ " : "") + "Line notes"}
          </button>
          <button type="button" onClick={() => p.togglePdf("pdfCover")} style={p.pdfCover ? segOn : segOff}>
            {(p.pdfCover ? "✓ " : "") + "Cover note"}
          </button>
          <button type="button" onClick={() => p.togglePdf("pdfTerms")} style={p.pdfTerms ? segOn : segOff}>
            {(p.pdfTerms ? "✓ " : "") + "Terms"}
          </button>
        </div>
        <button
          type="button"
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
      </div>

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
        <div
          className="est-doc"
          style={{
            width: 740,
            background: "#fff",
            borderRadius: 4,
            boxShadow: "0 6px 30px rgba(0,0,0,.12)",
            padding: "46px 50px",
            height: "fit-content",
          }}
        >
          {/* letterhead */}
          <div style={{ borderBottom: "2px solid #16181d", paddingBottom: 16, marginBottom: 20 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={letterhead.src}
              alt="Peak Systems Group, Inc."
              style={{ display: "block", width: "100%", height: "auto" }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <div
                style={{
                  textAlign: "right",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11.5,
                  color: "#5b616e",
                  lineHeight: 1.7,
                }}
              >
                {p.quoteId} · REV {p.revNum} · {revDateLabel}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 26, fontSize: 12 }}>
            <div>
              <div
                style={{
                  color: "#9aa0ab",
                  textTransform: "uppercase",
                  fontSize: 10,
                  letterSpacing: ".06em",
                  marginBottom: 3,
                }}
              >
                Prepared for
              </div>
              <div style={{ fontWeight: 600 }}>{p.custName}</div>
              {p.hasAttn && <div style={{ color: "#5b616e" }}>Attn: {p.attnLine}</div>}
            </div>
            <div style={{ textAlign: "right" }}>
              <div
                style={{
                  color: "#9aa0ab",
                  textTransform: "uppercase",
                  fontSize: 10,
                  letterSpacing: ".06em",
                  marginBottom: 3,
                }}
              >
                Project
              </div>
              <div style={{ fontWeight: 600 }}>Stage Systems Package</div>
              <div style={{ color: "#5b616e" }}>Main Auditorium — Phase 1</div>
            </div>
          </div>

          {showCover && (
            <div style={{ fontSize: 12.5, color: "#3a3f4a", lineHeight: 1.65, marginBottom: 24 }}>
              {p.quoteNote}
            </div>
          )}

          {/* sections */}
          {previewSections.map((ps) => (
            <div key={ps.heading}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  background: "#16181d",
                  color: "#fff",
                  padding: "8px 13px",
                  borderRadius: 4,
                  marginBottom: 2,
                  marginTop: 14,
                }}
              >
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{ps.heading}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{ps.subtotalLabel}</span>
              </div>
              {isItemized && (
                <div style={{ marginBottom: 6 }}>
                  {ps.lines.map((ln) => (
                    <div
                      key={ln.key}
                      style={{
                        display: "grid",
                        gridTemplateColumns: lineCols,
                        gap: 8,
                        padding: "8px 13px 6px",
                        fontSize: 12.5,
                        borderBottom: "1px solid #f0f1f4",
                        alignItems: "center",
                      }}
                    >
                      <span>
                        {ln.desc}
                        {ln.showComment && (
                          <span
                            style={{
                              display: "block",
                              fontSize: 11,
                              color: "#8c919c",
                              marginTop: 2,
                              lineHeight: 1.35,
                            }}
                          >
                            {ln.comment}
                          </span>
                        )}
                      </span>
                      {p.pdfQty && (
                        <span
                          style={{ fontFamily: "var(--font-mono)", textAlign: "right", color: "#8c919c" }}
                        >
                          {ln.qty} {ln.unit}
                        </span>
                      )}
                      <span
                        style={{ fontFamily: "var(--font-mono)", textAlign: "right", fontWeight: 600 }}
                      >
                        {ln.ext}
                      </span>
                    </div>
                  ))}
                  {ps.hasFreight && (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: lineCols,
                        gap: 8,
                        padding: "8px 13px 6px",
                        fontSize: 12.5,
                        borderBottom: "1px solid #f0f1f4",
                        alignItems: "center",
                        color: "#5b616e",
                      }}
                    >
                      <span>Freight &amp; delivery</span>
                      {p.pdfQty && <span></span>}
                      <span
                        style={{ fontFamily: "var(--font-mono)", textAlign: "right", fontWeight: 600 }}
                      >
                        {ps.freightLabel}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* totals */}
          <div style={{ borderTop: "2px solid #16181d", paddingTop: 14, marginTop: 20 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12.5,
                color: "#5b616e",
                marginBottom: 6,
              }}
            >
              <span>Materials</span>
              <span style={{ fontFamily: "var(--font-mono)" }}>{fmt(p.t.mat)}</span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12.5,
                color: "#5b616e",
                marginBottom: 6,
              }}
            >
              <span>Labor — installation &amp; commissioning</span>
              <span style={{ fontFamily: "var(--font-mono)" }}>{fmt(p.t.lab)}</span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12.5,
                color: "#5b616e",
                marginBottom: 10,
              }}
            >
              <span>Freight &amp; delivery</span>
              <span style={{ fontFamily: "var(--font-mono)" }}>{fmt(p.t.fr)}</span>
            </div>
            {p.t.tax > 0 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 12.5,
                  color: "#5b616e",
                  marginBottom: 10,
                }}
              >
                <span>Sales tax ({p.taxRatePct}%)</span>
                <span style={{ fontFamily: "var(--font-mono)" }}>{fmt(p.t.tax)}</span>
              </div>
            )}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: "#f7f8fa",
                borderRadius: 6,
                padding: "13px 15px",
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 700 }}>Total</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 600 }}>
                {fmt(p.t.grand)}
              </span>
            </div>
            {p.pdfTerms && (
              <div style={{ fontSize: 11, color: "#9aa0ab", marginTop: 12, lineHeight: 1.6 }}>
                Valid 30 days. Pricing reflects current manufacturer list. Acceptance generates a
                sales order in QuickBooks. Installation scheduled upon receipt of signed quote and
                40% deposit.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
