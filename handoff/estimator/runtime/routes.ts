/**
 * Estimator handoff — the shell's routes (pure: no window, so the Node checks import it).
 *
 * The route lives in `location.hash`, so `file://` and an Artifact URL behave the same:
 *
 *   #/estimates            the Estimates list (the default)
 *   #/estimate/<id>        one estimate, in the real Estimator   (search: ?id=<id>[&step=…&ptab=…])
 *   #/estimate/new         a clean new estimate                  (search: ?new=1)
 *   #/catalog  #/assemblies  #/rules
 *
 * The estimate's id and step ALSO stay in `location.search` (`?id=…&step=review`), because the real Estimator reads
 * and writes exactly those with `useSearchParams` / `history.pushState` (stepSearch, packageTabSearch). So the search
 * belongs to the Estimator and the hash to the shell: the history shim (shims/next-navigation.ts) keeps the hash
 * whenever the Estimator rewrites the search, and moves the hash to the new id when a first save mints one.
 *
 * `mapAppHref` is `router.push` / link-click routing: an app path the Estimator links to (`/estimator?id=X`,
 * `/quotes`, `/catalog`, `/design/assemblies`, `/estimating-rules`) → a shell route; a same-page query change
 * (`?step=…`, `/estimator?step=…`) → the page; anything else → "Not part of the prototype". Plan: PR 2 Task 7.
 */

/** The id the route uses for a clean, not-yet-saved estimate. */
export const NEW_ESTIMATE_ID = "new";

export type Route =
  | { name: "estimates" }
  | { name: "estimate"; id: string }
  | { name: "catalog" }
  | { name: "assemblies" }
  | { name: "rules" }
  | { name: "unknown"; path: string };

/** The top-nav entries, in order. */
export const NAV_ROUTES = [
  { name: "estimates", label: "Estimates" },
  { name: "catalog", label: "Catalog" },
  { name: "assemblies", label: "Assemblies" },
  { name: "rules", label: "Estimating Rules" },
] as const;

/** Shown wherever a link or push leaves the prototype. */
export const NOT_IN_PROTOTYPE_COPY = "Not part of the prototype";

const SIMPLE: Record<string, Route> = {
  estimates: { name: "estimates" },
  catalog: { name: "catalog" },
  assemblies: { name: "assemblies" },
  rules: { name: "rules" },
};

/** The hash for a route (`#/estimate/Q-G001`). Unknown routes keep their path. */
export function routeHash(r: Route): string {
  switch (r.name) {
    case "estimate":
      return `#/estimate/${encodeURIComponent(r.id)}`;
    case "unknown":
      return `#/${r.path.replace(/^\/+/, "")}`;
    default:
      return `#/${r.name}`;
  }
}

/** The search a shell navigation to `r` starts with: the Estimator's `?id=` / `?new=1`, else none. */
export function routeSearch(r: Route): string {
  if (r.name !== "estimate") return "";
  return r.id === NEW_ESTIMATE_ID ? "?new=1" : `?id=${encodeURIComponent(r.id)}`;
}

const isRouteHash = (hash: string): boolean => hash.startsWith("#/");

/* ------------------------------------------------------------------ query params the page owns vs. a host's */

/**
 * The query params the shell and the Estimator own: the estimate's id / new flag, its step and Build package tab
 * (stepSearch / packageTabSearch), and the intake hand-off params a new estimate opens with (readHandoff). Every
 * OTHER param is the host's — an Artifact or a share link may add e.g. a version or token param — and survives every
 * navigation the shell or the Estimator makes (`withForeignParams`).
 */
export const OWNED_PARAMS: ReadonlySet<string> = new Set(["id", "new", "step", "ptab", "type", "category", "customer", "venue", "contact", "name", "replaces", "thread", "lead", "suggestion"]);

const paramsOf = (search: string) => new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
const searchOf = (p: URLSearchParams) => {
  const s = p.toString();
  return s ? "?" + s : "";
};

/** `next` plus every param of `from` the page does not own and `next` does not name. */
export function withForeignParams(next: string, from: string): string {
  const out = paramsOf(next);
  const keep = paramsOf(from);
  let added = false;
  for (const k of new Set(keep.keys())) {
    if (OWNED_PARAMS.has(k) || out.has(k)) continue;
    for (const v of keep.getAll(k)) out.append(k, v);
    added = true;
  }
  return added ? searchOf(out) : next;
}

/** `search` without the params the page owns (a non-estimate route's search: only the host's params). */
export function foreignOnly(search: string): string {
  const p = paramsOf(search);
  for (const k of [...new Set(p.keys())]) if (OWNED_PARAMS.has(k)) p.delete(k);
  return searchOf(p);
}

/**
 * The route a location names. A `#/…` hash decides. Without one (a bare file, a pre-shell deep link such as
 * `index.html?id=Q-G001&step=review`, or an in-page anchor like `#systems`) the search decides: `?id=` → that
 * estimate, `?new=1` → a new one, else the list.
 */
export function parseRoute(hash: string, search: string): Route {
  if (isRouteHash(hash)) {
    const path = hash.slice(2).split(/[?#]/)[0].replace(/\/+$/, "");
    const [head, ...rest] = path.split("/");
    if (head === "" || head === "estimates") return rest.length ? { name: "unknown", path } : SIMPLE.estimates;
    if (head === "estimate") {
      if (rest.length !== 1 || !rest[0]) return { name: "unknown", path };
      let id = rest[0];
      try {
        id = decodeURIComponent(id);
      } catch {
        /* keep the raw id */
      }
      return { name: "estimate", id };
    }
    if (rest.length === 0 && SIMPLE[head]) return SIMPLE[head];
    return { name: "unknown", path };
  }
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const id = params.get("id");
  if (id) return { name: "estimate", id };
  if (params.get("new") === "1") return { name: "estimate", id: NEW_ESTIMATE_ID };
  return SIMPLE.estimates;
}

/** True when `a` and `b` name the same screen (an estimate by id). */
export function sameRoute(a: Route, b: Route): boolean {
  if (a.name !== b.name) return false;
  if (a.name === "estimate" && b.name === "estimate") return a.id === b.id;
  if (a.name === "unknown" && b.name === "unknown") return a.path === b.path;
  return true;
}

/* ------------------------------------------------------------------ app paths → routes */

export type AppTarget =
  /** A shell route, with the search to land on (the Estimator's own params). */
  | { kind: "route"; route: Route; search: string; anchor: string | null }
  /** A query change on the current page (`?step=review`), optionally with an in-page anchor. */
  | { kind: "page"; search: string; anchor: string | null }
  /** `#section` — scroll only; the route hash stays. */
  | { kind: "anchor"; anchor: string }
  /** An app path the prototype does not have. */
  | { kind: "unsupported"; path: string }
  /** Another site, mailto:, a packaged file… — the browser's own business. */
  | { kind: "external" };

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Where an app href goes. `current` is the route the page is on now: `/estimator?step=…` with no `id` is a
 * same-page change only while an estimate is open (else it starts a new estimate, as the app's own /estimator does).
 */
export function mapAppHref(href: string, current: Route): AppTarget {
  if (typeof href !== "string") return { kind: "external" };
  const raw = href.trim();
  if (raw === "") return { kind: "external" };
  if (SCHEME.test(raw) || raw.startsWith("//")) return { kind: "external" };
  // Only root-relative app paths, `?query` and `#hash` are the app's; anything else ("images/x.webp", "./a") is a file.
  if (!raw.startsWith("/") && !raw.startsWith("?") && !raw.startsWith("#")) return { kind: "external" };
  let u: URL;
  try {
    u = new URL(raw, "http://handoff.invalid/");
  } catch {
    return { kind: "external" };
  }
  const anchor = u.hash.length > 1 && !isRouteHash(u.hash) ? u.hash.slice(1) : null;
  if (raw.startsWith("#")) {
    if (isRouteHash(raw)) {
      const route = parseRoute(raw, "");
      return route.name === "unknown" ? { kind: "unsupported", path: route.path } : { kind: "route", route, search: routeSearch(route), anchor: null };
    }
    return anchor ? { kind: "anchor", anchor } : { kind: "external" };
  }
  if (raw.startsWith("?")) return { kind: "page", search: u.search, anchor };
  const path = u.pathname.replace(/\/+$/, "") || "/";
  switch (path) {
    case "/estimator": {
      const params = new URLSearchParams(u.search);
      const id = params.get("id");
      if (id) return { kind: "route", route: { name: "estimate", id }, search: u.search, anchor };
      if (current.name === "estimate" && params.get("new") !== "1") return { kind: "page", search: u.search, anchor };
      params.delete("new");
      const rest = params.toString();
      return { kind: "route", route: { name: "estimate", id: NEW_ESTIMATE_ID }, search: `?new=1${rest ? "&" + rest : ""}`, anchor };
    }
    case "/quotes":
      return { kind: "route", route: SIMPLE.estimates, search: "", anchor: null };
    case "/catalog":
      return { kind: "route", route: SIMPLE.catalog, search: "", anchor: null };
    case "/design/assemblies":
      return { kind: "route", route: SIMPLE.assemblies, search: "", anchor: null };
    case "/estimating-rules":
      return { kind: "route", route: SIMPLE.rules, search: "", anchor: null };
    default:
      return { kind: "unsupported", path: u.pathname + u.search };
  }
}

/* ------------------------------------------------------------------ history rewriting */

export type HistoryUrl = {
  /** pathname + search + hash to hand the real pushState / replaceState. */
  url: string;
  /** An in-page anchor the app asked for (`#systems`) — kept out of the URL (the hash is the route), scrolled to instead. */
  anchor: string | null;
  /** True when the caller named a `#/…` route itself (a shell navigation), false when the app only changed the search. */
  explicit: boolean;
};

/**
 * What the shim hands the real `history.pushState/replaceState` when something calls it with `url` at `currentHref`.
 * The Estimator calls it with `pathname + ?search` (+ `#systems`) and no route: this puts the route hash back, and
 * follows the search's `id` (a first save mints one: `#/estimate/new` → `#/estimate/Q-2041`). A `#/…` URL is the
 * shell's own and passes through.
 */
export function composeHistoryUrl(currentHref: string, url: string): HistoryUrl {
  const cur = new URL(currentHref);
  const next = new URL(url, currentHref);
  // A host's own params (anything the page doesn't own) ride along — the app only ever writes its own.
  const search = withForeignParams(next.search, cur.search);
  if (isRouteHash(next.hash)) return { url: next.pathname + search + next.hash, anchor: null, explicit: true };
  const anchor = next.hash.length > 1 ? next.hash.slice(1) : null;
  const here = parseRoute(cur.hash, cur.search);
  let hash = cur.hash;
  if (here.name === "estimate") {
    const id = next.searchParams.get("id");
    hash = routeHash(id ? { name: "estimate", id } : here);
  }
  return { url: next.pathname + search + hash, anchor, explicit: false };
}

/**
 * Makes the location consistent with its route after a shell navigation (popstate, a typed hash, a pre-shell deep
 * link): the hash is the truth, so an estimate route gets `?id=<id>` (`?new=1` for a new one) and any other route a
 * search with none of the page's own params (a host's params stay). Returns the corrected `pathname + search + hash`,
 * or null when it is already consistent.
 */
export function normalizedLocation(href: string): string | null {
  const u = new URL(href);
  const route = parseRoute(u.hash, u.search);
  const params = new URLSearchParams(u.search.startsWith("?") ? u.search.slice(1) : u.search);
  let search = u.search;
  if (route.name === "estimate") {
    if (route.id === NEW_ESTIMATE_ID) {
      if (params.get("new") !== "1" && !params.get("id")) {
        params.set("new", "1");
        search = "?" + params.toString();
      }
    } else if (params.get("id") !== route.id) {
      params.set("id", route.id);
      params.delete("new");
      search = "?" + params.toString();
    }
  } else {
    search = foreignOnly(search);
  }
  const hash = route.name === "unknown" ? u.hash : routeHash(route);
  const out = u.pathname + search + hash;
  return out === u.pathname + u.search + u.hash ? null : out;
}

/**
 * A location on `#/estimate/new` re-pointed at the id its first save minted (`?new=1&step=package#/estimate/new` →
 * `?id=Q-2045&step=package#/estimate/Q-2045`): history entries pushed before that save still name the new estimate,
 * and the shim re-points one when the user comes back to it (shims/next-navigation.ts). Null when `href` is not on
 * `#/estimate/new`.
 */
export function adoptedLocation(href: string, id: string): string | null {
  const u = new URL(href);
  const route = parseRoute(u.hash, u.search);
  if (route.name !== "estimate" || route.id !== NEW_ESTIMATE_ID || !id || id === NEW_ESTIMATE_ID) return null;
  const p = paramsOf(u.search);
  p.delete("new");
  p.set("id", id);
  return u.pathname + searchOf(p) + routeHash({ name: "estimate", id });
}
