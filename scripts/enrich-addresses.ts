/**
 * Customer address + travel-time backfill (punch #147).
 *
 *   tsx scripts/enrich-addresses.ts status
 *   tsx scripts/enrich-addresses.ts geocode [--commit --yes] [--limit N]
 *   tsx scripts/enrich-addresses.ts routes  [--commit --yes] [--limit N]
 *  *
 * `status`  — read-only coverage: how much of the book can produce a travel
 *             number at all, and how much of that is good enough to price from.
 * `geocode` — phase 1: stamp lat/lng on venues that have an address but none.
 * `routes`  — phase 2: warm the OSRM cache so travel is `routed`, not `auto`.
 * (The `enrich` mode, which folded a Daylite export's addresses in, was
 *  removed with the Daylite import.)
 *
 * DRY RUN IS THE DEFAULT everywhere. `--commit` writes; a hosted target
 * additionally demands `--yes` (scripts/db-target.ts), because all Vercel
 * environments share one Neon database and a hosted write is live to beta
 * users immediately. Take a backup first: DATABASE_URL=... npm run db:export
 *
 * Every phase is idempotent — re-running skips work already done — so an
 * interrupted run resumes by being run again.
 */
import { resolveDbTarget, requireHostedConfirmation } from "./db-target";

const args = process.argv.slice(2);
const cmd = (args[0] || "").toLowerCase();
const COMMIT = args.includes("--commit");
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const LIMIT = flag("--limit") ? Number(flag("--limit")) : undefined;

const USAGE = `
Usage:
  tsx scripts/enrich-addresses.ts status
  tsx scripts/enrich-addresses.ts geocode [--commit --yes] [--limit N]
  tsx scripts/enrich-addresses.ts routes  [--commit --yes] [--limit N]
`;

const n = (x: number) => x.toLocaleString("en-US");

/* ---------------- commands ---------------- */

async function cmdStatus() {
  const { travelCoverage } = await import("../src/lib/geo-backfill");
  const { officesFromSettings, quoteOrigin, hasCoords } = await import("../src/lib/geo");
  const c = await travelCoverage();

  const offices = await officesFromSettings();
  const origin = quoteOrigin(offices);
  const originOk = !!origin && hasCoords(origin);

  console.log("\nTravel coverage");
  console.log("=".repeat(60));
  console.log(`  venues (not deleted)        ${n(c.venues)}`);
  console.log(`  with coordinates            ${n(c.withCoords)}   <- can produce a travel number`);
  console.log(`  with a street address       ${n(c.withStreetAddress)}   <- quote-grade precision`);
  console.log(`  city only (no street)       ${n(c.cityOnly)}   <- town-centre precision`);
  console.log(`  no address at all           ${n(c.noAddress)}   <- nothing to geocode`);
  console.log(`  manual travel override      ${n(c.manualOverride)}   <- will not reprice`);
  console.log("");
  console.log(
    `  quote origin: ${
      originOk
        ? `${origin!.name || "(unnamed)"} @ ${origin!.lat},${origin!.lng}`
        : "NOT USABLE — set an office with lat/lng and mark it the quote default in Settings -> Locations"
    }`
  );
  if (!originOk) process.exitCode = 2;
}

async function cmdGeocode(hosted: boolean) {
  if (COMMIT) requireHostedConfirmation(hosted, args);
  const { backfillVenueCoords } = await import("../src/lib/geo-backfill");
  console.log(`\nPhase 1 — geocode venues  (${COMMIT ? "COMMIT" : "DRY RUN"})`);
  console.log("=".repeat(60));
  const rep = await backfillVenueCoords({
    limit: LIMIT,
    dryRun: !COMMIT,
    onProgress: (done, total) => {
      if (done % 10 === 0 || done === total) process.stdout.write(`\r  ${done}/${total} queries`);
    },
  });
  process.stdout.write("\n");
  console.log(`  candidates (missing coords) ${n(rep.candidates)}`);
  console.log(`  unaddressable (skipped)     ${n(rep.unaddressable)}`);
  console.log(`  queries issued (deduped)    ${n(rep.queriesIssued)}`);
  console.log(`  geocoded                    ${n(rep.geocoded)}`);
  console.log(`    building-level            ${n(rep.geocodedBuilding)}   <- quote-grade`);
  console.log(`    city-level                ${n(rep.geocodedCity)}   <- town centre`);
  console.log(`  failures                    ${n(rep.failures.length)}`);
  if (rep.remaining) console.log(`  remaining (raise --limit)   ${n(rep.remaining)}`);
  const byReason = rep.failures.reduce<Record<string, number>>((a, f) => {
    a[f.reason] = (a[f.reason] || 0) + 1;
    return a;
  }, {});
  if (rep.failures.length) {
    console.log(`  failure breakdown           ${JSON.stringify(byReason)}`);
    console.log("\n  first 20 failures:");
    for (const f of rep.failures.slice(0, 20))
      console.log(`    ${f.reason.padEnd(15)} ${f.query}${f.got ? `  (got ${f.got})` : ""}`);
  }
  if (!COMMIT) console.log("\n  DRY RUN — nothing written. Re-run with --commit to write.");
}

async function cmdRoutes(hosted: boolean) {
  if (COMMIT) requireHostedConfirmation(hosted, args);
  const { warmRoutes } = await import("../src/lib/geo-backfill");
  console.log(`\nPhase 2 — warm OSRM routes  (${COMMIT ? "COMMIT" : "DRY RUN"})`);
  console.log("=".repeat(60));
  const rep = await warmRoutes({
    limit: LIMIT,
    dryRun: !COMMIT,
    onProgress: (done, total) => {
      if (done % 10 === 0 || done === total) process.stdout.write(`\r  ${done}/${total} routes`);
    },
  });
  process.stdout.write("\n");
  if (!rep.officeName) {
    console.error(
      "  ABORT — no usable quote origin. Settings -> Locations needs an office\n" +
        "  with lat/lng, with one marked as the quote default. Without it every\n" +
        "  lookup is a no-op and travel still reads as unavailable."
    );
    process.exitCode = 2;
    return;
  }
  console.log(`  origin                      ${rep.officeName}`);
  console.log(`  venues with coordinates     ${n(rep.candidates)}`);
  console.log(`  distinct routes (deduped)   ${n(rep.distinctPairs)}`);
  console.log(`  already cached              ${n(rep.alreadyCached)}`);
  console.log(`  ${COMMIT ? "warmed" : "would warm"}                  ${n(rep.warmed)}`);
  if (COMMIT) console.log(`  failed                      ${n(rep.failed)}`);
  if (rep.remaining) console.log(`  remaining (raise --limit)   ${n(rep.remaining)}`);
  if (!COMMIT) console.log("\n  DRY RUN — nothing fetched or written.");
}

async function main() {
  if (!cmd || ["-h", "--help", "help"].includes(cmd)) {
    console.log(USAGE);
    process.exit(0);
  }
  const { hosted } = resolveDbTarget(`address backfill (${cmd})`);
  switch (cmd) {
    case "status":
      return cmdStatus();
    case "geocode":
      return cmdGeocode(hosted);
    case "routes":
      return cmdRoutes(hosted);
    default:
      console.error(`Unknown command "${cmd}"\n${USAGE}`);
      process.exit(1);
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
