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
 */

export type LaborSummaryGroup = {
  id: string;
  /** "<system name> · <discipline label>". */
  label: string;
  hours: number;
  cost: number;
  sell: number;
  edited: boolean;
};

export type LaborSummary = {
  groups: LaborSummaryGroup[];
  /** Hand-added labor lines billed by the hour (unit "hr", no configured group). */
  loose: { hours: number; cost: number; sell: number } | null;
  totals: { hours: number; cost: number; sell: number };
  /** Largest crew across mobilizations, Σ days, Σ overtime hours. */
  crew: { maxCrew: number; days: number; otHours: number };
};

/** A group's sell may differ from the configured price by this much before it reads as edited. */
export const LABOR_EDITED_TOLERANCE = 1;

const isHourUnit = (unit: unknown): boolean => String(unit ?? "").trim().toLowerCase() === "hr";

export function laborSummary(sections: SpecSection[], rate: RateFn): LaborSummary {
  const groups: LaborSummaryGroup[] = [];
  let looseHours = 0;
  let looseCost = 0;
  let looseSell = 0;
  let looseCount = 0;
  let maxCrew = 0;
  let days = 0;
  let otHours = 0;

  for (const sec of sections || []) {
    const records = sec.laborGroups || {};
    const items = sec.items || [];
    for (const id of Object.keys(records)) {
      const draft = records[id]?.draft;
      if (!draft) continue;
      const calc = computeLabor(draft, rate);
      let mobHours = 0;
      for (const m of calc.mobs) {
        mobHours += m.reg + m.otHrs; // reg already includes supervision (see header)
        otHours += m.otHrs;
        days += m.days;
        if (m.people > maxCrew) maxCrew = m.people;
      }
      const sell = items.reduce((a, it) => (it.laborGroup === id ? a + lineExtSellOf(it) : a), 0);
      const label = `${sec.name || "Untitled system"} · ${calc.discLabel}`;
      groups.push({
        id,
        label,
        hours: round2(mobHours + calc.pmHrs + calc.shopHrs + calc.drfHrs),
        cost: round2(calc.totalCost),
        sell: round2(sell),
        edited: Math.abs(sell - calc.totalPrice) > LABOR_EDITED_TOLERANCE,
      });
    }
    for (const it of items) {
      if (!it.labor || !isHourUnit(it.unit)) continue;
      if (it.laborGroup && records[it.laborGroup]?.draft) continue; // counted with its group
      const qty = Number.isFinite(it.qty) ? it.qty : 0;
      looseHours += qty;
      looseCost += qty * (Number.isFinite(it.cost) ? it.cost : 0);
      looseSell += lineExtSellOf(it);
      looseCount += 1;
    }
  }

  const loose = looseCount > 0 ? { hours: round2(looseHours), cost: round2(looseCost), sell: round2(looseSell) } : null;
  const sum = (pick: (g: { hours: number; cost: number; sell: number }) => number) =>
    round2(groups.reduce((a, g) => a + pick(g), 0) + (loose ? pick(loose) : 0));
  return {
    groups,
    loose,
    totals: { hours: sum((g) => g.hours), cost: sum((g) => g.cost), sell: sum((g) => g.sell) },
    crew: { maxCrew, days: round2(days), otHours: round2(otHours) },
  };
}
