import type { SpecItem, SpecSection } from "@/app/(app)/estimator/types";
import { reconcileEstimatorValue, round2, validSellOverride } from "@/app/(app)/estimator/pricing";
import type { BonusRates } from "@/lib/estimate-bonus/flags";
import { discountSkuOf, normalCostOf, sanitizeProjectDiscounts } from "@/lib/project-discounts/rules";
import { deriveEstimatorSections } from "./derive";

/**
 * #368 — Re-price on Revise (ETC price sync spec §9.1). When a sent / won /
 * lost Estimator system quote goes back to Draft, its plain catalog lines move
 * to today's catalog cost before the draft is stored, and each keeps its own
 * cost-to-sell ratio: new cost = catalog cost, new price = old price × new cost
 * ÷ old cost (a typed extended sell scales the same way), rounded to cents.
 * Ratio math is deliberately convention-neutral — never catalogAddPrice or a
 * margin / markup formula (#367 rewrites those).
 *
 * Not re-priced: stored cost ≤ 0, bonus lines, the Rewards credit, vendor-quote,
 * custom, allowance and placeholder-SKU lines, assembly / fixture / rack /
 * track / curtain lines (and the track a curtain hangs from — their own
 * configurators re-price them once the quote is a draft), any labor line
 * (labor / overhead / travel, or a catalog part in the Labor category), a
 * price-on-request line, and a line whose SKU doesn't resolve to a live part
 * with a real cost. A system with a typed price keeps it (its lines' cost
 * moves) and is named in the summary. Pure: the caller loads the catalog.
 */

/** The catalog facts a re-price reads, keyed by the SKU a line names (renames followed by the loader). */
export type RepriceCatalogPart = { sku: string; cost: number; category?: string | null };

/** One re-priced line — costs are the line's NORMAL (pre-project-discount) unit cost. */
export type RepriceChange = {
  sectionId: string;
  lineId: number;
  sku: string;
  desc: string;
  oldCost: number;
  newCost: number;
  oldPrice: number;
  newPrice: number;
};

/** Stored on the quote by the revise that re-priced it (`Quote.repricedOnRevise`); absent when nothing changed. */
export type RepricedOnRevise = {
  at: number;
  /** Who revised (setStatus's actor name). */
  by: string;
  /** Lines re-priced — may exceed `lines.length` (the list is capped). */
  count: number;
  /** The draft's total after the re-price minus before it, both derived the same way (bonus lines, discounts, rounding). */
  delta: number;
  lines: RepriceChange[];
  /** Systems whose typed price was kept although their lines' cost moved. */
  typedSystems: { sectionId: string; name: string }[];
};

/** At most this many change entries are stored (the count is always exact). */
export const REPRICE_LINES_MAX = 500;
const DESC_MAX = 120;

/** Only an Estimator system estimate re-prices on Revise (Grid quotes re-promote; service quotes price from rates). */
export function repriceAppliesTo(q: { source?: string | null; quoteType?: string | null }): boolean {
  return q.source === "estimator" && (q.quoteType || "system") === "system";
}

/** The SKU a line re-prices under, or "" when it never re-prices (the exclusions above, bar the catalog checks). */
export function repriceLineSku(it: SpecItem): string {
  if (!it || typeof it !== "object") return "";
  if (it.por || it.curtainTrackKey) return "";
  // #366's plain-line rule is exactly the rest: custom / vendor / allowance / curtain / labor / bonus / Rewards /
  // assembly / fixture / rack / track lines and placeholder SKUs carry no catalog SKU.
  return discountSkuOf(it);
}

/** Every SKU a re-price would look up, once each. */
export function repriceSkus(sections: SpecSection[]): string[] {
  const out = new Set<string>();
  for (const sec of Array.isArray(sections) ? sections : []) {
    for (const it of Array.isArray(sec?.items) ? sec.items : []) {
      const sku = repriceLineSku(it);
      if (sku) out.add(sku);
    }
  }
  return [...out];
}

function isLaborPart(p: RepriceCatalogPart): boolean {
  return typeof p.category === "string" && p.category.trim().toLowerCase() === "labor";
}

/**
 * Re-price the plain catalog lines of `sections` against `catalog`. Returns the
 * SAME array when nothing changes. A re-priced line drops its project-discount
 * stamp (cost = the new normal cost) — the caller's derivation re-applies the
 * map. Entries beyond REPRICE_LINES_MAX are re-priced but not listed.
 */
export function repriceSections(
  sections: SpecSection[],
  catalog: ReadonlyMap<string, RepriceCatalogPart>
): { sections: SpecSection[]; count: number; lines: RepriceChange[]; typedSystems: { sectionId: string; name: string }[] } {
  const lines: RepriceChange[] = [];
  const typedSystems: { sectionId: string; name: string }[] = [];
  let count = 0;
  if (!Array.isArray(sections)) return { sections, count, lines, typedSystems };
  const out = sections.map((sec) => {
    if (!sec || !Array.isArray(sec.items)) return sec;
    let changed = false;
    const items = sec.items.map((it) => {
      const sku = repriceLineSku(it);
      if (!sku) return it;
      const part = catalog.get(sku);
      if (!part || isLaborPart(part)) return it;
      const oldCost = normalCostOf(it);
      const newCost = round2(Number(part.cost));
      if (!(Number.isFinite(oldCost) && oldCost > 0) || !(Number.isFinite(newCost) && newCost > 0)) return it;
      if (round2(oldCost) === newCost) return it;
      const ratio = newCost / oldCost;
      const oldPrice = Number.isFinite(it.price) ? it.price : 0;
      const next: SpecItem = { ...it, cost: newCost, price: round2(oldPrice * ratio) };
      if (typeof it.extSellOverride === "number" && Number.isFinite(it.extSellOverride)) next.extSellOverride = round2(it.extSellOverride * ratio);
      delete next.catalogCost;
      delete next.projectDiscountPct;
      changed = true;
      count++;
      if (lines.length < REPRICE_LINES_MAX) {
        lines.push({
          sectionId: String(sec.id),
          lineId: it.id,
          sku,
          desc: String(it.desc || "").slice(0, DESC_MAX),
          oldCost: round2(oldCost),
          newCost,
          oldPrice,
          newPrice: next.price,
        });
      }
      return next;
    });
    if (!changed) return sec;
    if (validSellOverride(sec.sellOverride) != null) typedSystems.push({ sectionId: String(sec.id), name: String(sec.name || "") });
    return { ...sec, items };
  });
  return count ? { sections: out, count, lines, typedSystems } : { sections, count, lines, typedSystems };
}

/**
 * The whole Revise re-price for one quote's live spec (renames already
 * followed by the caller): re-price the lines, then run the SAME derivations a
 * save runs (deriveEstimatorSections — discounts, bonus lines — as a draft, and
 * reconcileEstimatorValue for value / margin). Null when no line changed — the
 * caller then stores nothing and leaves the spec untouched.
 */
export function repriceForRevise(
  q: { source?: string | null; quoteType?: string | null },
  spec: { sections?: unknown; projectDiscounts?: unknown } | null | undefined,
  catalog: ReadonlyMap<string, RepriceCatalogPart>,
  bonusRates: BonusRates
): { sections: SpecSection[]; value: number; margin: number; count: number; delta: number; lines: RepriceChange[]; typedSystems: { sectionId: string; name: string }[] } | null {
  if (!repriceAppliesTo(q)) return null;
  const sections = Array.isArray(spec?.sections) ? (spec!.sections as SpecSection[]) : [];
  const r = repriceSections(sections, catalog);
  if (!r.count) return null;
  const ctx = { source: q.source, quoteType: q.quoteType, status: "draft" };
  const discounts = sanitizeProjectDiscounts(spec?.projectDiscounts);
  const after = deriveEstimatorSections(ctx, r.sections, discounts, bonusRates);
  const before = deriveEstimatorSections(ctx, sections, discounts, bonusRates);
  const priced = reconcileEstimatorValue(after, { value: null, margin: null });
  const was = reconcileEstimatorValue(before, { value: null, margin: null });
  return { sections: after, value: priced.value, margin: priced.margin, count: r.count, delta: round2(priced.value - was.value), lines: r.lines, typedSystems: r.typedSystems };
}

/** True when `after` carries a re-price this transition made (a new stamp) — the open Estimator must reload. */
export function repricedNow(before: { repricedOnRevise?: { at?: number } | null } | null | undefined, after: { repricedOnRevise?: { at?: number } | null } | null | undefined): boolean {
  const a = after?.repricedOnRevise?.at;
  return typeof a === "number" && a !== before?.repricedOnRevise?.at;
}

/** The banner's headline: "Revise re-priced 12 lines to today's catalog (+$1,240)". */
export function repriceHeadline(r: Pick<RepricedOnRevise, "count" | "delta">): string {
  const n = r.count;
  const d = round2(r.delta);
  const money = "$" + Math.abs(d).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const sign = d > 0 ? "+" : d < 0 ? "−" : "±";
  return `Revise re-priced ${n} line${n === 1 ? "" : "s"} to today's catalog (${sign}${money})`;
}

/** Shape-clean a stored stamp for the page (null when absent or malformed). */
export function repricedOnReviseOf(raw: unknown): RepricedOnRevise | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<RepricedOnRevise>;
  if (typeof r.at !== "number" || typeof r.count !== "number" || !Array.isArray(r.lines)) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    at: r.at,
    by: typeof r.by === "string" ? r.by : "",
    count: num(r.count),
    delta: num(r.delta),
    lines: r.lines.slice(0, REPRICE_LINES_MAX).filter((l) => !!l && typeof l === "object").map((l) => ({
      sectionId: String(l.sectionId ?? ""),
      lineId: num(l.lineId),
      sku: String(l.sku ?? ""),
      desc: String(l.desc ?? "").slice(0, DESC_MAX),
      oldCost: num(l.oldCost),
      newCost: num(l.newCost),
      oldPrice: num(l.oldPrice),
      newPrice: num(l.newPrice),
    })),
    typedSystems: Array.isArray(r.typedSystems)
      ? r.typedSystems.filter((t) => !!t && typeof t === "object").map((t) => ({ sectionId: String(t.sectionId ?? ""), name: String(t.name ?? "") }))
      : [],
  };
}
