import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { getMany } from "@/lib/stores/catalog";
import { listFixtures } from "@/lib/stores/fixtures";
import { listLinesetTypes } from "@/lib/stores/rigging-types";
import { linesetTypeSkus } from "@/lib/rigging-config/types";
import type { PartInfo } from "../rigging-ui";
import LinesetTypesClient from "./lineset-types-client";

export const metadata = { title: "Lineset types — Estimating Rules — Quartzite-6" };
export const dynamic = "force-dynamic";

/** Estimating Rules → Lineset types (#373): the parts map behind the lineset configurator. Admin only. */
export default async function LinesetTypesPage() {
  const user = await requireUser();
  const back = <Link href="/estimating-rules" style={{ fontSize: 12.5, color: "#8c919c", textDecoration: "none" }}>← Estimating rules</Link>;
  if (!can("manage_users", user.roles)) {
    return (
      <div className="pk-content" style={{ maxWidth: 960 }}>
        {back}
        <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em", margin: "6px 0 20px" }}>Lineset types</div>
        <div className="pk-card" style={{ padding: "48px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Admin access required</div>
          <div style={{ fontSize: 13, color: "#9aa0ab", marginTop: 6, lineHeight: 1.55 }}>Lineset types decide which catalog parts price a lineset, so editing them is limited to admins.</div>
        </div>
      </div>
    );
  }
  const [types, fixtures] = await Promise.all([listLinesetTypes(), listFixtures()]);
  const skus = [...new Set(types.flatMap((t) => linesetTypeSkus(t)))];
  const parts: Record<string, PartInfo> = {};
  for (const p of skus.length ? await getMany(skus) : []) parts[p.sku] = { desc: p.desc, cost: p.cost || 0, unit: p.unit || "ea", mfr: p.mfr || "" };
  const assemblies = fixtures.filter((f) => f.kind === "hardware").map((f) => ({ id: f.id, name: f.label }));
  return (
    <div className="pk-content" style={{ maxWidth: 1000 }}>
      {back}
      <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em", marginTop: 6 }}>Lineset types</div>
      <div style={{ fontSize: 13.5, color: "#8c919c", margin: "4px 0 18px", lineHeight: 1.5 }}>
        The cable, hand line, terminations and chain wraps for a counterweight lineset. A role can be a catalog part or a Hardware assembly; every price comes from the live catalog.
      </div>
      <LinesetTypesClient types={types} parts={parts} assemblies={assemblies} />
    </div>
  );
}
