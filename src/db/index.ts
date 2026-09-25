import type { PgDatabase } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { AsyncLocalStorage } from "node:async_hooks";

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

const globalForDb = globalThis as unknown as {
  __peakDb?: Promise<Db>;
  __peakReady?: Promise<Db>;
  __peakSeeding?: boolean;
};
const transactionStore = new AsyncLocalStorage<Db>();

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
  // PGLITE_PATH lets tooling (e.g. the route smoke test, scripts/smoke-routes.ts)
  // point a normal (non-build) run at a scratch datadir instead of the real
  // dev database. Unset by default, so ordinary `next dev` / `next start` are
  // completely unaffected — this is additive, not a behavior change.
  const dataDir = isBuild
    ? path.join(os.tmpdir(), `peak-build-db-${process.pid}`, "pglite")
    : process.env.PGLITE_PATH || path.join(process.cwd(), ".data", "pglite");
  if (isBuild) {
    console.log(`[db] build phase — using throwaway datadir ${dataDir} (dev DB untouched)`);
  }
  fs.mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return db;
}

/** The dev auto-seed's promise, so callers that READ seeded data can wait for
 *  it. Never awaited inside createDb(): seedIfEmpty() calls getDb() through
 *  the doc-store helpers, so awaiting it there would await the promise it is
 *  itself part of. An external waiter has no such cycle. */
export function getDb(): Promise<Db> {
  const active = transactionStore.getStore();
  if (active) return Promise.resolve(active);
  if (!globalForDb.__peakDb) {
    globalForDb.__peakDb = createDb();
    // Dev auto-seed runs AFTER the db promise resolves — never inside
    // createDb(), because seeding uses doc-store helpers that call getDb()
    // (awaiting the same promise → deadlock). Skipped during a build: those
    // datadirs are throwaway, so seeding them is wasted work per worker.
    if (!process.env.DATABASE_URL && !isBuild) {
      globalForDb.__peakReady = globalForDb.__peakDb.then(async (db) => {
        globalForDb.__peakSeeding = true;
        try {
          const { seedIfEmpty } = await import("./seed-data");
          await seedIfEmpty(db);
          return db;
        } finally {
          globalForDb.__peakSeeding = false;
        }
      });
    } else {
      globalForDb.__peakReady = globalForDb.__peakDb;
    }
  }
  return globalForDb.__peakSeeding
    ? globalForDb.__peakDb
    : (globalForDb.__peakReady ?? globalForDb.__peakDb);
}

/** Resolves once the dev auto-seed has finished (or immediately when there is
 *  nothing to seed — hosted DATABASE_URL, or a build's throwaway datadir).
 *  Call this before reading seeded data (#148). */
export async function seeded(): Promise<void> {
  // Ensure the seed has actually been kicked off even if this is the first
  // call in the process, then wait for readiness.
  await getDb();
  await (globalForDb.__peakReady ?? globalForDb.__peakDb);
}

/** Run a unit of document/identity writes atomically. Nested calls join the outer transaction. */
export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const active = transactionStore.getStore();
  if (active) return fn();
  const db = await getDb();
  return (db as unknown as { transaction: (work: (tx: Db) => Promise<T>) => Promise<T> }).transaction(
    (tx) => transactionStore.run(tx, fn)
  );
}

/**
 * Run `fn` with the ambient transaction context EXITED (#172).
 *
 * `getDb()` reads an AsyncLocalStorage that `withTransaction` sets, so every
 * store call made inside a unit transparently gets the transaction handle.
 * That is right for work the unit is waiting on — and wrong for work merely
 * *started* inside it. A promise chain kicked off in the unit but resolving
 * after it commits still reads the same context, and by then the handle is
 * dead: the query throws "Transaction is closed". When the detached work
 * swallows its own errors (the `void (async …)().catch(() => {})` kickoff
 * shape), the write silently never happens — no row, and nothing the caller
 * can see.
 *
 * Wrap the KICKOFF in this. A `.then()` continuation captures the async
 * context at REGISTRATION time, not at resolution, so registering inside the
 * exited scope is what matters — where the promise later settles is
 * irrelevant. Anything `fn` starts therefore resolves against the pooled
 * handle.
 *
 * Scope: detached/background work that must not ride the caller's
 * transaction (Gmail label mirroring, cache warming, telemetry). It is
 * explicitly **not** a way to sneak a write past a rollback — a write made
 * through the pooled handle commits on its own and survives the surrounding
 * unit rolling back. If a write belongs to the unit, leave it in the unit.
 *
 * The caller must never AWAIT what this starts from inside the unit. On dev
 * PGlite there is one connection: a pooled query issued while the caller's
 * transaction is still open waits for that transaction to finish, so awaiting
 * it from inside the transaction deadlocks. Detached means detached.
 */
export function outsideTransaction<T>(fn: () => T): T {
  return transactionStore.exit(fn);
}
