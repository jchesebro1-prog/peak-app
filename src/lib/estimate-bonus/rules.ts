/**
 * Estimator bonuses (spec docs/superpowers/specs/2026-10-12-estimator-bonuses-design.md).
 * Pure: no I/O. The only place the 5% package / 2% estimator math lives.
 */
import type { SpecItem, SpecSection } from "@/app/(app)/estimator/types";
import { isSystemLine, lineExtSellOf, round2, systemFreight, validSellOverride } from "@/app/(app)/estimator/pricing";
import {
  DEFAULT_BONUS_RATES,
  isBonusItem,
  lineBonusPct,
  type BonusRates,
  isEstimatorBonusItem,
  isLegacyLaborBonusItem,
  isPackageBonusItem,
} from "./flags";

export type BonusAmount = { cost: number; sell: number };

const isAnyBonus = (it: SpecItem) => isBonusItem(it) || isLegacyLaborBonusItem(it);

/** The system with every bonus line (new and legacy) removed. */
export function stripBonusLines(sec: SpecSection): SpecSection {
  return sec.items.some(isAnyBonus) ? { ...sec, items: sec.items.filter((it) => !isAnyBonus(it)) } : sec;
}

/** In-total, non-option, non-bonus lines — the base both bonuses are figured on. */
function baseLines(sec: SpecSection): SpecItem[] {
  return sec.items.filter((it) => isSystemLine(it) && !isAnyBonus(it));
}

export function hasLaborLine(sec: SpecSection): boolean {
  const lines = baseLines(sec);
  if (!lines.length) return false;
  return sec.kind === "labor" || lines.some((it) => it.labor === true);
}

/** Spec "Bonus not figured — check line costs": an in-total line with a
 *  non-finite qty / cost / price, so the bonus lines can't be figured. */
export function bonusNotFigured(sec: SpecSection): boolean {
  return baseLines(stripBonusLines(sec)).some(
    (it) => !Number.isFinite(it.qty) || !Number.isFinite(it.cost) || !Number.isFinite(it.price)
  );
}

export function packageBonus(sec: SpecSection, pct: number = DEFAULT_BONUS_RATES.packagePct): BonusAmount | null {
  if (!hasLaborLine(sec)) return null;
  const lines = baseLines(sec);
  const cost = lines.reduce((a, it) => a + it.qty * it.cost, 0);
  const sell = lines.reduce((a, it) => a + lineExtSellOf(it), 0);
  if (!Number.isFinite(cost) || !Number.isFinite(sell) || cost <= 0) return null;
  const bCost = round2(cost * pct);
  if (bCost <= 0) return null;
  return { cost: bCost, sell: round2(bCost * (sell / cost)) };
}

export function estimatorBonus(sec: SpecSection, pkg: BonusAmount | null = packageBonus(sec), pct: number = DEFAULT_BONUS_RATES.estimatorPct): BonusAmount | null {
  const typed = validSellOverride(sec.sellOverride);
  let s: number;
  if (typed != null) {
    // A typed sell on a system with no base lines figures nothing (M1).
    if (!baseLines(stripBonusLines(sec)).length) return null;
    s = round2((typed * pct) / (1 + pct));
  } else {
    const stripped = stripBonusLines(sec);
    const p = baseLines(stripped).reduce((a, it) => a + lineExtSellOf(it), 0) + (pkg ? pkg.sell : 0) + systemFreight(stripped);
    if (!Number.isFinite(p)) return null;
    s = round2(p * pct);
  }
  return s > 0 ? { cost: s, sell: s } : null;
}

/** "5" / "2.5" — a rate as the line text prints it. */
const pctText = (pct: number) => String(Math.round(pct * 10000) / 100);

/** `bonusPct` rides on the line only when the rate isn't the default — a default-rate line stays byte-identical. */
function packageLine(secId: string, a: BonusAmount, id: number, pct: number): SpecItem {
  return {
    id, sku: "BON-PKG-" + secId, desc: `Package bonus — ${pctText(pct)}% of system cost`,
    qty: 1, unit: "lot", cost: a.cost, price: a.sell, labor: true, noFreight: true, bonus: "package",
    ...(pct !== DEFAULT_BONUS_RATES.packagePct ? { bonusPct: pct } : {}),
  };
}

function estimatorLine(secId: string, a: BonusAmount, id: number, pct: number): SpecItem {
  return {
    id, sku: "BON-EST-" + secId, desc: `Estimator bonus — ${pctText(pct)}% of system price`,
    qty: 1, unit: "lot", cost: a.sell, price: a.sell, noFreight: true, bonus: "estimator",
    ...(pct !== DEFAULT_BONUS_RATES.estimatorPct ? { bonusPct: pct } : {}),
  };
}

const LINE_KEYS = ["id", "sku", "desc", "qty", "unit", "cost", "price", "labor", "noFreight", "bonus", "bonusPct"] as const;

function sameItems(a: SpecItem[], b: SpecItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (!isBonusItem(a[i]) || !isBonusItem(b[i])) return false;
    // A bonus line must carry exactly the canonical keys — an extra key
    // (extSellOverride, option…) means it was tampered with.
    if (Object.keys(a[i]).length !== Object.keys(b[i]).length) return false;
    for (const k of LINE_KEYS) if (a[i][k] !== b[i][k]) return false;
  }
  return true;
}

export function sectionWithBonusLines(sec: SpecSection, nextId: () => number, rates: BonusRates = DEFAULT_BONUS_RATES): SpecSection {
  const stripped = stripBonusLines(sec);
  const pkg = packageBonus(stripped, rates.packagePct);
  const est = estimatorBonus(stripped, pkg, rates.estimatorPct);
  const prevPkg = sec.items.find(isPackageBonusItem);
  const prevEst = sec.items.find(isEstimatorBonusItem);
  const add: SpecItem[] = [];
  if (pkg) add.push(packageLine(sec.id, pkg, prevPkg ? prevPkg.id : nextId(), rates.packagePct));
  if (est) add.push(estimatorLine(sec.id, est, prevEst ? prevEst.id : nextId(), rates.estimatorPct));
  const items = [...stripped.items, ...add];
  return sameItems(sec.items, items) ? sec : { ...sec, items };
}

export function withBonusLines(sections: SpecSection[], nextId: () => number, rates: BonusRates = DEFAULT_BONUS_RATES): SpecSection[] {
  let changed = false;
  const out = sections.map((sec) => {
    const n = sectionWithBonusLines(sec, nextId, rates);
    if (n !== sec) changed = true;
    return n;
  });
  return changed ? out : sections;
}

export function idCounterFrom(sections: SpecSection[]): () => number {
  let n = 0;
  for (const s of sections) for (const it of s.items) if (typeof it.id === "number" && it.id > n) n = it.id;
  return () => ++n;
}

export function isBonusEligibleQuote(q: { source?: string | null; quoteType?: string | null }): boolean {
  const t = q.quoteType || "system"; // "" counts as absent
  if (t !== "system") return false;
  const s = q.source || "";
  return !s.startsWith("portal") && s !== "grid";
}

/**
 * Jeff 2026-10-15 #19 — the rates a quote's bonus lines are figured at: a
 * draft (or a new estimate) takes Estimating Rules' current `settingsRates`;
 * any other status keeps what its lines already carry (`bonusPct`, else the
 * default they were built at), so a sent / won / lost quote never re-prices
 * when the rates change. Pure.
 */
export function bonusRatesFor(status: string | null | undefined, sections: SpecSection[], settingsRates: BonusRates = DEFAULT_BONUS_RATES): BonusRates {
  if (!status || status === "draft") return settingsRates;
  let pkg: SpecItem | undefined;
  let est: SpecItem | undefined;
  for (const s of sections) for (const it of s.items) {
    if (!pkg && isPackageBonusItem(it)) pkg = it;
    if (!est && isEstimatorBonusItem(it)) est = it;
  }
  return { packagePct: pkg ? lineBonusPct(pkg) : DEFAULT_BONUS_RATES.packagePct, estimatorPct: est ? lineBonusPct(est) : DEFAULT_BONUS_RATES.estimatorPct };
}

export function bonusRulesApply(
  q: { source?: string | null; quoteType?: string | null; status?: string | null },
  sections: SpecSection[],
): boolean {
  if (!isBonusEligibleQuote(q)) return false;
  if (q.status === "won" || q.status === "lost") return false;
  if (!q.status || q.status === "draft") return true;
  return sections.some((s) => s.items.some(isBonusItem));
}
