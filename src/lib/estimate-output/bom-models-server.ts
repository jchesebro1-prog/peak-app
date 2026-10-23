import type { SpecSection } from "@/app/(app)/estimator/types";
import { getManyBySku } from "@/lib/stores/catalog";
import { BOM_MODEL_SKUS_MAX, bomModelPartOf, bomModelSkus, type BomModelParts } from "./bom-models";

/**
 * #365 — the catalog facts the BOM view's models read, for the SKUs given:
 * one batched getManyBySku (renamed SKUs followed, live parts only), keyed by
 * the SKU as requested, model fields only. A SKU the catalog doesn't know is
 * simply absent (the line then prints only its own Model # / MFR P/N).
 */
export async function loadBomModelParts(skus: readonly string[]): Promise<BomModelParts> {
  const want = [...new Set((skus || []).filter((s): s is string => typeof s === "string" && !!s.trim() && s !== "__proto__").map((s) => s.trim()))].slice(0, BOM_MODEL_SKUS_MAX);
  const out: BomModelParts = {};
  if (!want.length) return out;
  const parts = await getManyBySku(want);
  for (const sku of want) {
    const p = parts.get(sku);
    if (p) out[sku] = bomModelPartOf(p);
  }
  return out;
}

/** loadBomModelParts for the printed systems' plain catalog lines. Never
 *  throws: a failed read returns undefined, so the BOM prints descriptions
 *  only (loadKeyProductModels' rule). */
export async function loadBomModelPartsFor(sections: readonly SpecSection[]): Promise<BomModelParts | undefined> {
  try {
    return await loadBomModelParts(bomModelSkus(sections));
  } catch (e) {
    console.warn("[bom] line models unavailable", e instanceof Error ? e.message : e);
    return undefined;
  }
}
