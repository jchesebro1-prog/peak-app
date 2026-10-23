import type { SpecSection } from "@/app/(app)/estimator/types";
import { canonicalBonusSections } from "@/lib/estimate-bonus/canonical";
import type { BonusRates } from "@/lib/estimate-bonus/flags";
import { applyProjectDiscounts, type ProjectDiscounts } from "@/lib/project-discounts/rules";

/**
 * #368 — the derivations every server write of an Estimator quote's sections
 * runs once its lines are settled, in this order: the project discounts are
 * re-applied to every line and assembly part (#366 — a stale or hand-edited
 * cost can never disagree with the map), then the 5% package / 2% estimator
 * bonus lines are re-derived (they read normal cost, so they come after).
 * Shared by saveQuoteAction and the Revise re-price (rules.ts) so the two can't
 * drift; the stored `value` / `margin` then come from `reconcileEstimatorValue`
 * (pricing.ts) over the result, which also applies each system's $25 rounding /
 * typed price. Pure.
 *
 * `q` is the quote the sections will be stored on — its source / quoteType /
 * status decide whether bonus lines apply and at which rates (a draft takes
 * `bonusRates`, Estimating Rules' current ones).
 */
export function deriveEstimatorSections(
  q: { source?: string | null; quoteType?: string | null; status?: string | null },
  sections: SpecSection[],
  discounts: ProjectDiscounts,
  bonusRates: BonusRates
): SpecSection[] {
  return canonicalBonusSections(q, applyProjectDiscounts(sections, discounts), bonusRates);
}
