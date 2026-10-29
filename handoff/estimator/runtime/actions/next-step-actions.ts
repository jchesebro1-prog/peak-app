/**
 * Estimator handoff — browser implementations of src/app/(app)/quotes/review-actions.ts (#284/#287 — the
 * next-step control: Submit / Withdraw / Approve / Send back / Attest / Send to customer), type-enforced
 * against the originals. Each runs one guarded op (runtime/review-ops.ts, the quote-review-ops.ts port) as
 * the signed-in roster member (`ports.users.current()`), then answers the original's `NextStepSync`: the
 * quote's fresh review / status and the re-evaluated next-step view (props/estimator.ts nextStepFor — the
 * quote-next-step-server.ts port). A successful op refreshes the page props (the original's revalidatePath).
 * Plan: PR 2 Task 6.
 */
import type * as Original from "@/app/(app)/quotes/review-actions";
import type { Quote } from "@/lib/stores/quotes";
import type { HandoffStore } from "../store";
import { clock, refreshPortsFromStore, settingsView, users, type TeamUser } from "../ports";
import { nextStepFor } from "../props/estimator";
import { quoteRepo } from "../quote-repo";
import { reviewOps, type ReviewOpResult } from "../review-ops";
import { refresh } from "../router";
import type { Impl as ImplOf } from "./util";

export const NEXT_STEP_ACTIONS_KEY = "src/app/(app)/quotes/review-actions.ts";

type A = typeof Original;
type Impl<K extends keyof A> = ImplOf<A, K>;

/** quote-next-step-server quoteNextStepFor over the ports (the props builder's own port). */
export const nextStepView = (q: Quote, viewer: TeamUser) =>
  nextStepFor(q as Parameters<typeof nextStepFor>[0], viewer, users.all(), settingsView().reviewLimits, clock.now());

export function nextStepActions(store: HandoffStore): { [K in keyof A]: Impl<K> } {
  const repo = quoteRepo(store);
  const ops = reviewOps(repo);
  const actor = () => {
    const u = users.current();
    return { user: u, as: { name: u.name, roles: u.roles ?? [] } };
  };

  /** review-actions.ts after(): the fresh review / status / next step; a success refreshes the page. */
  const after = async (id: string, viewer: TeamUser, r: ReviewOpResult): Promise<Original.NextStepSync> => {
    if (r.ok) refresh();
    const q = id ? await repo.get(id) : null;
    return {
      ok: r.ok,
      ...(r.ok ? {} : { error: r.error }),
      review: q?.review ?? null,
      status: q?.status ?? null,
      next: q ? nextStepView(q, viewer) : null,
    };
  };

  /** Every op re-reads the settings first (review limits, pipelines). */
  const run = async (id: string, op: (a: { name: string; roles: string[] }) => Promise<ReviewOpResult>): Promise<Original.NextStepSync> => {
    await refreshPortsFromStore(store);
    const { user, as } = actor();
    return after(id, user, await op(as));
  };

  const nsSubmitAction: Impl<"nsSubmitAction"> = (id, reviewer) => run(id, (a) => ops.submitQuoteForApproval(id, a, reviewer));
  const nsWithdrawAction: Impl<"nsWithdrawAction"> = (id) => run(id, (a) => ops.withdrawQuoteReview(id, a));
  const nsApproveAction: Impl<"nsApproveAction"> = (id, asOf) => run(id, (a) => ops.approveQuoteReview(id, a, asOf));
  const nsSendBackAction: Impl<"nsSendBackAction"> = (id, note, asOf) => run(id, (a) => ops.sendBackQuoteReview(id, a, note, asOf));
  const nsAttestAction: Impl<"nsAttestAction"> = (id, note) => run(id, (a) => ops.attestQuoteApproval(id, a, note));
  const nsSendAction: Impl<"nsSendAction"> = (id, asOf) => run(id, (a) => ops.sendQuoteToCustomer(id, a, asOf));

  return { nsSubmitAction, nsWithdrawAction, nsApproveAction, nsSendBackAction, nsAttestAction, nsSendAction };
}
