import type { SearchEntry, SearchQuery } from "@/lib/portal-search";

/**
 * Portal catalog browse page — pure, client-safe helpers (#245 Task 10,
 * spec §3.1). No server imports (type-only above), so the "use client"
 * catalog component can use the URL + pager helpers directly.
 *
 * `TileVM` is SELL-ONLY: `toTileVM` copies an explicit whitelist of fields,
 * so a caller that hands it an `IndexedPart` (which carries cost) can never
 * leak cost, list, margin or a tier name to the browser.
 */

export type TileVM = {
  key: string;
  kind: "part" | "fixture";
  title: string;
  sku: string;
  mfr: string;
  category: string;
  imageId: string | null;
  hasDatasheet: boolean;
  unitPrice: number | null;
  por: boolean;
  unit: string;
};

/** Spec §3.1: 48 per page, numbered paging. */
export const CATALOG_PAGE_SIZE = 48;
/** "Parts you've quoted before" shelf cap (spec §3.1). */
export const SHELF_MAX = 12;

const MAX_TEXT = 200;
const MAX_FACET_VALUES = 50;

export type CatalogParams = { q: string; mfr: string[]; cat: string[]; page: number; part: string; dept: string };

type RawParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] ?? "" : v ?? "").slice(0, MAX_TEXT);
}

/** The raw `?dept=`/client `dept` field, cleaned to a plain id string. An
 *  id that doesn't resolve to a real department (or "other") is simply
 *  ignored downstream (departmentFilterFor/resolveDept) — no validation
 *  needed here beyond a length cap (#251). */
export function cleanDeptId(raw: unknown): string {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const v = (raw as Record<string, unknown>).dept;
    return typeof v === "string" ? v.trim().slice(0, 40) : "";
  }
  return "";
}

function cleanList(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
  const out: string[] = [];
  for (const s of arr) {
    if (typeof s !== "string") continue;
    const t = s.trim().slice(0, MAX_TEXT);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= MAX_FACET_VALUES) break;
  }
  return out;
}

function cleanPage(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** `?q=&mfr=&cat=&page=&part=&dept=` (mfr/cat may repeat) → clean params. */
export function parseCatalogParams(sp: RawParams): CatalogParams {
  return {
    q: first(sp.q).trim(),
    mfr: cleanList(sp.mfr),
    cat: cleanList(sp.cat),
    page: cleanPage(first(sp.page)),
    part: first(sp.part).trim(),
    dept: first(sp.dept).trim(),
  };
}

/** An untrusted client search query → a safe `SearchQuery` (page size
 *  clamped to 1..48, strings capped, facet lists de-duplicated). */
export function cleanSearchQuery(raw: unknown): SearchQuery {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const size = Math.floor(Number(r.pageSize));
  return {
    q: typeof r.q === "string" ? r.q.slice(0, MAX_TEXT) : "",
    mfr: cleanList(r.mfr),
    cat: cleanList(r.cat),
    page: cleanPage(r.page),
    pageSize: Number.isFinite(size) && size >= 1 ? Math.min(size, CATALOG_PAGE_SIZE) : CATALOG_PAGE_SIZE,
  };
}

/** The catalog URL for `p` with `over` applied. Page 1 and empty values are
 *  left out; a team preview carries its `preview=` through every link. */
export function catalogHref(p: CatalogParams, over: Partial<CatalogParams> = {}, previewCid = ""): string {
  const n = { ...p, ...over };
  const u = new URLSearchParams();
  if (n.q) u.set("q", n.q);
  for (const m of n.mfr) u.append("mfr", m);
  for (const c of n.cat) u.append("cat", c);
  if (n.page > 1) u.set("page", String(n.page));
  if (n.part) u.set("part", n.part);
  if (n.dept) u.set("dept", n.dept);
  if (previewCid) u.set("preview", previewCid);
  const s = u.toString();
  return "/portal/catalog" + (s ? "?" + s : "");
}

/** Add `value` to the list, or remove it if present. */
export function toggleValue(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export type PagerItem = number | "gap";

/**
 * Numbered pager: every page when there are 7 or fewer; otherwise the
 * first, the last, the current page ±1 and — near either end — the first
 * or last five, with "gap" for any run of two or more skipped pages (a
 * single skipped page is shown as its number instead of an ellipsis).
 */
export function pagerItems(page: number, pages: number): PagerItem[] {
  const total = Math.max(1, Math.floor(pages) || 1);
  const cur = Math.min(Math.max(1, Math.floor(page) || 1), total);
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const keep = new Set<number>([1, total, cur - 1, cur, cur + 1]);
  if (cur <= 4) for (let i = 2; i <= 5; i++) keep.add(i);
  if (cur >= total - 3) for (let i = total - 4; i < total; i++) keep.add(i);
  const nums = [...keep].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: PagerItem[] = [];
  for (const n of nums) {
    const prev = out.length ? (out[out.length - 1] as number) : 0;
    if (prev && n - prev === 2) out.push(prev + 1);
    else if (prev && n - prev > 2) out.push("gap");
    out.push(n);
  }
  return out;
}

type ShelfQuote = { createdAt?: number; updatedAt?: number; spec?: unknown; deleted?: boolean };

/**
 * "Parts you've quoted before" (spec §3.1): distinct SKUs from the given
 * quotes' `spec.sections[].items[].sku`, newest quote first, in line order
 * within a quote, quotable only, at most `max`. The caller has already
 * scoped the quotes to the company (`portalListsQuote`). Every level of
 * `spec` is guarded — a malformed quote contributes nothing.
 */
export function quotedBeforeSkus(
  quotes: readonly ShelfQuote[],
  isQuotable: (sku: string) => boolean,
  max = SHELF_MAX
): string[] {
  const sorted = [...quotes]
    .filter((q) => q && !q.deleted)
    .sort((a, b) => (b.createdAt || b.updatedAt || 0) - (a.createdAt || a.updatedAt || 0));
  const out: string[] = [];
  for (const q of sorted) {
    const spec = q.spec as { sections?: unknown } | null | undefined;
    const sections = spec && typeof spec === "object" && Array.isArray(spec.sections) ? spec.sections : [];
    for (const s of sections) {
      const items = s && typeof s === "object" && Array.isArray((s as { items?: unknown }).items) ? (s as { items: unknown[] }).items : [];
      for (const it of items) {
        const sku = it && typeof it === "object" ? (it as { sku?: unknown }).sku : undefined;
        if (typeof sku !== "string" || !sku || out.includes(sku) || !isQuotable(sku)) continue;
        out.push(sku);
        if (out.length >= max) return out;
      }
    }
  }
  return out;
}

type TileIdentity = Pick<SearchEntry, "key" | "kind" | "title" | "sku" | "mfr" | "category">;
type TileMedia = { imageIds?: readonly string[]; datasheetIds?: readonly string[]; unit?: string } | null | undefined;
type TilePrice = { unitPrice: number | null; por: boolean } | null | undefined;

/** One result tile — an explicit whitelist (never a spread), sell only. A
 *  missing price reads as "Price on request". */
export function toTileVM(e: TileIdentity, media: TileMedia, price: TilePrice): TileVM {
  const unitPrice = price && !price.por && typeof price.unitPrice === "number" ? price.unitPrice : null;
  return {
    key: String(e.key),
    kind: e.kind === "fixture" ? "fixture" : "part",
    title: String(e.title || e.sku || ""),
    sku: String(e.sku || ""),
    mfr: String(e.mfr || ""),
    category: String(e.category || ""),
    imageId: media?.imageIds?.[0] ?? null,
    hasDatasheet: !!media?.datasheetIds?.length,
    unitPrice,
    por: unitPrice == null,
    unit: e.kind === "fixture" ? "ea" : String(media?.unit || "ea"),
  };
}
