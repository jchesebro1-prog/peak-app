"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { saveSystemCategories } from "@/lib/stores/system-categories";
import type { SystemCategory } from "@/lib/system-categories";
import { searchCatalog } from "@/app/(app)/estimator/actions";
import type { EquipPartHit } from "@/app/(app)/design/grid/settings/actions";

/**
 * Estimating Rules → System categories mutations (Estimator Phase 6). Admin
 * (manage_users) only, like every other Estimating Rules action. The save
 * re-sanitizes whatever the client posts and returns what was stored.
 */

/** `sku` is the catalog record's CURRENT sku — it differs from the stored one when the part was renamed (#304). */
export type CategoryPartInfo = { sku: string; desc: string; unit: string; cost: number; list: number };

export async function saveSystemCategoriesAction(list: unknown): Promise<{ ok: true; categories: SystemCategory[] } | { ok: false; error: string }> {
  await requirePerm("manage_users");
  try {
    const categories = await saveSystemCategories(list);
    revalidatePath("/estimating-rules/system-categories");
    revalidatePath("/estimator");
    return { ok: true, categories };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save the categories." };
  }
}

/** Server-side part search (never the whole catalog on the client). Admin page, so cost is shown. */
export async function searchCategoryPartsAction(query: string): Promise<{ hits: EquipPartHit[]; total: number }> {
  await requirePerm("manage_users");
  const { hits, total } = await searchCatalog(String(query ?? ""), "", 20);
  return {
    hits: hits.map((h) => ({ sku: h.sku, desc: h.desc, category: h.category, unit: h.unit, cost: h.cost, list: h.list })),
    total,
  };
}
