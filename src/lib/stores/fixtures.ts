import { getDoc, getDocRows, insertDocIfAbsent, listDocs, softDeleteDoc, upsertDoc } from "@/db/doc-store";
import { getSettings } from "@/lib/settings";
import { sanitizeFixtureAssemblies, type CleanFixture, type FixtureRecord } from "@/lib/fixture-assemblies";
import { assemblyToFixture, normalizeFixtureRow, type RawFixtureRow } from "@/lib/fixtures-convert";
import { ensureFixturesConverted, fixturesConverted } from "@/lib/fixtures-migrate";

/**
 * Fixtures and systems (#FXB, spec §3) — one record type in the existing
 * `subassemblies` doc table (no new table, no SQL migration). Converted
 * Assemblies-tab records keep their `fa-…` ids, Subassemblies their `SA-…`
 * ids; new records get `SA-<TS36>`. Pure shapes/pricing live in
 * src/lib/fixture-assemblies.ts (client components import those, never this).
 */

export type { CleanFixture, FixtureBox, FixtureKind, FixtureLine, FixtureRecord, HeadLine, SystemScope } from "@/lib/fixture-assemblies";
export type FixtureSnapshot = NonNullable<FixtureRecord["snapshot"]>;

const COLL = "subassemblies" as const;
const byLabel = (a: FixtureRecord, b: FixtureRecord) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id);

/** Every live fixture and system. The first read on a database runs the
 *  one-time conversion; if that could not complete (error, budget, or a
 *  Vercel preview, which never converts), the settings-backed assemblies are
 *  served in memory so the Estimator, Quick Design and Grid keep resolving
 *  their ids. An id with ANY row — live or soft-deleted — is never served
 *  from settings (fix: a deleted in-memory `fa-` stays gone). */
export async function listFixtures(): Promise<FixtureRecord[]> {
  const converted = await ensureFixturesConverted();
  const rows = (await listDocs<RawFixtureRow>(COLL)).map(normalizeFixtureRow);
  if (!converted) {
    const have = new Set((await listDocs(COLL, { includeDeleted: true })).map((r) => r.id));
    for (const a of await settingsAssemblies()) {
      if (!have.has(a.id)) rows.push(assemblyToFixture(a, 0));
    }
  }
  return rows.sort(byLabel);
}

async function settingsAssemblies() {
  return sanitizeFixtureAssemblies((await getSettings()).fixtureAssemblies);
}

/** The settings-backed assembly listFixtures serves in memory for `id`, while
 *  the conversion has not completed and no row (live or deleted) holds it. */
async function inMemoryFixture(id: string): Promise<FixtureRecord | null> {
  if (await fixturesConverted()) return null;
  const a = (await settingsAssemblies()).find((x) => x.id === id);
  return a ? assemblyToFixture(a, 0) : null;
}

/** A live row, or — while unconverted — the in-memory settings-backed record
 *  listFixtures shows under the same id. A soft-deleted id reads as null. */
export async function getFixture(id: string): Promise<FixtureRecord | null> {
  const [row] = await getDocRows<RawFixtureRow>(COLL, [id]);
  if (row) return row.deleted ? null : normalizeFixtureRow(row.doc);
  return inMemoryFixture(id);
}

/** Mint `SA-<TS36>` through insertDocIfAbsent; a same-millisecond collision
 *  takes `-2`, `-3`, … instead of overwriting. */
export async function createFixture(value: CleanFixture, by: string, snapshot: FixtureSnapshot, now = Date.now()): Promise<FixtureRecord> {
  const base = `SA-${now.toString(36).toUpperCase()}`;
  for (let n = 0; n < 50; n++) {
    const rec: FixtureRecord = { ...value, id: n ? `${base}-${n + 1}` : base, snapshot, createdAt: now, createdBy: by, updatedAt: now, updatedBy: by };
    if (await insertDocIfAbsent(COLL, rec)) return rec;
  }
  throw new Error(`Could not mint a free fixture id after ${base}`);
}

/** Field names FixtureRecord defines but `value` (CleanFixture) may not carry
 *  — every optional field, even when absent from this save, so a cleared
 *  optional (lamp, position, circuit…) is never resurrected from the stored
 *  row just because it shares a name with the new shape. */
const OPTIONAL_FIXTURE_FIELDS = ["scope", "lightEngineLine", "lensLine", "lamp", "position", "circuit", "parts"] as const;

/** Replace the record body; keep id, kind, created stamps and provenance —
 *  and every legacy-only key `value` doesn't know about (options,
 *  lightEngineName, lensName, lightEngineCost, lensCost, cost, price,
 *  snapshot-era keys…), read from the RAW stored row: a row still in the old
 *  shape (a preview, production before/while the conversion runs, a row an
 *  older build re-saved) normalizes WITHOUT those keys, so carrying from the
 *  normalized record would drop exactly what an older build still reads. A
 *  human save clears `needsReview`.
 *
 *  An in-memory settings-backed `fa-` record (no row yet — unconverted
 *  database) is saved by creating its row under the same id
 *  (insert-if-absent, the conversion's own shape, so the conversion then
 *  skips it); a row that appeared meanwhile is updated instead, and one
 *  deleted meanwhile is refused. */
export async function updateFixture(
  existing: FixtureRecord,
  value: CleanFixture,
  by: string,
  snapshot: FixtureSnapshot,
  now = Date.now()
): Promise<FixtureRecord> {
  const newShapeKeys = new Set<string>([
    ...Object.keys(value),
    "id", "kind", "snapshot", "createdAt", "createdBy", "updatedAt", "updatedBy", "legacy", "needsReview",
    ...OPTIONAL_FIXTURE_FIELDS,
  ]);
  const build = (stored: Record<string, unknown>): FixtureRecord => {
    const legacyCarry: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(stored)) {
      if (!newShapeKeys.has(k)) legacyCarry[k] = v;
    }
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
  const raw = await getDoc<RawFixtureRow>(COLL, existing.id);
  if (raw) return upsertDoc(COLL, build(raw));
  const rec = build(existing);
  if (await insertDocIfAbsent(COLL, rec)) return rec;
  const appeared = await getDoc<RawFixtureRow>(COLL, existing.id);
  if (!appeared) throw new Error("This assembly was deleted — reload the page.");
  return upsertDoc(COLL, build(appeared));
}

/** Soft delete. An in-memory settings-backed `fa-` record (unconverted
 *  database) has no row to delete, so it gets a soft-deleted one under its
 *  id: listFixtures stops serving it and the conversion's insert-if-absent
 *  never re-inserts it. */
export async function removeFixture(id: string): Promise<void> {
  const [row] = await getDocRows(COLL, [id]);
  if (!row) {
    const mem = await inMemoryFixture(id);
    if (mem) await insertDocIfAbsent(COLL, mem);
  }
  await softDeleteDoc(COLL, id);
}
