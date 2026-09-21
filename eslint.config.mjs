import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Third-party minified worker; it is not application source.
    "public/pdf.worker.min.mjs",
  ]),
  // The React compiler rules are not actionable for this server-rendered
  // app's deliberate Date.now() calculations, local render helpers, and
  // optimistic effect resets. Keep them visible as warnings without making
  // the repository's quality gate fail on valid existing patterns.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/purity": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  // Test/smoke harnesses use intentionally loose fixture casts and child
  // process handles; application source remains strict about these rules.
  {
    files: ["scripts/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "prefer-const": "warn",
    },
  },
]);

export default eslintConfig;
