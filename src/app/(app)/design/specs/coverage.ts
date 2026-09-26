import { articleIdForPart, specStateOf, type SpecCategoryArticle, type SpecPartLike } from "@/lib/specs/articles";
import type { SpecSection } from "@/lib/specs/sections";

/**
 * Task 12 — the coverage table: which catalog parts have approved spec
 * language, and which have shown up on a BOM lately without any. Pure
 * (no store imports) so it's cheap to unit test against production's ~37.4k
 * catalog parts — every pass below is O(n) over its input with a Map/Set,
 * never a nested scan.
 */

/** A part counts as "on a BOM" if it appeared on a quote, a Grid project, or
 *  a generated bid spec within this window. 90 days. */
export const ON_BOM_WINDOW_MS = 90 * 86_400_000;

export type CoverageState = "authored" | "same-as" | "draft" | "missing";

export type CoverageRow = {
  sku: string;
  desc: string;
  category: string;
  articleId: string | null;
  state: CoverageState;
  onBom: boolean;
  hasDatasheet: boolean;
};

function pushSku(out: string[], sku: unknown): void {
  if (typeof sku !== "string") return;
  const t = sku.trim();
  if (t) out.push(t);
}

/** Every item SKU inside a saved quote/grid spec, regardless of which of
 *  the two shapes it's in: the estimator's `sections[].items[]` (nested) or
 *  the Grid's flat `lines[]`. Never throws on a junk or missing shape. */
export function skusFromQuoteSpec(spec: unknown): string[] {
  const out: string[] = [];
  if (!spec || typeof spec !== "object") return out;
  const s = spec as Record<string, unknown>;

  if (Array.isArray(s.sections)) {
    for (const sec of s.sections) {
      if (!sec || typeof sec !== "object") continue;
      const items = (sec as Record<string, unknown>).items;
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        if (item && typeof item === "object") pushSku(out, (item as Record<string, unknown>).sku);
      }
    }
  }

  if (Array.isArray(s.lines)) {
    for (const line of s.lines) {
      if (line && typeof line === "object") pushSku(out, (line as Record<string, unknown>).sku);
    }
  }

  return out;
}

/**
 * The union of SKUs that appeared on a BOM since `since`, across three
 * sources: quotes (estimator's nested spec or the Grid's flat one), Grid
 * projects (`placements[].partId`), and generated bid specs — the D94 shape
 * (`bom[].sku`) and Phase B's (`rows[].row.sku`). Each source is scanned
 * once; each doc's own arrays are scanned once — no nested per-part lookup.
 */
export function skusOnBomSince(
  sources: { quotes: unknown[]; gridProjects: unknown[]; generated: unknown[] },
  since: number
): Set<string> {
  const out = new Set<string>();
  const add = (sku: unknown) => {
    if (typeof sku !== "string") return;
    const t = sku.trim();
    if (t) out.add(t);
  };

  for (const q of sources.quotes || []) {
    if (!q || typeof q !== "object") continue;
    const r = q as Record<string, unknown>;
    const at = Number(r.updatedAt ?? r.createdAt ?? 0);
    if (!(at >= since)) continue;
    for (const sku of skusFromQuoteSpec(r.spec)) add(sku);
  }

  for (const p of sources.gridProjects || []) {
    if (!p || typeof p !== "object") continue;
    const r = p as Record<string, unknown>;
    const at = Number(r.updatedAt ?? 0);
    if (!(at >= since)) continue;
    const placements = r.placements;
    if (!Array.isArray(placements)) continue;
    for (const pl of placements) {
      if (pl && typeof pl === "object") add((pl as Record<string, unknown>).partId);
    }
  }

  for (const g of sources.generated || []) {
    if (!g || typeof g !== "object") continue;
    const r = g as Record<string, unknown>;
    const at = Number(r.createdAt ?? 0);
    if (!(at >= since)) continue;
    if (Array.isArray(r.bom)) {
      for (const row of r.bom) {
        if (row && typeof row === "object") add((row as Record<string, unknown>).sku);
      }
    }
    if (Array.isArray(r.rows)) {
      for (const row of r.rows) {
        if (!row || typeof row !== "object") continue;
        const inner = (row as Record<string, unknown>).row;
        if (inner && typeof inner === "object") add((inner as Record<string, unknown>).sku);
      }
    }
  }

  return out;
}

/** What coverage needs off a catalog part — a superset of SpecPartLike, so a
 *  real CatalogPart is structurally assignable with no cast. */
export type CoveragePart = SpecPartLike & { desc?: string };

/** `articleIdForPart` once per part, keyed by SKU — the one Map the library
 *  page's article-count table and `coverageRows` below both read, instead of
 *  each resolving every part's article independently (final fix wave item
 *  10). `articleIdForPart` itself also caches the (sort, title)-sorted
 *  `articles` copy it needs for a category-default lookup, so this is now a
 *  single O(n) pass with the sort paid once, not once per part per caller. */
export function articleIdMapForParts(
  parts: CoveragePart[],
  articles: SpecCategoryArticle[],
  sections: SpecSection[]
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const p of parts) out.set(p.sku, articleIdForPart(p, articles, sections));
  return out;
}

/** One row per catalog part — mapped to an article or not, spec'd or not.
 *  `bySku` (for specStateOf's same-as resolution) is built once here, not
 *  per part. `articleIdBySku` is the shared, already-computed map from
 *  `articleIdMapForParts` — see final fix wave item 10. `datasheetOk` is
 *  the part-documents coverage rule's answer (#207, spec §7 —
 *  datasheetSatisfiedSkus): own file, not needed, or covered by a fixture;
 *  a link nobody has fetched no longer counts. */
export function coverageRows(
  parts: CoveragePart[],
  articleIdBySku: Map<string, string | null>,
  onBom: Set<string>,
  datasheetOk: ReadonlySet<string>
): CoverageRow[] {
  const bySku = new Map<string, CoveragePart>();
  for (const p of parts) bySku.set(p.sku, p);

  return parts.map((p) => ({
    sku: p.sku,
    desc: p.desc ?? "",
    category: p.category ?? "",
    articleId: articleIdBySku.get(p.sku) ?? null,
    state: specStateOf(p, bySku),
    onBom: onBom.has(p.sku),
    hasDatasheet: datasheetOk.has(p.sku),
  }));
}

export function filterCoverage(
  rows: CoverageRow[],
  f: { articleId?: string; state?: CoverageState | "all"; onBomOnly?: boolean; datasheetOnly?: boolean; q?: string }
): CoverageRow[] {
  let out = rows;

  if (f.articleId) {
    out = f.articleId === "none" ? out.filter((r) => r.articleId === null) : out.filter((r) => r.articleId === f.articleId);
  }
  if (f.state && f.state !== "all") {
    out = out.filter((r) => r.state === f.state);
  }
  if (f.onBomOnly) {
    out = out.filter((r) => r.onBom);
  }
  if (f.datasheetOnly) {
    out = out.filter((r) => r.hasDatasheet);
  }
  const q = (f.q || "").trim().toLowerCase();
  if (q) {
    out = out.filter((r) => (r.sku + " " + r.desc).toLowerCase().includes(q));
  }

  return out;
}
