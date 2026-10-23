"use client";

import { memo, useMemo, useState, type CSSProperties } from "react";
import QuoteDocument, { QUOTE_WEB_EMBED_CSS } from "../quote-document";
import { liveBomDocumentProps } from "@/lib/estimate-output/live-bom";
import { previewPath } from "@/lib/estimate-output/package-preview";
import { bomPdfPath } from "@/lib/estimate-output/bom-pdf";
import type { EstimatorState } from "../use-estimator-state";
import { VendorsCard } from "./vendors-card";
import { QuotePeopleFields } from "../quote-people-fields";

/** Copy for the BOM quote tab (spec 2026-10-12 §4.3). */
export const BOM_TAB_COPY = {
  live: "Live",
  liveNote: "shows unsaved changes. The client sees this view once it's saved and sent.",
  openSaved: "Open saved preview ↗",
  downloadPdf: "Download PDF",
  openPdf: "Open PDF ↗",
  saveFirst: "Save first — the PDF prints the saved estimate.",
  saveToCreate: "Save to create the PDF.",
  pricesHidden: "Prices are hidden on client documents (Client package → Line detail).",
  empty: "Add a system on Build to see the BOM.",
  // #364 — Show on BOM.
  showOnBom: "Show on BOM",
  showOnBomHint: "System prices, tax and the Total always show.",
} as const;

/** #364 — the four saved Show on BOM switches (pdfOptions.bom*), in order. */
export const BOM_SHOW_SWITCHES = [
  { flag: "bomLinePrices", label: "Line prices" },
  { flag: "bomMaterials", label: "Materials" },
  { flag: "bomLabor", label: "Labor" },
  { flag: "bomFreight", label: "Freight" },
] as const;

const STRIP: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 14px", fontSize: 12, color: "#5b616e", lineHeight: 1.45, marginBottom: 12 };
const LINK: CSSProperties = { color: "var(--accent)", fontWeight: 600, textDecoration: "none" };
// #364: the Show on BOM switches — preview-doc.tsx's segmented ✓ toggles.
const SEG_WRAP: CSSProperties = { display: "inline-flex", flexWrap: "wrap", gap: 2, background: "#f1f2f5", borderRadius: 7, padding: 2 };
const SEG: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 12, padding: "5px 13px", borderRadius: 5, border: "none", cursor: "pointer" };
const SEG_ON: CSSProperties = { ...SEG, fontWeight: 600, background: "#fff", color: "#16181d", boxShadow: "0 1px 2px rgba(0,0,0,.1)" };
const SEG_OFF: CSSProperties = { ...SEG, fontWeight: 500, background: "transparent", color: "#9aa0ab" };

/**
 * #333 (spec §4.3, D-TBD-c) — Build package → BOM quote: the itemized, priced
 * quote exactly as the customer's BOM view prints it, built in the browser
 * from the UNSAVED editor state (liveBomDocumentProps = bomViewProps over
 * quoteDocumentDataFor — the saved preview's own path), so every edit on
 * Build shows on the next render with no network call. Read-only. Code-split
 * by the shell (next/dynamic), so QuoteDocument and the letterhead reach only
 * this chunk. Download PDF / Open PDF ↗ (2026-10-20) print the SAVED estimate's BOM view through /api/quotes/[id]/bom-pdf.
 */
type LiveBomInput = Parameters<typeof liveBomDocumentProps>[0];

/** The customer document, memoised: a hidden tab's re-renders never reach it (#333 review K). */
const BomDocument = memo(function BomDocument({ props }: { props: ReturnType<typeof liveBomDocumentProps> }) {
  return (
    <>
      {/* #333 review (L): the scoped web CSS — no page-level print rules on the Estimator page. */}
      <style>{QUOTE_WEB_EMBED_CSS}</style>
      <QuoteDocument {...props} layout="web" />
    </>
  );
});

export default function PackageBomTab({ s, active }: { s: EstimatorState; active: boolean }) {
  const {
    quoteId,
    projectName,
    customerId,
    docCustName,
    locationId,
    contactName,
    quoteNote,
    assumptions,
    owner,
    preparedBy,
    paymentTerms,
    sections,
    groups,
    vendorQuotes,
    pdfOpts,
    revNum,
    revDateMs,
    initial,
    customers,
    companyName,
    logoDark,
    purchasePerksDocLine,
    loadedId,
    pdfDirty,
    togglePdf,
  } = s;
  const portal = initial.portal;
  // #333 review (K): the input is a cheap memo; the props (and the document)
  // follow it only while the tab shows — hidden, the last render stays as is
  // and a TipTap keystroke on Narrative never rebuilds the BOM view.
  const input = useMemo(
    (): LiveBomInput => ({
      quoteNumber: quoteId,
      projectName,
      customerId,
      custName: docCustName,
      locationId,
      contactName,
      quoteNote,
      assumptions,
      owner,
      preparedBy,
      paymentTerms,
      sections,
      groups,
      vendorQuotes,
      pdfOptions: pdfOpts,
      revNum,
      revDateMs,
      // Only a portal-catalog quote prints differently (initial.portal is set for exactly those).
      source: portal ? "portal-catalog" : null,
      portalFirm: portal?.portalFirm ?? null,
      customers,
      companyName,
      logoDark,
      rewardsLine: purchasePerksDocLine,
    }),
    [quoteId, projectName, customerId, docCustName, locationId, contactName, quoteNote, assumptions, owner, preparedBy, paymentTerms, sections, groups, vendorQuotes, pdfOpts, revNum, revDateMs, portal, customers, companyName, logoDark, purchasePerksDocLine]
  );
  const [shown, setShown] = useState<LiveBomInput | null>(null);
  if (active && shown !== input) setShown(input);
  const props = useMemo(() => (shown ? liveBomDocumentProps(shown) : null), [shown]);
  const empty = (shown?.sections ?? sections).every((sec) => !sec.items.length);

  return (
    <div className="est-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", background: "#f7f8fa" }}>
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "18px 16px 40px" }}>
        <div role="note" style={STRIP}>
          <span>
            <strong style={{ color: "#16181d" }}>{BOM_TAB_COPY.live}</strong> — {BOM_TAB_COPY.liveNote}
          </span>
          {loadedId && (
            <a href={previewPath(loadedId, "bom")} target="_blank" rel="noopener noreferrer" style={LINK}>
              {BOM_TAB_COPY.openSaved}
            </a>
          )}
          {loadedId ? (
            <>
              <a href={bomPdfPath(loadedId, true)} target="_blank" rel="noopener noreferrer" style={LINK}>
                {BOM_TAB_COPY.downloadPdf}
              </a>
              <a href={bomPdfPath(loadedId, false)} target="_blank" rel="noopener noreferrer" style={LINK}>
                {BOM_TAB_COPY.openPdf}
              </a>
              {pdfDirty && <span style={{ color: "#8a6d1f" }}>{BOM_TAB_COPY.saveFirst}</span>}
            </>
          ) : (
            <span aria-disabled="true" style={{ color: "#9aa0ab", fontWeight: 600 }}>
              {BOM_TAB_COPY.downloadPdf} — {BOM_TAB_COPY.saveToCreate}
            </span>
          )}
          {!pdfOpts.pdfPrices && <span style={{ flexBasis: "100%", color: "#8a6d1f" }}>{BOM_TAB_COPY.pricesHidden}</span>}
          {/* #364 — Show on BOM: saved with the quote (pdfOptions), applied by bomViewProps to this tab, the BOM PDF,
              the saved preview's BOM and the client's online BOM. Line prices yields to the quote-wide Prices. */}
          <span role="group" aria-label={BOM_TAB_COPY.showOnBom} style={{ flexBasis: "100%", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 10px" }}>
            <strong style={{ color: "#16181d" }}>{BOM_TAB_COPY.showOnBom}</strong>
            <span style={SEG_WRAP}>
              {BOM_SHOW_SWITCHES.map(({ flag, label }) => {
                const locked = flag === "bomLinePrices" && !pdfOpts.pdfPrices;
                const on = pdfOpts[flag] && !locked;
                return (
                  <button
                    key={flag}
                    type="button"
                    onClick={() => togglePdf(flag)}
                    disabled={locked}
                    title={locked ? BOM_TAB_COPY.pricesHidden : undefined}
                    aria-pressed={on}
                    style={{ ...(on ? SEG_ON : SEG_OFF), ...(locked ? { cursor: "not-allowed", opacity: 0.6 } : {}) }}
                  >
                    {(on ? "✓ " : "") + label}
                  </button>
                );
              })}
            </span>
            <span style={{ color: "#8c919c" }}>{BOM_TAB_COPY.showOnBomHint}</span>
          </span>
        </div>
        {/* Box goods sale (spec 2026-10-21): the Narrative tab's aside is gone, so Lead estimator / Prepared by live here. */}
        {s.boxSale && (
          <div data-testid="box-sale-people" style={{ display: "flex", flexDirection: "column", gap: 7, background: "#fff", border: "1px solid #ececf0", borderRadius: 12, padding: "12px 14px", marginBottom: 12, maxWidth: 360 }}>
            <QuotePeopleFields s={s} tone="light" />
          </div>
        )}
        <details open style={{ background: "#fff", border: "1px solid #ececf0", borderRadius: 12, padding: "10px 14px", marginBottom: 12 }}>
          <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "#16181d" }}>
            Vendors
          </summary>
          <div style={{ marginTop: 10 }}>
            {loadedId ? <VendorsCard quoteId={loadedId} vendorQuotes={vendorQuotes} refreshKey={0} /> : <div style={{ fontSize: 11.5, color: "#aab0bb" }}>Save the estimate first.</div>}
          </div>
        </details>
        {empty ? (
          <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 12, padding: "40px 24px", textAlign: "center", fontSize: 14, fontWeight: 600, color: "#5b616e" }}>
            {BOM_TAB_COPY.empty}
          </div>
        ) : props ? (
          <BomDocument props={props} />
        ) : null}
      </div>
    </div>
  );
}
