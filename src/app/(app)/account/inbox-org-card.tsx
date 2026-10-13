"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SenderRuleRowVM } from "@/lib/inbox-org/rule-list";
import { removeMySenderRuleAction, setKeepInInboxAction } from "./actions";

/**
 * #335 Inbox organization, Settings → Account: "Keep threads in my inbox
 * after I reply" (spec §4; default off = archive-on-reply on) and My sender
 * rules (spec §5) with delete.
 */
const DAY_FMT = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" });

export default function InboxOrgCard({ keepInInbox, rules }: { keepInInbox: boolean; rules: SenderRuleRowVM[] }) {
  const router = useRouter();
  const [on, setOn] = useState(keepInInbox);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  const flip = (v: boolean) => {
    setOn(v);
    start(async () => {
      try {
        await setKeepInInboxAction(v);
      } catch {
        setOn(!v);
        setNote("Couldn't save — try again.");
      }
    });
  };

  const remove = (r: SenderRuleRowVM) => {
    if (!confirm(`Delete your rule for ${r.match}?`)) return;
    start(async () => {
      setNote(null);
      try {
        const res = await removeMySenderRuleAction(r.id);
        if (!res.ok) setNote(res.error);
        router.refresh();
      } catch {
        setNote("Couldn't delete — try again.");
      }
    });
  };

  return (
    <div className="pk-card" style={{ padding: "17px 18px", marginTop: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>Keep threads in my inbox after I reply</div>
          <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3, lineHeight: 1.5 }}>
            Off: replying files the thread and takes it out of your inbox; it comes back when the ball is in your court
            again. On: replied threads stay in your inbox.
          </div>
        </div>
        <button
          role="switch"
          aria-checked={on}
          aria-label="Keep threads in my inbox after I reply"
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

      <div style={{ borderTop: "1px solid #f3f4f7", marginTop: 14, paddingTop: 12 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>My sender rules</div>
        <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3, lineHeight: 1.5 }}>
          Saved from a correction in Inbox → Organize. Yours win over the company-wide ones.
        </div>
        {rules.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "#8c919c", marginTop: 8 }}>No rules yet.</div>
        ) : (
          <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0 }}>
            {rules.map((r) => (
              <li key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: "1px solid #f6f7f9", flexWrap: "wrap" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#3a3f4a" }}>{r.match}</span>
                <span style={{ fontSize: 12.5, flex: 1, minWidth: 160 }}>{r.action}</span>
                {r.createdAt > 0 && <span style={{ fontSize: 11.5, color: "#aab0bb" }}>{DAY_FMT.format(new Date(r.createdAt))}</span>}
                <button
                  className="pk-btn-outline"
                  style={{ fontSize: 11.5, padding: "2px 9px" }}
                  disabled={pending}
                  aria-label={`Delete the rule for ${r.match}`}
                  onClick={() => remove(r)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
        {note && (
          <div role="status" style={{ fontSize: 12, color: "#b4543a", marginTop: 6 }}>
            {note}
          </div>
        )}
      </div>
    </div>
  );
}
