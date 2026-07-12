import { requirePerm } from "@/lib/session";
import * as Pricing from "@/lib/stores/pricing";
import { getTypeMeta } from "../types";
import { exportCsv, templateCsv } from "../registry";

/**
 * Download endpoint for the Import/Export hub. Read-only: builds a CSV (or the
 * blank template) for a record type from its store, or the estimating-rules
 * export straight from the pricing store's own exporters. Admin-only, matching
 * the hub gate. Served as an attachment so plain <a> links download without JS.
 *
 *   /import/export?type=customers            → current records as CSV
 *   /import/export?type=customers&kind=template → blank template CSV
 *   /import/export?type=pricing&fmt=csv|json → estimating rules
 */
export async function GET(req: Request): Promise<Response> {
  await requirePerm("manage_users");

  const url = new URL(req.url);
  const type = url.searchParams.get("type") || "";

  if (type === "pricing") {
    const fmt = url.searchParams.get("fmt") === "json" ? "json" : "csv";
    const body = fmt === "json" ? await Pricing.exportJSON() : await Pricing.exportCSV();
    return new Response(body, {
      headers: {
        "Content-Type": fmt === "json" ? "application/json;charset=utf-8" : "text/csv;charset=utf-8",
        "Content-Disposition": `attachment; filename="${Pricing.exportFileName(fmt)}"`,
      },
    });
  }

  const meta = getTypeMeta(type);
  if (!meta) return new Response("Unknown export type", { status: 400 });

  const kind = url.searchParams.get("kind") === "template" ? "template" : "export";
  const body = kind === "template" ? templateCsv(type) : await exportCsv(type);

  const d = new Date();
  const p = (n: number) => (n < 10 ? "0" + n : "" + n);
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  const filename =
    kind === "template" ? `Peak_${type}_template.csv` : `Peak_${type}_${stamp}.csv`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv;charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
