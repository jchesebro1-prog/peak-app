/**
 * Estimator handoff — BAKED (esbuild-plugins.ts bakePlugin): the Estimating Rules registry and the engine-rate
 * defaults, from src/lib/stores/pricing.ts. That store reaches the database (`@/db/doc-store`) and can never be
 * bundled, but these exports are plain data. In Node (tests, verify, the build itself) this module re-exports them
 * from the original; in the browser bundle its contents are replaced, at build time, by a JSON literal of each value
 * read from the original — so the prototype always carries the app's own registry, never a copy. Every export must be
 * JSON-safe (the build refuses one that isn't). Plan: PR 2 Task 10.
 */
export {
  GROUPS,
  FLAMETEST_RATE_DEFAULTS,
  REPAIR_RATE_DEFAULTS,
  INSPECTION_RATE_DEFAULTS,
  TRAVEL_RATE_DEFAULTS,
  CATALOG_RATE_DEFAULTS,
  FLAMETEST_RATES_BLOB,
  REPAIR_RATES_BLOB,
  INSPECTION_RATES_BLOB,
  TRAVEL_RATES_BLOB,
  CATALOG_RATES_BLOB,
  FIXTURE_RATES_BLOB,
} from "@/lib/stores/pricing";
