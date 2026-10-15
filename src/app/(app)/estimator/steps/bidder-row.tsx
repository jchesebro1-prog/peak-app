"use client";

import type { CSSProperties } from "react";
import type { BidderVM, BidPanelVM } from "@/lib/parties/bid-vm";

/** #348 slice 2a — one bidder's row in the Bidders card (presentation only; the card owns the calls). */
export const BTN: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 600, color: "#16181d", background: "#f1f2f5", border: "none", borderRadius: 7, padding: "6px 12px", cursor: "pointer" };
const FIELD: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 12, padding: "4px 6px", border: "1px solid #dcdfe5", borderRadius: 6, background: "#fff" };
const CHIP: CSSProperties = { fontSize: 10.5, fontWeight: 600, borderRadius: 20, padding: "2px 8px", whiteSpace: "nowrap" };

function resultChip(b: BidderVM): CSSProperties {
  if (b.result === "awarded") return { ...CHIP, background: "#e6f4ea", color: "#1e6b34" };
  if (b.result === "lost") return { ...CHIP, background: "#f1f2f5", color: "#6b7280" };
  return { ...CHIP, background: "#f1f2f5", color: "#5b616e" };
}

export function BidderRow({
  b,
  panel,
  busy,
  onPatch,
  onSubmitted,
  onAward,
}: {
  b: BidderVM;
  panel: BidPanelVM;
  busy: boolean;
  onPatch: (partyId: string, patch: Record<string, unknown>) => void;
  onSubmitted: (b: BidderVM) => void;
  onAward: (b: BidderVM) => void;
}) {
  const edit = panel.canEdit;
  const locked = b.result === "awarded" || b.result === "lost";
  return (
    <li style={{ listStyle: "none", border: "1px solid #ececf0", borderRadius: 9, padding: "9px 11px", display: "grid", gap: 7 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <a href={`/companies/${encodeURIComponent(b.companyId)}`} style={{ fontSize: 13, fontWeight: 600, color: "#16181d" }}>
          {b.companyName}
        </a>
        <span style={{ ...CHIP, background: "#eef0f4", color: "#3a3f4a" }}>{b.role === "gc" ? "GC" : "EC"}</span>
        <span style={resultChip(b)}>{b.resultLabel}</span>
        <span style={{ fontSize: 11.5, color: b.needsRev ? "#9a6a00" : "#5b616e", fontWeight: b.needsRev ? 600 : 400 }}>{b.statusText}</span>
      </div>
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
                disabled={busy}
                onBlur={(e) => e.target.value.trim() !== b.bidSiteUrl && onPatch(b.id, { bidSiteUrl: e.target.value })}
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
            aria-label={`GC bid # — ${b.companyName}`}
            placeholder="GC bid #"
            defaultValue={b.gcBidNo}
            disabled={busy}
            onBlur={(e) => e.target.value.trim() !== b.gcBidNo && onPatch(b.id, { gcBidNo: e.target.value })}
            style={{ ...FIELD, width: 100 }}
          />
        </div>
      )}
      {!edit && b.submitVia === "website" && b.bidSiteUrl && (
        <a href={b.bidSiteUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11.5, fontWeight: 600 }}>
          Open bid site ↗
        </a>
      )}
      {edit && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          {b.result === "pending" && (
            <button type="button" disabled={busy} onClick={() => onSubmitted(b)} style={BTN}>
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
            <button type="button" disabled={busy} onClick={() => onAward(b)} style={{ ...BTN, background: "var(--accent)", color: "#fff" }}>
              Award
            </button>
          )}
        </div>
      )}
    </li>
  );
}
