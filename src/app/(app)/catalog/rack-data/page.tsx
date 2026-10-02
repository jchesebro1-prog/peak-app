import Link from "next/link";
import { requirePerm } from "@/lib/session";
import RackDataClient from "./rack-data-client";

export const metadata = { title: "Rack data sheet — Quartzite-6" };
export const maxDuration = 60;

/** Catalog rack data sheet (#296): download, fill in, upload, preview, import. */
export default async function RackDataPage() {
  await requirePerm("create");
  const link: React.CSSProperties = { color: "inherit", fontWeight: 600 };
  return (
    <div className="pk-content" style={{ maxWidth: 1100 }}>
      <Link href="/catalog" style={{ fontSize: 12.5, color: "#8c919c", textDecoration: "none" }}>← Catalog</Link>
      <h1 style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em", margin: "7px 0 4px" }}>Rack data sheet</h1>
      <p style={{ color: "#8c919c", fontSize: 13, margin: "0 0 10px", maxWidth: 760 }}>
        Fill in each part&apos;s rack height, depth, weight and power in one pass. Download the sheet, fill in the blanks in
        Excel or Sheets, upload it, check the preview, then import. Blank cells never erase what&apos;s already saved.
      </p>
      <p style={{ color: "#8c919c", fontSize: 13, margin: "0 0 16px", maxWidth: 760 }}>
        <a href="/catalog/rack-data/export" style={link}>Download the sheet</a> — the parts your assemblies use, plus any part that
        already has rack data. Or <a href="/catalog/rack-data/export?scope=all" style={link}>download the whole catalog</a>.
        Keep the SKU column as it is; the Manufacturer and Description columns are only there to help you.
      </p>
      <RackDataClient />
    </div>
  );
}
