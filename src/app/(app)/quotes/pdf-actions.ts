"use server";

import { scheduleQuotePdf } from "@/lib/quote-pdf/schedule";
import { pdfRetryPlan, pdfView, type QuotePdfView } from "@/lib/quote-pdf/state";
import { requireUser } from "@/lib/session";
import { get as getQuote } from "@/lib/stores/quotes";

/** The saved PDF's state for the preview's poll (#222). */
export async function quotePdfStatusAction(id: string): Promise<QuotePdfView | null> {
  await requireUser();
  const q = typeof id === "string" && id ? await getQuote(id) : null;
  return pdfView(q?.pdf, Date.now());
}

/** Re-render the saved PDF (#222). A render still in flight is left alone —
 *  its view comes back unchanged (pdfRetryPlan). Otherwise the same `savedAt`
 *  when the document hasn't changed, so a send waiting on this render still
 *  gets its copy; the last content change's when it has. Runs inside the
 *  calling page's `maxDuration` (the Estimator and the service builders set 120 s). */
export async function retryQuotePdfAction(id: string): Promise<QuotePdfView | null> {
  await requireUser();
  const q = typeof id === "string" && id ? await getQuote(id) : null;
  if (!q) return null;
  const plan = pdfRetryPlan(q, Date.now());
  if ("wait" in plan) return plan.wait;
  return scheduleQuotePdf(q.id, { savedAt: plan.savedAt });
}
