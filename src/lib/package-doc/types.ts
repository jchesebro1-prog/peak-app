/**
 * Estimator Phase 5 — the Build package document (spec.document): the client
 * document staff write in the TipTap editor, stored as ProseMirror JSON and
 * printed instead of the per-system narrative. These are the ONLY shapes a
 * saved document may take — sanitizePackageDoc (sanitize.ts) enforces them.
 * Pure types; client-safe.
 */

export type PDMarkType = "bold" | "italic";
export type PDMark = { type: PDMarkType };

export type ChipKind = "systemPrice" | "systemName" | "lineQty" | "quoteNumber" | "grandTotal";
export type PhotoAlign = "left" | "right" | "full";

export type PDText = { type: "text"; text: string; marks?: PDMark[] };
export type PDHardBreak = { type: "hardBreak" };
/** A live number/name: resolved at render (chips.ts). `ref` is the sectionId
 *  for system kinds, `sectionId:lineKey` for lineQty, "" otherwise. */
export type PDChip = { type: "chip"; attrs: { kind: ChipKind; ref: string } };
export type PDInline = PDText | PDHardBreak | PDChip;

export type PDParagraph = { type: "paragraph"; content?: PDInline[] };
export type PDHeading = { type: "heading"; attrs: { level: 1 | 2 | 3 }; content?: PDInline[] };
export type PDListItem = { type: "listItem"; content: Array<PDParagraph | PDBulletList | PDOrderedList> };
export type PDBulletList = { type: "bulletList"; content: PDListItem[] };
/** `attrs.start` (an integer 1–9999) only when the list does not begin at 1. */
export type PDOrderedList = { type: "orderedList"; attrs?: { start: number }; content: PDListItem[] };
export type PDPageBreak = { type: "pageBreak" };
/** The live price table (atom). */
export type PDPriceTable = { type: "priceTable" };
export type PhotoAttrs = { show: boolean; align: PhotoAlign; /** 25–100 (% of the text column). */ width: number };
/** A product-linked paragraph block: one BOM line of one system. */
export type PDProductBlock = {
  type: "productBlock";
  attrs: { sectionId: string; lineKey: string; sku: string; photo: PhotoAttrs };
  content: PDParagraph[];
};

export type PDBlock = PDParagraph | PDHeading | PDBulletList | PDOrderedList | PDPageBreak | PDPriceTable | PDProductBlock;
export type PDNode = PDBlock | PDListItem | PDInline;

export type PackageDoc = { type: "doc"; version: 1; content: PDBlock[] };
