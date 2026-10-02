"use client";

import { useEffect, useState, useTransition, type CSSProperties } from "react";
import { getShareLinkAction, revokeShareLinkAction, shareLinkStatusAction } from "./share-actions";
import { ONLINE_COPY, type ShareLinkStatus } from "@/lib/quote-share/view";

/**
 * #293 slice 3 — the customer preview's Client link block (spec §5.5): Copy
 * client link (the same link until it expires or is revoked), its expiry and
 * creator, and Revoke behind an inline confirm. The link opens the latest
 * SENT version, so a never-sent or recalled quote has no Copy. Reads its own
 * status on mount, again whenever the window regains focus (a send made
 * elsewhere while the preview is open enables Copy without reopening it) and
 * after its own actions — no quote data comes from the Estimator.
 */

const FAILED = "Could not reach the server. Try again.";

const label: CSSProperties = { fontSize: 11, fontWeight: 600, color: "#9aa0ab", textTransform: "uppercase", letterSpacing: ".04em" };
const btn: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 600, textAlign: "center", borderRadius: 8, padding: "9px 16px", border: "none", cursor: "pointer", color: "#16181d", background: "#f1f2f5" };
const off: CSSProperties = { cursor: "not-allowed", opacity: 0.55 };
const small: CSSProperties = { fontSize: 11.5, color: "#5b616e", lineHeight: 1.45 };
const linkBtn: CSSProperties = { background: "none", border: "none", padding: 0, fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 600, cursor: "pointer" };

function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
}

export function ClientLinkPanel({ quoteId }: { quoteId: string }) {
  const [status, setStatus] = useState<ShareLinkStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [manualUrl, setManualUrl] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    shareLinkStatusAction(quoteId).then(
      (r) => {
        if (!live) return;
        if (r.ok) {
          setStatus(r.status);
          setErr(null);
        } else setErr(r.error);
      },
      () => {
        if (live) setErr(FAILED);
      }
    );
    // Re-read on focus: the quote may have been sent (or recalled) elsewhere
    // while this preview stayed open. A failed re-read keeps what's shown.
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      shareLinkStatusAction(quoteId).then(
        (r) => {
          if (live && r.ok) setStatus(r.status);
        },
        () => undefined
      );
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      live = false;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [quoteId]);

  const reload = async () => {
    try {
      const r = await shareLinkStatusAction(quoteId);
      if (r.ok) setStatus(r.status);
    } catch {
      /* the panel keeps what it shows */
    }
  };

  const copy = () =>
    start(async () => {
      setErr(null);
      setNote(null);
      setManualUrl(null);
      setConfirmRevoke(false);
      let r: Awaited<ReturnType<typeof getShareLinkAction>>;
      try {
        r = await getShareLinkAction(quoteId);
      } catch {
        setErr(FAILED);
        return;
      }
      if (!r.ok) {
        setErr(r.error);
        await reload();
        return;
      }
      const link = r.link;
      if (!link.path) {
        setErr(FAILED);
        return;
      }
      setStatus((s) => (s ? { ...s, link } : s));
      const url = window.location.origin + link.path;
      try {
        await navigator.clipboard.writeText(url);
        setNote(ONLINE_COPY.copied);
      } catch {
        setManualUrl(url);
        setNote(ONLINE_COPY.copyManual);
      }
      await reload();
    });

  const revoke = () =>
    start(async () => {
      setErr(null);
      setNote(null);
      let r: Awaited<ReturnType<typeof revokeShareLinkAction>>;
      try {
        r = await revokeShareLinkAction(quoteId);
      } catch {
        setErr(FAILED);
        return;
      }
      if (!r.ok) {
        setErr(r.error);
        await reload();
        return;
      }
      setConfirmRevoke(false);
      setManualUrl(null);
      setNote(ONLINE_COPY.revoked);
      await reload();
    });

  if (!status) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={label}>Client link</span>
        <span style={small}>{err || "Loading…"}</span>
      </div>
    );
  }
  if (status.state === "not-shareable") return null;

  const link = status.link?.active ? status.link : null;
  const copyDisabled = pending || !status.canSend || status.state !== "ok";
  const copyTitle = !status.canSend
    ? ONLINE_COPY.needsSend
    : status.state === "not-sent"
      ? ONLINE_COPY.notSent
      : status.state === "revising"
        ? ONLINE_COPY.revisingStaff
        : undefined;

  return (
    <div data-testid="client-link" style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 7 }}>
      <span style={label}>Client link</span>
      <button type="button" onClick={copy} disabled={copyDisabled} title={copyTitle} style={{ ...btn, ...(copyDisabled ? off : {}) }}>
        Copy client link
      </button>
      {link && (
        <span style={small}>
          Expires {shortDate(link.expiresAt)} · created by {link.createdBy}
        </span>
      )}
      {link && status.canSend && !confirmRevoke && (
        <button type="button" onClick={() => setConfirmRevoke(true)} disabled={pending} style={{ ...linkBtn, color: "#a33a2b", alignSelf: "flex-start" }}>
          Revoke
        </button>
      )}
      {link && confirmRevoke && (
        <div role="group" aria-label="Revoke the client link" style={{ ...small, display: "flex", flexDirection: "column", gap: 6, padding: "8px 10px", background: "#fdf0ee", border: "1px solid #f3d2cc", borderRadius: 7 }}>
          <span>{ONLINE_COPY.revokeConfirm}</span>
          <span style={{ display: "flex", gap: 12 }}>
            <button type="button" onClick={revoke} disabled={pending} style={{ ...linkBtn, color: "#a33a2b" }}>
              Revoke link
            </button>
            <button type="button" onClick={() => setConfirmRevoke(false)} disabled={pending} style={{ ...linkBtn, color: "#5b616e" }}>
              Cancel
            </button>
          </span>
        </div>
      )}
      {note && <span style={small}>{note}</span>}
      {manualUrl && (
        <input readOnly value={manualUrl} aria-label="Client link" onFocus={(e) => e.currentTarget.select()} style={{ fontSize: 11.5, padding: "6px 8px", border: "1px solid #dfe2e8", borderRadius: 7 }} />
      )}
      {err && (
        <span role="alert" style={{ ...small, color: "#a33a2b" }}>
          {err}
        </span>
      )}
    </div>
  );
}
