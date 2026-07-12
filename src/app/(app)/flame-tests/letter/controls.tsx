"use client";

/**
 * Print button for the flame-test quote letter (Flame Test Letter.dc.html
 * toolbar). window.print() is the only genuinely-client bit; the rest of the
 * toolbar (Quotes / Edit-quote links) are server <Link>s in page.tsx.
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
