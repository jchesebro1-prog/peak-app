"use client";

import { useState, useTransition } from "react";
import { setInvitePrefAction } from "./actions";

/**
 * D76-A — "Email me calendar invites (.ics)" per-user toggle. Separate from
 * the to-do notification categories (those drive the nav bell; this drives
 * whether a scheduled site visit emails this user an invite).
 */
export default function InviteToggle({ initialOn }: { initialOn: boolean }) {
  const [on, setOn] = useState(initialOn);
  const [, start] = useTransition();
  const flip = (v: boolean) => {
    setOn(v);
    start(async () => {
      await setInvitePrefAction(v);
    });
  };
  return (
    <div className="pk-card" style={{ padding: "17px 18px", marginTop: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>Calendar invites</div>
          <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3, lineHeight: 1.5 }}>
            When a site visit is scheduled for you, email you a calendar
            invite (.ics) you can drop into your calendar.
          </div>
        </div>
        <button
          role="switch"
          aria-checked={on}
          aria-label="Toggle calendar-invite emails"
          onClick={() => flip(!on)}
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
      </div>
    </div>
  );
}
