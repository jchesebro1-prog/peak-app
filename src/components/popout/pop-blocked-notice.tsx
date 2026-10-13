"use client";

/**
 * Pop-out windows — the "pop-up blocked" notice (spec §1). The app has no
 * global toast, so this small fixed banner (mounted once in the (app) layout)
 * listens for openPopout's blocked event and hides itself after 6 s.
 */
import { useEffect, useState } from "react";
import { POP_BLOCKED_EVENT, POP_BLOCKED_MESSAGE, POP_BLOCKED_MS } from "@/lib/popout/click";

export default function PopBlockedNotice() {
  const [shownAt, setShownAt] = useState<number | null>(null);

  useEffect(() => {
    const onBlocked = () => setShownAt(Date.now());
    window.addEventListener(POP_BLOCKED_EVENT, onBlocked);
    return () => window.removeEventListener(POP_BLOCKED_EVENT, onBlocked);
  }, []);

  useEffect(() => {
    if (shownAt === null) return;
    const t = setTimeout(() => setShownAt(null), POP_BLOCKED_MS);
    return () => clearTimeout(t);
  }, [shownAt]);

  // The live region stays mounted so the message is announced when it appears.
  return (
    <div role="status" aria-live="polite">
      {shownAt !== null && (
        <div className="pk-pop-blocked">
          <span>{POP_BLOCKED_MESSAGE}</span>
          <button type="button" className="pk-pop-blocked-close" aria-label="Dismiss" onClick={() => setShownAt(null)}>
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
