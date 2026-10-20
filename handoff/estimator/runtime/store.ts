/**
 * Estimator handoff — the browser store: an IndexedDB overlay over the read-only slice.
 *
 * The slice (data/*.js → runtime/seed.ts) is the "production snapshot" and is never copied into
 * IndexedDB. Every write lands in the overlay — database `peak-estimator-handoff`, one object
 * store per collection plus `tombstones` — and every read is `overlay ?? seed`, minus tombstones.
 * **Reset to production snapshot** = `reset()`, which deletes the database.
 *
 * When IndexedDB is missing or refuses to open (some private windows), the store runs on an
 * in-memory overlay with `persistent: false`, and the shell shows "Changes won't be saved in this
 * window" (live: `subscribe` tells the shell when the flag flips — a failed write, or another window
 * deleting the database, also turns it off). Docs handed out by `get` are copies; docs from `all`
 * are shared — never mutate them. Overlay docs are stored as `{ id, seq, doc }` rows; `seq` is the
 * put order, so `all()` keeps it across reloads. Plan: PR 2 Task 3.
 */
import { seedCatalog, seedEstimates, seedFixtures, seedMeta, seedRules, type SeedEstimate, type SeedFixture, type SeedMeta, type SeedPart, type SeedRules } from "./seed";

export type Coll = "quotes" | "catalog" | "fixtures" | "blobs" | "settings" | "reviewComments" | "activity" | "intros" | "meta";

export const COLLS: readonly Coll[] = ["quotes", "catalog", "fixtures", "blobs", "settings", "reviewComments", "activity", "intros", "meta"];
export const DB_NAME = "peak-estimator-handoff";
export const DB_VERSION = 1;
export const TOMBSTONES = "tombstones";
/** How long openStore waits for IndexedDB before falling back to memory. */
export const OPEN_TIMEOUT_MS = 4000;
/** How long reset() waits for other windows to let go of the database before it gives up. */
export const RESET_TIMEOUT_MS = 4000;
/** reset() rejects with this when another window keeps the database open. */
export const RESET_BLOCKED_MESSAGE = "Close other prototype windows and try again.";

export interface HandoffStore {
  /** false = in-memory fallback: edits last until the window closes. Flips to false (never back, except
   *  after a successful reset) on a failed write or when another window deletes the database. */
  persistent: boolean;
  /** Calls `fn` whenever `persistent` changes. Returns the unsubscribe. Stable identity — fine for useSyncExternalStore. */
  subscribe(fn: () => void): () => void;
  /** overlay ?? seed; a tombstone reads as undefined. Returns a copy. */
  get<T>(c: Coll, id: string): Promise<T | undefined>;
  /** seed ∪ overlay − tombstones, overlay wins, seed order kept, new ids appended. Shared — never mutate. */
  all<T>(c: Coll): Promise<T[]>;
  put<T extends { id: string }>(c: Coll, doc: T): Promise<void>;
  /** Writes a tombstone (hides a seed doc too). */
  remove(c: Coll, id: string): Promise<void>;
  /**
   * Deletes the IndexedDB database and drops the in-memory overlay — back to the snapshot. Other
   * windows on the same database close their connection (and go non-persistent) so the delete can
   * proceed. Rejects with RESET_BLOCKED_MESSAGE when a window does not let go within RESET_TIMEOUT_MS;
   * the overlay is then left as it was and this window turns non-persistent.
   */
  reset(): Promise<void>;
}

export type StoreSeed = { [K in Coll]?: Array<{ id: string }> };

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
  return {
    quotes: g.estimates,
    catalog: g.catalog,
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

function openDb(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error(`IndexedDB did not open within ${OPEN_TIMEOUT_MS} ms`));
    }, OPEN_TIMEOUT_MS);
    let r: IDBOpenDBRequest;
    try {
      r = idb.open(DB_NAME, DB_VERSION);
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
 * in-memory fallback; Node tests). Never rejects: any IndexedDB failure means memory only.
 * `opts.resetTimeoutMs` shortens how long reset() waits for other windows (tests).
 */
export async function openStore(seed: StoreSeed, opts: { idb?: IDBFactory | null; resetTimeoutMs?: number } = {}): Promise<HandoffStore> {
  const idb = opts.idb !== undefined ? opts.idb : typeof indexedDB === "undefined" ? null : indexedDB;
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

  const listeners = new Set<() => void>();
  let db: IDBDatabase | null = null;
  let seq = 0;

  const setPersistent = (v: boolean) => {
    if (store.persistent === v) return;
    store.persistent = v;
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
      db = await openDb(idb);
      watch(db);
      seq = await loadOverlay(db, overlay);
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

  /** The next put order: strictly increasing here, and clock-ish so two windows rarely tie. */
  const nextSeq = () => (seq = Math.max(seq + 1, Date.now()));

  /** Mirrors one overlay change into IndexedDB. A failed write keeps the in-memory change and turns persistence off. */
  const persist = async (c: Coll, id: string, doc: { id: string } | null, at: number) => {
    const conn = db;
    if (!conn) return;
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

  /** deleteDatabase, waiting through `blocked` for the other windows to close. Resolves false on timeout. */
  const deleteDb = (factory: IDBFactory) =>
    new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => resolve(false), resetTimeout);
      let r: IDBOpenDBRequest;
      try {
        r = factory.deleteDatabase(DB_NAME);
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

  const store: HandoffStore = {
    persistent: !!db,
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    async get<T>(c: Coll, id: string) {
      const m = overlay.get(c)!;
      if (m.has(id)) return clone((m.get(id) ?? undefined) as T | undefined);
      return clone(indexOf(c).get(id) as T | undefined);
    },
    async all<T>(c: Coll) {
      return overlayMerge(seedOf(c), overlay.get(c)!) as T[];
    },
    async put<T extends { id: string }>(c: Coll, doc: T) {
      if (!doc || typeof doc.id !== "string" || doc.id === "") throw new Error(`put(${c}): a doc needs a string id`);
      const copy = clone(doc);
      const m = overlay.get(c)!;
      m.delete(copy.id); // a re-put moves to the end, the order IndexedDB's seq reproduces after a reload
      m.set(copy.id, copy);
      await persist(c, copy.id, copy, nextSeq());
    },
    async remove(c: Coll, id: string) {
      const m = overlay.get(c)!;
      m.delete(id);
      m.set(id, null);
      await persist(c, id, null, nextSeq());
    },
    async reset() {
      if (!idb) {
        for (const m of overlay.values()) m.clear();
        return;
      }
      try {
        db?.close();
      } catch {
        /* already closed */
      }
      db = null;
      let deleted: boolean;
      try {
        deleted = await deleteDb(idb);
      } catch (e) {
        console.warn("[handoff] could not delete the IndexedDB overlay", e);
        deleted = false;
      }
      if (!deleted) {
        // We let go of our connection; the delete stays queued behind the other window's. The overlay in
        // memory is untouched, and nothing more is saved here until the window reloads.
        setPersistent(false);
        throw new Error(RESET_BLOCKED_MESSAGE);
      }
      for (const m of overlay.values()) m.clear();
      seq = 0;
      // Reopen so later writes persist again (an empty database).
      try {
        db = await openDb(idb);
        watch(db);
        setPersistent(true);
      } catch (e) {
        console.warn("[handoff] IndexedDB did not reopen after reset — in memory from here", e);
        setPersistent(false);
      }
    },
  };
  return store;
}
