"use server";

import { requirePerm } from "@/lib/session";
import { searchCatalog } from "@/app/(app)/estimator/actions";

/** One catalog hit as the admin part picker shows it (cost included — admin screens only). */
export type EquipPartHit = { sku: string; desc: string; category: string; unit: string; cost: number; list: number };

/** Server-side part search (never the whole ~37k catalog on the client). Admin page, so cost is shown. */
export async function searchEquipmentPartsAction(query: string): Promise<{ hits: EquipPartHit[]; total: number }> {
  await requirePerm("manage_users");
  const { hits, total } = await searchCatalog(String(query ?? ""), "", 20);
  return {
    hits: hits.map((h) => ({ sku: h.sku, desc: h.desc, category: h.category, unit: h.unit, cost: h.cost, list: h.list })),
    total,
  };
}
