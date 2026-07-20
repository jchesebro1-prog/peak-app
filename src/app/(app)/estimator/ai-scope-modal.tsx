"use client";

import { ACCENT_INK, ACCENT_SOFT, ConfigModal, LBL } from "./est-ui";

/** A drafted quote line (description / qty / unit — never a price, D6 guardrail).
 *  Lived in lib/ai/features until D89 removed the AI layer; the rules-based
 *  scope flow (S12/D86) is the only producer now. */
export type DraftedLine = { description: string; qty: number; unit: string };

/**
 * Scope review panel (S12/D83 — rules-based). Shows the scope paragraph
 * assembled deterministically from the linked survey/inspection's captured
 * fields, for the estimator to review and insert into the quote note. Line
 * items are always added manually (Jeff's call); the legacy suggested-lines
 * list renders only if a caller ever supplies lines. Nothing here writes to
 * the quote directly. Modeled on the configurator modals (curtain-modal.tsx).
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
      icon={
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3l1.9 6.1L20 11l-6.1 1.9L12 19l-1.9-6.1L4 11l6.1-1.9L12 3z" />
        </svg>
      }
      title="Draft from survey/inspection"
      sub={<>From {sourceLabel} · review before adding</>}
      onClose={onClose}
      footerLeft={
        <span style={{ fontSize: 11.5, color: "#8c919c" }}>
          Assembled from the record&apos;s captured fields — edit it like any
          note. You add the items and set every price.
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
          Assembling the scope of work…
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

          {/* suggested lines (legacy — the rules path sends none) */}
          {lines != null && lines.length > 0 && (
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
            {(
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
          )}
        </>
      )}
    </ConfigModal>
  );
}
