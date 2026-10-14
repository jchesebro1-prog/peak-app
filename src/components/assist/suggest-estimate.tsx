"use client";

/**
 * Estimate suggestion — the one entry-point control (spec 2026-10-13 §3):
 * "Suggest estimate", or "Suggestion ready → Open" + "Suggest again" when the
 * source already has one (computed on the server, `suggestEntryFor`). The
 * busy label stays up and the click stays guarded until the Estimator opens.
 * Imports only pure modules and types.
 */
import { useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SUGGEST_BUSY_LABEL, SUGGEST_START_ERROR, startSuggestion, type SuggestStartSource } from "@/lib/assist/suggest-client";

export const SUGGEST_TITLE = "Assist — suggests systems and parts from this record; you build the estimate";

/** Busy state + a ref double-click guard around `startSuggestion`. */
export function useSuggestEstimate(source: SuggestStartSource) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const start = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await startSuggestion(source, router);
      if (r.ok) return; // stay busy (and guarded) while the Estimator opens
      setError(r.error);
    } catch {
      setError(SUGGEST_START_ERROR);
    }
    inFlight.current = false;
    setBusy(false);
  };
  return { busy, error, start };
}

const BTN: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 11.5,
  fontWeight: 600,
  color: "#5b616e",
  background: "#fff",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "6px 10px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const LINK: CSSProperties = { color: "var(--accent)", fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" };

export default function SuggestEstimate({
  source,
  readyHref,
  disabled = false,
  disabledTitle,
  buttonStyle,
  linkStyle,
  style,
}: {
  source: SuggestStartSource;
  /** The source's latest suggestion (server: `suggestEntryFor`); null when none. */
  readyHref: string | null;
  /** e.g. unsaved edits — the route reads the saved record. */
  disabled?: boolean;
  disabledTitle?: string;
  buttonStyle?: CSSProperties;
  linkStyle?: CSSProperties;
  style?: CSSProperties;
}) {
  const { busy, error, start } = useSuggestEstimate(source);
  const off = busy || disabled;
  return (
    <span data-testid="suggest-estimate" style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12, ...style }}>
      {readyHref && !busy && (
        <Link href={readyHref} style={{ ...LINK, ...linkStyle }}>
          Suggestion ready → Open
        </Link>
      )}
      <button
        type="button"
        disabled={off}
        title={disabled && disabledTitle ? disabledTitle : SUGGEST_TITLE}
        onClick={() => void start()}
        style={{ ...BTN, ...buttonStyle, opacity: off ? 0.6 : 1, cursor: off ? "default" : "pointer" }}
      >
        {busy ? SUGGEST_BUSY_LABEL : readyHref ? "Suggest again" : "Suggest estimate"}
      </button>
      {error && (
        <span role="alert" style={{ fontSize: 12, color: "#b4543a" }}>
          {error}
        </span>
      )}
    </span>
  );
}
