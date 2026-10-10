"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { squarePhotosAction } from "./actions";

/**
 * Admin-only (#322): make every photo stored before photos were squared the
 * same 1600×1600 padded square. Loops the action like thumbnail-button.tsx —
 * each call has a 45 s budget — until nothing is left or a call tries
 * nothing; photos that fail are remembered in `skip` so they don't come back
 * first on every call. Re-click to continue after a stop. Originals are kept
 * on each photo's history.
 */
export default function SquarePhotosButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = () => {
    if (!window.confirm("Make every existing product photo the same 1600×1600 padded square?\n\nOriginals are kept on each photo's history. Keep this tab open until it finishes.")) return;
    start(async () => {
      setMsg(null);
      let done = 0;
      let failed = 0;
      let skip: string[] = [];
      for (;;) {
        const r = await squarePhotosAction({ skip });
        if (!r.ok) {
          setMsg({ ok: false, text: r.error });
          break;
        }
        done += r.done;
        failed += r.failed;
        skip = [...skip, ...r.failedIds];
        const stuck = r.done === 0 && r.failed === 0;
        if (r.remaining <= 0 || stuck) {
          setMsg({
            ok: !stuck || r.remaining <= 0,
            text: done === 0 && failed === 0 && r.remaining <= 0 ? "Every photo is already uniform." : `Squared ${done} · ${failed} failed · ${r.remaining} left`,
          });
          break;
        }
        setMsg({ ok: true, text: `Squared ${done} · ${failed} failed · ${r.remaining} left…` });
      }
      router.refresh();
    });
  };

  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button type="button" className="pk-btn-outline" disabled={pending} onClick={run}>
        {pending ? "Making photos uniform…" : "Make photos uniform"}
      </button>
      {msg && (
        <span role={msg.ok ? "status" : "alert"} style={{ fontSize: 12, color: msg.ok ? "#1f7a52" : "#b4543a" }}>
          {msg.text}
        </span>
      )}
    </span>
  );
}
