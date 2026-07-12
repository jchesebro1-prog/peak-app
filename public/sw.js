/**
 * Peak Backend service worker — Phase 6 offline shell.
 *
 * Faithful port of the prototype's app/sw.js caching policy:
 *  - NETWORK-FIRST for same-origin GETs, cached under origin+pathname (query
 *    string stripped) so preview/auth params never fragment or poison the
 *    cache; offline falls back to the path-keyed entry. This lets any page you
 *    visited with signal reload with no signal.
 *  - CACHE-FIRST (ignoreSearch) for cross-origin fonts (opaque OK).
 *  - NEVER cache the API surface (/api/*) — sync push/pull, auth, search must
 *    always hit the network or fail loudly; nominatim/osrm are query-is-request
 *    and callers fall back to built-in estimates offline.
 *  - App DATA is deliberately NOT here: it lives in IndexedDB (the sync
 *    mirror/outbox), so offline reads/writes work as soon as the shell loads.
 *
 * Bump CACHE_NAME to invalidate; activate deletes every other cache and claims
 * open clients.
 */

const CACHE_NAME = "peak-shell-v1";

// Small, individually-added precache so one 404 can't abort install.
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        SHELL.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => {})
        )
      )
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

function pathKey(url) {
  const u = new URL(url);
  return u.origin + u.pathname; // strip query
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never intercept mutations

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Never cache the API surface — always network (may fail offline by design).
  if (sameOrigin && url.pathname.startsWith("/api/")) return;

  if (sameOrigin) {
    // Network-first, path-keyed cache fallback.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(pathKey(req.url), copy))
              .catch(() => {});
          }
          return res;
        })
        .catch(() =>
          caches.match(pathKey(req.url)).then(
            (hit) =>
              hit ||
              caches.match("/") ||
              new Response("", { status: 504, statusText: "Offline" })
          )
        )
    );
    return;
  }

  // Cross-origin fonts / static assets: cache-first, ignore query.
  if (/fonts\.(googleapis|gstatic)\.com|\.(woff2?|ttf|otf)$/.test(url.href)) {
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
            return res;
          })
      )
    );
  }
  // Everything else cross-origin (nominatim/osrm/tiles): pass through.
});
