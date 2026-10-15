"use client";

import { useRef, useState, type CSSProperties } from "react";
import type { BidderVM, BidPanelVM } from "@/lib/parties/bid-vm";
import { BID_SEND_COPY } from "@/lib/parties/bid-send";
import { ONLINE_COPY } from "@/lib/quote-share/view";
import { bidderLinkAction } from "../bid-send-actions";

/** #348 slice 2a — one bidder's row in the Bidders card (presentation only; the card owns the calls). */
export const BTN: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 600, color: "#16181d", background: "#f1f2f5", border: "none", borderRadius: 7, padding: "6px 12px", cursor: "pointer" };
const FIELD: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 12, padding: "4px 6px", border: "1px solid #dcdfe5", borderRadius: 6, background: "#fff" };
const SR_ONLY: CSSProperties = { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 };
const CHIP: CSSProperties = { fontSize: 10.5, fontWeight: 600, borderRadius: 20, padding: "2px 8px", whiteSpace: "nowrap" };

function resultChip(b: BidderVM): CSSProperties {
  if (b.result === "awarded") return { ...CHIP, background: "#e6f4ea", color: "#1e6b34" };
  if (b.result === "lost") return { ...CHIP, background: "#f1f2f5", color: "#6b7280" };
  return { ...CHIP, background: "#f1f2f5", color: "#5b616e" };
}

/** The file name from a Content-Disposition `filename*=UTF-8''…` (decoded), else the fallback. */
function downloadName(disposition: string | null, fallback: string): string {
  const m = disposition?.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  if (m) {
    try {
      const n = decodeURIComponent(m[1].trim().replace(/^"|"$/g, ""));
      if (n) return n;
    } catch {}
  }
  return fallback;
}

export function BidderRow({
  b,
  panel,
  busy,
  walking,
  savingFields,
  onPatch,
  onSubmitted,
  onAward,
  onSend,
}: {
  b: BidderVM;
  panel: BidPanelVM;
  /** Any card mutation in flight, a bidder send walk included. */
  busy: boolean;
  /** A bidder send walk is running: even the blur-saved inputs lock. */
  walking: boolean;
  /** `${partyId}:${field}` keys with a blur-save in flight (each disables only its own input). */
  savingFields: readonly string[];
  onPatch: (partyId: string, patch: Record<string, unknown>, field?: string) => void;
  onSubmitted: (b: BidderVM) => void;
  onAward: (b: BidderVM) => void;
  /** Send / Send revision / Retry — the card opens its email panel for this bidder. */
  onSend: (b: BidderVM) => void;
}) {
  const edit = panel.canEdit;
  const urlSaving = savingFields.includes(`${b.id}:bidSiteUrl`);
  const noSaving = savingFields.includes(`${b.id}:gcBidNo`);
  const locked = b.result === "awarded" || b.result === "lost";
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState("");
  const pdfInFlight = useRef(false);
  // A blank or malformed address shows the No email chip instead of a Send button.
  const canEmail = !!b.sendLabel && !b.noEmail;
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkNote, setLinkNote] = useState("");
  const [linkError, setLinkError] = useState("");
  // #348 2b-ii — this bidder's own link (v3), copied; a browser that refuses the clipboard gets a prompt to copy by hand.
  async function copyLink() {
    if (linkBusy) return;
    setLinkBusy(true);
    setLinkNote("");
    setLinkError("");
    try {
      const r = await bidderLinkAction(panel.quoteId, b.id);
      if (!r.ok) {
        setLinkError(r.error);
        return;
      }
      const url = window.location.origin + r.path;
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        window.prompt(ONLINE_COPY.copyManual, url);
      }
      setLinkNote(BID_SEND_COPY.linkCopied);
    } catch {
      setLinkError("The link couldn’t be made — check your connection and try again.");
    } finally {
      setLinkBusy(false);
    }
  }
  // #348 2b-i — the render takes seconds: fetch it so the row can say "Preparing PDF…" and show a failure inline (a bare link would navigate to the error text).
  async function downloadPdf() {
    if (pdfInFlight.current) return;
    pdfInFlight.current = true;
    setPdfBusy(true);
    setPdfError("");
    try {
      const res = await fetch(b.pdfHref);
      // A signed-out session redirects to the sign-in page (200, HTML) — never save that as a PDF.
      if (res.redirected) {
        setPdfError("Your session expired — reload the page.");
        return;
      }
      if (!res.ok || !res.headers.get("content-type")?.startsWith("application/pdf")) {
        const text = res.ok ? "" : (await res.text()).trim().slice(0, 300);
        setPdfError(text || "The bidder PDF couldn’t be rendered — try again.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = downloadName(res.headers.get("content-disposition"), `${b.companyName} estimate.pdf`);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setPdfError("The bidder PDF couldn’t be downloaded — check your connection and try again.");
    } finally {
      pdfInFlight.current = false;
      setPdfBusy(false);
    }
  }
  return (
    <li style={{ listStyle: "none", border: "1px solid #ececf0", borderRadius: 9, padding: "9px 11px", display: "grid", gap: 7 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <a href={`/companies/${encodeURIComponent(b.companyId)}`} style={{ fontSize: 13, fontWeight: 600, color: "#16181d" }}>
          {b.companyName}
        </a>
        <span style={{ ...CHIP, background: "#eef0f4", color: "#3a3f4a" }}>{b.role === "gc" ? "GC" : "EC"}</span>
        <span style={resultChip(b)}>{b.resultLabel}</span>
        <span style={{ fontSize: 11.5, color: b.needsRev ? "#9a6a00" : "#5b616e", fontWeight: b.needsRev ? 600 : 400 }}>{b.statusText}</span>
        {b.noEmail && (
          <span title={BID_SEND_COPY.noEmailTitle} style={{ ...CHIP, background: "#fdf6e7", color: "#7a5a12" }}>
            {BID_SEND_COPY.noEmailChip}
          </span>
        )}
        {b.opensText && (
          <span title={b.opensTitle} style={{ ...CHIP, background: "#eef6f0", color: "#1e6b34" }}>
            {b.opensText}
          </span>
        )}
        {/* #348 2b-i — the estimate addressed to this bidder, rendered on demand; any bidder (pending, awarded, lost) can need a copy. */}
        <button
          type="button"
          aria-label={pdfBusy ? undefined : `Download PDF — ${b.companyName}`}
          aria-busy={pdfBusy}
          disabled={pdfBusy}
          onClick={() => void downloadPdf()}
          style={{ fontFamily: "var(--font-ui)", fontSize: 11.5, fontWeight: 600, marginLeft: "auto", background: "none", border: "none", padding: 0, color: "var(--accent)", cursor: pdfBusy ? "default" : "pointer", opacity: pdfBusy ? 0.7 : 1 }}
        >
          {pdfBusy ? "Preparing PDF…" : "Download PDF"}
        </button>
        {/* Announced to screen readers while the render runs (the button's own label goes quiet when busy). */}
        <span aria-live="polite" style={SR_ONLY}>
          {pdfBusy ? `Preparing the PDF for ${b.companyName}…` : ""}
        </span>
      </div>
      {b.failedText && (
        <div role="alert" style={{ fontSize: 11.5, color: "#b42318" }}>
          {b.failedText}
        </div>
      )}
      {pdfError && (
        <div role="alert" style={{ fontSize: 11.5, color: "#b42318" }}>
          {pdfError}
        </div>
      )}
      {(b.contactName || b.contactEmail) && (
        <div style={{ fontSize: 11.5, color: "#5b616e" }}>
          {b.contactName}
          {b.contactEmail && <span style={{ fontFamily: "var(--font-mono)", marginLeft: b.contactName ? 8 : 0 }}>{b.contactEmail}</span>}
        </div>
      )}
      {b.confirmation && <div style={{ fontSize: 11.5, color: "#5b616e" }}>Confirmation: {b.confirmation}</div>}
      {edit && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 11.5, color: "#5b616e" }}>
            Submit via{" "}
            <select aria-label={`Submit via — ${b.companyName}`} value={b.submitVia} disabled={busy} onChange={(e) => onPatch(b.id, { submitVia: e.target.value })} style={FIELD}>
              <option value="email">Email</option>
              <option value="website">Their bid website</option>
            </select>
          </label>
          {b.submitVia === "website" && (
            <>
              <input
                key={`url-${b.bidSiteUrl}`}
                aria-label={`Bid site link — ${b.companyName}`}
                placeholder="https://…"
                defaultValue={b.bidSiteUrl}
                disabled={urlSaving || walking}
                onBlur={(e) => e.target.value.trim() !== b.bidSiteUrl && onPatch(b.id, { bidSiteUrl: e.target.value }, "bidSiteUrl")}
                style={{ ...FIELD, width: 200 }}
              />
              {b.bidSiteUrl && (
                <a href={b.bidSiteUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11.5, fontWeight: 600 }}>
                  Open bid site ↗
                </a>
              )}
            </>
          )}
          <input
            key={`no-${b.gcBidNo}`}
            aria-label={`GC bid number — ${b.companyName}`}
            placeholder="GC bid #"
            defaultValue={b.gcBidNo}
            disabled={noSaving || walking}
            onBlur={(e) => e.target.value.trim() !== b.gcBidNo && onPatch(b.id, { gcBidNo: e.target.value }, "gcBidNo")}
            style={{ ...FIELD, width: 100 }}
          />
        </div>
      )}
      {!edit && b.submitVia === "website" && b.bidSiteUrl && (
        <a href={b.bidSiteUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11.5, fontWeight: 600 }}>
          Open bid site ↗
        </a>
      )}
      {(canEmail || panel.canCopyLink) && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          {canEmail && (
            <button
              type="button"
              aria-label={`${b.sendLabel} — ${b.companyName}`}
              disabled={busy}
              onClick={() => onSend(b)}
              style={{ ...BTN, background: "var(--accent)", color: "#fff" }}
            >
              {b.sendLabel}
            </button>
          )}
          {panel.canCopyLink && (
            <button type="button" aria-label={`Copy link — ${b.companyName}`} disabled={linkBusy || walking} onClick={() => void copyLink()} style={BTN}>
              {BID_SEND_COPY.copyLink}
            </button>
          )}
          {linkNote && (
            <span role="status" style={{ fontSize: 11.5, color: "#5b616e" }}>
              {linkNote}
            </span>
          )}
          {linkError && (
            <span role="alert" style={{ fontSize: 11.5, color: "#b42318" }}>
              {linkError}
            </span>
          )}
        </div>
      )}
      {edit && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          {b.result === "pending" && b.submitVia === "website" && (
            <button type="button" aria-label={`Mark submitted — ${b.companyName}`} disabled={busy} onClick={() => onSubmitted(b)} style={BTN}>
              {b.needsRev ? `Mark Rev ${panel.rev} submitted` : "Mark submitted"}
            </button>
          )}
          <select
            aria-label={`Result — ${b.companyName}`}
            value={b.result}
            disabled={busy || locked}
            onChange={(e) => onPatch(b.id, { result: e.target.value })}
            style={FIELD}
          >
            {locked ? (
              <option value={b.result}>{b.resultLabel}</option>
            ) : (
              <>
                <option value="pending">Pending</option>
                <option value="withdrew">Withdrew</option>
                <option value="no_bid">No bid</option>
              </>
            )}
          </select>
          {panel.canAward && b.result === "pending" && (
            <button type="button" aria-label={`Award — ${b.companyName}`} disabled={busy} onClick={() => onAward(b)} style={{ ...BTN, background: "var(--accent)", color: "#fff" }}>
              Award
            </button>
          )}
        </div>
      )}
    </li>
  );
}
