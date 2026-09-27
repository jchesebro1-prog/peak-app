import type { CustomerDoc } from "@/lib/stores/customers";
import type { AppSettingsData } from "@/lib/settings";
import type { Quote } from "@/lib/stores/quotes";
import type { QuoteDocumentProps } from "@/app/(app)/estimator/quote-document";
import { totals } from "@/app/(app)/estimator/pricing";
import { PAYMENT_TERMS, type PaymentTerms, type SpecSection, type VendorQuote } from "@/app/(app)/estimator/types";
import { normalizePdfOptions } from "./pdf-options";

/**
 * A saved quote → the props of the customer QuoteDocument (#222). Mirrors what
 * the Estimator hands PreviewDoc (estimator/page.tsx initialFrom + estimator-
 * client.tsx: custName, the "attn" contact ladder, the primary-venue fallback,
 * "Label — City" venue, Rev = revisions.length) so the saved PDF and the
 * builder agree. Pure given its inputs; the print route loads them.
 */

/** The Estimator's TAX_RATE_PCT (estimator-client.tsx) — no tax line today. */
const TAX_RATE_PCT = 0;

type DocQuote = Quote & { paymentTerms?: string };
type DocCustomer = Pick<CustomerDoc, "name" | "locations" | "contacts">;

export function quoteDocumentDataFor(
  q: DocQuote,
  cust: DocCustomer | null,
  settings: Pick<AppSettingsData, "companyName" | "logoDark">
): QuoteDocumentProps {
  const spec = (q.spec || null) as { sections?: unknown } | null;
  const sections = spec && Array.isArray(spec.sections) ? (spec.sections as SpecSection[]) : [];
  const vendorQuotes = Array.isArray(q.vendorQuotes)
    ? (q.vendorQuotes as VendorQuote[]).filter((v) => !!v && typeof v.id === "string")
    : [];
  const contacts = cust?.contacts || [];
  const locations = cust?.locations || [];
  // initialFrom's ladder: a stored contact that is no longer on the customer
  // (or none stored at all) reads as the primary contact.
  let contactName = q.contactName;
  if (contactName == null || (contactName && contacts.length && !contacts.some((c) => c.name === contactName))) {
    const pc = contacts.find((c) => c.primary) || contacts[0] || null;
    contactName = pc ? pc.name : "";
  }
  const current =
    contacts.length && contactName
      ? contacts.find((c) => c.name === contactName) || contacts.find((c) => c.primary) || contacts[0]
      : null;
  // initialFrom: a linked customer with no stored venue reads its primary one.
  const locId = q.locationId || (cust ? (locations.find((l) => l.primary) || locations[0])?.id : null) || null;
  const loc = cust && locId ? locations.find((l) => l.id === locId) : undefined;
  const companyName = settings.companyName || "Peak Systems Group";
  const paymentTerms: PaymentTerms = (PAYMENT_TERMS as readonly string[]).includes(q.paymentTerms || "")
    ? (q.paymentTerms as PaymentTerms)
    : "Unknown";
  return {
    quoteId: q.id,
    revNum: Math.max(1, q.revisions?.length || 1),
    revDateMs: q.updatedAt || q.createdAt || 0,
    custName: (q.customerId && cust?.name) || q.customer || "",
    hasAttn: current ? true : !!contactName,
    attnLine: current ? current.name + (current.role ? " · " + current.role : "") : contactName,
    projectName: q.name || "",
    venueLabel: loc ? [loc.label || "", loc.city || ""].filter(Boolean).join(" — ") : "",
    ownerName: q.owner || companyName,
    companyName,
    logoDark: settings.logoDark || null,
    quoteNote: q.quoteNote || "",
    assumptions: q.assumptions || "",
    sections,
    vendorQuotes,
    t: totals(sections, TAX_RATE_PCT),
    taxRatePct: TAX_RATE_PCT,
    ...normalizePdfOptions(q.pdfOptions),
    paymentTerms,
  };
}
