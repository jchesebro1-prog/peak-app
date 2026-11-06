import type { SpecItem, SpecSection } from "@/lib/estimating-core/types";
import { isPlaceholderSku } from "@/lib/specs/record-keys";
import { isBonusItem } from "@/lib/estimate-bonus/flags";
import { isRewardCreditItem } from "@/lib/rewards/credit-line";
import { partModel } from "@/lib/catalog-rename/sku";

/**
 * #366 — project discounts: a vendor's project pricing (e.g. ETC registered-
 * project pricing on a fixture) recorded on ONE estimate as an extra % off
 * Peak's normal cost for ONE catalog SKU, wherever it appears (plain lines and
 * parts inside assemblies). Cost drops; sell never moves; the savings show as
 * margin. Spec docs/superpowers/specs/2026-10-22-project-discounts-design.md.
 *
 * The map (`spec.projectDiscounts`, SKU → entry) is the source of truth; every
 * matching line / assembly part carries a stamped copy (`catalogCost` = its
 * normal cost, `projectDiscountPct`, and the discounted `cost`), written only
 * by `applyProjectDiscounts` — the client after each edit, the server on every
 * save, move and copy. Pure and client-safe: type-only imports from the
 * estimator plus the pure flag helpers (never pricing.ts, which imports this).
 */

export type ProjectDiscount = { pct: number; note: string; by: string; at: number };
/** Key = the trimmed, real catalog SKU. */
export type ProjectDiscounts = Record<string, ProjectDiscount>;

export const PROJECT_DISCOUNTS_MAX = 200;
export const PROJECT_DISCOUNT_NOTE_MAX = 200;

const round2 = (n: number) => Math.round(n * 100) / 100;
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** A valid discount % — finite, rounded to two decimals, 0 < pct < 100 — else null
 *  (0, 100, negatives, junk). Accepts "12", "12.5", "12%". */
export function parseDiscountPct(raw: unknown): number | null {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim()
        ? Number(raw.replace(/[%\s]/g, ""))
        : NaN;
  if (!Number.isFinite(n)) return null;
  const v = round2(n);
  return v > 0 && v < 100 ? v : null;
}

/** The trimmed SKU when it is a real catalog part number, else "" (placeholders
 *  CUSTOM / AI / CURTAIN / CRT-n / blank, and prototype keys, never match). */
function realSku(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s || s === "__proto__" || s === "constructor" || s === "prototype") return "";
  return isPlaceholderSku(s) ? "" : s;
}

/** Shape-clean a posted / stored map: valid entries only (real SKU, valid pct),
 *  the note trimmed + clipped, capped at PROJECT_DISCOUNTS_MAX. `by` / `at`
 *  pass through as data here — the save path re-stamps them (mergeDiscountsForSave). */
export function sanitizeProjectDiscounts(raw: unknown): ProjectDiscounts {
  const out: ProjectDiscounts = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= PROJECT_DISCOUNTS_MAX) break;
    const sku = realSku(k);
    if (!sku || own(out, sku) || !v || typeof v !== "object") continue;
    const e = v as Record<string, unknown>;
    const pct = parseDiscountPct(e.pct);
    if (pct == null) continue;
    out[sku] = {
      pct,
      note: typeof e.note === "string" ? e.note.trim().slice(0, PROJECT_DISCOUNT_NOTE_MAX) : "",
      by: typeof e.by === "string" ? e.by.slice(0, 64) : "",
      at: typeof e.at === "number" && Number.isFinite(e.at) ? e.at : 0,
    };
    n++;
  }
  return out;
}

/**
 * The map a save stores: the sanitized posted map, where an entry unchanged
 * from `prior` (same pct and note) keeps prior's `by` / `at`, and a new or
 * changed one is stamped `userId` / `now`. A posted `by` / `at` is never trusted.
 */
export function mergeDiscountsForSave(prior: ProjectDiscounts, posted: unknown, userId: string, now: number): ProjectDiscounts {
  const clean = sanitizeProjectDiscounts(posted);
  const out: ProjectDiscounts = {};
  for (const [sku, e] of Object.entries(clean)) {
    const p = own(prior, sku) ? prior[sku] : undefined;
    out[sku] = p && p.pct === e.pct && p.note === e.note
      ? { pct: e.pct, note: e.note, by: p.by, at: p.at }
      : { pct: e.pct, note: e.note, by: userId, at: now };
  }
  return out;
}

/** A stable fingerprint of what the user controls (SKU, pct, note — never by / at): the builder's
 *  "unsaved discount edit" check. */
export function projectDiscountsKey(d: ProjectDiscounts): string {
  return JSON.stringify(
    Object.keys(d || {})
      .sort()
      .map((k) => [k, d[k]?.pct, d[k]?.note || ""])
  );
}

/** The cost a line or part would have with no project discount. Freight, the 5%
 *  package bonus and the tier re-price read this, so the customer's price never moves. */
export function normalCostOf(it: { cost: number; catalogCost?: number }): number {
  return typeof it.catalogCost === "number" && Number.isFinite(it.catalogCost) ? it.catalogCost : it.cost;
}

/** True for a line whose own cost is the sum of its parts (fixture / System /
 *  Hardware assembly, a #274 track line) — its PARTS carry the discount. */
function isAssemblyLine(it: SpecItem): boolean {
  return Array.isArray(it.components) && it.components.length > 0 && !isBonusItem(it);
}

/**
 * The SKU a PLAIN line is discounted under, or "" when it can't carry one:
 * a custom line (even one saved with a real SKU — its cost is typed by hand
 * in the Custom part form), a vendor-quote line, allowance, curtain, any labor
 * (labor / overhead / travel), a bonus line, the Rewards credit, or an
 * assembly / rack / track line itself (an assembly's parts are discounted
 * inside it instead).
 */
export function discountSkuOf(it: SpecItem): string {
  if (!it || typeof it !== "object") return "";
  if (it.custom || it.vendorQuoteId || it.allowance || it.curtain || it.labor || it.laborOverhead || it.laborTravel) return "";
  if (isBonusItem(it) || isRewardCreditItem(it)) return "";
  if ((Array.isArray(it.components) && it.components.length) || it.rackId || it.track || it.fixture) return "";
  return realSku(it.sku);
}

type Part = NonNullable<SpecItem["components"]>[number];
type Stampable = { cost: number; catalogCost?: number; projectDiscountPct?: number };

function pctFor(d: ProjectDiscounts, sku: string): number | null {
  return sku && own(d, sku) && d[sku] && typeof d[sku].pct === "number" ? d[sku].pct : null;
}

/** One line / part re-stamped at `pct` (null = restored to its normal cost).
 *  The same object back when nothing changes (so the client's effect settles). */
function stamp<T extends Stampable>(x: T, pct: number | null): T {
  const normal = normalCostOf(x);
  if (pct == null || !(normal > 0)) {
    if (!("catalogCost" in x) && !("projectDiscountPct" in x)) return x;
    const out = { ...x, cost: normal };
    delete out.catalogCost;
    delete out.projectDiscountPct;
    return out;
  }
  const cost = round2(normal * (1 - pct / 100));
  if (x.cost === cost && x.catalogCost === normal && x.projectDiscountPct === pct) return x;
  return { ...x, catalogCost: normal, projectDiscountPct: pct, cost };
}

function applyToItem(it: SpecItem, d: ProjectDiscounts): SpecItem {
  if (!it || typeof it !== "object") return it;
  if (isAssemblyLine(it)) {
    const comps = it.components as Part[];
    // The line's normal cost is its cost plus what its parts are CURRENTLY
    // discounted by — so a writer that rebuilt the line's cost from its parts
    // (or a fresh, unstamped rebuild) is read correctly either way.
    let was = 0;
    let now = 0;
    let partsChanged = false;
    const next = comps.map((c) => {
      const q = typeof c.qty === "number" && c.qty > 0 ? c.qty : 0;
      const n = stamp(c, q > 0 ? pctFor(d, realSku(c.sku)) : null);
      if (n !== c) partsChanged = true;
      was += q * (normalCostOf(c) - c.cost);
      now += q * (normalCostOf(n) - n.cost);
      return n;
    });
    const normalLine = round2(it.cost + was);
    const delta = round2(now);
    const lineCost = delta > 0 ? round2(normalLine - delta) : normalLine;
    const wantCatalog = delta > 0 ? normalLine : undefined;
    if (!partsChanged && it.cost === lineCost && it.catalogCost === wantCatalog && !("projectDiscountPct" in it)) return it;
    // The line itself never carries a pct (its parts may be discounted at different rates).
    const out: SpecItem = { ...it, components: partsChanged ? next : comps, cost: lineCost };
    delete out.projectDiscountPct;
    if (wantCatalog != null) out.catalogCost = wantCatalog;
    else delete out.catalogCost;
    return out;
  }
  const sku = discountSkuOf(it);
  // A line that can't carry a discount is still restored if it once had one.
  return stamp(it, sku ? pctFor(d, sku) : null);
}

/**
 * Re-stamp every matching line and assembly part under `d`, restoring any that
 * no longer match. Idempotent; never touches `price`, `extSellOverride`,
 * `sellOverride` or any other sell field. Returns the SAME array (and the same
 * section / item objects) wherever nothing changed.
 */
export function applyProjectDiscounts(sections: SpecSection[], d: ProjectDiscounts): SpecSection[] {
  if (!Array.isArray(sections)) return sections;
  const map = d && typeof d === "object" ? d : {};
  let changed = false;
  const out = sections.map((sec) => {
    if (!sec || !Array.isArray(sec.items)) return sec;
    let secChanged = false;
    const items = sec.items.map((it) => {
      const n = applyToItem(it, map);
      if (n !== it) secChanged = true;
      return n;
    });
    if (!secChanged) return sec;
    changed = true;
    return { ...sec, items };
  });
  return changed ? out : sections;
}

/** SKU → how many lines and assembly parts the discount hits (SKUs with no hit are absent). */
export function discountHits(sections: SpecSection[], d: ProjectDiscounts): Record<string, number> {
  const out: Record<string, number> = {};
  const bump = (sku: string) => {
    if (sku && own(d, sku)) out[sku] = (out[sku] || 0) + 1;
  };
  for (const sec of Array.isArray(sections) ? sections : []) {
    for (const it of sec?.items || []) {
      if (!it) continue;
      if (isAssemblyLine(it)) {
        for (const c of it.components || []) if (c && c.qty > 0) bump(realSku(c.sku));
      } else bump(discountSkuOf(it));
    }
  }
  return out;
}

export type DiscountableSku = { sku: string; label: string; where: string };

/** Every SKU on the estimate a discount could apply to (plain catalog lines and
 *  assembly parts with a cost), first appearance wins — the card's "+ Add" picker. */
export function discountableSkus(sections: SpecSection[]): DiscountableSku[] {
  const seen = new Map<string, DiscountableSku>();
  for (const sec of Array.isArray(sections) ? sections : []) {
    for (const it of sec?.items || []) {
      if (!it) continue;
      if (isAssemblyLine(it)) {
        for (const c of it.components || []) {
          const sku = realSku(c?.sku);
          if (sku && normalCostOf(c) > 0 && !seen.has(sku)) {
            seen.set(sku, { sku, label: c.label || sku, where: `${sec.name} · in ${(it.desc || "").split(" — ")[0]}` });
          }
        }
        continue;
      }
      const sku = discountSkuOf(it);
      if (sku && normalCostOf(it) > 0 && !seen.has(sku)) seen.set(sku, { sku, label: it.desc || sku, where: sec.name });
    }
  }
  return [...seen.values()];
}

/** The entries of `d` whose SKU the sections contain — what a system copied or
 *  moved into a NEW estimate carries with it. */
export function discountsForSections(sections: SpecSection[], d: ProjectDiscounts): ProjectDiscounts {
  const hits = discountHits(sections, d);
  const out: ProjectDiscounts = {};
  for (const sku of Object.keys(hits)) out[sku] = d[sku];
  return out;
}

export type ProjectPricingRow = {
  sku: string;
  /** The model purchasing asks for (the line's Model # / MFR P/N, else the Brand:Model SKU's model). */
  model: string;
  desc: string;
  qty: number;
  pct: number;
  /** Per unit. */
  normalCost: number;
  /** Per unit, after the project discount. */
  expectedCost: number;
  note: string;
};

/**
 * The won project's "Project pricing to request": one row per discounted SKU
 * that hits at least one line or part, qty summed across the estimate (a
 * line's qty, or line qty × part qty inside an assembly). Option lines and
 * alternate systems aren't bought, so they don't count. Per-unit costs come
 * from the first hit.
 */
export function projectPricingFrom(sections: SpecSection[], d: ProjectDiscounts): ProjectPricingRow[] {
  const rows = new Map<string, ProjectPricingRow>();
  const add = (sku: string, desc: string, qty: number, normal: number, model: string) => {
    if (!sku || !own(d, sku) || !(qty > 0) || !(normal > 0)) return;
    const e = d[sku];
    const r = rows.get(sku);
    if (r) {
      r.qty = round2(r.qty + qty);
      return;
    }
    rows.set(sku, { sku, model, desc, qty: round2(qty), pct: e.pct, normalCost: round2(normal), expectedCost: round2(normal * (1 - e.pct / 100)), note: e.note || "" });
  };
  for (const sec of Array.isArray(sections) ? sections : []) {
    if (!sec || sec.alternate === true) continue;
    for (const it of sec.items || []) {
      if (!it || it.option) continue;
      const lq = typeof it.qty === "number" && it.qty > 0 ? it.qty : 0;
      if (isAssemblyLine(it)) {
        for (const c of it.components || []) if (c && c.qty > 0) add(realSku(c.sku), c.label || c.sku, lq * c.qty, normalCostOf(c), partModel({ sku: realSku(c.sku) }));
      } else {
        const sku = discountSkuOf(it);
        add(sku, it.desc || it.sku, lq, normalCostOf(it), partModel({ sku, manufacturerModelNumber: it.manufacturerModelNumber, manufacturerPartNumber: it.manufacturerPartNumber }));
      }
    }
  }
  return [...rows.values()];
}
