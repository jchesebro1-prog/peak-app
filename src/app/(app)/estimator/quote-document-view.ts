import { systemFreight, systemItemsRev, systemSellTotal } from "./pricing";
import type { SpecSection } from "./types";
import type { QuoteDocumentProps } from "./quote-document";

/**
 * #293 — QuoteDocument's pure view helpers, kept out of quote-document.tsx
 * (which imports a .jpg the Node harness can't load). The printed-systems
 * predicate is QuoteDocument's own `previewSections` filter, verbatim.
 */

/** QuoteDocument's `previewSections` filter: a system prints in the body
 *  only when it carries some revenue. */
export function systemPrintsInBody(sec: SpecSection): boolean {
  return systemItemsRev(sec) > 0 || systemFreight(sec) > 0 || systemSellTotal(sec) > 0;
}

/** Systems whose lines the body didn't itemize — every narrative system, or
 *  every system when the document prints by section — among those the body
 *  prints at all (some revenue). The Itemized appendix lists exactly these. */
export function appendixSystemIds(sections: SpecSection[], detail: "itemized" | "sectioned"): string[] {
  return (sections || [])
    .filter(systemPrintsInBody)
    .filter((sec) => detail === "sectioned" || (sec.presentation || "itemized") === "narrative")
    .map((sec) => sec.id);
}

/** #293 slice 3 (spec §2.3) — the online BOM view: every system itemized,
 *  quantities and descriptions on, the appendix off. Prices keep the quote's
 *  own choice (an estimator who hid prices still hides them). Pure. */
export function bomViewProps(p: QuoteDocumentProps): QuoteDocumentProps {
  return {
    ...p,
    detail: "itemized",
    pdfQty: true,
    pdfNotes: true,
    pdfItemizedAppendix: false,
    sections: p.sections.map((s) => ({ ...s, presentation: "itemized" as const })),
  };
}

/** The Narrative / BOM toggle is offered only when the body left some
 *  system un-itemized — otherwise the document already is the BOM. */
export function offersBomView(sections: SpecSection[], detail: "itemized" | "sectioned"): boolean {
  return appendixSystemIds(sections, detail).length > 0;
}
