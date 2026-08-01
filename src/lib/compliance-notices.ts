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

// DRAFT WORDING — punch #73, awaiting Jeff's review; not reviewed by counsel.
export const FLAME_TEST_LIMITATION_NOTICE =
  "This document records the results of a field flame test performed per NFPA 705 — Recommended Practice for a Field Flame Test — and reflects only the technician's observations of the specific items tested on the stated date. It certifies flame-test results as described above; it is not a fire-code compliance determination for the venue as a whole and is not an engineering certification unless separately signed and sealed by a qualified professional engineer.";

// DRAFT WORDING — punch #73, awaiting Jeff's review; not reviewed by counsel.
export const INSPECTION_LIMITATION_NOTICE =
  "This report documents the inspector's visual observations of accessible rigging components on the stated survey date, evaluated against OSHA 1910 fall-protection standards, NFPA 80 & 101 life-safety codes, and the ANSI E1 entertainment-technology series (E1.4 counterweight rigging, E1.22 fire-safety curtain). It certifies only what was observed and rated on that date — it does not certify the structural design or integrity of the building, is not a substitute for continuous inspection, and is not an engineering certification unless separately signed and sealed by a qualified professional engineer.";
