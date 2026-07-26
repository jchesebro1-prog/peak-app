/**
 * One-off: import the cleaned combined price book into the catalog.
 *
 *   npm run dev must be STOPPED first (PGlite is single-writer on .data/pglite).
 *   npx tsx scripts/import-catalog.ts
 *
 * Reads scripts/catalog-import-data.json (produced from Combined.xlsx: deduped,
 * category-inferred, keyed Vendor:Model, both list + cost prices). Rows go
 * through mergeUpsert, so re-running re-prices existing SKUs in place while
 * preserving fields this file doesn't carry (ports, trade, datasheet
 * attachments, spec text). Flagged rows (cost>list or no list price) carry
 * note "verify price". Safe to run against the existing DB.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { getDb } from "../src/db";
import { mergeUpsert, type CatalogPart } from "../src/lib/stores/catalog";

type ImportPart = Omit<CatalogPart, "id">;

async function main() {
  await getDb(); // ensure DB is up + migrated before upserting
  const file = path.join(process.cwd(), "scripts", "catalog-import-data.json");
  const parts: ImportPart[] = JSON.parse(readFileSync(file, "utf8"));
  console.log(`Importing ${parts.length} catalog parts…`);

  let n = 0;
  let flagged = 0;
  for (const p of parts) {
    await mergeUpsert(p.sku, p);
    n++;
    if (p.note) flagged++;
    if (n % 1000 === 0) console.log(`  …${n}/${parts.length}`);
  }
  console.log(`Done. Upserted ${n} parts (${flagged} flagged "verify price").`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
