"use client";

/* ============================================================
 * Photo grid. Lifted out of controls.tsx verbatim — the file-input handler
 * and the remover stay in the editor and arrive as props.
 * ============================================================ */

import type { ChangeEvent } from "react";
import type { Draft } from "./types";
import { ACCENT_BORDER_LT, ACCENT_INK, ACCENT_SOFT } from "./styles";

export interface PhotosProps {
  draft: Draft;
  onPhotos: (e: ChangeEvent<HTMLInputElement>) => void;
  removePhoto: (id: string) => void;
}

export function PhotosSection({ draft, onPhotos, removePhoto }: PhotosProps) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: "#9aa0ab" }}>{draft.photos.length} of 8</span>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 600, color: ACCENT_INK, background: ACCENT_SOFT, border: `1px solid ${ACCENT_BORDER_LT}`, borderRadius: 9, padding: "9px 13px", cursor: "pointer", minHeight: 40 }}>
          Add photo
          <input type="file" accept="image/*" capture="environment" multiple onChange={onPhotos} style={{ display: "none" }} />
        </label>
      </div>
      {draft.photos.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(92px,1fr))", gap: 9 }}>
          {draft.photos.map((p) => (
            <div key={p.id} style={{ position: "relative", height: 92, borderRadius: 10, overflow: "hidden", background: "#f1f2f5", border: "1px solid #e8eaee" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.dataUrl} alt="site photo" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              <button onClick={() => removePhoto(p.id)} aria-label="Remove photo" style={{ position: "absolute", top: 5, right: 5, width: 26, height: 26, borderRadius: "50%", background: "rgba(16,18,22,.62)", color: "#fff", border: "none", cursor: "pointer", fontSize: 14, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ border: "1.5px dashed #dfe2e8", borderRadius: 11, padding: 20, textAlign: "center", fontSize: 12.5, color: "#aab0bb" }}>
          No photos yet — tap <b style={{ fontWeight: 600, color: "#8c919c" }}>Add photo</b> to capture the site.
        </div>
      )}
    </>
  );
}
