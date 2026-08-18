/**
 * Production migration hook — runs during `npm run build` on the host.
 * With DATABASE_URL set it applies pending SQL migrations (drizzle/) to that
 * Postgres. Without it (local build, CI without a database) it's a no-op —
 * local dev migrates the embedded PGlite automatically at startup.
 */
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Preview deployments inherit DATABASE_URL for runtime reads, but must never
// mutate the shared hosted database during a branch build. Production remains
// the migration boundary; local builds continue to be a no-op.
if (process.env.VERCEL_ENV === "preview") {
  console.log("[migrate] preview deployment — skipping shared database migrations.");
} else if (process.env.DATABASE_URL) {
  console.log("[migrate] DATABASE_URL set — applying migrations…");
  const client = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
  try {
    // Confirm the connection independently before migrating. drizzle-kit
    // suppresses the underlying Postgres error in non-interactive builds,
    // which leaves Vercel with only an unhelpful spinner and exit code 1.
    await client`select 1`;
    await migrate(drizzle(client), {
      migrationsFolder: path.join(process.cwd(), "drizzle"),
    });
  } catch (error) {
    console.error("[migrate] database migration failed:", error);
    throw error;
  } finally {
    await client.end({ timeout: 5 });
  }
  console.log("[migrate] done.");
} else {
  console.log("[migrate] no DATABASE_URL — skipping (dev uses embedded PGlite).");
}
