/* #348 slice 6 Task 3 (Jeff 2026-10-15) — the owner's portal on a bid estimate: "just a BOM without a price on
   anything". Pure: one block per printed system of the chosen SENT revision (its frozen spec), rows from the #301
   package BOM (packageBomRows — PackageBomRow has no money field). Alternates are left out, as on the package page's
   scopes. The catalog read is portal-bid-server's portalOwnerBom (the package page's catalogFor). */
import type { SpecSection, VendorQuote } from "@/app/(app)/estimator/types";
import { systemPrintsInBody } from "@/app/(app)/estimator/quote-document-view";
import { normalizeSystemOrder, sanitizeGroups } from "@/lib/estimate-groups/groups";
import { packageBomRows, packageBomSkus, type BomCatalogPart, type PackageBomRow } from "@/lib/estimate-output/bom";
import { normalizePdfOptions } from "@/lib/quote-pdf/pdf-options";
import { onlineHeaderLine } from "@/lib/quote-share/view";
import type { Quote, QuoteRevision } from "@/lib/stores/quotes";

export type OwnerBomSystem = { id: string; name: string; rows: PackageBomRow[] };
export type OwnerBom = {
  /** The revision's own name (never a later live rename). */
  title: string;
  /** "EST-1005 · Rev 2 · sent Oct 1, 2026" — the Rev and date the sent document printed. */
  headerLine: string;
  /** "Prepared for <owner company>". */
  preparedFor: string;
  /** False when the estimate's Qty is off — the rows then carry no quantity and the view drops the column. */
  showQty: boolean;
  systems: OwnerBomSystem[];
};

type BomRev = Pick<QuoteRevision, "rev" | "at" | "name" | "spec" | "vendorQuotes" | "docFields" | "pdfSavedAt">;

/** The revision's printed systems, in print order: never an Alternate, never a system that prints nothing. */
export function ownerBomSections(rev: Pick<QuoteRevision, "spec">): SpecSection[] {
  const spec = (rev.spec || null) as { sections?: unknown; groups?: unknown } | null;
  const raw = spec && Array.isArray(spec.sections) ? (spec.sections as SpecSection[]) : [];
  return normalizeSystemOrder(raw, sanitizeGroups(spec?.groups)).filter((sec) => !!sec && sec.alternate !== true && systemPrintsInBody(sec));
}

/** The skus the owner's BOM needs from the catalog. */
export function ownerBomSkus(rev: Pick<QuoteRevision, "spec">): string[] {
  return packageBomSkus(ownerBomSections(rev));
}

/** The owner's BOM. With the estimate's Qty off the rows carry no quantities, as on the package page. */
export function ownerBom(
  q: Pick<Quote, "id" | "estNo" | "estSuffix" | "quoteType" | "revisions" | "pdfOptions" | "name">,
  rev: BomRev,
  catalog: ReadonlyMap<string, BomCatalogPart>,
  preparedFor: string
): OwnerBom {
  const vendorQuotes = (Array.isArray(rev.vendorQuotes) ? (rev.vendorQuotes as VendorQuote[]) : []).filter((v) => !!v && typeof v.id === "string");
  // The revision's frozen Show-on-PDF choices when it has them (quoteAsOfRevision's rule), else the live ones.
  const df = rev.docFields as { pdfOptions?: unknown } | undefined;
  const showQty = normalizePdfOptions(df && "pdfOptions" in df ? df.pdfOptions : q.pdfOptions).pdfQty !== false;
  return {
    title: (rev.name || q.name || "").trim(),
    headerLine: onlineHeaderLine(q, rev),
    preparedFor: (preparedFor || "").trim(),
    showQty,
    systems: ownerBomSections(rev).map((sec) => ({
      id: sec.id,
      name: sec.name || "",
      // Jeff 2026-10-15: a vendor-quoted line shows its description only — no vendor name, no vendor quote #.
      rows: packageBomRows(sec, catalog, vendorQuotes, { hideVendor: true }).map((r) => (showQty ? r : { ...r, qty: null, unit: "" })),
    })),
  };
}
