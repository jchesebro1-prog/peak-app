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
import { list as listCatalog, mergeUpsert } from "@/lib/stores/catalog";
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
  const guard = checkManufacturer({ mfr: input.mfr, fileSkus: valid.map((r) => r.sku), catalog: await listCatalog() });
  if (!guard.ok) return { ok: false, error: guard.detail };
  const mfr = guard.normalizedMfr;

  // Re-importing an already-catalogued SKU must not wipe fields this parse
  // doesn't know about (ports, trade, datasheet, …) — mergeUpsert overlays
  // just the parsed fields. pricedAt lands only on rows whose price moved.
  for (const r of valid) {
    await mergeUpsert(
      r.sku,
      { desc: r.desc, category: r.category || "Uncategorized", unit: r.unit, list: r.list, cost: r.cost, mfr },
      { pricedAt: input.effectiveAt }
    );
  }
  // D156: the file's effective date is the manufacturer's price-list date —
  // it confirms the unchanged rows too, not just the ones whose price moved.
  await setPriceListEffective(mfrKey(mfr), input.effectiveAt);
  return { ok: true, imported: valid.length, mfr };
}
