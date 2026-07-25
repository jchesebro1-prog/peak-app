import { getDoc, listDocs, upsertDoc } from "@/db/doc-store";

/**
 * Catalog — server port of app/catalog-data.js (window.MASTER_CATALOG +
 * window.catalogByCategory) over collection "catalog_parts". Single source of
 * truth for catalog parts across the system.
 *
 * Part shape is the prototype's entry shape exactly; the document id is the
 * SKU (the parts' natural key).
 * - `category` drives filtering. Curtain fabrics are tagged "Fabric".
 * - `costPerSqft` is only present on Fabric rows; the curtain configurator
 *   uses it as the material cost basis.
 * - Labor/travel rates are tagged "Labor"; the labor configurator reads
 *   `cost` as the rate. Edit a rate here to reprice every quote globally.
 *
 * Note: listDocs orders by id (SKU) ascending; the prototype array's
 * insertion order is not preserved in the DB.
 */

export type CatalogPart = {
  /** Document id — equals the SKU. */
  id: string;
  sku: string;
  desc: string;
  /** 'Fabric' | 'Labor' | … */
  category: string;
  /** 'sq ft' | 'hr' | 'mi' | 'night' | 'day' | 'ea' | … */
  unit: string;
  list: number;
  cost: number;
  mfr?: string;
  /** Fabric rows only — curtain configurator material cost basis. */
  costPerSqft?: number;
  /** Fabric rows only — weight basis, so one fabric choice drives both price
   *  and rigging weight. The oz also appears in `desc` for humans; this is the
   *  machine-readable copy. */
  oz?: number;
  /** How `oz` is measured. Velour bolts are sold by linear yard at a given
   *  bolt width; muslin and scrim by square yard. */
  ozBasis?: "lin-yd" | "sq-yd";
  /** Bolt width in inches — only meaningful when ozBasis is "lin-yd". */
  boltWidthIn?: number;
  /** Curtain make-it-ourselves area cost, $/ft² of sewn fabric. Fabric rows
   *  only. Seeded ~10% above the Rose-Brand-reconciled rate; edit toward real
   *  shop cost when the curtain shop exists. Distinct from raw costPerSqft. */
  curtainAreaRate?: number;
  /** Labor rows — 'RIG' | 'LIG' | 'AUD' | 'VID' picks the rate set. */
  discipline?: string;
  /** Labor rows — 'labor' | 'ot' | 'sup' | 'shop' | 'travel' | 'equip'. */
  role?: string;
  /** Freeform flag shown in the catalog (e.g. "verify price" on imported rows
   *  whose price looked off). Cleared once a human confirms the pricing. */
  note?: string;
  /** Trade override — normally derived via the category map. */
  trade?: string;
};

/** All parts (port of window.MASTER_CATALOG reads). */
export async function list(): Promise<CatalogPart[]> {
  return listDocs<CatalogPart>("catalog_parts");
}

export async function get(sku: string): Promise<CatalogPart | null> {
  return getDoc<CatalogPart>("catalog_parts", sku);
}

/** Rows of a given category (port of window.catalogByCategory). */
export async function byCategory(category: string): Promise<CatalogPart[]> {
  const all = await list();
  return all.filter((p) => p.category === category);
}

/** Insert or fully replace a part; the SKU is the document id. */
export async function upsert(
  part: Omit<CatalogPart, "id"> & { id?: string }
): Promise<CatalogPart> {
  const doc: CatalogPart = { ...part, id: part.id || part.sku };
  return upsertDoc<CatalogPart>("catalog_parts", doc);
}
