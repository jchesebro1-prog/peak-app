/**
 * Estimator handoff — the Catalog screen's rules (pure: the Node checks import this; ui/catalog.tsx renders it).
 *
 * Browse: the SAME ranking as the Estimator's catalog picker (rankCatalogParts — what `searchCatalog` ranks with), then the
 * category / manufacturer facets on top. Category and manufacturer are exact matches, so a facet's count is exactly the rows
 * it filters to. (The picker's "Fabric" category is the broader isFabricPart; here "Fabric" is the parts whose category is
 * Fabric — the counts have to agree with the rows.) Facet counts are crossed: the category counts honour the search and the
 * manufacturer pick, the manufacturer counts honour the search and the category pick. The page never holds more than
 * PAGE_SIZE rows.
 *
 * Edit: a PARTIAL port of the app's part editor save (src/app/(app)/catalog/actions.ts upsertPart over catalog.ts
 * mergeUpsert → writePart); the fabric guards are the app's own (part-form.ts), imported: `updatedAt` stamped, `pricedAt` stamped only when the cost or list moved (nextPricedAt),
 * rack data through cleanRackFacts (a blank clears the field), the narrative paragraph stamped with who and when.
 * A new part's SKU is unique against the live catalog AND every retired SKU (the rename stubs and parts' `formerSkus`),
 * case-insensitively — the sku resolver lowercases, so two spellings would shadow each other.
 *
 * What a catalog price does to an estimate line is the Estimator's rule, not this screen's: a part added from the picker
 * sells at catalogAddPrice(cost, list, tierMargin) — cost × (1 + markup) when the part has a cost, else its list price.
 * `addLineSell` states it for the verify walk. Plan: PR 2 Task 8.
 */
import { fabricFactsProblem, fabricRateProblem } from "@/app/(app)/catalog/part-form";
import { rankCatalogParts } from "@/lib/estimating-core/catalog-rank";
import { catalogAddPrice } from "@/lib/estimating-core/tier-reprice";
import { isFabricPart } from "@/lib/fabric-part";
import { MAX_PARAGRAPH } from "@/lib/estimating-core/narrative";
import { nextPricedAt } from "@/lib/catalog-books";
import { cleanRackFacts } from "@/lib/rack/part-facts";
import { AIRFLOWS, MOUNT_FACES, RACK_FACT_KEYS, RACK_MOUNTS, RACK_WIDTHS, type RackFactKey } from "@/lib/rack/types";
import type { LivePart } from "./readers";

/** Rows on one page — the table never renders more. */
export const PAGE_SIZE = 100;
/** The longest SKU the editor takes. */
export const SKU_MAX = 120;
/** A cost or list above this is a typo, not a price. */
export const PRICE_MAX = 10_000_000;
/** What a blank category falls back to (upsertPart's default). */
export const DEFAULT_CATEGORY = "Uncategorized";

export type CatalogFilter = { query: string; category: string | null; mfr: string | null };
export type Facet = { value: string; count: number };
export type CatalogResults = {
  /** Every matching part, best match first (the page slices this). */
  rows: LivePart[];
  categories: Facet[];
  manufacturers: Facet[];
};

/** A facet's label: a blank value reads "(none)". */
export const facetLabel = (value: string): string => (value === "" ? "(none)" : value);

/** Counts by value, biggest first, ties by name. Pure. */
export function facetCounts(values: Iterable<string>): Facet[] {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/**
 * The browse view: `query` ranked exactly like the Estimator picker (an empty query keeps every part, alphabetical by
 * description), narrowed by the category and manufacturer facets. `null` facet = all.
 */
export function browseCatalog(parts: readonly LivePart[], f: CatalogFilter): CatalogResults {
  const ranked = rankCatalogParts(parts as LivePart[], f.query).map((s) => s.p);
  const catOf = (p: LivePart) => p.category || "";
  const mfrOf = (p: LivePart) => p.mfr || "";
  const byMfr = f.mfr === null ? ranked : ranked.filter((p) => mfrOf(p) === f.mfr);
  const byCat = f.category === null ? ranked : ranked.filter((p) => catOf(p) === f.category);
  const rows = f.category === null ? byMfr : byMfr.filter((p) => catOf(p) === f.category);
  return { rows, categories: facetCounts(byMfr.map(catOf)), manufacturers: facetCounts(byCat.map(mfrOf)) };
}

/** Page `page` (0-based, clamped) of `total` rows: its bounds and the page count. */
export function pageBounds(total: number, page: number, size = PAGE_SIZE): { page: number; pages: number; start: number; end: number } {
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(0, Math.floor(page) || 0), pages - 1);
  return { page: p, pages, start: p * size, end: Math.min(total, p * size + size) };
}

/** "$1,234.50" — the Catalog's money cells. */
export const money = (n: number | undefined): string =>
  (typeof n === "number" && Number.isFinite(n) ? n : 0).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ------------------------------------------------------------------ SKUs */

/** Every SKU a new part must avoid, lowercased: `live` maps to the live SKU's spelling, `retired` is renamed-away SKUs. */
export type SkuIndex = { live: Map<string, string>; retired: Set<string> };

/** Built from the live parts and the store's retired-SKU stubs (store.catalogRenames) — lazily, when "New part" opens. */
export function skuIndex(parts: readonly Pick<LivePart, "sku" | "id" | "formerSkus">[], renames: ReadonlyMap<string, string>): SkuIndex {
  const live = new Map<string, string>();
  const retired = new Set<string>();
  for (const [from] of renames) retired.add(from.trim().toLowerCase());
  for (const p of parts) {
    live.set((p.sku || p.id).trim().toLowerCase(), p.sku || p.id);
    for (const f of p.formerSkus ?? []) retired.add(String(f).trim().toLowerCase());
  }
  return { live, retired };
}

/** null = the SKU is free to use; else the message the editor shows. */
export function validateSku(raw: string, index: SkuIndex): string | null {
  const sku = (raw ?? "").trim();
  if (!sku) return "A SKU is required.";
  if (sku.toUpperCase() === "CUSTOM") return "CUSTOM is reserved for custom lines — pick a real SKU.";
  if (sku.length > SKU_MAX) return `Keep the SKU under ${SKU_MAX} characters.`;
  if (/[\u0000-\u001f\u007f]/.test(sku)) return "A SKU can't contain control characters.";
  const key = sku.toLowerCase();
  const live = index.live.get(key);
  if (live !== undefined) return `${live} is already in the catalog — open it from the list, or use a different SKU.`;
  if (index.retired.has(key)) return `${sku} was retired by a SKU rename — use a different SKU.`;
  return null;
}

/* ------------------------------------------------------------------ the part editor */

export const RACK_LABEL: Record<RackFactKey, string> = {
  rackMount: "Rack mount",
  ruHeight: "RU height",
  rackWidth: "Rack width",
  depthIn: "Depth (in)",
  weightLb: "Weight (lb)",
  powerWatts: "Power (W)",
  maxPowerWatts: "Max power (W)",
  powerCapacityWatts: "Outlet capacity (W)",
  mountFace: "Mount face",
  airflow: "Airflow",
  rackNotes: "Rack notes",
};

/** The rack fields that are a pick list, with their options. */
export const RACK_ENUMS: Partial<Record<RackFactKey, readonly string[]>> = {
  rackMount: RACK_MOUNTS,
  rackWidth: RACK_WIDTHS,
  mountFace: MOUNT_FACES,
  airflow: AIRFLOWS,
};

/** Everything the editor edits, as the strings its inputs hold. */
export type PartDraft = {
  sku: string;
  desc: string;
  category: string;
  unit: string;
  cost: string;
  list: string;
  mfr: string;
  manufacturerPartNumber: string;
  manufacturerModelNumber: string;
  narrativeText: string;
  rack: Record<RackFactKey, string>;
};

export type DraftField = Exclude<keyof PartDraft, "rack"> | "rack";

const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "");

/** The editor's starting values: a part's own, or a clean new part. */
export function draftFromPart(p: LivePart | null): PartDraft {
  const rack = Object.fromEntries(RACK_FACT_KEYS.map((k) => [k, str((p as Record<string, unknown> | null)?.[k])])) as Record<RackFactKey, string>;
  return {
    sku: p?.sku ?? "",
    desc: p?.desc ?? "",
    category: p?.category ?? "",
    unit: p?.unit ?? (p ? "" : "ea"),
    cost: p ? String(p.cost ?? 0) : "0",
    list: p ? String(p.list ?? 0) : "0",
    mfr: p?.mfr ?? "",
    manufacturerPartNumber: p?.manufacturerPartNumber ?? "",
    manufacturerModelNumber: p?.manufacturerModelNumber ?? "",
    narrativeText: p?.narrativeText ?? "",
    rack,
  };
}

/** A decimal the editor accepts: "1234.5", "1,234.50", ".5" — commas only as thousands separators in the right places. */
const PLAIN_DECIMAL = /^(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?$/;

/**
 * A price cell → dollars: blank = 0; "$1,234.50" is fine. Only plain decimals — hex, exponents ("1e3"), signs and garbled commas
 * ("1,23,4") are refused. A value with more than 2 decimals is never rounded silently: it is refused ("Use at most 2 decimal
 * places") unless it IS the stored value (`stored`) — an untouched field has to round-trip unchanged.
 */
export function parsePrice(raw: string, stored?: number): { ok: true; value: number } | { ok: false; error: string } {
  const s = (raw ?? "").trim().replace(/^\$\s*/, "");
  if (s === "") return { ok: true, value: 0 };
  if (s === "." || !PLAIN_DECIMAL.test(s)) return { ok: false, error: "Enter a number, zero or more." };
  const n = Number(s.replace(/,/g, ""));
  if (!Number.isFinite(n)) return { ok: false, error: "Enter a number, zero or more." };
  if (n > PRICE_MAX) return { ok: false, error: `That is above ${PRICE_MAX.toLocaleString("en-US")} — check for a typo.` };
  const decimals = s.split(".")[1]?.length ?? 0;
  if (decimals > 2 && n !== stored) return { ok: false, error: "Use at most 2 decimal places." };
  return { ok: true, value: n };
}

/** A part's identity for "did it change since I opened it?" — key order does not matter. */
export function partFingerprint(p: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => [k, sort(x)])) : v;
  return JSON.stringify(sort(p));
}

/**
 * The app's fabric guards (part-form.ts fabricRateProblem / fabricFactsProblem — the same functions, imported) over the fabric
 * facts a part already carries. The editor doesn't edit curtainAreaRate / oz / ozBasis / flameRating; they ride along, so the
 * only way to break the rule here is a category or unit change that stops the part being a fabric. null = fine.
 */
export function fabricStrandProblem(base: LivePart | null, category: string, unit: string): string | null {
  if (!base) return null;
  const b = base as LivePart & { curtainAreaRate?: number; oz?: number; ozBasis?: "lin-yd" | "sq-yd"; flameRating?: string };
  if (isFabricPart({ category, unit })) return null;
  const rateRaw = (base as Record<string, unknown>).curtainAreaRate;
  const rate = typeof rateRaw === "number" && Number.isFinite(rateRaw) && rateRaw > 0 ? rateRaw : undefined;
  return (
    fabricRateProblem(category, rate, unit) ??
    fabricFactsProblem(category, unit, { oz: b.oz, ozBasis: b.ozBasis, flameRating: b.flameRating })
  );
}

export type DraftResult = { ok: true; part: LivePart } | { ok: false; errors: Partial<Record<DraftField, string>> };

const OPTIONAL_TEXT = ["mfr", "manufacturerPartNumber", "manufacturerModelNumber"] as const;

/**
 * The part a Save writes: `base` (null = a new part) with the draft laid over it. Fields the editor doesn't own ride along
 * untouched. An existing part's SKU never changes (a rename is its own workflow); a new part's must pass `validateSku`.
 */
export function applyDraft(base: LivePart | null, draft: PartDraft, ctx: { now: number; by: string; index?: SkuIndex }): DraftResult {
  const errors: Partial<Record<DraftField, string>> = {};
  const sku = base ? base.sku : draft.sku.trim();
  if (!base) {
    const e = validateSku(draft.sku, ctx.index ?? { live: new Map(), retired: new Set() });
    if (e) errors.sku = e;
  }
  const desc = draft.desc.trim();
  if (!desc) errors.desc = "A description is required.";
  // An untouched price keeps the stored number exactly (never re-rounded); a typed one is parsed.
  const was = draftFromPart(base);
  const cost = base && draft.cost === was.cost ? ({ ok: true, value: base.cost ?? 0 } as const) : parsePrice(draft.cost, base?.cost);
  if (!cost.ok) errors.cost = cost.error;
  const list = base && draft.list === was.list ? ({ ok: true, value: base.list ?? 0 } as const) : parsePrice(draft.list, base?.list);
  if (!list.ok) errors.list = list.error;
  const category = draft.category.trim() || DEFAULT_CATEGORY;
  const unit = draft.unit.trim() || "ea";
  const stranded = fabricStrandProblem(base, category, unit);
  if (stranded) errors[base && category === (base.category || DEFAULT_CATEGORY) ? "unit" : "category"] = stranded;
  const rack = cleanRackFacts(draft.rack);
  if (!rack.ok) errors.rack = rack.error;
  const narrative = draft.narrativeText.replace(/\r\n?/g, "\n").trim();
  if (narrative.length > MAX_PARAGRAPH) errors.narrativeText = `Keep the paragraph under ${MAX_PARAGRAPH.toLocaleString("en-US")} characters.`;
  if (Object.keys(errors).length || !cost.ok || !list.ok || !rack.ok) return { ok: false, errors };

  const next: Record<string, unknown> = { ...(base ?? {}), id: base ? base.id : sku, sku, desc };
  next.category = category;
  next.unit = unit;
  next.cost = cost.value;
  next.list = list.value;
  for (const k of OPTIONAL_TEXT) {
    const v = draft[k].trim();
    if (v) next[k] = v;
    else delete next[k];
  }
  for (const [k, v] of Object.entries(rack.patch)) {
    if (v === undefined) delete next[k];
    else next[k] = v;
  }
  if (narrative !== (base?.narrativeText ?? "").trim()) {
    if (narrative) {
      next.narrativeText = narrative;
      next.narrativeUpdatedAt = ctx.now;
      next.narrativeUpdatedBy = ctx.by;
    } else {
      delete next.narrativeText;
      delete next.narrativeUpdatedAt;
      delete next.narrativeUpdatedBy;
    }
  }
  next.updatedAt = ctx.now;
  // writePart: pricedAt moves only when the cost or list did.
  const pricedAt = nextPricedAt(base, { list: list.value, cost: cost.value, pricedAt: base?.pricedAt }, ctx.now);
  if (pricedAt != null) next.pricedAt = pricedAt;
  else delete next.pricedAt;
  return { ok: true, part: next as LivePart };
}

/**
 * The unit sell the Estimator's catalog picker gives this part on a quote stamped `tierMargin` (null = none stamped):
 * catalogAddPrice — a part WITH a cost sells at cost × (1 + markup); a part with no cost sells at its LIST price.
 */
export function addLineSell(part: Pick<LivePart, "cost" | "list">, tierMargin: number | null | undefined): number {
  return catalogAddPrice(part.cost || 0, part.list || 0, tierMargin);
}
