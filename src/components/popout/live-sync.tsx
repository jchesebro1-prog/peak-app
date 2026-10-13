"use client";

/**
 * Pop-out windows — LiveSync (spec §5). One per window, mounted once in the
 * (app) layout; replaces the #335 Inbox/Home listener. Renders nothing.
 *
 * - A `changed` message from another window → `router.refresh()`, debounced
 *   1 s, deferred while the person is typing (guard.ts: until 3 s after the
 *   last keystroke in an editable field). `router.refresh()` keeps client state.
 * - Visible again / window focus → refresh when the last one was > 30 s ago.
 * - In a main window (not a pop-out): answer "Open in main window" — ack,
 *   focus, navigate. Only the main window focused most recently answers.
 * - Re-applies `pk-pop` (dev Strict Mode resets <html> attributes) and tags
 *   the native shell with `pk-native` so pop-out affordances can hide there.
 * - In a pop-out: saves its frame per kind (spec §4) on resize (debounced
 *   500 ms) and on beforeunload / pagehide.
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { onMessage, postMainAck, windowId } from "@/lib/popout/channel";
import { shouldFocusRefresh, shouldRefreshNow } from "@/lib/popout/guard";
import { isPopWindow, savePopGeometry } from "@/lib/popout/open";
import {
  MAIN_FOCUS_KEY,
  NATIVE_CLASS,
  POP_CLASS,
  isEditableTarget,
  shouldAnswerOpenInMain,
  toAppPath,
} from "@/lib/popout/live";
import { isNativePlatform } from "@/lib/platform";

const CHANGED_DEBOUNCE_MS = 1000;
const GEOMETRY_DEBOUNCE_MS = 500;

export default function LiveSync() {
  const router = useRouter();
  const pathname = usePathname();
  const lastKeyAt = useRef<number | null>(null);
  const lastRefreshAt = useRef<number>(0);

  // Pop-out / native classes on <html> — before paint.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (isPopWindow()) root.classList.add(POP_CLASS);
    try {
      if (isNativePlatform()) root.classList.add(NATIVE_CLASS);
    } catch {
      // no Capacitor bridge — a plain browser
    }
  }, []);

  // Window memory (spec §4): a pop-out saves its frame under its kind.
  useEffect(() => {
    if (!isPopWindow()) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        savePopGeometry();
      }, GEOMETRY_DEBOUNCE_MS);
    };
    const saveNow = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      savePopGeometry();
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("beforeunload", saveNow);
    window.addEventListener("pagehide", saveNow);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("beforeunload", saveNow);
      window.removeEventListener("pagehide", saveNow);
    };
  }, []);

  // A navigation renders fresh server data: it counts as a refresh.
  useEffect(() => {
    lastRefreshAt.current = Date.now();
  }, [pathname]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const refresh = () => {
      lastRefreshAt.current = Date.now();
      router.refresh();
    };
    // Run a refresh now, or after the typing guard says it may.
    const attempt = () => {
      timer = null;
      const decision = shouldRefreshNow({
        lastKeyAt: lastKeyAt.current,
        now: Date.now(),
        activeIsEditable: isEditableTarget(document.activeElement as HTMLInputElement | null),
      });
      if (decision === "now") refresh();
      else timer = setTimeout(attempt, decision.deferMs);
    };
    const schedule = (delayMs: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(attempt, delayMs);
    };

    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target as HTMLInputElement | null)) lastKeyAt.current = Date.now();
    };

    const recordMainFocus = () => {
      if (isPopWindow()) return;
      try {
        localStorage.setItem(MAIN_FOCUS_KEY, JSON.stringify({ id: windowId(), at: Date.now() }));
      } catch {
        // storage blocked — every main window answers
      }
    };
    const forgetMainFocus = () => {
      if (isPopWindow()) return;
      try {
        if (!shouldAnswerOpenInMain(windowId(), localStorage.getItem(MAIN_FOCUS_KEY))) return;
        localStorage.removeItem(MAIN_FOCUS_KEY);
      } catch {
        // storage blocked
      }
    };

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      recordMainFocus();
      if (shouldFocusRefresh(lastRefreshAt.current, Date.now())) schedule(0);
    };
    const onFocus = () => {
      recordMainFocus();
      if (shouldFocusRefresh(lastRefreshAt.current, Date.now())) schedule(0);
    };

    const off = onMessage((m) => {
      if (m.type === "changed") {
        schedule(CHANGED_DEBOUNCE_MS);
        return;
      }
      if (m.type === "open-in-main") {
        if (isPopWindow()) return;
        let answer = true;
        try {
          answer = shouldAnswerOpenInMain(windowId(), localStorage.getItem(MAIN_FOCUS_KEY));
        } catch {
          // storage blocked — answer
        }
        if (!answer) return;
        const path = toAppPath(m.url, window.location.origin);
        if (!path) return;
        postMainAck(m.url);
        try {
          window.focus();
        } catch {
          // the browser may refuse to raise the window
        }
        router.push(path);
      }
    });

    try {
      if (document.hasFocus()) recordMainFocus();
    } catch {
      // ignore
    }
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pagehide", forgetMainFocus);
    return () => {
      if (timer) clearTimeout(timer);
      off();
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pagehide", forgetMainFocus);
      forgetMainFocus();
    };
  }, [router]);

  return null;
}
