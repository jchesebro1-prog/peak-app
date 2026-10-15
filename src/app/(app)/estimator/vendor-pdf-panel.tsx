"use client";

/* #348 slice 5 — Read the PDF, in the vendor quote form: the file-row button and the results panel under the
   attachment grid. Browser-only: it renders what the hook holds (`VendorDraft.pdfRead` / `extracted`, the form's
   `VendorPdfFormState`) and runs the pure checks' notes; the read itself is the hook's `readVendorPdf`. Nothing here
   saves — a read fills the form, and only Add + Save keep it. */
import type { CSSProperties } from "react";
import { VENDOR_PDF_COPY, modelLabel } from "@/lib/vendor-pdf/extraction";
import { checkNotes } from "@/lib/vendor-pdf/checks";
import { yearAwareDate } from "@/lib/format";
import type { VendorDraft, VendorPdfFormState } from "./types";

const WARN = "#8a6d1f";
const INFO = "#5b616e";
const ERROR = "#b4543a";
const TRY_HARDER_TITLE = "Reads the PDF again with Sonnet — replaces the lines this read filled in";

/** The Download link's look, as a button. */
const LINK_BTN: CSSProperties = {
  border: 0,
  background: "none",
  padding: 0,
  fontFamily: "var(--font-ui)",
  fontSize: 11.5,
  fontWeight: 600,
  color: "var(--accent)",
  textDecoration: "none",
  cursor: "pointer",
};

/** "Read the PDF" in the file row (the slice-4 `fileActions` slot); disabled, with the reading copy, while busy. */
export function ReadPdfButton({ busy, onRead }: { busy: VendorPdfFormState["busy"]; onRead: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        if (!busy) onRead();
      }}
      disabled={!!busy}
      aria-busy={!!busy}
      style={{ ...LINK_BTN, cursor: busy ? "default" : "pointer", opacity: busy ? 0.65 : 1 }}
    >
      {busy === "hard" ? VENDOR_PDF_COPY.readingHard : busy ? VENDOR_PDF_COPY.reading : VENDOR_PDF_COPY.button}
    </button>
  );
}

/** What the last read (or its failure) says, under the attachment + Link grid. Renders nothing with no read, no
 *  error and no saved read. One Try harder: after a non-hard read, or after a failure that wasn't a Try harder and
 *  wasn't a too-large file. */
export function VendorPdfPanel({ draft, state, onTryHarder }: { draft: VendorDraft; state: VendorPdfFormState; onTryHarder: () => void }) {
  const read = draft.pdfRead;
  const x = draft.extracted?.data ?? null;
  const err = state.error;
  if (!read && !err) {
    // An edit of a saved quote: the read was kept on the record, but its checks aren't held — one muted line.
    if (!draft.extracted) return null;
    return (
      <div style={{ marginTop: -8, marginBottom: 16, fontSize: 11.5, color: "#8c919c" }}>
        Read by {modelLabel(draft.extracted.model)} on {yearAwareDate(draft.extracted.at)} — Read the PDF again to re-check.
      </div>
    );
  }
  const offerTryHarder = err ? !err.tooLarge && !err.hard && !state.busy : !!read && !read.hard;
  const notes = read && x ? checkNotes(read.checks, x, { vendor: draft.vendor, vendorCompanyId: draft.vendorCompanyId }) : [];
  const n = x?.lines?.length ?? 0;
  return (
    <div
      style={{
        marginTop: -6,
        marginBottom: 16,
        border: "1px solid #eef0f3",
        borderRadius: 8,
        background: "#fafbfc",
        padding: "10px 12px",
        fontSize: 12,
        lineHeight: 1.45,
      }}
    >
      {read && (
        <div role="status" style={{ color: "#16181d", fontWeight: 600 }}>
          {VENDOR_PDF_COPY.filled(n, modelLabel(read.model))}
        </div>
      )}
      {notes.length > 0 && (
        <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none" }}>
          {notes.map((note, i) => (
            <li key={i} style={{ color: note.tone === "warn" ? WARN : INFO, fontSize: 11.5, marginTop: i ? 3 : 0 }}>
              {note.text}
            </li>
          ))}
        </ul>
      )}
      {err && (
        <div role="alert" style={{ color: ERROR, fontSize: 11.5, marginTop: read ? 6 : 0 }}>
          {err.text}
        </div>
      )}
      {offerTryHarder && (
        <button
          type="button"
          title={TRY_HARDER_TITLE}
          onClick={() => {
            if (!state.busy) onTryHarder();
          }}
          disabled={!!state.busy}
          style={{ ...LINK_BTN, marginTop: 8, fontSize: 12, cursor: state.busy ? "default" : "pointer", opacity: state.busy ? 0.65 : 1 }}
        >
          {state.busy === "hard" ? VENDOR_PDF_COPY.readingHard : VENDOR_PDF_COPY.tryHarder}
        </button>
      )}
    </div>
  );
}
