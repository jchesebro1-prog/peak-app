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
  const dataDir = path.join(process.cwd(), ".data", "pglite");
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
    // (awaiting the same promise → deadlock).
    if (!process.env.DATABASE_URL) {
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
