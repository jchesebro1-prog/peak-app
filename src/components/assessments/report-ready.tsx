"use client";

import { useEffect } from "react";

/** Past this the report is marked ready anyway — a photo that never decodes prints blank rather than failing the PDF. */
const READY_CAP_MS = 20_000;

/**
 * #340 Task 10 — the print route's one client island. It sets each deferred <img data-photo-id> src from `sources`
 * (the data URIs travel the page once, here, instead of in every <img> the report draws), waits for every image in the
 * report to decode, then sets `data-report-ready` on the report root so headless Chrome prints. Renders nothing.
 */
export default function ReportReady({ sources }: { sources?: Record<string, string | null> }) {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-assessment-report]");
    if (!root) return;
    let done = false;
    const mark = () => {
      if (done) return;
      done = true;
      root.setAttribute("data-report-ready", "1");
    };
    const imgs = Array.from(root.querySelectorAll<HTMLImageElement>("img"));
    for (const img of imgs) {
      const id = img.dataset.photoId;
      const src = id && sources && Object.hasOwn(sources, id) ? sources[id] : null;
      if (src && !img.getAttribute("src")) img.src = src;
    }
    const timer = window.setTimeout(mark, READY_CAP_MS);
    void Promise.all(imgs.filter((img) => img.getAttribute("src")).map((img) => img.decode().catch(() => undefined))).then(() => {
      window.clearTimeout(timer);
      mark();
    });
    return () => window.clearTimeout(timer);
  }, [sources]);
  return null;
}
