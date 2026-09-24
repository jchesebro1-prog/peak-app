/**
 * DaVinci → catalog enrichment: report, dry run, apply (#162).
 *
 *   npm run davinci:enrich                          → the report, writes nothing
 *   npm run davinci:enrich -- --mfr=ETC              → scope to one manufacturer
 *   npm run davinci:enrich -- --unmatched            → CSV of what did not match
 *   npm run davinci:enrich -- --apply                → dry run, writes nothing
 *   npm run davinci:enrich -- --apply --commit       → write (hosted also needs --yes)
 *
 * DRY RUN IS THE DEFAULT. `--commit` says "I want to write"; `--yes` says "I
 * know this is the live database". They are separate because preview and
 * production share one Neon database — see scripts/db-target.ts.
 */
import { resolveDbTarget, requireHostedConfirmation } from "./db-target";
import { planEnrichment, applyEnrichment } from "../src/lib/catalog-davinci-apply";

const args = process.argv.slice(2);
const mfr = (args.find((a) => a.startsWith("--mfr=")) || "").slice(6) || undefined;
const commit = args.includes("--commit");
const force = args.includes("--force");
const n = (x: number) => x.toLocaleString("en-US");

async function main() {
  const { hosted } = resolveDbTarget(commit ? "davinci:enrich (WRITE)" : "davinci:enrich (read-only)");
  if (commit) requireHostedConfirmation(hosted, args);

  const { plans, stats } = await planEnrichment({ mfr, force });

  if (args.includes("--unmatched")) {
    console.log("sku");
    for (const s of stats.unmatched) console.log(s);
    return;
  }

  console.log(`\n  scanned              ${n(stats.scanned)}${mfr ? ` (mfr=${mfr})` : ""}`);
  console.log(`  matched DaVinci      ${n(stats.matched)}`);
  console.log(`  writable             ${n(stats.writable)}`);
  console.log(`  skipped, has ports   ${n(stats.skippedHasPorts)}${force ? " (overridden by --force)" : ""}`);
  console.log(`  skipped, nothing new ${n(stats.skippedNothingToWrite)}`);
  console.log(`  unmatched            ${n(stats.unmatched.length)}   (--unmatched for the list)\n`);

  const sample = plans.filter((p) => !p.skip).slice(0, 15);
  for (const p of sample) {
    const ports = p.ports.map((x) => `${x.name || "?"}[${x.direction}:${x.connectionType}]`).join("; ");
    console.log(`  ${p.sku.padEnd(28)} ${p.displayName}`);
    console.log(`      ports: ${ports || "(none)"}`);
    console.log(`      docs : ${p.docs.length}`);
  }
  if (stats.writable > sample.length) console.log(`  … and ${n(stats.writable - sample.length)} more`);

  if (!args.includes("--apply")) {
    console.log(`\n  Report only. To apply: npm run davinci:enrich -- --apply --commit`);
    console.log(`  (a hosted DATABASE_URL target also needs --yes)\n`);
    return;
  }
  const res = await applyEnrichment(plans, { commit });
  if (!commit) {
    console.log(`\n  DRY RUN — nothing written. ${n(stats.writable)} rows would change. Add --commit.\n`);
  } else {
    console.log(`\n  WROTE ${n(res.written)} rows.`);
    // A plan's catalog row can vanish between planning and applying (deleted
    // out from under this run). applyEnrichment counts that gap as `missing`
    // rather than creating a row for it (the feature's hard constraint: never
    // create a catalog row) — surfaced here so "planned" vs "written" never
    // diverges silently, which is exactly what this report exists to prevent.
    if (res.missing) console.log(`  ${n(res.missing)} plan(s) skipped — catalog row no longer exists.`);
    console.log("");
  }
}

main().then(
  () => process.exit(0),
  (e) => { console.error(e); process.exit(1); }
);
