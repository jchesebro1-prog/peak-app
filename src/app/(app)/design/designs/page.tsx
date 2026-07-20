import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { getAllDesigns } from "@/lib/stores/designs";
import { allEngagements } from "@/lib/stores/engagements";
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

  const [designs, engagements, roster, fabricParts, reviewerRows] = await Promise.all([
    getAllDesigns(),
    allEngagements(),
    activeUsers(),
    byCategory("Fabric"),
    reviewers(),
  ]);

  // Derived, not stored: the design record carries no back-pointer, so the
  // reverse lookup is built here by scanning engagements each load — the two
  // sides of the link can never disagree (task 8 / D97).
  const engagementForDesign: Record<string, { id: string; name: string }> = {};
  for (const e of engagements) {
    for (const did of e.designIds) {
      engagementForDesign[did] = { id: e.id, name: e.name };
    }
  }

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
      engagementForDesign={engagementForDesign}
    />
  );
}
