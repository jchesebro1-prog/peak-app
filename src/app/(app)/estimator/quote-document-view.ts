import { systemFreight, systemItemsRev, systemSellTotal } from "./pricing";
import type { SpecSection } from "./types";
import type { QuoteDocumentProps } from "./quote-document";
import type { SystemGroup } from "@/lib/estimate-groups/groups";
import { documentApplies } from "@/lib/package-doc/print";
import type { PackageDoc } from "@/lib/package-doc/types";

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

/** Estimator Phase 2a — a group heading row on the customer document: one per
 *  group with at least one PRINTED system (systemPrintsInBody), placed before
 *  that group's first printed system, carrying the Σ systemSellTotal of its
 *  printed systems. Ungrouped systems never get one; no groups → []. Pure. */
export function printedGroupHeadings(
  sections: SpecSection[],
  groups: SystemGroup[] | undefined,
): Array<{ beforeSectionId: string; name: string; subtotal: number }> {
  if (!groups || !groups.length) return [];
  const byId = new Map(groups.map((g) => [g.id, g]));
  const out: Array<{ beforeSectionId: string; name: string; subtotal: number }> = [];
  const at = new Map<string, number>();
  for (const sec of sections || []) {
    const g = sec.groupId ? byId.get(sec.groupId) : undefined;
    // Phase 2b: an alternate system prints in the Alternates block, not the body.
    if (!g || sec.alternate === true || !systemPrintsInBody(sec)) continue;
    const i = at.get(g.id);
    if (i === undefined) {
      at.set(g.id, out.length);
      out.push({ beforeSectionId: sec.id, name: g.name, subtotal: systemSellTotal(sec) });
    } else {
      out[i].subtotal += systemSellTotal(sec);
    }
  }
  return out;
}

/** Estimator Phase 2b — the Alternates block: one entry per Alternate group
 *  with at least one printed system (an `alternate: true` system that
 *  systemPrintsInBody), in document order (first printed system), carrying
 *  those printed systems and their Σ systemSellTotal. No groups → []. Pure. */
export function alternateGroupsForPrint<S extends SpecSection>(
  sections: S[],
  groups: SystemGroup[] | undefined,
): Array<{ group: SystemGroup; subtotal: number; sections: S[] }> {
  if (!groups || !groups.length) return [];
  const byId = new Map(groups.filter((g) => g.alternate === true).map((g) => [g.id, g]));
  const out: Array<{ group: SystemGroup; subtotal: number; sections: S[] }> = [];
  const at = new Map<string, number>();
  for (const sec of sections || []) {
    const g = sec.groupId ? byId.get(sec.groupId) : undefined;
    if (!g || sec.alternate !== true || !systemPrintsInBody(sec)) continue;
    const i = at.get(g.id);
    if (i === undefined) {
      at.set(g.id, out.length);
      out.push({ group: g, subtotal: systemSellTotal(sec), sections: [sec] });
    } else {
      out[i].subtotal += systemSellTotal(sec);
      out[i].sections.push(sec);
    }
  }
  return out;
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

/** Estimator Phase 5 — the Itemized appendix's systems. No package document:
 *  exactly the #293 rule (appendixSystemIds, only when Show on PDF → Itemized
 *  appendix is on). With a document the body itemizes nothing, so an
 *  itemized system's lines would otherwise print nowhere — every printed
 *  In-total (not alternate) system whose presentation is itemized (or unset)
 *  is listed ALWAYS; narrative systems only when the toggle is on, as before.
 *  Section order is kept. Pure. */
export function documentAppendixSystemIds(
  sections: SpecSection[],
  detail: "itemized" | "sectioned",
  pdfItemizedAppendix: boolean,
  hasDocument: boolean,
): string[] {
  if (!hasDocument) return pdfItemizedAppendix ? appendixSystemIds(sections, detail) : [];
  return (sections || [])
    .filter((sec) => !!sec && sec.alternate !== true && systemPrintsInBody(sec))
    .filter((sec) => pdfItemizedAppendix || (sec.presentation || "itemized") !== "narrative")
    .map((sec) => sec.id);
}

/** #293 slice 3 (spec §2.3) — the online BOM view: every system itemized,
 *  quantities and descriptions on, the appendix off. Prices keep the quote's
 *  own choice (an estimator who hid prices still hides them). Pure. */
export function bomViewProps(p: QuoteDocumentProps): QuoteDocumentProps {
  return {
    ...p,
    // Phase 5: the BOM view is the itemized bands — never the package document.
    document: null,
    detail: "itemized",
    pdfQty: true,
    pdfNotes: true,
    pdfItemizedAppendix: false,
    sections: p.sections.map((s) => ({ ...s, presentation: "itemized" as const })),
  };
}

/** The Narrative / BOM toggle is offered only when the body left some
 *  system un-itemized — otherwise the document already is the BOM. Phase 5:
 *  a package document itemizes nothing, so it always offers the BOM view
 *  (when any system prints). */
export function offersBomView(sections: SpecSection[], detail: "itemized" | "sectioned", document?: PackageDoc | null): boolean {
  return appendixSystemIds(sections, documentApplies(document) ? "sectioned" : detail).length > 0;
}
