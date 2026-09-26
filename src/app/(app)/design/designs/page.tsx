import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { getAllDesigns } from "@/lib/stores/designs";
import { allEngagements } from "@/lib/stores/engagements";
import { activeUsers, reviewers } from "@/lib/users";
import { tasksForDesign } from "@/lib/stores/tasks";
import { taskTemplateSetsFor } from "@/lib/stores/task-templates";
import { loadEquipmentPriceTable } from "@/lib/stores/equipment-map";
import { CanMapProvider } from "@/components/design/equipment-map-link";
import DesignClient from "./design-client";
import "./design.css";

/**
 * Design Dashboard — the budgetary design sandbox, ported from
 * app/Design.dc.html (SandboxStore list + promote flow), plus a linkable
 * detail panel (?id=D-###) with the review workflow and BOM summary.
 */

export const dynamic = "force-dynamic";
/** #210: listFixtures() (via loadEquipmentPriceTable) can run the one-time
 *  fixture conversion under its 15 s budget (FIXTURES_CONVERT_BUDGET_MS). */
export const maxDuration = 60;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;

  const [designs, engagements, roster, prices, reviewerRows, templateSets] = await Promise.all([
    getAllDesigns(),
    allEngagements(),
    activeUsers(),
    loadEquipmentPriceTable(),
    reviewers(),
    taskTemplateSetsFor("design"),
  ]);
  // D149/#118 — the selected design's rows from the shared tasks collection
  // (tasks.ts's designId pointer, added alongside this feature — no design
  // task UI existed before it). Mirrors the estimator page's tasksForQuote.
  const designTasks = sp.id ? await tasksForDesign(sp.id) : [];

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
      selectedId={sp.id || null}
      roster={roster.map((u) => ({ name: u.name, initials: u.initials, color: u.color }))}
      prices={prices}
      reviewerNames={reviewerRows.map((u) => u.name)}
      engagementsForDesign={engagementsForDesign}
      people={roster.map((u) => ({ id: u.id, name: u.name }))}
      designTasks={designTasks}
      templateSets={templateSets.map((s) => ({ id: s.id, name: s.name }))}
    />
    </CanMapProvider>
  );
}
