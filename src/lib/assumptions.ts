/**
 * The assumptions library the Estimator offers on an estimate (Settings →
 * Sales → Assumptions library; stored in `settings.consultingAssumptions` —
 * the key keeps its name from the removed Consulting builder). Pure.
 */
export const DEFAULT_CONSULTING_ASSUMPTIONS: string[] = [
  "Architectural backgrounds are provided by others in AutoCAD .dwg format; Revit modeling is not included.",
  "The owner provides timely access to the facility for field verification.",
  "Existing structure is assumed adequate for the loads shown; structural engineering is by others.",
  "Electrical service, conduit, and rough-in are provided by the electrical contractor.",
  "Permitting, plan-review, and other agency fees are excluded and billed separately when required.",
  "Up to two (2) design review meetings are included; additional meetings are billed hourly.",
  "One (1) revision cycle per drawing set is included.",
  "Construction administration covers the winning contractor's submittals and RFIs only.",
  "Reimbursable travel expenses are billed at cost.",
  "Fees are independent of any future construction or installation pricing.",
];

/** Stored list if non-empty, else the defaults (the mergedVisitReasons /
 *  mergedConsultingPhases idiom — a whole-list override, not a merge). */
export function mergedConsultingAssumptions(
  stored?: string[] | null
): string[] {
  const list = (stored || []).map((s) => s.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_CONSULTING_ASSUMPTIONS;
}
