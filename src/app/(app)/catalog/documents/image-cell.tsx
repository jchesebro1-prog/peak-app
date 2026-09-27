"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ImageSlotView } from "@/lib/part-docs/views";
import { docHref } from "./slot-cell";
import { uploadNewDocument } from "./upload-client";

/**
 * The Datasheets page's Image column (#242) — a thumbnail of the gallery's
 * lead image, the image count, and a drop zone that uploads straight into
 * the gallery (kind "image"). Ordering, hide/show and "from URL" live in the
 * part editor's fuller Images gallery (part-documents-section.tsx); this
 * cell is the to-do-list-sized view, same spirit as SlotCell.
 */

const link: React.CSSProperties = { border: "none", background: "none", padding: 0, color: "var(--accent)", fontWeight: 600, fontSize: 11.5, cursor: "pointer", fontFamily: "var(--font-ui)" };
const muted: React.CSSProperties = { fontSize: 11, color: "#8c919c" };

export default function ImageCell({
  sku,
  view,
  onUploaded,
}: {
  sku: string;
  view: ImageSlotView;
  /** Called after a NEW image lands. */
  onUploaded?: (sku: string, documentId: string, fileName: string) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const onFile = (file: File) => {
    setError(null);
    setBusy(true);
    startTransition(async () => {
      const r = await uploadNewDocument(file, "image", [sku]);
      setBusy(false);
      if (!r.ok) setError(r.error || "That didn't work.");
      else {
        onUploaded?.(sku, r.documentId, file.name);
        router.refresh();
      }
    });
  };

  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(false);
      const f = e.dataTransfer.files?.[0];
      if (f) onFile(f);
    },
  };

  return (
    <div {...dropProps} style={{ minWidth: 0, borderRadius: 8, outline: over ? "2px dashed var(--accent)" : "none", outlineOffset: 2, padding: 2 }}>
      <input
        ref={fileRef}
        type="file"
        accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
      />
      {busy ? (
        <span style={muted}>Uploading…</span>
      ) : view.first ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <a href={docHref(view.first.id)} target="_blank" rel="noopener noreferrer" title={view.first.title}>
            <img
              src={docHref(view.first.id)}
              alt={view.first.title}
              style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, border: "1px solid #e3e5ea", display: "block" }}
            />
          </a>
          <div style={{ display: "grid", gap: 2 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#3a3f4a" }}>{view.count} image{view.count === 1 ? "" : "s"}</span>
            <button type="button" style={link} onClick={() => fileRef.current?.click()}>+ Add</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => fileRef.current?.click()} style={{ border: "1px dashed #c9cdd5", borderRadius: 7, background: over ? "#f4f6fb" : "#fff", color: "#6b7079", fontSize: 11.5, padding: "5px 10px", cursor: "pointer" }}>
          Drop image or click
        </button>
      )}
      {error && <div role="alert" style={{ marginTop: 3, fontSize: 11, color: "#b4543a" }}>{error}</div>}
    </div>
  );
}
