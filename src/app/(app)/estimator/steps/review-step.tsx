"use client";

import type { NextStepAction } from "@/lib/quote-next-step";
import { QuoteNextStep } from "@/components/quote-review/quote-next-step";
import { PdfPreviewPane } from "../preview-doc";
import { CoverPackagePanel } from "../cover-package-panel";
import { ReviewCostSummary } from "../review-cost-summary";
import type { EstimatorState } from "../use-estimator-state";

/**
 * #305 — Customer review: the saved customer PDF (main), the review actions
 * and the internal cost summary (right, desktop). A phone shows only the PDF,
 * plus the approver's decision when one is waiting.
 */
export function ReviewStep({ s, onActed }: { s: EstimatorState; onActed: (a: NextStepAction) => void }) {
  const {
    applySync,
    coverSummary,
    doSave,
    loadedId,
    notIncluded,
    notIncludedDefault,
    onCoverSummary,
    onNotIncluded,
    pdf,
    pdfDirty,
    phone,
    saveNow,
    sections,
    setActionError,
    setGateRefused,
    setPdf,
    statusChanging,
    t,
    tierResolving,
    next,
  } = s;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* #284 — an approver on a phone can decide right from the preview.
          The build-mode error banner isn't rendered here, so the control
          shows its own inline error line. */}
      {phone && loadedId && next?.approverMode && (
        <div style={{ padding: "10px 14px", borderBottom: "1px solid #e4e7ec", background: "#fff" }}>
          <QuoteNextStep
            quoteId={loadedId}
            view={next}
            variant="panel"
            approverOnly
            onSync={(r) => {
              applySync(r);
              if (r.ok) {
                setActionError(null);
                setGateRefused(false);
              }
            }}
          />
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <PdfPreviewPane
          phone={phone}
          canBuild={!phone}
          savedQuoteId={loadedId}
          pdf={pdf}
          onPdf={setPdf}
          dirty={pdfDirty}
          onSave={doSave}
          saveDisabled={statusChanging || tierResolving}
          actionsInline={!phone}
        />
        {!phone && (
          <aside
            aria-label="Review"
            className="est-scroll"
            style={{ width: 320, flexShrink: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 18, padding: 18, background: "#fff", borderLeft: "1px solid #ececf0" }}
          >
            {loadedId && next && (
              <QuoteNextStep
                quoteId={loadedId}
                view={next}
                variant="panel"
                savedOnly={pdfDirty}
                disabled={statusChanging || tierResolving}
                beforeAction={pdfDirty ? saveNow : undefined}
                onSync={(r, action) => {
                  applySync(r);
                  if (r.ok) {
                    setActionError(null);
                    setGateRefused(false);
                    onActed(action);
                  }
                }}
                onError={(m) => {
                  setActionError(m);
                  setGateRefused(false);
                }}
              />
            )}
            <ReviewCostSummary sections={sections} totals={t} />
          </aside>
        )}
      </div>
      {phone && (
        <div style={{ padding: "10px 14px", borderTop: "1px solid #e4e7ec", background: "#fff", overflowY: "auto", flexShrink: 0, maxHeight: "45%" }}>
          <CoverPackagePanel
            savedQuoteId={loadedId}
            canEdit={false}
            dirty={pdfDirty}
            coverSummary={coverSummary}
            onCoverSummary={onCoverSummary}
            notIncluded={notIncluded}
            onNotIncluded={onNotIncluded}
            notIncludedDefault={notIncludedDefault}
          />
        </div>
      )}
    </div>
  );
}
