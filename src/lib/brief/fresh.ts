/**
 * AI daily brief — is a stored pre-draft still good? (spec §2 "Fresh").
 * A thread's pre-draft is fresh while its `basis` is the newest inbound
 * message id; a quote's nudge is fresh while the quote is still sent and its
 * `basis` is the current send time. Pure, client-safe.
 *
 * The `…For` checks add the owner: a draft made for someone else (the thread
 * or quote was reassigned since) is stale for the viewer and for the queue.
 */
import type { Direction } from "@/lib/stores/comms";
import type { QuoteHistoryEntry, QuoteStatus } from "@/lib/stores/quotes";

type MsgLike = { id: string; direction: Direction; at: number };

/** The newest inbound message's id (by time; a tie goes to the later one in the list), or null. */
export function newestInboundId(thread: { messages: readonly MsgLike[] }): string | null {
  let best: MsgLike | null = null;
  for (const m of thread.messages) if (m.direction === "in" && (!best || m.at >= best.at)) best = m;
  return best ? best.id : null;
}

export function preDraftFresh(thread: { messages: readonly MsgLike[]; preDraft?: { basis: string } | null }): boolean {
  const basis = thread.preDraft?.basis;
  if (!basis) return false;
  return newestInboundId(thread) === basis;
}

/** Fresh AND made for `ownerId` — what the reader, the card and the queue use. */
export function preDraftFreshFor(thread: { messages: readonly MsgLike[]; preDraft?: { basis: string; ownerId?: string } | null }, ownerId: string): boolean {
  return !!ownerId && thread.preDraft?.ownerId === ownerId && preDraftFresh(thread);
}

type QuoteLike = { status: QuoteStatus | string; history: readonly Pick<QuoteHistoryEntry, "at" | "to">[] };

/** When the quote was sent: the final history entry's time when it moved to sent; else null. */
export function lastSentAt(q: Pick<QuoteLike, "history">): number | null {
  const last = q.history.length ? q.history[q.history.length - 1] : null;
  return last && last.to === "sent" && Number.isFinite(last.at) ? last.at : null;
}

export function nudgeFresh(q: QuoteLike & { assistNudge?: { basis: number } | null }): boolean {
  if (q.status !== "sent" || !q.assistNudge) return false;
  const sent = lastSentAt(q);
  return sent !== null && q.assistNudge.basis === sent;
}

/** Fresh AND made for `ownerId` — what the Inbox prefill, the card and the queue use. */
export function nudgeFreshFor(q: QuoteLike & { assistNudge?: { basis: number; ownerId?: string } | null }, ownerId: string): boolean {
  return !!ownerId && q.assistNudge?.ownerId === ownerId && nudgeFresh(q);
}
