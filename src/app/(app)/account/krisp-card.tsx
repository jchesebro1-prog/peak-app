"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { connectKrispAction, disconnectKrispAction } from "./actions";
import { loadOlderAction, syncNowAction } from "../inbox/meetings/actions";
import { agoLabel } from "../inbox/meetings/format";

/** Serializable view of the signed-in user's Krisp connection (no secret). */
export type KrispCardInfo = {
  krispEmail: string | null;
  krispName: string | null;
  connectedAt: number;
  lastUsedAt: number | null;
  lastError: string | null;
  /** #323 — the meetings sync on the same connection (Inbox → Meetings). */
  meetings: { syncedAt: number | null; lastError: string | null; backfillFrom: number | null };
};

const DAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" });

/** "5 min ago" against the clock at render (the line is suppressHydrationWarning — a server/client minute apart is fine) */
function syncedAgo(ms: number): string {
  return agoLabel(ms, Date.now());
}

/**
 * Account → "My Krisp" (Recordings spec §1.2 / §6): the per-rep Krisp API
 * key, mirroring the "My mailbox" card beside it. Paste → Connect validates
 * the key against Krisp's `GET /me` server-side and stores it encrypted;
 * the plaintext never comes back to the browser. Disconnect deletes the row.
 *
 * Caveat, stated in the copy rather than faked: Krisp issues Read and Write
 * keys and `/me` answers both, so the scope cannot be verified at connect.
 * A Read key surfaces later as a 403 on the first import — recorded on the
 * recording and on this card's "last error".
 */
export default function KrispCard({ info }: { info: KrispCardInfo | null }) {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  function connect() {
    const clean = key.trim();
    if (!clean) {
      setError("Paste your Krisp API key first.");
      return;
    }
    setError("");
    startTransition(async () => {
      const r = await connectKrispAction(clean);
      if (r.ok) {
        setKey("");
        router.refresh();
      } else {
        setError(r.error || "Couldn't connect — try again.");
      }
    });
  }

  function disconnect() {
    setError("");
    startTransition(async () => {
      const r = await disconnectKrispAction();
      setConfirmDisconnect(false);
      if (r.ok) router.refresh();
      else setError(r.error || "Couldn't disconnect — try again.");
    });
  }

  // #323 — Sync now / Load older, the same actions as the Inbox Meetings box
  const [syncNote, setSyncNote] = useState<{ text: string; bad: boolean } | null>(null);
  function syncMeetings(mode: "recent" | "backfill") {
    setSyncNote(null);
    startTransition(async () => {
      try {
        const r = mode === "recent" ? await syncNowAction() : await loadOlderAction();
        if (!r.ok) setSyncNote({ text: r.error, bad: true });
        else if (r.busy) setSyncNote({ text: "Sync already running", bad: false });
        else {
          const created = r.result?.created ?? 0;
          setSyncNote({ text: created ? `${created} new meeting${created === 1 ? "" : "s"}` : "Up to date", bad: false });
        }
        router.refresh();
      } catch {
        setSyncNote({ text: "Something went wrong — try again.", bad: true });
      }
    });
  }

  const connectedOn = info
    ? new Date(info.connectedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "";

  return (
    <div className="pk-card" style={{ padding: "17px 18px", marginTop: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>My Krisp</div>
          <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3, lineHeight: 1.5 }}>
            {info
              ? (info.krispEmail || info.krispName || "Krisp account") +
                (info.krispName && info.krispEmail ? " · " + info.krispName : "") +
                " · connected " +
                connectedOn
              : "Site-visit recordings you capture in the app are transcribed in your own Krisp account. Paste a personal API key (Krisp → Settings → API) — it must be a Write key, since the app imports audio; a Read key is accepted here but fails at the first import."}
          </div>
          {info?.lastError && (
            <div style={{ fontSize: 11.5, color: "#b4543a", marginTop: 6, lineHeight: 1.45 }}>
              Last Krisp error: {info.lastError}
            </div>
          )}
          {error && (
            <div style={{ fontSize: 11.5, color: "#b4543a", marginTop: 6, lineHeight: 1.45 }}>{error}</div>
          )}
        </div>
        {!info && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
            <input
              type="password"
              autoComplete="off"
              value={key}
              disabled={pending}
              placeholder="Krisp API key (Write scope)"
              aria-label="Krisp API key (Write scope)"
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") connect();
              }}
              style={{
                border: "1px solid #e4e7ec",
                borderRadius: 8,
                padding: "7px 10px",
                fontSize: 12.5,
                fontFamily: "var(--font-mono)",
                background: "#fff",
                color: "#16181d",
                minWidth: 240,
              }}
            />
            <button className="pk-btn-accent" disabled={pending} onClick={connect} style={{ flexShrink: 0 }}>
              {pending ? "Checking…" : "Connect"}
            </button>
          </div>
        )}
        {info && (
          <>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "#1f7a52",
                background: "#e8f3ee",
                border: "1px solid #cfe6db",
                padding: "3px 10px",
                borderRadius: 20,
                flexShrink: 0,
              }}
            >
              Connected
            </span>
            {!confirmDisconnect ? (
              <button
                className="pk-btn-outline"
                style={{ color: "#8c919c", flexShrink: 0 }}
                disabled={pending}
                onClick={() => setConfirmDisconnect(true)}
              >
                Disconnect
              </button>
            ) : (
              <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                <span style={{ fontSize: 11.5, color: "#8a3a2a" }}>Remove the key?</span>
                <button className="pk-btn-danger" disabled={pending} onClick={disconnect}>
                  Disconnect
                </button>
                <button className="pk-btn-outline" disabled={pending} onClick={() => setConfirmDisconnect(false)}>
                  Keep
                </button>
              </span>
            )}
          </>
        )}
      </div>
      {info && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 14, paddingTop: 12, borderTop: "1px solid #f0f1f4" }}>
          <div style={{ flex: 1, minWidth: 200, fontSize: 12, lineHeight: 1.5 }}>
            <div style={{ color: info.meetings.lastError ? "#b4543a" : "#5b616e" }} suppressHydrationWarning>
              {info.meetings.lastError
                ? `Last meetings sync failed: ${info.meetings.lastError}`
                : info.meetings.syncedAt
                  ? `Meetings synced ${syncedAgo(info.meetings.syncedAt)}`
                  : "Meetings not synced yet"}
            </div>
            {info.meetings.backfillFrom != null && (
              <div style={{ color: "#9aa0ab" }}>Pulled back to {DAY.format(info.meetings.backfillFrom)}</div>
            )}
            {syncNote && (
              <div role="status" style={{ color: syncNote.bad ? "#b4543a" : "#5b616e", marginTop: 3 }}>{syncNote.text}</div>
            )}
          </div>
          <button className="pk-btn-outline" disabled={pending} onClick={() => syncMeetings("recent")} style={{ flexShrink: 0 }}>
            Sync now
          </button>
          <button
            className="pk-btn-outline"
            disabled={pending}
            onClick={() => syncMeetings("backfill")}
            title="Import the 90 days before the oldest meeting synced so far"
            style={{ flexShrink: 0 }}
          >
            Load older
          </button>
        </div>
      )}
    </div>
  );
}
