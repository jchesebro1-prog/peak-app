/**
 * Limitation notices for outputs with physical or regulatory consequences
 * (punch #73). Two families of documents get one:
 *
 *  - RIGGING outputs (Lineset Builder weights/capacity, Steel Calculator) —
 *    figures computed from entered dimensions and catalog data, against
 *    AISC ASD (src/lib/design/steel.ts).
 *  - COMPLIANCE documents (flame-test report/certificate, rigging inspection
 *    report) — records of what was observed on the stated date, checked
 *    against the standards named in each notice (NFPA 705 for flame test;
 *    OSHA 1910 / ANSI E1 / NFPA 80 & 101 for the inspection rubric — see
 *    src/lib/stores/inspections.ts `boilerplate()` and
 *    src/app/(app)/inspections/[id]/report/report-doc.tsx `recBasis`).
 *
 * Every string below is DRAFT WORDING pending product-owner (Jeff) sign-off
 * and has NOT been reviewed by counsel — see the comment on each constant.
 * Kept in this one module, deliberately, so the wording can be revised in a
 * single edit rather than hunted down across templates/report bodies. Do not
 * fork or inline copies of these strings elsewhere; import from here.
 */

// DRAFT WORDING — punch #73, awaiting Jeff's review; not reviewed by counsel.
export const RIGGING_LIMITATION_NOTICE =
  "These figures are calculated from the dimensions and catalog data entered into this tool (AISC ASD beam capacity; goods, hoist and counterweight-arbor loading per the formulas in src/lib/design/steel.ts). They are NOT a substitute for on-site verification by a qualified rigger or engineer. Actual capacity depends on the condition of the existing structure and hardware — welds, connections, wear, prior modifications — which this software has not inspected.";

