import { groupRowsByManufacturer, type ManufacturerGroup } from "@/lib/catalog-import-guard";
import type { PreparedRow } from "./parse";

/** #132 — per-manufacturer groups of a prepared catalog table (valid rows only —
 *  rows without a manufacturer are already invalid and never written). Used by
 *  `actions.ts` (commit) and `controls.tsx` (live preview) so the two can never
 *  disagree about which rows a manufacturer check covers. */
export function catalogGroups(rows: PreparedRow[]): ManufacturerGroup[] {
  return groupRowsByManufacturer(
    rows.filter((r) => r.valid).map((r) => ({ mfr: String(r.values.mfr ?? ""), sku: String(r.values.sku ?? "") }))
  );
}
