"use client";

import { CustomerFieldsCard } from "../customer-fields-card";
import { EstimateOutputCard } from "../estimate-output-card";
import { PipelinesCard } from "../pipelines-card";
import { ReviewLimitsCard } from "../review-limits-card";
import type { CustomFieldDef } from "@/lib/customer-fields";
import type { Pipelines } from "@/lib/pipelines";
import type { ReviewLimits } from "@/lib/review-limits";
import type { EstimateOutputDefaults } from "@/lib/estimate-output/fields";
import { GROUP_LINKS } from "../settings-sections";
import { LinkTiles } from "./shared";
import type { UserVM } from "./types";

/**
 * Settings → Sales & Rewards (settings cleanup): the Rewards, Catalog,
 * Estimating Rules and Templates shortcut row, then Review limits, Pipelines
 * and Customer fields — each card unchanged from the old Admin section.
 */
export function SalesGroup({
  users,
  reviewLimits,
  estimateOutput,
  pipelines,
  pipelineUsage,
  customerFieldDefs,
}: {
  users: UserVM[];
  /** #242 — resolved; archived people's rows kept. */
  reviewLimits: ReviewLimits;
  /** #301 — the Not included default and the cover footer website. */
  estimateOutput: EstimateOutputDefaults;
  /** Settings → Pipelines (Task 7). */
  pipelines: Pipelines;
  /** Stage usage counts, keyed by pipeline id then stage id. */
  pipelineUsage: Record<string, Record<string, number>>;
  customerFieldDefs: CustomFieldDef[];
}) {
  return (
    <>
      <LinkTiles screens={GROUP_LINKS.sales} />
      <ReviewLimitsCard
        key={JSON.stringify(reviewLimits)}
        people={users.filter((u) => u.status === "active").map((u) => ({ id: u.id, name: u.name }))}
        limits={reviewLimits}
      />
      <PipelinesCard pipelines={pipelines} usage={pipelineUsage} />
      <CustomerFieldsCard
        key={customerFieldDefs.map((d) => d.id).join("|")}
        defs={customerFieldDefs}
      />
      <EstimateOutputCard key={JSON.stringify(estimateOutput)} defaults={estimateOutput} />
    </>
  );
}
