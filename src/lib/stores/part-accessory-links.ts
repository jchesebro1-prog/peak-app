import { createHash } from "node:crypto";
import { listDocs, patchDoc, softDeleteDoc, upsertDoc } from "@/db/doc-store";
import type { AccessoryLinkSource, AccessoryPair, PartAccessoryLink } from "@/lib/part-docs/types";

/**
 * The fixture → accessory graph (#DOC, spec §5) — `part_accessory_links`.
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
  return syncScopes(
    scope.source,
    (l) => scope.sourceRef === undefined || l.sourceRef === scope.sourceRef,
    [{ sourceRef: scope.sourceRef, pairs }]
  );
}

async function syncScopes(
  source: AccessoryLinkSource,
  owns: (l: PartAccessoryLink) => boolean,
  scopes: ReadonlyArray<{ sourceRef?: string; pairs: readonly AccessoryPair[] }>
): Promise<{ written: number; removed: number }> {
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

  let written = 0;
  for (const [id, link] of desired) {
    const current = own.get(id);
    if (current && sameLink(current, link)) continue;
    await upsertDoc<PartAccessoryLink>("part_accessory_links", link);
    written++;
  }
  let removed = 0;
  for (const id of own.keys()) {
    if (desired.has(id)) continue;
    await softDeleteDoc("part_accessory_links", id);
    removed++;
  }
  return { written, removed };
}

/**
 * The Assembly Builder's "has its own datasheet" toggle: set or clear the
 * flag on every live link of the pair (a pair can be linked by several
 * assemblies and by DaVinci at once — coverage reads them as one). Returns
 * the number of rows changed.
 */
export async function setOwnDatasheet(parentSku: string, accessorySku: string, own: boolean): Promise<number> {
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
  return changed;
}
