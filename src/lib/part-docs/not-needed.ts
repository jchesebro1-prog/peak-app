import { get as getPart, mergeUpsert } from "@/lib/stores/catalog";
import type { DocNotNeeded, PartDocKind } from "./types";

/**
 * Set or clear a part's "not needed" mark for one kind (#DOC, spec §4 step 2).
 * Server-only. Goes through `mergeUpsert` — never `upsert`, which would wipe
 * every field this write does not carry — and skips SKUs that are not in the
 * catalog, because mergeUpsert would otherwise create a malformed part.
 * Returns how many parts changed.
 */
export async function setDocNotNeeded(skus: readonly string[], kind: PartDocKind, on: boolean): Promise<number> {
  let changed = 0;
  for (const sku of new Set(skus)) {
    const part = await getPart(sku);
    if (!part) continue;
    const current: DocNotNeeded = part.docNotNeeded ?? {};
    if (!!current[kind] === on) continue;
    const next: DocNotNeeded = { ...current };
    if (on) next[kind] = true;
    else delete next[kind];
    await mergeUpsert(sku, { docNotNeeded: next.datasheet || next.specsheet ? next : undefined });
    changed++;
  }
  return changed;
}
