/**
 * Production migration hook — runs during `npm run build` on the host.
 * With DATABASE_URL set it applies pending SQL migrations (drizzle/) to that
 * Postgres. Without it (local build, CI without a database) it's a no-op —
 * local dev migrates the embedded PGlite automatically at startup.
 *
 * Uses drizzle-orm's migrator directly rather than shelling out to
 * `npx drizzle-kit migrate`. Same bookkeeping either way (drizzle-kit drives
 * this very code path — drizzle-orm/pg-core/dialect.js, schema "drizzle",
 * table "__drizzle_migrations", work selected by created_at < folderMillis),
 * but drizzle-kit renders the failure inside its spinner and exits 1 with
 * nothing on stdout or stderr: the 45a7614 deploy failed for a full cycle
 * showing only `Command failed: npx drizzle-kit migrate`. Calling the
 * migrator ourselves lets the actual Postgres error (code, message, failing
 * statement) reach the build log.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

if (!process.env.DATABASE_URL) {
  console.log("[migrate] no DATABASE_URL — skipping (dev uses embedded PGlite).");
  process.exit(0);
}

console.log("[migrate] DATABASE_URL set — applying migrations…");

// max: 1 — DDL on a single connection; the process exits right after.
const client = postgres(process.env.DATABASE_URL, { max: 1 });

try {
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  console.log("[migrate] done.");
} catch (err) {
  console.error("[migrate] FAILED — the database rejected a migration:\n");
  // postgres-js errors carry the parts that actually identify the problem;
  // a bare `throw` would print only the message.
  for (const key of ["severity", "code", "message", "detail", "hint", "where", "query"]) {
    if (err?.[key]) console.error(`  ${key}: ${err[key]}`);
  }
  if (!err?.code) console.error(err);
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}
