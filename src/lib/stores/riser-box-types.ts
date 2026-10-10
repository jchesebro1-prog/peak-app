import { getBlob, setBlob } from "@/db/doc-store";
import { BRAY_BOX_TYPES } from "@/lib/design/conduit-riser/tables";
import type { CRBoxType } from "@/lib/design/conduit-riser/input";
import { RISER_BOX_TYPES_BLOB, sanitizeBoxTypes } from "@/lib/riser-box-types";

/**
 * Riser box types store (#321): settings blob `riser_box_types`
 * `{ types: CRBoxType[] }`. Reading never writes — an absent `types` key is
 * Bray's list; a saved empty list stays empty.
 */
export async function getRiserBoxTypes(): Promise<CRBoxType[]> {
  const raw = await getBlob<Record<string, unknown>>(RISER_BOX_TYPES_BLOB, {});
  return Array.isArray(raw.types) ? sanitizeBoxTypes(raw.types) : BRAY_BOX_TYPES.map((t) => ({ ...t }));
}

export async function saveRiserBoxTypes(list: unknown): Promise<CRBoxType[]> {
  const clean = sanitizeBoxTypes(list);
  await setBlob(RISER_BOX_TYPES_BLOB, { types: clean });
  return clean;
}
