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
 *
 * Fix round 2: candidates are recomputed fresh every call, so a datasheet
 * that keeps failing to render never gets an image and would otherwise sort
 * first again on every retry — the naive `for (;;)` loop never terminated.
 * This accumulates every failed datasheet id across calls and passes it back
 * as `skip`, and stops the moment EITHER nothing is left (`remaining === 0`)
 * OR a call made no progress at all (`done === 0` — every candidate it tried
 * failed, or the whole run's candidates are down to already-failed ones).
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
      let skip: string[] = [];
      for (;;) {
        const r = await renderThumbnailsAction({ skip });
        if (!r.ok) {
          setMsg({ ok: false, text: r.error });
          break;
        }
        done += r.done;
        failed += r.failed;
        skip = [...skip, ...r.failedIds];
        if (r.remaining <= 0 || r.done === 0) {
          setMsg({
            ok: true,
            text: done === 0 && failed === 0 ? "Nothing needed a thumbnail." : `${done} rendered${failed ? ` · ${failed} couldn't be rendered` : ""}.`,
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
