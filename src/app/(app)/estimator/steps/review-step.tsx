"use client";

import { useEffect, useMemo, useState } from "react";
import type { NextStepAction } from "@/lib/quote-next-step";
import { QuoteNextStep } from "@/components/quote-review/quote-next-step";
import { estimateReadiness } from "@/lib/estimate-steps/readiness";
import { REVIEW_UI_COPY } from "@/lib/estimate-review/review-ui";
import { PdfPreviewPane } from "../preview-doc";
import { ClientLinkPanel } from "../client-link-panel";
import { CoverPackagePanel } from "../cover-package-panel";
import { reviewDocsAction, type ReviewDocsResult } from "../review-actions";
import type { EstimatorState } from "../use-estimator-state";
import { ReviewSidebar } from "./review-sidebar";
import { ReviewTabs } from "./review-tabs";

/**
 * #305 — Customer review. Desktop (Phase 4, spec §11): the client's-eye tabs
 * (review-tabs.tsx — Document = the saved PDF, the framed package page / BOM /
 * cut sheets, Datasheets, Drawings) and the internal sidebar (review-sidebar.tsx —
 * the review actions, cost, Labor, Package checklist, Comments). A phone keeps
 * the view-only Review: the PDF, the approver's decision when one is waiting,
 * and the read-only cover and client link blocks.
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
    revNum,
    sections,
    setActionError,
    setGateRefused,
    setPdf,
    status,
    statusChanging,
    tierResolving,
    next,
    packageDoc,
  } = s;

  /* Phase 4 — the SAVED package's Datasheets / Drawings rows and gap chips,
     shared by the tabs and the Package checklist; re-read after every Save
     (pdf.savedAt) or status change (next.asOf). Desktop only. */
  const [docs, setDocs] = useState<ReviewDocsResult | null>(null);
  const savedAt = pdf?.savedAt ?? 0;
  const asOf = next?.asOf ?? 0;
  useEffect(() => {
    if (phone || !loadedId) return;
    let live = true;
    reviewDocsAction(loadedId).then(
      (r) => {
        if (live) setDocs(r);
      },
      () => {
        if (live) setDocs({ ok: false, error: REVIEW_UI_COPY.docsError });
      }
    );
    return () => {
      live = false;
    };
  }, [phone, loadedId, savedAt, asOf]);
  const packageBadge = useMemo(
    () =>
      estimateReadiness({
        saved: !!loadedId,
        sections,
        review: next ? { label: next.pill.label, tone: next.pill.tone } : null,
        status,
        revNum,
        hasDocument: !!packageDoc,
      }).package,
    [loadedId, sections, next, status, revNum, packageDoc]
  );

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
        {phone ? (
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
        ) : (
          <>
            <ReviewTabs s={s} docs={loadedId ? docs : null} />
            <ReviewSidebar s={s} onActed={onActed} docs={loadedId ? docs : null} packageBadge={packageBadge} />
          </>
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
          {loadedId && <ClientLinkPanel quoteId={loadedId} />}
        </div>
      )}
    </div>
  );
}
