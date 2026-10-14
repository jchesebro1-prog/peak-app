"use client";

/* The assessment editor's banners (#337, Task 7):
   - red: a save the server refused (naming the question), and outbox entries the sync push refused;
   - amber: scalar edits an online save dropped because the copy was stale;
   - yellow: `syncRejects` — what an offline push couldn't apply, with Re-enter / Use mine / Dismiss. */
import type { AssessmentDef } from "@/lib/assessments/defs/types";
import {
  FIELD_LABELS,
  formatRejectPayload,
  reenterAnswer,
  rejectLabel,
  type PicklistExtrasVM,
  type SyncRejectVM,
} from "@/lib/assessments/editor-model";

const box = (bg: string, bd: string, ink: string): React.CSSProperties => ({
  background: bg, border: `1px solid ${bd}`, color: ink, borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 10,
});
const RED = box("#fbeeea", "#f0d6cd", "#8c3b26");
const AMBER = box("#fdf3e3", "#f1dcb6", "#7a4a0c");
const YELLOW = box("#fffbe6", "#efe2a2", "#5f5310");

export interface Refusal { key?: string; label?: string; error: string }
export interface OutboxError { what: string; error: string }

export default function SyncBanners({
  def, extras, refusal, onGoTo, dropped, onDismissDropped, rejects, onReenter, onUseMine, onDismiss, outboxErrors, busy,
}: {
  def: AssessmentDef;
  extras: PicklistExtrasVM;
  refusal: Refusal | null;
  onGoTo: (key: string) => void;
  dropped: string[];
  onDismissDropped: () => void;
  rejects: SyncRejectVM[];
  onReenter: (r: SyncRejectVM) => void;
  onUseMine: (r: SyncRejectVM) => void;
  onDismiss: (keys: string[]) => void;
  outboxErrors: OutboxError[];
  busy: boolean;
}) {
  const fieldRejects = rejects.filter((r) => r.key.startsWith("field:"));
  const otherRejects = rejects.filter((r) => !r.key.startsWith("field:"));
  return (
    <div aria-live="polite">
      {refusal && (
        <div role="alert" style={RED}>
          <b>Not saved.</b>{" "}
          {refusal.label ? (
            <>
              <button type="button" className="as-linkbtn" onClick={() => onGoTo(refusal.key!)}>{refusal.label}</button>{" "}
              <span className="as-mono-sm">({refusal.key})</span>: {refusal.error}
            </>
          ) : (
            refusal.error
          )}
        </div>
      )}

      {outboxErrors.map((e, i) => (
        <div key={i} role="alert" style={{ ...RED, padding: "7px 14px" }}>
          Couldn&apos;t sync {e.what}: {e.error}
        </div>
      ))}

      {dropped.length > 0 && (
        <div style={AMBER}>
          {dropped.map((f) => (
            <div key={f}>Your change to {(FIELD_LABELS[f] ?? f).toLowerCase()} wasn&apos;t saved because someone else changed it — reload.</div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="button" className="pk-btn-outline" onClick={() => window.location.reload()}>Reload</button>
            <button type="button" className="pk-btn-outline" onClick={onDismissDropped}>Dismiss</button>
          </div>
        </div>
      )}

      {fieldRejects.map((r) => {
        const yours = formatRejectPayload(r.key, r.payload, def, extras);
        const field = (FIELD_LABELS[r.key.slice(6)] ?? r.key.slice(6)).toLowerCase();
        return (
          <div key={r.key} style={YELLOW}>
            <div>
              Kept the other device&apos;s value for {field}
              {r.payload !== undefined ? <> — yours was: <b>{yours}</b></> : null}
            </div>
            {r.error && <div className="as-mono-sm" style={{ marginTop: 2 }}>{r.error}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              {r.payload !== undefined && ["scopes", "spaceLabel", "accompanying"].includes(r.key.slice(6)) && (
                <button type="button" className="pk-btn-outline" disabled={busy} onClick={() => onUseMine(r)}>Use mine</button>
              )}
              <button type="button" className="pk-btn-outline" disabled={busy} onClick={() => onDismiss([r.key])}>Dismiss</button>
            </div>
          </div>
        );
      })}

      {otherRejects.length > 0 && (
        <div style={YELLOW}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Some changes from this device couldn&apos;t be saved</div>
          {otherRejects.map((r) => {
            const canReenter = !r.key.startsWith("photo:") && !r.key.startsWith("prompt:") && reenterAnswer(r.payload, "x", 0) !== null;
            const yours = formatRejectPayload(r.key, r.payload, def, extras);
            return (
              <div key={`${r.key}:${r.at}`} style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", padding: "4px 0", borderTop: "1px solid #f3eac0" }}>
                <span style={{ flex: "1 1 240px", minWidth: 0 }}>
                  <b>{rejectLabel(r.key, def)}</b> — {r.error}
                  {yours ? <span className="as-mono-sm"> (yours: {yours})</span> : null}
                </span>
                {canReenter && <button type="button" className="pk-btn-outline" disabled={busy} onClick={() => onReenter(r)}>Re-enter</button>}
              </div>
            );
          })}
          <div style={{ marginTop: 8 }}>
            <button type="button" className="pk-btn-outline" disabled={busy} onClick={() => onDismiss(otherRejects.map((r) => r.key))}>Dismiss</button>
          </div>
        </div>
      )}
    </div>
  );
}
