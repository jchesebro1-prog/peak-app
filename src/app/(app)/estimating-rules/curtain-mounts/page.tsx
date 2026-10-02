import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { getMany } from "@/lib/stores/catalog";
import { listCurtainMounts } from "@/lib/stores/curtain-mounts";
import CurtainMountsClient, { type MountPartInfo } from "./curtain-mounts-client";

export const metadata = { title: "Curtain mounts — Estimating Rules — Quartzite-6" };
export const dynamic = "force-dynamic";

/**
 * Estimating Rules → Curtain mounts (#292 §4.6): the hardware each curtain
 * mount uses when a curtain has no track. Admin-only (manage_users). Reads
 * the blob and only its SKUs (one getMany); a SKU no longer in the catalog
 * shows as missing.
 */
export default async function CurtainMountsPage() {
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
        <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em", margin: "6px 0 20px" }}>Curtain mounts</div>
        <div className="pk-card" style={{ padding: "48px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Admin access required</div>
          <div style={{ fontSize: 13, color: "#9aa0ab", marginTop: 6, lineHeight: 1.55 }}>
            Curtain mounts decide the hardware every cut sheet lists, so editing them is limited to admins.
          </div>
        </div>
      </div>
    );
  }
  const mounts = await listCurtainMounts();
  const skus = [...new Set(Object.values(mounts).flatMap((m) => (m?.rows ?? []).map((r) => r.sku)))];
  const parts: Record<string, MountPartInfo> = {};
  for (const p of skus.length ? await getMany(skus) : []) parts[p.sku] = { desc: p.desc, cost: p.cost || 0, unit: p.unit || "ea" };
  return (
    <div className="pk-content" style={{ maxWidth: 1000 }}>
      {back}
      <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em", margin: "6px 0 6px" }}>Curtain mounts</div>
      <div style={{ fontSize: 13, color: "#8c919c", marginBottom: 18, lineHeight: 1.55 }}>
        The hardware each curtain mount uses when a curtain has no track. A tracked curtain lists its track&apos;s own parts instead.
      </div>
      <CurtainMountsClient mounts={mounts} parts={parts} />
    </div>
  );
}
