import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * #293 slice 3 — the client share-link token (spec §2.6, §7). Modeled on the
 * print token (src/lib/quote-pdf/token.ts), domain-separated ("share:" vs
 * "print:") and keyed to a per-quote nonce stored on the quote
 * (Quote.shareLink): `<exp>.<base64url HMAC-SHA256(secret,
 * "share:quote:<id>:<nonce>:<exp>")>`. The nonce is stored on the quote doc
 * — never sent to the Client link panel, but /api/sync/pull ships whole quote
 * docs (nonce included) to active team users. That is not a credential: a
 * token can't be made without AUTH_SECRET. A token dies the moment the
 * nonce rotates (Revoke) or the stored expiry changes. Pure: the secret and
 * the clock are parameters. Server-only (node:crypto) — never import from a
 * client component.
 */
export const SHARE_DEFAULT_TTL_MS = 60 * 86_400_000;
export const SHARE_MAX_TTL_MS = 366 * 86_400_000;
/** No leading zero on the expiry: one expiry has exactly one spelling, so
 *  "0" + a valid token never verifies. */
export const SHARE_TOKEN_RE = /^([1-9]\d{0,14})\.([A-Za-z0-9_-]{43})$/;

/** 32 random bytes, base64url (43 chars). Rotated on every revoke. */
export function newShareNonce(): string {
  return randomBytes(32).toString("base64url");
}

function mac(secret: string, quoteId: string, nonce: string, exp: number): string {
  return createHmac("sha256", secret).update(`share:quote:${quoteId}:${nonce}:${exp}`).digest("base64url");
}

export function signShareToken(secret: string, quoteId: string, nonce: string, exp: number): string {
  if (!secret) throw new Error("AUTH_SECRET is required to sign a share token.");
  if (!nonce || !Number.isSafeInteger(exp) || exp <= 0) throw new Error("A share token needs a nonce and a positive expiry.");
  return `${exp}.${mac(secret, quoteId, nonce, exp)}`;
}

/** Fails closed on anything but a valid, unexpired MAC for exactly this
 *  quote id + stored nonce + stored expiry (spec §2.6). */
export function verifyShareToken(
  secret: string,
  token: string,
  quoteId: string,
  stored: { nonce: string; expiresAt: number } | null | undefined,
  nowMs: number
): boolean {
  if (!secret || typeof token !== "string" || typeof quoteId !== "string" || !quoteId) return false;
  if (!stored || typeof stored.nonce !== "string" || !stored.nonce || typeof stored.expiresAt !== "number") return false;
  if (!(stored.expiresAt > 0)) return false; // revoked, or never created
  // A NaN clock makes both expiry comparisons false — fail closed instead.
  if (!Number.isFinite(nowMs)) return false;
  const m = SHARE_TOKEN_RE.exec(token);
  if (!m) return false;
  const exp = Number(m[1]);
  if (!Number.isSafeInteger(exp) || exp !== stored.expiresAt) return false;
  if (nowMs > exp || exp - nowMs > SHARE_MAX_TTL_MS) return false;
  const want = Buffer.from(mac(secret, quoteId, stored.nonce, exp));
  const have = Buffer.from(m[2]);
  return want.length === have.length && timingSafeEqual(want, have);
}

/* ---------------------------------------------------------------------
 * #301 slice B (D-g, R11) — the v2, revision-pinned token:
 * `<exp>.<rev>.<base64url HMAC-SHA256(secret,
 * "share:quote:<id>:<rev>:<nonce>:<exp>")>`. Same per-quote nonce and
 * expiry as v1 (Quote.shareLink — no storage change), so Revoke kills
 * every v1 AND v2 token at once. `rev` is QuoteRevision.rev (the 1-based
 * array position, manual snapshots included) and sits inside the MAC, so a
 * token can't be moved to another revision. Domain separation from v1: the
 * v2 string has one more `:` field, and the nonce (base64url, never `:`)
 * is each quote's own random value — neither MAC can stand in for the
 * other. The shapes never overlap either: v1's MAC group has no `.`.
 * --------------------------------------------------------------------- */
export const SHARE_TOKEN_V2_RE = /^([1-9]\d{0,14})\.([1-9]\d{0,5})\.([A-Za-z0-9_-]{43})$/;
const MAX_TOKEN_REV = 999_999;

function macV2(secret: string, quoteId: string, rev: number, nonce: string, exp: number): string {
  return createHmac("sha256", secret).update(`share:quote:${quoteId}:${rev}:${nonce}:${exp}`).digest("base64url");
}

export function signShareTokenV2(secret: string, quoteId: string, rev: number, nonce: string, exp: number): string {
  if (!secret) throw new Error("AUTH_SECRET is required to sign a share token.");
  if (!nonce || !Number.isSafeInteger(exp) || exp <= 0) throw new Error("A share token needs a nonce and a positive expiry.");
  if (!Number.isSafeInteger(rev) || rev < 1 || rev > MAX_TOKEN_REV) throw new Error("A v2 share token needs a revision number 1–999,999.");
  return `${exp}.${rev}.${macV2(secret, quoteId, rev, nonce, exp)}`;
}

/** The pinned revision when `token` is a valid, unexpired v2 MAC for exactly
 *  this quote id + stored nonce + stored expiry; null otherwise (fails closed). */
export function verifyShareTokenV2(
  secret: string,
  token: string,
  quoteId: string,
  stored: { nonce: string; expiresAt: number } | null | undefined,
  nowMs: number
): number | null {
  if (!secret || typeof token !== "string" || typeof quoteId !== "string" || !quoteId) return null;
  if (!stored || typeof stored.nonce !== "string" || !stored.nonce || typeof stored.expiresAt !== "number") return null;
  if (!(stored.expiresAt > 0)) return null;
  if (!Number.isFinite(nowMs)) return null;
  const m = SHARE_TOKEN_V2_RE.exec(token);
  if (!m) return null;
  const exp = Number(m[1]);
  const rev = Number(m[2]);
  if (!Number.isSafeInteger(exp) || exp !== stored.expiresAt || !Number.isSafeInteger(rev) || rev < 1) return null;
  if (nowMs > exp || exp - nowMs > SHARE_MAX_TTL_MS) return null;
  const want = Buffer.from(macV2(secret, quoteId, rev, stored.nonce, exp));
  const have = Buffer.from(m[3]);
  return want.length === have.length && timingSafeEqual(want, have) ? rev : null;
}

/* ---------------------------------------------------------------------
 * #348 slice 2b-ii — the v3, bidder-addressed token:
 * `<exp>.<rev>.<hex16>.<base64url HMAC-SHA256(secret,
 * "share:bidder:<id>:<rev>:<partyId>:<nonce>:<exp>")>` where hex16 is the
 * bidder party id's hex (`pty_` + 16 hex). Same per-quote nonce and expiry
 * as v1/v2, so Revoke kills every v1, v2 and v3 token at once. Four dotted
 * parts, so it never overlaps v1 (two) or v2 (three, a 43-char MAC third).
 * The `share:bidder:` prefix keeps it domain-separated from `share:quote:`.
 * --------------------------------------------------------------------- */
export const SHARE_TOKEN_V3_RE = /^([1-9]\d{0,14})\.([1-9]\d{0,5})\.([0-9a-f]{16})\.([A-Za-z0-9_-]{43})$/;
const BIDDER_PARTY_RE = /^pty_[0-9a-f]{16}$/;

function macV3(secret: string, quoteId: string, rev: number, partyId: string, nonce: string, exp: number): string {
  return createHmac("sha256", secret).update(`share:bidder:${quoteId}:${rev}:${partyId}:${nonce}:${exp}`).digest("base64url");
}

export function signShareTokenV3(secret: string, quoteId: string, rev: number, partyId: string, nonce: string, exp: number): string {
  if (!secret) throw new Error("AUTH_SECRET is required to sign a share token.");
  if (!nonce || !Number.isSafeInteger(exp) || exp <= 0) throw new Error("A share token needs a nonce and a positive expiry.");
  if (!Number.isSafeInteger(rev) || rev < 1 || rev > MAX_TOKEN_REV) throw new Error("A v3 share token needs a revision number 1–999,999.");
  if (typeof partyId !== "string" || !BIDDER_PARTY_RE.test(partyId)) throw new Error("A v3 share token needs a bidder party id (pty_ + 16 hex).");
  return `${exp}.${rev}.${partyId.slice(4)}.${macV3(secret, quoteId, rev, partyId, nonce, exp)}`;
}

/** The pinned revision and bidder when `token` is a valid, unexpired v3 MAC for
 *  exactly this quote id + stored nonce + stored expiry; null otherwise (fails closed). */
export function verifyShareTokenV3(
  secret: string,
  token: string,
  quoteId: string,
  stored: { nonce: string; expiresAt: number } | null | undefined,
  nowMs: number
): { rev: number; partyId: string } | null {
  if (!secret || typeof token !== "string" || typeof quoteId !== "string" || !quoteId) return null;
  if (!stored || typeof stored.nonce !== "string" || !stored.nonce || typeof stored.expiresAt !== "number") return null;
  if (!(stored.expiresAt > 0)) return null;
  if (!Number.isFinite(nowMs)) return null;
  const m = SHARE_TOKEN_V3_RE.exec(token);
  if (!m) return null;
  const exp = Number(m[1]);
  const rev = Number(m[2]);
  if (!Number.isSafeInteger(exp) || exp !== stored.expiresAt || !Number.isSafeInteger(rev) || rev < 1) return null;
  if (nowMs > exp || exp - nowMs > SHARE_MAX_TTL_MS) return null;
  const partyId = `pty_${m[3]}`;
  const wantMac = Buffer.from(macV3(secret, quoteId, rev, partyId, stored.nonce, exp));
  const haveMac = Buffer.from(m[4]);
  return wantMac.length === haveMac.length && timingSafeEqual(wantMac, haveMac) ? { rev, partyId } : null;
}

export type ParsedShareToken =
  | { v: 1; exp: number }
  | { v: 2; exp: number; rev: number }
  | { v: 3; exp: number; rev: number; partyId: string };

/** Shape only — never a verification. */
export function parseShareToken(token: unknown): ParsedShareToken | null {
  if (typeof token !== "string") return null;
  const m1 = SHARE_TOKEN_RE.exec(token);
  if (m1) return { v: 1, exp: Number(m1[1]) };
  const m2 = SHARE_TOKEN_V2_RE.exec(token);
  if (m2) return { v: 2, exp: Number(m2[1]), rev: Number(m2[2]) };
  const m3 = SHARE_TOKEN_V3_RE.exec(token);
  if (m3) return { v: 3, exp: Number(m3[1]), rev: Number(m3[2]), partyId: `pty_${m3[3]}` };
  return null;
}

export function isShareTokenV2(token: unknown): boolean {
  return parseShareToken(token)?.v === 2;
}

/** A rev-pinned package link: the owner's v2 or a bidder's v3. */
export function isPackageToken(token: unknown): boolean {
  const v = parseShareToken(token)?.v;
  return v === 2 || v === 3;
}
