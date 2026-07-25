/**
 * Import the converted dealer price sheets into the catalog (D117).
 *
 *   1. python3 scripts/convert-dealer-sheets.py /path/to/dealer-import-data.json
 *   2. STOP the dev server (PGlite is single-writer on .data/pglite) + back up .data
 *   3. npx tsx scripts/import-dealer-sheets.ts /path/to/dealer-import-data.json
 *      (DATABASE_URL=… for the hosted catalog)
 *
 * Same contract as import-catalog.ts: upserts are idempotent (SKU is the doc
 * id — re-running edits in place), flagged rows carry `note`, nothing is
 * deleted. The existing 10.7k-part price book is untouched except where a
 * dealer sheet legitimately re-prices an identical Brand:Model SKU.
 */
import { readFileSync } from "node:fs";
import { getDb } from "../src/db";
import { upsert, type CatalogPart } from "../src/lib/stores/catalog";

type ImportPart = Omit<CatalogPart, "id">;

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: npx tsx scripts/import-dealer-sheets.ts <dealer-import-data.json>");
    process.exit(1);
  }
  await getDb(); // ensure DB is up + migrated before upserting
  const parts: ImportPart[] = JSON.parse(readFileSync(file, "utf8"));
  console.log(`Importing ${parts.length} dealer-sheet parts…`);
  let n = 0;
  let flagged = 0;
  for (const p of parts) {
    await upsert(p);
    n++;
    if (p.note) flagged++;
    if (n % 1000 === 0) console.log(`  …${n}`);
  }
  console.log(`Done: ${n} parts upserted, ${flagged} carrying a "verify" note.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
