/**
 * The customer preview's "Show on PDF" choices (#222), saved on the quote as
 * `pdfOptions` so the stored PDF is reproducible from saved data alone. Pure
 * and client-safe. The boolean named `pdfOptions` inside is the existing
 * "Options" toggle (option-flagged lines) — the name predates this object.
 */
export type QuotePdfOptions = {
  detail: "itemized" | "sectioned";
  pdfQty: boolean;
  pdfNotes: boolean;
  pdfPrices: boolean;
  pdfCover: boolean;
  pdfTerms: boolean;
  pdfOptions: boolean;
};

export const PDF_TOGGLE_KEYS = ["pdfQty", "pdfNotes", "pdfPrices", "pdfCover", "pdfTerms", "pdfOptions"] as const;

export const DEFAULT_PDF_OPTIONS: QuotePdfOptions = {
  detail: "itemized",
  pdfQty: true,
  pdfNotes: true,
  pdfPrices: true,
  pdfCover: true,
  pdfTerms: true,
  pdfOptions: true,
};

export function normalizePdfOptions(raw: unknown): QuotePdfOptions {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: QuotePdfOptions = { ...DEFAULT_PDF_OPTIONS, detail: o.detail === "sectioned" ? "sectioned" : "itemized" };
  for (const k of PDF_TOGGLE_KEYS) {
    const v = o[k];
    if (typeof v === "boolean") out[k] = v;
  }
  return out;
}
