/**
 * Estimator bonuses (spec docs/superpowers/specs/2026-10-12-estimator-bonuses-design.md).
 * Pure: no I/O. The only place the 5% package / 2% estimator math lives.
 */
import type { SpecItem, SpecSection } from "@/app/(app)/estimator/types";
import { isSystemLine, lineExtSellOf, round2, systemFreight, validSellOverride } from "@/app/(app)/estimator/pricing";
import {
  BONUS_ESTIMATOR_PCT,
  BONUS_PACKAGE_PCT,
  isBonusItem,
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

export function packageBonus(sec: SpecSection): BonusAmount | null {
  if (!hasLaborLine(sec)) return null;
  const lines = baseLines(sec);
  const cost = lines.reduce((a, it) => a + it.qty * it.cost, 0);
  const sell = lines.reduce((a, it) => a + lineExtSellOf(it), 0);
  if (!Number.isFinite(cost) || !Number.isFinite(sell) || cost <= 0) return null;
  const bCost = round2(cost * BONUS_PACKAGE_PCT);
  if (bCost <= 0) return null;
  return { cost: bCost, sell: round2(bCost * (sell / cost)) };
}

export function estimatorBonus(sec: SpecSection, pkg: BonusAmount | null = packageBonus(sec)): BonusAmount | null {
  const typed = validSellOverride(sec.sellOverride);
  let s: number;
  if (typed != null) {
    // A typed sell on a system with no base lines figures nothing (M1).
    if (!baseLines(stripBonusLines(sec)).length) return null;
    s = round2((typed * BONUS_ESTIMATOR_PCT) / (1 + BONUS_ESTIMATOR_PCT));
  } else {
    const stripped = stripBonusLines(sec);
    const p = baseLines(stripped).reduce((a, it) => a + lineExtSellOf(it), 0) + (pkg ? pkg.sell : 0) + systemFreight(stripped);
    if (!Number.isFinite(p)) return null;
    s = round2(p * BONUS_ESTIMATOR_PCT);
  }
  return s > 0 ? { cost: s, sell: s } : null;
}

function packageLine(secId: string, a: BonusAmount, id: number): SpecItem {
  return {
    id, sku: "BON-PKG-" + secId, desc: "Package bonus — 5% of system cost",
    qty: 1, unit: "lot", cost: a.cost, price: a.sell, labor: true, noFreight: true, bonus: "package",
  };
}

function estimatorLine(secId: string, a: BonusAmount, id: number): SpecItem {
  return {
    id, sku: "BON-EST-" + secId, desc: "Estimator bonus — 2% of system price",
    qty: 1, unit: "lot", cost: a.sell, price: a.sell, noFreight: true, bonus: "estimator",
  };
}

const LINE_KEYS = ["id", "sku", "desc", "qty", "unit", "cost", "price", "labor", "noFreight", "bonus"] as const;

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

export function sectionWithBonusLines(sec: SpecSection, nextId: () => number): SpecSection {
  const stripped = stripBonusLines(sec);
  const pkg = packageBonus(stripped);
  const est = estimatorBonus(stripped, pkg);
  const prevPkg = sec.items.find(isPackageBonusItem);
  const prevEst = sec.items.find(isEstimatorBonusItem);
  const add: SpecItem[] = [];
  if (pkg) add.push(packageLine(sec.id, pkg, prevPkg ? prevPkg.id : nextId()));
  if (est) add.push(estimatorLine(sec.id, est, prevEst ? prevEst.id : nextId()));
  const items = [...stripped.items, ...add];
  return sameItems(sec.items, items) ? sec : { ...sec, items };
}

export function withBonusLines(sections: SpecSection[], nextId: () => number): SpecSection[] {
  let changed = false;
  const out = sections.map((sec) => {
    const n = sectionWithBonusLines(sec, nextId);
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

export function bonusRulesApply(
  q: { source?: string | null; quoteType?: string | null; status?: string | null },
  sections: SpecSection[],
): boolean {
  if (!isBonusEligibleQuote(q)) return false;
  if (q.status === "won" || q.status === "lost") return false;
  if (!q.status || q.status === "draft") return true;
  return sections.some((s) => s.items.some(isBonusItem));
}
