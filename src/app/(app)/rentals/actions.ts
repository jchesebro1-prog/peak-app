"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import * as equipmentItems from "@/lib/stores/equipment-items";
import * as equipmentLocations from "@/lib/stores/equipment-locations";
import type { EquipmentCategory } from "@/lib/stores/equipment-items";

/**
 * Rentals hub mutations (Task 4). Edits go through `mergeUpsert` rather than
 * a full `upsert` — this form only exposes sku/name/category/manufacturer/
 * rates/stock, and `upsert()` is a full replace. Seeded items already carry
 * `stock` (owned qty per location, consumed by Task 2's availability logic);
 * a plain `upsert` here would silently zero it out on the very first rate
 * edit. `mergeUpsert` (built in Task 1 for exactly this shallow-merge
 * situation) preserves description/subcategory/active for existing items.
 * New items (no id) still get sane defaults via `upsert`.
 *
 * Fix (final review, punch #93): the form only ever exposed sku/name/
 * category/manufacturer/rates, so every new item — hub-created or
 * CSV-imported — was born with `stock: []`, permanently unbookable
 * (qtyOwned() always 0). The form now submits one `stock_<locationId>`
 * field per known location; read them here and build the `stock` array so
 * both create and edit can set per-location quantities. Creating new
 * locations stays out of scope — `upsertEquipmentLocation` below is still
 * unused by design; this only lets the qty for *existing* locations be set.
 */
export async function upsertEquipmentItem(formData: FormData): Promise<void> {
  await requirePerm("create");
  const id = String(formData.get("id") || "");
  const locations = await equipmentLocations.list();
  const stock = locations
    .map((loc) => ({ locationId: loc.id, qty: Number(formData.get(`stock_${loc.id}`) || 0) }))
    .filter((s) => Number.isFinite(s.qty) && s.qty > 0);
  const patch = {
    sku: String(formData.get("sku") || ""),
    name: String(formData.get("name") || ""),
    category: String(formData.get("category") || "other") as EquipmentCategory,
    manufacturer: String(formData.get("manufacturer") || ""),
    dayRate: Number(formData.get("dayRate") || 0),
    weekRate: Number(formData.get("weekRate") || 0),
    monthRate: Number(formData.get("monthRate") || 0),
    stock,
  };
  if (id) {
    await equipmentItems.mergeUpsert(id, patch);
  } else {
    await equipmentItems.upsert({ ...patch, active: true });
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
