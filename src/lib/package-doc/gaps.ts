import { keyProductSkuOf } from "@/app/(app)/estimator/narrative";
import { systemPrintsInBody } from "@/app/(app)/estimator/quote-document-view";
import type { SpecSection } from "@/app/(app)/estimator/types";
import { chipRefExists, findLine, findSection, splitLineRef } from "./chips";
import { inlineText, walkDoc } from "./text";
import type { ChipKind, PackageDoc, PDProductBlock } from "./types";

/**
 * Estimator Phase 5 — what the document is missing against the live BOM
 * (the editor's Gaps list). Words are never rewritten; these are only flags.
 *  - removedChips: chips whose system/line no longer exists (deduped).
 *  - productsNotInBom: product blocks whose line left its system, or whose
 *    line's sku changed (`No longer in BOM`; kept until the user deletes it).
 *  - systemsNotMentioned: printed In-total systems (systemPrintsInBody, not
 *    alternate) the document never refers to — no chip or product block on
 *    the system and no heading whose text is its name (case-insensitive).
 *  - itemizedInAppendix: informational — the names of printed In-total
 *    systems whose presentation is itemized (or unset); with a document their
 *    lines print in the Itemized appendix whatever the toggle says
 *    (documentAppendixSystemIds) — "Lines for <names> print in the appendix."
 * Pure; client-safe.
 */

export type DocGaps = {
  removedChips: Array<{ kind: ChipKind; ref: string }>;
  productsNotInBom: Array<{ sectionId: string; lineKey: string; sku: string }>;
  systemsNotMentioned: Array<{ id: string; name: string }>;
  itemizedInAppendix: string[];
};

/** Is this product block's line still in the BOM with the same anchor sku? */
export function productBlockInBom(block: PDProductBlock, sections: readonly SpecSection[]): boolean {
  const a = block?.attrs;
  if (!a) return false;
  const it = findLine(findSection(sections, a.sectionId), a.lineKey);
  if (!it) return false;
  if (!a.sku) return true;
  const own = typeof it.sku === "string" ? it.sku.trim() : "";
  return keyProductSkuOf(it) === a.sku || own === a.sku;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

export function docGaps(doc: PackageDoc | null | undefined, sections: readonly SpecSection[]): DocGaps {
  const secs = Array.isArray(sections) ? sections : [];
  const out: DocGaps = { removedChips: [], productsNotInBom: [], systemsNotMentioned: [], itemizedInAppendix: [] };
  const mentioned = new Set<string>();
  const headings = new Set<string>();
  const seenChip = new Set<string>();
  const seenBlock = new Set<string>();
  for (const n of walkDoc(doc)) {
    if (n.type === "chip") {
      const { kind, ref } = n.attrs;
      if (kind === "systemPrice" || kind === "systemName") mentioned.add(ref);
      else if (kind === "lineQty") {
        const r = splitLineRef(ref);
        if (r) mentioned.add(r.sectionId);
      }
      const key = kind + "\u0000" + ref;
      if (!chipRefExists(n, secs) && !seenChip.has(key)) {
        seenChip.add(key);
        out.removedChips.push({ kind, ref });
      }
    } else if (n.type === "productBlock") {
      const { sectionId, lineKey, sku } = n.attrs;
      mentioned.add(sectionId);
      const key = sectionId + "\u0000" + lineKey + "\u0000" + sku;
      if (!productBlockInBom(n, secs) && !seenBlock.has(key)) {
        seenBlock.add(key);
        out.productsNotInBom.push({ sectionId, lineKey, sku });
      }
    } else if (n.type === "heading") {
      const t = norm(inlineText(n.content));
      if (t) headings.add(t);
    }
  }
  for (const sec of secs) {
    if (!sec || sec.alternate === true || !systemPrintsInBody(sec)) continue;
    if ((sec.presentation || "itemized") !== "narrative") out.itemizedInAppendix.push(sec.name || "");
    if (mentioned.has(sec.id) || headings.has(norm(sec.name || ""))) continue;
    out.systemsNotMentioned.push({ id: sec.id, name: sec.name || "" });
  }
  return out;
}
