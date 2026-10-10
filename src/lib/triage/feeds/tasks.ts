import type { TaskRecord } from "@/lib/stores/tasks";
import type { Assignment } from "@/lib/stores/assignments";
import { assignmentHref } from "@/lib/queue";
import { sameName } from "@/lib/quote-approval-rules";
import { dayDiff, dayKey, nextDayKey } from "../clock";
import type { OpenWork } from "../dedupe";
import { triageKey } from "../keys";
import type { TriageCandidate, TriageFact, TriageSource } from "../types";
import type { AtRiskShared } from "../hooks";
import type { FeedCtx, FeedResult, TriageFeed } from "./context";

/** Spec 3 adds `priority` (high|normal|low) to tasks and assignments; read it only when present. */
export function tierOf(rec: unknown): "high" | "low" | null {
  const p = (rec as { priority?: unknown } | null | undefined)?.priority;
  return p === "high" || p === "low" ? p : null;
}

/** Overdue / due today / due tomorrow by Chicago calendar day. 0 = undated → none. */
export function taskDueFacts(due: number, now: number): TriageFact[] {
  if (!due) return [];
  const today = dayKey(now);
  const d = dayKey(due);
  if (d < today) return [{ kind: "task_overdue", days: dayDiff(d, today) }];
  if (d === today) return [{ kind: "task_due_today" }];
  if (d === nextDayKey(today)) return [{ kind: "task_due_tomorrow" }];
  return [];
}

export function taskHref(t: Pick<TaskRecord, "projectId" | "threadId" | "leadId">): string {
  if (t.projectId) return `/projects/${encodeURIComponent(t.projectId)}`;
  if (t.threadId) return `/inbox?thread=${encodeURIComponent(t.threadId)}`;
  if (t.leadId) return `/leads?lead=${encodeURIComponent(t.leadId)}`;
  return "/calendar";
}

/**
 * Open tasks and Queue assignments assigned to me: overdue, due today, due
 * tomorrow, or at risk (spec 3, through the hook). Every open item — on the
 * list or not — is returned as open work for the duplicate collapse.
 */
export function selectTasks(
  input: { tasks: readonly TaskRecord[]; assignments: readonly Assignment[]; atRisk: ReadonlySet<string> },
  ctx: Pick<FeedCtx, "me" | "now">
): FeedResult {
  const candidates: TriageCandidate[] = [];
  const openWork: OpenWork[] = [];
  const add = (key: string, source: TriageSource, title: string, sub: string, href: string, due: number, createdAt: number, rec: unknown) => {
    openWork.push({ key, title });
    const facts = taskDueFacts(due, ctx.now);
    if (input.atRisk.has(key)) facts.push({ kind: "task_at_risk" });
    if (!facts.length) return;
    const tier = tierOf(rec);
    if (tier) facts.push({ kind: "task_tier", tier });
    candidates.push({ key, source, title, sub, href, since: due || createdAt || 0, facts });
  };
  for (const t of input.tasks) {
    if (t.status === "done" || !sameName(t.assigneeName, ctx.me.name)) continue;
    add(triageKey.task(t.id), "task", t.title, t.projectId ? t.section || "" : "", taskHref(t), t.dueAt ?? 0, t.createdAt, t);
  }
  for (const a of input.assignments) {
    if (a.done || !sameName(a.assignee, ctx.me.name)) continue;
    const sub = a.link?.label || (sameName(a.createdBy, ctx.me.name) ? "Self" : `from ${a.createdBy}`);
    add(triageKey.assignment(a.id), "assignment", a.title, sub, assignmentHref(a.link, a.source || ""), a.dueDate || 0, a.createdAt, a);
  }
  return { candidates, openWork };
}

/** The build's memoized reads for the at-risk hook. The roster also holds
 *  the users being planned (a build may name users outside the active roster). */
export function atRiskShared(ctx: FeedCtx): AtRiskShared {
  const planUsers = ctx.planUsers ?? [ctx.me];
  const roster = ctx.users.map((u) => ({ id: u.id, name: u.name }));
  for (const u of planUsers) if (!roster.some((r) => r.id === u.id)) roster.push({ id: u.id, name: u.name });
  return {
    build: ctx.data,
    roster: async () => roster,
    tasks: ctx.data.tasks,
    assignments: ctx.data.assignments,
    visits: ctx.data.visits,
    userIds: planUsers.map((u) => u.id),
    deadlineMs: ctx.deadlineMs,
  };
}

export const tasksFeed: TriageFeed = {
  source: "task",
  async load(ctx) {
    const [tasks, assignments, atRisk] = await Promise.all([ctx.data.tasks(), ctx.data.assignments(), ctx.hooks.atRisk(ctx.me, ctx.now, atRiskShared(ctx))]);
    return selectTasks({ tasks, assignments, atRisk }, ctx);
  },
};
