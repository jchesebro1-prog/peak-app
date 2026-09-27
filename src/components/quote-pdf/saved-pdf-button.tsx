"use client";

import Link from "next/link";
import { useState } from "react";
import type { QuotePdfView } from "@/lib/quote-pdf/state";
import { pdfCanRetry } from "./pdf-banner";
import { useQuotePdf } from "./use-quote-pdf";

/**
 * Service builders' letter button (#222): opens the SAVED proposal PDF in a new
 * tab, with its render status and Retry underneath; the old web letter stays
 * one click away as "Web version". The page re-renders with a fresh
 * `initialPdf` after every save (the save action redirects back here), so the
 * caller keys this component on that view to start from it.
 */
export function SavedPdfButton({
  quoteId,
  initialPdf,
  accent,
  letterHref,
}: {
  quoteId: string;
  initialPdf: QuotePdfView | null;
  accent: string;
  letterHref: string;
}) {
  const [pdf, setPdf] = useState<QuotePdfView | null>(initialPdf);
  const { timedOut, retry, retrying } = useQuotePdf(quoteId, pdf, setPdf);
  const href = `/api/quotes/${encodeURIComponent(quoteId)}/pdf`;
  const ready = !!pdf?.hasFile;
  const note = retrying
    ? "Updating PDF…"
    : !pdf
    ? "No PDF yet."
    : pdf.status === "pending"
    ? timedOut
      ? "The PDF is taking longer than expected."
      : "Updating PDF…"
    : pdf.status === "failed"
    ? pdf.error || "The PDF couldn’t be made."
    : null;
  const canRetry = pdfCanRetry(pdf, timedOut, retrying);
  const btn = {
    marginTop: 9,
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    fontSize: 13,
    fontWeight: 600,
    color: accent,
    background: "#fff",
    border: "1px solid #e4e7ec",
    borderRadius: 10,
    padding: 11,
    textDecoration: "none",
    boxSizing: "border-box" as const,
  };
  return (
    <div>
      {ready ? (
        <a href={href} target="_blank" rel="noopener noreferrer" style={btn}>
          Open quote PDF →
        </a>
      ) : (
        <span style={{ ...btn, opacity: 0.55, cursor: "default" }}>Open quote PDF →</span>
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 6, fontSize: 11.5, color: "#8c919c" }}>
        <span>{note || "Saved PDF is current."}</span>
        <span style={{ display: "flex", gap: 10, flexShrink: 0 }}>
          {canRetry && (
            <button
              type="button"
              onClick={retry}
              style={{ fontFamily: "var(--font-ui)", fontSize: 11.5, fontWeight: 600, color: accent, background: "none", border: "none", padding: 0, cursor: "pointer" }}
            >
              {pdf ? "Retry" : "Create PDF"}
            </button>
          )}
          <Link href={letterHref} style={{ color: "#8c919c", fontWeight: 600, textDecoration: "none" }}>
            Web version
          </Link>
        </span>
      </div>
    </div>
  );
}
