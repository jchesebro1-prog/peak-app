"use client";

/* Mark complete (#340 spec §2, Task 8). The server runs `evaluate` on the stored answers and lists every gap:
   required questions (by label), required photos (by label), open prompts (by text) — overridable with
   Complete anyway, and recorded for the report's follow-up list — plus photos still uploading, which hard-block
   (the override is disabled). A pending photo with no bytes queued on THIS device can't finish from here: the
   dialog offers Remove photo for it, the escape hatch that keeps a lost upload from blocking completion forever. */
import { useEffect, useState } from "react";
import { gapGroups } from "@/lib/assessments/editor-model";
import type { PhotoRef } from "@/lib/assessments/photos";
import type { CompleteReply } from "./actions";

export interface CompleteDialogProps {
  /** saves what's pending, then calls completeAssessmentAction(id, override) */
  run: (override: boolean) => Promise<CompleteReply>;
  /** pending photos with no bytes queued on this device (computed by the editor from the photo queue) */
  stuck: PhotoRef[];
  /** where a photo was taken ("Rigging — The access point"), for the stuck list */
  describe: (p: PhotoRef) => string;
  /** the signed-in user, and a user id → display name lookup, for "Taken by …" on a stuck photo */
  meId: string;
  nameOf: (userId: string) => string;
  /** removePendingPhotoAction + adopt its rev; resolves to an error message or null */
  onRemovePhoto: (photoId: string) => Promise<string | null>;
  onDone: () => void;
  onClose: () => void;
}

type Result = Extract<CompleteReply, { ok: false }>;

const takenAtLabel = (ms: number) => new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function CompleteDialog({ run, stuck, describe, meId, nameOf, onRemovePhoto, onDone, onClose }: CompleteDialogProps) {
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const attempt = async (override: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const r = await run(override);
      if (r.ok) { onDone(); return; }
      if (r.error) setError(r.error);
      setResult(r);
    } catch {
      setError("Mark complete needs a connection. Try again when you're online.");
    } finally {
      setBusy(false);
    }
  };

  // Opening the dialog is the first attempt (no override).
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await run(false);
        if (!alive) return;
        if (r.ok) { onDone(); return; }
        if (r.error) setError(r.error);
        setResult(r);
      } catch {
        if (alive) setError("Mark complete needs a connection. Try again when you're online.");
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opening
  }, []);

  const remove = async (pid: string) => {
    setRemoving(pid);
    const err = await onRemovePhoto(pid);
    setRemoving(null);
    if (err) setError(err);
    else await attempt(false);
  };

  const g = gapGroups(result?.gaps ?? []);
  const uploading = result?.uploading ?? 0;
  const anyGap = g.questions.length + g.photos.length + g.prompts.length + g.other.length > 0;
  const stuckIds = new Set(stuck.map((p) => p.id));

  return (
    <div className="as-sheet-back" style={{ justifyContent: "center", alignItems: "flex-start", paddingTop: "8vh" }} onClick={onClose}>
      <div className="pk-card" role="dialog" aria-modal="true" aria-label="Mark complete" style={{ width: "min(560px, calc(100vw - 32px))", maxHeight: "80vh", overflowY: "auto", padding: 18 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ fontSize: 17, fontWeight: 600 }}>Mark complete</div>
          <span style={{ flex: 1 }} />
          <button type="button" className="as-x" aria-label="Close" onClick={onClose}>×</button>
        </div>
        {busy && !result && <div style={{ fontSize: 13, color: "#8c919c", marginTop: 10 }}>Checking…</div>}
        {error && <div className="as-note" style={{ background: "#fbeeea", border: "1px solid #f0d6cd", color: "#8c3b26", marginTop: 10 }} role="alert">{error}</div>}

        {result && uploading > 0 && (
          <div className="as-note" style={{ background: "#fdf3e3", border: "1px solid #f1dcb6", color: "#7a4a0c", marginTop: 10 }}>
            <div style={{ fontWeight: 600 }}>{uploading} photo{uploading === 1 ? "" : "s"} still uploading</div>
            <div>The assessment can&apos;t be completed until {uploading === 1 ? "it finishes" : "they finish"}.</div>
            {stuck.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {stuck.map((p) => (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "4px 0", borderTop: "1px solid #f1dcb6" }}>
                    <span style={{ flex: "1 1 220px" }}>
                      {describe(p)}: This photo never finished uploading from any device — remove it to continue
                      <span className="as-mono-sm" style={{ display: "block", marginTop: 2 }}>Taken by {nameOf(p.by)} at {takenAtLabel(p.takenAt)}</span>
                      {p.by !== meId && <span style={{ display: "block", marginTop: 2, fontWeight: 600 }}>Someone else took this photo — it may still be uploading from their device.</span>}
                    </span>
                    <button type="button" className="pk-btn-outline" disabled={!!removing || busy} onClick={() => void remove(p.id)}>
                      {removing === p.id ? "Removing…" : "Remove photo"}
                    </button>
                  </div>
                ))}
              </div>
            )}
            {stuck.length === 0 && <div className="as-mono-sm" style={{ marginTop: 4 }}>Keep this page open while they upload, then try again.</div>}
          </div>
        )}

        {result && anyGap && (
          <div style={{ marginTop: 10, fontSize: 13 }}>
            <div style={{ fontWeight: 600 }}>Still open</div>
            {g.questions.length > 0 && <GapList title="Questions" items={g.questions} />}
            {g.photos.length > 0 && <GapList title="Photos" items={g.photos} />}
            {g.prompts.length > 0 && <GapList title="Suggested findings" items={g.prompts} />}
            {g.other.length > 0 && <GapList title="Other" items={g.other} />}
            <div className="as-mono-sm" style={{ marginTop: 6 }}>Completing anyway records these in the report&apos;s follow-up list.</div>
          </div>
        )}

        {result && !anyGap && uploading === 0 && !error && <div style={{ fontSize: 13, marginTop: 10 }}>Nothing is open.</div>}

        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          {result && anyGap && (
            <button
              type="button"
              className="pk-btn-accent"
              disabled={busy || uploading > 0}
              title={uploading > 0 ? "Wait for the photos to finish uploading" : undefined}
              onClick={() => void attempt(true)}
            >
              Complete anyway
            </button>
          )}
          {result && (!anyGap || stuckIds.size > 0) && (
            <button type="button" className="pk-btn-outline" disabled={busy} onClick={() => void attempt(false)}>Try again</button>
          )}
          <button type="button" className="pk-btn-outline" onClick={onClose}>Keep working</button>
        </div>
      </div>
    </div>
  );
}

function GapList({ title, items }: { title: string; items: string[] }) {
  return (
    <div style={{ marginTop: 6 }}>
      <div className="as-mono-sm">{title}</div>
      <ul style={{ margin: "2px 0 0 18px", padding: 0 }}>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
}
