import { getDoc, listDocs, upsertDoc } from "@/db/doc-store";

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

export async function upsert(
  loc: Omit<EquipmentLocation, "id"> & { id?: string }
): Promise<EquipmentLocation> {
  const all = await list();
  const id = loc.id || `loc-${all.length + 1}`;
  const doc: EquipmentLocation = { ...loc, id };
  await upsertDoc(COLLECTION, doc);
  return doc;
}
