"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { TrackedEmail } from "@/lib/estimate-email/track-server";
import { activityTime, newRepliesOf, SEND_UI_COPY } from "@/lib/estimate-email/send-ui";
import { markEstimateEmailReadAction, replyToEstimateEmailAction, sendTrackAction } from "../send-actions";
import { ACCENT_INK, ACCENT_SOFT } from "../est-ui";

const CARD_LABEL = { fontSize: 11, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", marginBottom: 10 } as const;
const SMALL: CSSProperties = { fontSize: 11.5, color: "#5b616e", lineHeight: 1.45 };
const PILL: CSSProperties = { fontSize: 10.5, fontWeight: 600, borderRadius: 20, padding: "2px 8px", whiteSpace: "nowrap" };
const BTN: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  fontWeight: 600,
  color: "#16181d",
  background: "#f1f2f5",
  border: "none",
  borderRadius: 7,
  padding: "6px 12px",
  cursor: "pointer",
};

/**
 * Estimator Phase 3 (spec §10.4) — the Send & track step's Activity card:
 * the estimate emails sent from here, newest first, each with its messages
 * (customer replies arrive through the existing Gmail import), an inline
 * Reply and Mark read for the mailbox owner. Reads on mount, whenever the
 * window regains focus, and when `refreshKey` changes (a send from the
 * composer); reports the opens + unread-reply counts up for the Send badge.
 */
export function SendActivity({
  quoteId,
  refreshKey,
  onTrack,
}: {
  quoteId: string;
  refreshKey: number;
  onTrack: (t: { opens: number; newReplies: number }) => void;
}) {
  const [emails, setEmails] = useState<TrackedEmail[] | null>(null);
  const [opens, setOpens] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const onTrackRef = useRef(onTrack);
  useEffect(() => {
    onTrackRef.current = onTrack;
  }, [onTrack]);

  useEffect(() => {
    let live = true;
    const load = () =>
      sendTrackAction(quoteId).then(
        (r) => {
          if (!live) return;
          if (r.ok) {
            setEmails(r.emails);
            setOpens(r.opens.total);
            setErr(null);
            onTrackRef.current({ opens: r.opens.total, newReplies: r.newReplies });
          } else setErr(r.error);
        },
        () => {
          // A failed re-read keeps what's shown.
          if (live) setErr((e) => e ?? SEND_UI_COPY.failed);
        }
      );
    void load();
    // Re-read on focus: a reply may have arrived (Gmail import) while the tab was away.
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      void load();
    };
    window.addEventListener("focus", refresh);
    return () => {
      live = false;
      window.removeEventListener("focus", refresh);
    };
  }, [quoteId, refreshKey]);

  /** One email changed in place (a reply or Mark read); the badge follows. */
  const patch = (threadId: string, next: Partial<TrackedEmail>) => {
    if (!emails) return;
    const out = emails.map((e) => (e.threadId === threadId ? { ...e, ...next } : e));
    setEmails(out);
    onTrackRef.current({ opens, newReplies: newRepliesOf(out) });
  };

  return (
    <>
      <div style={CARD_LABEL}>{SEND_UI_COPY.activity}</div>
      {opens > 0 && <div style={{ ...SMALL, marginBottom: 8 }}>{SEND_UI_COPY.opens(opens)}</div>}
      {err && <div style={{ ...SMALL, color: "#9b3a2a", marginBottom: 8 }}>{err}</div>}
      {emails === null ? (
        !err && <div style={SMALL}>{SEND_UI_COPY.loading}</div>
      ) : emails.length === 0 ? (
        <div style={{ fontSize: 11.5, color: "#aab0bb" }}>{SEND_UI_COPY.empty}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {emails.map((e) => (
            <EmailRow key={e.threadId} quoteId={quoteId} email={e} onPatch={(p) => patch(e.threadId, p)} />
          ))}
        </div>
      )}
    </>
  );
}

function EmailRow({ quoteId, email: e, onPatch }: { quoteId: string; email: TrackedEmail; onPatch: (p: Partial<TrackedEmail>) => void }) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const act = async (fn: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setErr(null);
    setNote(null);
    try {
      await fn();
    } catch (x) {
      console.error("[SendActivity]", x);
      setErr(SEND_UI_COPY.failed);
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  const sendReply = () =>
    act(async () => {
      const r = await replyToEstimateEmailAction(quoteId, e.threadId, text);
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      onPatch(r.summary);
      setText("");
      setReplyOpen(false);
      if (r.warning) setNote(r.warning);
    });

  const markRead = () =>
    act(async () => {
      const r = await markEstimateEmailReadAction(quoteId, e.threadId);
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      onPatch(r.summary);
    });

  return (
    <div style={{ border: "1px solid #ececf0", borderRadius: 10, padding: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, rowGap: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#16181d", flex: "1 1 220px", minWidth: 0, overflowWrap: "anywhere" }}>
          {e.subject || "(no subject)"}
        </span>
        <span style={{ ...PILL, background: "#f1f2f5", color: "#5b616e" }}>Rev {e.rev}</span>
        <span style={{ ...PILL, ...(e.delivered ? { background: ACCENT_SOFT, color: ACCENT_INK } : { background: "#fdf6e7", color: "#7a5a12" }) }}>
          {e.delivered ? SEND_UI_COPY.deliveredGmail : SEND_UI_COPY.deliveredLocal}
        </span>
        {e.unread > 0 && <span style={{ ...PILL, background: "var(--accent)", color: "#16181d" }}>{e.unread} new</span>}
      </div>
      <div style={{ ...SMALL, marginTop: 3, overflowWrap: "anywhere" }}>
        To {e.to || "—"} · {activityTime(e.sentAt)}
      </div>
      {e.textHidden ? (
        <div style={{ ...SMALL, marginTop: 8, color: "#8a8f99" }}>{SEND_UI_COPY.textHidden(e.ownerName)}</div>
      ) : (
        e.messages.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            {e.messages.map((m, i) => (
              <div
                key={i}
                style={{
                  borderRadius: 8,
                  padding: "7px 10px",
                  background: m.unread ? ACCENT_SOFT : "#f7f8fa",
                  borderLeft: "3px solid " + (m.unread ? "var(--accent)" : m.direction === "in" ? "#c9ccd3" : "#e4e6eb"),
                }}
              >
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, fontSize: 11, color: "#6b7079" }}>
                  <span style={{ fontWeight: 700, color: m.unread ? ACCENT_INK : "#5b616e" }}>{m.direction === "in" ? "Reply" : "Sent"}</span>
                  <span style={{ overflowWrap: "anywhere" }}>{m.from}</span>
                  <span>· {activityTime(m.at)}</span>
                </div>
                {m.snippet && <div style={{ fontSize: 12.5, color: "#16181d", marginTop: 3, lineHeight: 1.45, overflowWrap: "anywhere" }}>{m.snippet}</div>}
              </div>
            ))}
          </div>
        )
      )}
      {e.canReply && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          {!replyOpen && (
            <button type="button" disabled={pending} onClick={() => setReplyOpen(true)} style={BTN}>
              {SEND_UI_COPY.reply}
            </button>
          )}
          {e.unread > 0 && (
            <button type="button" disabled={pending} onClick={markRead} style={{ ...BTN, opacity: pending ? 0.55 : 1 }}>
              {SEND_UI_COPY.markRead}
            </button>
          )}
        </div>
      )}
      {e.canReply && replyOpen && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <textarea
            value={text}
            disabled={pending}
            onChange={(x) => setText(x.target.value)}
            rows={4}
            aria-label={SEND_UI_COPY.reply}
            style={{
              width: "100%",
              boxSizing: "border-box",
              fontFamily: "var(--font-ui)",
              fontSize: 13,
              border: "1px solid #dfe2e8",
              borderRadius: 8,
              padding: "8px 10px",
              resize: "vertical",
            }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              disabled={pending || !text.trim()}
              onClick={sendReply}
              style={{ ...BTN, background: "var(--accent)", opacity: pending || !text.trim() ? 0.55 : 1 }}
            >
              {SEND_UI_COPY.send}
            </button>
            <button type="button" disabled={pending} onClick={() => setReplyOpen(false)} style={BTN}>
              {SEND_UI_COPY.cancel}
            </button>
          </div>
        </div>
      )}
      {err && <div style={{ ...SMALL, color: "#9b3a2a", marginTop: 6 }}>{err}</div>}
      {note && <div style={{ ...SMALL, color: "#7a5a12", marginTop: 6 }}>{note}</div>}
    </div>
  );
}
