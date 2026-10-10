/**
 * One-time paced re-check of backfill-derived venue verifications (D724).
 *
 *   DATABASE_URL=... npm run geo:recheck-venues                  → dry run, writes nothing
 *   DATABASE_URL=... npm run geo:recheck-venues -- --apply --yes → write (hosted needs --yes)
 *   PGLITE_PATH=<scratch dir> npm run geo:recheck-venues          → a local copy
 *   ... -- --limit 50                                              → only the first 50 (by id)
 *
 * The target must be named explicitly — DATABASE_URL or PGLITE_PATH in the
 * environment of this command. It never falls back to .env.local or the dev
 * database (.data/pglite is single-process; never run this while `next dev`
 * holds it).
 *
 * Re-geocodes every venue that is verified only because the one-time backfill
 * said so (verified + source geocode + no verified-at) at ≤ 1 Nominatim
 * request per second, through the venue path's own gates. A venue whose hit
 * fails geocodedStatus — or lands more than 0.5 mi from the stored point — is
 * downgraded to needs_check (coordinates untouched); a confirmed one is
 * stamped verified-at so a re-run skips it; an outage leaves the row for the
 * next run. Pins and human verifications are never touched. ≈ 1.1–1.5 s per
 * venue: about 25–30 minutes for the production book.
 */
import { requireHostedConfirmation, resolveDbTarget } from "./db-target";
import { recheckBackfilledVenues } from "../src/lib/address-verify/venue-recheck";

const args = process.argv.slice(2);
const apply = args.includes("--apply");

function limitArg(): number | undefined {
  const i = args.indexOf("--limit");
  if (i < 0) return undefined;
  const n = Number(args[i + 1]);
  if (!Number.isInteger(n) || n <= 0) {
    console.error("\n  --limit needs a positive whole number: --limit 50\n");
    process.exit(1);
  }
  return n;
}

async function main(): Promise<void> {
  // Explicit target only: checked BEFORE .env.local is read, so a forgotten
  // .env.local value can never pick the database for a write.
  if (!process.env.DATABASE_URL && !process.env.PGLITE_PATH) {
    console.error(
      "\nRefusing to run without an explicit database target.\n" +
        "Set DATABASE_URL (hosted) or PGLITE_PATH (a local PGlite directory) for this command.\n"
    );
    process.exit(1);
  }
  const limit = limitArg();
  const { hosted } = resolveDbTarget(apply ? "geo:recheck-venues --apply" : "geo:recheck-venues (dry run)");
  if (apply) requireHostedConfirmation(hosted, args);

  const started = Date.now();
  const report = await recheckBackfilledVenues({
    apply,
    limit,
    onProgress: (done, total) => {
      if (done % 50 === 0 || done === total) console.log(`  ${done}/${total} checked (${Math.round((Date.now() - started) / 1000)} s)`);
    },
  });

  for (const c of report.changes.filter((x) => x.to === "needs_check")) {
    console.log(`  needs_check  ${c.id}  ${c.address}  — ${c.reason}`);
  }
  console.log(
    `\n${apply ? "Applied" : "Dry run"}: ${report.candidates} backfill-verified venue(s); ` +
      `${report.confirmed} confirmed, ${report.downgraded} ${apply ? "downgraded" : "would be downgraded"} to needs_check, ` +
      `${report.outage} skipped (geocoder unavailable — re-run later)` +
      (report.raced ? `, ${report.raced} changed meanwhile (left alone)` : "") +
      "."
  );
  if (!apply && report.candidates) console.log("Nothing was written. Re-run with --apply (and --yes for a hosted database) to write.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
