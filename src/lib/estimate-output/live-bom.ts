import type { QuoteDocumentProps } from "@/app/(app)/estimator/quote-document";
import { bomViewProps } from "@/app/(app)/estimator/quote-document-view";
import type { CustomerLite, SpecSection, VendorQuote } from "@/app/(app)/estimator/types";
import type { SystemGroup } from "@/lib/estimate-groups/groups";
import type { QuotePdfOptions } from "@/lib/quote-pdf/pdf-options";
import { quoteDocumentDataFor } from "@/lib/quote-pdf/quote-document-data";

/**
 * #333 (spec 2026-10-12 §7.1, D-TBD-c) — the Build package step's live BOM
 * quote: the customer's BOM view built in the browser from the UNSAVED editor
 * state. Pure and client-safe (types only from stores).
 *
 * It builds a minimal Quote-shaped object and runs the SAME
 * quoteDocumentDataFor the print route and /estimator-preview use, then
 * bomViewProps — so the contact ladder, venue label, sort, totals, groups and
 * portal extras are the saved view's own. revNum / revDateMs / rewardsLine
 * come from the input (the hook's state and its Rewards read).
 *
 * The package document is not passed: bomViewProps always drops it (the BOM
 * view is the itemized bands), so validating it per keystroke would be waste.
 */
export type LiveBomInput = {
  /** The printed number (the hook's `quoteId` label — the estimate number, or the id). */
  quoteNumber: string;
  projectName: string;
  customerId: string | null;
  /** The free-text customer (a walk-in), used when no linked customer has a name. */
  custName: string;
  locationId: string | null;
  contactName: string | null;
  quoteNote: string;
  assumptions: string;
  owner: string;
  preparedBy: string;
  paymentTerms: string;
  sections: SpecSection[];
  groups: SystemGroup[];
  vendorQuotes: VendorQuote[];
  pdfOptions: QuotePdfOptions;
  revNum: number;
  revDateMs: number;
  /** "portal-catalog" for a portal-catalog quote; anything else prints as an Estimator quote. */
  source: string | null;
  /** A portal-catalog firm generation's validity (prints "Valid until …"). */
  portalFirm: { generatedAt: number; validUntil: number } | null;
  customers: CustomerLite[];
  companyName: string;
  logoDark: string | null;
  /** The customer's purchase-perks doc line ("" when none / not this customer). */
  rewardsLine: string;
};

export function liveBomDocumentProps(i: LiveBomInput): QuoteDocumentProps {
  const cust = i.customerId ? i.customers.find((c) => c.id === i.customerId) ?? null : null;
  const q = {
    id: i.quoteNumber,
    name: i.projectName,
    customer: i.custName,
    customerId: i.customerId,
    locationId: i.locationId,
    contactName: i.contactName,
    quoteNote: i.quoteNote,
    assumptions: i.assumptions,
    owner: i.owner,
    preparedBy: i.preparedBy,
    paymentTerms: i.paymentTerms,
    spec: { sections: i.sections, groups: i.groups },
    vendorQuotes: i.vendorQuotes,
    pdfOptions: i.pdfOptions,
    source: i.source,
    portalFirm: i.portalFirm,
  };
  const doc = quoteDocumentDataFor(q as unknown as Parameters<typeof quoteDocumentDataFor>[0], cust, {
    companyName: i.companyName,
    logoDark: i.logoDark,
  });
  return bomViewProps({ ...doc, revNum: i.revNum, revDateMs: i.revDateMs, rewardsLine: i.rewardsLine });
}
