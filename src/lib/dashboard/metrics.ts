/**
 * #43 — business metrics for dashboard widgets. Pure over arrays so the
 * spec harness can drive them; `now` is always a parameter. The bucketing
 * and forecast maths were lifted verbatim from reports/page.tsx.
 */
import type { Quote } from "@/lib/stores/quotes";
import type { RangeKey } from "./registry";
import { lineExtSellOf } from "@/app/(app)/estimator/pricing";
import { isBonusItem } from "@/lib/estimate-bonus/flags";
import { costFromSell } from "@/lib/markup";

export const DAY = 86_400_000;

export type Bucket = { start: number; end: number; label: string };

export function lastMonths(k: number, now: number): Bucket[] {
  const d = new Date(now);
  const arr: Bucket[] = [];
  for (let i = k - 1; i >= 0; i--) {
    const start = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const end = new Date(d.getFullYear(), d.getMonth() - i + 1, 1);
    arr.push({ start: start.getTime(), end: end.getTime(), label: start.toLocaleDateString("en-US", { month: "short" }) });
  }
  return arr;
}

export function salesBuckets(range: RangeKey, now: number): Bucket[] {
  if (range === "qtr") return lastMonths(3, now);
  if (range === "12m") {
    const m = lastMonths(12, now);
    const q: Bucket[] = [];
    for (let i = 0; i < 4; i++) {
      const chunk = m.slice(i * 3, i * 3 + 3);
      q.push({ start: chunk[0].start, end: chunk[2].end, label: `Q${i + 1}` });
    }
    return q;
  }
  return lastMonths(6, now);
}

export function periodBounds(range: RangeKey, now: number): { start: number; end: number; priorStart: number } {
  const start = salesBuckets(range, now)[0].start;
  return { start, end: now + 1, priorStart: start - (now - start) };
}

export function wonAt(q: Quote): number {
  const h = (q.history || []).filter((e) => e.to === "won");
  return h.length ? h[h.length - 1].at : q.updatedAt || 0;
}

export function decidedAt(q: Quote): number {
  const h = (q.history || []).filter((e) => e.to === "won" || e.to === "lost");
  return h.length ? h[h.length - 1].at : q.updatedAt || 0;
}

const sumValue = (arr: Array<{ value: number }>) => arr.reduce((s, x) => s + (x.value || 0), 0);

export type SalesMetrics = {
  quotedValue: number;
  avg: number;
  wonValue: number;
  won: number;
  lost: number;
  winRate: number;
  /** cost-weighted quote markup over quotes created in [a, b): Σ profit ÷ Σ cost (#367). */
  avgMarkup: number;
};

export function salesMetrics(quotes: Quote[], a: number, b: number): SalesMetrics {
  const created = quotes.filter((q) => (q.createdAt || 0) >= a && (q.createdAt || 0) < b);
  const quotedValue = sumValue(created);
  const wonList = quotes.filter((q) => q.status === "won" && wonAt(q) >= a && wonAt(q) < b);
  const lostList = quotes.filter((q) => q.status === "lost" && decidedAt(q) >= a && decidedAt(q) < b);
  const decided = wonList.length + lostList.length;
  // #367: quote.margin holds a markup k; a quote's cost is value ÷ (1 + k) and its profit value − cost.
  // costFromSell is guarded: a junk k or 1 + k ≤ 0 (a stored −1) counts the quote at cost (profit 0),
  // never ±Infinity / NaN; a zero-cost quote's k = 0 also prices at cost (markup 0).
  const costSum = created.reduce((s, q) => s + costFromSell(q.value || 0, q.margin || 0), 0);
  const profit = quotedValue - costSum;
  return {
    quotedValue,
    avg: created.length ? quotedValue / created.length : 0,
    wonValue: sumValue(wonList),
    won: wonList.length,
    lost: lostList.length,
    winRate: decided ? (wonList.length / decided) * 100 : 0,
    avgMarkup: costSum > 0 && Number.isFinite(profit / costSum) ? profit / costSum : 0,
  };
}

/* ---- equipment sold ---- */

type SpecLike = {
  sections?: Array<{
    kind?: string;
    alternate?: true;
    items?: Array<{
      sku?: string;
      desc?: string;
      qty?: number;
      price?: number;
      extSellOverride?: number;
      labor?: boolean;
      bonus?: string;
      option?: boolean;
    }>;
  }>;
};

export type SoldItem = { sku: string; desc: string; qty: number; value: number };
export type SoldCategory = { category: string; value: number; qty: number; items: SoldItem[] };

export function equipmentSold(
  quotes: Quote[],
  partCategory: (sku: string) => string | undefined,
  a: number,
  b: number
): SoldCategory[] {
  const cats = new Map<string, { value: number; qty: number; items: Map<string, SoldItem> }>();
  for (const q of quotes) {
    if (q.status !== "won") continue;
    const at = wonAt(q);
    if (at < a || at >= b) continue;
    for (const s of ((q.spec as SpecLike | undefined)?.sections) || []) {
      if (s.kind === "labor") continue;
      // Phase 2b: an Alternate group's systems are out of the base bid, like option lines
      if (s.alternate) continue;
      for (const it of s.items || []) {
        if (it.labor || it.option || isBonusItem(it)) continue;
        const sku = it.sku || "";
        const category = (sku && partCategory(sku)) || "Uncategorized";
        const qty = it.qty || 0;
        // Honor a manual extended-sell override (punch: unit/ext sell edits
        // keep each other in sync) instead of always recomputing qty × price.
        const value = lineExtSellOf({ qty, price: it.price || 0, extSellOverride: it.extSellOverride });
        const c = cats.get(category) || { value: 0, qty: 0, items: new Map() };
        c.value += value;
        c.qty += qty;
        const key = sku || it.desc || "?";
        const row = c.items.get(key) || { sku, desc: it.desc || sku, qty: 0, value: 0 };
        row.qty += qty;
        row.value += value;
        c.items.set(key, row);
        cats.set(category, c);
      }
    }
  }
  return [...cats.entries()]
    .map(([category, c]) => ({ category, value: c.value, qty: c.qty, items: [...c.items.values()].sort((x, y) => y.value - x.value) }))
    .sort((x, y) => y.value - x.value);
}
