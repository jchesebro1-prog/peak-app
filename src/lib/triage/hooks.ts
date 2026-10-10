import type { TriageUser } from "./types";
import { unverifiedVisitFlags } from "@/lib/address-verify/triage-flags";
import { taskPlanAtRisk } from "@/lib/task-plan/triage";

/**
 * Optional inputs from specs 1–3 (drive time, visit scheduling, auto task
 * calendar), which are built on another branch. Each feed reads its input
 * through these providers, so with NO_HOOKS every feed is its pre-spec form.
 * At those specs' merge, each replaces ONE field of TRIAGE_HOOKS below.
 */
/** Keys (`task:<id>` / `asg:<id>`) spec 3's planner flags At risk for this person. */
export type AtRiskProvider = (me: TriageUser, now: number) => Promise<ReadonlySet<string>>;
/** Visit id → flag labels (spec 1 unverified address, spec 2 conflicts). */
export type VisitFlagProvider = (visitIds: readonly string[], now: number) => Promise<ReadonlyMap<string, readonly string[]>>;

export type TriageHooks = { atRisk: AtRiskProvider; visitFlags: VisitFlagProvider };

export const NO_HOOKS: TriageHooks = {
  atRisk: async () => new Set<string>(),
  visitFlags: async () => new Map<string, readonly string[]>(),
};

/** The hooks the app runs with. */
export const TRIAGE_HOOKS: TriageHooks = { ...NO_HOOKS, visitFlags: unverifiedVisitFlags, atRisk: taskPlanAtRisk };
