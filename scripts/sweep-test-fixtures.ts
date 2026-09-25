/**
 * Sweep leftover spec-suite fixtures out of a database (#149, D233).
 *
 *   npm run test:sweep-fixtures                          → report, writes nothing
 *   npm run test:sweep-fixtures -- --commit              → soft-delete them
 *   npm run test:sweep-fixtures -- --commit --yes        → …on a hosted target
 *   npm run test:sweep-fixtures -- --commit --hard       → remove the rows outright
 *
 * `scripts/test-review-and-spec.ts` tears its own fixtures down now, at suite
 * level as well as per-test. This is the manual equivalent, for the datadir a
 * crashed, killed or pre-#149 run left dirty — and for proving a datadir is
 * clean before trusting a second run on it.
 *
 * A fixture is any doc whose id carries the `TEST<scope>:` marker, plus the
 * rows the suite spawned from one (`quoteId` / `link.id`) — see
 * scripts/test-fixtures.ts for why the marker is shaped that way.
 *
 * DRY RUN IS THE DEFAULT: `--commit` writes, and a hosted target additionally
 * demands `--yes` (scripts/db-target.ts) — the same two-flag convention every
 * other writing script here uses (scripts/port-rules.ts,
 * scripts/enrich-addresses.ts). The two are deliberately separate because all
 * Vercel environments share one Neon database: one flag says "I want to
 * write", the other says "I know this is the live database".
 *
 * Deletes are soft by default, like every other delete path in the app.
 * `--hard` removes the rows, tombstones included, and is refused outright on
 * a hosted target — no flag combination reaches it. It exists because the
 * service creators and sweeps are deliberately tombstone-aware (#173), so a
 * SOFT-swept scratch datadir is still not reusable: the next run's spawns
 * correctly refuse to re-create rows they can see a tombstone for. Use
 * `--hard` on a scratch datadir you are about to run the suite against again.
 *
 * NOTE ON THE LOCAL TARGET: with no DATABASE_URL and no PGLITE_PATH this
 * resolves `.data/pglite` — the real dev book — and opening it is a write
 * (migrate() runs), which PGlite tolerates from exactly one process at a
 * time (AGENTS.md). The target is printed before anything happens; set
 * PGLITE_PATH to name the scratch datadir you actually mean, and make sure
 * no `next dev` or other tsx script is holding it.
 */
import { resolveDbTarget, requireHostedConfirmation } from "./db-target";
import { FIXTURE_MARKER, hardSweepRefusal, sweepFixtures } from "./test-fixtures";

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const HARD = args.includes("--hard");

async function main() {
  const { hosted } = resolveDbTarget("sweep test fixtures");
  const refusal = hardSweepRefusal({ hosted, hard: HARD });
  if (refusal) {
    console.error(`\n${refusal}\n`);
    process.exit(1);
  }
  if (COMMIT) requireHostedConfirmation(hosted, args);

  const mode = HARD ? "hard" : "soft";
  const found = await sweepFixtures({ commit: COMMIT, mode });

  const verb = HARD ? "removed" : "soft-deleted";
  console.log(
    `\n${COMMIT ? "SWEPT" : "DRY RUN"} (${mode}) — docs carrying the ${FIXTURE_MARKER}<scope>: marker\n`
  );
  if (!found.length) {
    console.log("  (none — this database carries no spec-suite fixtures)");
  } else {
    const byColl = new Map<string, string[]>();
    for (const { coll, id } of found) byColl.set(coll, [...(byColl.get(coll) || []), id]);
    for (const [coll, ids] of [...byColl].sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`  ${coll}  (${ids.length})`);
      for (const id of ids.sort()) console.log(`      ${id}`);
    }
    console.log(`\n  ${found.length} total ${COMMIT ? verb : `would be ${verb}`}`);
  }
  if (!COMMIT && found.length) {
    console.log("\n  DRY RUN — nothing written. Re-run with --commit (a hosted target also needs --yes).");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
