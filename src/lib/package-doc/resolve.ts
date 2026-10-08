import { fmt, systemSellTotal, type QuoteTotals } from "@/app/(app)/estimator/pricing";
import { keyProductHeading } from "@/app/(app)/estimator/narrative";
import { systemPrintsInBody } from "@/app/(app)/estimator/quote-document-view";
import type { SpecSection } from "@/app/(app)/estimator/types";
import { PLACEHOLDER_SRC } from "@/lib/part-image-fallback";
import { rewardPointsAppliedLabel } from "@/lib/rewards/points";
import { findLine, findSection, resolveChip } from "./chips";
import { productBlockInBom } from "./gaps";
import { linePlaceholder } from "./print";
import { clampPhotoWidth, LIST_START_MAX } from "./schema";
import type { LineAnchor, PackageDoc, PDBlock, PDBulletList, PDInline, PDMark, PDListItem, PDOrderedList, PDParagraph, PDProductBlock, PDProductImage, PhotoAlign } from "./types";

/**
 * Estimator Phase 5 — the package document resolved for a CLIENT output:
 * every live value read now (chips, the price table, each product block's
 * heading and photo) and nothing else — strings only, so a resolved document
 * can ride the client package model (§10: a system's sell price, a line's
 * qty + unit and a product name; never a line price, cost or internal note).
 * The renderer (components/package-doc/package-doc-view.tsx) draws exactly
 * this. Iterative over blocks, bounded by the sanitizer's caps. Pure;
 * client-safe.
 *
 *   chip → its value (resolveChip); a missing system/line → dropped
 *   productBlock → heading = keyProductHeading(line) while the line is in the
 *     BOM (else none); photo (photo.show) = photos[sku] → the line's kind
 *     placeholder → none
 *   productImage (#312) → the same photo source (photos[sku] → the line's
 *     kind placeholder) with its own align / width; no source → dropped
 *   systemTotal → the system's name + systemSellTotal (alternate systems
 *     flagged); a missing system → dropped
 *   priceTable → printed In-total systems (name · systemSellTotal), the tax
 *     and Rewards credit rows, Total = t.grand — the totals block's numbers;
 *     printed alternates listed separately ("priced separately")
 */

export type PackageDocCtx = {
  sections: readonly SpecSection[];
  t: QuoteTotals;
  /** The printed estimate number (QuoteDocument's quoteId) — the quoteNumber chip. */
  quoteId: string;
  taxRatePct?: number;
  /** The totals block's Total label ("Total (excludes items pending price)" on a portal POR quote). */
  totalLabel?: string;
  /** sku → photo (data URI for print, a scoped photo route on the web). */
  photos?: Record<string, { src: string; alt: string }>;
};

export type RInline = { t: "text"; text: string; bold?: true; italic?: true } | { t: "br" } | { t: "chip"; text: string };
export type RParagraph = { t: "p"; content: RInline[] };
export type RList = { t: "ul" | "ol"; /** An ordered list that does not begin at 1. */ start?: number; items: Array<Array<RParagraph | RList>> };
export type RPhoto = { src: string; alt: string; align: PhotoAlign; width: number };
export type RProduct = { t: "product"; sku: string; heading: string | null; photo: RPhoto | null; paras: RParagraph[] };
/** #312 — a product's photo on its own (no words, no heading). */
export type RImage = { t: "image"; sku: string; photo: RPhoto };
export type RPriceRow = { name: string; price: string };
export type RPriceTable = { t: "price"; rows: RPriceRow[]; extra: RPriceRow[]; totalLabel: string; total: string; alternates: RPriceRow[] };
/** A system's price line: its name and systemSellTotal; `alternate` adds " — priced separately". */
export type RSysTotal = { t: "systotal"; name: string; price: string; alternate: boolean };
export type RBlock = RParagraph | { t: "h"; level: 1 | 2 | 3; content: RInline[] } | RList | RProduct | RImage | RPriceTable | RSysTotal | { t: "pagebreak" };
export type ResolvedPackageDoc = { blocks: RBlock[] };

function inline(content: readonly PDInline[] | undefined, ctx: PackageDocCtx): RInline[] {
  const out: RInline[] = [];
  for (const n of Array.isArray(content) ? content : []) {
    if (!n || typeof n !== "object") continue;
    if (n.type === "text") {
      if (typeof n.text !== "string" || !n.text) continue;
      const marks = new Set<string>((Array.isArray(n.marks) ? (n.marks as PDMark[]) : []).map((m) => (m ? m.type : "")));
      out.push({ t: "text", text: n.text, ...(marks.has("bold") ? { bold: true as const } : {}), ...(marks.has("italic") ? { italic: true as const } : {}) });
    } else if (n.type === "hardBreak") out.push({ t: "br" });
    else if (n.type === "chip") {
      const v = resolveChip(n, { sections: ctx.sections, t: ctx.t, quoteId: ctx.quoteId, totalLabel: ctx.totalLabel });
      if (v) out.push({ t: "chip", text: v });
    }
  }
  return out;
}

const para = (p: PDParagraph, ctx: PackageDocCtx): RParagraph => ({ t: "p", content: inline(p?.content, ctx) });

function list(l: PDBulletList | PDOrderedList, ctx: PackageDocCtx): RList {
  const start = l.type === "orderedList" && l.attrs && Number.isInteger(l.attrs.start) && l.attrs.start > 1 && l.attrs.start <= LIST_START_MAX ? l.attrs.start : undefined;
  return {
    t: l.type === "orderedList" ? "ol" : "ul",
    ...(start ? { start } : {}),
    items: (Array.isArray(l.content) ? l.content : []).map((li: PDListItem) =>
      (Array.isArray(li?.content) ? li.content : []).flatMap((c): Array<RParagraph | RList> =>
        c?.type === "paragraph" ? [para(c, ctx)] : c?.type === "bulletList" || c?.type === "orderedList" ? [list(c, ctx)] : []
      )
    ),
  };
}

/** The photo a line-anchored node prints: the part's own (photos[sku]) →
 *  the line's kind placeholder → none. The one source for product blocks and
 *  product images. */
export function linePhotoSource(a: LineAnchor, ctx: Pick<PackageDocCtx, "sections" | "photos">): { src: string; alt: string } | undefined {
  const ph = linePlaceholder(a, ctx.sections);
  // Own-key lookup only: a `__proto__` / `constructor` sku must never read Object.prototype.
  const own = ctx.photos && typeof a.sku === "string" && Object.hasOwn(ctx.photos, a.sku) ? ctx.photos[a.sku] : undefined;
  return own ?? (ph ? { src: PLACEHOLDER_SRC[ph], alt: "" } : undefined);
}

const alignOf = (v: unknown): PhotoAlign => (v === "left" || v === "full" ? v : "right");

function product(b: PDProductBlock, ctx: PackageDocCtx): RProduct {
  const a = b.attrs;
  const line = productBlockInBom(b, ctx.sections) ? findLine(findSection(ctx.sections, a.sectionId), a.lineKey) : undefined;
  const src = a.photo?.show ? linePhotoSource(a, ctx) : undefined;
  return {
    t: "product",
    sku: a.sku,
    heading: line ? keyProductHeading(line) : null,
    photo: src ? { src: src.src, alt: src.alt, align: alignOf(a.photo.align), width: clampPhotoWidth(a.photo.width) } : null,
    paras: (Array.isArray(b.content) ? b.content : []).map((p) => para(p, ctx)),
  };
}

/** A product image: its photo source with its own align / width, or null
 *  (prints nothing) when no source resolves. */
export function productImageOf(b: PDProductImage, ctx: Pick<PackageDocCtx, "sections" | "photos">): RImage | null {
  const a = b?.attrs;
  if (!a) return null;
  const src = linePhotoSource(a, ctx);
  return src ? { t: "image", sku: a.sku, photo: { src: src.src, alt: src.alt, align: alignOf(a.align), width: clampPhotoWidth(a.width) } } : null;
}

/** The live price table — the same numbers as QuoteDocument's totals block. */
export function priceTableOf(ctx: PackageDocCtx): RPriceTable {
  const secs = Array.isArray(ctx.sections) ? ctx.sections : [];
  const row = (s: SpecSection): RPriceRow => ({ name: s.name || "", price: fmt(systemSellTotal(s)) });
  const credit = ctx.t.credit || 0;
  return {
    t: "price",
    rows: secs.filter((s) => s && s.alternate !== true && systemPrintsInBody(s)).map(row),
    extra: [
      ...(ctx.t.tax > 0 ? [{ name: `Sales tax (${ctx.taxRatePct ?? 0}%)`, price: fmt(ctx.t.tax) }] : []),
      ...(credit > 0 ? [{ name: rewardPointsAppliedLabel(credit), price: "−" + fmt(credit) }] : []),
    ],
    totalLabel: ctx.totalLabel || "Total",
    total: fmt(ctx.t.grand),
    alternates: secs.filter((s) => s && s.alternate === true && systemPrintsInBody(s)).map(row),
  };
}

/** A system's live price line, or null when the system is gone or does not
 *  print in the body (zero revenue / hidden — the price table skips it too). */
export function systemTotalOf(sectionId: unknown, ctx: Pick<PackageDocCtx, "sections">): RSysTotal | null {
  const sec = findSection(ctx.sections, typeof sectionId === "string" ? sectionId : "");
  return sec && systemPrintsInBody(sec) ? { t: "systotal", name: (sec.name || "").trim() || "Untitled system", price: fmt(systemSellTotal(sec)), alternate: sec.alternate === true } : null;
}

function block(b: PDBlock, ctx: PackageDocCtx): RBlock | null {
  switch (b?.type) {
    case "paragraph":
      return para(b, ctx);
    case "heading":
      return { t: "h", level: b.attrs?.level === 1 || b.attrs?.level === 3 ? b.attrs.level : 2, content: inline(b.content, ctx) };
    case "bulletList":
    case "orderedList":
      return list(b, ctx);
    case "productBlock":
      return product(b, ctx);
    case "productImage":
      return productImageOf(b, ctx);
    case "priceTable":
      return priceTableOf(ctx);
    case "systemTotal":
      return systemTotalOf(b.attrs?.sectionId, ctx);
    case "pageBreak":
      return { t: "pagebreak" };
    default:
      return null;
  }
}

export function resolvePackageDoc(doc: PackageDoc, ctx: PackageDocCtx): ResolvedPackageDoc {
  const blocks: RBlock[] = [];
  for (const b of doc && Array.isArray(doc.content) ? doc.content : []) {
    const r = block(b, ctx);
    if (r) blocks.push(r);
  }
  return { blocks };
}
