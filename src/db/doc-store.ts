import { and, asc, eq, gt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { DOC_TABLES, blobs, type CollectionName } from "./doc-tables";

/**
 * Generic document store — the server replacement for the prototype's
 * localStorage read/write/ensure pattern. Every `src/lib/stores/*` module
 * builds its domain API (lifecycles, worklists, pricing) on this.
 *
 * Semantics ported from sync.js/CloudStore:
 * - upsert/patch bump rev and updatedAt (the prototype's dirty()),
 * - review is server-owned: normal writes never touch it; setReview is the
 *   only writer (CloudStore._put preserved review on re-push),
 * - deletes are soft (deleted:true) so pull-sync clients converge,
 * - seq (bigserial) orders every write for cursor-based pull (Phase 6).
 *   Only INSERT gets a seq from the bigserial default; every UPDATE here
 *   (patchDoc, softDeleteDoc, setReview, and upsertDoc's onConflictDoUpdate
 *   branch) gets its seq re-drawn by a database trigger
 *   (drizzle/0012_seq_bump_trigger.sql), not by code in this file — so a
 *   write path that reaches these tables directly (e.g. /api/sync/push)
 *   still keeps seq monotonic without remembering to bump it explicitly.
 */

export type Doc = Record<string, unknown> & { id: string };

function table(coll: CollectionName) {
  const t = DOC_TABLES[coll];
  if (!t) throw new Error(`Unknown collection: ${coll}`);
  return t;
}

export async function listDocs<T extends Doc = Doc>(
  coll: CollectionName,
  opts: { includeDeleted?: boolean } = {}
): Promise<T[]> {
  const db = await getDb();
  const t = table(coll);
  const rows = opts.includeDeleted
    ? await db.select().from(t).orderBy(asc(t.id))
    : await db.select().from(t).where(eq(t.deleted, false)).orderBy(asc(t.id));
  return rows.map((r) => ({ ...(r.doc as T), id: r.id }));
}

/**
 * Candidate rows whose JSON contains `query` (case-insensitive), capped at
 * `limit`. Filters in SQL so global search never materializes a whole table
 * (the catalog is ~10.7k rows) — the caller applies its precise per-field
 * match to the small candidate set. Matches anywhere in the document text;
 * that's a superset of any field-specific match, so nothing real is missed.
 */
export async function searchDocs<T extends Doc = Doc>(
  coll: CollectionName,
  query: string,
  limit: number
): Promise<T[]> {
  const q = query.trim();
  if (!q) return [];
  const db = await getDb();
  const t = table(coll);
  // Escape LIKE metacharacters so a user typing % or _ isn't a wildcard.
  const pattern = "%" + q.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
  const rows = await db
    .select()
    .from(t)
    .where(and(eq(t.deleted, false), sql`${t.doc}::text ILIKE ${pattern}`))
    .orderBy(asc(t.id))
    .limit(limit);
  return rows.map((r) => ({ ...(r.doc as T), id: r.id }));
}

export async function getDoc<T extends Doc = Doc>(
  coll: CollectionName,
  id: string
): Promise<T | null> {
  const db = await getDb();
  const t = table(coll);
  const rows = await db.select().from(t).where(eq(t.id, id)).limit(1);
  if (!rows.length || rows[0].deleted) return null;
  return { ...(rows[0].doc as T), id: rows[0].id };
}

/** Insert or fully replace a document (review untouched on replace). */
export async function upsertDoc<T extends Doc>(
  coll: CollectionName,
  doc: T
): Promise<T> {
  const db = await getDb();
  const t = table(coll);
  const now = Date.now();
  const stored = { ...doc };
  await db
    .insert(t)
    .values({
      id: doc.id,
      doc: stored,
      rev: 1,
      updatedAt: now,
      receivedAt: now,
      review: { state: "new" },
      deleted: false,
    })
    .onConflictDoUpdate({
      target: t.id,
      set: {
        doc: stored,
        rev: sql`${t.rev} + 1`,
        updatedAt: now,
        receivedAt: now,
        deleted: false,
      },
    });
  return doc;
}

/** Insert ONLY if the id is free — returns false on collision instead of
 *  replacing (upsertDoc would silently clobber the concurrent writer's doc).
 *  For writers whose ids come from the nextPrefixedId max-scan, which two
 *  concurrent requests can compute identically (D73). */
export async function insertDocIfAbsent<T extends Doc>(
  coll: CollectionName,
  doc: T
): Promise<boolean> {
  const db = await getDb();
  const t = table(coll);
  const now = Date.now();
  const rows = await db
    .insert(t)
    .values({
      id: doc.id,
      doc: { ...doc },
      rev: 1,
      updatedAt: now,
      receivedAt: now,
      review: { state: "new" },
      deleted: false,
    })
    .onConflictDoNothing()
    .returning({ id: t.id });
  return rows.length > 0;
}

/** Read-modify-write with rev bump; returns null if the doc doesn't exist. */
export async function patchDoc<T extends Doc = Doc>(
  coll: CollectionName,
  id: string,
  mutate: (doc: T) => T | void
): Promise<T | null> {
  const current = await getDoc<T>(coll, id);
  if (!current) return null;
  const next = (mutate(current) as T) || current;
  next.id = id;
  const db = await getDb();
  const t = table(coll);
  await db
    .update(t)
    .set({
      doc: next,
      rev: sql`${t.rev} + 1`,
      updatedAt: Date.now(),
      receivedAt: Date.now(),
    })
    .where(eq(t.id, id));
  return next;
}

export async function softDeleteDoc(
  coll: CollectionName,
  id: string
): Promise<void> {
  const db = await getDb();
  const t = table(coll);
  await db
    .update(t)
    .set({
      deleted: true,
      rev: sql`${t.rev} + 1`,
      updatedAt: Date.now(),
      receivedAt: Date.now(),
    })
    .where(eq(t.id, id));
}

/**
 * Hard-delete every document in a collection. Unlike softDeleteDoc, this
 * removes the rows entirely (no tombstones) — used only by the go-live
 * "clear demo data" reset, where the goal is a genuinely empty table before
 * real records are imported. Returns the number of rows removed.
 */
export async function clearCollection(coll: CollectionName): Promise<number> {
  const db = await getDb();
  const t = table(coll);
  const rows = await db.select({ id: t.id }).from(t);
  if (rows.length) await db.delete(t);
  return rows.length;
}

/** Office triage subdoc — the only writer of `review` (port of CloudStore.setReview). */
export async function setReview(
  coll: CollectionName,
  id: string,
  patch: Record<string, unknown>
): Promise<void> {
  const db = await getDb();
  const t = table(coll);
  const rows = await db.select().from(t).where(eq(t.id, id)).limit(1);
  if (!rows.length) return;
  const review = {
    state: "new",
    ...((rows[0].review as Record<string, unknown>) || {}),
    ...patch,
    at: Date.now(),
  };
  await db
    .update(t)
    .set({ review, updatedAt: Date.now() })
    .where(eq(t.id, id));
}

/** Changes after a cursor — Phase 6 pull sync. Includes deleted docs. */
export async function listSince(
  coll: CollectionName,
  cursor: number,
  limit = 500
): Promise<{
  changes: Array<{
    id: string;
    doc: Doc;
    rev: number;
    seq: number;
    deleted: boolean;
    review: Record<string, unknown> | null;
  }>;
  cursor: number;
}> {
  const db = await getDb();
  const t = table(coll);
  const rows = await db
    .select()
    .from(t)
    .where(gt(t.seq, cursor))
    .orderBy(asc(t.seq))
    .limit(limit);
  const changes = rows.map((r) => ({
    id: r.id,
    doc: { ...(r.doc as Doc), id: r.id },
    rev: r.rev,
    seq: Number(r.seq),
    deleted: r.deleted,
    review: (r.review as Record<string, unknown>) ?? null,
  }));
  const last = changes.length ? changes[changes.length - 1].seq : cursor;
  return { changes, cursor: last };
}

/**
 * Prefixed sequential ids, port of every store's nextId(): scan for the
 * highest numeric suffix of `PREFIX-`, floor at `base`, return next.
 */
export async function nextPrefixedId(
  coll: CollectionName,
  prefix: string,
  base: number
): Promise<string> {
  const all = await listDocs(coll, { includeDeleted: true });
  let max = base;
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  for (const d of all) {
    const m = re.exec(d.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${max + 1}`;
}

/**
 * Mint a prefixed id and insert under it, retrying with a fresh id on
 * collision instead of letting a concurrent creator's row get overwritten
 * (D73 — same guard insertDocIfAbsent exists for, generalized so every
 * nextPrefixedId call site gets it instead of hand-rolling the retry loop;
 * ported from the one place that already did this, gmail/bridge.ts's
 * recordMessage). `build` must be pure (id in, doc out) — it may run more
 * than once per call, so side effects (sending a message, etc.) belong
 * outside it, before or after calling this.
 */
export async function insertWithPrefixedId<T extends Doc>(
  coll: CollectionName,
  prefix: string,
  base: number,
  build: (id: string) => T,
  maxAttempts = 5
): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const id = await nextPrefixedId(coll, prefix, base);
    const doc = build(id);
    if (await insertDocIfAbsent<T>(coll, doc)) return doc;
  }
  throw new Error(
    `insertWithPrefixedId: id collision persisted for ${coll}/${prefix} after ${maxAttempts} attempts`
  );
}

/* ---------- blob singletons (settings-style stores) ---------- */

export async function getBlob<T extends Record<string, unknown>>(
  id: string,
  defaults: T
): Promise<T> {
  const db = await getDb();
  const rows = await db.select().from(blobs).where(eq(blobs.id, id)).limit(1);
  return { ...defaults, ...((rows[0]?.data as Partial<T>) || {}) };
}

/**
 * Merge `patch` into blob `id`, atomically (punch #62). The old version did
 * SELECT then UPDATE/INSERT in application code — a read-modify-write race:
 * two concurrent setBlob calls on the same id but DIFFERENT top-level keys
 * could each read the row before the other's write landed, and the slower
 * writer's stale snapshot would silently overwrite (drop) the faster
 * writer's key on save, with no error anywhere. `portal_grants` (D-side of
 * src/lib/portal.ts, one key per PortalGrant incl. its encrypted magic-link
 * token) is keyed exactly this way — two grants created around the same
 * moment, or a revoke racing a new grant, could lose one silently. A single
 * `INSERT ... ON CONFLICT DO UPDATE` using Postgres's jsonb `||` operator
 * (right side wins per top-level key, same as the old `{...existing,
 * ...patch}`) does the merge inside the database in one statement, so there
 * is no read-then-write gap for a concurrent writer to land in — this is a
 * single atomic statement, not a multi-statement transaction.
 *
 * Residual, accepted gap: two concurrent patches to the SAME top-level key
 * (e.g. two writes racing to touch the same grant's lastSeenAt/revokedAt)
 * still last-write-wins on that key's fields — closing that needs a
 * row-level lock/transaction, which is out of scope here (see PUNCHLIST).
 */
export async function setBlob(
  id: string,
  patch: Record<string, unknown>
): Promise<void> {
  const db = await getDb();
  const json = JSON.stringify(patch);
  await db
    .insert(blobs)
    .values({ id, data: patch, updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: blobs.id,
      set: {
        data: sql`${blobs.data} || ${json}::jsonb`,
        updatedAt: Date.now(),
      },
    });
}
