/**
 * Estimator handoff — BAKED (esbuild-plugins.ts bakePlugin) and an APP_OVERRIDES target: the venue classes
 * Estimating Rules' venue-doctrine editor (controls.tsx) lists. src/lib/stores/venue-classes.ts is pure, but it lives
 * under src/lib/stores/, which the build refuses to bundle (build.ts forbiddenBundleInputs). Every bundled import of it
 * resolves here instead; in the bundle this module's contents are a JSON literal of the value read from the original
 * at build time. Only the values the bundle imports are listed: a bundled importer that needs another name fails the
 * build ("No matching export"). Plan: PR 2 Task 10.
 */
export { VENUE_CLASSES } from "@/lib/stores/venue-classes";
