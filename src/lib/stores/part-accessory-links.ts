import { createHash } from "node:crypto";
import { insertDocsIfAbsent, listDocs, patchDoc, softDeleteDocs, upsertDocs, type DocBatchOpts } from "@/db/doc-store";
import type { AccessoryLinkSource, AccessoryPair, PartAccessoryLink } from "@/lib/part-docs/types";

/**
 * The fixture → accessory graph (#207, spec §5) — `part_accessory_links`.
 * Written by the Assembly Builder (source "assembly", sourceRef = the
 * assembly id) and the DaVinci pre-fill (source "davinci"); coverage is
 * computed from it (src/lib/part-docs/coverage.ts), never stored.
 */

/** Deterministic per (source, scope, parent, accessory): a re-sync rewrites
 *  the same row instead of piling up duplicates. */
export function accessoryLinkId(source: AccessoryLinkSource, scopeRef: string, parentSku: string, accessorySku: string): string {
  return `PAL-${createHash("sha1").update([source, scopeRef, parentSku, accessorySku].join("\u0000")).digest("hex").slice(0, 20)}`;
}

/** Field-wise, because jsonb does not keep key order. */
function sameLink(a: PartAccessoryLink, b: PartAccessoryLink): boolean {
  return (
    a.parentSku === b.parentSku &&
    a.accessorySku === b.accessorySku &&
    (a.maxQty ?? null) === (b.maxQty ?? null) &&
    !!a.included === !!b.included &&
    !!a.ownDatasheet === !!b.ownDatasheet &&
    a.source === b.source &&
    (a.sourceRef ?? null) === (b.sourceRef ?? null)
  );
}

export async function allAccessoryLinks(): Promise<PartAccessoryLink[]> {
  return listDocs<PartAccessoryLink>("part_accessory_links");
}

/**
 * Make the links of one scope exactly `pairs`: a scope is every live link of
 * `source` (DaVinci) or of `source` + `sourceRef` (one assembly). Missing
 * pairs are written, stale ones soft-deleted, unchanged ones untouched. The
 * human's "has its own datasheet" flag is carried over from ANY live link of
 * the same parent/accessory pair, so re-saving an assembly never clears it.
 */
export async function syncAccessoryLinks(
  scope: { source: AccessoryLinkSource; sourceRef?: string },
  pairs: readonly AccessoryPair[]
): Promise<{ written: number; removed: number }> {
  const { written, removed } = await syncAccessoryLinksBatch(scope, pairs);
  return { written, removed };
}

/**
 * syncAccessoryLinks with a between-chunks stop (`opts.shouldStop`) for a
 * caller on a wall-clock budget (the DaVinci pre-fill action). Writes land
 * before removals; when `complete` is false a re-run finishes the job — the
 * sync is computed afresh from what is live, so nothing is lost or doubled.
 */
export async function syncAccessoryLinksBatch(
  scope: { source: AccessoryLinkSource; sourceRef?: string },
  pairs: readonly AccessoryPair[],
  opts: DocBatchOpts = {}
): Promise<{ written: number; removed: number; complete: boolean }> {
  return syncScopes(
    scope.source,
    (l) => scope.sourceRef === undefined || l.sourceRef === scope.sourceRef,
    [{ sourceRef: scope.sourceRef, pairs }],
    opts
  );
}

/**
 * Sync many scopes that share a sourceRef prefix in ONE pass — the Assembly
 * Builder saves every fixture assembly at once. Links under the prefix whose
 * scope is not in `scopes` (a deleted assembly) are soft-deleted too.
 */
export async function syncAccessoryScopes(
  source: AccessoryLinkSource,
  refPrefix: string,
  scopes: ReadonlyArray<{ sourceRef: string; pairs: readonly AccessoryPair[] }>
): Promise<{ written: number; removed: number }> {
  const { written, removed } = await syncScopes(source, (l) => (l.sourceRef ?? "").startsWith(refPrefix), scopes);
  return { written, removed };
}

/**
 * Sync exactly the listed scopes in ONE pass (one read of the graph, batched
 * writes) — each scope ends up as its `pairs`, and links of any scope NOT
 * listed are left alone (no prefix pruning). The one-time assembly graph
 * sync (final fix wave, I2) uses this, so a settings read that comes back
 * empty can never wipe the graph.
 *
 * Strictly ADD-ONLY (final fix wave, #3): this is the one-time sync's only
 * caller, and it runs off of whatever settings/subassembly snapshot the
 * request happened to read — a real Assembly Builder save can land
 * concurrently, on the very scopes this pass is about to write. Reconciling
 * (soft-deleting a pair not in this stale desired set, or rewriting a row
 * that differs) would overwrite that concurrent save. So this only inserts
 * pairs that are not currently live; an already-live row (its fields, its
 * own-datasheet flag) is never touched, and nothing is ever soft-deleted
 * here. Normal save-time sync (syncAccessoryLinks/syncAccessoryScopes, the
 * Assembly Builder and DaVinci pre-fill's own writers) keeps full reconcile.
 */
export async function syncAccessoryScopeSet(
  source: AccessoryLinkSource,
  scopes: ReadonlyArray<{ sourceRef: string; pairs: readonly AccessoryPair[] }>,
  opts: DocBatchOpts = {}
): Promise<{ written: number; removed: number; complete: boolean }> {
  const refs = new Set(scopes.map((s) => s.sourceRef));
  if (!refs.size) return { written: 0, removed: 0, complete: true };
  return syncScopes(source, (l) => refs.has(l.sourceRef ?? ""), scopes, opts, "addOnly");
}

async function syncScopes(
  source: AccessoryLinkSource,
  owns: (l: PartAccessoryLink) => boolean,
  scopes: ReadonlyArray<{ sourceRef?: string; pairs: readonly AccessoryPair[] }>,
  opts: DocBatchOpts = {},
  mode: "reconcile" | "addOnly" = "reconcile"
): Promise<{ written: number; removed: number; complete: boolean }> {
  const all = await allAccessoryLinks();
  const own = new Map(all.filter((l) => l.source === source && owns(l)).map((l) => [l.id, l]));
  const ownFlag = new Set(all.filter((l) => l.ownDatasheet).map((l) => `${l.parentSku}\u0000${l.accessorySku}`));

  const desired = new Map<string, PartAccessoryLink>();
  for (const scope of scopes) {
    for (const p of scope.pairs) {
      const parentSku = p.parentSku.trim();
      const accessorySku = p.accessorySku.trim();
      if (!parentSku || !accessorySku || parentSku === accessorySku) continue;
      const id = accessoryLinkId(source, scope.sourceRef ?? "", parentSku, accessorySku);
      const prior = desired.get(id);
      const maxQty = Math.max(prior?.maxQty ?? 0, p.maxQty ?? 0) || undefined;
      const sourceRef = scope.sourceRef ?? prior?.sourceRef ?? p.sourceRef;
      desired.set(id, {
        id,
        parentSku,
        accessorySku,
        ...(maxQty ? { maxQty } : {}),
        ...(p.included || prior?.included ? { included: true } : {}),
        ...(ownFlag.has(`${parentSku}\u0000${accessorySku}`) ? { ownDatasheet: true } : {}),
        source,
        ...(sourceRef ? { sourceRef } : {}),
      });
    }
  }

  if (mode === "addOnly") {
    // Only rows whose deterministic id doesn't exist at all are written
    // (ON CONFLICT DO NOTHING) — a live row OR one only just soft-deleted by
    // a concurrent save is left completely alone, fields and own-datasheet
    // flag included. Nothing is ever soft-deleted in this mode.
    const missing = [...desired.entries()].filter(([id]) => !own.has(id)).map(([, link]) => link);
    const w = await insertDocsIfAbsent<PartAccessoryLink>("part_accessory_links", missing, opts);
    return { written: w.ids.length, removed: 0, complete: w.complete };
  }

  // The full changed/stale sets first, then chunked multi-row writes
  // (review fix wave 1) — the DaVinci scope is ~6.7k rows, one statement
  // each was minutes on Neon.
  const changed: PartAccessoryLink[] = [];
  for (const [id, link] of desired) {
    const current = own.get(id);
    if (!current || !sameLink(current, link)) changed.push(link);
  }
  const stale = [...own.keys()].filter((id) => !desired.has(id));
  const w = await upsertDocs<PartAccessoryLink>("part_accessory_links", changed, opts);
  if (!w.complete) return { written: w.ids.length, removed: 0, complete: false };
  const r = await softDeleteDocs("part_accessory_links", stale, opts);
  return { written: w.ids.length, removed: r.ids.length, complete: r.complete };
}

/**
 * The Assembly Builder's "has its own datasheet" toggle: set or clear the
 * flag on every live link of the pair (a pair can be linked by several
 * assemblies and by DaVinci at once — coverage reads them as one).
 * `linked` says whether the pair is in the graph at all (an unsaved member
 * is not); `changed` is the number of rows rewritten — 0 when the flag
 * already had that value, which is not an error (final fix wave, M1).
 */
export async function setOwnDatasheet(parentSku: string, accessorySku: string, own: boolean): Promise<{ linked: boolean; changed: number }> {
  const rows = (await allAccessoryLinks()).filter((l) => l.parentSku === parentSku && l.accessorySku === accessorySku);
  let changed = 0;
  for (const l of rows) {
    if (!!l.ownDatasheet === own) continue;
    await patchDoc<PartAccessoryLink>("part_accessory_links", l.id, (d) => {
      const next = { ...d };
      if (own) next.ownDatasheet = true;
      else delete next.ownDatasheet;
      return next;
    });
    changed++;
  }
  return { linked: rows.length > 0, changed };
}
