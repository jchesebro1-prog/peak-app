"use client";

import { useSyncExternalStore } from "react";

/** Every element matching `selector` has settled: data-ready="1" or
 *  data-error="1" (the drawing set's plan figures). */
function allSettled(selector: string): boolean {
  return [...document.querySelectorAll(selector)].every(
    (el) => el.getAttribute("data-ready") === "1" || el.getAttribute("data-error") === "1"
  );
}

function subscribeSettled(onChange: () => void): () => void {
  const mo = new MutationObserver(onChange);
  mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-ready", "data-error"] });
  return () => mo.disconnect();
}

const subscribeNothing = () => () => {};

/**
 * Shared print button for single-page letters (window.print() is the only
 * genuinely-client bit). Mirrors the per-letter PrintButton toolbars.
 *
 * `waitFor` (optional, #209): a selector whose elements must all carry
 * data-ready="1" (or data-error="1") before printing is allowed — the
 * drawing set's plan sheets render asynchronously, and printing earlier
 * would capture blank plans.
 */
export function PrintButton({ accent, waitFor }: { accent: string; waitFor?: string }) {
  const ready = useSyncExternalStore(
    waitFor ? subscribeSettled : subscribeNothing,
    () => (waitFor ? allSettled(waitFor) : true),
    () => !waitFor
  );
  return (
    <button
      type="button"
      disabled={!ready}
      title={ready ? undefined : "Waiting for the plan sheets to finish rendering"}
      onClick={() => {
        try {
          window.print();
        } catch {
          /* no-op */
        }
      }}
      style={{
        fontFamily: "var(--font-ui)",
        fontSize: 12.5,
        fontWeight: 600,
        color: "#fff",
        background: accent,
        border: "none",
        borderRadius: 9,
        padding: "9px 15px",
        cursor: ready ? "pointer" : "progress",
        opacity: ready ? 1 : 0.55,
      }}
    >
      {ready ? "Print / Save PDF" : "Preparing sheets…"}
    </button>
  );
}
