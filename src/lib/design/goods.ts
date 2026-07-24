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

/* ------------------------------ gear weights ------------------------------ */

export type GoodsSize = "small" | "medium" | "large";

export type FixtureCounts = {
  par: number;
  /** Front-of-house. ALWAYS contributes 0 lb to a batten — see electricGearLb. */
  front: number;
  cyc: number;
  side: number;
  automated: number;
};

export type GearDefaults = {
  /** Pounds per fixture, including clamp, cable and safety. */
  fixtureLb: FixtureCounts;
  /** One combined allowance covering cable, raceway and anything else on the
   *  pipe. Jeff wants a single distribution figure, not separate entries. */
  distributionLbPerFt: number;
  /** Acoustic shell CEILING weight per square foot. Towers are floor-supported
   *  and load no batten. */
  shellPsf: number;
};

export const DEFAULT_GEAR: GearDefaults = {
  fixtureLb: { par: 12, front: 18, cyc: 14, side: 18, automated: 45 },
  distributionLbPerFt: 1.5,
  shellPsf: 2.5,
};

/** Per-electric multipliers, mirroring quick/engine.ts compute(). */
const FIX_MUL: Record<GoodsSize, { par: number; side: number; automated: number; cyc: number }> = {
  small: { par: 0.7, side: 0, automated: 0, cyc: 1 },
  medium: { par: 1, side: 0.5, automated: 0.5, cyc: 1.25 },
  large: { par: 1.2, side: 0.75, automated: 0.9, cyc: 1.5 },
};

/**
 * Default fixture counts for ONE electric line.
 *
 * Derived by mirroring the estimator's count math (wUnit = round(PW / 8) times
 * a per-electric multiplier). Counts are safe to reuse in a way the estimator's
 * CURTAIN equations were not, because a count carries no fullness assumption.
 *
 * `front` is always 0: in the estimator, `Front` and `Cyc` are scaled by `wUnit`
 * alone, while `Par`, `Side light` and `Automated` are scaled by `E × wUnit`
 * (src/app/(app)/design/quick/engine.ts:486-490) — Front-of-house fixtures hang
 * on an FOH position, not on a lineset batten.
 */
export function electricCounts(
  d: VenueDims,
  size: GoodsSize = "medium",
  kind: "regular" | "cyc" = "regular"
): FixtureCounts {
  const wUnit = Math.max(1, Math.round(d.proWidthFt / 8));
  const m = FIX_MUL[size] || FIX_MUL.medium;
  if (kind === "cyc") {
    return { par: 0, front: 0, cyc: Math.round(wUnit * m.cyc), side: 0, automated: 0 };
  }
  return {
    par: Math.round(wUnit * m.par),
    front: 0,
    cyc: 0,
    side: Math.round(wUnit * m.side),
    automated: Math.round(wUnit * m.automated),
  };
}

/** Gear pounds on one electric: fixtures plus the distribution allowance.
 *  `front` is skipped unconditionally — FOH positions are not lineset battens. */
export function electricGearLb(
  counts: Partial<FixtureCounts>,
  battenLenFt: number,
  gear: GearDefaults = DEFAULT_GEAR
): number {
  const f = gear.fixtureLb;
  const fixtures =
    (counts.par || 0) * f.par +
    (counts.cyc || 0) * f.cyc +
    (counts.side || 0) * f.side +
    (counts.automated || 0) * f.automated;
  return fixtures + gear.distributionLbPerFt * Math.max(0, battenLenFt);
}

/** Gear pounds on one Shell line — the flown CEILING only.
 *  Acoustic shell TOWERS are floor-supported and load no batten (Jeff). */
export function shellGearLb(
  d: VenueDims,
  shellIntervalFt: number,
  gear: GearDefaults = DEFAULT_GEAR
): number {
  return gear.shellPsf * (d.proWidthFt * Math.max(0, shellIntervalFt));
}
