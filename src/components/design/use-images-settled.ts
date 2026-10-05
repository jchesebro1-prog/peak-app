"use client";

import { useEffect, useState } from "react";

/** How long a print waits on a drawing before printing anyway. */
export const IMAGES_SETTLE_TIMEOUT_MS = 5000;

/**
 * #300: true once every URL has loaded or failed — or after `timeoutMs`, so a
 * broken or slow drawing never blocks printing. No URLs → true at once (also
 * on the server render). Each URL is fetched through a detached Image, which
 * shares the browser cache with the `<image href>` / `<img>` that draws it
 * and, unlike a server-rendered element, cannot fire its load before a
 * listener is attached. The drawing-set figures gate `data-ready` on it.
 */
export function useImagesSettled(hrefs: readonly string[], timeoutMs: number = IMAGES_SETTLE_TIMEOUT_MS): boolean {
  const key = [...new Set(hrefs)].sort().join("\n");
  const [settledKey, setSettledKey] = useState<string | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    const finish = () => {
      if (live) setSettledKey(key);
    };
    const timer = window.setTimeout(finish, timeoutMs);
    const urls = key.split("\n");
    let left = urls.length;
    const imgs = urls.map((src) => {
      const img = new Image();
      const one = () => {
        left -= 1;
        if (left <= 0) {
          window.clearTimeout(timer);
          finish();
        }
      };
      img.onload = one;
      img.onerror = one;
      img.src = src;
      return img;
    });
    return () => {
      live = false;
      window.clearTimeout(timer);
      for (const img of imgs) {
        img.onload = null;
        img.onerror = null;
      }
    };
  }, [key, timeoutMs]);
  return !key || settledKey === key;
}
