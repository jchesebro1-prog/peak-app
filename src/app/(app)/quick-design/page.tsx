import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { getDesign } from "@/lib/stores/designs";
import { all as allCustomers } from "@/lib/stores/customers";
import { byCategory } from "@/lib/stores/catalog";
import { num } from "@/lib/stores/pricing";
import { reviewers } from "@/lib/users";
import QuickDesignClient from "./quick-design-client";
import "./quick-design.css";

/**
 * Quick Design — the budgetary estimate builder (sandbox), ported from
 * app/Quick Design.dc.html. Server shell: loads the saved design
 * (?design=D-###), the customer directory, catalog fabrics and the live
 * pricing-rule defaults; all estimating math runs client-side (engine.ts).
 */

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ design?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const designId = sp.design || null;

  const [design, customers, fabricParts, installPct, freightPct, contingencyPct, reviewerRows] =
    await Promise.all([
      designId ? getDesign(designId) : Promise.resolve(null),
      allCustomers(),
      byCategory("Fabric"),
      num("system.installPct", 18),
      num("system.freightPct", 5),
      num("system.contingencyPct", 10),
      reviewers(),
    ]);

  return (
    <QuickDesignClient
      me={user.name}
      canApprove={can("approve", user.roles)}
      initialDesign={design}
      customers={customers.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        location: c.location,
        locations: (c.locations || []).map((l) => ({
          id: l.id || "",
          label: l.label || "",
          city: l.city || "",
          primary: !!l.primary,
        })),
      }))}
      fabrics={fabricParts.map((p) => ({
        sku: p.sku,
        desc: p.desc,
        costPerSqft: p.costPerSqft != null ? p.costPerSqft : null,
      }))}
      rates={{ installPct, freightPct, contingencyPct }}
      reviewerNames={reviewerRows.map((u) => u.name)}
    />
  );
}
