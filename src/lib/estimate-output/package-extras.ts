import type { SharedPackage } from "@/lib/quote-share/links";
import { revisionPackageDocs } from "./package-docs-server";
import { specReadyFor } from "./package-spec-ready";
import { allSections } from "@/lib/stores/spec-sections";
import { cleanPackageFiles } from "./package-files";
import { responseScopes } from "./responses";
import { revisionGroupedSections } from "@/lib/quote-share/photo-response";
import { datasheetLinks, downloadsView, EMPTY_EXTRAS, plansView, type PackageExtras } from "./package-extras-model";

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
    // #304: the page looks a key product up by its line SKU — a renamed part's old one too.
    for (const [old, live] of docs.moved) if (extras.datasheets[live]) extras.datasheets[old] = extras.datasheets[live];
    const specReady = specReadyFor(docs.parts, await allSections());
    extras.downloads = downloadsView(docs.documents, specReady, base);
  } catch (e) {
    console.warn("[package] documents unavailable", e instanceof Error ? e.message : e);
  }
  // R12 — the pinned revision's frozen list only, never the live quote's.
  extras.plans = plansView(cleanPackageFiles(hit.rev.docFields?.packageFiles), base);
  // The choosable scopes (ids, names, prices) — the forms show only when the page can act (package-slots).
  // Phase 2b: alternate systems follow the In-total scopes, unticked by default (scope-selection).
  const { sections, groups } = revisionGroupedSections(hit.rev);
  extras.actions = { scopes: responseScopes(sections, groups) };
  return extras;
}
