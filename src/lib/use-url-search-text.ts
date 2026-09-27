"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { shouldAdoptUrlQ } from "./url-search-text";

/**
 * #243 — the draft text of a URL-as-state search box (Companies, People,
 * Vendors, Specs coverage).
 *
 * These pages are heavy server renders, so a debounced navigation for
 * "acm" can land after the user has typed on to "acme co". The old
 * per-page copy reset the draft to the URL's `q` on every change — so the
 * box jumped back to the stale, trimmed "acm", then forward again when the
 * next navigation landed: characters vanished and trailing spaces were
 * eaten. Here the draft re-syncs from the URL only when `q` is not the
 * value this box itself last navigated to (shouldAdoptUrlQ), so Back or a
 * "clear" link still reset it and our own navigation never does.
 *
 * Keystrokes navigate with router.replace (no history entry per pause, no
 * scroll jump); `go` is for the filter chips/selects and keeps push. Both
 * run in a transition, so `isPending` is true until the server render lands.
 *
 * The re-sync is a derived-state reset during render, not an effect
 * (react-hooks/set-state-in-effect is an error in this repo), so the last
 * pushed value lives in state rather than a ref.
 */
export function useUrlSearchText(
  q: string,
  delayMs = 300
): {
  /** What the search box shows. */
  text: string;
  /** Search box onChange: update the draft and, after `delayMs`, replace the URL with `href`. */
  setSearch: (v: string, href: string) => void;
  /** A filter chip/select: cancel any pending search navigation and push `href` (built from the current `text`). */
  go: (href: string) => void;
  /** A navigation from this bar is still rendering on the server. */
  isPending: boolean;
} {
  const router = useRouter();
  const [text, setText] = useState(q);
  const [prevQ, setPrevQ] = useState(q);
  const [lastPushed, setLastPushed] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (prevQ !== q) {
    setPrevQ(q);
    if (shouldAdoptUrlQ(q, lastPushed, text)) {
      setText(q);
      setLastPushed(null);
    }
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const setSearch = (v: string, href: string) => {
    setText(v);
    cancel();
    timer.current = setTimeout(() => {
      timer.current = null;
      setLastPushed(v.trim());
      startTransition(() => router.replace(href, { scroll: false }));
    }, delayMs);
  };

  const go = (href: string) => {
    cancel();
    setLastPushed(text.trim());
    startTransition(() => router.push(href));
  };

  return { text, setSearch, go, isPending };
}
