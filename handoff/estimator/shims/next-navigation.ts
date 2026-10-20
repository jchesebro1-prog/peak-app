/**
 * Estimator handoff — `next/navigation` for a server-less page. Location state comes from
 * window.location + history: pushState/replaceState are patched to announce a change and
 * popstate is listened to, so useSearchParams/usePathname re-render like Next's.
 * `useRouter().refresh()` goes to the refresh bus (runtime/router.ts). `push`/`replace` keep
 * same-page query changes (`?step=`, `/estimator?id=`) in the page; other app paths fall back
 * to location.assign until the shell's hash routes land (Task 7).
 */
import { useSyncExternalStore } from "react";
import { refresh } from "../runtime/router";

const EVT = "peak-handoff-locationchange";
let patched = false;

function patchHistory(): void {
  if (patched || typeof window === "undefined") return;
  patched = true;
  for (const m of ["pushState", "replaceState"] as const) {
    const orig = window.history[m].bind(window.history);
    window.history[m] = (data: unknown, unused: string, url?: string | URL | null) => {
      try {
        orig(data, unused, url);
      } catch (e) {
        // Some engines refuse query changes on file:// URLs; the page stays put.
        console.warn(`[handoff] history.${m} refused`, String(url), e);
      }
      window.dispatchEvent(new Event(EVT));
    };
  }
  window.addEventListener("popstate", () => window.dispatchEvent(new Event(EVT)));
}
patchHistory();

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVT, cb);
  return () => window.removeEventListener(EVT, cb);
}
const getSearch = () => window.location.search;
const getPath = () => window.location.pathname;

// One URLSearchParams per search string, so the hook's value is referentially stable.
const paramsCache = new Map<string, URLSearchParams>();

export function useSearchParams(): URLSearchParams {
  const s = useSyncExternalStore(subscribe, getSearch, getSearch);
  let p = paramsCache.get(s);
  if (!p) {
    p = new URLSearchParams(s);
    paramsCache.set(s, p);
  }
  return p;
}

export function usePathname(): string {
  return useSyncExternalStore(subscribe, getPath, getPath);
}

/** The same-page part of an href (`?…` or `/estimator?…`), else null. */
function inPageSearch(href: string): string | null {
  if (href.startsWith("?")) return href;
  const m = /^\/estimator(\?[^#]*)?$/.exec(href);
  return m ? m[1] || "" : null;
}

function navigate(kind: "push" | "replace", href: string): void {
  const search = inPageSearch(href);
  if (search !== null) {
    window.history[kind === "push" ? "pushState" : "replaceState"](null, "", window.location.pathname + search);
    return;
  }
  window.location.assign(href);
}

const router = {
  push: (href: string) => navigate("push", href),
  replace: (href: string) => navigate("replace", href),
  refresh: () => refresh(),
  back: () => window.history.back(),
  forward: () => window.history.forward(),
  prefetch: () => {},
};

export function useRouter(): typeof router {
  return router;
}

export function useParams(): Record<string, string> {
  return {};
}

export function useSelectedLayoutSegment(): string | null {
  return null;
}

export function useSelectedLayoutSegments(): string[] {
  return [];
}

export function redirect(href: string): never {
  throw new Error(`redirect(${href}) is not available in the prototype`);
}

export function notFound(): never {
  throw new Error("notFound() is not available in the prototype");
}
