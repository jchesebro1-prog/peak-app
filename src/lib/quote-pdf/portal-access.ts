import { portalListsQuote, type Quote } from "@/lib/stores/quotes";
import { portalPdfSource } from "./state";

/**
 * The customer portal's PDF rule (#222), one place for the route and the list:
 * the quote must be one the portal lists for this customer (published, or the
 * customer's own self-serve draft; never Daylite history), and it must have a
 * file a customer may see (the latest sent revision's copy, else a ready PDF).
 */
export function portalQuotePdfSource(q: Quote, customerId: string): { path: string; rev: number | null } | null {
  if (!portalListsQuote(q, customerId)) return null;
  return portalPdfSource(q);
}
