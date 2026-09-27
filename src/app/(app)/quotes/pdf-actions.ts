"use server";

import { scheduleQuotePdf } from "@/lib/quote-pdf/schedule";
import { pdfView, type QuotePdfView } from "@/lib/quote-pdf/state";
import { requireUser } from "@/lib/session";
import { get as getQuote } from "@/lib/stores/quotes";

/** The saved PDF's state for the preview's poll (#222). */
export async function quotePdfStatusAction(id: string): Promise<QuotePdfView | null> {
  await requireUser();
  const q = typeof id === "string" && id ? await getQuote(id) : null;
  return pdfView(q?.pdf, Date.now());
}

/** Re-render the saved PDF (#222). Same `savedAt`: the document hasn't changed,
 *  so a send waiting on this render still gets its copy. Runs inside the
 *  calling page's `maxDuration` (the Estimator and the service builders set 60 s). */
export async function retryQuotePdfAction(id: string): Promise<QuotePdfView | null> {
  await requireUser();
  const q = typeof id === "string" && id ? await getQuote(id) : null;
  if (!q) return null;
  return scheduleQuotePdf(q.id, { savedAt: q.pdf?.savedAt ?? q.updatedAt ?? Date.now() });
}
