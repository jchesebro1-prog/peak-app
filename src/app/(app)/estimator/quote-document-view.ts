import { systemFreight, systemItemsRev, systemSellTotal } from "./pricing";
import type { SpecSection } from "./types";

/**
 * #293 — QuoteDocument's pure view helpers, kept out of quote-document.tsx
 * (which imports a .jpg the Node harness can't load). The printed-systems
 * predicate is QuoteDocument's own `previewSections` filter, verbatim.
 */

/** Systems whose lines the body didn't itemize — every narrative system, or
 *  every system when the document prints by section — among those the body
 *  prints at all (some revenue). The Itemized appendix lists exactly these. */
export function appendixSystemIds(sections: SpecSection[], detail: "itemized" | "sectioned"): string[] {
  return (sections || [])
    .filter((sec) => systemItemsRev(sec) > 0 || systemFreight(sec) > 0 || systemSellTotal(sec) > 0)
    .filter((sec) => detail === "sectioned" || (sec.presentation || "itemized") === "narrative")
    .map((sec) => sec.id);
}
