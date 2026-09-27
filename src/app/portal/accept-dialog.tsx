"use client";

import { useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { checkDocumentName, MAX_DOCUMENT_LABEL } from "@/lib/document-files";
import { putDocumentFile } from "@/components/documents/upload-client";
import { PURCHASE_METHODS, PURCHASE_METHOD_LABEL } from "@/lib/portal-quote-mode";
import { finalizePortalDocumentIdAction } from "./documents-actions";
import { acceptPortalQuote } from "./actions";

/**
 * Accept quote dialog (#242 Task 13, spec §4.4). Purchase method (required),
 * an optional note (helper text carries the card warning verbatim — the
 * server re-checks it with a Luhn match, this is guidance only) and an
 * optional PO file. A file that fails to upload/finalize never blocks
 * acceptance (controller decision 5) — the customer lands on
 * /portal?accepted=1 either way, with a note when the file didn't attach.
 */

const OPEN_BTN: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  fontWeight: 600,
  color: "#fff",
  background: "#1f7a52",
  border: "none",
  borderRadius: 8,
  padding: "8px 12px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

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

const PANEL: CSSProperties = {
  gridColumn: "1 / -1",
  marginTop: 10,
  padding: "14px 16px",
  background: "#fafbfc",
  border: "1px solid #e4e7ec",
  borderRadius: 10,
};

export function AcceptDialog({
  quoteId,
  customerId,
  categories,
  disabled,
}: {
  quoteId: string;
  customerId: string;
  categories: Array<{ key: string; label: string }>;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<(typeof PURCHASE_METHODS)[number] | "">("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileMsg, setFileMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  if (disabled) return null;
  if (!open) {
    return (
      <button type="button" style={OPEN_BTN} onClick={() => setOpen(true)}>
        Accept quote
      </button>
    );
  }

  const pick = (list: FileList | null) => {
    setFileMsg("");
    const f = list && list[0] ? list[0] : null;
    if (f) {
      const refused = checkDocumentName(f.name, f.size);
      if (refused) {
        setFileMsg(refused);
        setFile(null);
        return;
      }
    }
    setFile(f);
  };

  const submit = async () => {
    if (!method) {
      setError("Pick how you'll purchase.");
      return;
    }
    setBusy(true);
    setError("");
    let poDocumentId: string | null = null;
    let attachFailed = false;
    if (file) {
      const put = await putDocumentFile(file, { customerId, handleUploadUrl: "/portal/documents/upload" });
      if (put.ok) {
        const poCategory = categories.find((c) => /purchase order/i.test(c.label))?.key || "other";
        const fin = await finalizePortalDocumentIdAction({
          uploadKey: put.uploadKey,
          blobPath: put.pathname,
          fileName: file.name,
          mime: file.type,
          category: poCategory,
          notes: "Purchase order — attached when accepting a quote",
        });
        if (fin.ok) poDocumentId = fin.id;
        else attachFailed = true;
      } else {
        attachFailed = true;
      }
    }
    try {
      const r = await acceptPortalQuote({ quoteId, purchaseMethod: method, notes, poDocumentId });
      if (!r.ok) {
        setError(r.error);
        setBusy(false);
        return;
      }
      router.push("/portal?accepted=1" + (attachFailed ? "&filewarn=1" : ""));
    } catch {
      setError("Couldn't accept this quote — check your connection and try again.");
      setBusy(false);
    }
  };

  return (
    <div style={PANEL}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Accept this quote</div>
      <div style={{ fontSize: 11.5, color: "#9aa0ab", marginBottom: 10 }}>
        Accepting lets our team know to move ahead — nothing is final until they confirm.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
        <label style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "#8c919c" }}>
          How will you purchase?
        </label>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {PURCHASE_METHODS.map((m) => (
            <label key={m} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input type="radio" name="purchaseMethod" value={m} checked={method === m} onChange={() => setMethod(m)} />
              {PURCHASE_METHOD_LABEL[m]}
            </label>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
        <label htmlFor="pk-accept-notes" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "#8c919c" }}>
          Purchasing notes (optional)
        </label>
        <textarea
          id="pk-accept-notes"
          style={{ ...FIELD, minHeight: 60, resize: "vertical" }}
          maxLength={1000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <div style={{ fontSize: 11, color: "#9aa0ab" }}>Don&rsquo;t enter card numbers — we&rsquo;ll call you to take payment.</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
        <label style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "#8c919c" }}>PO file (optional)</label>
        <input ref={input} type="file" style={{ ...FIELD, padding: "6px 8px" }} onChange={(e) => pick(e.target.files)} />
        <div style={{ fontSize: 11, color: "#9aa0ab" }}>Up to {MAX_DOCUMENT_LABEL}.</div>
        {fileMsg && (
          <div role="alert" style={{ fontSize: 12, color: "#b03a2e", fontWeight: 600 }}>
            {fileMsg}
          </div>
        )}
      </div>
      {error && (
        <div role="alert" style={{ marginBottom: 10, fontSize: 12.5, fontWeight: 600, color: "#b03a2e" }}>
          {error}
        </div>
      )}
      <div style={{ display: "flex", gap: 10 }}>
        <button
          type="button"
          disabled={busy}
          onClick={submit}
          style={{ ...OPEN_BTN, opacity: busy ? 0.6 : 1, cursor: busy ? "not-allowed" : "pointer" }}
        >
          {busy ? "Accepting…" : "Accept quote"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setOpen(false)}
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 12,
            fontWeight: 600,
            color: "#5b616e",
            background: "#fff",
            border: "1px solid #e4e7ec",
            borderRadius: 8,
            padding: "8px 12px",
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
