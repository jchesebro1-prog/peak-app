"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { refreshPortalQuote } from "./actions";

/** Past `validUntil`, the Accept button is replaced by this (#242 Task 13,
 *  spec §4.5) — re-prices every line at current cost/tier/freight. */
export function RefreshPricingButton({ quoteId }: { quoteId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  const run = () => {
    setError("");
    start(async () => {
      try {
        const r = await refreshPortalQuote(quoteId);
        if (!r.ok) setError(r.error);
        else router.refresh();
      } catch {
        setError("Couldn't refresh pricing — check your connection and try again.");
      }
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <button
        type="button"
        disabled={pending}
        onClick={run}
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: 12,
          fontWeight: 600,
          color: "#fff",
          background: "var(--accent)",
          border: "none",
          borderRadius: 8,
          padding: "8px 12px",
          cursor: pending ? "not-allowed" : "pointer",
          opacity: pending ? 0.6 : 1,
          whiteSpace: "nowrap",
        }}
      >
        {pending ? "Refreshing…" : "Refresh pricing"}
      </button>
      {error && (
        <div role="alert" style={{ fontSize: 11, fontWeight: 600, color: "#b03a2e", maxWidth: 220, textAlign: "right" }}>
          {error}
        </div>
      )}
    </div>
  );
}
