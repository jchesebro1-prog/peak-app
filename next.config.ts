import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/WASM database drivers must not be bundled by the server compiler.
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
};

export default nextConfig;
