"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { getManyBySku } from "@/lib/stores/catalog";
import { saveSystemCategories } from "@/lib/stores/system-categories";
import type { SystemCategory } from "@/lib/system-categories";
import { searchCatalog } from "@/app/(app)/estimator/actions";
import type { EquipPartHit } from "@/app/(app)/design/grid/settings/actions";

/**
 * Estimating Rules → System categories mutations (Estimator Phase 6). Admin
 * (manage_users) only, like every other Estimating Rules action. The save
 * re-sanitizes whatever the client posts and returns what was stored.
 */

export type CategoryPartInfo = { desc: string; unit: string; cost: number; list: number };

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

/** SKU → live catalog facts (a retired SKU follows its rename); null = not in the catalog. */
export async function resolveCategoryPartsAction(skus: readonly string[]): Promise<Record<string, CategoryPartInfo | null>> {
  await requirePerm("manage_users");
  const wanted = [...new Set((Array.isArray(skus) ? skus : []).map((s) => String(s ?? "")).filter(Boolean))].slice(0, 2000);
  const found = wanted.length ? await getManyBySku(wanted) : new Map();
  const out: Record<string, CategoryPartInfo | null> = {};
  for (const s of wanted) {
    const p = found.get(s);
    out[s] = p ? { desc: p.desc, unit: p.unit || "ea", cost: p.cost || 0, list: p.list || 0 } : null;
  }
  return out;
}
