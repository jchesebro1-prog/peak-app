/**
 * The Catalog page importer's body (PUNCHLIST #132, #133, #134), split from
 * the server action so the regression harness can drive it without a
 * session: `importCatalog` in ./actions.ts only parses FormData and turns a
 * result into the #111 redirect. Server-only (reads/writes the catalog
 * store); never import it into a client component.
 */
import { mfrKey } from "@/lib/catalog-books";
import { checkManufacturer, checkSize } from "@/lib/catalog-import-guard";
import { setPriceListEffective } from "@/lib/settings";
import { list as listCatalog, mergeUpsert, type CatalogProductMetadata, type CatalogPart } from "@/lib/stores/catalog";
import { importResolverFor } from "@/lib/stores/catalog-renames";
import { looksLikeSpecId, resolveArticleRef, resolveSectionRef } from "@/lib/specs/articles";
import { allSections } from "@/lib/stores/spec-sections";
import { allArticles } from "@/lib/stores/spec-articles";
import { fabricFieldsOf, parseCatalog } from "./parse";

export type CatalogImportInput = {
  /** Manufacturer as picked/typed; the guard normalizes it to an existing spelling. */
  mfr: string;
  /** The CSV/TSV text — the uploaded file's contents or the paste box. */
  text: string;
  /** Upload size in bytes (`file.size`, or `Buffer.byteLength` of the paste). */
  bytes: number;
  /** Epoch ms — the price list's effective date; stamped as `pricedAt` on rows whose price changes. */
  effectiveAt: number;
  /** Category for rows that leave theirs blank (the upload path passes "Prebuilt system"). */
  defaultCategory: string;
};

export type CatalogImportResult = { ok: true; imported: number; mfr: string } | { ok: false; error: string };

export async function runCatalogImport(input: CatalogImportInput): Promise<CatalogImportResult> {
  const size = checkSize(input.bytes);
  if (!size.ok) return { ok: false, error: size.error };
  if (!input.text.trim()) return { ok: false, error: "No rows found in that file." };

  const parsed = parseCatalog(input.text, input.defaultCategory);
  if (!parsed.ok) return { ok: false, error: parsed.error || "No rows found in that file." };
  const valid = parsed.rows.filter((r) => r.valid);
  if (valid.length === 0) return { ok: false, error: "No valid rows — the file needs a part-number column (MFR Part #, MFR PN or SKU) and a Description column." };

  // #132 — the guard runs before any upsert, so a rejected file writes nothing.
  const catalog = await listCatalog();
  // #302 — a row keyed by a renamed part's old order number (or by its MFR
  // P/N) updates that part; the guard judges rows by the same resolution.
  const resolve = await importResolverFor(catalog);
  const guard = checkManufacturer({ mfr: input.mfr, fileSkus: valid.map((r) => r.sku), filePns: valid.map((r) => r.manufacturerPartNumber ?? ""), catalog, resolve });
  if (!guard.ok) return { ok: false, error: guard.detail };
  const mfr = guard.normalizedMfr;

  // Re-importing an already-catalogued SKU must not wipe fields this parse
  // doesn't know about (ports, trade, datasheet, …) — mergeUpsert overlays
  // just the parsed fields. pricedAt lands only on rows whose price moved.
  //
  // A file with no List (resp. Cost) column parses that field as 0, which
  // is NOT "the vendor priced it at zero": the key is left out of the patch
  // for an existing part so its stored price rides along (the same
  // preserve-when-absent rule the Import hub's catalogPatch applies), and
  // only a brand-new part takes the 0 a document needs to be well-formed.
  const existing = new Set(catalog.map((p) => p.id)); // the document id IS the SKU (mergeUpsert's lookup)
  const bySku = new Map<string, CatalogPart>(catalog.map((p) => [p.id, p]));
  // D258: the price-book importer writes the same canonical pointers the
  // Import hub's catalogPatch does. Loaded once for the whole file, not once
  // per row — and (fix wave item 5) not at all for the common price-only
  // file, which carries neither column: the ~37,400-part catalog makes that
  // load pure waste on every price re-import.
  const needsSpecLib = valid.some((r) => r.specSection || r.specArticle);
  let specSections: Awaited<ReturnType<typeof allSections>> = [];
  let specArticles: Awaited<ReturnType<typeof allArticles>> = [];
  if (needsSpecLib) {
    [specSections, specArticles] = await Promise.all([allSections(), allArticles()]);
  }
  const priced = parsed.hasList || parsed.hasCost;
  for (const r of valid) {
    // #302 — write to the RESOLVED live SKU, never the row's old one:
    // the bySku/existing bookkeeping below is keyed by live SKU (and the
    // store's mergeUpsert also lands an old SKU on the renamed part). A row resolving to a different part
    // owns only what an exact match owns — the part's SKU, formerSkus and
    // model # stay (its P/N only moves when the row carries one).
    const resolved = resolve({ sku: r.sku, mfr: r.mfr || mfr, manufacturerPartNumber: r.manufacturerPartNumber });
    const sku = resolved ?? r.sku;
    const sameSku = sku === r.sku;
    const isNew = !existing.has(sku);
    const ex = bySku.get(sku);
    const secId = resolveSectionRef(r.specSection, specSections);
    const artId = resolveArticleRef(r.specArticle, specArticles, secId ?? (ex?.specSectionId || null));
    const artSection = artId ? specArticles.find((a) => a.id === artId)!.sectionId : null;
    const productMetadata: CatalogProductMetadata = {
      // A resolved pointer is canonical (handled below) and never also
      // stored as legacy Displays text; an unresolved one is kept exactly as
      // 2e284665's columns stored it, so no imported value is lost — UNLESS
      // it's shaped like a dead pointer id, which is dropped instead of
      // being written as legacy text (fix wave item 3; see looksLikeSpecId).
      ...(r.specSection && !secId && !looksLikeSpecId(r.specSection) ? { specSection: r.specSection } : {}),
      ...(r.specArticle && !artId && !looksLikeSpecId(r.specArticle) ? { specArticle: r.specArticle } : {}),
      ...(r.researchStatus === "researched" || r.researchStatus === "needs-review" ? { researchStatus: r.researchStatus } : {}),
      ...((r.manufacturerUrl || r.sourceDocumentName || r.sourceDocumentDate)
        ? {
            source: {
              ...(r.manufacturerUrl ? { manufacturerUrl: r.manufacturerUrl } : {}),
              ...(r.sourceDocumentName ? { sourceDocumentName: r.sourceDocumentName } : {}),
              ...(r.sourceDocumentDate ? { sourceDocumentDate: Date.parse(r.sourceDocumentDate) || null } : {}),
            },
          }
        : {}),
      ...((r.datasheetUrl || r.guideSpecUrl)
        ? {
            datasheets: [
              ...(r.datasheetUrl ? [{ kind: "datasheet" as const, fileName: "", sourceUrl: r.datasheetUrl }] : []),
              ...(r.guideSpecUrl ? [{ kind: "guide-spec" as const, fileName: "", sourceUrl: r.guideSpecUrl }] : []),
            ],
          }
        : {}),
    };
    await mergeUpsert(
      sku,
      {
        desc: r.desc,
        category: r.category || "Uncategorized",
        unit: r.unit,
        ...(parsed.hasList ? { list: r.list } : {}),
        ...(parsed.hasCost ? { cost: r.cost } : {}),
        mfr: r.mfr || mfr,
        ...(r.manufacturerPartNumber ? { manufacturerPartNumber: r.manufacturerPartNumber } : {}),
        ...(r.manufacturerModelNumber && sameSku ? { manufacturerModelNumber: r.manufacturerModelNumber } : {}),
        ...(parsed.hasMap || isNew ? { mapPrice: r.mapPrice || null } : {}),
        // #227 — only a carried, positive rate/bolt width is written.
        ...fabricFieldsOf(r),
        ...(Object.keys(productMetadata).length ? { productMetadata } : {}),
        // Fix wave item 4 — when Spec Section and Spec Article both resolve
        // but disagree, the ARTICLE's own section wins (same mirror rule as
        // the Import hub's catalogPatch).
        ...(artSection ? { specSectionId: artSection } : secId ? { specSectionId: secId } : {}),
        ...(artId ? { specArticleId: artId } : {}),
      },
      { pricedAt: input.effectiveAt }
    );
    existing.add(sku);
  }
  // D156: the file's effective date is the manufacturer's price-list date —
  // it confirms the unchanged rows too, not just the ones whose price moved.
  // But a file that carried no price column confirmed no price at all, so it
  // must not re-date the book (final review item 3).
  if (priced) await setPriceListEffective(mfrKey(mfr), input.effectiveAt);
  return { ok: true, imported: valid.length, mfr };
}
