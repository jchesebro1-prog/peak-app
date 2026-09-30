"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FETCH_BATCH_SIZE } from "@/lib/part-docs/types";
import type { FetchTarget } from "@/lib/part-docs/fetch-links";
import { catalogFetchTargetsAction, fetchLinksAction, renderThumbnailsAction } from "./actions";

/** Mirrors fetch-links.ts's NOT_ATTEMPTED_ERROR — not imported directly since
 *  that module pulls in server-only stores and blob code (same as
 *  documents-client.tsx). */
const NOT_ATTEMPTED = "Not attempted — run again.";

/**
 * Admin-only "Whole catalog images" (#245, 2026-09-30): datasheet page-1
 * thumbnails as portal product images for the WHOLE catalog, not just the
 * quoted parts this page lists. Two phases, both loops of existing actions:
 *
 *  1. Fetch — `catalogFetchTargetsAction` lists one target per unique
 *     datasheet URL (previously-failed links left out), fed to
 *     `fetchLinksAction` in FETCH_BATCH_SIZE chunks with documents-client's
 *     rule: a NOT_ATTEMPTED result is requeued, never counted as a failure.
 *  2. Render — `renderThumbnailsAction({ scope: "catalog" })` looped exactly
 *     like thumbnail-button.tsx: failed datasheet ids fold into `skip`, and it
 *     stops once nothing is left or a call attempts nothing (unlike that
 *     button, one failed render doesn't end the run — see the loop).
 */
export default function CatalogImagesButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = () => {
    const go = window.confirm(
      "Download every linked datasheet in the whole catalog into file storage, then render page 1 of each as the part's product image?\n\nThis can take a while — keep this tab open until it finishes."
    );
    if (!go) return;
    start(async () => {
      setMsg(null);

      // Phase 1 — fetch.
      const t = await catalogFetchTargetsAction();
      if (!t.ok) {
        setMsg({ ok: false, text: t.error });
        return;
      }
      const total = t.targets.length;
      let queue: FetchTarget[] = [...t.targets];
      let fetched = 0;
      let fetchFailed = 0;
      while (queue.length) {
        const chunk = queue.slice(0, FETCH_BATCH_SIZE);
        queue = queue.slice(FETCH_BATCH_SIZE);
        setMsg({ ok: true, text: `Fetching datasheets ${Math.min(fetched + fetchFailed + chunk.length, total)} of ${total}…` });
        const r = await fetchLinksAction(chunk);
        if (!r.ok) {
          setMsg({ ok: false, text: r.error });
          router.refresh();
          return;
        }
        for (const res of r.results) {
          if (!res.ok && res.error === NOT_ATTEMPTED) {
            queue.push({ sku: res.sku, kind: res.kind });
            continue;
          }
          if (res.ok) fetched++;
          else fetchFailed++;
        }
      }

      // Phase 2 — render.
      let done = 0;
      let failed = 0;
      let skip: string[] = [];
      for (;;) {
        const r = await renderThumbnailsAction({ scope: "catalog", skip });
        if (!r.ok) {
          setMsg({ ok: false, text: r.error });
          router.refresh();
          return;
        }
        done += r.done;
        failed += r.failed;
        skip = [...skip, ...r.failedIds];
        // Each call renders about one datasheet (RENDER_WORST_CASE_MS is over
        // the 45 s budget), so "stop when a call rendered nothing" would end a
        // catalog run at its first bad PDF. Failed ids fold into `skip`, so a
        // call that attempted anything made progress; stop only when nothing
        // is left or nothing was attempted.
        if (r.remaining <= 0 || r.done + r.failed === 0) break;
        setMsg({ ok: true, text: `Rendering thumbnails: ${done} done, ${r.remaining} to go…` });
      }

      setMsg({
        ok: true,
        text:
          `Datasheets: ${fetched} fetched${fetchFailed ? ` · ${fetchFailed} failed` : ""}. ` +
          `Thumbnails: ${done} rendered${failed ? ` · ${failed} failed` : ""}.`,
      });
      router.refresh();
    });
  };

  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button type="button" className="pk-btn-outline" disabled={pending} onClick={run}>
        {pending ? "Building catalog images…" : "Whole catalog images"}
      </button>
      {msg && (
        <span role={msg.ok ? "status" : "alert"} style={{ fontSize: 12, color: msg.ok ? "#1f7a52" : "#b4543a" }}>
          {msg.text}
        </span>
      )}
    </span>
  );
}
