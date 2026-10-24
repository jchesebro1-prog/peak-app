/**
 * Estimator handoff — the browser store: an IndexedDB overlay over the read-only slice.
 *
 * The slice (data/*.js → runtime/seed.ts) is the "production snapshot" and is never copied into
 * IndexedDB. Every write lands in the overlay — database `peak-estimator-handoff:<the snapshot's
 * exportedAt>` (dbNameFor: a new package never layers an older package's edits), one object
 * store per collection plus `tombstones` — and every read is `overlay ?? seed`, minus tombstones.
 * **Reset to production snapshot** = `reset()`, which deletes the database.
 *
 * When IndexedDB is missing or refuses to open (some private windows), the store runs on an
 * in-memory overlay with `persistent: false`, and the shell shows "Changes won't be saved in this
 * window" (live: `subscribe` tells the shell when the flag flips — a failed write, or another window
 * deleting the database, also turns it off). Docs handed out by `get` are copies; docs from `all`
 * are shared — never mutate them. Overlay docs are stored as `{ id, seq, doc }` rows; `seq` is the
 * put order, so `all()` keeps it across reloads. Parts retired by a SKU rename ({ id, sku, renamedTo } stubs)
 * are not catalog docs: `storeSeedFrom` splits them into `catalogRenames`, which only the sku resolver reads.
 * Plan: PR 2 Task 3.
 */
import { quoteOnMarkupBasis, rateBlobOnMarkupBasis } from "../markup-basis";
import { seedCatalog, seedEstimates, seedFixtures, seedMeta, seedRules, type SeedEstimate, type SeedFixture, type SeedMeta, type SeedPart, type SeedRules } from "./seed";

// "fixtures" rows with `deleted: true` are soft-delete markers — readers must skip them (use readers.listFixtures).
export type Coll = "quotes" | "catalog" | "fixtures" | "blobs" | "settings" | "reviewComments" | "activity" | "intros" | "meta";

export const COLLS: readonly Coll[] = ["quotes", "catalog", "fixtures", "blobs", "settings", "reviewComments", "activity", "intros", "meta"];
/** The overlay database's base name; the real one is keyed by the snapshot (dbNameFor). */
export const DB_NAME = "peak-estimator-handoff";
/** Longest snapshot key kept in the database name. */
export const DB_KEY_MAX = 64;

/**
 * The overlay database for one snapshot: `peak-estimator-handoff:<exportedAt>` (characters outside
 * [A-Za-z0-9._:-] dropped, ≤ DB_KEY_MAX). A package sliced from another export opens its own, empty database, so
 * an older package's edits never show over a newer snapshot (they stay in their own database). No exportedAt →
 * the bare DB_NAME. Pure.
 */
export function dbNameFor(exportedAt: unknown): string {
  const key = typeof exportedAt === "string" ? exportedAt.trim().replace(/[^A-Za-z0-9._:-]/g, "").slice(0, DB_KEY_MAX) : "";
  return key ? `${DB_NAME}:${key}` : DB_NAME;
}
export const DB_VERSION = 1;
export const TOMBSTONES = "tombstones";
/** How long openStore waits for IndexedDB before falling back to memory. */
export const OPEN_TIMEOUT_MS = 4000;
/** How long reset() waits for other windows to let go of the database before it gives up. */
export const RESET_TIMEOUT_MS = 4000;
/** reset() rejects with this when another window keeps the database open. */
export const RESET_BLOCKED_MESSAGE = "Close other prototype windows and try again.";

export interface HandoffStore {
  /** The IndexedDB database this store's overlay lives in (dbNameFor the snapshot; DB_NAME when none was given). */
  readonly dbName: string;
  /** false = in-memory fallback: edits last until the window closes. Flips to false (never back, except
   *  after a successful reset) on a failed write or when another window deletes the database. */
  readonly persistent: boolean;
  /** old sku → renamedTo for parts retired by a SKU rename (#304). Read-only seed data, never listed by `all("catalog")`. */
  readonly catalogRenames: ReadonlyMap<string, string>;
  /** Calls `fn` whenever `persistent` changes. Returns the unsubscribe. Stable identity — fine for useSyncExternalStore. */
  subscribe(fn: () => void): () => void;
  /** overlay ?? seed; a tombstone reads as undefined. Returns a copy. */
  get<T>(c: Coll, id: string): Promise<T | undefined>;
  /** seed ∪ overlay − tombstones, overlay wins, seed order kept, new ids appended. Shared — never mutate. */
  all<T>(c: Coll): Promise<T[]>;
  /**
   * `all()` plus the docs that were deleted: every seed doc (a tombstoned one reads as its seed copy) ∪ the live overlay
   * docs. For id / number counters only — a deleted seed id or number is never handed out again. (An overlay-only doc
   * that was deleted is gone; the `meta/*` counters remember what was minted.) Shared — never mutate.
   */
  allIncludingDeleted<T>(c: Coll): Promise<T[]>;
  put<T extends { id: string }>(c: Coll, doc: T): Promise<void>;
  /** Writes a tombstone (hides a seed doc too). */
  remove(c: Coll, id: string): Promise<void>;
  /**
   * Deletes the IndexedDB database and drops the in-memory overlay — back to the snapshot. Other
   * windows on the same database close their connection (and go non-persistent) so the delete can
   * proceed. The window reads non-persistent while the reset runs; writes made meanwhile survive it
   * (kept in memory, written to the fresh database after the reopen).
   *
   * - In-memory fallback (IndexedDB never opened): just clears the overlay; deleteDatabase is not called.
   * - deleteDatabase fails with an error: the overlay is cleared and the reset resolves, but this window
   *   stays non-persistent (the old database may still be on disk).
   * - Rejects with RESET_BLOCKED_MESSAGE when a window does not let go within RESET_TIMEOUT_MS; the overlay
   *   is then left as it was and this window turns non-persistent. **The deleteDatabase request stays queued in
   *   the browser** — it still runs (and wipes the saved overlay) as soon as the blocking window closes or reloads.
   */
  reset(): Promise<void>;
}

export type StoreSeed = { [K in Coll]?: Array<{ id: string }> } & {
  /** Retired-SKU stubs — kept out of the `catalog` collection so no reader can list a blank part. */
  catalogRenames?: Array<{ id: string; sku?: string; renamedTo?: string }>;
};

/**
 * The merged view of one collection: each seed doc in seed order, replaced by its overlay doc
 * when there is one and dropped when the overlay holds a tombstone (`null`); overlay docs whose
 * id the seed lacks follow, in the overlay's order (the last put comes last). Pure — never mutates either input.
 */
export function overlayMerge<T extends { id: string }>(seed: T[], overlay: Map<string, T | null>): T[] {
  if (overlay.size === 0) return seed.slice();
  const out: T[] = [];
  const seen = new Set<string>();
  for (const doc of seed) {
    seen.add(doc.id);
    if (!overlay.has(doc.id)) out.push(doc);
    else {
      const o = overlay.get(doc.id);
      if (o) out.push(o);
    }
  }
  for (const [id, o] of overlay) if (o && !seen.has(id)) out.push(o);
  return out;
}

/** One persisted overlay row: the doc and its put order. Rows written before `seq` existed are bare docs (seq 0). */
export type OverlayRow = { id: string; seq: number; doc: { id: string } };

/** A stored row → its seq and doc (a bare legacy doc reads as seq 0). */
function unwrapRow(row: { id: string } & Partial<OverlayRow>): { seq: number; doc: { id: string } } {
  return typeof row.seq === "number" && row.doc && typeof row.doc === "object" ? { seq: row.seq, doc: row.doc } : { seq: 0, doc: row };
}

/**
 * The overlay map for one collection from its stored rows (IndexedDB's getAll hands them back in id
 * order): inserted by ascending `seq`, so overlayMerge's "new ids follow in the overlay's order" is
 * the order the docs were put in, across reloads. Pure.
 */
export function overlayFromRows(rows: Array<{ id: string } & Partial<OverlayRow>>): Map<string, { id: string } | null> {
  const m = new Map<string, { id: string } | null>();
  rows
    .map((r, i) => ({ ...unwrapRow(r), i }))
    .sort((a, b) => a.seq - b.seq || a.i - b.i)
    .forEach((r) => m.set(r.doc.id, r.doc));
  return m;
}

/** The store's seed from the slice's globals (pure — tests pass parsed slices in). */
export function storeSeedFrom(g: {
  estimates: SeedEstimate[];
  catalog: SeedPart[];
  fixtures: SeedFixture[];
  rules: SeedRules;
  meta: SeedMeta | null;
}): StoreSeed {
  // A retired part (#304) arrives as { id, sku, renamedTo }: it is a redirect, not a part.
  const live: SeedPart[] = [];
  const catalogRenames: Array<{ id: string; sku?: string; renamedTo?: string }> = [];
  for (const p of g.catalog) {
    if (typeof p.renamedTo === "string" && p.renamedTo !== "") catalogRenames.push({ id: p.id, sku: p.sku ?? p.id, renamedTo: p.renamedTo });
    else live.push(p);
  }
  return {
    quotes: g.estimates,
    catalog: live,
    catalogRenames,
    fixtures: g.fixtures,
    // one row per table row, as in the app: settings row "main", blobs by id — { id, data }
    settings: [{ id: "main", data: g.rules.settings ?? {} } as { id: string }],
    blobs: Object.entries(g.rules.blobs ?? {}).map(([id, data]) => ({ id, data }) as { id: string }),
    meta: g.meta ? [{ id: "slice", ...g.meta }] : [],
  };
}

/** The seed from the window.PEAK_* globals the data/*.js scripts set. */
export function seedFromSlice(): StoreSeed {
  return storeSeedFrom({ estimates: seedEstimates(), catalog: seedCatalog(), fixtures: seedFixtures(), rules: seedRules(), meta: seedMeta() });
}

/**
 * #367 — the store's one read hook, the twin of the app's doc-store `hydrateDoc`: a quote without `pricingBasis: "markup"`
 * stores margins and reads converted (exactly, no sell moves); a rate blob not yet stamped reads converted once (whole-%
 * markup). A stamped doc is handed back untouched, so what the prototype itself saved is never converted twice. The result
 * is memoized per source object, so `all()` keeps returning the same objects between writes. See markup-basis.ts.
 */
const converted = new WeakMap<object, unknown>();
function onMarkupBasis<T>(c: Coll, doc: T): T {
  if (!doc || typeof doc !== "object" || (c !== "quotes" && c !== "blobs")) return doc;
  const hit = converted.get(doc as object);
  if (hit !== undefined) return hit as T;
  const out =
    c === "quotes"
      ? (quoteOnMarkupBasis(doc as unknown as Record<string, unknown>) as unknown as T)
      : (() => {
          const b = doc as unknown as { id?: string; data?: unknown };
          const data = rateBlobOnMarkupBasis(String(b.id), b.data);
          return data === b.data ? doc : ({ ...b, data } as unknown as T);
        })();
  converted.set(doc as object, out);
  return out;
}

const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));
const tombKey = (c: Coll, id: string): [string, string] => [c, id];

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function openDb(idb: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error(`IndexedDB did not open within ${OPEN_TIMEOUT_MS} ms`));
    }, OPEN_TIMEOUT_MS);
    let r: IDBOpenDBRequest;
    try {
      r = idb.open(name, DB_VERSION);
    } catch (e) {
      clearTimeout(timer);
      reject(e);
      return;
    }
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const c of COLLS) if (!db.objectStoreNames.contains(c)) db.createObjectStore(c, { keyPath: "id" });
      if (!db.objectStoreNames.contains(TOMBSTONES)) db.createObjectStore(TOMBSTONES);
    };
    r.onsuccess = () => {
      clearTimeout(timer);
      if (settled) r.result.close();
      else resolve(r.result);
    };
    r.onerror = () => {
      clearTimeout(timer);
      if (!settled) reject(r.error);
    };
    r.onblocked = () => console.warn("[handoff] IndexedDB open is blocked by another window");
  });
}

/** Reads the whole overlay (docs in put order, then tombstones) into memory. */
async function loadOverlay(db: IDBDatabase, overlay: Map<Coll, Map<string, { id: string } | null>>): Promise<number> {
  const tx = db.transaction([...COLLS, TOMBSTONES], "readonly");
  const done = txDone(tx);
  let maxSeq = 0;
  const reads = COLLS.map(async (c) => {
    const rows = await req(tx.objectStore(c).getAll() as IDBRequest<Array<{ id: string } & Partial<OverlayRow>>>);
    for (const r of rows) maxSeq = Math.max(maxSeq, unwrapRow(r).seq);
    overlay.set(c, overlayFromRows(rows));
  });
  const tombs = req(tx.objectStore(TOMBSTONES).getAllKeys()).then((keys) => keys);
  const [, , keys] = await Promise.all([Promise.all(reads), done, tombs]);
  for (const k of keys) {
    if (!Array.isArray(k) || k.length !== 2) continue;
    const m = overlay.get(k[0] as Coll);
    if (m) m.set(String(k[1]), null);
  }
  return maxSeq;
}

/**
 * Opens the store over `seed`. `opts.idb` overrides the IndexedDB factory (null = force the
 * in-memory fallback; Node tests); `opts.dbName` is the overlay database (main.tsx: dbNameFor the snapshot's
 * exportedAt; default DB_NAME). Never rejects: any IndexedDB failure means memory only.
 * `opts.resetTimeoutMs` shortens how long reset() waits for other windows (tests).
 */
export async function openStore(seed: StoreSeed, opts: { idb?: IDBFactory | null; resetTimeoutMs?: number; dbName?: string } = {}): Promise<HandoffStore> {
  const idb = opts.idb !== undefined ? opts.idb : typeof indexedDB === "undefined" ? null : indexedDB;
  const dbName = opts.dbName ?? DB_NAME;
  const resetTimeout = opts.resetTimeoutMs ?? RESET_TIMEOUT_MS;
  const overlay = new Map<Coll, Map<string, { id: string } | null>>(COLLS.map((c) => [c, new Map()]));
  const seedIndex = new Map<Coll, Map<string, { id: string }>>();
  const seedOf = (c: Coll) => seed[c] ?? [];
  const indexOf = (c: Coll) => {
    let m = seedIndex.get(c);
    if (!m) {
      m = new Map(seedOf(c).map((d) => [d.id, d]));
      seedIndex.set(c, m);
    }
    return m;
  };

  // Mutable state and listeners come first: a versionchange can fire while the database is still loading.
  const listeners = new Set<() => void>();
  let persistent = false;
  let db: IDBDatabase | null = null;
  let seq = 0;
  /** IndexedDB opened and loaded at startup. False = the in-memory fallback: there is no database to delete. */
  let opened = false;
  /** Writes made while reset() is running — they survive it (replayed into memory, written after the reopen). */
  let midReset: Array<{ c: Coll; id: string; doc: { id: string } | null; at: number }> | null = null;
  let resetting: Promise<void> | null = null;

  const setPersistent = (v: boolean) => {
    if (persistent === v) return;
    persistent = v;
    for (const fn of [...listeners]) {
      try {
        fn();
      } catch (e) {
        console.error("[handoff] store subscriber threw", e);
      }
    }
  };

  /** Gives the connection up when another window wants to delete / upgrade the database (its Reset). */
  const watch = (conn: IDBDatabase) => {
    conn.onversionchange = () => {
      conn.close();
      if (db === conn) {
        db = null;
        console.warn("[handoff] another window reset the prototype data — changes in this window are no longer saved");
        setPersistent(false);
      }
    };
  };

  if (idb) {
    try {
      const conn = await openDb(idb, dbName);
      db = conn;
      watch(conn);
      seq = await loadOverlay(conn, overlay);
      opened = true;
    } catch (e) {
      console.warn("[handoff] IndexedDB unavailable — changes won't be saved in this window", e);
      try {
        db?.close();
      } catch {
        /* already closed */
      }
      db = null;
      for (const m of overlay.values()) m.clear();
    }
  }
  persistent = !!db;

  /** The next put order: strictly increasing here, and clock-ish so two windows rarely tie. */
  const nextSeq = () => (seq = Math.max(seq + 1, Date.now()));

  /** Mirrors one overlay change into IndexedDB. A failed write — or no connection to write to — keeps the in-memory change and turns persistence off. */
  const persist = async (c: Coll, id: string, doc: { id: string } | null, at: number) => {
    const conn = db;
    if (!conn) {
      setPersistent(false); // the write is skipped: never report it as saved
      return;
    }
    try {
      const tx = conn.transaction([c, TOMBSTONES], "readwrite");
      const done = txDone(tx);
      if (doc) {
        tx.objectStore(c).put({ id, seq: at, doc } satisfies OverlayRow);
        tx.objectStore(TOMBSTONES).delete(tombKey(c, id));
      } else {
        tx.objectStore(c).delete(id);
        tx.objectStore(TOMBSTONES).put(Date.now(), tombKey(c, id));
      }
      await done;
    } catch (e) {
      console.warn(`[handoff] could not save ${c}/${id} to IndexedDB — changes in this window are no longer saved`, e);
      if (db === conn) {
        try {
          conn.close();
        } catch {
          /* already closed */
        }
        db = null;
      }
      setPersistent(false);
    }
  };

  /** A write: into memory (the caller did that), then IndexedDB — or, during a reset, the queue the reset drains. */
  const write = async (c: Coll, id: string, doc: { id: string } | null) => {
    const at = nextSeq();
    if (midReset) {
      midReset.push({ c, id, doc, at });
      await resetting?.catch(() => undefined); // resolves once the reset has written it (or given up)
    } else await persist(c, id, doc, at);
  };

  /** deleteDatabase, waiting through `blocked` for the other windows to close. Resolves false on timeout; rejects on an error. */
  const deleteDb = (factory: IDBFactory) =>
    new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => resolve(false), resetTimeout);
      let r: IDBOpenDBRequest;
      try {
        r = factory.deleteDatabase(dbName);
      } catch (e) {
        clearTimeout(timer);
        reject(e);
        return;
      }
      r.onsuccess = () => {
        clearTimeout(timer);
        resolve(true);
      };
      r.onerror = () => {
        clearTimeout(timer);
        reject(r.error ?? new Error("could not delete the IndexedDB overlay"));
      };
      r.onblocked = () => console.warn("[handoff] reset is waiting for other prototype windows to close");
    });

  const clearOverlay = () => {
    for (const m of overlay.values()) m.clear();
    seq = 0;
  };

  const doReset = async (factory: IDBFactory) => {
    const queue: NonNullable<typeof midReset> = (midReset = []);
    setPersistent(false); // honest until the reopen: nothing written meanwhile is on disk yet
    try {
      db?.close();
    } catch {
      /* already closed */
    }
    db = null;
    let deleted = false;
    let failed = false;
    try {
      deleted = await deleteDb(factory);
    } catch (e) {
      console.warn("[handoff] could not delete the IndexedDB overlay", e);
      failed = true;
    }
    if (!deleted && !failed) {
      // Timed out. We let go of our connection; the delete stays queued behind the other window's. The overlay in
      // memory (mid-reset writes included) is untouched, and nothing more is saved here until the window reloads.
      midReset = null;
      throw new Error(RESET_BLOCKED_MESSAGE);
    }
    // Back to the snapshot — but a write made while the reset ran is newer than the reset: replay it.
    const replay = queue.splice(0);
    clearOverlay();
    for (const w of replay) {
      const m = overlay.get(w.c)!;
      m.delete(w.id);
      m.set(w.id, w.doc);
      seq = Math.max(seq, w.at);
    }
    if (failed) {
      // The old database may still be on disk, so don't reopen it over a cleared memory: stay non-persistent.
      midReset = null;
      return;
    }
    // Reopen so later writes persist again (an empty database), then write what came in meanwhile.
    try {
      const conn = await openDb(factory, dbName);
      db = conn;
      watch(conn);
    } catch (e) {
      console.warn("[handoff] IndexedDB did not reopen after reset — in memory from here", e);
      midReset = null;
      return;
    }
    const flush = replay;
    while (flush.length || queue.length) {
      flush.push(...queue.splice(0));
      const w = flush.shift()!;
      await persist(w.c, w.id, w.doc, w.at);
    }
    midReset = null;
    if (db) setPersistent(true); // a failed flush closed the connection and left it off
  };

  const store: HandoffStore = {
    dbName,
    get persistent() {
      return persistent;
    },
    catalogRenames: new Map((seed.catalogRenames ?? []).filter((r) => r.renamedTo).map((r) => [r.sku ?? r.id, r.renamedTo as string])),
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    async get<T>(c: Coll, id: string) {
      const m = overlay.get(c)!;
      if (m.has(id)) return clone(onMarkupBasis(c, (m.get(id) ?? undefined) as T | undefined));
      return clone(onMarkupBasis(c, indexOf(c).get(id) as T | undefined));
    },
    async all<T>(c: Coll) {
      return overlayMerge(seedOf(c), overlay.get(c)!).map((d) => onMarkupBasis(c, d)) as T[];
    },
    async allIncludingDeleted<T>(c: Coll) {
      const live = new Map<string, { id: string } | null>();
      for (const [id, d] of overlay.get(c)!) if (d) live.set(id, d);
      return overlayMerge(seedOf(c), live).map((d) => onMarkupBasis(c, d)) as T[];
    },
    async put<T extends { id: string }>(c: Coll, doc: T) {
      if (!doc || typeof doc.id !== "string" || doc.id === "") throw new Error(`put(${c}): a doc needs a string id`);
      const copy = clone(doc);
      const m = overlay.get(c)!;
      m.delete(copy.id); // a re-put moves to the end, the order IndexedDB's seq reproduces after a reload
      m.set(copy.id, copy);
      await write(c, copy.id, copy);
    },
    async remove(c: Coll, id: string) {
      const m = overlay.get(c)!;
      m.delete(id);
      m.set(id, null);
      await write(c, id, null);
    },
    reset() {
      if (resetting) return resetting;
      if (!idb || !opened) {
        // In-memory fallback: there is no database to delete.
        clearOverlay();
        return Promise.resolve();
      }
      const p = doReset(idb).finally(() => {
        resetting = null;
      });
      resetting = p;
      return p;
    },
  };
  return store;
}
