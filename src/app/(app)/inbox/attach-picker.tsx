"use client";

import { useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import type { AttachmentMetaVM } from "./types";
import { PaperclipIcon } from "./icons";
import { attachableDocumentsAction, finalizeMailUploadAction, mailUploadTargetAction, type AttachableDoc } from "./attach-actions";
import { MAIL_ATTACH_MAX_BYTES, MAIL_ATTACH_MAX_FILES, MAIL_ATTACH_MAX_LABEL, mailAttachNameError, type AttachRef, type ComposeAttachments } from "@/lib/mail-attachments";

/**
 * Batch 6 / #64 — the Inbox composer's Attach button: files from the computer
 * (straight to private Blob through /api/inbox/attach-upload — never through
 * a server action) and the linked company's / project's Documents. Chips with
 * ✕; 25 MB and 20 files together. The server re-checks everything on save /
 * send (lib/mail-attachments-server.ts).
 */

export type AttachItem = { id: string; name: string; size: number; key?: string; ref?: AttachRef; progress?: number };

export type AttachState = {
  items: AttachItem[];
  dirty: boolean;
  uploading: number;
  error: string | null;
};

export function initialAttachState(existing: AttachmentMetaVM[] | undefined): AttachState {
  return {
    items: (existing || []).map((a, i) => ({ id: a.key || `old-${i}`, name: a.name, size: a.size, key: a.key })),
    dirty: false,
    uploading: 0,
    error: null,
  };
}

/** What save / send carries: undefined when the attachments weren't touched (the draft's own list stands). */
export function attachPayload(s: AttachState): ComposeAttachments | undefined {
  if (!s.dirty) return undefined;
  return {
    keep: s.items.filter((i) => !i.ref && i.key).map((i) => i.key!),
    add: s.items.filter((i) => i.ref && i.progress === undefined).map((i) => i.ref!),
  };
}

const sizeLabel = (bytes: number) =>
  bytes >= 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(1) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB";

let seq = 0;
const nextId = () => `att-${Date.now().toString(36)}-${++seq}`;

export default function AttachPicker({
  state,
  setState,
  threadId,
  customerId,
}: {
  state: AttachState;
  setState: (fn: (s: AttachState) => AttachState) => void;
  threadId: string | null;
  customerId: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState(false);
  const [docs, setDocs] = useState<AttachableDoc[] | null>(null);
  const [docsOpen, setDocsOpen] = useState(false);
  const [docsErr, setDocsErr] = useState<string | null>(null);
  const total = state.items.reduce((s, i) => s + i.size, 0);

  const fail = (error: string) => setState((s) => ({ ...s, error }));

  /** The files that fit (name, size, the 25 MB / 20-file room left), checked against the list as it stands now. */
  function addFiles(files: File[]) {
    let used = total;
    let count = state.items.length;
    for (const file of files) {
      const pre = mailAttachNameError(file.name, file.size);
      if (pre) {
        fail(pre);
        continue;
      }
      if (count + 1 > MAIL_ATTACH_MAX_FILES || used + file.size > MAIL_ATTACH_MAX_BYTES) {
        fail(`Attachments can be ${MAIL_ATTACH_MAX_LABEL} and ${MAIL_ATTACH_MAX_FILES} files together — ${file.name} doesn’t fit.`);
        continue;
      }
      used += file.size;
      count++;
      void addFile(file);
    }
  }

  async function addFile(file: File) {
    const id = nextId();
    setState((s) => ({ ...s, error: null, dirty: true, uploading: s.uploading + 1, items: [...s.items, { id, name: file.name, size: file.size, progress: 0 }] }));
    const drop = (error: string) =>
      setState((s) => ({ ...s, error, uploading: Math.max(0, s.uploading - 1), items: s.items.filter((i) => i.id !== id) }));
    try {
      const target = await mailUploadTargetAction(file.name, file.size);
      if (!target.ok) return drop(target.error);
      const res = await upload(target.pathname, file, {
        access: "private",
        handleUploadUrl: "/api/inbox/attach-upload",
        clientPayload: JSON.stringify({ uploadKey: target.uploadKey }),
        contentType: file.type || "application/octet-stream",
        multipart: file.size > 5 * 1024 * 1024,
        onUploadProgress: (e) => setState((s) => ({ ...s, items: s.items.map((i) => (i.id === id ? { ...i, progress: Math.round(e.percentage) } : i)) })),
      });
      const fin = await finalizeMailUploadAction({ uploadKey: target.uploadKey, blobPath: res.pathname, fileName: file.name, mime: file.type });
      if (!fin.ok) return drop(fin.error);
      const a = fin.attachment;
      setState((s) => ({
        ...s,
        uploading: Math.max(0, s.uploading - 1),
        items: s.items.map((i) => (i.id === id ? { id, name: a.name, size: a.size, ref: { kind: "upload", blobPath: a.blobPath, name: a.name, mime: a.mime } } : i)),
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      drop(/client token|storage/i.test(msg) ? "Upload refused — file storage may not be configured, or your session ended." : "Upload failed — try again.");
    }
  }

  async function openDocs() {
    setMenu(false);
    setDocsOpen(true);
    setDocsErr(null);
    setDocs(null);
    const r = await attachableDocumentsAction({ threadId, customerId: threadId ? null : customerId || null });
    if (!r.ok) setDocsErr(r.error);
    else setDocs(r.docs);
  }

  function addDoc(d: AttachableDoc) {
    setState((s) => {
      if (s.items.some((i) => i.ref?.kind === "document" && i.ref.documentId === d.id)) return s;
      const used = s.items.reduce((n, i) => n + i.size, 0);
      if (s.items.length >= MAIL_ATTACH_MAX_FILES || used + d.size > MAIL_ATTACH_MAX_BYTES) {
        return { ...s, error: `Attachments can be ${MAIL_ATTACH_MAX_LABEL} and ${MAIL_ATTACH_MAX_FILES} files together — ${d.fileName} doesn’t fit.` };
      }
      return { ...s, error: null, dirty: true, items: [...s.items, { id: nextId(), name: d.fileName, size: d.size, ref: { kind: "document", documentId: d.id } }] };
    });
  }

  const remove = (id: string) => setState((s) => ({ ...s, dirty: true, error: null, items: s.items.filter((i) => i.id !== id) }));

  const btn: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "#3a3f4a",
    background: "#fff", border: "1px solid #e4e7ec", borderRadius: 9, padding: "7px 12px", cursor: "pointer", fontFamily: "var(--font-ui)",
  };
  const noCompany = !threadId && !customerId;

  return (
    <div style={{ padding: "8px 20px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", position: "relative" }}>
        <button type="button" style={btn} onClick={() => setMenu((v) => !v)} aria-haspopup="menu" aria-expanded={menu}>
          <PaperclipIcon size={13} /> Attach
        </button>
        {state.items.length > 0 && (
          <span style={{ fontSize: 11.5, color: total > MAIL_ATTACH_MAX_BYTES ? "#9b3a2a" : "#9aa0ab", fontFamily: "var(--font-mono)" }}>
            {sizeLabel(total)} of {MAIL_ATTACH_MAX_LABEL}
          </span>
        )}
        {menu && (
          <div role="menu" style={{ position: "absolute", top: 38, left: 0, zIndex: 5, background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, boxShadow: "0 10px 30px rgba(0,0,0,.14)", padding: 5, minWidth: 230 }}>
            <button type="button" role="menuitem" onClick={() => { setMenu(false); fileRef.current?.click(); }} style={{ ...btn, border: "none", width: "100%", justifyContent: "flex-start" }}>
              From this computer…
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={openDocs}
              disabled={noCompany}
              title={noCompany ? "Pick a client first — Documents are the company’s files" : undefined}
              style={{ ...btn, border: "none", width: "100%", justifyContent: "flex-start", opacity: noCompany ? 0.45 : 1, cursor: noCompany ? "default" : "pointer" }}
            >
              From the company’s Documents…
            </button>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = "";
            addFiles(files);
          }}
        />
      </div>

      {docsOpen && (
        <div style={{ marginTop: 8, border: "1px solid #e8eaee", borderRadius: 10, maxHeight: 220, overflowY: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "7px 10px", borderBottom: "1px solid #f0f1f4", fontSize: 11.5, fontWeight: 600, color: "#5b616e" }}>
            <span style={{ flex: 1 }}>Documents</span>
            <button type="button" onClick={() => setDocsOpen(false)} style={{ border: "none", background: "transparent", cursor: "pointer", color: "#8c919c", fontSize: 14 }} aria-label="Close Documents">
              ✕
            </button>
          </div>
          {docsErr && <div style={{ padding: 10, fontSize: 12, color: "#9b3a2a" }}>{docsErr}</div>}
          {!docsErr && docs === null && <div style={{ padding: 10, fontSize: 12, color: "#9aa0ab" }}>Loading…</div>}
          {docs && docs.length === 0 && <div style={{ padding: 10, fontSize: 12, color: "#9aa0ab" }}>No documents on this company or project yet.</div>}
          {docs?.map((d) => {
            const on = state.items.some((i) => i.ref?.kind === "document" && i.ref.documentId === d.id);
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => addDoc(d)}
                disabled={on}
                style={{ display: "flex", width: "100%", gap: 8, alignItems: "center", textAlign: "left", padding: "7px 10px", border: "none", borderTop: "1px solid #f6f7f9", background: on ? "#f7f8fa" : "#fff", cursor: on ? "default" : "pointer", fontFamily: "var(--font-ui)" }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "#16181d", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title || d.fileName}</span>
                  <span style={{ display: "block", fontSize: 11, color: "#9aa0ab" }}>{d.category}{d.project ? " · project" : ""} · {d.fileName}</span>
                </span>
                <span style={{ fontSize: 11, color: "#9aa0ab", fontFamily: "var(--font-mono)" }}>{on ? "Added" : sizeLabel(d.size)}</span>
              </button>
            );
          })}
        </div>
      )}

      {state.items.length > 0 && (
        <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {state.items.map((a) => (
            <span
              key={a.id}
              title={a.progress !== undefined ? "Uploading…" : "Attached — sends with this email"}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 600, color: "#3a3f4a", background: "#f4f5f7", border: "1px solid #e8eaee", borderRadius: 7, padding: "5px 6px 5px 9px" }}
            >
              <PaperclipIcon size={12} />
              {a.name}
              <span style={{ color: "#aab0bb", fontWeight: 500 }}>{a.progress !== undefined ? `${a.progress}%` : sizeLabel(a.size)}</span>
              {(a.key || a.ref) && a.progress === undefined && (
                <button
                  type="button"
                  onClick={() => remove(a.id)}
                  aria-label={`Remove ${a.name}`}
                  style={{ border: "none", background: "transparent", cursor: "pointer", color: "#8c919c", fontSize: 12, padding: "0 3px", lineHeight: 1 }}
                >
                  ✕
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {state.error && (
        <div role="alert" style={{ marginTop: 6, fontSize: 12, color: "#9b3a2a" }}>
          {state.error}
        </div>
      )}
    </div>
  );
}
