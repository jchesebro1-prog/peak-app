/**
 * Morning triage's at-risk provider (TRIAGE_HOOKS.atRisk, spec
 * 2026-10-09-morning-triage "spec 3 seam"). The triage cron builds every
 * user's morning list through this, so it is also where the plan is
 * computed "on the morning cron" without a new rider on the daily trigger.
 * It never LOCKS anything (D797): no `started` pin is saved from a triage
 * build — cron or lazy first view — for anyone; only stale pins are swept
 * (fail-closed, as before). A view build (no deadline) reads Google with the
 * short VIEW_PLAN_CALENDAR_MS limit, like Home.
 *
 * One plan per build: with `shared` (the build's memoized loaders) the first
 * call plans EVERY user the build names in one loadTaskPlans — Google reads
 * in parallel, each bounded by the build's deadline — saves all pins once,
 * and every later user of the same build looks up its own result. A single-
 * user view (a fresh build) plans only that person. Never throws: the tasks
 * feed runs under allSettled and a throw would hide every task. A failed
 * load saves nothing (loadTaskPlans fails closed) and stays failed for the
 * whole build.
 */
import type { AtRiskShared } from "@/lib/triage/hooks";
import type { TriageUser } from "@/lib/triage/types";
import { loadTaskPlans, savePlanPins, VIEW_PLAN_CALENDAR_MS, type PersonPlan, type PinStore, type TaskPlanDeps } from "./load";

type Opts = { deps?: Partial<TaskPlanDeps>; store?: PinStore };
type BuildPlans = { ids: ReadonlySet<string>; plans: Promise<Map<string, PersonPlan>> };

/** Per build object → that build's plans (dropped with the build). */
const BUILD_PLANS = new WeakMap<object, BuildPlans>();

async function planAndSave(userIds: readonly string[], meId: string, now: number, opts: Opts, shared?: AtRiskShared): Promise<Map<string, PersonPlan>> {
  const fromBuild: Partial<TaskPlanDeps> = shared
    ? { roster: shared.roster, tasks: shared.tasks, assignments: shared.assignments, visits: shared.visits }
    : {};
  // A view build (no cron deadline) waits on the Google read — keep it short.
  const viewLimit: Partial<TaskPlanDeps> = shared?.deadlineMs == null ? { calendarTimeoutMs: VIEW_PLAN_CALENDAR_MS } : {};
  const plans = await loadTaskPlans({ userIds, meId, deadlineMs: shared?.deadlineMs, deps: { ...viewLimit, ...opts.deps, ...fromBuild, now: () => now } });
  await savePlanPins(plans, { persistStartedFor: null, store: opts.store });
  return new Map(plans.map((p) => [p.userId, p]));
}

function planFor(me: TriageUser, now: number, shared: AtRiskShared | undefined, opts: Opts): Promise<Map<string, PersonPlan>> {
  if (!shared) return planAndSave([me.id], me.id, now, opts);
  let memo = BUILD_PLANS.get(shared.build);
  if (!memo) {
    const ids = new Set([...(shared.userIds ?? []), me.id]);
    memo = { ids, plans: planAndSave([...ids], me.id, now, opts, shared) };
    BUILD_PLANS.set(shared.build, memo);
  }
  // Someone the build didn't name: plan just them, still on the build's reads.
  return memo.ids.has(me.id) ? memo.plans : planAndSave([me.id], me.id, now, opts, shared);
}

export async function taskPlanAtRisk(me: TriageUser, now: number, shared?: AtRiskShared, opts: Opts = {}): Promise<ReadonlySet<string>> {
  try {
    const plan = (await planFor(me, now, shared, opts)).get(me.id);
    return new Set(plan ? plan.result.atRisk.map((a) => a.itemKey) : []);
  } catch (err) {
    console.error("[task-plan] triage at-risk failed:", me.name, err);
    return new Set<string>();
  }
}
