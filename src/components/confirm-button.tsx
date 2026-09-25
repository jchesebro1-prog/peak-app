"use client";

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";

export function ConfirmButton({
  onConfirm,
  label = "Delete",
  confirmLabel = "Confirm delete",
  pendingLabel = "Deleting…",
  className = "pk-btn-danger",
  style,
  disabled,
  title,
  ariaLabel,
}: {
  onConfirm: () => void | Promise<unknown>;
  label?: ReactNode;
  confirmLabel?: ReactNode;
  pendingLabel?: ReactNode;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
}) {
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!armed || pending) return;
    const timer = setTimeout(() => setArmed(false), 5000);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setArmed(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [armed, pending]);

  const stop = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const confirm = async (e: MouseEvent) => {
    stop(e);
    setPending(true);
    try {
      await onConfirm();
      if (mounted.current) setArmed(false);
    } catch (err) {
      if (mounted.current) {
        setArmed(false);
        setError(err instanceof Error ? err.message : "Delete failed");
      }
    } finally {
      if (mounted.current) setPending(false);
    }
  };

  if (armed) {
    return (
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <button type="button" className={className} style={style} disabled={pending} title={title} aria-label={ariaLabel} onClick={confirm}>
          {pending ? pendingLabel : confirmLabel}
        </button>
        <button type="button" className="pk-btn-outline" style={{ fontSize: 12 }} disabled={pending} onClick={(e) => { stop(e); setArmed(false); }}>
          Cancel
        </button>
      </span>
    );
  }

  return (
    <>
      <button type="button" className={className} style={style} disabled={disabled} title={title} aria-label={ariaLabel} onClick={(e) => { stop(e); setError(null); setArmed(true); }}>
        {label}
      </button>
      {error && <span role="alert" style={{ color: "var(--danger, #b42318)", fontSize: 12 }}>{error}</span>}
    </>
  );
}
