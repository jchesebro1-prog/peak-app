import Link from "next/link";
import { requireUser } from "@/lib/session";
import { ProductSpecsImport } from "./product-specs-client";

/**
 * #205 — Import product specs: loads the filled product-specs template
 * (docs/specs-seed/…/product-specs-template.xlsx) back into the catalog.
 * Each row's MFR # matches catalog parts; a preview shows every match and
 * problem before anything is written, and the import writes spec text only
 * onto parts that matched. It never creates a part.
 */

export const metadata = { title: "Import product specs — Quartzite-6" };

export default async function ProductSpecsImportPage() {
  await requireUser();
  return (
    <div className="pk-content" style={{ maxWidth: 1080, margin: "0 auto" }}>
      <div style={{ marginBottom: 10 }}>
        <Link href="/design/specs/library" style={{ fontSize: 12, color: "#8c919c", textDecoration: "none" }}>
          ← Spec library
        </Link>
      </div>
      <div style={{ marginBottom: 18 }}>
        <div className="pk-page-title">Import product specs</div>
        <div className="pk-page-sub">
          Load the filled product-specs template. Each MFR # is matched to a catalog part; the first match gets the
          spec text and the rest are linked to it as “same spec as”. Parts are never created.
        </div>
      </div>
      <ProductSpecsImport />
    </div>
  );
}
