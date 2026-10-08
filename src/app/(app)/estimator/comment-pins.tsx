"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { NumberedComment } from "@/lib/estimate-review/comments";
import { commentActionLabel, commentTime, REVIEW_UI_COPY } from "@/lib/estimate-review/review-ui";
import { resolveReviewCommentAction } from "./review-actions";
import { ACCENT_INK, ACCENT_SOFT } from "./est-ui";
import type { EstimatorState } from "./use-estimator-state";

/**
 * Phase 4 (spec §11.3) — review comment pins. A "💬 N" badge on a system card
 * (or above the card column for the whole estimate) opens a small popover of
 * that system's open comments, each with an inline Resolve for anyone who can
 * resolve. The comments are the shared `reviewComments` state in the hook.
 */

/** Keep the shared comment list fresh when the tab regains focus (debounced). The mount load is the hook's own. */
export function useCommentsFocusRefresh(s: EstimatorState): void {
  const { loadedId, refreshReviewComments } = s;
  useEffect(() => {
    if (!loadedId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const kick = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refreshReviewComments(), 400);
    };
    window.addEventListener("focus", kick);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", kick);
    };
  }, [loadedId, refreshReviewComments]);
}

/** Resolve one comment through the server action and publish the fresh list; resolves to an error message or null. */
export function useResolveComment(s: EstimatorState): (commentId: string) => Promise<string | null> {
  const { loadedId, setReviewComments } = s;
  return async (commentId: string) => {
    if (!loadedId) return "Save the estimate first.";
    try {
      const r = await resolveReviewCommentAction(loadedId, commentId);
      if (r.ok) {
        setReviewComments(r.comments);
        return null;
      }
      return r.error;
    } catch {
      return "Couldn't resolve that — try again.";
    }
  };
}

const POP_W = 320;

export function CommentPin({
  label,
  system,
  comments,
  mayResolve,
  onResolve,
}: {
  /** Visible text, e.g. "💬 2" or "💬 2 on the whole estimate". */
  label: string;
  /** The system's name (or "the whole estimate") for the accessible name. */
  system: string;
  comments: NumberedComment[];
  /** Whether the viewer may resolve (`canResolve` on their roles) — gates the Resolve buttons. */
  mayResolve: boolean;
  onResolve: (commentId: string) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - POP_W - 8));
      setPos({ top: r.bottom + 6, left });
    };
    place();
    const onDoc = (e: PointerEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDoc, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", onDoc, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  if (comments.length === 0) return null;
  const n = comments.length;

  const resolve = async (id: string) => {
    if (busy) return;
    setBusy(id);
    setErr(null);
    const e = await onResolve(id);
    setBusy(null);
    if (e) setErr(e);
  };

  return (
    <span style={{ display: "inline-flex", flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
      <button
        ref={btnRef}
        type="button"
        aria-expanded={open}
        aria-label={`${n} review comment${n === 1 ? "" : "s"} on ${system}`}
        onClick={() => setOpen((o) => !o)}
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: 11.5,
          fontWeight: 600,
          color: ACCENT_INK,
          background: ACCENT_SOFT,
          border: "none",
          borderRadius: 999,
          padding: "2px 9px",
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </button>
      {open && (
        <div
          ref={popRef}
          role="dialog"
          aria-label={`Review comments on ${system}`}
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            width: POP_W,
            maxHeight: 320,
            overflowY: "auto",
            zIndex: 60,
            background: "#fff",
            border: "1px solid #e4e7ec",
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,.14)",
            padding: 10,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            textAlign: "left",
            cursor: "default",
          }}
        >
          {comments.map(({ n: num, comment }) => (
            <div key={comment.id} style={{ borderBottom: "1px solid #f1f2f5", paddingBottom: 8 }}>
              <div style={{ fontSize: 11, color: "#8c919c" }}>
                <b style={{ fontFamily: "var(--font-mono)", color: ACCENT_INK }}>{num}</b> · {comment.by} · {commentTime(comment.at)}
              </div>
              <div style={{ fontSize: 12.5, color: "#16181d", lineHeight: 1.45, whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginTop: 2 }}>{comment.body}</div>
              {mayResolve && (
                <button
                  type="button"
                  onClick={() => void resolve(comment.id)}
                  disabled={!!busy}
                  aria-label={commentActionLabel("resolve", num)}
                  style={RESOLVE_BTN}
                >
                  {REVIEW_UI_COPY.resolve}
                </button>
              )}
            </div>
          ))}
          {err && (
            <div role="alert" style={{ fontSize: 11.5, color: "#9b3a2a" }}>
              {err}
            </div>
          )}
        </div>
      )}
    </span>
  );
}

const RESOLVE_BTN: CSSProperties = {
  marginTop: 4,
  fontFamily: "var(--font-ui)",
  fontSize: 11.5,
  fontWeight: 600,
  color: ACCENT_INK,
  background: "transparent",
  border: "none",
  padding: 0,
  cursor: "pointer",
};
