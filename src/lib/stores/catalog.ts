import { getDoc, listDocs, upsertDoc } from "@/db/doc-store";
import type { Port } from "@/lib/catalog-connect";

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
  /** Device connectors (punch #39, Task 3) — feeds Grid wiring validation
   *  (Task 4), which uses canConnect/compatibleWireTypes from
   *  lib/catalog-connect to check patched runs between device ports. */
  ports?: Port[];
  /** Datasheet attachment (punch #39, Task 5, D116 blob pattern) — the PDF's
   *  bytes live in Vercel Blob, never in this doc (10.7k parts × MB-scale
   *  jsonb is exactly the anti-pattern D116 exists to avoid); this is just
   *  the blob's pathname, streamed by the authenticated
   *  /api/part-datasheet/<sku> proxy. Always set/cleared together with
   *  datasheetName by uploadPartDatasheetAction/removePartDatasheetAction. */
  datasheetBlobKey?: string;
  /** Original filename of the attached datasheet, for display. */
  datasheetName?: string;
  /** Epoch ms of the last write through `upsert`/`mergeUpsert` (PUNCHLIST
   *  #14, decision A) — drives the dashboard's price-book age pills. Unset
   *  on rows that have never been touched since seeding (the seed fixtures
   *  predate this field on purpose; "unknown age" is honest for a row
   *  nobody has confirmed since import). */
  updatedAt?: number;
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

/** Insert or fully replace a part; the SKU is the document id. Stamps
 *  `updatedAt` on every write (PUNCHLIST #14, decision A) — centralized here
 *  rather than left to each caller so every write path (the catalog edit
 *  form, the .xlsx/CSV importer, the spec-builder's create-on-the-fly path)
 *  gets it for free instead of needing to remember it individually. */
export async function upsert(
  part: Omit<CatalogPart, "id"> & { id?: string }
): Promise<CatalogPart> {
  const doc: CatalogPart = { ...part, id: part.id || part.sku, updatedAt: Date.now() };
  return upsertDoc<CatalogPart>("catalog_parts", doc);
}

/**
 * Load the existing part (if any) and shallow-merge `patch` over it before
 * calling `upsert` — which, per the note above, is a FULL REPLACE and will
 * otherwise silently drop any field the caller doesn't happen to carry
 * (ports, datasheetBlobKey/Name, trade, discipline/role, costPerSqft, …).
 *
 * Use this instead of a bare `upsert(...)` whenever the caller only knows
 * about a subset of a part's fields — the catalog edit form and bulk/paste
 * import both authoritatively own a handful of fields (desc, category, unit,
 * list, cost, mfr, note, …) and should overwrite exactly those, while
 * everything else on an existing part rides along untouched. A key present
 * in `patch` always wins, including an explicit `undefined` (how a caller
 * clears a field it owns, e.g. a blanked `mfr`/`note`); a key simply absent
 * from `patch` (as with a JSON-parsed import row that never had it) leaves
 * the existing value in place.
 */
export async function mergeUpsert(
  sku: string,
  patch: Partial<Omit<CatalogPart, "id" | "sku">>
): Promise<CatalogPart> {
  const existing = await get(sku);
  // Cast: TS can't see that callers only omit fields `existing` already
  // supplies (or, for a brand-new part, that `patch` carries every required
  // field itself) — the runtime contract is enforced by callers, same as
  // the pre-existing `{ ...part, ... } as SpecCatalogPart` pattern in
  // design/engagements/spec/actions.ts.
  return upsert({ ...(existing ?? {}), ...patch, sku } as Omit<CatalogPart, "id"> & { id?: string });
}
