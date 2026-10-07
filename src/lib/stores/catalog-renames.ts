import { getBlob, setBlob } from "@/db/doc-store";
import { buildImportResolver, type ImportResolver, type ResolvablePart } from "@/lib/catalog-rename/import-resolve";

/**
 * #304 — the append-only log of SKU renames (order number → `Brand:Model`).
 * One blob, `{ renames: [...] }`. The importers and the sweeps read it as
 * the old → new crosswalk; the parts themselves carry the same fact in
 * `formerSkus` / `renamedTo`, so the log is the audit trail and the lookup
 * for data (customer files, spreadsheets) that never sees a part doc.
 */
export type SkuRename = { from: string; to: string; model: string; at: number; by: string };

export const SKU_RENAMES_BLOB = "catalog_sku_renames";

function clean(raw: unknown): SkuRename[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e): e is SkuRename =>
      !!e && typeof e.from === "string" && !!e.from && typeof e.to === "string" && !!e.to && typeof e.model === "string",
  );
}

export async function allSkuRenames(): Promise<SkuRename[]> {
  return clean((await getBlob<{ renames: unknown }>(SKU_RENAMES_BLOB, { renames: [] })).renames);
}

/** Append `entries`; one entry per `from` — a repeated `from` replaces the
 *  earlier entry instead of duplicating it (the apply engine re-logs a rename
 *  whose log append was lost; a retired SKU is never renamed a second time). */
export async function appendSkuRenames(entries: SkuRename[]): Promise<void> {
  if (!entries.length) return;
  const byFrom = new Map<string, SkuRename>();
  for (const e of [...(await allSkuRenames()), ...clean(entries)]) {
    byFrom.delete(e.from); // re-insert so the last write also sorts last
    byFrom.set(e.from, e);
  }
  await setBlob(SKU_RENAMES_BLOB, { renames: [...byFrom.values()] });
}

/** old SKU → the SKU it ended up as. Pure; a chain a→b→c collapses to
 *  a→c and b→c; a cycle stops rather than looping. */
export function renameMapOf(entries: SkuRename[]): Map<string, string> {
  const direct = new Map<string, string>();
  for (const e of entries) direct.set(e.from, e.to);
  const out = new Map<string, string>();
  for (const from of direct.keys()) {
    let to = direct.get(from)!;
    for (let hops = 0; direct.has(to) && hops < direct.size; hops++) to = direct.get(to)!;
    out.set(from, to);
  }
  return out;
}

/** #304 — what a LIVE write needs to follow the renames: `m` (old SKU → the
 *  SKU it ended up as) and `models` (final SKU → its model, what a moved
 *  quote line prints). One log read. The rename sweep and the writers that
 *  copy frozen history back into live fields (Load system, Copy system,
 *  revision restore) share it. */
export async function liveRenameRefs(): Promise<{ m: Map<string, string>; models: Map<string, string> }> {
  const log = await allSkuRenames();
  const models = new Map<string, string>();
  for (const e of log) if (e.model) models.set(e.to, e.model);
  return { m: renameMapOf(log), models };
}

/** #304 — the importers' row resolver over `live` (the book the import has
 *  already loaded) and the rename log; one log read per import. */
export async function importResolverFor(live: ResolvablePart[]): Promise<ImportResolver> {
  return buildImportResolver(live, renameMapOf(await allSkuRenames()));
}
