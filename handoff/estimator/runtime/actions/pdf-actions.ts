/**
 * Estimator handoff — browser implementations of src/app/(app)/quotes/pdf-actions.ts (the saved quote PDF's
 * status and Retry), type-enforced against the originals.
 *
 * The app prints the customer PDF with headless Chrome on every Save; the prototype has no renderer — the
 * Customer review's Document tab draws the document live and prints it with the browser (Print → PDF,
 * ui/review-overrides.tsx). So the status is the stored view as the original reads it (`pdfView(q.pdf)`:
 * null for a quote that never had a PDF, which is every quote in the prototype), and Retry renders nothing
 * — it answers the same view. Plan: PR 2 Task 5.
 */
import type * as Original from "@/app/(app)/quotes/pdf-actions";
import { pdfView } from "@/lib/quote-pdf/state";
import type { HandoffStore } from "../store";
import { quoteRepo } from "../quote-repo";
import type { Impl as ImplOf } from "./util";

export const PDF_ACTIONS_KEY = "src/app/(app)/quotes/pdf-actions.ts";

type A = typeof Original;
type Impl<K extends keyof A> = ImplOf<A, K>;

export function pdfActions(store: HandoffStore): { [K in keyof A]: Impl<K> } {
  const repo = quoteRepo(store);
  const quotePdfStatusAction: Impl<"quotePdfStatusAction"> = async (id) => {
    const q = typeof id === "string" && id ? await repo.get(id) : null;
    return pdfView(q?.pdf, Date.now());
  };
  /** No renderer: nothing to re-render — the stored view (null when the quote is missing, as the original). */
  const retryQuotePdfAction: Impl<"retryQuotePdfAction"> = async (id) => {
    const q = typeof id === "string" && id ? await repo.get(id) : null;
    return q ? pdfView(q.pdf, Date.now()) : null;
  };
  return { quotePdfStatusAction, retryQuotePdfAction };
}
