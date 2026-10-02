import { isImportedHistoryQuote, portalListsQuote, type Quote } from "@/lib/stores/quotes";
import { onlineEstimateState, type OnlineEstimateState } from "@/lib/quote-share/view";
import { portalPdfPreparing, portalPdfSource, portalPdfUnavailable } from "./state";

/**
 * The customer portal's PDF rule (#222), one place for the route and the list:
 * the quote must be one the portal lists for this customer (published, or the
 * customer's own self-serve draft; never Daylite history), and it must have a
 * file a customer may see: once sent, only the latest sent revision's copy;
 * never sent, the current ready PDF (portalPdfSource).
 */
export function portalQuotePdfSource(q: Quote, customerId: string): { path: string; rev: number | null } | null {
  if (!portalListsQuote(q, customerId)) return null;
  return portalPdfSource(q);
}

/** A quote this customer may open whose sent copy isn't stored yet but can still arrive (#222). */
export function portalQuotePdfPreparing(q: Quote, customerId: string): boolean {
  return portalListsQuote(q, customerId) && portalPdfPreparing(q);
}

/** A quote this customer may open whose sent copy is missing for good (#222 T4 re-review):
 *  sent before saved PDFs existed, or edited after the send. */
export function portalQuotePdfUnavailable(q: Quote, customerId: string): boolean {
  return portalListsQuote(q, customerId) && portalPdfUnavailable(q);
}

/**
 * #293 slice 3 — the portal estimate page's rule (spec §5.2, decision 16):
 * the quote must be this customer's and not Daylite history; then the one
 * online rule decides. A staff quote recalled to draft after sending shows
 * the "being revised" card (no content) — portalListsQuote hides staff
 * drafts, so the list rule alone would call it unavailable. Content (ok)
 * still requires the portal's list rule.
 */
export function portalOnlineEstimateState(q: Quote, customerId: string): OnlineEstimateState {
  if (!customerId || q.customerId !== customerId || isImportedHistoryQuote(q)) return { kind: "unavailable" };
  const s = onlineEstimateState(q);
  if (s.kind === "ok" && !portalListsQuote(q, customerId)) return { kind: "unavailable" };
  return s;
}
