import type { SpecSection } from "@/app/(app)/estimator/types";
import { systemPrintsInBody } from "@/app/(app)/estimator/quote-document-view";
import { keyProductsNeedingText, scopesWithoutGoals } from "@/lib/estimate-output/package-gaps";
import { isRewardCreditItem } from "@/lib/rewards/credit-line";
import type { NextStepTone } from "@/lib/quote-next-step";
import type { QuoteStatus } from "@/lib/stores/quotes";
import type { EstimateStep } from "./steps";

/**
 * #305 (spec §4.6) — the line under each step tab. Pure and client-safe;
 * computed from the LIVE editor state, so it moves as you type. Never blocks.
 * The Package count is the client-side half of package-gaps.ts; the
 * server-only gaps (datasheets, drawings) stay as chips inside the step.
 */

export type StepBadge = { state: "ok" | "gaps" | "idle"; label: string; count?: number };

export type ReadinessInput = {
  saved: boolean;
  sections: SpecSection[];
  /** The next-step view's pill, or null for an unsaved quote. */
  review: { label: string; tone: NextStepTone } | null;
  status: QuoteStatus;
  revNum: number;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function buildBadge(sections: SpecSection[]): StepBadge {
  if (sections.length === 0) return { state: "idle", label: "No systems yet" };
  let empty = 0;
  let unpriced = 0;
  for (const s of sections) {
    const lines = s.items.filter((it) => !isRewardCreditItem(it));
    if (lines.length === 0) empty++;
    unpriced += lines.filter((it) => !(Number(it.price) > 0)).length;
  }
  const count = empty + unpriced;
  if (count === 0) {
    // Phase 2a: built progress rides the priced badge once any system is marked built.
    const n = sections.length;
    const built = sections.filter((s) => s.built).length;
    if (built === n) return { state: "ok", label: `✓ ${n} of ${n} built` };
    if (built > 0) return { state: "ok", label: `✓ ${plural(n, "system", "systems")} priced · ${built} of ${n} built` };
    return { state: "ok", label: `✓ ${plural(n, "system", "systems")} priced` };
  }
  const parts = [empty ? plural(empty, "empty system", "empty systems") : "", unpriced ? plural(unpriced, "unpriced line", "unpriced lines") : ""].filter(Boolean);
  return { state: "gaps", count, label: parts.join(" · ") };
}

function packageBadge(saved: boolean, sections: SpecSection[]): StepBadge {
  if (!saved) return { state: "idle", label: "Save first" };
  const noIntro = sections.filter((s) => systemPrintsInBody(s) && s.presentation === "narrative" && !(s.narrative || "").trim()).length;
  const count = noIntro + keyProductsNeedingText(sections) + scopesWithoutGoals(sections);
  return count === 0 ? { state: "ok", label: "✓ Ready" } : { state: "gaps", count, label: plural(count, "gap", "gaps") };
}

function reviewBadge(review: ReadinessInput["review"]): StepBadge {
  if (!review) return { state: "idle", label: "Not submitted" };
  if (review.tone === "approved") return { state: "ok", label: review.label };
  if (review.tone === "changes") return { state: "gaps", label: review.label };
  return { state: "idle", label: review.label };
}

function sendBadge(i: ReadinessInput): StepBadge {
  if (i.status === "sent") return { state: "ok", label: `Sent · Rev ${i.revNum}` };
  if (i.status === "won") return { state: "ok", label: "Won" };
  if (i.status === "lost") return { state: "idle", label: "Lost" };
  return { state: "idle", label: i.review?.tone === "approved" ? "Ready to send" : "—" };
}

export function estimateReadiness(i: ReadinessInput): Record<EstimateStep, StepBadge> {
  return {
    build: buildBadge(i.sections),
    package: packageBadge(i.saved, i.sections),
    review: reviewBadge(i.review),
    send: sendBadge(i),
  };
}
