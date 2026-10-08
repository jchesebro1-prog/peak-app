"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  composerInitial,
  FOLLOW_UP_OPTIONS,
  primaryLabel,
  SEND_STEP_IDS,
  SEND_UI_COPY,
  sendResultMessage,
  sendSync,
  type ComposerFields,
  type SendNotice,
} from "@/lib/estimate-email/send-ui";
import { estimateEmailDefaultsAction, openEstimateInInboxAction, sendEstimateEmailAction } from "../send-actions";
import { ACCENT_INK, ACCENT_SOFT } from "../est-ui";
import type { EstimatorState } from "../use-estimator-state";

const CARD_LABEL = { fontSize: 11, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", marginBottom: 10 } as const;
const FIELD_LABEL: CSSProperties = { display: "block", fontSize: 11, fontWeight: 600, color: "#6b7079", marginBottom: 4 };
const INPUT: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  color: "#16181d",
  background: "#fff",
  border: "1px solid #dfe2e8",
  borderRadius: 8,
  padding: "8px 10px",
};
const SMALL: CSSProperties = { fontSize: 11.5, color: "#5b616e", lineHeight: 1.45 };
const LINK_BTN: CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  fontWeight: 600,
  color: ACCENT_INK,
  cursor: "pointer",
};
const NOTICE_TONE: Record<SendNotice["tone"], CSSProperties> = {
  ok: { background: ACCENT_SOFT, color: ACCENT_INK, border: "1px solid color-mix(in srgb, var(--accent) 30%, #fff)" },
  warn: { background: "#fdf6e7", color: "#7a5a12", border: "1px solid #f0dfb5" },
  error: { background: "#fdf0ee", color: "#9b3a2a", border: "1px solid #f3cfc7" },
};

/** Scroll a Send-step card into view (and focus a control in it, when named). */
function goTo(cardId: string, focusId?: string) {
  const el = document.getElementById(cardId);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  if (focusId) (document.getElementById(focusId) as HTMLElement | null)?.focus({ preventScroll: true });
}

/**
 * Estimator Phase 3 (spec §10.1–10.3) — the Send & track composer: To, Cc,
 * Subject, Body (with the `{link}` placeholder), the two PDF attachments, the
 * follow-up task, and the sender's Gmail state. Send saves unsaved edits
 * first (as the next-step control does) and sends the saved version as
 * `asOf`; the result syncs the quote's status and next step into the editor.
 * Escape hatches: Open in Inbox, Mark sent without emailing (the Status
 * card), Copy link only (the Client link card).
 */
export function SendComposer({ s, collapsible, onSent }: { s: EstimatorState; collapsible: boolean; onSent: () => void }) {
  const { applySync, loadedId, next, pdfDirty, saveNow, setActionError, setGateRefused, status, statusChanging, tierResolving } = s;
  const [fields, setFields] = useState<ComposerFields>(() => composerInitial(null));
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [gmail, setGmail] = useState<{ connected: boolean; from: string } | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [notice, setNotice] = useState<SendNotice | null>(null);
  const [open, setOpen] = useState(!collapsible);

  useEffect(() => {
    if (!loadedId) return;
    let live = true;
    estimateEmailDefaultsAction(loadedId).then(
      (r) => {
        if (!live) return;
        if (r.ok) {
          setFields(composerInitial(r));
          setGmail({ connected: r.gmailConnected, from: r.fromAddress });
          setLoadErr(null);
        } else setLoadErr(r.error);
        setLoaded(true);
      },
      () => {
        if (!live) return;
        setLoadErr(SEND_UI_COPY.failed);
        setLoaded(true);
      }
    );
    return () => {
      live = false;
    };
  }, [loadedId]);

  if (!loadedId) {
    return (
      <>
        <div style={CARD_LABEL}>{SEND_UI_COPY.composerTitle}</div>
        <div style={{ fontSize: 11.5, color: "#aab0bb" }}>{SEND_UI_COPY.saveFirst}</div>
      </>
    );
  }

  const disabled = pending || !loaded || statusChanging || tierResolving;
  const set = <K extends keyof ComposerFields>(k: K, v: ComposerFields[K]) => setFields((f) => ({ ...f, [k]: v }));

  /** Saves unsaved edits first — the saved version is what the action decides (asOf). */
  const versionToSend = async (): Promise<number | undefined | false> => {
    if (pdfDirty) return await saveNow();
    return next?.asOf;
  };

  const run = async (kind: "send" | "inbox") => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setNotice(null);
    try {
      const asOf = await versionToSend();
      if (asOf === false) return;
      const input = { ...fields, asOf };
      if (kind === "send") {
        const r = await sendEstimateEmailAction(loadedId, input);
        const sync = sendSync(r);
        if (sync) applySync(sync);
        if (r.ok) {
          setActionError(null);
          setGateRefused(false);
          setOpen(false);
          onSent();
        }
        setNotice(sendResultMessage(r));
      } else {
        const r = await openEstimateInInboxAction(loadedId, input);
        const sync = sendSync(r);
        if (sync) applySync(sync);
        if (r.ok) {
          window.location.assign(r.href);
          return;
        }
        setNotice(sendResultMessage(r));
      }
    } catch (e) {
      console.error("[SendComposer]", e);
      setNotice({ tone: "error", text: SEND_UI_COPY.failed });
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  const noticeView = notice && (
    <div role="status" style={{ ...NOTICE_TONE[notice.tone], borderRadius: 8, padding: "8px 11px", fontSize: 12.5, lineHeight: 1.45, marginTop: 10 }}>
      <div>{notice.text}</div>
      {notice.warning && <div style={{ marginTop: 3 }}>{notice.warning}</div>}
      {notice.href && (
        <a href={notice.href} style={{ display: "inline-block", marginTop: 4, fontWeight: 600, color: "inherit" }}>
          {SEND_UI_COPY.openInbox}
        </a>
      )}
    </div>
  );

  const header = collapsible ? (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      aria-expanded={open}
      style={{
        ...CARD_LABEL,
        marginBottom: open ? 10 : 0,
        background: "none",
        border: "none",
        padding: 0,
        cursor: "pointer",
        fontFamily: "var(--font-ui)",
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <span aria-hidden style={{ display: "inline-block", transform: open ? "rotate(90deg)" : "none", transition: "transform .12s" }}>
        ▸
      </span>
      {SEND_UI_COPY.sendAnother}
    </button>
  ) : (
    <div style={CARD_LABEL}>{SEND_UI_COPY.composerTitle}</div>
  );

  return (
    <>
      {header}
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {loadErr && <div style={{ ...SMALL, color: "#9b3a2a" }}>{loadErr}</div>}
          {!loaded && <div style={SMALL}>{SEND_UI_COPY.loading}</div>}
          <label>
            <span style={FIELD_LABEL}>To</span>
            <input type="text" value={fields.to} disabled={disabled} onChange={(e) => set("to", e.target.value)} style={INPUT} autoComplete="off" />
          </label>
          <label>
            <span style={FIELD_LABEL}>Cc</span>
            <input type="text" value={fields.cc} disabled={disabled} onChange={(e) => set("cc", e.target.value)} style={INPUT} autoComplete="off" />
          </label>
          <label>
            <span style={FIELD_LABEL}>Subject</span>
            <input type="text" value={fields.subject} disabled={disabled} onChange={(e) => set("subject", e.target.value)} style={INPUT} />
          </label>
          <label>
            <span style={FIELD_LABEL}>Body</span>
            <textarea
              value={fields.body}
              disabled={disabled}
              onChange={(e) => set("body", e.target.value)}
              rows={10}
              style={{ ...INPUT, resize: "vertical", lineHeight: 1.5 }}
            />
            <span style={{ ...SMALL, display: "block", marginTop: 3 }}>{SEND_UI_COPY.linkHint}</span>
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
              <input type="checkbox" checked={fields.attachEstimate} disabled={disabled} onChange={(e) => set("attachEstimate", e.target.checked)} />
              {SEND_UI_COPY.attachEstimate}
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
              <input type="checkbox" checked={fields.attachCover} disabled={disabled} onChange={(e) => set("attachCover", e.target.checked)} />
              {SEND_UI_COPY.attachCover}
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
              {SEND_UI_COPY.followUp}
              <select
                value={fields.followUpDays}
                disabled={disabled}
                onChange={(e) => set("followUpDays", Number(e.target.value))}
                aria-label={SEND_UI_COPY.followUp}
                style={{ ...INPUT, width: "auto", padding: "6px 8px" }}
              >
                {FOLLOW_UP_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {gmail && <div style={SMALL}>{gmail.connected ? SEND_UI_COPY.from(gmail.from) : SEND_UI_COPY.gmailOff}</div>}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => run("send")}
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: 13,
                fontWeight: 700,
                color: "#16181d",
                background: "var(--accent)",
                border: "none",
                borderRadius: 8,
                padding: "9px 18px",
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.55 : 1,
              }}
            >
              {primaryLabel(status)}
            </button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, rowGap: 6, borderTop: "1px solid #f0f1f4", paddingTop: 10 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <button type="button" disabled={disabled} onClick={() => run("inbox")} style={{ ...LINK_BTN, opacity: disabled ? 0.55 : 1 }}>
                {SEND_UI_COPY.openInbox}
              </button>
              {status === "draft" && <span style={{ ...SMALL, color: "#8a6a1e" }}>{SEND_UI_COPY.inboxWarning}</span>}
            </span>
            {status === "draft" && (
              <button type="button" onClick={() => goTo(SEND_STEP_IDS.status, SEND_STEP_IDS.statusSelect)} style={LINK_BTN}>
                {SEND_UI_COPY.markSentOnly}
              </button>
            )}
            <button type="button" onClick={() => goTo(SEND_STEP_IDS.clientLink)} style={LINK_BTN}>
              {SEND_UI_COPY.copyLinkOnly}
            </button>
          </div>
        </div>
      )}
      {noticeView}
    </>
  );
}
