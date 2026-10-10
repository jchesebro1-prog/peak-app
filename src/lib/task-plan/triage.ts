/**
 * Morning triage's at-risk provider (TRIAGE_HOOKS.atRisk, spec
 * 2026-10-09-morning-triage "spec 3 seam"). The triage cron builds every
 * user's morning list through this, so it is also where the plan is
 * computed "on the morning cron" — and its started/remainder pins saved —
 * without a new rider on the daily trigger. Bounded: the cron stops starting
 * users at its own deadline, and each call's Google read is capped by
 * PLAN_CALENDAR_TIMEOUT_MS. Never throws: the tasks feed runs under
 * allSettled and a throw would hide every task. A failed load saves nothing
 * (loadTaskPlans fails closed).
 */
import type { TriageUser } from "@/lib/triage/types";
import { loadTaskPlans, savePlanPins, type PinStore, type TaskPlanDeps } from "./load";

export async function taskPlanAtRisk(
  me: TriageUser,
  now: number,
  opts: { deps?: Partial<TaskPlanDeps>; store?: PinStore } = {}
): Promise<ReadonlySet<string>> {
  try {
    const [plan] = await loadTaskPlans({ userIds: [me.id], meId: me.id, deps: { ...opts.deps, now: () => now } });
    if (!plan) return new Set<string>();
    await savePlanPins([plan], opts.store);
    return new Set(plan.result.atRisk.map((a) => a.itemKey));
  } catch (err) {
    console.error("[task-plan] triage at-risk failed:", me.name, err);
    return new Set<string>();
  }
}
