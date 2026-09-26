import { getBlob, insertDocIfAbsent, listDocs, setBlob, upsertDoc } from "@/db/doc-store";
import { getSettingsStrict } from "@/lib/settings";
import { planFixtureConversion, type RawFixtureRow } from "@/lib/fixtures-convert";
import { syncAllAssemblyGraphs } from "@/lib/part-docs/assembly-sync";

/**
 * The fixture builder's one-time conversion (#FXB, spec §3 and §5).
 * Server-only.
 *
 * 1. Each `settings.fixtureAssemblies` entry becomes a fixture row with the
 *    same id (insert-if-absent, so one a user has since deleted stays
 *    deleted). Settings are read STRICTLY: a transient DB error throws and
 *    leaves the flag unset instead of reading as "no assemblies".
 * 2. Each legacy-shaped `subassemblies` row is rewritten in place.
 * 3. The accessory graph moves to `fixture:<id>` (assembly-sync.ts).
 *
 * The settings array is never written — it stays as a backup. A blob flag
 * (`fixtures_convert.convertedAt`), set only once all three steps have
 * finished, makes every later read one single-row check. A run cut short by
 * its budget resumes on the next read. Runs from the first
 * `listFixtures()`, the Datasheets page, `npm run fixtures:convert` and
 * `npm run part-docs:backfill`.
 */

export const FIXTURES_CONVERT_BLOB_ID = "fixtures_convert";
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

export async function convertFixtures(opts: { shouldStop?: () => boolean; now?: number } = {}): Promise<FixtureConvertResult> {
  const [settings, rows] = await Promise.all([getSettingsStrict(), listDocs<RawFixtureRow>("subassemblies")]);
  const plan = planFixtureConversion(settings.fixtureAssemblies, rows, opts.now ?? Date.now());
  const out: FixtureConvertResult = { inserted: 0, rewritten: 0, graphWritten: 0, graphRemoved: 0, complete: false };
  for (const rec of plan.inserts) {
    if (opts.shouldStop?.()) return out;
    if (await insertDocIfAbsent("subassemblies", rec)) out.inserted++;
  }
  for (const rec of plan.rewrites) {
    if (opts.shouldStop?.()) return out;
    await upsertDoc("subassemblies", rec);
    out.rewritten++;
  }
  const g = await syncAllAssemblyGraphs({ shouldStop: opts.shouldStop });
  out.graphWritten = g.written;
  out.graphRemoved = g.removed;
  out.complete = g.complete;
  if (g.complete) await setBlob(FIXTURES_CONVERT_BLOB_ID, { convertedAt: Date.now() });
  return out;
}

/** Has the conversion completed on this database? One single-row read. */
export async function fixturesConverted(): Promise<boolean> {
  return (await getBlob<ConvertFlag>(FIXTURES_CONVERT_BLOB_ID, { convertedAt: 0 })).convertedAt > 0;
}

/**
 * The first-read hook: true once converted (one flag read), otherwise runs
 * the conversion under `budgetMs` and says whether it completed. Never
 * throws — a failure is logged and callers fall back (listFixtures serves the
 * settings-backed assemblies in memory).
 */
export async function ensureFixturesConverted(budgetMs = FIXTURES_CONVERT_BUDGET_MS, now: () => number = Date.now): Promise<boolean> {
  try {
    if (await fixturesConverted()) return true;
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
