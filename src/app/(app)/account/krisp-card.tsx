"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { connectKrispAction, disconnectKrispAction } from "./actions";

/** Serializable view of the signed-in user's Krisp connection (no secret). */
export type KrispCardInfo = {
  krispEmail: string | null;
  krispName: string | null;
  connectedAt: number;
  lastUsedAt: number | null;
  lastError: string | null;
};

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
    </div>
  );
}
