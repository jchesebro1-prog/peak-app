/**
 * AI daily brief (spec §6) — the `assist_runs` outcomeDetail keys the report
 * reads. Pure constants, shared by the writers and `briefReport`.
 */

/** On a reply run: the draft queue made it (a pre-draft), not a live Draft reply. */
export const PREDRAFT_RUN_KEY = "queued";

/** On a nudge run: its email was opened in the composer via `?nudge=` (not necessarily sent). */
export const NUDGE_OPENED_KEY = "opened";
