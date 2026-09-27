"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { setQuoteStatus } from "@/app/(app)/quotes/actions";
import { declinePortalAcceptanceAction } from "./actions";
import { PURCHASE_METHOD_LABEL } from "@/lib/portal-quote-mode";
import type { PortalPanelData } from "./types";

/**
 * Staff Portal panel (#245 Task 13, spec §5) — rendered at the top of the
 * Estimator for a loaded `source === "portal-catalog"` quote. A review
 * banner listing every price-on-request line, the customer's acceptance
 * (purchase method / notes / PO file) with Approve (→ the normal gated Won
 * path) / Decline, and a firm quote's validity date.
 */

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function fmtDateTime(ms: number): string {
  return new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

const CARD: CSSProperties = {
  background: "#fff",
  border: "1px solid #e4e7ec",
  borderRadius: 12,
  padding: "14px 18px",
  marginBottom: 16,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

export function PortalPanel({
  data,
  statusError,
}: {
  data: PortalPanelData;
  statusError?: string | null;
}) {
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const submitDecline = () => {
    setError("");
    start(async () => {
      const r = await declinePortalAcceptanceAction(data.quoteId, note);
      if (!r.ok) setError(r.error);
      else {
        setDeclining(false);
        setNote("");
      }
    });
  };

  return (
    <div style={CARD}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: ".05em",
            textTransform: "uppercase",
            color: "#3155a8",
            background: "#e9eefb",
            border: "1px solid #d4ddf3",
            borderRadius: 6,
            padding: "3px 8px",
          }}
        >
          Portal quote
        </span>
        {data.portalFirm && (
          <span style={{ fontSize: 12.5, color: "#5b616e" }}>Firm portal quote — valid until {fmtDate(data.portalFirm.validUntil)}</span>
        )}
      </div>

      {statusError && (
        <div role="alert" style={{ fontSize: 12.5, fontWeight: 600, color: "#b03a2e", background: "#fdf0ee", border: "1px solid #f3d2cc", borderRadius: 8, padding: "8px 10px" }}>
          {statusError}
        </div>
      )}

      {data.portalReview && (
        <div style={{ background: "#fbf3dd", border: "1px solid #f0e2bd", borderRadius: 8, padding: "10px 12px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#8a6d1f", marginBottom: 6 }}>
            Needs Peak&rsquo;s price before it can be sent
          </div>
          {data.porItems.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "#5b616e" }}>
              {data.porItems.map((it, i) => (
                <li key={i}>
                  Price on request: {it.desc} {it.qty !== 1 ? `×${it.qty}` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <div style={{ fontSize: 12.5, color: "#5b616e" }}>Price every line below, then Save and Send.</div>
          )}
        </div>
      )}

      {data.portalAcceptance && (
        <div style={{ background: "#eaf6ef", border: "1px solid #cce9da", borderRadius: 8, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#1f7a52" }}>
            Accepted by {data.portalAcceptance.by} — {fmtDateTime(data.portalAcceptance.at)}
          </div>
          <div style={{ fontSize: 12.5, color: "#5b616e" }}>
            {data.portalAcceptance.purchaseMethod ? "Purchasing by " + PURCHASE_METHOD_LABEL[data.portalAcceptance.purchaseMethod] : "Purchase method not recorded"}
          </div>
          {data.portalAcceptance.notes && <div style={{ fontSize: 12.5, color: "#5b616e" }}>“{data.portalAcceptance.notes}”</div>}
          {data.portalAcceptance.poDocumentId && (
            <a
              href={`/api/documents/${encodeURIComponent(data.portalAcceptance.poDocumentId)}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}
            >
              Open PO file ↗
            </a>
          )}
          {error && (
            <div role="alert" style={{ fontSize: 12, fontWeight: 600, color: "#b03a2e" }}>
              {error}
            </div>
          )}
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap", marginTop: 4 }}>
            <form action={setQuoteStatus}>
              <input type="hidden" name="id" value={data.quoteId} />
              <input type="hidden" name="status" value="won" />
              <input type="hidden" name="back" value={data.back} />
              <button
                type="submit"
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "#fff",
                  background: "#1f7a52",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 14px",
                  cursor: "pointer",
                }}
              >
                Approve (mark Won)
              </button>
            </form>
            {!declining ? (
              <button
                type="button"
                onClick={() => setDeclining(true)}
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "#a33a2b",
                  background: "#fff",
                  border: "1px solid #f3d2cc",
                  borderRadius: 8,
                  padding: "8px 14px",
                  cursor: "pointer",
                }}
              >
                Decline with note
              </button>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 260 }}>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={500}
                  placeholder="Why this order is being declined (1–500 characters)"
                  style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, padding: "7px 9px", border: "1px solid #d6d9e0", borderRadius: 7, minHeight: 52, resize: "vertical" }}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    disabled={pending || !note.trim()}
                    onClick={submitDecline}
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#fff",
                      background: "#a33a2b",
                      border: "none",
                      borderRadius: 7,
                      padding: "7px 12px",
                      cursor: pending || !note.trim() ? "not-allowed" : "pointer",
                      opacity: pending || !note.trim() ? 0.6 : 1,
                    }}
                  >
                    {pending ? "Declining…" : "Confirm decline"}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      setDeclining(false);
                      setNote("");
                      setError("");
                    }}
                    style={{ fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 600, color: "#5b616e", background: "#fff", border: "1px solid #e4e7ec", borderRadius: 7, padding: "7px 12px", cursor: "pointer" }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
