import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { loadSourcingReport } from "@/lib/sourcing-report-load";
import { sortForNoCost, sourcingCsv } from "@/lib/sourcing-report";

/** Batch 6 / #66 — the most-quoted products table as CSV: the page's rows and
 *  cost gate (`approve`), every cell formula-injection guarded. */
export const maxDuration = 60;

export async function GET() {
  const me = await requireUser();
  const withCost = can("approve", me.roles);
  const report = await loadSourcingReport();
  const rows = withCost ? report.parts : sortForNoCost(report.parts, (r) => r.model || r.sku);
  return new Response(sourcingCsv(rows, withCost), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="most-quoted-products.csv"',
      "cache-control": "no-store",
    },
  });
}
