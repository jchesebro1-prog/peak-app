/**
 * One-time paced re-check of backfill-derived venue verifications (D724).
 *
 *   DATABASE_URL=... npm run geo:recheck-venues                  → dry run, writes nothing
 *   DATABASE_URL=... npm run geo:recheck-venues -- --apply --yes → write (hosted needs --yes)
 *   PGLITE_PATH=<scratch dir> npm run geo:recheck-venues          → a local copy
 *   ... -- --limit 50                                              → only the first 50 (by id)
 *   ... -- --skip reviewed.txt                                     → leave these site ids alone
 *
 * The target must be named explicitly — DATABASE_URL or PGLITE_PATH in the
 * environment of this command. It never falls back to .env.local or the dev
 * database (.data/pglite is single-process; never run this while `next dev`
 * holds it), and with only PGLITE_PATH set a DATABASE_URL from .env.local is
 * ignored.
 *
 * Re-geocodes every venue that is verified only because the one-time backfill
 * said so (verified + source geocode + no verified-at) at ≤ 1 Nominatim
 * request per second, through the venue path's own gates. A venue whose hit
 * fails geocodedStatus — or lands more than 0.5 mi from the stored point — is
 * downgraded to needs_check (coordinates untouched); a confirmed one is
 * stamped verified-at so a re-run skips it; an outage (any failed lookup,
 * including the town-centre lookup) leaves the row for the next run. Pins and
 * human verifications made since #325 are never touched. ≈ 1.1–1.5 s per
 * venue: about 25–30 minutes for the production book.
 *
 * KNOWN LIMIT — review before --apply. Venue pins and suggestion picks made
 * before #325 (the Settings sidebar's Unlocated venues list, #175) stamped
 * no verification fields, so they are indistinguishable from backfill rows:
 * the re-check judges them like any other and may downgrade a hand-placed
 * venue to needs_check. Run the dry run first, review its needs_check list,
 * and save the ids of any venue a human already placed correctly to a file
 * (one per line; the dry run's own "needs_check <id> …" lines may be pasted
 * as-is) — then apply with `--skip <file>` so those are left alone.
 */
import { readFileSync } from "node:fs";
import { requireHostedConfirmation, resolveExplicitDbTarget } from "./db-target";
import { parseRecheckArgs } from "./geo-recheck-args";
import { recheckBackfilledVenues } from "../src/lib/address-verify/venue-recheck";

const args = process.argv.slice(2);

async function main(): Promise<void> {
  const parsed = parseRecheckArgs(args, (p) => readFileSync(p, "utf8"));
  if (!parsed.ok) {
    console.error(`\n  ${parsed.error}\n`);
    process.exit(1);
  }
  const { apply, limit, skipIds, skipFile } = parsed;
  // Explicit target only: checked BEFORE .env.local is read, so a forgotten
  // .env.local value can never pick the database for a write.
  const target = resolveExplicitDbTarget(apply ? "geo:recheck-venues --apply" : "geo:recheck-venues (dry run)");
  if (!target) {
    console.error(
      "\nRefusing to run without an explicit database target.\n" +
        "Set DATABASE_URL (hosted) or PGLITE_PATH (a local PGlite directory) for this command.\n"
    );
    process.exit(1);
  }
  if (apply) requireHostedConfirmation(target.hosted, args);
  if (skipFile) console.log(`  skipping ${skipIds.size} site id(s) from ${skipFile}`);

  const started = Date.now();
  const report = await recheckBackfilledVenues({
    apply,
    limit,
    skipIds,
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
      (report.skipped ? `, ${report.skipped} left alone (--skip)` : "") +
      (report.raced ? `, ${report.raced} changed meanwhile (left alone)` : "") +
      "."
  );
  if (!apply && report.candidates) {
    console.log(
      "Nothing was written. Review the needs_check list above first: a venue pinned or picked by hand before #325 looks\n" +
        "exactly like a backfill row. Save the ids of any that are already right to a file and re-run with\n" +
        "--apply --skip <file> (and --yes for a hosted database)."
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
