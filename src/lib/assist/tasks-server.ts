/**
 * #334 Assist — Suggest tasks, as a reusable server function (AI daily
 * brief, spec §2). `suggestTasksAction` (Inbox) is a thin wrapper around it;
 * the brief's draft queue calls it in the background. Suggestions only:
 * nothing is created here — the dialog creates ticked rows through the
 * existing #215 task action.
 */
import { activeUsers } from "@/lib/users";
import { threadTaskLinkOptions } from "@/lib/inbox-task-write";
import { chicagoToday } from "./config";
import { promptMessages, threadBlock } from "./features/thread-text";
import { buildTasksUserText, sanitizeTaskSuggestions, TaskSuggestSchema, TASKS_SYSTEM, type TaskSuggestion } from "./features/task-suggest";
import { runAssist, type AssistCallDeps } from "./run";
import { loadThreadFor } from "./thread-access";
import { gateFor } from "./gate-server";
import { outOfTime, splitCallDeps, type ThreadAssistFail } from "./reply-server";

export type TaskSuggestResult =
  | { ok: true; runId: string; suggestions: TaskSuggestion[]; team: { id: string; name: string }[]; links: { key: string; label: string }[] }
  | ThreadAssistFail;

export async function suggestTasksForThread(
  threadId: string,
  me: { id: string; name: string },
  deps: AssistCallDeps & { preloaded?: { team?: { id: string; name: string }[] } } = {}
): Promise<TaskSuggestResult> {
  const refused = await gateFor("tasks", me.id, deps);
  if (refused) return { ok: false, error: refused, kind: "gate", runId: null };
  const t = await loadThreadFor(threadId, me.name);
  if (!t) return { ok: false, error: "That email isn't available.", kind: "thread", runId: null };
  const [team, links] = await Promise.all([
    deps.preloaded?.team ?? activeUsers().then((users) => users.map((u) => ({ id: u.id, name: u.name }))),
    threadTaskLinkOptions(t),
  ]);
  const today = chicagoToday(deps.now ?? Date.now());
  const split = splitCallDeps(deps, "tasks");
  if (!split) return outOfTime();
  const { run, call } = split;
  const r = await runAssist(
    {
      feature: "tasks",
      slot: "tasks",
      user: { id: me.id, name: me.name },
      system: TASKS_SYSTEM,
      userText: buildTasksUserText({
        thread: threadBlock({ subject: t.subject, messages: promptMessages(t) }, { maxMessages: 8, maxChars: 2000 }),
        today: today.date,
        weekday: today.weekday,
        team,
        links,
      }),
      schema: TaskSuggestSchema,
      contextRef: "thread:" + t.id,
      ...call,
    },
    run
  );
  if (!r.ok) return { ok: false, error: r.error, kind: r.runId ? "model" : "gate", runId: r.runId };
  const suggestions = sanitizeTaskSuggestions(r.value, {
    today: today.date,
    teamIds: new Set(team.map((x) => x.id)),
    linkKeys: new Set(links.map((l) => l.key)),
  });
  return { ok: true, runId: r.runId, suggestions, team, links };
}
