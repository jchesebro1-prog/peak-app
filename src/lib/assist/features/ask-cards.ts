/**
 * Ask AI proposal cards (spec 2026-10-13-ask-ai-design.md §4). Pure and
 * client-safe.
 *
 * The four proposal tools never write anything: the runner validates the
 * model's input against these schemas, `sanitizeCard` turns it into a card
 * against what this conversation exposed, and the user confirms the card
 * through the app's existing actions (which re-check access themselves).
 */
import { z } from "zod";
import { refKey, type RefKind } from "./ask-refs";

export type AskCardKind = "task" | "note" | "email" | "estimate";
export const ASK_CARD_KINDS: readonly AskCardKind[] = ["task", "note", "email", "estimate"];

/** Card caps (spec §4). */
export const CARD_TITLE_MAX = 200;
export const CARD_NOTES_MAX = 1000;
export const CARD_NOTE_TEXT_MAX = 4000;
export const CARD_EMAIL_TO_MAX = 10;
export const CARD_SUBJECT_MAX = 200;
export const CARD_BODY_MAX = 8000;
/** A due date further out than this many years is dropped. */
export const CARD_DUE_MAX_YEARS = 2;

export type AskTaskLinks = {
  customerId?: string;
  siteId?: string;
  leadId?: string;
  threadId?: string;
  quoteId?: string;
  projectId?: string;
};
export type NoteTargetKind = "company" | "venue" | "lead" | "project";
export type EstimateSourceKind = "thread" | "lead" | "survey" | "meeting";

export type AskTaskCard = { kind: "task"; title: string; notes: string; dueYmd: string | null; assigneeId: string | null; links: AskTaskLinks };
export type AskNoteCard = { kind: "note"; target: { kind: NoteTargetKind; id: string }; text: string };
export type AskEmailCard = { kind: "email"; to: string[]; subject: string; body: string; threadId: string | null };
export type AskEstimateCard = { kind: "estimate"; source: { kind: EstimateSourceKind; id: string } };
export type AskCard = AskTaskCard | AskNoteCard | AskEmailCard | AskEstimateCard;

/** A task link field → the ref kind its id must have been exposed as. */
export const TASK_LINK_KINDS: Record<keyof AskTaskLinks, RefKind> = {
  customerId: "company",
  siteId: "venue",
  leadId: "lead",
  threadId: "thread",
  quoteId: "quote",
  projectId: "project",
};
const NOTE_TARGETS: readonly NoteTargetKind[] = ["company", "venue", "lead", "project"];
const ESTIMATE_SOURCES: readonly EstimateSourceKind[] = ["thread", "lead", "survey", "meeting"];

/* ---------------- tool input schemas (what the model sends) ---------------- */

// Loose upper bounds: an over-long field is truncated by sanitizeCard, not
// bounced back to the model as an error round.
const idField = z.string().max(400).nullish();

export const ProposeTaskInput = z.object({
  title: z.string().max(2000).describe("A short task title."),
  notes: z.string().max(10_000).nullish().describe("Optional detail."),
  due: z.string().max(60).nullish().describe("Due date as YYYY-MM-DD (America/Chicago), or omit."),
  assigneeId: idField.describe("A team member's user id; omit for the person asking."),
  links: z
    .object({
      customerId: idField.describe("A company id from a record you looked up."),
      siteId: idField.describe("A venue id."),
      leadId: idField.describe("A lead id."),
      threadId: idField.describe("An email thread id."),
      quoteId: idField.describe("A quote id."),
      projectId: idField.describe("A project id."),
    })
    .nullish(),
});

export const ProposeNoteInput = z.object({
  target: z.object({
    kind: z.enum(["company", "venue", "lead", "project"]),
    id: z.string().max(400),
  }),
  text: z.string().max(20_000).describe("The note text."),
});

export const ProposeEmailInput = z.object({
  to: z.array(z.string().max(400)).max(50).describe("Recipient email addresses taken from records or the conversation."),
  subject: z.string().max(2000),
  body: z.string().max(40_000).describe("Plain-text email body."),
  threadId: idField.describe("The email thread this replies to, if any."),
});

export const ProposeSuggestEstimateInput = z.object({
  source: z.object({
    kind: z.enum(["thread", "lead", "survey", "meeting"]),
    id: z.string().max(400),
  }),
});

/** The proposal tools: name, kind, description and input schema (the runner converts to JSON Schema). */
export const ASK_PROPOSAL_TOOLS = [
  {
    name: "propose_task",
    kind: "task",
    description: "Propose a task for the user to confirm. Nothing is created until they click Confirm.",
    schema: ProposeTaskInput,
  },
  {
    name: "propose_note",
    kind: "note",
    description: "Propose a note on a company, venue, lead or project for the user to confirm. Nothing is saved until they click Confirm.",
    schema: ProposeNoteInput,
  },
  {
    name: "propose_email",
    kind: "email",
    description: "Propose an email draft. Confirming opens it in the Inbox composer; it is never sent automatically.",
    schema: ProposeEmailInput,
  },
  {
    name: "propose_suggest_estimate",
    kind: "estimate",
    description: "Propose starting an estimate suggestion from an email thread, lead, venue assessment (survey) or meeting.",
    schema: ProposeSuggestEstimateInput,
  },
] as const satisfies readonly { name: string; kind: AskCardKind; description: string; schema: z.ZodType }[];

export type ProposalToolName = (typeof ASK_PROPOSAL_TOOLS)[number]["name"];
export function proposalToolKind(name: string): AskCardKind | null {
  return ASK_PROPOSAL_TOOLS.find((t) => t.name === name)?.kind ?? null;
}

/* ---------------- sanitising ---------------- */

export type CardContext = {
  /** refKey()s this request exposed (tool results, page context, re-checked prior tokens). */
  refs: Set<string>;
  /** Lower-cased addresses that appear in an exposed record or were typed by the user. */
  emails: Set<string>;
  /** Active team members. */
  team: { id: string }[];
  meId: string;
  /** Today in America/Chicago, YYYY-MM-DD. */
  todayYmd: string;
  /** #340 — exposed thread ids outside the asker's own mailbox (readable
   *  because linked or assigned): a task card never links one, so the card
   *  shows only what createAskTask will write (its thread link is own-only). */
  readOnlyThreads?: ReadonlySet<string>;
};

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

function capped(t: string, max: number): string {
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}
/** One line: control characters and line breaks become spaces, collapsed, trimmed, capped. */
export function oneLine(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  return capped(s.replace(/\r\n?|\n|\t/g, " ").replace(CONTROL, "").replace(/ {2,}/g, " ").trim(), max);
}
/** Multi-line text: CRs and control characters dropped, 3+ blank lines squeezed, trimmed, capped. */
export function multiLine(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  return capped(s.replace(/\r\n?/g, "\n").replace(CONTROL, "").replace(/\n{3,}/g, "\n\n").trim(), max);
}

const EMAIL_RE = /^[^\s@<>"(),;:[\]\\]+@[^\s@<>"(),;:[\]\\]+\.[^\s@<>"(),;:[\]\\]+$/;
export function cleanEmail(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim().toLowerCase();
  return t.length <= 254 && EMAIL_RE.test(t) ? t : null;
}

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CHICAGO_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });

function realYmd(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * A due date, read in America/Chicago: `YYYY-MM-DD` as written, a timestamp
 * with no zone as its own date (Chicago wall time), or a zoned ISO timestamp
 * (Z / ±hh:mm) converted to its Chicago day. Null when it isn't a real date, is
 * before today, or is more than CARD_DUE_MAX_YEARS out.
 */
export function parseDueYmd(raw: unknown, todayYmd: string): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  let ymd: string | null = null;
  const m = YMD_RE.exec(t);
  if (m) {
    ymd = realYmd(+m[1], +m[2], +m[3]) ? t : null;
  } else if (/^\d{4}-\d{2}-\d{2}T/.test(t)) {
    if (/(Z|[+-]\d{2}(:?\d{2})?)$/i.test(t)) {
      // a zoned timestamp: its America/Chicago day
      const ms = Date.parse(t);
      ymd = Number.isFinite(ms) ? CHICAGO_DAY.format(new Date(ms)) : null;
    } else {
      // a bare local timestamp is already Chicago wall time — its own date
      const d = YMD_RE.exec(t.slice(0, 10));
      ymd = d && realYmd(+d[1], +d[2], +d[3]) ? t.slice(0, 10) : null;
    }
  }
  if (!ymd || !YMD_RE.test(todayYmd)) return null;
  const limit = `${String(+todayYmd.slice(0, 4) + CARD_DUE_MAX_YEARS).padStart(4, "0")}${todayYmd.slice(4)}`;
  return ymd >= todayYmd && ymd <= limit ? ymd : null;
}

/** An id the conversation exposed as `kind`, else null. */
function exposed(kind: RefKind, id: unknown, refs: Set<string>): string | null {
  if (typeof id !== "string") return null;
  const t = id.trim();
  return t && refs.has(refKey(kind, t)) ? t : null;
}

/**
 * The model's proposal → a card, or null. Ids survive only when this request
 * exposed them (an invalid note target / estimate source drops the card;
 * an unknown task link or thread id is just dropped). Recipients survive
 * only when exposed; the assignee must be an active team member, else the
 * user; the due date is read in Chicago.
 */
export function sanitizeCard(kind: AskCardKind, input: unknown, ctx: CardContext): AskCard | null {
  switch (kind) {
    case "task": {
      const p = ProposeTaskInput.safeParse(input);
      if (!p.success) return null;
      const title = oneLine(p.data.title, CARD_TITLE_MAX);
      if (!title) return null;
      const links: AskTaskLinks = {};
      for (const [field, refKind] of Object.entries(TASK_LINK_KINDS) as [keyof AskTaskLinks, RefKind][]) {
        const id = exposed(refKind, p.data.links?.[field], ctx.refs);
        if (id && !(refKind === "thread" && ctx.readOnlyThreads?.has(id))) links[field] = id;
      }
      const want = typeof p.data.assigneeId === "string" ? p.data.assigneeId.trim() : "";
      const assigneeId = want && ctx.team.some((u) => u.id === want) ? want : ctx.meId || null;
      return {
        kind: "task",
        title,
        notes: multiLine(p.data.notes, CARD_NOTES_MAX),
        dueYmd: parseDueYmd(p.data.due, ctx.todayYmd),
        assigneeId,
        links,
      };
    }
    case "note": {
      const p = ProposeNoteInput.safeParse(input);
      if (!p.success || !NOTE_TARGETS.includes(p.data.target.kind)) return null;
      const id = exposed(p.data.target.kind, p.data.target.id, ctx.refs);
      const text = multiLine(p.data.text, CARD_NOTE_TEXT_MAX);
      if (!id || !text) return null;
      return { kind: "note", target: { kind: p.data.target.kind, id }, text };
    }
    case "email": {
      const p = ProposeEmailInput.safeParse(input);
      if (!p.success) return null;
      const allowed = new Set([...ctx.emails].map((e) => e.toLowerCase()));
      const to: string[] = [];
      for (const raw of p.data.to) {
        const e = cleanEmail(raw);
        if (e && allowed.has(e) && !to.includes(e) && to.length < CARD_EMAIL_TO_MAX) to.push(e);
      }
      const subject = oneLine(p.data.subject, CARD_SUBJECT_MAX);
      const body = multiLine(p.data.body, CARD_BODY_MAX);
      if (!subject && !body) return null;
      return { kind: "email", to, subject, body, threadId: exposed("thread", p.data.threadId, ctx.refs) };
    }
    case "estimate": {
      const p = ProposeSuggestEstimateInput.safeParse(input);
      if (!p.success || !ESTIMATE_SOURCES.includes(p.data.source.kind)) return null;
      const id = exposed(p.data.source.kind, p.data.source.id, ctx.refs);
      return id ? { kind: "estimate", source: { kind: p.data.source.kind, id } } : null;
    }
    default:
      return null;
  }
}

/** A shallow shape check for a card arriving over the wire (the client trusts only well-formed cards). */
export function isAskCard(x: unknown): x is AskCard {
  if (!x || typeof x !== "object") return false;
  const c = x as Record<string, unknown>;
  switch (c.kind) {
    case "task":
      return typeof c.title === "string" && typeof c.notes === "string" && (c.dueYmd === null || typeof c.dueYmd === "string") && (c.assigneeId === null || typeof c.assigneeId === "string") && !!c.links && typeof c.links === "object";
    case "note": {
      const t = c.target as Record<string, unknown> | null;
      return !!t && typeof t === "object" && NOTE_TARGETS.includes(t.kind as NoteTargetKind) && typeof t.id === "string" && typeof c.text === "string";
    }
    case "email":
      return Array.isArray(c.to) && c.to.every((e) => typeof e === "string") && typeof c.subject === "string" && typeof c.body === "string" && (c.threadId === null || typeof c.threadId === "string");
    case "estimate": {
      const s = c.source as Record<string, unknown> | null;
      return !!s && typeof s === "object" && ESTIMATE_SOURCES.includes(s.kind as EstimateSourceKind) && typeof s.id === "string";
    }
    default:
      return false;
  }
}
