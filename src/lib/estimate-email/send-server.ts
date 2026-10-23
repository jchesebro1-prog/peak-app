import { displayQuoteNumber } from "@/lib/estimate-number";
import { renderCoverPdf as renderCoverPdfLive } from "@/lib/estimate-output/cover-pdf-server";
import { coverPdfFileName } from "@/lib/estimate-output/cover";
import { chicagoDayEnd, leadEstimator } from "@/lib/estimate-output/responses";
import { pdfStorage } from "@/lib/quote-pdf/storage";
import { applyOutboundSignature } from "@/lib/email-signature";
import { gmailEnabled, personalKey } from "@/lib/gmail/config";
import { getConnectionInfo } from "@/lib/gmail/connections";
import { latestSentRevision, pdfFileName, pdfIsCurrent, pdfKindForQuoteType, pdfStoragePath, pdfView, teamPdfPath } from "@/lib/quote-pdf/state";
import { bidderLinkPath, ensureShareLink } from "@/lib/quote-share/links";
import { sendQuoteToCustomer, type ReviewOpResult } from "@/lib/quote-review-ops";
import { findDraftByLink, get as getThread, holdLastOutbound, saveDraft, sendDraft, type CommAttachment, type CommLink } from "@/lib/stores/comms";
import {
  claimEstimateEmailSend, get as getQuoteLive, recordEstimateEmail, releaseEstimateEmailSend,
  type EstimateEmailClaim, type EstimateEmailEntry, type Quote, type QuoteRevision, type QuoteStatus,
} from "@/lib/stores/quotes";
import { signatureFor } from "@/lib/stores/signatures";
import { createTask } from "@/lib/stores/tasks";
import { can } from "@/lib/team";
import { activeUsers, getUser } from "@/lib/users";
import { attachmentsFit, bodyWithLink, coverPdfHref, estimateDraftIsCurrent, FOLLOW_UP_CHOICES, parseRecipients, withoutAddresses } from "./compose";
import { mailboxViewer } from "@/lib/mailbox-viewer";
import type { SpecSection } from "@/app/(app)/estimator/types";
import { boxSaleOf, boxSaleSaveProblem } from "@/lib/estimate-box-sale/rules";
import { getCompany } from "@/lib/identity/companies";
import { bidderPdfFileName } from "@/lib/parties/addressee";
import { bidderPartyFor, bidderRecipient } from "@/lib/parties/addressee-server";
import { addendaSinceRow, bidderAlreadyHas, bidderPdfRev, bidderSubject, BID_SEND_COPY, isPartyId, latestSentRev } from "@/lib/parties/bid-send";
import type { BidderState } from "@/lib/parties/rules";
import { renderBidderPdf as renderBidderPdfLive } from "@/lib/quote-pdf/bidder-pdf-server";
import { markBidderSendFailed, recordBidderSend as recordBidderSendLive } from "@/lib/stores/bids";

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
 * Final review: an email that didn't go out through Gmail (local, refused,
 * or no answer in time — "unknown", which Gmail may have accepted) is held
 * back from every later send on the thread (`noAutoRetry`), so a reply can
 * never silently push it with its PDF. The cover PDF rides by reference too
 * (stored under the quote's own folder; a data-URL only when storage fails).
 * Open in Inbox reuses the sender's own still-current draft for the quote.
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
  gmailFailed: "Marked sent, but Gmail didn’t accept the email — send it again from here.",
  gmailFailedResend: "Gmail didn’t accept the email — send it again from here.",
  /** Gmail didn't answer in time: it may have been accepted — never resend blind. */
  gmailUnknown: "Marked sent, but Gmail didn’t answer in time — check your Gmail Sent folder before sending again.",
  gmailUnknownResend: "Gmail didn’t answer in time — check your Gmail Sent folder before sending again.",
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
  /** Internal (sendBidderEmail only; the actions' cleanInput never sets it): the bidder's own PDF rides instead, so
   *  a box sale's "estimate PDF always attached" rule does not apply. */
  forBidder?: boolean;
};

/** Box goods sale (spec 2026-10-21): the quote PDF always goes with the email, whatever a stale composer posts. */
const wantsEstimatePdf = (q: Quote, input: EstimateEmailInput): boolean => input?.attachEstimate === true || (!input?.forBidder && boxSaleOf(q));

export type ThreadSpec = {
  mailboxUser: string;
  /** #349 — the sender's users.id: the thread's owner (identity, never the name). */
  mailboxOwnerId: string;
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
 *  connection / bridge off), `failed` — connected, but Gmail refused it — or
 *  `unknown` — Gmail didn't answer in time (it may have been accepted). */
export type EmailDelivery = "gmail" | "local" | "failed" | "unknown";

/** An unsent Inbox draft linked to the quote, in the sender's own mailbox. */
export type InboxDraftRef = { threadId: string; createdAt: number; attachments: Array<{ pdfPath?: string }> };

export type EstimateEmailDeps = {
  now: () => number;
  getQuote: (id: string) => Promise<Quote | null>;
  /** A stored quote PDF's bytes (estimatePdfPath); null = not readable. */
  readPdf: (path: string) => Promise<Buffer | null>;
  /** The cover, rendered now; throws EstimateEmailError with the reason. */
  renderCoverPdf: (q: Quote) => Promise<Buffer>;
  /** Keep the rendered cover in PDF storage (`quote-pdfs/<id>/cover-<now>.pdf`);
   *  the stored path, or null when storage is unavailable / the write failed. */
  storeCover: (quoteId: string, bytes: Buffer, now: number) => Promise<string | null>;
  /** The sender's newest unsent Inbox draft linked to this quote (Open in Inbox reuses it). */
  findInboxDraft: (quoteId: string, owner: { id: string; name: string }) => Promise<InboxDraftRef | null>;
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
  | { ok: true; href: string; threadId: string; status: QuoteStatus; warning?: string; reused?: true }
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
  /** The rendered cover — stored (by reference) just before the thread is made. */
  cover: { name: string; bytes: Buffer } | null;
  /** #348 2b-ii — the bidder's own PDF (bidder mode only): its bytes and the sent revision it was rendered at (null = live draft). */
  bidderPdf?: { bytes: Buffer; rev: number | null };
};

/** `scope: "row"` (#348 2b-ii) — a refusal that belongs to one bidder row, not the whole quote. */
type Refusal = { ok: false; error: string; scope?: "row" };

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
  // Box goods sale (spec 2026-10-21): equipment + freight only. Labor can still sit on one (a restored revision, a
  // move into it from before the rule) — it is never sent, by any path: send, Open in Inbox or a bidder send.
  const boxProblem = boxSaleSaveProblem(boxSaleOf(q), (q.spec as { sections?: SpecSection[] } | null | undefined)?.sections);
  if (boxProblem) return { ok: false, error: boxProblem };
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
  if (wantsEstimatePdf(q, input) && !estimatePdfPath(q)) return { ok: false, error: SEND_COPY.pdfPreparing };
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
  let cover: Prepared["cover"] = null;
  try {
    if (wantsEstimatePdf(q, input)) {
      const path = estimatePdfPath(q);
      if (!path) return { ok: false, error: SEND_COPY.pdfPreparing };
      // The PDF state stores no size, so the file is read to size it (and to
      // prove it is readable before anything is marked).
      const bytes = await deps.readPdf(path);
      if (!bytes || !bytes.length) return { ok: false, error: SEND_COPY.pdfUnreadable };
      estimate = { name: pdfFileName(number, null), size: bytes.length };
      if (!attachmentsFit([estimate.size])) return { ok: false, error: SEND_COPY.tooLarge };
    }
    // Box goods sale (spec 2026-10-21): never a cover, whatever a stale composer posts.
    if (input.attachCover === true && !boxSaleOf(q)) {
      const bytes = await deps.renderCoverPdf(q);
      cover = { name: coverPdfFileName(number), bytes };
    }
  } catch (e) {
    if (!(e instanceof EstimateEmailError)) console.error("[estimate-email] attachments failed", e);
    return { ok: false, error: userMessage(e, SEND_COPY.attachFailed) };
  }
  if (!attachmentsFit([estimate?.size ?? 0, cover?.bytes.length ?? 0])) return { ok: false, error: SEND_COPY.tooLarge };

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
  mode: "send" | "inbox",
  /** #348 2b-ii — more slow work after the attachments, before the final re-read (the bidder PDF render). */
  more?: (p: Prepared) => Promise<Prepared | Refusal>
): Promise<Prepared | Refusal> {
  const fresh = await deps.getQuote(first.q.id);
  if (!fresh) return { ok: false, error: SEND_COPY.gone };
  // Recalled, closed or sent by someone else since the first read.
  if (fresh.status !== first.q.status) return { ok: false, error: SEND_COPY.changedSince };
  const again = await preflight(deps, actor, first.q.id, input, mode, fresh);
  if ("ok" in again) return again;
  let p = await attach(deps, actor, again, input, mode);
  if ("ok" in p) return p;
  if (more) {
    p = await more(p);
    if ("ok" in p) return p;
  }
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
  asOf: number | undefined,
  /** #348 2b-ii — mint the link from the fresh quote + its sent revision (a bidder's v3) instead of ensureLink. */
  linkFor?: (q: Quote, rev: QuoteRevision) => Promise<string>
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
    if (linkFor) {
      // Bidder mode: always re-read — a revision cut during the render must be seen (the caller's revision guard).
      const fresh = (await deps.getQuote(p.q.id)) ?? p.q;
      const rev = latestSentRevision(fresh.revisions);
      if (!rev || typeof rev.rev !== "number") throw new Error("no sent revision after send");
      linked = { ok: true, markedSent, url: await linkFor(fresh, rev), q: fresh, rev };
    } else {
      const url = await deps.ensureLink(p.q.id);
      const fresh = markedSent ? (await deps.getQuote(p.q.id)) ?? p.q : p.q;
      const rev = latestSentRevision(fresh.revisions);
      if (!rev || typeof rev.rev !== "number") throw new Error("no sent revision after send");
      linked = { ok: true, markedSent, url, q: fresh, rev };
    }
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

/** The thread's attachments: the estimate (the sent revision's copy) and the
 *  cover, both by reference. The cover is stored now — only once the email is
 *  certain to be made — and rides as a data-URL only when storing it fails. */
async function attachmentsFor(deps: EstimateEmailDeps, p: Prepared, m: Linked): Promise<CommAttachment[]> {
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
  if (p.cover) {
    const { name, bytes } = p.cover;
    let path: string | null = null;
    try {
      path = await deps.storeCover(m.q.id, bytes, deps.now());
    } catch (e) {
      console.error("[estimate-email] storing the cover failed — attaching it inline", e);
    }
    out.push(
      path
        ? { name, mime: "application/pdf", size: bytes.length, pdfPath: path, href: coverPdfHref(m.q.id, path) }
        : { name, mime: "application/pdf", size: bytes.length, dataUrl: "data:application/pdf;base64," + bytes.toString("base64") }
    );
  }
  return out;
}

async function threadSpecFor(deps: EstimateEmailDeps, actor: SendActor, p: Prepared, m: Linked): Promise<ThreadSpec> {
  const q = m.q;
  return {
    mailboxUser: actor.name,
    mailboxOwnerId: actor.id,
    customerId: q.customerId ?? null,
    customer: q.customer || "",
    contactName: q.contactName || "",
    to: p.to,
    cc: p.cc,
    subject: p.subject,
    body: bodyWithLink(p.body, m.url),
    link: { type: "quote", id: q.id, label: estimateLinkLabel(q) },
    attachments: await attachmentsFor(deps, p, m),
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
    sent = await deps.createAndSendThread(await threadSpecFor(deps, actor, p, m));
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
  // Connected, but Gmail refused it or didn't answer (it may have been
  // accepted): not ok, no follow-up task — but the thread IS recorded, so the
  // estimate's Activity shows it with that state. The message is held back
  // (noAutoRetry) — nothing ever re-sends it on its own. A failed record only logs.
  if (sent.delivery !== "gmail" && sent.delivery !== "local") {
    try {
      if (!(await deps.recordEmail(q.id, { threadId: sent.threadId, rev, at: deps.now(), by: actor.name, to: p.to }))) {
        console.error("[estimate-email] recording an undelivered send wrote nothing", q.id, sent.threadId, sent.delivery);
      }
    } catch (e) {
      console.error("[estimate-email] record failed (undelivered send)", e);
    }
    const unknown = sent.delivery === "unknown";
    return {
      ok: false,
      error: markedSent ? (unknown ? SEND_COPY.gmailUnknown : SEND_COPY.gmailFailed) : unknown ? SEND_COPY.gmailUnknownResend : SEND_COPY.gmailFailedResend,
      // No Inbox link: the Inbox can't resend it — the Activity card shows the thread.
      ...(markedSent ? { markedSent: true } : {}),
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
    const reused = await reuseInboxDraft(deps, actor, c.q.id);
    if (reused) return reused;
    const p = await prepareClaimed(deps, actor, c, input, "inbox");
    return "ok" in p ? p : openClaimed(deps, actor, p, input);
  });
}

/**
 * Final review (I3b) — the sender's own unsent draft for this quote, when it
 * still matches the quote (estimateDraftIsCurrent, made at or after the
 * latest sent revision): Open in Inbox opens it again instead of making (and
 * recording) another. Under the claim; a failed lookup just makes a new one.
 */
async function reuseInboxDraft(deps: EstimateEmailDeps, actor: SendActor, quoteId: string): Promise<OpenInInboxResult | null> {
  try {
    const d = await deps.findInboxDraft(quoteId, { id: actor.id, name: actor.name });
    if (!d) return null;
    const q = await deps.getQuote(quoteId);
    const rev = q ? latestSentRevision(q.revisions) : null;
    if (!q || !rev || !estimateDraftIsCurrent(q, d.attachments) || !(Number(d.createdAt) >= (Number(rev.at) || 0))) return null;
    return { ok: true, href: inboxDraftHref(d.threadId), threadId: d.threadId, status: q.status, reused: true };
  } catch (e) {
    console.error("[estimate-email] looking up an open Inbox draft failed", e);
    return null;
  }
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
    threadId = (await deps.createDraftThread(await threadSpecFor(deps, actor, p, m))).threadId;
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

/* ---- #348 2b-ii — send to ONE bidder through the same ordered pipeline ---- */

/** One GC/EC bidder row on the quote and who its email goes to. */
export type BidderTarget = { partyId: string; companyId: string; companyName: string; contactName: string; email: string; bid: BidderState };
export type BidderEmailInput = { subject: string; body: string; asOf?: number; retryUnknown?: boolean };
export type BidderRenderResult = { ok: true; pdf: Buffer } | { ok: false; error: string; scope: "quote" | "row" };

export type BidderEmailDeps = EstimateEmailDeps & {
  /** The live bidder row on THIS quote (with its recipient), or null. */
  getBidder: (quoteId: string, partyId: string) => Promise<BidderTarget | null>;
  /** The bidder's PDF — at a sent revision, or live (null) on a draft. */
  renderBidderPdf: (q: Quote, partyId: string, rev: number | null) => Promise<BidderRenderResult>;
  /** Keep the bidder copy in PDF storage; the stored path, or null when storage is unavailable / failed. */
  storeBidderPdf: (quoteId: string, partyId: string, rev: number, bytes: Buffer, now: number) => Promise<string | null>;
  /** The bidder's absolute v3 link at `rev`; throws EstimateEmailError when refused. */
  bidderLink: (quoteId: string, partyId: string, rev: number) => Promise<string>;
  recordBidderSend: (
    quoteId: string,
    partyId: string,
    entry: EstimateEmailEntry,
    outcome: { kind: "sent" } | { kind: "failed"; error: string; unknown?: boolean },
    by: string
  ) => Promise<boolean>;
  markBidderFailed: (quoteId: string, partyId: string, f: { at: number; error: string; unknown?: boolean; threadId?: string }) => Promise<boolean>;
};

export type BidderSendResult =
  | { ok: true; partyId: string; threadId: string; delivery: "gmail" | "local"; rev: number; status: QuoteStatus; warning?: string }
  | { ok: true; partyId: string; skipped: true; rev: number }
  | { ok: false; partyId: string; error: string; scope: "quote" | "row"; markedSent?: boolean };

type BidderFail = Extract<BidderSendResult, { ok: false }>;

/** The largest bidder PDF that may ride inline (base64 in the thread) when PDF storage is unavailable. */
const BIDDER_INLINE_MAX = 4 * 1024 * 1024;

/** The row's own refusals — no stamp, no claim. */
function bidderRowRefusal(t: BidderTarget | null, input: BidderEmailInput): string | null {
  if (!t) return BID_SEND_COPY.gone;
  if (t.bid.result !== "pending") return BID_SEND_COPY.notPending;
  if (t.bid.submitVia === "website") return BID_SEND_COPY.website;
  if (!String(t.email || "").trim()) return BID_SEND_COPY.noEmail(t.contactName || t.companyName);
  if (!parseRecipients(t.email).ok) return BID_SEND_COPY.badEmail(t.contactName || t.companyName);
  if (t.bid.failed?.unknown && input.retryUnknown !== true) return BID_SEND_COPY.unknownRetry;
  return null;
}

/**
 * #348 2b-ii — email the estimate to ONE bidder. The customer pipeline's own steps, in its own order (preflight →
 * claim → preflight again → attachments [+ the bidder PDF render] → re-read → mark sent (draft only) → link →
 * thread → record), with four differences: the recipient (the bidder's addressee contact), the attachment (the
 * bidder's own PDF, stored by reference), the link (the bidder's v3 at the sent revision) and the record (the
 * bidder row + the estimate's Activity, via recordBidderSend). No follow-up task, no cover, no Cc. Never holds the
 * quote row lock — only the store-owned send claim — across the render or Gmail.
 */
export async function sendBidderEmail(
  deps: BidderEmailDeps,
  actor: SendActor,
  quoteId: string,
  partyId: string,
  input: BidderEmailInput
): Promise<BidderSendResult> {
  const row = (error: string): BidderFail => ({ ok: false, partyId, error, scope: "row" });
  const whole = (error: string, markedSent?: boolean): BidderFail => ({ ok: false, partyId, error, scope: "quote", ...(markedSent ? { markedSent: true } : {}) });
  // No bidder row is read for someone who can't send at all.
  if (!can("send", actor.roles) && !can("approve", actor.roles)) return whole(SEND_COPY.needsPerm);
  if (!isPartyId(partyId)) return row(BID_SEND_COPY.gone);
  const t0 = await deps.getBidder(quoteId, partyId);
  const r0 = bidderRowRefusal(t0, input);
  if (r0 || !t0) return row(r0 ?? BID_SEND_COPY.gone);

  const est: EstimateEmailInput = {
    to: t0.email, cc: "", subject: input.subject, body: input.body, attachEstimate: false, attachCover: false, followUpDays: 0, asOf: input.asOf, forBidder: true,
  };
  const c = await preflight(deps, actor, quoteId, est, "send");
  if ("ok" in c) return whole(c.error);
  if (bidderAlreadyHas(c.q, t0.bid)) return { ok: true, partyId, skipped: true, rev: latestSentRev(c.q) ?? 0 };

  const r = await withClaim(deps, actor, c.q.id, async (): Promise<BidderSendResult> => {
    // The idempotency point: a double click or a second tab sees the first send's stamp here.
    const t = await deps.getBidder(quoteId, partyId);
    const rr = bidderRowRefusal(t, input);
    if (rr || !t) return row(rr ?? BID_SEND_COPY.gone);
    const fq = (await deps.getQuote(c.q.id)) ?? c.q;
    if (bidderAlreadyHas(fq, t.bid)) return { ok: true, partyId, skipped: true, rev: latestSentRev(fq) ?? 0 };

    // The recipient is the claim-time re-read's, so the email and the stamp agree.
    const p = await prepareClaimed(deps, actor, c, { ...est, to: t.email }, "send", async (pp) => {
      const rev = bidderPdfRev(pp.q);
      const rendered = await deps.renderBidderPdf(pp.q, partyId, rev);
      if (!rendered.ok) return { ok: false, error: rendered.error, ...(rendered.scope === "row" ? { scope: "row" as const } : {}) };
      if (!attachmentsFit([rendered.pdf.length])) return { ok: false, error: BID_SEND_COPY.tooLarge };
      return { ...pp, bidderPdf: { bytes: rendered.pdf, rev } };
    });
    if ("ok" in p) {
      if (p.scope !== "row") return whole(p.error);
      try {
        await deps.markBidderFailed(quoteId, partyId, { at: deps.now(), error: p.error });
      } catch (e) {
        console.error("[estimate-email] stamping the bidder failure failed", e);
      }
      return row(p.error);
    }
    return sendBidderClaimed(deps, actor, partyId, t, p, input);
  });
  // The claim's own refusals (busy, gone, failed) carry no partyId: they belong to the quote.
  return "partyId" in r ? r : whole(r.error);
}

async function sendBidderClaimed(
  deps: BidderEmailDeps,
  actor: SendActor,
  partyId: string,
  t: BidderTarget,
  p: Prepared,
  input: BidderEmailInput
): Promise<BidderSendResult> {
  const quoteId = p.q.id;
  const whole = (error: string, markedSent?: boolean): BidderFail => ({ ok: false, partyId, error, scope: "quote", ...(markedSent ? { markedSent: true } : {}) });
  const pdf = p.bidderPdf;
  if (!pdf) return whole(SEND_COPY.prepareFailed);
  let bidderGone = false;
  const m = await markAndLink(deps, actor, p, input.asOf ?? p.q.updatedAt, async (q, rev) => {
    // A sent revision cut during the render (e.g. a portal price refresh): the PDF is of an older one — mint no link, email nothing.
    if (pdf.rev !== null && rev.rev !== pdf.rev) throw new EstimateEmailError(SEND_COPY.changedSince);
    try {
      return await deps.bidderLink(q.id, partyId, rev.rev);
    } catch (e) {
      // The bidder was removed between the claim and the link: this row's problem, not the quote's.
      if (e instanceof EstimateEmailError && e.message === BID_SEND_COPY.gone) bidderGone = true;
      throw e;
    }
  });
  if (!m.ok) {
    if (bidderGone) return { ok: false, partyId, error: BID_SEND_COPY.gone, scope: "row", ...(m.markedSent ? { markedSent: true } : {}) };
    return whole(m.error, m.markedSent);
  }
  const { q, markedSent } = m;
  const rev = m.rev.rev;

  // The bidder's own copy, stored now (only once the email is certain to be made); inline only when storing fails.
  const name = bidderPdfFileName(q.name, t.companyName, rev);
  let path: string | null = null;
  try {
    path = await deps.storeBidderPdf(q.id, partyId, rev, pdf.bytes, deps.now());
  } catch (e) {
    console.error("[estimate-email] storing the bidder PDF failed — attaching it inline", e);
  }
  if (!path && pdf.bytes.length > BIDDER_INLINE_MAX) return whole(BID_SEND_COPY.tooLarge, markedSent);
  const att: CommAttachment = path
    ? { name, mime: "application/pdf", size: pdf.bytes.length, pdfPath: path, href: coverPdfHref(q.id, path) }
    : { name, mime: "application/pdf", size: pdf.bytes.length, dataUrl: "data:application/pdf;base64," + pdf.bytes.toString("base64") };
  const spec: ThreadSpec = {
    ...(await threadSpecFor(deps, actor, p, m)),
    customerId: t.companyId,
    customer: t.companyName,
    contactName: t.contactName,
    subject: bidderSubject(p.subject, (q.name || "").trim() || displayQuoteNumber(q), addendaSinceRow(q, t.bid)),
    attachments: [att],
  };

  let sent: { threadId: string; delivery: EmailDelivery };
  try {
    sent = await deps.createAndSendThread(spec);
  } catch (e) {
    console.error("[estimate-email] bidder send failed", e);
    const threadId = e instanceof EstimateEmailError ? e.threadId : undefined;
    // The thread is no longer a draft: the send may have left Gmail — never a blind retry.
    const mayHaveSent = !!threadId && e instanceof EstimateEmailError && e.stillDraft === false;
    const error = mayHaveSent ? SEND_COPY.gmailUnknownResend : SEND_COPY.notSent;
    try {
      await deps.markBidderFailed(quoteId, partyId, { at: deps.now(), error, ...(mayHaveSent ? { unknown: true } : {}), ...(threadId ? { threadId } : {}) });
    } catch (e2) {
      console.error("[estimate-email] stamping the bidder failure failed", e2);
    }
    return { ok: false, partyId, error, scope: "row", ...(markedSent ? { markedSent: true } : {}) };
  }
  const entry: EstimateEmailEntry = { threadId: sent.threadId, rev, at: deps.now(), by: actor.name, to: t.email };
  if (sent.delivery !== "gmail" && sent.delivery !== "local") {
    // Gmail refused it or didn't answer (it may have been accepted): recorded on the row + Activity, held back
    // (noAutoRetry, in createAndSendThread) — "unknown" makes the row refuse a blind retry.
    const unknown = sent.delivery === "unknown";
    const error = unknown ? SEND_COPY.gmailUnknownResend : SEND_COPY.gmailFailedResend;
    try {
      if (!(await deps.recordBidderSend(quoteId, partyId, entry, { kind: "failed", error, ...(unknown ? { unknown: true } : {}) }, actor.id))) {
        console.error("[estimate-email] recording an undelivered bidder send wrote nothing", quoteId, partyId, sent.threadId);
      }
    } catch (e) {
      console.error("[estimate-email] bidder record failed (undelivered send)", e);
    }
    return { ok: false, partyId, error, scope: "row", ...(markedSent ? { markedSent: true } : {}) };
  }
  // The email is out: a failed record never reads as a failed send (that would invite a duplicate).
  let warning: string | undefined;
  try {
    if (!(await deps.recordBidderSend(quoteId, partyId, entry, { kind: "sent" }, actor.id))) warning = BID_SEND_COPY.recordFailed;
  } catch (e) {
    console.error("[estimate-email] bidder record failed", e);
    warning = BID_SEND_COPY.recordFailed;
  }
  if (warning) {
    // Nothing on the row says it went out: stamp it unknown so Send to all never emails it twice. Best effort.
    try {
      await deps.markBidderFailed(quoteId, partyId, { at: deps.now(), error: BID_SEND_COPY.recordFailed, unknown: true, threadId: sent.threadId });
    } catch (e) {
      console.error("[estimate-email] stamping the unrecorded bidder send failed", e);
    }
  }
  return { ok: true, partyId, threadId: sent.threadId, delivery: sent.delivery, rev, status: q.status, ...(warning ? { warning } : {}) };
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
    storeCover: async (quoteId, bytes, now) => {
      const store = pdfStorage();
      if ("unavailable" in store) return null;
      try {
        return await store.put(pdfStoragePath(quoteId, `cover-${now}`), bytes);
      } catch (e) {
        console.error("[estimate-email] cover storage write failed", e);
        return null;
      }
    },
    findInboxDraft: async (quoteId, owner) => {
      // #349 — the sender's own drafts, by identity
      const t = await findDraftByLink("quote", quoteId, { owner: await mailboxViewer(owner) });
      return t ? { threadId: t.id, createdAt: t.createdAt, attachments: t.draft?.attachments || [] } : null;
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
      const draft = await saveDraft(draftInput(spec));
      try {
        const sent = await sendDraft(draft.id, spec.mailboxUser, { stampAddresses: true });
        if (!sent) throw new Error("the draft vanished before it was sent");
      } catch (e) {
        console.error("[estimate-email] sendDraft failed", e);
        const t = await getThread(draft.id).catch(() => null);
        throw t ? new EstimateEmailError(SEND_COPY.notSent, draft.id, t.status === "draft") : new EstimateEmailError(SEND_COPY.notSent);
      }
      // addMessage awaits the bridge's dispatch, so a Gmail send has stamped its gmailId (or its sendFailure) by now.
      const delivery = await deliveryAfterSend(connected, () => getThread(draft.id));
      // I1: not through Gmail → never pushed later by a reply on the thread.
      if (delivery !== "gmail") await holdOutbound(draft.id, delivery);
      return { threadId: draft.id, delivery };
    },
    createDraftThread: async (spec) => ({ threadId: (await saveDraft(draftInput(spec))).id }),
    recordEmail: recordEstimateEmail,
    addFollowUpTask: (spec, actor) => createTask(spec, { id: actor.id, name: actor.name }),
    roster: async () => (await activeUsers()).map((u) => ({ id: u.id, name: u.name, status: u.status })),
  };
}

/** #348 2b-ii — the bidder send's real deps: the estimate deps plus the bidder row, render, store, link and record. */
export function liveBidderEmailDeps(opts: { origin: string; host: string | null; proto: string | null; actor: SendActor }): BidderEmailDeps {
  const origin = opts.origin.replace(/\/+$/, "");
  return {
    ...liveEstimateEmailDeps(opts),
    getBidder: async (quoteId, partyId) => {
      const party = await bidderPartyFor(quoteId, partyId);
      if (!party || !party.bid) return null;
      const company = await getCompany(party.companyId);
      if (!company) return null;
      const r = await bidderRecipient(party);
      return { partyId: party.id, companyId: company.id, companyName: company.name, contactName: r.name, email: r.email, bid: party.bid };
    },
    renderBidderPdf: async (q, partyId, rev) => {
      const r = await renderBidderPdfLive(q.id, partyId, opts.host, opts.proto, { rev });
      if (r.ok) return { ok: true, pdf: r.pdf };
      // 503: Chrome, the secret or the origin is unavailable — every row would fail the same way.
      if (r.status === 503) return { ok: false, error: r.error, scope: "quote" };
      return { ok: false, error: r.status === 404 ? BID_SEND_COPY.gone : r.error, scope: "row" };
    },
    storeBidderPdf: async (quoteId, partyId, rev, bytes, now) => {
      const store = pdfStorage();
      if ("unavailable" in store) return null;
      try {
        return await store.put(pdfStoragePath(quoteId, `bidder-${partyId.slice(4)}-r${rev}-${now}`), bytes);
      } catch (e) {
        console.error("[estimate-email] bidder PDF storage write failed", e);
        return null;
      }
    },
    bidderLink: async (quoteId, partyId, rev) => {
      const r = await bidderLinkPath(quoteId, partyId, opts.actor.name, { rev });
      if (!r.ok) throw new EstimateEmailError(r.error);
      return origin + r.path;
    },
    recordBidderSend: recordBidderSendLive,
    markBidderFailed: markBidderSendFailed,
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
 *  the bridge stamped a gmailId (gmail), or its send timed out (unknown — Gmail
 *  may have accepted it), or anything else (failed). */
export function deliveryOfThread(
  t: { messages?: Array<{ direction?: string; gmailId?: string; sendFailure?: string }> } | null | undefined,
  connected: boolean
): EmailDelivery {
  if (!connected) return "local";
  const outs = (t?.messages || []).filter((x) => x.direction === "out");
  const last = outs[outs.length - 1];
  if (last?.gmailId) return "gmail";
  return last?.sendFailure === "timeout" ? "unknown" : "failed";
}

/** I1 — hold the thread's latest outbound email back from every later bridge
 *  send (comms holdLastOutbound). Best effort: logged, never thrown — the
 *  email's outcome is already decided. */
export async function holdOutbound(threadId: string, delivery: Exclude<EmailDelivery, "gmail">): Promise<void> {
  try {
    if (!(await holdLastOutbound(threadId, delivery))) console.error("[estimate-email] nothing to hold back on", threadId);
  } catch (e) {
    console.error("[estimate-email] holding the message back from auto-send failed", threadId, e);
  }
}

/** The delivery of a send that already went out. Not connected is "local"
 *  whatever the thread holds, so a failed read must not fail that send; when
 *  connected the read decides gmail vs failed (a throw there is a real error). */
export async function deliveryAfterSend(connected: boolean, readThread: () => Promise<Parameters<typeof deliveryOfThread>[0]>): Promise<EmailDelivery> {
  if (!connected) return "local";
  return deliveryOfThread(await readThread(), connected);
}

function draftInput(spec: ThreadSpec) {
  return {
    mailbox: "personal" as const,
    owner: { id: spec.mailboxOwnerId, name: spec.mailboxUser }, // #349 — owned by identity
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
