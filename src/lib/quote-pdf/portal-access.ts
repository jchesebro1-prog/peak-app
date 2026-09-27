import { portalListsQuote, type Quote } from "@/lib/stores/quotes";
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
