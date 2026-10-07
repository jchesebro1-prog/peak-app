/**
 * Estimator Phase 2b — the customer-facing Alternates list copy, shared by the
 * cover PDF and the package page so the two can't drift. Dependency-free (safe
 * for client and server alike). The estimate PDF's own Alternates sub-line
 * ("Priced separately — not included in the total") is deliberately worded
 * differently — it sits beside a price, not under a total.
 */
export const ALTERNATES_TITLE = "Alternates";
export const ALTERNATES_NOTE = "Not included in the total above.";
