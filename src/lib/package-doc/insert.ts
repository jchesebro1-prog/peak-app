import { isKeyProductEligible, isLineToken, keyProductHeading, keyProductSkuOf } from "@/app/(app)/estimator/narrative";
import { systemPrintsInBody } from "@/app/(app)/estimator/quote-document-view";
import type { SpecItem, SpecSection } from "@/app/(app)/estimator/types";
import { keyProductsNeedingText, packageGapChips, scopesWithoutGoals } from "@/lib/estimate-output/package-gaps";
import { notIncludedItems } from "@/lib/estimate-output/scopes";
import type { GroupBlock, SystemGroup } from "@/lib/estimate-groups/groups";
import { findLine, findSection } from "./chips";
import type { DocGaps } from "./gaps";
import { MAX_LINE_KEY, MAX_SECTION_ID } from "./schema";
import { productBlockFor, systemHeadingBlocks, systemTotalBlock } from "./seed";
import { bulletListOf, inlineText, textToBlocks, walkDoc } from "./text";
import type { ChipKind, PackageDoc, PDBlock, PDPageBreak, PDPriceTable } from "./types";

/**
 * Estimator Phase 5 — the Build package editor's left pane (Gaps, BOM,
 * Library), as pure rules: what a BOM drag carries, the nodes each pane item
 * inserts, which BOM rows are already in the document (✓), and the Gaps
 * list's rows. Every built node is valid schema (sanitizePackageDoc returns
 * it unchanged). No TipTap, no React. Client-safe.
 */

/** The drag MIME a BOM row sets; the editor's drop handler reads only this. */
export const DOC_NODE_MIME = "application/x-peak-docnode";

/** `system` = heading + slot + price line; `systemTotal` = just the price line. */
export type DocNodePayload = { kind: "line" | "system" | "systemTotal"; sectionId: string; lineKey: string };

const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.length <= max ? v : null);

/** A dropped payload, validated (anything else → null, and the drop is left alone). */
export function parseDocNodePayload(raw: unknown): DocNodePayload | null {
  let v: unknown = raw;
  if (typeof raw === "string") {
    if (!raw || raw.length > 1000) return null;
    try {
      v = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const kind = o.kind === "line" || o.kind === "system" || o.kind === "systemTotal" ? o.kind : null;
  const sectionId = str(o.sectionId, MAX_SECTION_ID);
  const lineKey = o.lineKey === undefined ? "" : str(o.lineKey, MAX_LINE_KEY);
  if (!kind || !sectionId || lineKey === null) return null;
  if (kind === "line" && !lineKey) return null;
  return { kind, sectionId, lineKey: kind === "line" ? lineKey : "" };
}

/** What a BOM row's dragstart writes (application/x-peak-docnode). */
export const docNodeDragData = (p: DocNodePayload): string => JSON.stringify({ kind: p.kind, sectionId: p.sectionId, lineKey: p.lineKey });

/** A line's product block: its library paragraph (else one empty paragraph),
 *  photo on the right at 34 % (DEFAULT_PHOTO). A custom / allowance line
 *  anchors on its `line:<id>` token and never reads the library. */
export function lineNodes(sec: Pick<SpecSection, "id">, it: SpecItem, paragraph: string | null | undefined): PDBlock[] {
  const sku = keyProductSkuOf(it);
  return [productBlockFor(sec.id, it.id, sku, isLineToken(sku) ? "" : paragraph || "")];
}

/** A system: heading (level 2, its name), an empty paragraph (the cursor
 *  lands there — the intro goes above the price line) and its live price line. */
export const systemNodes = (sec: Pick<SpecSection, "id" | "name">): PDBlock[] => [...systemHeadingBlocks(sec), { type: "paragraph" }, systemTotalBlock(sec.id)];

/** The system price line alone. */
export const systemTotalNodes = (sec: Pick<SpecSection, "id">): PDBlock[] => [systemTotalBlock(sec.id)];

/** A saved system intro → paragraphs / bullet lists (narrativeBlocks rules). */
export const introNodes = (text: string | null | undefined): PDBlock[] => textToBlocks(text);

/** The Not included list: the quote's own text, else the default — one bullet per item. */
export function notIncludedNodes(text: string | null | undefined, fallback: string | null | undefined): PDBlock[] {
  const own = notIncludedItems(text);
  const ul = bulletListOf(own.length ? own : notIncludedItems(fallback));
  return ul ? [ul] : [];
}

export const priceTableNodes = (): PDBlock[] => [{ type: "priceTable" } satisfies PDPriceTable];
export const pageBreakNodes = (): PDBlock[] => [{ type: "pageBreak" } satisfies PDPageBreak];

/** The nodes a dropped / inserted BOM row becomes, or null when its system
 *  or line is gone (or the line can't be featured). `paragraphOf` reads the
 *  cached library paragraph for a sku. */
export function docNodesFor(p: DocNodePayload, sections: readonly SpecSection[], paragraphOf: (sku: string) => string | null | undefined): PDBlock[] | null {
  const sec = findSection(sections, p.sectionId);
  if (!sec) return null;
  if (p.kind === "system") return systemNodes(sec);
  if (p.kind === "systemTotal") return systemTotalNodes(sec);
  const it = findLine(sec, p.lineKey);
  if (!it || !isKeyProductEligible(it)) return null;
  const sku = keyProductSkuOf(it);
  return lineNodes(sec, it, isLineToken(sku) ? "" : paragraphOf(sku));
}

/** The library sku a line payload needs before it can be built ("" = none). */
export function payloadLibrarySku(p: DocNodePayload, sections: readonly SpecSection[]): string {
  if (p.kind !== "line") return "";
  const it = findLine(findSection(sections, p.sectionId), p.lineKey);
  if (!it || !isKeyProductEligible(it)) return "";
  const sku = keyProductSkuOf(it);
  return isLineToken(sku) ? "" : sku;
}

/* ---- ✓: what the document already holds ---- */

export type DocPresence = { chipSystems: Set<string>; headings: Set<string>; lines: Set<string> };

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const lineId = (sectionId: string, lineKey: string | number) => sectionId + "\u0000" + String(lineKey);

export function docPresence(doc: PackageDoc | null | undefined): DocPresence {
  const out: DocPresence = { chipSystems: new Set(), headings: new Set(), lines: new Set() };
  for (const n of walkDoc(doc)) {
    if (n.type === "chip" && (n.attrs.kind === "systemPrice" || n.attrs.kind === "systemName")) out.chipSystems.add(n.attrs.ref);
    else if (n.type === "systemTotal") out.chipSystems.add(n.attrs.sectionId);
    else if (n.type === "heading") {
      const t = norm(inlineText(n.content));
      if (t) out.headings.add(t);
    } else if (n.type === "productBlock") out.lines.add(lineId(n.attrs.sectionId, n.attrs.lineKey));
  }
  return out;
}

/** A system is in the document when a price/name chip or price line refers to it or a heading carries its name. */
export function systemInDoc(sec: Pick<SpecSection, "id" | "name">, pr: DocPresence): boolean {
  const name = norm(sec.name || "");
  return pr.chipSystems.has(sec.id) || (!!name && pr.headings.has(name));
}

/** A line is in the document when a product block anchors on it (same system + line). */
export const lineInDoc = (sectionId: string, lineKey: string | number, pr: DocPresence): boolean => pr.lines.has(lineId(sectionId, lineKey));

/* ---- BOM tree ---- */

export type BomSystem = { sec: SpecSection; lines: SpecItem[] };
export type BomGroup = { group: SystemGroup | null; systems: BomSystem[] };

/** Systems by group in Build order (the hook's groupBlocks), each with the
 *  lines that can become a product block. Empty groups are left out. */
export function bomTree(blocks: ReadonlyArray<GroupBlock<SpecSection>>): BomGroup[] {
  return (blocks || [])
    .filter((b) => b && b.sections.length > 0)
    .map((b) => ({
      group: b.group,
      systems: b.sections.map((sec) => ({ sec, lines: (Array.isArray(sec.items) ? sec.items : []).filter((it) => it && isKeyProductEligible(it)) })),
    }));
}

export const lineLabel = (it: SpecItem): string => keyProductHeading(it) || keyProductSkuOf(it) || "Line " + it.id;

/* ---- Gaps ---- */

export type GapRow =
  | { key: string; tone: "warn" | "info"; text: string; action?: undefined }
  | { key: string; tone: "warn"; text: string; action: { kind: "scroll"; sectionId: string; lineKey: string; sku: string } }
  | { key: string; tone: "warn"; text: string; action: { kind: "insertSystem"; sectionId: string } };

export const REMOVED_CHIP_TEXT: Record<ChipKind, string> = {
  systemPrice: "A price for a removed system",
  systemName: "A name for a removed system",
  lineQty: "A quantity for a removed line",
  quoteNumber: "A removed quote number",
  grandTotal: "A removed grand total",
};

/** "A", "A and B", "A, B and C". */
export function joinNames(names: readonly string[]): string {
  const n = names.map((s) => (s || "").trim() || "Untitled system");
  if (n.length <= 1) return n[0] || "";
  return n.slice(0, -1).join(", ") + " and " + n[n.length - 1];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The Build package tab's own (client-side) gaps — readiness.ts's
 *  packageBadge counts, worded like the package panel's chips. With a
 *  document (`hasDocument`) the narrative-field gaps are left out. */
export function packageReadinessGaps(sections: SpecSection[], hasDocument = false): string[] {
  const secs = Array.isArray(sections) ? sections : [];
  // A document replaces the narrative fields: only client goals (and the
  // package's drawings, always satisfied here) still count.
  if (hasDocument) return packageGapChips({ noDatasheet: 0, drawings: 1, keyProductsNeedText: 0, scopesNoGoals: scopesWithoutGoals(secs) });
  const noIntro = secs.filter((s) => systemPrintsInBody(s) && s.presentation === "narrative" && !(s.narrative || "").trim()).length;
  const out = noIntro ? [`${plural(noIntro, "narrative system has", "narrative systems have")} no intro`] : [];
  return out.concat(packageGapChips({ noDatasheet: 0, drawings: 1, keyProductsNeedText: keyProductsNeedingText(secs), scopesNoGoals: scopesWithoutGoals(secs) }));
}

/** The Gaps list, in order: removed chips, products no longer in the BOM
 *  (click scrolls to the block), systems the document never mentions (click
 *  inserts heading + intro paragraph + price line at the end), the itemized-appendix note, then
 *  the package gaps. `nameOf` names a product block's sku (library description). */
export function gapRows(gaps: DocGaps, packageGaps: readonly string[], nameOf: (sku: string) => string | null | undefined = () => null): GapRow[] {
  const rows: GapRow[] = [];
  gaps.removedChips.forEach((c, i) => rows.push({ key: `chip-${i}`, tone: "warn", text: REMOVED_CHIP_TEXT[c.kind] || "A removed item" }));
  gaps.productsNotInBom.forEach((b, i) => {
    const name = (!isLineToken(b.sku) && nameOf(b.sku)) || (isLineToken(b.sku) ? "A custom line" : b.sku) || "A product";
    rows.push({ key: `pb-${i}`, tone: "warn", text: `${name} — No longer in BOM`, action: { kind: "scroll", sectionId: b.sectionId, lineKey: b.lineKey, sku: b.sku } });
  });
  gaps.systemsNotMentioned.forEach((s) =>
    rows.push({ key: `sys-${s.id}`, tone: "warn", text: `${(s.name || "").trim() || "Untitled system"} isn't in the document`, action: { kind: "insertSystem", sectionId: s.id } })
  );
  if (gaps.itemizedInAppendix.length) rows.push({ key: "appendix", tone: "info", text: `Lines for ${joinNames(gaps.itemizedInAppendix)} print in the appendix.` });
  packageGaps.forEach((g, i) => rows.push({ key: `pkg-${i}`, tone: "warn", text: g }));
  return rows;
}

/* ---- the editor's insert API (left-pane buttons) ---- */

/** What the editor hands the left pane (onReady). The pane never touches TipTap. */
export type PackageDocApi = {
  /** Insert blocks at the cursor (never splitting a list or a product block), or at the end. */
  insertBlocks: (nodes: PDBlock[], where?: "cursor" | "end") => boolean;
  /** Build a BOM row's nodes (fetching its library paragraph first when needed) and insert them at the cursor / end. */
  insertDocNode: (p: DocNodePayload, where?: "cursor" | "end") => Promise<boolean>;
  /** Put the cursor in a product block and scroll it into view. */
  scrollToProduct: (t: { sectionId: string; lineKey: string; sku?: string }) => boolean;
  /** Emit any pending keystrokes now (a programmatic Save calls this before it reads the document). */
  flush: () => void;
};
