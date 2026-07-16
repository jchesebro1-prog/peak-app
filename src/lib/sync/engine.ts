/**
 * SyncEngine — the client transport for Phase 6 offline capture. A faithful
 * port of the prototype's window.SyncEngine (app/sync.js), rebuilt against
 * the real backend:
 *
 *   push:  POST /api/sync/push   (batched whole-document upsert by client id)
 *   pull:  GET  /api/sync/pull   (cursor/seq based; the capability the
 *                                 prototype never had — makes the office/field
 *                                 split real across devices)
 *
 * The outbox is durable in IndexedDB (see idb.ts) so captures survive a
 * reload/restart the way the prototype's localStorage records did. Semantics
 * kept from sync.js:
 *  - optimistic local-first: enqueue writes the mirror immediately, then kicks
 *    a push; a save that reaches the server online never touches the outbox.
 *  - re-entry guarded syncNow; a connection loss mid-batch leaves the rest
 *    pending and the next `online`/unpause retries.
 *  - manual "work offline" pause persisted under the prototype's
 *    rss_sync_paused_v1 key; lastSyncAt under rss_sync_last_v1.
 *  - last-write-wins: a stale-rev push comes back "conflict" with the server
 *    copy; we keep the server copy (office edits win) and surface the count.
 *
 * This module is client-only (guards on window/indexedDB) and a singleton.
 */

import { idb, outboxKey, type OutboxEntry, type MirrorEntry } from "./idb";

/** Collections a field device mirrors locally for offline reads. */
// Keep in sync with SYNCABLE_COLLECTIONS in src/db/doc-tables.ts — the server
// push endpoint rejects any collection not in that allowlist, so adding one
// here without adding it there means its pushes are silently dropped.
export const FIELD_COLLECTIONS = [
  "surveys",
  "inspections",
  "flame_jobs",
  "repair_jobs",
  "projects",
  "customers",
] as const;

const PAUSED_KEY = "rss_sync_paused_v1";
const LAST_KEY = "rss_sync_last_v1";
const CURSORS_META = "cursors";

export type SyncStatus = {
  online: boolean;
  paused: boolean;
  connected: boolean; // online && !paused
  syncing: boolean;
  pending: number; // outbox entries awaiting/failed push
  errors: number; // outbox entries in 'error' state
  conflicts: number; // records the office overwrote since last clear
  lastSyncAt: number | null;
};

/**
 * Deterministic status for SSR and the first client render. getStatus() reads
 * navigator.onLine and localStorage, which the server can't see — hydrating
 * from those directly makes the first client render disagree with the server
 * markup. Matches what getStatus() returns in a browserless environment.
 */
export function initialStatus(): SyncStatus {
  return {
    online: true,
    paused: false,
    connected: true,
    syncing: false,
    pending: 0,
    errors: 0,
    conflicts: 0,
    lastSyncAt: null,
  };
}

type Listener = (s: SyncStatus) => void;

/** Broadcast to server-rendered screens so they can router.refresh(). */
export const SYNC_EVENT = "peak-sync";
export const DATA_PULLED_EVENT = "peak-data-pulled";

class SyncEngine {
  private listeners = new Set<Listener>();
  private syncing = false;
  private pending = 0;
  private errors = 0;
  private conflicts = 0;
  private lastSyncAt: number | null = null;
  private started = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  /* ---------- lifecycle ---------- */

  start() {
    if (this.started || typeof window === "undefined") return;
    this.started = true;
    this.lastSyncAt = this.readLast();
    window.addEventListener("online", this.onOnline);
    window.addEventListener("offline", this.onOffline);
    // Hydrate counts, then attempt an initial reconcile.
    void this.refreshCounts().then(() => {
      void this.syncNow();
      void this.pull();
    });
    // Gentle background poll so office→field changes arrive (SSE is Phase 7+).
    this.pollTimer = setInterval(() => {
      if (this.connected()) void this.pull();
    }, 60_000);
  }

  stop() {
    if (typeof window === "undefined") return;
    window.removeEventListener("online", this.onOnline);
    window.removeEventListener("offline", this.onOffline);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.started = false;
  }

  private onOnline = () => {
    this.emit();
    void this.syncNow();
  };
  private onOffline = () => this.emit();

  /* ---------- status ---------- */

  private isOnline(): boolean {
    // Node ≥21 defines a global navigator with no onLine, so check for an
    // explicit false rather than trusting the field to exist. Without this,
    // SSR renders the chip "Offline" and hydration mismatches.
    return typeof navigator === "undefined" || navigator.onLine !== false;
  }
  isPaused(): boolean {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(PAUSED_KEY) === "1";
  }
  connected(): boolean {
    return this.isOnline() && !this.isPaused();
  }
  getStatus(): SyncStatus {
    const online = this.isOnline();
    const paused = this.isPaused();
    return {
      online,
      paused,
      connected: online && !paused,
      syncing: this.syncing,
      pending: this.pending,
      errors: this.errors,
      conflicts: this.conflicts,
      lastSyncAt: this.lastSyncAt,
    };
  }

  setPaused(v: boolean) {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(PAUSED_KEY, v ? "1" : "0");
    }
    this.emit();
    if (!v) {
      void this.syncNow();
      void this.pull();
    }
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    cb(this.getStatus());
    return () => this.listeners.delete(cb);
  }

  private emit() {
    const s = this.getStatus();
    this.listeners.forEach((l) => l(s));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: s }));
    }
  }

  private readLast(): number | null {
    if (typeof localStorage === "undefined") return null;
    const v = localStorage.getItem(LAST_KEY);
    return v ? Number(v) : null;
  }
  private stampLast() {
    this.lastSyncAt = Date.now();
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LAST_KEY, String(this.lastSyncAt));
    }
  }

  private async refreshCounts() {
    const rows = await idb.getAll<OutboxEntry>("outbox");
    this.pending = rows.length;
    this.errors = rows.filter((r) => r.state === "error").length;
    this.emit();
  }

  /* ---------- outbox writes ---------- */

  /**
   * Capture a whole document locally and schedule a push. Called by the
   * save-seam when offline/paused, or when an online save failed to reach the
   * server. Mirrors immediately (optimistic) so the screen shows the edit.
   */
  async enqueue(
    collection: string,
    id: string,
    doc: Record<string, unknown>,
    rev = 1
  ): Promise<void> {
    const key = outboxKey(collection, id);
    const entry: OutboxEntry = {
      key,
      collection,
      id,
      doc: { ...doc, id },
      rev,
      queuedAt: Date.now(),
      state: "pending",
    };
    await idb.put("outbox", entry);
    await this.writeMirror(collection, id, doc, rev, false);
    await this.refreshCounts();
    void this.syncNow();
  }

  /**
   * Record a document that already reached the server via an online
   * server-action save: update the mirror and clear any stale outbox entry.
   */
  async recordSynced(
    collection: string,
    id: string,
    doc: Record<string, unknown>,
    rev = 1
  ): Promise<void> {
    await idb.delete("outbox", outboxKey(collection, id));
    await this.writeMirror(collection, id, doc, rev, false);
    await this.refreshCounts();
  }

  private async writeMirror(
    collection: string,
    id: string,
    doc: Record<string, unknown>,
    rev: number,
    deleted: boolean
  ) {
    const entry: MirrorEntry = {
      key: outboxKey(collection, id),
      collection,
      id,
      doc: { ...doc, id },
      rev,
      deleted,
      syncedAt: Date.now(),
    };
    await idb.put("mirror", entry);
  }

  /* ---------- read fallback (offline) ---------- */

  async mirrorList<T extends { id: string }>(collection: string): Promise<T[]> {
    const rows = await idb.getAll<MirrorEntry>("mirror");
    return rows
      .filter((r) => r.collection === collection && !r.deleted)
      .map((r) => ({ ...(r.doc as T), id: r.id }));
  }

  async mirrorGet<T extends { id: string }>(
    collection: string,
    id: string
  ): Promise<T | null> {
    const row = await idb.get<MirrorEntry>("mirror", outboxKey(collection, id));
    if (!row || row.deleted) return null;
    return { ...(row.doc as T), id: row.id };
  }

  /* ---------- transport ---------- */

  /** Flush the outbox to /api/sync/push, then pull to converge. */
  async syncNow(): Promise<void> {
    if (this.syncing || !this.connected()) return;
    const outbox = (await idb.getAll<OutboxEntry>("outbox")).filter(
      (e) => e.state === "pending"
    );
    if (!outbox.length) {
      // Nothing to push; still refresh the timestamp opportunistically.
      return;
    }
    this.syncing = true;
    this.emit();
    try {
      const collections: Record<
        string,
        Array<{ id: string; rev: number; doc: Record<string, unknown> }>
      > = {};
      for (const e of outbox) {
        (collections[e.collection] ||= []).push({
          id: e.id,
          rev: e.rev,
          doc: e.doc,
        });
      }
      const res = await fetch("/api/sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ collections }),
      });
      if (!res.ok) throw new Error(`push ${res.status}`);
      const data = (await res.json()) as {
        results: Record<
          string,
          Array<{
            id: string;
            status: "ok" | "conflict" | "error";
            rev?: number;
            server?: Record<string, unknown>;
          }>
        >;
      };
      let conflicts = 0;
      for (const [coll, recs] of Object.entries(data.results || {})) {
        for (const r of recs) {
          const key = outboxKey(coll, r.id);
          if (r.status === "ok") {
            await idb.delete("outbox", key);
            await this.writeMirror(
              coll,
              r.id,
              (await idb.get<MirrorEntry>("mirror", key))?.doc || {},
              r.rev ?? 1,
              false
            );
          } else if (r.status === "conflict") {
            // Office edits are newer — keep the server copy, drop our capture.
            conflicts++;
            await idb.delete("outbox", key);
            if (r.server) await this.writeMirror(coll, r.id, r.server, r.rev ?? 1, false);
          } else {
            // Malformed — flag but keep out of the retry loop until re-saved.
            const entry = await idb.get<OutboxEntry>("outbox", key);
            if (entry) await idb.put("outbox", { ...entry, state: "error" });
          }
        }
      }
      this.conflicts += conflicts;
      this.stampLast();
      await this.refreshCounts();
      await this.pull();
    } catch {
      // Network dropped mid-flush — leave the rest pending; retry on reconnect.
    } finally {
      this.syncing = false;
      this.emit();
    }
  }

  /** Pull office changes into the local mirror and advance cursors. */
  async pull(): Promise<void> {
    if (!this.connected()) return;
    try {
      const cursors =
        (await idb.getMeta<Record<string, number>>(CURSORS_META)) || {};
      const url =
        "/api/sync/pull?collections=" +
        FIELD_COLLECTIONS.join(",") +
        "&cursors=" +
        encodeURIComponent(JSON.stringify(cursors));
      const res = await fetch(url);
      if (!res.ok) return;
      const data = (await res.json()) as {
        changes: Record<
          string,
          Array<{
            id: string;
            doc: Record<string, unknown>;
            rev: number;
            deleted: boolean;
          }>
        >;
        cursors: Record<string, number>;
      };
      let applied = 0;
      for (const [coll, recs] of Object.entries(data.changes || {})) {
        for (const r of recs) {
          // Don't clobber a local capture still waiting to be pushed.
          const pendingLocal = await idb.get<OutboxEntry>(
            "outbox",
            outboxKey(coll, r.id)
          );
          if (pendingLocal && pendingLocal.state === "pending") continue;
          await this.writeMirror(coll, r.id, r.doc, r.rev, r.deleted);
          applied++;
        }
      }
      if (data.cursors) await idb.setMeta(CURSORS_META, data.cursors);
      if (applied > 0 && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(DATA_PULLED_EVENT));
      }
    } catch {
      /* offline — ignore */
    }
  }

  /* ---------- helpers ---------- */

  timeAgo(ts: number | null): string {
    if (!ts) return "never";
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 45) return "just now";
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  }

  clearConflicts() {
    this.conflicts = 0;
    this.emit();
  }
}

/** Module singleton (one per browser tab). */
let engine: SyncEngine | null = null;
export function getEngine(): SyncEngine {
  if (!engine) engine = new SyncEngine();
  return engine;
}
