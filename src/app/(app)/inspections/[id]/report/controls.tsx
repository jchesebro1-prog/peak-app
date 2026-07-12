"use client";

import { startRenovationQuote } from "../actions";

/** Print / PDF — the prototype's window.print() (screen-only). */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => {
        try {
          window.print();
        } catch {
          /* ignore */
        }
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        fontSize: 13,
        fontWeight: 600,
        color: "#16181d",
        background: "#fff",
        border: "1px solid #e4e7ec",
        borderRadius: 9,
        padding: "10px 15px",
        cursor: "pointer",
        minHeight: 40,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ fontSize: 14 }}>⎙</span> Print / PDF
    </button>
  );
}

/** "Renovation quote →" — spins up a system quote from this inspection and
 *  opens it in the Estimator (server action redirects). */
export function RenovationQuoteButton({ id }: { id: string }) {
  return (
    <form action={startRenovationQuote.bind(null, id)}>
      <button
        type="submit"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          fontSize: 13,
          fontWeight: 600,
          color: "#fff",
          background: "var(--accent)",
          border: "none",
          borderRadius: 9,
          padding: "10px 14px",
          cursor: "pointer",
          minHeight: 40,
          whiteSpace: "nowrap",
        }}
      >
        Renovation quote →
      </button>
    </form>
  );
}
