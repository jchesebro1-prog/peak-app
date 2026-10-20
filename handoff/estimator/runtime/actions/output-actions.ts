/**
 * Estimator handoff — browser implementations of src/app/(app)/estimator/output-actions.ts (#301 — a
 * site visit's client goals for the Build package's Client goals box), type-enforced against the originals.
 *
 * Site visits (surveys) are not in the slice: `surveyGoalsAction` answers the original's own "no such
 * record" refusal, and `siteVisitGoalsAction` the original's empty success (no visits to pick from).
 * Plan: PR 2 Task 5.
 */
import type * as Original from "@/app/(app)/estimator/output-actions";
import type { Impl as ImplOf } from "./util";

export const OUTPUT_ACTIONS_KEY = "src/app/(app)/estimator/output-actions.ts";

type A = typeof Original;
type Impl<K extends keyof A> = ImplOf<A, K>;

const ID_MAX = 64;

export function outputActions(): { [K in keyof A]: Impl<K> } {
  const surveyGoalsAction: Impl<"surveyGoalsAction"> = async (surveyId) => {
    const id = typeof surveyId === "string" ? surveyId.trim().slice(0, ID_MAX) : "";
    if (!id) return { ok: false, error: "No site visit is linked." };
    return { ok: false, error: "That site visit no longer exists." };
  };
  const siteVisitGoalsAction: Impl<"siteVisitGoalsAction"> = async () => ({ ok: true, options: [] });
  return { surveyGoalsAction, siteVisitGoalsAction };
}
