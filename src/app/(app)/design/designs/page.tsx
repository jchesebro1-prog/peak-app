import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { getAllDesigns } from "@/lib/stores/designs";
import { allEngagements } from "@/lib/stores/engagements";
import { activeUsers, reviewers } from "@/lib/users";
import { loadEquipmentPriceTable } from "@/lib/stores/equipment-map";
import { loadWireLaborRules } from "@/lib/stores/pricing";
import { CanMapProvider } from "@/components/design/equipment-map-link";
import { getSettings } from "@/lib/settings";
import { venueTypesFrom } from "@/lib/venue-types";
import { estimateLinksForDesigns } from "@/lib/design/estimate-links-server";
import DesignClient from "./design-client";
import "./design.css";

/**
 * Design Dashboard — the budgetary design sandbox, ported from
 * app/Design.dc.html (SandboxStore list + promote flow), plus a linkable
 * detail panel (?id=D-###) with the review workflow and BOM summary.
 */

export const dynamic = "force-dynamic";
/** #210: listFixtures() (via loadEquipmentPriceTable) can run the one-time
 *  fixture conversion under its 15 s budget (FIXTURES_CONVERT_BUDGET_MS).
 *  #222: a promote renders the quote's saved PDF in `after()`, inside this
 *  budget — 120 s (fix wave 1). */
export const maxDuration = 120;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;

  const [designs, engagements, roster, prices, reviewerRows, wireLabor, settings] = await Promise.all([
    getAllDesigns(),
    allEngagements(),
    activeUsers(),
    loadEquipmentPriceTable(),
    reviewers(),
    loadWireLaborRules(),
    getSettings(),
  ]);
  // #316: designs drawing an Estimator quote offer "Open estimate →", not Add to Quotes (one batched read).
  const estimateLinks = await estimateLinksForDesigns(designs);

  // Derived, not stored: the design record carries no back-pointer, so the
  // reverse lookup is built here by scanning engagements each load — the two
  // sides of the link can never disagree (task 8 / D97). A design can be
  // referenced by more than one engagement (e.g. a design engagement and a
  // later bid-support engagement), so this holds all of them, in
  // allEngagements() order.
  const engagementsForDesign: Record<string, Array<{ id: string; name: string }>> = {};
  for (const e of engagements) {
    for (const did of e.designIds) {
      (engagementsForDesign[did] ||= []).push({ id: e.id, name: e.name });
    }
  }

  return (
    <CanMapProvider canMap={can("manage_users", user.roles)}>
    <DesignClient
      me={user.name}
      canApprove={can("approve", user.roles)}
      canCreate={can("create", user.roles)}
      designs={designs}
      estimateLinks={estimateLinks}
      selectedId={sp.id || null}
      roster={roster.map((u) => ({ name: u.name, initials: u.initials, color: u.color }))}
      prices={prices}
      wireLabor={wireLabor}
      reviewerNames={reviewerRows.map((u) => u.name)}
      engagementsForDesign={engagementsForDesign}
      people={roster.map((u) => ({ id: u.id, name: u.name }))}
      venueTypes={venueTypesFrom(settings.venueTypes)}
    />
    </CanMapProvider>
  );
}
