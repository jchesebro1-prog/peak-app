import { getManyBySku, type CatalogPart } from "@/lib/stores/catalog";
import { get as getQuote, type Quote } from "@/lib/stores/quotes";
import { isFabricPart } from "@/lib/fabric-part";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { quoteBuilderHref } from "@/lib/quote-links";
import { estimateTrayLines, type EstimateTrayData } from "./estimate-tray";

/**
 * #314 — the server half of the Grid's "From estimate" tray: the linked
 * quote's CURRENT saved spec (read live on every editor load, never copied
 * into the design), filtered by the catalog (a fabric, Labor or unknown SKU
 * can't be placed), plus the #304 rename map for every SKU the tray or the
 * option's placements name (requested → live SKU, the catalog's own
 * renamedTo resolution), so the client counts a renamed part once.
 * Server-only.
 */

export type { EstimateTrayData } from "./estimate-tray";

const isGridPlaceablePart = (p: CatalogPart | undefined): boolean => !!p && !isFabricPart(p) && (p.category || "").trim() !== "Labor";

function specOf(q: Quote | null): { sections: unknown; groups: unknown } {
  const s = (q?.spec || {}) as { sections?: unknown; groups?: unknown };
  return { sections: s.sections, groups: s.groups };
}

/** Every raw SKU the quote's lines name (before any filtering). */
function rawLineSkus(sections: unknown): string[] {
  const out = new Set<string>();
  for (const sec of Array.isArray(sections) ? sections : []) {
    for (const it of Array.isArray((sec as { items?: unknown })?.items) ? (sec as { items: unknown[] }).items : []) {
      const s = typeof (it as { sku?: unknown })?.sku === "string" ? (it as { sku: string }).sku.trim() : "";
      if (s && s.length <= 128) out.add(s);
    }
  }
  return [...out];
}

export async function loadEstimateTray(quoteId: string, placementPartIds: readonly string[]): Promise<EstimateTrayData> {
  const q = quoteId ? await getQuote(quoteId) : null;
  const base = { quoteId, quoteNumber: q ? displayQuoteNumber(q) : quoteId, href: quoteBuilderHref({ id: quoteId, quoteType: q?.quoteType ?? "system" }) };
  if (!q) return { ...base, gone: true, renames: {}, lines: [], excluded: 0, excludedBy: {} };
  const { sections, groups } = specOf(q);
  const asked = [...new Set([...rawLineSkus(sections), ...placementPartIds.filter((s) => typeof s === "string" && s && s.length <= 128)])];
  const bySku = asked.length ? await getManyBySku(asked) : new Map<string, CatalogPart>();
  const renames: Record<string, string> = {};
  for (const [requested, part] of bySku) if (part.sku !== requested) renames[requested] = part.sku;
  const live = new Map([...bySku.values()].map((p) => [p.sku, p] as const));
  const result = estimateTrayLines(sections, groups, { resolve: renames, placeable: (sku) => isGridPlaceablePart(live.get(sku)) });
  return { ...base, gone: false, renames, ...result };
}

/** The catalog parts behind the tray's lines — what ensureGridSymbolsFor needs so each one resolves in the editor. */
export async function estimateTrayParts(quote: Quote): Promise<CatalogPart[]> {
  const { sections, groups } = specOf(quote);
  const skus = rawLineSkus(sections);
  if (!skus.length) return [];
  const bySku = await getManyBySku(skus);
  const live = new Map([...bySku.values()].map((p) => [p.sku, p] as const));
  const renames: Record<string, string> = {};
  for (const [requested, part] of bySku) if (part.sku !== requested) renames[requested] = part.sku;
  const { lines } = estimateTrayLines(sections, groups, { resolve: renames, placeable: (sku) => isGridPlaceablePart(live.get(sku)) });
  const want = new Set(lines.map((l) => l.sku));
  return [...live.values()].filter((p) => want.has(p.sku));
}
