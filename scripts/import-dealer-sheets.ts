/**
 * Import the converted dealer price sheets into the catalog (D117).
 *
 *   1. python3 scripts/convert-dealer-sheets.py /path/to/dealer-import-data.json
 *   2. STOP the dev server (PGlite is single-writer on .data/pglite) + back up .data
 *   3. npx tsx scripts/import-dealer-sheets.ts /path/to/dealer-import-data.json
 *      (DATABASE_URL=… for the hosted catalog)
 *
 * Upserts are idempotent (SKU is the doc id — re-running edits in place),
 * flagged rows carry `note`, nothing is deleted. Unlike import-catalog.ts's
 * raw upsert (a full-replace), each row here goes through mergeUpsert
 * (lib/stores/catalog) — it loads whatever part already exists for that SKU
 * and overlays only the fields this sheet actually carries. So re-importing
 * an already-catalogued SKU (a dealer sheet legitimately re-pricing an
 * identical Brand:Model SKU) only touches desc/category/unit/list/cost/mfr/
 * note; anything added since the original import — ports, trade, a
 * datasheet attachment, etc. — survives untouched instead of being wiped by
 * a bare full-replace.
 */
import { readFileSync } from "node:fs";
import { getDb } from "../src/db";
import { mergeUpsert, type CatalogPart } from "../src/lib/stores/catalog";

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
    await mergeUpsert(p.sku, p);
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
