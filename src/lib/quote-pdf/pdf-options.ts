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
  /** #293: print every system the body didn't itemize again, in full, after
   *  the signature block. Off by default; absent on older quotes → off. */
  pdfItemizedAppendix: boolean;
  /** #292 — append Client-style curtain cut sheets after the estimate. Off by default. */
  pdfCutSheets: boolean;
  /** #364 — Build package → BOM quote → Show on BOM. The BOM view only (the
   *  BOM tab, BOM PDF, saved preview's BOM and the client's online BOM), never
   *  the estimate PDF, Cover PDF, bidder PDFs or package page. All on by
   *  default; absent on older quotes → on. Line prices still yield to
   *  `pdfPrices` (effective = pdfPrices && bomLinePrices — bomViewProps). */
  bomLinePrices: boolean;
  bomMaterials: boolean;
  bomLabor: boolean;
  bomFreight: boolean;
};

export const PDF_TOGGLE_KEYS = ["pdfQty", "pdfNotes", "pdfPrices", "pdfCover", "pdfTerms", "pdfOptions", "pdfItemizedAppendix", "pdfCutSheets", "bomLinePrices", "bomMaterials", "bomLabor", "bomFreight"] as const;

export const DEFAULT_PDF_OPTIONS: QuotePdfOptions = {
  detail: "itemized",
  pdfQty: true,
  pdfNotes: true,
  pdfPrices: true,
  pdfCover: true,
  pdfTerms: true,
  pdfOptions: true,
  pdfItemizedAppendix: false,
  pdfCutSheets: false,
  bomLinePrices: true,
  bomMaterials: true,
  bomLabor: true,
  bomFreight: true,
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
