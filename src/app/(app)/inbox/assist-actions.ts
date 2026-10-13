"use server";

import { requireUser } from "@/lib/session";
import { get as getThread, visibleTo, type CommThread } from "@/lib/stores/comms";
import { activeUsers } from "@/lib/users";
import { threadTaskLinkOptions } from "@/lib/inbox-task-write";
import { runAssist } from "@/lib/assist/run";
import { chicagoToday } from "@/lib/assist/config";
import { setRunOutcome } from "@/lib/stores/assist-runs";
import { promptMessages, threadBlock } from "@/lib/assist/features/thread-text";
import {
  buildTasksUserText,
  sanitizeTaskSuggestions,
  TaskSuggestSchema,
  TASKS_SYSTEM,
  type TaskSuggestion,
} from "@/lib/assist/features/task-suggest";
import type { AssistOutcome } from "@/lib/assist/types";

/** #334 Assist — Suggest tasks. Suggestions only: nothing is created here;
 *  the dialog creates ticked rows through the existing #215 task action. */

const OUTCOMES: AssistOutcome[] = ["accepted", "edited", "discarded"];

async function loadThreadFor(threadId: string, meName: string): Promise<CommThread | null> {
  const t = await getThread(String(threadId || ""));
  if (!t || t.deleted || !visibleTo(t, meName) || t.channel !== "email") return null;
  return t;
}

export async function suggestTasksAction(threadId: string): Promise<
  | { ok: true; runId: string; suggestions: TaskSuggestion[]; team: { id: string; name: string }[]; links: { key: string; label: string }[] }
  | { ok: false; error: string }
> {
  const me = await requireUser();
  const t = await loadThreadFor(threadId, me.name);
  if (!t) return { ok: false, error: "That email isn't available." };
  const [users, links] = await Promise.all([activeUsers(), threadTaskLinkOptions(t)]);
  const team = users.map((u) => ({ id: u.id, name: u.name }));
  const today = chicagoToday(Date.now());
  const r = await runAssist({
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
  });
  if (!r.ok) return { ok: false, error: r.error };
  const suggestions = sanitizeTaskSuggestions(r.value, {
    today: today.date,
    teamIds: new Set(team.map((x) => x.id)),
    linkKeys: new Set(links.map((l) => l.key)),
  });
  return { ok: true, runId: r.runId, suggestions, team, links };
}

export async function recordAssistOutcomeAction(
  runId: string,
  outcome: AssistOutcome,
  detail: Record<string, unknown>
): Promise<{ ok: boolean }> {
  const me = await requireUser();
  if (!OUTCOMES.includes(outcome)) return { ok: false };
  let safe: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(JSON.stringify(detail ?? {}));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false };
    safe = parsed as Record<string, unknown>;
  } catch {
    return { ok: false };
  }
  if (JSON.stringify(safe).length > 4000) return { ok: false };
  return { ok: await setRunOutcome(String(runId || ""), me.id, outcome, safe) };
}
