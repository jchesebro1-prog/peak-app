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
import { adoptedLocation, composeHistoryUrl, mapAppHref, NEW_ESTIMATE_ID, normalizedLocation, NOT_IN_PROTOTYPE_COPY, parseRoute, routeHash, routeSearch, withForeignParams, type Route } from "../runtime/routes";

const EVT = "peak-handoff-locationchange";
/** Fired on window with a `detail` saying who moved the location. */
export type LocationChange = { source: "nav" | "app" };
export const NOTICE_EVT = "peak-handoff-notice";
let patched = false;

const emit = (source: LocationChange["source"]) => window.dispatchEvent(new CustomEvent<LocationChange>(EVT, { detail: { source } }));

/** How long an in-page anchor waits for its element (a tab that mounts lazily, a panel shown a moment later). */
export const ANCHOR_WAIT_MS = 5000;
let cancelAnchor: (() => void) | null = null;

/**
 * Scrolls to `#id` once the element exists and is laid out — the Estimator pushes the anchor in the same tick it
 * switches the step/tab, and the target panel mounts (or stops being display:none) after that. Watches the DOM
 * (MutationObserver) for up to ANCHOR_WAIT_MS; a newer anchor request replaces a pending one.
 */
export function scrollToAnchor(id: string): void {
  cancelAnchor?.();
  const ready = () => {
    const el = document.getElementById(id);
    return el && el.getClientRects().length ? el : null;
  };
  const now = ready();
  if (now) {
    now.scrollIntoView({ block: "start" });
    return;
  }
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    obs.disconnect();
    clearTimeout(timer);
    if (cancelAnchor === finish) cancelAnchor = null;
  };
  const obs = new MutationObserver(() => {
    const el = ready();
    if (!el) return;
    finish();
    // After this frame's layout, so a panel that just turned visible has its final position.
    requestAnimationFrame(() => el.scrollIntoView({ block: "start" }));
  });
  obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "hidden", "id"] });
  const timer = setTimeout(finish, ANCHOR_WAIT_MS);
  cancelAnchor = finish;
}

/* ------------------------------------------------------------------ a new estimate's history entries */

/**
 * Every history entry on an estimate route carries a session token in its state (`__handoffEstimate`). A new
 * estimate's first save records token → minted id; when the user later comes back (Back / Forward) to an entry of
 * that session still on `#/estimate/new`, normalizeLocation re-points it at the saved estimate instead of opening a
 * blank new one. Kept in sessionStorage so it survives a reload of the window.
 */
const TOKEN = "__handoffEstimate";
const ADOPTED_KEY = "peak-handoff-adopted";
const adopted = new Map<string, string>();
try {
  const raw = typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(ADOPTED_KEY);
  if (raw) for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, string>)) if (typeof v === "string") adopted.set(k, v);
} catch {
  /* no sessionStorage — adoption lasts until the window closes */
}
const tokenOf = (state: unknown): string | null => {
  const t = state && typeof state === "object" ? (state as Record<string, unknown>)[TOKEN] : null;
  return typeof t === "string" ? t : null;
};
const mintToken = () => `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
/** `data` with the token added (null → a fresh object; a non-plain state is left as the caller gave it). */
const withToken = (data: unknown, token: string): unknown => (data == null ? { [TOKEN]: token } : isPlainObject(data) ? { ...data, [TOKEN]: token } : data);
function adopt(token: string, id: string): void {
  adopted.set(token, id);
  try {
    sessionStorage.setItem(ADOPTED_KEY, JSON.stringify(Object.fromEntries(adopted)));
  } catch {
    /* in memory only */
  }
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
      // The entry's estimate session (see TOKEN): a shell push to an estimate starts one; anything else continues it.
      const before = currentRoute();
      const beforeToken = tokenOf(window.history.state);
      let state = data;
      let after: Route | null = null;
      try {
        const u = new URL(target == null ? window.location.href : String(target), window.location.href);
        after = parseRoute(u.hash, u.search);
      } catch {
        /* leave the state as given */
      }
      if (after?.name === "estimate") {
        const token = (m === "pushState" && explicit) || !beforeToken ? mintToken() : beforeToken;
        state = withToken(data, token);
        // A new estimate's first save: its entries (this one and any pushed before it) now belong to the saved id.
        if (!explicit && before.name === "estimate" && before.id === NEW_ESTIMATE_ID && after.id !== NEW_ESTIMATE_ID) adopt(token, after.id);
      }
      try {
        orig(state, unused, target);
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
  // The route's own params, plus any the host put on the URL (a version or token param an Artifact adds).
  const search = withForeignParams(opts.search ?? routeSearch(route), window.location.search);
  const hash = routeHash(route);
  const url = window.location.pathname + search + hash;
  // Already there (a nav tab clicked twice): no new history entry.
  if (url !== window.location.pathname + window.location.search + window.location.hash) window.history[opts.replace ? "replaceState" : "pushState"](null, "", url);
  if (opts.anchor) scrollToAnchor(opts.anchor);
}

/**
 * Makes the location consistent with its route (hash wins): a pre-shell deep link (`?id=X`, no hash), a typed hash
 * whose search names another estimate, a stale search left on a non-estimate route. An entry of a new estimate whose
 * session has since been saved is re-pointed at the saved id (adoptedLocation), so Back / Forward into it reopens that
 * estimate instead of a blank one. An estimate entry with no session token gets one. In place — no history entry.
 */
export function normalizeLocation(): void {
  const token = tokenOf(window.history.state);
  const savedAs = token ? adopted.get(token) : undefined;
  const fixed = (savedAs && adoptedLocation(window.location.href, savedAs)) || normalizedLocation(window.location.href);
  if (fixed) window.history.replaceState(window.history.state, "", fixed);
  else if (!token && currentRoute().name === "estimate" && (window.history.state == null || isPlainObject(window.history.state))) window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search + window.location.hash);
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
