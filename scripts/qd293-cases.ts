/**
 * #293 — fixed QuoteDocument props + a Node renderer, shared by the
 * byte-for-byte baseline writer (scripts/qd293-baseline.ts) and the harness.
 * QuoteDocument imports a .jpg letterhead that Node can't load, so the module
 * is required lazily after a CJS `.jpg` stub is registered (tsx runs this
 * repo's scripts as CommonJS; `@/` aliases resolve through tsconfig).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type QuoteDocumentType from "@/app/(app)/estimator/quote-document";
import type { QuoteDocumentProps } from "@/app/(app)/estimator/quote-document";
import { quoteDocumentDataFor } from "@/lib/quote-pdf/quote-document-data";
import type { SpecItem, SpecSection } from "@/app/(app)/estimator/types";

type DocModule = { default: typeof QuoteDocumentType; QUOTE_PRINT_CSS: string };
let mod: DocModule | null = null;

export function quoteDocumentModule293(): DocModule {
  if (mod) return mod;
  const ext = (require as unknown as { extensions: Record<string, (m: { exports: unknown }) => void> }).extensions;
  if (!ext[".jpg"]) ext[".jpg"] = (m) => { m.exports = { __esModule: true, default: { src: "/_test/peak-letterhead.jpg", width: 1, height: 1 } }; };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  mod = require("@/app/(app)/estimator/quote-document") as DocModule;
  return mod;
}

export function renderQuoteDocument293(props: QuoteDocumentProps): string {
  const { default: QuoteDocument } = quoteDocumentModule293();
  return renderToStaticMarkup(createElement(QuoteDocument, props));
}

const AT = Date.UTC(2026, 9, 1, 15); // mid-day UTC: the same calendar date in every US zone
const line = (id: number, extra: Partial<SpecItem> = {}): SpecItem =>
  ({ id, sku: "SKU-" + id, desc: "Line " + id, qty: 2, unit: "ea", cost: 10, price: 25, ...extra } as SpecItem);

/** Four systems: itemized (comment, allowance, option, vendor line), narrative
 *  with intro, labor, and a narrative system with an empty intro. */
export function qd293Sections(): SpecSection[] {
  return [
    { id: "s1", name: "Rigging", kind: "materials", mfr: "", freightPct: 5, items: [line(1, { comment: "Customer note" }), line(2, { allowance: true }), line(3, { option: true }), line(4, { vendorQuoteId: "VQ-1" })] },
    { id: "s2", name: "Lighting", kind: "materials", mfr: "", freightPct: 0, presentation: "narrative", narrative: "Intro para.\n\n- One\n- Two", items: [line(5), line(6)] },
    { id: "s3", name: "Install", kind: "labor", mfr: "", freightPct: 0, items: [line(7, { labor: true, sku: "LAB-INSTALL", unit: "hr" })] },
    { id: "s4", name: "Empty narrative", kind: "materials", mfr: "", freightPct: 0, presentation: "narrative", narrative: "", items: [line(8)] },
  ];
}

export function qd293Props(opts: { sections?: SpecSection[]; pdfOptions?: Record<string, unknown> } = {}): QuoteDocumentProps {
  const quote = {
    id: "Q-293", name: "Narrative test", customer: "Walk-in", customerId: null, owner: "Pat Estimator", preparedBy: "",
    updatedAt: AT, createdAt: AT, revisions: [], quoteNote: "Cover note.", assumptions: "Assume access.", paymentTerms: "Net 30",
    spec: { sections: opts.sections ?? qd293Sections() },
    vendorQuotes: [{ id: "VQ-1", vendor: "Acme", quoteNumber: "Q9", description: "Motors", display: "itemized", lines: [{ id: 1, description: "Motor", qty: 2, unit: "ea", amount: 100 }], terms: "", notes: "", total: 100, includesFreight: false }],
    pdfOptions: { ...(opts.pdfOptions || {}) },
  };
  return quoteDocumentDataFor(quote as never, null, { companyName: "Peak Systems Group", logoDark: null });
}

/** The byte-for-byte cases: a quote with no key products and the appendix off. */
export function qd293Cases(): Record<string, QuoteDocumentProps> {
  return {
    itemized: qd293Props(),
    sectioned: qd293Props({ pdfOptions: { detail: "sectioned" } }),
    lean: qd293Props({ pdfOptions: { pdfQty: false, pdfPrices: false, pdfCover: false, pdfTerms: false } }),
  };
}
