import type { DerivedActionItem } from "@/lib/krisp/derive";
import type { NoteParentKind } from "@/lib/stores/notes";
import { normalizeText } from "./names";
import type { MeetingLinks, MeetingTodo, TodoKind } from "./types";

type Named = { id: string; name: string };

const exact = (label: string, full: string) => normalizeText(label) === normalizeText(full);

/** First-name match, either direction: "Tom" ↔ "Tom Ellis", or "Tom Ellis" ↔ a record stored only as "Tom". */
function firstNameMatches(label: string, full: string): boolean {
  const l = normalizeText(label), f = normalizeText(full);
  if (!l || !f) return false;
  return f.split(" ")[0] === l || (!f.includes(" ") && l.split(" ")[0] === f);
}

export function suggestTodoKind(assignee: string | null, people: { users: Named[]; contacts: Named[] }): TodoKind {
  if (!assignee || !normalizeText(assignee)) return "note";
  if (people.users.some((u) => exact(assignee, u.name))) return "task";
  if (people.contacts.some((c) => exact(assignee, c.name))) return "waiting";
  const user = people.users.some((u) => firstNameMatches(assignee, u.name));
  const contact = people.contacts.some((c) => firstNameMatches(assignee, c.name));
  if (user && contact) return "note"; // ambiguous first name — the rep decides
  return user ? "task" : contact ? "waiting" : "note";
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
  // Never lose a decision: a decided to-do Krisp no longer lists stays. An undecided one it dropped or reworded is removed.
  for (const rest of byKey.values()) if (rest.decision) out.push(rest);
  return out;
}

export function noteParentFor(links: MeetingLinks): { parentKind: NoteParentKind; parentId: string } | null {
  if (links.siteId) return { parentKind: "site", parentId: links.siteId };
  const w = links.work;
  if (w && (w.type === "lead" || w.type === "project" || w.type === "engagement")) return { parentKind: w.type, parentId: w.id };
  if (links.customerId) return { parentKind: "customer", parentId: links.customerId };
  return null;
}
