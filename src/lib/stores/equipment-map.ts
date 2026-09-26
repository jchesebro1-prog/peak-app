import { getBlob, setBlob } from "@/db/doc-store";
import { getMany, type CatalogPart } from "@/lib/stores/catalog";
import { listFixtures } from "@/lib/stores/fixtures";
import { getCatalogRates } from "@/lib/stores/pricing";
import { fixtureSkus } from "@/lib/fixture-assemblies";
import { EQUIPMENT_ROW_BY_KEY } from "@/lib/design/equipment-vocab";
import {
  EQUIPMENT_MAP_BLOB,
  buildEquipmentPriceTable,
  mapSkus,
  mergeEquipRow,
  sanitizeEquipmentMap,
  type EquipmentMap,
  type EquipmentPriceTable,
  type EquipPriceCtx,
  type EquipRow,
  type EquipRowInput,
} from "@/lib/design/equipment-map";

/**
 * The Equipment map store (#GEM, D-GEM-2): one settings blob, one top-level
 * key per row. Starts EMPTY — nothing here ever writes a row on its own; only
 * saveEquipmentRow / clearEquipmentRow, called from the admin actions, do.
 * Survives the go-live reset (clearDemoData never touches blobs), like every
 * other rate blob.
 */

export async function getEquipmentMap(): Promise<EquipmentMap> {
  return sanitizeEquipmentMap(await getBlob<Record<string, unknown>>(EQUIPMENT_MAP_BLOB, {}));
}

export async function saveEquipmentRow(
  rowKey: string,
  input: EquipRowInput,
  by: string,
  now = Date.now()
): Promise<{ ok: true; row: EquipRow } | { ok: false; error: string }> {
  if (!EQUIPMENT_ROW_BY_KEY.has(rowKey)) return { ok: false, error: "Unknown equipment row." };
  const prev = (await getEquipmentMap())[rowKey];
  const merged = mergeEquipRow(prev, input, by, now);
  if (!merged.ok) return merged;
  await setBlob(EQUIPMENT_MAP_BLOB, { [rowKey]: merged.row });
  return merged;
}

export async function clearEquipmentRow(rowKey: string): Promise<boolean> {
  if (!EQUIPMENT_ROW_BY_KEY.has(rowKey)) return false;
  await setBlob(EQUIPMENT_MAP_BLOB, { [rowKey]: null });
  return true;
}

/**
 * Everything the resolver needs, loaded once. Pass `catalog` when the caller
 * already holds the whole book for this request (the Grid editor page, Quick
 * Design); otherwise exactly the SKUs the map, `extraSkus` and the parts of
 * `extraFixtureIds` reference are read in ONE getMany — never the whole
 * ~37,400-part catalog, never one query per part.
 */
export async function loadEquipPriceCtx(
  opts: { catalog?: ReadonlyArray<CatalogPart>; extraSkus?: readonly string[]; extraFixtureIds?: readonly string[] } = {}
): Promise<{ map: EquipmentMap; ctx: EquipPriceCtx; catalogParts: ReadonlyMap<string, CatalogPart> }> {
  const [map, fixtureList, rates] = await Promise.all([getEquipmentMap(), listFixtures(), getCatalogRates()]);
  const fixtures = new Map(fixtureList.map((f) => [f.id, f]));
  let catalogParts: Map<string, CatalogPart>;
  if (opts.catalog) {
    catalogParts = new Map(opts.catalog.map((p) => [p.sku, p]));
  } else {
    const skus = new Set<string>([...mapSkus(map, fixtures), ...(opts.extraSkus || [])]);
    for (const id of opts.extraFixtureIds || []) {
      const f = fixtures.get(id);
      if (f) for (const sku of fixtureSkus(f)) skus.add(sku);
    }
    catalogParts = new Map((skus.size ? await getMany([...skus]) : []).map((p) => [p.sku, p]));
  }
  return { map, ctx: { parts: catalogParts, fixtures, margin: rates.defaultMargin }, catalogParts };
}

export async function loadEquipmentPriceTable(opts?: Parameters<typeof loadEquipPriceCtx>[0]): Promise<EquipmentPriceTable> {
  const { map, ctx } = await loadEquipPriceCtx(opts);
  return buildEquipmentPriceTable(map, ctx);
}
