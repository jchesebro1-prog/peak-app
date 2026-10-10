import type { DerivedActionItem } from "@/lib/krisp/derive";
import type { NoteParentKind } from "@/lib/stores/notes";
import { normalizeText } from "./names";
import type { MeetingLinks, MeetingTodo, TodoKind } from "./types";

type Named = { id: string; name: string };

function nameMatches(label: string, full: string): boolean {
  const l = normalizeText(label), f = normalizeText(full);
  return !!l && (l === f || f.split(" ")[0] === l);
}

export function suggestTodoKind(assignee: string | null, people: { users: Named[]; contacts: Named[] }): TodoKind {
  if (!assignee) return "note";
  if (people.users.some((u) => nameMatches(assignee, u.name))) return "task";
  if (people.contacts.some((c) => nameMatches(assignee, c.name))) return "waiting";
  return "note";
}

export function mergeTodos(prev: MeetingTodo[], derived: DerivedActionItem[], suggest: (assignee: string | null) => TodoKind): MeetingTodo[] {
  const byKey = new Map(prev.map((t) => [t.key, t]));
  const out: MeetingTodo[] = [];
  for (const d of derived) {
    const old = byKey.get(d.key);
    byKey.delete(d.key);
    if (old?.decision) { out.push(old); continue; }
    out.push({ key: d.key, title: d.title, assigneeLabel: d.assigneeName, dueDate: d.dueDate,
      suggested: suggest(d.assigneeName), decision: null });
  }
  for (const rest of byKey.values()) out.push(rest); // never drop a to-do the app already holds
  return out;
}

export function noteParentFor(links: MeetingLinks): { parentKind: NoteParentKind; parentId: string } | null {
  if (links.siteId) return { parentKind: "site", parentId: links.siteId };
  const w = links.work;
  if (w && (w.type === "lead" || w.type === "project" || w.type === "engagement")) return { parentKind: w.type, parentId: w.id };
  if (links.customerId) return { parentKind: "customer", parentId: links.customerId };
  return null;
}
