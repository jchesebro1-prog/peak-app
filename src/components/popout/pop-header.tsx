"use client";

/**
 * Pop-out windows — the slim header a pop-out shows in place of the nav
 * (spec §2). Rendered once in the (app) layout; CSS keeps `.pk-pop-header`
 * hidden unless <html> has `pk-pop`. Title from `document.title` (kept
 * current across in-window navigation), "Open in main window" (asks the main
 * window over the channel, else a normal tab after 500 ms), and ✕.
 */
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { postOpenInMain } from "@/lib/popout/channel";
import { popHeaderTitle } from "@/lib/popout/live";

const ACK_MS = 500;

export default function PopHeader() {
  const pathname = usePathname();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const read = () => setTitle(popHeaderTitle(document.title));
    read();
    // Next swaps the <title> after a client navigation — follow it.
    let obs: MutationObserver | null = null;
    try {
      obs = new MutationObserver(read);
      obs.observe(document.head, { subtree: true, childList: true, characterData: true });
    } catch {
      // no MutationObserver — the pathname dependency still re-reads
    }
    return () => obs?.disconnect();
  }, [pathname]);

  async function openInMain() {
    if (busy) return;
    setBusy(true);
    const url = window.location.href;
    let answered = false;
    try {
      answered = await postOpenInMain(url, ACK_MS);
    } catch {
      answered = false;
    }
    if (!answered) {
      try {
        window.open(url, "_blank", "noopener");
      } catch {
        // blocked — nothing more to do
      }
    }
    setBusy(false);
  }

  function close() {
    try {
      window.close();
    } catch {
      // not script-closable
    }
  }

  return (
    <header className="pk-pop-header" aria-label="Pop-out window">
      <div className="pk-pop-header-title" title={title}>
        {title}
      </div>
      <div className="pk-pop-header-actions">
        <button type="button" className="pk-pop-header-btn" onClick={openInMain} disabled={busy}>
          Open in main window
        </button>
        <button type="button" className="pk-pop-header-btn pk-pop-header-close" onClick={close} aria-label="Close this window">
          ✕
        </button>
      </div>
    </header>
  );
}
