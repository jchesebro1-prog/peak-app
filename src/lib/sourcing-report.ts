/**
 * Batch 6 / #66 (Jeff 2026-10-15) — most-quoted products and projected
 * sourcing: every catalog part on an OPEN estimate (status draft or sent),
 * summed by part and by manufacturer, weighted by the chance it is won.
 *
 * The win chance is the manufacturer analytics rule (#298): the
 * manufacturer's own won ÷ (won + lost) by cost, else the shop's rate, else 0
 * (`rateFor`, built from `manufacturerAnalytics`).
 *
 * Lines counted (the analytics rule, plus assembly expansion): labor sections
 * and lines, the hidden bonus lines (#330), option / allowance /
 * price-on-request lines, the rewards credit and Alternate groups are
 * skipped. An assembly line counts its members (`expandLine`, #332) — a
 * component's own cost as quoted, else today's catalog cost for a live member
 * (racks, Grid `asm:` lines). Grid quotes (flat `spec.lines`) count at
 * today's catalog cost, as in the analytics. Only catalog parts are listed
 * (a custom or allowance line has no part to source).
 *
 * Pure — the loader hands in quotes, parts, fixtures and the rate.
 */
import type { SpecItem, SpecSection } from "@/app/(app)/estimator/types";
import { isRewardCreditItem } from "@/lib/rewards/credit-line";
import { mfrKey } from "@/lib/catalog-books";
import { ALLOWANCE_PART_PREFIX, ASSEMBLY_PART_PREFIX } from "@/lib/design/grid-virtual-parts";
import { CUSTOM_ITEM_PREFIX } from "@/lib/design/grid-custom-items";
import { isLaborSku } from "@/lib/design/wire-labor";
import { isBonusItem } from "@/lib/estimate-bonus/flags";
import { expandLine, type FixtureLookup } from "@/lib/quote-line-members";
import { partModel } from "@/lib/catalog-rename/sku";
import { toCsv } from "@/lib/assessments/csv";

export type SourcingQuote = { id: string; status: string; spec?: unknown };
export type SourcingPart = {
  sku: string;
  mfr?: string;
  desc?: string;
  cost?: number;
  manufacturerModelNumber?: string;
  manufacturerPartNumber?: string;
};
export type SourcingPartRow = {
  sku: string;
  model: string;
  desc: string;
  manufacturer: string;
  mfrKey: string;
  qty: number;
  weightedQty: number;
  weightedCost: number;
  estimates: number;
};
export type SourcingMfrRow = Omit<SourcingPartRow, "sku" | "model" | "desc"> & { parts: number };
export type SourcingReport = { parts: SourcingPartRow[]; manufacturers: SourcingMfrRow[]; openEstimates: number };

/** The statuses an estimate is still open in. */
export const OPEN_STATUSES = ["draft", "sent"] as const;

const num = (n: unknown): number => {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? v : 0;
};
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

type Hit = { sku: string; qty: number; cost: number };

/** One quote's catalog-part hits (qty and extended cost, not yet weighted). */
export function sourcingHits(
  spec: unknown,
  partsBySku: ReadonlyMap<string, SourcingPart>,
  fixtureOf?: FixtureLookup,
): Hit[] {
  const s = spec as { sections?: unknown; lines?: unknown } | null | undefined;
  if (!s || typeof s !== "object") return [];
  const out: Hit[] = [];
  const isPart = (sku: string) => !!sku && partsBySku.has(sku) && !isLaborSku(sku);
  const catalogCost = (sku: string) => num(partsBySku.get(sku)?.cost);
  // A Grid line names the part by document id; one row per real sku.
  const partSku = (sku: string) => partsBySku.get(sku)?.sku || sku;

  if (Array.isArray(s.sections)) {
    for (const sec of s.sections as SpecSection[]) {
      if (!sec || sec.kind === "labor" || sec.alternate || !Array.isArray(sec.items)) continue;
      for (const it of sec.items as SpecItem[]) {
        if (!it || isBonusItem(it) || it.labor || it.laborOverhead || it.laborTravel || it.option || it.allowance || it.por || isRewardCreditItem(it)) continue;
        const members = expandLine(it, fixtureOf);
        if (members) {
          // A component's own unit cost as quoted; a live member (rack) at today's catalog cost.
          const compCost = new Map<string, number>();
          for (const c of Array.isArray(it.components) ? it.components : []) {
            const sku = str(c?.sku);
            if (sku && !compCost.has(sku) && typeof c.cost === "number" && Number.isFinite(c.cost)) compCost.set(sku, c.cost);
          }
          for (const m of members) {
            if (!isPart(m.sku) || !(m.qty > 0)) continue;
            out.push({ sku: partSku(m.sku), qty: m.qty, cost: m.qty * (compCost.get(m.sku) ?? catalogCost(m.sku)) });
          }
          continue;
        }
        const sku = str(it.sku);
        const qty = num(it.qty);
        if (!isPart(sku) || !(qty > 0)) continue;
        out.push({ sku: partSku(sku), qty, cost: qty * num(it.cost) });
      }
    }
    return out;
  }
  if (Array.isArray(s.lines)) {
    for (const raw of s.lines as Array<Record<string, unknown>>) {
      if (!raw || typeof raw !== "object" || raw.allowance || raw.custom || raw.labor === true) continue;
      const sku = str(raw.sku);
      if (!sku || sku.startsWith(ALLOWANCE_PART_PREFIX) || sku.startsWith(CUSTOM_ITEM_PREFIX) || isLaborSku(sku)) continue;
      if (sku.startsWith(ASSEMBLY_PART_PREFIX)) {
        for (const m of expandLine(raw, fixtureOf) || []) {
          if (isPart(m.sku) && m.qty > 0) out.push({ sku: partSku(m.sku), qty: m.qty, cost: m.qty * catalogCost(m.sku) });
        }
        continue;
      }
      const qty = num(raw.qty);
      if (!isPart(sku) || !(qty > 0)) continue;
      out.push({ sku: partSku(sku), qty, cost: qty * catalogCost(sku) });
    }
  }
  return out;
}

/** The report: parts and manufacturers, sorted by weighted cost (then weighted qty, then name). */
export function sourcingReport(
  quotes: readonly SourcingQuote[],
  partsBySku: ReadonlyMap<string, SourcingPart>,
  opts: { canonical?: (key: string) => string; rateFor: (mfrKey: string) => number; fixtureOf?: FixtureLookup },
): SourcingReport {
  const canonical = opts.canonical ?? ((k: string) => k);
  const rate = (k: string) => {
    const r = opts.rateFor(k);
    return Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : 0;
  };
  const parts = new Map<string, SourcingPartRow & { ids: Set<string> }>();
  let openEstimates = 0;
  for (const q of quotes) {
    if (!(OPEN_STATUSES as readonly string[]).includes(q.status)) continue;
    const hits = sourcingHits(q.spec, partsBySku, opts.fixtureOf);
    if (!hits.length) continue;
    openEstimates++;
    for (const h of hits) {
      let row = parts.get(h.sku);
      if (!row) {
        const p = partsBySku.get(h.sku)!;
        const raw = str(p.mfr);
        const k = mfrKey(raw);
        row = {
          sku: h.sku, model: partModel(p), desc: str(p.desc), manufacturer: raw, mfrKey: k ? canonical(k) : "",
          qty: 0, weightedQty: 0, weightedCost: 0, estimates: 0, ids: new Set(),
        };
        parts.set(h.sku, row);
      }
      const r = rate(row.mfrKey);
      row.qty += h.qty;
      row.weightedQty += h.qty * r;
      row.weightedCost += h.cost * r;
      row.ids.add(q.id);
    }
  }
  const mfrs = new Map<string, SourcingMfrRow & { ids: Set<string> }>();
  const partRows: SourcingPartRow[] = [];
  for (const { ids, ...row } of parts.values()) {
    row.estimates = ids.size;
    partRows.push(row);
    const key = row.mfrKey || "";
    let m = mfrs.get(key);
    if (!m) mfrs.set(key, (m = { manufacturer: row.manufacturer, mfrKey: key, qty: 0, weightedQty: 0, weightedCost: 0, estimates: 0, parts: 0, ids: new Set() }));
    m.qty += row.qty;
    m.weightedQty += row.weightedQty;
    m.weightedCost += row.weightedCost;
    m.parts++;
    for (const id of ids) m.ids.add(id);
  }
  const mfrRows: SourcingMfrRow[] = [...mfrs.values()].map(({ ids, ...m }) => ({ ...m, estimates: ids.size }));
  const byWeight = <T extends { weightedCost: number; weightedQty: number }>(name: (x: T) => string) => (a: T, b: T) =>
    b.weightedCost - a.weightedCost || b.weightedQty - a.weightedQty || name(a).localeCompare(name(b));
  partRows.sort(byWeight<SourcingPartRow>((x) => x.model || x.sku));
  mfrRows.sort(byWeight<SourcingMfrRow>((x) => x.manufacturer));
  return { parts: partRows, manufacturers: mfrRows, openEstimates };
}

/** The order a viewer without cost sees: by weighted quantity (cost never decides it). */
export function sortForNoCost<T extends { weightedQty: number; qty: number }>(rows: readonly T[], name: (x: T) => string): T[] {
  return [...rows].sort((a, b) => b.weightedQty - a.weightedQty || b.qty - a.qty || name(a).localeCompare(name(b)));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** CSV of the parts table, formula-injection guarded (`toCsv`). `withCost` false leaves the cost column out. */
export function sourcingCsv(rows: readonly SourcingPartRow[], withCost: boolean): string {
  const header = ["Model #", "SKU", "Description", "Manufacturer", "Quoted qty", "Weighted qty", ...(withCost ? ["Weighted cost"] : []), "Estimates"];
  return toCsv(
    header,
    rows.map((r) => [r.model, r.sku, r.desc, r.manufacturer, round2(r.qty), round2(r.weightedQty), ...(withCost ? [round2(r.weightedCost)] : []), r.estimates]),
  );
}
