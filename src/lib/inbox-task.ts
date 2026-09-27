/**
 * #215 — tasks from an email thread. Pure (type-only imports): the Inbox
 * page builds the dialog's link list with it, the client dialog seeds its
 * notes with it, and the server writer (inbox-task-write.ts) re-derives the
 * links with it — the client only sends which candidate keys stay ticked,
 * so it can never link something the thread doesn't carry.
 */
import type { TaskRecord } from "@/lib/stores/tasks";

export type ThreadTaskLinkKind =
  | "thread" | "contact" | "customer" | "site" | "quote" | "lead" | "project" | "survey" | "inspection";

export type ThreadTaskLinkCandidate = { key: string; kind: ThreadTaskLinkKind; id: string };

export type ThreadTaskRequest = {
  threadId: string;
  title: string;
  notes: string;
  /** users.id; "" = me */
  assigneeUserId: string;
  /** an <input type="date"> value; "" = no due date */
  dueDate: string;
  /** candidate keys left ticked; "thread" is always added */
  linkKeys: string[];
};

export type ThreadTaskRow = {
  id: string;
  title: string;
  assigneeName: string;
  assigneeInitials: string;
  /** "Sep 30", "" when undated */
  due: string;
  overdue: boolean;
};

export const THREAD_TASK_TITLE_MAX = 200;
export const THREAD_TASK_NOTES_MAX = 4000;
/** Same value as TASK_CONTACT_IDS_MAX in stores/tasks.ts — a value import
 *  from the store would drag it into the dialog's client bundle. */
const CONTACTS_MAX = 25;

const WORK_KINDS = ["quote", "lead", "project", "survey", "inspection"] as const;
type WorkKind = (typeof WORK_KINDS)[number];
const isWorkKind = (s: string): s is WorkKind => (WORK_KINDS as readonly string[]).includes(s);

export function threadTaskLinkCandidates(src: {
  threadId: string;
  customerId: string | null;
  siteId?: string | null;
  link?: { type: string; id: string; label?: string } | null;
  primaryContactId?: string | null;
  contactIds?: readonly string[];
}): ThreadTaskLinkCandidate[] {
  const out: ThreadTaskLinkCandidate[] = [{ key: "thread", kind: "thread", id: src.threadId }];
  const seen = new Set<string>();
  for (const raw of [src.primaryContactId, ...(src.contactIds ?? [])]) {
    const id = typeof raw === "string" ? raw.trim() : "";
    if (!id || seen.has(id) || seen.size >= CONTACTS_MAX) continue;
    seen.add(id);
    out.push({ key: `contact:${id}`, kind: "contact", id });
  }
  if (src.customerId) {
    out.push({ key: "customer", kind: "customer", id: src.customerId });
    if (src.siteId) out.push({ key: "site", kind: "site", id: src.siteId });
  }
  const link = src.link;
  if (link && link.id && isWorkKind(link.type)) out.push({ key: "work", kind: link.type, id: link.id });
  return out;
}

/** "YYYY-MM-DD" → noon of that date (the projects/actions.ts convention),
 *  "" → null, anything else → "invalid". */
export function dueAtFromDateInput(value: string): number | null | "invalid" {
  const s = (value || "").trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return "invalid";
  const d = new Date(`${s}T12:00:00`);
  if (
    Number.isNaN(d.getTime()) ||
    d.getFullYear() !== Number(m[1]) ||
    d.getMonth() + 1 !== Number(m[2]) ||
    d.getDate() !== Number(m[3])
  ) {
    return "invalid";
  }
  return d.getTime();
}

export function defaultThreadTaskNotes(subject: string, sender: string, when: string): string {
  const s = (subject || "").trim() || "(no subject)";
  const who = (sender || "").trim() || "unknown sender";
  const at = (when || "").trim();
  return `From email: "${s}" — ${who}${at ? `, ${at}` : ""}`;
}

function workRefLine(kind: "survey" | "inspection", id: string, label: string): string {
  const l = (label || "").trim();
  const text = !l ? id : l.includes(id) ? l : `${id} — ${l}`;
  return `Linked ${kind}: ${text}`;
}

export function buildThreadTaskInput(args: {
  req: ThreadTaskRequest;
  candidates: readonly ThreadTaskLinkCandidate[];
  workLabel: string;
  roster: readonly { id: string; name: string }[];
  me: { id: string; name: string };
}): { ok: true; input: Partial<TaskRecord> & { title: string } } | { ok: false; error: string } {
  const { req, candidates, workLabel, roster, me } = args;
  const title = String(req?.title ?? "").replace(/\s+/g, " ").trim();
  if (!title) return { ok: false, error: "The task needs a title." };
  if (title.length > THREAD_TASK_TITLE_MAX) return { ok: false, error: `Keep the title under ${THREAD_TASK_TITLE_MAX} characters.` };
  const notes = String(req?.notes ?? "").trim();
  if (notes.length > THREAD_TASK_NOTES_MAX) return { ok: false, error: `Keep the notes under ${THREAD_TASK_NOTES_MAX} characters.` };
  const dueAt = dueAtFromDateInput(String(req?.dueDate ?? ""));
  if (dueAt === "invalid") return { ok: false, error: "Pick a valid due date." };
  const assigneeId = String(req?.assigneeUserId ?? "").trim() || me.id;
  const assignee = roster.find((u) => u.id === assigneeId);
  if (!assignee) return { ok: false, error: "Pick someone on the team." };

  const wanted = new Set((Array.isArray(req?.linkKeys) ? req.linkKeys : []).map(String));
  wanted.add("thread");
  const input: Partial<TaskRecord> & { title: string } = {
    title,
    section: "Email",
    notes,
    assigneeUserId: assignee.id,
    assigneeName: assignee.name,
    dueAt,
  };
  const contactIds: string[] = [];
  const refs: string[] = [];
  for (const c of candidates) {
    if (!wanted.has(c.key)) continue;
    switch (c.kind) {
      case "thread": input.threadId = c.id; break;
      case "contact": contactIds.push(c.id); break;
      case "customer": input.customerId = c.id; break;
      case "site": input.siteId = c.id; break;
      case "lead": input.leadId = c.id; break;
      case "quote": input.quoteId = c.id; break;
      case "project": input.projectId = c.id; break;
      case "survey":
      case "inspection": refs.push(workRefLine(c.kind, c.id, workLabel)); break;
    }
  }
  if (contactIds.length) input.contactIds = contactIds;
  if (refs.length) input.notes = [notes, ...refs].filter(Boolean).join("\n");
  return { ok: true, input };
}

/** The sidebar's list: open tasks, soonest due first, undated last. */
export function threadTaskRows(
  tasks: readonly TaskRecord[],
  nowMs: number,
  initialsOf: (name: string) => string
): ThreadTaskRow[] {
  return tasks
    .filter((t) => t.status !== "done")
    .sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || a.createdAt - b.createdAt)
    .map((t) => ({
      id: t.id,
      title: t.title,
      assigneeName: t.assigneeName,
      assigneeInitials: t.assigneeName ? initialsOf(t.assigneeName) : "",
      due: t.dueAt ? new Date(t.dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "",
      overdue: !!t.dueAt && t.dueAt < nowMs,
    }));
}
