import { and, asc, desc, eq, gt, inArray, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { getDb, withTransaction } from "@/db";
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

/**
 * Estimate numbers (#223) are allocated by the database's
 * assign_estimate_numbers() and never change. Every UPDATE of a quote or
 * lead here — upsertDoc/upsertDocs replacing an existing row, patchDoc —
 * therefore writes the incoming doc WITHOUT its estNo/estSuffix and keeps the
 * ones stored in the row, in the same statement. So a whole doc read before
 * the number was assigned (a stale save, a re-import, a store update() that
 * raced the numbering) can never wipe it, and a doc carrying a different
 * number can never rewrite it. A NEW row is inserted as given: create() paths
 * build their docs field by field and never copy a number, except the one
 * deliberate carry (leads.create's `estNo`, the consulting auto-lead).
 */
const ESTIMATE_NUMBERED: ReadonlySet<CollectionName> = new Set<CollectionName>(["quotes", "leads"]);

function docOnUpdate(coll: CollectionName, incoming: SQL): SQL {
  if (!ESTIMATE_NUMBERED.has(coll)) return incoming;
  const cur = table(coll).doc;
  return sql`((${incoming}) - 'estNo' - 'estSuffix') || jsonb_strip_nulls(jsonb_build_object(
    'estNo', CASE WHEN jsonb_typeof(${cur}->'estNo') = 'number' THEN ${cur}->'estNo' END,
    'estSuffix', CASE WHEN jsonb_typeof(${cur}->'estNo') = 'number' AND jsonb_typeof(${cur}->'estSuffix') = 'number'
                      THEN ${cur}->'estSuffix' END))`;
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

/** Soft-deleted rows only, by id — what a writer that must never revive a
 *  human's delete (the photo sheet's detached links) reads. */
export async function listDeletedDocs<T extends Doc = Doc>(coll: CollectionName): Promise<T[]> {
  const db = await getDb();
  const t = table(coll);
  const rows = await db.select().from(t).where(eq(t.deleted, true)).orderBy(asc(t.id));
  return rows.map((r) => ({ ...(r.doc as T), id: r.id }));
}

/**
 * #341 — a small predicate language over a doc's JSON, compiled to SQL by
 * `docCondSql` (searchDocs' `where`). `path` is a field path from the doc
 * root (["customerId"], ["link", "type"]); every segment and value is a bound
 * parameter. Leaves:
 *  - `is`: the text at path equals the value (null/absent never matches);
 *  - `isNot`: the text at path, absent read as "", differs from the value;
 *  - `isFolded`: the text at path, trimmed and lower-cased, equals the value
 *    (pass the value already folded; "" never matches);
 *  - `filled: "text"`: a non-empty string; `filled: "array"`: a non-empty
 *    JSON array;
 *  - `empty: "text"` (#349): the text at path, absent / null read as "", is
 *    "" (the exact complement of `filled: "text"`);
 *  - `in` (Jeff 2026-10-15 #26): the text at path is one of the values
 *    (null/absent never matches; no values never matches).
 * `all` of nothing is true; `any` of nothing is false.
 */
export type DocCond =
  | { all: readonly DocCond[] }
  | { any: readonly DocCond[] }
  | { path: readonly string[]; is: string }
  | { path: readonly string[]; isNot: string }
  | { path: readonly string[]; isFolded: string }
  | { path: readonly string[]; filled: "text" | "array" }
  | { path: readonly string[]; empty: "text" }
  | { path: readonly string[]; in: readonly string[] };

/** JS whitespace `trim()` strips, for the SQL btrim in `isFolded`. */
const TRIM_CHARS = " \t\n\r\f\v\u00a0\ufeff";

function jsonAtPath(doc: SQLWrapper, path: readonly string[]): SQL {
  let e: SQL = sql`${doc}`;
  for (const seg of path) e = sql`(${e} -> ${seg})`;
  return e;
}

function textAtPath(doc: SQLWrapper, path: readonly string[]): SQL {
  if (!path.length) throw new Error("DocCond: empty path");
  return sql`(${jsonAtPath(doc, path.slice(0, -1))} ->> ${path[path.length - 1]})`;
}

export function docCondSql(doc: SQLWrapper, c: DocCond): SQL {
  if ("all" in c) return c.all.length ? sql`(${sql.join(c.all.map((x) => docCondSql(doc, x)), sql` AND `)})` : sql`TRUE`;
  if ("any" in c) return c.any.length ? sql`(${sql.join(c.any.map((x) => docCondSql(doc, x)), sql` OR `)})` : sql`FALSE`;
  if ("is" in c) return sql`(${textAtPath(doc, c.path)} = ${c.is})`;
  if ("in" in c) {
    if (!c.in.length) return sql`FALSE`;
    return sql`(${textAtPath(doc, c.path)} IN (${sql.join(c.in.map((v) => sql`${v}`), sql`, `)}))`;
  }
  if ("isNot" in c) return sql`(coalesce(${textAtPath(doc, c.path)}, '') <> ${c.isNot})`;
  if ("isFolded" in c) {
    if (!c.isFolded) return sql`FALSE`;
    return sql`(lower(btrim(coalesce(${textAtPath(doc, c.path)}, ''), ${TRIM_CHARS})) = ${c.isFolded})`;
  }
  if (!c.path.length) throw new Error("DocCond: empty path");
  if ("empty" in c) return sql`(coalesce(${textAtPath(doc, c.path)}, '') = '')`;
  if (c.filled === "array") {
    const j = jsonAtPath(doc, c.path);
    // CASE, not AND: Postgres doesn't promise AND short-circuits, and
    // jsonb_array_length throws on a non-array.
    return sql`(CASE WHEN jsonb_typeof(${j}) = 'array' THEN jsonb_array_length(${j}) > 0 ELSE FALSE END)`;
  }
  return sql`(coalesce(${textAtPath(doc, c.path)}, '') <> '')`;
}

/**
 * Candidate rows whose JSON contains `query` (case-insensitive), capped at
 * `limit`. Filters in SQL so global search never materializes a whole table
 * (the catalog is ~10.7k rows) — the caller applies its precise per-field
 * match to the small candidate set. Matches anywhere in the document text;
 * that's a superset of any field-specific match, so nothing real is missed.
 *
 * `fieldEquals` (Ask AI) further keeps only rows whose top-level doc fields
 * equal these strings — applied in SQL before the LIMIT, so a scoped search
 * (one user's mailbox) is never crowded out by rows it would discard. Field
 * names are code constants, passed as bound parameters. Omitted = the
 * unscoped query exactly as before.
 *
 * `where` (#341) is one more predicate over the doc, built from `DocCond`
 * (and / or / equals / not-equals / folded-equals / filled), also applied in
 * SQL before the LIMIT — how ⌘K keeps only the email threads the viewer may
 * see (comms-visibility.ts canSeeThreadCond) without other mailboxes'
 * threads crowding the visible ones out of the candidate cut.
 */
export async function searchDocs<T extends Doc = Doc>(
  coll: CollectionName,
  query: string,
  limit: number,
  opts: { fieldEquals?: Readonly<Record<string, string>>; where?: DocCond } = {}
): Promise<T[]> {
  const q = query.trim();
  if (!q) return [];
  const db = await getDb();
  const t = table(coll);
  // Escape LIKE metacharacters so a user typing % or _ isn't a wildcard.
  const pattern = "%" + q.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
  const eqs = Object.entries(opts.fieldEquals ?? {}).map(([f, v]) => sql`${t.doc}->>${f} = ${v}`);
  const extra = opts.where ? [docCondSql(t.doc, opts.where)] : [];
  const rows = await db
    .select()
    .from(t)
    .where(and(eq(t.deleted, false), sql`${t.doc}::text ILIKE ${pattern}`, ...eqs, ...extra))
    .orderBy(asc(t.id))
    .limit(limit);
  return rows.map((r) => ({ ...(r.doc as T), id: r.id }));
}

/**
 * Live rows narrowed in SQL by two optional filters (#205 spec builder final
 * fix 6 — the product picker, so a keystroke never reads the whole catalog):
 *
 * - `text` + `textFields`: the lowercased haystack `f1 f2 f3` (each field
 *   coalesced to "", joined by single spaces — the same string a JS
 *   `${a} ${b || ""} ${c || ""}` builds) contains `text`, case-insensitively;
 * - `nonEmpty`: at least one of these top-level fields is a non-empty string.
 *
 * Both are supersets of the caller's exact JS check, which re-runs on the
 * result. Field names are code constants, passed as bound parameters.
 * `limit` caps the rows, in id order by default; `orderByNumericDesc` (a doc
 * field holding a number, e.g. `estNo`) orders newest-first instead, so a
 * capped result keeps the most recent matches rather than the oldest ids.
 *
 * Grid notes #6: `allText` is `text` for several tokens at once — the haystack
 * must contain EVERY one (ANDed). `fields` projects each row to just those
 * top-level doc fields (absent/null ones left out), so a wide candidate read
 * never ships whole documents; `id` always comes from the row.
 */
export async function listDocsFiltered<T extends Doc = Doc>(
  coll: CollectionName,
  opts: {
    textFields?: readonly string[];
    text?: string;
    allText?: readonly string[];
    nonEmpty?: readonly string[];
    limit?: number;
    orderByNumericDesc?: string;
    fields?: readonly string[];
  }
): Promise<T[]> {
  const db = await getDb();
  const t = table(coll);
  const where = [eq(t.deleted, false)];
  const texts = [opts.text || "", ...(opts.allText ?? [])].map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (texts.length && opts.textFields?.length) {
    const hay = sql.join(
      opts.textFields.map((f) => sql`coalesce(${t.doc}->>${f}, '')`),
      sql` || ' ' || `
    );
    for (const text of texts) {
      const pattern = "%" + text.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
      where.push(sql`lower(${hay}) LIKE ${pattern}`);
    }
  }
  if (opts.nonEmpty?.length) {
    const anyNonEmpty = sql.join(
      opts.nonEmpty.map((f) => sql`coalesce(${t.doc}->>${f}, '') <> ''`),
      sql` OR `
    );
    where.push(sql`(${anyNonEmpty})`);
  }
  const order = opts.orderByNumericDesc
    ? desc(sql`(${t.doc}->>${opts.orderByNumericDesc})::numeric`)
    : asc(t.id);
  const doc = opts.fields?.length
    ? sql`jsonb_strip_nulls(jsonb_build_object(${sql.join(
        opts.fields.map((f) => sql`${f}::text, ${t.doc}->${f}`),
        sql`, `
      )}))`
    : t.doc;
  const q = db.select({ id: t.id, doc }).from(t).where(and(...where)).orderBy(order);
  const rows = opts.limit != null ? await q.limit(opts.limit) : await q;
  return rows.map((r) => ({ ...(r.doc as T), id: r.id }));
}

/**
 * Rows by id, live AND soft-deleted, each with its `deleted` flag — one
 * statement per DOC_BATCH_CHUNK ids (#207 final fix wave: attachDocument's
 * fan-out reads its deterministic link ids in one go instead of one getDoc
 * per SKU). Missing ids are simply absent from the result.
 */
export async function getDocRows<T extends Doc = Doc>(
  coll: CollectionName,
  ids: readonly string[]
): Promise<Array<{ id: string; deleted: boolean; doc: T }>> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (!unique.length) return [];
  const db = await getDb();
  const t = table(coll);
  const out: Array<{ id: string; deleted: boolean; doc: T }> = [];
  for (let i = 0; i < unique.length; i += DOC_BATCH_CHUNK) {
    const rows = await db.select().from(t).where(inArray(t.id, unique.slice(i, i + DOC_BATCH_CHUNK)));
    for (const r of rows) out.push({ id: r.id, deleted: r.deleted, doc: { ...(r.doc as T), id: r.id } });
  }
  return out;
}

/**
 * Live rows whose id matches one of `ids` ignoring case — the fallback for a
 * SKU typed in a different case than the part's real id (#205 spec builder:
 * specs match SKUs case-insensitively). Filtered in SQL (`lower(id) IN …`),
 * so it never materializes the collection; callers try the exact
 * (primary-key) lookup first and only send the misses here.
 */
export async function getDocsByIdAnyCase<T extends Doc = Doc>(
  coll: CollectionName,
  ids: readonly string[]
): Promise<T[]> {
  const unique = [...new Set(ids.map((i) => i.toLowerCase()))].filter(Boolean);
  if (!unique.length) return [];
  const db = await getDb();
  const t = table(coll);
  const out: T[] = [];
  for (let i = 0; i < unique.length; i += DOC_BATCH_CHUNK) {
    const rows = await db
      .select()
      .from(t)
      .where(and(eq(t.deleted, false), inArray(sql<string>`lower(${t.id})`, unique.slice(i, i + DOC_BATCH_CHUNK))))
      .orderBy(asc(t.id));
    for (const r of rows) out.push({ ...(r.doc as T), id: r.id });
  }
  return out;
}

/**
 * Live rows whose top-level string field `field` is one of `values` —
 * filtered in SQL (`doc->>field IN (…)`) so a per-request lookup (one SKU's
 * links, a page of SKUs) never materializes the whole collection (#207
 * final fix wave). `field` is a code constant, passed as a bound parameter.
 * `nullFields` (#218) further keeps only rows where each of those top-level
 * fields is absent or JSON null (`doc->>f IS NULL`) — also code constants.
 */
export async function listDocsByField<T extends Doc = Doc>(
  coll: CollectionName,
  field: string,
  values: readonly string[],
  opts: { nullFields?: readonly string[] } = {}
): Promise<T[]> {
  const unique = [...new Set(values)].filter(Boolean);
  if (!unique.length) return [];
  const db = await getDb();
  const t = table(coll);
  const out: T[] = [];
  for (let i = 0; i < unique.length; i += DOC_BATCH_CHUNK) {
    const rows = await db
      .select()
      .from(t)
      .where(
        and(
          eq(t.deleted, false),
          inArray(sql<string>`${t.doc}->>${field}`, unique.slice(i, i + DOC_BATCH_CHUNK)),
          ...(opts.nullFields ?? []).map((f) => sql`${t.doc}->>${f} IS NULL`)
        )
      )
      .orderBy(asc(t.id));
    for (const r of rows) out.push({ ...(r.doc as T), id: r.id });
  }
  return out;
}

/**
 * #349 — live rows matching one `DocCond` (the thread-ownership predicate),
 * filtered in SQL, in id order; `limit` caps the rows. Every path segment and
 * value is a bound parameter (docCondSql).
 */
export async function listDocsWhere<T extends Doc = Doc>(coll: CollectionName, where: DocCond, opts: { limit?: number } = {}): Promise<T[]> {
  const db = await getDb();
  const t = table(coll);
  const q = db.select().from(t).where(and(eq(t.deleted, false), docCondSql(t.doc, where))).orderBy(asc(t.id));
  const rows = opts.limit != null ? await q.limit(opts.limit) : await q;
  return rows.map((r) => ({ ...(r.doc as T), id: r.id }));
}

/**
 * Live rows where ANY of the two-level JSON paths holds boolean true
 * (`doc->a->>b = 'true'`), filtered in SQL — #335's `pendingAi` worklist.
 * `fieldIn` further keeps rows where ANY of those top-level string fields is
 * one of its values (`lower: true` compares trimmed + lower-cased, values
 * given lower-cased); `negateFieldIn` keeps the rows matching NONE of them
 * (an absent field reads as ""). Field names / path segments are code
 * constants, passed as bound parameters. Ordered by the numeric top-level
 * field `orderByNumericAsc` (oldest first), else id; `limit` applies after
 * every filter.
 */
export async function listDocsWithFlag<T extends Doc = Doc>(
  coll: CollectionName,
  paths: ReadonlyArray<readonly [string, string]>,
  opts: {
    limit?: number;
    orderByNumericAsc?: string;
    fieldIn?: ReadonlyArray<{ field: string; values: readonly string[]; lower?: boolean }>;
    negateFieldIn?: boolean;
  } = {}
): Promise<T[]> {
  if (!paths.length) return [];
  const db = await getDb();
  const t = table(coll);
  const any = sql.join(
    paths.map(([a, b]) => sql`(${t.doc}->${a}->>${b}) = 'true'`),
    sql` OR `
  );
  const where = [eq(t.deleted, false), sql`(${any})`];
  const ins = (opts.fieldIn ?? []).filter((f) => f.values.length);
  if (ins.length) {
    const match = sql.join(
      ins.map(({ field, values, lower }) => {
        const col = lower ? sql`lower(trim(coalesce(${t.doc}->>${field}, '')))` : sql`coalesce(${t.doc}->>${field}, '')`;
        return sql`${col} IN (${sql.join(values.map((v) => sql`${v}`), sql`, `)})`;
      }),
      sql` OR `
    );
    where.push(opts.negateFieldIn ? sql`NOT (${match})` : sql`(${match})`);
  } else if (opts.fieldIn && !opts.negateFieldIn) {
    return [];
  }
  const order = opts.orderByNumericAsc ? asc(sql`(${t.doc}->>${opts.orderByNumericAsc})::numeric`) : asc(t.id);
  const q = db.select().from(t).where(and(...where)).orderBy(order, asc(t.id));
  const rows = opts.limit != null ? await q.limit(opts.limit) : await q;
  return rows.map((r) => ({ ...(r.doc as T), id: r.id }));
}

/**
 * Compare-and-set ONE top-level key of a live row: writes `next` (undefined
 * removes the key) only if the stored value still equals `expected` (jsonb
 * equality — key order doesn't matter; undefined = absent or null). Atomic in
 * one UPDATE, so two writers racing on the same read can't both win (#335's
 * AI-pass lease). Returns whether it wrote. Bumps rev like patchDocKey.
 */
export async function casDocKey(coll: CollectionName, id: string, key: string, expected: unknown, next: unknown): Promise<boolean> {
  const db = await getDb();
  const t = table(coll);
  const nextDoc =
    next === undefined ? sql`(${t.doc} - ${key}::text)` : sql`(${t.doc} || jsonb_build_object(${key}::text, ${JSON.stringify(next)}::jsonb))`;
  const same =
    expected === undefined || expected === null
      ? sql`(${t.doc}->${key}) IS NULL OR jsonb_typeof(${t.doc}->${key}) = 'null'`
      : sql`(${t.doc}->${key}) = ${JSON.stringify(expected)}::jsonb`;
  const now = Date.now();
  const rows = await db
    .update(t)
    .set({ doc: nextDoc, rev: sql`${t.rev} + 1`, updatedAt: now, receivedAt: now })
    .where(and(eq(t.id, id), eq(t.deleted, false), sql`(${same})`))
    .returning({ id: t.id });
  return rows.length > 0;
}

/**
 * #349 review — compare-and-set ONE top-level key on every live row matching
 * `where`, in one UPDATE: writes `value` only where the key is still absent
 * (or null) — the same key-level CAS as `casDocKey(…, undefined, value)`, for
 * a set of rows (a rename handing over its name-only threads). Returns the ids
 * written. Every path and value is a bound parameter (docCondSql).
 */
export async function casDocKeyWhere(coll: CollectionName, where: DocCond, key: string, value: unknown): Promise<string[]> {
  const db = await getDb();
  const t = table(coll);
  const now = Date.now();
  const rows = await db
    .update(t)
    .set({ doc: sql`(${t.doc} || jsonb_build_object(${key}::text, ${JSON.stringify(value)}::jsonb))`, rev: sql`${t.rev} + 1`, updatedAt: now, receivedAt: now })
    .where(and(eq(t.deleted, false), docCondSql(t.doc, where), sql`((${t.doc}->${key}) IS NULL OR jsonb_typeof(${t.doc}->${key}) = 'null')`))
    .returning({ id: t.id });
  return rows.map((r) => r.id);
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
        doc: docOnUpdate(coll, sql`excluded.doc`),
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

/* ---------- batched writes (#207 review fix wave 1) ----------
 *
 * Multi-row counterparts of upsertDoc / insertDocIfAbsent / softDeleteDoc for
 * writers that hold thousands of rows at once (the DaVinci pre-fill writes
 * ~360 documents, ~4k links and ~6.7k graph rows). One awaited statement per
 * row is a network round trip per row on Neon — minutes, past Vercel's
 * function limit. These write DOC_BATCH_CHUNK rows per statement instead.
 *
 * Per-row semantics are EXACTLY the single-row versions': the same columns
 * and values, the same conflict clause, and every UPDATE still fires the
 * table's `_seq_bump` BEFORE UPDATE trigger once per row (Postgres row
 * triggers are per row, not per statement), so pull-sync's `seq > cursor`
 * sees each change. Each chunk is one statement, so it is atomic on its own;
 * the batch as a whole is not (neither is a loop of single-row calls).
 *
 * `shouldStop` is checked before every chunk (the first included) so a
 * caller with a wall-clock budget can stop cleanly between chunks;
 * `complete` says whether every chunk ran. Parameter count per statement is
 * 7 × chunk (3,500 at 500) — well under Postgres's 65,535.
 */

export const DOC_BATCH_CHUNK = 500;

export type DocBatchOpts = { chunkSize?: number; shouldStop?: () => boolean };
export type DocBatchResult = { ids: string[]; complete: boolean };

function chunksOf<T>(items: readonly T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size) || DOC_BATCH_CHUNK);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

/**
 * insertDocIfAbsent for many rows: ON CONFLICT (id) DO NOTHING — an existing
 * row (live or soft-deleted) is never touched. `ids` are the rows actually
 * inserted. A duplicate id inside the batch behaves like two sequential
 * calls: the first is inserted, the second is a no-op.
 */
export async function insertDocsIfAbsent<T extends Doc>(
  coll: CollectionName,
  docs: readonly T[],
  opts: DocBatchOpts = {}
): Promise<DocBatchResult> {
  const db = await getDb();
  const t = table(coll);
  const ids: string[] = [];
  for (const chunk of chunksOf(docs, opts.chunkSize ?? DOC_BATCH_CHUNK)) {
    if (opts.shouldStop?.()) return { ids, complete: false };
    const now = Date.now();
    const rows = await db
      .insert(t)
      .values(
        chunk.map((doc) => ({
          id: doc.id,
          doc: { ...doc },
          rev: 1,
          updatedAt: now,
          receivedAt: now,
          review: { state: "new" },
          deleted: false,
        }))
      )
      .onConflictDoNothing()
      .returning({ id: t.id });
    for (const r of rows) ids.push(r.id);
  }
  return { ids, complete: true };
}

/**
 * upsertDoc for many rows: insert, or fully replace `doc`, bump rev, stamp
 * updatedAt/receivedAt and revive a soft-deleted row (review untouched on
 * replace). Postgres refuses one statement that updates the same row twice,
 * so a duplicate id inside the batch keeps its LAST document (what a
 * sequential loop leaves behind; rev is bumped once, not per duplicate).
 * `ids` are every row written.
 */
export async function upsertDocs<T extends Doc>(
  coll: CollectionName,
  docs: readonly T[],
  opts: DocBatchOpts = {}
): Promise<DocBatchResult> {
  const db = await getDb();
  const t = table(coll);
  const last = new Map<string, T>();
  for (const d of docs) {
    last.delete(d.id);
    last.set(d.id, d);
  }
  const ids: string[] = [];
  for (const chunk of chunksOf([...last.values()], opts.chunkSize ?? DOC_BATCH_CHUNK)) {
    if (opts.shouldStop?.()) return { ids, complete: false };
    const now = Date.now();
    await db
      .insert(t)
      .values(
        chunk.map((doc) => ({
          id: doc.id,
          doc: { ...doc },
          rev: 1,
          updatedAt: now,
          receivedAt: now,
          review: { state: "new" },
          deleted: false,
        }))
      )
      .onConflictDoUpdate({
        target: t.id,
        set: {
          doc: docOnUpdate(coll, sql`excluded.doc`),
          rev: sql`${t.rev} + 1`,
          updatedAt: now,
          receivedAt: now,
          deleted: false,
        },
      });
    for (const d of chunk) ids.push(d.id);
  }
  return { ids, complete: true };
}

/**
 * softDeleteDoc for many ids: deleted:true, rev+1, updatedAt/receivedAt
 * stamped — on whatever rows exist, already-deleted ones included (exactly
 * what softDeleteDoc does). `ids` are the rows that matched.
 */
export async function softDeleteDocs(
  coll: CollectionName,
  ids: readonly string[],
  opts: DocBatchOpts = {}
): Promise<DocBatchResult> {
  const db = await getDb();
  const t = table(coll);
  const done: string[] = [];
  for (const chunk of chunksOf([...new Set(ids)], opts.chunkSize ?? DOC_BATCH_CHUNK)) {
    if (opts.shouldStop?.()) return { ids: done, complete: false };
    const now = Date.now();
    const rows = await db
      .update(t)
      .set({
        deleted: true,
        rev: sql`${t.rev} + 1`,
        updatedAt: now,
        receivedAt: now,
      })
      .where(inArray(t.id, chunk))
      .returning({ id: t.id });
    for (const r of rows) done.push(r.id);
  }
  return { ids: done, complete: true };
}

/**
 * Set (`value`) or remove (`undefined`) ONE top-level key on many LIVE docs,
 * in place, in SQL — never a read-modify-write of the whole document, so a
 * write to any other field landing meanwhile is kept, and a soft-deleted row
 * is never touched (let alone revived). `stamp` adds more top-level keys in
 * the same statement (e.g. a doc's own `updatedAt`). One UPDATE per
 * DOC_BATCH_CHUNK ids, bumping rev / updated_at / received_at like every
 * other write here (the table's seq trigger re-draws seq). `ids` are the rows
 * actually changed (missing and deleted ids are absent). Grid notes #2.
 */
export async function patchDocKey(
  coll: CollectionName,
  ids: readonly string[],
  key: string,
  value: unknown,
  opts: DocBatchOpts & { stamp?: Record<string, unknown> } = {}
): Promise<DocBatchResult> {
  const db = await getDb();
  const t = table(coll);
  const done: string[] = [];
  const stamp = opts.stamp && Object.keys(opts.stamp).length ? sql` || ${JSON.stringify(opts.stamp)}::jsonb` : sql``;
  const next =
    value === undefined
      ? sql`(${t.doc} - ${key}::text)${stamp}`
      : sql`(${t.doc} || jsonb_build_object(${key}::text, ${JSON.stringify(value)}::jsonb))${stamp}`;
  for (const chunk of chunksOf([...new Set(ids)], Math.min(opts.chunkSize ?? DOC_BATCH_CHUNK, DOC_BATCH_CHUNK))) {
    if (opts.shouldStop?.()) return { ids: done, complete: false };
    const now = Date.now();
    const rows = await db
      .update(t)
      .set({ doc: next, rev: sql`${t.rev} + 1`, updatedAt: now, receivedAt: now })
      .where(and(inArray(t.id, chunk), eq(t.deleted, false)))
      .returning({ id: t.id });
    for (const r of rows) done.push(r.id);
  }
  return { ids: done, complete: true };
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
  if (ESTIMATE_NUMBERED.has(coll)) {
    // #223: the stored number wins (docOnUpdate); hand the caller what was stored.
    const rows = await db
      .update(t)
      .set({
        doc: docOnUpdate(coll, sql`${JSON.stringify(next)}::jsonb`),
        rev: sql`${t.rev} + 1`,
        updatedAt: Date.now(),
        receivedAt: Date.now(),
      })
      .where(eq(t.id, id))
      .returning({ doc: t.doc });
    const stored = rows[0]?.doc as Record<string, unknown> | undefined;
    if (stored) {
      const rec = next as Record<string, unknown>;
      for (const k of ["estNo", "estSuffix"]) {
        if (typeof stored[k] === "number") rec[k] = stored[k];
        else delete rec[k];
      }
    }
    return next;
  }
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

/**
 * Read-modify-write of blob `id` under a row lock (#343) — the closing of the
 * "residual gap" setBlob's comment above describes. For a writer whose new
 * value depends on the current one (append to a list kept under one key, edit
 * one entry of it, a check-then-set), so concurrent writers never lose each
 * other's change.
 *
 * Runs in a transaction (joins an outer one): `SELECT data … FOR UPDATE`,
 * then `fn(current)` returns a top-level patch merged exactly like setBlob
 * (a key replaces the stored value; an `undefined` value is skipped — use
 * null to clear, as setBlob callers do), or `null` to write nothing. `current`
 * is the raw stored object ({} when the blob doesn't exist). `fn` must be
 * pure, synchronous and fast: it can run more than once and runs while the
 * row is locked. A missing row: `fn({})` is asked first (null → nothing is
 * written), then `INSERT … ON CONFLICT DO NOTHING` and a re-select FOR
 * UPDATE, so a racing first writer is waited on, never overwritten. Returns
 * the stored object after the call.
 */
export async function updateBlob(
  id: string,
  fn: (current: Record<string, unknown>) => Record<string, unknown> | null
): Promise<Record<string, unknown>> {
  return withTransaction(async () => {
    const db = await getDb();
    const lock = () =>
      db.select({ data: blobs.data }).from(blobs).where(eq(blobs.id, id)).for("update").limit(1);
    let rows = await lock();
    if (!rows.length) {
      if (fn({}) === null) return {};
      await db
        .insert(blobs)
        .values({ id, data: {}, updatedAt: Date.now() })
        .onConflictDoNothing({ target: blobs.id });
      rows = await lock();
    }
    const current = ((rows[0]?.data as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
    const patch = fn(current);
    if (patch === null) return current;
    const next: Record<string, unknown> = { ...current };
    const kept: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) next[k] = kept[k] = v;
    // Only the patched keys travel (setBlob's `data || patch`), not the whole row.
    await db
      .update(blobs)
      .set({ data: sql`${blobs.data} || ${JSON.stringify(kept)}::jsonb`, updatedAt: Date.now() })
      .where(eq(blobs.id, id));
    return next;
  });
}

/**
 * Ids of every blob whose id starts with `prefix` (#304 — the per-user
 * `gridFavorites:<userId>` blobs, which the rename sweep has to visit). The
 * prefix is matched literally: `%`, `_` and `\` are escaped for LIKE.
 */
export async function listBlobIds(prefix: string): Promise<string[]> {
  const db = await getDb();
  const pattern = prefix.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
  const rows = await db.select({ id: blobs.id }).from(blobs).where(sql`${blobs.id} like ${pattern} escape '\\'`);
  return rows.map((r) => r.id).sort();
}

/**
 * #226: merge `patch` into blob `id` WITHOUT replacing any key already
 * there — the mirror image of setBlob's `||` (here the EXISTING row is the
 * right-hand side, so it wins per top-level key), in one atomic statement.
 * The Grid type map's auto-apply writes through this, so an admin entry can
 * never be replaced by an auto one, even when the two writes race.
 */
export async function setBlobKeysIfAbsent(
  id: string,
  patch: Record<string, unknown>
): Promise<void> {
  if (!Object.keys(patch).length) return;
  const db = await getDb();
  const json = JSON.stringify(patch);
  await db
    .insert(blobs)
    .values({ id, data: patch, updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: blobs.id,
      set: {
        data: sql`${json}::jsonb || ${blobs.data}`,
        updatedAt: Date.now(),
      },
    });
}
