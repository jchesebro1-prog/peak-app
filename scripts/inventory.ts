/**
 * Data inventory: READ ONLY. Answers "what is actually in this database, and
 * how much of it is still demo data?" before anyone presses Clear demo data.
 *
 * This is step 0 of the MASTER-HOWTO §7 go-live sequence (punch list #59).
 * It writes nothing, migrates nothing, and seeds nothing: with DATABASE_URL
 * set, getDb() only opens a postgres-js connection (src/db/index.ts:63-79;
 * the dev auto-seed branch is skipped whenever DATABASE_URL is present).
 *
 *   npm run db:inventory                    → local PGlite (.data/pglite)
 *   DATABASE_URL=... npm run db:inventory   → hosted Postgres (Neon / prod)
 *
 * "Demo" is measured by ID overlap with the seed fixtures in src/db/seeds/*,
 * the same fixtures clearDemoData() would wipe. A row whose id is not in a
 * seed set is treated as real. Catalog parts are reported separately because
 * the imported price books dwarf everything else.
 *
 * No secrets are printed: connection strings, Gmail tokens and blob payloads
 * are never read or echoed, only counts and key names.
 */
import { readFileSync } from "node:fs";

// Standalone scripts don't get Next's .env.local loading, do it by hand
// (never overrides values already in the environment). This lets the hosted
// connection string stay in the gitignored .env.local instead of being typed
// on the command line. Safe: getDb() reads DATABASE_URL lazily inside
// createDb(), which runs long after these imports are evaluated.
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = /^([A-Z_][A-Z0-9_]*)="?([^"\n]*)"?$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  /* no .env.local: rely on the ambient environment */
}

import { sql } from "drizzle-orm";
import { getDb } from "../src/db";
import { DOC_TABLES, type CollectionName } from "../src/db/doc-tables";
import {
  blobs,
  users,
  appSettings,
  gmailConnections,
  notifPrefs,
  companies,
  contacts,
  contactEmails,
  contactPhones,
  sites,
} from "../src/db/schema";

import { customersSeed } from "../src/db/seeds/customers";
import { quotesSeed } from "../src/db/seeds/quotes";
import { catalogSeed } from "../src/db/seeds/catalog";
import { leadsSeed } from "../src/db/seeds/leads";
import { surveysSeed } from "../src/db/seeds/surveys";
import { commsSeed } from "../src/db/seeds/comms";
import { flameJobsSeed } from "../src/db/seeds/flame-jobs";
import { repairJobsSeed } from "../src/db/seeds/repair-jobs";
import { inspectionsSeed } from "../src/db/seeds/inspections";
import { projectsSeed } from "../src/db/seeds/projects";
import { designsSeed } from "../src/db/seeds/designs";

/** Mirrors DEMO_SEEDS in src/db/seed-data.ts, the surface a go-live reset wipes. */
const SEEDS: Array<[CollectionName, () => Array<{ id: string }>]> = [
  ["customers", customersSeed as () => Array<{ id: string }>],
  ["catalog_parts", catalogSeed as unknown as () => Array<{ id: string }>],
  ["quotes", quotesSeed as unknown as () => Array<{ id: string }>],
  ["leads", leadsSeed as unknown as () => Array<{ id: string }>],
  ["surveys", surveysSeed as unknown as () => Array<{ id: string }>],
  ["comms", commsSeed as unknown as () => Array<{ id: string }>],
  ["flame_jobs", flameJobsSeed as unknown as () => Array<{ id: string }>],
  ["repair_jobs", repairJobsSeed as unknown as () => Array<{ id: string }>],
  ["inspections", inspectionsSeed as unknown as () => Array<{ id: string }>],
  ["projects", projectsSeed as unknown as () => Array<{ id: string }>],
  ["designs", designsSeed as unknown as () => Array<{ id: string }>],
];

function pad(s: string, n: number) {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}
function padL(s: string | number, n: number) {
  const t = String(s);
  return t.length >= n ? t : " ".repeat(n - t.length) + t;
}

async function main() {
  const hosted = !!process.env.DATABASE_URL;
  const db = await getDb();

  console.log("");
  console.log("=".repeat(78));
  console.log(
    `DATA INVENTORY, source: ${hosted ? "HOSTED (DATABASE_URL)" : "LOCAL PGlite (.data/pglite)"}`
  );
  console.log(`taken: ${new Date().toISOString()}   (read-only, nothing was written)`);
  console.log("=".repeat(78));

  // ---- Document collections -------------------------------------------------
  const seedIds = new Map<string, Set<string>>();
  for (const [coll, make] of SEEDS) {
    try {
      seedIds.set(coll, new Set(make().map((d) => d.id)));
    } catch {
      seedIds.set(coll, new Set());
    }
  }

  console.log("");
  console.log("DOCUMENT COLLECTIONS");
  console.log(
    `  ${pad("collection", 24)}${padL("live", 8)}${padL("deleted", 9)}${padL("demo", 8)}${padL("real", 8)}  verdict`
  );
  console.log("  " + "-".repeat(72));

  let totalLive = 0;
  let totalReal = 0;
  const emptyCollections: string[] = [];

  for (const [name, table] of Object.entries(DOC_TABLES)) {
    const rows: Array<{ id: string; deleted: boolean }> = await db
      .select({ id: table.id, deleted: table.deleted })
      .from(table);
    const live = rows.filter((r) => !r.deleted);
    const deleted = rows.length - live.length;
    const seeds = seedIds.get(name) ?? new Set<string>();
    const demo = live.filter((r) => seeds.has(r.id)).length;
    const real = live.length - demo;

    totalLive += live.length;
    totalReal += real;
    if (live.length === 0) emptyCollections.push(name);

    let verdict: string;
    if (live.length === 0) verdict = "empty";
    else if (seeds.size === 0) verdict = "real (no demo fixture exists)";
    else if (demo === live.length) verdict = "ALL DEMO";
    else if (demo === 0) verdict = "all real";
    else verdict = `mixed, ${demo} demo rows to clear`;

    console.log(
      `  ${pad(name, 24)}${padL(live.length, 8)}${padL(deleted, 9)}${padL(demo, 8)}${padL(real, 8)}  ${verdict}`
    );
  }
  console.log("  " + "-".repeat(72));
  console.log(`  ${pad("TOTAL", 24)}${padL(totalLive, 8)}${padL("", 9)}${padL("", 8)}${padL(totalReal, 8)}`);

  // ---- Catalog detail (drives punch #50 and #54) ----------------------------
  console.log("");
  console.log("CATALOG BREAKDOWN  (top 15 categories)");
  const cats: Array<{ category: string | null; n: number }> = await db
    .select({
      category: sql<string | null>`${DOC_TABLES.catalog_parts.doc}->>'category'`,
      n: sql<number>`count(*)::int`,
    })
    .from(DOC_TABLES.catalog_parts)
    .where(sql`${DOC_TABLES.catalog_parts.deleted} = false`)
    .groupBy(sql`${DOC_TABLES.catalog_parts.doc}->>'category'`)
    .orderBy(sql`count(*) desc`)
    .limit(15);
  if (cats.length === 0) {
    console.log("  (catalog is empty)");
  } else {
    for (const c of cats) {
      console.log(`  ${pad(c.category ?? "(none)", 34)}${padL(c.n, 8)}`);
    }
  }

  // The #50 smoking gun: drape weights and TRACK weights both resolve through
  // a catalog part with category 'Fabric' AND a usable oz value.
  const fabric: Array<{ sku: string | null; oz: string | null }> = await db
    .select({
      sku: sql<string | null>`${DOC_TABLES.catalog_parts.doc}->>'sku'`,
      oz: sql<string | null>`${DOC_TABLES.catalog_parts.doc}->>'oz'`,
    })
    .from(DOC_TABLES.catalog_parts)
    .where(
      sql`${DOC_TABLES.catalog_parts.deleted} = false and ${DOC_TABLES.catalog_parts.doc}->>'category' = 'Fabric'`
    );
  const withOz = fabric.filter((f) => f.oz !== null && f.oz !== "" && Number(f.oz) > 0);
  console.log("");
  console.log("PUNCH #50 CHECK: drape fabric availability");
  console.log(`  parts with category 'Fabric' ......... ${fabric.length}`);
  console.log(`  ...of those, with a usable oz value .. ${withOz.length}`);
  if (withOz.length === 0) {
    console.log(
      "  >> CONFIRMED CAUSE: with no usable Fabric part, ruleToWeightLine leaves fab"
    );
    console.log(
      "     undefined, so computeSetWeight returns goods = 0 AND trackWt = 0. The"
    );
    console.log("     lineset builder will show empty curtains and tracks. Not an equation bug.");
  } else {
    console.log(`  >> Fabric is present (${withOz.map((f) => f.sku).join(", ")}), look elsewhere for #50.`);
  }

  const labor: Array<{ n: number }> = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(DOC_TABLES.catalog_parts)
    .where(
      sql`${DOC_TABLES.catalog_parts.deleted} = false and ${DOC_TABLES.catalog_parts.doc}->>'category' = 'Labor'`
    );
  console.log(
    `  parts with category 'Labor' (punch #54) .. ${labor[0]?.n ?? 0}  ` +
      `${(labor[0]?.n ?? 0) === 0 ? ">> estimator is on the hardcoded LABOR_RATES_FALLBACK" : ""}`
  );

  // ---- Identity + config tables --------------------------------------------
  console.log("");
  console.log("IDENTITY & CONFIG TABLES");
  const rel: Array<[string, { id: unknown }]> = [
    ["users (team roster)", users as never],
    ["companies", companies as never],
    ["contacts", contacts as never],
    ["contact_emails", contactEmails as never],
    ["contact_phones", contactPhones as never],
    ["sites (venues)", sites as never],
    ["gmail_connections", gmailConnections as never],
    ["notif_prefs", notifPrefs as never],
  ];
  for (const [label, table] of rel) {
    const r: Array<{ n: number }> = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(table as never);
    console.log(`  ${pad(label, 34)}${padL(r[0]?.n ?? 0, 8)}`);
  }

  const blobRows: Array<{ id: string }> = await db.select({ id: blobs.id }).from(blobs);
  console.log(
    `  ${pad("blobs (rate singletons)", 34)}${padL(blobRows.length, 8)}  keys: ${
      blobRows.map((b) => b.id).join(", ") || "(none)"
    }`
  );

  const settingsRows = await db.select().from(appSettings);
  const data = (settingsRows[0]?.data ?? {}) as Record<string, unknown>;
  console.log("");
  console.log("APP SETTINGS");
  console.log(`  rows .................. ${settingsRows.length} (expected 1, id="main")`);
  console.log(`  companyName ........... ${String(data.companyName ?? "(unset)")}`);
  console.log(
    `  seedDemo .............. ${String(data.seedDemo)}  ` +
      `${data.seedDemo === true ? ">> demo data is ON for this database" : ""}`
  );

  // ---- Verdict --------------------------------------------------------------
  console.log("");
  console.log("=".repeat(78));
  console.log("READ THIS BEFORE PRESSING 'Clear demo data'");
  console.log(
    `  Rows that would be DELETED by clearDemoData(): every live row in the 11 demo`
  );
  console.log(
    `  collections: including REAL rows mixed into them. Check the 'real' column above:`
  );
  console.log(
    `  clearDemoData() wipes whole collections, it does NOT delete demo rows selectively.`
  );
  console.log(`  Empty collections (${emptyCollections.length}): ${emptyCollections.join(", ") || "none"}`);
  console.log("");
  console.log("  Back up first:  npm run db:export     (add DATABASE_URL for the hosted DB)");
  console.log("=".repeat(78));
  console.log("");

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
