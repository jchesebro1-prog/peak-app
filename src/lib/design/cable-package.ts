/**
 * The Cable Package (#233 late, Jeff 2026-09-27: "based on the number of
 * fixtures selected and then a multiplier factor similar to how we are doing
 * labor"). A QUANTITY step, like the wire pull:
 *
 *   qty = ⌈fixtures × per fixture × tier ×⌉
 *
 * `fixtures` is the total quantity of the Lighting system's fixture lines
 * (LIGHTING_FIXTURE_KEYS — Par, Front, Cyc, Side light, Automated) as the
 * equations emit them; `per fixture` and the tier multipliers are Estimating
 * Rules (wire-labor.ts CableRule). No tier → ×1.0. No fixtures (or 0 per
 * fixture, or Lighting out of scope) → no line. The Equipment map's
 * "Cable Package" row prices the quantity (D303/D304).
 *
 * compute() emits the line at the default rule and the design's own tier;
 * withCablePackage() re-derives it with the live rules at the tier being
 * priced (Quick Design's tiers, a Grid Auto card's Lighting tier).
 *
 * Pure and client-safe: no store or db import.
 */
import type { BomItem, SystemBlock, TierKey } from "@/app/(app)/design/quick/engine";
import { EQUIPMENT_ROW_BY_KEY, isLightingFixtureKey } from "./equipment-vocab";
import { tierMult, type CableRule, type WireLaborRules } from "./wire-labor";

export const CABLE_PACKAGE_KEY = "lighting:cablePackage";

/** A BomItem-shaped line, narrowed to what fixture counting needs. */
export type FixtureLine = { key: string; qty: number; desc?: string };

/**
 * The total quantity of the fixture lines among `items` (anything else is
 * ignored). `qtyOf` picks each line's EFFECTIVE quantity — the designer's
 * typed override when there is one, else the equation's own qty (the
 * default). Quick Design passes the tier's qtyOverrides (keyed by label);
 * Grid Auto passes its per-row qty edits (keyed by row key) — #233 late
 * review: fixture count must reflect what the design actually carries, not
 * only what the equations first emitted.
 */
export function lightingFixtureCount(
  items: ReadonlyArray<FixtureLine>,
  qtyOf: (it: FixtureLine) => number = (it) => it.qty
): number {
  let n = 0;
  for (const it of items) {
    if (!isLightingFixtureKey(it.key)) continue;
    const q = qtyOf(it);
    if (Number.isFinite(q) && q > 0) n += q;
  }
  return n;
}

/** ⌈fixtures × per fixture × tier ×⌉ — 0 when there are no fixtures or the rule is 0. */
export function cablePackageQty(fixtures: number, rule: CableRule | undefined, tier: TierKey | null | undefined): number {
  if (!(fixtures > 0) || !rule || !Number.isFinite(rule.perFixture) || !(rule.perFixture > 0)) return 0;
  // To the thousandth first, so float noise (11.000000000000002) never buys an extra package.
  const raw = Math.round(fixtures * rule.perFixture * tierMult(rule.mult, tier) * 1000) / 1000;
  return Math.ceil(raw);
}

const num = (n: number) => String(Math.round(n * 1000) / 1000);

/** The line's note, so the math is visible: "24 fixtures × 1 × 1.15". */
export function cablePackageNote(fixtures: number, rule: CableRule, tier: TierKey | null | undefined): string {
  return `${num(fixtures)} fixture${fixtures === 1 ? "" : "s"} × ${num(rule.perFixture)} × ${num(tierMult(rule.mult, tier))}`;
}

/** The Cable Package line for a Lighting system's items, or null when it has none. */
export function cablePackageItem(
  items: ReadonlyArray<FixtureLine>,
  rule: CableRule,
  tier: TierKey | null | undefined,
  qtyOf: (it: FixtureLine) => number = (it) => it.qty
): BomItem | null {
  const fixtures = lightingFixtureCount(items, qtyOf);
  const qty = cablePackageQty(fixtures, rule, tier);
  if (!(qty > 0)) return null;
  const def = EQUIPMENT_ROW_BY_KEY.get(CABLE_PACKAGE_KEY);
  return {
    key: CABLE_PACKAGE_KEY,
    desc: def ? def.label : CABLE_PACKAGE_KEY,
    unit: def ? def.unit : "ea",
    qty,
    cost: 0,
    price: 0,
    note: cablePackageNote(fixtures, rule, tier),
  };
}

/**
 * The Cable Package step: the Lighting system's line re-derived from its
 * fixture lines with `rules.cable` at `tier`, replacing any it already had
 * (in place; appended when it had none). Runs before the wire-pull step and
 * map pricing. A system it doesn't change comes back as the same object.
 *
 * `qtyOf` (default: the equation's own qty) lets a caller count fixtures by
 * their EFFECTIVE quantity — the designer's typed qty override, when there
 * is one — rather than the raw equation output (#233 late review: Quick
 * Design passes its qtyOverrides, Grid Auto its per-row qty edits).
 */
export function withCablePackage(
  systems: SystemBlock[],
  tier: TierKey | null | undefined,
  rules: WireLaborRules,
  qtyOf: (it: FixtureLine) => number = (it) => it.qty
): SystemBlock[] {
  return systems.map((sys) => {
    if (sys.key !== "lighting") return sys;
    const at = sys.items.findIndex((it) => it.key === CABLE_PACKAGE_KEY);
    const cur = at >= 0 ? sys.items[at] : undefined;
    const next = sys.on ? cablePackageItem(sys.items, rules.cable, tier, qtyOf) : null;
    if (!next) return cur ? { ...sys, items: sys.items.filter((it) => it.key !== CABLE_PACKAGE_KEY) } : sys;
    if (cur && cur.qty === next.qty && cur.note === next.note && sys.items.filter((it) => it.key === CABLE_PACKAGE_KEY).length === 1) return sys;
    const kept = sys.items.filter((it) => it.key !== CABLE_PACKAGE_KEY);
    const items = at >= 0 ? [...kept.slice(0, at), next, ...kept.slice(at)] : [...kept, next];
    return { ...sys, items };
  });
}
