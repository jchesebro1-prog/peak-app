import type { PgDatabase } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/**
 * Database client.
 * - Production / hosted: set DATABASE_URL (Neon or any Postgres) — uses postgres-js.
 * - Local dev with no DATABASE_URL: embedded PGlite (file-backed Postgres at
 *   .data/pglite). Zero setup — `npm run dev` just works. Migrations are
 *   applied and seed data inserted automatically on first touch.
 *
 * This mirrors the prototype's sync seam (sync.js): stores talk to one data
 * layer; only the transport underneath changes.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, typeof schema>;

const globalForDb = globalThis as unknown as { __peakDb?: Promise<Db> };

/**
 * True while `next build` is running. The build fans out across ~7 worker
 * PROCESSES to collect page data and generate static pages, and each one that
 * touches this module would open the same PGlite directory. PGlite is
 * single-process (and createDb() *writes* — migrate() creates the drizzle
 * schema), so concurrent workers corrupt `.data/pglite`. That is what produced
 * `.data-corrupt-20260719`, `-20260719b`, and `-20260724`.
 *
 * Only local builds are affected: hosted builds set DATABASE_URL and take the
 * postgres-js path above, never reaching this branch.
 */
const isBuild = process.env.NEXT_PHASE === "phase-production-build";

async function createDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const postgres = (await import("postgres")).default;
    const client = postgres(url, { max: 5, prepare: false });
    return drizzle(client, { schema }) as unknown as Db;
  }
  // Dev: embedded PGlite, auto-migrated + auto-seeded.
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const path = await import("node:path");
  const fs = await import("node:fs");
  const os = await import("node:os");
  // During a build, give every worker its OWN throwaway datadir so the real
  // dev database is never opened concurrently (and never touched at all).
  const dataDir = isBuild
    ? path.join(os.tmpdir(), `peak-build-db-${process.pid}`, "pglite")
    : path.join(process.cwd(), ".data", "pglite");
  if (isBuild) {
    console.log(`[db] build phase — using throwaway datadir ${dataDir} (dev DB untouched)`);
  }
  fs.mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return db;
}

export function getDb(): Promise<Db> {
  if (!globalForDb.__peakDb) {
    globalForDb.__peakDb = createDb();
    // Dev auto-seed runs AFTER the db promise resolves — never inside
    // createDb(), because seeding uses doc-store helpers that call getDb()
    // (awaiting the same promise → deadlock). Skipped during a build: those
    // datadirs are throwaway, so seeding them is wasted work per worker.
    if (!process.env.DATABASE_URL && !isBuild) {
      void globalForDb.__peakDb
        .then(async (db) => {
          const { seedIfEmpty } = await import("./seed-data");
          await seedIfEmpty(db);
        })
        .catch((err) => console.error("[db] dev auto-seed failed:", err));
    }
  }
  return globalForDb.__peakDb;
}
