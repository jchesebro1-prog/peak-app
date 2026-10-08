import { cleanOpens } from "@/lib/estimate-output/opens";
import { get as getThreadLive, markRead as markReadLive, reply as replyLive } from "@/lib/stores/comms";
import { get as getQuoteLive, type Quote } from "@/lib/stores/quotes";
import { can } from "@/lib/team";
import { activeUsers } from "@/lib/users";
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
  /** The thread lives in one person's personal mailbox, and the Gmail bridge sends from that account. */
  notOwnerReply: (owner: string) => `Only ${owner || "the mailbox owner"} can reply — it’s their mailbox.`,
  notOwnerRead: (owner: string) => `Only ${owner || "the mailbox owner"} can mark this read.`,
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
  /** The thread owner's user id for a mailbox name (null = not on the roster). */
  userIdByName: (name: string) => Promise<string | null>;
  /** Can Gmail be involved in this user's mail at all? */
  gmailConnected: (userId: string) => Promise<boolean>;
  /** Append an outbound email message to the thread as `me`; null = the thread is gone. */
  reply: (threadId: string, body: string, me: string) => Promise<unknown | null>;
  /** Clear the thread's unread flag. */
  markRead: (threadId: string) => Promise<unknown | null>;
};

export type TrackOpens = { total: number; byRev: Record<string, number> };

/**
 * One tracked email as a viewer may see it. Metadata (subject, recipient, sent
 * time, rev, delivery, unread count) is for everyone who can see the estimate;
 * the message text only for the thread's owner, send|approve holders and the
 * quote's Lead estimator — otherwise `messages` is empty and `textHidden` set.
 */
export type TrackedEmail = ThreadSummary & {
  /** The estimate revision this email carried (from the recorded entry). */
  rev: number;
  /** The mailbox the thread lives in — the only person who can reply or mark read. */
  ownerName: string;
  /** The viewer is the owner (Reply / Mark read are theirs alone). */
  canReply: boolean;
  textHidden: boolean;
};

export type TrackViewer = Pick<SendActor, "id" | "name" | "roles">;

export type TrackResult =
  | { ok: true; emails: TrackedEmail[]; opens: TrackOpens; newReplies: number }
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

const sameName = (a: string | null | undefined, b: string | null | undefined) => {
  const x = String(a ?? "").trim().toLowerCase();
  return !!x && x === String(b ?? "").trim().toLowerCase();
};

/** The mailbox a raw comms thread lives in (a person's name; "" = not personal). */
function mailboxOwnerOf(raw: unknown): string {
  const u = (raw as { mailboxUser?: unknown } | null)?.mailboxUser;
  return typeof u === "string" ? u.trim() : "";
}

/**
 * The quote's tracked emails, newest first (by when each went out; the
 * later-recorded wins a tie), threads that no longer exist skipped, plus the
 * link-open totals and the count of unread customer replies across them. The
 * message text follows the viewer (see TrackedEmail).
 */
export async function trackEstimate(deps: TrackDeps, viewer: TrackViewer, quoteId: string): Promise<TrackResult> {
  const id = String(quoteId || "");
  const q = id && id.length <= 64 ? await deps.getQuote(id) : null;
  if (!q) return { ok: false, error: TRACK_COPY.gone };
  const ids = recordedThreadIds(q);
  const revOf = new Map<string, number>();
  for (const e of Array.isArray(q.estimateEmails) ? q.estimateEmails : []) {
    if (e && typeof e.threadId === "string" && Number.isFinite(e.rev)) revOf.set(e.threadId, e.rev);
  }
  const holdsPerm = can("send", viewer.roles) || can("approve", viewer.roles);
  const isLead = sameName(q.owner, viewer.name);
  const loaded = await Promise.all(ids.map(async (tid) => {
    try {
      const raw = await deps.getThread(tid);
      const s = summarizeThread(raw);
      return s ? { s, owner: mailboxOwnerOf(raw) } : null;
    } catch (e) {
      console.error("[estimate-email] track: thread read failed", e);
      return null;
    }
  }));
  const emails = loaded
    .map((x, i) => ({ x, i }))
    .filter((r): r is { x: { s: ThreadSummary; owner: string }; i: number } => !!r.x)
    .sort((a, b) => b.x.s.sentAt - a.x.s.sentAt || a.i - b.i)
    .map(({ x }): TrackedEmail => {
      const isOwner = sameName(x.owner, viewer.name);
      const textHidden = !(isOwner || holdsPerm || isLead);
      return {
        ...x.s,
        messages: textHidden ? [] : x.s.messages,
        rev: revOf.get(x.s.threadId) ?? 0,
        ownerName: x.owner,
        canReply: isOwner,
        textHidden,
      };
    });
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

/**
 * Reply inline on one of the quote's estimate emails (send|approve). Only the
 * thread's owner can: it lives in their personal mailbox and the Gmail bridge
 * sends from the thread owner's account, so the reply, its signature and its
 * delivery are all the owner's.
 */
export async function replyToEstimateEmail(deps: TrackDeps, actor: SendActor, quoteId: string, threadId: string, body: string): Promise<TrackReplyResult> {
  if (!can("send", actor.roles) && !can("approve", actor.roles)) return { ok: false, error: TRACK_COPY.needsPerm };
  const owned = await ownedThread(deps, quoteId, threadId);
  if (!owned.ok) return owned;
  const raw = await deps.getThread(owned.id);
  if (!raw) return { ok: false, error: TRACK_COPY.gone };
  const owner = mailboxOwnerOf(raw);
  if (!sameName(owner, actor.name)) return { ok: false, error: TRACK_COPY.notOwnerReply(owner) };
  const text = typeof body === "string" ? body.trim() : "";
  if (!text) return { ok: false, error: TRACK_COPY.noBody };
  if (text.length > BODY_MAX) return { ok: false, error: TRACK_COPY.bodyTooLong };

  let signed: string;
  try {
    // The Inbox's own rule (applyOutboundSignature) — applied once, here, for the owner (= the actor).
    signed = await deps.applySignature(text, actor);
  } catch (e) {
    console.error("[estimate-email] track: signature failed", e);
    return { ok: false, error: TRACK_COPY.replyFailed };
  }
  const connected = await deps.gmailConnected((await deps.userIdByName(owner)) ?? actor.id);
  try {
    if (!(await deps.reply(owned.id, signed, actor.name))) return { ok: false, error: TRACK_COPY.gone };
  } catch (e) {
    console.error("[estimate-email] track: reply failed", e);
    return { ok: false, error: TRACK_COPY.replyFailed };
  }
  // Answering a thread reads it (the owner's mailbox, so the owner's to clear). Best effort: the reply is already out.
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

/** Clear unread on one of the quote's estimate emails — the thread owner's alone. */
export async function markEstimateEmailRead(deps: TrackDeps, actor: Pick<SendActor, "name">, quoteId: string, threadId: string): Promise<TrackReadResult> {
  const owned = await ownedThread(deps, quoteId, threadId);
  if (!owned.ok) return owned;
  const raw = await deps.getThread(owned.id);
  if (!raw) return { ok: false, error: TRACK_COPY.gone };
  const owner = mailboxOwnerOf(raw);
  if (!sameName(owner, actor.name)) return { ok: false, error: TRACK_COPY.notOwnerRead(owner) };
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
    userIdByName: async (name) => (await activeUsers()).find((u) => sameName(u.name, name))?.id ?? null,
    gmailConnected: gmailConnectedFor,
    reply: (threadId, body, me) => replyLive(threadId, { body, me }),
    markRead: markReadLive,
  };
}
