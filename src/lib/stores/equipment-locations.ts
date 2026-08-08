import { getDoc, insertWithPrefixedId, listDocs, upsertDoc } from "@/db/doc-store";

/**
 * Rentals module — equipment locations (warehouse/trailer/etc.) that
 * equipment-items.ts stock quantities are keyed against. Doc-store
 * collection "equipment_locations", matching the catalog_parts/repair_jobs
 * pattern (D129) — no prototype ancestor.
 */

export type EquipmentLocation = {
  id: string;
  name: string;
  address?: string;
};

const COLLECTION = "equipment_locations";

export async function list(): Promise<EquipmentLocation[]> {
  return listDocs<EquipmentLocation>(COLLECTION);
}

export async function get(id: string): Promise<EquipmentLocation | null> {
  return getDoc<EquipmentLocation>(COLLECTION, id);
}

/**
 * Explicit id stays a plain replace-upsert; a minted id goes through
 * insertWithPrefixedId (D73) instead of a read-then-write
 * `loc-${all.length + 1}` count, which two concurrent creates could
 * compute identically — the second silently overwriting the first.
 */
export async function upsert(
  loc: Omit<EquipmentLocation, "id"> & { id?: string }
): Promise<EquipmentLocation> {
  if (loc.id) {
    const doc: EquipmentLocation = { ...loc, id: loc.id };
    await upsertDoc(COLLECTION, doc);
    return doc;
  }
  return insertWithPrefixedId<EquipmentLocation>(COLLECTION, "loc", 0, (id) => ({ ...loc, id }));
}
