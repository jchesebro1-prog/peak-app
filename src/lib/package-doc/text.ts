import { narrativeBlocks, type NarrativeBlock } from "@/app/(app)/estimator/narrative";
import type { PackageDoc, PDBlock, PDBulletList, PDInline, PDNode, PDParagraph, PDProductBlock } from "./types";

/**
 * Estimator Phase 5 — plain-text helpers for the package document: walking
 * it, reading a product block's words back as the catalog's plain-text
 * paragraph format (D488 / narrativeBlocks rules), and turning plain text
 * into document nodes for the seed and the editor's Library. Iterative walks
 * only. Pure; client-safe.
 */

/** Every node in document order (pre-order), doc excluded. */
export function walkDoc(doc: PackageDoc | null | undefined): PDNode[] {
  const out: PDNode[] = [];
  const blocks = doc && Array.isArray(doc.content) ? doc.content : [];
  const stack: PDNode[] = [...blocks].reverse();
  while (stack.length) {
    const n = stack.pop()!;
    out.push(n);
    const c = (n as { content?: PDNode[] }).content;
    if (Array.isArray(c)) for (let i = c.length - 1; i >= 0; i--) stack.push(c[i]);
  }
  return out;
}

/** A textblock's inline content as plain text: hard breaks are "\n", chips print nothing. */
export function inlineText(content: readonly PDInline[] | undefined): string {
  let s = "";
  for (const n of content || []) {
    if (n.type === "text") s += n.text;
    else if (n.type === "hardBreak") s += "\n";
  }
  return s;
}

/** Plain text of any node (paragraphs/items separated by a blank line). */
export function nodeText(node: PDNode): string {
  if (node.type === "text") return node.text;
  if (node.type === "hardBreak") return "\n";
  if (node.type === "paragraph" || node.type === "heading") return inlineText(node.content);
  const c = (node as { content?: PDNode[] }).content;
  return Array.isArray(c) ? c.map(nodeText).filter((t) => t !== "").join("\n\n") : "";
}

/** A product block's words in the catalog paragraph's plain-text format:
 *  paragraphs joined by a blank line, hard breaks as single line breaks,
 *  trimmed — so "from product" is `productBlockText(node) === narrativeText.trim()`
 *  for text the seed or Revert put there. */
export function productBlockText(node: PDProductBlock): string {
  const paras = Array.isArray(node?.content) ? node.content : [];
  return paras
    .map((p) => inlineText(p.content).split("\n").map((l) => l.trimEnd()).join("\n").trim())
    .filter((t) => t !== "")
    .join("\n\n")
    .trim();
}

const textNode = (text: string): PDInline[] => (text ? [{ type: "text", text }] : []);

/** One paragraph whose lines are joined by hard breaks. */
export function paragraphOfLines(lines: readonly string[]): PDParagraph {
  const content: PDInline[] = [];
  lines.forEach((l, i) => {
    if (i) content.push({ type: "hardBreak" });
    content.push(...textNode(l));
  });
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
}

export function bulletListOf(items: readonly string[]): PDBulletList | null {
  const clean = items.map((s) => (typeof s === "string" ? s.trim() : "")).filter(Boolean);
  if (!clean.length) return null;
  return { type: "bulletList", content: clean.map((t) => ({ type: "listItem", content: [paragraphOfLines([t])] })) };
}

/** Narrative plain text → document blocks: a paragraph per text group (line
 *  breaks kept), a bullet list per "- " group. Empty text → []. */
export function textToBlocks(text: string | null | undefined): PDBlock[] {
  return narrativeBlocks(text).flatMap((b): PDBlock[] => {
    if (b.kind === "p") return [paragraphOfLines(b.lines)];
    const ul = bulletListOf(b.items);
    return ul ? [ul] : [];
  });
}

/** Narrative plain text → paragraphs only (a product block holds paragraphs):
 *  a "- " group stays one paragraph of "- item" lines, so productBlockText
 *  reads the original text back. Always at least one paragraph. */
export function textToParagraphs(text: string | null | undefined): PDParagraph[] {
  const out = narrativeBlocks(text).map((b: NarrativeBlock) => paragraphOfLines(b.kind === "p" ? b.lines : b.items.map((i) => "- " + i)));
  return out.length ? out : [{ type: "paragraph" }];
}

/** A catalog paragraph in the form productBlockText reads back, so the
 *  editor's "from product" test is `productBlockText(node) ===
 *  normalizeProductText(narrativeText)` (blank-line/whitespace differences
 *  and a bullet run glued to a paragraph don't count as an edit). */
export function normalizeProductText(text: string | null | undefined): string {
  return productBlockText({ type: "productBlock", attrs: { sectionId: "", lineKey: "", sku: "", photo: { show: false, align: "right", width: 34 } }, content: textToParagraphs(text) });
}

/** Product blocks in document order. */
export function docProductBlocks(doc: PackageDoc | null | undefined): PDProductBlock[] {
  return walkDoc(doc).filter((n): n is PDProductBlock => n.type === "productBlock");
}

/** Distinct product-block skus in document order ("" skipped). */
export function docProductSkus(doc: PackageDoc | null | undefined): string[] {
  const out: string[] = [];
  for (const b of docProductBlocks(doc)) {
    const s = b.attrs?.sku;
    if (typeof s === "string" && s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Product-block skus whose photo prints (photo.show), excluding `line:<id>`
 *  tokens (they print a placeholder, never a catalog photo read). */
export function docPhotoSkus(doc: PackageDoc | null | undefined): string[] {
  const out: string[] = [];
  for (const b of docProductBlocks(doc)) {
    const s = b.attrs?.sku;
    if (b.attrs?.photo?.show && typeof s === "string" && s && !/^line:\d+$/.test(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Nothing printable: no document, or only empty paragraphs/headings/lists
 *  and page breaks. A chip, a price table, a system price line or a product block is content. */
export function isEmptyDoc(doc: PackageDoc | null | undefined): boolean {
  if (!doc || !Array.isArray(doc.content)) return true;
  for (const n of walkDoc(doc)) {
    if (n.type === "text" && n.text.trim()) return false;
    if (n.type === "chip" || n.type === "priceTable" || n.type === "productBlock" || n.type === "systemTotal") return false;
  }
  return true;
}
