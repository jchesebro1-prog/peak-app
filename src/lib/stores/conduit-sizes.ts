import { getBlob, setBlob } from "@/db/doc-store";
import { getMany } from "@/lib/stores/catalog";
import { isPerLengthUnit } from "@/lib/design/grid-bom";
import type { ConduitSize } from "@/lib/design/conduit-riser/pricing";
import { CONDUIT_SIZES_BLOB, DEFAULT_CONDUIT_SIZES, sanitizeConduitSizes, validateConduitSizeRows } from "@/lib/conduit-sizes";

/**
 * Conduit sizes store (#321): settings blob `conduit_sizes` `{ sizes }`.
 * Reading never writes — an absent `sizes` key is the six seed sizes with no
 * parts; a saved empty list stays empty.
 */
export async function getConduitSizes(): Promise<ConduitSize[]> {
  const raw = await getBlob<Record<string, unknown>>(CONDUIT_SIZES_BLOB, {});
  return Array.isArray(raw.sizes) ? sanitizeConduitSizes(raw.sizes) : DEFAULT_CONDUIT_SIZES.map((s) => ({ ...s }));
}

export type SaveConduitSizesResult = { ok: true; sizes: ConduitSize[] } | { ok: false; error: string };

/** Refuses (writing nothing) any row that would be dropped, a part missing from the live catalog and a part that isn't sold per foot — each by row. */
export async function saveConduitSizes(list: unknown): Promise<SaveConduitSizesResult> {
  const checked = validateConduitSizeRows(list);
  if (!checked.ok) return checked;
  const ids = [...new Set(checked.sizes.flatMap((s) => (s.partId ? [s.partId] : [])))];
  const live = new Map((ids.length ? await getMany(ids) : []).map((p) => [p.sku, p]));
  for (let i = 0; i < checked.sizes.length; i++) {
    const { size, partId } = checked.sizes[i];
    if (!partId) continue;
    const part = live.get(partId);
    if (!part) return { ok: false, error: `${size}: ${partId} is not in the catalog.` };
    if (!isPerLengthUnit(part.unit || "")) return { ok: false, error: `${size}: ${partId} is sold per ${part.unit || "each"}, not per foot — pick a per-foot part.` };
  }
  await setBlob(CONDUIT_SIZES_BLOB, { sizes: checked.sizes });
  return { ok: true, sizes: checked.sizes };
}
