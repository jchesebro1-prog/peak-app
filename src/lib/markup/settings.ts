/** Settings conversion (#367, spec §5.2) — pure. stores/pricing.ts runs it once per blob under a row lock. */
import { PRICING_BASIS, marginToMarkup, roundMarkupPct } from "./index";

export const BASIS_STAMP = "_pricingBasis";
export const MARGIN_BACKUP = "_marginBackup";

/** The patch that converts one stored rate blob (round to a whole %), or null when it is already stamped.
 *  `pct` = the blob stores whole percents (pricing_rules: 30) rather than fractions (0.30). */
export function markupSettingsPatch(current: Record<string, unknown>, keys: readonly string[], pct: boolean): Record<string, unknown> | null {
  if (current[BASIS_STAMP] === PRICING_BASIS) return null;
  const patch: Record<string, unknown> = { [BASIS_STAMP]: PRICING_BASIS };
  const backup: Record<string, number> = {};
  for (const k of keys) {
    const v = current[k];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    backup[k] = v;
    const r = roundMarkupPct(marginToMarkup(pct ? v / 100 : v));
    patch[k] = pct ? Math.round(r * 100) : r;
  }
  if (Object.keys(backup).length) patch[MARGIN_BACKUP] = backup;
  return patch;
}

/** A rate blob without the stamp and backup keys — what the getters hand to engines (never saved into a quote). */
export function withoutBasisKeys<T extends Record<string, unknown>>(blob: T): T {
  const rest: Record<string, unknown> = { ...blob };
  delete rest[BASIS_STAMP];
  delete rest[MARGIN_BACKUP];
  return rest as T;
}
