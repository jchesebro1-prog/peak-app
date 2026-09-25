import type { PgDatabase } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";

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

/** Drizzle's `.execute()` comes back shaped differently per driver: PGlite
 *  wraps its rows in `{ rows: [...] }` — confirmed directly against it in
 *  the regression harness. postgres-js's raw result is array-like instead
 *  (per the `postgres` library's own `RowList` docs/typings) — not
 *  exercised against a real Postgres here, so this branch is read, not
 *  tested; the `Array.isArray` fallback below is what it depends on. */
function firstRow<T = Record<string, unknown>>(result: unknown): T | undefined {
  if (result && typeof result === "object" && "rows" in result) {
    return (result as { rows: T[] }).rows[0];
  }
  if (Array.isArray(result)) return result[0] as T;
  return undefined;
}

/** Advisory-lock namespace for `withQuoteLock` (#180) — the `classid` half
 *  of the two-argument `pg_advisory_xact_lock(classid, key)` form. Without
 *  it, a lock taken here shares Postgres's single 64-bit advisory-lock
 *  keyspace with anything else in the app that ever takes one; the
 *  namespace makes that collision impossible rather than merely unlikely.
 *  Picked to be this punch item's own number — there's no registry, just
 *  "don't reuse it for something unrelated." */
const QUOTE_LOCK_NAMESPACE = 180;
/** `hashtext(quoteId)` inside the namespace is still only a 32-bit hash, so
 *  two DIFFERENT quote ids CAN collide onto the same key. That is why the
 *  doc comment below no longer claims different keys "never contend" — a
 *  collision only costs an unrelated pair of quotes an unnecessary wait
 *  (their spawns serialize instead of running concurrently); it can never
 *  cause two spawns for the same quote to both proceed, which is the only
 *  thing correctness depends on here. */
const QUOTE_LOCK_POLL_MS = 100;
const QUOTE_LOCK_TIMEOUT_MS = 10_000;

export const QUOTE_LOCK_TIMEOUT = "db/quote-lock-timeout" as const;

export class QuoteLockTimeoutError extends Error {
  /**
   * Read by `isQuoteLockTimeout`, deliberately in place of `instanceof` —
   * same reasoning as `quotes.ts`'s `ApprovalGateRefused`/
   * `isApprovalGateRefusal`: `setStatus` reaches this module's own
   * `withQuoteLock` through `quote-spawn.ts`, itself reached via a dynamic
   * `import()`, and Next splits server actions across route bundles — this
   * module can legitimately exist twice in one process, which would fail an
   * `instanceof` check across that boundary. A string compared by value
   * crosses it intact.
   */
  readonly quoteLockTimeout = QUOTE_LOCK_TIMEOUT;
  readonly quoteId: string;
  constructor(quoteId: string) {
    super(
      `withQuoteLock: timed out after ${QUOTE_LOCK_TIMEOUT_MS}ms waiting for the spawn lock on quote ${quoteId} — another request is still working on it.`
    );
    this.name = "QuoteLockTimeoutError";
    this.quoteId = quoteId;
  }
}

/** True only for withQuoteLock's own timeout — structural on purpose, see above. */
export function isQuoteLockTimeout(e: unknown): e is QuoteLockTimeoutError {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { quoteLockTimeout?: unknown }).quoteLockTimeout === QUOTE_LOCK_TIMEOUT
  );
}

/**
 * Run `fn` inside a transaction holding a Postgres advisory lock scoped to
 * `quoteId` (#180). The quote→job/project spawners are read-then-insert
 * with no unique DB constraint to lean on — the link lives in
 * `doc.quoteId` inside a jsonb column, so nothing at the DB layer stops two
 * concurrent callers from both deciding a quote is uncovered and each
 * inserting a record for it. An advisory lock needs no such constraint
 * (and no migration): it is a plain Postgres session/transaction
 * primitive, held for the life of the transaction and released
 * automatically on commit or rollback, so a second caller for the SAME
 * quote simply waits until the first is done, then re-reads coverage and
 * (correctly) finds nothing left to do. Nesting inside an already-open
 * transaction (e.g. a real win inside `setStatus`) joins it via
 * `withTransaction`, so the lock is held for that outer transaction's
 * whole lifetime — exactly what should serialize against a healing sweep
 * racing the same quote.
 *
 * Waits in bounded polls (`pg_try_advisory_xact_lock`, non-blocking, every
 * `QUOTE_LOCK_POLL_MS`) rather than blocking indefinitely on
 * `pg_advisory_xact_lock` — a caller stuck behind a genuinely wedged
 * holder (a transaction that never commits) should fail loudly
 * (`QuoteLockTimeoutError`, already caught by `safeSweep` on every sweep
 * caller) instead of hanging the request — or, on PGlite's single
 * connection, the whole process. Deliberately NOT `SET LOCAL
 * lock_timeout`: that is transaction-scoped session state, and this
 * function's transaction can be the OUTER one a real win runs inside
 * (`setStatus`) — a `SET LOCAL` here would leak into whatever else that
 * same caller's transaction does after the lock is acquired, silently
 * handing an unrelated later statement a `lock_timeout` it never asked
 * for.
 */
export async function withQuoteLock<T>(quoteId: string, fn: () => Promise<T>): Promise<T> {
  return withTransaction(async () => {
    const db = await getDb();
    const deadline = Date.now() + QUOTE_LOCK_TIMEOUT_MS;
    for (;;) {
      const result = await db.execute(
        sql`select pg_try_advisory_xact_lock(${QUOTE_LOCK_NAMESPACE}, hashtext(${quoteId})) as got`
      );
      if (firstRow<{ got: boolean }>(result)?.got) break;
      if (Date.now() >= deadline) throw new QuoteLockTimeoutError(quoteId);
      await new Promise((resolve) => setTimeout(resolve, QUOTE_LOCK_POLL_MS));
    }
    return fn();
  });
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
