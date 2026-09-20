/**
 * Quartzite service worker — Phase 6 offline shell.
 *
 * Faithful port of the prototype's app/sw.js caching policy:
 *  - NETWORK-FIRST for document navigations. Successfully rendered pages are
 *    cached by route (including meaningful query params such as estimator id)
 *    so Back and revisiting an opened job work without signal.
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

const CACHE_NAME = "quartzite-shell-v2";

// Small, individually-added precache so one 404 can't abort install.
const SHELL = ["/offline.html", "/manifest.webmanifest", "/icon.svg"];

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

function navigationKey(url) {
  const u = new URL(url);
  // Next's transport-only RSC nonce must never fragment the document cache.
  // Meaningful app state (?id=, ?tab=) stays so one record cannot overwrite
  // another record's offline page.
  u.searchParams.delete("_rsc");
  return u.toString();
}

function cacheableDocument(req, res) {
  if (!res || res.status !== 200 || res.type !== "basic" || res.redirected) return false;
  const requested = new URL(req.url);
  const answered = new URL(res.url);
  if (requested.pathname !== answered.pathname) return false;
  if (requested.pathname === "/login" || requested.pathname.startsWith("/api/")) return false;
  return (res.headers.get("content-type") || "").includes("text/html");
}

self.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "CACHE_ROUTE") return;
  const target = new URL(String(event.data.url || ""), self.location.origin);
  if (target.origin !== self.location.origin || target.pathname.startsWith("/api/") || target.pathname === "/login") return;
  target.searchParams.delete("_rsc");
  const request = new Request(target.toString(), {
    method: "GET",
    credentials: "same-origin",
    headers: { Accept: "text/html" },
  });
  event.waitUntil(
    fetch(request)
      .then((res) => {
        if (!cacheableDocument(request, res)) return;
        return caches.open(CACHE_NAME).then((cache) => cache.put(navigationKey(target.toString()), res));
      })
      .catch(() => {})
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never intercept mutations

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Never cache the API surface — always network (may fail offline by design).
  if (sameOrigin && url.pathname.startsWith("/api/")) return;

  // RSC flight responses are not HTML documents. Caching one under a route
  // poisons Back/reload with an unreadable component payload.
  if (sameOrigin && (url.searchParams.has("_rsc") || req.headers.get("RSC") === "1")) return;

  if (sameOrigin && req.mode === "navigate") {
    // Network-first document cache. An unseen route gets an honest offline
    // screen whose Back button returns to the last cached page.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (cacheableDocument(req, res)) {
            const copy = res.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(navigationKey(req.url), copy))
              .catch(() => {});
          }
          return res;
        })
        .catch(() =>
          caches.match(navigationKey(req.url)).then(
            (hit) =>
              hit ||
              caches.match("/offline.html") ||
              new Response("", { status: 504, statusText: "Offline" })
          )
        )
    );
    return;
  }

  if (sameOrigin) {
    const staticAsset =
      url.pathname.startsWith("/_next/static/") ||
      ["script", "style", "font", "image"].includes(req.destination);
    if (!staticAsset) return;
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res && res.status === 200) {
              caches.open(CACHE_NAME).then((cache) => cache.put(req, res.clone())).catch(() => {});
            }
            return res;
          })
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
