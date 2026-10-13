/** Suggest tasks (spec §7). Pure prompt + schema + sanitizer. */
import { z } from "zod";
import { cleanSize, cleanTier, DEFAULT_SIZE, DEFAULT_TIER, type TaskSize, type TaskTier } from "@/lib/task-plan/types";
import { UNTRUSTED_NOTE } from "./thread-text";

export const TaskSuggestSchema = z.strictObject({
  tasks: z.array(
    z.strictObject({
      title: z.string(),
      notes: z.string(),
      dueDate: z.string(),
      assigneeUserId: z.string(),
      linkKeys: z.array(z.string()),
      tier: z.enum(["high", "normal", "low"]),
      size: z.enum(["s", "m", "l"]),
    })
  ),
});

export const TASKS_SYSTEM = [
  "You help staff at Peak Systems Group (a theatrical rigging, curtain, lighting and AV contractor) turn an email thread into follow-up tasks.",
  "Return 0 to 5 concrete tasks that a Peak staff member (never the customer) must do because of this thread. Return none if nothing is needed.",
  "title: a short imperative (\"Send revised curtain quote to Lincoln HS\"). notes: one or two sentences of context, or \"\".",
  "dueDate: YYYY-MM-DD only when the thread states or clearly implies a date; otherwise \"\". Never invent a date.",
  "assigneeUserId: one id from the team list only when the thread names that person as responsible; otherwise \"\".",
  "linkKeys: keys from the provided link list that the task relates to.",
  "tier: high only for a hard deadline or an unhappy customer; low for nice-to-haves; else normal. size: s ≈ 30 min, m ≈ 1 h, l ≈ half a day.",
  UNTRUSTED_NOTE,
].join("\n");

export function buildTasksUserText(ctx: {
  thread: string;
  today: string;
  weekday: string;
  team: { id: string; name: string }[];
  links: { key: string; label: string }[];
}): string {
  return [
    `Today is ${ctx.weekday} ${ctx.today} (America/Chicago).`,
    "Team (id — name):",
    ...ctx.team.map((t) => `- ${t.id} — ${t.name}`),
    "Links you may use (key — label):",
    ...ctx.links.map((l) => `- ${l.key} — ${l.label}`),
    "",
    ctx.thread,
  ].join("\n");
}

export type TaskSuggestion = {
  title: string;
  notes: string;
  dueDate: string;
  assigneeUserId: string;
  linkKeys: string[];
  tier: TaskTier;
  size: TaskSize;
};

/** True when the user changed any field of a suggestion before creating it. */
export function suggestionEdited(a: TaskSuggestion, b: TaskSuggestion): boolean {
  return (
    a.title.trim() !== b.title.trim() ||
    a.notes.trim() !== b.notes.trim() ||
    a.dueDate !== b.dueDate ||
    a.assigneeUserId !== b.assigneeUserId ||
    a.tier !== b.tier ||
    a.size !== b.size ||
    [...a.linkKeys].sort().join("\n") !== [...b.linkKeys].sort().join("\n")
  );
}

/** Outcome of a Suggest-tasks run: nothing created = discarded; every
 *  suggestion created untouched = accepted; anything else = edited. */
export function taskSuggestOutcome(d: { suggested: number; created: number; edited: number }): "accepted" | "edited" | "discarded" {
  if (d.created <= 0) return "discarded";
  if (d.created === d.suggested && d.edited === 0) return "accepted";
  return "edited";
}

export function sanitizeTaskSuggestions(
  raw: z.infer<typeof TaskSuggestSchema>,
  ctx: { today: string; teamIds: Set<string>; linkKeys: Set<string> }
): TaskSuggestion[] {
  const seen = new Set<string>();
  const out: TaskSuggestion[] = [];
  for (const t of raw?.tasks ?? []) {
    const title = (t.title || "").replace(/\s+/g, " ").trim().slice(0, 200);
    if (!title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    const due = /^\d{4}-\d{2}-\d{2}$/.test(t.dueDate || "") && t.dueDate >= ctx.today ? t.dueDate : "";
    const links = [...new Set(["thread", ...(t.linkKeys || [])])].filter((k) => ctx.linkKeys.has(k));
    out.push({
      title,
      notes: (t.notes || "").trim().slice(0, 1000),
      dueDate: due,
      assigneeUserId: ctx.teamIds.has(t.assigneeUserId) ? t.assigneeUserId : "",
      linkKeys: links,
      tier: cleanTier(t.tier) ?? DEFAULT_TIER,
      size: cleanSize(t.size) ?? DEFAULT_SIZE,
    });
    if (out.length >= 5) break;
  }
  return out;
}
