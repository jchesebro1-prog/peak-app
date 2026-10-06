import type { SharedPackage } from "@/lib/quote-share/links";
import { hasPrintableSpec } from "@/lib/specs/articles";
import { revisionPackageDocs } from "./package-docs-server";
import { datasheetLinks, downloadsView, EMPTY_EXTRAS, type PackageExtras } from "./package-extras-model";

/**
 * #301 slice C — the package page's extras for a resolved v2 link: the
 * pinned SENT revision's documents (datasheets per key product and the
 * Downloads card; Task 6 Plans & risers, Task 7 the client actions' scopes).
 * Server-only. Never throws — a failed read leaves that card out.
 */
export async function loadPackageExtras(hit: SharedPackage, base: string): Promise<PackageExtras> {
  const extras: PackageExtras = { ...EMPTY_EXTRAS, datasheets: {}, plans: [] };
  try {
    const docs = await revisionPackageDocs(hit.rev);
    extras.datasheets = datasheetLinks(docs.bySku, base);
    const specReady = docs.parts.some((p) => !!(p as { specSectionId?: string }).specSectionId && hasPrintableSpec(p as { specBody?: string; specState?: "authored" | "draft" }));
    extras.downloads = downloadsView(docs.documents, specReady, base);
  } catch (e) {
    console.warn("[package] documents unavailable", e instanceof Error ? e.message : e);
  }
  return extras;
}
