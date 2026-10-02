import { requirePerm } from "@/lib/session";
import { fixtureSkus } from "@/lib/fixture-assemblies";
import { rackSheetCsv, rackSheetExportGrid } from "@/lib/rack/part-facts-sheet";
import { rackFactsOrUndefined } from "@/lib/rack/part-facts";
import { getMany, list as listCatalog, type CatalogPart } from "@/lib/stores/catalog";
import { listFixtures } from "@/lib/stores/fixtures";

/**
 * Rack data sheet **export** (#296). Default scope = the parts Peak's
 * assemblies already use plus any part that already carries rack data;
 * `?scope=all` = the whole catalog. `?category=` narrows either.
 */
export const maxDuration = 60;

export async function GET(req: Request) {
  await requirePerm("create");
  const url = new URL(req.url);
  const all = url.searchParams.get("scope") === "all";
  const category = (url.searchParams.get("category") ?? "").trim();

  let parts: CatalogPart[];
  if (all) {
    parts = await listCatalog();
  } else {
    const used = new Set<string>();
    for (const f of await listFixtures()) for (const sku of fixtureSkus(f)) used.add(sku);
    const [usedParts, everything] = [await getMany([...used]), await listCatalog()];
    const seen = new Set(usedParts.map((p) => p.sku));
    parts = [...usedParts, ...everything.filter((p) => !seen.has(p.sku) && rackFactsOrUndefined(p))];
  }
  if (category) parts = parts.filter((p) => p.category === category);
  parts.sort((a, b) => (a.mfr ?? "").localeCompare(b.mfr ?? "") || a.sku.localeCompare(b.sku));

  const grid = rackSheetExportGrid(parts.map((p) => ({ sku: p.sku, desc: p.desc, ...(p.mfr ? { mfr: p.mfr } : {}), ...rackFactsOrUndefined(p) })));
  return new Response(rackSheetCsv(grid), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="rack-data.csv"',
      "cache-control": "no-store",
    },
  });
}
