import { insertDocIfAbsent } from "@/db/doc-store";
import { list as listCatalog, getMany as getCatalogParts, type CatalogPart } from "@/lib/stores/catalog";
import { ensureGridSymbolsFor } from "@/lib/stores/grid-catalog";
import { getSettingsStrict, setSettings } from "@/lib/settings";
import { isPerLengthUnit } from "@/lib/design/grid-bom";
import { cleanCableOd } from "@/lib/design/conduit-riser/cable-od";
import { findExistingCable, linkStarterWireTypes, WIRE_STARTER, WIRE_STARTER_LINKS, type WireStarterCable } from "@/lib/design/wire-starter";

/**
 * Grid notes #5 — load the starter cables (wire-starter.ts) and put every
 * per-foot cable in the Grid library. Idempotent and additive only:
 *
 * - A starter cable is inserted into the Catalog ONLY when no part already is
 *   that cable (same SKU, a SKU a rename retired into it, or the same
 *   manufacturer + model under another SKU — findExistingCable). The insert
 *   is insert-if-absent on the document id, so a part deleted at that SKU is
 *   never revived and an existing part's price or edits are never touched.
 * - Each linked wire type gains cableSku / symbol / signal only where blank
 *   (linkStarterWireTypes); settings are written only when something changed.
 * - ensureWireLibrary: every live per-foot catalog part gets a Grid library
 *   entry (ensureGridSymbolsFor is insert-if-absent too), so a cable that was
 *   added to the Catalog after the library was first seeded reaches the
 *   Wires pane.
 */

export type WireStarterResult = {
  partsAdded: number;
  partsExisting: number;
  libraryAdded: number;
  wireTypesLinked: number;
};

const STARTER_NOTE = "Starter cable — set cost and sell per ft";

function starterPart(c: WireStarterCable, now: number): CatalogPart {
  const od = cleanCableOd(c.cableOdIn);
  return {
    id: c.sku,
    sku: c.sku,
    desc: c.desc,
    category: c.category,
    unit: c.unit,
    list: c.list,
    cost: c.cost,
    mfr: c.manufacturer,
    manufacturerModelNumber: c.modelNumber,
    manufacturerPartNumber: c.mfrPartNumber,
    note: STARTER_NOTE,
    docs: [{ kind: "datasheet", label: "Manufacturer datasheet", url: c.source }],
    ...(od !== null ? { cableOdIn: od } : {}),
    updatedAt: now,
  };
}

/** Every live per-foot catalog part gets a Grid library entry. Returns how many were added. */
export async function ensureWireLibrary(by: string, catalog?: CatalogPart[]): Promise<number> {
  const parts = (catalog ?? (await listCatalog())).filter((p) => !p.renamedTo && isPerLengthUnit(p.unit || ""));
  return ensureGridSymbolsFor(parts, by);
}

export async function loadWireStarter(
  by: string,
  opts: { starter?: readonly WireStarterCable[]; links?: typeof WIRE_STARTER_LINKS } = {}
): Promise<WireStarterResult> {
  const starter = opts.starter ?? WIRE_STARTER;
  const links = opts.links ?? WIRE_STARTER_LINKS;
  const catalog = await listCatalog();
  const now = Date.now();
  let partsAdded = 0;
  let partsExisting = 0;
  /** starter SKU → the catalog SKU that holds that cable. */
  const skuOf = new Map<string, string>();
  for (const c of starter) {
    const have = findExistingCable(c, catalog);
    if (have) {
      partsExisting += 1;
      skuOf.set(c.sku, have.sku);
      continue;
    }
    if (await insertDocIfAbsent<CatalogPart>("catalog_parts", starterPart(c, now))) partsAdded += 1;
    else partsExisting += 1; // a deleted part holds the SKU — it stays deleted
    skuOf.set(c.sku, c.sku);
  }

  // Re-read only what this run inserted, then the library pass over the whole book.
  const added = partsAdded ? await getCatalogParts(starter.filter((c) => skuOf.get(c.sku) === c.sku).map((c) => c.sku)) : [];
  const known = new Set(catalog.map((p) => p.id));
  const libraryAdded = await ensureWireLibrary(by, [...catalog, ...added.filter((p) => !known.has(p.id))]);

  // Link a wire type only to a cable that is really in the Catalog now.
  const live = new Set([...catalog, ...added].map((p) => p.sku));
  const linkable = links.filter((l) => live.has(skuOf.get(l.cableSku) ?? l.cableSku));
  const settings = await getSettingsStrict();
  const { wireTypes, linked } = linkStarterWireTypes(settings.wireTypes, (s) => skuOf.get(s) ?? s, linkable);
  if (linked > 0) await setSettings({ wireTypes });

  return { partsAdded, partsExisting, libraryAdded, wireTypesLinked: linked };
}
