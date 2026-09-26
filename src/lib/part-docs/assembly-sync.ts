import { getBlob, setBlob } from "@/db/doc-store";
import { getSettings } from "@/lib/settings";
import { sanitizeFixtureAssemblies } from "@/lib/fixture-assemblies";
import { list as listSubassemblies } from "@/lib/stores/subassemblies";
import { syncAccessoryScopeSet } from "@/lib/stores/part-accessory-links";
import {
  assemblyRef,
  fixtureAssemblyPairs,
  subassemblyPairs,
  subassemblyRef,
} from "./assembly-graph";

/**
 * One-time Assembly Builder → accessory graph sync (#207, final fix wave I2).
 * Server-only.
 *
 * The builders write `part_accessory_links` on save, so assemblies and
 * subassemblies saved before part documents shipped had no graph links
 * until someone re-saved them. This syncs every fixture assembly
 * (`sanitizeFixtureAssemblies(settings.fixtureAssemblies)`, scope
 * `assembly:<id>`) and every subassembly (`subassembly:<id>`) in ONE pass —
 * the same pairs and scopes the save actions write, through the same
 * `syncScopes` core and its batched writers — so it is idempotent: a second
 * run writes nothing, and the "has its own datasheet" flag is carried over
 * like any re-save. It syncs exactly the scopes that exist and prunes
 * nothing else (`syncAccessoryScopeSet`): a deleted assembly's links are the
 * save action's job, and an empty settings read can never wipe the graph.
 *
 * Run by `npm run part-docs:backfill -- --commit` and, automatically, by the
 * Datasheets page on its first read. The page path is gated by a blob flag
 * (`part_docs_graph_sync.assembliesSyncedAt`) so after the first completed
 * run it costs one single-row read; the flag is set only when the sync
 * finished, so a run cut short by its budget simply resumes next time.
 */

export const GRAPH_SYNC_BLOB_ID = "part_docs_graph_sync";
type GraphSyncFlag = { assembliesSyncedAt: number };

/** The page's budget for the sync — well inside its 60 s maxDuration, and
 *  the writes are a handful of chunks (a few dozen assemblies at most). */
export const GRAPH_SYNC_BUDGET_MS = 15_000;

export type AssemblyGraphSyncResult = {
  assemblies: number;
  subassemblies: number;
  written: number;
  removed: number;
  complete: boolean;
};

export async function syncAllAssemblyGraphs(opts: { shouldStop?: () => boolean } = {}): Promise<AssemblyGraphSyncResult> {
  const [settings, subs] = await Promise.all([getSettings(), listSubassemblies()]);
  const assemblies = sanitizeFixtureAssemblies(settings.fixtureAssemblies);
  const scopes = [
    ...assemblies.map((a) => ({ sourceRef: assemblyRef(a.id), pairs: fixtureAssemblyPairs(a) })),
    ...subs.map((s) => ({ sourceRef: subassemblyRef(s.id), pairs: subassemblyPairs(s) })),
  ];
  const r = await syncAccessoryScopeSet("assembly", scopes, { shouldStop: opts.shouldStop });
  if (r.complete) await setBlob(GRAPH_SYNC_BLOB_ID, { assembliesSyncedAt: Date.now() });
  return { assemblies: assemblies.length, subassemblies: subs.length, ...r };
}

/** Has the one-time sync completed on this database? One single-row read. */
export async function assemblyGraphSynced(): Promise<boolean> {
  return (await getBlob<GraphSyncFlag>(GRAPH_SYNC_BLOB_ID, { assembliesSyncedAt: 0 })).assembliesSyncedAt > 0;
}

/**
 * The Datasheets page's first-read hook: a no-op (one flag read) once the
 * sync has completed; otherwise runs it under `budgetMs`. Never throws — a
 * failure is logged and the page renders from whatever graph exists.
 */
export async function ensureAssemblyGraphSynced(budgetMs = GRAPH_SYNC_BUDGET_MS, now: () => number = Date.now): Promise<AssemblyGraphSyncResult | null> {
  try {
    if (await assemblyGraphSynced()) return null;
    const deadline = now() + budgetMs;
    return await syncAllAssemblyGraphs({ shouldStop: () => now() >= deadline });
  } catch (e) {
    console.error("[part-docs] assembly graph sync failed", e);
    return null;
  }
}
