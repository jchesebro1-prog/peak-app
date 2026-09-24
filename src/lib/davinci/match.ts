/**
 * Match a catalog SKU to a DaVinci record (#162).
 *
 * Both sides go through `normalizeSku`, which is why it lives in its own module:
 * production writes bare model numbers, local dev writes `MFR:`-prefixed ones,
 * and DaVinci writes bare model AND part numbers. Measured 2026-09-23 against
 * production: 3,424 of 3,959 ETC rows (86.5%) match.
 */
import { normalizeSku } from "./sku";
import type { DavinciRecord } from "./types";

export function buildIndex(records: readonly DavinciRecord[]): Map<string, DavinciRecord> {
  const idx = new Map<string, DavinciRecord>();
  for (const r of records) {
    for (const m of r.modelNumbers) {
      // First record wins. ETC reuses an identifier across a type and its
      // accessory in a handful of cases; picking the first keeps the result
      // reproducible instead of depending on iteration order downstream.
      if (!idx.has(m)) idx.set(m, r);
    }
  }
  return idx;
}

export function matchSku(sku: string, index: Map<string, DavinciRecord>): DavinciRecord | null {
  const key = normalizeSku(sku);
  if (!key) return null;
  return index.get(key) ?? null;
}
