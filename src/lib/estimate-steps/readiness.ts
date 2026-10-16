import type { SpecSection } from "@/app/(app)/estimator/types";
import { systemPrintsInBody } from "@/app/(app)/estimator/quote-document-view";
import { keyProductsNeedingText, scopesWithoutGoals } from "@/lib/estimate-output/package-gaps";
import { docGaps } from "@/lib/package-doc/gaps";
import { documentApplies } from "@/lib/package-doc/print";
import type { PackageDoc } from "@/lib/package-doc/types";
import { isRewardCreditItem } from "@/lib/rewards/credit-line";
import { needsRequote } from "@/lib/narrative/old-vendor-line";
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
  /** Phase 3: client-link opens and unread replies on the sent estimate's emails. */
  track?: { opens: number; newReplies: number };
  /** Phase 5: the estimate's package document. When it applies (documentApplies)
   *  it replaces the narrative fields, so their gaps (system intros,
   *  key-product paragraphs) don't count — its own broken pieces do (chips
   *  whose system/line is gone, product blocks no longer in the BOM). */
  document?: PackageDoc | null;
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

/** Narrative systems printed in the body with no intro text (a package
 *  document that applies replaces the intros, so then none count). */
export function narrativeWithoutIntro(sections: SpecSection[], document?: PackageDoc | null): number {
  if (documentApplies(document)) return 0;
  return sections.filter((s) => systemPrintsInBody(s) && s.presentation === "narrative" && !(s.narrative || "").trim()).length;
}

function packageBadge(saved: boolean, sections: SpecSection[], document?: PackageDoc | null): StepBadge {
  if (!saved) return { state: "idle", label: "Save first" };
  if (documentApplies(document)) {
    const g = docGaps(document, sections);
    const count = scopesWithoutGoals(sections) + g.removedChips.length + g.productsNotInBom.length;
    return count === 0 ? { state: "ok", label: "✓ Ready" } : { state: "gaps", count, label: plural(count, "gap", "gaps") };
  }
  const noIntro = narrativeWithoutIntro(sections);
  const count = noIntro + keyProductsNeedingText(sections) + scopesWithoutGoals(sections);
  return count === 0 ? { state: "ok", label: "✓ Ready" } : { state: "gaps", count, label: plural(count, "gap", "gaps") };
}

function reviewBadge(review: ReadinessInput["review"]): StepBadge {
  if (!review) return { state: "idle", label: "Not submitted" };
  if (review.tone === "approved") return { state: "ok", label: review.label };
  if (review.tone === "changes") return { state: "gaps", label: review.label };
  return { state: "idle", label: review.label };
}

/** #352 review M3 — lines Load system flagged "Old vendor price — re-quote" (still carrying the note). */
export function requoteCount(sections: SpecSection[]): number {
  return sections.reduce((n, s) => n + s.items.filter((it) => !isRewardCreditItem(it) && needsRequote(it)).length, 0);
}

function sendBadge(i: ReadinessInput): StepBadge {
  // #352 review M3: a draft about to go out warns about lines still at an old vendor price — never blocks Send.
  const requote = i.status === "draft" ? requoteCount(i.sections) : 0;
  // #355 review M6: so is a narrative system with no intro text (new estimates start Narrative).
  const noIntro = i.status === "draft" ? narrativeWithoutIntro(i.sections, i.document) : 0;
  if (requote > 0 || noIntro > 0) {
    const base = i.review?.tone === "approved" ? "Ready to send" : "";
    const warn = [
      requote ? `⚠ ${plural(requote, "line needs", "lines need")} a re-quote` : "",
      noIntro ? `⚠ ${plural(noIntro, "narrative system has", "narrative systems have")} no intro text` : "",
    ];
    return { state: "gaps", count: requote + noIntro, label: [base, ...warn].filter(Boolean).join(" · ") };
  }
  if (i.status === "sent") {
    const opens = i.track?.opens ?? 0;
    const replies = i.track?.newReplies ?? 0;
    let label = `Sent · Rev ${i.revNum}`;
    if (opens > 0) label += ` · 👁 ${opens}`;
    if (replies > 0) label += ` · ${replies} new ${replies === 1 ? "reply" : "replies"}`;
    return { state: "ok", label };
  }
  if (i.status === "won") return { state: "ok", label: "Won" };
  if (i.status === "lost") return { state: "idle", label: "Lost" };
  return { state: "idle", label: i.review?.tone === "approved" ? "Ready to send" : "—" };
}

export function estimateReadiness(i: ReadinessInput): Record<EstimateStep, StepBadge> {
  return {
    build: buildBadge(i.sections),
    package: packageBadge(i.saved, i.sections, i.document),
    review: reviewBadge(i.review),
    send: sendBadge(i),
  };
}
