"use client";

import type { CSSProperties } from "react";
import letterhead from "./peak-letterhead.jpg";
import { fmt, systemFreight, systemItemsRev, type QuoteTotals } from "./pricing";
import type { PaymentTerms, SpecItem, SpecSection, VendorQuote } from "./types";

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

const ACCENT_INK = "color-mix(in srgb, var(--accent) 72%, #000)";
const ACCENT_BD = "color-mix(in srgb, var(--accent) 28%, #fff)";

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

const microLabel: CSSProperties = {
  color: "#9aa0ab",
  textTransform: "uppercase",
  fontSize: 10,
  letterSpacing: ".06em",
  marginBottom: 3,
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
  projectName: string;
  /** "Label — City" for the selected customer venue ("" when none). */
  venueLabel: string;
  ownerName: string;
  companyName: string;
  /** Uploaded document logo (Settings → Branding), falls back to the baked letterhead. */
  logoDark: string | null;
  quoteNote: string;
  sections: SpecSection[];
  setSectionPresentation: (id: string, value: "itemized" | "narrative") => void;
  /** #143 — a vendor line reads from its record here too, but NEVER its cost,
   *  terms or notes: those are internal only (Jeff). */
  vendorQuotes: VendorQuote[];
  t: QuoteTotals;
  taxRatePct: number;
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
  togglePdf: (flag: "pdfQty" | "pdfNotes" | "pdfPrices" | "pdfCover" | "pdfTerms" | "pdfOptions") => void;
};

const DAY_MS = 86400000;

function longDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function PreviewDoc(p: PreviewProps) {
  const isItemized = p.detail === "itemized";
  const showLines = p.pdfQty || p.pdfNotes || p.pdfPrices;
  const lineCols = [p.pdfNotes ? "1fr" : "", p.pdfQty ? "70px" : "", p.pdfPrices ? "104px" : ""].filter(Boolean).join(" ");
  const showCover = !!(p.pdfCover && p.quoteNote && p.quoteNote.trim());
  const revDateLabel = longDate(p.revDateMs);
  const validThruLabel = longDate(p.revDateMs + 30 * DAY_MS);

  const previewSections = p.sections
    .filter((sec) => systemItemsRev(sec) > 0 || systemFreight(sec) > 0)
    .map((sec, i) => {
      const visible = sec.items.filter((x) => !x.option);
      const secFr = systemFreight(sec);
      const sub = systemItemsRev(sec) + secFr;
      return {
        id: sec.id,
        num: i + 1,
        name: sec.name,
        narrative: (sec.narrative || "").trim(),
        presentation: sec.presentation || "itemized",
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
                  sub: [] as { key: string; qty: number; unit: string; text: string }[],
                  qty: "" as string | number,
                  unit: "",
                  ext: fmt(visible.reduce((a, it) => a + it.qty * it.price, 0)),
                },
              ]
            : visible.map((it) => {
                /* #143: a vendor quote shows as one line reading
                   "Vendor · Quote no. — Description", or, set to Itemized, the
                   same line with its material descriptions underneath and the
                   price rolled up on the parent. Terms, notes and the vendor's
                   cost never appear here. */
                const vq = it.vendorQuoteId
                  ? p.vendorQuotes.find((v) => v.id === it.vendorQuoteId)
                  : undefined;
                const desc = vq
                  ? vq.vendor + " \u00b7 " + vq.quoteNumber + " \u2014 " + vq.description
                  : it.allowance
                  ? "Budget allowance — " + it.desc
                  : it.desc;
                return {
                  key: String(it.id),
                  desc,
                  comment: (it.comment || "").trim(),
                  showComment: !!(p.pdfNotes && it.comment && it.comment.trim()),
                  /* Qty/unit stay SEPARATE from the text (#143 re-review):
                     baked into the description they printed straight past the
                     Quantities toggle the rest of the document obeys. */
                  sub:
                    vq && vq.display === "itemized"
                      ? vq.lines.map((l) => ({
                          key: String(l.id),
                          qty: l.qty,
                          unit: l.unit,
                          text: l.description,
                        }))
                      : [],
                  qty: it.qty as string | number,
                  unit: it.unit,
                  ext: fmt(it.qty * it.price),
                };
              }),
      };
    });

  const lineCount = previewSections.reduce((a, s) => a + s.lines.length, 0);
  const optionItems: Array<{ sec: string; it: SpecItem }> = [];
  p.sections.forEach((sec) =>
    sec.items.forEach((it) => {
      if (it.option) optionItems.push({ sec: sec.name, it });
    })
  );
  const showOptions = p.pdfOptions && optionItems.length > 0;

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
          {/* letterhead — uploaded logo when set, baked sheet otherwise (D59 ladder) */}
          <div style={{ borderBottom: `3px solid var(--accent)`, paddingBottom: 16, marginBottom: 22 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.logoDark || letterhead.src}
              alt={p.companyName}
              style={
                p.logoDark
                  ? { display: "block", maxHeight: 76, maxWidth: "100%", objectFit: "contain" }
                  : { display: "block", width: "100%", height: "auto" }
              }
            />
          </div>

          {/* document title */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-end",
              gap: 16,
              marginBottom: 22,
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 27,
                  fontWeight: 700,
                  letterSpacing: ".14em",
                  lineHeight: 1,
                  color: "#16181d",
                }}
              >
                QUOTE
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  color: ACCENT_INK,
                  marginTop: 7,
                }}
              >
                {p.quoteId} · REV {p.revNum}
              </div>
            </div>
            <div
              style={{
                textAlign: "right",
                fontSize: 11.5,
                color: "#5b616e",
                lineHeight: 1.75,
              }}
            >
              <div>
                Issued <strong style={{ color: "#16181d" }}>{revDateLabel}</strong>
              </div>
              <div>
                Valid through <strong style={{ color: "#16181d" }}>{validThruLabel}</strong>
              </div>
            </div>
          </div>

          {/* prepared for / project / prepared by */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.1fr 1.3fr 1fr",
              gap: 18,
              marginBottom: 20,
              fontSize: 12,
            }}
          >
            <div>
              <div style={microLabel}>Prepared for</div>
              <div style={{ fontWeight: 600 }}>{p.custName}</div>
              {p.hasAttn && <div style={{ color: "#5b616e" }}>Attn: {p.attnLine}</div>}
            </div>
            <div>
              <div style={microLabel}>Project</div>
              <div style={{ fontWeight: 600 }}>{p.projectName || "Stage systems package"}</div>
              {p.venueLabel && <div style={{ color: "#5b616e" }}>{p.venueLabel}</div>}
            </div>
            <div>
              <div style={microLabel}>Prepared by</div>
              <div style={{ fontWeight: 600 }}>{p.ownerName}</div>
              <div style={{ color: "#5b616e" }}>{p.companyName}</div>
            </div>
          </div>

          {/* at-a-glance investment band */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 14,
              flexWrap: "wrap",
              background: "var(--accent-soft)",
              border: `1px solid ${ACCENT_BD}`,
              borderRadius: 8,
              padding: "13px 16px",
              marginBottom: 24,
            }}
          >
            <div>
              <div style={{ ...microLabel, color: ACCENT_INK, marginBottom: 2 }}>
                Total investment
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 21,
                  fontWeight: 600,
                  letterSpacing: "-.01em",
                  color: "#16181d",
                }}
              >
                {fmt(p.t.grand)}
              </div>
            </div>
            <div style={{ textAlign: "right", fontSize: 11.5, color: "#5b616e", lineHeight: 1.7 }}>
              <div>
                {previewSections.length} {previewSections.length === 1 ? "system" : "systems"} ·{" "}
                {lineCount} line {lineCount === 1 ? "item" : "items"}
                {optionItems.length > 0 && showOptions
                  ? ` · ${optionItems.length} optional`
                  : ""}
              </div>
              <div>Materials, installation &amp; freight included</div>
            </div>
          </div>

          {showCover && (
            <div
              style={{
                fontSize: 12.5,
                color: "#3a3f4a",
                lineHeight: 1.7,
                marginBottom: 26,
                paddingLeft: 14,
                borderLeft: `3px solid ${ACCENT_BD}`,
              }}
            >
              {p.quoteNote}
            </div>
          )}

          {/* sections */}
          {previewSections.map((ps) => (
            <div key={ps.num + ps.name}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  background: "#16181d",
                  color: "#fff",
                  padding: "8px 13px 8px 10px",
                  borderRadius: 4,
                  borderLeft: "4px solid var(--accent)",
                  marginBottom: 2,
                  marginTop: 14,
                }}
              >
                <span style={{ display: "flex", alignItems: "baseline", gap: 9, minWidth: 0 }}>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10.5,
                      opacity: 0.65,
                      flexShrink: 0,
                    }}
                  >
                    {String(ps.num).padStart(2, "0")}
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{ps.name}</span>
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, flexShrink: 0 }}>
                  {ps.subtotalLabel}
                  <button type="button" onClick={() => p.setSectionPresentation(ps.id, ps.presentation === "narrative" ? "itemized" : "narrative")} style={{ marginLeft: 8, border: "1px solid rgba(255,255,255,.25)", borderRadius: 5, background: "transparent", color: "#fff", fontSize: 10, padding: "3px 6px", cursor: "pointer" }}>
                    {ps.presentation === "narrative" ? "Narrative" : "Itemized"}
                  </button>
                </span>
              </div>
              {ps.presentation === "narrative" ? (
                <div style={{ padding: "10px 13px 12px", fontSize: 12.5, color: "#3a3f4a", lineHeight: 1.55, borderBottom: "1px solid #f0f1f4" }}>
                  {ps.narrative || "System scope and pricing are included in the total above."}
                </div>
              ) : isItemized && showLines ? (
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
                      {p.pdfNotes && <span>
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
                        {ln.sub.map((sl) => (
                          <span
                            key={sl.key}
                            style={{
                              display: "block",
                              fontSize: 11,
                              color: "#8c919c",
                              marginTop: 2,
                              paddingLeft: 12,
                              lineHeight: 1.35,
                            }}
                          >
                            {p.pdfQty && (
                              <span style={{ fontFamily: "var(--font-mono)", marginRight: 6 }}>
                                {sl.qty} {sl.unit}
                              </span>
                            )}
                            {sl.text}
                          </span>
                        ))}
                      </span>}
                      {p.pdfQty && (
                        <span
                          style={{ fontFamily: "var(--font-mono)", textAlign: "right", color: "#8c919c" }}
                        >
                          {ln.qty} {ln.unit}
                        </span>
                      )}
                      {p.pdfPrices && (
                        <span
                          style={{ fontFamily: "var(--font-mono)", textAlign: "right", fontWeight: 600 }}
                        >
                          {ln.ext}
                        </span>
                      )}
                    </div>
                  ))}
                  {ps.hasFreight && (p.pdfNotes || p.pdfPrices) && (
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
                      {p.pdfNotes && <span>Freight &amp; delivery</span>}
                      {p.pdfQty && <span></span>}
                      {p.pdfPrices && (
                        <span
                          style={{ fontFamily: "var(--font-mono)", textAlign: "right", fontWeight: 600 }}
                        >
                          {ps.freightLabel}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ) : !isItemized ? (
                <div
                  style={{
                    padding: "7px 13px 9px",
                    fontSize: 11.5,
                    color: "#8c919c",
                    borderBottom: "1px solid #f0f1f4",
                    marginBottom: 6,
                  }}
                >
                  {ps.lines.length} line {ps.lines.length === 1 ? "item" : "items"}
                  {ps.hasFreight ? " · includes freight & delivery" : ""}
                </div>
              ) : null}
            </div>
          ))}

          {/* optional additions — priced, not in the total */}
          {showOptions && (
            <div
              style={{
                border: `1px dashed ${ACCENT_BD}`,
                borderRadius: 6,
                padding: "12px 14px",
                marginTop: 20,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: 10,
                  marginBottom: 4,
                }}
              >
                <span style={{ fontSize: 12.5, fontWeight: 700, color: ACCENT_INK }}>
                  Optional additions
                </span>
                <span style={{ fontSize: 11, color: "#8c919c" }}>
                  Priced separately — not included in the total
                </span>
              </div>
              {optionItems.map(({ sec, it }) => (
                <div
                  key={sec + "-" + it.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: lineCols,
                    gap: 8,
                    padding: "7px 0 5px",
                    fontSize: 12.5,
                    borderBottom: "1px solid #f0f1f4",
                    alignItems: "center",
                  }}
                >
                  <span>
                    {it.desc}
                    <span style={{ display: "block", fontSize: 10.5, color: "#9aa0ab", marginTop: 1 }}>
                      {sec}
                    </span>
                  </span>
                  {p.pdfQty && (
                    <span style={{ fontFamily: "var(--font-mono)", textAlign: "right", color: "#8c919c" }}>
                      {it.qty} {it.unit}
                    </span>
                  )}
                  {p.pdfPrices && (
                    <span style={{ fontFamily: "var(--font-mono)", textAlign: "right", fontWeight: 600 }}>
                      {fmt(it.qty * it.price)}
                    </span>
                  )}
                </div>
              ))}
              <div style={{ fontSize: 11, color: "#8c919c", marginTop: 8, lineHeight: 1.5 }}>
                Want any of these included? Let us know and we’ll issue a revised quote.
              </div>
            </div>
          )}

          {/* totals */}
          <div style={{ borderTop: "2px solid #16181d", paddingTop: 14, marginTop: 22 }}>
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
                background: "var(--accent)",
                color: "#fff",
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
              <>
                <div style={{ marginTop: 18 }}>
                  <div style={{ ...microLabel, marginBottom: 6 }}>Terms</div>
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: 16,
                      fontSize: 11,
                      color: "#5b616e",
                      lineHeight: 1.75,
                    }}
                  >
                    {["This quote is valid for 30 days from the issue date.", `Payment terms: ${p.paymentTerms}.`].map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>

                {/* acceptance */}
                <div
                  style={{
                    borderTop: "1px solid #ececf0",
                    marginTop: 16,
                    paddingTop: 14,
                  }}
                >
                  <div style={{ ...microLabel, marginBottom: 2 }}>Acceptance</div>
                  <div style={{ fontSize: 11.5, color: "#5b616e", lineHeight: 1.6, marginBottom: 18 }}>
                    To proceed, sign and return this quote — or accept it online through your{" "}
                    {p.companyName} customer portal.
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "2fr 1.4fr 1fr",
                      gap: 22,
                      fontSize: 10.5,
                      color: "#8c919c",
                    }}
                  >
                    <div style={{ borderTop: "1px solid #9aa0ab", paddingTop: 5 }}>
                      Signature — accepted for {p.custName}
                    </div>
                    <div style={{ borderTop: "1px solid #9aa0ab", paddingTop: 5 }}>
                      Name &amp; title
                    </div>
                    <div style={{ borderTop: "1px solid #9aa0ab", paddingTop: 5 }}>Date</div>
                  </div>
                </div>
              </>
            )}

            {/* footer */}
            <div
              style={{
                borderTop: "1px solid #ececf0",
                marginTop: 20,
                paddingTop: 10,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: 10.5, color: "#9aa0ab" }}>
                Questions? Reach out to {p.ownerName} — we’re glad to walk through any line.
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#aab0bb" }}>
                {p.companyName} · {p.quoteId} · REV {p.revNum} · {revDateLabel}
              </span>
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
