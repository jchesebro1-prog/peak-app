"use client";

/**
 * #335 Inbox organization (spec §9) — refresh this page when another window
 * or tab changes something (a `changed` message on BroadcastChannel("peak");
 * the legacy `inbox-changed` is mapped by `onMessage`), debounced 1 s.
 * Mounted by the Inbox shell and Home. Renders nothing. The pop-out spec's
 * LiveSync replaces this.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { onMessage } from "@/lib/popout/channel";

export default function InboxChangedListener() {
  const router = useRouter();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = onMessage((m) => {
      if (m.type !== "changed") return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        router.refresh();
      }, 1000);
    });
    return () => {
      if (timer) clearTimeout(timer);
      off();
    };
  }, [router]);
  return null;
}
