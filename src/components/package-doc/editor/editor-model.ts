import { keyProductHeading } from "@/app/(app)/estimator/narrative";
import type { KeyProductLibraryRow } from "@/app/(app)/estimator/narrative";
import type { SpecSection } from "@/app/(app)/estimator/types";
import { findLine, findSection } from "@/lib/package-doc/chips";
import { productBlockInBom } from "@/lib/package-doc/gaps";
import { linePlaceholder } from "@/lib/package-doc/print";
import { clampPhotoWidth, DEFAULT_IMAGE, isPhotoAlign, MAX_BLOCK_TEXT, MAX_DEPTH, MAX_JSON_CHARS, MAX_NODES } from "@/lib/package-doc/schema";
import { countNodes, sanitizePackageDoc } from "@/lib/package-doc/sanitize";
import { normalizeProductText } from "@/lib/package-doc/text";
import type { LineAnchor, PackageDoc, PDProductBlock, PhotoAlign, PhotoAttrs } from "@/lib/package-doc/types";
import { PLACEHOLDER_SRC } from "@/lib/part-image-fallback";

/**
 * Estimator Phase 5 — the package document editor's pure rules (no TipTap,
 * no React), so the harness can test them behaviourally:
 *  - productTagState: a product block reads "from product" only while its
 *    words equal the catalog paragraph (productBlockText(node) ===
 *    normalizeProductText(narrativeText)); otherwise "edited here"; null while
 *    the library row is still loading.
 *  - docSizeState: the editor's raw JSON against the server caps — "near"
 *    within 10 % of the node cap or the 200 KB cap, "over" when the
 *    validator would drop or refuse anything — node cap, a long block,
 *    nesting deeper than MAX_DEPTH, or 200 KB (the editor then never emits:
 *    a silently cut document must never replace the stored one).
 *  - productBlockLabel / productPhotoPreview: what the product block's tag and
 *    photo preview show (the same photo order as the narrative column).
 *  - withPhoto / withImage: a photo / product-image patch, clamped the way
 *    the validator clamps.
 *  - linePhotoPreview (#312): the same preview for any line anchor — a
 *    product image uses it exactly as an old photo'd product block does.
 */

export type ProductTagState = "from" | "edited";

/** `· from product` while the block's words equal the library paragraph;
 *  `· edited here` otherwise (no library paragraph = edited here). `undefined`
 *  = the library row hasn't loaded yet → null (no claim either way). */
export function productTagState(nodeText: string, libraryText: string | null | undefined): ProductTagState | null {
  if (libraryText === undefined) return null;
  if (libraryText === null) return "edited";
  return nodeText === normalizeProductText(libraryText) ? "from" : "edited";
}

export const TAG_SUFFIX: Record<ProductTagState, string> = { from: "from product", edited: "edited here" };

/** `<label> · from product` / `<label> · edited here` (label alone while loading). */
export function productTagText(label: string, state: ProductTagState | null): string {
  return state ? `${label} · ${TAG_SUFFIX[state]}` : label;
}

export const isLineTokenSku = (sku: string): boolean => /^line:\d+$/.test(sku);

/** A line-token block (a custom or allowance line — no catalog part, no
 *  library paragraph) never claims "from product" / "edited here":
 *  `<label> · custom line`, with no Save to product or Revert. */
export function customLineTagText(label: string): string {
  return `${label} · custom line`;
}

/** How long "Saved to the product." stays (it also clears on the next edit). */
export const SAVED_TO_PRODUCT_MS = 4000;

/** The block's name: the line's printed heading while it is in the BOM,
 *  else the library description, else the sku. */
export function productBlockLabel(block: PDProductBlock, sections: readonly SpecSection[], row?: KeyProductLibraryRow | null): string {
  const a = block.attrs;
  if (productBlockInBom(block, sections)) {
    const line = findLine(findSection(sections, a.sectionId), a.lineKey);
    if (line) return keyProductHeading(line) || a.sku || "Product";
  }
  return (row && row.desc) || a.sku || "Product";
}

/** The editor's photo preview — the narrative column's order: the part's own
 *  photo → the line's kind placeholder (allowance / custom) → the
 *  manufacturer image → none. In-app photo route, never a data URI. */
export function productPhotoPreview(
  block: PDProductBlock,
  sections: readonly SpecSection[],
  row?: KeyProductLibraryRow | null
): { src: string; note: string | null } | null {
  return linePhotoPreview(block?.attrs, sections, row);
}

/** productPhotoPreview for any line anchor (a product block's or a product image's attrs). */
export function linePhotoPreview(
  a: LineAnchor | null | undefined,
  sections: readonly SpecSection[],
  row?: KeyProductLibraryRow | null
): { src: string; note: string | null } | null {
  if (row && row.photoDocId) return { src: "/api/part-documents/" + encodeURIComponent(row.photoDocId), note: null };
  const ph = linePlaceholder(a, sections);
  if (ph === "allowance") return { src: PLACEHOLDER_SRC.allowance, note: "Prints the Allowance placeholder" };
  if (ph === "custom-device") return { src: PLACEHOLDER_SRC["custom-device"], note: "Prints the Custom Device placeholder" };
  if (row && row.fallbackDocId) return { src: "/api/part-documents/" + encodeURIComponent(row.fallbackDocId), note: `Prints the manufacturer image (${row.fallbackLabel || "manufacturer"})` };
  return null;
}

/** A photo patch, clamped like the validator (width 25–100, align left/right/full). */
export function withPhoto(photo: Partial<PhotoAttrs> | null | undefined, patch: Partial<PhotoAttrs>): PhotoAttrs {
  const cur = { show: true, align: "right" as const, width: 34, ...(photo || {}) };
  const next = { ...cur, ...patch };
  return { show: next.show !== false, align: isPhotoAlign(next.align) ? next.align : "right", width: clampPhotoWidth(next.width) };
}

export type ImageAttrs = { align: PhotoAlign; width: number };

/** A product-image patch, clamped like the validator (width 25–100, align left/right/full). */
export function withImage(img: Partial<ImageAttrs> | null | undefined, patch: Partial<ImageAttrs>): ImageAttrs {
  const next = { ...DEFAULT_IMAGE, ...(img || {}), ...patch };
  return { align: isPhotoAlign(next.align) ? next.align : DEFAULT_IMAGE.align, width: clampPhotoWidth(next.width) };
}

export type DocSizeState = {
  /** The sanitized document to emit, or null when nothing may be emitted ("over"). */
  doc: PackageDoc | null;
  nodes: number;
  jsonChars: number;
  level: "ok" | "near" | "over";
  /** The warning bar's text ("" when ok). */
  message: string;
};

export const NEAR_CAP = 0.9;
export const TOO_LARGE = "The document is too large to save — shorten it.";

/** Longest paragraph/heading text in a raw editor JSON tree (iterative). */
function longestTextblock(raw: unknown): number {
  let max = 0;
  const stack: unknown[] = [raw];
  while (stack.length) {
    const n = stack.pop() as { type?: unknown; content?: unknown; text?: unknown } | null;
    if (!n || typeof n !== "object") continue;
    const kids = Array.isArray(n.content) ? n.content : [];
    if (n.type === "paragraph" || n.type === "heading") {
      let len = 0;
      for (const k of kids) if (k && typeof k === "object" && typeof (k as { text?: unknown }).text === "string") len += ((k as { text: string }).text).length;
      if (len > max) max = len;
    } else for (const k of kids) stack.push(k);
  }
  return max;
}

/** Deepest node in a raw editor JSON tree, counted like the validator (the
 *  doc's own children are depth 1). Iterative. */
export function rawDepth(raw: unknown): number {
  let max = 0;
  const stack: [unknown, number][] = [];
  const kids0 = raw && typeof raw === "object" && Array.isArray((raw as { content?: unknown }).content) ? ((raw as { content: unknown[] }).content) : [];
  for (const k of kids0) stack.push([k, 1]);
  while (stack.length) {
    const [n, d] = stack.pop()!;
    if (!n || typeof n !== "object") continue;
    if (d > max) max = d;
    const kids = (n as { content?: unknown }).content;
    if (Array.isArray(kids)) for (const k of kids) stack.push([k, d + 1]);
  }
  return max;
}

const kb = (chars: number) => Math.round(chars / 1024);

/** The editor's raw JSON against the server caps. */
export function docSizeState(raw: unknown): DocSizeState {
  const content = raw && typeof raw === "object" && Array.isArray((raw as { content?: unknown }).content) ? ((raw as { content: unknown[] }).content) : [];
  const nodes = countNodes(content);
  const doc = nodes > MAX_NODES || longestTextblock(raw) > MAX_BLOCK_TEXT || rawDepth(raw) > MAX_DEPTH ? null : sanitizePackageDoc(raw);
  const jsonChars = doc ? JSON.stringify(doc).length : JSON.stringify(raw ?? null).length;
  if (!doc) return { doc: null, nodes, jsonChars, level: "over", message: TOO_LARGE };
  if (nodes >= MAX_NODES * NEAR_CAP || jsonChars >= MAX_JSON_CHARS * NEAR_CAP)
    return {
      doc,
      nodes,
      jsonChars,
      level: "near",
      message: `The document is near its size limit (${nodes.toLocaleString("en-US")} of ${MAX_NODES.toLocaleString("en-US")} pieces · ${kb(jsonChars)} KB of ${kb(MAX_JSON_CHARS)} KB).`,
    };
  return { doc, nodes, jsonChars, level: "ok", message: "" };
}

/** The editor's content for a stored document (TipTap ignores `version`). */
export function toEditorContent(doc: PackageDoc): { type: "doc"; content: PackageDoc["content"] } {
  return { type: "doc", content: Array.isArray(doc?.content) ? doc.content : [] };
}
