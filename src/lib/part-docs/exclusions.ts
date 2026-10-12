/**
 * #333 (spec 2026-10-12 §5.2, D-TBD-h) — a project's per-product datasheet
 * choice. Pure and client-safe: the Client package tab shows a tick's effect
 * instantly with it, and resolvePackageDocs applies it on the server.
 *
 *  - "self": the SKU itself is left out (whatever its datasheet state);
 *  - "parent": its datasheet slot is covered, and EVERY covering fixture in
 *    context is left out — a covered accessory follows its fixture;
 *  - null: it goes to the client.
 *
 * Datasheets only (Q1, Jeff 2026-10-12): spec sheets and manuals still ship.
 */

export type DatasheetExclusion = "self" | "parent";

export type ExclusionRow = {
  sku: string;
  state: "own" | "covered" | "not-needed" | "missing" | "link-only";
  /** The fixtures in context whose datasheet covers this SKU (covered rows only). */
  coveredBy: readonly string[];
};

export function datasheetExclusion(row: ExclusionRow, excluded: ReadonlySet<string>): DatasheetExclusion | null {
  if (excluded.has(row.sku)) return "self";
  if (row.state === "covered" && row.coveredBy.length > 0 && row.coveredBy.every((p) => excluded.has(p))) return "parent";
  return null;
}
