"use client";

import { useState } from "react";
import { useSync } from "@/lib/sync/SyncProvider";

/**
 * The live sync chip in the nav — replaces Phase 1's navigator.onLine-only
 * placeholder. Reflects the full SyncEngine status (offline / work-offline /
 * syncing / N-to-sync / synced) and opens a small panel with the last-sync
 * time, a "Sync now" action, and the manual "Work offline" toggle
 * (rss_sync_paused_v1). Two variants: the top-bar pill and the mobile-drawer
 * card.
 */

function chipLabel(s: {
  online: boolean;
  paused: boolean;
  syncing: boolean;
  pending: number;
}): { text: string; dot: "" | "offline" | "syncing" } {
  if (!s.online) return { text: "Offline", dot: "offline" };
  if (s.paused) return { text: "Work offline", dot: "offline" };
  if (s.syncing) return { text: "Syncing…", dot: "syncing" };
  if (s.pending > 0)
    return { text: `${s.pending} to sync`, dot: "offline" };
  return { text: "Synced", dot: "" };
}

export default function SyncChip({
  variant = "bar",
}: {
  variant?: "bar" | "drawer";
}) {
  const s = useSync();
  const [open, setOpen] = useState(false);
  const { text, dot } = chipLabel(s);

  const detail = !s.online
    ? "No connection — captures are saved on this device and will sync when you're back online."
    : s.paused
      ? "You've turned off syncing. Captures stay on this device until you turn it back on."
      : s.pending > 0
        ? `${s.pending} change${s.pending === 1 ? "" : "s"} waiting to reach the office.`
        : "Everything on this device is in the office.";

  if (variant === "drawer") {
    return (
      <div
        style={{
          margin: 14,
          background: "#1d2026",
          border: "1px solid #2b2e35",
          borderRadius: 13,
          padding: 13,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className={`pk-sync-dot${dot ? " " + dot : ""}`} />
          <span style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>
            {text}
          </span>
        </div>
        <div style={{ color: "#9aa0ab", fontSize: 11.5, marginTop: 5 }}>
          {detail}
        </div>
        <div style={{ color: "#7b818c", fontSize: 11, marginTop: 6 }}>
          Last synced {s.timeAgo(s.lastSyncAt)}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button
            onClick={() => s.setPaused(!s.paused)}
            style={{
              flex: 1,
              padding: "8px 10px",
              borderRadius: 9,
              border: "1px solid #2f323a",
              background: s.paused ? "var(--accent)" : "#23262d",
              color: "#fff",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "var(--font-ui)",
            }}
          >
            {s.paused ? "Turn syncing on" : "Work offline"}
          </button>
          {s.online && !s.paused && (
            <button
              onClick={() => s.syncNow()}
              disabled={s.syncing}
              style={{
                flex: 1,
                padding: "8px 10px",
                borderRadius: 9,
                border: "1px solid #2f323a",
                background: "#23262d",
                color: "#cfd3da",
                fontSize: 12,
                fontWeight: 600,
                cursor: s.syncing ? "default" : "pointer",
                fontFamily: "var(--font-ui)",
              }}
            >
              {s.syncing ? "Syncing…" : "Sync now"}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        className="pk-sync"
        onClick={() => setOpen((v) => !v)}
        title={detail}
        style={{ font: "inherit" }}
      >
        <span className={`pk-sync-dot${dot ? " " + dot : ""}`} />
        <span>{text}</span>
      </button>
      {open && (
        <>
          <div className="pk-backdrop" onClick={() => setOpen(false)} />
          <div
            style={{
              position: "absolute",
              top: 44,
              right: 0,
              width: 288,
              maxWidth: "88vw",
              background: "#fff",
              border: "1px solid #e8eaee",
              borderRadius: 12,
              boxShadow: "0 16px 46px rgba(0,0,0,.24)",
              padding: 14,
              zIndex: 70,
              color: "#16181d",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className={`pk-sync-dot${dot ? " " + dot : ""}`} />
              <span style={{ fontSize: 14, fontWeight: 600 }}>{text}</span>
            </div>
            <div style={{ fontSize: 12, color: "#6b7079", marginTop: 6, lineHeight: 1.45 }}>
              {detail}
            </div>
            <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 8, fontFamily: "var(--font-mono)" }}>
              Last synced {s.timeAgo(s.lastSyncAt)}
            </div>
            {s.errors > 0 && (
              <div style={{ fontSize: 11.5, color: "#b4520a", marginTop: 6 }}>
                {s.errors} change{s.errors === 1 ? "" : "s"} couldn’t be saved — reopen and save again.
              </div>
            )}
            {s.conflicts > 0 && (
              <div style={{ fontSize: 11.5, color: "#6b7079", marginTop: 6 }}>
                {s.conflicts} record{s.conflicts === 1 ? " was" : "s were"} updated in the office and kept the office version.
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                onClick={() => s.setPaused(!s.paused)}
                style={{
                  flex: 1,
                  padding: "9px 10px",
                  borderRadius: 9,
                  border: "1px solid #e2e4e9",
                  background: s.paused ? "var(--accent)" : "#fff",
                  color: s.paused ? "#fff" : "#3a3f4a",
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "var(--font-ui)",
                }}
              >
                {s.paused ? "Turn syncing on" : "Work offline"}
              </button>
              <button
                onClick={() => s.syncNow()}
                disabled={!s.online || s.paused || s.syncing}
                style={{
                  flex: 1,
                  padding: "9px 10px",
                  borderRadius: 9,
                  border: "1px solid #e2e4e9",
                  background: "#fff",
                  color: !s.online || s.paused ? "#c4c9d2" : "#3a3f4a",
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: !s.online || s.paused || s.syncing ? "default" : "pointer",
                  fontFamily: "var(--font-ui)",
                }}
              >
                {s.syncing ? "Syncing…" : "Sync now"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
