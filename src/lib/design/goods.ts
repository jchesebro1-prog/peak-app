import type { VenueDims } from "./venue-dims";

/**
 * Peak's soft-goods geometry, as one table (spec §1).
 *
 * EVERY dimension here is FINISHED. Fullness and cut allowance are applied
 * exactly once, downstream, by computeSetWeight(). Do not pre-fatten anything.
 *
 * These rules were authored from Jeff's doctrine, NOT lifted from the design
 * estimator. The estimator's curtain areas have no fullness model at all —
 * they are lump pricing surfaces and cannot be converted to finished sizes.
 */

export type GoodsTier = "good" | "better" | "best";

export type DrapeRule = {
  /** Catalog SKU — resolves to both price and weight. */
  fabricSku: string;
  /** Finished width, ft (per panel when qty > 1). */
  w: number;
  /** Finished height, ft. */
  h: number;
  /** Percent. 50 for velour, 0 for the cyc. */
  fullness: number;
  /** Panels on the line. 2 = a travelling pair. */
  qty: number;
  /** TRACKS name, or null when the goods tie directly to pipe. */
  track: string | null;
  /** CHAINS name. "None" for a pocket bottom. */
  chain: string;
};

/** Exact names from steel.ts TRACKS / CHAINS — these are lookup keys, not labels. */
export const TRACK_TRAVELER = "Standard traveler track (~1.75 lb/ft)";
export const CHAIN_JACK = "Jack chain ~0.14 lb/ft";
export const CHAIN_NONE = "None";

/** Per-tier fabric SKU by drape role. Mirrors tierDefsDefault().fabrics in
 *  quick/engine.ts, plus a cyc role the estimator does not have. All three
 *  velour roles point at the same SKU per tier today; the separate keys exist
 *  so a cheaper rear blackout can be specced later without touching the main. */
const TIER_FABRIC: Record<GoodsTier, Record<string, string>> = {
  good: { draw: "RB-EN-16", legs: "RB-EN-16", border: "RB-EN-16", fullstage: "RB-EN-16", cyc: "RB-MUS" },
  better: { draw: "RB-MARVEL", legs: "RB-MARVEL", border: "RB-MARVEL", fullstage: "RB-MARVEL", cyc: "RB-MUS" },
  best: { draw: "RB-MV-MN", legs: "RB-MV-MN", border: "RB-MV-MN", fullstage: "RB-MV-MN", cyc: "RB-MUS" },
};

/**
 * The finished-dimension recipe for one generated line.
 * Returns null for line types that carry no soft goods — Electric, Shell and
 * General Purpose. Their weight comes from gear, not fabric.
 */
export function drapeRule(
  lineType: string,
  d: VenueDims,
  tier: GoodsTier
): DrapeRule | null {
  const PW = d.proWidthFt;
  const PH = d.proHeightFt;
  const fab = TIER_FABRIC[tier] || TIER_FABRIC.better;

  // A travelling pair: each panel covers half the opening plus 2 ft of centre
  // overlap, so the pair finishes at PW + 4.
  const pair = (sku: string): DrapeRule => ({
    fabricSku: sku,
    w: PW / 2 + 2,
    h: PH + 1,
    fullness: 50,
    qty: 2,
    track: TRACK_TRAVELER,
    chain: CHAIN_JACK,
  });

  switch (lineType) {
    case "Draw":
    case "Midstage Draw":
      return pair(fab.draw);
    // Jeff: "Rear is a draw curtain typically. Same as the mid."
    case "Rear":
      return pair(fab.fullstage);
    case "Legs":
      return { fabricSku: fab.legs, w: 6, h: PH + 1, fullness: 50, qty: 2, track: null, chain: CHAIN_JACK };
    case "Border":
      return { fabricSku: fab.border, w: PW, h: 5, fullness: 50, qty: 1, track: null, chain: CHAIN_JACK };
    // The cyc is the ONLY line at PH exactly (no header overlap) and the ONLY
    // one at 0% fullness — it hangs flat. Inheriting the schedule's 50%
    // default would run it roughly 50% heavy.
    case "CYC":
      return { fabricSku: fab.cyc, w: PW, h: PH, fullness: 0, qty: 1, track: null, chain: CHAIN_NONE };
    default:
      return null;
  }
}
