"use client";

import { useState, type ReactNode } from "react";
import type { NextStepAction } from "@/lib/quote-next-step";
import { SEND_STEP_IDS, sendStepLayout, type SendCard } from "@/lib/estimate-email/send-ui";
import type { QuoteStatus } from "@/lib/stores/quotes";
import { QuoteNextStep } from "@/components/quote-review/quote-next-step";
import { TasksCard } from "@/components/tasks-card";
import { ApplyTemplateControl } from "@/components/apply-template-control";
import { addQuoteTaskAction, removeQuoteTaskAction, applyQuoteTemplateAction, setQuoteTaskStatusAction, updateQuoteTaskAction } from "../actions";
import { ClientLinkPanel } from "../client-link-panel";
import { PackageStaffPanel } from "../package-staff-panel";
import { CHEVRON_CLIP, DARK_SELECT, STATUS_DOT } from "../estimator-styles";
import type { EstimatorState } from "../use-estimator-state";
import { SendActivity } from "./send-activity";
import { SendComposer } from "./send-composer";

const CARD = { background: "#fff", border: "1px solid #ececf0", borderRadius: 12, padding: 16 } as const;
const CARD_LABEL = { fontSize: 11, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", marginBottom: 10 } as const;

/**
 * #305 — Send & track: status and the next step, the Daylite pipeline, the
 * client link (+ revisions) and the client's responses, and the quote's tasks.
 * Phase 3 (spec §10): the email composer leads before the first send; once
 * sent, the Activity card leads with a collapsed "Send another email"
 * composer (none once won/lost). The cards render as one keyed list, so a
 * status change reorders them without remounting the composer.
 */
export function SendStep({ s, onActed }: { s: EstimatorState; onActed: (a: NextStepAction) => void }) {
  const {
    applySync,
    changePipeline,
    changeStage,
    changeStatus,
    loadedId,
    pdfDirty,
    people,
    pipelines,
    quoteTasks,
    saveNow,
    setActionError,
    setGateRefused,
    setTrackSummary,
    showStageBar,
    stageBarCurIdx,
    stageBarLostLabel,
    stageBarPipeline,
    status,
    statusChanging,
    templateSets,
    tierResolving,
    next,
  } = s;
  /** Bumped after a send so the Activity card re-reads at once. */
  const [trackKey, setTrackKey] = useState(0);

  const cards: Record<SendCard, ReactNode> = {
    composer: (
      <section key="composer" aria-label="Email the estimate" style={CARD}>
        <SendComposer s={s} collapsible={status !== "draft"} onSent={() => setTrackKey((k) => k + 1)} />
      </section>
    ),
    activity: (
      <section key="activity" aria-label="Activity" style={CARD}>
        {loadedId ? (
          <SendActivity quoteId={loadedId} refreshKey={trackKey} onTrack={setTrackSummary} />
        ) : (
          <div style={{ fontSize: 11.5, color: "#aab0bb" }}>Save the estimate first.</div>
        )}
      </section>
    ),
    status: (
      <section key="status" id={SEND_STEP_IDS.status} aria-label="Status" style={CARD}>
        <div style={CARD_LABEL}>Status</div>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: loadedId && next ? 12 : 0 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: STATUS_DOT[status] || "#c98a2b",
              flexShrink: 0,
            }}
          />
          <select
            value={status}
            id={SEND_STEP_IDS.statusSelect}
            onChange={(e) => changeStatus(e.target.value as QuoteStatus)}
            aria-label="Quote status"
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 12.5,
              fontWeight: 600,
              color: "#16181d",
              background: "#fff",
              border: "1px solid #dfe2e8",
              borderRadius: 8,
              padding: "9px 10px",
              cursor: "pointer",
            }}
          >
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
          </select>
        </div>
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
      </section>
    ),
    // Daylite stage bar (Task 6) — system quotes only, none for an unsaved
    // estimate (sendStepLayout drops it when the bar does not apply).
    // Read-only + a "Lost" marker on a lost quote; the pipeline switch
    // (Estimate/Design ⇄ BID SPEC) only while draft, since a sent/won stage
    // carries contractual meaning.
    pipeline: showStageBar ? (
      <section key="pipeline" aria-label="Pipeline" style={CARD}>
        <div style={CARD_LABEL}>Pipeline</div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
            rowGap: 8,
            padding: "9px 22px",
            background: "#22252b",
            borderBottom: "1px solid #2b2e35",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            {stageBarPipeline.stages.map((s, i) => {
              const isCurrent = i === stageBarCurIdx;
              const isPast = stageBarCurIdx >= 0 && i < stageBarCurIdx;
              const readOnly = status === "lost";
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={readOnly}
                  onClick={() => changeStage(s.id)}
                  title={readOnly ? "Lost — the stage the quote died at" : "Set stage: " + s.label}
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: 11,
                    fontWeight: isCurrent ? 700 : 600,
                    color: isCurrent ? "#16181d" : isPast ? "#cfd3da" : "#7d828d",
                    background: isCurrent ? "var(--accent)" : "#2b2e35",
                    border: "1px solid " + (isCurrent ? "var(--accent)" : "#3a3e46"),
                    padding: "6px 16px 6px 20px",
                    marginLeft: i === 0 ? 0 : -10,
                    clipPath: CHEVRON_CLIP,
                    cursor: readOnly ? "default" : "pointer",
                    whiteSpace: "nowrap",
                    position: "relative",
                    zIndex: i + 1,
                    opacity: readOnly ? 0.6 : 1,
                  }}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
          {status === "lost" && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "#e0a08f",
                background: "#3a2b26",
                border: "1px solid #5a3c33",
                borderRadius: 20,
                padding: "4px 11px",
                whiteSpace: "nowrap",
              }}
            >
              ✕ Lost{stageBarLostLabel ? " at " + stageBarLostLabel : ""}
            </span>
          )}
          {status === "draft" && (
            <select
              value={stageBarPipeline.id}
              onChange={(e) => changePipeline(e.target.value)}
              aria-label="Quote pipeline"
              style={{ ...DARK_SELECT, borderRadius: 7, padding: "6px 9px" }}
            >
              {pipelines.quote.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </section>
    ) : null,
    clientLink: (
      <section key="clientLink" id={SEND_STEP_IDS.clientLink} aria-label="Client link" style={CARD}>
        {loadedId ? (
          <ClientLinkPanel quoteId={loadedId} withPackage={false} />
        ) : (
          <>
            <div style={CARD_LABEL}>Client link</div>
            <div style={{ fontSize: 11.5, color: "#aab0bb" }}>Save the estimate first.</div>
          </>
        )}
        {loadedId && <PackageStaffPanel quoteId={loadedId} section="responses" />}
      </section>
    ),
    tasks: (
      <section key="tasks" aria-label="Tasks" style={CARD}>
        {/* Tasks (PUNCHLIST #17 remainder) — needs a saved quote to
              attach to; a brand-new unsaved draft has nowhere for
              quoteId to point yet. */}
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#9aa0ab",
              letterSpacing: ".05em",
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
            Tasks
          </div>
          {loadedId ? (
            <>
              <ApplyTemplateControl parentField="quoteId" parentId={loadedId} templateSets={templateSets} action={applyQuoteTemplateAction} />
              <TasksCard
                parentField="quoteId"
                parentId={loadedId}
                tasks={quoteTasks}
                people={people}
                addAction={addQuoteTaskAction}
                setStatusAction={setQuoteTaskStatusAction}
                updateAction={updateQuoteTaskAction}
                removeAction={removeQuoteTaskAction}
                defaultSection="Review"
              />
            </>
          ) : (
            <div style={{ fontSize: 11.5, color: "#aab0bb" }}>Save the quote to add tasks.</div>
          )}
        </div>
      </section>
    ),
  };

  return (
    <div className="est-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 26px 60px" }}>
      <div style={{ maxWidth: 880, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
        {sendStepLayout(status, showStageBar).map((k) => cards[k])}
      </div>
    </div>
  );
}
