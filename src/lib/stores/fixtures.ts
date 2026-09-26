import { getDoc, insertDocIfAbsent, listDocs, softDeleteDoc, upsertDoc } from "@/db/doc-store";
import { getSettings } from "@/lib/settings";
import { sanitizeFixtureAssemblies, type CleanFixture, type FixtureRecord } from "@/lib/fixture-assemblies";
import { assemblyToFixture, normalizeFixtureRow, type RawFixtureRow } from "@/lib/fixtures-convert";
import { ensureFixturesConverted } from "@/lib/fixtures-migrate";

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
 *  one-time conversion; if that could not complete (error or budget), the
 *  settings-backed assemblies are served in memory so the Estimator, Quick
 *  Design and Grid keep resolving their ids. */
export async function listFixtures(): Promise<FixtureRecord[]> {
  const converted = await ensureFixturesConverted();
  const rows = (await listDocs<RawFixtureRow>(COLL)).map(normalizeFixtureRow);
  if (!converted) {
    const have = new Set(rows.map((r) => r.id));
    for (const a of sanitizeFixtureAssemblies((await getSettings()).fixtureAssemblies)) {
      if (!have.has(a.id)) rows.push(assemblyToFixture(a, 0));
    }
  }
  return rows.sort(byLabel);
}

export async function getFixture(id: string): Promise<FixtureRecord | null> {
  const row = await getDoc<RawFixtureRow>(COLL, id);
  return row ? normalizeFixtureRow(row) : null;
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
 *  optional (lamp, position, circuit…) is never resurrected from `existing`
 *  just because it shares a name with the new shape. */
const OPTIONAL_FIXTURE_FIELDS = ["scope", "lightEngineLine", "lensLine", "lamp", "position", "circuit", "parts"] as const;

/** Replace the record body; keep id, kind, created stamps and provenance —
 *  and, for a converted row (fix wave 1), every legacy-only key `value`
 *  doesn't know about (options, lightEngineName, lensName, lightEngineCost,
 *  lensCost, cost, price, snapshot-era keys…), so the first human save of a
 *  converted SA- row doesn't silently drop the rollback/older-build fields
 *  fixtures-migrate.ts deliberately kept. A human save clears `needsReview`. */
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
  const legacyCarry: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(existing)) {
    if (!newShapeKeys.has(k)) legacyCarry[k] = v;
  }
  const rec = {
    ...legacyCarry,
    ...value,
    id: existing.id,
    kind: existing.kind,
    snapshot,
    createdAt: existing.createdAt,
    createdBy: existing.createdBy,
    updatedAt: now,
    updatedBy: by,
    ...(existing.legacy ? { legacy: existing.legacy } : {}),
  } as FixtureRecord;
  return upsertDoc(COLL, rec);
}

export async function removeFixture(id: string): Promise<void> {
  await softDeleteDoc(COLL, id);
}
