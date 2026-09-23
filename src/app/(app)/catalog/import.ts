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
import { list as listCatalog, mergeUpsert, type CatalogProductMetadata } from "@/lib/stores/catalog";
import { parseCatalog } from "./parse";

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
  if (valid.length === 0) return { ok: false, error: "No valid rows — check the header names." };

  // #132 — the guard runs before any upsert, so a rejected file writes nothing.
  const catalog = await listCatalog();
  const guard = checkManufacturer({ mfr: input.mfr, fileSkus: valid.map((r) => r.sku), catalog });
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
  const priced = parsed.hasList || parsed.hasCost;
  for (const r of valid) {
    const isNew = !existing.has(r.sku);
    const productMetadata: CatalogProductMetadata = {
      ...(r.specSection ? { specSection: r.specSection } : {}),
      ...(r.specArticle ? { specArticle: r.specArticle } : {}),
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
      r.sku,
      {
        desc: r.desc,
        category: r.category || "Uncategorized",
        unit: r.unit,
        ...(parsed.hasList ? { list: r.list } : {}),
        ...(parsed.hasCost ? { cost: r.cost } : {}),
        mfr: r.mfr || mfr,
        ...(r.manufacturerPartNumber ? { manufacturerPartNumber: r.manufacturerPartNumber } : {}),
        ...(r.manufacturerModelNumber ? { manufacturerModelNumber: r.manufacturerModelNumber } : {}),
        ...(parsed.hasMap || isNew ? { mapPrice: r.mapPrice || null } : {}),
        ...(Object.keys(productMetadata).length ? { productMetadata } : {}),
      },
      { pricedAt: input.effectiveAt }
    );
    existing.add(r.sku);
  }
  // D156: the file's effective date is the manufacturer's price-list date —
  // it confirms the unchanged rows too, not just the ones whose price moved.
  // But a file that carried no price column confirmed no price at all, so it
  // must not re-date the book (final review item 3).
  if (priced) await setPriceListEffective(mfrKey(mfr), input.effectiveAt);
  return { ok: true, imported: valid.length, mfr };
}
