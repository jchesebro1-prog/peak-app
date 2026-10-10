import type { Assignment } from "@/lib/stores/assignments";
import type { SiteVisit } from "@/lib/stores/site-visits";
import type { TaskRecord } from "@/lib/stores/tasks";
import type { TriageUser } from "./types";
import { unverifiedVisitFlags } from "@/lib/address-verify/triage-flags";
import { taskPlanAtRisk } from "@/lib/task-plan/triage";

/**
 * Optional inputs from specs 1–3 (drive time, visit scheduling, auto task
 * calendar), which are built on another branch. Each feed reads its input
 * through these providers, so with NO_HOOKS every feed is its pre-spec form.
 * At those specs' merge, each replaces ONE field of TRIAGE_HOOKS below.
 */
/**
 * The build's memoized reads, handed to the at-risk provider so it never
 * re-reads what the feeds already loaded. `build` identifies the build (the
 * provider memoizes per build on it); `userIds` is everyone the build plans
 * (the cron: every user it builds — absent means only `me`); `deadlineMs` is
 * the cron's stop time, which bounds any external read the provider makes.
 */
export type AtRiskShared = {
  build: object;
  roster(): Promise<{ id: string; name: string }[]>;
  tasks(): Promise<TaskRecord[]>;
  assignments(): Promise<Assignment[]>;
  visits(): Promise<SiteVisit[]>;
  userIds?: readonly string[];
  deadlineMs?: number;
};
/** Keys (`task:<id>` / `asg:<id>`) spec 3's planner flags At risk for this person. */
export type AtRiskProvider = (me: TriageUser, now: number, shared?: AtRiskShared) => Promise<ReadonlySet<string>>;
/** Visit id → flag labels (spec 1 unverified address, spec 2 conflicts). */
export type VisitFlagProvider = (visitIds: readonly string[], now: number) => Promise<ReadonlyMap<string, readonly string[]>>;

export type TriageHooks = { atRisk: AtRiskProvider; visitFlags: VisitFlagProvider };

export const NO_HOOKS: TriageHooks = {
  atRisk: async () => new Set<string>(),
  visitFlags: async () => new Map<string, readonly string[]>(),
};

/** The hooks the app runs with. */
export const TRIAGE_HOOKS: TriageHooks = { ...NO_HOOKS, visitFlags: unverifiedVisitFlags, atRisk: taskPlanAtRisk };
