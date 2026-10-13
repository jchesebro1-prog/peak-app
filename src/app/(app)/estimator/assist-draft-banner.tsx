"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AssistDraftView } from "./types";
import { dismissAssistDraftAction } from "./assist-actions";

/**
 * #334 (D877) — the Build banner on an estimate Assist drafted from an email:
 * a reminder to check every line, a link back to the email, the model's notes
 * and why each line was picked. Styled like the Estimator's informational
 * save notice (estimator-banners.tsx). Dismiss hides it for everyone.
 */
export function AssistDraftBanner({ view }: { view: AssistDraftView | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);
  if (!view || hiddenFor === view.quoteId) return null;
  const ink = "#2b4a7a";
  return (
    <div
      role="status"
      style={{
        margin: "0 0 12px",
        padding: "10px 14px",
        background: "#eef3fb",
        border: "1px solid #cddaf0",
        borderRadius: 8,
        color: ink,
        fontSize: 12.5,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ fontWeight: 600 }}>
          Drafted from an email by Assist — check every line before submitting.{" "}
          <a href={"/inbox?thread=" + encodeURIComponent(view.threadId)} style={{ color: "inherit", textDecoration: "underline" }}>
            Open the email
          </a>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await dismissAssistDraftAction(view.quoteId);
              if (r.ok) {
                setHiddenFor(view.quoteId);
                router.refresh();
              }
            } finally {
              setBusy(false);
            }
          }}
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: ink,
            background: "transparent",
            border: "none",
            cursor: busy ? "default" : "pointer",
            padding: "2px 4px",
            flexShrink: 0,
            opacity: busy ? 0.6 : 1,
          }}
        >
          Dismiss
        </button>
      </div>
      {view.notes && <p style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{view.notes}</p>}
      {view.reasons.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Why these parts ({view.reasons.length})</summary>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {view.reasons.map((r, i) => (
              <li key={i}>
                {r.desc ? <strong style={{ fontWeight: 600 }}>{r.desc}</strong> : null}
                {r.desc ? " — " : null}
                {r.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
