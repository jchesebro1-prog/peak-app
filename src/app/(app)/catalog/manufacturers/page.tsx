import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { blobEnabled } from "@/lib/blob";
import { list as listCatalog } from "@/lib/stores/catalog";
import { listManufacturers } from "@/lib/stores/manufacturers";
import { loadPartDocsState } from "@/lib/part-docs/load";
import { buildImageIndex } from "@/lib/part-docs/views";
import { manufacturerRows } from "@/lib/manufacturer-rows";
import ManufacturersClient from "./manufacturers-client";

export const metadata = { title: "Manufacturers — Quartzite-6" };
export const dynamic = "force-dynamic";
// The set-image action reads each upload back from Blob and shrinks it with
// sharp — same 60 s function ceiling as the Datasheets page.
export const maxDuration = 60;

/** Catalog → Manufacturers (Manufacturer section Part 1): one image per manufacturer, shown to customers on that manufacturer's parts that have no photo of their own. */
export default async function ManufacturersPage() {
  const user = await requireUser();
  const parts = await listCatalog();
  const [state, records] = await Promise.all([loadPartDocsState(parts), listManufacturers()]);
  const images = buildImageIndex(state.documents, state.links);
  const rows = manufacturerRows(parts, (sku) => (images.get(sku) ?? []).some((r) => r.source !== "datasheet-render"), records);
  const canEdit = can("create", user.roles);
  return (
    <div className="pk-content" style={{ maxWidth: 1100 }}>
      <Link href="/catalog" style={{ fontSize: 12.5, color: "#8c919c", textDecoration: "none" }}>← Catalog</Link>
      <h1 style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em", margin: "7px 0 4px" }}>Manufacturers</h1>
      <p style={{ color: "#8c919c", fontSize: 13, margin: "0 0 16px", maxWidth: 720 }}>
        One image per manufacturer. Customers see it on any of that manufacturer&apos;s parts that have no photo of their own.
      </p>
      {!blobEnabled() && (
        <div style={{ marginBottom: 14, padding: "10px 14px", borderRadius: 10, background: "#fdf3df", border: "1px solid #f3e0b5", color: "#9a6b12", fontSize: 12.5 }}>
          File storage isn&apos;t configured on this deployment (no BLOB_READ_WRITE_TOKEN) — uploads will be refused.
        </div>
      )}
      <ManufacturersClient rows={rows} canEdit={canEdit} />
    </div>
  );
}
