import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { list as listCatalog } from "@/lib/stores/catalog";
import { loadDeviceTypeContext } from "@/lib/stores/device-types";
import { typeReviewRows } from "@/lib/design/device-types";
import DeviceTypesClient from "./device-types-client";

export const metadata = { title: "Device types — Quartzite-6" };
export const dynamic = "force-dynamic";

/**
 * Catalog → Device types (#226, spec §Screens 1): the curated ~25-type list
 * and the mapping of every distinct raw catalog category to one of them.
 * Reading through loadDeviceTypeContext auto-applies confident matches, so
 * the first visit maps the whole existing catalog on its own; what is left
 * unmapped is listed first.
 */
export default async function DeviceTypesPage() {
  const user = await requireUser();
  if (!can("manage_users", user.roles)) {
    return (
      <div className="pk-content" style={{ maxWidth: 960 }}>
        <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em", marginBottom: 20 }}>Device types</div>
        <div className="pk-card" style={{ padding: "48px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Admin access required</div>
          <div style={{ fontSize: 13, color: "#9aa0ab", marginTop: 6, lineHeight: 1.55 }}>
            Mapping catalog categories to Grid device types is limited to admins.
          </div>
        </div>
      </div>
    );
  }

  const catalog = await listCatalog();
  const { types, map } = await loadDeviceTypeContext(catalog);
  const rows = typeReviewRows(catalog, map, types);
  const partCounts: Record<string, number> = {};
  for (const r of rows) if (r.typeKey) partCounts[r.typeKey] = (partCounts[r.typeKey] || 0) + r.count;
  const unmapped = rows.filter((r) => r.status === "unmapped").length;

  return (
    <div className="pk-content" style={{ maxWidth: 1100 }}>
      <div style={{ marginBottom: 18 }}>
        <Link href="/catalog" style={{ fontSize: 12.5, color: "#8c919c", textDecoration: "none" }}>
          ← Catalog
        </Link>
        <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em", marginTop: 6 }}>Device types</div>
        <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 5, lineHeight: 1.5, maxWidth: 780 }}>
          The Grid&apos;s palette, layers and legends group parts by these types instead of the{" "}
          {rows.length.toLocaleString("en-US")} raw catalog categories. Confident matches apply on their own (marked{" "}
          <em>auto</em>); {unmapped.toLocaleString("en-US")} {unmapped === 1 ? "category needs" : "categories need"} a
          decision. Estimating groups &amp; trades stay on the{" "}
          <Link href="/catalog" style={{ color: "var(--accent)" }}>
            Catalog
          </Link>{" "}
          page.
        </div>
      </div>
      <DeviceTypesClient key={JSON.stringify(types)} types={types} rows={rows} partCounts={partCounts} />
    </div>
  );
}
