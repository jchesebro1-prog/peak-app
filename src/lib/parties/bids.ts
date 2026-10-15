/* #348 slice 2a — the pure bid rules. Browser-safe: client components read labels and status text from here.
   The stores (src/lib/stores/bids.ts, parties.ts, quotes.ts) are the only writers and call these. */
import { chicagoShortDate, chicagoTime, dayDiff, dayKey } from "@/lib/triage/clock";
import type { BidderState } from "./rules";

export const BID_RESULTS = ["pending", "awarded", "lost", "withdrew", "no_bid"] as const;
export type BidResult = (typeof BID_RESULTS)[number];
export const BID_RESULT_LABEL: Record<BidResult, string> = {
  pending: "Pending",
  awarded: "Awarded",
  lost: "Lost the award",
  withdrew: "Withdrew",
  no_bid: "No bid",
};

export type BidAddendum = { no: number; receivedAt: number; note: string };
export type QuoteBid = { dueAt: number | null; addenda: BidAddendum[]; awardedPartyId: string | null };
export const EMPTY_BID: QuoteBid = { dueAt: null, addenda: [], awardedPartyId: null };

const ADDENDA_MAX = 30;
const NOTE_MAX = 200;
const BIDNO_MAX = 60;
const CONF_MAX = 120;
const URL_MAX = 500;
export const BID_TIME_MIN = Date.UTC(2000, 0, 1);
export const BID_TIME_MAX = Date.UTC(2100, 0, 1);
const isMs = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= BID_TIME_MIN && n <= BID_TIME_MAX;

/** A bid-details edit. A missing `dueAt` / `addenda` key means "keep the current value" (the store merges);
 *  an explicit `dueAt: null` clears the due date. */
export function sanitizeBidDetails(
  raw: unknown
): { ok: true; value: { dueAt?: number | null; addenda?: BidAddendum[] } } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Nothing to save." };
  const r = raw as { dueAt?: unknown; addenda?: unknown };
  if (r.dueAt !== null && r.dueAt !== undefined && !isMs(r.dueAt)) return { ok: false, error: "Pick a valid due date." };
  if (r.addenda !== undefined && !Array.isArray(r.addenda)) return { ok: false, error: "Addenda must be a list." };
  const list = Array.isArray(r.addenda) ? r.addenda : [];
  if (list.length > ADDENDA_MAX) return { ok: false, error: `Keep it to ${ADDENDA_MAX} addenda.` };
  const out: BidAddendum[] = [];
  const seen = new Set<number>();
  for (const a of list) {
    const x = (a || {}) as { no?: unknown; receivedAt?: unknown; note?: unknown };
    if (typeof x.no !== "number" || !Number.isInteger(x.no) || x.no < 1 || x.no > 99) return { ok: false, error: "Addendum numbers run 1 to 99." };
    if (seen.has(x.no)) return { ok: false, error: `Addendum ${x.no} is listed twice.` };
    if (!isMs(x.receivedAt)) return { ok: false, error: `Addendum ${x.no} needs a received date.` };
    const note = typeof x.note === "string" ? x.note.trim() : "";
    if (note.length > NOTE_MAX) return { ok: false, error: "Keep each addendum note under 200 characters." };
    seen.add(x.no);
    out.push({ no: x.no, receivedAt: x.receivedAt, note });
  }
  out.sort((a, b) => a.no - b.no);
  const value: { dueAt?: number | null; addenda?: BidAddendum[] } = {};
  if ("dueAt" in r && r.dueAt !== undefined) value.dueAt = isMs(r.dueAt) ? r.dueAt : null;
  if ("addenda" in r && r.addenda !== undefined) value.addenda = out;
  return { ok: true, value };
}

export function sanitizeBidSiteUrl(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return { ok: true, value: null };
  if (s.length > URL_MAX) return { ok: false, error: "That link is too long." };
  if (!/^https?:\/\/[^\s]+$/i.test(s)) return { ok: false, error: "Use a link that starts with http:// or https://." };
  return { ok: true, value: s };
}

export type BidderPatch = Partial<Pick<BidderState, "submitVia" | "bidSiteUrl" | "gcBidNo">> & { result?: "pending" | "withdrew" | "no_bid" };

/** A bidder edit from the UI. Present keys only; a blank bidSiteUrl/gcBidNo clears (key present, value undefined). */
export function sanitizeBidderPatch(raw: unknown): { ok: true; value: BidderPatch } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Nothing to save." };
  const r = raw as Record<string, unknown>;
  const out: BidderPatch = {};
  if ("submitVia" in r) {
    if (r.submitVia !== "email" && r.submitVia !== "website") return { ok: false, error: "Submit via email or their bid website." };
    out.submitVia = r.submitVia;
  }
  if ("bidSiteUrl" in r) {
    if (r.bidSiteUrl !== null && r.bidSiteUrl !== undefined && typeof r.bidSiteUrl !== "string") return { ok: false, error: "That value isn't text." };
    const u = sanitizeBidSiteUrl(r.bidSiteUrl);
    if (!u.ok) return u;
    out.bidSiteUrl = u.value ?? undefined;
  }
  if ("gcBidNo" in r) {
    if (r.gcBidNo !== null && r.gcBidNo !== undefined && typeof r.gcBidNo !== "string") return { ok: false, error: "That value isn't text." };
    const n = typeof r.gcBidNo === "string" ? r.gcBidNo.trim() : "";
    if (n.length > BIDNO_MAX) return { ok: false, error: "Keep the bid number under 60 characters." };
    out.gcBidNo = n || undefined;
  }
  if ("result" in r) {
    if (r.result !== "pending" && r.result !== "withdrew" && r.result !== "no_bid") return { ok: false, error: "Award and lost are set by Award." };
    out.result = r.result;
  }
  return { ok: true, value: out };
}

export function newBidderState(submitVia: "email" | "website" = "email"): BidderState {
  return { result: "pending", submitVia, revSent: null, sentAt: null, sentBy: null, threadId: null, failed: null };
}

export function applyBidderPatch(bid: BidderState, patch: BidderPatch): BidderState {
  const next: BidderState = { ...bid };
  for (const k of Object.keys(patch) as Array<keyof BidderPatch>) {
    const v = patch[k];
    if (v === undefined) delete (next as Record<string, unknown>)[k];
    else (next as Record<string, unknown>)[k] = v;
  }
  return next;
}

export function markSubmittedState(bid: BidderState, rev: number, by: string, confirmation: string, now: number): BidderState {
  const conf = (typeof confirmation === "string" ? confirmation : "").trim().slice(0, CONF_MAX);
  const next: BidderState = { ...bid, revSent: rev, sentAt: now, sentBy: by, failed: null };
  if (conf) next.confirmation = conf;
  else delete next.confirmation;
  return next;
}

/** The `rev` of the latest SENT revision; before any send, max(1, revisions.length). Inlined (no quote-pdf import). */
export function currentRev(q: { revisions?: unknown[] | null }): number {
  const revs = Array.isArray(q.revisions) ? q.revisions : [];
  for (let i = revs.length - 1; i >= 0; i--) {
    const r = revs[i] as { reason?: unknown; rev?: unknown } | null;
    if (r && typeof r === "object" && r.reason === "sent" && typeof r.rev === "number" && Number.isSafeInteger(r.rev)) return r.rev;
  }
  return Math.max(1, revs.length || 1);
}

export function bidderSentState(bid: BidderState, rev: number, by: string, threadId: string, at: number): BidderState {
  return { ...bid, revSent: rev, sentAt: at, sentBy: by, threadId, failed: null };
}

export function bidderFailedState(bid: BidderState, f: { at: number; error: string; unknown?: boolean }, threadId?: string | null): BidderState {
  const next: BidderState = { ...bid, failed: { at: f.at, error: String(f.error).slice(0, 300), ...(f.unknown ? { unknown: true } : {}) } };
  if (threadId) next.threadId = threadId;
  return next;
}

export function nextBidderOpens(prev: unknown, now: number): { count: number; lastAt: number } | null {
  if (typeof now !== "number" || !Number.isFinite(now) || now <= 0) return null;
  const p = prev as { count?: unknown; lastAt?: unknown } | null | undefined;
  if (!p || typeof p !== "object" || typeof p.count !== "number" || !Number.isFinite(p.count) || typeof p.lastAt !== "number" || !Number.isFinite(p.lastAt)) {
    return { count: 1, lastAt: now };
  }
  return { count: Math.min(p.count + 1, 1_000_000), lastAt: Math.max(p.lastAt, now) };
}

export function bidderOpensText(o: { count: number; lastAt: number } | null | undefined): string {
  return o && o.count > 0 ? `Opened ${o.count}×` : "";
}

export function bidderOpensTitle(o: { count: number; lastAt: number } | null | undefined): string {
  return o && o.count > 0 && isMs(o.lastAt) ? `Last opened ${chicagoShortDate(o.lastAt)}, ${chicagoTime(o.lastAt)}` : "";
}

export function needsRev(bid: BidderState | null, rev: number): boolean {
  if (!bid || bid.result !== "pending") return false;
  return bid.revSent == null || bid.revSent < rev;
}

export function awardPlan(
  bidders: ReadonlyArray<{ id: string; bid: BidderState }>,
  partyId: string
): { ok: true; updates: Array<{ id: string; bid: BidderState }> } | { ok: false; error: string } {
  const winner = bidders.find((b) => b.id === partyId);
  if (!winner) return { ok: false, error: "That company isn't a bidder on this estimate." };
  if (bidders.some((b) => b.bid.result === "awarded")) return { ok: false, error: "This bid is already awarded — undo that first." };
  if (winner.bid.result !== "pending") return { ok: false, error: "That bidder withdrew or didn't bid." };
  const updates: Array<{ id: string; bid: BidderState }> = [{ id: winner.id, bid: { ...winner.bid, result: "awarded" } }];
  for (const b of bidders) {
    if (b.id === partyId || b.bid.result !== "pending") continue;
    updates.push({ id: b.id, bid: { ...b.bid, result: "lost", lostByAward: true } });
  }
  return { ok: true, updates };
}

export function undoAwardPlan(bidders: ReadonlyArray<{ id: string; bid: BidderState }>): Array<{ id: string; bid: BidderState }> {
  const out: Array<{ id: string; bid: BidderState }> = [];
  for (const b of bidders) {
    if (b.bid.result === "awarded" || (b.bid.result === "lost" && b.bid.lostByAward)) {
      const next: BidderState = { ...b.bid, result: "pending" };
      delete next.lostByAward;
      out.push({ id: b.id, bid: next });
    }
  }
  return out;
}

export const canAward = (status: string): boolean => status === "draft" || status === "sent";
export const canUndoAward = (status: string): boolean => status !== "won";

export function bidDueText(dueAt: number): string {
  if (!isMs(dueAt)) return "";
  return `${chicagoShortDate(dueAt)}, ${chicagoTime(dueAt)}`;
}

export function bidderStatusText(bid: BidderState, rev: number): string {
  if (bid.result !== "pending") return BID_RESULT_LABEL[bid.result];
  const website = bid.submitVia === "website";
  if (bid.failed && (bid.revSent == null || bid.revSent < rev)) return "Send failed";
  if (bid.revSent == null) return website ? "Not submitted" : "Not sent";
  if (bid.revSent < rev) return `Needs Rev ${rev}`;
  return `${website ? "Submitted" : "Sent"} Rev ${bid.revSent}${isMs(bid.sentAt) ? ` · ${chicagoShortDate(bid.sentAt)}` : ""}`;
}

export function bidDueDays(dueAt: number, now: number): number {
  if (!isMs(dueAt) || !isMs(now)) return Number.POSITIVE_INFINITY;
  return dayDiff(dayKey(now), dayKey(dueAt));
}

export function isOpenBid(q: { status?: string; bid?: QuoteBid | null }, bidders: ReadonlyArray<{ bid: BidderState | null }>): boolean {
  if (q.status !== "draft" && q.status !== "sent") return false;
  if (q.bid?.awardedPartyId) return false;
  return bidders.some((b) => b.bid?.result === "pending");
}
