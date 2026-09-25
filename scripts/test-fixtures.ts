/**
 * Fixture ids for the DB-backed spec suites — one marker, one builder, one
 * teardown (#149, D233).
 *
 * The problem this closes is a file-wide convention, not one test's mistake.
 * `scripts/test-review-and-spec.ts` writes real rows (quotes, engagements,
 * catalog parts, bookings) and for years each new test invented its own id
 * shape and its own — or no — cleanup. Individual tests have been fixed by
 * hand several times; the next author still had to remember. Here cleanup is
 * what happens by default and forgetting is the deliberate act.
 *
 * ## The marker
 *
 * A fixture id is `TEST<scope>:<slug>` — `TEST13:inspection-quote`,
 * `TEST169:flame`, `TEST162:CSPAR`. `<scope>` is the punchlist/decision item
 * that owns the fixture so a stray row names its author; `<slug>` is free.
 *
 * That shape was chosen because it is already the majority of the file:
 * `TEST169:`, `TEST172:`, `TEST173:`, `TEST162:` and the older bare `TEST:`
 * all satisfy it unchanged, so adopting it churns nothing. The colon is what
 * makes it safe to sweep: matching is anchored at the start of the id AND
 * requires the colon, so a real catalog sku that merely contains the letters
 * TEST (a "TESTER" product) is never mistaken for a fixture, and neither is
 * a doc that only mentions the word in a field. Prose markers that are names
 * rather than ids (`ZZ-TEST-145-T10 Round Trip`, `TEST156: Phase Casing…`,
 * the bar keys in the #157 block) are out of scope: they never reach a doc
 * id, so nothing can leak them.
 *
 * ## The convention
 *
 *   const Q = fixtureId(13, "inspection-quote");
 *   await createFixture("quotes", { id: Q, ... });   // registered as it is created
 *
 * Nothing else is required: the suite-level teardown removes it. A test that
 * needs its own rows gone *before* later tests run (because a later sweep or
 * count would see them) calls `await dropFixtures(13)` in its own `finally`.
 *
 * ## Why the suite's own teardown HARD-deletes
 *
 * Soft delete is the app's semantics everywhere else, and it is what the
 * sweep script does by default. It is the wrong thing here, and proving that
 * is what running the suite twice against one datadir is for: the service
 * creators and sweeps are deliberately tombstone-aware (#173 — "a record the
 * user DELETED must stay deleted"), so a soft-deleted fixture poisons the
 * next run. Measured: soft-delete teardown, second run on the same datadir,
 * 21 FAIL across #13, #170 and #173 — every one of them a spawn correctly
 * refusing to re-create a row it could still see a tombstone for. Teardown
 * therefore removes the row outright, tombstones included, and the datadir
 * is genuinely as it was.
 *
 * `scripts/sweep-test-fixtures.ts` is the same sweep run by hand, for a
 * datadir that a crashed or killed run left dirty.
 */
import { eq } from "drizzle-orm";
import { getDb } from "../src/db";
import { listDocs, softDeleteDoc, upsertDoc, type Doc } from "../src/db/doc-store";
import { DOC_TABLES, type CollectionName } from "../src/db/doc-tables";

/** The one marker. Every fixture id begins with it. */
export const FIXTURE_MARKER = "TEST";

/** `TEST<scope>:` — anchored, and the colon is mandatory (see header). */
const FIXTURE_ID_RE = new RegExp(`^${FIXTURE_MARKER}[0-9A-Za-z-]*:`);

/** Build a fixture id. `scope` is the punch/decision item that owns it. */
export function fixtureId(scope: string | number, slug: string): string {
  return `${FIXTURE_MARKER}${scope}:${slug}`;
}

export function isFixtureId(id: unknown): id is string {
  return typeof id === "string" && FIXTURE_ID_RE.test(id);
}

/**
 * True for a fixture row and for the rows the code under test SPAWNED from
 * one. A spawned project/job/booking gets a generated id (`P-2001`), so the
 * marker only ever reaches it through the two reference shapes this repo
 * actually uses: a promoted `quoteId`, and an assignment's `link.id`. Both
 * are what the hand-rolled #169/#173 teardowns already re-query by.
 */
export function isFixtureDoc(doc: Record<string, unknown>): boolean {
  if (isFixtureId(doc.id)) return true;
  if (isFixtureId(doc.quoteId)) return true;
  const link = doc.link as { id?: unknown } | null | undefined;
  return isFixtureId(link?.id);
}

export type FixtureRef = { coll: CollectionName; id: string };

/** `soft` = tombstone (the app's own semantics, safe on a shared database);
 *  `hard` = the row is gone, tombstones included (see the header). */
export type SweepMode = "soft" | "hard";

const registered: FixtureRef[] = [];

async function removeDoc(coll: CollectionName, id: string, mode: SweepMode): Promise<void> {
  if (mode === "soft") {
    await softDeleteDoc(coll, id);
    return;
  }
  const db = await getDb();
  // doc-store has no per-row hard delete on purpose — nothing in the app
  // needs one, and adding it there would be a production API that only the
  // test harness calls. Scripts reach the table directly.
  const table = DOC_TABLES[coll];
  await db.delete(table).where(eq(table.id, id));
}

/** Register a row for teardown. Idempotent. */
export function registerFixture(coll: CollectionName, id: string): void {
  if (!registered.some((e) => e.coll === coll && e.id === id)) registered.push({ coll, id });
}

/**
 * `upsertDoc` that registers the row for teardown first — so a write that
 * throws half-way still leaves something to clean up, and so cleanup is not
 * a second thing the author has to remember.
 */
export async function createFixture<T extends Doc>(coll: CollectionName, doc: T): Promise<T> {
  registerFixture(coll, doc.id);
  return upsertDoc(coll, doc);
}

/**
 * Remove registered fixtures, newest first, and forget them. With `scope`,
 * only the ones `fixtureId(scope, …)` built. Returns the count. Defaults to
 * `hard` because the only caller is the harness, whose own guards mean it can
 * only ever be pointed at a throwaway datadir.
 */
export async function dropFixtures(scope?: string | number, mode: SweepMode = "hard"): Promise<number> {
  const prefix = scope === undefined ? null : `${FIXTURE_MARKER}${scope}:`;
  let dropped = 0;
  for (let i = registered.length - 1; i >= 0; i--) {
    const entry = registered[i];
    if (prefix && !entry.id.startsWith(prefix)) continue;
    await removeDoc(entry.coll, entry.id, mode);
    registered.splice(i, 1);
    dropped++;
  }
  return dropped;
}

/**
 * Every doc in the database carrying the marker, registered or not. Live only
 * by default — that is the leak question ("did anything survive the last
 * run?"). Teardown passes `includeDeleted` so tombstones go too.
 */
export async function findFixtureDocs(opts: { includeDeleted?: boolean } = {}): Promise<FixtureRef[]> {
  const found: FixtureRef[] = [];
  for (const coll of Object.keys(DOC_TABLES) as CollectionName[]) {
    for (const doc of await listDocs(coll, opts)) {
      if (isFixtureDoc(doc)) found.push({ coll, id: doc.id });
    }
  }
  return found;
}

/**
 * Find (and, with `commit`, remove) every marked doc. Registry-free on
 * purpose: this is what catches a fixture whose creator never registered it,
 * and the rows the code under test spawned from one.
 */
/**
 * The one rule `scripts/sweep-test-fixtures.ts` adds on top of db-target's
 * two-flag convention: `--hard` is refused on a hosted target outright, by no
 * flag combination — not even `--commit --yes`. A hard delete leaves offline
 * clients no tombstone to pull, so the row comes back on their next push, and
 * all Vercel environments share one Neon database. Lives here, and returns
 * the message rather than exiting, so the rule can be asserted without a
 * database (the script itself is a `main()` that cannot be imported).
 * Returns null to proceed.
 */
export function hardSweepRefusal(opts: { hosted: boolean; hard: boolean }): string | null {
  if (!opts.hard || !opts.hosted) return null;
  return (
    "Refusing --hard against the HOSTED database: a hard delete leaves offline\n" +
    "clients no tombstone to pull, so the row silently comes back. Sweep it soft\n" +
    "(--commit --yes), or point this at the scratch datadir you meant."
  );
}

export async function sweepFixtures(opts: { commit: boolean; mode?: SweepMode }): Promise<FixtureRef[]> {
  const mode = opts.mode ?? "soft";
  const found = await findFixtureDocs({ includeDeleted: mode === "hard" });
  if (opts.commit) for (const entry of found) await removeDoc(entry.coll, entry.id, mode);
  return found;
}
