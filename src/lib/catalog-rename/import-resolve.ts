/**
 * #302 — which live part an imported price-list row means. Manufacturer price
 * lists keep arriving keyed by order number ("80-0043") after the part was
 * renamed to a `Brand:Model` SKU ("Symetrix:Jupiter 4"), so both catalog
 * importers (the Catalog page's runCatalogImport and the Import hub's catalog
 * writer) and the manufacturer import guard resolve each row through here
 * before deciding "update" vs "new part" — never a duplicate at the old SKU,
 * never a revived tombstone.
 *
 * Pure: the caller passes the live book (`list()`) and the rename crosswalk
 * (`renameMapOf(allSkuRenames())`); built once per import, O(1) per row.
 */
import { mfrKey } from "@/lib/catalog-books";

export type ResolvablePart = { sku: string; mfr?: string; manufacturerPartNumber?: string; formerSkus?: string[] };
export type ImportResolveRow = { sku: string; mfr?: string; manufacturerPartNumber?: string };
/** The live SKU the row resolves to, or null (a new part). */
export type ImportResolver = (row: ImportResolveRow) => string | null;

/** SKUs and part numbers compare case/punctuation-insensitively — the same
 *  lowercase-alnum key the import guard's skuKey and the hub's `ci` use. */
const key = (s: string | null | undefined): string => mfrKey(s);

/** First SKU seen per key; a key two different SKUs claim is ambiguous (null). */
function claim(m: Map<string, string | null>, k: string, sku: string): void {
  if (!k) return;
  const prev = m.get(k);
  if (prev === undefined) m.set(k, sku);
  else if (prev !== sku) m.set(k, null);
}

/**
 * Resolution order (first hit wins):
 * 1. an exact live SKU;
 * 2. a live part whose `formerSkus` lists the row SKU (normalized);
 * 3. the rename log, chain followed, to a live SKU (exact, then normalized);
 *    — a step 2/3 hit yields to the UNIQUE live part whose own SKU normalizes
 *    to the row SKU's key: a live part's SKU outranks another part's former
 *    SKU. (Without a 2/3 hit, a normalized-only live match stays the
 *    importer's own rule — the hub's `ci`; the page is exact.)
 * 4. the UNIQUE live part of the same manufacturer (mfrKey) whose normalized
 *    MFR P/N equals the row's MFR P/N when the row carries one — else the
 *    row SKU. A row P/N is never second-guessed by its SKU.
 * Anything else — including an ambiguous step 2/4 — is null.
 */
export function buildImportResolver(live: ResolvablePart[], renames: ReadonlyMap<string, string>): ImportResolver {
  const liveSkus = new Set<string>();
  const byLiveKey = new Map<string, string | null>(); // normalized live SKU → sku
  const byFormer = new Map<string, string | null>();
  const byMfrPn = new Map<string, string | null>(); // `${mfrKey}\u0000${pnKey}` → sku
  for (const p of live) {
    if (!p?.sku) continue;
    liveSkus.add(p.sku);
    claim(byLiveKey, key(p.sku), p.sku);
    for (const f of p.formerSkus ?? []) claim(byFormer, key(f), p.sku);
    const mk = key(p.mfr);
    const pk = key(p.manufacturerPartNumber);
    if (mk && pk) claim(byMfrPn, `${mk}\u0000${pk}`, p.sku);
  }
  // The log keyed both ways: exact first, then normalized (a normalized key
  // two renames share is ambiguous and dropped).
  const renamesByKey = new Map<string, string | null>();
  for (const [from, to] of renames) claim(renamesByKey, key(from), to);
  const followRename = (start: string | null | undefined): string | null => {
    let to = start;
    // renameMapOf already collapses chains; follow any leftover hop anyway,
    // bounded so a cycle stops.
    for (let hops = 0; to && !liveSkus.has(to) && hops <= renames.size; hops++) to = renames.get(to);
    return to && liveSkus.has(to) ? to : null;
  };

  return (row) => {
    const sku = String(row?.sku ?? "").trim();
    const k = key(sku);
    if (sku && liveSkus.has(sku)) return sku; // 1
    if (k) {
      const hit = byFormer.get(k) || followRename(renames.get(sku)) || followRename(renamesByKey.get(k)); // 2, 3
      if (hit) return byLiveKey.get(k) || hit; // a live SKU in another spelling outranks a former SKU
    }
    const mk = key(row?.mfr); // 4
    if (!mk) return null;
    const pk = key(row?.manufacturerPartNumber) || k;
    if (!pk) return null;
    return byMfrPn.get(`${mk}\u0000${pk}`) ?? null;
  };
}
