import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { getMany } from "@/lib/stores/catalog";
import { getConduitSizes } from "@/lib/stores/conduit-sizes";
import ConduitSizesClient, { type ConduitPartInfo } from "./conduit-sizes-client";

export const metadata = { title: "Conduit sizes — Estimating Rules — Quartzite-6" };
export const dynamic = "force-dynamic";

/**
 * Estimating Rules → Conduit sizes (#321): the per-foot catalog part a priced
 * conduit run buys, by size. Admin-only (manage_users). Reads the blob and only
 * its parts (one getMany); a part no longer in the catalog shows as missing.
 */
export default async function ConduitSizesPage() {
  const user = await requireUser();
  const back = (
    <Link href="/estimating-rules" style={{ fontSize: 12.5, color: "#8c919c", textDecoration: "none" }}>
      ← Estimating rules
    </Link>
  );
  if (!can("manage_users", user.roles)) {
    return (
      <div className="pk-content" style={{ maxWidth: 960 }}>
        {back}
        <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em", margin: "6px 0 20px" }}>Conduit sizes</div>
        <div className="pk-card" style={{ padding: "48px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Admin access required</div>
          <div style={{ fontSize: 13, color: "#9aa0ab", marginTop: 6, lineHeight: 1.55 }}>
            Conduit sizes decide what a priced conduit run adds to a quote, so editing them is limited to admins.
          </div>
        </div>
      </div>
    );
  }
  const sizes = await getConduitSizes();
  const ids = [...new Set(sizes.flatMap((s) => (s.partId ? [s.partId] : [])))];
  const parts: Record<string, ConduitPartInfo> = {};
  for (const p of ids.length ? await getMany(ids) : []) parts[p.sku] = { desc: p.desc, cost: p.cost || 0, unit: p.unit || "ea" };
  return (
    <div className="pk-content" style={{ maxWidth: 1000 }}>
      {back}
      <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em", margin: "6px 0 6px" }}>Conduit sizes</div>
      <div style={{ fontSize: 13, color: "#8c919c", marginBottom: 18, lineHeight: 1.55 }}>
        What a priced conduit run buys, by size. Pick the catalog part sold by the foot for each size; a run on a size with no part stops the quote until one is set. Footage is added up per part and rounded up once.
      </div>
      <ConduitSizesClient sizes={sizes} parts={parts} />
    </div>
  );
}
