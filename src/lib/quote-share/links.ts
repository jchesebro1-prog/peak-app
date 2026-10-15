import { get as getQuote, patchShareLink, recordShareOpen, type Quote, type QuoteRevision } from "@/lib/stores/quotes";
import { createHmac } from "node:crypto";
import { rateLimit, rateLimitRefund } from "@/lib/rate-limit";
import { SHARE_OPEN_DEDUPE_MS } from "@/lib/estimate-output/opens";
import { latestSentRevision } from "@/lib/quote-pdf/state";
import { parseShareToken, SHARE_TOKEN_RE, signShareToken, signShareTokenV2, signShareTokenV3, verifyShareToken, verifyShareTokenV2, verifyShareTokenV3 } from "./token";
import { getCompany } from "@/lib/identity/companies";
import { bidderPartyFor } from "@/lib/parties/addressee-server";
import { BID_SEND_COPY, isPartyId, latestSentRev } from "@/lib/parties/bid-send";
import type { BidderState } from "@/lib/parties/rules";
import { recordBidderOpen } from "@/lib/stores/bids";
import { cleanBidderName } from "@/lib/estimate-output/responses";
import {
  ONLINE_COPY, onlineEstimateState, shareEligibility, sharePath,
  type OnlineEstimateState, type ShareLinkStatus, type ShareLinkView,
} from "./view";
import { packageState, sentRevisionRows, type VisiblePackageState } from "./package-view";

/**
 * #293 slice 3 — client share links, server side (spec §5.3, §5.5, §7).
 * Create (re-copy returns the same link), revoke (rotate the nonce AND set
 * expiry 0), describe for a browser (never the nonce), and resolve a public
 * request. The store's patchShareLink is the only writer and mints every
 * nonce and expiry; this module only asks it to. `resolveSharedQuote` only
 * READS — a public GET never writes.
 */

export const SHARE_ID_MAX = 64;
export const SHARE_VIEW_PER_MIN = 60;
export const SHARE_PHOTO_PER_MIN = 300;
/** #301 slice C — the package page's downloads (spec §6, R10). */
export const SHARE_DOC_PER_MIN = 120;
export const SHARE_FILE_PER_MIN = 120;
export const SHARE_ZIP_PER_WINDOW = 6;
export const SHARE_ZIP_WINDOW_MS = 10 * 60_000;

export function shareSecret(): string {
  return process.env.AUTH_SECRET || "";
}

export function shareLinkView(q: Pick<Quote, "id" | "shareLink" | "revisions">, secret: string, now: number, withPath = true): ShareLinkView | null {
  const l = q.shareLink;
  if (!l) return null;
  const active = !!secret && typeof l.nonce === "string" && !!l.nonce && l.expiresAt > now;
  // #301 slice B: the copyable link pins the latest SENT revision (D-g).
  const latest = active && withPath ? latestSentRevision(q.revisions) : null;
  return {
    active,
    path: active && withPath ? sharePath(q.id, signShareToken(secret, q.id, l.nonce, l.expiresAt)) : null,
    pathV2: latest ? sharePath(q.id, signShareTokenV2(secret, q.id, latest.rev, l.nonce, l.expiresAt)) : null,
    expiresAt: l.expiresAt,
    createdAt: l.createdAt,
    createdBy: l.createdBy,
    revokedAt: l.revokedAt ?? null,
    revokedBy: l.revokedBy ?? null,
  };
}

/** The Client link panel's read: the paths only for a Send holder; the
 *  per-revision rows (no paths) for anyone signed in. */
export function shareLinkStatus(q: Quote, canSend: boolean, secret: string, now: number): ShareLinkStatus {
  return { state: shareEligibility(q), canSend, link: shareLinkView(q, secret, now, canSend), sentRevs: sentRevisionRows(q) };
}

export type ShareWrite = { ok: true; link: ShareLinkView } | { ok: false; error: string };

function refusalFor(q: Quote): string | null {
  const e = shareEligibility(q);
  if (e === "ok") return null;
  return e === "revising" ? ONLINE_COPY.revisingStaff : e === "not-sent" ? ONLINE_COPY.notSent : ONLINE_COPY.notShareable;
}

/** Copy client link: an active link comes back unchanged; otherwise a fresh
 *  60-day one is written. Refused unless the quote's online state is ok. */
export async function ensureShareLink(quoteId: string, by: string, opts: { now?: number; secret?: string } = {}): Promise<ShareWrite> {
  const now = opts.now ?? Date.now();
  const secret = opts.secret ?? shareSecret();
  if (!secret) return { ok: false, error: ONLINE_COPY.noSecret };
  const cur = await getQuote(quoteId);
  if (!cur) return { ok: false, error: ONLINE_COPY.gone };
  const pre = refusalFor(cur);
  if (pre) return { ok: false, error: pre };
  // Fast path: an active link is returned without a write.
  const live = shareLinkView(cur, secret, now);
  if (live?.active) return { ok: true, link: live };
  // Re-checked under the row lock: a recall or a parallel create since the read.
  // Widened by hand: TS doesn't see the callback's assignment, and an
  // annotated `null` initialiser would narrow `refusal` to null below.
  let refusal = null as string | null;
  const res = await patchShareLink(quoteId, {
    kind: "create",
    by,
    now,
    allow: (doc) => {
      refusal = refusalFor(doc);
      return !refusal;
    },
  });
  if (!res) return { ok: false, error: ONLINE_COPY.gone };
  if (refusal) return { ok: false, error: refusal };
  const link = shareLinkView(res.quote, secret, now);
  return link?.active ? { ok: true, link } : { ok: false, error: ONLINE_COPY.gone };
}

/** Revoke: a fresh nonce and expiry 0 — every earlier token fails twice over.
 *  A quote that never had a link has nothing to revoke: no write. */
export async function revokeShareLink(quoteId: string, by: string, opts: { now?: number } = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  const cur = await getQuote(quoteId);
  if (!cur) return { ok: false, error: ONLINE_COPY.gone };
  if (!cur.shareLink) return { ok: true };
  const res = await patchShareLink(quoteId, { kind: "revoke", by, now: opts.now ?? Date.now() });
  return res ? { ok: true } : { ok: false, error: ONLINE_COPY.gone };
}

/** The public page's (and its photo route's) one check, in order: shape
 *  (no DB read for a malformed id or token) → get → verify → state. Read-only.
 *  null = show the one "isn't active" card, whatever the cause. */
export async function resolveSharedQuote(
  id: string,
  token: string,
  opts: { secret?: string; now?: number } = {}
): Promise<{ q: Quote; state: OnlineEstimateState } | null> {
  if (typeof id !== "string" || !id || id.length > SHARE_ID_MAX) return null;
  if (typeof token !== "string" || !SHARE_TOKEN_RE.test(token)) return null;
  const secret = opts.secret ?? shareSecret();
  if (!secret) return null;
  const q = await getQuote(id);
  if (!q || q.id !== id) return null;
  if (!verifyShareToken(secret, token, id, q.shareLink, opts.now ?? Date.now())) return null;
  return { q, state: onlineEstimateState(q) };
}

/** #348 2b-ii — the bidder a v3 link is addressed to (a live GC/EC bidder row on the quote, its company live). */
export type SharedBidder = { partyId: string; companyId: string; companyName: string; result: BidderState["result"] };

/** #301 slice B — a rev-pinned (v2) package link, resolved. `currentPath`:
 *  the v2 link to the latest sent revision when this one is superseded.
 *  #348 2b-ii: a v3 link carries its `bidder` (and its `currentPath` is the
 *  same bidder's v3); a v2 link has `bidder: null`. */
export type SharedPackage = { q: Quote; rev: QuoteRevision; state: VisiblePackageState; currentPath: string | null; bidder?: SharedBidder | null };

/** The package page's (and its photo route's) one check, in order: shape
 *  (no DB read for a malformed id or a non-package token) → get → v2/v3
 *  verify → packageState → (v3) the bidder row + company. Read-only. null =
 *  the one "isn't active" card — a removed bidder or a deleted company too. */
export async function resolveSharedPackage(
  id: string,
  token: string,
  opts: { secret?: string; now?: number } = {}
): Promise<SharedPackage | null> {
  if (typeof id !== "string" || !id || id.length > SHARE_ID_MAX) return null;
  const parsed = parseShareToken(token);
  if (!parsed || (parsed.v !== 2 && parsed.v !== 3)) return null;
  const secret = opts.secret ?? shareSecret();
  if (!secret) return null;
  const q = await getQuote(id);
  if (!q || q.id !== id || !q.shareLink) return null;
  const now = opts.now ?? Date.now();
  let rev: number;
  let partyId: string | null = null;
  if (parsed.v === 2) {
    const r2 = verifyShareTokenV2(secret, token, id, q.shareLink, now);
    if (r2 == null) return null;
    rev = r2;
  } else {
    const r3 = verifyShareTokenV3(secret, token, id, q.shareLink, now);
    if (!r3) return null;
    rev = r3.rev;
    partyId = r3.partyId;
  }
  const state = packageState(q, rev);
  if (state.kind === "inactive") return null;
  const l = q.shareLink;
  if (partyId == null) {
    const currentPath = state.kind === "superseded" ? sharePath(id, signShareTokenV2(secret, id, state.latestRev, l.nonce, l.expiresAt)) : null;
    return { q, rev: state.rev, state, currentPath, bidder: null };
  }
  // v3: the bidder must still be a live bidder row on THIS quote with a known result, its company live. Any miss → null.
  const party = await bidderPartyFor(q.id, partyId);
  const result = party?.bid?.result;
  if (!party || !result) return null;
  const company = await getCompany(party.companyId);
  if (!company) return null;
  // Superseded: the SAME bidder's v3 at the latest sent revision — never the owner's v2.
  const currentPath = state.kind === "superseded" ? sharePath(id, signShareTokenV3(secret, id, state.latestRev, party.id, l.nonce, l.expiresAt)) : null;
  return {
    q,
    rev: state.rev,
    state,
    currentPath,
    bidder: { partyId: party.id, companyId: party.companyId, companyName: cleanBidderName(company.name), result },
  };
}

/** #348 2b-ii — a bidder's own v3 path to one SENT revision, or null unless the link is active (nonce, unexpired),
 *  `rev` is one of this quote's sent revisions and `partyId` has the bidder-id shape. Pure (no reads). */
export function bidderSharePath(q: Pick<Quote, "id" | "shareLink" | "revisions">, partyId: string, rev: number, secret: string, now: number): string | null {
  const l = q.shareLink;
  if (!secret || !l || typeof l.nonce !== "string" || !l.nonce || !(l.expiresAt > now)) return null;
  if (!isPartyId(partyId) || !Number.isSafeInteger(rev)) return null;
  const revs = Array.isArray(q.revisions) ? q.revisions : [];
  if (!revs.some((r) => !!r && r.rev === rev && r.reason === "sent")) return null;
  return sharePath(q.id, signShareTokenV3(secret, q.id, rev, partyId, l.nonce, l.expiresAt));
}

/** #348 2b-ii — the bidder's link: ensure the quote's share link (its refusals pass through), then sign a v3 for
 *  this bidder at `opts.rev` (default: the latest sent revision). */
export async function bidderLinkPath(
  quoteId: string,
  partyId: string,
  by: string,
  opts: { rev?: number; secret?: string; now?: number } = {}
): Promise<{ ok: true; path: string; rev: number } | { ok: false; error: string }> {
  const now = opts.now ?? Date.now();
  const secret = opts.secret ?? shareSecret();
  const ensured = await ensureShareLink(quoteId, by, { secret, now });
  if (!ensured.ok) return ensured;
  const q = await getQuote(quoteId);
  if (!q) return { ok: false, error: ONLINE_COPY.gone };
  if (!(await bidderPartyFor(q.id, partyId))) return { ok: false, error: BID_SEND_COPY.gone };
  const rev = opts.rev ?? latestSentRev(q);
  const path = rev == null ? null : bidderSharePath(q, partyId, rev, secret, now);
  return path && rev != null ? { ok: true, path, rev } : { ok: false, error: ONLINE_COPY.gone };
}

/** Cheap per-IP guard before any read, for the open beacon. */
export const SHARE_OPEN_PER_MIN = 30;

/** No limiter key ever holds the raw IP: it is an HMAC keyed by the share
 *  secret, so the short hash can't be reversed by brute-forcing IPv4. */
export function openIpKey(ip: string): string {
  return createHmac("sha256", shareSecret()).update(ip || "unknown").digest("base64url").slice(0, 16);
}

/**
 * #301 slice B (D-o, R18) — record one client open of a v2 package link.
 * v1 links and anything resolveSharedPackage refuses record nothing. At
 * most one open per IP-hash per pinned revision per 30 minutes — in memory
 * (the rate limiter), so a restart or a second instance can count one more;
 * best-effort by design. The caller has already skipped team users.
 * #348 2b-ii: a v3 (bidder) open counts on the bidder's party row only
 * (recordBidderOpen), deduped per bidder — never Quote.shareOpens, so the
 * owner's "Opened" chip and Client link rows are unaffected.
 */
export async function recordSharedOpen(id: string, token: string, ip: string, opts: { secret?: string; now?: number } = {}): Promise<boolean> {
  const hit = await resolveSharedPackage(id, token, opts);
  if (!hit) return false;
  const bidder = hit.bidder ?? null;
  const slot = bidder
    ? `share-open:${hit.q.id}:${hit.rev.rev}:${bidder.partyId}:${openIpKey(ip)}`
    : `share-open:${hit.q.id}:${hit.rev.rev}:${openIpKey(ip)}`;
  if (!rateLimit(slot, 1, SHARE_OPEN_DEDUPE_MS).ok) return false;
  // A failed write must not suppress this IP for the whole window: refund the slot.
  const now = opts.now ?? Date.now();
  let recorded = false;
  try {
    recorded = bidder ? await recordBidderOpen(hit.q.id, bidder.partyId, now) : await recordShareOpen(hit.q.id, hit.rev.rev, now);
  } catch (e) {
    rateLimitRefund(slot);
    throw e;
  }
  if (!recorded) rateLimitRefund(slot);
  return recorded;
}
