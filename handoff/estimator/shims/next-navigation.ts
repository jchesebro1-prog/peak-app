/**
 * Estimator handoff — `next/navigation` for a server-less page. Location state comes from
 * window.location + history: pushState/replaceState are patched to announce a change and
 * popstate is listened to, so useSearchParams/usePathname re-render like Next's.
 * `useRouter().refresh()` goes to the refresh bus (runtime/router.ts).
 *
 * The shell's route lives in `location.hash` (runtime/routes.ts); the Estimator owns `location.search`
 * (`?id=`, `?step=`, `?ptab=`). The patched pushState/replaceState therefore (1) keep the route hash when the
 * Estimator rewrites only the search, (2) move the hash to a new estimate's id when a first save puts it in the
 * search, and (3) turn the Estimator's in-page anchors (`#systems`) into a scroll, since the hash is the route.
 * `router.push/replace` map app paths onto routes (`/estimator?id=X` → `#/estimate/X`, `/quotes` → `#/estimates`,
 * `/catalog`, `/design/assemblies`, `/estimating-rules`); same-page query changes stay on the page; anything else
 * raises the "Not part of the prototype" notice. Plan: PR 2 Task 7.
 */
import { useSyncExternalStore } from "react";
import { refresh } from "../runtime/router";
import { composeHistoryUrl, mapAppHref, normalizedLocation, NOT_IN_PROTOTYPE_COPY, parseRoute, routeHash, routeSearch, type Route } from "../runtime/routes";

const EVT = "peak-handoff-locationchange";
/** Fired on window with a `detail` saying who moved the location. */
export type LocationChange = { source: "nav" | "app" };
export const NOTICE_EVT = "peak-handoff-notice";
let patched = false;

const emit = (source: LocationChange["source"]) => window.dispatchEvent(new CustomEvent<LocationChange>(EVT, { detail: { source } }));

/** Scrolls to `#id`, retrying for a moment: the Estimator pushes the anchor in the same tick it switches the tab. */
export function scrollToAnchor(id: string): void {
  let tries = 0;
  const step = () => {
    const el = document.getElementById(id);
    if (el && el.getClientRects().length) el.scrollIntoView({ block: "start" });
    else if (++tries < 20) setTimeout(step, 50);
  };
  step();
}

function patchHistory(): void {
  if (patched || typeof window === "undefined") return;
  patched = true;
  for (const m of ["pushState", "replaceState"] as const) {
    const orig = window.history[m].bind(window.history);
    window.history[m] = (data: unknown, unused: string, url?: string | URL | null) => {
      let target = url;
      let anchor: string | null = null;
      let explicit = false;
      if (url != null) {
        try {
          const c = composeHistoryUrl(window.location.href, String(url));
          target = c.url;
          anchor = c.anchor;
          explicit = c.explicit;
        } catch {
          /* an unparseable url goes to the browser as given */
        }
      }
      try {
        orig(data, unused, target);
      } catch (e) {
        // Some engines refuse query changes on file:// URLs; the page stays put.
        console.warn(`[handoff] history.${m} refused`, String(url), e);
      }
      emit(explicit ? "nav" : "app");
      if (anchor) scrollToAnchor(anchor);
    };
  }
  window.addEventListener("popstate", () => emit("nav"));
}
patchHistory();

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVT, cb);
  return () => window.removeEventListener(EVT, cb);
}
const getSearch = () => window.location.search;
const getPath = () => window.location.pathname;

/** Like Next's ReadonlyURLSearchParams: reads work, every mutator throws. */
class ReadonlySearchParams extends URLSearchParams {
  append(): never {
    throw new Error("URLSearchParams is read-only in the prototype");
  }
  delete(): never {
    throw new Error("URLSearchParams is read-only in the prototype");
  }
  set(): never {
    throw new Error("URLSearchParams is read-only in the prototype");
  }
  sort(): never {
    throw new Error("URLSearchParams is read-only in the prototype");
  }
}

// One read-only view per search string, so the hook's value is referentially stable.
const paramsCache = new Map<string, URLSearchParams>();

export function useSearchParams(): URLSearchParams {
  const s = useSyncExternalStore(subscribe, getSearch, getSearch);
  let p = paramsCache.get(s);
  if (!p) {
    p = new ReadonlySearchParams(s);
    paramsCache.set(s, p);
  }
  return p;
}

export function usePathname(): string {
  return useSyncExternalStore(subscribe, getPath, getPath);
}

/** The route the location names now. */
export function currentRoute(): Route {
  return parseRoute(window.location.hash, window.location.search);
}

/** Calls `fn` on every location change (pushState / replaceState / popstate), with who moved it. Returns the unsubscribe. */
export function subscribeLocation(fn: (c: LocationChange) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<LocationChange>).detail ?? { source: "app" });
  window.addEventListener(EVT, h);
  return () => window.removeEventListener(EVT, h);
}

/** Shows the shell's non-blocking notice (ui/preview-overlay.tsx listens). */
export function showShellNotice(text: string): void {
  window.dispatchEvent(new CustomEvent<string>(NOTICE_EVT, { detail: text }));
}

/** Moves to a shell route (a history entry, or in place with `replace`). The Estimator's own params ride in `search`. */
export function goTo(route: Route, opts: { replace?: boolean; search?: string; anchor?: string | null } = {}): void {
  const search = opts.search ?? routeSearch(route);
  const hash = routeHash(route);
  const url = window.location.pathname + search + hash;
  // Already there (a nav tab clicked twice): no new history entry.
  if (url !== window.location.pathname + window.location.search + window.location.hash) window.history[opts.replace ? "replaceState" : "pushState"](null, "", url);
  if (opts.anchor) scrollToAnchor(opts.anchor);
}

/**
 * Makes the location consistent with its route (hash wins): a pre-shell deep link (`?id=X`, no hash), a typed hash
 * whose search names another estimate, a stale search left on a non-estimate route. In place — no history entry.
 */
export function normalizeLocation(): void {
  const fixed = normalizedLocation(window.location.href);
  if (fixed) window.history.replaceState(null, "", fixed);
}

function navigate(kind: "push" | "replace", href: string): void {
  const target = mapAppHref(href, currentRoute());
  switch (target.kind) {
    case "route":
      goTo(target.route, { replace: kind === "replace", search: target.search, anchor: target.anchor });
      return;
    case "page":
      window.history[kind === "push" ? "pushState" : "replaceState"](null, "", window.location.pathname + target.search + (target.anchor ? "#" + target.anchor : ""));
      return;
    case "anchor":
      scrollToAnchor(target.anchor);
      return;
    case "unsupported":
      console.warn(`[handoff] ${NOT_IN_PROTOTYPE_COPY}: ${target.path}`);
      showShellNotice(`${NOT_IN_PROTOTYPE_COPY}: ${target.path}`);
      return;
    case "external":
      window.location.assign(href);
  }
}

const router = {
  push: (href: string) => navigate("push", href),
  replace: (href: string) => navigate("replace", href),
  refresh: () => refresh(),
  back: () => window.history.back(),
  forward: () => window.history.forward(),
  prefetch: () => {},
};

/** The router outside a component (ui/link-routing.ts, the shell). */
export const appRouter = router;

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
