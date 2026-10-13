"use client";

/**
 * Pop-out windows — LiveSync (spec §5). One per window, mounted once in the
 * (app) layout; replaces the #335 Inbox/Home listener. Renders nothing.
 *
 * - A `changed` message from another window → `router.refresh()`, debounced
 *   1 s and trailing-throttled to one per 5 s (D911), deferred while an
 *   editable field is focused or until 3 s after the last keystroke (D913).
 *   `router.refresh()` keeps client state.
 * - Visible again / window focus → refresh when the last one was > 30 s ago,
 *   after a 1.5 s settle; skipped while an editable field is focused (waits)
 *   or the page holds unsaved work (hold.ts, D912).
 * - Offline gate (D910): never refresh while the browser is offline or the
 *   sync engine is disconnected (Next falls back to a full reload, which the
 *   SW answers from cache and in-memory edits are lost). The refresh is
 *   parked and runs ~2 s after `online` / the engine reconnects.
 * - In a main window (not a pop-out): answer "Open in main window" — ack,
 *   focus, navigate. Only the main window focused most recently answers,
 *   and never while it has unsaved work (focused field, typed < 3 s ago, or
 *   the page hold — D912); the pop-out then opens a tab.
 * - Re-applies `pk-pop` (dev Strict Mode resets <html> attributes) and tags
 *   the native shell with `pk-native` so pop-out affordances can hide there.
 * - In a pop-out: saves its position + inner size per kind (spec §4) on resize (debounced
 *   500 ms) and on beforeunload / pagehide.
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { onMessage, postMainAck, windowId } from "@/lib/popout/channel";
import {
  FOCUS_SETTLE_MS,
  ONLINE_RETRY_MS,
  canRefreshOnline,
  canYieldToOpenInMain,
  changeDelayMs,
  nextRefreshStep,
  shouldFocusRefresh,
} from "@/lib/popout/guard";
import { hasUnsavedHold } from "@/lib/popout/hold";
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
import { SYNC_EVENT, getEngine } from "@/lib/sync/engine";

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

  // Window memory (spec §4): a pop-out saves its position + inner size under its kind.
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
    // What this window is owed (see guard.ts `nextRefreshStep`).
    let owedChange = false;
    let owedFocus = false;
    let parkedOffline = false;

    const activeIsEditable = () => isEditableTarget(document.activeElement as HTMLInputElement | null);
    const network = () => {
      let engineConnected: boolean | undefined;
      try {
        engineConnected = getEngine().getStatus().connected;
      } catch {
        // no engine — navigator.onLine alone decides
      }
      return { navigatorOnline: typeof navigator === "undefined" ? undefined : navigator.onLine, engineConnected };
    };

    const refresh = () => {
      owedChange = false;
      owedFocus = false;
      lastRefreshAt.current = Date.now();
      router.refresh();
    };
    // Run an owed refresh now, wait, park it until online (D910), or drop it.
    const attempt = () => {
      timer = null;
      const step = nextRefreshStep({
        owedChange,
        owedFocus,
        ...network(),
        hold: hasUnsavedHold(),
        lastKeyAt: lastKeyAt.current,
        activeIsEditable: activeIsEditable(),
        lastRefreshAt: lastRefreshAt.current,
        now: Date.now(),
      });
      if (step.action === "refresh") refresh();
      else if (step.action === "wait") timer = setTimeout(attempt, step.ms);
      else if (step.action === "offline") parkedOffline = true;
      else if (step.action === "drop") owedFocus = false;
    };
    const schedule = (delayMs: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(attempt, delayMs);
    };
    // Back online (or "Work offline" switched off): run a parked refresh ~2 s later.
    const onBackOnline = () => {
      if (!parkedOffline) return;
      if (!canRefreshOnline(network())) return;
      parkedOffline = false;
      schedule(ONLINE_RETRY_MS);
    };
    // A `changed` message: trailing-throttled to one refresh per 5 s (D911).
    // A pending timer is kept — the refresh it runs fetches every save so far.
    const onChanged = () => {
      owedChange = true;
      if (parkedOffline) {
        onBackOnline();
        return;
      }
      if (timer) return;
      schedule(changeDelayMs(lastRefreshAt.current, Date.now(), CHANGED_DEBOUNCE_MS));
    };
    // Visible again / focus: settle 1.5 s, then the gate re-checks online (D910).
    const onFocusBack = () => {
      if (!shouldFocusRefresh(lastRefreshAt.current, Date.now())) return;
      owedFocus = true;
      if (parkedOffline) {
        onBackOnline();
        return;
      }
      if (timer) return;
      schedule(FOCUS_SETTLE_MS);
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
      onFocusBack();
    };
    const onFocus = () => {
      recordMainFocus();
      onFocusBack();
    };

    const off = onMessage((m) => {
      if (m.type === "changed") {
        onChanged();
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
        // Never navigate away from unsaved work (D912): stay silent so the
        // pop-out falls back to a new tab.
        if (!canYieldToOpenInMain({ activeIsEditable: activeIsEditable(), lastKeyAt: lastKeyAt.current, now: Date.now(), hold: hasUnsavedHold() })) return;
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
    window.addEventListener("online", onBackOnline);
    window.addEventListener(SYNC_EVENT, onBackOnline);
    window.addEventListener("pagehide", forgetMainFocus);
    return () => {
      if (timer) clearTimeout(timer);
      off();
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onBackOnline);
      window.removeEventListener(SYNC_EVENT, onBackOnline);
      window.removeEventListener("pagehide", forgetMainFocus);
      forgetMainFocus();
    };
  }, [router]);

  return null;
}
