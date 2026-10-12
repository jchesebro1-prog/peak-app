import type { SpecSection } from "@/app/(app)/estimator/types";
import { bonusRulesApply, idCounterFrom, withBonusLines } from "./rules";

/** Every server write of an Estimator quote's sections passes through here. */
export function canonicalBonusSections(
  q: { source?: string | null; quoteType?: string | null; status?: string | null },
  sections: SpecSection[],
): SpecSection[] {
  return bonusRulesApply(q, sections) ? withBonusLines(sections, idCounterFrom(sections)) : sections;
}
