"use client";
/**
 * #284 — the quote's one next-step control: a status pill, the primary
 * action (Submit for approval / Send to customer → / Approve & send →), Send
 * back… for approvers, and a ⋯ menu for the rest (Withdraw, Assign to…,
 * Attest approval…, Submit for approval anyway, #287 Approve only (owner
 * sends)). The view is decided on the server
 * (quoteNextStepFor); this only renders it and dispatches the guarded
 * actions. Client-safe: no store, ops or session imports — only the
 * "use server" actions file and types. The modals portal to document.body
 * so a sticky toolbar's stacking context (z 20) can't trap them under the nav.
 */
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  nsApproveAction,
  nsAttestAction,
  nsSendAction,
  nsSendBackAction,
  nsSubmitAction,
  nsWithdrawAction,
  type NextStepSync,
} from "@/app/(app)/quotes/review-actions";
import type { NextStepAction, NextStepTone, QuoteNextStepView } from "@/lib/quote-next-step";

type Props = {
  quoteId: string;
  view: QuoteNextStepView;
  /** "toolbar" = the Estimator's dark header; "panel" = light surfaces (hub, phone). */
  variant: "toolbar" | "panel";
  /** Show only the approver's Approve & send / Send back / Approve only (the Estimator's phone preview). */
  approverOnly?: boolean;
  /** Called with every server result; default = router.refresh(). */
  onSync?: (r: NextStepSync) => void;
  /** Report a refusal; default = an inline red line under the control. */
  onError?: (msg: string) => void;
  /** Runs before any action (the Estimator saves unsaved edits first): resolves to the
   *  saved quote's `updatedAt` (#287 — that version is now the one shown), or false to abort.
   *  Skipped for the in-review decisions (Approve & send, Approve only, Send
   *  back): an approver decides the version they were shown (view.asOf), and
   *  saving first would bump updatedAt and refuse it. */
  beforeAction?: () => Promise<number | false>;
  /** Pill suffix " · as last saved" while the form has unsaved edits. */
  savedOnly?: boolean;
  /** Disables every button (the Estimator: a status change or tier lookup is in flight). */
  disabled?: boolean;
};

const TONE: Record<NextStepTone, { bg: string; ink: string }> = {
  draft: { bg: "#f4f5f7", ink: "#5b616e" },
  review: { bg: "#eef3fc", ink: "#3155a8" },
  changes: { bg: "#fdf1ec", ink: "#b4543a" },
  approved: { bg: "#ecf6f0", ink: "#1f7a52" },
  stale: { bg: "#fbf3dd", ink: "#8a6d1f" },
};

const BTN: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  fontWeight: 600,
  border: "none",
  borderRadius: 8,
  padding: "9px 15px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const MENU_ITEM: CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  fontWeight: 500,
  color: "#16181d",
  background: "transparent",
  border: "none",
  padding: "8px 12px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

/* Modal chrome — the Estimator's attest / request-changes modals, copied. */
const OVERLAY: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(16,22,30,.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 28,
  zIndex: 80,
};
const CARD: CSSProperties = {
  width: 460,
  maxWidth: "100%",
  background: "#fff",
  borderRadius: 15,
  boxShadow: "0 24px 70px rgba(0,0,0,.34)",
  overflow: "hidden",
  color: "#16181d",
  textAlign: "left",
};
const HEAD: CSSProperties = { padding: "17px 22px", borderBottom: "1px solid #f0f1f4", fontSize: 16, fontWeight: 600 };
const INTRO: CSSProperties = { fontSize: 12.5, color: "#5b616e", marginBottom: 11, lineHeight: 1.5 };
const AREA: CSSProperties = {
  width: "100%",
  minHeight: 96,
  border: "1px solid #e4e7ec",
  borderRadius: 9,
  padding: "11px 13px",
  fontSize: 13.5,
  fontFamily: "var(--font-ui)",
  resize: "vertical",
  outline: "none",
  boxSizing: "border-box",
};
const FOOT: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 9,
  padding: "14px 22px",
  borderTop: "1px solid #f0f1f4",
};
const CANCEL: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#5b616e",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  padding: "10px 12px",
};
const confirmBtn = (enabled: boolean, on: string, off: string): CSSProperties => ({
  fontSize: 13,
  fontWeight: 600,
  color: "#fff",
  background: enabled ? on : off,
  border: "none",
  borderRadius: 9,
  padding: "10px 18px",
  cursor: enabled ? "pointer" : "not-allowed",
});

export function QuoteNextStep({ quoteId, view, variant, approverOnly, onSync, onError, beforeAction, savedOnly, disabled }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [menu, setMenu] = useState<"closed" | "menu" | "assign">("closed");
  const [modal, setModal] = useState<null | "sendBack" | "attest">(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const menuRef = useRef<HTMLSpanElement>(null);
  const titleId = useId();

  // The ⋯ menu closes on an outside click and on Escape; Escape also closes a modal.
  useEffect(() => {
    if (menu === "closed" && !modal) return;
    const onDown = (e: MouseEvent) => {
      if (menu !== "closed" && menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu("closed");
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenu("closed");
      setModal(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu, modal]);

  if (approverOnly && !view.approverMode) return null;

  const report = (msg: string) => {
    if (onError) onError(msg);
    else setErr(msg);
  };

  /** `fn(shown)` gets the version the viewer is deciding: view.asOf, or — #287 —
   *  the pre-save's own `updatedAt`, since the viewer's just-saved edits are then
   *  the version shown. `versioned`: the action carries it. */
  const run = (fn: (shown: number) => Promise<NextStepSync>, opts: { skipBefore?: boolean; versioned?: boolean } = {}) => {
    setMenu("closed");
    setErr(null);
    startTransition(async () => {
      try {
        let shown = view.asOf;
        if (!opts.skipBefore && beforeAction) {
          const savedAt = await beforeAction();
          if (savedAt === false) return;
          shown = savedAt;
        }
        const res = await fn(shown);
        // A refused versioned action keeps the version the viewer was shown:
        // handing the fresh asOf to an onSync caller (the Estimator keeps its form;
        // only a reload shows the new content) would let a second click decide
        // content this screen never loaded. The default router.refresh re-renders
        // the page with the current version, so it needs no such guard.
        const keepShown = !!opts.skipBefore || !!opts.versioned;
        const r = !res.ok && keepShown && res.next ? { ...res, next: { ...res.next, asOf: shown } } : res;
        if (!r.ok) report(r.error || "That didn't go through.");
        (onSync ?? (() => router.refresh()))(r);
      } catch (e) {
        // A dropped connection or a thrown action must not reach the error boundary.
        console.error("[QuoteNextStep]", e);
        report("That didn't go through — check your connection and try again.");
      }
    });
  };

  const openModal = (m: "sendBack" | "attest") => {
    setMenu("closed");
    setNote("");
    setModal(m);
  };
  const closeModal = () => {
    setModal(null);
    setNote("");
  };
  const confirmModal = () => {
    const text = note.trim();
    if (!text || !modal) return;
    const m = modal;
    closeModal();
    if (m === "sendBack") run(() => nsSendBackAction(quoteId, text, view.asOf), { skipBefore: true });
    else run(() => nsAttestAction(quoteId, text));
  };

  const dispatch = (action: NextStepAction) => {
    switch (action) {
      case "submit":
        return run(() => nsSubmitAction(quoteId, null));
      case "send":
        // #287: Approve & send → decides the shown version with no pre-save (like Approve);
        // a non-owner's Send carries it too (after a pre-save, the version it just stored).
        if (view.approverMode) return run(() => nsSendAction(quoteId, view.asOf), { skipBefore: true });
        if (!view.viewerIsOwner) return run((shown) => nsSendAction(quoteId, shown), { versioned: true });
        return run(() => nsSendAction(quoteId));
      case "approve":
        // In review: the shown version, no pre-save. #287 Approve only on a draft saves the approver's edits first.
        if (view.approverMode) return run(() => nsApproveAction(quoteId, view.asOf), { skipBefore: true });
        return run((shown) => nsApproveAction(quoteId, shown), { versioned: true });
      case "withdraw":
        return run(() => nsWithdrawAction(quoteId));
      case "assign":
        return setMenu("assign");
      case "sendBack":
        return openModal("sendBack");
      case "attest":
        return openModal("attest");
    }
  };

  // #287: the phone approver mode shows the in-review actions — Approve & send, Send back, Approve only.
  const primary = view.primary && (!approverOnly || view.approverMode) ? view.primary : null;
  const sendBack = view.secondary.find((s) => s.action === "sendBack") || null;
  const menuItems = approverOnly ? view.secondary.filter((s) => s.action === "approve") : view.secondary.filter((s) => s.action !== "sendBack");
  const tone = TONE[view.pill.tone] || TONE.draft;
  const showPill = !approverOnly && view.pill.label !== "";
  const busy = pending || !!disabled;
  const dots: CSSProperties =
    variant === "toolbar"
      ? { background: "#2b2e35", color: "#cfd3da" }
      : { background: "#fff", border: "1px solid #e4e7ec", color: "#3a3f4a" };

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 4, verticalAlign: "middle" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {showPill && (
          <span
            title={view.pill.title || undefined}
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 12,
              fontWeight: 600,
              color: tone.ink,
              background: tone.bg,
              borderRadius: 999,
              padding: "5px 11px",
              whiteSpace: "nowrap",
            }}
          >
            {view.pill.label + (savedOnly ? " · as last saved" : "")}
          </span>
        )}
        {primary && (
          <button
            type="button"
            disabled={busy}
            onClick={() => dispatch(primary.action)}
            style={{
              ...BTN,
              color: "#fff",
              background: primary.action === "submit" ? "#3155a8" : "#1f7a52",
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.6 : 1,
            }}
          >
            {primary.label}
          </button>
        )}
        {sendBack && (
          <button
            type="button"
            disabled={busy}
            onClick={() => dispatch("sendBack")}
            style={{
              ...BTN,
              color: "#b4543a",
              background: "#f9ece8",
              border: "1px solid #f0d6cd",
              padding: "8px 14px",
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.6 : 1,
            }}
          >
            {sendBack.label}
          </button>
        )}
        {menuItems.length > 0 && (
          <span ref={menuRef} style={{ position: "relative", display: "inline-flex" }}>
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={menu !== "closed"}
              aria-label="More approval actions"
              disabled={busy}
              onClick={() => setMenu((m) => (m === "closed" ? "menu" : "closed"))}
              style={{
                ...BTN,
                ...dots,
                padding: "9px 12px",
                cursor: busy ? "not-allowed" : "pointer",
                opacity: busy ? 0.6 : 1,
              }}
            >
              ⋯
            </button>
            {menu !== "closed" && (
              <span
                role="menu"
                style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  right: 0,
                  zIndex: 40,
                  minWidth: 210,
                  display: "flex",
                  flexDirection: "column",
                  padding: "4px 0",
                  background: "#fff",
                  border: "1px solid #e4e7ec",
                  borderRadius: 9,
                  boxShadow: "0 12px 28px rgba(0,0,0,.18)",
                }}
              >
                {menu === "menu" &&
                  menuItems.map((s) => (
                    <button key={s.action} type="button" role="menuitem" disabled={busy} onClick={() => dispatch(s.action)} style={MENU_ITEM}>
                      {s.label}
                    </button>
                  ))}
                {menu === "assign" && (
                  <>
                    <span style={{ padding: "6px 12px 4px", fontSize: 11.5, fontWeight: 600, color: "#8c919c" }}>Assign to…</span>
                    {view.reviewers.length === 0 ? (
                      <span style={{ padding: "8px 12px", fontSize: 13, color: "#5b616e" }}>No other approvers</span>
                    ) : (
                      view.reviewers.map((name) => (
                        <button
                          key={name}
                          type="button"
                          role="menuitem"
                          disabled={busy}
                          onClick={() => run(() => nsSubmitAction(quoteId, name))}
                          style={MENU_ITEM}
                        >
                          {name}
                        </button>
                      ))
                    )}
                  </>
                )}
              </span>
            )}
          </span>
        )}
      </span>
      {err && <span style={{ fontSize: 12, fontWeight: 600, color: "#9a2f22" }}>{err}</span>}

      {modal &&
        typeof document !== "undefined" &&
        createPortal(
        <div
          className="est-modalwrap"
          onClick={(e) => {
            // React bubbles portal events to the control's ancestors (the toolbar) — stop here.
            e.stopPropagation();
            closeModal();
          }}
          style={OVERLAY}
        >
          <div
            className="est-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(e) => e.stopPropagation()}
            style={CARD}
          >
            <div id={titleId} style={HEAD}>{modal === "sendBack" ? "Send back for changes" : "Attest approval"}</div>
            <div style={{ padding: "20px 22px" }}>
              <div style={INTRO}>
                {modal === "sendBack"
                  ? "Tell the estimator what needs to change before this can be approved."
                  : "Reviews here often happen by phone or on a call, not in the app. If that already happened, name who reviewed it and how — this note is required and becomes the approval record."}
              </div>
              <textarea
                className="est-field"
                autoFocus
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={modal === "sendBack" ? "e.g. Re-check the rigging load math…" : 'e.g. "Reviewed by Jeff on a Teams call, 2026-08-01"'}
                style={AREA}
              />
            </div>
            <div style={FOOT}>
              <button type="button" onClick={closeModal} style={CANCEL}>
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmModal}
                disabled={!note.trim() || busy}
                style={modal === "sendBack" ? confirmBtn(!!note.trim() && !busy, "#b4543a", "#dba99b") : confirmBtn(!!note.trim() && !busy, "#1f7a52", "#9cc7ae")}
              >
                {modal === "sendBack" ? "Send back for changes" : "Record approval"}
              </button>
            </div>
          </div>
        </div>,
          document.body
        )}
    </div>
  );
}
