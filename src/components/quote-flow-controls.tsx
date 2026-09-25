"use client";

import Link from "next/link";
import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  CHANGE_TYPE_DISABLED_HINT,
  canChangeType,
  wonEditMessage,
  type WonEditField,
} from "@/app/(app)/quotes/new/handoff";

/**
 * #160 / D205 — "Change type" for every quote builder. A draft links to the
 * intake in replace mode; anything else renders disabled with the hint.
 */
export function ChangeTypeControl({
  quoteId,
  status,
  tone = "light",
}: {
  quoteId: string;
  status: string;
  tone?: "light" | "dark";
}) {
  const dark = tone === "dark";
  const base: CSSProperties = {
    display: "inline-block",
    fontSize: 11.5,
    fontWeight: 600,
    fontFamily: "var(--font-ui)",
    color: dark ? "#c9cdd4" : "#5b616e",
    background: dark ? "transparent" : "#fff",
    border: `1px solid ${dark ? "#3a3e46" : "#e4e7ec"}`,
    borderRadius: 7,
    padding: "3px 9px",
    textDecoration: "none",
    whiteSpace: "nowrap",
  };
  if (!canChangeType(status)) {
    return (
      <span aria-disabled="true" title={CHANGE_TYPE_DISABLED_HINT} style={{ ...base, opacity: 0.45, cursor: "not-allowed" }}>
        Change type
      </span>
    );
  }
  return (
    <Link href={`/quotes/new?replaces=${encodeURIComponent(quoteId)}`} style={base}>
      Change type
    </Link>
  );
}

export type WonEditGuard = {
  /**
   * Gate an edit to `field`. Not won (or already confirmed once this field
   * this session): returns true immediately — the caller applies the edit
   * itself, same as before. Won and not yet confirmed: stashes `run`,
   * returns false, and renders `prompt` below — nothing changes until the
   * user answers it.
   */
  guard: (field: WonEditField, run: () => void) => boolean;
  /** Inline confirm banner for whichever field is pending, or null when
   *  idle. Render once, near the guarded fields. */
  prompt: ReactNode;
};

const PROMPT_WRAP: CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 8,
  marginTop: 2,
  padding: "8px 10px",
  fontSize: 12,
  lineHeight: 1.4,
  color: "#8a6d1f",
  background: "#fdf8ee",
  border: "1px solid #f0e2bd",
  borderRadius: 8,
};
const PROMPT_CHANGE: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 11.5,
  fontWeight: 600,
  color: "#fff",
  background: "#b4863a",
  border: "none",
  borderRadius: 6,
  padding: "4px 10px",
  cursor: "pointer",
};
const PROMPT_CANCEL: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 11.5,
  fontWeight: 600,
  color: "#8a6d1f",
  background: "none",
  border: "1px solid #f0e2bd",
  borderRadius: 6,
  padding: "4px 10px",
  cursor: "pointer",
};

/**
 * D206 — before changing customer, venue or contact on a WON quote, confirm
 * once per field (the spawned project/job keeps the old value). Warn, don't
 * block; not-won quotes pass straight through.
 *
 * #178 — window.confirm() silently returns false with NO dialog at all in
 * this app's Capacitor iOS/Android shells (D96/D127), so a guarded edit used
 * to just do nothing with no explanation. This stashes the pending edit and
 * renders an inline "Change it" / "Cancel" notice instead — the same pattern
 * the Estimator uses for this same warning (estimator-client.tsx's
 * guardWonMeta/wonMetaGuard); wonEditMessage keeps the copy identical.
 */
export function useWonEditGuard(status: string): WonEditGuard {
  const acked = useRef<Set<WonEditField>>(new Set());
  const [pending, setPending] = useState<{ field: WonEditField; run: () => void } | null>(null);

  const guard = (field: WonEditField, run: () => void): boolean => {
    if (status !== "won" || acked.current.has(field)) return true;
    setPending({ field, run });
    return false;
  };

  const prompt = pending ? (
    <div style={PROMPT_WRAP}>
      <span style={{ flex: 1, minWidth: 160 }}>{wonEditMessage(pending.field)}</span>
      <button
        type="button"
        onClick={() => {
          acked.current.add(pending.field);
          const run = pending.run;
          setPending(null);
          run();
        }}
        style={PROMPT_CHANGE}
      >
        Change it
      </button>
      <button type="button" onClick={() => setPending(null)} style={PROMPT_CANCEL}>
        Cancel
      </button>
    </div>
  ) : null;

  return { guard, prompt };
}
