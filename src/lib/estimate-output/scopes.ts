import type { SpecSection } from "@/app/(app)/estimator/types";
import type { QuoteDocumentProps } from "@/app/(app)/estimator/quote-document";
import { lineExtSellOf, systemSellTotal } from "@/app/(app)/estimator/pricing";
import { systemPrintsInBody } from "@/app/(app)/estimator/quote-document-view";
import { narrativeBlocks, printableKeyProducts, type NarrativeBlock, type PrintableKeyProduct } from "@/app/(app)/estimator/narrative";
import { rewardPointsAppliedLabel } from "@/lib/rewards/points";
import { COVER_TEXT_MAX, cleanPlainText, effectiveDiscipline, type ScopeDiscipline } from "./fields";

/**
 * #301 slice A — what the cover PDF prints, from the customer document's own
 * props (QuoteDocumentProps — R20). Pure and client-safe: the narrative
 * column's source chip and the cover builder share coverParagraphFor.
 *
 * A scope is a system the document prints (systemPrintsInBody — the same set
 * and order as QuoteDocument's bands, D-a); its price is systemSellTotal
 * (freight, a typed sell and $25 rounding inside). Nothing re-prices. R1:
 * Σ scope prices − t.credit = t.grand (tax is 0).
 */

export const MISSING_COVER = "[needs a paragraph]";
export const LABOR_COVER = "Installation, commissioning & project management.";

export type CoverSource = "override" | "intro" | "key-product" | "labor" | "missing";
export const COVER_SOURCE_LABEL: Record<CoverSource, string> = {
  override: "Override",
  intro: "From intro",
  "key-product": "From key product",
  labor: "Labor wording",
  missing: "Needs a paragraph",
};
export type CoverParagraph = { text: string; source: CoverSource };

function firstParagraph(blocks: NarrativeBlock[]): string {
  const b = blocks.find((x) => x.kind === "p");
  return b && b.kind === "p" ? b.lines.map((l) => l.trim()).filter(Boolean).join(" ") : "";
}

/** D-d: the override, else the intro's first paragraph, else (labor) the
 *  labor wording, else the first key product's first paragraph, else the
 *  visible placeholder — never blocking. */
export function coverParagraphFor(sec: SpecSection): CoverParagraph {
  const o = cleanPlainText(sec.coverText, COVER_TEXT_MAX);
  if (o) return { text: o, source: "override" };
  const intro = firstParagraph(narrativeBlocks(sec.narrative));
  if (intro) return { text: intro, source: "intro" };
  if (sec.kind === "labor") return { text: LABOR_COVER, source: "labor" };
  const kp = printableKeyProducts(sec)[0];
  const kpText = kp ? firstParagraph(kp.blocks) : "";
  if (kpText) return { text: kpText, source: "key-product" };
  return { text: MISSING_COVER, source: "missing" };
}

export type OutputScope = {
  id: string;
  num: number;
  name: string;
  isLabor: boolean;
  discipline: ScopeDiscipline | null;
  price: number;
  clientGoals: string;
  cover: CoverParagraph;
  /** #301 slice B — the intro as printable blocks, and the resolved key
   *  products (the package page shows them on every scope). */
  introBlocks: NarrativeBlock[];
  keyProducts: PrintableKeyProduct[];
};

export function outputScopes(p: Pick<QuoteDocumentProps, "sections">): OutputScope[] {
  return (p.sections || []).filter(systemPrintsInBody).map((sec, i) => ({
    id: sec.id,
    num: i + 1,
    name: sec.name || "",
    isLabor: sec.kind === "labor",
    discipline: effectiveDiscipline(sec),
    price: systemSellTotal(sec),
    clientGoals: (sec.clientGoals || "").trim(),
    cover: coverParagraphFor(sec),
    introBlocks: narrativeBlocks(sec.narrative),
    keyProducts: printableKeyProducts(sec),
  }));
}

export type AddOption = { num: number; label: string; desc: string; reason: string; sectionName: string; price: number };

/** D-f: every option line in document order (all systems, as QuoteDocument's
 *  Optional additions box), only when the quote's Options toggle is on. */
export function addOptions(p: Pick<QuoteDocumentProps, "sections" | "pdfOptions">): AddOption[] {
  if (!p.pdfOptions) return [];
  const out: AddOption[] = [];
  for (const sec of p.sections || []) {
    for (const it of sec.items || []) {
      if (!it || !it.option) continue;
      const num = out.length + 1;
      out.push({ num, label: `ADD OPTION ${num}`, desc: it.desc || "", reason: (it.comment || "").trim(), sectionName: sec.name || "", price: lineExtSellOf(it) });
    }
  }
  return out;
}

export type CoverTotals = { credit: number; creditLabel: string | null; totalLabel: string; total: number; rewardsLine: string; standingLines: string[] };

/** R1: the totals lines exactly where QuoteDocument prints them. */
export function coverTotals(p: Pick<QuoteDocumentProps, "t" | "sections" | "isPortalCatalog" | "rewardsLine" | "standingLines">): CoverTotals {
  const credit = p.t.credit || 0;
  const anyPor = !!p.isPortalCatalog && (p.sections || []).some((sec) => sec.items.some((it) => !it.option && it.por));
  return {
    credit,
    creditLabel: credit > 0 ? rewardPointsAppliedLabel(credit) : null,
    totalLabel: anyPor ? "Total (excludes items pending price)" : "Total",
    total: p.t.grand,
    rewardsLine: (p.rewardsLine || "").trim(),
    standingLines: (p.standingLines || []).map((l) => l.trim()).filter(Boolean),
  };
}

/** One item per line; list markers and trailing ; / . stripped; blanks and repeats dropped. */
export function notIncludedItems(text: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of (text || "").replace(/\r\n?/g, "\n").split("\n")) {
    const item = raw.replace(/^\s*(?:[-*•]\s+|\d+[.)]\s+)/, "").trim().replace(/[;.]+$/, "").trim();
    if (!item) continue;
    const k = item.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out.slice(0, 40);
}

/** "Not included: a; b; c." — or "" when there is nothing. */
export function notIncludedLine(text: string | null | undefined): string {
  const items = notIncludedItems(text);
  return items.length ? `Not included: ${items.join("; ")}.` : "";
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
}

/** The typed summary, else "This estimate includes N scopes: A, B and C." (D-e). */
export function coverSummaryText(summary: string | null | undefined, names: string[]): string {
  const s = (summary || "").trim();
  if (s) return s;
  const n = names.map((x) => x.trim()).filter(Boolean);
  if (!n.length) return "";
  return `This estimate includes ${n.length} scope${n.length === 1 ? "" : "s"}: ${listNames(n)}.`;
}

/** "Lighting scope" (a name already ending in "scope" is kept). */
export function scopePriceLabel(name: string): string {
  const n = (name || "").trim() || "System";
  return /\bscope$/i.test(n) ? n : `${n} scope`;
}
