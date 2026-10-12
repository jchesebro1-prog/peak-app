import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { getAll } from "@/lib/stores/quotes";
import { bonusReportCsv, bonusReportRange, bonusReportRows } from "@/lib/estimate-bonus/report";

/** Estimator bonuses report as CSV — the same visibility rules as the page. */
export const maxDuration = 60;

export async function GET(req: Request) {
  const me = await requireUser();
  const url = new URL(req.url);
  const range = bonusReportRange(url.searchParams.get("from"), url.searchParams.get("to"), Date.now());
  const quotes = (await getAll()).filter((q) => q.status === "won");
  const rows = bonusReportRows(
    quotes,
    { id: me.id, name: me.name, isAdmin: can("manage_users", me.roles) },
    { from: range.from, to: range.to, person: url.searchParams.get("person") },
  );
  return new Response(bonusReportCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="estimator-bonuses.csv"',
      "cache-control": "no-store",
    },
  });
}
