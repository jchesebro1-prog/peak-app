/**
 * #43 — business metrics for dashboard widgets. Pure over arrays so the
 * spec harness can drive them; `now` is always a parameter. The bucketing
 * and forecast maths were lifted verbatim from reports/page.tsx.
 */
import type { Quote } from "@/lib/stores/quotes";
import type { ProjectRecord } from "@/lib/stores/projects";
import type { ConsultingEngagement } from "@/lib/stores/engagements";
import type { RangeKey } from "./registry";
import { isActive, isBacklog, isDone, projectTag, type ProjectTag } from "@/lib/pipelines";

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
  /** value-weighted quote.margin over quotes created in [a, b) */
  avgMargin: number;
};

export function salesMetrics(quotes: Quote[], a: number, b: number): SalesMetrics {
  const created = quotes.filter((q) => (q.createdAt || 0) >= a && (q.createdAt || 0) < b);
  const quotedValue = sumValue(created);
  const wonList = quotes.filter((q) => q.status === "won" && wonAt(q) >= a && wonAt(q) < b);
  const lostList = quotes.filter((q) => q.status === "lost" && decidedAt(q) >= a && decidedAt(q) < b);
  const decided = wonList.length + lostList.length;
  const marginDollars = created.reduce((s, q) => s + (q.value || 0) * (q.margin || 0), 0);
  return {
    quotedValue,
    avg: created.length ? quotedValue / created.length : 0,
    wonValue: sumValue(wonList),
    won: wonList.length,
    lost: lostList.length,
    winRate: decided ? (wonList.length / decided) * 100 : 0,
    avgMargin: quotedValue ? marginDollars / quotedValue : 0,
  };
}

/* ---- projects ---- */

const byTarget = (a: ProjectRecord, b: ProjectRecord) =>
  (a.targetDate ?? Number.MAX_SAFE_INTEGER) - (b.targetDate ?? Number.MAX_SAFE_INTEGER);

export function openProjects(projects: ProjectRecord[]): ProjectRecord[] {
  return projects.filter((p) => isActive(p)).sort(byTarget);
}

export function backlogProjects(projects: ProjectRecord[]): ProjectRecord[] {
  return projects.filter((p) => isBacklog(p)).sort(byTarget);
}

/** "Project profit" v1 (decision 9): projected, value × margin over the open book. */
export function projectedProfit(projects: ProjectRecord[]): { value: number; profit: number; margin: number } {
  const book = projects.filter((p) => !isDone(p));
  const value = sumValue(book);
  const profit = book.reduce((s, p) => s + (p.value || 0) * (p.margin || 0), 0);
  return { value, profit, margin: value ? profit / value : 0 };
}

/* ---- equipment sold ---- */

type SpecLike = {
  sections?: Array<{
    kind?: string;
    items?: Array<{ sku?: string; desc?: string; qty?: number; price?: number; labor?: boolean; option?: boolean }>;
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
      for (const it of s.items || []) {
        if (it.labor || it.option) continue;
        const sku = it.sku || "";
        const category = (sku && partCategory(sku)) || "Uncategorized";
        const qty = it.qty || 0;
        const value = qty * (it.price || 0);
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

/* ---- installs book + billing forecast (forward, always 12 months) ---- */

export type ForecastBucket = { start: number; billed: number; collected: number };

export function installsForecast(
  projects: ProjectRecord[],
  engagements: ConsultingEngagement[],
  now: number,
  horizonMonths: number
): {
  book: ProjectRecord[];
  totalValue: number;
  blended: number;
  cost: number;
  buckets: ForecastBucket[];
  bucketMs: number;
  toBill: number;
  collected: number;
  byStage: Array<{ stage: string; tag: ProjectTag; count: number; value: number }>;
  upcoming: ProjectRecord[];
  timeline: ProjectRecord[];
  windowMs: number;
} {
  const H = horizonMonths;
  const windowMs = H * 30 * DAY;
  const horizonEnd = now + windowMs;
  const book = projects.filter((p) => !isDone(p) && (p.targetDate == null || p.targetDate <= horizonEnd));
  const totalValue = sumValue(book);
  const blended = totalValue ? book.reduce((a, p) => a + (p.value || 0) * (p.margin || 0), 0) / totalValue : 0;
  const cost = Math.round(totalValue * (1 - blended));

  // Full value billed at landing (targetDate), collected net-30 after.
  // Consulting milestone fees (D90) land the same way — forecast-only.
  const msPoints = engagements
    .flatMap((e) => e.milestones)
    .filter((m) => !m.completedAt && (m.amount || 0) > 0 && m.targetDate > 0 && m.targetDate <= horizonEnd);
  const bC = 6;
  const bucketMs = windowMs / bC;
  const buckets: ForecastBucket[] = [];
  for (let i = 0; i < bC; i++) {
    const lo = now + i * bucketMs;
    const hi = now + (i + 1) * bucketMs;
    let billed = 0;
    let collected = 0;
    book.forEach((p) => {
      const land = p.targetDate || 0;
      if (land >= lo && land < hi) billed += p.value || 0;
      const coll = land + 30 * DAY;
      if (coll >= lo && coll < hi) collected += p.value || 0;
    });
    msPoints.forEach((m) => {
      if (m.targetDate >= lo && m.targetDate < hi) billed += m.amount || 0;
      const coll = m.targetDate + 30 * DAY;
      if (coll >= lo && coll < hi) collected += m.amount || 0;
    });
    buckets.push({ start: lo, billed, collected });
  }
  const toBill =
    sumValue(book.filter((p) => (p.targetDate || 0) >= now && (p.targetDate || 0) <= horizonEnd)) +
    msPoints.filter((m) => m.targetDate >= now).reduce((a, m) => a + (m.amount || 0), 0);
  const collected =
    sumValue(book.filter((p) => (p.targetDate || 0) + 30 * DAY >= now && (p.targetDate || 0) + 30 * DAY <= horizonEnd)) +
    msPoints.filter((m) => m.targetDate + 30 * DAY >= now && m.targetDate + 30 * DAY <= horizonEnd).reduce((a, m) => a + (m.amount || 0), 0);

  const stageMap = new Map<string, { value: number; count: number; tag: ProjectTag }>();
  book.forEach((p) => {
    const label = p.stageMeta?.label ?? p.stage;
    const e = stageMap.get(label) || { value: 0, count: 0, tag: projectTag(p) };
    e.value += p.value || 0;
    e.count += 1;
    stageMap.set(label, e);
  });
  const byStage = [...stageMap.entries()].map(([stage, e]) => ({ stage, tag: e.tag, count: e.count, value: e.value }));

  const timeline = [...book].sort((a, b) => (a.targetDate || 0) - (b.targetDate || 0));
  return { book, totalValue, blended, cost, buckets, bucketMs, toBill, collected, byStage, upcoming: timeline.slice(0, 6), timeline, windowMs };
}
