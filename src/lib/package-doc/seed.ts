import { printableKeyProducts, resolveKeyProducts } from "@/app/(app)/estimator/narrative";
import { systemPrintsInBody } from "@/app/(app)/estimator/quote-document-view";
import type { SpecSection } from "@/app/(app)/estimator/types";
import { groupBlocks, type SystemGroup } from "@/lib/estimate-groups/groups";
import { clampPhotoWidth, DEFAULT_IMAGE, DEFAULT_PHOTO, DOC_VERSION, isPhotoAlign } from "./schema";
import { sanitizePackageDoc } from "./sanitize";
import { textToBlocks, textToParagraphs } from "./text";
import type { PackageDoc, PDBlock, PDHeading, PDProductBlock, PDProductImage, PDSystemTotal, PhotoAlign, PhotoAttrs } from "./types";

/**
 * Estimator Phase 5 — "Start the document": a first draft built from the
 * quote's current narrative fields (spec §12.5). For each PRINTED
 * (systemPrintsInBody) In-total system, in Build order (groupBlocks):
 *   heading (level 2, the system name) → its intro (`sec.narrative`) as
 *   paragraphs / bullet lists → per printable key product (resolved "ok"
 *   blocks, in order) its photo as its own productImage (right, 34 % —
 *   today's float; only when the key product's photo flag is on) then its
 *   words as a product block (photo { show: false }) (#312) → its live
 *   systemTotal price line, last.
 * Then the live price table. Then, when any alternate system prints, an
 * "Alternates" heading (level 1) and those systems the same way.
 * The result is run through the validator; a draft too big for the caps
 * falls back to headings + price lines + the table (the words stay in the
 * narrative fields). Pure; client-safe.
 */

export type SeedInput = {
  sections: readonly SpecSection[];
  groups?: readonly SystemGroup[] | null;
};

export const ALTERNATES_HEADING = "Alternates";

const textHeading = (text: string, level: 1 | 2 | 3): PDHeading =>
  text ? { type: "heading", attrs: { level }, content: [{ type: "text", text }] } : { type: "heading", attrs: { level } };

/** A system's heading (level 2, its name) — what both the seed and a BOM system drop start with. */
export function systemHeadingBlocks(sec: Pick<SpecSection, "id" | "name">): PDBlock[] {
  const name = typeof sec.name === "string" ? sec.name.trim() : "";
  return [textHeading(name || "Untitled system", 2)];
}

/** A system's live price line (the node `+ Price line` and a system drop end with). */
export const systemTotalBlock = (sectionId: string): PDSystemTotal => ({ type: "systemTotal", attrs: { sectionId } });

/** One product-linked block (seed, BOM drag, + Key product). Since #312 the
 *  callers pass `{ show: false }` — the photo is its own productImage. */
export function productBlockFor(
  sectionId: string,
  lineKey: string | number,
  sku: string,
  text: string | null | undefined,
  photo?: Partial<PhotoAttrs>,
): PDProductBlock {
  return {
    type: "productBlock",
    attrs: { sectionId, lineKey: String(lineKey), sku, photo: { ...DEFAULT_PHOTO, ...(photo || {}) } },
    content: textToParagraphs(text),
  };
}

/** #312 — one product's photo as its own piece (right at 34 % unless given). */
export function productImageFor(sectionId: string, lineKey: string | number, sku: string, img?: { align?: PhotoAlign; width?: number }): PDProductImage {
  const align = img?.align;
  const width = img?.width;
  return {
    type: "productImage",
    attrs: { sectionId, lineKey: String(lineKey), sku, align: isPhotoAlign(align) ? align : DEFAULT_IMAGE.align, width: width === undefined ? DEFAULT_IMAGE.width : clampPhotoWidth(width) },
  };
}

/** A line's words and photo: [productImage (when `photo`), productBlock (photo hidden)]. */
export function productNodesFor(sectionId: string, lineKey: string | number, sku: string, text: string | null | undefined, photo: boolean): Array<PDProductImage | PDProductBlock> {
  const words = productBlockFor(sectionId, lineKey, sku, text, { show: false });
  return photo ? [productImageFor(sectionId, lineKey, sku), words] : [words];
}

/** A system's printable key products, in order: each one's image (when its
 *  photo flag is on) followed by its words. */
export function keyProductBlocks(sec: SpecSection): Array<PDProductImage | PDProductBlock> {
  // printableKeyProducts is resolveKeyProducts' "ok" rows, in the same order.
  const ok = resolveKeyProducts(sec).filter((r) => r.status === "ok");
  const printable = printableKeyProducts(sec);
  return printable.flatMap((p, i) => productNodesFor(sec.id, ok[i]?.kp.lineKey ?? "", p.sku, ok[i]?.kp.text ?? "", !!p.photo));
}

function systemBlocks(sec: SpecSection, withWords: boolean): PDBlock[] {
  const out = systemHeadingBlocks(sec);
  if (withWords) {
    out.push(...textToBlocks(typeof sec.narrative === "string" ? sec.narrative : ""));
    out.push(...keyProductBlocks(sec).filter((b) => b.attrs.lineKey));
  }
  out.push(systemTotalBlock(sec.id));
  return out;
}

function build(input: SeedInput, withWords: boolean): PackageDoc {
  const groups = Array.isArray(input.groups) ? [...input.groups] : [];
  const ordered = groupBlocks([...(Array.isArray(input.sections) ? input.sections : [])], groups).flatMap((b) => b.sections);
  const printed = ordered.filter((s) => s && systemPrintsInBody(s));
  const inTotal = printed.filter((s) => s.alternate !== true);
  const alternates = printed.filter((s) => s.alternate === true);
  const content: PDBlock[] = [];
  for (const sec of inTotal) content.push(...systemBlocks(sec, withWords));
  content.push({ type: "priceTable" });
  if (alternates.length) {
    content.push(textHeading(ALTERNATES_HEADING, 1));
    for (const sec of alternates) content.push(...systemBlocks(sec, withWords));
  }
  return { type: "doc", version: DOC_VERSION, content };
}

export function seedPackageDoc(input: SeedInput): PackageDoc {
  return sanitizePackageDoc(build(input, true)) ?? sanitizePackageDoc(build(input, false)) ?? { type: "doc", version: DOC_VERSION, content: [{ type: "priceTable" }] };
}
