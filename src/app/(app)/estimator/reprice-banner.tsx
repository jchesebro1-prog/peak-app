"use client";

import { useState, useSyncExternalStore } from "react";
import { repriceHeadline, type RepricedOnRevise } from "@/lib/estimate-reprice/rules";

/**
 * #368 (spec §9.1) — the Build banner after a Revise re-priced lines to today's
 * catalog: "Revise re-priced 12 lines to today's catalog (+$1,240)", an
 * expandable old → new list, and the systems whose typed price was kept.
 * Styled like the Assist-draft banner. Dismiss hides it for this viewer only
 * (localStorage, keyed by quote + the revise's time, so the next revise shows
 * again); every storage access is guarded — a blocked store just means the
 * banner shows until dismissed in this tab.
 */

const KEY_PREFIX = "peak:reprice-dismissed:";
const listeners = new Set<() => void>();

function readDismissed(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

const money = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function RepriceBanner({ view, quoteId, show }: { view: RepricedOnRevise | null | undefined; quoteId: string | null; show: boolean }) {
  const key = quoteId ? KEY_PREFIX + quoteId : "";
  // The server snapshot is "not dismissed" — the stored choice applies once hydrated.
  const stored = useSyncExternalStore(subscribe, () => (key ? readDismissed(key) : null), () => null);
  const [hiddenAt, setHiddenAt] = useState<number | null>(null);
  if (!view || !show || !view.count) return null;
  if (hiddenAt === view.at || stored === String(view.at)) return null;
  const ink = "#2b4a7a";
  const more = view.count - view.lines.length;
  return (
    <div
      role="status"
      data-testid="reprice-banner"
      style={{ margin: "0 0 12px", padding: "10px 14px", background: "#eef3fb", border: "1px solid #cddaf0", borderRadius: 8, color: ink, fontSize: 12.5 }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ fontWeight: 600 }}>{repriceHeadline(view)}</div>
        <button
          type="button"
          onClick={() => {
            setHiddenAt(view.at);
            if (!key) return;
            try {
              window.localStorage.setItem(key, String(view.at));
            } catch {
              // Storage blocked — the banner stays hidden for this page view only.
            }
            listeners.forEach((l) => l());
          }}
          style={{ fontSize: 12.5, fontWeight: 600, color: ink, background: "transparent", border: "none", cursor: "pointer", padding: "2px 4px", flexShrink: 0 }}
        >
          Dismiss
        </button>
      </div>
      {view.typedSystems.length > 0 && (
        <p style={{ margin: "6px 0 0" }}>
          Typed system price kept: {view.typedSystems.map((t) => t.name || "Untitled system").join(", ")} — its lines&apos; cost moved, its price didn&apos;t.
        </p>
      )}
      <details style={{ marginTop: 6 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Show the lines ({view.count})</summary>
        <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
          {view.lines.map((l) => (
            <li key={l.sectionId + ":" + l.lineId}>
              <strong style={{ fontWeight: 600 }}>{l.desc || l.sku}</strong>
              {l.desc && l.sku ? <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}> {l.sku}</span> : null}
              {" — cost "}
              {money(l.oldCost)} → {money(l.newCost)}
              {", sell "}
              {money(l.oldPrice)} → {money(l.newPrice)}
            </li>
          ))}
          {more > 0 && <li>…and {more} more</li>}
        </ul>
      </details>
    </div>
  );
}
