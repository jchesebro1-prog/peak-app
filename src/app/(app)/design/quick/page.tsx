import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { getDesign } from "@/lib/stores/designs";
import { all as allCustomers } from "@/lib/stores/customers";
import { list as catalogList } from "@/lib/stores/catalog";
import { fixtureAssembliesFrom } from "@/lib/fixture-assemblies";
import { listFixtures } from "@/lib/stores/fixtures";
import { num } from "@/lib/stores/pricing";
import { reviewers } from "@/lib/users";
import { loadDesignPricing } from "@/lib/stores/design-pricing";
import { CanMapProvider } from "@/components/design/equipment-map-link";
import QuickDesignClient from "./quick-design-client";
import "./quick-design.css";

/**
 * Quick Design — the budgetary estimate builder (sandbox), ported from
 * app/Quick Design.dc.html. Server shell: loads the saved design
 * (?design=D-###), the customer directory, the Equipment map price table
 * (#GEM) and the live pricing-rule defaults; all estimating math runs
 * client-side (engine.ts).
 */

export const dynamic = "force-dynamic";
/** #210: this page's first listFixtures() can run the one-time fixture
 *  conversion under its 15 s budget (FIXTURES_CONVERT_BUDGET_MS) — 60 s keeps
 *  that well inside the function limit, like the Datasheets page. */
export const maxDuration = 60;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ design?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const designId = sp.design || null;

  const [design, customers, installPct, freightPct, contingencyPct, reviewerRows, fixtureRecords, catalogRows] =
    await Promise.all([
      designId ? getDesign(designId) : Promise.resolve(null),
      allCustomers(),
      num("system.installPct", 18),
      num("system.freightPct", 5),
      num("system.contingencyPct", 10),
      reviewers(),
      listFixtures(),
      catalogList(),
    ]);
  // #210: fixtures (not systems) under their kept ids — included parts only.
  const fixtureList = fixtureAssembliesFrom(fixtureRecords, catalogRows);
  // The Equipment map price table (#GEM) plus each pickable fixture's price,
  // built from the catalog and fixtures this request already loaded (no
  // second load of either). A fixture pick prices through the SAME resolver
  // as an Equipment map assembly cell (priceCell, final review I3): its
  // included sell, or cost ÷ (1 − margin) when list-less — never a list-only
  // sum — and a pick that prices needs-a-part stays needs-a-part.
  const { table: prices, fixturePrices } = await loadDesignPricing(
    fixtureList.map((f) => f.id),
    { catalog: catalogRows, fixtures: fixtureRecords }
  );
  const fixtureAssemblies = fixtureList.map((assembly) => ({ id: assembly.id, name: assembly.name }));

  return (
    <CanMapProvider canMap={can("manage_users", user.roles)}>
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
      prices={prices}
      rates={{ installPct, freightPct, contingencyPct }}
      reviewerNames={reviewerRows.map((u) => u.name)}
      fixtureAssemblies={fixtureAssemblies}
      fixturePrices={fixturePrices}
    />
    </CanMapProvider>
  );
}
