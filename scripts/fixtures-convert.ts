/**
 * Fixture builder conversion (#FXB, spec 2026-09-25-fixture-builder-merge-design.md §3):
 * settings.fixtureAssemblies + legacy subassembly rows → fixture records
 * (ids kept), and the accessory graph moved to one `fixture:<id>` scope.
 * Idempotent; the app runs the same step on its first read.
 *
 *   npm run fixtures:convert              → report, writes nothing
 *   npm run fixtures:convert -- --commit  → write (hosted also needs --yes)
 */
import { resolveDbTarget, requireHostedConfirmation } from "./db-target";
import { listDocs } from "../src/db/doc-store";
import { getSettingsStrict } from "../src/lib/settings";
import { planFixtureConversion } from "../src/lib/fixtures-convert";
import { convertFixtures, fixturesConverted } from "../src/lib/fixtures-migrate";

const args = process.argv.slice(2);
const commit = args.includes("--commit");

async function main() {
  const { hosted } = resolveDbTarget(commit ? "fixtures:convert (WRITE)" : "fixtures:convert (read-only)");
  if (commit) requireHostedConfirmation(hosted, args);
  const [settings, rows] = await Promise.all([getSettingsStrict(), listDocs("subassemblies")]);
  const plan = planFixtureConversion(settings.fixtureAssemblies, rows, Date.now());
  console.log(`\n  rows in subassemblies            ${rows.length}`);
  console.log(`  assemblies to convert            ${plan.inserts.length}`);
  console.log(`  legacy subassemblies to rewrite  ${plan.rewrites.length}`);
  console.log(`  will need review                 ${plan.inserts.filter((r) => r.needsReview).length}`);
  console.log(`  conversion complete              ${(await fixturesConverted()) ? "yes" : "not yet"}\n`);
  if (!commit) {
    console.log("  Report only. To write: npm run fixtures:convert -- --commit\n");
    return;
  }
  const r = await convertFixtures();
  console.log(
    `  INSERTED ${r.inserted}, REWROTE ${r.rewritten}; graph: ${r.graphWritten} fixture: link(s) written, ` +
      `${r.graphRemoved} legacy link(s) retired — ${r.complete ? "complete" : "INCOMPLETE, run again"}.\n`
  );
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
