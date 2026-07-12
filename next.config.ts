import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/WASM database drivers must not be bundled by the server compiler.
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
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
