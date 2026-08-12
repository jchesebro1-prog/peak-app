"use client";

import { useEffect } from "react";

/**
 * Last-resort recovery for authenticated screens and their Server Actions.
 * Expected action errors are returned inline where a screen has local state;
 * this boundary keeps a rare exhausted-id mint or page-load sync failure from
 * becoming a raw framework crash with no user recovery path.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Quartzite screen error", error);
  }, [error]);

  return (
    <main className="pk-content" style={{ maxWidth: 620, margin: "48px auto" }}>
      <section className="pk-card" style={{ padding: 28 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 650 }}>That change couldn’t be completed</h1>
        <p style={{ margin: "9px 0 20px", color: "#6f7580", fontSize: 13.5, lineHeight: 1.55 }}>
          Your previous screen is still available. Try the operation again; if it repeats,
          note what you were creating so an administrator can investigate it.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{ border: 0, borderRadius: 7, padding: "8px 14px", background: "var(--accent)", color: "#fff", font: "600 13px var(--font-ui)", cursor: "pointer" }}
        >
          Try again
        </button>
      </section>
    </main>
  );
}
