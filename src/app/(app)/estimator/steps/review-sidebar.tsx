"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { NextStepAction } from "@/lib/quote-next-step";
import { QuoteNextStep } from "@/components/quote-review/quote-next-step";
import { nsSendBackAction } from "@/app/(app)/quotes/review-actions";
import { canAddComment, canDelete, canResolve, COMMENT_BODY_MAX, numberComments, type ReviewComment } from "@/lib/estimate-review/comments";
import { laborSummary, type LaborSummaryGroup } from "@/lib/estimate-review/labor";
import {
  canSendBackFromReview, checklistRows, commentActionLabel, commentTargets, commentTime, crewLine, REVIEW_UI_COPY as COPY, sendBackEnabled, sendBackLabel,
  sendBackNoteFromNumbered, withoutSendBack,
} from "@/lib/estimate-review/review-ui";
import type { StepBadge } from "@/lib/estimate-steps/readiness";
import { fmt } from "../pricing";
import { ReviewCostSummary } from "../review-cost-summary";
import { addReviewCommentAction, deleteReviewCommentAction, listReviewCommentsAction, resolveReviewCommentAction, type ReviewCommentsResult, type ReviewDocsResult } from "../review-actions";
import type { EstimatorState } from "../use-estimator-state";

const TITLE: CSSProperties = { fontSize: 11, fontWeight: 600, color: "#9aa0ab", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 };
const CELL: CSSProperties = { padding: "4px 6px", fontSize: 12, borderBottom: "1px solid #ececf0", textAlign: "left" };
const NUM: CSSProperties = { ...CELL, textAlign: "right", fontFamily: "var(--font-mono)" };
const SMALL: CSSProperties = { fontSize: 11.5, color: "#5b616e", lineHeight: 1.45 };
const BTN: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  fontWeight: 600,
  color: "#16181d",
  background: "#f1f2f5",
  border: "none",
  borderRadius: 7,
  padding: "5px 11px",
  cursor: "pointer",
};
const LINK_BTN: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 11.5, fontWeight: 600, color: "#5b616e", background: "none", border: "none", padding: 0, cursor: "pointer" };
const FIELD: CSSProperties = { width: "100%", boxSizing: "border-box", fontFamily: "var(--font-ui)", fontSize: 12.5, border: "1px solid #d8dbe1", borderRadius: 7, padding: "6px 8px", background: "#fff" };

/**
 * Estimator Phase 4 (spec §11.2–11.3) — the Customer review step's internal
 * sidebar (never client-visible): the review actions (QuoteNextStep, as
 * before) plus an approver's "Send back with N comments", the cost summary,
 * the Labor table, the Package checklist and the review Comments.
 */
export function ReviewSidebar({
  s,
  onActed,
  docs,
  packageBadge,
}: {
  s: EstimatorState;
  onActed: (a: NextStepAction) => void;
  docs: ReviewDocsResult | null;
  packageBadge: StepBadge;
}) {
  const { applySync, loadedId, pdfDirty, refreshReviewComments, saveNow, sections, setActionError, setGateRefused, statusChanging, t, tierResolving, next } = s;
  const sendBackHere = canSendBackFromReview(next);
  /* The panel's own "Send back…" is modal and typed-text only (it would drop the
     comments), so while this sidebar offers the comment-aware one, the panel doesn't. */
  const panelView = useMemo(() => (next && sendBackHere ? withoutSendBack(next) : next), [next, sendBackHere]);

  /* Keep the comments fresh: read on opening the step, and again (debounced) when the tab regains focus. */
  useEffect(() => {
    if (!loadedId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const kick = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refreshReviewComments(), 400);
    };
    kick();
    window.addEventListener("focus", kick);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", kick);
    };
  }, [loadedId, refreshReviewComments]);

  return (
    <aside
      aria-label="Review"
      className="est-scroll"
      style={{ width: 340, flexShrink: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 18, padding: 18, background: "#fff", borderLeft: "1px solid #ececf0" }}
    >
      {loadedId && next && panelView && (
        <QuoteNextStep
          quoteId={loadedId}
          view={panelView}
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
      {loadedId && sendBackHere && <SendBackWithComments s={s} onActed={onActed} />}
      <ReviewCostSummary sections={sections} totals={t} />
      <LaborTable s={s} />
      <PackageChecklist saved={!!loadedId} docs={docs} packageBadge={packageBadge} />
      <ReviewComments s={s} />
    </aside>
  );
}

/** The approver's send-back built from the open comments (sendBackNote) plus optional text. */
function SendBackWithComments({ s, onActed }: { s: EstimatorState; onActed: (a: NextStepAction) => void }) {
  const { applySync, loadedId, next, pdfDirty, reviewComments, sections, setActionError, setGateRefused, setReviewComments, statusChanging, tierResolving } = s;
  const [open, setOpen] = useState(false);
  const [extra, setExtra] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const openCount = numberComments(reviewComments, sections).length;
  const label = sendBackLabel(openCount);
  const canSubmit = sendBackEnabled(openCount, extra) && !busy && !statusChanging && !tierResolving && !pdfDirty;
  const saveFirst = pdfDirty ? COPY.sendBackSaveFirst : undefined;

  const submit = async () => {
    if (!loadedId || !next || !canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      /* The note follows the SAVED estimate's numbering: read the server's list first. */
      const fresh = await listReviewCommentsAction(loadedId);
      if (!fresh.ok) {
        setErr(fresh.error);
        return;
      }
      setReviewComments(fresh.comments);
      if (!sendBackEnabled(fresh.numbered.length, extra)) {
        setErr(COPY.sendBackNoComments);
        return;
      }
      const r = await nsSendBackAction(loadedId, sendBackNoteFromNumbered(fresh.numbered, extra), next.asOf);
      applySync(r);
      if (r.ok) {
        setActionError(null);
        setGateRefused(false);
        setOpen(false);
        setExtra("");
        onActed("sendBack");
      } else setErr(r.error || "Couldn't send it back — try again.");
    } catch {
      setErr("Couldn't send it back — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={statusChanging || tierResolving || pdfDirty}
          title={saveFirst}
          style={{ ...BTN, width: "100%", color: "#b4543a", background: "#fbeceb", cursor: pdfDirty ? "not-allowed" : "pointer", opacity: pdfDirty ? 0.6 : 1 }}
        >
          {label}
        </button>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 10, border: "1px solid #ecd2c9", borderRadius: 9, background: "#fdf8f6" }}>
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>{label}</div>
          <textarea
            aria-label={COPY.sendBackExtra}
            placeholder={COPY.sendBackExtra}
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            rows={3}
            disabled={busy}
            style={{ ...FIELD, resize: "vertical" }}
          />
          {err && <div style={{ ...SMALL, color: "#9b3a2a" }}>{err}</div>}
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" onClick={submit} disabled={!canSubmit} title={saveFirst} style={{ ...BTN, color: "#fff", background: canSubmit ? "#b4543a" : "#dba99b", cursor: canSubmit ? "pointer" : "not-allowed" }}>
              {COPY.sendBackConfirm}
            </button>
            <button type="button" onClick={() => setOpen(false)} disabled={busy} style={BTN}>
              {COPY.cancel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function LaborTable({ s }: { s: EstimatorState }) {
  const { rate, sections } = s;
  const sum = useMemo(() => laborSummary(sections, rate), [sections, rate]);
  const row = (g: LaborSummaryGroup) => (
    <tr key={g.id}>
      <td style={CELL}>
        {g.label}
        {g.edited && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 600, color: "#7a5a12", background: "#fdf6e7", borderRadius: 10, padding: "1px 6px" }}>{COPY.edited}</span>}
      </td>
      <td style={NUM}>{g.hours}</td>
      <td style={NUM}>{fmt(g.cost)}</td>
      <td style={NUM}>{fmt(g.sell)}</td>
    </tr>
  );
  const looseRow = (l: { hours: number; cost: number; sell: number }, key: string) => (
    <tr key={key}>
      <td style={CELL}>{COPY.looseLabor}</td>
      <td style={NUM}>{l.hours}</td>
      <td style={NUM}>{fmt(l.cost)}</td>
      <td style={NUM}>{fmt(l.sell)}</td>
    </tr>
  );
  const empty = sum.groups.length === 0 && !sum.loose && !sum.alternate;
  return (
    <div>
      <div style={TITLE}>{COPY.labor}</div>
      {empty ? (
        <div style={SMALL}>{COPY.noLabor}</div>
      ) : (
        <>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "#8c919c" }}>
                <th style={{ ...CELL, fontWeight: 500 }}>Group</th>
                <th style={{ ...NUM, fontWeight: 500 }}>Hours</th>
                <th style={{ ...NUM, fontWeight: 500 }}>Cost</th>
                <th style={{ ...NUM, fontWeight: 500 }}>Sell</th>
              </tr>
            </thead>
            <tbody>
              {sum.groups.map(row)}
              {sum.loose && looseRow(sum.loose, "loose")}
              <tr style={{ fontWeight: 600 }}>
                <td style={CELL}>{COPY.laborTotal}</td>
                <td style={NUM}>{sum.totals.hours}</td>
                <td style={NUM}>{fmt(sum.totals.cost)}</td>
                <td style={NUM}>{fmt(sum.totals.sell)}</td>
              </tr>
              {sum.alternate && (
                <>
                  <tr>
                    <td colSpan={4} style={{ ...CELL, paddingTop: 12, fontSize: 11, fontWeight: 600, color: "#8c919c", textTransform: "uppercase", letterSpacing: ".04em" }}>
                      {COPY.alternates}
                    </td>
                  </tr>
                  {sum.alternate.groups.map(row)}
                  {sum.alternate.loose && looseRow(sum.alternate.loose, "alt-loose")}
                </>
              )}
            </tbody>
          </table>
          <div style={{ ...SMALL, marginTop: 6 }}>{crewLine(sum.crew)}</div>
        </>
      )}
    </div>
  );
}

function PackageChecklist({ saved, docs, packageBadge }: { saved: boolean; docs: ReviewDocsResult | null; packageBadge: StepBadge }) {
  const gaps = docs && docs.ok ? docs.gaps : null;
  const rows = checklistRows(gaps, packageBadge);
  return (
    <div>
      <div style={TITLE}>{COPY.checklist}</div>
      {!saved ? (
        <div style={SMALL}>{COPY.saveFirst}</div>
      ) : (
        <>
          {!docs && <div style={SMALL}>{COPY.checklistLoading}</div>}
          {docs && !docs.ok && <div style={{ ...SMALL, color: "#9b3a2a" }}>{docs.error || COPY.docsError}</div>}
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            {rows.map((r) => (
              <li key={r.text} style={{ ...SMALL, color: r.ok ? "#1f7a52" : "#7a5a12" }}>
                {r.ok ? "✓ " : "• "}
                {r.text}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ReviewComments({ s }: { s: EstimatorState }) {
  const { loadedId, reviewComments, sections, setReviewComments, viewerName, viewerRoles } = s;
  const [target, setTarget] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const numbered = numberComments(reviewComments, sections);
  const resolved = reviewComments.filter((c) => c.resolvedAt != null);
  const mayAdd = canAddComment(viewerRoles);
  const targets = commentTargets(sections);

  const run = async (key: string, fn: () => Promise<ReviewCommentsResult>, after?: () => void) => {
    if (busy) return;
    setBusy(key);
    setErr(null);
    try {
      const r = await fn();
      if (r.ok) {
        setReviewComments(r.comments);
        after?.();
      } else setErr(r.error);
    } catch {
      setErr("Couldn't save that — try again.");
    } finally {
      setBusy(null);
    }
  };

  const add = () => {
    if (!loadedId || !body.trim()) return;
    void run("add", () => addReviewCommentAction(loadedId, target || null, body), () => setBody(""));
  };

  const actions = (c: ReviewComment, n: number | null) => (
    <span style={{ display: "inline-flex", gap: 10 }}>
      {canResolve(viewerRoles, c) && (
        <button type="button" onClick={() => loadedId && run("r:" + c.id, () => resolveReviewCommentAction(loadedId, c.id))} disabled={!!busy} aria-label={commentActionLabel("resolve", n)} style={LINK_BTN}>
          {COPY.resolve}
        </button>
      )}
      {canDelete(viewerRoles, c, viewerName) && (
        <button type="button" onClick={() => loadedId && run("d:" + c.id, () => deleteReviewCommentAction(loadedId, c.id))} disabled={!!busy} aria-label={commentActionLabel("delete", n)} style={{ ...LINK_BTN, color: "#9b3a2a" }}>
          {COPY.delete}
        </button>
      )}
    </span>
  );

  return (
    <div>
      <div style={TITLE}>{COPY.comments}</div>
      {!loadedId ? (
        <div style={SMALL}>{COPY.saveFirst}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {numbered.length === 0 ? (
            <div style={SMALL}>{COPY.noComments}</div>
          ) : (
            <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {numbered.map(({ n, comment, system }) => (
                <li key={comment.id} style={{ display: "flex", gap: 8 }}>
                  <span
                    aria-label={`Comment ${n}`}
                    style={{ flexShrink: 0, width: 20, height: 20, borderRadius: 10, background: "var(--accent)", color: "#fff", fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-mono)" }}
                  >
                    {n}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: "#5b616e" }}>{system}</div>
                    <div style={{ fontSize: 12.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{comment.body}</div>
                    <div style={{ ...SMALL, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
                      <span>
                        {comment.by} · {commentTime(comment.at)}
                      </span>
                      {actions(comment, n)}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {resolved.length > 0 && (
            <details>
              <summary style={{ ...SMALL, cursor: "pointer" }}>
                {COPY.resolved} ({resolved.length})
              </summary>
              <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                {resolved.map((c) => (
                  <li key={c.id} style={{ ...SMALL, color: "#8c919c" }}>
                    <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", textDecoration: "line-through" }}>{c.body}</div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <span>
                        {c.by} · {COPY.resolved.toLowerCase()} by {c.resolvedBy || "—"}
                        {c.resolvedAt ? ` · ${commentTime(c.resolvedAt)}` : ""}
                      </span>
                      {actions(c, null)}
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {mayAdd && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <select aria-label="Comment on" value={target} onChange={(e) => setTarget(e.target.value)} style={FIELD}>
                {targets.map((o) => (
                  <option key={o.value || "whole"} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <textarea
                aria-label="Comment"
                placeholder={COPY.commentPlaceholder}
                value={body}
                maxLength={COMMENT_BODY_MAX}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                disabled={busy === "add"}
                style={{ ...FIELD, resize: "vertical" }}
              />
              <div>
                <button type="button" onClick={add} disabled={!body.trim() || !!busy} style={{ ...BTN, cursor: !body.trim() || busy ? "not-allowed" : "pointer", opacity: !body.trim() || busy ? 0.6 : 1 }}>
                  {COPY.addComment}
                </button>
              </div>
            </div>
          )}
          {err && <div style={{ ...SMALL, color: "#9b3a2a" }}>{err}</div>}
        </div>
      )}
    </div>
  );
}
