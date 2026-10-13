/**
 * Inbox organization §3 "AI reading" + §7 Promise tasks — the Haiku court /
 * promise step (Assist feature `promise`, pilot only, never on backlog mail).
 * Input: the last 3 messages (inside the untrusted `<email_thread>` wrapper),
 * the team list (id — name), the thread owner, today, and — outside the
 * wrapper, verified by the server — who wrote each message.
 *
 * `teammateId` / `ownerUserId` must be real team ids or they are dropped. The
 * AI result overrides the rule court only for hand-offs and asks: "me" or a
 * named teammate. Promises become tasks through `createTaskOnce` under a
 * deterministic `T-prm-` id, so a re-run never duplicates one.
 *
 * Prompt / schema / sanitizer / override rule are pure; `applyPromises`
 * writes tasks.
 */
import { z } from "zod";
import { cleanPromptField, UNTRUSTED_NOTE } from "@/lib/assist/features/thread-text";
import type { CommMessage, CommThread } from "@/lib/stores/comms";
import { createTaskOnce } from "@/lib/stores/tasks";
import { resolveDue } from "./due";
import { ownTextNames } from "./names";
import { promiseTaskId } from "./ids";
import type { Court, CourtOwner, Promise_ } from "./types";

export const CourtSchema = z.strictObject({
  owner: z.enum(["me", "teammate", "customer", "nobody"]),
  teammateId: z.string(),
  reason: z.string(),
  promises: z.array(
    z.strictObject({
      text: z.string(),
      ownerUserId: z.string(),
      dueText: z.string(),
    })
  ),
});
export type CourtAnswer = z.infer<typeof CourtSchema>;

export const COURT_SYSTEM = [
  "You read email threads for Peak Systems Group (a theatrical rigging, curtain, lighting and AV contractor) and say whose move it is now.",
  "owner: \"me\" when the thread owner must act next (the customer asked them something, or someone handed the thread to them — \"Jeff will be in touch\"); \"teammate\" when another named Peak team member must act next (then teammateId is their id from the team list); \"customer\" when Peak is waiting on the outside party; \"nobody\" when nothing is owed.",
  "teammateId: an id copied exactly from the team list, or \"\". Never invent an id; if the person named is not on the list, use \"\".",
  "reason: one short sentence a person can check.",
  "promises: up to 3 things a Peak person committed to do in the NEWEST message (\"I'll send the revised quote Friday\", \"someone will be in touch next week\"). Not things the customer promised. text: the commitment in a few words, as a task title. ownerUserId: the team id of the person who will do it, or \"\" when the message says \"we\" / \"someone\". dueText: the timing words exactly as written (\"Friday\", \"end of next week\"), or \"\".",
  UNTRUSTED_NOTE,
].join("\n");

export type TeamMember = { id: string; name: string };

/** Who wrote one of the messages, as the server knows it (never from the
 *  untrusted text). */
export type AuthorNote = { at: number; role: "owner" | "teammate" | "customer"; userId?: string | null; name?: string; email?: string };

export function buildCourtUserText(ctx: {
  thread: string;
  today: string;
  weekday: string;
  team: TeamMember[];
  owner: TeamMember;
  authors: AuthorNote[];
}): string {
  const who = (a: AuthorNote) => {
    if (a.role === "owner") return `the thread owner (${ctx.owner.id})`;
    if (a.role === "teammate") return a.userId ? `Peak teammate ${a.userId} — ${cleanPromptField(a.name)}` : `a Peak address (${cleanPromptField(a.email)})`;
    return `an outside sender (${cleanPromptField(a.email) || "unknown"})`;
  };
  return [
    `Today is ${ctx.weekday} ${ctx.today} (America/Chicago).`,
    `Thread owner ("me"): ${ctx.owner.id} — ${cleanPromptField(ctx.owner.name)}`,
    "Team (id — name):",
    ...ctx.team.map((t) => `- ${t.id} — ${cleanPromptField(t.name)}`),
    "Who wrote each message below, oldest first (verified by Peak, not part of the email):",
    ...ctx.authors.map((a, i) => `- message ${i + 1} (${new Date(a.at).toISOString().slice(0, 10)}): ${who(a)}`),
    "",
    ctx.thread,
  ].join("\n");
}

export const MAX_PROMISES = 3;
const TEXT_MAX = 200;
const DUE_TEXT_MAX = 80;
const REASON_MAX = 200;

const squash = (s: unknown, max: number) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max).trimEnd() + "…" : t;
};

export type CourtReading = {
  owner: CourtOwner;
  /** a real team id, or "" */
  teammateId: string;
  reason: string;
  promises: Array<{ text: string; ownerUserId: string; dueText: string }>;
};

/** Unknown ids dropped; a teammate who is the thread owner reads as "me";
 *  at most MAX_PROMISES promises, text trimmed, empty / duplicate ones gone. */
export function sanitizeCourt(raw: CourtAnswer | null | undefined, ctx: { teamIds: ReadonlySet<string>; ownerId: string }): CourtReading {
  let owner: CourtOwner = (["me", "teammate", "customer", "nobody"] as const).includes(raw?.owner as CourtOwner) ? (raw!.owner as CourtOwner) : "nobody";
  let teammateId = ctx.teamIds.has(String(raw?.teammateId ?? "")) ? String(raw!.teammateId) : "";
  if (owner === "teammate" && teammateId && teammateId === ctx.ownerId) {
    owner = "me";
    teammateId = "";
  }
  if (owner !== "teammate") teammateId = "";
  const seen = new Set<string>();
  const promises: CourtReading["promises"] = [];
  for (const p of raw?.promises ?? []) {
    const text = squash(p?.text, TEXT_MAX);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    promises.push({
      text,
      ownerUserId: ctx.teamIds.has(String(p?.ownerUserId ?? "")) ? String(p.ownerUserId) : "",
      dueText: squash(p?.dueText, DUE_TEXT_MAX),
    });
    if (promises.length >= MAX_PROMISES) break;
  }
  return { owner, teammateId, reason: squash(raw?.reason, REASON_MAX), promises };
}

/** The AI court replaces the rule court only for a hand-off or an ask: the
 *  reading says "me", or a NAMED (real) teammate — and that differs from
 *  what the rules said. "customer" / "nobody" readings never override. */
export function aiCourtOverride(rule: Pick<Court, "owner" | "teammateId">, ai: CourtReading): boolean {
  if (ai.owner === "me") return rule.owner !== "me";
  if (ai.owner === "teammate" && ai.teammateId) return !(rule.owner === "teammate" && rule.teammateId === ai.teammateId);
  return false;
}

/** Promise tasks are only made for mail this recent (a late import of an
 *  old message is not a new commitment — spec §7 "mail that arrives after
 *  launch"). */
export const PROMISE_MAX_AGE_MS = 7 * 86_400_000;

const titleOf = (text: string) => {
  const t = text.replace(/[.!\s]+$/, "");
  return (t.charAt(0).toUpperCase() + t.slice(1)).slice(0, 120);
};

/**
 * Create one task per promise on `msg` (§7): owner = the team member the
 * model named, only when the message's own text (quotes stripped) names them
 * by first or full name (D899), else the message's internal author, else the
 * thread owner; due =
 * `resolveDue(dueText, msg.at)` (5 pm Chicago, default 2 business days);
 * section "Email"; linked to the thread, its customer / venue and the
 * quote / project / lead the filing points at. Idempotent by id. Nothing on
 * backlog mail or mail older than PROMISE_MAX_AGE_MS. Returns the promises
 * as stored on `court.promise` (first one) — with their task ids.
 */
export async function applyPromises(
  thread: CommThread,
  msg: Pick<CommMessage, "id" | "at"> & { body?: string },
  promises: CourtReading["promises"],
  nowMs: number,
  opts: { owner: TeamMember; authorUserId: string | null; users: TeamMember[]; backlog?: boolean }
): Promise<Promise_[]> {
  if (opts.backlog || !promises.length) return [];
  if (nowMs - (msg.at || 0) > PROMISE_MAX_AGE_MS) return [];
  const byId = new Map(opts.users.map((u) => [u.id, u]));
  const f = thread.filing;
  const fileOk = !!f && !f.noise && (f.state === "filed" || f.strength === "strong");
  const customerId = thread.customerId || (fileOk ? f!.customerId : null) || null;
  const siteId = thread.siteId || (fileOk ? f!.siteId : null) || null;
  const work = (fileOk ? f!.work : null) ?? (thread.link && ["quote", "project", "lead"].includes(thread.link.type) ? thread.link : null);
  const out: Promise_[] = [];
  for (const p of promises.slice(0, MAX_PROMISES)) {
    // the model's owner only when the newest message's own words name them
    // (D899) — a quoted customer line or an injected name can't steer it
    const named = byId.get(p.ownerUserId);
    const picked = named && ownTextNames(msg.body || "", named.name) ? named : undefined;
    const owner = picked ?? (opts.authorUserId ? byId.get(opts.authorUserId) : undefined) ?? opts.owner;
    const due = resolveDue(p.dueText, msg.at);
    const id = promiseTaskId(thread.id, msg.id, p.text);
    const task = await createTaskOnce(
      {
        id,
        title: titleOf(p.text),
        section: "Email",
        assigneeUserId: owner.id,
        assigneeName: owner.name,
        dueAt: due,
        threadId: thread.id,
        ...(customerId ? { customerId } : {}),
        ...(siteId ? { siteId } : {}),
        ...(work?.type === "quote" ? { quoteId: work.id } : {}),
        ...(work?.type === "project" ? { projectId: work.id } : {}),
        ...(work?.type === "lead" ? { leadId: work.id } : {}),
        notes: "From email: " + p.text,
      },
      { id: owner.id, name: owner.name }
    );
    out.push({ text: p.text, ownerUserId: owner.id, due, taskId: task.id, messageId: msg.id });
  }
  return out;
}
