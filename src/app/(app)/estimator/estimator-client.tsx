"use client";

import { useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import type { NextStepAction } from "@/lib/quote-next-step";
import { parseStep, stepAfterAction, stepSearch, type EstimateStep } from "@/lib/estimate-steps/steps";
import { estimateReadiness } from "@/lib/estimate-steps/readiness";
import { CSS } from "./estimator-styles";
import { useEstimatorState } from "./use-estimator-state";
import type { EstimatorProps } from "./types";
import { EstimatorHeader } from "./estimator-header";
import { EstimatorBanners } from "./estimator-banners";
import { StepTabs } from "./step-tabs";
import { BuildStep } from "./steps/build-step";
import { PackageStep } from "./steps/package-step";
import { ReviewStep } from "./steps/review-step";
import { SendStep } from "./steps/send-step";

/**
 * #304 (spec 2026-10-07 §4) — the Estimator shell: one header, four step
 * tabs (`?step=`), the banners, and the active step. All quote state lives in
 * useEstimatorState, so switching steps never drops unsaved edits.
 */
export default function EstimatorClient(props: EstimatorProps) {
  const s = useEstimatorState(props);
  const params = useSearchParams();
  const step: EstimateStep = s.phone ? "review" : parseStep(params.get("step"));
  const goStep = (to: EstimateStep) => {
    if (to === step) return;
    window.history.pushState(null, "", window.location.pathname + stepSearch(window.location.search, to));
  };
  const onActed = (action: NextStepAction) => {
    const to = stepAfterAction(action);
    if (to) goStep(to);
  };
  // The first save gives a new estimate its id — put it in the URL so a reload or a copied step link reopens it.
  useEffect(() => {
    if (!s.loadedId || params.get("id") === s.loadedId) return;
    window.history.replaceState(null, "", window.location.pathname + stepSearch(window.location.search, step, s.loadedId));
  }, [s.loadedId, params, step]);
  const badges = useMemo(
    () =>
      estimateReadiness({
        saved: !!s.loadedId,
        sections: s.sections,
        review: s.next ? { label: s.next.pill.label, tone: s.next.pill.tone } : null,
        status: s.status,
        revNum: s.revNum,
      }),
    [s.loadedId, s.sections, s.next, s.status, s.revNum]
  );

  return (
    <div className="est-root" style={{ height: "100%", display: "flex", flexDirection: "column", fontFamily: "var(--font-ui)", color: "#16181d", background: "#f7f8fa", overflow: "hidden" }}>
      <style>{CSS}</style>
      {!s.phone && (
        <>
          <EstimatorHeader s={s} onActed={onActed} />
          <StepTabs step={step} badges={badges} onStep={goStep} />
          <EstimatorBanners s={s} onActed={onActed} />
        </>
      )}

      {step === "build" && <BuildStep s={s} onOpenNarrative={() => goStep("package")} />}
      {step === "package" && <PackageStep s={s} />}
      {step === "review" && <ReviewStep s={s} onActed={onActed} />}
      {step === "send" && <SendStep s={s} onActed={onActed} />}
    </div>
  );
}
