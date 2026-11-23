import type { CatalogPart } from "@/lib/stores/catalog";

/** Spec fields carried on a catalog part (D94, extended by #205) — declared on
 *  CatalogPart itself; this alias names the slice. Moved here from the removed
 *  bid-spec generator. */
export type PartSpecFields = Pick<
  CatalogPart,
  "specArticleId" | "specSectionId" | "specTitle" | "specBody" | "specSameAs" | "specSort" | "specState" | "specSource"
>;

export type SpecCatalogPart = CatalogPart & PartSpecFields;

/** One line of an equipment list read off a quote. */
export type BomRow = {
  sku: string;
  desc: string;
  qty: number;
  mfrNumber?: string;
  manufacturer?: string;
};
