import type { SpecSection } from "@/lib/estimating-core/types";
import { DEFAULT_BONUS_RATES, type BonusRates } from "./flags";
import { bonusRatesFor, bonusRulesApply, idCounterFrom, withBonusLines } from "./rules";

/** Every server write of an Estimator quote's sections passes through here. `settingsRates` (Jeff 2026-10-15 #19) —
 *  Estimating Rules' current rates (loadBonusRates); a draft takes them, any other status keeps its lines' own. */
export function canonicalBonusSections(
  q: { source?: string | null; quoteType?: string | null; status?: string | null },
  sections: SpecSection[],
  settingsRates: BonusRates = DEFAULT_BONUS_RATES,
): SpecSection[] {
  return bonusRulesApply(q, sections) ? withBonusLines(sections, idCounterFrom(sections), bonusRatesFor(q.status, sections, settingsRates)) : sections;
}
