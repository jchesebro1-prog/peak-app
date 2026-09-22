/**
 * Customer address + travel-time backfill (punch #147).
 *
 *   tsx scripts/enrich-addresses.ts status
 *   tsx scripts/enrich-addresses.ts geocode [--commit --yes] [--limit N]
 *   tsx scripts/enrich-addresses.ts routes  [--commit --yes] [--limit N]
 *   tsx scripts/enrich-addresses.ts enrich  --csv <Companies.csv> [--commit --yes] [--overwrite]
 *
 * `status`  — read-only coverage: how much of the book can produce a travel
 *             number at all, and how much of that is good enough to price from.
 * `geocode` — phase 1: stamp lat/lng on venues that have an address but none.
 * `routes`  — phase 2: warm the OSRM cache so travel is `routed`, not `auto`.
 * `enrich`  — fold a fresh Daylite export's street addresses into the records
 *             the July import already created, matched on the deterministic
 *             company id. Run this BEFORE `geocode` to get building-level
 *             precision instead of city centroids.
 *
 * DRY RUN IS THE DEFAULT everywhere. `--commit` writes; a hosted target
 * additionally demands `--yes` (scripts/db-target.ts), because all Vercel
 * environments share one Neon database and a hosted write is live to beta
 * users immediately. Take a backup first: DATABASE_URL=... npm run db:export
 *
 * Every phase is idempotent — re-running skips work already done — so an
 * interrupted run resumes by being run again.
 */
import fs from "node:fs";
import { resolveDbTarget, requireHostedConfirmation } from "./db-target";
import { companyId as deriveCompanyId, baseSiteId } from "./daylite-ids";

const args = process.argv.slice(2);
const cmd = (args[0] || "").toLowerCase();
const COMMIT = args.includes("--commit");
const OVERWRITE = args.includes("--overwrite");
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const LIMIT = flag("--limit") ? Number(flag("--limit")) : undefined;
const CSV = flag("--csv");

const USAGE = `
Usage:
  tsx scripts/enrich-addresses.ts status
  tsx scripts/enrich-addresses.ts geocode [--commit --yes] [--limit N]
  tsx scripts/enrich-addresses.ts routes  [--commit --yes] [--limit N]
  tsx scripts/enrich-addresses.ts enrich  --csv <Companies.csv> [--commit --yes] [--overwrite]
`;

/* ---------------- CSV (same dialect as import-daylite.ts) ----------------
   Deliberately a local copy rather than a shared import: the id helpers in
   daylite-ids.ts MUST not drift (a changed hash silently matches nothing),
   but a CSV parser that drifts produces visibly wrong output on the first
   row. Importing from import-daylite.ts would also execute its main(). */
function readCsv(fp: string): { header: string[]; rows: string[][] } {
  const content = fs.readFileSync(fp, "utf8").replace(/^﻿/, "");
  const recs: string[] = [];
  let cur = "",
    inQ = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === '"') inQ = !inQ;
    if ((ch === "\n" || ch === "\r") && !inQ) {
      if (ch === "\r" && content[i + 1] === "\n") i++;
      if (cur.length) recs.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.length) recs.push(cur);
  const split = (line: string): string[] => {
    const out: string[] = [];
    let c = "",
      q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            c += '"';
            i++;
          } else q = false;
        } else c += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") {
        out.push(c);
        c = "";
      } else c += ch;
    }
    out.push(c);
    return out.map((x) => x.trim());
  };
  const rows = recs.map(split);
  return { header: rows[0] || [], rows: rows.slice(1) };
}

/* ---------------- header aliases (spec §4.1) ----------------
   Daylite's export header spellings vary by template, so accept the likely
   ones and SAY which was picked. A missing street column is fatal: silently
   falling back to city-level is the exact bug this work exists to fix. */
const ALIASES: Record<"name" | "street" | "city" | "state" | "zip", string[]> = {
  name: ["Name", "Company", "Company Name", "Organization"],
  street: ["Address 1", "Address", "Street 1", "Street", "Address Line 1", "Address1"],
  city: ["City", "Town"],
  state: ["State/Province", "State", "Province", "State / Province"],
  zip: ["Postal Code", "Zip", "ZIP/Postal Code", "Zip Code", "Postcode", "ZIP"],
};

function resolveHeaders(header: string[]) {
  const lower = header.map((h) => h.trim().toLowerCase());
  const pick = (cands: string[]): { col: string; index: number } | null => {
    for (const c of cands) {
      const i = lower.indexOf(c.toLowerCase());
      if (i >= 0) return { col: header[i], index: i };
    }
    return null;
  };
  return {
    name: pick(ALIASES.name),
    street: pick(ALIASES.street),
    city: pick(ALIASES.city),
    state: pick(ALIASES.state),
    zip: pick(ALIASES.zip),
  };
}

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

async function cmdEnrich(hosted: boolean) {
  if (!CSV) {
    console.error("enrich needs --csv <path to Daylite Companies.csv>");
    process.exit(1);
  }
  if (!fs.existsSync(CSV)) {
    console.error(`No such file: ${CSV}`);
    process.exit(1);
  }
  if (COMMIT) requireHostedConfirmation(hosted, args);

  const { header, rows } = readCsv(CSV);
  const cols = resolveHeaders(header);

  console.log(`\nDaylite address enrichment  (${COMMIT ? "COMMIT" : "DRY RUN"})`);
  console.log("=".repeat(60));
  console.log(`  file    ${CSV}`);
  console.log(`  rows    ${n(rows.length)}`);
  console.log("  detected columns:");
  for (const [k, v] of Object.entries(cols))
    console.log(`    ${k.padEnd(7)} ${v ? `"${v.col}"` : "— not found —"}`);

  if (!cols.name) {
    console.error("\n  ABORT — no company-name column. Header was:\n  " + header.join(" | "));
    process.exit(1);
  }
  if (!cols.street) {
    console.error(
      "\n  ABORT — this export has NO STREET ADDRESS column, which is the whole\n" +
        "  point of the re-export. Header was:\n  " +
        header.join(" | ") +
        "\n\n  Re-export from Daylite with the address fields included."
    );
    process.exit(1);
  }

  const { getDb } = await import("../src/db");
  const { sites, companies } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const db = await getDb();

  const get = (r: string[], c: { index: number } | null) =>
    c && c.index < r.length ? (r[c.index] || "").trim() : "";

  let matchedCo = 0,
    missingCo = 0,
    noAddressInCsv = 0,
    coUpdated = 0,
    coSkipped = 0,
    venueUpdated = 0,
    venueSkipped = 0,
    venueAbsent = 0;
  const unmatched: string[] = [];

  for (const r of rows) {
    const name = get(r, cols.name);
    if (!name) continue;
    const street = get(r, cols.street);
    if (!street) {
      noAddressInCsv++;
      continue;
    }
    const city = get(r, cols.city);
    const state = get(r, cols.state);
    const zip = get(r, cols.zip);

    const coId = deriveCompanyId(name);
    const [co] = await db.select().from(companies).where(eq(companies.id, coId)).limit(1);
    if (!co) {
      missingCo++;
      if (unmatched.length < 40) unmatched.push(name);
      continue;
    }
    matchedCo++;

    // Company mailing address — every matched company, venue or not.
    const coHasAddress = !!(co.address || "").trim();
    if (coHasAddress && !OVERWRITE) coSkipped++;
    else {
      if (COMMIT)
        await db
          .update(companies)
          .set({ address: street, city, state, zip, updatedAt: Date.now() })
          .where(eq(companies.id, coId));
      coUpdated++;
    }

    // Venue address — only where the import already created one. Never an
    // insert: a vendor with no venue stays venue-less (spec §3).
    const siteId = baseSiteId(coId);
    const [site] = await db.select().from(sites).where(eq(sites.id, siteId)).limit(1);
    if (!site) {
      venueAbsent++;
      continue;
    }
    const siteHasAddress = !!(site.address || "").trim();
    if (siteHasAddress && !OVERWRITE) venueSkipped++;
    else {
      if (COMMIT)
        await db
          .update(sites)
          // lat/lng deliberately untouched — `geocode` stamps those next, off
          // the street address this pass just wrote.
          .set({ address: street, city, state, zip, updatedAt: Date.now() })
          .where(eq(sites.id, siteId));
      venueUpdated++;
    }
  }

  console.log("");
  console.log(`  rows with no street address ${n(noAddressInCsv)}`);
  console.log(`  matched to a company        ${n(matchedCo)}`);
  console.log(`  unmatched (renamed?)        ${n(missingCo)}`);
  console.log(`  company address written     ${n(coUpdated)}`);
  console.log(`  company skipped (app wins)  ${n(coSkipped)}`);
  console.log(`  venue address written       ${n(venueUpdated)}`);
  console.log(`  venue skipped (app wins)    ${n(venueSkipped)}`);
  console.log(`  company address only        ${n(venueAbsent)}   <- partner/vendor, no venue`);
  if (unmatched.length) {
    console.log(`\n  first ${unmatched.length} unmatched names:`);
    for (const u of unmatched) console.log(`    ${u}`);
  }
  if (!COMMIT) console.log("\n  DRY RUN — nothing written. Re-run with --commit to write.");
  console.log("\n  Next: `geocode` to stamp coordinates, then `routes` to warm real drive times.");
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
    case "enrich":
      return cmdEnrich(hosted);
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
