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
 * window". Docs handed out by `get` are copies; docs from `all` are shared — never mutate them.
 * Plan: PR 2 Task 3.
 */
import { seedCatalog, seedEstimates, seedFixtures, seedMeta, seedRules, type SeedEstimate, type SeedFixture, type SeedMeta, type SeedPart, type SeedRules } from "./seed";

export type Coll = "quotes" | "catalog" | "fixtures" | "blobs" | "settings" | "reviewComments" | "activity" | "intros" | "meta";

export const COLLS: readonly Coll[] = ["quotes", "catalog", "fixtures", "blobs", "settings", "reviewComments", "activity", "intros", "meta"];
export const DB_NAME = "peak-estimator-handoff";
export const DB_VERSION = 1;
export const TOMBSTONES = "tombstones";
/** How long openStore waits for IndexedDB before falling back to memory. */
export const OPEN_TIMEOUT_MS = 4000;

export interface HandoffStore {
  /** false = in-memory fallback: edits last until the window closes. */
  persistent: boolean;
  /** overlay ?? seed; a tombstone reads as undefined. Returns a copy. */
  get<T>(c: Coll, id: string): Promise<T | undefined>;
  /** seed ∪ overlay − tombstones, overlay wins, seed order kept, new ids appended. Shared — never mutate. */
  all<T>(c: Coll): Promise<T[]>;
  put<T extends { id: string }>(c: Coll, doc: T): Promise<void>;
  /** Writes a tombstone (hides a seed doc too). */
  remove(c: Coll, id: string): Promise<void>;
  /** Deletes the IndexedDB database and drops the in-memory overlay — back to the snapshot. */
  reset(): Promise<void>;
}

export type StoreSeed = { [K in Coll]?: Array<{ id: string }> };

/**
 * The merged view of one collection: each seed doc in seed order, replaced by its overlay doc
 * when there is one and dropped when the overlay holds a tombstone (`null`); overlay docs whose
 * id the seed lacks follow, in the overlay's order. Pure — never mutates either input.
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

/** Reads the whole overlay (docs + tombstones) into memory. */
async function loadOverlay(db: IDBDatabase, overlay: Map<Coll, Map<string, { id: string } | null>>): Promise<void> {
  const tx = db.transaction([...COLLS, TOMBSTONES], "readonly");
  const done = txDone(tx);
  const reads = COLLS.map(async (c) => {
    const docs = await req(tx.objectStore(c).getAll() as IDBRequest<Array<{ id: string }>>);
    const m = overlay.get(c)!;
    for (const d of docs) m.set(d.id, d);
  });
  const tombs = req(tx.objectStore(TOMBSTONES).getAllKeys()).then((keys) => {
    for (const k of keys) {
      if (!Array.isArray(k) || k.length !== 2) continue;
      const m = overlay.get(k[0] as Coll);
      if (m) m.set(String(k[1]), null);
    }
  });
  await Promise.all([...reads, tombs, done]);
}

/**
 * Opens the store over `seed`. `opts.idb` overrides the IndexedDB factory (null = force the
 * in-memory fallback; Node tests). Never rejects: any IndexedDB failure means memory only.
 */
export async function openStore(seed: StoreSeed, opts: { idb?: IDBFactory | null } = {}): Promise<HandoffStore> {
  const idb = opts.idb !== undefined ? opts.idb : typeof indexedDB === "undefined" ? null : indexedDB;
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

  let db: IDBDatabase | null = null;
  if (idb) {
    try {
      db = await openDb(idb);
      await loadOverlay(db, overlay);
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

  /** Mirrors one overlay change into IndexedDB; a failed write keeps the in-memory change. */
  const persist = async (c: Coll, id: string, doc: { id: string } | null) => {
    if (!db) return;
    try {
      const tx = db.transaction([c, TOMBSTONES], "readwrite");
      const done = txDone(tx);
      if (doc) {
        tx.objectStore(c).put(doc);
        tx.objectStore(TOMBSTONES).delete(tombKey(c, id));
      } else {
        tx.objectStore(c).delete(id);
        tx.objectStore(TOMBSTONES).put(Date.now(), tombKey(c, id));
      }
      await done;
    } catch (e) {
      console.warn(`[handoff] could not save ${c}/${id} to IndexedDB (kept for this window only)`, e);
    }
  };

  const store: HandoffStore = {
    persistent: !!db,
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
      overlay.get(c)!.set(copy.id, copy);
      await persist(c, copy.id, copy);
    },
    async remove(c: Coll, id: string) {
      overlay.get(c)!.set(id, null);
      await persist(c, id, null);
    },
    async reset() {
      for (const m of overlay.values()) m.clear();
      if (!db || !idb) return;
      db.close();
      db = null;
      await new Promise<void>((resolve) => {
        const r = idb.deleteDatabase(DB_NAME);
        r.onsuccess = () => resolve();
        r.onerror = () => {
          console.warn("[handoff] could not delete the IndexedDB overlay", r.error);
          resolve();
        };
        r.onblocked = () => resolve();
      });
      // Reopen so later writes persist again (an empty database).
      try {
        db = await openDb(idb);
      } catch (e) {
        console.warn("[handoff] IndexedDB did not reopen after reset — in memory from here", e);
        store.persistent = false;
      }
    },
  };
  return store;
}
