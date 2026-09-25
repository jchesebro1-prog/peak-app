import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/WASM database drivers must not be bundled by the server compiler.
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  // #134 (D157): the catalog importers cap uploads at 1 MB themselves
  // (lib/catalog-import-guard) and surface the refusal through the Catalog
  // page's importError banner. Server actions default to a 1 MB request
  // body, which multipart overhead pushes a ~1 MB file past, so Next would
  // reject it with an opaque error before our check runs — leave room so the
  // app's own clear error always wins.
  experimental: { serverActions: { bodySizeLimit: "1200kb" } },
  // Part documents (#207): the Datasheets page's admin "Pre-fill from
  // DaVinci" action reads the committed extract with fs at run time, which
  // file tracing cannot see — ship it with that route's function.
  outputFileTracingIncludes: { "/catalog/documents": ["./data/davinci-extract.json"] },
  // Baseline security response headers applied to every route. These are the
  // non-breaking hardening headers (no CSP yet — a Content-Security-Policy
  // needs to be tuned against Leaflet/Three/inline styles and verified in a
  // real build before it's turned on). HSTS only takes effect over HTTPS, so
  // it is inert on the LAN/localhost dev origins.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Clickjacking: the app is never meant to be embedded in a frame.
          { key: "X-Frame-Options", value: "DENY" },
          // Stop browsers from MIME-sniffing responses into a different type.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Don't leak full URLs (which can carry ids) to other origins.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Drop powerful browser features the app doesn't use.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          // Force HTTPS for a year once seen over TLS (no effect on http dev).
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
  // The Field Survey module was renamed Venue Assessments (route moved from
  // /field-survey to /venue-assessments). Old links/bookmarks keep working;
  // Next preserves the query string, so ?id=FS-1053 survives the hop.
  async redirects() {
    return [
      { source: "/field-survey", destination: "/venue-assessments", permanent: true },
      { source: "/field-survey/:path*", destination: "/venue-assessments/:path*", permanent: true },
    ];
  },
  // Dev-only: let other machines on the LAN load the app (Next 16 blocks
  // dev resources from non-localhost origins by default). Covers the Mac's
  // Bonjour name and common private-network IPs. No effect in production.
  allowedDevOrigins: [
    "sms-mac-mini.local",
    "*.local",
    "172.17.5.172",
    "192.168.*.*",
    "10.*.*.*",
    "172.16.*.*",
    "172.17.*.*",
  ],
};

export default nextConfig;
