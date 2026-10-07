import { displayQuoteNumber } from "@/lib/estimate-number";
import { renderCoverPdf as renderCoverPdfLive } from "@/lib/estimate-output/cover-pdf-server";
import { coverPdfFileName } from "@/lib/estimate-output/cover";
import { chicagoDayEnd, leadEstimator } from "@/lib/estimate-output/responses";
import { pdfStorage } from "@/lib/quote-pdf/storage";
import { latestSentRevision, pdfFileName, pdfIsCurrent, pdfKindForQuoteType, teamPdfPath } from "@/lib/quote-pdf/state";
import { ensureShareLink } from "@/lib/quote-share/links";
import { sendQuoteToCustomer, type ReviewOpResult } from "@/lib/quote-review-ops";
import { get as getThread, saveDraft, sendDraft, type CommAttachment, type CommLink } from "@/lib/stores/comms";
import { get as getQuoteLive, recordEstimateEmail, type EstimateEmailEntry, type Quote, type QuoteStatus } from "@/lib/stores/quotes";
import { createTask } from "@/lib/stores/tasks";
import { can } from "@/lib/team";
import { activeUsers } from "@/lib/users";
import { attachmentsFit, FOLLOW_UP_CHOICES, parseRecipients, withLink } from "./compose";

/**
 * Estimator Phase 3 (spec §10.1, §10.3) — email the estimate from the
 * Estimator's Send & track step, server-only. The order is fixed and is the
 * whole point of this module:
 *
 *   preflight → attachments → mark sent (draft only) → client link →
 *   comms thread (send, or a draft for Open in Inbox) → record → follow-up
 *
 * Nothing is marked or emailed when preflight or the attachments fail; an
 * approval-gate refusal emails nothing. Once the quote is marked sent, a
 * failure before the email goes out reports `markedSent: true` (the quote
 * stays sent — the link already works). Once the email HAS gone out, a failed
 * record or follow-up never reads as a failed send (that would invite a
 * duplicate email): the result stays ok with a `warning`.
 *
 * Every side effect is an injected dep so the spec harness proves the order
 * with fakes; `liveEstimateEmailDeps` wires the real ones (the "use server"
 * wrappers in src/app/(app)/estimator/send-actions.ts).
 */

export const SEND_COPY = {
  needsPerm: "You need send or approve permission to send a quote.",
  gone: "Quote not found.",
  notEstimate: "Only system estimates can be emailed from here.",
  closed: "This estimate is closed — it can’t be emailed.",
  pdfStale: "Save the estimate first — its PDF is out of date.",
  pdfUnreadable: "The estimate PDF couldn’t be read — save the estimate and try again.",
  noTo: "Add at least one To address.",
  badTo: (bad: string[]) => `Check the To address${bad.length === 1 ? "" : "es"}: ${bad.join(", ")}`,
  badCc: (bad: string[]) => `Check the Cc address${bad.length === 1 ? "" : "es"}: ${bad.join(", ")}`,
  tooManyRecipients: "Too many recipients — 20 at most.",
  noSubject: "Add a subject.",
  noBody: "Add a message.",
  subjectTooLong: "The subject is too long.",
  bodyTooLong: "The message is too long.",
  badFollowUp: "Pick a follow-up option.",
  tooLarge: "Too large to attach — send the link only.",
  attachFailed: "The attachments couldn’t be prepared — try again.",
  markFailed: "The estimate couldn’t be marked sent — nothing was emailed. Try again.",
  partial: "Marked sent, but the email didn’t go out — open it in Inbox.",
  notSent: "The email didn’t go out — try again.",
  inboxPartial: "Marked sent, but the Inbox draft couldn’t be created — try Open in Inbox again.",
  inboxFailed: "The Inbox draft couldn’t be created — try again.",
  recordFailed: "Sent — but it couldn’t be logged on the estimate’s Activity.",
  taskFailed: "Sent — but the follow-up task couldn’t be created. Add it by hand.",
} as const;

export const RECIPIENTS_MAX = 20;
/** The To + Cc text itself — parsed only under this length. */
export const RECIPIENTS_RAW_MAX = 4_000;
export const SUBJECT_MAX = 300;
export const BODY_MAX = 20_000;
const DAY_MS = 86_400_000;

/** A failure whose message is written for the user (a dep throws it). */
export class EstimateEmailError extends Error {
  /** A comms thread already exists (the draft whose send failed). */
  threadId?: string;
  constructor(message: string, threadId?: string) {
    super(message);
    this.name = "EstimateEmailError";
    if (threadId) this.threadId = threadId;
  }
}

export type SendActor = { id: string; name: string; roles: string[] };
export type RosterUser = { id: string; name: string; status?: string | null };

export type EstimateEmailInput = {
  to: string;
  cc?: string;
  subject: string;
  body: string;
  attachEstimate: boolean;
  attachCover: boolean;
  /** 0 = Off; one of FOLLOW_UP_CHOICES. Ignored by Open in Inbox. */
  followUpDays?: number;
  /** The quote's updatedAt the sender was shown — refuse a version they didn't see (first send only). */
  asOf?: number;
};

export type ThreadSpec = {
  mailboxUser: string;
  customerId: string | null;
  customer: string;
  contactName: string;
  /** The FULL To line ("a@b.com, c@d.org") — the thread's contactEmail and the message's `to`. */
  to: string;
  cc: string;
  subject: string;
  body: string;
  link: CommLink;
  attachments: CommAttachment[];
};

export type FollowUpSpec = {
  title: string;
  section: string;
  quoteId: string;
  assigneeUserId: string | null;
  assigneeName: string;
  dueAt: number;
  notes: string;
  threadId: string;
  customerId?: string;
  leadId?: string;
};

export type EstimateEmailDeps = {
  now: () => number;
  getQuote: (id: string) => Promise<Quote | null>;
  /** The estimate PDF bytes (estimatePdfPath); null = not readable. */
  readEstimatePdf: (q: Quote) => Promise<Buffer | null>;
  /** The cover, rendered now; throws EstimateEmailError with the reason. */
  renderCoverPdf: (q: Quote) => Promise<Buffer>;
  sendQuote: (id: string, actor: SendActor, asOf?: number) => Promise<ReviewOpResult>;
  /** The absolute client-link URL; throws EstimateEmailError when refused. */
  ensureLink: (id: string) => Promise<string>;
  createAndSendThread: (spec: ThreadSpec) => Promise<{ threadId: string; delivered: boolean }>;
  createDraftThread: (spec: ThreadSpec) => Promise<{ threadId: string }>;
  recordEmail: (id: string, entry: EstimateEmailEntry) => Promise<boolean>;
  addFollowUpTask: (spec: FollowUpSpec, actor: SendActor) => Promise<unknown>;
  /** Active team members — the Lead estimator lookup. */
  roster: () => Promise<RosterUser[]>;
};

export type SendEstimateResult =
  | { ok: true; threadId: string; delivered: boolean; status: QuoteStatus; warning?: string }
  | { ok: false; error: string; markedSent?: boolean; href?: string };

export type OpenInInboxResult =
  | { ok: true; href: string; threadId: string; status: QuoteStatus; warning?: string }
  | { ok: false; error: string; markedSent?: boolean };

/** The Inbox composer opened on a draft (shared boxes are retired — the personal box). */
export function inboxDraftHref(threadId: string): string {
  return `/inbox?box=personal&folder=drafts&draft=${encodeURIComponent(threadId)}`;
}

/** The thread's record link label: `<EST number> · <project name>`. */
export function estimateLinkLabel(q: Quote): string {
  const number = displayQuoteNumber(q);
  const name = String(q.name || "").trim();
  return name ? `${number} · ${name}` : number;
}

/**
 * Which stored PDF goes out: on a re-send (status `sent`) the latest sent
 * revision's own copy when it has one — exactly what the customer was sent —
 * else the current file (preflight already required it to be current).
 */
export function estimatePdfPath(q: Pick<Quote, "status" | "pdf" | "revisions">): string | null {
  if (q.status === "sent") {
    const rev = latestSentRevision(q.revisions);
    if (rev?.pdfBlobPath) return rev.pdfBlobPath;
  }
  return teamPdfPath(q, null);
}

/** Follow-up due: 11:59 PM Chicago on the day `days` days from `now`. */
export function followUpDueAt(now: number, days: number): number {
  return chicagoDayEnd(now + days * DAY_MS);
}

type Prepared = {
  q: Quote;
  to: string;
  cc: string;
  subject: string;
  body: string;
  attachments: CommAttachment[];
};

type Refusal = { ok: false; error: string };

function userMessage(e: unknown, fallback: string): string {
  return e instanceof EstimateEmailError ? e.message : fallback;
}

/** Steps 1–2: preflight and attachments. Reads only — nothing is written. */
async function prepare(
  deps: EstimateEmailDeps,
  actor: SendActor,
  quoteId: string,
  input: EstimateEmailInput,
  mode: "send" | "inbox"
): Promise<Prepared | Refusal> {
  if (!can("send", actor.roles) && !can("approve", actor.roles)) return { ok: false, error: SEND_COPY.needsPerm };
  const id = String(quoteId || "");
  const q = id && id.length <= 64 ? await deps.getQuote(id) : null;
  if (!q) return { ok: false, error: SEND_COPY.gone };
  if (pdfKindForQuoteType(q.quoteType) !== "quote") return { ok: false, error: SEND_COPY.notEstimate };
  if (q.status !== "draft" && q.status !== "sent") return { ok: false, error: SEND_COPY.closed };
  if (!pdfIsCurrent(q.pdf, q.contentChangedAt)) return { ok: false, error: SEND_COPY.pdfStale };

  const rawTo = String(input?.to ?? "");
  const rawCc = String(input?.cc ?? "");
  if (rawTo.length + rawCc.length > RECIPIENTS_RAW_MAX) return { ok: false, error: SEND_COPY.tooManyRecipients };
  const to = parseRecipients(rawTo);
  if (!to.ok) return { ok: false, error: SEND_COPY.badTo(to.bad) };
  // Open in Inbox may leave To for the composer; a send needs one.
  if (mode === "send" && to.list.length === 0) return { ok: false, error: SEND_COPY.noTo };
  const cc = parseRecipients(rawCc);
  if (!cc.ok) return { ok: false, error: SEND_COPY.badCc(cc.bad) };
  if (to.list.length + cc.list.length > RECIPIENTS_MAX) return { ok: false, error: SEND_COPY.tooManyRecipients };
  // One line: a subject can never carry a header break.
  const subject = String(input?.subject ?? "").replace(/[\r\n]+/g, " ").trim();
  const body = String(input?.body ?? "");
  if (!subject) return { ok: false, error: SEND_COPY.noSubject };
  if (!body.trim()) return { ok: false, error: SEND_COPY.noBody };
  if (subject.length > SUBJECT_MAX) return { ok: false, error: SEND_COPY.subjectTooLong };
  if (body.length > BODY_MAX) return { ok: false, error: SEND_COPY.bodyTooLong };
  if (mode === "send" && !(FOLLOW_UP_CHOICES as readonly number[]).includes(Number(input?.followUpDays))) {
    return { ok: false, error: SEND_COPY.badFollowUp };
  }

  // Step 2 — attachments, before anything is marked.
  const number = displayQuoteNumber(q);
  const attachments: CommAttachment[] = [];
  try {
    if (input.attachEstimate === true) {
      const bytes = await deps.readEstimatePdf(q);
      if (!bytes || !bytes.length) return { ok: false, error: SEND_COPY.pdfUnreadable };
      attachments.push(pdfAttachment(pdfFileName(number, null), bytes));
    }
    if (input.attachCover === true) {
      attachments.push(pdfAttachment(coverPdfFileName(number), await deps.renderCoverPdf(q)));
    }
  } catch (e) {
    if (!(e instanceof EstimateEmailError)) console.error("[estimate-email] attachments failed", e);
    return { ok: false, error: userMessage(e, SEND_COPY.attachFailed) };
  }
  if (!attachmentsFit(attachments.map((a) => a.size))) return { ok: false, error: SEND_COPY.tooLarge };

  return { q, to: to.list.join(", "), cc: cc.list.join(", "), subject, body, attachments };
}

function pdfAttachment(name: string, bytes: Buffer): CommAttachment {
  return { name, mime: "application/pdf", size: bytes.length, dataUrl: "data:application/pdf;base64," + bytes.toString("base64") };
}

/** Steps 3–4: mark sent (draft only) and mint the link. */
async function markAndLink(
  deps: EstimateEmailDeps,
  actor: SendActor,
  p: Prepared,
  asOf: number | undefined
): Promise<{ ok: true; markedSent: boolean; url: string; q: Quote; rev: number } | { ok: false; error: string; markedSent: boolean }> {
  let markedSent = false;
  if (p.q.status === "draft") {
    let r: ReviewOpResult;
    try {
      r = await deps.sendQuote(p.q.id, actor, typeof asOf === "number" && asOf > 0 ? asOf : undefined);
    } catch (e) {
      console.error("[estimate-email] mark sent threw", e);
      return { ok: false, error: SEND_COPY.markFailed, markedSent: false };
    }
    // The approval gate (or a version change) refused: nothing is emailed.
    if (!r.ok) return { ok: false, error: r.error, markedSent: false };
    markedSent = true;
  }
  try {
    const url = await deps.ensureLink(p.q.id);
    const fresh = markedSent ? (await deps.getQuote(p.q.id)) ?? p.q : p.q;
    const rev = latestSentRevision(fresh.revisions)?.rev;
    if (typeof rev !== "number") throw new Error("no sent revision after send");
    return { ok: true, markedSent, url, q: fresh, rev };
  } catch (e) {
    if (!(e instanceof EstimateEmailError)) console.error("[estimate-email] client link failed", e);
    return { ok: false, error: markedSent ? SEND_COPY.partial : userMessage(e, SEND_COPY.notSent), markedSent };
  }
}

function threadSpecFor(actor: SendActor, q: Quote, p: Prepared, body: string): ThreadSpec {
  return {
    mailboxUser: actor.name,
    customerId: q.customerId ?? null,
    customer: q.customer || "",
    contactName: q.contactName || "",
    to: p.to,
    cc: p.cc,
    subject: p.subject,
    body,
    link: { type: "quote", id: q.id, label: estimateLinkLabel(q) },
    attachments: p.attachments,
  };
}

/** §10.1 — Send & mark sent → / Send email →. */
export async function sendEstimateEmail(
  deps: EstimateEmailDeps,
  actor: SendActor,
  quoteId: string,
  input: EstimateEmailInput
): Promise<SendEstimateResult> {
  const p = await prepare(deps, actor, quoteId, input, "send");
  if ("ok" in p) return p;
  const m = await markAndLink(deps, actor, p, input.asOf);
  if (!m.ok) return { ok: false, error: m.error, ...(m.markedSent ? { markedSent: true } : {}) };
  const { q, rev, markedSent } = m;

  // Step 5 — the email.
  let sent: { threadId: string; delivered: boolean };
  try {
    sent = await deps.createAndSendThread(threadSpecFor(actor, q, p, withLink(p.body, m.url)));
  } catch (e) {
    console.error("[estimate-email] send failed", e);
    const threadId = e instanceof EstimateEmailError ? e.threadId : undefined;
    return {
      ok: false,
      error: markedSent ? SEND_COPY.partial : SEND_COPY.notSent,
      ...(markedSent ? { markedSent: true } : {}),
      ...(threadId ? { href: inboxDraftHref(threadId) } : {}),
    };
  }

  // Steps 6–7 — the email is out: these never turn the result into a failure.
  const at = deps.now();
  const warnings: string[] = [];
  try {
    if (!(await deps.recordEmail(q.id, { threadId: sent.threadId, rev, at, by: actor.name, to: p.to }))) warnings.push(SEND_COPY.recordFailed);
  } catch (e) {
    console.error("[estimate-email] record failed", e);
    warnings.push(SEND_COPY.recordFailed);
  }
  const days = Number(input.followUpDays);
  if (days > 0) {
    try {
      const users = await deps.roster();
      const lead = leadEstimator(q.owner, q.preparedBy, users.filter((u) => (u.status ?? "active") === "active"));
      const assignee = lead ? { id: lead.id, name: lead.name } : { id: actor.id || null, name: actor.name };
      const number = displayQuoteNumber(q);
      await deps.addFollowUpTask(
        {
          title: `Follow up on ${estimateLinkLabel(q)}`,
          section: "Review",
          quoteId: q.id,
          assigneeUserId: assignee.id,
          assigneeName: assignee.name,
          dueAt: followUpDueAt(at, days),
          notes: `${number} was emailed to ${p.to} by ${actor.name}.`,
          threadId: sent.threadId,
          ...(q.customerId ? { customerId: q.customerId } : {}),
          ...(q.leadId ? { leadId: q.leadId } : {}),
        },
        actor
      );
    } catch (e) {
      console.error("[estimate-email] follow-up task failed", e);
      warnings.push(SEND_COPY.taskFailed);
    }
  }
  return {
    ok: true,
    threadId: sent.threadId,
    delivered: sent.delivered === true,
    status: q.status,
    ...(warnings.length ? { warning: warnings.join(" ") } : {}),
  };
}

/** §10.3 — Open in Inbox: steps 1–4 and 6, the thread as a DRAFT (never sent here). */
export async function openEstimateInInbox(
  deps: EstimateEmailDeps,
  actor: SendActor,
  quoteId: string,
  input: EstimateEmailInput
): Promise<OpenInInboxResult> {
  const p = await prepare(deps, actor, quoteId, input, "inbox");
  if ("ok" in p) return p;
  const m = await markAndLink(deps, actor, p, input.asOf);
  if (!m.ok) {
    const error = m.markedSent ? SEND_COPY.inboxPartial : m.error;
    return { ok: false, error, ...(m.markedSent ? { markedSent: true } : {}) };
  }
  const { q, rev, markedSent } = m;
  let threadId: string;
  try {
    threadId = (await deps.createDraftThread(threadSpecFor(actor, q, p, withLink(p.body, m.url)))).threadId;
  } catch (e) {
    console.error("[estimate-email] inbox draft failed", e);
    return { ok: false, error: markedSent ? SEND_COPY.inboxPartial : SEND_COPY.inboxFailed, ...(markedSent ? { markedSent: true } : {}) };
  }
  let warning: string | undefined;
  try {
    if (!(await deps.recordEmail(q.id, { threadId, rev, at: deps.now(), by: actor.name, to: p.to }))) warning = SEND_COPY.recordFailed;
  } catch (e) {
    console.error("[estimate-email] record failed", e);
    warning = SEND_COPY.recordFailed;
  }
  return { ok: true, href: inboxDraftHref(threadId), threadId, status: q.status, ...(warning ? { warning } : {}) };
}

/* ---- the real deps (wired by the "use server" wrappers) ---- */

/**
 * `origin`: the app origin the client link is built on (the cover's own link
 * line uses the same print origin); `host`/`proto`: the request's, for the
 * cover render. Only the app ever calls this — the harness passes fakes.
 */
export function liveEstimateEmailDeps(opts: { origin: string; host: string | null; proto: string | null; actor: SendActor }): EstimateEmailDeps {
  const origin = opts.origin.replace(/\/+$/, "");
  return {
    now: Date.now,
    getQuote: getQuoteLive,
    readEstimatePdf: async (q) => {
      const path = estimatePdfPath(q);
      const store = pdfStorage();
      if (!path || "unavailable" in store) return null;
      return store.read(path);
    },
    renderCoverPdf: async (q) => {
      const r = await renderCoverPdfLive(q.id, opts.host, opts.proto);
      if (!r.ok) throw new EstimateEmailError(r.error);
      return r.pdf;
    },
    sendQuote: (id, actor, asOf) => sendQuoteToCustomer(id, actor, asOf),
    ensureLink: async (id) => {
      const r = await ensureShareLink(id, opts.actor.name);
      if (!r.ok) throw new EstimateEmailError(r.error);
      // #301 slice B: the link pins the latest sent revision (v2), as Copy client link does.
      const path = r.link.pathV2 ?? r.link.path;
      if (!path) throw new Error("active link without a path");
      return origin + path;
    },
    createAndSendThread: async (spec) => {
      const draft = await saveDraft({ ...draftInput(spec), me: spec.mailboxUser });
      try {
        const sent = await sendDraft(draft.id, spec.mailboxUser, { stampAddresses: true });
        if (!sent) throw new Error("the draft vanished before it was sent");
      } catch (e) {
        console.error("[estimate-email] sendDraft failed", e);
        throw new EstimateEmailError(SEND_COPY.notSent, draft.id);
      }
      // Gmail stamps gmailId after the write (dispatchOutbound); none = local only.
      const t = await getThread(draft.id);
      const outs = (t?.messages || []).filter((x) => x.direction === "out");
      return { threadId: draft.id, delivered: !!outs[outs.length - 1]?.gmailId };
    },
    createDraftThread: async (spec) => ({ threadId: (await saveDraft({ ...draftInput(spec), me: spec.mailboxUser })).id }),
    recordEmail: recordEstimateEmail,
    addFollowUpTask: (spec, actor) => createTask(spec, { id: actor.id, name: actor.name }),
    roster: async () => (await activeUsers()).map((u) => ({ id: u.id, name: u.name, status: u.status })),
  };
}

function draftInput(spec: ThreadSpec) {
  return {
    mailbox: "personal" as const,
    mailboxUser: spec.mailboxUser,
    customerId: spec.customerId,
    customer: spec.customer,
    contactName: spec.contactName,
    contactEmail: spec.to,
    to: spec.to,
    cc: spec.cc,
    subject: spec.subject,
    body: spec.body,
    link: spec.link,
    attachments: spec.attachments,
  };
}
