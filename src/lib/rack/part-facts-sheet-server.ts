// SERVER ONLY — reads and writes the catalog. Never import from a "use client" file.
import { getMany, mergeUpsert } from "@/lib/stores/catalog";
import { rackFactsOf } from "./part-facts";
import { rackSheetPatch, type RackImportResult, type RackSheetRow } from "./part-facts-sheet";
import { RACK_FACT_KEYS, type RackPartFacts } from "./types";

const WRITE_BATCH = 10;

/**
 * #296 — plan or apply a parsed rack-data sheet. Preview (dryRun) and apply
 * share this one path, so what the preview promised is what Import does.
 * Additive: only the cells that differ from what's saved are written, through
 * mergeUpsert, so everything else on the part rides along untouched.
 */
export async function applyRackRows(rows: readonly RackSheetRow[], opts: { dryRun?: boolean } = {}): Promise<RackImportResult[]> {
  const skus = [...new Set(rows.map((r) => r.sku).filter(Boolean))];
  const parts = skus.length ? await getMany(skus) : [];
  // What each part holds as the sheet is walked, so a SKU listed twice is compared against the first row's write.
  const current = new Map<string, RackPartFacts>(parts.map((p) => [p.sku, rackFactsOf(p)]));
  const results: RackImportResult[] = [];
  const writes = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const base = { line: row.line, sku: row.sku };
    if (!row.sku) {
      results.push({ ...base, status: "invalid", message: "This row has no SKU." });
      continue;
    }
    const have = current.get(row.sku);
    if (!have) {
      results.push({ ...base, status: "unknown-sku", message: "No catalog part has this SKU." });
      continue;
    }
    const patch = rackSheetPatch(row.cells);
    if (!patch.ok) {
      results.push({ ...base, status: "invalid", message: patch.error });
      continue;
    }
    const changed: Record<string, unknown> = {};
    for (const k of RACK_FACT_KEYS) {
      if (!(k in patch.patch)) continue;
      if (patch.patch[k] !== have[k]) changed[k] = patch.patch[k];
    }
    if (!Object.keys(changed).length) {
      results.push({ ...base, status: "unchanged" });
      continue;
    }
    writes.set(row.sku, { ...(writes.get(row.sku) ?? {}), ...changed });
    current.set(row.sku, { ...have, ...changed } as RackPartFacts);
    results.push({ ...base, status: "updated" });
  }
  if (!opts.dryRun) {
    // One write per SKU (a SKU listed twice merges into one), a few at a time so a 5,000-row sheet fits the request budget.
    const todo = [...writes];
    for (let i = 0; i < todo.length; i += WRITE_BATCH) {
      await Promise.all(todo.slice(i, i + WRITE_BATCH).map(([sku, patch]) => mergeUpsert(sku, patch as Partial<RackPartFacts>)));
    }
  }
  return results;
}
