"use client";

import { useMemo, type CSSProperties } from "react";
import QuoteDocument, { QUOTE_WEB_CSS } from "../quote-document";
import { liveBomDocumentProps } from "@/lib/estimate-output/live-bom";
import { previewPath } from "@/lib/estimate-output/package-preview";
import type { EstimatorState } from "../use-estimator-state";

/** Copy for the BOM quote tab (spec 2026-10-12 §4.3). */
export const BOM_TAB_COPY = {
  live: "Live",
  liveNote: "shows unsaved changes. The client sees this view once it's saved and sent.",
  openSaved: "Open saved preview ↗",
  pricesHidden: "Prices are hidden on client documents (Client package → Line detail).",
  empty: "Add a system on Build to see the BOM.",
} as const;

const STRIP: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 14px", fontSize: 12, color: "#5b616e", lineHeight: 1.45, marginBottom: 12 };
const LINK: CSSProperties = { color: "var(--accent)", fontWeight: 600, textDecoration: "none" };

/**
 * #333 (spec §4.3, D-TBD-c) — Build package → BOM quote: the itemized, priced
 * quote exactly as the customer's BOM view prints it, built in the browser
 * from the UNSAVED editor state (liveBomDocumentProps = bomViewProps over
 * quoteDocumentDataFor — the saved preview's own path), so every edit on
 * Build shows on the next render with no network call. Read-only. Code-split
 * by the shell (next/dynamic), so QuoteDocument and the letterhead reach only
 * this chunk.
 */
export default function PackageBomTab({ s }: { s: EstimatorState }) {
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
  } = s;
  const portal = initial.portal;
  const props = useMemo(
    () =>
      liveBomDocumentProps({
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
  const empty = sections.every((sec) => !sec.items.length);

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
          {!pdfOpts.pdfPrices && <span style={{ flexBasis: "100%", color: "#8a6d1f" }}>{BOM_TAB_COPY.pricesHidden}</span>}
        </div>
        {empty ? (
          <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 12, padding: "40px 24px", textAlign: "center", fontSize: 14, fontWeight: 600, color: "#5b616e" }}>
            {BOM_TAB_COPY.empty}
          </div>
        ) : (
          <>
            <style>{QUOTE_WEB_CSS}</style>
            <QuoteDocument {...props} layout="web" />
          </>
        )}
      </div>
    </div>
  );
}
