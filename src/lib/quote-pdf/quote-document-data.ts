import type { CustomerDoc } from "@/lib/stores/customers";
import type { AppSettingsData } from "@/lib/settings";
import type { Quote } from "@/lib/stores/quotes";
import type { QuoteDocumentProps } from "@/app/(app)/estimator/quote-document";
import { totals } from "@/app/(app)/estimator/pricing";
import { PAYMENT_TERMS, type PaymentTerms, type SpecSection, type VendorQuote } from "@/app/(app)/estimator/types";
import { normalizePdfOptions } from "./pdf-options";
import { displayQuoteNumber } from "@/lib/estimate-number";

/**
 * A saved quote → the props of the customer QuoteDocument (#222). Mirrors what
 * the Estimator hands PreviewDoc (estimator/page.tsx initialFrom + estimator-
 * client.tsx: custName, the "attn" contact ladder, the primary-venue fallback,
 * "Label — City" venue, Rev = revisions.length) so the saved PDF and the
 * builder agree. Pure given its inputs; the print route loads them.
 */

/** The Estimator's TAX_RATE_PCT (estimator-client.tsx) — no tax line today. */
const TAX_RATE_PCT = 0;

/** #245 — the standing lines a portal-catalog quote prints (global
 *  constraints, verbatim). Kept here (not in the server-only
 *  src/lib/portal-quotes.ts) so the document data stays pure. */
export const PORTAL_DOC_REVIEW_LINE = "All quotes are subject to Peak review and approval.";
export const PORTAL_DOC_TAX_LINE = "Plus applicable sales tax.";

/** "October 27, 2026" — the document's own long-date format. */
function longDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/**
 * #245 (widened #248 Task 2) — what a portal-catalog OR portal-service quote
 * adds to the document: the review + tax lines, "Valid until <date>" for a
 * firm generation, and (portal-catalog only, via `sections`) the freight row
 * with the venue's one-way miles when known ("Freight & delivery — 412 mi").
 * Never the freight % (it is a % of cost — spec §8.1). The flame/inspection
 * proposal letters (letter-view.tsx) call this with an empty `sections` —
 * they have no freight row of their own, only the standing lines. Every
 * other quote: nothing.
 */
export function portalDocumentExtras(
  q: Pick<Quote, "source" | "portalFirm">,
  sections: SpecSection[]
): { standingLines: string[]; validUntilMs: number | null; freightLabel: string } {
  if (q.source !== "portal-catalog" && q.source !== "portal-service") {
    return { standingLines: [], validUntilMs: null, freightLabel: "Freight & delivery" };
  }
  const until = q.portalFirm && typeof q.portalFirm.validUntil === "number" ? q.portalFirm.validUntil : null;
  const miles = sections.map((s) => s.freightMiles).find((m): m is number => typeof m === "number" && Number.isFinite(m) && m >= 0);
  return {
    standingLines: [PORTAL_DOC_REVIEW_LINE, PORTAL_DOC_TAX_LINE, ...(until != null ? [`Valid until ${longDate(until)}`] : [])],
    validUntilMs: until,
    freightLabel: miles != null ? `Freight & delivery — ${Math.round(miles).toLocaleString("en-US")} mi` : "Freight & delivery",
  };
}

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
    // #223 — the document prints the estimate number (the id when unnumbered).
    quoteId: displayQuoteNumber(q),
    revNum: Math.max(1, q.revisions?.length || 1),
    revDateMs: q.updatedAt || q.createdAt || 0,
    custName: (q.customerId && cust?.name) || q.customer || "",
    hasAttn: current ? true : !!contactName,
    attnLine: current ? current.name + (current.role ? " · " + current.role : "") : contactName,
    projectName: q.name || "",
    venueLabel: loc ? [loc.label || "", loc.city || ""].filter(Boolean).join(" — ") : "",
    // The lead estimator — "Questions? Reach out to …".
    ownerName: q.owner || companyName,
    // #285 task B: "Prepared by" prints the quote's own preparedBy, falling
    // back to the lead estimator (owner), then the company.
    preparedByName: (q.preparedBy || "").trim() || q.owner || companyName,
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
    isPortalCatalog: q.source === "portal-catalog",
    ...portalDocumentExtras(q, sections),
  };
}
