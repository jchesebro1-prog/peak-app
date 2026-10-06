import type { PackageSkuDocs } from "@/lib/part-docs/package";
import type { ResponseScope } from "./responses";

/**
 * #301 slice C — what fills the package page's Slice B mount points, as
 * plain view models (hrefs, names, labels — never a blob path, a gap or a
 * record). Pure and client-safe. Built server-side by package-extras.ts.
 */

export type DatasheetLinkView = { href: string; name: string };
export type PackageDownloadsView = { zipHref: string; files: Array<{ href: string; name: string; kindLabel: string }>; specifications: boolean };
export type PackagePlanView = { href: string; name: string; kindLabel: string; sizeLabel: string; isImage: boolean };
export type PackageActionsView = { scopes: ResponseScope[] };
export type PackageExtras = {
  /** key-product sku → its datasheet link (keyProductExtra). */
  datasheets: Record<string, DatasheetLinkView>;
  downloads: PackageDownloadsView | null;
  plans: PackagePlanView[];
  /** Present only when the page may act (canAct) — package-slots decides. */
  actions: PackageActionsView | null;
};

export const EMPTY_EXTRAS: PackageExtras = { datasheets: {}, downloads: null, plans: [], actions: null };

export function packageDocHref(base: string, docId: string): string {
  return `${base}/doc/${encodeURIComponent(docId)}`;
}

export function datasheetLinks(bySku: ReadonlyMap<string, Pick<PackageSkuDocs, "datasheet">>, base: string): Record<string, DatasheetLinkView> {
  const out: Record<string, DatasheetLinkView> = {};
  for (const [sku, d] of bySku) if (d.datasheet) out[sku] = { href: packageDocHref(base, d.datasheet.documentId), name: d.datasheet.name };
  return out;
}
