/**
 * Manufacturer analytics (Manufacturer section Part 3, spec
 * docs/superpowers/specs/2026-10-03-manufacturer-page-and-analytics-design.md):
 * what Peak has quoted through each manufacturer — cost as quoted, sell
 * alongside — plus a history-weighted forecast of what is still open.
 *
 * Pure — no I/O. The loader hands in the quotes, a sku → catalog part map and
 * a canonical-key resolver (merged manufacturers), so the same code runs on
 * the server and in the harness.
 */
import type { Quote } from "@/lib/stores/quotes";
import type { SpecItem, SpecSection } from "@/app/(app)/estimator/types";
import { lineExtSellOf } from "@/app/(app)/estimator/pricing";
import { isRewardCreditItem } from "@/lib/rewards/credit-line";
import { decidedAt, wonAt } from "@/lib/dashboard/metrics";
import { mfrKey } from "@/lib/catalog-books";

export type AnalyticsQuote = Pick<Quote, "id" | "status" | "createdAt" | "updatedAt" | "history" | "spec">;
export type AnalyticsPart = { sku: string; mfr?: string; desc?: string };
export type MoneyPair = { cost: number; sell: number };
export type ManufacturerMetrics = {
  key: string;
  quoted: MoneyPair;
  won: MoneyPair;
  lost: MoneyPair;
  open: MoneyPair;
  draft: MoneyPair;
  /** won ÷ (won + lost) by cost; null when both are 0. */
  winRate: number | null;
  /** open × (winRate ?? shopWinRate ?? 0). */
  forecast: MoneyPair;
  usedShopRate: boolean;
  /** "YYYY-MM" (America/Chicago), 12 entries, oldest first. */
  monthlyWon: Array<{ month: string; cost: number; sell: number }>;
  topParts: Array<{ sku: string; desc: string; qty: number; cost: number }>;
  quotes: number;
};
export type AnalyticsResult = {
  byKey: Map<string, ManufacturerMetrics>;
  shopWinRate: number | null;
  windowStart: number;
  now: number;
};

export const ANALYTICS_WINDOW_MS = 365 * 24 * 3600 * 1000;

type AttributedLine = { key: string; sku: string; desc: string; qty: number; cost: number; sell: number };

const num = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) ? n : 0);

/** The quote's catalog-attributable lines: labor, options, the rewards credit,
 *  allowances and price-on-request lines are skipped; a fixture line counts
 *  each component; a line with no manufacturer is skipped. */
export function attributedLines(
  q: AnalyticsQuote,
  partsBySku: ReadonlyMap<string, AnalyticsPart>,
  canonical: (key: string) => string,
): AttributedLine[] {
  const spec = q.spec as { sections?: unknown } | null | undefined;
  const sections = spec && Array.isArray(spec.sections) ? (spec.sections as SpecSection[]) : [];
  const out: AttributedLine[] = [];
  const keyFor = (sku: string, own?: string): string => {
    const raw = partsBySku.get(sku)?.mfr || own || "";
    const k = mfrKey(raw);
    return k ? canonical(k) : "";
  };
  for (const sec of sections) {
    if (!sec || sec.kind === "labor" || !Array.isArray(sec.items)) continue;
    for (const it of sec.items as SpecItem[]) {
      if (!it || it.labor || it.laborOverhead || it.laborTravel || it.option || it.allowance || it.por || isRewardCreditItem(it)) continue;
      const lineQty = num(it.qty);
      if (Array.isArray(it.components) && it.components.length) {
        for (const c of it.components) {
          const qty = num(c.qty) * lineQty;
          const key = keyFor(c.sku, undefined);
          if (!key || qty <= 0) continue;
          out.push({ key, sku: c.sku, desc: partsBySku.get(c.sku)?.desc || c.label || "", qty, cost: num(c.cost) * qty, sell: num(c.price) * qty });
        }
        continue;
      }
      const key = keyFor(it.sku, it.manufacturer);
      if (!key) continue;
      out.push({ key, sku: it.sku, desc: partsBySku.get(it.sku)?.desc || it.desc || "", qty: lineQty, cost: lineQty * num(it.cost), sell: lineExtSellOf(it) });
    }
  }
  return out;
}

const monthFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit" });
const monthOf = (t: number): string => {
  const p = monthFmt.formatToParts(new Date(t));
  return `${p.find((x) => x.type === "year")!.value}-${p.find((x) => x.type === "month")!.value}`;
};

/** The 12 "YYYY-MM" keys ending with `now`'s Chicago month, oldest first. */
function lastTwelveMonths(now: number): string[] {
  const [y, m] = monthOf(now).split("-").map(Number);
  const out: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const idx = y * 12 + (m - 1) - i;
    out.push(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`);
  }
  return out;
}

const pair = (): MoneyPair => ({ cost: 0, sell: 0 });
const add = (p: MoneyPair, cost: number, sell: number) => {
  p.cost += cost;
  p.sell += sell;
};
const rate = (won: number, lost: number): number | null => (won + lost > 0 ? won / (won + lost) : null);

type Acc = {
  m: ManufacturerMetrics;
  quoteIds: Set<string>;
  months: Map<string, MoneyPair>;
  parts: Map<string, { sku: string; desc: string; qty: number; cost: number }>;
};

export function manufacturerAnalytics(
  quotes: readonly AnalyticsQuote[],
  partsBySku: ReadonlyMap<string, AnalyticsPart>,
  canonical: (key: string) => string,
  now: number,
): AnalyticsResult {
  const windowStart = now - ANALYTICS_WINDOW_MS;
  const inWindow = (t: number) => t >= windowStart && t <= now;
  const months = lastTwelveMonths(now);
  const accs = new Map<string, Acc>();
  const accFor = (key: string): Acc => {
    let a = accs.get(key);
    if (!a) {
      a = {
        m: {
          key, quoted: pair(), won: pair(), lost: pair(), open: pair(), draft: pair(),
          winRate: null, forecast: pair(), usedShopRate: false,
          monthlyWon: [], topParts: [], quotes: 0,
        },
        quoteIds: new Set(), months: new Map(months.map((mo) => [mo, pair()])), parts: new Map(),
      };
      accs.set(key, a);
    }
    return a;
  };

  for (const q of quotes) {
    const lines = attributedLines(q, partsBySku, canonical);
    if (!lines.length) continue;
    const status = q.status;
    const quotedHere = inWindow(q.createdAt || 0) && (status === "sent" || status === "won" || status === "lost");
    const wonHere = status === "won" && inWindow(wonAt(q as Quote));
    const lostHere = status === "lost" && inWindow(decidedAt(q as Quote));
    const wonMonth = wonHere ? monthOf(wonAt(q as Quote)) : "";
    for (const l of lines) {
      const a = accFor(l.key);
      if (quotedHere) {
        add(a.m.quoted, l.cost, l.sell);
        a.quoteIds.add(q.id);
        const p = a.parts.get(l.sku) || { sku: l.sku, desc: l.desc, qty: 0, cost: 0 };
        p.qty += l.qty;
        p.cost += l.cost;
        if (!p.desc) p.desc = l.desc;
        a.parts.set(l.sku, p);
      }
      if (wonHere) {
        add(a.m.won, l.cost, l.sell);
        const mo = a.months.get(wonMonth);
        if (mo) add(mo, l.cost, l.sell);
      }
      if (lostHere) add(a.m.lost, l.cost, l.sell);
      if (status === "sent") add(a.m.open, l.cost, l.sell);
      if (status === "draft") add(a.m.draft, l.cost, l.sell);
    }
  }

  let shopWon = 0;
  let shopLost = 0;
  for (const a of accs.values()) {
    shopWon += a.m.won.cost;
    shopLost += a.m.lost.cost;
  }
  const shopWinRate = rate(shopWon, shopLost);

  const byKey = new Map<string, ManufacturerMetrics>();
  for (const [key, a] of accs) {
    const m = a.m;
    m.winRate = rate(m.won.cost, m.lost.cost);
    m.usedShopRate = m.winRate === null;
    const r = m.winRate ?? shopWinRate ?? 0;
    m.forecast = { cost: m.open.cost * r, sell: m.open.sell * r };
    m.monthlyWon = months.map((mo) => ({ month: mo, ...a.months.get(mo)! }));
    m.topParts = [...a.parts.values()].sort((x, y) => y.cost - x.cost || x.sku.localeCompare(y.sku)).slice(0, 10);
    m.quotes = a.quoteIds.size;
    byKey.set(key, m);
  }
  return { byKey, shopWinRate, windowStart, now };
}

/** Sum several manufacturers (a vendor's manufacturers) into one metrics row;
 *  the win rate is recomputed from the summed won/lost, not averaged. */
export function rollupMetrics(
  list: readonly ManufacturerMetrics[],
  shopWinRate: number | null,
): Omit<ManufacturerMetrics, "key" | "topParts"> & { keys: string[] } {
  const sum = (pick: (m: ManufacturerMetrics) => MoneyPair): MoneyPair => {
    const p = pair();
    for (const m of list) add(p, pick(m).cost, pick(m).sell);
    return p;
  };
  const won = sum((m) => m.won);
  const lost = sum((m) => m.lost);
  const open = sum((m) => m.open);
  const winRate = rate(won.cost, lost.cost);
  const r = winRate ?? shopWinRate ?? 0;
  const monthly = new Map<string, MoneyPair>();
  for (const m of list) for (const e of m.monthlyWon) add(monthly.get(e.month) ?? monthly.set(e.month, pair()).get(e.month)!, e.cost, e.sell);
  const monthOrder = list.length ? list[0].monthlyWon.map((e) => e.month) : [];
  return {
    keys: list.map((m) => m.key),
    quoted: sum((m) => m.quoted),
    won, lost, open,
    draft: sum((m) => m.draft),
    winRate,
    forecast: { cost: open.cost * r, sell: open.sell * r },
    usedShopRate: winRate === null,
    monthlyWon: monthOrder.map((mo) => ({ month: mo, ...monthly.get(mo)! })),
    quotes: list.reduce((a, m) => a + m.quotes, 0),
  };
}
