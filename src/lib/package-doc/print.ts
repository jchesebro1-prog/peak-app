import type { SpecSection } from "@/app/(app)/estimator/types";
import type { PlaceholderName } from "@/lib/part-image-fallback";
import { findLine, findSection } from "./chips";
import { lineAnchorInBom } from "./gaps";
import { docLineNodes, docPhotoSkus, isEmptyDoc } from "./text";
import type { LineAnchor, PackageDoc, PDProductBlock } from "./types";

/**
 * Estimator Phase 5 — what the client outputs need to print a package
 * document: whether one applies at all, which photo a product block or a
 * product image (#312) takes when the part has none of its own, and which document skus may take their
 * manufacturer's image. Pure; client-safe.
 */

/** A document prints only when it is a doc with printable content
 *  (isEmptyDoc false). No document, or an empty one, = today's output. */
export function documentApplies(doc: PackageDoc | null | undefined): doc is PackageDoc {
  return !!doc && typeof doc === "object" && doc.type === "doc" && Array.isArray(doc.content) && !isEmptyDoc(doc);
}

/** The kind placeholder a line-anchored node (a product block's or a
 *  product image's attrs) prints when the part has no photo of its own — the
 *  key products' rule (narrative.ts printableKeyProducts): an allowance line →
 *  allowance, a custom line → custom device. Only while the anchor's line is
 *  still in the BOM; otherwise none. */
export function linePlaceholder(a: LineAnchor | null | undefined, sections: readonly SpecSection[]): PlaceholderName | undefined {
  if (!a || !lineAnchorInBom(a, sections)) return undefined;
  const it = findLine(findSection(sections, a.sectionId), a.lineKey);
  return it?.allowance ? "allowance" : it?.custom ? "custom-device" : undefined;
}

/** A product block's kind placeholder (linePlaceholder on its attrs). */
export function docBlockPlaceholder(block: PDProductBlock, sections: readonly SpecSection[]): PlaceholderName | undefined {
  return linePlaceholder(block?.attrs, sections);
}

/** Document photo skus that may fall back to their manufacturer's image:
 *  every product image's and photo-on block's catalog sku except one whose
 *  node prints a kind placeholder (the placeholder comes before the
 *  manufacturer image). */
export function docManufacturerFallbackSkus(doc: PackageDoc | null | undefined, sections: readonly SpecSection[]): string[] {
  const want = new Set(docPhotoSkus(doc));
  const out: string[] = [];
  for (const b of docLineNodes(doc)) {
    const s = b.attrs?.sku;
    if (!want.has(s) || out.includes(s) || linePlaceholder(b.attrs, sections)) continue;
    out.push(s);
  }
  return out;
}

/** The systems whose key products still print beside a document: with a
 *  document only the alternates (the document replaces the In-total bands),
 *  without one every system. */
export function keyProductPrintSections<S extends SpecSection>(sections: readonly S[], doc: PackageDoc | null | undefined): S[] {
  const all = Array.isArray(sections) ? [...sections] : [];
  return documentApplies(doc) ? all.filter((s) => s && s.alternate === true) : all;
}
