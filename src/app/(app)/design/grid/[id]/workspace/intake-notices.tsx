"use client";

import { useRef, useState, useTransition } from "react";
import { newPlanUploadId, planFileProblem } from "@/lib/design/grid-plan-upload";
import { GRID_SHEET_ACCEPT, GRID_SHEET_DIRECT_MAX_LABEL } from "@/lib/design/grid-sheet-upload";
import { uploadGridSheet } from "../sheet-upload";
import { uploadNote } from "@/lib/design/grid-sheet-split";
import { GRID_SHEET_MAX_LABEL } from "@/lib/grid-sheet-file";
import { dismissGridNoticeAction, retryGridNoticeAction } from "../actions";
import type { GridEditor } from "../use-grid-editor";

/**
 * #314 review — what the intake save left for the editor: a plan view that
 * didn't land (copy or upload) and #211's Auto fill warnings. The intake's
 * save re-renders straight into the editor, so these are stored on the
 * project and shown here until Retry succeeds or they are dismissed.
 * Retry: a copy re-runs on the server (a no-op if it already landed); an
 * upload asks for the file again (a dropped File doesn't survive the swap).
 */

const BTN: React.CSSProperties = {
  border: "1px solid #e6cf9f",
  background: "#fff",
  borderRadius: 6,
  padding: "1px 8px",
  fontFamily: "inherit",
  fontSize: 11.5,
  fontWeight: 600,
  color: "#7a5a1c",
  cursor: "pointer",
};

export default function IntakeNotices({ ed }: { ed: GridEditor }) {
  const { intakeNotices, project, router, blobUploads, openAdjust, noteAction } = ed;
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const fileFor = useRef<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  if (!intakeNotices.length) return null;

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    start(async () => {
      setErr(null);
      let r: { ok: true } | { ok: false; error: string };
      try {
        r = await fn();
      } catch {
        r = { ok: false, error: "That didn't save — check your connection and try again." };
      }
      if (!r.ok) setErr(r.error);
      router.refresh();
    });

  const pickFile = (file: File | undefined) => {
    const noticeId = fileFor.current;
    fileFor.current = null;
    if (!file || !noticeId) return;
    const problem = planFileProblem(file, blobUploads);
    if (problem) return setErr(problem);
    run(async () => {
      const up = await uploadGridSheet(project.id, file, { blobUploads, planUploadId: newPlanUploadId() });
      if (!up.ok) return up;
      // #319: the kept sentence and split note land as intake notices (D698) — not twice.
      noteAction(uploadNote(file.name, up, { intakeNotices: true }));
      openAdjust(up.sheetId, true, up.sheetIds);
      return dismissGridNoticeAction(project.id, noticeId);
    });
  };

  return (
    <div data-testid="intake-notices" role="alert" style={{ display: "flex", flexDirection: "column", gap: 4, padding: "6px 10px", background: "#fdf4e7", borderBottom: "1px solid #f0dcbb", fontSize: 11.5, color: "#7a5a1c" }}>
      {intakeNotices.map((n) => (
        <div key={n.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ flex: "1 1 300px", minWidth: 0, lineHeight: 1.45 }}>{n.message}</span>
          {n.retry?.kind === "copy" && (
            <button type="button" disabled={pending} onClick={() => run(() => retryGridNoticeAction(project.id, n.id))} style={BTN}>
              {pending ? "Retrying…" : "Retry the plan view"}
            </button>
          )}
          {n.retry?.kind === "upload" && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                fileFor.current = n.id;
                input.current?.click();
              }}
              title={`Choose the plan again — PDF or image, up to ${blobUploads ? GRID_SHEET_DIRECT_MAX_LABEL : GRID_SHEET_MAX_LABEL}`}
              style={BTN}
            >
              {pending ? "Uploading…" : "Choose the plan again…"}
            </button>
          )}
          <button type="button" disabled={pending} onClick={() => run(() => dismissGridNoticeAction(project.id, n.id))} style={{ ...BTN, border: "none", background: "none" }}>
            Dismiss
          </button>
        </div>
      ))}
      {err && <span style={{ color: "#a0442b", fontWeight: 600 }}>{err}</span>}
      <input
        ref={input}
        type="file"
        accept={GRID_SHEET_ACCEPT}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          pickFile(f);
        }}
      />
    </div>
  );
}
