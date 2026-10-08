import type { PackageDocument, PackageSkuDocs } from "@/lib/part-docs/package";
import { displayQuoteNumber, type QuoteNumberFields } from "@/lib/estimate-number";
import { documentRevStamp } from "@/lib/quote-pdf/state";
import { formatBytes } from "@/lib/document-files";
import { cleanPackageFiles, isPackageFileId, PACKAGE_FILE_KIND_LABEL, visiblePackageFiles, type PackageFile, type PackageFileRow } from "./package-files";
import type { DatasheetLinkView, PackagePlanView } from "./package-extras-model";

/**
 * Estimator Phase 4 (spec §11.1) — the staff preview of what the client gets:
 * the package page, BOM and cut sheets at /estimator-preview/[id], plus the
 * Customer review step's Datasheets / Drawings rows. Pure and client-safe:
 * every link here is a STAFF route (signed-in only) — never a share token,
 * a `/share/` path or a blob path. The server halves live in
 * package-live-loader.ts and estimator/review-actions.ts.
 */

export const PREVIEW_COPY = {
  actionsNote: "Client scope choices and questions appear here on the client's page.",
  noCurtains: "This estimate has no curtains.",
} as const;

export type PreviewTab = "package" | "bom" | "cutsheets";

/** `?tab=` → the tab; anything else → the package page (the default). */
export function previewTab(raw: string | string[] | undefined): PreviewTab {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "bom" || v === "cutsheets" ? v : "package";
}

/** `/estimator-preview/<id>?tab=…` — `view=bom` only on the package tab (its own Narrative / BOM toggle). */
export function previewPath(quoteId: string, tab: PreviewTab = "package", view: "narrative" | "bom" = "narrative"): string {
  const q = `?tab=${tab}${tab === "package" && view === "bom" ? "&view=bom" : ""}`;
  return `/estimator-preview/${encodeURIComponent(quoteId)}${q}`;
}

/** The staff part-document viewer (signed-in only). */
export function staffPartDocHref(docId: string): string {
  return `/api/part-documents/${encodeURIComponent(docId)}`;
}

/** The staff package-file route (signed-in only; the quote's own visible files). */
export function staffPackageFileHref(quoteId: string, fileId: string): string {
  return `/api/quotes/${encodeURIComponent(quoteId)}/package-files/${encodeURIComponent(fileId)}`;
}

/** The staff file route's rule: a file of THIS quote's own stored list that
 *  the client would see (an upload hides a Grid file of its kind), else null. */
export function staffPackageFile(packageFiles: unknown, fileId: string): PackageFile | null {
  if (!isPackageFileId(fileId)) return null;
  return visiblePackageFiles(cleanPackageFiles(packageFiles)).find((f) => f.id === fileId) ?? null;
}

const chicagoDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });

/** "EST-1005 · Rev 2 · saved Oct 7, 2026" — the SAVED estimate's own Rev and
 *  date (the PDF's rule, documentRevStamp); the client's page prints the sent
 *  revision's stamp instead (onlineHeaderLine), which a draft doesn't have. */
export function previewHeaderLine(
  q: QuoteNumberFields & { id: string; revisions?: readonly unknown[] | null; updatedAt?: number | null; createdAt?: number | null },
): string {
  const s = documentRevStamp(q);
  return `${displayQuoteNumber(q)} · Rev ${s.revNum}${s.revDateMs ? ` · saved ${chicagoDate(s.revDateMs)}` : ""}`;
}

export type StaffDownloadsView = { files: Array<{ href: string; name: string; kindLabel: string }>; specifications: boolean };
export type StaffPackageExtras = {
  /** key-product sku (the line's own, renamed ones too) → its datasheet link. */
  datasheets: Record<string, DatasheetLinkView>;
  /** The client's Downloads card without its zip link; null = no card. */
  downloads: StaffDownloadsView | null;
  plans: PackagePlanView[];
};

type DocsIn = { bySku: ReadonlyMap<string, Pick<PackageSkuDocs, "datasheet">>; moved?: ReadonlyMap<string, string>; documents: readonly Pick<PackageDocument, "documentId" | "name" | "kind">[] };

/**
 * The package page's extras (the share page's loadPackageExtras rules) with
 * staff links: datasheets → the part-document viewer, plans → the staff file
 * route, and no zip. `docs` null (a failed read) leaves the datasheets and
 * Downloads out; the plans still show.
 */
export function staffPackageExtras(docs: DocsIn | null, specifications: boolean, files: readonly PackageFile[], quoteId: string): StaffPackageExtras {
  const datasheets: Record<string, DatasheetLinkView> = {};
  let downloads: StaffDownloadsView | null = null;
  if (docs) {
    for (const [sku, d] of docs.bySku) if (d.datasheet) datasheets[sku] = { href: staffPartDocHref(d.datasheet.documentId), name: d.datasheet.name };
    // #304: the page looks a key product up by its line SKU — a renamed part's old one too.
    for (const [old, live] of docs.moved || []) if (datasheets[live]) datasheets[old] = datasheets[live];
    const shown = docs.documents
      .filter((d) => d.kind === "datasheet" || d.kind === "specsheet")
      .map((d) => ({ href: staffPartDocHref(d.documentId), name: d.name, kindLabel: d.kind === "datasheet" ? "Datasheet" : "Spec sheet" }));
    if (shown.length || specifications) downloads = { files: shown, specifications };
  }
  const plans: PackagePlanView[] = visiblePackageFiles(files).map((f) => ({
    href: staffPackageFileHref(quoteId, f.id),
    name: f.name,
    kindLabel: PACKAGE_FILE_KIND_LABEL[f.kind],
    sizeLabel: formatBytes(f.size),
    isImage: f.contentType !== "application/pdf",
  }));
  return { datasheets, downloads, plans };
}

// ---- The Customer review step's Datasheets / Drawings tabs ----

export type DocLinkView = { href: string; name: string };
export type ReviewDatasheetRow = {
  sku: string;
  label: string;
  datasheet: DocLinkView | null;
  /** Fixture SKUs whose datasheet covers this part on this estimate. */
  datasheetCoveredBy: string[];
  /** True when no datasheet is needed (own, covered, or marked not needed). */
  datasheetOk: boolean;
  specsheet: DocLinkView | null;
  manual: DocLinkView | null;
};
export type ReviewDrawingRow = { id: string; name: string; kindLabel: string; sizeLabel: string; href: string };
export type ReviewDocsView = { datasheets: ReviewDatasheetRow[]; drawings: ReviewDrawingRow[]; gaps: string[] };

const docLink = (d: { documentId: string; name: string } | null): DocLinkView | null => (d ? { href: staffPartDocHref(d.documentId), name: d.name } : null);

/** Every printed catalog part (the package BOM's order, one row per SKU) with its document state. */
export function reviewDatasheetRows(bom: ReadonlyArray<{ sku: string; desc: string }>, bySku: ReadonlyMap<string, PackageSkuDocs>): ReviewDatasheetRow[] {
  const out: ReviewDatasheetRow[] = [];
  const seen = new Set<string>();
  for (const r of bom) {
    const d = bySku.get(r.sku);
    if (!d || seen.has(r.sku)) continue;
    seen.add(r.sku);
    out.push({
      sku: r.sku,
      label: (r.desc || "").trim() || r.sku,
      datasheet: docLink(d.datasheet),
      datasheetCoveredBy: [...d.datasheetCoveredBy],
      datasheetOk: d.datasheetOk,
      specsheet: docLink(d.specsheet),
      manual: docLink(d.manual),
    });
  }
  return out;
}

/** The drawings the client sees (an upload hides a Grid file of its kind), linked to the staff file route. */
export function reviewDrawingRows(quoteId: string, rows: readonly PackageFileRow[]): ReviewDrawingRow[] {
  return rows.filter((r) => !r.hidden).map((r) => ({ id: r.id, name: r.name, kindLabel: r.kindLabel, sizeLabel: r.sizeLabel, href: staffPackageFileHref(quoteId, r.id) }));
}
