/* ------------------------------------------------------------------ *
 * The Grid — BOM math (D108). Pure and dependency-free on purpose
 * (same rule as lib/annotations.ts): the editor's live BOM sidebar is
 * a client component and must not drag the doc-store, and therefore
 * PGlite, into the browser bundle. The server quote action uses the
 * same functions so the sidebar and the quote can never disagree.
 * ------------------------------------------------------------------ */

/** The slice of a catalog part the BOM needs — structurally satisfied by
 *  stores/catalog.CatalogPart, mapped server-side and passed to the client. */
export type PartLite = {
  id: string;
  sku: string;
  desc: string;
  category: string;
  unit: string;
  list: number;
  cost: number;
};

export type BomLine = {
  partId: string;
  desc: string;
  unit: string;
  qty: number;
  /** Unit list price at render time. */
  list: number;
  /** qty × list. */
  ext: number;
};

/**
 * Group device placements into BOM lines, priciest line first.
 *
 * A placement whose part has left the catalog is NOT dropped — hiding it
 * would silently shrink a quote. It stays visible at $0, flagged, so the
 * human deletes the markers or restores the part deliberately.
 */
export function bomLines(
  placements: Array<{ partId: string }>,
  parts: PartLite[]
): BomLine[] {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const qty = new Map<string, number>();
  for (const pl of placements) qty.set(pl.partId, (qty.get(pl.partId) || 0) + 1);
  const lines: BomLine[] = [];
  for (const [partId, n] of qty) {
    const part = byId.get(partId);
    lines.push({
      partId,
      desc: part ? part.desc : `${partId} (removed part — no longer in the catalog)`,
      unit: part ? part.unit : "ea",
      qty: n,
      list: part ? part.list : 0,
      ext: n * (part ? part.list : 0),
    });
  }
  return lines.sort((a, b) => b.ext - a.ext || a.partId.localeCompare(b.partId));
}

/** Sell value, internal cost, and blended margin for a set of placements. */
export function bomTotals(
  placements: Array<{ partId: string }>,
  parts: PartLite[]
): { value: number; cost: number; margin: number } {
  const byId = new Map(parts.map((p) => [p.id, p]));
  let value = 0;
  let cost = 0;
  for (const pl of placements) {
    const part = byId.get(pl.partId);
    if (!part) continue;
    value += part.list;
    cost += part.cost;
  }
  return { value, cost, margin: value > 0 ? (value - cost) / value : 0 };
}
