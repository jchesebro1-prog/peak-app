import { computeLabor, lineExtSellOf, round2, type RateFn } from "@/app/(app)/estimator/pricing";
import type { SpecSection } from "@/app/(app)/estimator/types";

/**
 * Estimator Phase 4 (spec §11.2) — the Customer review step's internal Labor
 * table. PURE: no server imports, nothing is written. Reads the saved systems
 * (sections) and a live labor-rate function.
 *
 * Hours for one configured labor group (`SpecSection.laborGroups[id].draft`,
 * priced by `computeLabor`):
 *
 *     hours = Σ mobs (MobCalc.reg + MobCalc.otHrs) + pmHrs + shopHrs + drfHrs
 *
 * `MobCalc.reg` is the mobilization's straight-time man-hours INCLUDING the
 * supervision hours (`supHrs` is the part of `reg` billed at the -SUP rate —
 * `installerHrs = reg − supHrs`), so supervision is already counted and `supHrs`
 * is deliberately NOT added again. `totalReg` is Σ reg, so it is not added on top
 * of the mob sum either. PM / shop / drafting hours are LaborCalc's own.
 *
 * cost  = the configured `totalCost`.
 * sell  = Σ CURRENT extended sell of the lines that carry `laborGroup === id`
 *         (so hand edits after configuring show up).
 * edited = that sell differs from the configured `totalPrice` by more than $1.
 *
 * Alternate-group systems (`SpecSection.alternate === true`) are priced separately and
 * option-flagged lines (`it.option`) sit outside the totals, so neither feeds `groups`,
 * `loose`, `totals` or `crew`: alternates go to the `alternate` bucket, option lines are
 * left out of every sell/loose row (a group with optioned lines reads `edited`).
 *
 * The table's sell can differ from `totals().lab` by system price adjustments ($25
 * round-ups / typed system sells) and by unflagged lines in labor-kind sections.
 */

export type LaborSummaryGroup = {
  id: string;
  /** "<system name> · <discipline label>". */
  label: string;
  hours: number;
  cost: number;
  sell: number;
  edited: boolean;
  /** Set only on rows in the `alternate` bucket. */
  alternate?: true;
};

type LaborSums = { hours: number; cost: number; sell: number };

export type LaborSummary = {
  groups: LaborSummaryGroup[];
  /** Hand-added labor lines billed by the hour (unit "hr", no configured group). */
  loose: LaborSums | null;
  totals: LaborSums;
  /** Largest crew across mobilizations, Σ days, Σ overtime hours. */
  crew: { maxCrew: number; days: number; otHours: number };
  /** Alternate-group systems' labor — priced separately, shown below the totals row; null when none. */
  alternate: { groups: LaborSummaryGroup[]; loose: LaborSums | null; totals: LaborSums } | null;
};

/** A group's sell may differ from the configured price by this much before it reads as edited. */
export const LABOR_EDITED_TOLERANCE = 1;

const isHourUnit = (unit: unknown): boolean => String(unit ?? "").trim().toLowerCase() === "hr";

export function laborSummary(sections: SpecSection[], rate: RateFn): LaborSummary {
  const groups: LaborSummaryGroup[] = [];
  const altGroups: LaborSummaryGroup[] = [];
  const loose = { hours: 0, cost: 0, sell: 0, count: 0 };
  const altLoose = { hours: 0, cost: 0, sell: 0, count: 0 };
  let maxCrew = 0;
  let days = 0;
  let otHours = 0;
  let sawAlternate = false;

  for (const sec of sections || []) {
    const isAlt = sec.alternate === true;
    if (isAlt) sawAlternate = true;
    const outGroups = isAlt ? altGroups : groups;
    const outLoose = isAlt ? altLoose : loose;
    const records = sec.laborGroups || {};
    const items = sec.items || [];
    for (const id of Object.keys(records)) {
      const draft = records[id]?.draft;
      if (!draft) continue;
      const calc = computeLabor(draft, rate);
      let mobHours = 0;
      for (const m of calc.mobs) {
        mobHours += m.reg + m.otHrs; // reg already includes supervision (see header)
        if (!isAlt) {
          otHours += m.otHrs;
          days += m.days;
          if (m.people > maxCrew) maxCrew = m.people;
        }
      }
      const sell = items.reduce((a, it) => (it.laborGroup === id && !it.option ? a + lineExtSellOf(it) : a), 0);
      const label = `${sec.name || "Untitled system"} · ${calc.discLabel}`;
      outGroups.push({
        id,
        label,
        hours: round2(mobHours + calc.pmHrs + calc.shopHrs + calc.drfHrs),
        cost: round2(calc.totalCost),
        sell: round2(sell),
        edited: Math.abs(sell - calc.totalPrice) > LABOR_EDITED_TOLERANCE,
        ...(isAlt ? { alternate: true as const } : {}),
      });
    }
    for (const it of items) {
      if (!it.labor || !isHourUnit(it.unit) || it.option) continue;
      if (it.laborGroup && records[it.laborGroup]?.draft) continue; // counted with its group
      const qty = Number.isFinite(it.qty) ? it.qty : 0;
      outLoose.hours += qty;
      outLoose.cost += qty * (Number.isFinite(it.cost) ? it.cost : 0);
      outLoose.sell += lineExtSellOf(it);
      outLoose.count += 1;
    }
  }

  const finish = (l: typeof loose): LaborSums | null =>
    l.count > 0 ? { hours: round2(l.hours), cost: round2(l.cost), sell: round2(l.sell) } : null;
  const totalsOf = (gs: LaborSummaryGroup[], l: LaborSums | null): LaborSums => {
    const sum = (pick: (g: LaborSums) => number) => round2(gs.reduce((a, g) => a + pick(g), 0) + (l ? pick(l) : 0));
    return { hours: sum((g) => g.hours), cost: sum((g) => g.cost), sell: sum((g) => g.sell) };
  };
  const looseOut = finish(loose);
  const altLooseOut = finish(altLoose);
  return {
    groups,
    loose: looseOut,
    totals: totalsOf(groups, looseOut),
    crew: { maxCrew, days: round2(days), otHours: round2(otHours) },
    alternate:
      sawAlternate && (altGroups.length > 0 || altLooseOut)
        ? { groups: altGroups, loose: altLooseOut, totals: totalsOf(altGroups, altLooseOut) }
        : null,
  };
}
