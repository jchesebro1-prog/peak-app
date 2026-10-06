"use client";

import type { CSSProperties } from "react";
import { COVER_SUMMARY_MAX, NOT_INCLUDED_MAX } from "@/lib/estimate-output/fields";

/**
 * #301 slice A — the customer preview sidebar's "Cover & package" block: the
 * quote's Overall summary and Not included list (they print on the cover PDF,
 * never on the estimate PDF). Edits autosave through the Estimator's header
 * autosave and ride every Save.
 */

export type CoverPackagePanelProps = {
  savedQuoteId: string | null;
  canEdit: boolean;
  /** The editor holds changes the saved quote doesn't have yet. */
  dirty: boolean;
  coverSummary: string;
  onCoverSummary: (v: string) => void;
  notIncluded: string;
  onNotIncluded: (v: string) => void;
  notIncludedDefault: string;
};

const sideLabel: CSSProperties = { fontSize: 11, fontWeight: 600, color: "#9aa0ab", textTransform: "uppercase", letterSpacing: ".04em" };
const fieldLabel: CSSProperties = { fontSize: 11.5, fontWeight: 600, color: "#3a3f4a" };
const hint: CSSProperties = { fontSize: 11, color: "#8c919c", lineHeight: 1.45 };
const ta: CSSProperties = { width: "100%", minHeight: 76, resize: "vertical", fontFamily: "var(--font-ui)", fontSize: 12, lineHeight: 1.45, color: "#16181d", border: "1px solid #dfe2e8", borderRadius: 7, padding: "7px 9px", background: "#fff" };
const smallBtn: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 600, color: "#3a3f4a", background: "#f1f2f5", border: "none", borderRadius: 6, padding: "3px 8px", cursor: "pointer" };

export function CoverPackagePanel(p: CoverPackagePanelProps) {
  const atDefault = p.notIncluded.trim() === p.notIncludedDefault.trim();
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 7 }}>
      <span style={sideLabel}>Cover &amp; package</span>
      <span style={fieldLabel}>Overall summary</span>
      <textarea
        aria-label="Overall summary"
        value={p.coverSummary}
        readOnly={!p.canEdit}
        maxLength={COVER_SUMMARY_MAX}
        onChange={(e) => p.onCoverSummary(e.target.value)}
        placeholder="Blank prints “This estimate includes N scopes: …”"
        style={ta}
      />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <span style={fieldLabel}>Not included</span>
        <button
          type="button"
          style={{ ...smallBtn, opacity: !p.canEdit || atDefault ? 0.5 : 1, cursor: !p.canEdit || atDefault ? "default" : "pointer" }}
          disabled={!p.canEdit || atDefault}
          onClick={() => p.onNotIncluded(p.notIncludedDefault)}
          title="Put back the list from Settings → Estimate output"
        >
          Reset to default
        </button>
      </div>
      <textarea
        aria-label="Not included"
        value={p.notIncluded}
        readOnly={!p.canEdit}
        maxLength={NOT_INCLUDED_MAX}
        onChange={(e) => p.onNotIncluded(e.target.value)}
        placeholder="One item per line"
        style={ta}
      />
      <span style={hint}>One item per line — prints as one “Not included:” paragraph on the cover.</span>
    </div>
  );
}
