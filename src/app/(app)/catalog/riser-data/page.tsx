import Link from "next/link";
import { requirePerm } from "@/lib/session";
import RiserDataClient from "./riser-data-client";

export const metadata = { title: "Riser data — Quartzite-6" };
// Apply runs in budgeted batches (FETCH_ACTION_BUDGET_MS, 45 s).
export const maxDuration = 60;

/** Catalog → Riser data (#328 A2): download, review in Excel, upload, preview, apply. Admin only. */
export default async function RiserDataPage() {
  await requirePerm("manage_users");
  const link: React.CSSProperties = { color: "inherit", fontWeight: 600 };
  return (
    <div className="pk-content" style={{ maxWidth: 1100 }}>
      <Link href="/catalog" style={{ fontSize: 12.5, color: "#8c919c", textDecoration: "none" }}>← Catalog</Link>
      <h1 style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em", margin: "7px 0 4px" }}>Riser data</h1>
      <p style={{ color: "#8c919c", fontSize: 13, margin: "0 0 10px", maxWidth: 760 }}>
        Review the Bray designator code and riser tag defaults (Box · Face · Mount · Height · P/D) for lighting-control
        parts in one pass. <a href="/catalog/riser-data/export" style={link}>Download the sheet</a>, fix the highlighted
        columns in Excel or Sheets, upload it, check the preview, then apply.
      </p>
      <p style={{ color: "#8c919c", fontSize: 13, margin: "0 0 16px", maxWidth: 760 }}>
        A blank part is pre-filled from the suggestion rules (Source: suggested) — nothing is saved until you apply it. In
        the editable columns, a blank cell leaves the part alone and a <code>-</code> clears the saved value. Keep the SKU
        column as it is.
      </p>
      <RiserDataClient />
    </div>
  );
}
