import type { NextStepAction } from "@/lib/quote-next-step";

/**
 * #304 (spec 2026-10-07 §4) — the Estimator's four steps. Pure and
 * client-safe: the shell reads `?step=` through parseStep, writes it through
 * stepSearch, and moves after a next-step action through stepAfterAction.
 */

export const ESTIMATE_STEPS = ["build", "package", "review", "send"] as const;
export type EstimateStep = (typeof ESTIMATE_STEPS)[number];

export const STEP_LABEL: Record<EstimateStep, string> = {
  build: "Build",
  package: "Build package",
  review: "Customer review",
  send: "Send & track",
};

/** Missing, unknown or wrong-case → Build (old `/estimator?id=` links open there). */
export function parseStep(raw: string | null | undefined): EstimateStep {
  return (ESTIMATE_STEPS as readonly string[]).includes(raw ?? "") ? (raw as EstimateStep) : "build";
}

/** Where the shell goes after a SUCCESSFUL next-step action; null = stay. */
export function stepAfterAction(action: NextStepAction): EstimateStep | null {
  switch (action) {
    case "submit":
    case "approve":
    case "attest":
    case "assign":
      return "review";
    case "send":
      return "send";
    case "sendBack":
    case "withdraw":
      return "build";
    default:
      return null;
  }
}

/** The `?…` string for `step`, keeping every other param. Build writes no
 *  `step` param. `id` (a just-saved quote) is set when given. */
export function stepSearch(search: string, step: EstimateStep, id?: string | null): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (id) params.set("id", id);
  if (step === "build") params.delete("step");
  else params.set("step", step);
  const s = params.toString();
  return s ? "?" + s : "";
}
