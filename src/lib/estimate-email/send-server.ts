import { displayQuoteNumber } from "@/lib/estimate-number";
import { renderCoverPdf as renderCoverPdfLive } from "@/lib/estimate-output/cover-pdf-server";
import { coverPdfFileName } from "@/lib/estimate-output/cover";
import { chicagoDayEnd, leadEstimator } from "@/lib/estimate-output/responses";
import { pdfStorage } from "@/lib/quote-pdf/storage";
import { applyOutboundSignature } from "@/lib/email-signature";
import { gmailEnabled, personalKey } from "@/lib/gmail/config";
import { getConnectionInfo } from "@/lib/gmail/connections";
import { latestSentRevision, pdfFileName, pdfIsCurrent, pdfKindForQuoteType, pdfView, teamPdfPath } from "@/lib/quote-pdf/state";
import { ensureShareLink } from "@/lib/quote-share/links";
import { sendQuoteToCustomer, type ReviewOpResult } from "@/lib/quote-review-ops";
import { get as getThread, saveDraft, sendDraft, type CommAttachment, type CommLink } from "@/lib/stores/comms";
import {
  claimEstimateEmailSend, get as getQuoteLive, recordEstimateEmail, releaseEstimateEmailSend,
  type EstimateEmailClaim, type EstimateEmailEntry, type Quote, type QuoteRevision, type QuoteStatus,
} from "@/lib/stores/quotes";
import { signatureFor } from "@/lib/stores/signatures";
import { createTask } from "@/lib/stores/tasks";
import { can } from "@/lib/team";
import { activeUsers, getUser } from "@/lib/users";
import { attachmentsFit, bodyWithLink, FOLLOW_UP_CHOICES, parseRecipients, withoutAddresses } from "./compose";

/**
 * Estimator Phase 3 (spec §10.1, §10.3) — email the estimate from the
 * Estimator's Send & track step, server-only. The order is fixed and is the
 * whole point of this module:
 *
 *   preflight → claim → preflight again → attachments → re-read →
 *   mark sent (draft only) → client link →
 *   comms thread (send, or a draft for Open in Inbox) → record → follow-up
 *
 * Nothing is marked or emailed when preflight or the attachments fail; an
 * approval-gate refusal emails nothing. Once the quote is marked sent, a
 * failure before the email goes out reports `markedSent: true` (the quote
 * stays sent — the link already works). Once the email HAS gone out, a failed
 * record or follow-up never reads as a failed send (that would invite a
 * duplicate email): the result stays ok with a `warning`.
 *
 * Fix round 1: one send at a time per quote (a store-owned claim,
 * `Quote.emailSending`, taken before anything is marked and released in
 * `finally`); a stale view (`asOf`) is refused on a re-send too; Gmail
 * refusing a connected sender's email is a failure, never "sent locally";
 * the estimate PDF rides BY REFERENCE (`pdfPath` + `href`) — its bytes are
 * never copied into the comms thread; the sender's signature is applied the
 * way the Inbox applies it.
 *
 * Fix round 2: the claim is taken right after the cheap preflight — BEFORE
 * the PDF read and the (up to 45 s) cover render — and the quote is re-read
 * under it twice: once on acquiring it (the whole preflight again, plus the
 * status the first read saw) and once after the attachments, just before
 * anything is marked (a recall/close/save during the render refuses). A
 * Gmail-refused send is still recorded on the estimate's Activity (no
 * follow-up task). A partial failure with no thread to open says to send
 * again rather than "open it in Inbox".
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
  changedSince: "This quote changed since you opened it — reload to review the current version.",
  pdfStale: "Save the estimate first — its PDF is out of date.",
  pdfRendering: "The PDF is still being made — try again in a moment.",
  pdfPreparing: "The sent PDF is still being prepared — try again in a moment.",
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
  prepareFailed: "The email couldn’t be prepared — try again.",
  inProgress: "Another send of this estimate is in progress.",
  claimFailed: "The send couldn’t start — try again.",
  markFailed: "The estimate couldn’t be marked sent — nothing was emailed. Try again.",
  partial: "Marked sent, but the email didn’t go out — open it in Inbox.",
  /** Marked sent, nothing went out and no thread exists to open. */
  partialNoThread: "Marked sent, but the email didn’t go out — send it again in a moment.",
  notSent: "The email didn’t go out — try again.",
  gmailFailed: "Marked sent, but Gmail didn’t accept the email — open it in Inbox.",
  gmailFailedResend: "Gmail didn’t accept the email — open it in Inbox.",
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
  /** That thread is still a draft (false = it left Drafts — link the thread). */
  stillDraft?: boolean;
  constructor(message: string, threadId?: string, stillDraft?: boolean) {
    super(message);
    this.name = "EstimateEmailError";
    if (threadId) this.threadId = threadId;
    if (typeof stillDraft === "boolean") this.stillDraft = stillDraft;
  }
}

export type SendActor = { id: string; name: string; roles: string[]; email?: string | null };
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
  /** The quote's updatedAt the sender was shown — a version they didn't see is refused (first send and re-send). */
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

/** How the email left: through the sender's Gmail, locally only (no Gmail
 *  connection / bridge off), or `failed` — connected, but Gmail didn't take it. */
export type EmailDelivery = "gmail" | "local" | "failed";

export type EstimateEmailDeps = {
  now: () => number;
  getQuote: (id: string) => Promise<Quote | null>;
  /** A stored quote PDF's bytes (estimatePdfPath); null = not readable. */
  readPdf: (path: string) => Promise<Buffer | null>;
  /** The cover, rendered now; throws EstimateEmailError with the reason. */
  renderCoverPdf: (q: Quote) => Promise<Buffer>;
  /** Take the quote's one in-flight send (Quote.emailSending). */
  claimSend: (id: string, by: string, now: number) => Promise<{ ok: true; claim: EstimateEmailClaim } | { ok: false; reason: "busy" | "gone" }>;
  releaseSend: (id: string, claim: EstimateEmailClaim) => Promise<void>;
  /** The sender's signature, applied as the Inbox applies it at send. */
  applySignature: (body: string, actor: SendActor) => Promise<string>;
  sendQuote: (id: string, actor: SendActor, asOf?: number) => Promise<ReviewOpResult>;
  /** The absolute client-link URL; throws EstimateEmailError when refused. */
  ensureLink: (id: string) => Promise<string>;
  createAndSendThread: (spec: ThreadSpec) => Promise<{ threadId: string; delivery: EmailDelivery }>;
  createDraftThread: (spec: ThreadSpec) => Promise<{ threadId: string }>;
  recordEmail: (id: string, entry: EstimateEmailEntry) => Promise<boolean>;
  addFollowUpTask: (spec: FollowUpSpec, actor: SendActor) => Promise<unknown>;
  /** Active team members — the Lead estimator lookup. */
  roster: () => Promise<RosterUser[]>;
};

export type SendEstimateResult =
  | { ok: true; threadId: string; delivery: "gmail" | "local"; status: QuoteStatus; warning?: string }
  | { ok: false; error: string; markedSent?: boolean; href?: string };

export type OpenInInboxResult =
  | { ok: true; href: string; threadId: string; status: QuoteStatus; warning?: string }
  | { ok: false; error: string; markedSent?: boolean };

/** The Inbox composer opened on a draft (shared boxes are retired — the personal box). */
export function inboxDraftHref(threadId: string): string {
  return `/inbox?box=personal&folder=drafts&draft=${encodeURIComponent(threadId)}`;
}

/** The Inbox reader opened on a thread that has left Drafts. */
export function inboxThreadHref(threadId: string): string {
  return `/inbox?thread=${encodeURIComponent(threadId)}`;
}

/** The team download URL of one sent revision's PDF (api/quotes/[id]/pdf). */
export function revisionPdfHref(quoteId: string, rev: number): string {
  return `/api/quotes/${encodeURIComponent(quoteId)}/pdf?rev=${rev}&download=1`;
}

/** The thread's record link label: `<EST number> · <project name>`. */
export function estimateLinkLabel(q: Quote): string {
  const number = displayQuoteNumber(q);
  const name = String(q.name || "").trim();
  return name ? `${number} · ${name}` : number;
}

/**
 * Which stored PDF goes out. Once the quote has been sent, only the latest
 * sent revision's own copy — exactly what the customer was sent; null while
 * that copy isn't there yet ("being prepared"), never the current file (the
 * rule in quote-pdf/state.ts portalPdfSource). A quote never sent: its
 * current file (preflight requires it to be current).
 */
export function estimatePdfPath(q: Pick<Quote, "status" | "pdf" | "revisions">): string | null {
  if (q.status === "sent") {
    const rev = latestSentRevision(q.revisions);
    if (rev) return rev.pdfBlobPath || null;
  }
  return teamPdfPath(q, null);
}

/** Follow-up due: 11:59 PM Chicago on the day `days` days from `now`. */
export function followUpDueAt(now: number, days: number): number {
  return chicagoDayEnd(now + days * DAY_MS);
}

/** Step 1's output: the quote as read plus the cleaned fields. */
type Checked = {
  q: Quote;
  to: string;
  cc: string;
  subject: string;
  body: string;
};

type Prepared = Checked & {
  /** The estimate PDF (by reference once the revision is known): its file name and raw size. */
  estimate: { name: string; size: number } | null;
  cover: CommAttachment | null;
};

type Refusal = { ok: false; error: string };

function userMessage(e: unknown, fallback: string): string {
  return e instanceof EstimateEmailError ? e.message : fallback;
}

/** Step 1: the cheap preflight — one quote read, no file read, no render.
 *  Run before the claim and again under it. Nothing is written. */
async function preflight(
  deps: EstimateEmailDeps,
  actor: SendActor,
  quoteId: string,
  input: EstimateEmailInput,
  mode: "send" | "inbox",
  /** Under the claim: the quote just re-read (no second read). */
  reread?: Quote
): Promise<Checked | Refusal> {
  if (!can("send", actor.roles) && !can("approve", actor.roles)) return { ok: false, error: SEND_COPY.needsPerm };
  const id = String(quoteId || "");
  const q = reread ?? (id && id.length <= 64 ? await deps.getQuote(id) : null);
  if (!q) return { ok: false, error: SEND_COPY.gone };
  if (pdfKindForQuoteType(q.quoteType) !== "quote") return { ok: false, error: SEND_COPY.notEstimate };
  if (q.status !== "draft" && q.status !== "sent") return { ok: false, error: SEND_COPY.closed };
  // A re-send never reaches sendQuote's version check — the shown version is checked here for both.
  const asOf = input?.asOf;
  if (typeof asOf === "number" && asOf > 0 && q.updatedAt !== asOf) return { ok: false, error: SEND_COPY.changedSince };
  if (!pdfIsCurrent(q.pdf, q.contentChangedAt)) {
    return { ok: false, error: pdfView(q.pdf, deps.now())?.status === "pending" ? SEND_COPY.pdfRendering : SEND_COPY.pdfStale };
  }

  const rawTo = String(input?.to ?? "");
  const rawCc = String(input?.cc ?? "");
  if (rawTo.length + rawCc.length > RECIPIENTS_RAW_MAX) return { ok: false, error: SEND_COPY.tooManyRecipients };
  const to = parseRecipients(rawTo);
  if (!to.ok) return { ok: false, error: SEND_COPY.badTo(to.bad) };
  // Open in Inbox may leave To for the composer; a send needs one.
  if (mode === "send" && to.list.length === 0) return { ok: false, error: SEND_COPY.noTo };
  const ccParsed = parseRecipients(rawCc);
  if (!ccParsed.ok) return { ok: false, error: SEND_COPY.badCc(ccParsed.bad) };
  const cc = withoutAddresses(ccParsed.list, to.list);
  if (to.list.length + cc.length > RECIPIENTS_MAX) return { ok: false, error: SEND_COPY.tooManyRecipients };
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
  // A re-send whose sent revision has no PDF copy yet: never the current file.
  if (input?.attachEstimate === true && !estimatePdfPath(q)) return { ok: false, error: SEND_COPY.pdfPreparing };
  return { q, to: to.list.join(", "), cc: cc.join(", "), subject, body };
}

/** Step 2 (under the claim): the signature and the attachments. Reads only. */
async function attach(deps: EstimateEmailDeps, actor: SendActor, c: Checked, input: EstimateEmailInput, mode: "send" | "inbox"): Promise<Prepared | Refusal> {
  const { q } = c;
  let body = c.body;
  // The Inbox's own send rule (applyOutboundSignature). An Inbox draft is
  // left as written — the Inbox applies it when that draft is sent.
  if (mode === "send") {
    try {
      body = await deps.applySignature(body, actor);
    } catch (e) {
      console.error("[estimate-email] signature failed", e);
      return { ok: false, error: SEND_COPY.prepareFailed };
    }
  }

  // Step 2 — attachments, before anything is marked. The estimate's size is
  // checked against the cap before the cover is rendered at all.
  const number = displayQuoteNumber(q);
  let estimate: Prepared["estimate"] = null;
  let cover: CommAttachment | null = null;
  try {
    if (input.attachEstimate === true) {
      const path = estimatePdfPath(q);
      if (!path) return { ok: false, error: SEND_COPY.pdfPreparing };
      const bytes = await deps.readPdf(path);
      if (!bytes || !bytes.length) return { ok: false, error: SEND_COPY.pdfUnreadable };
      estimate = { name: pdfFileName(number, null), size: bytes.length };
      if (!attachmentsFit([estimate.size])) return { ok: false, error: SEND_COPY.tooLarge };
    }
    if (input.attachCover === true) {
      const bytes = await deps.renderCoverPdf(q);
      // The cover is rendered on demand and small: it rides as a data-URL.
      cover = { name: coverPdfFileName(number), mime: "application/pdf", size: bytes.length, dataUrl: "data:application/pdf;base64," + bytes.toString("base64") };
    }
  } catch (e) {
    if (!(e instanceof EstimateEmailError)) console.error("[estimate-email] attachments failed", e);
    return { ok: false, error: userMessage(e, SEND_COPY.attachFailed) };
  }
  if (!attachmentsFit([estimate?.size ?? 0, cover?.size ?? 0])) return { ok: false, error: SEND_COPY.tooLarge };

  return { ...c, body, estimate, cover };
}

/**
 * Steps 1–2 under the claim. The first preflight ran before the claim: run it
 * again on a fresh read (asOf, status, PDF-current — anything that changed
 * before the claim was taken) and require the status it saw (draft → first
 * send, sent → re-send). Then the slow work, then one more read: a quote
 * saved, recalled or closed during the render is refused, nothing marked.
 */
async function prepareClaimed(
  deps: EstimateEmailDeps,
  actor: SendActor,
  first: Checked,
  input: EstimateEmailInput,
  mode: "send" | "inbox"
): Promise<Prepared | Refusal> {
  const fresh = await deps.getQuote(first.q.id);
  if (!fresh) return { ok: false, error: SEND_COPY.gone };
  // Recalled, closed or sent by someone else since the first read.
  if (fresh.status !== first.q.status) return { ok: false, error: SEND_COPY.changedSince };
  const again = await preflight(deps, actor, first.q.id, input, mode, fresh);
  if ("ok" in again) return again;
  const p = await attach(deps, actor, again, input, mode);
  if ("ok" in p) return p;
  const now = await deps.getQuote(p.q.id);
  if (!now) return { ok: false, error: SEND_COPY.gone };
  if (now.status !== p.q.status || now.updatedAt !== p.q.updatedAt) return { ok: false, error: SEND_COPY.changedSince };
  return p;
}

type Linked = { ok: true; markedSent: boolean; url: string; q: Quote; rev: QuoteRevision };

/** Steps 3–4: mark sent (draft only) and mint the link. */
async function markAndLink(
  deps: EstimateEmailDeps,
  actor: SendActor,
  p: Prepared,
  asOf: number | undefined
): Promise<Linked | { ok: false; error: string; markedSent: boolean }> {
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
  let linked: Linked;
  try {
    const url = await deps.ensureLink(p.q.id);
    const fresh = markedSent ? (await deps.getQuote(p.q.id)) ?? p.q : p.q;
    const rev = latestSentRevision(fresh.revisions);
    if (!rev || typeof rev.rev !== "number") throw new Error("no sent revision after send");
    linked = { ok: true, markedSent, url, q: fresh, rev };
  } catch (e) {
    if (!(e instanceof EstimateEmailError)) console.error("[estimate-email] client link failed", e);
    // No thread exists yet — nothing to open in Inbox.
    return { ok: false, error: markedSent ? SEND_COPY.partialNoThread : userMessage(e, SEND_COPY.notSent), markedSent };
  }
  // The estimate goes out as the sent revision's own copy (by reference).
  if (p.estimate && !linked.rev.pdfBlobPath) {
    console.error("[estimate-email] the sent revision has no PDF copy", p.q.id, linked.rev.rev);
    return { ok: false, error: markedSent ? SEND_COPY.partialNoThread : SEND_COPY.pdfPreparing, markedSent };
  }
  return linked;
}

function attachmentsFor(p: Prepared, m: Linked): CommAttachment[] {
  const out: CommAttachment[] = [];
  if (p.estimate && m.rev.pdfBlobPath) {
    out.push({
      name: p.estimate.name,
      mime: "application/pdf",
      size: p.estimate.size,
      pdfPath: m.rev.pdfBlobPath,
      href: revisionPdfHref(m.q.id, m.rev.rev),
    });
  }
  if (p.cover) out.push(p.cover);
  return out;
}

function threadSpecFor(actor: SendActor, p: Prepared, m: Linked): ThreadSpec {
  const q = m.q;
  return {
    mailboxUser: actor.name,
    customerId: q.customerId ?? null,
    customer: q.customer || "",
    contactName: q.contactName || "",
    to: p.to,
    cc: p.cc,
    subject: p.subject,
    body: bodyWithLink(p.body, m.url),
    link: { type: "quote", id: q.id, label: estimateLinkLabel(q) },
    attachments: attachmentsFor(p, m),
  };
}

/** Take the one in-flight send, run `work`, always release. */
async function withClaim<T extends { ok: boolean }>(
  deps: EstimateEmailDeps,
  actor: SendActor,
  quoteId: string,
  work: () => Promise<T>
): Promise<T | Refusal> {
  let claim: EstimateEmailClaim;
  try {
    const c = await deps.claimSend(quoteId, actor.name, deps.now());
    if (!c.ok) return { ok: false, error: c.reason === "busy" ? SEND_COPY.inProgress : SEND_COPY.gone };
    claim = c.claim;
  } catch (e) {
    console.error("[estimate-email] claim failed", e);
    return { ok: false, error: SEND_COPY.claimFailed };
  }
  try {
    return await work();
  } finally {
    try {
      await deps.releaseSend(quoteId, claim);
    } catch (e) {
      // It expires on its own (ESTIMATE_EMAIL_CLAIM_MS).
      console.error("[estimate-email] releasing the send claim failed", e);
    }
  }
}

/** §10.1 — Send & mark sent → / Send email →. */
export async function sendEstimateEmail(
  deps: EstimateEmailDeps,
  actor: SendActor,
  quoteId: string,
  input: EstimateEmailInput
): Promise<SendEstimateResult> {
  const c = await preflight(deps, actor, quoteId, input, "send");
  if ("ok" in c) return c;
  return withClaim(deps, actor, c.q.id, async () => {
    const p = await prepareClaimed(deps, actor, c, input, "send");
    return "ok" in p ? p : sendClaimed(deps, actor, p, input);
  });
}

async function sendClaimed(deps: EstimateEmailDeps, actor: SendActor, p: Prepared, input: EstimateEmailInput): Promise<SendEstimateResult> {
  const m = await markAndLink(deps, actor, p, input.asOf);
  if (!m.ok) return { ok: false, error: m.error, ...(m.markedSent ? { markedSent: true } : {}) };
  const { q, markedSent } = m;
  const rev = m.rev.rev;

  // Step 5 — the email.
  let sent: { threadId: string; delivery: EmailDelivery };
  try {
    sent = await deps.createAndSendThread(threadSpecFor(actor, p, m));
  } catch (e) {
    console.error("[estimate-email] send failed", e);
    const threadId = e instanceof EstimateEmailError ? e.threadId : undefined;
    const stillDraft = e instanceof EstimateEmailError ? e.stillDraft !== false : true;
    return {
      ok: false,
      error: markedSent ? (threadId ? SEND_COPY.partial : SEND_COPY.partialNoThread) : SEND_COPY.notSent,
      ...(markedSent ? { markedSent: true } : {}),
      ...(threadId ? { href: stillDraft ? inboxDraftHref(threadId) : inboxThreadHref(threadId) } : {}),
    };
  }
  // Connected, but Gmail didn't take it: not ok, no follow-up task — but the
  // thread IS recorded, so the estimate's Activity shows it (and reads as
  // delivered once the bridge later pushes it). A failed record only logs.
  if (sent.delivery !== "gmail" && sent.delivery !== "local") {
    try {
      if (!(await deps.recordEmail(q.id, { threadId: sent.threadId, rev, at: deps.now(), by: actor.name, to: p.to }))) {
        console.error("[estimate-email] recording a Gmail-refused send wrote nothing", q.id, sent.threadId);
      }
    } catch (e) {
      console.error("[estimate-email] record failed (Gmail-refused send)", e);
    }
    return {
      ok: false,
      error: markedSent ? SEND_COPY.gmailFailed : SEND_COPY.gmailFailedResend,
      ...(markedSent ? { markedSent: true } : {}),
      href: inboxThreadHref(sent.threadId),
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
    delivery: sent.delivery,
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
  const c = await preflight(deps, actor, quoteId, input, "inbox");
  if ("ok" in c) return c;
  return withClaim(deps, actor, c.q.id, async () => {
    const p = await prepareClaimed(deps, actor, c, input, "inbox");
    return "ok" in p ? p : openClaimed(deps, actor, p, input);
  });
}

async function openClaimed(deps: EstimateEmailDeps, actor: SendActor, p: Prepared, input: EstimateEmailInput): Promise<OpenInInboxResult> {
  const m = await markAndLink(deps, actor, p, input.asOf);
  if (!m.ok) {
    const error = m.markedSent ? SEND_COPY.inboxPartial : m.error;
    return { ok: false, error, ...(m.markedSent ? { markedSent: true } : {}) };
  }
  const { q, markedSent } = m;
  let threadId: string;
  try {
    threadId = (await deps.createDraftThread(threadSpecFor(actor, p, m))).threadId;
  } catch (e) {
    console.error("[estimate-email] inbox draft failed", e);
    return { ok: false, error: markedSent ? SEND_COPY.inboxPartial : SEND_COPY.inboxFailed, ...(markedSent ? { markedSent: true } : {}) };
  }
  let warning: string | undefined;
  try {
    if (!(await deps.recordEmail(q.id, { threadId, rev: m.rev.rev, at: deps.now(), by: actor.name, to: p.to }))) warning = SEND_COPY.recordFailed;
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
    readPdf: async (path) => {
      const store = pdfStorage();
      if ("unavailable" in store) return null;
      return store.read(path);
    },
    renderCoverPdf: async (q) => {
      const r = await renderCoverPdfLive(q.id, opts.host, opts.proto);
      if (!r.ok) throw new EstimateEmailError(r.error);
      return r.pdf;
    },
    claimSend: (id, by, now) => claimEstimateEmailSend(id, by, now),
    releaseSend: (id, claim) => releaseEstimateEmailSend(id, claim),
    applySignature: applySenderSignature,
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
      const connected = await gmailConnectedFor(opts.actor.id);
      const draft = await saveDraft({ ...draftInput(spec), me: spec.mailboxUser });
      try {
        const sent = await sendDraft(draft.id, spec.mailboxUser, { stampAddresses: true });
        if (!sent) throw new Error("the draft vanished before it was sent");
      } catch (e) {
        console.error("[estimate-email] sendDraft failed", e);
        const t = await getThread(draft.id).catch(() => null);
        throw t ? new EstimateEmailError(SEND_COPY.notSent, draft.id, t.status === "draft") : new EstimateEmailError(SEND_COPY.notSent);
      }
      // addMessage awaits the bridge's dispatch, so a Gmail send has stamped its gmailId by now.
      return { threadId: draft.id, delivery: deliveryOfThread(await getThread(draft.id), connected) };
    },
    createDraftThread: async (spec) => ({ threadId: (await saveDraft({ ...draftInput(spec), me: spec.mailboxUser })).id }),
    recordEmail: recordEstimateEmail,
    addFollowUpTask: (spec, actor) => createTask(spec, { id: actor.id, name: actor.name }),
    roster: async () => (await activeUsers()).map((u) => ({ id: u.id, name: u.name, status: u.status })),
  };
}

/** The Inbox's own outbound-signature rule, for the sender: a #127 signature
 *  means the composer handled it (seeded by the defaults, kept or removed by
 *  the sender); none → the legacy footer from the sender's profile
 *  (inbox/actions composeSendAction). Shared by the send and the inline reply. */
export async function applySenderSignature(body: string, actor: SendActor): Promise<string> {
  const [signature, profile] = await Promise.all([signatureFor(actor.name), getUser(actor.id)]);
  return applyOutboundSignature(body, !!signature, profile || { name: actor.name, email: actor.email ?? null });
}

/** Can Gmail be involved in this sender's mail at all? "local" only when the
 *  bridge is off or the sender has no connection; an unknown lookup counts as
 *  connected — a missing gmailId then reads as failed, never "local". */
export async function gmailConnectedFor(userId: string): Promise<boolean> {
  try {
    return gmailEnabled() && !!(await getConnectionInfo(personalKey(userId)));
  } catch (e) {
    console.error("[estimate-email] gmail connection lookup failed", e);
    return true;
  }
}

/** How a thread's latest outbound message left: not connected → local; else
 *  the bridge stamped a gmailId (gmail) or it didn't (failed). */
export function deliveryOfThread(t: { messages?: Array<{ direction?: string; gmailId?: string }> } | null | undefined, connected: boolean): EmailDelivery {
  if (!connected) return "local";
  const outs = (t?.messages || []).filter((x) => x.direction === "out");
  return outs[outs.length - 1]?.gmailId ? "gmail" : "failed";
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
