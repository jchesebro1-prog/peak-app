import Link from "next/link";
import { requireUser } from "@/lib/session";
import { blobEnabled } from "@/lib/blob";
import BulkDrop from "./bulk-drop";

export const metadata = { title: "Upload datasheets — Quartzite-6" };

/** Bulk drop (#207, spec §3): drop a folder, review the matches, confirm. */
export default async function BulkUploadPage() {
  await requireUser();
  return (
    <div className="pk-content" style={{ maxWidth: 1100 }}>
      <Link href="/catalog/documents" style={{ fontSize: 12.5, color: "#8c919c", textDecoration: "none" }}>← Datasheets</Link>
      <h1 style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em", margin: "7px 0 4px" }}>Upload many</h1>
      <p style={{ color: "#8c919c", fontSize: 13, margin: "0 0 16px", maxWidth: 720 }}>
        Drop a folder of PDFs and Word files. Each is matched to parts by the model number, MFR P/N or SKU in its file
        name; names with spec, guide or specification (and Word files) are filed as spec sheets. Review, fix any row, then confirm.
      </p>
      {!blobEnabled() && (
        <div style={{ marginBottom: 14, padding: "10px 14px", borderRadius: 10, background: "#fdf3df", border: "1px solid #f3e0b5", color: "#9a6b12", fontSize: 12.5 }}>
          File storage isn&apos;t configured on this deployment (no BLOB_READ_WRITE_TOKEN) — uploads will be refused.
        </div>
      )}
      <BulkDrop />
    </div>
  );
}
