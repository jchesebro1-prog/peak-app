import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { getMany } from "@/lib/stores/catalog";
import { listPipeTypes } from "@/lib/stores/rigging-types";
import { pipeTypeSkus } from "@/lib/rigging-config/types";
import type { PartInfo } from "../rigging-ui";
import PipeTypesClient from "./pipe-types-client";

export const metadata = { title: "Pipe types — Estimating Rules — Quartzite-6" };
export const dynamic = "force-dynamic";

/** Estimating Rules → Pipe types (#373): the parts map behind the pipe configurator. Admin only. */
export default async function PipeTypesPage() {
  const user = await requireUser();
  const back = <Link href="/estimating-rules" style={{ fontSize: 12.5, color: "#8c919c", textDecoration: "none" }}>← Estimating rules</Link>;
  if (!can("manage_users", user.roles)) {
    return (
      <div className="pk-content" style={{ maxWidth: 960 }}>
        {back}
        <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em", margin: "6px 0 20px" }}>Pipe types</div>
        <div className="pk-card" style={{ padding: "48px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Admin access required</div>
          <div style={{ fontSize: 13, color: "#9aa0ab", marginTop: 6, lineHeight: 1.55 }}>Pipe types decide which catalog parts price a pipe, so editing them is limited to admins.</div>
        </div>
      </div>
    );
  }
  const types = await listPipeTypes();
  const skus = [...new Set(types.flatMap((t) => pipeTypeSkus(t)))];
  const parts: Record<string, PartInfo> = {};
  for (const p of skus.length ? await getMany(skus) : []) parts[p.sku] = { desc: p.desc, cost: p.cost || 0, unit: p.unit || "ea", mfr: p.mfr || "" };
  return (
    <div className="pk-content" style={{ maxWidth: 1000 }}>
      {back}
      <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em", marginTop: 6 }}>Pipe types</div>
      <div style={{ fontSize: 13.5, color: "#8c919c", margin: "4px 0 18px", lineHeight: 1.5 }}>
        The catalog parts for each kind of pipe. The pipe configurator works out sticks, splices and clamps; every price comes from these parts in the live catalog.
      </div>
      <PipeTypesClient types={types} parts={parts} />
    </div>
  );
}
