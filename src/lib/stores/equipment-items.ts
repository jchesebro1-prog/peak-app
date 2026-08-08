import { getDoc, insertWithPrefixedId, listDocs, upsertDoc } from "@/db/doc-store";

/**
 * Rentals module — equipment items (the rentable gear catalog). Doc-store
 * collection "equipment_items", matching the catalog_parts/repair_jobs
 * pattern (D129) — no prototype ancestor. `stock` carries per-location
 * owned quantities; availability against bookings is computed in Task 2.
 */

export type EquipmentCategory =
  | "speakers"
  | "monitors"
  | "lighting"
  | "consoles"
  | "control-io"
  | "other";

export type EquipmentItem = {
  id: string;
  sku: string;
  name: string;
  category: EquipmentCategory;
  subcategory?: string;
  manufacturer?: string;
  description?: string;
  dayRate: number;
  weekRate: number;
  monthRate: number;
  active: boolean;
  stock: Array<{ locationId: string; qty: number }>;
};

const COLLECTION = "equipment_items";

export async function list(): Promise<EquipmentItem[]> {
  return listDocs<EquipmentItem>(COLLECTION);
}

export async function get(id: string): Promise<EquipmentItem | null> {
  return getDoc<EquipmentItem>(COLLECTION, id);
}

export async function byCategory(category: EquipmentCategory): Promise<EquipmentItem[]> {
  const all = await list();
  return all.filter((i) => i.category === category);
}

/**
 * Explicit id (edits, via mergeUpsert below) stay a plain replace-upsert.
 * A minted id (new items) goes through insertWithPrefixedId (D73) instead
 * of a read-then-write `eq-${all.length + 1}` count, which two concurrent
 * creates (e.g. two rental quotes approved moments apart, each spawning
 * new catalog rows) could compute identically — the second silently
 * overwriting the first via upsertDoc.
 */
export async function upsert(
  item: Omit<EquipmentItem, "id"> & { id?: string }
): Promise<EquipmentItem> {
  if (item.id) {
    const doc: EquipmentItem = { ...item, id: item.id };
    await upsertDoc(COLLECTION, doc);
    return doc;
  }
  return insertWithPrefixedId<EquipmentItem>(COLLECTION, "eq", 0, (id) => ({ ...item, id }));
}

/**
 * Load the existing item (if any) and shallow-merge `patch` over it before
 * upserting — upsert() is a full replace and would otherwise silently drop
 * any field the caller doesn't happen to carry. `@/db/doc-store` has no
 * `mergeUpsertDoc` helper (checked); this mirrors catalog.ts's `mergeUpsert`,
 * the existing get+upsert pattern for this exact situation.
 */
export async function mergeUpsert(
  id: string,
  patch: Partial<Omit<EquipmentItem, "id">>
): Promise<EquipmentItem> {
  const existing = await get(id);
  return upsert({ ...(existing ?? {}), ...patch, id } as Omit<EquipmentItem, "id"> & { id?: string });
}

export async function qtyOwned(itemId: string, locationId: string): Promise<number> {
  const item = await get(itemId);
  if (!item) return 0;
  const row = item.stock.find((s) => s.locationId === locationId);
  return row ? row.qty : 0;
}
