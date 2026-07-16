"use client";

/**
 * Shared print button for single-page letters (window.print() is the only
 * genuinely-client bit). Mirrors the per-letter PrintButton toolbars.
 */
export function PrintButton({ accent }: { accent: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        try {
          window.print();
        } catch {
          /* no-op */
        }
      }}
      style={{
        fontFamily: "var(--font-ui)",
        fontSize: 12.5,
        fontWeight: 600,
        color: "#fff",
        background: accent,
        border: "none",
        borderRadius: 9,
        padding: "9px 15px",
        cursor: "pointer",
      }}
    >
      Print / Save PDF
    </button>
  );
}
