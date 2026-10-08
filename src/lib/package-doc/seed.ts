import { printableKeyProducts, resolveKeyProducts } from "@/app/(app)/estimator/narrative";
import { systemPrintsInBody } from "@/app/(app)/estimator/quote-document-view";
import type { SpecSection } from "@/app/(app)/estimator/types";
import { groupBlocks, type SystemGroup } from "@/lib/estimate-groups/groups";
import { DEFAULT_PHOTO, DOC_VERSION } from "./schema";
import { sanitizePackageDoc } from "./sanitize";
import { textToBlocks, textToParagraphs } from "./text";
import type { PackageDoc, PDBlock, PDHeading, PDParagraph, PDProductBlock, PhotoAttrs } from "./types";

/**
 * Estimator Phase 5 — "Start the document": a first draft built from the
 * quote's current narrative fields (spec §12.5). For each PRINTED
 * (systemPrintsInBody) In-total system, in Build order (groupBlocks):
 *   heading (level 2, the system name) → a paragraph holding its
 *   systemPrice chip → its intro (`sec.narrative`) as
 *   paragraphs / bullet lists → a product block per printable key product
 *   (resolved "ok" blocks, in order; photo { show: the block's photo flag,
 *   align right, width 34 } — today's float).
 * Then the live price table. Then, when any alternate system prints, an
 * "Alternates" heading (level 1) and those systems the same way.
 * The result is run through the validator; a draft too big for the caps
 * falls back to headings + price chips + the table (the words stay in the
 * narrative fields). Pure; client-safe.
 */

export type SeedInput = {
  sections: readonly SpecSection[];
  groups?: readonly SystemGroup[] | null;
};

export const ALTERNATES_HEADING = "Alternates";

const textHeading = (text: string, level: 1 | 2 | 3): PDHeading =>
  text ? { type: "heading", attrs: { level }, content: [{ type: "text", text }] } : { type: "heading", attrs: { level } };

/** A system's heading + its price chip — also what dragging a system into the editor inserts. */
export function systemHeadingBlocks(sec: Pick<SpecSection, "id" | "name">): PDBlock[] {
  const name = typeof sec.name === "string" ? sec.name.trim() : "";
  const price: PDParagraph = { type: "paragraph", content: [{ type: "chip", attrs: { kind: "systemPrice", ref: sec.id } }] };
  return [textHeading(name || "Untitled system", 2), price];
}

/** One product-linked block (seed, BOM drag, + Key product). */
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

/** A system's printable key products as product blocks, in order. */
export function keyProductBlocks(sec: SpecSection): PDProductBlock[] {
  // printableKeyProducts is resolveKeyProducts' "ok" rows, in the same order.
  const ok = resolveKeyProducts(sec).filter((r) => r.status === "ok");
  const printable = printableKeyProducts(sec);
  return printable.map((p, i) => productBlockFor(sec.id, ok[i]?.kp.lineKey ?? "", p.sku, ok[i]?.kp.text ?? "", { show: p.photo }));
}

function systemBlocks(sec: SpecSection, withWords: boolean): PDBlock[] {
  const out = systemHeadingBlocks(sec);
  if (!withWords) return out;
  out.push(...textToBlocks(typeof sec.narrative === "string" ? sec.narrative : ""));
  out.push(...keyProductBlocks(sec).filter((b) => b.attrs.lineKey));
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
