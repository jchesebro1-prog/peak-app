/**
 * Production migration hook — runs during `npm run build` on the host.
 * With DATABASE_URL set it applies pending SQL migrations (drizzle/) to that
 * Postgres. Without it (local build, CI without a database) it's a no-op —
 * local dev migrates the embedded PGlite automatically at startup.
 */
import { execFileSync } from "node:child_process";

// Preview deployments inherit DATABASE_URL for runtime reads, but must never
// mutate the shared hosted database during a branch build. Production remains
// the migration boundary; local builds continue to be a no-op.
if (process.env.VERCEL_ENV === "preview") {
  console.log("[migrate] preview deployment — skipping shared database migrations.");
} else if (process.env.DATABASE_URL) {
  console.log("[migrate] DATABASE_URL set — applying migrations…");
  try {
    const output = execFileSync("npx", ["drizzle-kit", "migrate"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (output) process.stdout.write(output);
  } catch (error) {
    // Vercel otherwise reports only the wrapper's generic command failure,
    // hiding the actual Postgres/Drizzle diagnostic needed to repair it.
    console.error("[migrate] drizzle-kit migrate failed");
    if (error.stdout) process.stdout.write(String(error.stdout));
    if (error.stderr) process.stderr.write(String(error.stderr));
    process.exitCode = 1;
    throw error;
  }
  console.log("[migrate] done.");
} else {
  console.log("[migrate] no DATABASE_URL — skipping (dev uses embedded PGlite).");
}
