/**
 * Estimator handoff — browser implementations of src/app/(app)/quotes/actions.ts (the Quotes hub's
 * form actions) that the Estimator reaches: setQuoteStatus (the Portal panel's Approve) and
 * deleteQuoteAction. Same validation and result shapes, type-enforced against the originals.
 * The hub's client package and revision save/restore are left unregistered (no hub in the prototype).
 *
 * setQuoteStatus's original redirects back to the hub with `statusError` / `statusNotice`; the
 * prototype has no hub to land on, so a refusal is logged (console.warn) and the action returns.
 * Plan: PR 2 Task 4.
 */
import type * as Original from "@/app/(app)/quotes/actions";
import type { QuoteStatus } from "@/lib/stores/quotes";
import { REOPENED_AT_WON_NOTICE, reopenedAtWonVersion } from "@/lib/quote-won-version";
import { refresh } from "../router";
import type { HandoffStore } from "../store";
import { refreshPortsFromStore, users } from "../ports";
import { quoteRepo } from "../quote-repo";
import { STAGES, statusFailureMessage } from "../quote-model";

export const QUOTES_ACTIONS_KEY = "src/app/(app)/quotes/actions.ts";

type A = typeof Original;
type Impl<K extends keyof A> = A[K] extends (...a: infer P) => Promise<infer R> ? (...a: P) => Promise<R> : never;

export type ImplementedQuotesAction = "setQuoteStatus" | "deleteQuoteAction";

export function quotesActions(store: HandoffStore): { [K in ImplementedQuotesAction]: Impl<K> } {
  const repo = quoteRepo(store);

  const setQuoteStatus: Impl<"setQuoteStatus"> = async (formData) => {
    await refreshPortsFromStore(store);
    const user = users.current();
    const id = String(formData.get("id") || "");
    const status = String(formData.get("status") || "");
    if (!id || !(STAGES as readonly string[]).includes(status)) return;
    const before = await repo.get(id);
    let q;
    try {
      q = await repo.setStatus(id, status as QuoteStatus, user.name);
    } catch (e) {
      console.warn("[handoff] setQuoteStatus refused:", statusFailureMessage(e, "quotes/actions setQuoteStatus: setStatus threw"));
      return;
    }
    if (!q) return;
    refresh();
    if (reopenedAtWonVersion(before, q)) console.warn("[handoff] setQuoteStatus:", REOPENED_AT_WON_NOTICE);
  };

  /** Soft delete → a tombstone in the overlay (the Rewards ledger and system library are not in the prototype). */
  const deleteQuoteAction: Impl<"deleteQuoteAction"> = async (id) => {
    await repo.remove(id);
    refresh();
    return { ok: true as const };
  };

  return { setQuoteStatus, deleteQuoteAction };
}
