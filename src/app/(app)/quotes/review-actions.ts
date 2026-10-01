"use server";
/**
 * #284 — the next-step control's server actions (Estimator + Quotes hub).
 * Each calls one guarded op (src/lib/quote-review-ops.ts) and returns the
 * quote's fresh review/status plus the re-evaluated next-step view.
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { get, type QuoteReview, type QuoteStatus } from "@/lib/stores/quotes";
import { quoteNextStepFor } from "@/lib/quote-next-step-server";
import type { QuoteNextStepView } from "@/lib/quote-next-step";
import {
  submitQuoteForApproval,
  withdrawQuoteReview,
  approveQuoteReview,
  sendBackQuoteReview,
  attestQuoteApproval,
  sendQuoteToCustomer,
  type ReviewOpResult,
} from "@/lib/quote-review-ops";

export type NextStepSync = {
  ok: boolean;
  error?: string;
  review: QuoteReview | null;
  status: QuoteStatus | null;
  /** The re-evaluated next-step view (its strip carries the #242 limit chip). */
  next: QuoteNextStepView | null;
};

async function after(id: string, user: { name: string; roles: string[] }, r: ReviewOpResult): Promise<NextStepSync> {
  if (r.ok) revalidatePath("/", "layout");
  const q = id ? await get(id) : null;
  return {
    ok: r.ok,
    ...(r.ok ? {} : { error: r.error }),
    review: q?.review ?? null,
    status: q?.status ?? null,
    next: q ? await quoteNextStepFor(q, user) : null,
  };
}

export async function nsSubmitAction(id: string, reviewer: string | null): Promise<NextStepSync> {
  const user = await requireUser();
  return after(id, user, await submitQuoteForApproval(id, user, reviewer));
}
export async function nsWithdrawAction(id: string): Promise<NextStepSync> {
  const user = await requireUser();
  return after(id, user, await withdrawQuoteReview(id, user));
}
/** `asOf` = the view's `asOf` (the quote's updatedAt the approver was shown). */
export async function nsApproveAction(id: string, asOf?: number): Promise<NextStepSync> {
  const user = await requireUser();
  return after(id, user, await approveQuoteReview(id, user, asOf));
}
export async function nsSendBackAction(id: string, note: string, asOf?: number): Promise<NextStepSync> {
  const user = await requireUser();
  return after(id, user, await sendBackQuoteReview(id, user, note, asOf));
}
export async function nsAttestAction(id: string, note: string): Promise<NextStepSync> {
  const user = await requireUser();
  return after(id, user, await attestQuoteApproval(id, user, note));
}
export async function nsSendAction(id: string): Promise<NextStepSync> {
  const user = await requireUser();
  return after(id, user, await sendQuoteToCustomer(id, user));
}
