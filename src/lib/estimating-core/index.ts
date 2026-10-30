/**
 * estimating-core — the Estimator's pricing domain as one browser-pure
 * library (estimator handoff, spec
 * docs/superpowers/specs/2026-10-20-estimator-handoff-package-design.md §3).
 *
 * Flat exports: the domain moved here from src/app/(app)/estimator/ (the old
 * paths re-export these files). Namespaced exports: pure src/lib modules that
 * stay where they are but belong to the core's closure, so `npm run
 * core:check` gates them too. Nothing reachable from this file may import a
 * store, the database, a route folder, a React component or a server package.
 */
export * from "./types";
export * from "./pricing";
export * from "./estimator-data";
export * from "./tier-reprice";
export * from "./labor-group";
export * from "./labor-defaults";
export * from "./track-bom";
export * from "./curtain-line";
export * from "./fixture-bom";
export * from "./freight-default";
export * from "./catalog-rank";
export * from "./copy-system";
export * from "./narrative";

// Pure src/lib modules in the core's closure (unchanged paths).
export * as curtainPricing from "@/lib/design/curtain-pricing";
export * as curtainGeom from "@/lib/curtain-geom";
export * as curtainMounts from "@/lib/curtain-mounts";
export * as curtainFabric from "@/lib/curtain-pricing";
export * as fixtureAssemblies from "@/lib/fixture-assemblies";
export * as fixtureRates from "@/lib/fixture-rates";
export * as freightRule from "@/lib/freight-rule";
export * as quoteLineMembers from "@/lib/quote-line-members";
export * as reviewLimits from "@/lib/review-limits";
export * as systemCategories from "@/lib/system-categories";
export * as tierPricing from "@/lib/tier-pricing";
export * as trackEngine from "@/lib/track-engine";
export * as trackSeries from "@/lib/track-series";
export * as estimateNumber from "@/lib/estimate-number";
export * as bonusCanonical from "@/lib/estimate-bonus/canonical";
export * as bonusFlags from "@/lib/estimate-bonus/flags";
export * as bonusRecord from "@/lib/estimate-bonus/record";
export * as bonusRules from "@/lib/estimate-bonus/rules";
export * as bonusCard from "@/lib/estimate-bonus/card";
export * as groups from "@/lib/estimate-groups/groups";
export * as lineMove from "@/lib/estimate-line-move/move";
export * as lineReid from "@/lib/estimate-line-move/reid";
export * as rackDefaults from "@/lib/rack/defaults";
export * as rackGeometry from "@/lib/rack/geometry";
export * as rackLayout from "@/lib/rack/layout";
export * as rackRules from "@/lib/rack/rules";
export * as rackSvg from "@/lib/rack/svg";
export * as rackTypes from "@/lib/rack/types";
export * as rackPartFacts from "@/lib/rack/part-facts";
export * as approvalSnapshot from "@/lib/approval-snapshot";
export * as servicePricing from "@/lib/service-pricing";
export * as rewardCreditLine from "@/lib/rewards/credit-line";
