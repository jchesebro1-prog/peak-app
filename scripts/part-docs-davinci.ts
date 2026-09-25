/**
 * DaVinci → part documents pre-fill: report, dry run, apply (#207, spec §6).
 *
 *   npm run part-docs:davinci                     → the report, writes nothing
 *   npm run part-docs:davinci -- --apply          → dry run, writes nothing
 *   npm run part-docs:davinci -- --apply --commit → write (hosted also needs --yes)
 *
 * Writes link-only datasheet documents (source "davinci", sourceUrl only —
 * nothing is downloaded), their links to ETC parts, and the DaVinci
 * accessory graph. The same write is the Datasheets page's admin
 * "Pre-fill from DaVinci" button. Scoped to ETC like davinci:enrich.
 */
import { resolveDbTarget, requireHostedConfirmation } from "./db-target";
import { applyPrefill, planPrefillFromDavinci } from "../src/lib/part-docs/davinci-apply";

const args = process.argv.slice(2);
const commit = args.includes("--commit");
const n = (x: number) => x.toLocaleString("en-US");

async function main() {
  const { hosted } = resolveDbTarget(commit ? "part-docs:davinci (WRITE)" : "part-docs:davinci (read-only)");
  if (commit) requireHostedConfirmation(hosted, args);
  const plan = await planPrefillFromDavinci();
  const s = plan.stats;
  console.log(`\n  library                ${plan.libraryTimestamp}`);
  console.log(`  ETC parts scanned      ${n(s.parts)}`);
  console.log(`  DaVinci types matched  ${n(s.typesMatched)}`);
  console.log(`  datasheet documents    ${n(s.documents)} (${n(s.documentLinks)} part links)`);
  console.log(`  accessory pairs        ${n(s.accessoryPairs)} (${n(s.accessoryLinksUnmatched)} DaVinci links with no Peak part on one end)\n`);
  if (!args.includes("--apply")) {
    console.log("  Report only. To apply: npm run part-docs:davinci -- --apply --commit");
    console.log("  (a hosted DATABASE_URL target also needs --yes)\n");
    return;
  }
  if (!commit) {
    console.log("  DRY RUN — nothing written. Add --commit.\n");
    return;
  }
  // No time budget here (unlike the admin button): the batched writes run to completion.
  const r = await applyPrefill(plan, "DaVinci pre-fill");
  console.log(`  WROTE ${n(r.documentsCreated)} documents, ${n(r.linksCreated)} links, ${n(r.accessoryWritten)} accessory links (${n(r.accessoryRemoved)} removed).\n`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
