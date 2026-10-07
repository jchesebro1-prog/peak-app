import Link from "next/link";
import { requirePerm } from "@/lib/session";
import ModelNumbersClient from "./model-numbers-client";

export const metadata = { title: "Model numbers — Quartzite-6" };
// Rename batches run under a 45 s budget (FETCH_ACTION_BUDGET_MS).
export const maxDuration = 60;

/** #302 Catalog → Model numbers (admin): order-number SKUs become `Brand:Model` from a filled crosswalk sheet. */
export default async function ModelNumbersPage() {
  await requirePerm("manage_users");
  return (
    <div className="pk-content" style={{ maxWidth: 1100 }}>
      <Link href="/catalog" style={{ fontSize: 12.5, color: "#8c919c", textDecoration: "none" }}>← Catalog</Link>
      <h1 style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em", margin: "7px 0 4px" }}>Model numbers</h1>
      <p style={{ color: "#8c919c", fontSize: 13, margin: "0 0 16px", maxWidth: 760 }}>
        Replace order-number SKUs with <code>Brand:Model</code>. Upload a filled crosswalk sheet. Quotes, assemblies, Grid designs,
        documents and photos move to the new SKU; sent quotes keep theirs and still open. The old number stays searchable. Back up
        production first: <code>npm run db:export</code>.
      </p>
      <ModelNumbersClient />
    </div>
  );
}
