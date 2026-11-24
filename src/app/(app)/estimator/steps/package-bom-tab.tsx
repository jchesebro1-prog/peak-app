"use client";

import { memo, useEffect, useMemo, useState, type CSSProperties } from "react";
import QuoteDocument, { QUOTE_WEB_EMBED_CSS } from "../quote-document";
import { liveBomDocumentProps } from "@/lib/estimate-output/live-bom";
import { bomModelSkus, type BomModelPart, type BomModelParts } from "@/lib/estimate-output/bom-models";
import { bomModelPartsAction } from "../actions";
import { previewPath } from "@/lib/estimate-output/package-preview";
import { bomPdfPath } from "@/lib/estimate-output/bom-pdf";
import { BOOK_COVER_COPY, quoteDatasheetsPdfPath } from "@/lib/part-docs/datasheet-book-cover";
import type { EstimatorState } from "../use-estimator-state";
import { VendorsCard } from "./vendors-card";
import { QuotePeopleFields } from "../quote-people-fields";
import { PaymentTermsSelect } from "../preview-doc";
import { PAYMENT_TERMS } from "../types";
import { bomPricesHiddenNote, bomSwitchShown } from "@/lib/estimate-box-sale/rules";

/** Copy for the BOM Estimate Generator tab (spec 2026-10-12 §4.3; #379). */
export const BOM_TAB_COPY = {
  settings: "Estimate settings",
  settingsHint: "Every switch re-draws the preview on the right and is saved with the estimate.",
  showOnEstimate: "Show on the estimate",
  sections: "Sections",
  people: "People",
  live: "Live",
  liveNote: "shows unsaved changes. The client gets this estimate once it's saved and sent.",
  openSaved: "Open saved preview ↗",
  downloadPdf: "Download PDF",
  openPdf: "Open PDF ↗",
  saveFirst: "Save first — the PDF prints the saved estimate.",
  saveToCreate: "Save to create the PDF.",
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
// #379: the settings panel beside the live preview.
const H2: CSSProperties = { margin: 0, fontSize: 11, fontWeight: 700, color: "#9aa0ab", textTransform: "uppercase", letterSpacing: ".06em" };
const H3: CSSProperties = { margin: 0, fontSize: 12, fontWeight: 700, color: "#16181d" };
const HINT: CSSProperties = { fontSize: 11.5, color: "#8c919c", lineHeight: 1.45 };
const GROUP: CSSProperties = { display: "flex", flexDirection: "column", gap: 7 };
const ROW: CSSProperties = { display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#3a3f4a", cursor: "pointer" };

/**
 * #333 (spec §4.3, D-TBD-c); #379 (Jeff 2026-11-24) — Build package → BOM
 * Estimate Generator: the settings on the left, and on the right the itemized,
 * priced estimate exactly as the customer's document prints it, built in the browser
 * from the UNSAVED editor state (liveBomDocumentProps = bomViewProps over
 * quoteDocumentDataFor — the saved preview's own path), so every edit on
 * Build shows on the next render with no network call. Read-only. Code-split
 * by the shell (next/dynamic), so QuoteDocument and the letterhead reach only
 * this chunk. Download PDF / Open PDF ↗ (2026-10-20) print the SAVED estimate's BOM view through /api/quotes/[id]/bom-pdf;
 * Download datasheet package (2026-10-30) is the saved estimate's datasheet book.
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
    loadedId,
    contentUnsaved,
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
    }),
    [quoteId, projectName, customerId, docCustName, locationId, contactName, quoteNote, assumptions, owner, preparedBy, paymentTerms, sections, groups, vendorQuotes, pdfOpts, revNum, revDateMs, portal, customers, companyName, logoDark]
  );
  const [shown, setShown] = useState<LiveBomInput | null>(null);
  if (active && shown !== input) setShown(input);
  const props = useMemo(() => (shown ? liveBomDocumentProps(shown) : null), [shown]);
  // #365 — "Model — Description" on each plain catalog line. The SKUs come from
  // the SHOWN input, so a hidden tab reads nothing (review K); each SKU is read
  // once through bomModelPartsAction (the saved views' own catalog read) and a
  // miss is remembered as null. Until the first read lands — or if it fails —
  // the tab prints descriptions only.
  const [modelCache, setModelCache] = useState<Record<string, BomModelPart | null>>({});
  const modelSkus = useMemo(() => bomModelSkus(shown?.sections), [shown]);
  const missingSkus = modelSkus.filter((sku) => !Object.prototype.hasOwnProperty.call(modelCache, sku)).join("\n");
  useEffect(() => {
    if (!missingSkus) return;
    const want = missingSkus.split("\n");
    let stale = false;
    bomModelPartsAction(want)
      .then((got) => {
        if (stale) return;
        setModelCache((c) => {
          const next = { ...c };
          for (const sku of want) next[sku] = Object.prototype.hasOwnProperty.call(got, sku) ? got[sku] : null;
          return next;
        });
      })
      .catch(() => {
        /* descriptions only — the next SKU change asks again */
      });
    return () => {
      stale = true;
    };
  }, [missingSkus]);
  const bomModelParts = useMemo((): BomModelParts | undefined => {
    const hits = Object.entries(modelCache).filter((e): e is [string, BomModelPart] => e[1] !== null);
    return Object.keys(modelCache).length ? Object.fromEntries(hits) : undefined;
  }, [modelCache]);
  const docProps = useMemo(() => (props && bomModelParts ? { ...props, bomModelParts } : props), [props, bomModelParts]);
  const empty = (shown?.sections ?? sections).every((sec) => !sec.items.length);

  /** One settings switch. `locked` shows why it can't be changed. */
  const toggle = (label: string, on: boolean, onChange: () => void, opts: { locked?: string; hint?: string; testId?: string } = {}) => (
    <label key={label} title={opts.locked || opts.hint} style={{ ...ROW, ...(opts.locked ? { cursor: "not-allowed", opacity: 0.6 } : {}) }}>
      <input type="checkbox" role="switch" aria-checked={on} checked={on} disabled={!!opts.locked} onChange={onChange} data-testid={opts.testId} style={{ accentColor: "var(--accent)", flexShrink: 0 }} />
      <span>{label}</span>
    </label>
  );

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", background: "#f7f8fa" }}>
      {/* Left: the settings. Every switch is saved with the quote (pdfOptions) and re-draws the preview at once. */}
      <aside aria-label={BOM_TAB_COPY.settings} className="est-scroll" style={{ width: 320, flexShrink: 0, overflowY: "auto", background: "#fff", borderRight: "1px solid #e4e7ec", padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={GROUP}>
          <h2 style={H2}>{BOM_TAB_COPY.settings}</h2>
          <span style={HINT}>{BOM_TAB_COPY.settingsHint}</span>
        </div>
        {/* The estimate-wide Show prices / Show quantities (pdfPrices / pdfQty). */}
        <div data-testid="bom-show-toggles" role="group" aria-label={BOM_TAB_COPY.showOnEstimate} style={GROUP}>
          <h3 style={H3}>{BOM_TAB_COPY.showOnEstimate}</h3>
          {toggle("Show prices", pdfOpts.pdfPrices, () => togglePdf("pdfPrices"))}
          {toggle("Show quantities", pdfOpts.pdfQty, () => togglePdf("pdfQty"))}
        </div>
        {/* #364 — Show on BOM: applied by bomViewProps to this preview, the estimate PDF, the saved preview's BOM and
            the client's online BOM. Line prices yields to Show prices. */}
        <div role="group" aria-label={BOM_TAB_COPY.showOnBom} style={GROUP}>
          <h3 style={H3}>{BOM_TAB_COPY.showOnBom}</h3>
          {BOM_SHOW_SWITCHES.filter(({ flag }) => bomSwitchShown(flag, s.boxSale)).map(({ flag, label }) => {
            const locked = flag === "bomLinePrices" && !pdfOpts.pdfPrices;
            return toggle(label, pdfOpts[flag] && !locked, () => togglePdf(flag), { locked: locked ? bomPricesHiddenNote(s.boxSale) : undefined });
          })}
          <span style={HINT}>{BOM_TAB_COPY.showOnBomHint}</span>
        </div>
        {/* Payment terms, Terms, Options and the Cover note toggle. The cover note's text is the header's
            Quote details → Quote note, on every step. */}
        <div data-testid="bom-document-controls" role="group" aria-label={BOM_TAB_COPY.sections} style={GROUP}>
          <h3 style={H3}>{BOM_TAB_COPY.sections}</h3>
          {toggle("Cover note", pdfOpts.pdfCover, () => togglePdf("pdfCover"), { hint: "The cover note at the top of the estimate (edit its text under Quote details → Quote note)" })}
          {toggle("Options", pdfOpts.pdfOptions, () => togglePdf("pdfOptions"))}
          {toggle("Terms", pdfOpts.pdfTerms, () => togglePdf("pdfTerms"))}
          <span style={{ ...ROW, cursor: "default", justifyContent: "space-between" }}>
            <span>Payment terms</span>
            <PaymentTermsSelect value={paymentTerms} options={PAYMENT_TERMS} onChange={s.setPaymentTerms} />
          </span>
        </div>
        {/* Lead estimator / Prepared by print on the estimate. */}
        <div data-testid="bom-people" style={GROUP}>
          <h3 style={H3}>{BOM_TAB_COPY.people}</h3>
          <QuotePeopleFields s={s} tone="light" />
        </div>
        <details style={{ borderTop: "1px solid #f0f1f4", paddingTop: 10 }}>
          <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "#16181d" }}>Vendors</summary>
          <div style={{ marginTop: 10 }}>
            {loadedId ? <VendorsCard quoteId={loadedId} vendorQuotes={vendorQuotes} refreshKey={0} /> : <div style={{ fontSize: 11.5, color: "#aab0bb" }}>Save the estimate first.</div>}
          </div>
        </details>
      </aside>

      {/* Right: the live preview */}
      <div className="est-scroll" data-testid="bom-preview" style={{ flex: 1, minWidth: 0, overflowY: "auto" }}>
        <div style={{ maxWidth: 820, margin: "0 auto", padding: "18px 16px 40px" }}>
          <div role="note" style={STRIP}>
            <span>
              <strong style={{ color: "#16181d" }}>{BOM_TAB_COPY.live}</strong> — {BOM_TAB_COPY.liveNote}
            </span>
            {loadedId ? (
              <>
                <a href={bomPdfPath(loadedId, true)} target="_blank" rel="noopener noreferrer" style={LINK}>
                  {BOM_TAB_COPY.downloadPdf}
                </a>
                <a href={bomPdfPath(loadedId, false)} target="_blank" rel="noopener noreferrer" style={LINK}>
                  {BOM_TAB_COPY.openPdf}
                </a>
                <a href={previewPath(loadedId, "bom")} target="_blank" rel="noopener noreferrer" style={LINK}>
                  {BOM_TAB_COPY.openSaved}
                </a>
                {/* The datasheet book (cover, index, datasheets) — its choices are on the Datasheets tab; a box sale has none. */}
                <a
                  href={quoteDatasheetsPdfPath(loadedId)}
                  download
                  data-testid="bom-datasheets-pdf"
                  style={LINK}
                  title="One PDF: a cover with our logo and the customer's job details, then every datasheet A→Z by manufacturer — from the saved estimate, honouring the Datasheets tab's choices"
                >
                  {BOOK_COVER_COPY.estimateButton}
                </a>
                {contentUnsaved && <span style={{ color: "#8a6d1f" }}>{BOM_TAB_COPY.saveFirst}</span>}
              </>
            ) : (
              <span aria-disabled="true" style={{ color: "#9aa0ab", fontWeight: 600 }}>
                {BOM_TAB_COPY.downloadPdf} — {BOM_TAB_COPY.saveToCreate}
              </span>
            )}
            {!pdfOpts.pdfPrices && <span style={{ flexBasis: "100%", color: "#8a6d1f" }}>{bomPricesHiddenNote(s.boxSale)}</span>}
          </div>
          {empty ? (
            <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 12, padding: "40px 24px", textAlign: "center", fontSize: 14, fontWeight: 600, color: "#5b616e" }}>
              {BOM_TAB_COPY.empty}
            </div>
          ) : docProps ? (
            <BomDocument props={docProps} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
