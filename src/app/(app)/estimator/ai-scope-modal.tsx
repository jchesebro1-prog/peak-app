"use client";

import type { DraftedLine } from "@/lib/ai/features";
import { ACCENT_INK, ACCENT_SOFT, ConfigModal, LBL } from "./est-ui";

/**
 * AI scope review panel (Phase 8, D4). Renders the AI-drafted scope paragraph
 * and suggested line items (description / qty / unit — NO price) for the
 * estimator to review. Modeled on the configurator modals (curtain-modal.tsx).
 *
 * GUARDRAIL (D6): the AI never sets a price. "Insert scope" drops the paragraph
 * into the quote note; each "Add" routes the line through the estimator's own
 * add-line path with the price left blank/zero for the estimator to fill in.
 * Nothing here writes to the quote directly.
 */

export default function AiScopeModal({
  sourceLabel,
  targetSection,
  busy,
  error,
  scope,
  lines,
  scopeInserted,
  addedLines,
  onInsertScope,
  onAddLine,
  onRetry,
  onClose,
}: {
  sourceLabel: string;
  targetSection: string;
  busy: boolean;
  error: string | null;
  scope: string | null;
  lines: DraftedLine[] | null;
  scopeInserted: boolean;
  addedLines: Record<number, boolean>;
  onInsertScope: () => void;
  onAddLine: (index: number, line: DraftedLine) => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const hasDraft = !busy && !error && scope != null;

  return (
    <ConfigModal
      width={640}
      icon="✨"
      iconSize={16}
      title="Draft from survey/inspection"
      sub={<>From {sourceLabel} · review before adding</>}
      onClose={onClose}
      footerLeft={
        <span style={{ fontSize: 11.5, color: "#8c919c" }}>
          AI drafts scope &amp; items only — you set every price.
        </span>
      }
      footerRight={
        <button
          type="button"
          onClick={onClose}
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 13,
            fontWeight: 600,
            border: "1px solid #e4e7ec",
            borderRadius: 9,
            padding: "10px 20px",
            background: "#fff",
            color: "#5b616e",
            cursor: "pointer",
          }}
        >
          Done
        </button>
      }
    >
      {busy && (
        <div style={{ padding: "28px 4px", textAlign: "center", color: "#8c919c", fontSize: 13 }}>
          Drafting scope and line items… ✨
        </div>
      )}

      {!busy && error && (
        <div style={{ padding: "6px 0" }}>
          <div
            style={{
              padding: "12px 14px",
              borderRadius: 10,
              background: "#fef2f2",
              border: "1px solid #f7d4d4",
              color: "#b4272b",
              fontSize: 13,
            }}
          >
            {error}
          </div>
          <button
            type="button"
            onClick={onRetry}
            style={{
              marginTop: 12,
              fontFamily: "var(--font-ui)",
              fontSize: 13,
              fontWeight: 600,
              border: "none",
              borderRadius: 9,
              padding: "9px 16px",
              background: "var(--accent)",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      )}

      {hasDraft && (
        <>
          {/* scope paragraph */}
          <div style={{ marginBottom: 20 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                marginBottom: 6,
              }}
            >
              <label style={{ ...LBL, marginBottom: 0 }}>Scope of work</label>
              <button
                type="button"
                onClick={onInsertScope}
                disabled={scopeInserted}
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 8,
                  padding: "6px 12px",
                  cursor: scopeInserted ? "default" : "pointer",
                  border: "1px solid " + (scopeInserted ? "#d6f0e0" : "var(--accent)"),
                  background: scopeInserted ? "#eafaf1" : ACCENT_SOFT,
                  color: scopeInserted ? "#1f7a4d" : ACCENT_INK,
                }}
              >
                {scopeInserted ? "Inserted ✓" : "Insert into quote note"}
              </button>
            </div>
            <div
              style={{
                whiteSpace: "pre-wrap",
                fontSize: 13.5,
                lineHeight: 1.55,
                color: "#16181d",
                border: "1px solid #ececf0",
                borderRadius: 10,
                padding: "12px 14px",
                background: "#fafbfc",
              }}
            >
              {scope}
            </div>
          </div>

          {/* suggested lines */}
          <div>
            <label style={LBL}>
              Suggested line items{" "}
              <span
                style={{
                  color: "#c4c9d2",
                  textTransform: "none",
                  letterSpacing: 0,
                  fontWeight: 500,
                }}
              >
                · price blank — added to {targetSection || "the first system"}
              </span>
            </label>
            {!lines || lines.length === 0 ? (
              <div style={{ fontSize: 13, color: "#8c919c", padding: "8px 0" }}>
                No line items were suggested.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {lines.map((ln, i) => {
                  const added = !!addedLines[i];
                  return (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "9px 11px",
                        border: "1px solid #ececf0",
                        borderRadius: 9,
                        background: "#fff",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: "#16181d" }}>{ln.description}</div>
                        <div
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: 11.5,
                            color: "#8c919c",
                            marginTop: 2,
                          }}
                        >
                          {ln.qty} {ln.unit} · price TBD
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onAddLine(i, ln)}
                        disabled={added}
                        style={{
                          fontFamily: "var(--font-ui)",
                          fontSize: 12.5,
                          fontWeight: 600,
                          borderRadius: 8,
                          padding: "7px 14px",
                          flexShrink: 0,
                          cursor: added ? "default" : "pointer",
                          border: "1px solid " + (added ? "#d6f0e0" : "var(--accent)"),
                          background: added ? "#eafaf1" : "var(--accent)",
                          color: added ? "#1f7a4d" : "#fff",
                        }}
                      >
                        {added ? "Added ✓" : "Add"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </ConfigModal>
  );
}
