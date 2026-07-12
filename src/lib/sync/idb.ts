/**
 * Tiny promise-based IndexedDB wrapper — the durable side of the Phase 6
 * offline outbox. Dependency-free (no external libs; Jeff's install stays a
 * plain `npm install`). One database, three stores:
 *
 * - `outbox`  keyed `${collection}::${id}` — whole documents captured while
 *             offline (or that failed to reach the server), awaiting push.
 *             This IS the prototype's per-record syncState==='pending' flag,
 *             promoted to a real queue so it survives a page reload / app
 *             restart the way localStorage did.
 * - `mirror`  keyed `${collection}::${id}` — a local read-cache of the field
 *             collections, hydrated from /api/sync/pull, so list/detail
 *             screens can fall back to last-known data with no signal.
 * - `meta`    keyed by string — pull cursors, lastSyncAt, etc.
 *
 * All state is device-local and non-sensitive (the same records the server
 * already holds); nothing here is a credential.
 */

const DB_NAME = "peak-sync";
const DB_VERSION = 1;
export const STORES = ["outbox", "mirror", "meta"] as const;
export type StoreName = (typeof STORES)[number];

export type OutboxEntry = {
  key: string; // `${collection}::${id}`
  collection: string;
  id: string;
  doc: Record<string, unknown>;
  rev: number;
  queuedAt: number;
  state: "pending" | "error";
  error?: string;
};

export type MirrorEntry = {
  key: string;
  collection: string;
  id: string;
  doc: Record<string, unknown>;
  rev: number;
  deleted: boolean;
  syncedAt: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function hasIDB(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) {
          db.createObjectStore(s, { keyPath: s === "meta" ? undefined : "key" });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

export const idb = {
  available: hasIDB,

  async getAll<T>(store: StoreName): Promise<T[]> {
    if (!hasIDB()) return [];
    return (await tx<T[]>(store, "readonly", (s) => s.getAll())) || [];
  },

  async get<T>(store: StoreName, key: string): Promise<T | undefined> {
    if (!hasIDB()) return undefined;
    return tx<T | undefined>(store, "readonly", (s) => s.get(key));
  },

  async put(store: StoreName, value: unknown, key?: string): Promise<void> {
    if (!hasIDB()) return;
    await tx(store, "readwrite", (s) =>
      key !== undefined ? s.put(value, key) : s.put(value)
    );
  },

  async delete(store: StoreName, key: string): Promise<void> {
    if (!hasIDB()) return;
    await tx(store, "readwrite", (s) => s.delete(key));
  },

  /* meta store uses out-of-line keys */
  async getMeta<T>(key: string): Promise<T | undefined> {
    return this.get<T>("meta", key);
  },
  async setMeta(key: string, value: unknown): Promise<void> {
    return this.put("meta", value, key);
  },
};

export function outboxKey(collection: string, id: string): string {
  return `${collection}::${id}`;
}
