import { listDocs } from "@/db/doc-store";
import { normalizeFixtureRow, type RawFixtureRow } from "@/lib/fixtures-convert";
import { retireAccessoryScopes, syncAccessoryScopeSet } from "@/lib/stores/part-accessory-links";
import { fixturePairs, fixtureRef, LEGACY_ASSEMBLY_REF_PREFIXES } from "./assembly-graph";

/**
 * Fixture builder → accessory graph, one pass (#207 final fix wave I2,
 * reshaped by #FXB). Server-only.
 *
 * Every fixture record (systems feed nothing) gets its `fixture:<id>` scope,
 * written ADD-ONLY through `syncAccessoryScopeSet`: a row that is already
 * live, and its own-datasheet flag, is never touched, so a concurrent
 * builder save can't be overwritten by this stale snapshot. New rows carry
 * the flag from any live link of the same pair — which is why the legacy
 * `assembly:` / `subassembly:` rows are retired only AFTER the fixture:
 * rows exist. Nothing writes those legacy scopes any more, so retiring all
 * of them is safe. Idempotent; the gate and budget live in
 * src/lib/fixtures-migrate.ts.
 */

export type AssemblyGraphSyncResult = {
  fixtures: number;
  written: number;
  removed: number;
  complete: boolean;
};

export async function syncAllAssemblyGraphs(opts: { shouldStop?: () => boolean } = {}): Promise<AssemblyGraphSyncResult> {
  const fixtures = (await listDocs<RawFixtureRow>("subassemblies")).map(normalizeFixtureRow).filter((f) => f.kind === "fixture");
  const scopes = fixtures.map((f) => ({ sourceRef: fixtureRef(f.id), pairs: fixturePairs(f) }));
  const w = await syncAccessoryScopeSet("assembly", scopes, { shouldStop: opts.shouldStop });
  if (!w.complete) return { fixtures: fixtures.length, written: w.written, removed: 0, complete: false };
  const r = await retireAccessoryScopes("assembly", LEGACY_ASSEMBLY_REF_PREFIXES, { shouldStop: opts.shouldStop });
  return { fixtures: fixtures.length, written: w.written, removed: r.removed, complete: r.complete };
}
