/**
 * #368 — ETC price-list rows → catalog writes. Pure: the caller passes the
 * live catalog, the import resolver and the deleted SKUs; nothing here reads
 * or writes.
 *
 * Rules (spec §6, plus the #368 review fixes):
 * - Rows merge by part number. A part in two priced lists takes the first in
 *   the order finished goods → spare parts → flat-rate repair; a demo row adds
 *   its netPrice as `demoPrice` to the same item.
 * - Matching: the catalog importer's own resolver (`importResolverFor`, #304)
 *   with mfr "ETC" and the part number as SKU and MFR P/N — a hit on another
 *   brand's part is no match; then the one live ETC part whose MFR P/N is that
 *   part number; then the one live ETC part whose SKU or model # is the row's
 *   model number, when no other ETC row shares that model AND the part's own
 *   MFR P/N is blank or this part number. Production keys ETC parts by model
 *   number, so without the last two steps every existing part would come back
 *   as "new". Only parts whose mfr normalizes to ETC are ever matched.
 * - Two rows of one pull never land on one part: the first wins, the second is
 *   skipped as a conflict.
 * - A part a person deleted — same SKU, or a deleted ETC part with that MFR
 *   P/N or (P/N-compatible) model — is never re-created. A part number that is
 *   another brand's SKU is skipped, never created on top of it.
 * - A daily delta never lets a lower-precedence list overwrite a price an
 *   earlier list set (`etcPriceList`, finished goods → spare parts → flat-rate
 *   repair); a full pull is authoritative and may.
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
import { ETC_SKIP_REASON } from "./copy";

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

/* ---------- matching ---------- */

export type EtcLivePart = Pick<CatalogPart, "sku" | "mfr" | "manufacturerPartNumber" | "manufacturerModelNumber" | "list" | "cost" | "priceDate" | "demoPrice" | "etcPriceList"> & {
  formerSkus?: string[];
};

export function isEtcMfr(mfr: string | null | undefined): boolean {
  return ETC_MFR_KEYS.has(mfrKey(mfr));
}

/** 0 = write it; otherwise the skip reason (copy.ts ETC_SKIP_REASON). */
export type EtcMatchCode = 0 | 1 | 2 | 3 | 4;
export const ETC_CODE = { ok: 0, conflict: 1, deleted: 2, foreign: 3, unmatched: 4 } as const;
/** `sku` "" with code 0 = create a new part at the part number. */
export type EtcMatch = { sku: string; code: EtcMatchCode };

function claim(m: Map<string, string | null>, k: string, sku: string): void {
  if (!k) return;
  const prev = m.get(k);
  if (prev === undefined) m.set(k, sku);
  else if (prev !== sku) m.set(k, null);
}

/** The part's own MFR P/N doesn't contradict this part number (blank or the same). */
function pnCompatible(p: EtcLivePart, pn: string): boolean {
  const own = mfrKey(p.manufacturerPartNumber);
  return !own || own === mfrKey(pn);
}

/**
 * Match every item of one pull/delta against the live catalog (and the parts
 * people deleted), then apply the one-part-per-row guard. Pure.
 */
export function matchEtcItems(items: readonly EtcItem[], live: readonly EtcLivePart[], deleted: readonly EtcLivePart[], resolve: ImportResolver): EtcMatch[] {
  const bySku = new Map(live.map((p) => [p.sku, p]));
  const index = (parts: readonly EtcLivePart[]) => {
    const byPn = new Map<string, string | null>();
    const byModel = new Map<string, string | null>();
    const etc = new Map<string, EtcLivePart>();
    for (const p of parts) {
      if (!p?.sku || !isEtcMfr(p.mfr)) continue;
      etc.set(p.sku, p);
      claim(byPn, mfrKey(p.manufacturerPartNumber), p.sku);
      for (const k of new Set([normalizeSku(p.sku), normalizeSku(p.manufacturerModelNumber ?? "")])) claim(byModel, k, p.sku);
    }
    return { byPn, byModel, etc };
  };
  const L = index(live);
  const D = index(deleted);
  const deletedSkus = new Set(deleted.map((p) => p.sku));
  const modelUses = new Map<string, number>();
  for (const i of items) {
    const k = normalizeSku(i.model);
    if (k) modelUses.set(k, (modelUses.get(k) ?? 0) + 1);
  }
  const byModelFor = (ix: typeof L, item: EtcItem, needUnique: boolean): string | null => {
    const mk = normalizeSku(item.model);
    if (!mk || (needUnique && modelUses.get(mk) !== 1)) return null;
    const sku = ix.byModel.get(mk);
    const p = sku ? ix.etc.get(sku) : undefined;
    return p && pnCompatible(p, item.pn) ? p.sku : null;
  };

  const out: EtcMatch[] = items.map((item) => {
    const hit = resolve({ sku: item.pn, mfr: ETC_MFR, manufacturerPartNumber: item.pn });
    const hitPart = hit ? bySku.get(hit) : undefined;
    if (hit && hitPart && isEtcMfr(hitPart.mfr)) return { sku: hit, code: 0 };
    const pn = L.byPn.get(mfrKey(item.pn));
    if (pn) return { sku: pn, code: 0 };
    const model = byModelFor(L, item, true);
    if (model) return { sku: model, code: 0 };
    if (!item.src) return { sku: "", code: 4 };
    const gone = deletedSkus.has(item.pn) ? item.pn : D.byPn.get(mfrKey(item.pn)) || byModelFor(D, item, false);
    if (gone) return { sku: gone, code: 2 };
    // Another brand's part answers to this part number (its SKU, a former SKU, a rename): never create on top of it.
    if (hit || bySku.has(item.pn)) return { sku: hit || item.pn, code: 3 };
    return { sku: "", code: 0 };
  });

  // One part per row: the first row to claim a SKU keeps it.
  const claimed = new Set<string>();
  items.forEach((item, i) => {
    const m = out[i];
    if (m.code !== 0) return;
    const key = m.sku || item.pn;
    if (claimed.has(key)) out[i] = { sku: m.sku || item.pn, code: 1 };
    else claimed.add(key);
  });
  return out;
}

/* ---------- snapshot encoding (compact tuples, ~160 bytes a row) ---------- */

export type EtcItemTuple = [string, string, string, string, number, number | null, number | null, number | null, string, number];
/** -1 in the code slot: fetched, not matched yet (a daily delta stored before its catalog read). */
export const ETC_UNMATCHED = -1;

export function encodeItem(i: EtcItem, m: EtcMatch | null): EtcItemTuple {
  return [i.pn, i.model, i.desc, i.path, i.src == null ? -1 : ETC_LISTS.indexOf(i.src), i.lp, i.np, i.demo, m?.sku ?? "", m ? m.code : ETC_UNMATCHED];
}

export function decodeItem(t: unknown): { item: EtcItem; match: EtcMatch | null } | null {
  if (!Array.isArray(t) || typeof t[0] !== "string" || !t[0]) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
  const src = typeof t[4] === "number" && t[4] >= 0 && t[4] < 3 ? ETC_LISTS[t[4]] : null;
  const item: EtcItem = { pn: t[0], model: String(t[1] ?? ""), desc: String(t[2] ?? "") || t[0], path: String(t[3] ?? ""), src, lp: num(t[5]), np: num(t[6]), demo: num(t[7]) };
  const code = typeof t[9] === "number" && t[9] >= 0 && t[9] <= 4 ? (t[9] as EtcMatchCode) : null;
  return { item, match: code == null ? null : { sku: typeof t[8] === "string" ? t[8] : "", code } };
}

/* ---------- planning ---------- */

export type EtcPartPatch = Partial<Pick<CatalogPart, "list" | "cost" | "manufacturerPartNumber" | "manufacturerModelNumber" | "demoPrice" | "demoPricedAt" | "etcPriceList">>;
export type EtcNewPart = Omit<CatalogPart, "id">;
export type EtcChange = { pn: string; sku: string; desc: string; field: "list" | "cost" | "demo"; from: number | null; to: number };
export type EtcPricedList = "finished-goods" | "spare-parts" | "flat-rate-repair";

export type EtcAction =
  | { kind: "create"; pn: string; sku: string; src: EtcPricedList; part: EtcNewPart; demo: boolean }
  /** `priced`: the write confirms a list/cost (stamp pricedAt/priceDate). */
  | { kind: "update"; pn: string; sku: string; src: EtcListKey | null; patch: EtcPartPatch; priced: boolean; priceChanged: boolean; demoChanged: boolean; changes: EtcChange[] }
  /** Nothing moved; `redate` = a priced row whose priceDate isn't today yet (one priceDate-only write). */
  | { kind: "unchanged"; pn: string; sku: string; src: EtcListKey | null; redate: boolean }
  | { kind: "skip"; pn: string; sku: string; src: EtcListKey | null; code: Exclude<EtcMatchCode, 0> };

export type EtcPlanCtx = {
  /** Epoch ms written as demoPricedAt. */
  now: number;
  /** Start of today (Chicago) — a priceDate at or after it is already today. */
  todayStart: number;
  /** A full pull is authoritative over `etcPriceList`; a daily delta is not. */
  full: boolean;
};

export function newPartCategory(item: Pick<EtcItem, "path" | "src">): string {
  if (item.src === "flat-rate-repair") return "ETC repair";
  const first = (item.path.split(">")[0] ?? "").trim().slice(0, 80);
  if (first) return first;
  return item.src === "spare-parts" ? "ETC spare parts" : "Uncategorized";
}

const rankOf = (l: string | null | undefined): number => {
  const i = (ETC_PRICED_LISTS as readonly string[]).indexOf(l ?? "");
  return i < 0 ? 99 : i;
};

/** Plan one matched item. `existing` is the live part the match names (null = create). */
export function planEtcItem(item: EtcItem, match: EtcMatch, existing: EtcLivePart | null, ctx: EtcPlanCtx): EtcAction {
  const src = item.src as EtcPricedList | null;
  if (match.code !== 0) return { kind: "skip", pn: item.pn, sku: match.sku, src: item.src, code: match.code };
  if (!existing) {
    if (!src) return { kind: "skip", pn: item.pn, sku: "", src: null, code: 4 };
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
      etcPriceList: src,
    };
    return { kind: "create", pn: item.pn, sku: item.pn, src, part, demo: item.demo != null };
  }
  const sku = existing.sku;
  const patch: EtcPartPatch = {};
  const changes: EtcChange[] = [];
  const label = item.desc || item.pn;
  // A delta row from a lower-precedence list never overwrites an earlier list's price.
  const outranked = !!src && !ctx.full && rankOf(existing.etcPriceList) < rankOf(src);
  const pricing = !!src && !outranked;
  if (pricing) {
    if (item.lp != null && item.lp !== existing.list) {
      patch.list = item.lp;
      changes.push({ pn: item.pn, sku, desc: label, field: "list", from: existing.list ?? null, to: item.lp });
    }
    if (item.np != null && item.np !== existing.cost) {
      patch.cost = item.np;
      changes.push({ pn: item.pn, sku, desc: label, field: "cost", from: existing.cost ?? null, to: item.np });
    }
    if (existing.etcPriceList !== src) patch.etcPriceList = src!;
  }
  if (src) {
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
    const redate = pricing && !(typeof existing.priceDate === "number" && existing.priceDate >= ctx.todayStart);
    return { kind: "unchanged", pn: item.pn, sku, src: item.src, redate };
  }
  return { kind: "update", pn: item.pn, sku, src: item.src, patch, priced: pricing, priceChanged: "list" in patch || "cost" in patch, demoChanged, changes };
}

/**
 * At import time the stored match is re-checked against the part as it is
 * now: a matched part that is gone (deleted since the pull) is skipped; a
 * planned create whose SKU now exists becomes an update when it's an ETC part
 * (a retried batch) and is skipped when it's another brand's.
 */
export function targetNow(item: EtcItem, match: EtcMatch, liveNow: ReadonlyMap<string, EtcLivePart>): { match: EtcMatch; existing: EtcLivePart | null } {
  if (match.code !== 0) return { match, existing: null };
  const sku = match.sku || item.pn;
  const p = liveNow.get(sku);
  if (!match.sku) {
    if (!p) return { match, existing: null };
    return isEtcMfr(p.mfr) ? { match: { sku: p.sku, code: 0 }, existing: p } : { match: { sku, code: 3 }, existing: null };
  }
  if (!p) return { match: { sku, code: 2 }, existing: null };
  return isEtcMfr(p.mfr) ? { match: { sku: p.sku, code: 0 }, existing: p } : { match: { sku, code: 3 }, existing: null };
}

/** Plan every item against one catalog view (the preview). */
export function planEtc(items: readonly EtcItem[], matches: readonly EtcMatch[], live: readonly EtcLivePart[], ctx: EtcPlanCtx): EtcAction[] {
  const bySku = new Map(live.map((p) => [p.sku, p]));
  return items.map((i, k) => {
    const m = matches[k];
    return planEtcItem(i, m, m.code === 0 && m.sku ? bySku.get(m.sku) ?? null : null, ctx);
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
  const sample: EtcSkip[] = skipped.slice(0, SAMPLE);
  let unmatchedCount = 0;
  let planSkips = 0;
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
    } else if (a.code === 4) {
      unmatchedCount++;
      demo.unmatched++;
      if (unmatched.length < SAMPLE) unmatched.push(a.pn);
    } else {
      planSkips++;
      lists.get(a.src ?? "demo-prices")!.skipped++;
      if (sample.length < SAMPLE) sample.push({ list: a.src ?? "demo-prices", partNumber: a.pn, reason: ETC_SKIP_REASON[a.code] + (a.sku && a.code !== 2 ? ` (${a.sku})` : "") });
    }
  }
  return {
    lists: [...lists.values()],
    items: actions.length,
    changes,
    skipped: { count: skipped.length + planSkips, sample },
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
  else if (a.code === 4) n.demoUnmatched++;
  else n.skipped++;
  return n;
}
