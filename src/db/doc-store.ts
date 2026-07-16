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

/* ---------- blob singletons (settings-style stores) ---------- */

export async function getBlob<T extends Record<string, unknown>>(
  id: string,
  defaults: T
): Promise<T> {
  const db = await getDb();
  const rows = await db.select().from(blobs).where(eq(blobs.id, id)).limit(1);
  return { ...defaults, ...((rows[0]?.data as Partial<T>) || {}) };
}

export async function setBlob(
  id: string,
  patch: Record<string, unknown>
): Promise<void> {
  const db = await getDb();
  const rows = await db.select().from(blobs).where(eq(blobs.id, id)).limit(1);
  const next = { ...((rows[0]?.data as Record<string, unknown>) || {}), ...patch };
  if (rows.length) {
    await db
      .update(blobs)
      .set({ data: next, updatedAt: Date.now() })
      .where(eq(blobs.id, id));
  } else {
    await db.insert(blobs).values({ id, data: next, updatedAt: Date.now() });
  }
}
