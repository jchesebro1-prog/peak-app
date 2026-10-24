/**
 * Estimator handoff — what an estimate's grand total is once the Estimator has loaded it. The Estimator does not
 * show the stored sections' total: on load it canonicalizes them — page.tsx normalizeSystemOrder; use-estimator-state's
 * initial state (#267: a draft, non-portal estimate's systems round up to the next $25 — withPriceRound); then its
 * bonus effect (bonusRulesApply → withBonusLines at bonusRatesFor(status, …, Estimating Rules' rates)). The Estimates
 * list (ui/estimates-list.tsx) and verify.ts (expectedEstimatorTotals) both read it here, so the list total, the
 * Estimator's header and the check can never disagree. Pure. Plan: PR 2 Tasks 3 and 7.
 */
import { totals, withPriceRound } from "@/lib/estimating-core/pricing";
import type { SpecSection } from "@/lib/estimating-core/types";
import { normalizeSystemOrder, sanitizeGroups } from "@/lib/estimate-groups/groups";
import { sourceForSave } from "@/lib/portal-quote-mode";
import { bonusRatesFor, bonusRulesApply, idCounterFrom, withBonusLines } from "@/lib/estimate-bonus/rules";
import { bonusRatesFrom, BONUS_ESTIMATOR_RATE_ID, BONUS_PACKAGE_RATE_ID } from "@/lib/estimate-bonus/flags";

/** The quote fields the total reads (a sliced estimate or a stored quote). */
export type TotalsQuote = {
  status?: string | null;
  source?: string | null;
  quoteType?: string | null;
  spec?: { sections?: unknown; groups?: unknown } | null;
};

/**
 * `raw` = totals() of the stored sections (the golden fixture's figure); `canonical` = after the load
 * canonicalization (what the Estimator's "Quoted total" reads). `general` is the pricing_rules blob.
 */
export function canonicalTotals(q: TotalsQuote, general: Record<string, unknown>): { raw: number; canonical: number; priceRound: boolean; bonusLines: boolean } {
  const stored = Array.isArray(q.spec?.sections) ? (q.spec!.sections as SpecSection[]) : [];
  const ordered = normalizeSystemOrder(stored, sanitizeGroups(q.spec?.groups));
  const status = q.status ?? "draft";
  const sections = q.source !== "portal-catalog" && status === "draft" ? withPriceRound(ordered) : ordered;
  const rates = bonusRatesFrom(general[BONUS_PACKAGE_RATE_ID], general[BONUS_ESTIMATOR_RATE_ID]);
  const applies = bonusRulesApply({ source: sourceForSave(q.source, "estimator"), quoteType: q.quoteType ?? "system", status }, sections);
  const canonical = applies ? withBonusLines(sections, idCounterFrom(sections), bonusRatesFor(status, sections, rates)) : sections;
  return { raw: totals(stored, 0).grand, canonical: totals(canonical, 0).grand, priceRound: sections !== ordered, bonusLines: canonical !== sections };
}
