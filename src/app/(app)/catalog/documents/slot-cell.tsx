"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import { acceptFor } from "@/lib/part-docs/files";
import { coveredLabel } from "@/lib/part-docs/coverage";
import type { SlotView } from "@/lib/part-docs/views";
import type { PartDocKind } from "@/lib/part-docs/types";
import { detachDocumentAction, fetchLinksAction, setNotNeededAction } from "./actions";
import { uploadNewDocument, uploadReplacement } from "./upload-client";

/**
 * One document slot (#207, spec §3) — shared by the Datasheets to-do list and
 * the part editor. Shows one of: ✓ file (view · replace · detach), Covered on
 * N fixture datasheets, Link only (Fetch), Not needed, or an empty drop zone.
 * A file dropped on ANY state becomes the part's own document.
 */

const link: React.CSSProperties = { border: "none", background: "none", padding: 0, color: "var(--accent)", fontWeight: 600, fontSize: 11.5, cursor: "pointer", fontFamily: "var(--font-ui)" };
const muted: React.CSSProperties = { fontSize: 11, color: "#8c919c" };

export function docHref(id: string): string {
  return `/api/part-documents/${encodeURIComponent(id)}`;
}

export default function SlotCell({
  sku,
  kind,
  view,
  onUploaded,
}: {
  sku: string;
  kind: PartDocKind;
  view: SlotView;
  /** Called after a NEW document lands (the "Also covers…" step). */
  onUploaded?: (sku: string, documentId: string, fileName: string) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const replaceFor = useRef<string | null>(null);

  const run = (label: string, fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => {
    setError(null);
    setBusy(label);
    startTransition(async () => {
      const r = await fn();
      setBusy(null);
      if (!r.ok) setError(r.error || "That didn't work.");
      else {
        after?.();
        router.refresh();
      }
    });
  };

  const onFile = (file: File) => {
    const target = replaceFor.current;
    replaceFor.current = null;
    if (target) {
      run("Replacing…", () => uploadReplacement(file, target, kind));
      return;
    }
    let newId = "";
    run(
      "Uploading…",
      async () => {
        const r = await uploadNewDocument(file, kind, [sku]);
        if (r.ok) newId = r.documentId;
        return r;
      },
      () => newId && onUploaded?.(sku, newId, file.name)
    );
  };

  const pick = (documentId: string | null) => {
    replaceFor.current = documentId;
    fileRef.current?.click();
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

  const body = (() => {
    switch (view.state) {
      case "own":
        return (
          <div style={{ display: "grid", gap: 3 }}>
            {view.docs.map((d) => (
              <div key={d.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <a href={docHref(d.id)} target="_blank" rel="noopener noreferrer" title={d.fileName} style={{ fontSize: 12, color: "#1f7a52", fontWeight: 600, textDecoration: "none", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  ✓ {d.title}
                </a>
                <button type="button" style={link} disabled={!!busy} onClick={() => pick(d.id)}>
                  Replace
                </button>
                <ConfirmButton
                  label="Detach"
                  confirmLabel="Detach from this part?"
                  pendingLabel="Detaching…"
                  className="pk-btn-outline"
                  style={{ fontSize: 11, padding: "2px 8px" }}
                  onConfirm={async () => {
                    const r = await detachDocumentAction(d.id, sku);
                    if (!r.ok) throw new Error(r.error);
                    router.refresh();
                  }}
                />
              </div>
            ))}
          </div>
        );
      case "covered": {
        // The server already collapsed the lists to the first
        // COVERED_COLLAPSE entries; the counts carry the rest (M7).
        const moreParents = Math.max(0, view.parentCount - view.parents.length);
        const moreDocs = Math.max(0, view.docCount - view.docs.length);
        return (
          <div>
            <button type="button" style={{ ...link, color: "#3a5fb4" }} onClick={() => setOpen((o) => !o)}>
              {coveredLabel(view.docCount, kind)}
            </button>
            {open && (
              <div style={{ marginTop: 4, display: "grid", gap: 2 }}>
                {view.parents.map((p) => (
                  <span key={p.sku} style={muted}>
                    on <b style={{ color: "#3d424e" }}>{p.sku}</b> {p.desc}
                  </span>
                ))}
                {moreParents > 0 && <span style={muted}>+{moreParents} more fixture{moreParents === 1 ? "" : "s"}</span>}
                {view.docs.map((d) => (
                  <a key={d.id} href={docHref(d.id)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "var(--accent)" }}>
                    {d.title}
                  </a>
                ))}
                {moreDocs > 0 && <span style={muted}>+{moreDocs} more document{moreDocs === 1 ? "" : "s"}</span>}
              </div>
            )}
            {!open && moreParents > 0 && <span style={muted}> · {view.parents.map((p) => p.sku).join(", ")} +{moreParents} more</span>}
          </div>
        );
      }
      case "link-only":
        return (
          <div style={{ display: "grid", gap: 3 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <a href={view.docs[0] ? docHref(view.docs[0].id) : view.urls[0]} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#9a6b12", fontWeight: 600, textDecoration: "none" }}>
                Link only
              </a>
              <button type="button" style={link} disabled={!!busy} onClick={() => run("Fetching…", async () => {
                const r = await fetchLinksAction([{ sku, kind }]);
                if (!r.ok) return r;
                const res = r.results[0];
                return res && !res.ok ? { ok: false, error: res.error } : { ok: true };
              })}>
                Fetch
              </button>
            </div>
            {view.error && <span style={{ fontSize: 11, color: "#b4543a" }}>Last fetch: {view.error}</span>}
          </div>
        );
      case "not-needed":
        return (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={muted}>Not needed</span>
            <button type="button" style={link} disabled={!!busy} onClick={() => run("Saving…", () => setNotNeededAction([sku], kind, false))}>
              Undo
            </button>
          </div>
        );
      case "missing":
        return (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" onClick={() => pick(null)} disabled={!!busy} style={{ border: "1px dashed #c9cdd5", borderRadius: 7, background: over ? "#f4f6fb" : "#fff", color: "#6b7079", fontSize: 11.5, padding: "5px 10px", cursor: "pointer" }}>
              Drop file or click
            </button>
            <button type="button" style={{ ...link, color: "#8c919c", fontWeight: 500 }} disabled={!!busy} onClick={() => run("Saving…", () => setNotNeededAction([sku], kind, true))}>
              Not needed
            </button>
          </div>
        );
    }
  })();

  return (
    <div {...dropProps} style={{ minWidth: 0, borderRadius: 8, outline: over ? "2px dashed var(--accent)" : "none", outlineOffset: 2, padding: 2 }}>
      <input
        ref={fileRef}
        type="file"
        accept={acceptFor(kind)}
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
      />
      {busy ? <span style={muted}>{busy}</span> : body}
      {view.state !== "missing" && view.state !== "own" && !busy && (
        <button type="button" style={{ ...link, fontWeight: 500, color: "#8c919c", marginTop: 3 }} onClick={() => pick(null)}>
          Upload own file
        </button>
      )}
      {error && <div role="alert" style={{ marginTop: 3, fontSize: 11, color: "#b4543a" }}>{error}</div>}
    </div>
  );
}
