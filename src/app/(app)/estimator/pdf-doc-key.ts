import type { QuotePdfOptions } from "@/lib/quote-pdf/pdf-options";
import type { SpecSection, VendorQuote } from "./types";
import { withoutBuilt, type SystemGroup } from "@/lib/estimate-groups/groups";

/**
 * Fingerprint of what the customer PDF shows (#222). The preview compares the
 * live key to the key of the last successful save and says "Unsaved changes —
 * save to update the PDF." while they differ. Vendor quotes contribute only
 * their customer-visible fields: attachment, terms, notes and cost never print,
 * and the server rewrites attachments on save. Only the vendor quotes a line
 * references count, in id order: a Save hands back the server's list, pruned
 * of records no line uses and reordered (saveQuoteAction), and that is the
 * same document — not "Unsaved changes" (#222 T5 review).
 */
export type PdfDocKeyInput = {
  /** #223 — the estimate number the document prints (QuoteDocument's quoteId). */
  quoteNumber?: string;
  projectName: string;
  custName: string;
  customerId: string | null;
  locationId: string | null;
  contactName: string;
  quoteNote: string;
  assumptions: string;
  paymentTerms: string;
  sections: SpecSection[];
  /** Phase 2a: group headings print on the document, so a rename/reorder is a document change. */
  groups?: SystemGroup[];
  vendorQuotes: VendorQuote[];
  pdfOptions: QuotePdfOptions;
};

function printedVendorQuotes(sections: SpecSection[], vendorQuotes: VendorQuote[]): VendorQuote[] {
  const used = new Set<string>();
  (sections || []).forEach((sec) => (sec?.items || []).forEach((it) => it?.vendorQuoteId && used.add(it.vendorQuoteId)));
  return (vendorQuotes || []).filter((v) => used.has(v.id)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function pdfDocKey(i: PdfDocKeyInput): string {
  return JSON.stringify([
    i.quoteNumber || "",
    i.projectName,
    i.custName,
    i.customerId || "",
    i.locationId || "",
    i.contactName,
    i.quoteNote,
    i.assumptions,
    i.paymentTerms,
    i.sections.map(withoutBuilt),
    i.groups ?? [],
    printedVendorQuotes(i.sections, i.vendorQuotes).map((v) => [v.id, v.vendor, v.quoteNumber, v.description, v.display, v.lines]),
    i.pdfOptions,
  ]);
}

/** The header fields the Estimator autosaves through updateQuoteMetaAction. */
export type SavedMeta = {
  customerId?: string | null;
  locationId?: string | null;
  customer?: string;
  contactName?: string;
  quoteNote?: string;
  assumptions?: string;
  installTimeframe?: string;
  category?: string;
  name?: string;
};

/**
 * The saved document after a header autosave landed (#222 Task 5). An
 * autosave re-renders the PDF from the SAVED quote — its new header fields
 * over the last Save's systems — so the preview's baseline takes exactly the
 * fields that were written and nothing the editor still holds unsaved.
 * Mirrors updateQuoteMetaAction's allowlist: a blank name never clears one;
 * installTimeframe and category don't print.
 */
export function withSavedMeta(base: PdfDocKeyInput, meta: SavedMeta): PdfDocKeyInput {
  const next = { ...base };
  if ("customerId" in meta) next.customerId = meta.customerId ?? null;
  if ("locationId" in meta) next.locationId = meta.locationId ?? null;
  if (typeof meta.customer === "string") next.custName = meta.customer;
  if (typeof meta.contactName === "string") next.contactName = meta.contactName;
  if (typeof meta.quoteNote === "string") next.quoteNote = meta.quoteNote;
  if (typeof meta.assumptions === "string") next.assumptions = meta.assumptions;
  if (typeof meta.name === "string" && meta.name.trim()) next.projectName = meta.name.trim();
  return next;
}
