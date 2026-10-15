"use client";

/* ============================================================
 * Earlier photos (#344 C5) — the survey's old inline photos (`draft.photos`,
 * up to 8 data URLs), read-only. New photos are taken per section
 * (section-photos.tsx); this grid shows only when a survey still has old
 * ones. Assessment findings that link old photo ids keep reading them.
 * ============================================================ */

import type { Draft } from "./types";

export interface PhotosProps {
  draft: Draft;
}

export function PhotosSection({ draft }: PhotosProps) {
  if (!draft.photos.length) return null;
  return (
    <>
      <div style={{ fontSize: 12, color: "#9aa0ab", marginBottom: 12 }}>Taken before photos moved into each section.</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(92px,1fr))", gap: 9 }}>
        {draft.photos.map((p) => (
          <div key={p.id} title={p.name} style={{ display: "block", height: 92, borderRadius: 10, overflow: "hidden", background: "#f1f2f5", border: "1px solid #e8eaee" }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- an inline data URL from the survey record */}
            <img src={p.dataUrl} alt={p.name || "site photo"} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          </div>
        ))}
      </div>
    </>
  );
}
