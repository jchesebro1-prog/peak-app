/**
 * Estimator handoff — the fixtures store over the browser store: src/lib/stores/fixtures.ts's reader and writers
 * (getFixture, createFixture, updateFixture, removeFixture) against the IndexedDB overlay's `fixtures` collection
 * (the app's `subassemblies` doc table). listFixtures is readers.ts's (the Estimator's props builder reads it too).
 *
 * The app soft-deletes (a `deleted` column next to the doc); the prototype keeps that as a marker row — the stored doc
 * plus `deleted: true` — so a deleted id is never minted again, a deleted settings-backed `fa-` assembly stays gone
 * (listFixtures counts the marker's id as "has a row"), and every reader skips it. Plan: PR 2 Task 9.
 */
import { sanitizeFixtureAssemblies, type CleanFixture, type FixtureRecord } from "@/lib/fixture-assemblies";
import { assemblyToFixture, normalizeFixtureRow, type RawFixtureRow } from "@/lib/fixtures-convert";
import type { HandoffStore } from "./store";
import { blobData, clock, settingsView } from "./ports";

export type FixtureSnapshot = NonNullable<FixtureRecord["snapshot"]>;
/** A stored fixtures row: a live doc, or a soft-delete marker (`deleted: true`). */
export type StoredFixtureRow = RawFixtureRow & { deleted?: boolean; deletedAt?: number };

export const isDeletedRow = (r: { deleted?: unknown } | null | undefined): boolean => !!r && r.deleted === true;

/** fixtures-migrate fixturesConverted(): the one-time conversion has completed (the `fixtures_convert` blob). */
export function fixturesConvertedNow(): boolean {
  const flag = blobData("fixtures_convert") as { convertedAt?: unknown };
  return typeof flag.convertedAt === "number" && flag.convertedAt > 0;
}

/** stores/fixtures inMemoryFixture: while unconverted, the settings-backed assembly no row (live or deleted) holds. */
async function inMemoryFixture(id: string): Promise<FixtureRecord | null> {
  if (fixturesConvertedNow()) return null;
  const a = sanitizeFixtureAssemblies(settingsView().fixtureAssemblies).find((x) => x.id === id);
  return a ? assemblyToFixture(a, 0) : null;
}

/** Every id that has a row — live, soft-deleted (marker) or a deleted seed doc. Insert-if-absent and the settings fallback both check it. */
export async function fixtureIdsWithRows(store: HandoffStore): Promise<Set<string>> {
  return new Set((await store.allIncludingDeleted<StoredFixtureRow>("fixtures")).map((r) => r.id));
}

/** stores/fixtures getFixture: a live row normalized, or — while unconverted and no row holds the id — the settings-backed record. A soft-deleted id reads as null. */
export async function getFixtureLocal(store: HandoffStore, id: string): Promise<FixtureRecord | null> {
  if (!id) return null;
  const row = await store.get<StoredFixtureRow>("fixtures", id);
  if (row) return isDeletedRow(row) ? null : normalizeFixtureRow(row);
  if ((await fixtureIdsWithRows(store)).has(id)) return null; // a tombstoned seed row
  return inMemoryFixture(id);
}

async function insertIfAbsent(store: HandoffStore, rec: FixtureRecord): Promise<boolean> {
  if ((await fixtureIdsWithRows(store)).has(rec.id)) return false;
  await store.put("fixtures", rec);
  return true;
}

/** stores/fixtures createFixture: mint `SA-<TS36>` insert-if-absent; a same-millisecond collision takes `-2`, `-3`, … */
export async function createFixtureLocal(store: HandoffStore, value: CleanFixture, by: string, snapshot: FixtureSnapshot, now = clock.now()): Promise<FixtureRecord> {
  const base = `SA-${now.toString(36).toUpperCase()}`;
  for (let n = 0; n < 50; n++) {
    const rec: FixtureRecord = { ...value, id: n ? `${base}-${n + 1}` : base, snapshot, createdAt: now, createdBy: by, updatedAt: now, updatedBy: by };
    if (await insertIfAbsent(store, rec)) return rec;
  }
  throw new Error(`Could not mint a free fixture id after ${base}`);
}

/** stores/fixtures OPTIONAL_FIXTURE_FIELDS — never carried from the stored row (a cleared optional stays cleared). */
const OPTIONAL_FIXTURE_FIELDS = ["scope", "lightEngineLine", "lensLine", "lamp", "position", "circuit", "portalCategory", "parts", "rack"] as const;

/**
 * stores/fixtures updateFixture: replace the body; keep id, kind, created stamps and provenance, and every legacy-only
 * key the new shape doesn't know about, read from the RAW stored row. A human save clears `needsReview`. An in-memory
 * settings-backed record (no row) is saved by creating its row under the same id; one deleted meanwhile is refused.
 */
export async function updateFixtureLocal(store: HandoffStore, existing: FixtureRecord, value: CleanFixture, by: string, snapshot: FixtureSnapshot, now = clock.now()): Promise<FixtureRecord> {
  const newShapeKeys = new Set<string>([
    ...Object.keys(value),
    "id", "kind", "snapshot", "createdAt", "createdBy", "updatedAt", "updatedBy", "legacy", "needsReview",
    ...OPTIONAL_FIXTURE_FIELDS,
  ]);
  const build = (stored: Record<string, unknown>): FixtureRecord => {
    const legacyCarry: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(stored)) if (!newShapeKeys.has(k)) legacyCarry[k] = v;
    return {
      ...legacyCarry,
      ...value,
      id: existing.id,
      kind: existing.kind,
      snapshot,
      createdAt: existing.createdAt || now,
      createdBy: existing.createdBy,
      updatedAt: now,
      updatedBy: by,
      ...(existing.legacy ? { legacy: existing.legacy } : {}),
    } as FixtureRecord;
  };
  const raw = await store.get<StoredFixtureRow>("fixtures", existing.id);
  if (raw && !isDeletedRow(raw)) {
    const rec = build(raw);
    await store.put("fixtures", rec);
    return rec;
  }
  if (raw) throw new Error("This assembly was deleted — reload the page.");
  const rec = build(existing as unknown as Record<string, unknown>);
  if (await insertIfAbsent(store, rec)) return rec;
  throw new Error("This assembly was deleted — reload the page.");
}

/** stores/fixtures removeFixture: soft delete — a marker row under the id (an in-memory settings-backed record gets one too, so it stays gone). */
export async function removeFixtureLocal(store: HandoffStore, id: string, now = clock.now()): Promise<void> {
  if (!id) return;
  const row = await store.get<StoredFixtureRow>("fixtures", id);
  if (row) {
    if (!isDeletedRow(row)) await store.put("fixtures", { ...row, deleted: true, deletedAt: now });
    return;
  }
  const mem = await inMemoryFixture(id);
  if (mem) await store.put("fixtures", { ...(mem as unknown as RawFixtureRow), deleted: true, deletedAt: now });
}
