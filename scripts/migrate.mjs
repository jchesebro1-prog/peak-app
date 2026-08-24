/**
 * Production migration hook — runs during `npm run build` on the host.
 * With DATABASE_URL set, production deployments apply pending SQL migrations
 * (drizzle/) to Postgres. Vercel Preview builds deliberately skip this step:
 * Preview commonly shares the production connection string and must never
 * mutate the live database just to render a branch build. Without DATABASE_URL
 * (local build, CI without a database) it's also a no-op — local dev migrates
 * the embedded PGlite automatically at startup.
 */
import { execSync } from "node:child_process";

if (process.env.VERCEL_ENV === "preview") {
  console.log("[migrate] Vercel Preview — skipping database migrations.");
} else if (process.env.DATABASE_URL) {
  console.log("[migrate] DATABASE_URL set — applying migrations…");
  execSync("npx drizzle-kit migrate", { stdio: "inherit" });
  console.log("[migrate] done.");
} else {
  console.log("[migrate] no DATABASE_URL — skipping (dev uses embedded PGlite).");
}
