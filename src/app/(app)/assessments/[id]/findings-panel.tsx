"use client";

/* The editor's findings (#337 spec §3, Task 8): the prompt chip that turns a rule's suggestion into a finding, and
   the panel listing this assessment's findings with Edit, Merge and Split (until the assessment is completed).
   Merge keeps the first selected finding (list order) and voids the others "Merged into <printedId>"; Split moves the
   chosen photos and questions to a new finding. Both are online-only server actions (the kept finding needs its
   number); the editor runs them and adopts what comes back. */
import { useState } from "react";
import type { PendingPrompt } from "@/lib/assessments/evaluate";
import type { AssessmentDef } from "@/lib/assessments/defs/types";
import { pendingPrintedLabel } from "@/lib/assessments/findings-model";
import type { FindingVM } from "@/lib/assessments/editor-model";
import { RATING_LABELS } from "./finding-sheet";

export const FINDINGS_CSS = `
  .as-prompt { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12.5px; border-radius: 8px; padding: 7px 11px; margin-top: 8px; }
  .as-prompt-imm { background: #fbeeea; border: 1px solid #f0d6cd; color: #8c3b26; }
  .as-prompt-needs { background: #fdf3e3; border: 1px solid #f1dcb6; color: #7a4a0c; }
  .as-prompt-good { background: #eef6f0; border: 1px solid #cbe6d2; color: #2f6b3d; }
  .as-fpanel { padding: 14px 16px; margin-bottom: 14px; }
  .as-frow { display: flex; align-items: flex-start; gap: 10px; padding: 8px 0; border-top: 1px solid #f2f3f6; font-size: 13px; }
  .as-frow:first-of-type { border-top: 0; }
  .as-rate { font-size: 10.5px; font-weight: 600; border-radius: 20px; padding: 2px 8px; white-space: nowrap; }
  .as-rate-immediate { color: #8c3b26; background: #fbeeea; border: 1px solid #f0d6cd; }
  .as-rate-needs { color: #7a4a0c; background: #fdf3e3; border: 1px solid #f1dcb6; }
  .as-rate-good { color: #2f6b3d; background: #e9f5ec; border: 1px solid #cbe6d2; }
  .as-split { background: #f6f7f9; border-radius: 8px; padding: 8px 10px; margin-top: 6px; font-size: 12.5px; }
`;

/** "⚑ <text> · Create finding / Dismiss" — under the question that raised it. */
export function PromptChip({ prompt, disabled, onCreate, onDismiss }: { prompt: PendingPrompt; disabled: boolean; onCreate: () => void; onDismiss: () => void }) {
  const cls = prompt.rating === "immediate" ? "as-prompt-imm" : prompt.rating === "needs" ? "as-prompt-needs" : "as-prompt-good";
  return (
    <div className={`as-prompt ${cls}`} role="note">
      <span style={{ flex: "1 1 220px" }}>
        <span aria-hidden="true">⚑ </span>
        {prompt.text}
        <span className="as-mono-sm"> · {prompt.category} · {RATING_LABELS[prompt.rating]}</span>
      </span>
      {!disabled && (
        <span style={{ whiteSpace: "nowrap" }}>
          <button type="button" className="as-linkbtn" onClick={onCreate}>Create finding</button>
          <span aria-hidden="true"> / </span>
          <button type="button" className="as-linkbtn" style={{ fontWeight: 400 }} onClick={onDismiss}>Dismiss</button>
        </span>
      )}
    </div>
  );
}

export interface FindingsPanelProps {
  findings: FindingVM[];
  /** keys the server has (merge / split work only on those) */
  serverKeys: Set<string>;
  def: AssessmentDef;
  codes: { company: string | null; site: string | null };
  disabled: boolean;
  onNew: () => void;
  onEdit: (f: FindingVM) => void;
  /** resolve to an error message, or null when done */
  onMerge: (keys: string[]) => Promise<string | null>;
  onSplit: (f: FindingVM, move: { photoIds: string[]; questionKeys: string[] }) => Promise<string | null>;
}

export default function FindingsPanel({ findings, serverKeys, def, codes, disabled, onNew, onEdit, onMerge, onSplit }: FindingsPanelProps) {
  const live = findings.filter((f) => !f.voided);
  const voided = findings.filter((f) => f.voided);
  const [picked, setPicked] = useState<string[]>([]);
  const [splitting, setSplitting] = useState<string | null>(null);
  const [move, setMove] = useState<{ photoIds: string[]; questionKeys: string[] }>({ photoIds: [], questionKeys: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labels = new Map(def.scopes.flatMap((s) => s.modules.flatMap((m) => m.questions.map((q) => [q.key, q.label] as const))));
  const idOf = (f: FindingVM) => f.printedId ?? pendingPrintedLabel(f.companyCode ?? codes.company, f.siteCode ?? codes.site, f.category);
  // Merge keeps the first in list order.
  const chosen = live.filter((f) => picked.includes(f.key));
  const keep = chosen[0];

  const run = async (p: Promise<string | null>, after: () => void) => {
    setBusy(true);
    setError(null);
    const err = await p;
    setBusy(false);
    if (err) setError(err);
    else after();
  };

  return (
    <section className="pk-card as-fpanel" aria-label="Findings">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div className="as-module-title" style={{ margin: 0 }}>Findings ({live.length})</div>
        <span style={{ flex: 1 }} />
        {!disabled && chosen.length >= 2 && (
          <button
            type="button"
            className="pk-btn-outline"
            disabled={busy}
            title={keep ? `Keeps ${idOf(keep)}; the others are voided "Merged into ${idOf(keep)}"` : undefined}
            onClick={() => {
              if (!window.confirm(`Merge ${chosen.length} findings into ${idOf(keep!)}? The others are voided "Merged into ${idOf(keep!)}" and keep their numbers.`)) return;
              void run(onMerge(chosen.map((f) => f.key)), () => setPicked([]));
            }}
          >
            Merge {chosen.length} into {idOf(keep!)}
          </button>
        )}
        {!disabled && <button type="button" className="pk-btn-outline" onClick={onNew}>+ Finding</button>}
      </div>
      {error && <div className="as-note" style={{ background: "#fbeeea", border: "1px solid #f0d6cd", color: "#8c3b26", marginTop: 8 }} role="alert">{error}</div>}
      {live.length === 0 && <div style={{ fontSize: 12.5, color: "#8c919c", marginTop: 6 }}>No findings yet. Create one from a suggestion chip, a question&apos;s ⋯ menu, or + Finding.</div>}
      <div style={{ marginTop: 6 }}>
        {live.map((f) => {
          const onServer = serverKeys.has(f.key);
          return (
            <div key={f.key} className="as-frow">
              {!disabled && (
                <input
                  type="checkbox"
                  aria-label={`Select ${idOf(f)} to merge`}
                  disabled={!onServer || busy}
                  title={onServer ? undefined : "Merge needs the finding on the server first"}
                  checked={picked.includes(f.key)}
                  onChange={(e) => setPicked((p) => (e.target.checked ? [...p, f.key] : p.filter((k) => k !== f.key)))}
                  style={{ marginTop: 3 }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }} title={f.printedId ? undefined : "Numbered when it reaches the server"}>{idOf(f)}</span>
                  <span className={`as-rate as-rate-${f.rating}`}>{RATING_LABELS[f.rating]}</span>
                  {f.photoIds.length > 0 && <span className="as-mono-sm">{f.photoIds.length} photo{f.photoIds.length === 1 ? "" : "s"}</span>}
                  {!onServer && <span className="as-mono-sm">not synced yet</span>}
                </div>
                <div style={{ color: "#3a3f4a", marginTop: 2, whiteSpace: "pre-line", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{f.description}</div>
                {splitting === f.key && (
                  <div className="as-split">
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Move to a new finding:</div>
                    {f.questionKeys.map((k) => (
                      <label key={k} style={{ display: "block" }}>
                        <input type="checkbox" checked={move.questionKeys.includes(k)} onChange={(e) => setMove((m) => ({ ...m, questionKeys: e.target.checked ? [...m.questionKeys, k] : m.questionKeys.filter((x) => x !== k) }))} /> {labels.get(k) ?? k}
                      </label>
                    ))}
                    {f.photoIds.map((p, i) => (
                      <label key={p} style={{ display: "block" }}>
                        <input type="checkbox" checked={move.photoIds.includes(p)} onChange={(e) => setMove((m) => ({ ...m, photoIds: e.target.checked ? [...m.photoIds, p] : m.photoIds.filter((x) => x !== p) }))} /> Photo {i + 1}
                      </label>
                    ))}
                    {!f.questionKeys.length && !f.photoIds.length && <div>This finding has no photos or questions to move.</div>}
                    <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                      <button type="button" className="pk-btn-accent" style={{ padding: "6px 12px" }} disabled={busy || (!move.photoIds.length && !move.questionKeys.length)} onClick={() => void run(onSplit(f, move), () => setSplitting(null))}>Split</button>
                      <button type="button" className="pk-btn-outline" onClick={() => setSplitting(null)}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="pk-btn-outline" onClick={() => onEdit(f)}>{disabled ? "View" : "Edit"}</button>
                {!disabled && onServer && splitting !== f.key && (
                  <button type="button" className="pk-btn-outline" disabled={busy} onClick={() => { setSplitting(f.key); setMove({ photoIds: [], questionKeys: [] }); }}>Split</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {voided.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ fontSize: 12.5, color: "#8c919c", cursor: "pointer" }}>Voided ({voided.length})</summary>
          {voided.map((f) => (
            <div key={f.key} className="as-frow" style={{ color: "#8c919c" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, textDecoration: "line-through" }}>{idOf(f)}</span>
              <span>{f.voidReason ?? "Voided"}</span>
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
