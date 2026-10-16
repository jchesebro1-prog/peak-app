"use client";

import { useState } from "react";
import { getEngine } from "@/lib/sync/engine";
import { readyCount, readyLine, type TodayJob } from "@/lib/sync/today-jobs";

/**
 * Batch 6 / #65 — "Download today's jobs": lists the signed-in tech's jobs
 * for today (GET /api/sync/today, `create` holders only — #351), pulls the
 * field records into the offline mirror (the ordinary pull, even with Work
 * offline on), then asks the service worker to keep each job's page and
 * waits for its answer. Ends with "Ready offline: N jobs".
 */

type Phase =
  | { k: "idle" }
  | { k: "busy"; text: string }
  | { k: "done"; text: string; ok: boolean };

const PAGE_TIMEOUT_MS = 20_000;

/** Ask the service worker to keep one page; resolves true only when it says it did. */
function cachePage(sw: ServiceWorker, url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve(false), PAGE_TIMEOUT_MS);
    ch.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve(!!(e.data && e.data.ok));
    };
    sw.postMessage({ type: "CACHE_ROUTE", url }, [ch.port2]);
  });
}

async function activeWorker(): Promise<ServiceWorker | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((r) => setTimeout(() => r(null), 5_000)),
  ]);
  return reg?.active ?? null;
}

export default function DownloadToday({ tone = "light" }: { tone?: "light" | "dark" }) {
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const busy = phase.k === "busy";

  async function run() {
    if (busy) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setPhase({ k: "done", ok: false, text: "You’re offline — connect, then download today’s jobs." });
      return;
    }
    setPhase({ k: "busy", text: "Finding today’s jobs…" });
    let jobs: TodayJob[] = [];
    let pages: string[] = [];
    try {
      const res = await fetch("/api/sync/today", { cache: "no-store" });
      if (res.status === 403) {
        setPhase({ k: "done", ok: false, text: "Downloading jobs is for field roles only." });
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { jobs?: TodayJob[]; pages?: string[] };
      jobs = Array.isArray(data.jobs) ? data.jobs : [];
      pages = Array.isArray(data.pages) ? data.pages : [];
    } catch {
      setPhase({ k: "done", ok: false, text: "Couldn’t reach the office — try again with a connection." });
      return;
    }
    if (!jobs.length) {
      setPhase({ k: "done", ok: true, text: readyLine(0, 0) });
      return;
    }

    const engine = getEngine();
    setPhase({ k: "busy", text: `Saving ${jobs.length} job${jobs.length === 1 ? "" : "s"} to this device…` });
    await engine.pull({ force: true });
    const mirrored = new Set<string>();
    for (const j of jobs) {
      if (j.collection && (await engine.mirrorGet(j.collection, j.id))) mirrored.add(`${j.collection}:${j.id}`);
    }

    const sw = await activeWorker();
    const cached = new Set<string>();
    if (sw) {
      for (let i = 0; i < pages.length; i++) {
        setPhase({ k: "busy", text: `Saving page ${i + 1} of ${pages.length}…` });
        if (await cachePage(sw, pages[i])) cached.add(pages[i]);
      }
    }
    const ready = readyCount(jobs, cached, mirrored);
    setPhase({
      k: "done",
      ok: ready === jobs.length,
      text: sw ? readyLine(ready, jobs.length) : "This browser can’t keep pages offline — install the app or use Chrome / Safari.",
    });
  }

  const dark = tone === "dark";
  return (
    <div style={{ marginTop: 10 }}>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        aria-busy={busy}
        style={{
          width: "100%",
          padding: "9px 10px",
          borderRadius: 9,
          border: `1px solid ${dark ? "#2f323a" : "#e2e4e9"}`,
          background: dark ? "#23262d" : "#fff",
          color: dark ? "#cfd3da" : "#3a3f4a",
          fontSize: 12.5,
          fontWeight: 600,
          cursor: busy ? "default" : "pointer",
          fontFamily: "var(--font-ui)",
        }}
      >
        {busy ? "Downloading…" : "Download today’s jobs"}
      </button>
      {phase.k !== "idle" && (
        <div
          role="status"
          aria-live="polite"
          style={{ fontSize: 11.5, marginTop: 6, lineHeight: 1.4, color: phase.k === "done" && !phase.ok ? "#b4520a" : dark ? "#9aa0ab" : "#6b7079" }}
        >
          {phase.text}
        </div>
      )}
    </div>
  );
}
