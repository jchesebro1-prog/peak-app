import { getDoc } from "@/db/doc-store";
import type { EstimateEmailEntry, Quote } from "@/lib/stores/quotes";
import { get as getQuote, patchQuoteBid, recordEstimateEmail, setStatus, withQuoteRowLock } from "@/lib/stores/quotes";
import { addParty, listFor, setPartyBid } from "@/lib/stores/parties";
import type { BidderState, Party } from "@/lib/parties/rules";
import {
  applyBidderPatch, awardPlan, bidderFailedState, bidderSentState, canAward, canUndoAward, currentRev, markSubmittedState, newBidderState, nextBidderOpens, sanitizeBidDetails,
  sanitizeBidderPatch, undoAwardPlan, addendaAdded, type QuoteBid,
} from "@/lib/parties/bids";

/**
 * #348 slice 2a — bids: the composition of the quote's bid details (quotes.patchQuoteBid) and the bidder state on
 * its GC/EC party rows (parties.setPartyBid). The owner stays the customer: nothing here touches customerId,
 * contact, venue or tier (spec §3.4, revised 2026-10-15).
 */

const CLOSED = new Set(["won", "lost"]);
type Bidder = Party & { bid: BidderState };
const isBidder = (p: Party): p is Bidder => !!p.bid && (p.role === "gc" || p.role === "ec");

export async function listBidders(quoteId: string): Promise<Bidder[]> {
  return (await listFor("quote", quoteId)).filter(isBidder);
}

/** A missing `dueAt` / `addenda` key keeps the stored value; an explicit `dueAt: null` clears it. Refuses a
 *  closed (won / lost) estimate; reads and writes under the quote's row lock.
 *
 *  Jeff 2026-10-15 #3: a NEW addendum on a SENT estimate puts it back to Draft — the normal revise
 *  (setStatus "draft", same row lock, history entry, no revision cut), so the next send is a new sent
 *  revision with the next Rev, re-checked by the approval gate like any revise, and the Bidders card
 *  offers "Send revision to all bidders". `revised` lists the new addenda when it happened. An AWARDED bid never
 *  reverts (#352 review M2): the award is decided, so the addendum is only recorded. */
export async function setBidDetails(
  quoteId: string,
  raw: unknown,
  by?: string
): Promise<{ ok: true; bid: QuoteBid; revised?: number[] } | { ok: false; error: string }> {
  const clean = sanitizeBidDetails(raw);
  if (!clean.ok) return clean;
  const { dueAt, addenda } = clean.value;
  return withQuoteRowLock(quoteId, async () => {
    const q = await getQuote(quoteId);
    if (!q) return { ok: false as const, error: "That estimate wasn't found." };
    if (CLOSED.has(q.status)) return { ok: false as const, error: "This estimate is closed." };
    const added = addenda !== undefined ? addendaAdded(q.bid?.addenda, addenda) : [];
    const saved = await patchQuoteBid(quoteId, (bid) => ({
      ...bid,
      ...(dueAt !== undefined ? { dueAt } : {}),
      ...(addenda !== undefined ? { addenda } : {}),
    }));
    if (!saved?.bid) return { ok: false as const, error: "That estimate wasn't found." };
    // #352 review M2: an awarded bid is decided — an addendum is recorded, the estimate stays Sent (no revert).
    if (q.status === "sent" && added.length > 0 && !q.bid?.awardedPartyId) {
      // Joins this transaction (setStatus re-locks the same row harmlessly).
      await setStatus(quoteId, "draft", by || "Addendum");
      return { ok: true as const, bid: saved.bid, revised: added };
    }
    return { ok: true as const, bid: saved.bid };
  });
}

export async function addBidder(
  input: { quoteId: string; companyId: string; contactId?: string | null; role: "gc" | "ec"; submitVia?: "email" | "website" },
  by: string
): Promise<{ ok: true; party: Party; existed: boolean } | { ok: false; error: string }> {
  if (input.role !== "gc" && input.role !== "ec") return { ok: false, error: "Bidders are GCs or ECs." };
  // Row lock first (setStatus's order): the closed / awarded checks and the insert see one committed state.
  const gate = await withQuoteRowLock(input.quoteId, async () => {
    const q = await getQuote(input.quoteId);
    if (!q) return { ok: false as const, error: "That estimate wasn't found." };
    if (CLOSED.has(q.status)) return { ok: false as const, error: "This estimate is closed." };
    if (q.bid?.awardedPartyId) return { ok: false as const, error: "Undo the award before adding a bidder." };
    if (q.customerId && input.companyId === q.customerId) return { ok: false as const, error: "The customer can't bid on its own estimate." };
    const wasBidder = (await listBidders(q.id)).some((p) => p.companyId === input.companyId && p.role === input.role);
    const added = await addParty({ recordType: "quote", recordId: q.id, companyId: input.companyId, contactId: input.contactId ?? null, role: input.role }, by);
    if (!added.ok) return added;
    const party = added.party.bid ? added.party : (await setPartyBid(added.party.id, newBidderState(input.submitVia))) ?? added.party;
    return { ok: true as const, party, q, existed: wasBidder };
  });
  if (!gate.ok) return gate;
  const { party, q, existed } = gate;
  // The owner is the customer (spec §3.4): make it explicit on a bid.
  if (q.customerId && !(await listFor("quote", q.id)).some((p) => p.role === "owner")) {
    await addParty({ recordType: "quote", recordId: q.id, companyId: q.customerId, role: "owner" }, by);
  }
  // The lead keeps the job's full GC/EC list (spec §3.5).
  if (q.leadId && (await getDoc("leads", q.leadId))) {
    await addParty({ recordType: "lead", recordId: q.leadId, companyId: input.companyId, contactId: input.contactId ?? null, role: input.role }, by);
  }
  return { ok: true, party, existed };
}

async function bidderRow(partyId: string): Promise<{ party: Bidder; quote: Quote } | { error: string }> {
  const p = await getDoc<Party>("record_parties", partyId);
  if (!p || p.recordType !== "quote" || !isBidder(p)) return { error: "That bidder wasn't found." };
  const q = await getQuote(p.recordId);
  if (!q) return { error: "That estimate wasn't found." };
  return { party: p, quote: q };
}

/** Look the bidder up to learn its quote, then re-read it (and the quote) under the quote's row lock and
 *  refuse a closed estimate — every bidder edit is read-modify-write, so it must not race an award. */
async function withBidderLocked<T extends { ok: boolean }>(
  partyId: string,
  fn: (row: { party: Bidder; quote: Quote }) => Promise<T>
): Promise<T | { ok: false; error: string }> {
  const first = await getDoc<Party>("record_parties", partyId);
  if (!first || first.recordType !== "quote") return { ok: false, error: "That bidder wasn't found." };
  return withQuoteRowLock(first.recordId, async () => {
    const row = await bidderRow(partyId);
    if ("error" in row) return { ok: false as const, error: row.error };
    if (CLOSED.has(row.quote.status)) return { ok: false as const, error: "This estimate is closed." };
    return fn(row);
  });
}

export async function updateBidder(partyId: string, raw: unknown): Promise<{ ok: true; party: Party } | { ok: false; error: string }> {
  const clean = sanitizeBidderPatch(raw);
  if (!clean.ok) return clean;
  return withBidderLocked(partyId, async (row) => {
    if (clean.value.result && row.quote.bid?.awardedPartyId) return { ok: false as const, error: "Undo the award first." };
    if (clean.value.result && row.party.bid.result !== "pending" && row.party.bid.result !== "withdrew" && row.party.bid.result !== "no_bid")
      return { ok: false as const, error: "Undo the award first." };
    const saved = await setPartyBid(partyId, applyBidderPatch(row.party.bid, clean.value));
    return saved ? { ok: true as const, party: saved } : { ok: false as const, error: "That bidder wasn't found." };
  });
}

export async function markSubmitted(partyId: string, by: string, confirmation: string): Promise<{ ok: true; party: Party } | { ok: false; error: string }> {
  return withBidderLocked(partyId, async (row) => {
    if (row.party.bid.result !== "pending") return { ok: false as const, error: "Only a pending bidder can be marked submitted." };
    const saved = await setPartyBid(partyId, markSubmittedState(row.party.bid, currentRev(row.quote), by, confirmation, Date.now()));
    return saved ? { ok: true as const, party: saved } : { ok: false as const, error: "That bidder wasn't found." };
  });
}

// LOCK ORDER: every bid write takes the quote ROW lock first (withQuoteRowLock) — the same order as
// setStatus("won"), which row-locks and only then takes the advisory lock in spawnFromQuote. Taking the
// advisory lock first here would invert that and let an award land on a won quote.
export async function awardBid(quoteId: string, partyId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  return withQuoteRowLock(quoteId, async () => {
    const q = await getQuote(quoteId);
    if (!q) return { ok: false as const, error: "That estimate wasn't found." };
    if (!canAward(q.status)) return { ok: false as const, error: "Only an open estimate can be awarded." };
    if (q.bid?.awardedPartyId) return { ok: false as const, error: "This bid is already awarded — undo that first." };
    const plan = awardPlan(await listBidders(quoteId), partyId);
    if (!plan.ok) return plan;
    for (const u of plan.updates) await setPartyBid(u.id, u.bid);
    await patchQuoteBid(quoteId, (bid) => ({ ...bid, awardedPartyId: partyId }));
    return { ok: true as const };
  });
}

export async function undoAward(quoteId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  return withQuoteRowLock(quoteId, async () => {
    const q = await getQuote(quoteId);
    if (!q) return { ok: false as const, error: "That estimate wasn't found." };
    if (!canUndoAward(q.status)) return { ok: false as const, error: "The estimate is won — the award can't be undone." };
    if (!q.bid?.awardedPartyId) return { ok: false as const, error: "Nothing is awarded." };
    for (const u of undoAwardPlan(await listBidders(quoteId))) await setPartyBid(u.id, u.bid);
    await patchQuoteBid(quoteId, (bid) => ({ ...bid, awardedPartyId: null }));
    return { ok: true as const };
  });
}

/** The party when it is a live GC/EC bidder row on THIS quote. Call under the quote's row lock. */
async function bidderOnQuote(quoteId: string, partyId: string): Promise<Bidder | null> {
  const p = await getDoc<Party>("record_parties", partyId);
  return p && p.recordType === "quote" && p.recordId === quoteId && isBidder(p) ? p : null;
}

/**
 * #348 2b-ii — record one bidder email (sent, or failed after the thread existed): the estimate-email entry
 * (remembers the bidder; idempotent by thread, no updatedAt bump) and the bidder's own state. Does not require
 * `pending` — a bidder awarded while its email was in flight still gets the true `revSent`. Row lock first.
 * Returns whether the party write happened.
 */
export async function recordBidderSend(
  quoteId: string,
  partyId: string,
  entry: EstimateEmailEntry,
  outcome: { kind: "sent" } | { kind: "failed"; error: string; unknown?: boolean },
  by: string
): Promise<boolean> {
  return withQuoteRowLock(quoteId, async () => {
    const p = await bidderOnQuote(quoteId, partyId);
    // The email already went out (or its draft exists): record it even when the bidder vanished mid-send — only the party write is skipped.
    await recordEstimateEmail(quoteId, { ...entry, partyId });
    if (!p) return false;
    const next = outcome.kind === "sent"
      ? bidderSentState(p.bid, entry.rev, by, entry.threadId, entry.at)
      : bidderFailedState(p.bid, { at: entry.at, error: outcome.error, unknown: outcome.unknown }, entry.threadId);
    return !!(await setPartyBid(partyId, next));
  });
}

/** A send that failed before the email went out: stamp the failure on the bidder, nothing else (plus the leftover
 *  draft's `threadId` when one exists). */
export async function markBidderSendFailed(quoteId: string, partyId: string, f: { at: number; error: string; unknown?: boolean; threadId?: string }): Promise<boolean> {
  return withQuoteRowLock(quoteId, async () => {
    const p = await bidderOnQuote(quoteId, partyId);
    return p ? !!(await setPartyBid(partyId, bidderFailedState(p.bid, f, f.threadId))) : false;
  });
}

/** One more open of this bidder's link. Counts on the party only — never Quote.shareOpens, never patchQuote. */
export async function recordBidderOpen(quoteId: string, partyId: string, now: number): Promise<boolean> {
  return withQuoteRowLock(quoteId, async () => {
    const p = await bidderOnQuote(quoteId, partyId);
    if (!p) return false;
    const opens = nextBidderOpens(p.bid.opens, now);
    return opens ? !!(await setPartyBid(partyId, { ...p.bid, opens })) : false;
  });
}
