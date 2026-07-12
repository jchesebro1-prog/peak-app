"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setAllNotifAction, setNotifPrefAction } from "./actions";

/**
 * To-do notifications card — ported from Account Settings.dc.html.
 * Per-category toggles for the Nav to-do center (the bell); muted categories
 * are hidden from it and drop out of its badge count. Backed by the
 * notif-prefs store (keyed by the signed-in user's name), so it only ever
 * changes this account.
 */

type Row = { key: string; label: string; desc: string; on: boolean };

export default function NotifControls({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const total = rows.length;
  const countOn = rows.filter((r) => r.on).length;
  const allOn = total > 0 && countOn === total;

  const run = (fn: () => Promise<unknown>) =>
    startTransition(async () => {
      await fn();
      router.refresh();
    });

  return (
    <div
      className="pk-card"
      style={{ padding: 0, overflow: "hidden" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          padding: "16px 18px 14px",
          borderBottom: "1px solid #f0f1f4",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>To-do notifications</div>
          <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3 }}>
            Choose which categories appear in your to-do center and its badge
            count.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              fontWeight: 600,
              color: "#8c919c",
              whiteSpace: "nowrap",
            }}
          >
            {countOn} of {total} on
          </span>
          <button
            onClick={() => run(() => setAllNotifAction(!allOn))}
            className="pk-btn-outline"
            style={{ whiteSpace: "nowrap" }}
          >
            {allOn ? "Mute all" : "Enable all"}
          </button>
        </div>
      </div>

      {rows.map((r) => (
        <div
          key={r.key}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr) auto",
            gap: 14,
            alignItems: "center",
            padding: "14px 18px",
            borderBottom: "1px solid #f5f6f8",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.3 }}>
              {r.label}
            </div>
            <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 2, lineHeight: 1.4 }}>
              {r.desc}
            </div>
          </div>
          <NotifToggle
            on={r.on}
            onChange={(v) => run(() => setNotifPrefAction(r.key, v))}
            label={r.label}
          />
        </div>
      ))}

      <div style={{ padding: "12px 18px", fontSize: 11.5, color: "#aab0bb", lineHeight: 1.5 }}>
        Muted categories are hidden from the bell and don&apos;t count toward its
        badge. This only changes your account.
      </div>
    </div>
  );
}

function NotifToggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={`Toggle ${label}`}
      onClick={() => onChange(!on)}
      style={{
        position: "relative",
        width: 44,
        height: 26,
        borderRadius: 13,
        border: "none",
        cursor: "pointer",
        flexShrink: 0,
        background: on ? "var(--accent)" : "#cdd1d9",
        transition: "background .15s ease",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: on ? 21 : 3,
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 2px rgba(0,0,0,.3)",
          transition: "left .15s ease",
        }}
      />
    </button>
  );
}
