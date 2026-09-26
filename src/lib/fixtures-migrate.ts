import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { DOC_TABLES } from "@/db/doc-tables";
import { getBlob, insertDocsIfAbsent, setBlob } from "@/db/doc-store";
import { getSettingsStrict } from "@/lib/settings";
import { planFixtureConversion, type RawFixtureRow } from "@/lib/fixtures-convert";
import type { FixtureRecord } from "@/lib/fixture-assemblies";
import { syncAllAssemblyGraphs } from "@/lib/part-docs/assembly-sync";

/**
 * The fixture builder's one-time conversion (#FXB, spec §3 and §5).
 * Server-only.
 *
 * 1. Each `settings.fixtureAssemblies` entry becomes a fixture row with the
 *    same id (insert-if-absent, so one a user has since deleted stays
 *    deleted). Settings are read STRICTLY: a transient DB error throws and
 *    leaves the flag unset instead of reading as "no assemblies".
 * 2. Each legacy-shaped `subassemblies` row gains the fixture fields in
 *    place — ADDITIVELY (fix wave 1, C1): every original field (options,
 *    lightEngineName, lensName, costs, price, snapshot…) is kept verbatim, so
 *    an older build still reading the old shape (production runs one while
 *    previews share its database) and a rollback both keep working. Each row
 *    is one conditional UPDATE (fix wave 1, I1): only while it is still live,
 *    still legacy-shaped and at the rev this pass read, merged with jsonb
 *    `||` — a concurrent save or delete is never clobbered or revived; the
 *    pass then reports incomplete and the next one re-plans from fresh rows.
 * 3. The accessory graph moves to `fixture:<id>` (assembly-sync.ts).
 *
 * The settings array is never written — it stays as a backup. A blob flag
 * (`fixtures_convert.convertedAt`), set only once all three steps have
 * finished, makes every later read one single-row check; the same moment
 * also sets the part-documents build's own graph-sync flag (fix wave 1, M1)
 * so an older build can't re-create the retired `assembly:`/`subassembly:`
 * scopes. A run cut short by its budget resumes on the next read. Runs from
 * the Datasheets page (never on a Vercel preview — see
 * ensureFixturesConverted), `npm run fixtures:convert -- --commit` and
 * `npm run part-docs:backfill -- --commit`.
 */

export const FIXTURES_CONVERT_BLOB_ID = "fixtures_convert";
/** The part-documents build's one-time graph-sync flag (its assembly-sync.ts
 *  `GRAPH_SYNC_BLOB_ID`). Once set, that build never writes the legacy
 *  `assembly:` / `subassembly:` scopes again. */
export const LEGACY_GRAPH_SYNC_BLOB_ID = "part_docs_graph_sync";
/** A page read's budget — well inside a 60 s function. */
export const FIXTURES_CONVERT_BUDGET_MS = 15_000;
type ConvertFlag = { convertedAt: number };

export type FixtureConvertResult = {
  inserted: number;
  rewritten: number;
  graphWritten: number;
  graphRemoved: number;
  complete: boolean;
};

export type FixtureConvertOpts = {
  shouldStop?: () => boolean;
  now?: number;
  /** Test seam: awaited after the read, before the first write — where a
   *  concurrent save or delete would land. */
  beforeWrite?: () => Promise<void>;
};

/**
 * What a legacy row gains: every converted field it does not already have,
 * plus `lines` (the key that marks it converted). Original keys are never
 * overwritten — the new readers normalize the overlapping ones (label,
 * lensSku "" → null …) through normalizeFixtureRow anyway.
 */
export function additiveFixturePatch(original: RawFixtureRow, converted: FixtureRecord): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(converted)) if (!(k in original) && v !== undefined) patch[k] = v;
  patch.lines = converted.lines;
  return patch;
}

const subassemblies = DOC_TABLES.subassemblies;
/** SQL twin of fixtures-convert.ts `isLegacySubassembly`: `lines` missing,
 *  null or not an object (a JS array counts as an object there). */
const legacyShape = sql`coalesce(jsonb_typeof(${subassemblies.doc}->'lines'), 'null') not in ('object', 'array')`;

/** Every row with its rev; soft-deleted ones only by id (they are never
 *  planned — a converted assembly a user deleted stays deleted). */
async function readRows(): Promise<{ live: Array<{ row: RawFixtureRow; rev: number }>; deletedIds: Set<string> }> {
  const db = await getDb();
  const t = subassemblies;
  const rows = await db.select({ id: t.id, rev: t.rev, deleted: t.deleted, doc: t.doc }).from(t).orderBy(asc(t.id));
  return {
    live: rows.filter((r) => !r.deleted).map((r) => ({ row: { ...(r.doc as RawFixtureRow), id: r.id }, rev: r.rev })),
    deletedIds: new Set(rows.filter((r) => r.deleted).map((r) => r.id)),
  };
}

/** One conditional, atomic in-place merge. Rev/updatedAt/receivedAt move
 *  exactly as upsertDoc's update branch moves them (seq by the table's
 *  `_seq_bump` trigger); `deleted` is never touched. True when it landed. */
async function mergeIfUnchanged(id: string, rev: number, patch: Record<string, unknown>): Promise<boolean> {
  const db = await getDb();
  const t = subassemblies;
  const now = Date.now();
  const rows = await db
    .update(t)
    .set({
      doc: sql`${t.doc} || ${JSON.stringify(patch)}::jsonb`,
      rev: sql`${t.rev} + 1`,
      updatedAt: now,
      receivedAt: now,
    })
    .where(and(eq(t.id, id), eq(t.rev, rev), eq(t.deleted, false), legacyShape))
    .returning({ id: t.id });
  return rows.length > 0;
}

export async function convertFixtures(opts: FixtureConvertOpts = {}): Promise<FixtureConvertResult> {
  const [settings, { live: snapshot, deletedIds }] = await Promise.all([getSettingsStrict(), readRows()]);
  const plan = planFixtureConversion(settings.fixtureAssemblies, snapshot.map((s) => s.row), opts.now ?? Date.now());
  await opts.beforeWrite?.();
  const out: FixtureConvertResult = { inserted: 0, rewritten: 0, graphWritten: 0, graphRemoved: 0, complete: false };
  // Insert-if-absent still guards a delete that lands after the read.
  const inserts = plan.inserts.filter((r) => !deletedIds.has(r.id));
  const ins = await insertDocsIfAbsent("subassemblies", inserts, { shouldStop: opts.shouldStop });
  out.inserted = ins.ids.length;
  if (!ins.complete) return out;
  const byId = new Map(snapshot.map((s) => [s.row.id, s]));
  let raced = 0;
  for (const rec of plan.rewrites) {
    if (opts.shouldStop?.()) return out;
    const s = byId.get(rec.id);
    if (s && (await mergeIfUnchanged(rec.id, s.rev, additiveFixturePatch(s.row, rec)))) out.rewritten++;
    else raced++;
  }
  const g = await syncAllAssemblyGraphs({ shouldStop: opts.shouldStop });
  out.graphWritten = g.written;
  out.graphRemoved = g.removed;
  // A row that changed under us is re-planned by the next pass (from fresh
  // rows), so the flags wait for a pass that saw no race.
  out.complete = g.complete && raced === 0;
  if (out.complete) {
    await setBlob(LEGACY_GRAPH_SYNC_BLOB_ID, { assembliesSyncedAt: Date.now() });
    await setBlob(FIXTURES_CONVERT_BLOB_ID, { convertedAt: Date.now() });
  }
  return out;
}

/** Has the conversion completed on this database? One single-row read. */
export async function fixturesConverted(): Promise<boolean> {
  return (await getBlob<ConvertFlag>(FIXTURES_CONVERT_BLOB_ID, { convertedAt: 0 })).convertedAt > 0;
}

/**
 * The first-read hook: true once converted (one flag read), otherwise runs
 * the conversion under `budgetMs` and says whether it completed. Never
 * throws — a failure is logged and callers fall back (legacy rows and the
 * settings-backed assemblies normalize in memory).
 *
 * A Vercel PREVIEW deploy never converts (fix wave 1, C1; same guard as
 * scripts/migrate.mjs): previews share production's database, so a branch
 * must not rewrite production rows on its first page load. The explicit
 * CLI runs (`fixtures:convert` / `part-docs:backfill --commit`) still do.
 */
export async function ensureFixturesConverted(budgetMs = FIXTURES_CONVERT_BUDGET_MS, now: () => number = Date.now): Promise<boolean> {
  try {
    if (await fixturesConverted()) return true;
    if (process.env.VERCEL_ENV === "preview") return false;
    const deadline = now() + budgetMs;
    return (await convertFixtures({ shouldStop: () => now() >= deadline })).complete;
  } catch (e) {
    console.error("[fixtures] conversion failed", e);
    return false;
  }
}

/** Re-arm the conversion (the go-live reset wipes the doc table but keeps
 *  settings, so the settings-backed assemblies come back on the next read). */
export async function resetFixturesConversion(): Promise<void> {
  await setBlob(FIXTURES_CONVERT_BLOB_ID, { convertedAt: 0 });
}
