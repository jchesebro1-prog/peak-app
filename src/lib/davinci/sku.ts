/**
 * The one SKU normalizer for DaVinci matching (#162).
 *
 * Peak's two catalogs disagree on SKU format: local dev writes a
 * manufacturer-prefixed id (`ETC:ION XE 2K-US`, the shape `scripts/import-catalog.ts`
 * produces), production writes the bare model number (`ION XE 2K-US`, the shape the
 * dealer-sheet importer produces). DaVinci writes bare model and part numbers.
 * Matching literally would work against production and silently miss every row in
 * dev, which is where this feature is developed — so the prefix comes off first.
 *
 * Extract and match MUST share this function. `scripts/daylite-ids.ts` exists for
 * the same reason: an id convention duplicated in two places drifts, and the drift
 * is invisible until a whole import matches nothing.
 */
export function normalizeSku(s: string): string {
  const raw = String(s ?? "").trim();
  // Drop a leading `MFR:` segment only — a colon later in the string is part of
  // the identifier and must survive into the key.
  const i = raw.indexOf(":");
  const body = i >= 0 ? raw.slice(i + 1) : raw;
  return body.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
