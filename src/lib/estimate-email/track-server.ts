import { cleanOpens } from "@/lib/estimate-output/opens";
import { get as getThreadLive, markRead as markReadLive, reply as replyLive } from "@/lib/stores/comms";
import { get as getQuoteLive, type Quote } from "@/lib/stores/quotes";
import { can } from "@/lib/team";
import { summarizeThread, type ThreadSummary } from "./compose";
import {
  applySenderSignature, BODY_MAX, deliveryOfThread, gmailConnectedFor, type EmailDelivery, type SendActor,
} from "./send-server";

/**
 * Estimator Phase 3 (spec §10.4) — the Send & track step's read side and the
 * inline reply, server-only. Customer replies land in the SAME comms thread
 * the estimate went out on (the existing Gmail import), so tracking is a
 * read of the threads recorded on the quote (`Quote.estimateEmails`) plus the
 * client-link opens (`Quote.shareOpens`). Only threads recorded on THAT quote
 * can be read, replied to or marked read here — any other id answers with the
 * same generic "Not found." (no oracle for which comms threads exist).
 *
 * Every dependency is injected so the spec harness proves the rules with
 * fakes; `liveTrackDeps` wires the real ones (the "use server" wrappers in
 * src/app/(app)/estimator/send-actions.ts). Nothing here ever sends to Gmail
 * itself: the reply goes through the comms store's `reply`, which dispatches
 * through the bridge only when the sender has a connection.
 */

export const TRACK_COPY = {
  gone: "Not found.",
  needsPerm: "You need send or approve permission to reply to a quote email.",
  noBody: "Add a message.",
  bodyTooLong: "The message is too long.",
  replyFailed: "The reply couldn’t be sent — try again.",
  gmailFailed: "Saved, but Gmail didn’t accept the reply — open it in Inbox.",
} as const;

export type TrackDeps = {
  getQuote: (id: string) => Promise<Quote | null>;
  /** A raw comms thread (summarizeThread reads it); null = gone. */
  getThread: (id: string) => Promise<unknown | null>;
  /** The sender's signature, applied as the Inbox applies it at send. */
  applySignature: (body: string, actor: SendActor) => Promise<string>;
  /** Can Gmail be involved in this sender's mail at all? */
  gmailConnected: (actor: SendActor) => Promise<boolean>;
  /** Append an outbound email message to the thread as `me`; null = the thread is gone. */
  reply: (threadId: string, body: string, me: string) => Promise<unknown | null>;
  /** Clear the thread's unread flag. */
  markRead: (threadId: string) => Promise<unknown | null>;
};

export type TrackOpens = { total: number; byRev: Record<string, number> };

export type TrackResult =
  | { ok: true; emails: ThreadSummary[]; opens: TrackOpens; newReplies: number }
  | { ok: false; error: string };

export type TrackReplyResult =
  | { ok: true; summary: ThreadSummary; delivery: EmailDelivery; warning?: string }
  | { ok: false; error: string };

export type TrackReadResult = { ok: true; summary: ThreadSummary } | { ok: false; error: string };

/** The recorded thread ids, newest recorded first, de-duplicated. */
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

/** Link opens: the total and the per-revision counts (garbage entries dropped). */
export function opensOf(q: Pick<Quote, "shareOpens">): TrackOpens {
  const opens = cleanOpens(q.shareOpens);
  const byRev: Record<string, number> = {};
  let total = 0;
  for (const [rev, s] of Object.entries(opens)) {
    byRev[rev] = s.count;
    total += s.count;
  }
  return { total, byRev };
}

/**
 * The quote's tracked emails, newest first (by when each went out; the
 * later-recorded wins a tie), threads that no longer exist skipped, plus the
 * link-open totals and the count of unread customer replies across them.
 */
export async function trackEstimate(deps: TrackDeps, quoteId: string): Promise<TrackResult> {
  const id = String(quoteId || "");
  const q = id && id.length <= 64 ? await deps.getQuote(id) : null;
  if (!q) return { ok: false, error: TRACK_COPY.gone };
  const ids = recordedThreadIds(q);
  const loaded = await Promise.all(ids.map(async (tid) => {
    try {
      return summarizeThread(await deps.getThread(tid));
    } catch (e) {
      console.error("[estimate-email] track: thread read failed", e);
      return null;
    }
  }));
  const emails = loaded
    .map((s, i) => ({ s, i }))
    .filter((x): x is { s: ThreadSummary; i: number } => !!x.s)
    .sort((a, b) => b.s.sentAt - a.s.sentAt || a.i - b.i)
    .map((x) => x.s);
  return { ok: true, emails, opens: opensOf(q), newReplies: emails.reduce((n, e) => n + e.unread, 0) };
}

/** The thread, only when it is one of this quote's recorded estimate emails. */
async function ownedThread(deps: TrackDeps, quoteId: string, threadId: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const id = String(quoteId || "");
  const tid = String(threadId || "");
  const q = id && id.length <= 64 && tid && tid.length <= 200 ? await deps.getQuote(id) : null;
  if (!q || !recordedThreadIds(q).includes(tid)) return { ok: false, error: TRACK_COPY.gone };
  return { ok: true, id: tid };
}

/** Reply inline on one of the quote's estimate emails (send|approve). */
export async function replyToEstimateEmail(deps: TrackDeps, actor: SendActor, quoteId: string, threadId: string, body: string): Promise<TrackReplyResult> {
  if (!can("send", actor.roles) && !can("approve", actor.roles)) return { ok: false, error: TRACK_COPY.needsPerm };
  const owned = await ownedThread(deps, quoteId, threadId);
  if (!owned.ok) return owned;
  const text = typeof body === "string" ? body.trim() : "";
  if (!text) return { ok: false, error: TRACK_COPY.noBody };
  if (text.length > BODY_MAX) return { ok: false, error: TRACK_COPY.bodyTooLong };
  if (!(await deps.getThread(owned.id))) return { ok: false, error: TRACK_COPY.gone };

  let signed: string;
  try {
    // The Inbox's own rule (applyOutboundSignature) — applied once, here.
    signed = await deps.applySignature(text, actor);
  } catch (e) {
    console.error("[estimate-email] track: signature failed", e);
    return { ok: false, error: TRACK_COPY.replyFailed };
  }
  const connected = await deps.gmailConnected(actor);
  try {
    if (!(await deps.reply(owned.id, signed, actor.name))) return { ok: false, error: TRACK_COPY.gone };
  } catch (e) {
    console.error("[estimate-email] track: reply failed", e);
    return { ok: false, error: TRACK_COPY.replyFailed };
  }
  // Answering a thread reads it. Best effort: the reply is already out.
  try {
    await deps.markRead(owned.id);
  } catch (e) {
    console.error("[estimate-email] track: mark read after reply failed", e);
  }
  const t = await deps.getThread(owned.id);
  const summary = summarizeThread(t);
  if (!summary) return { ok: false, error: TRACK_COPY.gone };
  const delivery = deliveryOfThread(t as Parameters<typeof deliveryOfThread>[0], connected);
  return delivery === "failed" ? { ok: true, summary, delivery, warning: TRACK_COPY.gmailFailed } : { ok: true, summary, delivery };
}

/** Clear unread on one of the quote's estimate emails. */
export async function markEstimateEmailRead(deps: TrackDeps, quoteId: string, threadId: string): Promise<TrackReadResult> {
  const owned = await ownedThread(deps, quoteId, threadId);
  if (!owned.ok) return owned;
  if (!(await deps.getThread(owned.id))) return { ok: false, error: TRACK_COPY.gone };
  await deps.markRead(owned.id);
  const summary = summarizeThread(await deps.getThread(owned.id));
  return summary ? { ok: true, summary } : { ok: false, error: TRACK_COPY.gone };
}

/* ---- the real deps (wired by the "use server" wrappers) ---- */

export function liveTrackDeps(): TrackDeps {
  return {
    getQuote: getQuoteLive,
    getThread: getThreadLive,
    applySignature: applySenderSignature,
    gmailConnected: (actor) => gmailConnectedFor(actor.id),
    reply: (threadId, body, me) => replyLive(threadId, { body, me }),
    markRead: markReadLive,
  };
}
