import type { PackageDocument, PackageSkuDocs } from "@/lib/part-docs/package";
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

/** Datasheets and spec sheets only (never manuals — D-l). Nothing to offer → no card. */
export function downloadsView(documents: readonly Pick<PackageDocument, "documentId" | "name" | "kind">[], specifications: boolean, base: string): PackageDownloadsView | null {
  const files = documents
    .filter((d) => d.kind === "datasheet" || d.kind === "specsheet")
    .map((d) => ({ href: packageDocHref(base, d.documentId), name: d.name, kindLabel: d.kind === "datasheet" ? "Datasheet" : "Spec sheet" }));
  if (!files.length && !specifications) return null;
  return { zipHref: `${base}/package.zip`, files, specifications };
}

export function downloadsSummary(v: PackageDownloadsView): string {
  const ds = v.files.filter((f) => f.kindLabel === "Datasheet").length;
  const ss = v.files.length - ds;
  const parts = [ds ? `${ds} datasheet${ds === 1 ? "" : "s"}` : "", ss ? `${ss} spec sheet${ss === 1 ? "" : "s"}` : "", v.specifications ? "Specifications (Word)" : ""];
  return parts.filter(Boolean).join(" · ");
}
