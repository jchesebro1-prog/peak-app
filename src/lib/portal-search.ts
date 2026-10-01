import { entryMatchesDept, type DeptFilter } from "@/lib/portal-departments";

/** Portal catalog search + two-way facets + paging (#245, spec §3.1). Pure. */
export type SearchEntry = { key: string; kind: "part" | "fixture"; title: string; sku: string; mfr: string; category: string; haystack: string; browsable: boolean; rank: number };
/** `dept` (#252) — resolved in the browse layer (portal-catalog-browse.ts),
 *  never a raw `?dept=` id: keeps this module pure and its own tests free
 *  of any department-store dependency. */
export type SearchQuery = { q: string; mfr: string[]; cat: string[]; page: number; pageSize: number; dept?: DeptFilter };
export type Facet = { value: string; count: number; selected: boolean };
/** #289: the hits split by kind — fixtures head the results as Packages &
 *  Assemblies, parts follow. Counted over every hit (all pages). */
export type SearchGroups = { packages: number; parts: number };
export type SearchResult = { entries: SearchEntry[]; total: number; page: number; pages: number; mfrFacets: Facet[]; catFacets: Facet[]; groups: SearchGroups };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function buildHaystack(parts: readonly (string | null | undefined)[]): string {
  const joined = parts.filter(Boolean).join(" ");
  return " " + norm(joined) + " " + joined.toLowerCase().replace(/[^a-z0-9]/g, "") + " ";
}
function facets(rows: readonly SearchEntry[], field: "mfr" | "category", selected: readonly string[]): Facet[] {
  const counts = new Map<string, number>();
  for (const r of rows) { const v = r[field] || "—"; counts.set(v, (counts.get(v) || 0) + 1); }
  for (const s of selected) if (!counts.has(s)) counts.set(s, 0);
  return [...counts].map(([value, count]) => ({ value, count, selected: selected.includes(value) }))
    .sort((a, b) => Number(b.selected) - Number(a.selected) || b.count - a.count || a.value.localeCompare(b.value));
}
export function searchCatalog(all: readonly SearchEntry[], query: SearchQuery): SearchResult {
  const tokens = norm(query.q).split(" ").filter(Boolean);
  // #289: departments hold parts only; "packages" holds fixtures only.
  const inDept = (e: SearchEntry) => !query.dept || entryMatchesDept(e, query.dept);
  const base = all.filter((e) => (tokens.length ? tokens.every((t) => e.haystack.includes(t)) : e.browsable) && inDept(e));
  const inMfr = (e: SearchEntry) => !query.mfr.length || query.mfr.includes(e.mfr || "—");
  const inCat = (e: SearchEntry) => !query.cat.length || query.cat.includes(e.category || "—");
  const hits = base.filter((e) => inMfr(e) && inCat(e));
  const mfrFacets = facets(base.filter(inCat), "mfr", query.mfr);
  const catFacets = facets(base.filter(inMfr), "category", query.cat);
  // #289: packages first, then parts — one sort, so the two headed groups
  // page as one list.
  const kindOrder = (e: SearchEntry) => (e.kind === "fixture" ? 0 : 1);
  const sorted = [...hits].sort((a, b) => kindOrder(a) - kindOrder(b) || b.rank - a.rank || a.title.localeCompare(b.title));
  const packages = hits.filter((e) => e.kind === "fixture").length;
  const pageSize = Math.max(1, query.pageSize);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const page = Math.min(Math.max(1, Math.floor(query.page) || 1), pages);
  return {
    entries: sorted.slice((page - 1) * pageSize, page * pageSize),
    total: sorted.length,
    page,
    pages,
    mfrFacets,
    catFacets,
    groups: { packages, parts: sorted.length - packages },
  };
}
