/**
 * Production migration hook — runs during `npm run build` on the host.
 * With DATABASE_URL set it applies pending SQL migrations (drizzle/) to that
 * Postgres. Without it (local build, CI without a database) it's a no-op —
 * local dev migrates the embedded PGlite automatically at startup.
 */
import { execSync } from "node:child_process";

if (process.env.DATABASE_URL) {
  console.log("[migrate] DATABASE_URL set — applying migrations…");
  execSync("npx drizzle-kit migrate", { stdio: "inherit" });
  console.log("[migrate] done.");
} else {
  console.log("[migrate] no DATABASE_URL — skipping (dev uses embedded PGlite).");
}
