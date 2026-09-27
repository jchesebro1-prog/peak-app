"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { renderThumbnailsAction } from "./actions";

/**
 * Admin-only (#245, spec §5): render page 1 of each quoted part's own
 * datasheet PDF to a PNG thumbnail, for every part with a stored datasheet
 * and no image yet. Loops the action — like the Datasheets fetch loop
 * (documents-client.tsx) — until nothing is left within this run's reach,
 * since the whole catalog's gap can outrun one call's 45s render budget.
 */
export default function ThumbnailButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = () =>
    start(async () => {
      setMsg(null);
      let done = 0;
      let failed = 0;
      for (;;) {
        const r = await renderThumbnailsAction();
        if (!r.ok) {
          setMsg({ ok: false, text: r.error });
          break;
        }
        done += r.done;
        failed += r.failed;
        if (r.remaining <= 0) {
          setMsg({
            ok: true,
            text: done === 0 && failed === 0 ? "Nothing needed a thumbnail." : `Rendered ${done} thumbnail${done === 1 ? "" : "s"}${failed ? ` · ${failed} failed` : ""}.`,
          });
          break;
        }
        setMsg({ ok: true, text: `Rendered ${done}${failed ? ` · ${failed} failed` : ""}, ${r.remaining} to go…` });
      }
      router.refresh();
    });

  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button type="button" className="pk-btn-outline" disabled={pending} onClick={run}>
        {pending ? "Rendering thumbnails…" : "Datasheet thumbnails"}
      </button>
      {msg && (
        <span role={msg.ok ? "status" : "alert"} style={{ fontSize: 12, color: msg.ok ? "#1f7a52" : "#b4543a" }}>
          {msg.text}
        </span>
      )}
    </span>
  );
}
