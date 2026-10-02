import Link from "next/link";
import { requirePerm } from "@/lib/session";
import { blobEnabled } from "@/lib/blob";
import PhotoSheetClient from "./photo-sheet-client";

export const metadata = { title: "Photo sheet — Quartzite-6" };
// Import batches fetch, shrink and store under a 45 s budget (FETCH_ACTION_BUDGET_MS).
export const maxDuration = 60;

/** Catalog photo sheet: export the to-do list, fill in URLs or file names, import. */
export default async function PhotoSheetPage() {
  await requirePerm("create");
  return (
    <div className="pk-content" style={{ maxWidth: 1100 }}>
      <Link href="/catalog/documents" style={{ fontSize: 12.5, color: "#8c919c", textDecoration: "none" }}>← Datasheets</Link>
      <h1 style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em", margin: "7px 0 4px" }}>Photo sheet</h1>
      <p style={{ color: "#8c919c", fontSize: 13, margin: "0 0 16px", maxWidth: 760 }}>
        Download the sheet — every quoted or portal part, the ones missing a photo first. Put an image link or a photo&apos;s
        file name in Photo 1–3 (Photo 1 becomes the main photo), then upload it with any photos it names. Names not dropped
        here are looked up in the Peak Product Photos Drive folder. Nothing is ever removed.
      </p>
      {!blobEnabled() && (
        <div style={{ marginBottom: 14, padding: "10px 14px", borderRadius: 10, background: "#fdf3df", border: "1px solid #f3e0b5", color: "#9a6b12", fontSize: 12.5 }}>
          File storage isn&apos;t configured on this deployment (no BLOB_READ_WRITE_TOKEN) — imports will be refused.
        </div>
      )}
      <PhotoSheetClient />
    </div>
  );
}
