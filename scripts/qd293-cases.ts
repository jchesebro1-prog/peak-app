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

export function qd293Props(opts: { sections?: SpecSection[]; groups?: unknown; pdfOptions?: Record<string, unknown>; document?: unknown } = {}): QuoteDocumentProps {
  const quote = {
    id: "Q-293", name: "Narrative test", customer: "Walk-in", customerId: null, owner: "Pat Estimator", preparedBy: "",
    updatedAt: AT, createdAt: AT, revisions: [], quoteNote: "Cover note.", assumptions: "Assume access.", paymentTerms: "Net 30",
    spec: { sections: opts.sections ?? qd293Sections(), ...(opts.groups !== undefined ? { groups: opts.groups } : {}), ...(opts.document !== undefined ? { document: opts.document } : {}) },
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

/** Estimator Phase 2b — quotes WITHOUT alternates (groups all In total, the
 *  P2a fixtures, print + web, sectioned, appendix, options off, a portal POR
 *  line): the Alternates work must leave every one byte-for-byte as it was.
 *  scripts/qdp2b-baseline.ts wrote their pre-change render once. */
export function qdP2bNoAltCases(): Record<string, QuoteDocumentProps> {
  const G = [{ id: "g-a", name: "Stage", alternate: false }, { id: "g-b", name: "House", alternate: false }];
  const grouped = (): SpecSection[] => qd293Sections().map((s) => (s.id === "s2" || s.id === "s3" ? { ...s, groupId: "g-a" } : s.id === "s4" ? { ...s, groupId: "g-b" } : s));
  const por = (): SpecSection[] => qd293Sections().map((s) => (s.id === "s1" ? { ...s, items: [...s.items, line(9, { por: true, price: 0 })] } : s));
  return {
    groupedPrint: qd293Props({ sections: grouped(), groups: G }),
    groupedWeb: { ...qd293Props({ sections: grouped(), groups: G }), layout: "web" },
    groupedSectioned: qd293Props({ sections: grouped(), groups: G, pdfOptions: { detail: "sectioned" } }),
    groupedAppendix: qd293Props({ sections: grouped(), groups: G, pdfOptions: { pdfItemizedAppendix: true } }),
    groupedOptionsOff: qd293Props({ sections: grouped(), groups: G, pdfOptions: { pdfOptions: false } }),
    portalPor: { ...qd293Props({ sections: por() }), isPortalCatalog: true },
    ungroupedWeb: { ...qd293Props(), layout: "web" },
  };
}

/** Estimator Phase 5 — quotes WITHOUT a package document: every #293 / #P2b
 *  case plus key products with photos (print + web), alternates and the
 *  appendix. The document work must leave each one byte-for-byte as it was;
 *  scripts/qdp5-baseline.ts wrote their pre-change render once. */
export function qdP5NoDocCases(): Record<string, QuoteDocumentProps> {
  const G = [{ id: "g-a", name: "Stage", alternate: false }, { id: "g-x", name: "Upgrades", alternate: true }];
  const withKp = (): SpecSection[] =>
    qd293Sections().map((s) =>
      s.id === "s2"
        ? { ...s, keyProducts: [{ lineKey: "5", sku: "SKU-5", text: "Five para.\n\n- a\n- b", photo: true }, { lineKey: "6", sku: "SKU-6", text: "Six para.", photo: false }] }
        : s
    );
  const alt = { id: "a1", name: "LED Upgrade", kind: "materials", mfr: "", freightPct: 0, groupId: "g-x", presentation: "narrative", narrative: "Alt intro.", items: [line(11)] } as unknown as SpecSection;
  const grouped = (): SpecSection[] => [...withKp().map((s) => (s.id === "s2" ? { ...s, groupId: "g-a" } : s)), alt];
  const photos = { "SKU-5": { src: "data:image/png;base64,AAAA", alt: "Five" } };
  const out: Record<string, QuoteDocumentProps> = {};
  for (const [k, v] of Object.entries(qd293Cases())) out["p293-" + k] = v;
  for (const [k, v] of Object.entries(qdP2bNoAltCases())) out["p2b-" + k] = v;
  out.keyProductsPrint = { ...qd293Props({ sections: withKp() }), keyProductPhotos: photos };
  out.keyProductsWeb = { ...qd293Props({ sections: withKp() }), keyProductPhotos: photos, layout: "web" };
  out.alternatesPrint = { ...qd293Props({ sections: grouped(), groups: G }), keyProductPhotos: photos };
  out.alternatesWebAppendix = { ...qd293Props({ sections: grouped(), groups: G, pdfOptions: { pdfItemizedAppendix: true } }), keyProductPhotos: photos, layout: "web" };
  out.sectionedAppendix = qd293Props({ sections: withKp(), pdfOptions: { detail: "sectioned", pdfItemizedAppendix: true } });
  return out;
}
