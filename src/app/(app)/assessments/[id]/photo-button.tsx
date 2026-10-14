"use client";

/* Assessment photos in the editor (#340, Task 8): the camera button (one per question, one per required-photo slot,
   one in the finding sheet), a module's photo slots, thumbnails that show the device copy while a photo is still
   uploading, and the list of photos the queue gave up on. The capture itself (resize → pending ref → save →
   queue) lives in the editor, which owns the record; these components only collect the file and show state. */
import { useRef, useState } from "react";
import type { PhotoReq } from "@/lib/assessments/defs/types";
import type { PhotoRef } from "@/lib/assessments/photos";

export const PHOTO_CSS = `
  .as-cam { display: inline-flex; align-items: center; gap: 5px; font: inherit; font-size: 12px; color: #5b616e; background: #fff; border: 1px solid #d6d9e0; border-radius: 7px; padding: 4px 9px; cursor: pointer; min-height: 30px; white-space: nowrap; }
  .as-cam:hover { border-color: #b9bec8; color: #24272e; }
  .as-cam[aria-disabled="true"] { opacity: .5; cursor: default; }
  .as-cam svg { width: 15px; height: 15px; }
  .as-thumb { position: relative; display: block; }
  .as-thumb-tag { position: absolute; left: 3px; bottom: 3px; font-size: 9.5px; font-weight: 600; background: rgba(22,24,27,.72); color: #fff; border-radius: 4px; padding: 1px 4px; }
  .as-slots { display: grid; gap: 8px; margin-top: 10px; }
  .as-slot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 12.5px; color: #3a3f4a; border: 1px dashed #d6d9e0; border-radius: 8px; padding: 7px 10px; }
  .as-slot.missing { border-color: #e7c48e; background: #fffaf0; }
  .as-slot .as-thumbs { margin-top: 0; }
  .as-failed { border: 1px solid #f0d6cd; background: #fbeeea; color: #8c3b26; border-radius: 8px; padding: 9px 12px; margin-bottom: 10px; font-size: 12.5px; }
  .as-failed-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 4px 0; border-top: 1px solid #f0d6cd; }
  .as-failed-row:first-of-type { border-top: 0; }
`;

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

/** The camera button: `<input type=file accept=image/* capture=environment>` (camera on a phone, file picker on a
 *  desktop). `onFile` does the rest; the button stays busy until it settles. */
export function PhotoButton({ label = "Photo", disabled, onFile, title }: { label?: string; disabled?: boolean; onFile: (f: File) => Promise<unknown>; title?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const off = disabled || busy;
  return (
    <label className="as-cam" aria-disabled={off} title={title ?? "Take or choose a photo"}>
      <CameraIcon />
      {busy ? "Adding…" : label}
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        disabled={off}
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = ""; // the same file can be picked again
          if (!f) return;
          setBusy(true);
          void onFile(f).finally(() => setBusy(false));
        }}
      />
    </label>
  );
}

const photoUrl = (assessmentId: string, photoId: string) => `/api/assessments/${encodeURIComponent(assessmentId)}/photos/${encodeURIComponent(photoId)}`;

/** Thumbnails: the server's file once uploaded; while pending, the device copy (a local object URL) when this device
 *  took it, else an "Uploading" tile. Optional selection (the finding sheet's photo picker). */
export function PhotoThumbs({
  photos,
  assessmentId,
  localUrls,
  selected,
  onToggle,
}: {
  photos: PhotoRef[];
  assessmentId: string;
  localUrls: Record<string, string>;
  selected?: string[];
  onToggle?: (id: string) => void;
}) {
  if (!photos.length) return null;
  return (
    <div className="as-thumbs">
      {photos.map((p) => {
        const done = !!(p.blobPath || p.inline);
        const src = done ? photoUrl(assessmentId, p.id) : localUrls[p.id];
        const on = selected?.includes(p.id);
        const img = src ? (
          // eslint-disable-next-line @next/next/no-img-element -- a private, session-gated route or a local object URL; next/image can't proxy either
          <img src={src} alt={p.caption ?? "Assessment photo"} loading="lazy" style={on ? { outline: "3px solid var(--accent)", outlineOffset: 1 } : undefined} />
        ) : (
          <span className="as-thumb-pending" style={on ? { outline: "3px solid var(--accent)", outlineOffset: 1 } : undefined}>Uploading</span>
        );
        if (onToggle) {
          return (
            <button key={p.id} type="button" className="as-thumb" aria-pressed={!!on} title={on ? "Linked — click to unlink" : "Click to link"} onClick={() => onToggle(p.id)} style={{ border: 0, padding: 0, background: "none", cursor: "pointer" }}>
              {img}
              {!done && src && <span className="as-thumb-tag">Uploading</span>}
            </button>
          );
        }
        return done ? (
          <a key={p.id} className="as-thumb" href={photoUrl(assessmentId, p.id)} target="_blank" rel="noreferrer" title={p.caption ?? p.id}>{img}</a>
        ) : (
          <span key={p.id} className="as-thumb" title="Still uploading">
            {img}
            {src && <span className="as-thumb-tag">Uploading</span>}
          </span>
        );
      })}
    </div>
  );
}

/** A module's photo slots (its PhotoReqs): label, what's been taken for it, and a camera button. A required slot
 *  with nothing taken yet is highlighted (it is a Mark-complete gap). */
export function PhotoSlots({
  reqs,
  photos,
  missing,
  assessmentId,
  localUrls,
  disabled,
  onFile,
}: {
  reqs: PhotoReq[];
  photos: PhotoRef[];
  missing: string[];
  assessmentId: string;
  localUrls: Record<string, string>;
  disabled: boolean;
  onFile: (req: PhotoReq, f: File) => Promise<unknown>;
}) {
  if (!reqs.length) return null;
  return (
    <div className="as-slots">
      {reqs.map((r) => {
        const taken = photos.filter((p) => p.reqId === r.id);
        return (
          <div key={r.id} className={`as-slot${missing.includes(r.id) ? " missing" : ""}`}>
            <span style={{ flex: "1 1 180px" }}>
              {r.label}
              {r.optional ? <span className="as-mono-sm"> · optional</span> : missing.includes(r.id) ? <span className="as-req"> · needed</span> : null}
            </span>
            <PhotoThumbs photos={taken} assessmentId={assessmentId} localUrls={localUrls} />
            {!disabled && <PhotoButton onFile={(f) => onFile(r, f)} />}
          </div>
        );
      })}
    </div>
  );
}

export interface FailedPhotoRow { photoId: string; lastError: string; label: string }

/** "Photos that couldn't upload": the queue gave up on these (their bytes are still on this device). Retry starts
 *  over; Discard drops the device copy and removes the pending ref from the record. */
export function FailedPhotos({
  rows,
  busy,
  note,
  onRetry,
  onDiscard,
}: {
  rows: FailedPhotoRow[];
  busy: string | null;
  note: string | null;
  onRetry: (photoId: string) => void;
  onDiscard: (photoId: string) => void;
}) {
  if (!rows.length && !note) return null;
  return (
    <div className="as-failed" role="status">
      {rows.length > 0 && <div style={{ fontWeight: 600, marginBottom: 4 }}>Photos that couldn&apos;t upload</div>}
      {rows.map((r) => (
        <div key={r.photoId} className="as-failed-row">
          <span style={{ flex: "1 1 220px" }}>
            {r.label}: <span style={{ color: "#5b616e" }}>{r.lastError}</span>
          </span>
          <button type="button" className="pk-btn-outline" disabled={busy === r.photoId} onClick={() => onRetry(r.photoId)}>Retry</button>
          <button type="button" className="pk-btn-outline" disabled={busy === r.photoId} onClick={() => onDiscard(r.photoId)}>Discard</button>
        </div>
      ))}
      {note && <div style={{ marginTop: rows.length ? 6 : 0 }}>{note}</div>}
    </div>
  );
}
