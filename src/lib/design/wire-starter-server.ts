import { list as listCatalog, listDeleted as listDeletedCatalog, getMany as getCatalogParts, insertIfAbsent, type CatalogPart } from "@/lib/stores/catalog";
import { ensureGridSymbolsForMany } from "@/lib/stores/grid-catalog";
import { getSettingsStrict, setSettings } from "@/lib/settings";
import { isPerLengthUnit } from "@/lib/design/grid-bom";
import { cleanCableOd } from "@/lib/design/conduit-riser/cable-od";
import { findExistingCable, linkStarterWireTypes, WIRE_STARTER, WIRE_STARTER_LINKS, type WireStarterCable } from "@/lib/design/wire-starter";

/**
 * Grid notes #5 — load the starter cables (wire-starter.ts) and put every
 * per-foot cable in the Grid library. Idempotent and additive only:
 *
 * - A starter cable already in the Catalog (findExistingCable over LIVE
 *   parts: same SKU / former SKU, or a per-foot part of the same
 *   manufacturer + model) is left alone and, when per-foot, linked.
 * - A starter cable a human DELETED — any soft-deleted part matching the same
 *   rule, rename tombstones excluded (their successor is live) — is "held
 *   deleted": never re-inserted, never linked. Restoring it in the Catalog is
 *   the way back.
 * - Anything else is inserted through the catalog store's insertIfAbsent
 *   (insert-if-absent on the SKU, updatedAt/pricedAt stamped like writePart),
 *   so an existing part's price or edits are never touched.
 * - Each linked wire type gains cableSku / symbol / signal only where blank
 *   (linkStarterWireTypes); settings are written only when something changed.
 * - ensureWireLibrary: every live per-foot catalog part gets a Grid library
 *   entry, batched (ensureGridSymbolsForMany), so a cable added to the Catalog
 *   after the library was first seeded reaches the Wires pane.
 */

export type WireStarterResult = {
  partsAdded: number;
  partsExisting: number;
  /** Starter cables a deleted catalog part holds: not re-added, their wire type left unlinked. */
  heldDeleted: number;
  /** The deleted parts' SKUs, for the result line. */
  heldDeletedNames: string[];
  libraryAdded: number;
  wireTypesLinked: number;
};

const STARTER_NOTE = "Starter cable — set cost and sell per ft";

function starterPart(c: WireStarterCable): Omit<CatalogPart, "id"> & { id: string } {
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
  };
}

/** Every live per-foot catalog part gets a Grid library entry (batched). Returns how many were added. */
export async function ensureWireLibrary(by: string, catalog?: CatalogPart[]): Promise<number> {
  const parts = (catalog ?? (await listCatalog())).filter((p) => !p.renamedTo && isPerLengthUnit(p.unit || ""));
  return ensureGridSymbolsForMany(parts, by);
}

export async function loadWireStarter(
  by: string,
  opts: { starter?: readonly WireStarterCable[]; links?: typeof WIRE_STARTER_LINKS } = {}
): Promise<WireStarterResult> {
  const starter = opts.starter ?? WIRE_STARTER;
  const links = opts.links ?? WIRE_STARTER_LINKS;
  const [catalog, deletedRows] = await Promise.all([listCatalog(), listDeletedCatalog()]);
  // A rename's tombstone is not a delete: the part it became is live (and lists the old SKU in formerSkus).
  const deleted = deletedRows.filter((p) => !p.renamedTo);
  let partsAdded = 0;
  let partsExisting = 0;
  const heldDeletedNames: string[] = [];
  /** starter SKU → the live, per-foot catalog SKU that holds that cable (only these are linked). */
  const linkSku = new Map<string, string>();
  for (const c of starter) {
    const live = findExistingCable(c, catalog);
    if (live) {
      partsExisting += 1;
      if (isPerLengthUnit(live.unit || "")) linkSku.set(c.sku, live.sku);
      continue;
    }
    const gone = findExistingCable(c, deleted);
    if (gone) {
      heldDeletedNames.push(gone.sku);
      continue;
    }
    if (await insertIfAbsent(starterPart(c))) {
      partsAdded += 1;
      linkSku.set(c.sku, c.sku);
    } else {
      // Lost a race, or a rename tombstone holds the id: the live read below decides.
      partsExisting += 1;
    }
  }

  // Re-read only the SKUs this run tried to add, then the library pass over the whole book.
  const tried = starter.filter((c) => linkSku.get(c.sku) === c.sku).map((c) => c.sku);
  const added = tried.length ? await getCatalogParts(tried) : [];
  const known = new Set(catalog.map((p) => p.id));
  const libraryAdded = await ensureWireLibrary(by, [...catalog, ...added.filter((p) => !known.has(p.id))]);

  // Link a wire type only to a per-foot cable that is really live in the Catalog now.
  const liveSkus = new Set([...catalog, ...added].map((p) => p.sku));
  const linkable = links.filter((l) => {
    const s = linkSku.get(l.cableSku);
    return !!s && liveSkus.has(s);
  });
  const settings = await getSettingsStrict();
  const { wireTypes, linked } = linkStarterWireTypes(settings.wireTypes, (s) => linkSku.get(s) ?? s, linkable);
  if (linked > 0) await setSettings({ wireTypes });

  return { partsAdded, partsExisting, heldDeleted: heldDeletedNames.length, heldDeletedNames, libraryAdded, wireTypesLinked: linked };
}
