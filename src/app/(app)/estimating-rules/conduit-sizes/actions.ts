"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { saveConduitSizes } from "@/lib/stores/conduit-sizes";
import type { ConduitSize } from "@/lib/design/conduit-riser/pricing";
import { isPerLengthUnit } from "@/lib/design/grid-bom";
import { searchCatalog } from "@/app/(app)/estimator/actions";
import type { EquipPartHit } from "@/app/(app)/design/grid/settings/actions";

/** Estimating Rules → Conduit sizes (#321). Admin (manage_users) only; the store re-sanitizes and re-checks the catalog (every part must exist and be sold per foot). */
export async function saveConduitSizesAction(rows: unknown): Promise<{ ok: true; sizes: ConduitSize[] } | { ok: false; error: string }> {
  await requirePerm("manage_users");
  try {
    const r = await saveConduitSizes(rows);
    if (!r.ok) return r;
    revalidatePath("/estimating-rules/conduit-sizes");
    revalidatePath("/design/grid", "layout");
    return { ok: true, sizes: r.sizes };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save the conduit sizes." };
  }
}

/** Part search for the size rows: only per-foot parts (the catalog's `ft` units) are offered. Searches wide, then filters, so the 20 shown are all pickable. */
export async function searchConduitPartsAction(query: string): Promise<{ hits: EquipPartHit[]; total: number }> {
  await requirePerm("manage_users");
  const { hits } = await searchCatalog(String(query ?? ""), "", 300);
  const perFoot = hits.filter((h) => isPerLengthUnit(h.unit || ""));
  return {
    hits: perFoot.slice(0, 20).map((h) => ({ sku: h.sku, desc: h.desc, category: h.category, unit: h.unit, cost: h.cost, list: h.list })),
    total: perFoot.length,
  };
}
