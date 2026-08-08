"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import * as equipmentItems from "@/lib/stores/equipment-items";
import * as equipmentLocations from "@/lib/stores/equipment-locations";
import type { EquipmentCategory } from "@/lib/stores/equipment-items";

/**
 * Rentals hub mutations (Task 4). Edits go through `mergeUpsert` rather than
 * a full `upsert` — this form only exposes sku/name/category/manufacturer/
 * rates, and `upsert()` is a full replace. Seeded items already carry
 * `stock` (owned qty per location, consumed by Task 2's availability logic);
 * a plain `upsert` here would silently zero it out on the very first rate
 * edit. `mergeUpsert` (built in Task 1 for exactly this shallow-merge
 * situation) preserves stock/description/subcategory/active for existing
 * items. New items (no id) still get sane defaults via `upsert`.
 */
export async function upsertEquipmentItem(formData: FormData): Promise<void> {
  await requirePerm("create");
  const id = String(formData.get("id") || "");
  const patch = {
    sku: String(formData.get("sku") || ""),
    name: String(formData.get("name") || ""),
    category: String(formData.get("category") || "other") as EquipmentCategory,
    manufacturer: String(formData.get("manufacturer") || ""),
    dayRate: Number(formData.get("dayRate") || 0),
    weekRate: Number(formData.get("weekRate") || 0),
    monthRate: Number(formData.get("monthRate") || 0),
  };
  if (id) {
    await equipmentItems.mergeUpsert(id, patch);
  } else {
    await equipmentItems.upsert({ ...patch, active: true, stock: [] });
  }
  revalidatePath("/rentals");
}

export async function upsertEquipmentLocation(formData: FormData): Promise<void> {
  await requirePerm("create");
  await equipmentLocations.upsert({
    id: String(formData.get("id") || "") || undefined,
    name: String(formData.get("name") || ""),
  });
  revalidatePath("/rentals");
}
