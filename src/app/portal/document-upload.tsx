"use client";

import { useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { checkDocumentName, MAX_DOCUMENT_LABEL } from "@/lib/document-files";
import { putDocumentFile } from "@/components/documents/upload-client";
import { finalizePortalDocumentAction } from "./documents-actions";

/**
 * Portal "Send us files" (#218). Files go browser → private Blob through
 * /portal/documents/upload, then finalizePortalDocumentAction records them.
 * The company is the portal session's (server-side); `customerId` here only
 * builds the upload path the server re-checks.
 */

const FIELD: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  color: "#16181d",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "8px 10px",
  background: "#fff",
  width: "100%",
};

export function PortalDocumentUpload({
  customerId,
  venues,
  categories,
  disabled,
}: {
  customerId: string;
  venues: Array<{ id: string; label: string }>;
  categories: Array<{ key: string; label: string }>;
  disabled: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [venue, setVenue] = useState("");
  const [category, setCategory] = useState("other");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (disabled) {
    return (
      <div style={{ padding: "14px 20px", fontSize: 12, color: "#9aa0ab" }}>Uploads are disabled in the team preview.</div>
    );
  }

  const pick = (list: FileList | null) => {
    setMsg(null);
    const chosen = list ? [...list] : [];
    const refused = chosen.map((f) => checkDocumentName(f.name, f.size)).filter((e): e is string => !!e);
    setFiles(chosen.filter((f) => !checkDocumentName(f.name, f.size)));
    if (refused.length) setMsg({ ok: false, text: refused.join(" ") });
  };

  const send = async () => {
    if (!files.length) return;
    setBusy(true);
    setMsg(null);
    let sent = 0;
    const errors: string[] = [];
    for (const f of files) {
      const put = await putDocumentFile(f, { customerId, handleUploadUrl: "/portal/documents/upload" });
      if (!put.ok) {
        errors.push(`${f.name}: ${put.error}`);
        continue;
      }
      const r = await finalizePortalDocumentAction({
        uploadKey: put.uploadKey,
        blobPath: put.pathname,
        fileName: f.name,
        mime: f.type,
        siteId: venue || null,
        category,
        notes: note,
      });
      if (r.ok) sent++;
      else errors.push(`${f.name}: ${r.error}`);
    }
    setBusy(false);
    setFiles([]);
    if (input.current) input.current.value = "";
    if (sent) setNote("");
    setMsg(
      errors.length
        ? { ok: false, text: errors.join(" · ") }
        : { ok: true, text: sent === 1 ? "Sent — our team has it." : `${sent} files sent — our team has them.` }
    );
    if (sent) router.refresh();
  };

  return (
    <div style={{ padding: "14px 20px", borderTop: "1px solid #f0f1f4", background: "#fafbfc" }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Send us files</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
        <input
          ref={input}
          type="file"
          multiple
          aria-label="Choose files"
          style={{ ...FIELD, padding: "6px 8px" }}
          onChange={(e) => pick(e.target.files)}
        />
        <select style={FIELD} aria-label="Venue" value={venue} onChange={(e) => setVenue(e.target.value)}>
          <option value="">Any venue / general</option>
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
        <select style={FIELD} aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <textarea
        style={{ ...FIELD, marginTop: 8, minHeight: 56, resize: "vertical" }}
        maxLength={2000}
        placeholder="Add a note for our team (optional)"
        aria-label="Note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          disabled={busy || !files.length}
          onClick={send}
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 13,
            fontWeight: 600,
            color: "#fff",
            background: "var(--accent)",
            border: "none",
            borderRadius: 9,
            padding: "9px 14px",
            cursor: busy || !files.length ? "not-allowed" : "pointer",
            opacity: busy || !files.length ? 0.55 : 1,
          }}
        >
          {busy ? "Sending…" : files.length > 1 ? `Send ${files.length} files` : "Send file"}
        </button>
        <span style={{ fontSize: 11.5, color: "#9aa0ab" }}>Any file up to {MAX_DOCUMENT_LABEL}. Programs and scripts can&apos;t be sent.</span>
      </div>
      {msg && (
        <div role={msg.ok ? "status" : "alert"} style={{ marginTop: 8, fontSize: 12.5, fontWeight: 600, color: msg.ok ? "#1f7a52" : "#b03a2e" }}>
          {msg.text}
        </div>
      )}
    </div>
  );
}
