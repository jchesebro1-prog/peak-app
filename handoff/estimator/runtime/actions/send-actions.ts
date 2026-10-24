/**
 * Estimator handoff — browser implementations of src/app/(app)/estimator/send-actions.ts (Estimator Phase 3 —
 * Send & track), type-enforced against the originals. NOTHING IS EVER SENT: the `email` port records the
 * message as an activity row and the Activity card reads it back, marked "Sent (simulated)".
 *
 * `sendEstimateEmailAction` runs send-server.ts sendEstimateEmail's ordered action, ported:
 *   1. preflight (permission, quote, system estimate, draft / sent, the version shown, recipients, subject,
 *      body, follow-up) — before the claim and again under it, on a fresh read;
 *   2. the one in-flight send per quote (`claimSend`, here a per-window set);
 *   3. mark sent (a draft only) through the review ops' sendQuoteToCustomer — the same approval gate, the
 *      same "sent" revision and history the next-step control's Send writes;
 *   4. the email → `ports.email.send` (recorded, never sent), then the quote's `estimateEmails` entry;
 *   5. the original's success shape (`delivery: "local"`, the fresh status and next step) with a warning that
 *      says it was simulated.
 * Left out — no Gmail, PDFs or comms threads exist offline: the share secret / request origin, the PDF-current
 * and PDF-copy checks (the attachments are listed on the activity row by name only), the cover render, the
 * signature (none is sliced), the client link (the body's {link} becomes a placeholder) and the follow-up task
 * (there is no tasks store — the warning says so).
 *
 * `estimateEmailDefaultsAction` builds the composer's defaults exactly as the original (compose.ts
 * estimateEmailDefaults): To = the quote contact's email from the customer port, Cc = the Lead estimator
 * unless that's the sender, the subject / body with the EST number and {link}. No bidder is ever awarded
 * (parties aren't in the prototype), no signature, Gmail "not connected" (it will be "saved as sent here").
 *
 * `sendTrackAction` answers the Activity card from the quote's recorded `estimateEmails` joined to the email
 * activity rows (track-server.ts trackEstimate's shape; each one a single outbound message whose text starts
 * "Sent (simulated)"). Open in Inbox, Reply and Mark read are refused (no Inbox).
 * Plan: PR 2 Task 6.
 */
import type * as Original from "@/app/(app)/estimator/send-actions";
import type { TrackedEmail, TrackOpens } from "@/lib/estimate-email/track-server";
import type { EstimateEmailInput } from "@/lib/estimate-email/send-server";
import { bodyWithLink, estimateEmailDefaults, FOLLOW_UP_CHOICES, parseRecipients, summarizeThread, withoutAddresses } from "@/lib/estimate-email/compose";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { leadEstimator } from "@/lib/estimate-output/responses";
import { cleanOpens } from "@/lib/estimate-output/opens";
import { sendDefaultsContact } from "@/lib/parties/addressee";
import { latestSentRevision, pdfFileName, pdfKindForQuoteType } from "@/lib/quote-pdf/state";
import { coverPdfFileName } from "@/lib/estimate-output/cover";
import { can } from "@/lib/team";
import { boxSaleOf, boxSaleSaveProblem } from "@/lib/estimate-box-sale/rules";
import type { SpecSection } from "@/app/(app)/estimator/types";
import type { Quote, QuoteStatus } from "@/lib/stores/quotes";
import type { ActionImpl } from "../actions-registry";
import type { HandoffStore } from "../store";
import { clock, customers, email, refreshPortsFromStore, users, type EmailActivity, type TeamUser } from "../ports";
import { refusals } from "./misc-refusals";
import { quoteRepo } from "../quote-repo";
import { reviewOps } from "../review-ops";
import { refresh } from "../router";
import { nextStepView } from "./next-step-actions";
import type { Impl as ImplOf } from "./util";

export const SEND_ACTIONS_KEY = "src/app/(app)/estimator/send-actions.ts";

type A = typeof Original;
type Impl<K extends keyof A> = ImplOf<A, K>;

/** send-server.ts SEND_COPY — the strings this port uses, verbatim. */
export const SEND_COPY = {
  needsPerm: "You need send or approve permission to send a quote.",
  gone: "Quote not found.",
  notEstimate: "Only system estimates can be emailed from here.",
  closed: "This estimate is closed — it can’t be emailed.",
  changedSince: "This quote changed since you opened it — reload to review the current version.",
  noTo: "Add at least one To address.",
  badTo: (bad: string[]) => `Check the To address${bad.length === 1 ? "" : "es"}: ${bad.join(", ")}`,
  badCc: (bad: string[]) => `Check the Cc address${bad.length === 1 ? "" : "es"}: ${bad.join(", ")}`,
  tooManyRecipients: "Too many recipients — 20 at most.",
  noSubject: "Add a subject.",
  noBody: "Add a message.",
  subjectTooLong: "The subject is too long.",
  bodyTooLong: "The message is too long.",
  badFollowUp: "Pick a follow-up option.",
  inProgress: "Another send of this estimate is in progress.",
  markFailed: "The estimate couldn’t be marked sent — nothing was emailed. Try again.",
  partialNoThread: "Marked sent, but the email didn’t go out — send it again in a moment.",
  notSent: "The email didn’t go out — try again.",
  recordFailed: "Sent — but it couldn’t be logged on the estimate’s Activity.",
} as const;

/** track-server.ts TRACK_COPY.gone. */
export const TRACK_GONE = "Not found.";

/** send-server.ts limits. */
const RECIPIENTS_MAX = 20;
const RECIPIENTS_RAW_MAX = 4_000;
const SUBJECT_MAX = 300;
const BODY_MAX = 20_000;

/** How every simulated estimate email reads in the Activity card (the start of its message text). */
export const SIMULATED_SEND_MARK = "Sent (simulated)";
/** The message text's lead-in: what really happened to it. */
export const SIMULATED_SEND_NOTE = `${SIMULATED_SEND_MARK} — the prototype never emails; nothing left this browser.`;
/** What the body's {link} becomes — the client link is minted by Quartzite at send. */
export const SIMULATED_LINK = "[client link — Quartzite inserts it when it sends]";
/** The composer's warning under "Sent locally (Gmail not connected)." */
export const SIMULATED_SEND_WARNING = "Simulated — nothing was emailed; the prototype only records the send on this estimate.";
/** Added to the warning when a follow-up was picked. */
export const NO_FOLLOW_UP_TASK = "No follow-up task was created (tasks aren't part of the prototype).";

/** send-actions.ts cleanInput — verbatim. */
function cleanInput(raw: unknown): EstimateEmailInput {
  const o = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    to: str(o.to),
    cc: str(o.cc),
    subject: str(o.subject),
    body: str(o.body),
    attachEstimate: o.attachEstimate === true,
    attachCover: o.attachCover === true,
    followUpDays: typeof o.followUpDays === "number" ? o.followUpDays : Number.NaN,
    asOf: typeof o.asOf === "number" && Number.isFinite(o.asOf) ? o.asOf : undefined,
  };
}

const canSendOrApprove = (u: TeamUser) => can("send", u.roles) || can("approve", u.roles);

type Checked = { q: Quote; to: string; cc: string; subject: string; body: string };
type Refusal = { ok: false; error: string };

/** send-server.ts preflight (mode "send"), minus the PDF checks — no PDFs exist offline. Nothing is written. */
export function preflightSend(actor: { roles?: string[] }, q: Quote | null, input: EstimateEmailInput): Checked | Refusal {
  if (!can("send", actor.roles) && !can("approve", actor.roles)) return { ok: false, error: SEND_COPY.needsPerm };
  if (!q) return { ok: false, error: SEND_COPY.gone };
  if (pdfKindForQuoteType(q.quoteType) !== "quote") return { ok: false, error: SEND_COPY.notEstimate };
  if (q.status !== "draft" && q.status !== "sent") return { ok: false, error: SEND_COPY.closed };
  // Box goods sale (spec 2026-10-21): equipment + freight only. Labor can still sit on one (a restored revision, a
  // move into it from before the rule) — it is never sent, by any path.
  const boxProblem = boxSaleSaveProblem(boxSaleOf(q), (q.spec as { sections?: SpecSection[] } | null | undefined)?.sections);
  if (boxProblem) return { ok: false, error: boxProblem };
  const asOf = input?.asOf;
  if (typeof asOf === "number" && asOf > 0 && q.updatedAt !== asOf) return { ok: false, error: SEND_COPY.changedSince };
  const rawTo = String(input?.to ?? "");
  const rawCc = String(input?.cc ?? "");
  if (rawTo.length + rawCc.length > RECIPIENTS_RAW_MAX) return { ok: false, error: SEND_COPY.tooManyRecipients };
  const to = parseRecipients(rawTo);
  if (!to.ok) return { ok: false, error: SEND_COPY.badTo(to.bad) };
  if (to.list.length === 0) return { ok: false, error: SEND_COPY.noTo };
  const ccParsed = parseRecipients(rawCc);
  if (!ccParsed.ok) return { ok: false, error: SEND_COPY.badCc(ccParsed.bad) };
  const cc = withoutAddresses(ccParsed.list, to.list);
  if (to.list.length + cc.length > RECIPIENTS_MAX) return { ok: false, error: SEND_COPY.tooManyRecipients };
  const subject = String(input?.subject ?? "").replace(/[\r\n]+/g, " ").trim();
  const body = String(input?.body ?? "");
  if (!subject) return { ok: false, error: SEND_COPY.noSubject };
  if (!body.trim()) return { ok: false, error: SEND_COPY.noBody };
  if (subject.length > SUBJECT_MAX) return { ok: false, error: SEND_COPY.subjectTooLong };
  if (body.length > BODY_MAX) return { ok: false, error: SEND_COPY.bodyTooLong };
  if (!(FOLLOW_UP_CHOICES as readonly number[]).includes(Number(input?.followUpDays))) return { ok: false, error: SEND_COPY.badFollowUp };
  return { q, to: to.list.join(", "), cc: cc.join(", "), subject, body };
}

/** The PDFs the email would carry (send-server attach's file names) — listed on the activity row only. */
function attachmentNames(q: Quote, input: EstimateEmailInput): string[] {
  const n = displayQuoteNumber(q);
  // Box goods sale: the quote PDF always goes with the email (wantsEstimatePdf), and never a cover (a stale composer's tick is ignored).
  const box = boxSaleOf(q);
  return [...(input.attachEstimate || box ? [pdfFileName(n, null)] : []), ...(input.attachCover && !box ? [coverPdfFileName(n)] : [])];
}

/** track-server.ts recordedThreadIds — newest recorded first, de-duplicated. */
function recordedThreadIds(q: Pick<Quote, "estimateEmails">): string[] {
  const list = Array.isArray(q.estimateEmails) ? q.estimateEmails : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const id = typeof list[i]?.threadId === "string" ? list[i].threadId : "";
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** track-server.ts opensOf — the link-open totals (none in the prototype unless sliced). */
function opensOf(q: Pick<Quote, "shareOpens">): TrackOpens {
  const opens = cleanOpens(q.shareOpens);
  const byRev: Record<string, number> = {};
  let total = 0;
  for (const [rev, s] of Object.entries(opens)) {
    byRev[rev] = s.count;
    total += s.count;
  }
  return { total, byRev };
}

/** One recorded email activity row as the comms thread summarizeThread reads: one outbound message, delivered locally. */
export function simulatedThread(row: EmailActivity): Parameters<typeof summarizeThread>[0] {
  const to = row.to.join(", ");
  return {
    id: row.id,
    subject: row.subject,
    contactEmail: to,
    status: "sent",
    createdAt: row.at,
    unread: false,
    messages: [{ direction: "out", at: row.at, author: row.by, body: `${SIMULATED_SEND_NOTE} ${row.body}`, to, deliveryNote: "local" }],
  };
}

/** trackEstimate over the store: recorded emails joined to their activity rows, newest sent first. */
export function trackedEmailsOf(q: Quote, rows: readonly EmailActivity[]): TrackedEmail[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const revOf = new Map<string, number>();
  for (const e of Array.isArray(q.estimateEmails) ? q.estimateEmails : []) if (e && typeof e.threadId === "string" && Number.isFinite(e.rev)) revOf.set(e.threadId, e.rev);
  return recordedThreadIds(q)
    .map((tid, i) => {
      const row = byId.get(tid);
      const s = row ? summarizeThread(simulatedThread(row)) : null;
      return s ? { s, i, by: row!.by } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => b.s.sentAt - a.s.sentAt || a.i - b.i)
    // Reply / Mark read are the Inbox's — never offered here.
    .map(({ s, by }): TrackedEmail => ({ ...s, rev: revOf.get(s.threadId) ?? 0, ownerName: by, canReply: false }));
}

export type ImplementedSendAction = "estimateEmailDefaultsAction" | "sendEstimateEmailAction" | "sendTrackAction";

export function sendActions(store: HandoffStore): { [K in ImplementedSendAction]: Impl<K> } {
  const repo = quoteRepo(store);
  const ops = reviewOps(repo);
  /** claimSend: one in-flight send per quote (per window — the app's claim lives on the quote row). */
  const sending = new Set<string>();

  /** send-actions.ts freshView: the page refreshes and the result carries the quote's status + next step. */
  const freshView = async (quoteId: string, user: TeamUser): Promise<{ status?: QuoteStatus; next: ReturnType<typeof nextStepView> | null }> => {
    refresh();
    const q = quoteId ? await repo.get(quoteId) : null;
    return q ? { status: q.status, next: nextStepView(q, user) } : { next: null };
  };

  const estimateEmailDefaultsAction: Impl<"estimateEmailDefaultsAction"> = async (quoteId) => {
    await refreshPortsFromStore(store);
    const user = users.current();
    const q = await repo.get(String(quoteId || ""));
    if (!q) return { ok: false, error: SEND_COPY.gone };
    if (pdfKindForQuoteType(q.quoteType) !== "quote") return { ok: false, error: SEND_COPY.notEstimate };
    const contact = q.customerId && q.contactName ? customers.contactByName(q.customerId, q.contactName) : null;
    const lead = leadEstimator(q.owner, q.preparedBy, users.all());
    // The slice carries no team email addresses, so the sender's (and the Cc lead's) address is blank.
    const emailOf = (u: TeamUser | null) => String((u as { email?: unknown } | null)?.email ?? "").trim();
    const senderEmail = emailOf(user);
    return {
      ok: true,
      ...estimateEmailDefaults({
        projectName: q.name || "",
        estimateNumber: displayQuoteNumber(q),
        // No bidder is ever awarded in the prototype (parties aren't sliced) → the owner's contact.
        ...sendDefaultsContact(null, { name: q.contactName || contact?.name || "", email: contact?.email || "" }),
        senderName: user.name,
        senderEmail,
        leadName: lead?.name || "",
        leadEmail: lead && lead.id !== user.id ? emailOf(lead) : "",
        signature: "",
        // Box goods sale: the saved estimate's flag (Send saves first).
        boxSale: boxSaleOf(q),
      }),
      gmailConnected: false,
      fromAddress: senderEmail,
    };
  };

  const sendEstimateEmailAction: Impl<"sendEstimateEmailAction"> = async (quoteId, rawInput) => {
    await refreshPortsFromStore(store);
    const user = users.current();
    if (!canSendOrApprove(user)) return { ok: false, error: SEND_COPY.needsPerm };
    const id = String(quoteId || "");
    const input = cleanInput(rawInput);
    const actor = { name: user.name, roles: user.roles ?? [] };
    const r = await (async (): Promise<Original.SendEstimateActionResult> => {
      const first = preflightSend(user, id && id.length <= 64 ? await repo.get(id) : null, input);
      if ("ok" in first) return first;
      if (sending.has(first.q.id)) return { ok: false, error: SEND_COPY.inProgress };
      sending.add(first.q.id);
      try {
        // Under the claim: the status it saw, the checks again on a fresh read, then one more read.
        const fresh = await repo.get(first.q.id);
        if (!fresh) return { ok: false, error: SEND_COPY.gone };
        if (fresh.status !== first.q.status) return { ok: false, error: SEND_COPY.changedSince };
        const p = preflightSend(user, fresh, input);
        if ("ok" in p) return p;
        const now = await repo.get(p.q.id);
        if (!now) return { ok: false, error: SEND_COPY.gone };
        if (now.status !== p.q.status || now.updatedAt !== p.q.updatedAt) return { ok: false, error: SEND_COPY.changedSince };

        // Mark sent (a draft only) — the gate, the sent revision and history, exactly as Send to customer.
        let markedSent = false;
        if (p.q.status === "draft") {
          let m;
          try {
            m = await ops.sendQuoteToCustomer(p.q.id, actor, typeof input.asOf === "number" && input.asOf > 0 ? input.asOf : undefined);
          } catch (e) {
            console.error("[handoff] send: mark sent threw", e);
            return { ok: false, error: SEND_COPY.markFailed };
          }
          if (!m.ok) return { ok: false, error: m.error };
          markedSent = true;
        }
        const q = markedSent ? ((await repo.get(p.q.id)) ?? p.q) : p.q;
        const rev = latestSentRevision(q.revisions);
        if (!rev || typeof rev.rev !== "number") {
          console.error("[handoff] send: no sent revision after send", q.id);
          return { ok: false, error: markedSent ? SEND_COPY.partialNoThread : SEND_COPY.notSent, ...(markedSent ? { markedSent: true } : {}) };
        }

        // The email — recorded by the email port, never sent. A throw here is send-server's "the email didn't go
        // out": after the mark-sent it is the partial result (the fresh view rides along), before it a plain retry.
        let sent;
        try {
          sent = await email.send({
            to: p.to.split(", ").filter(Boolean),
            cc: p.cc ? p.cc.split(", ").filter(Boolean) : [],
            subject: p.subject,
            body: bodyWithLink(p.body, SIMULATED_LINK),
            quoteId: q.id,
            rev: rev.rev,
            attachments: attachmentNames(q, input),
          });
        } catch (e) {
          console.error("[handoff] send: the email port threw", e);
          return { ok: false, error: markedSent ? SEND_COPY.partialNoThread : SEND_COPY.notSent, ...(markedSent ? { markedSent: true } : {}) };
        }
        const warnings = [SIMULATED_SEND_WARNING];
        try {
          if (!(await repo.recordEstimateEmail(q.id, { threadId: sent.id, rev: rev.rev, at: clock.now(), by: user.name, to: p.to }))) warnings.push(SEND_COPY.recordFailed);
        } catch (e) {
          console.error("[handoff] send: record failed", e);
          warnings.push(SEND_COPY.recordFailed);
        }
        if (Number(input.followUpDays) > 0) warnings.push(NO_FOLLOW_UP_TASK);
        return { ok: true, threadId: sent.id, delivery: "local", status: q.status, warning: warnings.join(" ") };
      } finally {
        sending.delete(first.q.id);
      }
    })();
    // send-actions.ts: a refusal that changed nothing returns as is; anything else carries the fresh view.
    const stale = !r.ok && r.error === SEND_COPY.changedSince;
    if (!r.ok && !r.markedSent && !stale) return r;
    return { ...r, ...(await freshView(id, user)) };
  };

  const sendTrackAction: Impl<"sendTrackAction"> = async (quoteId) => {
    const id = String(quoteId || "");
    const q = id && id.length <= 64 ? await repo.get(id) : null;
    if (!q) return { ok: false, error: TRACK_GONE };
    const rows = (await store.all<EmailActivity>("activity")).filter((a) => a.kind === "email" && a.quoteId === q.id);
    const emails = trackedEmailsOf(q, rows);
    return { ok: true, emails, opens: opensOf(q), newReplies: emails.reduce((n, e) => n + e.unread, 0) };
  };

  return { estimateEmailDefaultsAction, sendEstimateEmailAction, sendTrackAction };
}

/** No Inbox in the prototype: a draft can't be opened there, and there is no thread to reply to or mark read. */
export const REFUSED_SEND_ACTIONS = ["openEstimateInInboxAction", "replyToEstimateEmailAction", "markEstimateEmailReadAction"] as const satisfies readonly Exclude<keyof A, ImplementedSendAction>[];

/** Registered as explicit refusals (NOT_IN_PROTOTYPE + one console.warn per name). Every original's result type admits `{ ok: false, error }` (tsc, via `refusals`). */
export function refusedSendActions(): Record<(typeof REFUSED_SEND_ACTIONS)[number], ActionImpl> {
  return refusals<A>(REFUSED_SEND_ACTIONS) as Record<(typeof REFUSED_SEND_ACTIONS)[number], ActionImpl>;
}
