/**
 * #368 — ETC price-list rows → catalog writes. Pure: the caller passes the
 * live catalog, the import resolver and the deleted SKUs; nothing here reads
 * or writes.
 *
 * Rules (spec §6):
 * - Rows merge by part number. A part in two priced lists takes the first in
 *   the order finished goods → spare parts → flat-rate repair; a demo row adds
 *   its netPrice as `demoPrice` to the same item.
 * - Matching: the catalog importer's own resolver (`importResolverFor`, #304)
 *   with mfr "ETC" and the part number as SKU and MFR P/N; then (#368) the one
 *   live ETC part whose MFR P/N is that part number; then the one live ETC part
 *   whose SKU or model # is the row's model number, when no other ETC row
 *   shares that model. Production keys ETC parts by model number, so without
 *   the last two steps every existing part would come back as "new".
 * - Existing part, priced list: `list` ← listPrice and `cost` ← netPrice, each
 *   only when it moved (a missing/zero ETC price leaves ours alone); MFR P/N
 *   and model # only when ours is blank. Description and category never change.
 * - New part, priced list: SKU = part number, mfr ETC, category from ETC's
 *   first path segment (spare parts with none → "ETC spare parts", flat-rate
 *   repair → "ETC repair"). A part a person deleted is never brought back.
 * - Demo prices never touch list or cost; a demo-only part number that
 *   matches nothing is reported, not created.
 */
import type { ImportResolver } from "@/lib/catalog-rename/import-resolve";
import type { CatalogPart } from "@/lib/stores/catalog";
import type { EtcRunCounts } from "@/lib/dealer-api/connections";
import { mfrKey } from "@/lib/catalog-books";
import { normalizeSku } from "@/lib/davinci/sku";
import { ETC_LISTS, ETC_PRICED_LISTS, type EtcListKey, type EtcRow, type EtcSkip } from "./parse";

export const ETC_MFR = "ETC";
const ETC_MFR_KEYS = new Set(["etc", "electronictheatrecontrols", "electronictheatrecontrolsinc", "etcinc"]);

export type EtcItem = {
  pn: string;
  model: string;
  desc: string;
  path: string;
  /** The priced list that set lp/np, or null for a demo-only part number. */
  src: EtcListKey | null;
  lp: number | null;
  np: number | null;
  /** The demo list's netPrice, when the part is on it. */
  demo: number | null;
};

/** Merge parsed rows into one item per part number (precedence above). */
export function mergeEtcRows(rows: readonly EtcRow[]): EtcItem[] {
  const rank = (l: EtcListKey | null) => (l == null ? 99 : ETC_PRICED_LISTS.indexOf(l));
  const byPn = new Map<string, EtcItem>();
  for (const r of rows) {
    const cur = byPn.get(r.partNumber);
    if (r.list === "demo-prices") {
      if (cur) {
        if (cur.demo == null && r.netPrice != null) cur.demo = r.netPrice;
      } else {
        byPn.set(r.partNumber, { pn: r.partNumber, model: r.modelNumber, desc: r.desc, path: r.categoryPath, src: null, lp: null, np: null, demo: r.netPrice });
      }
      continue;
    }
    if (cur && rank(cur.src) <= rank(r.list)) continue; // an earlier (or the same) priced list already won
    const next: EtcItem = { pn: r.partNumber, model: r.modelNumber, desc: r.desc, path: r.categoryPath, src: r.list, lp: r.listPrice, np: r.netPrice, demo: cur?.demo ?? null };
    byPn.set(r.partNumber, next);
  }
  return [...byPn.values()];
}

/* ---------- snapshot encoding (compact tuples, ~150 bytes a row) ---------- */

export type EtcItemTuple = [string, string, string, string, number, number | null, number | null, number | null];

export function encodeItem(i: EtcItem): EtcItemTuple {
  return [i.pn, i.model, i.desc, i.path, i.src == null ? -1 : ETC_LISTS.indexOf(i.src), i.lp, i.np, i.demo];
}

export function decodeItem(t: unknown): EtcItem | null {
  if (!Array.isArray(t) || typeof t[0] !== "string" || !t[0]) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
  const src = typeof t[4] === "number" && t[4] >= 0 && t[4] < 3 ? ETC_LISTS[t[4]] : null;
  return { pn: t[0], model: String(t[1] ?? ""), desc: String(t[2] ?? "") || t[0], path: String(t[3] ?? ""), src, lp: num(t[5]), np: num(t[6]), demo: num(t[7]) };
}

/* ---------- matching ---------- */

export type EtcLivePart = Pick<CatalogPart, "sku" | "mfr" | "manufacturerPartNumber" | "manufacturerModelNumber" | "list" | "cost" | "priceDate" | "demoPrice"> & {
  formerSkus?: string[];
};

function claim(m: Map<string, string | null>, k: string, sku: string): void {
  if (!k) return;
  const prev = m.get(k);
  if (prev === undefined) m.set(k, sku);
  else if (prev !== sku) m.set(k, null);
}

/** item → the live SKU it means, or null (a new part). */
export function buildEtcMatcher(live: readonly EtcLivePart[], resolve: ImportResolver, items: readonly EtcItem[]): (item: EtcItem) => string | null {
  const byPn = new Map<string, string | null>();
  const byModel = new Map<string, string | null>();
  for (const p of live) {
    if (!p?.sku || !ETC_MFR_KEYS.has(mfrKey(p.mfr))) continue;
    claim(byPn, mfrKey(p.manufacturerPartNumber), p.sku);
    const keys = new Set([normalizeSku(p.sku), normalizeSku(p.manufacturerModelNumber ?? "")]);
    for (const k of keys) claim(byModel, k, p.sku);
  }
  const modelUses = new Map<string, number>();
  for (const i of items) {
    const k = normalizeSku(i.model);
    if (k) modelUses.set(k, (modelUses.get(k) ?? 0) + 1);
  }
  return (item) => {
    const hit = resolve({ sku: item.pn, mfr: ETC_MFR, manufacturerPartNumber: item.pn });
    if (hit) return hit;
    const pn = byPn.get(mfrKey(item.pn));
    if (pn) return pn;
    const mk = normalizeSku(item.model);
    if (mk && modelUses.get(mk) === 1) return byModel.get(mk) ?? null;
    return null;
  };
}

/* ---------- planning ---------- */

export type EtcPartPatch = Partial<Pick<CatalogPart, "list" | "cost" | "manufacturerPartNumber" | "manufacturerModelNumber" | "demoPrice" | "demoPricedAt">>;
export type EtcNewPart = Omit<CatalogPart, "id">;
export type EtcChange = { pn: string; sku: string; desc: string; field: "list" | "cost" | "demo"; from: number | null; to: number };

export type EtcAction =
  | { kind: "create"; pn: string; sku: string; src: EtcListKey; part: EtcNewPart; demo: boolean }
  /** `priced`: the write confirms a list/cost (stamp pricedAt/priceDate). */
  | { kind: "update"; pn: string; sku: string; src: EtcListKey | null; patch: EtcPartPatch; priced: boolean; priceChanged: boolean; demoChanged: boolean; changes: EtcChange[] }
  /** Nothing moved; `redate` = a priced row whose priceDate isn't today yet (one priceDate-only write). */
  | { kind: "unchanged"; pn: string; sku: string; src: EtcListKey | null; redate: boolean }
  | { kind: "demo-unmatched"; pn: string }
  | { kind: "deleted"; pn: string; sku: string; src: EtcListKey };

export type EtcPlanCtx = {
  /** Epoch ms written as demoPricedAt. */
  now: number;
  /** Start of today (Chicago) — a priceDate at or after it is already today. */
  todayStart: number;
  /** SKUs a person deleted (soft-deleted, not renamed) — never revived. */
  deletedSkus: ReadonlySet<string>;
};

export function newPartCategory(item: Pick<EtcItem, "path" | "src">): string {
  if (item.src === "flat-rate-repair") return "ETC repair";
  const first = (item.path.split(">")[0] ?? "").trim().slice(0, 80);
  if (first) return first;
  return item.src === "spare-parts" ? "ETC spare parts" : "Uncategorized";
}

export function planEtcItem(item: EtcItem, sku: string | null, existing: EtcLivePart | null, ctx: EtcPlanCtx): EtcAction {
  if (!sku || !existing) {
    if (!item.src) return { kind: "demo-unmatched", pn: item.pn };
    if (ctx.deletedSkus.has(item.pn)) return { kind: "deleted", pn: item.pn, sku: item.pn, src: item.src };
    const part: EtcNewPart = {
      sku: item.pn,
      desc: item.desc || item.pn,
      category: newPartCategory(item),
      unit: "ea",
      list: item.lp ?? 0,
      cost: item.np ?? 0,
      mfr: ETC_MFR,
      manufacturerPartNumber: item.pn,
      ...(item.model ? { manufacturerModelNumber: item.model } : {}),
      ...(item.demo != null ? { demoPrice: item.demo, demoPricedAt: ctx.now } : {}),
    };
    return { kind: "create", pn: item.pn, sku: item.pn, src: item.src, part, demo: item.demo != null };
  }
  const patch: EtcPartPatch = {};
  const changes: EtcChange[] = [];
  const label = item.desc || item.pn;
  if (item.src) {
    if (item.lp != null && item.lp !== existing.list) {
      patch.list = item.lp;
      changes.push({ pn: item.pn, sku, desc: label, field: "list", from: existing.list ?? null, to: item.lp });
    }
    if (item.np != null && item.np !== existing.cost) {
      patch.cost = item.np;
      changes.push({ pn: item.pn, sku, desc: label, field: "cost", from: existing.cost ?? null, to: item.np });
    }
    if (!existing.manufacturerPartNumber?.trim()) patch.manufacturerPartNumber = item.pn;
    if (!existing.manufacturerModelNumber?.trim() && item.model) patch.manufacturerModelNumber = item.model;
  }
  let demoChanged = false;
  if (item.demo != null && item.demo !== existing.demoPrice) {
    patch.demoPrice = item.demo;
    patch.demoPricedAt = ctx.now;
    demoChanged = true;
    changes.push({ pn: item.pn, sku, desc: label, field: "demo", from: existing.demoPrice ?? null, to: item.demo });
  }
  if (!Object.keys(patch).length) {
    const redate = !!item.src && !(typeof existing.priceDate === "number" && existing.priceDate >= ctx.todayStart);
    return { kind: "unchanged", pn: item.pn, sku, src: item.src, redate };
  }
  return { kind: "update", pn: item.pn, sku, src: item.src, patch, priced: !!item.src, priceChanged: "list" in patch || "cost" in patch, demoChanged, changes };
}

/** Plan every item against one catalog view. */
export function planEtc(items: readonly EtcItem[], live: readonly EtcLivePart[], resolve: ImportResolver, ctx: EtcPlanCtx): EtcAction[] {
  const bySku = new Map(live.map((p) => [p.sku, p]));
  const match = buildEtcMatcher(live, resolve, items);
  return items.map((i) => {
    const sku = match(i);
    return planEtcItem(i, sku, sku ? bySku.get(sku) ?? null : null, ctx);
  });
}

/* ---------- preview + run counts ---------- */

export type EtcPreviewList = { list: EtcListKey; rows: number; created: number; changed: number; unchanged: number; skipped: number; unmatched: number };
export type EtcPreview = {
  lists: EtcPreviewList[];
  items: number;
  /** First 20 price changes, old → new. */
  changes: EtcChange[];
  skipped: { count: number; sample: EtcSkip[] };
  demoUnmatched: { count: number; sample: string[] };
};

export const ETC_PREVIEW_CHANGES = 20;
const SAMPLE = 20;

export function previewOf(actions: readonly EtcAction[], rowCounts: Partial<Record<EtcListKey, number>>, skipped: readonly EtcSkip[]): EtcPreview {
  const lists = new Map<EtcListKey, EtcPreviewList>(ETC_LISTS.map((l) => [l, { list: l, rows: rowCounts[l] ?? 0, created: 0, changed: 0, unchanged: 0, skipped: 0, unmatched: 0 }]));
  for (const s of skipped) lists.get(s.list)!.skipped++;
  const changes: EtcChange[] = [];
  const unmatched: string[] = [];
  let unmatchedCount = 0;
  const demo = lists.get("demo-prices")!;
  for (const a of actions) {
    if (a.kind === "create") {
      lists.get(a.src)!.created++;
      if (a.demo) demo.changed++;
    } else if (a.kind === "update") {
      if (a.src) {
        if (a.priceChanged) lists.get(a.src)!.changed++;
        else lists.get(a.src)!.unchanged++;
      }
      if (a.demoChanged) demo.changed++;
      for (const c of a.changes) if (changes.length < ETC_PREVIEW_CHANGES && c.field !== "demo") changes.push(c);
    } else if (a.kind === "unchanged") {
      if (a.src) lists.get(a.src)!.unchanged++;
    } else if (a.kind === "deleted") {
      lists.get(a.src)!.skipped++;
    } else {
      unmatchedCount++;
      demo.unmatched++;
      if (unmatched.length < SAMPLE) unmatched.push(a.pn);
    }
  }
  return {
    lists: [...lists.values()],
    items: actions.length,
    changes,
    skipped: { count: skipped.length + actions.filter((a) => a.kind === "deleted").length, sample: skipped.slice(0, SAMPLE) },
    demoUnmatched: { count: unmatchedCount, sample: unmatched },
  };
}

export type EtcCounts = EtcRunCounts;
export const ZERO_ETC_COUNTS: EtcCounts = { created: 0, updated: 0, unchanged: 0, demo: 0, demoUnmatched: 0, skipped: 0 };

/** Add one applied action to the running counts. */
export function countAction(c: EtcCounts, a: EtcAction): EtcCounts {
  const n = { ...c };
  if (a.kind === "create") {
    n.created++;
    if (a.demo) n.demo++;
  } else if (a.kind === "update") {
    if (a.priceChanged) n.updated++;
    else if (a.src) n.unchanged++;
    if (a.demoChanged) n.demo++;
  } else if (a.kind === "unchanged") n.unchanged++;
  else if (a.kind === "deleted") n.skipped++;
  else n.demoUnmatched++;
  return n;
}
