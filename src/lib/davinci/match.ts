/**
 * Match a catalog SKU to a DaVinci record (#162).
 *
 * Both sides go through `normalizeSku`, which is why it lives in its own module:
 * production writes bare model numbers, local dev writes `MFR:`-prefixed ones,
 * and DaVinci writes bare model AND part numbers. Measured 2026-09-23 against
 * production: 2,917 of 3,959 ETC rows (73.7%) match, of which 2,636 carry ports
 * and 2,872 carry document links. That's lower than a raw type-count match
 * because `extract.ts` drops types with neither ports nor documents (lens
 * tubes, back boxes, accessories) before the index is ever built — they have
 * nothing to contribute, so excluding them is correct, not a shortfall.
 *
 * A SKU match is NOT on its own a licence to write: the key is the normalized
 * identifier and nothing else, so `Draper:450` and `Symetrix:4.50%` both land
 * on ETC's `450` (Source Four 50 Degree). The manufacturer gate that makes the
 * match safe lives in `catalog-davinci-apply.planEnrichment`, not here.
 */
import { normalizeSku } from "./sku";
import type { DavinciRecord } from "./types";

/**
 * Is `candidate` a better owner of a shared identifier than `current`?
 *
 * 440 of the 13,633 distinct identifiers are claimed by more than one type —
 * not "a handful". 104 of those collisions differ in their port sets, and 25
 * resolved under plain first-wins to a record with NO ports while an
 * alternative had some (`IQCI` → a 0-port record over a 24-port one;
 * `S4WRDPAR` → 0 ports over 3, the loser literally named "Source 4WRD Color
 * PAR" and discontinued). Order in `library.json` is not meaningful, so the
 * tie-break is explicit: live type first, then the one that actually carries
 * ports, then first-wins so the result stays reproducible either way.
 */
function outranks(candidate: DavinciRecord, current: DavinciRecord): boolean {
  if (candidate.active !== current.active) return candidate.active;
  return candidate.ports.length > current.ports.length;
}

export type DavinciIndex = {
  index: Map<string, DavinciRecord>;
  /** Identifiers claimed by more than one type — printed by davinci:extract. */
  collisions: number;
};

export function buildIndexWithStats(records: readonly DavinciRecord[]): DavinciIndex {
  const index = new Map<string, DavinciRecord>();
  const collided = new Set<string>();
  for (const r of records) {
    for (const m of r.modelNumbers) {
      const current = index.get(m);
      if (!current) {
        index.set(m, r);
        continue;
      }
      collided.add(m);
      if (outranks(r, current)) index.set(m, r);
    }
  }
  return { index, collisions: collided.size };
}

export function buildIndex(records: readonly DavinciRecord[]): Map<string, DavinciRecord> {
  return buildIndexWithStats(records).index;
}

export function matchSku(sku: string, index: Map<string, DavinciRecord>): DavinciRecord | null {
  const key = normalizeSku(sku);
  if (!key) return null;
  return index.get(key) ?? null;
}
