/**
 * The Import hub's catalog commit (PUNCHLIST #132, #133; D156) — guard,
 * normalize, write, stamp — split from the server action so the regression
 * harness can drive it without a session: `importRecords` in ./actions.ts
 * only parses FormData and turns this result into a redirect (the same
 * split as catalog/import.ts on the Catalog page). Server-only (reads the
 * catalog store, writes settings); never import it into a client component.
 */
import { mfrKey } from "@/lib/catalog-books";
import { checkManufacturerGroups, type GroupCheck } from "@/lib/catalog-import-guard";
import { list as listCatalog } from "@/lib/stores/catalog";
import { importResolverFor } from "@/lib/stores/catalog-renames";
import { catalogGroups } from "./catalog-groups";
import type { PreparedRow } from "./parse";
import { commitImport, type ImportMode, type ImportResult } from "./registry";

export type CatalogCommitInput = {
  /** Prepared rows of the `catalog` type (any spelling of the manufacturer). */
  rows: PreparedRow[];
  mode: ImportMode;
  /** Epoch ms — the price list's effective date: `pricedAt` on rows whose
   *  price changes, and (Oct 15 #32) `priceDate` on every row a priced file
   *  writes. */
  effectiveAt: number;
  /** Did the file map a List or a Cost column? A file without one confirmed
   *  no price, so it dates no part (final review item 3). */
  priced: boolean;
  /** #205 fix wave (Task 14, item 2) — the signed-in user, threaded into
   *  `specUpdatedBy` so an edited row is stamped with who imported it rather
   *  than the generic "import" fallback. Optional: the regression harness
   *  drives this session-free. */
  me?: { name: string };
};

export type CatalogCommitResult =
  | { ok: true; res: ImportResult; /** mfrKeys with at least one row dated by this file (Oct 15 #32: per part, never the whole book) */ stamped: string[] }
  | { ok: false; error: string };

/** #132 — a failing group's message, prefixed with the manufacturer it checked. */
function guardMessage(c: GroupCheck): string {
  return c.result.ok ? "" : (c.mfr ? `${c.mfr}: ` : "") + c.result.detail;
}

export async function commitCatalogImport(input: CatalogCommitInput): Promise<CatalogCommitResult> {
  // #132 — the wrong-manufacturer guard, per manufacturer in the file,
  // before anything is written; a failure rejects the whole file.
  // #304 — a row keyed by a renamed part's old order number counts as that
  // part, exactly as commitImport's catalog writer will resolve it.
  const catalog = await listCatalog();
  const checks = checkManufacturerGroups(catalogGroups(input.rows), catalog, await importResolverFor(catalog));
  const bad = checks.find((c) => !c.result.ok);
  if (bad) return { ok: false, error: guardMessage(bad) };

  // Each group files under the catalog's existing spelling of its manufacturer.
  const spelling = new Map(checks.map((c) => [mfrKey(c.mfr), c.result.ok ? c.result.normalizedMfr : c.mfr]));
  const rows = input.rows.map((r) => {
    if (!r.valid) return r;
    const mfr = String(r.values.mfr ?? "");
    return { ...r, values: { ...r.values, mfr: spelling.get(mfrKey(mfr)) ?? mfr } };
  });

  // Oct 15 #32 (supersedes D156's per-manufacturer book stamp): a priced
  // file dates exactly the rows it writes — the catalog writer stamps
  // `priceDate` per part — so a partial file never re-dates lines it left
  // out, and the manufacturer's book date is set only by hand (Catalog
  // banner). "Skip duplicates" writes nothing and so dates nothing (item 1);
  // a file with no price column dates nothing (item 3).
  const dating = input.mode !== "skip" && input.priced;
  const res = await commitImport("catalog", rows, input.mode, { effectiveAt: input.effectiveAt, me: input.me, priced: dating });
  const keyOf = (r: PreparedRow) => mfrKey(String(r.values.mfr ?? ""));
  const stamped = dating ? [...new Set(res.written.map(keyOf))].filter(Boolean) : [];
  return { ok: true, res, stamped };
}
