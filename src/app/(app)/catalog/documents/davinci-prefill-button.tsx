"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { prefillFromDavinciAction } from "./actions";

/** Admin-only (#207, spec §6): write ETC's DaVinci datasheet links and
 *  accessory graph. Nothing is downloaded — Fetch is a separate step. */
export default function DavinciPrefillButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button
        type="button"
        className="pk-btn-outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg(null);
            const r = await prefillFromDavinciAction();
            setMsg(r.ok ? { ok: true, text: r.summary } : { ok: false, text: r.error });
            if (r.ok) router.refresh();
          })
        }
      >
        {pending ? "Pre-filling…" : "Pre-fill from DaVinci"}
      </button>
      {msg && <span role={msg.ok ? "status" : "alert"} style={{ fontSize: 12, color: msg.ok ? "#1f7a52" : "#b4543a" }}>{msg.text}</span>}
    </span>
  );
}
