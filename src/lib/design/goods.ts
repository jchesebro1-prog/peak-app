import type { VenueDims } from "./venue-dims";
import { fabByName, fabricFromPart, type Fabric, type WeightLine } from "./steel";

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

/** Fabric per drape TYPE, with the tier as a grade shifter. The `better` row is
 *  Peak's real spec (Rose Brand quote 423939). Drives both weight and price. */
const FABRIC_BY_TYPE_TIER: Record<string, Record<GoodsTier, string>> = {
  Draw: { good: "RB-EN-22", better: "RB-CHAR-25", best: "RB-MV-MN" },
  "Midstage Draw": { good: "RB-EN-22", better: "RB-CHAR-25", best: "RB-MV-MN" },
  Rear: { good: "RB-EN-22", better: "RB-CHAR-25", best: "RB-MV-MN" },
  Border: { good: "RB-EN-22", better: "RB-CHAR-25", best: "RB-MV-MN" },
  Legs: { good: "RB-EN-16", better: "RB-EN-22", best: "RB-CHAR-25" },
  CYC: { good: "RB-MUS", better: "RB-MUS", best: "RB-MUS" },
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

  // Fabric for a given drape TYPE at the requested tier, falling back to that
  // type's `better` row (Peak's real spec) if an unrecognized tier ever
  // arrives — e.g. an unchecked `as GoodsTier` cast from a form value.
  const fabricFor = (type: string): string => {
    const row = FABRIC_BY_TYPE_TIER[type];
    return row[tier] || row.better;
  };

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
      return pair(fabricFor(lineType));
    // Jeff: "Rear is a draw curtain typically. Same as the mid."
    case "Rear":
      return pair(fabricFor("Rear"));
    case "Legs":
      return { fabricSku: fabricFor("Legs"), w: 6, h: PH + 1, fullness: 50, qty: 2, track: null, chain: CHAIN_JACK };
    case "Border":
      return { fabricSku: fabricFor("Border"), w: PW, h: 5, fullness: 50, qty: 1, track: null, chain: CHAIN_JACK };
    // The cyc is the ONLY line at PH exactly (no header overlap) and the ONLY
    // one at 0% fullness — it hangs flat. Inheriting the schedule's 50%
    // default would run it roughly 50% heavy.
    case "CYC":
      return { fabricSku: fabricFor("CYC"), w: PW, h: PH, fullness: 0, qty: 1, track: null, chain: CHAIN_NONE };
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

/* -------------------------- rule -> WeightLine join -------------------------- */

/** Shape of a catalog fabric row, narrowed to what goods geometry needs. */
export type GoodsFabric = {
  sku: string;
  desc: string;
  oz?: number;
  ozBasis?: "lin-yd" | "sq-yd";
  boltWidthIn?: number;
};

/**
 * Convert a DrapeRule into the field subset computeSetWeight() consumes.
 *
 * `full` is set explicitly on every line rather than left to inherit the
 * schedule default — the cyc MUST arrive at 0 and inheriting 50 would run it
 * roughly 50% heavy.
 */
export function ruleToWeightLine(
  rule: DrapeRule,
  fabrics: GoodsFabric[]
): {
  fab?: string;
  fabResolved?: Fabric;
  w: number;
  h: number;
  full: number;
  qty: number;
  track?: string;
  chain: string;
} {
  const part = fabrics.find((f) => f.sku === rule.fabricSku);
  return {
    // `fab` is the human-readable label only. The WEIGHT comes from
    // fabResolved — catalog descriptions do not match FABLIB names, so a
    // name-only lookup silently weighs zero (see task 2 step 6).
    fab: part ? part.desc : undefined,
    fabResolved: part ? fabricFromPart(part) || undefined : undefined,
    w: rule.w,
    h: rule.h,
    full: rule.fullness,
    qty: rule.qty,
    track: rule.track || undefined,
    chain: rule.chain,
  };
}

/**
 * Effective `fab` / `fabResolved` for one schedule line, merging the
 * rule-derived base (ruleToWeightLine's output, or a gear-only base for
 * Electric/Shell lines) with the user's hand-entered load override.
 *
 * computeSetWeight() (steel.ts) prefers `fabResolved` over a `fab` name
 * lookup. A rule-derived line's `fabResolved` comes from the CATALOG
 * (ruleToWeightLine), so a naive `{ ...base, ...load }` spread lets that
 * catalog `fabResolved` ride through untouched even when `load.fab`
 * overrides the label — the override becomes a silent no-op on weight (F1).
 * When the line is rule-derived and `fab` was overridden, re-resolve
 * `fabResolved` from the CATALOG list against the new value so the weight
 * tracks what the dropdown shows. A catalog miss clears `fabResolved`
 * (never keeps the stale rule value) so `fabByName(fab)` can govern
 * instead, same as any non-catalog line. Non-drape lines (no `rule`) and
 * lines with no override just carry the ordinary merge precedence through
 * unchanged.
 *
 * Pure — both the lineset-builder `rows` memo and its regression test call
 * this directly, so a broken/reverted merge fails the test, not just a
 * hand-copied reimplementation of it.
 */
export function mergeLineFabric(
  base: Partial<WeightLine>,
  load: Partial<WeightLine> | undefined,
  rule: DrapeRule | null,
  fabrics: GoodsFabric[]
): Pick<WeightLine, "fab" | "fabResolved"> {
  const fab = load?.fab !== undefined ? load.fab : base.fab;
  if (rule && load?.fab !== undefined) {
    const part = fabrics.find((f) => f.desc === load.fab);
    return { fab, fabResolved: (part && fabricFromPart(part)) || undefined };
  }
  return { fab, fabResolved: load?.fabResolved !== undefined ? load.fabResolved : base.fabResolved };
}

/* ---------------------- fabric-resolution diagnostics ---------------------- */

/** The "no fabric" choice in the load editor's fabric select. Stored as the
 *  line's `fab`, so it has to be recognizable here too. */
export const FAB_NONE = ", none, ";

/**
 * Why a line's fabric failed to resolve. `null` means it resolved fine.
 *
 * The kinds are deliberately distinct because they need DIFFERENT fixes:
 * `no-catalog` is "seed/import the Fabric category", `no-weight` is "this one
 * part is missing its oz", `missing-part` is "this SKU isn't in the catalog".
 * Collapsing them into one "fabric problem" would send Jeff to the wrong place.
 */
export type FabricIssue = {
  kind: "no-catalog" | "missing-part" | "no-weight" | "unrecognized" | "cleared";
  /** Short chip text for the schedule row. */
  short: string;
  /** Full sentence: the cause AND the fix. */
  message: string;
};

/**
 * Diagnose a line whose weight math will refuse to resolve — hard-fail,
 * punch #64: `computeSetWeight` (steel.ts) reports `fabricUnresolved: true`
 * and masks goods AND track weight to `null` rather than a plausible-looking
 * 0, so this is what explains the "unavailable" to Jeff.
 *
 * `expectsFabric` mirrors computeSetWeight()'s own `expectsFabricWeight()`
 * exactly (w>0 && h>0 alone, no `line.fab` requirement): a custom line with a
 * real finished footprint typed in expects a resolvable fabric too, even
 * before anything's been picked in the fabric select, and the two functions
 * must agree or a line can end up "unavailable" with no explanation on
 * screen. `!!rule` is kept as an explicit OR for a rule-derived line whose
 * `w`/`h` haven't landed on `line` yet (defensive; every real drapeRule()
 * output does carry w>0 && h>0).
 *
 * Resolution order mirrors computeSetWeight() exactly, `fabResolved` first,
 * then a FABLIB name lookup, so this never warns about a line that actually
 * weighs. It NEVER invents a fallback weight: the point is to make the gap
 * visible, not to paper over it.
 */
export function lineFabricIssue(
  line: Pick<WeightLine, "fab" | "fabResolved" | "w" | "h">,
  rule: DrapeRule | null,
  fabrics: GoodsFabric[]
): FabricIssue | null {
  // A gear-only line (Electric/Shell/General Purpose — no finished footprint)
  // is supposed to carry no goods, nothing to warn about.
  const expectsFabric = !!rule || ((line.w || 0) > 0 && (line.h || 0) > 0);
  if (!expectsFabric) return null;
  if (line.fabResolved) return null;
  if (line.fab && line.fab !== FAB_NONE && fabByName(line.fab)) return null;

  const goodsAndTrack = "goods and track weight can't be calculated";

  if (line.fab === FAB_NONE)
    return {
      kind: "cleared",
      short: "no fabric selected",
      message: `Fabric is set to "${FAB_NONE}" on a drape line, it contributes no goods and no track weight. Pick a fabric to weigh it.`,
    };

  if (fabrics.length === 0)
    return {
      kind: "no-catalog",
      short: "no catalog fabric",
      message: `There are no Fabric parts in the catalog${rule ? ` (this line wants ${rule.fabricSku})` : ""}, so ${goodsAndTrack} on any drape line. Import or seed the catalog's Fabric category (Catalog → category "Fabric"), each part carrying oz + basis + bolt width.`,
    };

  if (line.fab) {
    const picked = fabrics.find((f) => f.desc === line.fab);
    return picked
      ? {
          kind: "no-weight",
          short: "fabric has no oz",
          message: `Catalog fabric "${picked.desc}" (${picked.sku}) has no oz/yd², ${goodsAndTrack}. Add oz, basis and bolt width to that catalog part, or pick a fabric that has them.`,
        }
      : {
          kind: "unrecognized",
          short: "fabric not recognized",
          message: `Fabric "${line.fab}" is in neither the parts catalog nor the built-in fabric library, ${goodsAndTrack}. Pick a listed fabric.`,
        };
  }

  const sku = rule?.fabricSku || "?";
  const part = fabrics.find((f) => f.sku === sku);
  return part
    ? {
        kind: "no-weight",
        short: "fabric has no oz",
        message: `Catalog fabric "${part.desc}" (${part.sku}) has no oz/yd², ${goodsAndTrack}. Add oz, basis and bolt width to that catalog part, or pick a fabric that has them.`,
      }
    : {
        kind: "missing-part",
        short: `no catalog part ${sku}`,
        message: `The catalog has Fabric parts but none with SKU ${sku}, which is what this line's fabric tier asks for, ${goodsAndTrack}. Add that SKU to the catalog, or pick another fabric on this line.`,
      };
}
