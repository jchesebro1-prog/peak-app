"use client";

import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import type { NextStepAction } from "@/lib/quote-next-step";
import { parseStep, stepAfterAction, stepSearch, type EstimateStep } from "@/lib/estimate-steps/steps";
import { packageTabSearch } from "@/lib/estimate-steps/package-tabs";
import { estimateReadiness } from "@/lib/estimate-steps/readiness";
import { retryQuotePdfAction } from "@/app/(app)/quotes/pdf-actions";
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
 * #305 (spec 2026-10-07 §4) — the Estimator shell: one header, four step
 * tabs (`?step=`), the banners, and the active step. All quote state lives in
 * useEstimatorState, so switching steps never drops unsaved edits.
 */
export default function EstimatorClient(props: EstimatorProps) {
  const s = useEstimatorState(props);
  const params = useSearchParams();
  const step: EstimateStep = s.phone ? "review" : parseStep(params.get("step"));
  const goStep = (to: EstimateStep) => {
    if (to === step) return;
    void s.live.flush();
    window.history.pushState(null, "", window.location.pathname + stepSearch(window.location.search, to));
  };
  /** #333 (Q4): Build's presentation chip → Build package → Client package → Systems (the one presentation editor). */
  const presentationHref = packageTabSearch(stepSearch("?" + params.toString(), "package"), "client") + "#systems";
  const openPresentation = () =>
    window.history.pushState(null, "", window.location.pathname + packageTabSearch(stepSearch(window.location.search, "package"), "client") + "#systems");
  const onActed = (action: NextStepAction) => {
    const to = stepAfterAction(action);
    if (to) goStep(to);
  };
  // The first save gives a new estimate its id — put it in the URL so a reload or a copied step link reopens it.
  useEffect(() => {
    if (!s.loadedId || params.get("id") === s.loadedId) return;
    window.history.replaceState(null, "", window.location.pathname + stepSearch(window.location.search, step, s.loadedId));
  }, [s.loadedId, params, step]);
  // Customer review and Send & track show and send the rendered PDF. A live save only marks it out of date, so render it
  // on the way in: a save that renders when the screen is ahead of it, a plain render when it's out of date from before a reload.
  const renderAskedRef = useRef<string | null>(null);
  /** One manual save per visit: if the PDF still reads dirty after it, don't save (and render) again until the screen is clean once. */
  const saveAskedRef = useRef(false);
  const needsPdf = !!s.loadedId && (step === "review" || step === "send") && s.liveMode;
  useEffect(() => {
    if (!needsPdf) {
      renderAskedRef.current = null;
      saveAskedRef.current = false;
      return;
    }
    if (s.pdfDirty) {
      // Only after a real edit: load-time derived changes can read as dirty too, and opening must never write (a phone opens straight on review).
      if (s.live.edited && !saveAskedRef.current) {
        saveAskedRef.current = true;
        void s.saveNow();
      }
      return;
    }
    saveAskedRef.current = false; // clean again: a later edit on this step may ask once more
    if (s.pdf && !s.pdf.outOfDate) return;
    // Once per visit: a failed render shows its own Retry in the preview.
    if (renderAskedRef.current === s.loadedId) return;
    renderAskedRef.current = s.loadedId;
    void retryQuotePdfAction(s.loadedId as string).then((view) => {
      if (view) s.setPdf(view);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsPdf, s.pdfDirty, s.pdf, s.loadedId, s.live.edited]);
  const badges = useMemo(
    () =>
      estimateReadiness({
        saved: !!s.loadedId,
        sections: s.sections,
        review: s.next ? { label: s.next.pill.label, tone: s.next.pill.tone } : null,
        status: s.status,
        revNum: s.revNum,
        track: s.trackSummary ?? undefined,
        document: s.packageDoc,
        boxSale: s.boxSale,
      }),
    [s.loadedId, s.sections, s.packageDoc, s.next, s.status, s.revNum, s.trackSummary, s.boxSale]
  );

  return (
    <div className="est-root" style={{ height: "100%", display: "flex", flexDirection: "column", fontFamily: "var(--font-ui)", color: "#16181d", background: "#f7f8fa", overflow: "hidden" }}>
      <style>{CSS}</style>
      {!s.phone && (
        <>
          <EstimatorHeader s={s} step={step} onActed={onActed} onStep={goStep} />
          <StepTabs step={step} badges={badges} onStep={goStep} />
          <EstimatorBanners s={s} onActed={onActed} />
        </>
      )}

      {step === "build" && <BuildStep s={s} onOpenNarrative={() => goStep("package")} presentationHref={presentationHref} onOpenPresentation={openPresentation} />}
      {step === "package" && <PackageStep s={s} />}
      {step === "review" && <ReviewStep s={s} onActed={onActed} />}
      {step === "send" && <SendStep s={s} onActed={onActed} />}
    </div>
  );
}
