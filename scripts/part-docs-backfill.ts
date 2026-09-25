/**
 * Legacy datasheet backfill (#DOC, spec §5): every part still carrying the
 * old `datasheetBlobKey` gets a shared `part_documents` row (source
 * "legacy") and a link. The Datasheets page runs the same idempotent step on
 * every read; this is the explicit, reportable version.
 *
 *   npm run part-docs:backfill              → report, writes nothing
 *   npm run part-docs:backfill -- --commit  → write (hosted also needs --yes)
 */
import { resolveDbTarget, requireHostedConfirmation } from "./db-target";
import { list as allParts } from "../src/lib/stores/catalog";
import { backfillLegacyDatasheets, legacyDocumentId } from "../src/lib/part-docs/legacy";
import { allDocuments } from "../src/lib/stores/part-documents";

const args = process.argv.slice(2);
const commit = args.includes("--commit");

async function main() {
  const { hosted } = resolveDbTarget(commit ? "part-docs:backfill (WRITE)" : "part-docs:backfill (read-only)");
  if (commit) requireHostedConfirmation(hosted, args);
  const parts = (await allParts()).filter((p) => !!p.datasheetBlobKey);
  const known = new Set((await allDocuments()).map((d) => d.id));
  const pending = parts.filter((p) => !known.has(legacyDocumentId(p.sku)));
  console.log(`\n  parts with a legacy datasheet  ${parts.length}`);
  console.log(`  not yet backfilled             ${pending.length}\n`);
  if (!commit) {
    console.log("  Report only. To write: npm run part-docs:backfill -- --commit\n");
    return;
  }
  const r = await backfillLegacyDatasheets(pending);
  console.log(`  WROTE ${r.created} legacy document(s) + link(s).\n`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
