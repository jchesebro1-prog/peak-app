"use client";

import { useState, useTransition } from "react";
import { setBriefRemindersPrefAction } from "./actions";

/**
 * AI daily brief §5 — "Brief reminders on this phone". Shown only to Assist
 * pilot users with Daily brief on. Default on; it only does anything in the
 * installed phone app, which schedules a 6:45 and a 1:45 notification.
 */
export default function BriefRemindersToggle({ initialOn }: { initialOn: boolean }) {
  const [on, setOn] = useState(initialOn);
  const [, start] = useTransition();
  const flip = (v: boolean) => {
    setOn(v);
    start(async () => {
      await setBriefRemindersPrefAction(v);
    });
  };
  return (
    <div className="pk-card" style={{ padding: "17px 18px", marginTop: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>Brief reminders on this phone</div>
          <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3, lineHeight: 1.5 }}>
            In the phone app, a notification at 6:45 am and 1:45 pm (your phone&apos;s clock) when
            your morning and afternoon briefs are ready. Tapping it opens your brief.
          </div>
        </div>
        <button
          role="switch"
          aria-checked={on}
          aria-label="Toggle brief reminders on this phone"
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
