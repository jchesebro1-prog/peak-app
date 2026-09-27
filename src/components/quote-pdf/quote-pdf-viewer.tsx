"use client";

import { useState, type CSSProperties } from "react";
import type { QuotePdfView } from "@/lib/quote-pdf/state";
import { pdfBanner, pdfFileKey, type PdfBannerTone } from "./pdf-banner";
import { useQuotePdf } from "./use-quote-pdf";

function bannerStyle(tone: PdfBannerTone): CSSProperties {
  const palette =
    tone === "error"
      ? { background: "#fbeeee", color: "#a33b3b", border: "1px solid #f1d2d2" }
      : tone === "warn"
      ? { background: "#fbf3dd", color: "#8a6d1f", border: "1px solid #f0e2bd" }
      : { background: "#e9eefb", color: "#3155a8", border: "1px solid #d4ddf3" };
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "9px 12px",
    borderRadius: 8,
    fontSize: 12.5,
    fontWeight: 600,
    marginBottom: 10,
    ...palette,
  };
}

const actionBtn: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  fontWeight: 600,
  border: "1px solid currentColor",
  background: "#fff",
  color: "inherit",
  borderRadius: 7,
  padding: "5px 10px",
  cursor: "pointer",
  flexShrink: 0,
};

/* iOS (Safari and the app's WKWebView shell) shows only the first page of a
   PDF in an iframe, so there — and only there, detected in CSS so server and
   client render the same markup — a line under the status offers the file in
   its own tab. */
const IOS_CSS = `
.qpdf-ios { display: none; }
@supports (-webkit-touch-callout: none) { .qpdf-ios { display: flex; } }
`;

/**
 * The saved quote PDF in an embedded viewer (#222), with its status above it:
 * "Updating PDF…" while a render runs (the previous file stays visible), the
 * failure reason with Retry, and "Unsaved changes — save to update the PDF."
 * while the editor holds changes the file doesn't. Retry is offered only for a
 * failed or given-up render (pdfBanner), never while one is being polled.
 */
export function QuotePdfViewer({
  quoteId,
  pdf,
  onPdf,
  dirty,
}: {
  quoteId: string | null;
  pdf: QuotePdfView | null;
  onPdf: (v: QuotePdfView) => void;
  dirty: boolean;
}) {
  const { timedOut, retry, retrying } = useQuotePdf(quoteId, pdf, onPdf);
  const pending = pdf?.status === "pending";
  const notes = pdfBanner({ quoteId, pdf, dirty, timedOut, retrying });
  const base = quoteId ? `/api/quotes/${encodeURIComponent(quoteId)}/pdf` : null;
  // Reload the iframe only when the file itself changes (pdfFileKey) — the
  // adjust-state-during-render pattern, so no effect and no extra frame.
  const [shownKey, setShownKey] = useState<string | null>(() => pdfFileKey(null, pdf));
  const fileKey = pdfFileKey(shownKey, pdf);
  if (fileKey !== shownKey) setShownKey(fileKey);
  const src = base && pdf?.hasFile && fileKey ? `${base}?v=${encodeURIComponent(fileKey)}` : null;
  return (
    <div style={{ flex: 1, minHeight: "70vh", display: "flex", flexDirection: "column" }}>
      <style>{IOS_CSS}</style>
      {notes.map((n) => (
        <div key={n.text} role="status" style={bannerStyle(n.tone)}>
          <span>{n.text}</span>
          {n.action && (
            <button type="button" onClick={retry} disabled={retrying} style={actionBtn}>
              {retrying ? "Working…" : n.action}
            </button>
          )}
        </div>
      ))}
      {src && base && (
        <div className="qpdf-ios" style={{ ...bannerStyle("info"), fontWeight: 500 }}>
          <span>Only the first page may show here on iPhone and iPad.</span>
          <a href={base} target="_blank" rel="noopener noreferrer" style={{ ...actionBtn, textDecoration: "none" }}>
            Open PDF ↗
          </a>
        </div>
      )}
      {src ? (
        <iframe
          key={src}
          src={src}
          title="Quote PDF"
          style={{ flex: 1, width: "100%", minHeight: "60vh", border: "none", borderRadius: 4, background: "#fff", boxShadow: "0 6px 30px rgba(0,0,0,.12)" }}
        />
      ) : (
        <div
          style={{
            flex: 1,
            minHeight: "60vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 4,
            background: "#fff",
            color: "#9aa0ab",
            fontSize: 13,
          }}
        >
          {pending ? "Rendering the PDF…" : "The PDF appears here once the quote is saved."}
        </div>
      )}
    </div>
  );
}
