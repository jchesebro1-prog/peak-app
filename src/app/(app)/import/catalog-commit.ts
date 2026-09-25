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
import { setPriceListEffective } from "@/lib/settings";
import { list as listCatalog } from "@/lib/stores/catalog";
import { catalogGroups } from "./catalog-groups";
import type { PreparedRow } from "./parse";
import { commitImport, type ImportMode, type ImportResult } from "./registry";

export type CatalogCommitInput = {
  /** Prepared rows of the `catalog` type (any spelling of the manufacturer). */
  rows: PreparedRow[];
  mode: ImportMode;
  /** Epoch ms — the price list's effective date: `pricedAt` on rows whose
   *  price changes, and the book date of every manufacturer confirmed. */
  effectiveAt: number;
  /** Did the file map a List or a Cost column? A file without one confirmed
   *  no price, so it never re-dates a book (final review item 3). */
  priced: boolean;
  /** #205 fix wave (Task 14, item 2) — the signed-in user, threaded into
   *  `specUpdatedBy` so an edited row is stamped with who imported it rather
   *  than the generic "import" fallback. Optional: the regression harness
   *  drives this session-free. */
  me?: { name: string };
};

export type CatalogCommitResult =
  | { ok: true; res: ImportResult; /** mfrKeys whose book date was stamped */ stamped: string[] }
  | { ok: false; error: string };

/** #132 — a failing group's message, prefixed with the manufacturer it checked. */
function guardMessage(c: GroupCheck): string {
  return c.result.ok ? "" : (c.mfr ? `${c.mfr}: ` : "") + c.result.detail;
}

export async function commitCatalogImport(input: CatalogCommitInput): Promise<CatalogCommitResult> {
  // #132 — the wrong-manufacturer guard, per manufacturer in the file,
  // before anything is written; a failure rejects the whole file.
  const checks = checkManufacturerGroups(catalogGroups(input.rows), await listCatalog());
  const bad = checks.find((c) => !c.result.ok);
  if (bad) return { ok: false, error: guardMessage(bad) };

  // Each group files under the catalog's existing spelling of its manufacturer.
  const spelling = new Map(checks.map((c) => [mfrKey(c.mfr), c.result.ok ? c.result.normalizedMfr : c.mfr]));
  const rows = input.rows.map((r) => {
    if (!r.valid) return r;
    const mfr = String(r.values.mfr ?? "");
    return { ...r, values: { ...r.values, mfr: spelling.get(mfrKey(mfr)) ?? mfr } };
  });

  const res = await commitImport("catalog", rows, input.mode, { effectiveAt: input.effectiveAt, me: input.me });

  // D156 — the file's effective date is each manufacturer's price-list date
  // (it confirms that manufacturer's unchanged rows too). Stamped per
  // manufacturer group, from the rows commitImport actually wrote:
  // - "Skip duplicates" compares nothing, so it confirms nothing (item 1);
  // - a file with no price column confirmed no price (item 3);
  // - a group none of whose rows were written is not confirmed;
  // - a group with a row that errored (invalid, or the write threw) is not
  //   confirmed either — the per-group form of "errored === 0".
  const stamped: string[] = [];
  if (input.mode !== "skip" && input.priced) {
    const keyOf = (r: PreparedRow) => mfrKey(String(r.values.mfr ?? ""));
    const wrote = new Set(res.written.map(keyOf));
    const failed = new Set(res.failed.map(keyOf));
    for (const c of checks) {
      if (!c.result.ok) continue;
      const key = mfrKey(c.result.normalizedMfr);
      if (!wrote.has(key) || failed.has(key)) continue;
      await setPriceListEffective(key, input.effectiveAt);
      stamped.push(key);
    }
  }
  return { ok: true, res, stamped };
}
