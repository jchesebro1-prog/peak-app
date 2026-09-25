/**
 * Read-only production migration diagnosis (no DDL, no writes).
 *
 * Answers the only question that matters when `drizzle-kit migrate` exits 1
 * on the host without printing why: what does the target database actually
 * believe is applied, and do the objects the next migration creates already
 * exist there?
 *
 *   DATABASE_URL=... node scripts/diagnose-prod-migrations.mjs
 *
 * Prints nothing that identifies the connection — safe to paste back.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set — nothing to inspect.");
  process.exit(1);
}

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));

/* drizzle's migrator keys applied rows on sha256 of the raw .sql text and
 * stores the journal's `when` as created_at — so local files can be matched
 * to remote rows without relying on the tag (which isn't stored at all). */
const byHash = new Map();
for (const entry of journal.entries) {
  const sql = readFileSync(`drizzle/${entry.tag}.sql`, "utf8");
  byHash.set(createHash("sha256").update(sql).digest("hex"), entry);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  const rows = await sql`
    SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at
  `;
  console.log(`applied rows in drizzle.__drizzle_migrations: ${rows.length}`);
  console.log(`migrations in local journal:                  ${journal.entries.length}\n`);

  for (const r of rows) {
    const known = byHash.get(r.hash);
    console.log(
      `  ${String(r.created_at).padEnd(15)} ${known ? known.tag : "*** NOT IN THIS BRANCH'S drizzle/ ***"}`
    );
  }

  const appliedHashes = new Set(rows.map((r) => r.hash));
  const pending = [...byHash.entries()].filter(([h]) => !appliedHashes.has(h));
  console.log(`\npending (would run on next deploy): ${pending.map(([, e]) => e.tag).join(", ") || "none"}`);

  /* Do the objects the pending migrations create already exist? That is the
   * difference between "fresh DDL" and the 42P07/42701 that kills the build. */
  const objs = await sql`
    SELECT
      to_regclass('public.grid_catalog')  IS NOT NULL AS grid_catalog,
      to_regclass('public.subassemblies') IS NOT NULL AS subassemblies,
      EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='sites' AND column_name='location_name') AS sites_location_name,
      EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='users' AND column_name='last_login_at') AS users_last_login_at,
      EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='users' AND column_name='previous_login_at') AS users_previous_login_at
  `;
  console.log("\nobjects 0018_clever_maverick creates — already present?");
  for (const [k, v] of Object.entries(objs[0])) console.log(`  ${k.padEnd(24)} ${v}`);

  const tables = await sql`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' ORDER BY table_name
  `;
  console.log(`\npublic tables (${tables.length}): ${tables.map((t) => t.table_name).join(", ")}`);
} finally {
  await sql.end();
}
