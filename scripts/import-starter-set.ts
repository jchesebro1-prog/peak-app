/**
 * One-off: import the reviewed catalog starter set (punch #39, beta build-out).
 *
 *   npm run dev must be STOPPED first (PGlite is single-writer on .data/pglite).
 *   npx tsx scripts/import-starter-set.ts
 *
 * Reads scripts/starter-import-data.json — the reviewed starter set (Draper
 * excluded, 3 unidentified Biamp rows dropped, verify-flagged manufacturers
 * kept as-is, Network/NDI + RF/antenna ports back-filled — PUNCHLIST.md #39,
 * resolved 2026-08-07). Rows go through mergeUpsert, so re-running re-prices
 * existing SKUs in place while preserving fields this file doesn't carry
 * (datasheet attachments, spec text). Safe to re-run.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { getDb } from "../src/db";
import { mergeUpsert, type CatalogPart } from "../src/lib/stores/catalog";
import { resolveDbTarget, requireHostedConfirmation } from "./db-target";

type ImportPart = Omit<CatalogPart, "id">;

async function main() {
  const { hosted } = resolveDbTarget("catalog starter-set import");
  requireHostedConfirmation(hosted, process.argv);
  await getDb(); // ensure DB is up + migrated before upserting
  const file = path.join(process.cwd(), "scripts", "starter-import-data.json");
  const parts: ImportPart[] = JSON.parse(readFileSync(file, "utf8"));
  console.log(`Importing ${parts.length} starter-set catalog parts…`);

  let n = 0;
  let flagged = 0;
  for (const p of parts) {
    await mergeUpsert(p.sku, p);
    n++;
    if (p.note) flagged++;
  }
  console.log(`Done. Upserted ${n} parts (${flagged} carry a review-flag note).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
