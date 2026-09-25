"use client";

import Link from "next/link";
import { useRef, type CSSProperties } from "react";
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

/**
 * D206 — before changing customer, venue or contact on a WON quote, confirm
 * once per field (the spawned project/job keeps the old value). Warn, don't
 * block; not-won quotes pass straight through.
 */
export function useWonEditGuard(status: string): (field: WonEditField) => boolean {
  const acked = useRef<Set<WonEditField>>(new Set());
  return (field) => {
    if (status !== "won" || acked.current.has(field)) return true;
    const yes = window.confirm(wonEditMessage(field));
    if (yes) acked.current.add(field);
    return yes;
  };
}
