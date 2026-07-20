import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { getAllDesigns } from "@/lib/stores/designs";
import { byCategory } from "@/lib/stores/catalog";
import { activeUsers, reviewers } from "@/lib/users";
import DesignClient from "./design-client";
import "./design.css";

/**
 * Design Dashboard — the budgetary design sandbox, ported from
 * app/Design.dc.html (SandboxStore list + promote flow), plus a linkable
 * detail panel (?id=D-###) with the review workflow and BOM summary.
 */

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;

  const [designs, roster, fabricParts, reviewerRows] = await Promise.all([
    getAllDesigns(),
    activeUsers(),
    byCategory("Fabric"),
    reviewers(),
  ]);

  return (
    <DesignClient
      me={user.name}
      canApprove={can("approve", user.roles)}
      designs={designs}
      selectedId={sp.id || null}
      roster={roster.map((u) => ({ name: u.name, initials: u.initials, color: u.color }))}
      fabrics={fabricParts.map((p) => ({
        sku: p.sku,
        desc: p.desc,
        costPerSqft: p.costPerSqft != null ? p.costPerSqft : null,
      }))}
      reviewerNames={reviewerRows.map((u) => u.name)}
    />
  );
}
