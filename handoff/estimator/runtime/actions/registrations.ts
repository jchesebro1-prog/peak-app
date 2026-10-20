/**
 * Estimator handoff — every server-action registration, in one list: main.tsx registers it before the first
 * render, and the Node checks (scripts/test-handoff-runtime.ts) prove each registered file covers every export
 * of its original. Refusals first, then the real implementations (a real one wins a name). Since Task 6 every
 * "use server" module the bundle stubs is here — `verify.ts --smoke --all-steps` fails on any it isn't.
 * Plan: PR 2 Tasks 4–6.
 */
import type { ActionImpl } from "../actions-registry";
import type { HandoffStore } from "../store";
import { ESTIMATOR_ACTIONS_KEY, estimatorActions, refusedEstimatorActions } from "./estimator-actions";
import { QUOTES_ACTIONS_KEY, quotesActions } from "./quotes-actions";
import { REVIEW_ACTIONS_KEY, reviewActions } from "./review-actions";
import { NARRATIVE_ACTIONS_KEY, narrativeActions } from "./narrative-actions";
import { LIBRARY_ACTIONS_KEY, libraryActions } from "./library-actions";
import { CLIENT_PACKAGE_ACTIONS_KEY, clientPackageActions } from "./client-package-actions";
import { PACKAGE_ACTIONS_KEY, packageActions, refusedPackageActions } from "./package-actions";
import { OUTPUT_ACTIONS_KEY, outputActions } from "./output-actions";
import { PDF_ACTIONS_KEY, pdfActions } from "./pdf-actions";
import { refusedSendActions, SEND_ACTIONS_KEY, sendActions } from "./send-actions";
import { NEXT_STEP_ACTIONS_KEY, nextStepActions } from "./next-step-actions";
import { miscActions } from "./misc-refusals";

/** [fileKey, implementations] pairs; a fileKey may appear more than once (registerActions merges). */
export function actionRegistrations(store: HandoffStore): Array<[string, Record<string, ActionImpl>]> {
  return [
    // Task 4 — the Build step.
    [ESTIMATOR_ACTIONS_KEY, { ...refusedEstimatorActions(), ...estimatorActions(store) }],
    [QUOTES_ACTIONS_KEY, quotesActions(store)],
    // Task 5 — the customer-facing views (review comments, narrative / system library, package panel, PDF status).
    [REVIEW_ACTIONS_KEY, reviewActions(store)],
    [NARRATIVE_ACTIONS_KEY, narrativeActions(store)],
    [LIBRARY_ACTIONS_KEY, libraryActions(store)],
    [CLIENT_PACKAGE_ACTIONS_KEY, clientPackageActions()],
    [PACKAGE_ACTIONS_KEY, { ...refusedPackageActions(), ...packageActions(store) }],
    [OUTPUT_ACTIONS_KEY, outputActions()],
    [PDF_ACTIONS_KEY, pdfActions(store)],
    // Task 6 — Send & track (simulated: nothing is ever sent), the next-step approval flow, and an explicit
    // registration (shape-valid empty or a refusal) for every remaining out-of-scope action.
    [SEND_ACTIONS_KEY, { ...refusedSendActions(), ...sendActions(store) }],
    [NEXT_STEP_ACTIONS_KEY, nextStepActions(store)],
    ...Object.entries(miscActions(store)),
  ];
}
