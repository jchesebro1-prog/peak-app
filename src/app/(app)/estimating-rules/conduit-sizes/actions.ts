"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { saveConduitSizes } from "@/lib/stores/conduit-sizes";
import type { ConduitSize } from "@/lib/design/conduit-riser/pricing";
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

/** Part search for the size rows: only per-foot parts (the catalog's `ft` units) are offered. The unit filter runs inside the catalog query, before the 20-hit cap, so a broad query ("emt") still finds per-foot parts and `total` counts per-foot matches. */
export async function searchConduitPartsAction(query: string): Promise<{ hits: EquipPartHit[]; total: number }> {
  await requirePerm("manage_users");
  const { hits, total } = await searchCatalog(String(query ?? ""), "", 20, true);
  return {
    hits: hits.map((h) => ({ sku: h.sku, desc: h.desc, category: h.category, unit: h.unit, cost: h.cost, list: h.list })),
    total,
  };
}
